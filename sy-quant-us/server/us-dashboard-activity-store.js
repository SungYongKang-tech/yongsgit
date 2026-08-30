'use strict';

const fs = require('fs');
const path = require('path');

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

function kstDateKey(value) {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return null;
  const shifted = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function last7Dates() {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  const result = [];
  for (let i = 6; i >= 0; i -= 1) {
    const date = new Date(Date.UTC(y, m, d - i));
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
    result.push({ key, label: `${date.getUTCMonth() + 1}/${date.getUTCDate()}` });
  }
  return result;
}

function getRecent7DayRealized(state = readState()) {
  const dates = last7Dates();
  const dateSet = new Set(dates.map(item => item.key));
  const matrix = {};
  STRATEGY_IDS.forEach(id => {
    matrix[id] = Object.fromEntries(dates.map(item => [item.key, 0]));
  });

  for (const sell of state.sells) {
    const id = String(sell.strategy || '').toUpperCase();
    if (!matrix[id]) continue;
    const key = kstDateKey(sell.soldAt || sell.time || sell.createdAt);
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
    symbol: String(item.symbol || '').toUpperCase(),
    name: String(item.name || ''),
    status: String(item.status || 'WATCH'),
    score: toNumber(item.score),
    price: toNumber(item.price),
    changeRate: toNumber(item.changeRate),
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