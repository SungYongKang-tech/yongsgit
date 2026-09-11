'use strict';

const fs = require('fs');
const path = require('path');
const kiwoom = require('./kiwoom-us-client');
const activityStore = require('./us-dashboard-activity-store');
const { marketTodayKey, dateKeyInTimeZone, isUsTradingDay } = require('./market-calendar');

const DATA_FILE = path.join(__dirname, 'us-core-virtual-trades.json');
const TRACK_INTERVAL_MS = 60 * 1000;
const PRICE_UPDATE_INTERVAL_MS = 5 * 60 * 1000;
const READY_MAX_AGE_MS = 10 * 60 * 1000;
const SESSION_CLOSE_ET = '16:00';
const TRACK_END_ET = '16:15';
const MILESTONE_MINUTES = [10, 30, 60];
const MAX_POSITIONS = 500;
const MAX_SAMPLES_PER_POSITION = 100;

let timer = null;
let tickRunning = false;
let lastTickAt = null;
let lastPriceUpdateAt = 0;
let lastError = null;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  const n = Number(String(value).replace(/,/g, '').replace(/\+/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(toNumber(value) * factor) / factor;
}

function returnRate(entryPrice, price) {
  const entry = toNumber(entryPrice);
  const current = toNumber(price);
  return entry > 0 ? ((current - entry) / entry) * 100 : 0;
}

function nyClock(now = new Date(), includeSeconds = false) {
  const options = {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  };
  if (includeSeconds) options.second = '2-digit';
  const parts = new Intl.DateTimeFormat('en-US', options).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return includeSeconds
    ? `${values.hour}:${values.minute}:${values.second}`
    : `${values.hour}:${values.minute}`;
}

function emptyState() {
  return {
    version: 1,
    positions: [],
    updatedAt: null
  };
}

function readState() {
  if (!fs.existsSync(DATA_FILE)) return emptyState();
  try {
    const text = fs.readFileSync(DATA_FILE, 'utf8');
    if (!text.trim()) return emptyState();
    const parsed = JSON.parse(text);
    return {
      version: 1,
      positions: Array.isArray(parsed.positions) ? parsed.positions : [],
      updatedAt: parsed.updatedAt || null
    };
  } catch (err) {
    console.error('[US-CORE 가상추적] 파일 읽기 실패:', err.message);
    return emptyState();
  }
}

function writeState(state) {
  const temp = `${DATA_FILE}.${process.pid}.${Date.now()}.tmp`;
  const payload = JSON.stringify(state, null, 2);
  try {
    fs.writeFileSync(temp, payload, 'utf8');
    fs.renameSync(temp, DATA_FILE);
  } finally {
    if (fs.existsSync(temp)) {
      try { fs.unlinkSync(temp); } catch (_) {}
    }
  }
}

function positionKey(marketDate, exchange, symbol) {
  return `CORE:${marketDate}:${String(exchange || '').toUpperCase()}:${String(symbol || '').toUpperCase()}`;
}

function makeMilestones() {
  return Object.fromEntries(MILESTONE_MINUTES.map(minutes => [
    String(minutes),
    {
      minutes,
      capturedAt: null,
      price: null,
      returnRate: null
    }
  ]));
}

function candidateAgeMs(candidate, now = new Date()) {
  const ts = new Date(candidate?.updatedAt || 0).getTime();
  if (!Number.isFinite(ts) || ts <= 0) return Number.POSITIVE_INFINITY;
  return Math.max(0, now.getTime() - ts);
}

function isCandidateFromMarketDate(candidate, marketDate) {
  if (!candidate?.updatedAt) return false;
  const date = new Date(candidate.updatedAt);
  if (Number.isNaN(date.getTime())) return false;
  return dateKeyInTimeZone(date, 'America/New_York') === marketDate;
}

function registerReadyCandidates(now = new Date()) {
  const marketDate = marketTodayKey('US', now);
  const clock = nyClock(now);
  if (!isUsTradingDay(marketDate) || clock < '09:40' || clock > '12:00') return [];

  const activity = activityStore.getDashboardActivity();
  const readyRows = (Array.isArray(activity.candidates) ? activity.candidates : [])
    .filter(row => String(row.strategy || '').toUpperCase() === 'CORE')
    .filter(row => String(row.status || '').toUpperCase() === 'READY')
    .filter(row => candidateAgeMs(row, now) <= READY_MAX_AGE_MS)
    .filter(row => isCandidateFromMarketDate(row, marketDate))
    .filter(row => String(row.exchange || '').toUpperCase())
    .filter(row => toNumber(row.price) > 0);

  if (!readyRows.length) return [];

  const state = readState();
  const existingKeys = new Set(state.positions.map(row => String(row.id || '')));
  const created = [];

  for (const row of readyRows) {
    const exchange = String(row.exchange || '').toUpperCase();
    const symbol = String(row.symbol || '').toUpperCase();
    if (!exchange || !symbol) continue;

    const id = positionKey(marketDate, exchange, symbol);
    if (existingKeys.has(id)) continue;

    const entryPrice = toNumber(row.price);
    const entryAt = now.toISOString();
    const position = {
      id,
      strategy: 'CORE',
      marketDate,
      exchange,
      symbol,
      name: String(row.name || symbol),
      status: 'OPEN',
      virtualOnly: true,
      entryAt,
      entryClockEt: nyClock(now, true),
      entryPrice: round(entryPrice, 4),
      entryScore: round(row.score, 0),
      entrySignal: {
        changeRate: round(row.changeRate),
        dayPositionRate: round(row.dayPositionRate, 1),
        vwap: round(row.vwap, 4),
        vwapGapRate: round(row.vwapGapRate),
        rvol: round(row.rvol),
        tradeValue: round(row.tradeValue, 0),
        trendPersistence: round(row.trendPersistence, 2),
        qqqChangeRate: round(row.qqqChangeRate),
        qqqVwapGapRate: round(row.qqqVwapGapRate),
        reason: String(row.reason || '')
      },
      lastPrice: round(entryPrice, 4),
      currentReturnRate: 0,
      sampledMaxReturnRate: 0,
      sampledMaxPrice: round(entryPrice, 4),
      sampledMaxAt: entryAt,
      sampledMinReturnRate: 0,
      sampledMinPrice: round(entryPrice, 4),
      sampledMinAt: entryAt,
      milestones: makeMilestones(),
      sampleCount: 1,
      samples: [{ at: entryAt, price: round(entryPrice, 4), returnRate: 0 }],
      lastTrackedAt: entryAt,
      closedAt: null,
      closePrice: null,
      closeReturnRate: null,
      closeReason: null
    };

    state.positions.push(position);
    existingKeys.add(id);
    created.push(clone(position));
  }

  if (created.length) {
    if (state.positions.length > MAX_POSITIONS) {
      state.positions = state.positions.slice(-MAX_POSITIONS);
    }
    state.updatedAt = now.toISOString();
    writeState(state);
    console.log(
      '[US-CORE 가상진입]',
      created.map(row => `${row.symbol} $${row.entryPrice} / ${row.entryScore}점`).join(' | '),
      '/ 실제주문 없음'
    );
  }

  return created;
}

function captureMilestones(position, now, price, rate) {
  const entryMs = new Date(position.entryAt || 0).getTime();
  if (!Number.isFinite(entryMs) || entryMs <= 0) return;
  const elapsedMinutes = (now.getTime() - entryMs) / 60000;

  for (const minutes of MILESTONE_MINUTES) {
    const key = String(minutes);
    const milestone = position.milestones?.[key];
    if (!milestone || milestone.capturedAt || elapsedMinutes < minutes) continue;
    milestone.capturedAt = now.toISOString();
    milestone.price = round(price, 4);
    milestone.returnRate = round(rate);
  }
}

function applyPrice(position, now, price) {
  const currentPrice = toNumber(price);
  if (currentPrice <= 0) return false;

  const rate = returnRate(position.entryPrice, currentPrice);
  const at = now.toISOString();
  position.lastPrice = round(currentPrice, 4);
  position.currentReturnRate = round(rate);
  position.lastTrackedAt = at;

  if (rate > toNumber(position.sampledMaxReturnRate)) {
    position.sampledMaxReturnRate = round(rate);
    position.sampledMaxPrice = round(currentPrice, 4);
    position.sampledMaxAt = at;
  }
  if (rate < toNumber(position.sampledMinReturnRate)) {
    position.sampledMinReturnRate = round(rate);
    position.sampledMinPrice = round(currentPrice, 4);
    position.sampledMinAt = at;
  }

  if (!position.milestones || typeof position.milestones !== 'object') {
    position.milestones = makeMilestones();
  }
  captureMilestones(position, now, currentPrice, rate);

  if (!Array.isArray(position.samples)) position.samples = [];
  position.samples.push({ at, price: round(currentPrice, 4), returnRate: round(rate) });
  if (position.samples.length > MAX_SAMPLES_PER_POSITION) {
    position.samples = position.samples.slice(-MAX_SAMPLES_PER_POSITION);
  }
  position.sampleCount = toNumber(position.sampleCount) + 1;
  return true;
}

async function updateOpenPositions(now = new Date()) {
  const marketDate = marketTodayKey('US', now);
  const clock = nyClock(now);
  const tradingDay = isUsTradingDay(marketDate);
  if (!tradingDay || clock < '09:30' || clock > TRACK_END_ET) {
    return { updated: 0, closed: 0, errors: [] };
  }

  const state = readState();
  const openRows = state.positions.filter(row =>
    row.status === 'OPEN' && row.marketDate === marketDate
  );
  if (!openRows.length) return { updated: 0, closed: 0, errors: [] };

  let updated = 0;
  let closed = 0;
  const errors = [];

  for (const position of openRows) {
    try {
      const quote = await kiwoom.getQuote(position.exchange, position.symbol);
      const price = toNumber(quote.cur_prc);
      if (price <= 0) throw new Error('현재가 0');
      if (applyPrice(position, now, price)) updated += 1;

      if (clock >= SESSION_CLOSE_ET) {
        position.status = 'CLOSED';
        position.closedAt = now.toISOString();
        position.closePrice = round(price, 4);
        position.closeReturnRate = round(returnRate(position.entryPrice, price));
        position.closeReason = 'US_REGULAR_SESSION_END';
        closed += 1;
      }
    } catch (err) {
      errors.push(`${position.symbol}: ${err.message}`);
    }
  }

  if (updated || closed || errors.length) {
    state.updatedAt = now.toISOString();
    writeState(state);
  }

  if (closed) {
    console.log('[US-CORE 가상추적] 정규장 종료 가상포지션', `${closed}건 종료`);
  }
  return { updated, closed, errors };
}

function markStalePreviousSessions(now = new Date()) {
  const today = marketTodayKey('US', now);
  const state = readState();
  let changed = 0;
  for (const position of state.positions) {
    if (position.status === 'OPEN' && String(position.marketDate || '') < today) {
      position.status = 'CLOSE_REVIEW';
      position.closeReason = 'TRACKER_MISSED_SESSION_CLOSE';
      position.needsCloseReview = true;
      changed += 1;
    }
  }
  if (changed) {
    state.updatedAt = now.toISOString();
    writeState(state);
    console.warn('[US-CORE 가상추적]', `전일 미종료 ${changed}건 CLOSE_REVIEW 처리`);
  }
  return changed;
}

async function tick({ forcePriceUpdate = false } = {}) {
  if (tickRunning) return getStatus();
  tickRunning = true;
  const now = new Date();
  try {
    markStalePreviousSessions(now);
    const created = registerReadyCandidates(now);
    const due = forcePriceUpdate || Date.now() - lastPriceUpdateAt >= PRICE_UPDATE_INTERVAL_MS;
    let tracking = { updated: 0, closed: 0, errors: [] };
    if (due) {
      tracking = await updateOpenPositions(now);
      lastPriceUpdateAt = Date.now();
    }
    lastTickAt = now.toISOString();
    lastError = tracking.errors.length ? tracking.errors.join(' | ') : null;
    return { ...getStatus(), createdCount: created.length, tracking };
  } catch (err) {
    lastTickAt = now.toISOString();
    lastError = err.message;
    console.error('[US-CORE 가상추적 오류]', err.message);
    return { ...getStatus(), ok: false, error: err.message };
  } finally {
    tickRunning = false;
  }
}

function getStatus({ includePositions = false } = {}) {
  const state = readState();
  const positions = state.positions.slice().sort((a, b) =>
    String(b.entryAt || '').localeCompare(String(a.entryAt || ''))
  );
  const open = positions.filter(row => row.status === 'OPEN');
  const closed = positions.filter(row => row.status === 'CLOSED');
  const review = positions.filter(row => row.status === 'CLOSE_REVIEW');
  const payload = {
    ok: true,
    strategy: 'CORE',
    virtualOnly: true,
    actualOrderEnabled: false,
    trackerRunning: Boolean(timer),
    tickRunning,
    trackIntervalMs: TRACK_INTERVAL_MS,
    priceUpdateIntervalMs: PRICE_UPDATE_INTERVAL_MS,
    milestoneMinutes: MILESTONE_MINUTES,
    lastTickAt,
    lastError,
    totalCount: positions.length,
    openCount: open.length,
    closedCount: closed.length,
    closeReviewCount: review.length,
    updatedAt: state.updatedAt
  };
  if (includePositions) payload.positions = clone(positions.slice(0, 200));
  return payload;
}

function startVirtualTracker() {
  if (timer) return timer;
  timer = setInterval(() => {
    tick().catch(err => console.error('[US-CORE 가상추적 타이머 오류]', err.message));
  }, TRACK_INTERVAL_MS);
  if (typeof timer.unref === 'function') timer.unref();

  const initialTimer = setTimeout(() => {
    tick().catch(err => console.error('[US-CORE 가상추적 초기 오류]', err.message));
  }, 30 * 1000);
  if (typeof initialTimer.unref === 'function') initialTimer.unref();

  console.log(
    '[US-CORE 가상추적] 시작 / READY 최초 1회 가상진입 / 5분 가격추적 / 실제주문 없음'
  );
  return timer;
}

module.exports = {
  DATA_FILE,
  startVirtualTracker,
  tick,
  getStatus,
  registerReadyCandidates,
  updateOpenPositions
};
