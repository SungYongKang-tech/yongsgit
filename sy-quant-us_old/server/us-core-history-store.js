'use strict';

const fs = require('fs');
const path = require('path');
const activityStore = require('./us-dashboard-activity-store');
const usCore = require('./us-core-strategy');

const HISTORY_DIR = path.join(__dirname, 'us-core-history');
const POLL_INTERVAL_MS = 15000;
const MAX_SCANS_PER_DAY = 300;

let timer = null;
let lastRecordedScanAt = null;
let lastCheckAt = null;
let lastError = null;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function ensureDir() {
  fs.mkdirSync(HISTORY_DIR, { recursive: true });
}

function validDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function filePath(dateKey) {
  if (!validDateKey(dateKey)) throw new Error('date must be YYYY-MM-DD');
  return path.join(HISTORY_DIR, `us-core-history-${dateKey.replace(/-/g, '')}.json`);
}

function emptyDay(dateKey) {
  return {
    version: 1,
    strategy: 'CORE',
    market: 'US',
    observerOnly: true,
    actualOrderEnabled: false,
    tradingDate: dateKey,
    scans: [],
    updatedAt: null
  };
}

function readDay(dateKey) {
  const target = filePath(dateKey);
  if (!fs.existsSync(target)) return emptyDay(dateKey);
  try {
    const parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
    return {
      ...emptyDay(dateKey),
      ...parsed,
      scans: Array.isArray(parsed.scans) ? parsed.scans : []
    };
  } catch (err) {
    throw new Error(`US-CORE history read failed: ${err.message}`);
  }
}

function writeDay(dateKey, data) {
  ensureDir();
  const target = filePath(dateKey);
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(temp, target);
}

function normalizeCandidate(item = {}) {
  return {
    exchange: String(item.exchange || ''),
    symbol: String(item.symbol || '').toUpperCase(),
    name: String(item.name || ''),
    status: String(item.status || 'OBSERVE'),
    score: Number(item.score || 0),
    price: Number(item.price || 0),
    changeRate: Number(item.changeRate || 0),
    vwap: Number(item.vwap || 0),
    vwapGapRate: Number(item.vwapGapRate || 0),
    rvol: Number(item.rvol || 0),
    dayPositionRate: Number(item.dayPositionRate || 0),
    trendPersistence: Number(item.trendPersistence || 0),
    tradeValue: Number(item.tradeValue || 0),
    marketScore: Number(item.marketScore || 0),
    qqqChangeRate: Number(item.qqqChangeRate || 0),
    qqqVwapGapRate: Number(item.qqqVwapGapRate || 0),
    sources: Array.isArray(item.sources) ? item.sources.map(String) : [],
    blocks: Array.isArray(item.blocks) ? item.blocks.map(String) : [],
    components: item.components && typeof item.components === 'object' ? clone(item.components) : {},
    reason: String(item.reason || ''),
    updatedAt: item.updatedAt || null
  };
}

function buildSnapshot(coreStatus, activity) {
  const scan = coreStatus?.lastScan || {};
  const session = scan.session || coreStatus?.session || {};
  const candidates = Array.isArray(activity?.candidates)
    ? activity.candidates.filter(item => String(item.strategy || '').toUpperCase() === 'CORE')
    : [];

  return {
    scanAt: scan.updatedAt,
    tradingDate: session.date,
    clockEt: session.clockEt || null,
    discoveredCount: Number(scan.discoveredCount || 0),
    analyzedCount: Number(scan.analyzedCount || 0),
    candidateCount: Number(scan.candidateCount ?? candidates.length),
    readyCount: Number(scan.readyCount || 0),
    watchCount: Number(scan.watchCount || 0),
    market: scan.market ? clone(scan.market) : null,
    candidates: candidates.map(normalizeCandidate),
    errors: Array.isArray(scan.errors) ? scan.errors.map(String) : [],
    elapsedMs: Number(scan.elapsedMs || 0),
    observerOnly: true,
    actualOrderEnabled: false
  };
}

function recordLatestScan() {
  lastCheckAt = new Date().toISOString();
  try {
    const coreStatus = usCore.getCoreStatus();
    const scan = coreStatus?.lastScan || {};
    if (scan.status !== 'OBSERVING' || !scan.updatedAt) return { recorded: false, reason: 'NO_NEW_SCAN' };
    if (scan.updatedAt === lastRecordedScanAt) return { recorded: false, reason: 'ALREADY_RECORDED' };

    const session = scan.session || coreStatus.session || {};
    const dateKey = session.date;
    if (!validDateKey(dateKey)) return { recorded: false, reason: 'INVALID_TRADING_DATE' };

    const activity = activityStore.getDashboardActivity();
    const snapshot = buildSnapshot(coreStatus, activity);
    const day = readDay(dateKey);

    if (!day.scans.some(item => item.scanAt === snapshot.scanAt)) {
      day.scans.push(snapshot);
      if (day.scans.length > MAX_SCANS_PER_DAY) day.scans = day.scans.slice(-MAX_SCANS_PER_DAY);
      day.updatedAt = snapshot.scanAt;
      writeDay(dateKey, day);
    }

    lastRecordedScanAt = scan.updatedAt;
    lastError = null;
    console.log(
      '[US-CORE 이력]',
      `${dateKey} ${session.clockEt || ''}`,
      `후보 ${snapshot.candidateCount} / READY ${snapshot.readyCount} / WATCH ${snapshot.watchCount}`,
      '저장완료'
    );
    return { recorded: true, snapshot };
  } catch (err) {
    lastError = err.message;
    console.error('[US-CORE 이력 오류]', err.message);
    return { recorded: false, reason: 'ERROR', error: err.message };
  }
}

function summarizeDay(dateKey) {
  const day = readDay(dateKey);
  const unique = new Map();
  for (const scan of day.scans) {
    for (const item of Array.isArray(scan.candidates) ? scan.candidates : []) {
      const key = `${item.exchange}:${item.symbol}`;
      const prev = unique.get(key) || {
        exchange: item.exchange,
        symbol: item.symbol,
        name: item.name,
        firstSeenAt: scan.scanAt,
        lastSeenAt: scan.scanAt,
        scanCount: 0,
        readyCount: 0,
        watchCount: 0,
        maxScore: 0,
        latestStatus: item.status,
        latestScore: item.score
      };
      prev.lastSeenAt = scan.scanAt;
      prev.scanCount += 1;
      if (item.status === 'READY') prev.readyCount += 1;
      if (item.status === 'WATCH') prev.watchCount += 1;
      prev.maxScore = Math.max(prev.maxScore, Number(item.score || 0));
      prev.latestStatus = item.status;
      prev.latestScore = Number(item.score || 0);
      unique.set(key, prev);
    }
  }
  return {
    tradingDate: dateKey,
    scanCount: day.scans.length,
    uniqueCandidateCount: unique.size,
    candidates: Array.from(unique.values()).sort((a, b) => b.maxScore - a.maxScore),
    updatedAt: day.updatedAt
  };
}

function getHistory(dateKey) {
  const status = usCore.getCoreStatus();
  const resolved = validDateKey(dateKey) ? dateKey : status.session.date;
  return {
    ok: true,
    strategy: 'CORE',
    observerOnly: true,
    actualOrderEnabled: false,
    file: filePath(resolved),
    summary: summarizeDay(resolved),
    day: readDay(resolved)
  };
}

function getStatus() {
  return {
    ok: true,
    strategy: 'CORE',
    historyEnabled: true,
    actualOrderEnabled: false,
    polling: Boolean(timer),
    pollIntervalMs: POLL_INTERVAL_MS,
    historyDir: HISTORY_DIR,
    lastRecordedScanAt,
    lastCheckAt,
    lastError
  };
}

function startHistoryRecorder() {
  if (timer) return timer;
  ensureDir();
  timer = setInterval(recordLatestScan, POLL_INTERVAL_MS);
  if (typeof timer.unref === 'function') timer.unref();
  const initial = setTimeout(recordLatestScan, 5000);
  if (typeof initial.unref === 'function') initial.unref();
  console.log('[US-CORE 이력] 날짜별 후보 전체기록 시작 / 실제주문 영향 없음');
  return timer;
}

module.exports = {
  HISTORY_DIR,
  startHistoryRecorder,
  recordLatestScan,
  getHistory,
  getStatus,
  summarizeDay
};
