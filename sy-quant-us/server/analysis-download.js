'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const readline = require('readline');
const zlib = require('zlib');
const { execFile } = require('child_process');

let portfolioManager = null;
try {
  portfolioManager = require('./portfolio-manager');
} catch (error) {
  console.warn('[US 분석자료] portfolio-manager 로드 실패 / 현재 보유현황 교차검증 비활성', error.message);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  return {
    dosDate: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    dosTime: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
  };
}

function normalizeEntry(entry) {
  if (!entry || !entry.name) throw new Error('ZIP entry name is required');
  const name = String(entry.name).replace(/\\/g, '/').replace(/^\/+/, '');
  if (!name || name.includes('../')) throw new Error(`Unsafe ZIP entry path: ${name}`);
  const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data ?? ''), 'utf8');
  return { name, data, mtime: entry.mtime instanceof Date ? entry.mtime : new Date() };
}

function buildZip(entries = []) {
  const files = entries.map(normalizeEntry);
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;

  for (const file of files) {
    const nameBuffer = Buffer.from(file.name, 'utf8');

    // 분석 로그가 아주 커져도 메인 스레드를 과도하게 오래 점유하지 않도록 큰 파일은 STORE 방식 사용.
    const ZIP_DEFLATE_MAX_BYTES = 512 * 1024;
    let compressed = null;
    let useDeflate = false;
    if (file.data.length <= ZIP_DEFLATE_MAX_BYTES) {
      compressed = zlib.deflateRawSync(file.data, { level: 3 });
      useDeflate = compressed.length < file.data.length;
    }

    const payload = useDeflate ? compressed : file.data;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(file.data);
    const { dosDate, dosTime } = dosDateTime(file.mtime);
    const utf8Flag = 0x0800;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(utf8Flag, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(payload.length, 18);
    localHeader.writeUInt32LE(file.data.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, nameBuffer, payload);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(utf8Flag, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(payload.length, 20);
    centralHeader.writeUInt32LE(file.data.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralParts.push(centralHeader, nameBuffer);

    localOffset += localHeader.length + nameBuffer.length + payload.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(localOffset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDir, end]);
}

function dateKey(timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const get = type => parts.find(p => p.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function dateKeyFromValue(value, timeZone) {
  if (value === null || value === undefined || value === '') return '';

  const direct = String(value).trim();
  const directDate = direct.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (directDate) return directDate[1];

  let date = null;
  if (typeof value === 'number' || /^\d{10,13}$/.test(direct)) {
    let ms = Number(value);
    if (String(Math.trunc(ms)).length <= 10) ms *= 1000;
    date = new Date(ms);
  } else {
    date = new Date(value);
  }

  if (!date || Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const get = type => parts.find(p => p.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function timeHHMM(timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date());
  const get = type => parts.find(p => p.type === type)?.value || '00';
  return `${get('hour')}:${get('minute')}`;
}

function validateDate(value, fallback) {
  const date = String(value || fallback || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('date는 YYYY-MM-DD 형식이어야 합니다.');
  return date;
}

function safeJson(value) {
  return JSON.stringify(value, null, 2);
}

function getJson(port, pathname, timeoutMs = 12000) {
  return new Promise(resolve => {
    const req = http.get({
      hostname: '127.0.0.1',
      port,
      path: pathname,
      timeout: timeoutMs,
      headers: { Accept: 'application/json' }
    }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => {
        try {
          const parsed = text ? JSON.parse(text) : {};
          resolve(res.statusCode >= 400
            ? { ok: false, httpStatus: res.statusCode, response: parsed }
            : parsed);
        } catch (error) {
          resolve({ ok: false, error: `JSON 파싱 실패: ${error.message}`, raw: text.slice(0, 20000) });
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error(`API ${timeoutMs}ms 시간초과`)));
    req.on('error', error => resolve({ ok: false, error: error.message }));
  });
}

async function tailLines(filePath, count = 150) {
  if (!fs.existsSync(filePath)) return `[로그파일 없음] ${filePath}\n`;
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const queue = [];
  try {
    for await (const line of rl) {
      queue.push(line);
      if (queue.length > count) queue.shift();
    }
  } finally {
    rl.close();
    stream.destroy();
  }
  return queue.join('\n') + (queue.length ? '\n' : '');
}

function readTextIfExists(filePath, missingMessage = null) {
  if (!fs.existsSync(filePath)) return missingMessage ?? `[파일 없음] ${filePath}\n`;
  return fs.readFileSync(filePath, 'utf8');
}

function addSourceFiles(entries, rootDir, names = []) {
  for (const name of names) {
    const filePath = path.join(rootDir, name);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) continue;
    entries.push({
      name: `source/${name}`,
      data: fs.readFileSync(filePath),
      mtime: fs.statSync(filePath).mtime
    });
  }
}

function runNodeScript(scriptPath, args = [], options = {}) {
  return new Promise(resolve => {
    if (!fs.existsSync(scriptPath)) return resolve(`[실행파일 없음] ${scriptPath}\n`);
    execFile(process.execPath, [...(options.nodeArgs || []), scriptPath, ...args], {
      cwd: options.cwd || path.dirname(scriptPath),
      timeout: options.timeoutMs || 45000,
      maxBuffer: options.maxBuffer || 8 * 1024 * 1024,
      env: process.env
    }, (error, stdout, stderr) => {
      const rows = [];
      if (stdout) rows.push(stdout.trimEnd());
      if (stderr) rows.push(stderr.trimEnd());
      if (error) rows.push(`[실행 오류] ${error.message}`);
      resolve(rows.filter(Boolean).join('\n') + '\n');
    });
  });
}

function sendZip(res, fileName, buffer) {
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Length', String(buffer.length));
  res.setHeader('Content-Disposition', `attachment; filename="${fileName.replace(/[^A-Za-z0-9._-]/g, '_')}"`);
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.end(buffer);
}

const ROOT = __dirname;
const AUTO_STATE_FILE = path.join(ROOT, 'us-paper-auto-state.json');
const PORT = 3001;
const TZ = 'America/New_York';
const PM2_LOG_DIR = '/home/ubuntu/.pm2/logs';

const PM2_KNOWN_OUT = [
  path.join(PM2_LOG_DIR, 'sy-quant-us-server-out.log'),
  path.join(PM2_LOG_DIR, 'sy-quant-us-out.log')
];

const PM2_KNOWN_ERR = [
  path.join(PM2_LOG_DIR, 'sy-quant-us-server-error.log'),
  path.join(PM2_LOG_DIR, 'sy-quant-us-error.log')
];

const STRATEGIES = Object.freeze([
  { id: 'CORE', slug: 'core' },
  { id: 'FAST', slug: 'fast' },
  { id: 'VOLUME', slug: 'volume' },
  { id: 'WAVE', slug: 'wave' }
]);

const TRADE_LINE_RX = /\bBUY\b|\bSELL\b|\bORDER\b|\bFILLED\b|\bFILL\b|체결|매수|매도|익절|손절|청산|PORTFOLIO|MASTER/i;
const IMPORTANT_MASTER_RX = /US-(CORE|FAST|VOLUME|WAVE)|\b(CORE|FAST|VOLUME|WAVE)\b|MASTER|PORTFOLIO|\bBUY\b|\bSELL\b|\bORDER\b|\bFILLED\b|\bFILL\b|체결|매수|매도|보유|차단|후보|전략설정|데이터보정|분석자료|오류|실패/i;

function section(title, body = '') {
  return `===== ${title} =====\n${String(body || '').trimEnd()}\n\n`;
}

function nyDateKeyFromDate(date) {
  return dateKeyFromValue(date instanceof Date ? date.getTime() : date, TZ);
}

function explicitDateFromLogLine(line) {
  const value = String(line || '');

  // timezone/offset가 붙은 ISO timestamp는 반드시 America/New_York 거래일로 환산.
  const iso = value.match(/\b(20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2}))\b/);
  if (iso) {
    const parsed = new Date(iso[1]);
    if (!Number.isNaN(parsed.getTime())) {
      return { explicit: true, date: nyDateKeyFromDate(parsed), source: 'ISO_TZ' };
    }
  }

  // timezone이 없는 timestamp는 기존 운영 로그의 로컬 표기로 보고 표기된 날짜를 그대로 사용.
  const plainIso = value.match(/\b(20\d{2}-\d{2}-\d{2})[T ]\d{2}:\d{2}:\d{2}\b/);
  if (plainIso) return { explicit: true, date: plainIso[1], source: 'PLAIN_ISO' };

  const dateOnly = value.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (dateOnly) return { explicit: true, date: dateOnly[1], source: 'DATE_TEXT' };

  return { explicit: false, date: '', source: 'UNDATED' };
}

function lineBelongsToTradingDate(line, tradingDate) {
  const info = explicitDateFromLogLine(line);
  return info.explicit && info.date === tradingDate;
}

function discoverPm2LogFiles(kind = 'out') {
  const suffix = kind === 'error' ? '-error.log' : '-out.log';
  const known = kind === 'error' ? PM2_KNOWN_ERR : PM2_KNOWN_OUT;
  let discovered = [];

  try {
    discovered = fs.readdirSync(PM2_LOG_DIR)
      .filter(name => name.endsWith(suffix))
      .filter(name => /sy-quant-us|syquant-us|us-server/i.test(name))
      .map(name => path.join(PM2_LOG_DIR, name));
  } catch (_) {}

  return [...new Set([...known, ...discovered])]
    .filter(filePath => fs.existsSync(filePath) && fs.statSync(filePath).isFile());
}

async function filterOneTradingDayLog(filePath, tradingDate, keywordRegex = null, maxLines = 20000) {
  if (!fs.existsSync(filePath)) {
    return {
      filePath,
      confirmedRows: [],
      undatedRows: [],
      truncated: false,
      exists: false,
      error: null
    };
  }

  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const confirmedRows = [];
  const undatedRows = [];
  let truncated = false;

  try {
    for await (const line of rl) {
      if (keywordRegex) {
        keywordRegex.lastIndex = 0;
        if (!keywordRegex.test(line)) continue;
      }

      const info = explicitDateFromLogLine(line);
      if (info.explicit) {
        if (info.date !== tradingDate) continue;
        confirmedRows.push(line);
      } else if (undatedRows.length < 500) {
        // 날짜가 없는 로그는 오늘 거래로 확정하지 않고 참고자료로만 분리.
        undatedRows.push(line);
      }

      if (confirmedRows.length >= maxLines) {
        truncated = true;
        break;
      }
    }
  } catch (error) {
    return {
      filePath,
      confirmedRows,
      undatedRows,
      truncated,
      exists: true,
      error: error.message
    };
  } finally {
    rl.close();
    stream.destroy();
  }

  return { filePath, confirmedRows, undatedRows, truncated, exists: true, error: null };
}

async function filterPm2Logs(kind, tradingDate, keywordRegex = null, maxLines = 40000) {
  const files = discoverPm2LogFiles(kind);
  const confirmedChunks = [];
  const undatedChunks = [];
  const errors = [];
  const matchedFiles = [];
  let confirmedCount = 0;
  let undatedCount = 0;
  let truncated = false;

  for (const filePath of files) {
    const remain = Math.max(1, maxLines - confirmedCount);
    const part = await filterOneTradingDayLog(filePath, tradingDate, keywordRegex, remain);

    if (part.error) errors.push(`${filePath}: ${part.error}`);
    if (part.confirmedRows.length) {
      matchedFiles.push(filePath);
      confirmedCount += part.confirmedRows.length;
      confirmedChunks.push(
        `----- SOURCE: ${filePath} -----\n${part.confirmedRows.join('\n')}`
      );
    }

    if (part.undatedRows.length) {
      undatedCount += part.undatedRows.length;
      undatedChunks.push(
        `----- SOURCE: ${filePath} / 날짜 미확정 참고 -----\n${part.undatedRows.join('\n')}`
      );
    }

    if (part.truncated || confirmedCount >= maxLines) {
      truncated = true;
      break;
    }
  }

  const footer = [];
  footer.push(`조회한 PM2 ${kind} 로그: ${files.length ? files.join(', ') : '[없음]'}`);
  footer.push(`거래일 확정 매칭: ${confirmedCount.toLocaleString()}줄`);
  if (truncated) footer.push(`[이하 생략: 거래일 확정 로그 ${maxLines.toLocaleString()}줄 초과]`);
  if (errors.length) footer.push(`[로그 읽기 오류] ${errors.join(' | ')}`);

  return {
    text: confirmedChunks.length
      ? confirmedChunks.join('\n') + '\n' + footer.join('\n') + '\n'
      : `[해당 거래일 관련 로그 없음]\n${footer.join('\n')}\n`,
    undatedText: undatedChunks.length
      ? undatedChunks.join('\n') + `\n날짜 미확정 참고로그 ${undatedCount.toLocaleString()}줄\n`
      : '[날짜 미확정 참고 로그 없음]\n',
    confirmedCount,
    undatedCount,
    matchedFiles,
    files,
    truncated,
    errors
  };
}

async function tailPm2Errors(count = 150) {
  const files = discoverPm2LogFiles('error');
  if (!files.length) return `[PM2 관련 error 로그파일 없음] ${PM2_LOG_DIR}\n`;

  const parts = [];
  const perFile = Math.max(20, Math.ceil(count / files.length));
  for (const filePath of files) {
    const text = await tailLines(filePath, perFile);
    if (!text.trim()) continue;
    parts.push(`----- SOURCE: ${filePath} -----\n${text.trimEnd()}`);
  }
  return parts.join('\n') + '\n';
}

function strategyLogRegex(id) {
  return new RegExp(
    `US-${id}|\\b${id}\\b|${id}_|MASTER|PORTFOLIO|\\bBUY\\b|\\bSELL\\b|\\bORDER\\b|\\bFILLED\\b|체결|매수|매도|보유|차단|후보`,
    'i'
  );
}

function strategyErrorRegex(id) {
  return new RegExp(
    `US-${id}|\\b${id}\\b|${id}_|MASTER|PORTFOLIO|error|fail|timeout|시간초과|API|오류|실패|ECONN|fetch failed`,
    'i'
  );
}


function loadAutoTradeState() {
  if (!fs.existsSync(AUTO_STATE_FILE)) {
    return {
      ok: false,
      source: AUTO_STATE_FILE,
      positions: [],
      orders: [],
      error: 'us-paper-auto-state.json 없음'
    };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(AUTO_STATE_FILE, 'utf8'));
    return {
      ok: true,
      source: AUTO_STATE_FILE,
      version: parsed.version,
      market: parsed.market,
      paperCapital: parsed.paperCapital,
      positions: Array.isArray(parsed.positions) ? parsed.positions : [],
      orders: Array.isArray(parsed.orders) ? parsed.orders : [],
      updatedAt: parsed.updatedAt || null
    };
  } catch (error) {
    return {
      ok: false,
      source: AUTO_STATE_FILE,
      positions: [],
      orders: [],
      error: error.message
    };
  }
}

function findFilledOrder(autoState, side, strategy, symbol, position = null) {
  const targetOrderNo = side === 'BUY'
    ? String(position?.buyOrderNo || '')
    : String(position?.sellOrderNo || '');

  const rows = (autoState?.orders || []).filter(row =>
    row &&
    String(row.side || '').toUpperCase() === side &&
    String(row.strategy || '').toUpperCase() === strategy &&
    String(row.symbol || '').toUpperCase() === symbol
  );

  if (targetOrderNo) {
    const exact = rows.find(row => String(row.orderNo || '') === targetOrderNo);
    if (exact) return exact;
  }

  return rows
    .filter(row => row.status === 'FILLED')
    .sort((a, b) =>
      new Date(b.filledAt || b.submittedAt || 0).getTime() -
      new Date(a.filledAt || a.submittedAt || 0).getTime()
    )[0] || null;
}

function summarizeAutoTradeState(autoState, strategy, date) {
  const id = normalizeStrategy(strategy) || String(strategy || '').toUpperCase();
  const rows = [];

  for (const position of autoState?.positions || []) {
    if (!position || String(position.strategy || '').toUpperCase() !== id) continue;

    const symbol = String(position.symbol || '').toUpperCase();
    const openedDate = dateKeyFromValue(position.openedAt, TZ);

    if (openedDate === date) {
      const order = findFilledOrder(autoState, 'BUY', id, symbol, position);
      rows.push({
        type: 'BUY', side: 'BUY', strategy: id,
        exchange: position.exchange || order?.exchange || '',
        symbol,
        name: position.name || order?.name || symbol,
        quantity: Number(position.quantity || order?.quantity || 0),
        price: Number(position.entryPrice || order?.limitPrice || 0),
        amount: Number(position.entryNotional || 0),
        filledAt: position.openedAt || order?.filledAt || null,
        orderNo: position.buyOrderNo || order?.orderNo || '',
        positionId: position.id || '',
        status: 'FILLED'
      });
    }

    const closedDate = dateKeyFromValue(position.closedAt, TZ);
    if (position.status === 'CLOSED' && closedDate === date) {
      const order = findFilledOrder(autoState, 'SELL', id, symbol, position);
      rows.push({
        type: 'SELL', side: 'SELL', strategy: id,
        exchange: position.exchange || order?.exchange || '',
        symbol,
        name: position.name || order?.name || symbol,
        quantity: Number(position.quantity || order?.quantity || 0),
        price: Number(position.exitPrice || order?.limitPrice || 0),
        filledAt: position.closedAt || order?.filledAt || null,
        orderNo: position.sellOrderNo || order?.orderNo || '',
        positionId: position.id || '',
        status: 'FILLED',
        exitReason: position.exitReason || order?.exitReason || '',
        realizedProfit: Number(position.realizedProfit || 0),
        realizedProfitRate: Number(position.realizedProfitRate || 0)
      });
    }
  }

  rows.sort((a, b) =>
    new Date(a.filledAt || 0).getTime() - new Date(b.filledAt || 0).getTime()
  );

  return {
    ok: autoState?.ok !== false,
    source: AUTO_STATE_FILE,
    sourceOfTruth: true,
    sourceType: 'us-paper-auto-state positions confirmed fills',
    strategy: id,
    date,
    count: rows.length,
    buyCount: rows.filter(row => row.side === 'BUY').length,
    sellCount: rows.filter(row => row.side === 'SELL').length,
    realizedProfit: rows
      .filter(row => row.side === 'SELL')
      .reduce((sum, row) => sum + Number(row.realizedProfit || 0), 0),
    rows,
    stateUpdatedAt: autoState?.updatedAt || null,
    error: autoState?.error || null
  };
}

function normalizeStrategy(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return STRATEGIES.some(s => s.id === normalized) ? normalized : '';
}

function extractArray(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  const candidates = [
    value.history,
    value.trades,
    value.items,
    value.rows,
    value.data,
    value.results,
    value.records
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function looksLikeBuy(row = {}) {
  const values = [
    row.type, row.action, row.side, row.event, row.tradeType,
    row.orderSide, row.reason, row.status
  ].map(v => String(v || '').toUpperCase());
  return values.some(v =>
    v === 'BUY' ||
    v.includes('BUY') ||
    v.includes('ENTRY') ||
    v.includes('매수')
  );
}

function looksLikeSell(row = {}) {
  const values = [
    row.type, row.action, row.side, row.event, row.tradeType,
    row.orderSide, row.reason, row.status
  ].map(v => String(v || '').toUpperCase());
  return values.some(v =>
    v === 'SELL' ||
    v.includes('SELL') ||
    v.includes('EXIT') ||
    v.includes('TAKE_PROFIT') ||
    v.includes('STOP_LOSS') ||
    v.includes('청산') ||
    v.includes('매도') ||
    v.includes('익절') ||
    v.includes('손절')
  );
}

function summarizeHistoryPayload(historyPayload, strategy, date) {
  const rows = extractArray(historyPayload);
  const buyRows = rows.filter(looksLikeBuy);
  const sellRows = rows.filter(looksLikeSell);

  return {
    ok: historyPayload?.ok !== false,
    source: `GET /api/us-${String(strategy || '').toLowerCase()}/history?date=${date}`,
    sourceOfTruth: false,
    sourceRole: 'candidate/signal history only',
    strategy: normalizeStrategy(strategy) || String(strategy || '').toUpperCase(),
    date,
    count: rows.length,
    buyCount: buyRows.length,
    sellCount: sellRows.length,
    rows,
    rawShape: Array.isArray(historyPayload)
      ? 'array'
      : Object.keys(historyPayload || {})
  };
}

async function getCurrentPortfolioSnapshot() {
  if (!portfolioManager || typeof portfolioManager.getPortfolioSummary !== 'function') {
    return {
      ok: false,
      error: 'portfolio-manager.getPortfolioSummary 사용 불가',
      holdings: []
    };
  }

  try {
    const summary = await portfolioManager.getPortfolioSummary();
    return {
      ...(summary || {}),
      ok: summary?.ok !== false,
      holdings: Array.isArray(summary?.holdings) ? summary.holdings : []
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message,
      holdings: []
    };
  }
}

function buildStrategyCoverageCheck(strategy, outLog, tradeSummary, portfolioSnapshot) {
  const id = normalizeStrategy(strategy) || String(strategy || '').toUpperCase();
  const confirmedRows = String(outLog?.text || '')
    .split(/\r?\n/)
    .filter(line => line && !line.startsWith('----- SOURCE:') && !line.startsWith('조회한 PM2'));

  const tradeLikeCount = confirmedRows.filter(line => {
    TRADE_LINE_RX.lastIndex = 0;
    return TRADE_LINE_RX.test(line);
  }).length;

  const historyCount = Number(tradeSummary?.count || 0);
  const buyCount = Number(tradeSummary?.buyCount || 0);
  const sellCount = Number(tradeSummary?.sellCount || 0);

  const rows = [];
  rows.push(`분석일: ${tradeSummary?.date || '-'}`);
  rows.push(`AUTO STATE ${id} 실제체결: ${historyCount}건 / BUY ${buyCount}건 / SELL ${sellCount}건`);
  rows.push(`PM2 거래일 확정 전략로그: ${Number(outLog?.confirmedCount || 0)}줄 / 거래관련 키워드 ${tradeLikeCount}줄`);

  if (tradeSummary?.ok === false) {
    rows.push('주의: AUTO STATE 실제체결 자료를 읽지 못했습니다.');
    rows.push('PM2 로그와 전략 HISTORY/VIRTUAL TRADES를 보조자료로만 사용하십시오.');
  } else if (historyCount > 0 && Number(outLog?.confirmedCount || 0) === 0) {
    rows.push(`주의: PM2 조건 로그는 0건이지만 AUTO STATE에는 ${id} 실제체결이 있습니다.`);
    rows.push(`[해당 거래일 관련 로그 없음]을 ${id} 미거래로 해석하면 안 됩니다.`);
    rows.push(`위 US-${id} CONFIRMED AUTO TRADE HISTORY를 거래 기준(source of truth)으로 사용하십시오.`);
  } else if (historyCount > 0 && tradeLikeCount === 0) {
    rows.push('주의: 전략 운영 로그는 있으나 매수/매도/체결 키워드가 잡히지 않았습니다.');
    rows.push('거래 유무는 AUTO STATE를 우선하고, 원인은 PM2 로그로 교차검증하십시오.');
  } else if (historyCount === 0) {
    rows.push(`AUTO STATE 기준 해당 거래일 ${id} 실제체결 없음.`);
    rows.push('단, VIRTUAL TRADES는 실계좌/페이퍼 체결기록과 별도이므로 따로 분석하십시오.');
  } else {
    rows.push('AUTO STATE 실제체결과 PM2 거래일 확정 로그가 모두 존재합니다.');
    rows.push('거래 유무/손익은 AUTO STATE를 우선하고, 진입/청산 이유는 PM2와 DAILY SUMMARY를 교차검증하십시오.');
  }

  if (portfolioSnapshot?.ok) {
    rows.push(`현재 계좌 보유종목: ${Number(portfolioSnapshot.holdingCount ?? portfolioSnapshot.holdings?.length ?? 0)}개`);
    rows.push('현재 보유현황은 과거 거래기록을 대체하지 않고, 현재 상태 교차검증용으로만 사용합니다.');
  } else {
    rows.push(`현재 보유현황 교차검증 실패: ${portfolioSnapshot?.error || '원인 미상'}`);
  }

  if (Number(outLog?.undatedCount || 0) > 0) {
    rows.push(`날짜 미확정 참고로그 ${outLog.undatedCount}줄 존재: 오늘 거래 증거로 사용하지 말 것.`);
  }

  return rows.join('\n') + '\n';
}

function buildTodayTradeSummary(date, strategyTradeSummaries = {}, portfolioSnapshot = null) {
  const strategies = {};
  let totalTrades = 0;
  let totalBuys = 0;
  let totalSells = 0;
  let realizedProfit = 0;

  for (const s of STRATEGIES) {
    const h = strategyTradeSummaries[s.id] || {};
    strategies[s.id] = {
      tradeCount: Number(h.count || 0),
      buyCount: Number(h.buyCount || 0),
      sellCount: Number(h.sellCount || 0),
      realizedProfit: Number(h.realizedProfit || 0),
      sourceOk: h.ok !== false
    };
    totalTrades += Number(h.count || 0);
    totalBuys += Number(h.buyCount || 0);
    totalSells += Number(h.sellCount || 0);
    realizedProfit += Number(h.realizedProfit || 0);
  }

  return {
    ok: true,
    date,
    tradeSource: 'us-paper-auto-state.json confirmed positions',
    strategies,
    total: {
      tradeCount: totalTrades,
      buyCount: totalBuys,
      sellCount: totalSells,
      realizedProfit
    },
    currentPortfolio: portfolioSnapshot?.ok ? {
      holdingCount: Number(portfolioSnapshot.holdingCount ?? portfolioSnapshot.holdings?.length ?? 0),
      totalExposure: portfolioSnapshot.totalExposure,
      totalAsset: portfolioSnapshot.totalAsset,
      totalProfitLoss: portfolioSnapshot.totalProfitLoss,
      realizedProfitLoss: portfolioSnapshot.realizedProfitLoss,
      unrealizedProfitLoss: portfolioSnapshot.unrealizedProfitLoss,
      availableCash: portfolioSnapshot.availableCash,
      holdings: portfolioSnapshot.holdings
    } : {
      ok: false,
      error: portfolioSnapshot?.error || '현재 포트폴리오 조회 실패'
    }
  };
}


function buildSignalPerformanceFromAutoState(strategy, date) {
  const id = normalizeStrategy(strategy) || String(strategy || '').toUpperCase();

  let state = null;
  try {
    state = fs.existsSync(AUTO_STATE_FILE)
      ? JSON.parse(fs.readFileSync(AUTO_STATE_FILE, 'utf8'))
      : {};
  } catch (error) {
    return { ok:false, strategy:id, date, source:AUTO_STATE_FILE, error:error.message, groups:{} };
  }

  const positions = Array.isArray(state?.positions) ? state.positions : [];
  const orders = Array.isArray(state?.orders) ? state.orders : [];

  function orderForPosition(side, position) {
    const orderNo = side === 'BUY'
      ? String(position?.buyOrderNo || '')
      : String(position?.sellOrderNo || '');

    if (orderNo) {
      const exact = orders.find(row =>
        row &&
        String(row.side || '').toUpperCase() === side &&
        String(row.orderNo || '') === orderNo
      );
      if (exact) return exact;
    }

    return orders
      .filter(row =>
        row &&
        String(row.side || '').toUpperCase() === side &&
        String(row.strategy || '').toUpperCase() === id &&
        String(row.symbol || '').toUpperCase() === String(position?.symbol || '').toUpperCase()
      )
      .sort((a,b) =>
        new Date(b.filledAt || b.submittedAt || 0).getTime() -
        new Date(a.filledAt || a.submittedAt || 0).getTime()
      )[0] || null;
  }

  const rows = [];

  for (const position of positions) {
    if (!position || String(position.strategy || '').toUpperCase() !== id) continue;

    const buyOrder = orderForPosition('BUY', position);
    const signalStatus = String(buyOrder?.signalStatus || 'READY').toUpperCase();
    const budgetScale = Number(buyOrder?.budgetScale ?? 1);
    const score = Number(buyOrder?.score || 0);
    const candidateReason = buyOrder?.candidateReason || '';

    if (dateKeyFromValue(position.openedAt, TZ) === date) {
      rows.push({
        side:'BUY', strategy:id,
        symbol:String(position.symbol || '').toUpperCase(),
        name:position.name || position.symbol || '',
        quantity:Number(position.quantity || 0),
        price:Number(position.entryPrice || buyOrder?.limitPrice || 0),
        filledAt:position.openedAt || buyOrder?.filledAt || null,
        signalStatus, budgetScale, score, candidateReason
      });
    }

    if (position.status === 'CLOSED' && dateKeyFromValue(position.closedAt, TZ) === date) {
      rows.push({
        side:'SELL', strategy:id,
        symbol:String(position.symbol || '').toUpperCase(),
        name:position.name || position.symbol || '',
        quantity:Number(position.quantity || 0),
        price:Number(position.exitPrice || 0),
        filledAt:position.closedAt || null,
        signalStatus, budgetScale, score, candidateReason,
        exitReason:position.exitReason || '',
        realizedProfit:Number(position.realizedProfit || 0),
        realizedProfitRate:Number(position.realizedProfitRate || 0)
      });
    }
  }

  const groups = {};
  for (const signalStatus of ['READY','STRONG_READY']) {
    const signalRows = rows.filter(row => row.signalStatus === signalStatus);
    const buys = signalRows.filter(row => row.side === 'BUY');
    const sells = signalRows.filter(row => row.side === 'SELL');
    const wins = sells.filter(row => Number(row.realizedProfit || 0) > 0).length;
    const losses = sells.filter(row => Number(row.realizedProfit || 0) < 0).length;
    const flats = sells.length - wins - losses;
    const realizedProfit = sells.reduce((sum,row) => sum + Number(row.realizedProfit || 0), 0);
    const avgRealizedProfitRate = sells.length
      ? sells.reduce((sum,row) => sum + Number(row.realizedProfitRate || 0), 0) / sells.length
      : 0;

    groups[signalStatus] = {
      buyCount:buys.length,
      sellCount:sells.length,
      openCount:Math.max(0, buys.length - sells.length),
      wins, losses, flats,
      winRate:sells.length ? Math.round((wins / sells.length) * 10000) / 100 : null,
      realizedProfit:Math.round(realizedProfit * 100) / 100,
      avgRealizedProfitRate:Math.round(avgRealizedProfitRate * 100) / 100,
      rows:signalRows
    };
  }

  return {
    ok:true,
    strategy:id,
    date,
    source:'us-paper-auto-state.json',
    note:'AUTO v1.6 실제 BUY 주문의 signalStatus/budgetScale/score/candidateReason 기준 READY/STRONG_READY 성과 분리',
    groups
  };
}

async function buildStrategyAnalysis(strategy, date, portfolioSnapshot = null) {
  const { id, slug } = strategy;

  const [outLog, errLog, status, buyCheck, virtualTrades, history, historyStatus, summaryStatus] = await Promise.all([
    filterPm2Logs('out', date, strategyLogRegex(id)),
    filterPm2Logs('error', date, strategyErrorRegex(id)),
    getJson(PORT, `/api/us-${slug}/status`),
    getJson(PORT, `/api/strategy-buy-check/${id}`),
    getJson(PORT, `/api/us-${slug}/virtual-trades`),
    getJson(PORT, `/api/us-${slug}/history?date=${encodeURIComponent(date)}`),
    getJson(PORT, `/api/us-${slug}/history-status`),
    getJson(PORT, `/api/us-${slug}/daily-summary-status`)
  ]);

  const historySummary = summarizeHistoryPayload(history, id, date);
  const autoTradeSummary = summarizeAutoTradeState(loadAutoTradeState(), id, date);

  const rows = [
    section(`US-${id} CONFIRMED AUTO TRADE HISTORY`, safeJson(autoTradeSummary)),
    section(`US-${id} READY vs STRONG_READY PERFORMANCE`, safeJson(buildSignalPerformanceFromAutoState(id, date))),
    section(`US-${id} SIGNAL/HISTORY API (NOT SOURCE OF TRUTH)`, safeJson(historySummary)),
    section(`US-${id} : LOG COVERAGE CHECK`, buildStrategyCoverageCheck(id, outLog, autoTradeSummary, portfolioSnapshot)),
    section(`US-${id} : CONFIRMED TRADING-DAY SERVER OUT`, outLog.text),
    section(`US-${id} : UNDATED REFERENCE SERVER OUT`, outLog.undatedText),
    section(`US-${id} : CONFIRMED TRADING-DAY SERVER ERROR`, errLog.text),
    section(`US-${id} STATUS`, safeJson(status)),
    section(`US-${id} BUY CHECK`, safeJson(buyCheck)),
    section(`US-${id} VIRTUAL TRADES`, safeJson(virtualTrades)),
    section(`US-${id} HISTORY RAW`, safeJson(history)),
    section(`US-${id} HISTORY RECORDER STATUS`, safeJson(historyStatus)),
    section(`US-${id} DAILY SUMMARY STATUS`, safeJson(summaryStatus)),
    section('CURRENT US PORTFOLIO CROSS-CHECK', safeJson(portfolioSnapshot))
  ];

  if (id === 'CORE') {
    const diagnostics = await runNodeScript(path.join(ROOT, 'us-core-diagnostics.js'), [], {
      cwd: ROOT,
      timeoutMs: 45000,
      nodeArgs: ['-r', path.join(ROOT, 'us-core-data-safety-patch.js')]
    });
    rows.push(section('US-CORE DIAGNOSTICS', diagnostics));
  }

  return { text: rows.join(''), historySummary, autoTradeSummary };
}

async function buildStrategyResultAnalysis(strategy, date) {
  const { id, slug } = strategy;
  const day = date.replace(/-/g, '');
  const summary = await getJson(PORT, `/api/us-${slug}/daily-summary?date=${encodeURIComponent(date)}`);
  const finalTxtPath = path.join(ROOT, `us-${slug}-reports`, `us-${slug}-summary-${day}.txt`);
  const finalTxt = readTextIfExists(
    finalTxtPath,
    `장마감 FINAL TXT 아직 없음: ${finalTxtPath}\n`
  );

  const simulatorPath = path.join(ROOT, `us-${slug}-exit-simulator.js`);
  const simulator = fs.existsSync(simulatorPath)
    ? await runNodeScript(simulatorPath, [date], { cwd: ROOT, timeoutMs: 45000 })
    : '[해당 전략 exit simulator 없음]\n';

  return [
    section(`US-${id} DAILY SUMMARY`, safeJson(summary)),
    section(`US-${id} DAILY SUMMARY TXT`, finalTxt),
    section(`US-${id} EXIT SIMULATION`, simulator)
  ].join('');
}

async function buildMasterAnalysis(date, portfolioSnapshot = null, strategyHistorySummaries = {}, strategyTradeSummaries = {}) {
  const strategyStatuses = {};
  const historyStatuses = {};
  const summaryStatuses = {};
  const buyChecks = {};

  for (const s of STRATEGIES) {
    strategyStatuses[s.id] = await getJson(PORT, `/api/us-${s.slug}/status`);
    historyStatuses[s.id] = await getJson(PORT, `/api/us-${s.slug}/history-status`);
    summaryStatuses[s.id] = await getJson(PORT, `/api/us-${s.slug}/daily-summary-status`);
    buyChecks[s.id] = await getJson(PORT, `/api/strategy-buy-check/${s.id}`);
  }

  const tradeSummary = buildTodayTradeSummary(date, strategyTradeSummaries, portfolioSnapshot);
  const signalPerformance = Object.fromEntries(
    STRATEGIES.map(s => [s.id, buildSignalPerformanceFromAutoState(s.id, date)])
  );

  const [server, portfolioApi, settings, dashboard, confirmedAllOut, importantOut, allErr, recentErrors] = await Promise.all([
    getJson(PORT, '/api/status'),
    getJson(PORT, '/api/portfolio-summary'),
    getJson(PORT, '/api/strategy-settings'),
    getJson(PORT, '/api/strategy-dashboard-summary'),
    filterPm2Logs('out', date, null),
    filterPm2Logs('out', date, IMPORTANT_MASTER_RX),
    filterPm2Logs('error', date, null),
    tailPm2Errors(150)
  ]);

  return [
    section('TODAY US TRADE SUMMARY', safeJson(tradeSummary)),
    section('READY vs STRONG_READY PERFORMANCE', safeJson(signalPerformance)),
    section('ALL STRATEGY CONFIRMED AUTO TRADE HISTORY', safeJson(strategyTradeSummaries)),
    section('ALL STRATEGY SIGNAL/HISTORY API (NOT SOURCE OF TRUTH)', safeJson(strategyHistorySummaries)),
    section('CURRENT PORTFOLIO FROM portfolio-manager', safeJson(portfolioSnapshot)),
    section('US SERVER STATUS', safeJson(server)),
    section('US PORTFOLIO API', safeJson(portfolioApi)),
    section('US STRATEGY SETTINGS', safeJson(settings)),
    section('US STRATEGY DASHBOARD SUMMARY', safeJson(dashboard)),
    section('ALL STRATEGY STATUS', safeJson(strategyStatuses)),
    section('ALL STRATEGY BUY CHECK', safeJson(buyChecks)),
    section('ALL HISTORY RECORDER STATUS', safeJson(historyStatuses)),
    section('ALL DAILY SUMMARY STATUS', safeJson(summaryStatuses)),
    section('MASTER : CONFIRMED TRADING-DAY US SERVER OUT (FULL)', confirmedAllOut.text),
    section('MASTER : IMPORTANT BUY/SELL/STRATEGY LOG', importantOut.text),
    section('MASTER : UNDATED REFERENCE SERVER OUT', importantOut.undatedText),
    section('ALL STRATEGIES : CONFIRMED TRADING-DAY US SERVER ERROR', allErr.text),
    section('RECENT US ERRORS (TAIL / 날짜 미확정 참고)', recentErrors)
  ].join('');
}

function sourceFiles() {
  const common = [
    'server.js',
    'analysis-download.js',
    'kiwoom-us-client.js',
    'portfolio-manager.js',
    'strategy-settings-store.js',
    'market-calendar.js',
    'us-core-market-client.js',
    'us-dashboard-activity-store.js',
    'us-paper-auto-trader.js',
    'us-core-data-safety-patch.js',
    'us-core-diagnostics.js'
  ];

  const strategyFiles = STRATEGIES.flatMap(s => [
    `us-${s.slug}-strategy.js`,
    `us-${s.slug}-virtual-tracker.js`,
    `us-${s.slug}-history-store.js`,
    `us-${s.slug}-daily-summary.js`,
    `us-${s.slug}-exit-simulator.js`
  ]);

  return [...common, ...strategyFiles];
}

function addRawFiles(entries, date) {
  const day = date.replace(/-/g, '');

  if (fs.existsSync(AUTO_STATE_FILE) && fs.statSync(AUTO_STATE_FILE).isFile()) {
    entries.push({
      name: 'raw/us-paper-auto-state.json',
      data: fs.readFileSync(AUTO_STATE_FILE),
      mtime: fs.statSync(AUTO_STATE_FILE).mtime
    });
  }

  for (const s of STRATEGIES) {
    const slug = s.slug;
    const items = [
      [path.join(ROOT, `us-${slug}-virtual-trades.json`), `raw/us-${slug}-virtual-trades.json`],
      [path.join(ROOT, `us-${slug}-history`, `us-${slug}-history-${day}.json`), `raw/us-${slug}-history-${day}.json`],
      [path.join(ROOT, `us-${slug}-reports`, `us-${slug}-summary-${day}.json`), `raw/us-${slug}-summary-${day}.json`],
      [path.join(ROOT, `us-${slug}-reports`, `us-${slug}-summary-${day}.txt`), `raw/us-${slug}-summary-${day}.txt`]
    ];

    for (const [source, target] of items) {
      if (!fs.existsSync(source) || !fs.statSync(source).isFile()) continue;
      entries.push({
        name: target,
        data: fs.readFileSync(source),
        mtime: fs.statSync(source).mtime
      });
    }
  }
}

async function createPackage(date) {
  const day = date.replace(/-/g, '');
  const entries = [];
  const portfolioSnapshot = await getCurrentPortfolioSnapshot();
  const strategyHistorySummaries = {};
  const strategyTradeSummaries = {};

  // API/진단 부하가 한꺼번에 겹치지 않도록 전략별로 순차 수집.
  for (const strategy of STRATEGIES) {
    const built = await buildStrategyAnalysis(strategy, date, portfolioSnapshot);
    strategyHistorySummaries[strategy.id] = built.historySummary;
    strategyTradeSummaries[strategy.id] = built.autoTradeSummary;

    entries.push({
      name: `analysis/syquant-us-${strategy.slug}-${day}-analysis.txt`,
      data: built.text
    });

    entries.push({
      name: `analysis/syquant-us-${strategy.slug}-result-${day}-analysis.txt`,
      data: await buildStrategyResultAnalysis(strategy, date)
    });
  }

  entries.push({
    name: `analysis/syquant-us-master-${day}-analysis.txt`,
    data: await buildMasterAnalysis(date, portfolioSnapshot, strategyHistorySummaries, strategyTradeSummaries)
  });

  addSourceFiles(entries, ROOT, sourceFiles());
  addRawFiles(entries, date);

  const manifest = {
    ok: true,
    market: 'US',
    type: 'ALL_STRATEGIES',
    strategies: STRATEGIES.map(s => s.id),
    date,
    generatedAt: new Date().toISOString(),
    tradingTimeZone: TZ,
    sourceRoot: ROOT,
    mode: 'PAPER expected',
    safety: {
      secretsIncluded: false,
      envIncluded: false,
      tokenIncluded: false
    },
    tradeSourceOfTruth: 'us-paper-auto-state.json confirmed positions',
    currentPortfolioCrossCheck: portfolioSnapshot?.ok
      ? 'portfolio-manager.getPortfolioSummary'
      : `unavailable: ${portfolioSnapshot?.error || 'unknown'}`,
    notes: [
      'CORE/FAST/VOLUME/WAVE를 전략별로 분리 수집.',
      '실제 체결 source of truth는 us-paper-auto-state.json의 position OPEN/CLOSED 체결상태를 사용.',
      '전략별 history API는 후보/READY/가상신호 분석용이며 실제 체결 source of truth가 아님.',
      'portfolio-manager.getPortfolioSummary는 현재 보유현황 및 자산/손익 교차검증용으로 사용.',
      '각 전략 분석파일에 CONFIRMED AUTO TRADE HISTORY와 LOG COVERAGE CHECK 추가.',
      'PM2 로그는 고정 1개 경로가 아니라 US 관련 out/error 로그파일을 자동 탐색.',
      'timezone/offset가 있는 ISO 로그는 America/New_York 거래일로 환산하여 UTC 자정 경계 누락 방지.',
      '날짜 없는 PM2 로그는 오늘 거래 증거로 사용하지 않고 UNDATED REFERENCE로 별도 분리.',
      'MASTER 분석파일에는 요청 거래일의 날짜확정 OUT 전체를 전략 키워드 필터 없이 보존.',
      'MASTER 첫부분에 TODAY US TRADE SUMMARY와 4전략 CONFIRMED AUTO TRADE HISTORY를 포함.',
      'history raw/virtual trades/daily summary/exit simulator 기존 분석자료는 그대로 유지.',
      '.env/token/인증정보는 포함하지 않음.'
    ],
    analysisFiles: entries
      .filter(x => x.name.startsWith('analysis/'))
      .map(x => x.name),
    rawFiles: entries
      .filter(x => x.name.startsWith('raw/'))
      .map(x => x.name),
    sourceFiles: entries
      .filter(x => x.name.startsWith('source/'))
      .map(x => x.name)
  };

  entries.unshift({
    name: 'manifest.json',
    data: safeJson(manifest) + '\n'
  });

  return {
    fileName: `syquant-US-ALL-${day}.zip`,
    buffer: buildZip(entries)
  };
}

module.exports = function installUsAnalysisRoutes(app) {
  if (!app || typeof app.get !== 'function') {
    throw new Error('Express app이 필요합니다.');
  }

  app.get('/api/analysis/status', async (req, res) => {
    try {
      const strategies = {};
      for (const s of STRATEGIES) {
        strategies[s.id] = await getJson(PORT, `/api/us-${s.slug}/status`);
      }

      const portfolio = await getCurrentPortfolioSnapshot();

      res.json({
        ok: true,
        market: 'US',
        date: dateKey(TZ),
        time: timeHHMM(TZ),
        server: await getJson(PORT, '/api/status'),
        tradeSourceOfTruth: 'us-paper-auto-state.json confirmed positions',
        signalPerformanceTracking: 'READY vs STRONG_READY',
        portfolioCrossCheckAvailable: portfolio.ok,
        portfolioCrossCheckError: portfolio.error || null,
        strategies
      });
    } catch (error) {
      res.status(500).json({ ok: false, message: error.message });
    }
  });

  app.get('/api/analysis/download', async (req, res) => {
    try {
      const date = validateDate(req.query.date, dateKey(TZ));
      const result = await createPackage(date);
      sendZip(res, result.fileName, result.buffer);
    } catch (error) {
      console.error('[US 분석 ZIP 생성 오류]', error);
      if (!res.headersSent) {
        res.status(500).json({ ok: false, message: error.message });
      } else {
        res.end();
      }
    }
  });

  console.log(
    '[분석자료] US 4전략 ZIP 다운로드 API 활성화 / AUTO STATE source-of-truth + READY/STRONG_READY 성과분리 + portfolio 손익교정 + PM2 다중로그 + NY 거래일 확정 v5c'
  );
};

module.exports.__test = {
  dateKeyFromValue,
  explicitDateFromLogLine,
  lineBelongsToTradingDate,
  discoverPm2LogFiles,
  extractArray,
  summarizeHistoryPayload,
  loadAutoTradeState,
  summarizeAutoTradeState,
  getCurrentPortfolioSnapshot,
  buildStrategyCoverageCheck,
  buildTodayTradeSummary,
  filterPm2Logs,
  createPackage
};
