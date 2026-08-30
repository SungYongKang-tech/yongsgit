'use strict';

const fs = require('fs');
const path = require('path');
const { getRecentTradingDates, dateKeyInTimeZone } = require('./market-calendar');

const DATA_FILE = path.join(__dirname, 'us-dashboard-activity.json');
const STRATEGY_META = {
  OPEN: { label: 'US-OPEN', icon: '🚀' },
  CORE: { label: 'US-CORE', icon: '🛡️' },
  VOLUME: { label: 'US-VOLUME', icon: '📊' },
  WAVE: { label: 'US-WAVE', icon: '🌊' },
  FAST: { label: 'US-FAST', icon: '⚡' }
};
const STRATEGY_IDS = Object.keys(STRATEGY_META);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function emptyState() {
  return { version: 1, candidates: [], sells: [], updatedAt: null };
}

function readState() {
  if (!fs.existsSync(DATA_FILE)) return emptyState();
  try {
    const text = fs.readFileSync(DATA_FILE, 'utf8');
    if (!text.trim()) return emptyState();
    const parsed = JSON.parse(text);
    return {
      version: 1,
      candidates: Array.isArray(parsed.candidates) ? parsed.candidates : [],
      sells: Array.isArray(parsed.sells) ? parsed.sells : [],
      updatedAt: parsed.updatedAt || null
    };
  } catch (err) {
    console.error('[US 대시보드 활동] 읽기 실패:', err.message);
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

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function usMarketDateKey(value) {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return null;
  return dateKeyInTimeZone(d, 'America/New_York');
}

function last7TradingDates() {
  return getRecentTradingDates('US', 7);
}

function getRecent7DayRealized(state = readState()) {
  const dates = last7TradingDates();
  const dateSet = new Set(dates.map(item => item.key));
  const matrix = {};
  STRATEGY_IDS.forEach(id => {
    matrix[id] = Object.fromEntries(dates.map(item => [item.key, 0]));
  });

  for (const sell of state.sells) {
    const id = String(sell.strategy || '').toUpperCase();
    if (!matrix[id]) continue;
    const key = usMarketDateKey(sell.soldAt || sell.time || sell.createdAt);
    if (!key || !dateSet.has(key)) continue;
    matrix[id][key] += toNumber(sell.realizedProfit);
  }

  const rows = STRATEGY_IDS.map(id => ({
    id,
    label: STRATEGY_META[id].label,
    icon: STRATEGY_META[id].icon,
    values: dates.map(item => Math.round((matrix[id][item.key] || 0) * 100) / 100)
  }));

  return { dates, rows };
}

function getRealizedByStrategy(state = readState()) {
  const result = Object.fromEntries(STRATEGY_IDS.map(id => [id, 0]));
  for (const sell of state.sells) {
    const id = String(sell.strategy || '').toUpperCase();
    if (!Object.prototype.hasOwnProperty.call(result, id)) continue;
    result[id] += toNumber(sell.realizedProfit);
  }
  for (const id of STRATEGY_IDS) {
    result[id] = Math.round(result[id] * 100) / 100;
  }
  return result;
}

function getDashboardActivity() {
  const state = readState();
  return {
    recent7Days: getRecent7DayRealized(state),
    realizedByStrategy: getRealizedByStrategy(state),
    candidates: clone(state.candidates)
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
      .slice(0, 100),
    sellHistory: clone(state.sells)
      .sort((a, b) => String(b.soldAt || '').localeCompare(String(a.soldAt || '')))
      .slice(0, 200),
    updatedAt: state.updatedAt
  };
}

function setCandidates(strategyId, rows = []) {
  const id = String(strategyId || '').toUpperCase();
  if (!STRATEGY_META[id]) throw new Error('unknown US strategy');
  const state = readState();
  const now = new Date().toISOString();
  const keep = state.candidates.filter(item => String(item.strategy || '').toUpperCase() !== id);
  const incoming = (Array.isArray(rows) ? rows : []).slice(0, 100).map(item => ({
    strategy: id,
    exchange: String(item.exchange || ''),
    symbol: String(item.symbol || '').toUpperCase(),
    name: String(item.name || ''),
    status: String(item.status || 'WATCH'),
    score: toNumber(item.score),
    price: toNumber(item.price),
    changeRate: toNumber(item.changeRate),
    dayPositionRate: toNumber(item.dayPositionRate),
    vwap: toNumber(item.vwap),
    vwapGapRate: toNumber(item.vwapGapRate),
    rvol: toNumber(item.rvol),
    tradeValue: toNumber(item.tradeValue),
    trendPersistence: toNumber(item.trendPersistence),
    marketScore: toNumber(item.marketScore),
    qqqChangeRate: toNumber(item.qqqChangeRate),
    qqqVwapGapRate: toNumber(item.qqqVwapGapRate),
    averageDailyVolume: toNumber(item.averageDailyVolume),
    dailyVolumeSampleCount: toNumber(item.dailyVolumeSampleCount),
    sources: Array.isArray(item.sources) ? item.sources.map(String) : [],
    blocks: Array.isArray(item.blocks) ? item.blocks.map(String) : [],
    components: item.components && typeof item.components === 'object' ? clone(item.components) : {},
    reason: String(item.reason || ''),
    updatedAt: item.updatedAt || now
  }));
  state.candidates = [...keep, ...incoming];
  state.updatedAt = now;
  writeState(state);
  return clone(incoming);
}

function recordSell(input = {}) {
  const id = String(input.strategy || '').toUpperCase();
  if (!STRATEGY_META[id]) throw new Error('unknown US strategy');
  const state = readState();
  const soldAt = input.soldAt || new Date().toISOString();
  const row = {
    strategy: id,
    symbol: String(input.symbol || '').toUpperCase(),
    name: String(input.name || ''),
    quantity: toNumber(input.quantity),
    buyPrice: toNumber(input.buyPrice),
    sellPrice: toNumber(input.sellPrice),
    realizedProfit: toNumber(input.realizedProfit),
    profitRate: toNumber(input.profitRate),
    reason: String(input.reason || ''),
    soldAt
  };
  state.sells.push(row);
  if (state.sells.length > 2000) state.sells = state.sells.slice(-2000);
  state.updatedAt = soldAt;
  writeState(state);
  return clone(row);
}

module.exports = {
  DATA_FILE,
  getDashboardActivity,
  getRecent7DayRealized,
  getRealizedByStrategy,
  setCandidates,
  recordSell
};
