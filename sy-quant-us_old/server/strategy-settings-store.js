'use strict';

const fs = require('fs');
const path = require('path');

const SETTINGS_FILE = path.join(__dirname, 'us-strategy-settings.json');

const DEFAULT_SETTINGS = Object.freeze({
  version: 2,
  market: 'US',
  masterBuyEnabled: false,
  masterMaxInvestmentRate: 100,
  minimumCashRate: 0,
  strategies: {
    OPEN: {
      id: 'OPEN',
      label: 'US-OPEN',
      icon: '🚀',
      singleBuyRate: 20,
      strategyMaxInvestmentRate: 0,
      allocationRate: 0,
      maxHoldings: 1,
      dailyMaxNewBuys: 1,
      buyEnabled: false,
      implemented: false
    },
    CORE: {
      id: 'CORE',
      label: 'US-CORE',
      icon: '🛡️',
      singleBuyRate: 10,
      strategyMaxInvestmentRate: 25,
      allocationRate: 25,
      maxHoldings: 3,
      dailyMaxNewBuys: 3,
      buyEnabled: false,
      implemented: true
    },
    VOLUME: {
      id: 'VOLUME',
      label: 'US-VOLUME',
      icon: '📊',
      singleBuyRate: 10,
      strategyMaxInvestmentRate: 25,
      allocationRate: 25,
      maxHoldings: 2,
      dailyMaxNewBuys: 2,
      buyEnabled: false,
      implemented: true
    },
    WAVE: {
      id: 'WAVE',
      label: 'US-WAVE',
      icon: '🌊',
      singleBuyRate: 10,
      strategyMaxInvestmentRate: 25,
      allocationRate: 25,
      maxHoldings: 2,
      dailyMaxNewBuys: 2,
      buyEnabled: false,
      implemented: true
    },
    FAST: {
      id: 'FAST',
      label: 'US-FAST',
      icon: '⚡',
      singleBuyRate: 10,
      strategyMaxInvestmentRate: 25,
      allocationRate: 25,
      maxHoldings: 1,
      dailyMaxNewBuys: 1,
      buyEnabled: false,
      implemented: true
    }
  }
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function toFiniteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clampRate(value, fallback) {
  const n = toFiniteNumber(value, fallback);
  return Math.round(Math.min(100, Math.max(0, n)) * 10) / 10;
}

function clampInteger(value, fallback, min = 1, max = 50) {
  const n = Math.trunc(toFiniteNumber(value, fallback));
  return Math.min(max, Math.max(min, n));
}

function buildSettings(saved = {}) {
  const result = clone(DEFAULT_SETTINGS);

  result.masterBuyEnabled = Boolean(saved.masterBuyEnabled);
  result.masterMaxInvestmentRate = clampRate(
    saved.masterMaxInvestmentRate,
    result.masterMaxInvestmentRate
  );
  result.minimumCashRate = clampRate(
    saved.minimumCashRate,
    result.minimumCashRate
  );

  for (const id of Object.keys(result.strategies)) {
    const base = result.strategies[id];
    const incoming = saved?.strategies?.[id] || {};

    // v1의 allocationRate는 v2의 전략 최대 투자비율로 자동 이관한다.
    const migratedStrategyMax = incoming.strategyMaxInvestmentRate ?? incoming.allocationRate;

    base.singleBuyRate = clampRate(incoming.singleBuyRate, base.singleBuyRate);
    base.strategyMaxInvestmentRate = clampRate(
      migratedStrategyMax,
      base.strategyMaxInvestmentRate
    );
    // 기존 대시보드/로그와의 호환용 별칭.
    base.allocationRate = base.strategyMaxInvestmentRate;
    base.maxHoldings = clampInteger(incoming.maxHoldings, base.maxHoldings, 1, 20);
    base.dailyMaxNewBuys = clampInteger(
      incoming.dailyMaxNewBuys,
      base.dailyMaxNewBuys,
      1,
      20
    );

    // implemented는 코드 배포로만 변경한다. API로 켤 수 없다.
    base.implemented = Boolean(DEFAULT_SETTINGS.strategies[id].implemented);
    base.buyEnabled = base.implemented && Boolean(incoming.buyEnabled);
  }

  result.version = 2;
  result.allocationTotal = Object.values(result.strategies)
    .reduce((sum, item) => sum + Number(item.strategyMaxInvestmentRate || 0), 0);
  result.unallocatedRate = Math.max(0, 100 - result.allocationTotal);
  result.implementedCount = Object.values(result.strategies)
    .filter(item => item.implemented).length;
  result.buyEnabledCount = Object.values(result.strategies)
    .filter(item => item.buyEnabled).length;

  // 아직 구현된 전략이 하나도 없으면 MASTER도 항상 OFF로 유지한다.
  if (result.implementedCount === 0) {
    result.masterBuyEnabled = false;
  }

  result.updatedAt = saved.updatedAt || null;

  return result;
}

function readSavedSettings() {
  if (!fs.existsSync(SETTINGS_FILE)) return {};

  try {
    const text = fs.readFileSync(SETTINGS_FILE, 'utf8');
    if (!text.trim()) return {};
    return JSON.parse(text);
  } catch (err) {
    console.error('[US 전략설정] 설정파일 읽기 실패, 기본값 사용:', err.message);
    return {};
  }
}

function getSettings() {
  return buildSettings(readSavedSettings());
}

function writeSettingsAtomic(settings) {
  const tempPath = `${SETTINGS_FILE}.${process.pid}.${Date.now()}.tmp`;
  const payload = JSON.stringify(settings, null, 2);

  try {
    fs.writeFileSync(tempPath, payload, 'utf8');
    fs.renameSync(tempPath, SETTINGS_FILE);
  } finally {
    if (fs.existsSync(tempPath)) {
      try { fs.unlinkSync(tempPath); } catch (_) {}
    }
  }
}

function updateSettings(input = {}) {
  const current = getSettings();
  const candidate = clone(current);

  if (Object.prototype.hasOwnProperty.call(input, 'masterBuyEnabled')) {
    candidate.masterBuyEnabled = Boolean(input.masterBuyEnabled);
  }
  if (Object.prototype.hasOwnProperty.call(input, 'masterMaxInvestmentRate')) {
    candidate.masterMaxInvestmentRate = clampRate(
      input.masterMaxInvestmentRate,
      candidate.masterMaxInvestmentRate
    );
  }
  if (Object.prototype.hasOwnProperty.call(input, 'minimumCashRate')) {
    candidate.minimumCashRate = clampRate(
      input.minimumCashRate,
      candidate.minimumCashRate
    );
  }

  if (candidate.masterMaxInvestmentRate + candidate.minimumCashRate > 100.0001) {
    throw new Error(
      `MASTER 최대 투자비율과 최소 현금의 합은 100%를 넘을 수 없습니다. 현재 ${(candidate.masterMaxInvestmentRate + candidate.minimumCashRate).toFixed(1)}%`
    );
  }

  for (const id of Object.keys(DEFAULT_SETTINGS.strategies)) {
    const patch = input?.strategies?.[id];
    if (!patch || typeof patch !== 'object') continue;

    candidate.strategies[id].singleBuyRate = clampRate(
      patch.singleBuyRate,
      candidate.strategies[id].singleBuyRate
    );
    candidate.strategies[id].strategyMaxInvestmentRate = clampRate(
      patch.strategyMaxInvestmentRate ?? patch.allocationRate,
      candidate.strategies[id].strategyMaxInvestmentRate
    );
    candidate.strategies[id].allocationRate =
      candidate.strategies[id].strategyMaxInvestmentRate;
    candidate.strategies[id].maxHoldings = clampInteger(
      patch.maxHoldings,
      candidate.strategies[id].maxHoldings,
      1,
      20
    );
    candidate.strategies[id].dailyMaxNewBuys = clampInteger(
      patch.dailyMaxNewBuys,
      candidate.strategies[id].dailyMaxNewBuys,
      1,
      20
    );

    // 미구현 전략은 어떤 요청이 와도 BUY OFF를 유지한다.
    candidate.strategies[id].implemented = Boolean(
      DEFAULT_SETTINGS.strategies[id].implemented
    );
    candidate.strategies[id].buyEnabled =
      candidate.strategies[id].implemented && Boolean(patch.buyEnabled);
  }

  // 전략별 최대 투자비율은 각 전략의 상한이므로 합계가 100%를 넘는 것도 허용한다.
  // 다만 현재 US 기본값은 기존 20/30/20/20/10 배분을 보존한다.
  candidate.allocationTotal = Object.values(candidate.strategies)
    .reduce((sum, item) => sum + Number(item.strategyMaxInvestmentRate || 0), 0);
  candidate.unallocatedRate = Math.max(0, 100 - candidate.allocationTotal);
  candidate.implementedCount = Object.values(candidate.strategies)
    .filter(item => item.implemented).length;
  candidate.buyEnabledCount = Object.values(candidate.strategies)
    .filter(item => item.buyEnabled).length;

  if (candidate.implementedCount === 0) {
    candidate.masterBuyEnabled = false;
  }

  candidate.version = 2;
  candidate.updatedAt = new Date().toISOString();

  writeSettingsAtomic(candidate);
  return buildSettings(candidate);
}

function isBuyAllowed(strategyId) {
  const settings = getSettings();
  const id = String(strategyId || '').trim().toUpperCase();
  const strategy = settings.strategies[id];

  if (!strategy) {
    return { allowed: false, reason: 'UNKNOWN_STRATEGY', settings, strategy: null };
  }
  if (!settings.masterBuyEnabled) {
    return { allowed: false, reason: 'US_MASTER_BUY_OFF', settings, strategy };
  }
  if (!strategy.implemented) {
    return { allowed: false, reason: `US_${id}_NOT_IMPLEMENTED`, settings, strategy };
  }
  if (!strategy.buyEnabled) {
    return { allowed: false, reason: `US_${id}_BUY_OFF`, settings, strategy };
  }

  return { allowed: true, reason: 'BUY_ALLOWED', settings, strategy };
}

module.exports = {
  DEFAULT_SETTINGS,
  SETTINGS_FILE,
  getSettings,
  updateSettings,
  isBuyAllowed
};
