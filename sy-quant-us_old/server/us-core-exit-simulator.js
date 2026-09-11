'use strict';

const virtualTracker = require('./us-core-virtual-tracker');
const { marketTodayKey } = require('./market-calendar');

const PROFILES = Object.freeze([
  {
    id: 'HOLD_TO_CLOSE',
    label: '종가까지 보유',
    stopLossRate: null,
    takeProfitRate: null,
    breakEvenTriggerRate: null,
    protectRate: null,
    trailTriggerRate: null,
    trailGapRate: null
  },
  {
    id: 'TIGHT',
    label: '타이트',
    stopLossRate: -0.8,
    takeProfitRate: null,
    breakEvenTriggerRate: 1.2,
    protectRate: 0.15,
    trailTriggerRate: 2.0,
    trailGapRate: 0.7
  },
  {
    id: 'CORE_TEST',
    label: 'CORE 테스트',
    stopLossRate: -1.2,
    takeProfitRate: null,
    breakEvenTriggerRate: 1.0,
    protectRate: 0.1,
    trailTriggerRate: 1.5,
    trailGapRate: 0.6
  },
  {
    id: 'BALANCED',
    label: '균형',
    stopLossRate: -1.2,
    takeProfitRate: null,
    breakEvenTriggerRate: 1.8,
    protectRate: 0.2,
    trailTriggerRate: 3.0,
    trailGapRate: 1.0
  },
  {
    id: 'WIDE',
    label: '와이드',
    stopLossRate: -1.8,
    takeProfitRate: null,
    breakEvenTriggerRate: 2.5,
    protectRate: 0.25,
    trailTriggerRate: 4.0,
    trailGapRate: 1.5
  },
  {
    id: 'FIXED_TP3',
    label: '+3% 고정익절',
    stopLossRate: -1.2,
    takeProfitRate: 3.0,
    breakEvenTriggerRate: null,
    protectRate: null,
    trailTriggerRate: null,
    trailGapRate: null
  }
]);

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round(value, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

function returnRate(entryPrice, price) {
  const entry = toNumber(entryPrice);
  const current = toNumber(price);
  return entry > 0 ? ((current - entry) / entry) * 100 : 0;
}

function sampleRows(position = {}) {
  const entryAt = position.entryAt || null;
  const entryPrice = toNumber(position.entryPrice);
  const rows = Array.isArray(position.samples) ? position.samples.slice() : [];

  if (entryAt && entryPrice > 0 && !rows.some(row => row.at === entryAt)) {
    rows.push({ at: entryAt, price: entryPrice, returnRate: 0 });
  }

  return rows
    .filter(row => row && row.at && toNumber(row.price) > 0)
    .map(row => ({
      at: row.at,
      price: toNumber(row.price),
      returnRate: Number.isFinite(Number(row.returnRate))
        ? Number(row.returnRate)
        : returnRate(entryPrice, row.price)
    }))
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

function reasonLabel(reason) {
  const map = {
    STOP_LOSS: '손절',
    TAKE_PROFIT: '고정익절',
    TRAILING_STOP: '트레일링',
    BREAK_EVEN_PROTECT: '본전보호',
    SESSION_CLOSE: '장마감',
    MARK_TO_MARKET: '현재평가',
    CLOSE_REVIEW: '종료확인필요'
  };
  return map[reason] || reason || '-';
}

function evaluatePosition(position, profile) {
  const samples = sampleRows(position);
  const entryPrice = toNumber(position.entryPrice);
  let peakRate = 0;
  let breakEvenArmed = false;
  let trailArmed = false;
  let exit = null;

  for (const sample of samples) {
    const rate = toNumber(sample.returnRate);
    peakRate = Math.max(peakRate, rate);

    if (profile.breakEvenTriggerRate !== null && peakRate >= profile.breakEvenTriggerRate) {
      breakEvenArmed = true;
    }
    if (profile.trailTriggerRate !== null && peakRate >= profile.trailTriggerRate) {
      trailArmed = true;
    }

    if (profile.stopLossRate !== null && rate <= profile.stopLossRate) {
      exit = { at: sample.at, price: sample.price, returnRate: rate, reason: 'STOP_LOSS' };
      break;
    }

    if (profile.takeProfitRate !== null && rate >= profile.takeProfitRate) {
      exit = { at: sample.at, price: sample.price, returnRate: rate, reason: 'TAKE_PROFIT' };
      break;
    }

    if (
      trailArmed &&
      profile.trailGapRate !== null &&
      rate <= peakRate - profile.trailGapRate
    ) {
      exit = { at: sample.at, price: sample.price, returnRate: rate, reason: 'TRAILING_STOP' };
      break;
    }

    if (
      breakEvenArmed &&
      profile.protectRate !== null &&
      rate <= profile.protectRate
    ) {
      exit = { at: sample.at, price: sample.price, returnRate: rate, reason: 'BREAK_EVEN_PROTECT' };
      break;
    }
  }

  if (!exit && position.status === 'CLOSED') {
    const price = toNumber(position.closePrice || position.lastPrice);
    exit = {
      at: position.closedAt || position.lastTrackedAt || null,
      price,
      returnRate: Number.isFinite(Number(position.closeReturnRate))
        ? Number(position.closeReturnRate)
        : returnRate(entryPrice, price),
      reason: 'SESSION_CLOSE'
    };
  }

  if (!exit && position.status === 'CLOSE_REVIEW') {
    const price = toNumber(position.lastPrice || entryPrice);
    exit = {
      at: position.lastTrackedAt || null,
      price,
      returnRate: returnRate(entryPrice, price),
      reason: 'CLOSE_REVIEW',
      provisional: true
    };
  }

  if (!exit) {
    const last = samples.at(-1);
    const price = last ? last.price : toNumber(position.lastPrice || entryPrice);
    exit = {
      at: last?.at || position.lastTrackedAt || position.entryAt || null,
      price,
      returnRate: returnRate(entryPrice, price),
      reason: 'MARK_TO_MARKET',
      provisional: true
    };
  }

  return {
    positionId: position.id,
    exchange: position.exchange,
    symbol: position.symbol,
    name: position.name,
    marketDate: position.marketDate,
    entryAt: position.entryAt,
    entryPrice: round(entryPrice, 4),
    entryScore: round(position.entryScore, 0),
    exitAt: exit.at,
    exitPrice: round(exit.price, 4),
    returnRate: round(exit.returnRate),
    exitReason: exit.reason,
    exitReasonLabel: reasonLabel(exit.reason),
    provisional: Boolean(exit.provisional),
    sampleCount: samples.length,
    sampledPeakRate: round(peakRate),
    sourcePositionStatus: position.status
  };
}

function average(values) {
  const nums = values.filter(value => Number.isFinite(Number(value))).map(Number);
  if (!nums.length) return null;
  return round(nums.reduce((sum, value) => sum + value, 0) / nums.length);
}

function summarizeProfile(profile, positions) {
  const results = positions.map(position => evaluatePosition(position, profile));
  const completed = results.filter(row => !row.provisional);
  const returns = results.map(row => row.returnRate).filter(value => value !== null);
  const wins = returns.filter(value => value > 0).length;
  const losses = returns.filter(value => value < 0).length;
  const flat = returns.length - wins - losses;
  const ranked = results.slice().sort((a, b) => toNumber(b.returnRate) - toNumber(a.returnRate));
  const reasonCounts = {};
  for (const row of results) {
    reasonCounts[row.exitReason] = (reasonCounts[row.exitReason] || 0) + 1;
  }

  return {
    id: profile.id,
    label: profile.label,
    rules: { ...profile },
    positionCount: results.length,
    completedCount: completed.length,
    provisionalCount: results.length - completed.length,
    winCount: wins,
    lossCount: losses,
    flatCount: flat,
    winRate: results.length ? round((wins / results.length) * 100, 1) : null,
    averageReturnRate: average(returns),
    best: ranked.length ? ranked[0] : null,
    worst: ranked.length ? ranked.at(-1) : null,
    exitReasonCounts: reasonCounts,
    positions: results
  };
}

function getSimulation(dateKey) {
  const resolvedDate = /^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ''))
    ? String(dateKey)
    : marketTodayKey('US');
  const tracker = virtualTracker.getStatus({ includePositions: true });
  const positions = (Array.isArray(tracker.positions) ? tracker.positions : [])
    .filter(row => row.marketDate === resolvedDate);
  const profiles = PROFILES.map(profile => summarizeProfile(profile, positions));
  const ranking = profiles
    .map(item => ({
      id: item.id,
      label: item.label,
      averageReturnRate: item.averageReturnRate,
      winRate: item.winRate,
      completedCount: item.completedCount,
      provisionalCount: item.provisionalCount
    }))
    .sort((a, b) => toNumber(b.averageReturnRate) - toNumber(a.averageReturnRate));

  return {
    ok: true,
    strategy: 'CORE',
    market: 'US',
    simulationOnly: true,
    actualOrderEnabled: false,
    sampleBasis: '5-minute sampled virtual-tracker prices; not intrabar/tick-exact fills',
    tradingDate: resolvedDate,
    virtualEntryCount: positions.length,
    profileCount: PROFILES.length,
    ranking,
    profiles,
    generatedAt: new Date().toISOString()
  };
}

if (require.main === module) {
  try {
    const dateKey = String(process.argv[2] || '').trim();
    console.log(JSON.stringify(getSimulation(dateKey), null, 2));
  } catch (err) {
    console.error(JSON.stringify({ ok: false, simulationOnly: true, actualOrderEnabled: false, error: err.message }, null, 2));
    process.exitCode = 1;
  }
}

module.exports = {
  PROFILES,
  evaluatePosition,
  getSimulation
};
