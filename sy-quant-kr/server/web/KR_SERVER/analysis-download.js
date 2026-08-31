'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const readline = require('readline');
const zlib = require('zlib');
const { execFile } = require('child_process');
const portfolioManager = require('./portfolio-manager');

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
    const compressed = zlib.deflateRawSync(file.data, { level: 6 });
    const useDeflate = compressed.length < file.data.length;
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
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const get = type => parts.find(p => p.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function timeHHMM(timeZone) {
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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('date는 YYYY-MM-DD 형식이어야 합니다.');
  return date;
}

function safeJson(value) {
  return JSON.stringify(value, null, 2);
}

function getJson(port, pathname, timeoutMs = 10000) {
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
          if (res.statusCode >= 400) {
            resolve({ ok: false, httpStatus: res.statusCode, response: parsed });
          } else {
            resolve(parsed);
          }
        } catch (error) {
          resolve({ ok: false, error: `JSON 파싱 실패: ${error.message}`, raw: text.slice(0, 20000) });
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error(`API ${timeoutMs}ms 시간초과`)));
    req.on('error', error => resolve({ ok: false, error: error.message }));
  });
}

async function filterLog(filePath, date, keywordRegex, maxLines = 25000) {
  if (!fs.existsSync(filePath)) return `[로그파일 없음] ${filePath}\n`;
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const rows = [];
  const dateToken = `${date}T`;
  let truncated = false;
  try {
    for await (const line of rl) {
      if (!line.includes(dateToken)) continue;
      if (keywordRegex && !keywordRegex.test(line)) continue;
      rows.push(line);
      if (rows.length >= maxLines) {
        truncated = true;
        break;
      }
    }
  } finally {
    rl.close();
    stream.destroy();
  }
  if (truncated) rows.push(`[이하 생략: 관련 로그 ${maxLines.toLocaleString()}줄 초과]`);
  return rows.length ? rows.join('\n') + '\n' : '[해당 조건 로그 없음]\n';
}

async function tailLines(filePath, count = 100) {
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

function readJsonIfExists(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    return text.trim() ? JSON.parse(text) : fallback;
  } catch (_) {
    return fallback;
  }
}

function listFiles(dirPath, predicate) {
  try {
    return fs.readdirSync(dirPath).filter(name => !predicate || predicate(name));
  } catch (_) {
    return [];
  }
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
    if (!fs.existsSync(scriptPath)) {
      resolve(`[실행파일 없음] ${scriptPath}\n`);
      return;
    }
    execFile(process.execPath, [...(options.nodeArgs || []), scriptPath, ...args], {
      cwd: options.cwd || path.dirname(scriptPath),
      timeout: options.timeoutMs || 30000,
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
const PORT = 3000;
const PM2_OUT = '/home/ubuntu/.pm2/logs/sy-quant-kr-server-out.log';
const PM2_ERR = '/home/ubuntu/.pm2/logs/sy-quant-kr-server-error.log';
const TZ = 'Asia/Seoul';

const LOG_RX = {
  CORE_VOLUME: /CORE|VOLUME|MASTER|PORTFOLIO|매수|매도|보유|차단|후보|재평가|점수|스위칭/i,
  CORE_VOLUME_ERR: /CORE|VOLUME|MASTER|PORTFOLIO|error|fail|timeout|시간초과|오류|실패/i,
  OPEN: /OPEN|HOT|MASTER|PORTFOLIO|매수|매도|차단|후보|지속|관찰|시장/i,
  OPEN_ERR: /OPEN|HOT|MASTER|PORTFOLIO|error|fail|timeout|시간초과|API|오류|실패/i,
  WAVE: /WAVE|READY|TRIGGER|HOLD|PROTECT|REBOUND|COOLDOWN|전일급등|MASTER|PORTFOLIO|매수|매도/i,
  WAVE_ERR: /WAVE|wave-strategy|MASTER|PORTFOLIO|error|fail|timeout|시간초과|오류|실패/i,
  FAST: /FAST|MASTER|PORTFOLIO|매수|매도|후보|점수|트리거|관찰|진입|청산|손절|익절|보유/i,
  FAST_ERR: /FAST|MASTER|PORTFOLIO|error|fail|timeout|시간초과|API|오류|실패/i
};

function section(title, body = '') {
  return `===== ${title} =====\n${String(body || '').trimEnd()}\n\n`;
}

function strategySummary(portfolio, ids) {
  const strategies = portfolio?.strategies || {};
  const out = {};
  for (const id of ids) out[id] = strategies[id] || {};
  return safeJson(out);
}

async function buildCoreVolumeAnalysis(date) {
  const [outLog, errLog, portfolio] = await Promise.all([
    filterLog(PM2_OUT, date, LOG_RX.CORE_VOLUME),
    filterLog(PM2_ERR, date, LOG_RX.CORE_VOLUME_ERR),
    getJson(PORT, '/api/portfolio-summary')
  ]);
  return [
    section('CORE / VOLUME : KR SERVER OUT', outLog),
    section('CORE / VOLUME : KR SERVER ERROR', errLog),
    section('CORE / VOLUME : MASTER SUMMARY', strategySummary(portfolio, ['CORE', 'VOLUME']))
  ].join('');
}

async function buildOpenAnalysis(date) {
  const [outLog, errLog, learning, portfolio] = await Promise.all([
    filterLog(PM2_OUT, date, LOG_RX.OPEN),
    filterLog(PM2_ERR, date, LOG_RX.OPEN_ERR),
    getJson(PORT, '/api/open-learning-summary'),
    getJson(PORT, '/api/portfolio-summary')
  ]);
  return [
    section('OPEN / HOT : KR SERVER OUT', outLog),
    section('OPEN / HOT : KR SERVER ERROR', errLog),
    section('OPEN LEARNING SUMMARY', safeJson(learning)),
    section('OPEN MASTER SUMMARY', strategySummary(portfolio, ['OPEN']))
  ].join('');
}

async function buildWaveAnalysis(date) {
  const [outLog, errLog, portfolio] = await Promise.all([
    filterLog(PM2_OUT, date, LOG_RX.WAVE),
    filterLog(PM2_ERR, date, LOG_RX.WAVE_ERR),
    getJson(PORT, '/api/portfolio-summary')
  ]);
  const localState = readTextIfExists(
    path.join(ROOT, 'paper-state-wave.json'),
    'paper-state-wave.json 없음 또는 현재 구조에서 별도 상태파일 미사용\n'
  );
  return [
    section('WAVE : KR SERVER OUT', outLog),
    section('WAVE : KR SERVER ERROR', errLog),
    section('WAVE LOCAL STATE', localState),
    section('MASTER WAVE SUMMARY', strategySummary(portfolio, ['WAVE']))
  ].join('');
}

async function buildFastAnalysis(date) {
  const [outLog, errLog, portfolio, fastSummary] = await Promise.all([
    filterLog(PM2_OUT, date, LOG_RX.FAST),
    filterLog(PM2_ERR, date, LOG_RX.FAST_ERR),
    getJson(PORT, '/api/portfolio-summary'),
    getJson(PORT, '/api/fast-summary')
  ]);
  const localState = readTextIfExists(
    path.join(ROOT, 'paper-state-fast.json'),
    'paper-state-fast.json 없음 또는 현재 구조에서 별도 상태파일 미사용\n'
  );
  return [
    section('FAST : KR SERVER OUT', outLog),
    section('FAST : KR SERVER ERROR', errLog),
    section('FAST SUMMARY', safeJson(fastSummary)),
    section('FAST LOCAL STATE', localState),
    section('MASTER FAST SUMMARY', strategySummary(portfolio, ['FAST']))
  ].join('');
}

function buildMasterFinancialState(date) {
  const candidates = ['paper-state-core.json', 'paper-state.json'];
  const stateName = candidates.find(name => fs.existsSync(path.join(ROOT, name)));
  if (!stateName) return 'MASTER 상태파일을 자동으로 찾지 못함\n';

  const state = readJsonIfExists(path.join(ROOT, stateName), {}) || {};
  const holdings = Array.isArray(state.holdings) ? state.holdings : [];
  const logs = Array.isArray(state.tradeLogs) ? state.tradeLogs : [];
  const n = value => {
    const num = Number(value || 0);
    return Number.isFinite(num) ? Math.trunc(num) : 0;
  };

  const rows = [
    `사용 상태파일: ${path.join(ROOT, stateName)}`,
    `분석일: ${date}`,
    `초기자산: ${n(state.initialCapital).toLocaleString()}원`,
    `현금: ${n(state.totalCash).toLocaleString()}원`,
    `보유종목: ${holdings.length}`,
    `거래로그: ${logs.length}`,
    '',
    '----- 현재 보유 -----'
  ];

  for (const x of holdings) {
    rows.push([
      x.strategyGroup || x.strategy || x.ownerStrategy || 'UNKNOWN',
      x.name || '-',
      x.code || '-',
      '수량', x.qty ?? '-',
      '매수가', x.buyPrice ?? '-',
      '현재가', x.currentPrice ?? '-'
    ].join(' '));
  }

  rows.push('', '----- 최근 거래 50건 -----');
  for (const x of logs.slice(-50)) {
    rows.push([
      x.time || x.date || '-',
      x.strategyGroup || x.strategy || x.ownerStrategy || 'UNKNOWN',
      x.type || '-',
      x.name || '-',
      x.code || '-',
      '손익', x.profit ?? '-',
      '수익률', x.profitRate ?? '-'
    ].join(' '));
  }
  return rows.join('\n') + '\n';
}

async function buildMasterAnalysis(date) {
  const [portfolio, performance, recentErrors] = await Promise.all([
    getJson(PORT, '/api/portfolio-summary'),
    getJson(PORT, '/api/performance-summary'),
    tailLines(PM2_ERR, 100)
  ]);
  const stateFiles = listFiles(ROOT, name => /^paper-state.*\.json$/i.test(name)).sort();
  return [
    section('MASTER PORTFOLIO SUMMARY', safeJson(portfolio)),
    section('PERFORMANCE SUMMARY', safeJson(performance)),
    section('PAPER STATE FILE LIST', stateFiles.length ? stateFiles.join('\n') : 'paper-state*.json 없음'),
    section('MASTER FINANCIAL STATE', buildMasterFinancialState(date)),
    section('RECENT KR SERVER ERRORS', recentErrors)
  ].join('');
}

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
  const common = ['portfolio-manager.js', 'server.js'];
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

async function createPackage(type, date) {
  const day = date.replace(/-/g, '');
  const entries = [];
  const analyses = {};

  if (['CORE_VOLUME', 'CLOSE', 'ALL'].includes(type)) {
    analyses.coreVolume = await buildCoreVolumeAnalysis(date);
    entries.push({ name: `analysis/syquant-kr-core-volume-${day}-analysis.txt`, data: analyses.coreVolume });
  }
  if (['OPEN', 'CLOSE', 'ALL'].includes(type)) {
    analyses.open = await buildOpenAnalysis(date);
    entries.push({ name: `analysis/syquant-kr-open-${day}-analysis.txt`, data: analyses.open });
  }
  if (['WAVE', 'CLOSE', 'ALL'].includes(type)) {
    analyses.wave = await buildWaveAnalysis(date);
    entries.push({ name: `analysis/syquant-kr-wave-${day}-analysis.txt`, data: analyses.wave });
  }
  if (['FAST', 'ALL'].includes(type)) {
    analyses.fast = await buildFastAnalysis(date);
    entries.push({ name: `analysis/syquant-kr-fast-${day}-analysis.txt`, data: analyses.fast });
  }

  analyses.master = await buildMasterAnalysis(date);
  entries.push({ name: `analysis/syquant-kr-master-${day}-analysis.txt`, data: analyses.master });
  addSourceFiles(entries, ROOT, sourceListForType(type));

  const manifest = {
    ok: true,
    market: 'KR',
    type,
    date,
    generatedAt: new Date().toISOString(),
    timeZone: TZ,
    sourceRoot: ROOT,
    note: 'ChatGPT 분석용. .env/token/인증정보는 포함하지 않습니다.',
    analysisFiles: entries.filter(x => x.name.startsWith('analysis/')).map(x => x.name),
    sourceFiles: entries.filter(x => x.name.startsWith('source/')).map(x => x.name)
  };
  entries.unshift({ name: 'manifest.json', data: safeJson(manifest) + '\n' });

  return {
    fileName: `syquant-KR-${type}-${day}.zip`,
    buffer: buildZip(entries)
  };
}

function getFastHoldingCount() {
  try {
    const state = portfolioManager.loadMasterState();
    const holdings = Array.isArray(state?.holdings) ? state.holdings : [];
    return holdings.filter(item => {
      const strategy = String(item.strategyGroup || item.strategy || item.ownerStrategy || '').toUpperCase();
      return strategy === 'FAST' && Number(item.qty || 0) > 0;
    }).length;
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
    fast: { holdingCount: fastHoldingCount, ready: fastReady, message: fastMessage },
    close: { ready: afterClose, message: afterClose ? '15:30 장 종료 · 장마감 분석 가능' : '15:30 이후 장마감 분석 권장' }
  };
}

module.exports = function installKrAnalysisRoutes(app) {
  if (!app || typeof app.get !== 'function') throw new Error('Express app이 필요합니다.');

  app.get('/api/analysis/status', (req, res) => {
    try {
      res.json(buildStatus());
    } catch (error) {
      res.status(500).json({ ok: false, message: error.message });
    }
  });

  app.get('/api/analysis/download', async (req, res) => {
    try {
      const type = normalizeType(req.query.type);
      if (!type) return res.status(400).json({ ok: false, message: '지원하지 않는 type입니다.' });
      const date = validateDate(req.query.date, dateKey(TZ));
      const result = await createPackage(type, date);
      sendZip(res, result.fileName, result.buffer);
    } catch (error) {
      console.error('[KR 분석 ZIP 생성 오류]', error);
      if (!res.headersSent) res.status(500).json({ ok: false, message: error.message });
      else res.end();
    }
  });

  console.log('[분석자료] KR ZIP 다운로드 API 활성화 /api/analysis/download');
};

module.exports.__test = { normalizeType, sourceListForType, buildStatus };
