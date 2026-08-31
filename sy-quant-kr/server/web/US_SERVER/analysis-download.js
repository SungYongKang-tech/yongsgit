'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const readline = require('readline');
const zlib = require('zlib');
const { execFile } = require('child_process');

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
const PORT = 3001;
const PM2_OUT = '/home/ubuntu/.pm2/logs/sy-quant-us-server-out.log';
const PM2_ERR = '/home/ubuntu/.pm2/logs/sy-quant-us-server-error.log';
const TZ = 'America/New_York';

const CORE_LOG_RX = /US-CORE|CORE|READY|WATCH|가상진입|가상추적|이력|일일요약|데이터보정|후보|점수|관찰|오류|실패/i;
const CORE_ERR_RX = /US-CORE|CORE|error|fail|timeout|시간초과|API|오류|실패/i;

function section(title, body = '') {
  return `===== ${title} =====\n${String(body || '').trimEnd()}\n\n`;
}

async function buildCoreAnalysis(date) {
  const [outLog, errLog, status, virtualTrades, history] = await Promise.all([
    filterLog(PM2_OUT, date, CORE_LOG_RX),
    filterLog(PM2_ERR, date, CORE_ERR_RX),
    getJson(PORT, '/api/us-core/status'),
    getJson(PORT, '/api/us-core/virtual-trades'),
    getJson(PORT, `/api/us-core/history?date=${encodeURIComponent(date)}`)
  ]);

  const diagnostics = await runNodeScript(
    path.join(ROOT, 'us-core-diagnostics.js'),
    [],
    { cwd: ROOT, timeoutMs: 45000, nodeArgs: ['-r', path.join(ROOT, 'us-core-data-safety-patch.js')] }
  );

  return [
    section('US-CORE : US SERVER OUT', outLog),
    section('US-CORE : US SERVER ERROR', errLog),
    section('US-CORE STATUS', safeJson(status)),
    section('US-CORE VIRTUAL TRADES', safeJson(virtualTrades)),
    section('US-CORE HISTORY', safeJson(history)),
    section('US-CORE DIAGNOSTICS', diagnostics)
  ].join('');
}

async function buildCoreResultAnalysis(date) {
  const day = date.replace(/-/g, '');
  const summary = await getJson(PORT, `/api/us-core/daily-summary?date=${encodeURIComponent(date)}`);
  const finalTxt = readTextIfExists(
    path.join(ROOT, 'us-core-reports', `us-core-summary-${day}.txt`),
    `장마감 FINAL TXT 아직 없음: ${path.join(ROOT, 'us-core-reports', `us-core-summary-${day}.txt`)}\n`
  );
  const exitSimulation = await runNodeScript(
    path.join(ROOT, 'us-core-exit-simulator.js'),
    [],
    { cwd: ROOT, timeoutMs: 45000 }
  );

  return [
    section('US-CORE DAILY SUMMARY', safeJson(summary)),
    section('US-CORE DAILY SUMMARY TXT', finalTxt),
    section('EXIT SIMULATION', exitSimulation)
  ].join('');
}

async function buildMasterAnalysis() {
  const [status, portfolio, settings, buyCheck, historyStatus, summaryStatus, recentErrors] = await Promise.all([
    getJson(PORT, '/api/status'),
    getJson(PORT, '/api/portfolio-summary'),
    getJson(PORT, '/api/strategy-settings'),
    getJson(PORT, '/api/strategy-buy-check/CORE'),
    getJson(PORT, '/api/us-core/history-status'),
    getJson(PORT, '/api/us-core/daily-summary-status'),
    tailLines(PM2_ERR, 100)
  ]);

  return [
    section('US SERVER STATUS', safeJson(status)),
    section('US PORTFOLIO', safeJson(portfolio)),
    section('US STRATEGY SETTINGS', safeJson(settings)),
    section('CORE BUY CHECK', safeJson(buyCheck)),
    section('HISTORY RECORDER STATUS', safeJson(historyStatus)),
    section('DAILY SUMMARY STATUS', safeJson(summaryStatus)),
    section('RECENT US ERRORS', recentErrors)
  ].join('');
}

function sourceFiles() {
  return [
    'server.js',
    'kiwoom-us-client.js',
    'portfolio-manager.js',
    'strategy-settings-store.js',
    'market-calendar.js',
    'us-core-market-client.js',
    'us-core-strategy.js',
    'us-core-virtual-tracker.js',
    'us-core-history-store.js',
    'us-core-daily-summary.js',
    'us-core-exit-simulator.js',
    'us-core-data-safety-patch.js',
    'us-core-diagnostics.js',
    'us-dashboard-activity-store.js'
  ];
}

async function createPackage(date) {
  const day = date.replace(/-/g, '');
  // 진단과 exit simulation이 동시에 실행되어 US API 부하가 겹치지 않도록 순차 수집한다.
  const core = await buildCoreAnalysis(date);
  const result = await buildCoreResultAnalysis(date);
  const master = await buildMasterAnalysis();

  const entries = [
    { name: `analysis/syquant-us-core-${day}-analysis.txt`, data: core },
    { name: `analysis/syquant-us-core-result-${day}-analysis.txt`, data: result },
    { name: `analysis/syquant-us-master-${day}-analysis.txt`, data: master }
  ];
  addSourceFiles(entries, ROOT, sourceFiles());

  const manifest = {
    ok: true,
    market: 'US',
    type: 'CORE',
    date,
    generatedAt: new Date().toISOString(),
    tradingTimeZone: TZ,
    sourceRoot: ROOT,
    mode: 'PAPER expected',
    note: 'ChatGPT 분석용. .env/token/인증정보는 포함하지 않습니다.',
    analysisFiles: entries.filter(x => x.name.startsWith('analysis/')).map(x => x.name),
    sourceFiles: entries.filter(x => x.name.startsWith('source/')).map(x => x.name)
  };
  entries.unshift({ name: 'manifest.json', data: safeJson(manifest) + '\n' });

  return {
    fileName: `syquant-US-CORE-${day}.zip`,
    buffer: buildZip(entries)
  };
}

module.exports = function installUsAnalysisRoutes(app) {
  if (!app || typeof app.get !== 'function') throw new Error('Express app이 필요합니다.');

  app.get('/api/analysis/status', async (req, res) => {
    try {
      const [server, core, summary] = await Promise.all([
        getJson(PORT, '/api/status'),
        getJson(PORT, '/api/us-core/status'),
        getJson(PORT, '/api/us-core/daily-summary-status')
      ]);
      res.json({
        ok: true,
        market: 'US',
        date: dateKey(TZ),
        time: timeHHMM(TZ),
        server,
        core,
        dailySummary: summary
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
      if (!res.headersSent) res.status(500).json({ ok: false, message: error.message });
      else res.end();
    }
  });

  console.log('[분석자료] US ZIP 다운로드 API 활성화 /api/analysis/download');
};
