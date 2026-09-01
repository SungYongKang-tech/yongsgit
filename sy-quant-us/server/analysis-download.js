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
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = type => parts.find(p => p.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function timeHHMM(timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const get = type => parts.find(p => p.type === type)?.value || '00';
  return `${get('hour')}:${get('minute')}`;
}

function validateDate(value, fallback) {
  const date = String(value || fallback || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('date는 YYYY-MM-DD 형식이어야 합니다.');
  return date;
}

function safeJson(value) { return JSON.stringify(value, null, 2); }

function getJson(port, pathname, timeoutMs = 12000) {
  return new Promise(resolve => {
    const req = http.get({ hostname: '127.0.0.1', port, path: pathname, timeout: timeoutMs, headers: { Accept: 'application/json' } }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => {
        try {
          const parsed = text ? JSON.parse(text) : {};
          resolve(res.statusCode >= 400 ? { ok: false, httpStatus: res.statusCode, response: parsed } : parsed);
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
    entries.push({ name: `source/${name}`, data: fs.readFileSync(filePath), mtime: fs.statSync(filePath).mtime });
  }
}

function runNodeScript(scriptPath, args = [], options = {}) {
  return new Promise(resolve => {
    if (!fs.existsSync(scriptPath)) return resolve(`[실행파일 없음] ${scriptPath}\n`);
    execFile(process.execPath, [...(options.nodeArgs || []), scriptPath, ...args], {
      cwd: options.cwd || path.dirname(scriptPath), timeout: options.timeoutMs || 45000,
      maxBuffer: options.maxBuffer || 8 * 1024 * 1024, env: process.env
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
const STRATEGIES = Object.freeze([
  { id: 'CORE', slug: 'core' },
  { id: 'FAST', slug: 'fast' },
  { id: 'VOLUME', slug: 'volume' },
  { id: 'WAVE', slug: 'wave' }
]);

function section(title, body = '') { return `===== ${title} =====\n${String(body || '').trimEnd()}\n\n`; }

function nyDateKeyFromDate(date) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = type => parts.find(p => p.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function lineBelongsToTradingDate(line, tradingDate) {
  const value = String(line || '');
  const iso = value.match(/\b(20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2}))\b/);
  if (iso) {
    const parsed = new Date(iso[1]);
    if (!Number.isNaN(parsed.getTime())) return nyDateKeyFromDate(parsed) === tradingDate;
  }
  const plainIso = value.match(/\b(20\d{2}-\d{2}-\d{2})T\d{2}:\d{2}:\d{2}\b/);
  if (plainIso) return plainIso[1] === tradingDate;
  return value.includes(tradingDate);
}

async function filterTradingDayLog(filePath, tradingDate, keywordRegex = null, maxLines = 40000) {
  if (!fs.existsSync(filePath)) return `[로그파일 없음] ${filePath}\n`;
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const rows = [];
  let truncated = false;
  try {
    for await (const line of rl) {
      if (!lineBelongsToTradingDate(line, tradingDate)) continue;
      if (keywordRegex) {
        keywordRegex.lastIndex = 0;
        if (!keywordRegex.test(line)) continue;
      }
      rows.push(line);
      if (rows.length >= maxLines) { truncated = true; break; }
    }
  } finally {
    rl.close();
    stream.destroy();
  }
  if (truncated) rows.push(`[이하 생략: 관련 로그 ${maxLines.toLocaleString()}줄 초과]`);
  return rows.length ? rows.join('\n') + '\n' : '[해당 거래일 관련 로그 없음]\n';
}

function strategyLogRegex(id) { return new RegExp(`US-${id}|\\b${id}\\b`, 'i'); }
function strategyErrorRegex(id) { return new RegExp(`US-${id}|\\b${id}\\b|error|fail|timeout|시간초과|API|오류|실패`, 'i'); }

async function buildStrategyAnalysis(strategy, date) {
  const { id, slug } = strategy;
  const [outLog, errLog, status, virtualTrades, history, historyStatus, summaryStatus] = await Promise.all([
    filterTradingDayLog(PM2_OUT, date, strategyLogRegex(id)),
    filterTradingDayLog(PM2_ERR, date, strategyErrorRegex(id)),
    getJson(PORT, `/api/us-${slug}/status`),
    getJson(PORT, `/api/us-${slug}/virtual-trades`),
    getJson(PORT, `/api/us-${slug}/history?date=${encodeURIComponent(date)}`),
    getJson(PORT, `/api/us-${slug}/history-status`),
    getJson(PORT, `/api/us-${slug}/daily-summary-status`)
  ]);

  const rows = [
    section(`US-${id} : US SERVER OUT`, outLog),
    section(`US-${id} : US SERVER ERROR`, errLog),
    section(`US-${id} STATUS`, safeJson(status)),
    section(`US-${id} VIRTUAL TRADES`, safeJson(virtualTrades)),
    section(`US-${id} HISTORY`, safeJson(history)),
    section(`US-${id} HISTORY RECORDER STATUS`, safeJson(historyStatus)),
    section(`US-${id} DAILY SUMMARY STATUS`, safeJson(summaryStatus))
  ];

  if (id === 'CORE') {
    const diagnostics = await runNodeScript(path.join(ROOT, 'us-core-diagnostics.js'), [], {
      cwd: ROOT, timeoutMs: 45000, nodeArgs: ['-r', path.join(ROOT, 'us-core-data-safety-patch.js')]
    });
    rows.push(section('US-CORE DIAGNOSTICS', diagnostics));
  }
  return rows.join('');
}

async function buildStrategyResultAnalysis(strategy, date) {
  const { id, slug } = strategy;
  const day = date.replace(/-/g, '');
  const summary = await getJson(PORT, `/api/us-${slug}/daily-summary?date=${encodeURIComponent(date)}`);
  const finalTxtPath = path.join(ROOT, `us-${slug}-reports`, `us-${slug}-summary-${day}.txt`);
  const finalTxt = readTextIfExists(finalTxtPath, `장마감 FINAL TXT 아직 없음: ${finalTxtPath}\n`);

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

async function buildMasterAnalysis(date) {
  const strategyStatuses = {}, historyStatuses = {}, summaryStatuses = {}, buyChecks = {};
  for (const s of STRATEGIES) {
    strategyStatuses[s.id] = await getJson(PORT, `/api/us-${s.slug}/status`);
    historyStatuses[s.id] = await getJson(PORT, `/api/us-${s.slug}/history-status`);
    summaryStatuses[s.id] = await getJson(PORT, `/api/us-${s.slug}/daily-summary-status`);
    buyChecks[s.id] = await getJson(PORT, `/api/strategy-buy-check/${s.id}`);
  }

  const [server, portfolio, settings, dashboard, allOut, allErr, recentErrors] = await Promise.all([
    getJson(PORT, '/api/status'),
    getJson(PORT, '/api/portfolio-summary'),
    getJson(PORT, '/api/strategy-settings'),
    getJson(PORT, '/api/strategy-dashboard-summary'),
    filterTradingDayLog(PM2_OUT, date, /US-(CORE|FAST|VOLUME|WAVE)|SY Quant US|전략설정|데이터보정|분석자료/i),
    filterTradingDayLog(PM2_ERR, date, null),
    tailLines(PM2_ERR, 150)
  ]);

  return [
    section('US SERVER STATUS', safeJson(server)),
    section('US PORTFOLIO', safeJson(portfolio)),
    section('US STRATEGY SETTINGS', safeJson(settings)),
    section('US STRATEGY DASHBOARD SUMMARY', safeJson(dashboard)),
    section('ALL STRATEGY STATUS', safeJson(strategyStatuses)),
    section('ALL STRATEGY BUY CHECK', safeJson(buyChecks)),
    section('ALL HISTORY RECORDER STATUS', safeJson(historyStatuses)),
    section('ALL DAILY SUMMARY STATUS', safeJson(summaryStatuses)),
    section('ALL STRATEGIES : US SERVER OUT', allOut),
    section('ALL STRATEGIES : US SERVER ERROR', allErr),
    section('RECENT US ERRORS (TAIL)', recentErrors)
  ].join('');
}

function sourceFiles() {
  const common = [
    'server.js', 'analysis-download.js', 'kiwoom-us-client.js', 'portfolio-manager.js',
    'strategy-settings-store.js', 'market-calendar.js', 'us-core-market-client.js',
    'us-dashboard-activity-store.js', 'us-core-data-safety-patch.js', 'us-core-diagnostics.js'
  ];
  const strategyFiles = STRATEGIES.flatMap(s => [
    `us-${s.slug}-strategy.js`, `us-${s.slug}-virtual-tracker.js`,
    `us-${s.slug}-history-store.js`, `us-${s.slug}-daily-summary.js`,
    `us-${s.slug}-exit-simulator.js`
  ]);
  return [...common, ...strategyFiles];
}

function addRawFiles(entries, date) {
  const day = date.replace(/-/g, '');
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
      entries.push({ name: target, data: fs.readFileSync(source), mtime: fs.statSync(source).mtime });
    }
  }
}

async function createPackage(date) {
  const day = date.replace(/-/g, '');
  const entries = [];

  // API/진단 부하가 한꺼번에 겹치지 않도록 전략별로 순차 수집한다.
  for (const strategy of STRATEGIES) {
    entries.push({ name: `analysis/syquant-us-${strategy.slug}-${day}-analysis.txt`, data: await buildStrategyAnalysis(strategy, date) });
    entries.push({ name: `analysis/syquant-us-${strategy.slug}-result-${day}-analysis.txt`, data: await buildStrategyResultAnalysis(strategy, date) });
  }

  entries.push({ name: `analysis/syquant-us-master-${day}-analysis.txt`, data: await buildMasterAnalysis(date) });
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
    safety: { secretsIncluded: false, envIncluded: false, tokenIncluded: false },
    notes: [
      'CORE/FAST/VOLUME/WAVE를 전략별로 분리 수집.',
      'PM2 로그는 America/New_York 거래일 기준으로 판정하여 UTC 자정 경계 누락 방지.',
      'MASTER 분석 파일에 4전략 전체 로그를 다시 포함하여 개별 필터 누락 보완.',
      'exit simulator가 존재하면 요청 date를 명시적으로 전달.',
      'history/virtual trades/summary 원본 파일도 존재하면 raw/에 포함.',
      '.env/token/인증정보는 포함하지 않음.'
    ],
    analysisFiles: entries.filter(x => x.name.startsWith('analysis/')).map(x => x.name),
    rawFiles: entries.filter(x => x.name.startsWith('raw/')).map(x => x.name),
    sourceFiles: entries.filter(x => x.name.startsWith('source/')).map(x => x.name)
  };
  entries.unshift({ name: 'manifest.json', data: safeJson(manifest) + '\n' });
  return { fileName: `syquant-US-ALL-${day}.zip`, buffer: buildZip(entries) };
}

module.exports = function installUsAnalysisRoutes(app) {
  if (!app || typeof app.get !== 'function') throw new Error('Express app이 필요합니다.');

  app.get('/api/analysis/status', async (req, res) => {
    try {
      const strategies = {};
      for (const s of STRATEGIES) strategies[s.id] = await getJson(PORT, `/api/us-${s.slug}/status`);
      res.json({ ok: true, market: 'US', date: dateKey(TZ), time: timeHHMM(TZ), server: await getJson(PORT, '/api/status'), strategies });
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

  console.log('[분석자료] US 4전략 ZIP 다운로드 API 활성화 /api/analysis/download CORE/FAST/VOLUME/WAVE');
};
