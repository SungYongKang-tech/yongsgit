const fs = require("fs");
const path = require("path");

/**
 * SY Quant MASTER PORTFOLIO MANAGER
 *
 * 목적
 * - OPEN / CORE / VOLUME / WAVE / FAST가 하나의 가상계좌를 사용하도록 하는 공통 자금관리 모듈
 * - 전략 고유 후보/학습 데이터는 각 전략 파일에 남기고, 돈/보유/거래만 MASTER에서 관리
 *
 * 현재 구조
 * - OPEN / CORE / VOLUME / WAVE / FAST의 금융원장은 MASTER 하나로 통합되어 있다.
 * - 전략별 후보/학습/관찰 상태는 각 전략 파일에 남기고 돈/보유/거래는 MASTER가 관리한다.
 * - PAUSED는 신규매수를 차단하지만 기존 보유종목의 매도/위험관리는 계속 허용한다.
 */

const MASTER_STATE_FILE =
  process.env.SY_QUANT_MASTER_STATE_FILE ||
  path.join(__dirname, "paper-state-core.json");

const MASTER_LOCK_DIR =
  process.env.SY_QUANT_MASTER_LOCK_DIR ||
  path.join(__dirname, ".syquant-master-portfolio.lock");

const MASTER_INITIAL_CAPITAL = 100000000;
const PORTFOLIO_SCHEMA_VERSION = 1;

const STRATEGIES = ["OPEN", "CORE", "VOLUME", "WAVE", "FAST"];

const DEFAULT_PORTFOLIO_CONTROL = Object.freeze({
  schemaVersion: PORTFOLIO_SCHEMA_VERSION,
  allocationMode: "MANUAL",

  // 전체 계좌는 최대 90%까지만 주식에 노출하고 최소 10%는 현금으로 남긴다.
  totalExposureLimitRate: 0.90,
  reserveCashRate: 0.10,

  // 동일 종목은 먼저 산 전략만 보유한다.
  duplicateStockPolicy: "BLOCK",

  // 1단계에서는 기존 전략의 투자비율을 그대로 관찰하기 위해
  // 전략별 allocationRate를 강제로 적용하지 않는다.
  strategyAllocationEnforced: false,

  strategies: {
    OPEN: {
      enabled: true,
      status: "ACTIVE",
      allocationRate: null
    },
    CORE: {
      enabled: true,
      status: "ACTIVE",
      allocationRate: null
    },
    VOLUME: {
      enabled: true,
      status: "ACTIVE",
      allocationRate: null
    },
    WAVE: {
      enabled: true,
      status: "ACTIVE",
      allocationRate: null
    },
    FAST: {
      enabled: true,
      status: "ACTIVE",
      allocationRate: null
    }
  }
});

function sleepSync(ms) {
  const sab = new SharedArrayBuffer(4);
  const view = new Int32Array(sab);
  Atomics.wait(view, 0, 0, ms);
}

function clone(value) {
  return value === undefined
    ? undefined
    : JSON.parse(JSON.stringify(value));
}

function toNumber(value, fallback = 0) {
  const cleaned = String(value ?? "")
    .replace(/[+,%]/g, "")
    .replace(/,/g, "")
    .trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, toNumber(value)));
}

function normalizeCode(value) {
  const match = String(value || "")
    .replace(/^A/i, "")
    .match(/\d{6}/);
  return match ? match[0] : "";
}

function normalizeStrategy(value) {
  const strategy = String(value || "").trim().toUpperCase();
  return STRATEGIES.includes(strategy) ? strategy : "";
}

function nowText() {
  return new Date().toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul"
  });
}

function todayKey() {
  return new Date().toLocaleDateString("sv-SE", {
    timeZone: "Asia/Seoul"
  });
}

function mergeDefaults(target, defaults) {
  const result = target && typeof target === "object" && !Array.isArray(target)
    ? target
    : {};

  for (const [key, defaultValue] of Object.entries(defaults)) {
    if (result[key] === undefined || result[key] === null) {
      result[key] = clone(defaultValue);
      continue;
    }

    if (
      defaultValue &&
      typeof defaultValue === "object" &&
      !Array.isArray(defaultValue)
    ) {
      result[key] = mergeDefaults(result[key], defaultValue);
    }
  }

  return result;
}

function ensurePortfolioControl(state) {
  state.portfolioControl = mergeDefaults(
    state.portfolioControl,
    DEFAULT_PORTFOLIO_CONTROL
  );

  state.portfolioControl.schemaVersion = PORTFOLIO_SCHEMA_VERSION;
  state.portfolioControl.totalExposureLimitRate = clamp(
    state.portfolioControl.totalExposureLimitRate,
    0,
    1
  );
  state.portfolioControl.reserveCashRate = clamp(
    state.portfolioControl.reserveCashRate,
    0,
    1
  );

  for (const strategy of STRATEGIES) {
    const config = state.portfolioControl.strategies[strategy] || {};
    const defaultConfig = DEFAULT_PORTFOLIO_CONTROL.strategies[strategy];
    state.portfolioControl.strategies[strategy] = mergeDefaults(
      config,
      defaultConfig
    );

    const status = String(
      state.portfolioControl.strategies[strategy].status || "ACTIVE"
    ).toUpperCase();

    state.portfolioControl.strategies[strategy].status =
      ["ACTIVE", "REDUCED", "PAUSED"].includes(status)
        ? status
        : "ACTIVE";

    const rawRate =
      state.portfolioControl.strategies[strategy].allocationRate;

    if (rawRate !== null && rawRate !== undefined) {
      state.portfolioControl.strategies[strategy].allocationRate =
        clamp(rawRate, 0, 1);
    }
  }

  return state.portfolioControl;
}

function ensureMasterState(state = {}) {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    state = {};
  }

  if (!Array.isArray(state.holdings)) state.holdings = [];
  if (!Array.isArray(state.tradeLogs)) state.tradeLogs = [];

  if (!Number.isFinite(Number(state.initialCapital))) {
    state.initialCapital = MASTER_INITIAL_CAPITAL;
  }

  if (!Number.isFinite(Number(state.totalCash))) {
    state.totalCash = state.initialCapital;
  }

  // 기존 OPEN/CORE/VOLUME 상태와 호환하기 위해 다른 필드는 지우지 않는다.
  ensurePortfolioControl(state);

  state.masterAccount = {
    ...(state.masterAccount || {}),
    enabled: true,
    version: PORTFOLIO_SCHEMA_VERSION,
    accountName: "SY Quant MASTER",
    initialCapital: toNumber(state.initialCapital, MASTER_INITIAL_CAPITAL)
  };

  return state;
}

function getHoldingPrice(holding = {}) {
  return Math.abs(toNumber(
    holding.currentPrice ??
    holding.lastPrice ??
    holding.price ??
    holding.buyPrice
  ));
}

function getHoldingQty(holding = {}) {
  return Math.max(0, toNumber(holding.qty));
}

function getHoldingMarketValue(holding = {}) {
  const qty = getHoldingQty(holding);
  const price = getHoldingPrice(holding);

  if (qty > 0 && price > 0) {
    return qty * price;
  }

  return Math.max(
    0,
    toNumber(
      holding.marketValue ??
      holding.buyAmount ??
      holding.amount
    )
  );
}

function getHoldingCost(holding = {}) {
  const qty = getHoldingQty(holding);
  const buyPrice = Math.abs(toNumber(holding.buyPrice));

  if (qty > 0 && buyPrice > 0) return qty * buyPrice;

  return Math.max(
    0,
    toNumber(holding.buyAmount ?? holding.amount)
  );
}

function getStrategyOfHolding(holding = {}) {
  return normalizeStrategy(
    holding.strategyGroup ||
    holding.strategy ||
    holding.ownerStrategy
  );
}

function getTotalExposure(state) {
  ensureMasterState(state);
  return state.holdings.reduce(
    (sum, holding) => sum + getHoldingMarketValue(holding),
    0
  );
}

function getTotalCostExposure(state) {
  ensureMasterState(state);
  return state.holdings.reduce(
    (sum, holding) => sum + getHoldingCost(holding),
    0
  );
}

function getEquity(state) {
  ensureMasterState(state);
  return Math.max(
    0,
    toNumber(state.totalCash) + getTotalExposure(state)
  );
}

function getStrategyExposure(state, strategy) {
  ensureMasterState(state);
  const normalized = normalizeStrategy(strategy);
  if (!normalized) return 0;

  return state.holdings
    .filter(holding => getStrategyOfHolding(holding) === normalized)
    .reduce(
      (sum, holding) => sum + getHoldingMarketValue(holding),
      0
    );
}

function getStrategyHoldingCount(state, strategy) {
  ensureMasterState(state);
  const normalized = normalizeStrategy(strategy);
  if (!normalized) return 0;

  return state.holdings.filter(
    holding => getStrategyOfHolding(holding) === normalized
  ).length;
}

function findHoldingByCode(state, code) {
  ensureMasterState(state);
  const normalizedCode = normalizeCode(code);
  if (!normalizedCode) return null;

  return state.holdings.find(
    holding => normalizeCode(holding.code) === normalizedCode
  ) || null;
}

function isDuplicateHolding(state, code) {
  return Boolean(findHoldingByCode(state, code));
}

function getStrategyConfig(state, strategy) {
  ensureMasterState(state);
  const normalized = normalizeStrategy(strategy);
  if (!normalized) return null;
  return state.portfolioControl.strategies[normalized];
}

function getReserveCashAmount(state) {
  const equity = getEquity(state);
  return Math.max(
    0,
    equity * clamp(
      state.portfolioControl.reserveCashRate,
      0,
      1
    )
  );
}

function getExposureLimitAmount(state) {
  const equity = getEquity(state);
  return Math.max(
    0,
    equity * clamp(
      state.portfolioControl.totalExposureLimitRate,
      0,
      1
    )
  );
}

function getStrategyAllocationLimitAmount(state, strategy) {
  ensureMasterState(state);

  const config = getStrategyConfig(state, strategy);
  if (!config) return 0;

  if (state.portfolioControl.strategyAllocationEnforced !== true) {
    return Infinity;
  }

  if (
    config.allocationRate === null ||
    config.allocationRate === undefined
  ) {
    return Infinity;
  }

  return getEquity(state) * clamp(config.allocationRate, 0, 1);
}

function getAvailableCash(state, options = {}) {
  ensureMasterState(state);

  const strategy = normalizeStrategy(options.strategy);
  const cash = Math.max(0, toNumber(state.totalCash));
  const totalExposure = getTotalExposure(state);
  const exposureLimit = getExposureLimitAmount(state);
  const reserveCash = getReserveCashAmount(state);

  const cashAfterReserve = Math.max(0, cash - reserveCash);
  const exposureRoom = Math.max(0, exposureLimit - totalExposure);

  let available = Math.min(cashAfterReserve, exposureRoom);

  let strategyExposure = null;
  let strategyLimit = null;
  let strategyRoom = null;

  if (strategy) {
    strategyExposure = getStrategyExposure(state, strategy);
    strategyLimit = getStrategyAllocationLimitAmount(state, strategy);
    strategyRoom = Number.isFinite(strategyLimit)
      ? Math.max(0, strategyLimit - strategyExposure)
      : Infinity;

    available = Math.min(available, strategyRoom);
  }

  return {
    availableCash: Math.max(0, Math.floor(available)),
    cash: Math.floor(cash),
    equity: Math.floor(getEquity(state)),
    totalExposure: Math.floor(totalExposure),
    exposureLimit: Math.floor(exposureLimit),
    reserveCash: Math.floor(reserveCash),
    strategy,
    strategyExposure:
      strategyExposure === null ? null : Math.floor(strategyExposure),
    strategyLimit:
      strategyLimit === null || !Number.isFinite(strategyLimit)
        ? null
        : Math.floor(strategyLimit),
    strategyRoom:
      strategyRoom === null || !Number.isFinite(strategyRoom)
        ? null
        : Math.floor(strategyRoom)
  };
}

function canStrategyTrade(state, strategy) {
  const normalized = normalizeStrategy(strategy);
  if (!normalized) {
    return {
      ok: false,
      reason: "지원하지 않는 전략"
    };
  }

  const config = getStrategyConfig(state, normalized);

  if (!config || config.enabled !== true) {
    return {
      ok: false,
      reason: `${normalized} 전략 비활성`
    };
  }

  if (String(config.status).toUpperCase() === "PAUSED") {
    return {
      ok: false,
      reason: `${normalized} 전략 PAUSED`
    };
  }

  return {
    ok: true,
    strategy: normalized,
    status: config.status
  };
}

function canBuy(state, options = {}) {
  ensureMasterState(state);

  const strategyCheck = canStrategyTrade(state, options.strategy);
  if (!strategyCheck.ok) return strategyCheck;

  const strategy = strategyCheck.strategy;
  const code = normalizeCode(options.code);

  if (!code) {
    return {
      ok: false,
      reason: "종목코드 오류"
    };
  }

  const duplicate = findHoldingByCode(state, code);
  if (
    duplicate &&
    String(state.portfolioControl.duplicateStockPolicy).toUpperCase() === "BLOCK"
  ) {
    return {
      ok: false,
      reason:
        `${code} 중복보유 차단 / 기존 ${getStrategyOfHolding(duplicate) || "UNKNOWN"} 보유`,
      duplicateHolding: duplicate
    };
  }

  const price = Math.abs(toNumber(options.price));
  if (price <= 0) {
    return {
      ok: false,
      reason: "매수가 오류"
    };
  }

  const requestedAmount = Math.max(
    0,
    Math.floor(toNumber(options.requestedAmount))
  );

  if (requestedAmount <= 0) {
    return {
      ok: false,
      reason: "매수금액 오류"
    };
  }

  const availability = getAvailableCash(state, { strategy });

  if (availability.availableCash <= 0) {
    return {
      ok: false,
      reason: "MASTER 가용현금 없음",
      availability
    };
  }

  if (requestedAmount > availability.availableCash) {
    return {
      ok: false,
      reason:
        `MASTER 가용한도 초과 / 요청 ${requestedAmount.toLocaleString()}원 / ` +
        `가능 ${availability.availableCash.toLocaleString()}원`,
      availability
    };
  }

  const qty = Math.floor(requestedAmount / price);
  if (qty <= 0) {
    return {
      ok: false,
      reason: "매수가능 수량 0주",
      availability
    };
  }

  const buyAmount = qty * price;

  return {
    ok: true,
    strategy,
    code,
    price,
    qty,
    buyAmount,
    availability
  };
}

function makePositionId(strategy, code, timestampMs = Date.now()) {
  return [
    normalizeStrategy(strategy),
    normalizeCode(code),
    Number(timestampMs || Date.now())
  ].join("_");
}

function requestBuy(state, options = {}) {
  ensureMasterState(state);

  const check = canBuy(state, options);
  if (!check.ok) return check;

  const timestampMs = Number(options.timestampMs || Date.now());
  const holding = {
    ...(options.holding || {}),
    strategy: check.strategy,
    strategyGroup: check.strategy,
    ownerStrategy: check.strategy,
    code: check.code,
    buyPrice: check.price,
    currentPrice: check.price,
    qty: check.qty,
    buyAmount: check.buyAmount,
    buyDate: options.buyDate || todayKey(),
    buyAt: options.buyAt || nowText(),
    buyAtMs: timestampMs,
    positionId:
      options.positionId ||
      options.holding?.positionId ||
      makePositionId(check.strategy, check.code, timestampMs)
  };

  const logType =
    String(options.logType || `${check.strategy}_BUY`).toUpperCase();

  const tradeLog = {
    ...(options.tradeLog || {}),
    type: logType,
    strategy: check.strategy,
    strategyGroup: check.strategy,
    ownerStrategy: check.strategy,
    code: check.code,
    name: holding.name || options.name || check.code,
    price: check.price,
    buyPrice: check.price,
    qty: check.qty,
    amount: check.buyAmount,
    buyAmount: check.buyAmount,
    positionId: holding.positionId,
    date: options.date || todayKey(),
    time: options.time || nowText(),
    timestampMs
  };

  state.totalCash =
    Math.max(0, toNumber(state.totalCash) - check.buyAmount);
  state.holdings.push(holding);
  state.tradeLogs.push(tradeLog);

  return {
    ok: true,
    state,
    holding,
    tradeLog,
    qty: check.qty,
    buyAmount: check.buyAmount,
    totalCash: state.totalCash,
    availabilityBefore: check.availability
  };
}

function findHoldingForSell(state, options = {}) {
  ensureMasterState(state);

  if (options.positionId) {
    const exact = state.holdings.find(
      holding => String(holding.positionId || "") === String(options.positionId)
    );
    if (exact) return exact;
  }

  const code = normalizeCode(options.code);
  if (!code) return null;

  return state.holdings.find(
    holding => normalizeCode(holding.code) === code
  ) || null;
}

function requestSell(state, options = {}) {
  ensureMasterState(state);

  const holding = findHoldingForSell(state, options);
  if (!holding) {
    return {
      ok: false,
      reason: "MASTER 보유종목 없음"
    };
  }

  const ownerStrategy = getStrategyOfHolding(holding);
  const requestedStrategy = normalizeStrategy(options.strategy);

  if (
    requestedStrategy &&
    ownerStrategy &&
    requestedStrategy !== ownerStrategy &&
    options.allowCrossStrategySell !== true
  ) {
    return {
      ok: false,
      reason:
        `전략 소유권 불일치 / 보유 ${ownerStrategy} / 요청 ${requestedStrategy}`
    };
  }

  const price = Math.abs(toNumber(options.price));
  if (price <= 0) {
    return {
      ok: false,
      reason: "매도가 오류"
    };
  }

  const qty = getHoldingQty(holding);
  if (qty <= 0) {
    return {
      ok: false,
      reason: "보유수량 오류"
    };
  }

  const buyPrice = Math.abs(toNumber(holding.buyPrice));
  const buyAmount = Math.max(
    0,
    toNumber(holding.buyAmount, buyPrice * qty)
  );
  const proceeds = price * qty;
  const profit = proceeds - buyAmount;
  const profitRate =
    buyAmount > 0 ? (profit / buyAmount) * 100 : 0;

  const timestampMs = Number(options.timestampMs || Date.now());

  const tradeLog = {
    ...(options.tradeLog || {}),
    type:
      String(
        options.logType ||
        `${ownerStrategy || requestedStrategy || "MASTER"}_SELL`
      ).toUpperCase(),
    strategy: ownerStrategy || requestedStrategy || "MASTER",
    strategyGroup: ownerStrategy || requestedStrategy || "MASTER",
    ownerStrategy: ownerStrategy || requestedStrategy || "MASTER",
    code: normalizeCode(holding.code),
    name: holding.name || normalizeCode(holding.code),
    price,
    sellPrice: price,
    qty,
    proceeds,
    buyAmount,
    profit,
    profitRate,
    positionId: holding.positionId || null,
    date: options.date || todayKey(),
    time: options.time || nowText(),
    timestampMs,
    reason: options.reason || options.tradeLog?.reason || "매도조건 충족"
  };

  state.totalCash = toNumber(state.totalCash) + proceeds;
  state.holdings = state.holdings.filter(item => item !== holding);
  state.tradeLogs.push(tradeLog);

  return {
    ok: true,
    state,
    holding,
    tradeLog,
    proceeds,
    profit,
    profitRate,
    totalCash: state.totalCash
  };
}

function getPortfolioSummary(state) {
  ensureMasterState(state);

  const equity = getEquity(state);
  const totalExposure = getTotalExposure(state);
  const totalCash = Math.max(0, toNumber(state.totalCash));
  const initialCapital = Math.max(
    1,
    toNumber(state.initialCapital, MASTER_INITIAL_CAPITAL)
  );

  const strategies = {};

  for (const strategy of STRATEGIES) {
    const config = getStrategyConfig(state, strategy);
    const exposure = getStrategyExposure(state, strategy);
    const holdingCount = getStrategyHoldingCount(state, strategy);

    strategies[strategy] = {
      enabled: config.enabled === true,
      status: config.status,
      allocationRate: config.allocationRate,
      exposure: Math.floor(exposure),
      holdingCount,
      exposureRate: equity > 0 ? exposure / equity : 0
    };
  }

  return {
    accountName: "SY Quant MASTER",
    initialCapital: Math.floor(initialCapital),
    totalCash: Math.floor(totalCash),
    totalExposure: Math.floor(totalExposure),
    totalAsset: Math.floor(equity),
    totalReturnRate:
      ((equity - initialCapital) / initialCapital) * 100,
    holdingCount: state.holdings.length,
    reserveCash: Math.floor(getReserveCashAmount(state)),
    exposureLimit: Math.floor(getExposureLimitAmount(state)),
    availableCash: getAvailableCash(state).availableCash,
    allocationMode: state.portfolioControl.allocationMode,
    strategyAllocationEnforced:
      state.portfolioControl.strategyAllocationEnforced === true,
    strategies
  };
}

function readJsonSafe(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;

  const text = fs.readFileSync(filePath, "utf8");
  if (!text.trim()) return fallback;
  return JSON.parse(text);
}

function writeJsonAtomic(filePath, value) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tempPath = path.join(
    dir,
    `.${base}.${process.pid}.${Date.now()}.tmp`
  );

  fs.writeFileSync(
    tempPath,
    JSON.stringify(value, null, 2),
    "utf8"
  );

  const fd = fs.openSync(tempPath, "r");
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  fs.renameSync(tempPath, filePath);
}

function acquireMasterLock(options = {}) {
  const timeoutMs = Math.max(100, toNumber(options.timeoutMs, 3000));
  const staleMs = Math.max(1000, toNumber(options.staleMs, 15000));
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      fs.mkdirSync(MASTER_LOCK_DIR);
      fs.writeFileSync(
        path.join(MASTER_LOCK_DIR, "owner.json"),
        JSON.stringify({
          pid: process.pid,
          acquiredAt: Date.now()
        }),
        "utf8"
      );
      return true;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;

      try {
        const stat = fs.statSync(MASTER_LOCK_DIR);
        if (Date.now() - stat.mtimeMs > staleMs) {
          fs.rmSync(MASTER_LOCK_DIR, {
            recursive: true,
            force: true
          });
          continue;
        }
      } catch (_) {
        // 다른 프로세스가 방금 해제한 경우 다음 반복에서 재시도
      }

      sleepSync(25);
    }
  }

  throw new Error(
    `MASTER 계좌 잠금 시간초과 ${timeoutMs}ms`
  );
}

function releaseMasterLock() {
  try {
    fs.rmSync(MASTER_LOCK_DIR, {
      recursive: true,
      force: true
    });
  } catch (_) {}
}

function loadMasterState() {
  const state = readJsonSafe(
    MASTER_STATE_FILE,
    {
      initialCapital: MASTER_INITIAL_CAPITAL,
      totalCash: MASTER_INITIAL_CAPITAL,
      holdings: [],
      tradeLogs: []
    }
  );

  return ensureMasterState(state || {});
}

function saveMasterState(state) {
  ensureMasterState(state);
  state.updatedAt = nowText();
  writeJsonAtomic(MASTER_STATE_FILE, state);
  return state;
}

function withMasterTransaction(mutator, options = {}) {
  if (typeof mutator !== "function") {
    throw new Error("mutator 함수가 필요합니다.");
  }

  acquireMasterLock(options);

  try {
    const state = loadMasterState();
    const result = mutator(state);

    if (
      result &&
      typeof result.then === "function"
    ) {
      throw new Error(
        "withMasterTransaction은 동기 mutator만 지원합니다."
      );
    }

    if (result?.ok === false && options.saveOnReject !== true) {
      return result;
    }

    saveMasterState(state);

    return result === undefined
      ? { ok: true, state }
      : result;
  } finally {
    releaseMasterLock();
  }
}

function executeBuy(options = {}) {
  return withMasterTransaction(
    state => requestBuy(state, options),
    options.lockOptions || {}
  );
}

function executeSell(options = {}) {
  return withMasterTransaction(
    state => requestSell(state, options),
    options.lockOptions || {}
  );
}

function setStrategyControl(state, strategy, patch = {}) {
  ensureMasterState(state);

  const normalized = normalizeStrategy(strategy);
  if (!normalized) {
    return {
      ok: false,
      reason: "지원하지 않는 전략"
    };
  }

  const current = getStrategyConfig(state, normalized);

  if (patch.enabled !== undefined) {
    current.enabled = patch.enabled === true;
  }

  if (patch.status !== undefined) {
    const status = String(patch.status).toUpperCase();
    if (!["ACTIVE", "REDUCED", "PAUSED"].includes(status)) {
      return {
        ok: false,
        reason: "status는 ACTIVE / REDUCED / PAUSED만 가능"
      };
    }
    current.status = status;
  }

  if (patch.allocationRate !== undefined) {
    current.allocationRate =
      patch.allocationRate === null
        ? null
        : clamp(patch.allocationRate, 0, 1);
  }

  return {
    ok: true,
    strategy: normalized,
    config: clone(current)
  };
}


function setAllStrategyStatus(state, status) {
  ensureMasterState(state);

  const normalizedStatus = String(status || "").trim().toUpperCase();
  if (!["ACTIVE", "PAUSED"].includes(normalizedStatus)) {
    return {
      ok: false,
      reason: "전체 전략 status는 ACTIVE / PAUSED만 가능"
    };
  }

  const changed = {};
  for (const strategy of STRATEGIES) {
    const result = setStrategyControl(state, strategy, {
      status: normalizedStatus
    });

    if (!result.ok) return result;
    changed[strategy] = clone(result.config);
  }

  return {
    ok: true,
    status: normalizedStatus,
    strategies: changed
  };
}


module.exports = {
  MASTER_STATE_FILE,
  MASTER_INITIAL_CAPITAL,
  STRATEGIES,
  DEFAULT_PORTFOLIO_CONTROL,

  ensureMasterState,
  ensurePortfolioControl,

  normalizeCode,
  normalizeStrategy,
  getEquity,
  getTotalExposure,
  getTotalCostExposure,
  getStrategyExposure,
  getStrategyHoldingCount,
  getAvailableCash,
  getPortfolioSummary,

  getStrategyConfig,
  canStrategyTrade,
  isDuplicateHolding,
  findHoldingByCode,
  canBuy,

  requestBuy,
  requestSell,

  loadMasterState,
  saveMasterState,
  withMasterTransaction,
  executeBuy,
  executeSell,

  setStrategyControl,
  setAllStrategyStatus,

  __test: {
    getHoldingMarketValue,
    getHoldingCost,
    getReserveCashAmount,
    getExposureLimitAmount,
    getStrategyAllocationLimitAmount,
    makePositionId
  }
};
