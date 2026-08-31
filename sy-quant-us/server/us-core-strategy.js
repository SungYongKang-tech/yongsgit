'use strict';

const marketClient = require('./us-core-market-client');
const kiwoom = require('./kiwoom-us-client');
const activityStore = require('./us-dashboard-activity-store');
const { marketTodayKey, isUsTradingDay } = require('./market-calendar');

const CORE_CONFIG = Object.freeze({
  observerOnly: true,
  orderSubmissionEnabled: false,
  autoScanEnabled: true,
  coreStartEt: '09:40',
  coreEndEt: '12:00',
  autoScanIntervalMs: 3 * 60 * 1000,
  analyzeCandidateCount: 8,
  candidateStoreCount: 15,
  minPrice: 10,
  maxChangeRate: 8.0,
  minOpenChangeRate: 0.5,
  minDayPositionRate: 60,
  maxDayPositionRate: 96,
  minVwapGapRate: 0.0,
  minRvol: 1.0,
  minTrendPersistence: 0.50,
  minTradeValue: 5000000,
  readyScore: 65,
  watchScore: 45,
  qqqHardBlockChangeRate: -1.0,
  qqqHardBlockVwapGapRate: -0.40,
  dailyAverageLookback: 10
});

let scanRunning = false;
let scanTimer = null;
let lastScan = {
  ok: true,
  strategy: 'CORE',
  observerOnly: true,
  status: 'WAITING',
  reason: '아직 US-CORE 후보 스캔을 실행하지 않았습니다.',
  updatedAt: null,
  market: null,
  candidates: [],
  errors: []
};

const dailyVolumeCache = new Map();

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(toNumber(value) * factor) / factor;
}

function compactDate(key) {
  return String(key || '').replace(/-/g, '');
}

function dateDaysAgo(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - Math.max(0, Math.trunc(Number(days) || 0)));
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function nyClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.hour}:${values.minute}`;
}

function clockMinutes(hhmm) {
  const [h, m] = String(hhmm || '00:00').split(':').map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

function regularSessionProgress(now = new Date()) {
  const current = clockMinutes(nyClock(now));
  const open = 9 * 60 + 30;
  const close = 16 * 60;
  if (current <= open) return 0;
  if (current >= close) return 1;
  return (current - open) / (close - open);
}

function expectedVolumeCurve(progress) {
  const p = Math.max(0.01, Math.min(1, toNumber(progress)));
  return Math.min(1, p ** 0.65);
}

function getSessionState(now = new Date()) {
  const date = marketTodayKey('US', now);
  const clock = nyClock(now);
  const tradingDay = isUsTradingDay(date);
  const regular = tradingDay && clock >= '09:30' && clock <= '16:00';
  const coreWindow = tradingDay && clock >= CORE_CONFIG.coreStartEt && clock <= CORE_CONFIG.coreEndEt;
  return {
    date,
    clockEt: clock,
    tradingDay,
    regular,
    coreWindow,
    progress: regularSessionProgress(now)
  };
}

function sortMinuteRows(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .filter(row => toNumber(row.close) > 0)
    .sort((a, b) => {
      const ak = `${String(a.businessDate || '')}${String(a.time || '').padStart(6, '0')}`;
      const bk = `${String(b.businessDate || '')}${String(b.time || '').padStart(6, '0')}`;
      return ak.localeCompare(bk);
    });
}

function latestSessionRows(rows = []) {
  const sorted = sortMinuteRows(rows);
  const latestDate = sorted.reduce(
    (latest, row) => String(row.businessDate || '') > latest ? String(row.businessDate || '') : latest,
    ''
  );
  return {
    businessDate: latestDate,
    rows: sorted.filter(row => String(row.businessDate || '') === latestDate)
  };
}

function computeMinuteMetrics(rows = []) {
  const session = latestSessionRows(rows);
  const bars = session.rows;
  if (!bars.length) {
    return {
      businessDate: session.businessDate,
      price: 0,
      open: 0,
      high: 0,
      low: 0,
      volume: 0,
      vwap: 0,
      vwapGapRate: 0,
      dayPositionRate: 0,
      trendPersistence: 0,
      barCount: 0
    };
  }

  let volume = 0;
  let pv = 0;
  let high = 0;
  let low = Number.POSITIVE_INFINITY;
  for (const bar of bars) {
    const barVolume = Math.max(0, toNumber(bar.volume));
    const typical = (toNumber(bar.high) + toNumber(bar.low) + toNumber(bar.close)) / 3;
    volume += barVolume;
    pv += typical * barVolume;
    high = Math.max(high, toNumber(bar.high), toNumber(bar.close));
    const lowCandidate = Math.min(
      toNumber(bar.low) || Number.POSITIVE_INFINITY,
      toNumber(bar.close) || Number.POSITIVE_INFINITY
    );
    low = Math.min(low, lowCandidate);
  }

  if (!Number.isFinite(low)) low = 0;
  const first = bars[0];
  const last = bars[bars.length - 1];
  const price = toNumber(last.close);
  const open = toNumber(first.open || first.close);
  const vwap = volume > 0 ? pv / volume : price;
  const vwapGapRate = vwap > 0 ? ((price - vwap) / vwap) * 100 : 0;
  const dayPositionRate = high > low ? ((price - low) / (high - low)) * 100 : 50;

  const trendBars = bars.slice(-6);
  let nonDownSteps = 0;
  let steps = 0;
  for (let i = 1; i < trendBars.length; i += 1) {
    steps += 1;
    if (toNumber(trendBars[i].close) >= toNumber(trendBars[i - 1].close)) nonDownSteps += 1;
  }
  const trendPersistence = steps > 0 ? nonDownSteps / steps : 0;

  return {
    businessDate: session.businessDate,
    price,
    open,
    high,
    low,
    volume,
    vwap: round(vwap, 4),
    vwapGapRate: round(vwapGapRate),
    dayPositionRate: round(dayPositionRate, 1),
    trendPersistence: round(trendPersistence, 2),
    barCount: bars.length
  };
}

async function getAverageDailyVolume(exchange, symbol) {
  const cacheKey = `${exchange}:${symbol}`;
  const cached = dailyVolumeCache.get(cacheKey);
  if (cached && Date.now() - cached.savedAt < 6 * 60 * 60 * 1000) return cached;

  const chart = await marketClient.getDailyChart({
    exchange,
    symbol,
    startDate: dateDaysAgo(35),
    maxPages: 1
  });
  const todayCompact = compactDate(marketTodayKey('US'));
  const volumes = chart.rows
    .filter(row => String(row.date || '') !== todayCompact)
    .map(row => toNumber(row.volume))
    .filter(value => value > 0)
    .slice(0, CORE_CONFIG.dailyAverageLookback);
  const average = volumes.length
    ? volumes.reduce((sum, value) => sum + value, 0) / volumes.length
    : 0;
  const value = { average, sampleCount: volumes.length, savedAt: Date.now() };
  dailyVolumeCache.set(cacheKey, value);
  return value;
}

function scoreMarket(qqq) {
  const change = toNumber(qqq.changeRate);
  const vwapGap = toNumber(qqq.vwapGapRate);
  let score = 0;
  if (change >= 0.6) score += 8;
  else if (change >= 0) score += 6;
  else if (change >= -0.5) score += 3;
  if (vwapGap >= 0.25) score += 7;
  else if (vwapGap >= 0) score += 5;
  else if (vwapGap >= -0.3) score += 2;
  return Math.min(15, score);
}

function scoreChange(change) {
  if (change < 0) return 0;
  if (change < 0.5) return 6;
  if (change <= 1.5) return 14;
  if (change <= 4.5) return 20;
  if (change <= 8) return 14;
  return 4;
}

function scoreDayPosition(position) {
  if (position < 40) return 0;
  if (position < 60) return 6;
  if (position <= 90) return 15;
  if (position <= 97) return 10;
  return 5;
}

function scoreVwap(gap) {
  if (gap < -0.5) return 0;
  if (gap < 0) return 6;
  if (gap < 0.2) return 12;
  if (gap <= 1.5) return 20;
  if (gap <= 3) return 12;
  return 5;
}

function scoreRvol(rvol) {
  if (rvol < 0.7) return 0;
  if (rvol < 1) return 6;
  if (rvol < 1.2) return 10;
  if (rvol < 1.5) return 13;
  return 15;
}

function scoreTrend(persistence) {
  if (persistence < 0.4) return 0;
  if (persistence < 0.5) return 4;
  if (persistence < 0.67) return 7;
  return 10;
}

function scoreLiquidity(tradeValue) {
  if (tradeValue >= 50000000) return 5;
  if (tradeValue >= 20000000) return 4;
  if (tradeValue >= 5000000) return 3;
  if (tradeValue >= 1000000) return 1;
  return 0;
}

async function getQqqState() {
  const chart = await marketClient.getMinuteChart({
    exchange: 'ND',
    symbol: 'QQQ',
    startDate: marketTodayKey('US'),
    minute: 5,
    maxPages: 2
  });
  const metrics = computeMinuteMetrics(chart.rows);
  const changeRate = metrics.open > 0
    ? ((metrics.price - metrics.open) / metrics.open) * 100
    : 0;
  const hardBlocked =
    changeRate <= CORE_CONFIG.qqqHardBlockChangeRate ||
    metrics.vwapGapRate <= CORE_CONFIG.qqqHardBlockVwapGapRate;

  return {
    symbol: 'QQQ',
    price: round(metrics.price, 4),
    changeRate: round(changeRate),
    vwap: metrics.vwap,
    vwapGapRate: metrics.vwapGapRate,
    dayPositionRate: metrics.dayPositionRate,
    businessDate: metrics.businessDate,
    hardBlocked,
    marketScore: scoreMarket({ changeRate, vwapGapRate: metrics.vwapGapRate })
  };
}

function mergeDiscoveryRows(volumeRows = [], changeRows = []) {
  const map = new Map();
  function ingest(row, sourceWeight) {
    const symbol = String(row.symbol || '').toUpperCase().trim();
    const exchange = marketClient.normalizeExchange(row.exchange);
    if (!symbol || !exchange) return;
    const key = `${exchange}:${symbol}`;
    const previous = map.get(key) || {
      exchange,
      symbol,
      name: row.name || symbol,
      price: 0,
      changeRate: 0,
      openChangeRate: 0,
      volume: 0,
      tradeValue: 0,
      open: 0,
      high: 0,
      low: 0,
      sources: [],
      discoveryWeight: 0
    };
    previous.name = row.name || previous.name;
    previous.price = toNumber(row.price) || previous.price;
    previous.changeRate = toNumber(row.changeRate) || previous.changeRate;
    previous.openChangeRate = toNumber(row.openChangeRate) || previous.openChangeRate;
    previous.volume = Math.max(previous.volume, toNumber(row.volume));
    previous.tradeValue = Math.max(previous.tradeValue, toNumber(row.tradeValue));
    previous.open = toNumber(row.open) || previous.open;
    previous.high = toNumber(row.high) || previous.high;
    previous.low = toNumber(row.low) || previous.low;
    previous.discoveryWeight += sourceWeight + Math.max(0, 20 - toNumber(row.rank));
    if (!previous.sources.includes(row.source)) previous.sources.push(row.source);
    map.set(key, previous);
  }

  volumeRows.slice(0, 30).forEach(row => ingest(row, 10));
  changeRows.slice(0, 30).forEach(row => ingest(row, 12));

  return Array.from(map.values())
    .filter(row => row.price >= CORE_CONFIG.minPrice)
    .sort((a, b) =>
      b.sources.length - a.sources.length ||
      b.discoveryWeight - a.discoveryWeight ||
      b.tradeValue - a.tradeValue ||
      b.openChangeRate - a.openChangeRate
    );
}

async function analyzeCandidate(snapshot, qqq, session) {
  const minute = await marketClient.getMinuteChart({
    exchange: snapshot.exchange,
    symbol: snapshot.symbol,
    startDate: session.date,
    minute: 5,
    maxPages: 2
  });
  const minuteMetrics = computeMinuteMetrics(minute.rows);
  const dailyVolume = await getAverageDailyVolume(snapshot.exchange, snapshot.symbol);

  const price = toNumber(snapshot.price) || minuteMetrics.price;
  const open = toNumber(snapshot.open) || minuteMetrics.open;
  const high = Math.max(toNumber(snapshot.high), minuteMetrics.high);
  const lowSnapshot = toNumber(snapshot.low);
  const low = lowSnapshot > 0 && minuteMetrics.low > 0
    ? Math.min(lowSnapshot, minuteMetrics.low)
    : lowSnapshot || minuteMetrics.low;
  const openChangeRate = toNumber(snapshot.openChangeRate) ||
    (open > 0 ? ((price - open) / open) * 100 : 0);
  const dayPositionRate = high > low
    ? ((price - low) / (high - low)) * 100
    : minuteMetrics.dayPositionRate;
  const volume = Math.max(toNumber(snapshot.volume), minuteMetrics.volume);
  const tradeValue = Math.max(toNumber(snapshot.tradeValue), price * volume);
  const curve = expectedVolumeCurve(session.progress);
  const expectedVolume = dailyVolume.average > 0 ? dailyVolume.average * curve : 0;
  const rvol = expectedVolume > 0 ? volume / expectedVolume : 0;
  const vwapGapRate = minuteMetrics.vwap > 0
    ? ((price - minuteMetrics.vwap) / minuteMetrics.vwap) * 100
    : 0;

  const components = {
    market: scoreMarket(qqq),
    change: scoreChange(openChangeRate),
    dayPosition: scoreDayPosition(dayPositionRate),
    vwap: scoreVwap(vwapGapRate),
    rvol: scoreRvol(rvol),
    trend: scoreTrend(minuteMetrics.trendPersistence),
    liquidity: scoreLiquidity(tradeValue)
  };
  const score = Object.values(components).reduce((sum, value) => sum + value, 0);

  const blocks = [];
  if (qqq.hardBlocked) blocks.push('QQQ 약세');
  if (openChangeRate < CORE_CONFIG.minOpenChangeRate) blocks.push('시가대비 상승 부족');
  if (openChangeRate > CORE_CONFIG.maxChangeRate) blocks.push('상승 과열');
  if (dayPositionRate < CORE_CONFIG.minDayPositionRate) blocks.push('당일 위치 낮음');
  if (dayPositionRate > CORE_CONFIG.maxDayPositionRate) blocks.push('고점 추격');
  if (vwapGapRate < CORE_CONFIG.minVwapGapRate) blocks.push('VWAP 아래');
  if (rvol > 0 && rvol < CORE_CONFIG.minRvol) blocks.push('RVOL 부족');
  if (minuteMetrics.trendPersistence < CORE_CONFIG.minTrendPersistence) blocks.push('단기 추세 약함');
  if (tradeValue < CORE_CONFIG.minTradeValue) blocks.push('거래대금 부족');

  const dataFresh = minuteMetrics.businessDate === compactDate(session.date);
  if (!dataFresh) blocks.push('당일 분봉 없음');

  let status = 'OBSERVE';
  if (!blocks.length && score >= CORE_CONFIG.readyScore) status = 'READY';
  else if (score >= CORE_CONFIG.watchScore) status = 'WATCH';

  const reasonParts = [
    `VWAP ${vwapGapRate >= 0 ? '+' : ''}${round(vwapGapRate)}%`,
    `RVOL ${round(rvol)}x`,
    `위치 ${round(dayPositionRate, 0)}%`,
    `추세 ${round(minuteMetrics.trendPersistence * 100, 0)}%`,
    `QQQ ${qqq.changeRate >= 0 ? '+' : ''}${round(qqq.changeRate)}%`
  ];
  if (blocks.length) reasonParts.push(blocks.slice(0, 2).join('/'));
  reasonParts.push('관찰전용·주문OFF');

  return {
    strategy: 'CORE',
    exchange: snapshot.exchange,
    symbol: snapshot.symbol,
    name: snapshot.name || snapshot.symbol,
    status,
    score: round(score, 0),
    price: round(price, 4),
    changeRate: round(openChangeRate),
    dayPositionRate: round(dayPositionRate, 1),
    vwap: minuteMetrics.vwap,
    vwapGapRate: round(vwapGapRate),
    rvol: round(rvol),
    tradeValue: round(tradeValue, 0),
    trendPersistence: minuteMetrics.trendPersistence,
    marketScore: qqq.marketScore,
    qqqChangeRate: qqq.changeRate,
    qqqVwapGapRate: qqq.vwapGapRate,
    averageDailyVolume: round(dailyVolume.average, 0),
    dailyVolumeSampleCount: dailyVolume.sampleCount,
    sources: snapshot.sources,
    blocks,
    components,
    reason: reasonParts.join(' · '),
    updatedAt: new Date().toISOString()
  };
}

async function discoverSnapshots() {
  const volume = await marketClient.getTodayVolumeTop({ maxPages: 1 });
  const change = await marketClient.getChangeRateTopVsOpen({ maxPages: 1 });
  return mergeDiscoveryRows(volume.rows, change.rows);
}

async function runCoreScan({ force = false } = {}) {
  if (scanRunning) {
    return { ...lastScan, ok: false, status: 'BUSY', reason: 'US-CORE 스캔이 이미 실행 중입니다.' };
  }

  const session = getSessionState();
  if (!force && !session.coreWindow) {
    lastScan = {
      ...lastScan,
      ok: true,
      strategy: 'CORE',
      observerOnly: true,
      status: 'WAITING',
      reason: session.tradingDay
        ? `US-CORE 관찰시간 대기 (${CORE_CONFIG.coreStartEt}~${CORE_CONFIG.coreEndEt} ET)`
        : '미국시장 휴장일',
      session,
      updatedAt: new Date().toISOString()
    };
    return lastScan;
  }

  scanRunning = true;
  const startedAt = Date.now();
  const errors = [];
  try {
    const qqq = await getQqqState();
    const snapshots = await discoverSnapshots();
    const selected = snapshots.slice(0, CORE_CONFIG.analyzeCandidateCount);
    const candidates = [];

    for (const snapshot of selected) {
      try {
        const row = await analyzeCandidate(snapshot, qqq, session);
        candidates.push(row);
      } catch (err) {
        errors.push(`${snapshot.symbol}: ${err.message}`);
      }
    }

    const statusRank = value => value === 'READY' ? 3 : value === 'WATCH' ? 2 : 1;
    candidates.sort((a, b) =>
      statusRank(b.status) - statusRank(a.status) ||
      b.score - a.score
    );

    const stored = activityStore.setCandidates(
      'CORE',
      candidates.slice(0, CORE_CONFIG.candidateStoreCount)
    );

    lastScan = {
      ok: true,
      strategy: 'CORE',
      observerOnly: true,
      orderSubmissionEnabled: false,
      implemented: false,
      status: 'OBSERVING',
      reason: '후보 탐색·점수화만 수행합니다. 주문 코드는 연결되어 있지 않습니다.',
      session,
      market: qqq,
      discoveredCount: snapshots.length,
      analyzedCount: selected.length,
      candidateCount: stored.length,
      readyCount: stored.filter(row => row.status === 'READY').length,
      watchCount: stored.filter(row => row.status === 'WATCH').length,
      candidates: stored,
      errors,
      elapsedMs: Date.now() - startedAt,
      updatedAt: new Date().toISOString()
    };

    console.log(
      '[US-CORE 관찰]',
      `후보 ${lastScan.candidateCount} / READY ${lastScan.readyCount} / WATCH ${lastScan.watchCount}`,
      `QQQ ${qqq.changeRate >= 0 ? '+' : ''}${qqq.changeRate}%`,
      '주문OFF'
    );
    return lastScan;
  } catch (err) {
    lastScan = {
      ok: false,
      strategy: 'CORE',
      observerOnly: true,
      orderSubmissionEnabled: false,
      implemented: false,
      status: 'ERROR',
      reason: err.message,
      session,
      errors: [err.message],
      elapsedMs: Date.now() - startedAt,
      updatedAt: new Date().toISOString()
    };
    console.error('[US-CORE 관찰 오류]', err.message);
    return lastScan;
  } finally {
    scanRunning = false;
  }
}

async function analyzeSymbol({ exchange, symbol } = {}) {
  const session = getSessionState();
  const qqq = await getQqqState();
  const normalizedExchange = marketClient.normalizeExchange(exchange);
  const normalizedSymbol = String(symbol || '').toUpperCase().trim();
  if (!normalizedExchange || !normalizedSymbol) {
    throw new Error('exchange(NA/ND/NY)와 symbol이 필요합니다.');
  }

  const raw = await kiwoom.getQuote(normalizedExchange, normalizedSymbol);
  const snapshot = {
    exchange: normalizedExchange,
    symbol: normalizedSymbol,
    name: String(raw.stk_nm || raw.stk_enm || normalizedSymbol),
    price: marketClient.toNumber(raw.cur_prc),
    open: marketClient.toNumber(raw.open_pric),
    high: marketClient.toNumber(raw.high_pric),
    low: marketClient.toNumber(raw.low_pric),
    volume: marketClient.toNumber(raw.acc_trde_qty),
    changeRate: marketClient.toNumber(raw.flu_rt),
    sources: ['MANUAL_PREVIEW']
  };

  return {
    ok: true,
    observerOnly: true,
    orderSubmissionEnabled: false,
    session,
    market: qqq,
    analysis: await analyzeCandidate(snapshot, qqq, session)
  };
}

function getCoreStatus() {
  return {
    ok: true,
    strategy: 'CORE',
    observerOnly: true,
    orderSubmissionEnabled: false,
    implemented: false,
    scanRunning,
    config: CORE_CONFIG,
    session: getSessionState(),
    lastScan
  };
}

function startCoreObserver() {
  if (scanTimer) return scanTimer;
  scanTimer = setInterval(() => {
    runCoreScan().catch(err => console.error('[US-CORE 자동관찰 오류]', err.message));
  }, CORE_CONFIG.autoScanIntervalMs);
  if (typeof scanTimer.unref === 'function') scanTimer.unref();

  const initialTimer = setTimeout(() => {
    runCoreScan().catch(err => console.error('[US-CORE 초기관찰 오류]', err.message));
  }, 15 * 1000);
  if (typeof initialTimer.unref === 'function') initialTimer.unref();

  console.log(
    '[US-CORE]',
    `관찰모드 시작 ${CORE_CONFIG.coreStartEt}~${CORE_CONFIG.coreEndEt} ET /`,
    '주문 기능 없음 / implemented=false'
  );
  return scanTimer;
}

module.exports = {
  CORE_CONFIG,
  startCoreObserver,
  runCoreScan,
  analyzeSymbol,
  getCoreStatus,
  computeMinuteMetrics,
  getSessionState
};
