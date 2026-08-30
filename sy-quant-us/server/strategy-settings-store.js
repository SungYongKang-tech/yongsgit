'use strict';

const fs = require('fs');
const path = require('path');

const SETTINGS_FILE = path.join(__dirname, 'us-strategy-settings.json');

const DEFAULT_SETTINGS = Object.freeze({
  version: 1,
  market: 'US',
  masterBuyEnabled: false,
  strategies: {
    OPEN: {
      id: 'OPEN',
      label: 'US-OPEN',
      icon: '🚀',
      allocationRate: 20,
      maxHoldings: 1,
      buyEnabled: false,
      implemented: false
    },
    CORE: {
      id: 'CORE',
      label: 'US-CORE',
      icon: '🛡️',
      allocationRate: 30,
      maxHoldings: 3,
      buyEnabled: false,
      implemented: false
    },
    VOLUME: {
      id: 'VOLUME',
      label: 'US-VOLUME',
      icon: '📊',
      allocationRate: 20,
      maxHoldings: 2,
      buyEnabled: false,
      implemented: false
    },
    WAVE: {
      id: 'WAVE',
      label: 'US-WAVE',
      icon: '🌊',
      allocationRate: 20,
      maxHoldings: 2,
      buyEnabled: false,
      implemented: false
    },
    FAST: {
      id: 'FAST',
      label: 'US-FAST',
      icon: '⚡',
      allocationRate: 10,
      maxHoldings: 1,
      buyEnabled: false,
      implemented: false
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

function normalizeAllocationRate(value, fallback) {
  const n = toFiniteNumber(value, fallback);
  return Math.round(Math.min(100, Math.max(0, n)) * 10) / 10;
}

function normalizeMaxHoldings(value, fallback) {
  const n = Math.trunc(toFiniteNumber(value, fallback));
  return Math.min(20, Math.max(1, n));
}

function buildSettings(saved = {}) {
  const result = clone(DEFAULT_SETTINGS);
  result.masterBuyEnabled = Boolean(saved.masterBuyEnabled);

  for (const id of Object.keys(result.strategies)) {
    const base = result.strategies[id];
    const incoming = saved?.strategies?.[id] || {};

    base.allocationRate = normalizeAllocationRate(
      incoming.allocationRate,
      base.allocationRate
    );
    base.maxHoldings = normalizeMaxHoldings(
      incoming.maxHoldings,
      base.maxHoldings
    );

    // implemented는 코드 배포로만 변경한다. API 요청으로 켤 수 없다.
    base.implemented = Boolean(DEFAULT_SETTINGS.strategies[id].implemented);
    base.buyEnabled = base.implemented && Boolean(incoming.buyEnabled);
  }

  result.allocationTotal = Object.values(result.strategies)
    .reduce((sum, item) => sum + Number(item.allocationRate || 0), 0);
  result.unallocatedRate = Math.max(0, 100 - result.allocationTotal);
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

  for (const id of Object.keys(DEFAULT_SETTINGS.strategies)) {
    const patch = input?.strategies?.[id];
    if (!patch || typeof patch !== 'object') continue;

    candidate.strategies[id].allocationRate = normalizeAllocationRate(
      patch.allocationRate,
      candidate.strategies[id].allocationRate
    );
    candidate.strategies[id].maxHoldings = normalizeMaxHoldings(
      patch.maxHoldings,
      candidate.strategies[id].maxHoldings
    );

    // 미구현 전략은 어떤 요청이 와도 BUY OFF를 유지한다.
    candidate.strategies[id].implemented = Boolean(
      DEFAULT_SETTINGS.strategies[id].implemented
    );
    candidate.strategies[id].buyEnabled =
      candidate.strategies[id].implemented && Boolean(patch.buyEnabled);
  }

  const allocationTotal = Object.values(candidate.strategies)
    .reduce((sum, item) => sum + Number(item.allocationRate || 0), 0);

  if (allocationTotal > 100.0001) {
    throw new Error(`전략 자금비율 합계는 100%를 넘을 수 없습니다. 현재 ${allocationTotal.toFixed(1)}%`);
  }

  candidate.allocationTotal = Math.round(allocationTotal * 10) / 10;
  candidate.unallocatedRate = Math.round(Math.max(0, 100 - allocationTotal) * 10) / 10;
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
