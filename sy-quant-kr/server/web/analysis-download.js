'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const zlib = require('zlib');
const { spawn } = require('child_process');
const portfolioManager = require('./portfolio-manager');

const ROOT = __dirname;
const TZ = 'Asia/Seoul';
const PM2_LOG_DIR = '/home/ubuntu/.pm2/logs';
const ANALYSIS_RUNTIME_LOG_DIR = path.join(ROOT, 'analysis-runtime-logs');
const ANALYSIS_RUNTIME_LOG_PREFIX = 'syquant-runtime';

const PM2_KNOWN_OUT = [
  path.join(PM2_LOG_DIR, 'sy-quant-kr-server-out.log'),
  path.join(PM2_LOG_DIR, 'sy-quant-core-out.log'),
  path.join(PM2_LOG_DIR, 'kiwwm-server-out.log'),
  path.join(PM2_LOG_DIR, 'kiwoom-server-out.log')
];

const PM2_KNOWN_ERR = [
  path.join(PM2_LOG_DIR, 'sy-quant-kr-server-error.log'),
  path.join(PM2_LOG_DIR, 'sy-quant-core-error.log'),
  path.join(PM2_LOG_DIR, 'kiwwm-server-error.log'),
  path.join(PM2_LOG_DIR, 'kiwoom-server-error.log')
];

const LOG_RX = {
  CORE_VOLUME: /CORE|VOLUME|MASTER|PORTFOLIO|CORE_BUY|CORE_|VOLUME_BUY|VOLUME_|매수|매도|보유|차단|후보|재평가|점수|스위칭|익절|손절|트레일링/i,
  CORE_VOLUME_ERR: /CORE|VOLUME|MASTER|PORTFOLIO|error|fail|timeout|시간초과|오류|실패|ECONN|fetch failed/i,
  OPEN: /OPEN|HOT|MASTER|PORTFOLIO|매수|매도|차단|후보|지속|관찰|시장/i,
  OPEN_ERR: /OPEN|HOT|MASTER|PORTFOLIO|error|fail|timeout|시간초과|API|오류|실패/i,
  WAVE: /WAVE|READY|TRIGGER|HOLD|PROTECT|REBOUND|COOLDOWN|전일급등|MASTER|PORTFOLIO|매수|매도/i,
  WAVE_ERR: /WAVE|wave-strategy|MASTER|PORTFOLIO|error|fail|timeout|시간초과|오류|실패/i,
  FAST: /FAST|MASTER|PORTFOLIO|매수|매도|후보|점수|트리거|관찰|진입|청산|손절|익절|보유/i,
  FAST_ERR: /FAST|MASTER|PORTFOLIO|error|fail|timeout|시간초과|API|오류|실패/i
};

/* ---------------- ZIP ---------------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  return { dosDate, dosTime };
}

function normalizeEntry(entry) {
  if (!entry || !entry.name) throw new Error('ZIP entry name is required');
  const name = String(entry.name).replace(/\\/g, '/').replace(/^\/+/, '');
  if (!name || name.includes('../')) throw new Error(`Unsafe ZIP entry path: ${name}`);
  const data = Buffer.isBuffer(entry.data)
    ? entry.data
    : Buffer.from(String(entry.data ?? ''), 'utf8');
  const mtime = entry.mtime instanceof Date ? entry.mtime : new Date();
  return { name, data, mtime };
}

function buildZip(entries = []) {
  const files = entries.map(normalizeEntry);
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;

  for (const file of files) {
    const nameBuffer = Buffer.from(file.name, 'utf8');
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

function sendZip(res, fileName, buffer) {
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Length', String(buffer.length));
  res.setHeader('Content-Disposition', `attachment; filename="${fileName.replace(/[^A-Za-z0-9._-]/g, '_')}"`);
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.end(buffer);
}

/* ---------------- date / json ---------------- */

function dateKey(timeZone = TZ) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const get = type => parts.find(p => p.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function dateKeyFromValue(value, timeZone = TZ) {
  if (value === null || value === undefined || value === '') return '';

  const direct = String(value).trim();

  let m = direct.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];

  m = direct.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\./);
  if (m) {
    return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  }

  let date;
  if (typeof value === 'number' || /^\d{10,13}$/.test(direct)) {
    let ms = Number(value);
    if (String(Math.trunc(ms)).length <= 10) ms *= 1000;
    date = new Date(ms);
  } else {
    date = new Date(value);
  }

  if (!date || Number.isNaN(date.getTime())) return '';

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const get = type => parts.find(p => p.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function timeHHMM(timeZone = TZ) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date());
  const get = type => parts.find(p => p.type === type)?.value || '00';
  return `${get('hour')}:${get('minute')}`;
}

function validateDate(value, fallback) {
  const date = String(value || fallback || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('date는 YYYY-MM-DD 형식이어야 합니다.');
  }
  return date;
}

function safeJson(value) {
  return JSON.stringify(value, null, 2);
}

function readJsonFile(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const text = fs.readFileSync(filePath, 'utf8');
    return text.trim() ? JSON.parse(text) : fallback;
  } catch (_) {
    return fallback;
  }
}

function readTextIfExists(filePath, missingMessage = null, maxBytes = 8 * 1024 * 1024) {
  if (!fs.existsSync(filePath)) return missingMessage ?? `[파일 없음] ${filePath}\n`;

  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return missingMessage ?? `[파일 아님] ${filePath}\n`;

    if (stat.size <= maxBytes) {
      return fs.readFileSync(filePath, 'utf8');
    }

    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(maxBytes);

    try {
      fs.readSync(fd, buffer, 0, maxBytes, Math.max(0, stat.size - maxBytes));
    } finally {
      fs.closeSync(fd);
    }

    let text = buffer.toString('utf8');
    const firstNewline = text.indexOf('\n');
    if (firstNewline >= 0) text = text.slice(firstNewline + 1);

    return `[파일이 커서 최근 ${(maxBytes / 1024 / 1024).toFixed(0)}MB만 포함 / 전체 ${stat.size.toLocaleString()} bytes]\n${text}`;
  } catch (error) {
    return `[파일 읽기 실패] ${filePath} / ${error.message}\n`;
  }
}

function section(title, body = '') {
  return `===== ${title} =====\n${String(body || '').trimEnd()}\n\n`;
}


/* ---------------- dated runtime log capture ---------------- */

/*
 * PM2 출력 줄에 날짜가 없으면 사후에 어느 거래일인지 확정할 수 없다.
 * 따라서 이 분석 모듈이 로드된 뒤부터 전략 관련 console 로그를 KST 날짜/시간과 함께
 * 날짜별 분석 전용 파일에 동시에 기록한다.
 *
 * 같은 Node 프로세스에서 실행되는 OPEN/HOT/CORE/VOLUME/WAVE/FAST에 공통 적용된다.
 * 기존 PM2 출력은 그대로 유지하며, 과거의 무날짜 PM2 로그를 오늘 것으로 추정하지 않는다.
 */
let runtimeLogCaptureInstalled = false;
let runtimeLogWriteFailed = false;
let runtimeLogStreamDate = '';
let runtimeLogStream = null;
const runtimeLogOriginalConsole = {};

const RUNTIME_CAPTURE_RX = /OPEN|HOT|CORE|VOLUME|WAVE|FAST|MASTER|PORTFOLIO|READY|TRIGGER|HOLD|PROTECT|REBOUND|COOLDOWN|DISCOVER|시장온도|매수|매도|보유|차단|후보|재평가|점수|관찰|진입|청산|익절|손절|트레일링|스위칭|API|오류|실패|timeout|시간초과/i;

function kstIsoTimestamp(value = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(value);
    const get = type => parts.find(p => p.type === type)?.value || '00';
    return get('year') + '-' + get('month') + '-' + get('day') + 'T' + get('hour') + ':' + get('minute') + ':' + get('second') + '+09:00';
  } catch (_) {
    return new Date(value).toISOString();
  }
}

function runtimeLogPathForDate(date) {
  return path.join(
    ANALYSIS_RUNTIME_LOG_DIR,
    ANALYSIS_RUNTIME_LOG_PREFIX + '-' + String(date || dateKey(TZ)) + '.log'
  );
}

function stringifyConsoleArg(value) {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.stack || value.message || String(value);
  try {
    const json = JSON.stringify(value);
    if (json !== undefined) return json;
  } catch (_) {}
  return String(value);
}

function getRuntimeLogStream(date) {
  if (runtimeLogStream && runtimeLogStreamDate === date) return runtimeLogStream;

  try {
    if (runtimeLogStream) runtimeLogStream.end();
  } catch (_) {}

  fs.mkdirSync(ANALYSIS_RUNTIME_LOG_DIR, { recursive: true });
  runtimeLogStreamDate = date;
  runtimeLogStream = fs.createWriteStream(runtimeLogPathForDate(date), {
    flags: 'a',
    encoding: 'utf8'
  });
  runtimeLogStream.on('error', error => {
    runtimeLogWriteFailed = true;
    try {
      const original = runtimeLogOriginalConsole.error || console.error;
      original.call(console, '[분석자료 날짜로그 기록 실패]', error.message);
    } catch (_) {}
  });
  return runtimeLogStream;
}

function appendRuntimeAnalysisLog(level, args) {
  if (runtimeLogWriteFailed) return;

  try {
    const body = Array.from(args || []).map(stringifyConsoleArg).join(' ');
    RUNTIME_CAPTURE_RX.lastIndex = 0;
    if (!RUNTIME_CAPTURE_RX.test(body)) return;

    const now = new Date();
    const date = dateKeyFromValue(now.getTime(), TZ) || dateKey(TZ);
    const stamp = kstIsoTimestamp(now);
    getRuntimeLogStream(date).write(
      stamp + ' [' + String(level || 'LOG').toUpperCase() + '] ' + body + '\\n'
    );
  } catch (error) {
    runtimeLogWriteFailed = true;
  }
}

function installRuntimeLogCapture() {
  if (runtimeLogCaptureInstalled) return;
  runtimeLogCaptureInstalled = true;

  for (const level of ['log', 'info', 'warn', 'error']) {
    const original = console[level];
    if (typeof original !== 'function') continue;
    runtimeLogOriginalConsole[level] = original;

    console[level] = function patchedConsoleMethod(...args) {
      try { appendRuntimeAnalysisLog(level, args); } catch (_) {}
      return original.apply(console, args);
    };
  }

  appendRuntimeAnalysisLog('INFO', [
    '[분석자료 날짜로그] 전 전략 공통 캡처 활성화',
    ANALYSIS_RUNTIME_LOG_DIR
  ]);
}

async function collectRuntimeAnalysisLog(date, keywordRegex, maxRows = 12000) {
  const filePath = runtimeLogPathForDate(date);
  if (!fs.existsSync(filePath)) {
    return {
      filePath,
      rows: [],
      count: 0,
      exists: false,
      text: '[분석 전용 날짜확정 런타임 로그 없음]\\n'
    };
  }

  try {
    const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    const rows = [];

    for await (const line of rl) {
      if (!lineMatchesAnalysisDate(line, date)) continue;
      if (keywordRegex) {
        keywordRegex.lastIndex = 0;
        if (!keywordRegex.test(line)) continue;
      }
      if (rows.length < maxRows) rows.push(line);
    }

    return {
      filePath,
      rows,
      count: rows.length,
      exists: true,
      text: rows.length
        ? '----- SOURCE: ' + filePath + ' -----\\n' + rows.join('\\n') + '\\n'
        : '[해당 분석일 전략 관련 날짜확정 런타임 로그 없음]\\n'
    };
  } catch (error) {
    return {
      filePath,
      rows: [],
      count: 0,
      exists: true,
      error: error.message,
      text: '[분석 전용 날짜확정 런타임 로그 읽기 실패] ' + error.message + '\\n'
    };
  }
}

function mergeConfirmedLogText(runtimeResult, pm2Result) {
  const parts = [];

  if (runtimeResult?.count > 0) parts.push(runtimeResult.text.trimEnd());
  if (pm2Result?.explicitCount > 0) parts.push(pm2Result.explicitText.trimEnd());

  return parts.length
    ? parts.join('\\n') + '\\n'
    : '[해당 분석일로 날짜가 확정된 전략 로그 없음]\\n';
}

/* ---------------- MASTER source of truth ---------------- */

function loadMasterSnapshot() {
  try {
    const state = portfolioManager.loadMasterState();
    const summary = typeof portfolioManager.getPortfolioSummary === 'function'
      ? portfolioManager.getPortfolioSummary(state)
      : {
          accountName: 'SY Quant KR MASTER',
          initialCapital: Number(state?.initialCapital || 0),
          totalCash: Number(state?.totalCash || 0),
          holdingCount: Array.isArray(state?.holdings) ? state.holdings.length : 0
        };

    return {
      ok: true,
      state,
      portfolio: {
        ok: true,
        ...summary
      }
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message,
      state: { holdings: [], tradeLogs: [] },
      portfolio: { ok: false, error: error.message }
    };
  }
}

function tradeLogDateKey(log = {}) {
  const explicit = String(log.date || log.tradeDate || '').trim();
  const direct = explicit.match(/(\d{4}-\d{2}-\d{2})/);
  if (direct) return direct[1];

  const values = [
    log.timestampMs,
    log.timestamp,
    log.time,
    log.createdAt,
    log.updatedAt,
    log.buyAtMs,
    log.buyAt,
    log.buyTimeMs,
    log.buyTime,
    log.sellAtMs,
    log.sellAt,
    log.sellTime
  ];

  for (const value of values) {
    const key = dateKeyFromValue(value, TZ);
    if (key) return key;
  }

  return '';
}

function isBuyTrade(log = {}) {
  const type = String(log.type || '').toUpperCase();
  return type === 'BUY' || type.endsWith('_BUY') || type.includes('_BUY_');
}

function isSellTrade(log = {}) {
  const type = String(log.type || '').toUpperCase();
  return type === 'SELL' ||
    type.endsWith('_SELL') ||
    type.includes('_SELL_') ||
    type.includes('STOP_LOSS') ||
    type.includes('TAKE_PROFIT') ||
    type.includes('TRAILING_STOP') ||
    type.includes('PROTECT_SELL') ||
    type.includes('END_SELL') ||
    type.includes('TIME_SELL');
}

function getStrategy(log = {}) {
  const direct = String(
    log.strategyGroup ||
    log.strategy ||
    log.ownerStrategy ||
    ''
  ).trim().toUpperCase();

  if (direct) return direct;

  const type = String(log.type || '').trim().toUpperCase();
  for (const strategy of ['OPEN', 'CORE', 'VOLUME', 'WAVE', 'FAST']) {
    if (type === strategy || type.startsWith(`${strategy}_`)) return strategy;
  }

  return 'UNKNOWN';
}

function getMasterStrategyTrades(strategy, date) {
  try {
    const snapshot = loadMasterSnapshot();
    const state = snapshot.state || {};
    const target = String(strategy || '').trim().toUpperCase();

    const allLogs = Array.isArray(state.tradeLogs) ? state.tradeLogs : [];
    const rows = allLogs.filter(log =>
      getStrategy(log) === target &&
      tradeLogDateKey(log) === date
    );

    const buys = rows.filter(isBuyTrade);
    const sells = rows.filter(isSellTrade);
    const uniqueBuyPositionCount = new Set(
      buys.map(x => x.positionId || `${x.code}|${x.timestampMs || x.time || ''}`)
    ).size;

    return {
      ok: true,
      strategy: target,
      date,
      count: rows.length,
      buyCount: buys.length,
      uniqueBuyPositionCount,
      sellCount: sells.length,
      realizedProfit: sells.reduce((sum, x) => sum + Number(x.profit || 0), 0),
      tradeLogs: rows
    };
  } catch (error) {
    return {
      ok: false,
      strategy: String(strategy || '').toUpperCase(),
      date,
      count: 0,
      buyCount: 0,
      uniqueBuyPositionCount: 0,
      sellCount: 0,
      realizedProfit: 0,
      tradeLogs: [],
      error: error.message
    };
  }
}

function strategySummary(portfolio, ids) {
  const strategies = portfolio?.strategies || {};
  const out = {};
  for (const id of ids) out[id] = strategies[id] || {};
  return safeJson(out);
}

/* ---------------- PM2 log isolation ---------------- */

/*
 * 핵심:
 * 날짜가 없는 PM2 로그는 어느 거래일의 로그인지 사후에 확정할 수 없다.
 * 기존 방식처럼 "파일 mtime이 오늘"이라는 이유만으로 전부 오늘 로그에 넣으면
 * 전일 FAST 매수/매도가 오늘 분석에 섞인다.
 *
 * 따라서:
 * - explicit-dated rows: 당일 확정 로그
 * - undated rows: 별도 참고자료 (절대 당일 거래 source of truth로 사용하지 않음)
 */
function hasExplicitDateMarker(line) {
  const text = String(line || '');
  return /\b\d{4}-\d{2}-\d{2}(?:T|\s)/.test(text) ||
    /\b\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\./.test(text);
}

function lineMatchesAnalysisDate(line, date) {
  const text = String(line || '');

  if (text.includes(`${date}T`) || text.includes(`${date} `) || text.startsWith(date)) {
    return true;
  }

  const [y, m, d] = date.split('-').map(Number);
  if (text.includes(`${y}. ${m}. ${d}.`)) return true;

  const stamps =
    text.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g) || [];

  for (const stamp of stamps) {
    const parsed = new Date(stamp);
    if (!Number.isNaN(parsed.getTime()) &&
        dateKeyFromValue(parsed.getTime(), TZ) === date) {
      return true;
    }
  }

  return false;
}

function discoverPm2LogFiles(kind = 'out') {
  const suffix = kind === 'error' ? '-error.log' : '-out.log';
  const known = kind === 'error' ? PM2_KNOWN_ERR : PM2_KNOWN_OUT;
  let discovered = [];

  try {
    discovered = fs.readdirSync(PM2_LOG_DIR)
      .filter(name => name.endsWith(suffix))
      .filter(name => /^(?:sy-quant-kr|sy-quant-core|kiwwm-server|kiwoom-server)/i.test(name))
      .map(name => path.join(PM2_LOG_DIR, name));
  } catch (_) {}

  return [...new Set([...known, ...discovered])]
    .filter(filePath => fs.existsSync(filePath));
}

async function scanLogFile(filePath, date, keywordRegex, maxExplicit = 6000, maxUndated = 500) {
  if (!fs.existsSync(filePath)) {
    return {
      filePath,
      explicitRows: [],
      undatedRows: [],
      exists: false,
      error: null
    };
  }

  return await new Promise(resolve => {
    const explicitRows = [];
    const undatedQueue = [];
    let stderr = '';
    let settled = false;

    const grep = spawn(
      'grep',
      ['-aEi', '--', keywordRegex ? keywordRegex.source : '.*', filePath],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, LC_ALL: 'C' }
      }
    );

    const rl = readline.createInterface({
      input: grep.stdout,
      crlfDelay: Infinity
    });

    const timer = setTimeout(() => {
      try { grep.kill('SIGKILL'); } catch (_) {}
    }, 8000);

    if (typeof timer.unref === 'function') timer.unref();

    rl.on('line', line => {
      if (keywordRegex) {
        keywordRegex.lastIndex = 0;
        if (!keywordRegex.test(line)) return;
      }

      if (hasExplicitDateMarker(line)) {
        if (lineMatchesAnalysisDate(line, date) &&
            explicitRows.length < maxExplicit) {
          explicitRows.push(line);
        }
        return;
      }

      // 무날짜는 최근 일부만 별도 참고자료로 보존
      undatedQueue.push(line);
      if (undatedQueue.length > maxUndated) undatedQueue.shift();
    });

    grep.stderr.setEncoding('utf8');
    grep.stderr.on('data', chunk => {
      stderr += String(chunk || '');
      if (stderr.length > 3000) stderr = stderr.slice(-3000);
    });

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { rl.close(); } catch (_) {}

      resolve({
        filePath,
        explicitRows,
        undatedRows: undatedQueue,
        exists: true,
        error: stderr.trim() || null
      });
    };

    grep.on('error', error => {
      stderr += ` grep-error:${error.message}`;
      finish();
    });

    grep.on('close', finish);
  });
}

async function collectPm2Logs(kind, date, keywordRegex) {
  const files = discoverPm2LogFiles(kind);
  const results = await Promise.all(
    files.map(filePath => scanLogFile(filePath, date, keywordRegex))
  );

  const explicitParts = [];
  const undatedParts = [];
  const warnings = [];

  let explicitCount = 0;
  let undatedCount = 0;

  for (const result of results) {
    if (result.error) warnings.push(`${result.filePath}: ${result.error}`);

    if (result.explicitRows.length) {
      explicitParts.push(
        `----- SOURCE: ${result.filePath} -----`,
        ...result.explicitRows
      );
      explicitCount += result.explicitRows.length;
    }

    if (result.undatedRows.length) {
      undatedParts.push(
        `----- SOURCE: ${result.filePath} -----`,
        ...result.undatedRows
      );
      undatedCount += result.undatedRows.length;
    }
  }

  return {
    explicitText:
      explicitParts.length
        ? explicitParts.join('\n') + '\n'
        : '[해당 분석일로 날짜가 확정된 PM2 로그 없음]\n',
    undatedText:
      undatedParts.length
        ? [
            '[주의] 아래 로그에는 줄 자체에 날짜가 없습니다.',
            '[주의] 이전 거래일 로그가 섞여 있을 수 있으므로 실제 당일 거래 판단에 사용하지 마십시오.',
            '[기준] 당일 거래는 MASTER DATE FILTERED TRADE LOGS와 전략 LOCAL STATE를 사용하십시오.',
            '',
            ...undatedParts
          ].join('\n') + '\n'
        : '[무날짜 PM2 참고 로그 없음]\n',
    explicitCount,
    undatedCount,
    files,
    warnings
  };
}

async function tailPm2Errors(count = 100) {
  const files = discoverPm2LogFiles('error');
  const parts = [];
  const perFile = Math.max(20, Math.ceil(count / Math.max(1, files.length)));

  for (const filePath of files) {
    try {
      const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean);
      const tail = lines.slice(-perFile);
      if (tail.length) {
        parts.push(`----- SOURCE: ${filePath} -----`, ...tail);
      }
    } catch (_) {}
  }

  return parts.length ? parts.join('\n') + '\n' : '[최근 error 로그 없음]\n';
}

/* ---------------- FAST date filtering ---------------- */

function candidateDateKey(row = {}) {
  const values = [
    row.date,
    row.tradeDate,
    row.firstSeenAtMs,
    row.lastSeenAtMs,
    row.lastSourceObservedAtMs,
    row.firstSeenAt,
    row.lastSeenAt,
    row.updatedAt,
    row.createdAt
  ];

  for (const value of values) {
    const key = dateKeyFromValue(value, TZ);
    if (key) return key;
  }

  return '';
}

function valueMatchesDate(value, date) {
  return dateKeyFromValue(value, TZ) === date;
}

function buildFastLocalStateForDate(date) {
  const filePath = path.join(ROOT, 'paper-state-fast.json');
  const raw = readJsonFile(filePath, null);

  if (!raw || typeof raw !== 'object') {
    return {
      ok: false,
      date,
      sourceFile: filePath,
      error: 'paper-state-fast.json 없음 또는 JSON 읽기 실패'
    };
  }

  const rawCandidateDate = String(raw.candidateDate || '').trim();
  const allCandidates = Array.isArray(raw.candidates) ? raw.candidates : [];

  const candidates =
    rawCandidateDate === date
      ? allCandidates
      : allCandidates.filter(row => candidateDateKey(row) === date);

  const dailyStatsRaw =
    raw.dailyStats && typeof raw.dailyStats === 'object'
      ? raw.dailyStats
      : {};

  const dailyStats =
    dailyStatsRaw[date] && typeof dailyStatsRaw[date] === 'object'
      ? { [date]: dailyStatsRaw[date] }
      : {};

  const updatedAtMatches =
    !raw.updatedAt || valueMatchesDate(raw.updatedAt, date);

  return {
    ok: true,
    strategy: raw.strategy || 'FAST',
    strategyVersion: raw.strategyVersion || null,
    requestedDate: date,
    sourceFile: filePath,
    sourceCandidateDate: rawCandidateDate || null,
    sourceUpdatedAt: raw.updatedAt || null,
    sourceUpdatedAtMatchesDate: updatedAtMatches,
    candidateDate: date,
    candidateCount: candidates.length,
    candidates,
    dailyStats,
    lastRunAt:
      valueMatchesDate(raw.lastRunAt, date)
        ? raw.lastRunAt
        : null,
    lastRunAtMs:
      valueMatchesDate(raw.lastRunAtMs, date)
        ? raw.lastRunAtMs
        : 0,
    lastRunReason:
      updatedAtMatches
        ? (raw.lastRunReason || null)
        : null,
    _zipDateFilter: {
      applied: true,
      requestedDate: date,
      rawCandidateDate: rawCandidateDate || null,
      rawCandidateCount: allCandidates.length,
      includedCandidateCount: candidates.length,
      dailyStatsIncluded: Object.keys(dailyStats),
      note:
        rawCandidateDate === date
          ? 'candidateDate 일치. 현재 후보와 요청일 dailyStats만 포함.'
          : 'candidateDate 불일치. 후보 timestamp로 요청일만 필터하고 다른 날짜 dailyStats 제외.'
    }
  };
}

/* ---------------- daily / cumulative MASTER summary ---------------- */

function buildDailyPerformanceSummary(state = {}, date = '') {
  const logs = Array.isArray(state.tradeLogs) ? state.tradeLogs : [];
  const dayLogs = logs.filter(log => tradeLogDateKey(log) === date);
  const sellLogs = dayLogs.filter(log =>
    isSellTrade(log) &&
    Number.isFinite(Number(log.profit))
  );

  const strategyStats = ['OPEN', 'CORE', 'VOLUME', 'WAVE', 'FAST'].map(strategy => {
    const rows = dayLogs.filter(log => getStrategy(log) === strategy);
    const buys = rows.filter(isBuyTrade);
    const sells = rows.filter(log =>
      isSellTrade(log) &&
      Number.isFinite(Number(log.profit))
    );

    return {
      strategyGroup: strategy,
      tradeLogCount: rows.length,
      buyCount: buys.length,
      sellFillCount: sells.length,
      realizedProfit: sells.reduce((sum, log) => sum + Number(log.profit || 0), 0)
    };
  });

  return {
    ok: true,
    source: 'DIRECT_MASTER_STATE_DATE_FILTERED',
    date,
    tradeLogCount: dayLogs.length,
    buyCount: dayLogs.filter(isBuyTrade).length,
    sellFillCount: sellLogs.length,
    realizedProfit: sellLogs.reduce((sum, log) => sum + Number(log.profit || 0), 0),
    strategyStats,
    tradeLogs: dayLogs
  };
}

function buildCumulativeReference(state = {}) {
  const logs = Array.isArray(state.tradeLogs) ? state.tradeLogs : [];
  const sellLogs = logs.filter(log =>
    isSellTrade(log) &&
    Number.isFinite(Number(log.profit))
  );

  return {
    ok: true,
    scope: 'CUMULATIVE_REFERENCE_ONLY',
    tradeLogCount: logs.length,
    realizedProfit: sellLogs.reduce((sum, x) => sum + Number(x.profit || 0), 0),
    recentSells: sellLogs.slice(-20).reverse(),
    note: '누적 참고자료입니다. 오늘 전략 분석에는 DATE FILTERED 섹션을 사용하십시오.'
  };
}

function buildMasterFinancialState(date) {
  try {
    const snapshot = loadMasterSnapshot();
    const state = snapshot.state || {};
    const holdings = Array.isArray(state.holdings) ? state.holdings : [];
    const logs = Array.isArray(state.tradeLogs) ? state.tradeLogs : [];
    const dateLogs = logs.filter(log => tradeLogDateKey(log) === date);

    const n = value => {
      const num = Number(value || 0);
      return Number.isFinite(num) ? Math.trunc(num) : 0;
    };

    const statePath =
      portfolioManager.MASTER_STATE_FILE ||
      path.join(ROOT, 'paper-state-core.json');

    const rows = [
      `사용 상태파일: ${statePath}`,
      `분석일: ${date}`,
      `초기자산: ${n(state.initialCapital).toLocaleString()}원`,
      `현금: ${n(state.totalCash).toLocaleString()}원`,
      `현재 보유종목: ${holdings.length}`,
      `MASTER 전체 거래로그: ${logs.length}`,
      `분석일 거래로그: ${dateLogs.length}`,
      '',
      '----- 현재 보유 (과거 매수 보유 포함 / 참고) -----'
    ];

    for (const x of holdings) {
      rows.push([
        getStrategy(x),
        x.name || '-',
        x.code || '-',
        '수량', x.qty ?? '-',
        '매수가', x.buyPrice ?? '-',
        '현재가', x.currentPrice ?? '-',
        '매수일', x.buyTime || x.buyTimeText || x.buyAt || x.buyAtMs || '-'
      ].join(' '));
    }

    rows.push('', `----- ${date} 당일 거래 전체 (${dateLogs.length}건) -----`);

    if (!dateLogs.length) {
      rows.push('[해당 분석일 MASTER 거래 없음]');
    } else {
      for (const x of dateLogs) {
        rows.push([
          x.time || x.date || '-',
          getStrategy(x),
          x.type || '-',
          x.name || '-',
          x.code || '-',
          '손익', x.profit ?? '-',
          '수익률', x.profitRate ?? '-'
        ].join(' '));
      }
    }

    return rows.join('\n') + '\n';
  } catch (error) {
    return `MASTER 상태 조회 실패\n${error.message}\n`;
  }
}

/* ---------------- analyses ---------------- */

async function buildFastAnalysis(date) {
  const snapshot = loadMasterSnapshot();
  const portfolio = snapshot.portfolio || {};
  const masterTrades = getMasterStrategyTrades('FAST', date);
  const localState = buildFastLocalStateForDate(date);

  const [runtimeLog, outLog, errLog] = await Promise.all([
    collectRuntimeAnalysisLog(date, LOG_RX.FAST),
    collectPm2Logs('out', date, LOG_RX.FAST),
    collectPm2Logs('error', date, LOG_RX.FAST_ERR)
  ]);

  return [
    section(
      'FAST : DATE CONFIRMED KR SERVER OUT',
      mergeConfirmedLogText(runtimeLog, outLog)
    ),

    section(
      'FAST : MASTER TRADE LOGS (DATE FILTERED / SOURCE OF TRUTH)',
      safeJson(masterTrades)
    ),

    section(
      'FAST LOCAL STATE (DATE FILTERED)',
      safeJson(localState)
    ),

    section(
      'MASTER FAST SUMMARY (CURRENT ACCOUNT SNAPSHOT)',
      strategySummary(portfolio, ['FAST'])
    ),

    section(
      'FAST : DATE CONFIRMED KR SERVER ERROR',
      errLog.explicitText
    ),

    section(
      'FAST : UNDATED PM2 OUT (REFERENCE ONLY / MAY INCLUDE PREVIOUS DAYS)',
      outLog.undatedText
    ),

    section(
      'FAST : UNDATED PM2 ERROR (REFERENCE ONLY / MAY INCLUDE PREVIOUS DAYS)',
      errLog.undatedText
    ),

    section(
      'FAST : LOG ISOLATION STATUS',
      safeJson({
        date,
        confirmedRuntimeRows: runtimeLog.count,
        confirmedOutRows: outLog.explicitCount,
        confirmedErrorRows: errLog.explicitCount,
        undatedOutReferenceRows: outLog.undatedCount,
        undatedErrorReferenceRows: errLog.undatedCount,
        runtimeLogSource: runtimeLog.filePath,
        tradeSourceOfTruth: 'MASTER DATE FILTERED TRADE LOGS',
        candidateSourceOfTruth: 'FAST LOCAL STATE (DATE FILTERED)',
        warning:
          '무날짜 PM2 로그는 거래일을 확정할 수 없어 당일 성과 판단에서 제외'
      })
    )
  ].join('');
}

async function buildCoreVolumeAnalysis(date) {
  const snapshot = loadMasterSnapshot();
  const portfolio = snapshot.portfolio || {};
  const coreTrades = getMasterStrategyTrades('CORE', date);
  const volumeTrades = getMasterStrategyTrades('VOLUME', date);

  const [runtimeLog, outLog, errLog] = await Promise.all([
    collectRuntimeAnalysisLog(date, LOG_RX.CORE_VOLUME),
    collectPm2Logs('out', date, LOG_RX.CORE_VOLUME),
    collectPm2Logs('error', date, LOG_RX.CORE_VOLUME_ERR)
  ]);

  return [
    section('CORE / VOLUME : DATE CONFIRMED KR SERVER OUT', mergeConfirmedLogText(runtimeLog, outLog)),
    section('CORE MASTER TRADE LOGS (DATE FILTERED)', safeJson(coreTrades)),
    section('VOLUME MASTER TRADE LOGS (DATE FILTERED)', safeJson(volumeTrades)),
    section('CORE / VOLUME : DATE CONFIRMED KR SERVER ERROR', errLog.explicitText),
    section('CORE / VOLUME : UNDATED PM2 REFERENCE ONLY', outLog.undatedText),
    section('CORE / VOLUME : MASTER SUMMARY', strategySummary(portfolio, ['CORE', 'VOLUME']))
  ].join('');
}

async function buildOpenAnalysis(date) {
  const snapshot = loadMasterSnapshot();
  const portfolio = snapshot.portfolio || {};
  const trades = getMasterStrategyTrades('OPEN', date);

  const [runtimeLog, outLog, errLog] = await Promise.all([
    collectRuntimeAnalysisLog(date, LOG_RX.OPEN),
    collectPm2Logs('out', date, LOG_RX.OPEN),
    collectPm2Logs('error', date, LOG_RX.OPEN_ERR)
  ]);

  const learning = {};
  for (const name of ['open-learning-history.json', 'open-market.json']) {
    const filePath = path.join(ROOT, name);
    const raw = readJsonFile(filePath, null);
    if (raw !== null) learning[name] = raw;
  }

  return [
    section('OPEN / HOT : DATE CONFIRMED KR SERVER OUT', mergeConfirmedLogText(runtimeLog, outLog)),
    section('OPEN MASTER TRADE LOGS (DATE FILTERED / SOURCE OF TRUTH)', safeJson(trades)),
    section('OPEN / HOT : DATE CONFIRMED KR SERVER ERROR', errLog.explicitText),
    section('OPEN / HOT : UNDATED PM2 REFERENCE ONLY', outLog.undatedText),
    section('OPEN LEARNING LOCAL SNAPSHOT', safeJson(learning)),
    section('OPEN MASTER SUMMARY', strategySummary(portfolio, ['OPEN']))
  ].join('');
}

async function buildWaveAnalysis(date) {
  const snapshot = loadMasterSnapshot();
  const portfolio = snapshot.portfolio || {};
  const trades = getMasterStrategyTrades('WAVE', date);

  const [runtimeLog, outLog, errLog] = await Promise.all([
    collectRuntimeAnalysisLog(date, LOG_RX.WAVE),
    collectPm2Logs('out', date, LOG_RX.WAVE),
    collectPm2Logs('error', date, LOG_RX.WAVE_ERR)
  ]);

  const localState = readTextIfExists(
    path.join(ROOT, 'paper-state-wave.json'),
    'paper-state-wave.json 없음 또는 현재 구조에서 별도 상태파일 미사용\n'
  );

  return [
    section('WAVE : DATE CONFIRMED KR SERVER OUT', mergeConfirmedLogText(runtimeLog, outLog)),
    section('WAVE MASTER TRADE LOGS (DATE FILTERED / SOURCE OF TRUTH)', safeJson(trades)),
    section('WAVE : DATE CONFIRMED KR SERVER ERROR', errLog.explicitText),
    section('WAVE : UNDATED PM2 REFERENCE ONLY', outLog.undatedText),
    section('WAVE LOCAL STATE (REFERENCE)', localState),
    section('MASTER WAVE SUMMARY', strategySummary(portfolio, ['WAVE']))
  ].join('');
}

async function buildMasterAnalysis(date) {
  const snapshot = loadMasterSnapshot();
  const state = snapshot.state || {};
  const portfolio = snapshot.portfolio || {};

  const dailyPerformance = buildDailyPerformanceSummary(state, date);
  const cumulativeReference = buildCumulativeReference(state);
  const recentErrors = await tailPm2Errors(100);

  const stateFiles = (() => {
    try {
      return fs.readdirSync(ROOT)
        .filter(name => /^paper-state.*\.json$/i.test(name))
        .sort();
    } catch (_) {
      return [];
    }
  })();

  return [
    section('MASTER PORTFOLIO SUMMARY (CURRENT SNAPSHOT)', safeJson(portfolio)),
    section('PERFORMANCE SUMMARY (DATE FILTERED / USE FOR TODAY)', safeJson(dailyPerformance)),
    section('PERFORMANCE SUMMARY (CUMULATIVE / REFERENCE ONLY)', safeJson(cumulativeReference)),
    section('PAPER STATE FILE LIST', stateFiles.length ? stateFiles.join('\n') : 'paper-state*.json 없음'),
    section('MASTER FINANCIAL STATE (DATE FILTERED TRADES)', buildMasterFinancialState(date)),
    section(
      'RECENT KR SERVER ERRORS (TAIL / DATE NOT GUARANTEED)',
      '[주의] 이 섹션은 단순 tail 참고자료이며 날짜가 없는 줄은 오늘 오류로 단정하지 마십시오.\n' + recentErrors
    )
  ].join('');
}

/* ---------------- package ---------------- */

function normalizeType(value) {
  const raw = String(value || 'ALL').trim().toUpperCase().replace(/[\s-]+/g, '_');
  const map = {
    FAST: 'FAST',
    CORE: 'CORE_VOLUME',
    VOLUME: 'CORE_VOLUME',
    CORE_VOLUME: 'CORE_VOLUME',
    OPEN: 'OPEN',
    HOT: 'OPEN',
    WAVE: 'WAVE',
    CLOSE: 'CLOSE',
    ALL: 'ALL'
  };
  return map[raw] || null;
}

function sourceListForType(type) {
  const common = ['portfolio-manager.js', 'server.js', 'analysis-download.js'];
  const byType = {
    FAST: ['fast-strategy.js', ...common],
    CORE_VOLUME: ['auto-trader-core.js', ...common],
    OPEN: ['open-strategy.js', 'hot-scanner.js', ...common],
    WAVE: ['wave-strategy.js', 'hot-scanner.js', ...common],
    CLOSE: ['auto-trader-core.js', 'open-strategy.js', 'hot-scanner.js', 'wave-strategy.js', ...common],
    ALL: ['auto-trader-core.js', 'open-strategy.js', 'hot-scanner.js', 'wave-strategy.js', 'fast-strategy.js', ...common]
  };
  return [...new Set(byType[type] || common)];
}

function addSourceFiles(entries, names = []) {
  for (const name of names) {
    const filePath = path.join(ROOT, name);
    try {
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) continue;
      entries.push({
        name: `source/${name}`,
        data: fs.readFileSync(filePath),
        mtime: fs.statSync(filePath).mtime
      });
    } catch (_) {}
  }
}

async function createPackage(type, date) {
  const day = date.replace(/-/g, '');
  const entries = [];

  if (['CORE_VOLUME', 'CLOSE', 'ALL'].includes(type)) {
    entries.push({
      name: `analysis/syquant-kr-core-volume-${day}-analysis.txt`,
      data: await buildCoreVolumeAnalysis(date)
    });
  }

  if (['OPEN', 'CLOSE', 'ALL'].includes(type)) {
    entries.push({
      name: `analysis/syquant-kr-open-${day}-analysis.txt`,
      data: await buildOpenAnalysis(date)
    });
  }

  if (['WAVE', 'CLOSE', 'ALL'].includes(type)) {
    entries.push({
      name: `analysis/syquant-kr-wave-${day}-analysis.txt`,
      data: await buildWaveAnalysis(date)
    });
  }

  if (['FAST', 'ALL'].includes(type)) {
    entries.push({
      name: `analysis/syquant-kr-fast-${day}-analysis.txt`,
      data: await buildFastAnalysis(date)
    });
  }

  entries.push({
    name: `analysis/syquant-kr-master-${day}-analysis.txt`,
    data: await buildMasterAnalysis(date)
  });

  addSourceFiles(entries, sourceListForType(type));

  const manifest = {
    ok: true,
    market: 'KR',
    type,
    date,
    generatedAt: new Date().toISOString(),
    timeZone: TZ,
    sourceRoot: ROOT,
    note: 'ChatGPT 분석용. .env/token/인증정보는 포함하지 않습니다.',
    dateIsolation: {
      masterTrades: '요청 날짜만 포함',
      fastLocalState: 'candidateDate/dailyStats 요청 날짜만 포함',
      runtimeDatedRows: '분석 모듈이 전 전략 console 로그를 KST 날짜·시간과 함께 일자별 파일에 기록',
      pm2ExplicitRows: '기존 PM2 로그 중 줄 자체 날짜가 요청 날짜와 일치할 때만 당일 확정 로그',
      pm2UndatedRows: '별도 REFERENCE ONLY 섹션으로 격리. 당일 거래 판단에 사용하지 않음',
      cumulativePerformance: 'REFERENCE ONLY로 분리'
    },
    analysisFiles: entries
      .filter(x => x.name.startsWith('analysis/'))
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
    fileName: `syquant-KR-${type}-${day}.zip`,
    buffer: buildZip(entries)
  };
}

/* ---------------- status / routes ---------------- */

function getFastHoldingCount() {
  try {
    const state = loadMasterSnapshot().state || {};
    const holdings = Array.isArray(state.holdings) ? state.holdings : [];

    return holdings.filter(item =>
      getStrategy(item) === 'FAST' &&
      Number(item.qty || 0) > 0
    ).length;
  } catch (_) {
    return null;
  }
}

function buildStatus() {
  const date = dateKey(TZ);
  const hhmm = timeHHMM(TZ);
  const fastHoldingCount = getFastHoldingCount();
  const afterFastTime = hhmm >= '09:30';
  const afterClose = hhmm >= '15:30';

  let fastMessage;
  let fastReady = false;

  if (fastHoldingCount === null) {
    fastMessage = 'FAST 보유상태 확인 필요';
  } else if (fastHoldingCount > 0) {
    fastMessage = `FAST 보유 ${fastHoldingCount}종목 · 보유 종료 후 분석 권장`;
  } else if (!afterFastTime) {
    fastMessage = 'FAST 보유 0종목 · 09:30 이후 분석 권장';
  } else {
    fastMessage = 'FAST 보유 0종목 · 분석 가능';
    fastReady = true;
  }

  return {
    ok: true,
    market: 'KR',
    date,
    time: hhmm,
    fast: {
      holdingCount: fastHoldingCount,
      ready: fastReady,
      message: fastMessage
    },
    close: {
      ready: afterClose,
      message:
        afterClose
          ? '15:30 장 종료 · 장마감 분석 가능'
          : '15:30 이후 장마감 분석 권장'
    }
  };
}

module.exports = function installKrAnalysisRoutes(app) {
  installRuntimeLogCapture();

  if (!app || typeof app.get !== 'function') {
    throw new Error('Express app이 필요합니다.');
  }

  app.get('/api/analysis/status', (req, res) => {
    try {
      res.json(buildStatus());
    } catch (error) {
      res.status(500).json({
        ok: false,
        message: error.message
      });
    }
  });

  app.get('/api/analysis/download', async (req, res) => {
    try {
      const type = normalizeType(req.query.type);

      if (!type) {
        return res.status(400).json({
          ok: false,
          message: '지원하지 않는 type입니다.'
        });
      }

      const date = validateDate(
        req.query.date,
        dateKey(TZ)
      );

      const result = await createPackage(type, date);
      sendZip(res, result.fileName, result.buffer);
    } catch (error) {
      console.error('[KR 분석 ZIP 생성 오류]', error);

      if (!res.headersSent) {
        res.status(500).json({
          ok: false,
          message: error.message
        });
      } else {
        res.end();
      }
    }
  });

  console.log(
    '[분석자료] KR ZIP 다운로드 API 활성화 /api/analysis/download / 전 전략 날짜확정 런타임 로그 v9'
  );
};

module.exports.__test = {
  normalizeType,
  sourceListForType,
  buildStatus,
  tradeLogDateKey,
  getMasterStrategyTrades,
  lineMatchesAnalysisDate,
  discoverPm2LogFiles,
  buildFastLocalStateForDate,
  buildDailyPerformanceSummary,
  collectRuntimeAnalysisLog,
  runtimeLogPathForDate,
  createPackage
};
