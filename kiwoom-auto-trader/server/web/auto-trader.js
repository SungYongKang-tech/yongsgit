const fs = require("fs");
const path = require("path");

const STATE_FILE = path.join(__dirname, "paper-state.json");

const API_BASE = "http://localhost:3000";


const settings = {
  buyStartTime: "09:20",
  buyEndTime: "14:40",
  safeMinScore: 10,
  trendMinScore: 10,
  blockStoppedToday: true,

  totalCash: 100000000,

  coreRatio: 0.8,
  turboRatio: 0.2,

  maxHoldingCount: 8,
  coreMaxHoldingCount: 8,
  turboMaxHoldingCount: 4,

  perBuyAmount: 10000000,
  minBuyAmount: 3000000,

  dailyLossLimitRate: 0.01,
  maxConsecutiveLoss: 3,

  discoverLimit: 300,
  minScore: 9,
  buyCooldownMinutes: 10,

  tradeStart: "09:05",
  tradeEnd: "15:20",
  testMode: false,

  targetProfitRate: 999,
  trailingStartRate: 3,
  stopLossRate: -1.8,
  trailingStopRate: 2.5,

  firstTakeProfitRate: 3.0,
  firstTakeProfitSellRatio: 0.5,
  firstTakeProfitMinRemainQty: 1,

  breakEvenTriggerRate: 2.5,
  breakEvenSellRate: 0.8,

  endProfitSellTime: "15:10",
  endProfitSellOnlyPositive: true,

  turboEnabled: true,
turboStartTime: "09:00",
turboEndTime: "11:00",
turboForceSellTime: "11:00",

turboMinScore: 10,
turboWatchMinDayRiseRate: 1.0,


turboBuyMinDayRiseRate: 2.0,
turboBuyMaxDayRiseRate: 4.5,

turboMinVolume: 300000,
turboMinOpenPositionRate: 1.5,

turboStopLossRate: -1.0,
turboTakeProfitRate: 3.0,
turboTakeProfitSellRatio: 0.5,
turboTrailingStartRate: 2.0,
turboTrailingStopRate: 0.7,

turboMaxDailyBuyCount: 6,
turboMaxConsecutiveLoss: 3,
turboMinOneMinuteRiseRate: 0.25,

waveEnabled: true,
waveStartTime: "11:00",
waveEndTime: "14:30",
waveForceSellTime: "14:30",

waveMaxHoldingCount: 3,
waveMaxDailyBuyCount: 2,

waveMinMorningRiseRate: 3.0,
waveMinPullbackRate: 2.0,
waveMaxPullbackRate: 6.0,
waveMinReboundRate: 0.8,

waveStopLossRate: -1.5,
waveTakeProfitRate: 4.0,
waveTakeProfitSellRatio: 0.5,
waveTrailingStartRate: 3.0,
waveTrailingStopRate: 1.5,

leaderCoreEnabled: true,

leaderCoreMinScore: 10,
leaderCoreMinChangeRate: 1.5,
leaderCoreMaxChangeRate: 7.0,

leaderCoreMinVolume: 300000,
leaderCoreMinTradeValue: 2000000000, // 20억

leaderCoreMaxHoldingCount: 8,


};



let isRunning = false;

function isBetweenTime(start, end) {
  const now = new Date();
  const hhmm =
    String(now.getHours()).padStart(2, "0") +
    ":" +
    String(now.getMinutes()).padStart(2, "0");

  return hhmm >= start && hhmm <= end;
}


function loadState() {
  if (!fs.existsSync(STATE_FILE)) {
    return {
  holdings: [],
  tradeLogs: [],
  virtualResults: [],
  lastRunAt: null,
  lastSellCheckAt: null,
  serverAutoEnabled: true,
  totalCash: Math.floor(settings.totalCash * settings.coreRatio),
  turboCash: Math.floor(settings.totalCash * settings.turboRatio),
  budgetInitialized: true,
  turboSnapshots: {}
};
  }

  const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));

  if (state.serverAutoEnabled === undefined) {
    state.serverAutoEnabled = true;
  }

  if (!Array.isArray(state.holdings)) {
    state.holdings = [];
  }

  if (!Array.isArray(state.tradeLogs)) {
    state.tradeLogs = [];
  }

  if (!Array.isArray(state.virtualResults)) {
    state.virtualResults = [];
  }

 if (typeof state.totalCash === "undefined") {
  state.totalCash = settings.totalCash;
}

if (!state.budgetInitialized) {
  const holdingsValue = (state.holdings || []).reduce((sum, holding) => {
    return sum +
      Number(holding.currentPrice || holding.buyPrice || 0) *
      Number(holding.qty || 0);
  }, 0);

  const existingTotalAsset =
    Number(state.totalCash || 0) +
    Number(state.turboCash || 0) +
    holdingsValue;

  const baseAsset =
    existingTotalAsset > 0
      ? existingTotalAsset
      : settings.totalCash;

  state.totalCash = Math.floor(baseAsset * settings.coreRatio);
  state.turboCash = Math.floor(baseAsset * settings.turboRatio);
  state.budgetInitialized = true;
}

if (typeof state.turboCash === "undefined") {
  state.turboCash = 0;
}

if (!state.turboSnapshots) {
  state.turboSnapshots = {};
}

if (!state.waveCandidates) {
  state.waveCandidates = {};
}

if (!state.waveSnapshots) {
  state.waveSnapshots = {};
}

  return state;
}

function getBudgetInfo(state) {
  const holdingsValue = (state.holdings || []).reduce((sum, holding) => {
    return sum +
      Number(holding.currentPrice || holding.buyPrice || 0) *
      Number(holding.qty || 0);
  }, 0);

  const totalAsset =
    Number(state.totalCash || 0) +
    Number(state.turboCash || 0) +
    holdingsValue;

  const coreBudget = Math.floor(totalAsset * settings.coreRatio);
  const turboBudget = Math.floor(totalAsset * settings.turboRatio);

  const corePerBuyAmount = Math.floor(coreBudget / settings.coreMaxHoldingCount);
  const turboPerBuyAmount = Math.floor(turboBudget / settings.turboMaxHoldingCount);

  return {
    totalAsset,
    coreBudget,
    turboBudget,
    corePerBuyAmount,
    turboPerBuyAmount,
  };
}

function rebalanceCashIfNoHoldings(state, reason = "자동 재배분") {
  const holdings = state.holdings || [];

  if (holdings.length > 0) {
    return false;
  }

  const totalAsset =
    Number(state.totalCash || 0) +
    Number(state.turboCash || 0);

  if (!Number.isFinite(totalAsset) || totalAsset <= 0) {
    return false;
  }

  const coreCash = Math.floor(totalAsset * settings.coreRatio);
  const turboCash = totalAsset - coreCash;

  state.totalCash = coreCash;
  state.turboCash = turboCash;
  state.budgetInitialized = true;
  state.lastRebalancedAt = nowText();
  state.lastRebalanceReason = reason;

  console.log(
    `[자금 재배분] ${reason} / 총자산 ${totalAsset.toLocaleString()}원 ` +
    `/ CORE ${coreCash.toLocaleString()}원 / TURBO ${turboCash.toLocaleString()}원`
  );

  return true;
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function nowText() {
  return new Date().toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul"
  });
}

function isLeaderCoreCandidate(item, marketTemperature) {
  const score = Number(item.discoverScore || 0);
  const changeRate = Number(item.changeRate || 0);
  const volume = Number(item.volume || 0);
  const currentPrice = Number(item.currentPrice || item.price || 0);

  const tradeValue = currentPrice * volume;

  if (score < settings.leaderCoreMinScore) return false;

  if (changeRate < settings.leaderCoreMinChangeRate) return false;
  if (changeRate > settings.leaderCoreMaxChangeRate) return false;

  if (volume < settings.leaderCoreMinVolume) return false;
  if (tradeValue < settings.leaderCoreMinTradeValue) return false;

  if (
    marketTemperature &&
    (marketTemperature.level === "COLD" || marketTemperature.level === "CAUTION")
  ) {
    return false;
  }

  return true;
}

function todayKey() {
  return new Date().toLocaleDateString("sv-SE", {
    timeZone: "Asia/Seoul"
  });
}


function getCurrentTotalAsset(state) {
  const holdingsValue = (state.holdings || []).reduce((sum, holding) => {
    return sum + Number(holding.currentPrice || holding.buyPrice || 0) * Number(holding.qty || 0);
  }, 0);

  return Number(state.totalCash || 0) + Number(state.turboCash || 0) + holdingsValue;
}

function initDailyLossLimitIfNeeded(state) {
  const today = todayKey();

  if (state.dailyLossDate !== today) {
    state.dailyLossDate = today;
    state.dailyBuyStopped = false;
    state.dailyStartAsset = getCurrentTotalAsset(state);
    state.dailyLossLimit = Math.floor(
      state.dailyStartAsset * settings.dailyLossLimitRate
    );

    console.log(
      `[일일 손실한도 초기화] 시작총자산 ${state.dailyStartAsset.toLocaleString()}원 / 한도 ${state.dailyLossLimit.toLocaleString()}원`
    );
  }
}

function getTodayRealizedProfit(state) {
  const today = todayKey();

  return (state.tradeLogs || [])
    .filter((log) =>
      log.date === today &&
      typeof log.profit !== "undefined"
    )
    .reduce((sum, log) => sum + Number(log.profit || 0), 0);
}

function isDailyLossLimitReached(state) {
  initDailyLossLimitIfNeeded(state);

  const todayProfit = getTodayRealizedProfit(state);
  const limit = Number(state.dailyLossLimit || 0);

  if (limit <= 0) return false;

  return todayProfit <= -Math.abs(limit);
}

function getConsecutiveLossCount(state) {
  const results = [
    ...(state.virtualResults || []),
    ...(state.results || [])
  ];

  const sorted = results
    .filter((item) => item.sellTime)
    .sort((a, b) => new Date(b.sellTime) - new Date(a.sellTime));

  let count = 0;

  for (const item of sorted) {
    const profit = Number(item.profit || 0);

    if (profit < 0) {
      count++;
    } else {
      break;
    }
  }

  return count;
}

function isConsecutiveLossLimitReached(state) {
  return getConsecutiveLossCount(state) >= settings.maxConsecutiveLoss;
}

function isBuyCooldownActive(state) {
  if (!state.lastRunAt) return false;

  const lastRunTime = new Date(state.lastRunAt).getTime();

  if (!lastRunTime || Number.isNaN(lastRunTime)) return false;

  const elapsedMinutes = (Date.now() - lastRunTime) / 1000 / 60;

  return elapsedMinutes < settings.buyCooldownMinutes;
}


function isTradeTime() {
  if (settings.testMode) return true;

  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const current = `${hh}:${mm}`;

  return current >= settings.tradeStart && current <= settings.tradeEnd;
}

function isAfterEndProfitSellTime() {
  const now = new Date();

  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const current = `${hh}:${mm}`;

  return current >= settings.endProfitSellTime;
}


function isAlreadyHolding(state, code) {
  return state.holdings.some((item) => item.code === code);
}

function getCoreHoldingCount(state) {
  return (state.holdings || []).filter(
    (item) => item.strategyGroup !== "TURBO"
  ).length;
}




function isRecentlySold(state, code) {
  const today = todayKey();

  const results = [
    ...(state.virtualResults || []),
    ...(state.results || [])
  ];

  const todaySold = results.some((item) => {
    return (
      item.code === code &&
      item.sellTime &&
      item.date === today
    );
  });

  return todaySold;
}



function getTimeBasedMaxHolding() {
  const now = new Date();
  const hhmm =
    String(now.getHours()).padStart(2, "0") +
    ":" +
    String(now.getMinutes()).padStart(2, "0");

  if (hhmm < "09:20") return 0;
  if (hhmm < "09:40") return 3;
  if (hhmm < "10:00") return 5;
  if (hhmm < "13:00") return 7;

  return settings.maxHoldingCount;
}


function getAvailableSlots(state) {
  const timeMaxHolding = getTimeBasedMaxHolding();

  return Math.max(0, timeMaxHolding - getCoreHoldingCount(state));
}

async function fetchJson(url) {
  const res = await fetch(url);
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.message || "API 오류");
  }

  return data;
}

async function fetchPrice(code) {
  return await fetchJson(`${API_BASE}/api/price?code=${code}`);
}

async function discoverCandidates() {
  const data = await fetchJson(
    `${API_BASE}/api/discover?limit=${settings.discoverLimit}`
  );

  const items = data.items || [];

  return items
    .filter((item) => Number(item.discoverScore || 0) >= settings.minScore)
    .sort((a, b) => Number(b.discoverScore || 0) - Number(a.discoverScore || 0));
}

async function runBacktestWithPreset(code, preset) {
  const data = await fetchJson(
    `${API_BASE}/api/backtest?code=${code}&preset=${preset}`
  );

  return data;
}

async function findBestStrategy(code) {
  const presets = [
    { key: "trend", name: "추세형" },
    { key: "short", name: "단타형" },
    { key: "safe", name: "안정형" }
  ];

  const results = [];

  for (const preset of presets) {
    try {
      const result = await runBacktestWithPreset(code, preset.key);

      results.push({
        ...preset,
        profitRate: Number(result.finalProfitRate || result.profitRate || 0),
        winRate: Number(result.winRate || 0),
        tradeCount: Number(result.tradeCount || 0),
        passed: result.passed !== false
      });
    } catch (err) {
      console.warn("백테스트 실패:", code, preset.name, err.message);
    }
  }

  const valid = results.filter(item =>
  item.passed &&
  item.tradeCount >= 2 &&
  item.profitRate > 0
);

// 1순위 : 단타형
const short = valid.find(item =>
  item.key === "short" &&
  item.winRate >= 50
);

if (short) {
  return short;
}

// 2순위 : 추세형
const trend = valid.find(item =>
  item.key === "trend" &&
  item.winRate >= 40
);

if (trend) {
  return trend;
}

// 안정형은 당분간 제외
return null;
}

function wasStoppedToday(state, code) {
  const today = todayKey();

  const logs = [
    ...(state.virtualResults || []),
    ...(state.tradeLogs || [])
  ];

  return logs.some((item) =>
    item.code === code &&
    item.date === today &&
    (
      item.type === "STOP_LOSS" ||
      item.actionType === "STOP_LOSS" ||
      String(item.reason || "").includes("손절") ||
      Number(item.profit || 0) < 0
    )
  );
}

function isStrategyBlocked(state, strategyPreset) {
  const recent = (state.virtualResults || [])
    .filter((item) =>
      item.strategyPreset === strategyPreset &&
      item.date &&
      typeof item.profitRate !== "undefined"
    )
    .slice(-10);

  if (recent.length < 5) return false;

  const totalRate = recent.reduce(
    (sum, item) => sum + Number(item.profitRate || 0),
    0
  );

  return totalRate < -3;
}

function wasBoughtToday(state, code) {
  return (state.tradeLogs || []).some((item) =>
    item.type === "BUY" &&
    item.code === code &&
    item.date === todayKey()
  );
}

function getSafeStockName(item, priceData = {}) {
  const code = String(item.code || priceData.code || "").trim();

  const candidates = [
    priceData.name,
    item.name,
    item.stockName,
    item.korName
  ];

  for (const name of candidates) {
    const cleanName = String(name || "").trim();

    if (
      cleanName &&
      cleanName !== code &&
      !/^\d{6}$/.test(cleanName)
    ) {
      return cleanName;
    }
  }

  return code;
}

function paperBuy(state, item, strategy, buyAmountLimit = settings.perBuyAmount) {
  if (!isTradeTime()) {
    console.log("[모의매수 차단] 거래 가능 시간이 아닙니다.", item?.name);
    return false;
  }

  if (state.holdings.some((h) => h.code === item.code)) {
    console.log("[모의매수 제외] 이미 보유중", item.name);
    return false;
  }

const price = Number(item.currentPrice || item.price || 0);
if (!price || price <= 0) return false;

const availableCash = Number(
  state.totalCash || settings.totalCash || 0
);

// 현재 자산으로 가능한 최대 종목 수
const dynamicMaxHolding = Math.min(
  settings.maxHoldingCount,
  getTimeBasedMaxHolding(),
  Math.max(
    1,
    Math.floor(
      availableCash / settings.minBuyAmount
    )
  )
);

// 남은 슬롯(Core 기준, Turbo 보유종목 제외)
const remainSlots = Math.max(
  1,
  dynamicMaxHolding - getCoreHoldingCount(state)
);

const budget = getBudgetInfo(state);

const safeBuyAmountLimit = Number(
  buyAmountLimit || budget.corePerBuyAmount || settings.minBuyAmount || 10000000
);

// 종목당 투자금
const buyAmount = Math.min(
  safeBuyAmountLimit,
  Math.floor(availableCash / remainSlots)
);

// 실제 수량
const qty = Math.floor(buyAmount / price);

// 수량 계산 오류 방지
if (!Number.isFinite(buyAmount) || buyAmount <= 0 || !Number.isFinite(qty) || qty <= 0) {
  console.log("[모의매수 차단] 수량 계산 오류", {
    name: item.name,
    code: item.code,
    price,
    buyAmount,
    buyAmountLimit,
    safeBuyAmountLimit,
    availableCash,
    remainSlots
  });
  return false;
}



  const holding = {
  code: item.code,
  name: item.name && item.name !== item.code ? item.name : (item.stockName || item.korName || item.code),
  buyPrice: price,
  qty,
  buyAmount: price * qty,
  plannedBuyAmount: buyAmount,
  currentPrice: price,
  highestPrice: price,
  autoTrade: true,
  lowestPrice: price,
maxProfitRate: 0,
maxLossRate: 0,

  strategyGroup: "CORE",

  strategyPreset: strategy.key,
  strategyName: settings.leaderCoreEnabled
  ? `Leader Core-${strategy.name}`
  : strategy.name,
  discoverScore: Number(item.discoverScore || 0),
  discoverReasons: Array.isArray(item.discoverReasons)
    ? item.discoverReasons
    : [],
  discoverScoreDetails: item.discoverScoreDetails || {},
  protectMinutes: 5,
  buyTime: nowText(),
  buyTimeMs: Date.now(),
  buyAt: new Date().toISOString(),
  date: todayKey()
};

  state.holdings.push(holding);
  state.totalCash = availableCash - price * qty;

 state.tradeLogs.push({
  type: "BUY",
  strategyGroup: "CORE",

  code: item.code,
  name: item.name,
  price,
  buyPrice: price,      // 추가
  qty,

  buyAmount: price * qty,
  plannedBuyAmount: buyAmount,

  changeRate: Number(   // 추가
    item.changeRate ||
    item.fluctuationRate ||
    item.riseRate ||
    item.rate ||
    0
  ),

  volume: Number(item.volume || 0),   // 추가

  marketTemperature: state.marketTemperature || null, // 추가

  remainCashAfterBuy: state.totalCash,
  dynamicMaxHolding,
  remainSlotsAfterBuy: Math.max(
    0,
    dynamicMaxHolding - getCoreHoldingCount(state)
  ),

  discoverScore: Number(item.discoverScore || 0),
  strategyPreset: strategy.key,
  strategyName: settings.leaderCoreEnabled
  ? `Leader Core-${strategy.name}`
  : strategy.name,
  reason: settings.leaderCoreEnabled
  ? `Leader Core 대장주 조건 통과 / 최고전략 ${strategy.name} / 백테스트 수익률 ${strategy.profitRate.toFixed(2)}%`
  : `서버 자동 모의매수 / 최고전략 ${strategy.name} / 백테스트 수익률 ${strategy.profitRate.toFixed(2)}%`,
  date: todayKey(),
  time: nowText()
});

  

  return true;
}

function getTurboHoldingCount(state) {
  return (state.holdings || []).filter(
    (item) => item.strategyGroup === "TURBO"
  ).length;
}

function wasTurboBoughtToday(state, code) {
  return (state.tradeLogs || []).some((log) =>
    log.code === code &&
    log.date === todayKey() &&
    log.type === "TURBO_BUY"
  );
}

function getTodayTurboBuyCount(state) {
  return (state.tradeLogs || []).filter((log) =>
    log.date === todayKey() &&
    log.type === "TURBO_BUY"
  ).length;
}

function getTurboConsecutiveLossCount(state) {
  const turboSells = (state.tradeLogs || [])
    .filter((log) =>
      log.strategyGroup === "TURBO" &&
      log.date === todayKey() &&
      [
        "TURBO_STOP_LOSS",
        "TURBO_TAKE_PROFIT",
        "TURBO_TRAILING_STOP",
        "TURBO_TIME_EXIT",
        "TURBO_FIRST_TAKE_PROFIT"
      ].includes(log.type)
    )
    .reverse();

  let count = 0;

  for (const log of turboSells) {
    if (Number(log.profit || 0) < 0) {
      count++;
    } else {
      break;
    }
  }

  return count;
}

function isViLikeItem(item) {
  const rawText = JSON.stringify(item.raw || item || "");
  return rawText.includes("VI");
}

function checkTurboLeaderCandidate(item, currentPrice) {
  const dayRiseRate = Number(
    item.changeRate ||
    item.fluctuationRate ||
    item.riseRate ||
    item.rate ||
    0
  );

  const openPrice = Number(item.open || item.openPrice || 0);
  const highPrice = Number(item.high || item.highPrice || 0);
  const lowPrice = Number(item.low || item.lowPrice || 0);
  const volume = Number(item.volume || 0);

  if (dayRiseRate < settings.turboBuyMinDayRiseRate) {
    return { pass: false, reason: `상승률 부족 ${dayRiseRate.toFixed(2)}%` };
  }

  if (dayRiseRate > settings.turboBuyMaxDayRiseRate) {
    return { pass: false, reason: `상승률 과다 ${dayRiseRate.toFixed(2)}%` };
  }

  if (volume < settings.turboMinVolume) {
    return { pass: false, reason: `거래량 부족 ${volume.toLocaleString()}` };
  }

  if (openPrice > 0) {
    const openPositionRate = ((currentPrice - openPrice) / openPrice) * 100;

    if (openPositionRate < settings.turboMinOpenPositionRate) {
      return {
        pass: false,
        reason: `시가대비 힘 부족 ${openPositionRate.toFixed(2)}%`
      };
    }
  }

  if (highPrice > 0 && lowPrice > 0 && currentPrice > 0) {
    const range = highPrice - lowPrice;

    if (range > 0) {
      const position = ((currentPrice - lowPrice) / range) * 100;

      if (position < 55) {
        return {
          pass: false,
          reason: `당일 위치 약함 ${position.toFixed(1)}%`
        };
      }
    }
  }

  return {
    pass: true,
    reason: `대장주 선점 조건 통과 · 상승률 ${dayRiseRate.toFixed(2)}%`
  };
}

function paperTurboBuy(state, item, currentPrice) {
  if (!settings.turboEnabled) return false;

  if (getTodayTurboBuyCount(state) >= settings.turboMaxDailyBuyCount) {
    console.log("[TURBO 매수제외] 하루 최대 진입 횟수 도달");
    return false;
  }

  if (getTurboConsecutiveLossCount(state) >= settings.turboMaxConsecutiveLoss) {
    console.log("[TURBO 매수제외] 연속 손절 제한 도달");
    return false;
  }

  if (getTurboHoldingCount(state) >= settings.turboMaxHoldingCount) {
    console.log("[TURBO 매수제외] 최대 보유종목 도달");
    return false;
  }

  if (isAlreadyHolding(state, item.code)) {
    console.log("[TURBO 매수제외] 이미 보유중", item.name);
    return false;
  }

  if (wasTurboBoughtToday(state, item.code)) {
    console.log("[TURBO 매수제외] 오늘 이미 Turbo 매수", item.name);
    return false;
  }

  const price = Number(currentPrice || item.currentPrice || item.price || 0);
  if (!price || price <= 0) return false;

  const budget = getBudgetInfo(state);
  const availableCash = Number(state.turboCash || 0);
  const buyAmount = Math.min(budget.turboPerBuyAmount, availableCash);
  const qty = Math.floor(buyAmount / price);

  if (qty <= 0) {
    console.log("[TURBO 매수제외] Turbo 현금 부족");
    return false;
  }

  const holding = {
    code: item.code,
    name: item.name || item.stockName || item.korName || item.code,
    buyPrice: price,
    qty,
    buyAmount: price * qty,
    plannedBuyAmount: buyAmount,
    currentPrice: price,
    highestPrice: price,
    autoTrade: true,
    lowestPrice: price,
maxProfitRate: 0,
maxLossRate: 0,
    strategyGroup: "TURBO",
    strategyPreset: "turbo",
    strategyName: "터보형",
    discoverScore: Number(item.discoverScore || 0),
    discoverReasons: Array.isArray(item.discoverReasons)
      ? item.discoverReasons
      : [],
    buyTime: nowText(),
    buyTimeMs: Date.now(),
    buyAt: new Date().toISOString(),
    date: todayKey()
  };

  state.holdings.push(holding);
  state.turboCash = availableCash - price * qty;

  state.tradeLogs.push({
    type: "TURBO_BUY",
    strategyGroup: "TURBO",

    code: item.code,
    name: holding.name,

    price,
    buyPrice: price,
    qty,

    buyAmount: price * qty,
    plannedBuyAmount: buyAmount,

    changeRate: Number(
      item.changeRate ||
      item.fluctuationRate ||
      item.riseRate ||
      item.rate ||
      0
    ),

    volume: Number(item.volume || 0),

    marketTemperature: state.marketTemperature || null,

    remainTurboCashAfterBuy: state.turboCash,

    discoverScore: Number(item.discoverScore || 0),

    reason: "Turbo 조건 충족 자동 모의매수",

    date: todayKey(),
    time: nowText()
  });

  console.log(
    `[TURBO 매수] ${holding.name} ${holding.code} / ${price}원 / ${qty}주`
  );

  return true;
}

function getWaveHoldingCount(state) {
  return (state.holdings || []).filter(
    (item) => item.strategyGroup === "WAVE"
  ).length;
}

function getTodayWaveBuyCount(state) {
  return (state.tradeLogs || []).filter((log) =>
    log.date === todayKey() &&
    log.type === "WAVE_BUY"
  ).length;
}

function wasWaveBoughtToday(state, code) {
  return (state.tradeLogs || []).some((log) =>
    log.code === code &&
    log.date === todayKey() &&
    log.type === "WAVE_BUY"
  );
}

function rememberWaveCandidate(state, item, priceData, currentPrice) {
  if (!state.waveCandidates) state.waveCandidates = {};

  const highPrice = Number(priceData.high || item.high || 0);
  const openPrice = Number(priceData.open || item.open || 0);
  const dayRiseRate = Number(
    priceData.changeRate ||
    item.changeRate ||
    item.fluctuationRate ||
    item.riseRate ||
    item.rate ||
    0
  );

  if (dayRiseRate < settings.waveMinMorningRiseRate) return;

  const prev = state.waveCandidates[item.code] || {};

  state.waveCandidates[item.code] = {
    code: item.code,
    name: priceData.name || item.name || item.code,
    morningHigh: Math.max(
      Number(prev.morningHigh || 0),
      highPrice,
      currentPrice
    ),
    morningRiseRate: Math.max(
      Number(prev.morningRiseRate || 0),
      dayRiseRate
    ),
    openPrice,
    volume: Number(priceData.volume || item.volume || 0),
    discoverScore: Number(item.discoverScore || 0),
    detectedAt: prev.detectedAt || nowText(),
    lastSeenAt: nowText()
  };
}

function checkWaveCandidate(candidate, priceData) {
  const currentPrice = Number(priceData.currentPrice || 0);
  const highPrice = Number(candidate.morningHigh || 0);
  const lowPrice = Number(priceData.low || 0);

  if (!currentPrice || !highPrice || !lowPrice) {
    return { pass: false, reason: "가격 데이터 부족" };
  }

  const pullbackRate = ((highPrice - currentPrice) / highPrice) * 100;
  const reboundRate = ((currentPrice - lowPrice) / lowPrice) * 100;

  if (Number(candidate.morningRiseRate || 0) < settings.waveMinMorningRiseRate) {
    return { pass: false, reason: "오전 강세 부족" };
  }

  if (
    pullbackRate < settings.waveMinPullbackRate ||
    pullbackRate > settings.waveMaxPullbackRate
  ) {
    return {
      pass: false,
      reason: `눌림 범위 미충족 ${pullbackRate.toFixed(2)}%`
    };
  }

  if (reboundRate < settings.waveMinReboundRate) {
    return {
      pass: false,
      reason: `저점 반등 부족 ${reboundRate.toFixed(2)}%`
    };
  }

  return {
    pass: true,
    pullbackRate,
    reboundRate,
    reason: `WAVE 조건 통과 · 눌림 ${pullbackRate.toFixed(2)}% / 반등 ${reboundRate.toFixed(2)}%`
  };
}

function paperWaveBuy(state, candidate, currentPrice) {
  if (!settings.waveEnabled) return false;

  if (getWaveHoldingCount(state) >= settings.waveMaxHoldingCount) {
    console.log("[WAVE 매수제외] 최대 보유종목 도달");
    return false;
  }

  if (getTodayWaveBuyCount(state) >= settings.waveMaxDailyBuyCount) {
    console.log("[WAVE 매수제외] 하루 최대 진입 횟수 도달");
    return false;
  }

  if (isAlreadyHolding(state, candidate.code)) {
    console.log("[WAVE 매수제외] 이미 보유중", candidate.name);
    return false;
  }

  if (wasWaveBoughtToday(state, candidate.code)) {
    console.log("[WAVE 매수제외] 오늘 이미 WAVE 매수", candidate.name);
    return false;
  }

  const price = Number(currentPrice || 0);
  const availableCash = Number(state.turboCash || 0);

  const buyAmount = Math.min(
    Math.floor(
      availableCash /
        Math.max(1, settings.waveMaxHoldingCount - getWaveHoldingCount(state))
    ),
    availableCash
  );

  const qty = Math.floor(buyAmount / price);

  if (!price || qty <= 0) {
    console.log("[WAVE 매수제외] 현금 또는 수량 부족");
    return false;
  }

  const holding = {
    code: candidate.code,
    name: candidate.name || candidate.code,
    buyPrice: price,
    qty,
    buyAmount: price * qty,
    plannedBuyAmount: buyAmount,
    currentPrice: price,
    highestPrice: price,
    autoTrade: true,
    lowestPrice: price,
maxProfitRate: 0,
maxLossRate: 0,
    strategyGroup: "WAVE",
    strategyPreset: "wave",
    strategyName: "웨이브형",
    morningHigh: Number(candidate.morningHigh || 0),
    morningRiseRate: Number(candidate.morningRiseRate || 0),
    discoverScore: Number(candidate.discoverScore || 0),
    buyTime: nowText(),
    buyTimeMs: Date.now(),
    buyAt: new Date().toISOString(),
    date: todayKey()
  };

  state.holdings.push(holding);
  state.turboCash = availableCash - price * qty;

  state.tradeLogs.push({
    type: "WAVE_BUY",
    strategyGroup: "WAVE",

    code: holding.code,
    name: holding.name,

    price,
    buyPrice: price,
    qty,

    buyAmount: price * qty,
    plannedBuyAmount: buyAmount,

    volume: Number(candidate.volume || 0),
    morningHigh: Number(candidate.morningHigh || 0),
    morningRiseRate: Number(candidate.morningRiseRate || 0),

    marketTemperature: state.marketTemperature || null,

    remainTurboCashAfterBuy: state.turboCash,

    discoverScore: Number(candidate.discoverScore || 0),

    reason: "오전 대장주 2차 파동 WAVE 매수",

    date: todayKey(),
    time: nowText()
  });

  console.log(
    `[WAVE 매수] ${holding.name} ${holding.code} / ${price}원 / ${qty}주`
  );

  return true;
}




function paperSell(state, holding, sellPrice, reason, actionType = "SELL", sellQtyInput = null) {
  if (!holding) return false;

  if (!state.sellKeys) {
    state.sellKeys = {};
  }

  const isPartialSell =
  actionType === "FIRST_TAKE_PROFIT" ||
  actionType === "TURBO_FIRST_TAKE_PROFIT" ||
  actionType === "WAVE_FIRST_TAKE_PROFIT";

  const sellKey = `${todayKey()}_${holding.code}_${actionType}`;

  if (!isPartialSell && state.sellKeys[sellKey]) {
    console.log(`[중복매도 차단] ${holding.name} ${holding.code} ${actionType}`);
    return false;
  }

  if (!isPartialSell) {
    state.sellKeys[sellKey] = nowText();
  }

  if (holding.sold || holding.selling) {
    return false;
  }

  const holdingQty = Number(holding.qty || 0);
  const price = Number(sellPrice || 0);
  const sellQty = sellQtyInput ? Number(sellQtyInput) : holdingQty;

  if (holdingQty <= 0 || price <= 0 || sellQty <= 0 || sellQty > holdingQty) {
    return false;
  }

  holding.selling = true;

  const buyPrice = Number(holding.buyPrice || 0);
  const buyAmount = buyPrice * sellQty;
  const sellAmount = price * sellQty;
  const profit = sellAmount - buyAmount;
  const profitRate = buyAmount > 0 ? (profit / buyAmount) * 100 : 0;

  state.tradeLogs.push({
    type: actionType,
    code: holding.code,
    name: holding.name,
    price,
    qty: sellQty,
    buyPrice,
    sellPrice: price,
    buyAmount,
    sellAmount,
    profit,
    profitRate,

    highestPrice: Number(holding.highestPrice || buyPrice || 0),
lowestPrice: Number(holding.lowestPrice || buyPrice || 0),
maxProfitRate: Number(holding.maxProfitRate || 0),
maxLossRate: Number(holding.maxLossRate || 0),
holdingMinutes: holding.buyTimeMs
  ? Math.round((Date.now() - Number(holding.buyTimeMs)) / 1000 / 60)
  : 0,
buyTimeText: holding.buyTime || holding.buyTimeText || "",
sellTimeText: nowText(),

    reason: reason || "서버 매도",
    strategyPreset: holding.strategyPreset,
    strategyName: holding.strategyName,
    strategyGroup: holding.strategyGroup || "CORE",
    date: todayKey(),
    time: nowText()
  });

if (holding.strategyGroup === "TURBO" || holding.strategyGroup === "WAVE") {
  state.turboCash = Number(state.turboCash || 0) + sellAmount;
} else {
  state.totalCash = Number(state.totalCash || 0) + sellAmount;
}

  if (sellQty < holdingQty) {
    holding.qty = holdingQty - sellQty;
    holding.selling = false;
    holding.sold = false;
    holding.firstTakeProfitDone = true;
    holding.firstTakeProfitPrice = price;
    holding.firstTakeProfitAt = new Date().toISOString();

    console.log(
      `[1차 수익실현] ${holding.name} ${sellQty}주 매도 / 잔여 ${holding.qty}주 / 수익률 ${profitRate.toFixed(2)}%`
    );

    return true;
  }

  holding.sold = true;
  holding.selling = false;

  state.holdings = state.holdings.filter((item) => item.code !== holding.code);

rebalanceCashIfNoHoldings(
  state,
  `전량매도 후 자동 8:2 재배분 · ${actionType}`
);

console.log(
  `[매도완료] ${holding.name} ${sellQty}주 / ${price}원 / 수익률 ${profitRate.toFixed(2)}% / ${actionType}`
);

return true;
}










async function checkServerAutoSellOnce() {

  if (!isTradeTime()) {
    return;
  }

  const state = loadState();


  if (!state.serverAutoEnabled) {
    console.log("서버 자동매매 OFF 상태입니다.");
    return;
  }

  if (!state.holdings || state.holdings.length === 0) {
    return;
  }

  const remainHoldings = [];

  for (const holding of state.holdings) {
    try {
      const priceData = await fetchPrice(holding.code);
      const currentPrice = Number(priceData.currentPrice || 0);

      if (!currentPrice || currentPrice <= 0) {
        remainHoldings.push(holding);
        continue;
      }

      holding.currentPrice = currentPrice;

holding.highestPrice = Math.max(
  Number(holding.highestPrice || holding.buyPrice || currentPrice || 0),
  currentPrice
);

holding.lowestPrice = Math.min(
  Number(holding.lowestPrice || holding.buyPrice || currentPrice || 0),
  currentPrice
);

const buyPrice = Number(holding.buyPrice || 0);

const profitRate =
  buyPrice > 0
    ? ((currentPrice - buyPrice) / buyPrice) * 100
    : 0;

const currentMaxProfitRate =
  buyPrice > 0
    ? ((Number(holding.highestPrice || currentPrice) - buyPrice) / buyPrice) * 100
    : 0;

const currentMaxLossRate =
  buyPrice > 0
    ? ((Number(holding.lowestPrice || currentPrice) - buyPrice) / buyPrice) * 100
    : 0;

holding.maxProfitRate = Math.max(
  Number(holding.maxProfitRate || 0),
  currentMaxProfitRate
);

holding.maxLossRate = Math.min(
  Number(holding.maxLossRate || 0),
  currentMaxLossRate
);



const abnormalPrice =
  buyPrice > 0 &&
  (
    currentPrice >= buyPrice * 1.5 ||
    currentPrice <= buyPrice * 0.5
  );

if (abnormalPrice) {
  console.warn(
    `[가격이상 감지] ${holding.name}(${holding.code}) ` +
    `매수가 ${buyPrice} / 현재가 ${currentPrice} / 수익률 ${profitRate.toFixed(2)}%`
  );

  remainHoldings.push(holding);
  continue;
}

      const trailingDropRate =
        Number(holding.highestPrice || 0) > 0
          ? ((currentPrice - Number(holding.highestPrice)) /
              Number(holding.highestPrice)) *
            100
          : 0;

      const buyTimeMs =
        Number(holding.buyTimeMs || 0) ||
        (holding.buyAt ? new Date(holding.buyAt).getTime() : 0);


const protectMinutes =
  Number(holding.protectMinutes || 5);

      const protectUntil =
        buyTimeMs + protectMinutes * 60 * 1000;

      const isProtected =
        buyTimeMs > 0 && Date.now() < protectUntil;

      const isCrash = profitRate <= -2.5;

      if (isProtected) {
        console.log(
          `[보호시간] ${holding.name} ${protectMinutes}분 보호중 · 수익률 ${profitRate.toFixed(2)}%`
        );
      }








const maxProfitRate =
  buyPrice > 0
    ? ((Number(holding.highestPrice || currentPrice) - buyPrice) / buyPrice) * 100
    : 0;

    if (holding.strategyGroup === "TURBO") {
  if (
    maxProfitRate >= settings.turboTrailingStartRate &&
    !holding.turboTrailingActive
  ) {
    holding.turboTrailingActive = true;
    holding.turboTrailingStartPrice = currentPrice;

    console.log(
      `[TURBO 트레일링 시작] ${holding.name} / 최고수익 ${maxProfitRate.toFixed(2)}%`
    );
  }

  if (profitRate <= settings.turboStopLossRate) {
    paperSell(
      state,
      holding,
      currentPrice,
      `Turbo 손절 ${profitRate.toFixed(2)}%`,
      "TURBO_STOP_LOSS"
    );
    continue;
  }

  if (
  !holding.turboFirstTakeProfitDone &&
  profitRate >= settings.turboTakeProfitRate &&
  Number(holding.qty || 0) >= 2
) {
  const sellQty = Math.floor(
    Number(holding.qty || 0) * settings.turboTakeProfitSellRatio
  );

  if (sellQty >= 1) {
    paperSell(
      state,
      holding,
      currentPrice,
      `Turbo 1차 익절 ${profitRate.toFixed(2)}% · ${sellQty}주 매도`,
      "TURBO_FIRST_TAKE_PROFIT",
      sellQty
    );

    holding.turboFirstTakeProfitDone = true;
    holding.turboTrailingActive = true;
    remainHoldings.push(holding);
    continue;
  }
}

  if (
    holding.turboTrailingActive &&
    trailingDropRate <= -settings.turboTrailingStopRate &&
    profitRate > 0
  ) {
    paperSell(
      state,
      holding,
      currentPrice,
      `Turbo 트레일링 매도 · 최고가 대비 ${settings.turboTrailingStopRate}% 하락`,
      "TURBO_TRAILING_STOP"
    );
    continue;
  }

  if (isBetweenTime(settings.turboForceSellTime, "15:20")) {
    paperSell(
      state,
      holding,
      currentPrice,
      `Turbo 시간청산 ${settings.turboForceSellTime}`,
      "TURBO_TIME_EXIT"
    );
    continue;
  }

  remainHoldings.push(holding);
  continue;
}

if (holding.strategyGroup === "WAVE") {
  if (
    maxProfitRate >= settings.waveTrailingStartRate &&
    !holding.waveTrailingActive
  ) {
    holding.waveTrailingActive = true;
    holding.waveTrailingStartPrice = currentPrice;

    console.log(
      `[WAVE 트레일링 시작] ${holding.name} / 최고수익 ${maxProfitRate.toFixed(2)}%`
    );
  }

  if (profitRate <= settings.waveStopLossRate) {
    paperSell(
      state,
      holding,
      currentPrice,
      `WAVE 손절 ${profitRate.toFixed(2)}%`,
      "WAVE_STOP_LOSS"
    );
    continue;
  }

  if (
    !holding.waveFirstTakeProfitDone &&
    profitRate >= settings.waveTakeProfitRate &&
    Number(holding.qty || 0) >= 2
  ) {
    const sellQty = Math.floor(
      Number(holding.qty || 0) * settings.waveTakeProfitSellRatio
    );

    if (sellQty >= 1) {
      paperSell(
        state,
        holding,
        currentPrice,
        `WAVE 1차 익절 ${profitRate.toFixed(2)}% · ${sellQty}주 매도`,
        "WAVE_FIRST_TAKE_PROFIT",
        sellQty
      );

      holding.waveFirstTakeProfitDone = true;
      holding.waveTrailingActive = true;
      remainHoldings.push(holding);
      continue;
    }
  }

  if (
    holding.waveTrailingActive &&
    trailingDropRate <= -settings.waveTrailingStopRate &&
    profitRate > 0
  ) {
    paperSell(
      state,
      holding,
      currentPrice,
      `WAVE 트레일링 매도 · 최고가 대비 ${settings.waveTrailingStopRate}% 하락`,
      "WAVE_TRAILING_STOP"
    );
    continue;
  }

  if (isBetweenTime(settings.waveForceSellTime, "15:20")) {
    paperSell(
      state,
      holding,
      currentPrice,
      `WAVE 시간청산 ${settings.waveForceSellTime}`,
      "WAVE_TIME_EXIT"
    );
    continue;
  }

  remainHoldings.push(holding);
  continue;
}

if (maxProfitRate >= settings.breakEvenTriggerRate) {
  holding.breakEvenActivated = true;
}

if (
  holding.breakEvenActivated &&
  profitRate <= settings.breakEvenSellRate &&
  profitRate >= 0 &&
  !isProtected
) {
  paperSell(
    state,
    holding,
    currentPrice,
    `본절보호 매도 · 최고수익 ${maxProfitRate.toFixed(2)}% 후 ${profitRate.toFixed(2)}%까지 하락`,
    "BREAK_EVEN_PROTECT"
  );
  continue;
}

const holdingQty = Number(holding.qty || 0);

if (
  !holding.firstTakeProfitDone &&
  profitRate >= settings.firstTakeProfitRate &&
  holdingQty >= 2 &&
  !isProtected
) {
  const sellQty = Math.floor(holdingQty * settings.firstTakeProfitSellRatio);

  if (sellQty >= 1 && holdingQty - sellQty >= settings.firstTakeProfitMinRemainQty) {
    const firstSold = paperSell(
      state,
      holding,
      currentPrice,
      `1차 수익실현 ${profitRate.toFixed(2)}% · ${sellQty}주 매도`,
      "FIRST_TAKE_PROFIT",
      sellQty
    );

    if (firstSold) {
      holding.trailingActive = true;
      holding.targetTouched = true;
      holding.trailingStartPrice = currentPrice;
      remainHoldings.push(holding);
      continue;
    }
  }
}

if (
  isTradeTime() &&
  isAfterEndProfitSellTime() &&
  settings.endProfitSellOnlyPositive &&
  profitRate > 0
) {
  paperSell(
    state,
    holding,
    currentPrice,
    `장종료 전 수익 정리 ${profitRate.toFixed(2)}%`,
    "END_PROFIT_SELL"
  );
  continue;
}

if (
  isTradeTime() &&
  isAfterEndProfitSellTime() &&
  profitRate < 0 &&
  maxProfitRate < 2
) {
  paperSell(
    state,
    holding,
    currentPrice,
    `장종료 전 손실종목 정리 · 현재 ${profitRate.toFixed(2)}% / 최고 ${maxProfitRate.toFixed(2)}%`,
    "END_WEAK_SELL"
  );
  continue;
}



      if (
        profitRate >= settings.trailingStartRate && 
        !holding.trailingActive
      ) {
        holding.trailingActive = true;
        holding.targetTouched = true;
        holding.trailingStartPrice = currentPrice;

        console.log(
          `[트레일링 시작] ${holding.name} ` +
          `수익률 ${profitRate.toFixed(2)}% / ` +
          `현재가 ${currentPrice} / ` +
          `최고가 ${holding.highestPrice}`
        );
      }



if (profitRate >= 28) {
  paperSell(
    state,
    holding,
    currentPrice,
    "상한가 근처 수익실현",
    "TAKE_PROFIT"
  );
  continue;
}

const isRunnerCandidate =
  Number(holding.discoverScore || 0) >= 10;

const activeStopLossRate =
  isRunnerCandidate ? -2.5 : settings.stopLossRate;

if (
  profitRate <= activeStopLossRate &&
  (!isProtected || isCrash)
) {
  paperSell(
    state,
    holding,
    currentPrice,
    isCrash
      ? `급락 손절 ${profitRate.toFixed(2)}%`
      : `손절 ${activeStopLossRate}% 도달`,




        "STOP_LOSS"
        );
        continue;
      }

if (
  holding.trailingActive &&
  profitRate <= 0.3 &&
  !isProtected
) {
  paperSell(
    state,
    holding,
    currentPrice,
    "트레일링 본전 보호",
    "TRAILING_STOP"
  );
  continue;
}

// 고수익 구간 정체 매도
if (profitRate >= 5) {
  if (!holding.highProfitReachedAt) {
    holding.highProfitReachedAt = Date.now();
    holding.highProfitBaseRate = maxProfitRate;
    holding.highProfitBasePrice = currentPrice;
  }

  // 최고수익률을 0.5%p 이상 새로 갱신하면 정체 타이머 리셋
  if (maxProfitRate >= Number(holding.highProfitBaseRate || 0) + 0.5) {
    holding.highProfitReachedAt = Date.now();
    holding.highProfitBaseRate = maxProfitRate;
    holding.highProfitBasePrice = currentPrice;
  }

  const stagnantMinutes =
    (Date.now() - Number(holding.highProfitReachedAt || 0)) / 1000 / 60;

  const baseRate = Number(holding.highProfitBaseRate || maxProfitRate || 0);

  const stillHighProfit =
    baseRate > 0 && profitRate >= baseRate * 0.9;

  const noStrongNewHigh =
    maxProfitRate < baseRate + 0.5;

  if (
    stagnantMinutes >= 15 &&
    stillHighProfit &&
    noStrongNewHigh &&
    !isProtected
  ) {
    paperSell(
      state,
      holding,
      currentPrice,
      `고수익 정체 매도 · 최고수익 ${baseRate.toFixed(2)}% 부근 ${stagnantMinutes.toFixed(0)}분 정체 / 현재 ${profitRate.toFixed(2)}%`,
      "HIGH_PROFIT_STAGNANT_SELL"
    );
    continue;
  }
}

let dynamicTrailingRate = settings.trailingStopRate;

if (maxProfitRate >= 8) {
  dynamicTrailingRate = 2.5;
} else if (maxProfitRate >= 5) {
  dynamicTrailingRate = 1.8;
} else if (maxProfitRate >= 3) {
  dynamicTrailingRate = 1.2;
}






if (
  holding.trailingActive &&
  holding.highestPrice > holding.buyPrice &&
  profitRate > 0.5 &&
  trailingDropRate <= -dynamicTrailingRate &&
  !isProtected
) {
  paperSell(
    state,
    holding,
    currentPrice,
    `트레일링 매도 · 최고가 대비 ${dynamicTrailingRate}% 하락`,
    "TRAILING_STOP"
  );
  continue;
}
      remainHoldings.push(holding);
    } catch (error) {
      console.warn(
        "자동매도 감시 실패:",
        holding.code,
        error.message
      );
      remainHoldings.push(holding);
    }
  }

  state.holdings = remainHoldings;
  state.lastSellCheckAt = nowText();

  saveState(state);
}

function isPullbackReboundCandidate(item) {
  const currentPrice = Number(item.currentPrice || item.price || 0);
  const openPrice = Number(item.open || item.openPrice || 0);
  const highPrice = Number(item.high || item.highPrice || 0);
  const lowPrice = Number(item.low || item.lowPrice || 0);

  if (!currentPrice || !openPrice || !highPrice || !lowPrice) {
    return {
      pass: false,
      reason: "시가/고가/저가/현재가 부족"
    };
  }

  const firstRiseRate =
    ((highPrice - openPrice) / openPrice) * 100;

  const pullbackRate =
    ((highPrice - currentPrice) / highPrice) * 100;

  const reboundFromLowRate =
    ((currentPrice - lowPrice) / lowPrice) * 100;

  const openPositionRate =
    ((currentPrice - openPrice) / openPrice) * 100;

  const pass =
    firstRiseRate >= 2.5 &&
    firstRiseRate <= 12 &&
    pullbackRate >= 1.0 &&
    pullbackRate <= 3.0 &&
    reboundFromLowRate >= 1.0 &&
    currentPrice > openPrice;

  return {
    pass,
    firstRiseRate,
    pullbackRate,
    reboundFromLowRate,
    openPositionRate,
    reason: pass
      ? "눌림목 재상승 조건 통과"
      : `눌림목 미충족 · 1차상승 ${firstRiseRate.toFixed(2)}% / 고점대비 ${pullbackRate.toFixed(2)}% / 저점반등 ${reboundFromLowRate.toFixed(2)}% / 시가대비 ${openPositionRate.toFixed(2)}%`
  };
}

function calculateMarketTemperature(candidates = []) {
  const list = Array.isArray(candidates) ? candidates : [];

  const valid = list.filter((item) => {
    const rate = Number(
      item.changeRate ??
      item.changeRatePercent ??
      item.fluctuationRate ??
      item.rate ??
      0
    );

    return Number.isFinite(rate);
  });

  const total = valid.length;

  if (total === 0) {
    return {
      level: "NORMAL",
      label: "보통",
      advanceRatio: 0,
      upCount: 0,
      total: 0,
      reason: "시장온도 계산 데이터 없음"
    };
  }

  const upCount = valid.filter((item) => {
    const rate = Number(
      item.changeRate ??
      item.changeRatePercent ??
      item.fluctuationRate ??
      item.rate ??
      0
    );

    return rate > 0;
  }).length;

  const advanceRatio = (upCount / total) * 100;

  if (advanceRatio >= 70) {
    return {
      level: "HOT",
      label: "매우 좋음",
      advanceRatio: Number(advanceRatio.toFixed(1)),
      upCount,
      total,
      reason: `상승종목비율 ${advanceRatio.toFixed(1)}%`
    };
  }

  if (advanceRatio >= 55) {
    return {
      level: "GOOD",
      label: "양호",
      advanceRatio: Number(advanceRatio.toFixed(1)),
      upCount,
      total,
      reason: `상승종목비율 ${advanceRatio.toFixed(1)}%`
    };
  }

  if (advanceRatio >= 45) {
    return {
      level: "NORMAL",
      label: "보통",
      advanceRatio: Number(advanceRatio.toFixed(1)),
      upCount,
      total,
      reason: `상승종목비율 ${advanceRatio.toFixed(1)}%`
    };
  }

  if (advanceRatio >= 30) {
    return {
      level: "CAUTION",
      label: "주의",
      advanceRatio: Number(advanceRatio.toFixed(1)),
      upCount,
      total,
      reason: `상승종목비율 ${advanceRatio.toFixed(1)}%`
    };
  }

  return {
    level: "DANGER",
    label: "위험",
    advanceRatio: Number(advanceRatio.toFixed(1)),
    upCount,
    total,
    reason: `상승종목비율 ${advanceRatio.toFixed(1)}%`
  };
}

async function runServerAutoBuyOnce() {
  if (!isBetweenTime(settings.buyStartTime, settings.buyEndTime)) {
  console.log(
    `신규매수 시간 아님: ${settings.buyStartTime}~${settings.buyEndTime}`
  );
  return {
    ok: false,
    message: "신규매수 가능 시간이 아닙니다.",
  };
}

  if (isRunning) return;

  if (!isTradeTime()) {
    console.log("[자동매수 차단] 거래 가능 시간이 아닙니다.");
    return;
  }

  isRunning = true;

  try {

    if (!isTradeTime()) {
      console.log("거래 가능 시간이 아닙니다.");
      return;
    }

const state = loadState();

if (!state.serverAutoEnabled) {
  console.log("서버 자동매매 OFF 상태입니다. 자동매수를 실행하지 않습니다.");
  return;
}

state.lastBuyCheckAt = nowText();
saveState(state);


initDailyLossLimitIfNeeded(state);
saveState(state);

if (isDailyLossLimitReached(state)) {
  state.dailyBuyStopped = true;
  saveState(state);

  const todayProfit = getTodayRealizedProfit(state);

  console.log(
    `[일일 손실 제한] 오늘 실현손익 ${todayProfit.toLocaleString()}원 / 손실한도 ${Number(state.dailyLossLimit || 0).toLocaleString()}원 도달. 신규매수를 중단합니다.`
  );

  return {
    ok: false,
    message: "일일 손실한도 도달로 신규매수 중단"
  };
}

if (state.dailyBuyStopped) {
  console.log("[일일 손실 제한] 오늘 신규매수 중단 상태입니다.");
  return {
    ok: false,
    message: "일일 손실한도 도달로 신규매수 중단 상태"
  };
}

    if (isConsecutiveLossLimitReached(state)) {
      console.log(
        `[연속 손실 제한] 최근 손실 거래가 ${settings.maxConsecutiveLoss}회 연속 발생했습니다. 자동매수를 중단합니다.`
      );
      return;
    }

    if (isBuyCooldownActive(state)) {
      console.log(
        `[자동매수 대기] 최근 자동매수 실행 후 ${settings.buyCooldownMinutes}분이 지나지 않았습니다.`
      );
      return;
    }

    const slots = getAvailableSlots(state);

    if (slots <= 0) {
      console.log("보유 가능 종목 수 초과");
      return;
    }

    let candidates = await discoverCandidates();

    const marketTemperature = calculateMarketTemperature(candidates);

    if (marketTemperature.total < 20) {
  marketTemperature.level = "NORMAL";
  marketTemperature.label = "보통";
  marketTemperature.reason =
    `${marketTemperature.reason} / 표본 ${marketTemperature.total}개로 부족하여 NORMAL 처리`;
}

state.marketTemperature = {
  ...marketTemperature,
  checkedAt: new Date().toLocaleString("ko-KR")
};

console.log(
  `[시장온도] ${marketTemperature.label} / ` +
  `${marketTemperature.reason} / ` +
  `대상 ${marketTemperature.total}개`
);

if (marketTemperature.level === "DANGER") {
  saveState(state);

  return {
    ok: false,
    message: "시장온도 위험으로 신규매수 중단",
    marketTemperature
  };
}

const budget = getBudgetInfo(state);

const buyRules = {
  minScore: Number(settings.minScore || 10),
  perBuyAmount: Number(budget.corePerBuyAmount || 10000000),
  maxHoldingCount: Math.min(
    Number(settings.coreMaxHoldingCount || 8),
    getTimeBasedMaxHolding()
  )
};

if (marketTemperature.level === "CAUTION") {
  buyRules.minScore = Math.max(buyRules.minScore, 10);
  buyRules.perBuyAmount = Math.floor(buyRules.perBuyAmount * 0.5);
  buyRules.maxHoldingCount = Math.min(buyRules.maxHoldingCount, 5);

  const beforeCount = candidates.length;

  candidates = candidates.filter((item) => {
    return Number(item.discoverScore || 0) >= buyRules.minScore;
  });

  console.log(
    `[시장온도 주의] 매수조건 강화: ` +
    `minScore=${buyRules.minScore}, ` +
    `perBuyAmount=${buyRules.perBuyAmount}, ` +
    `maxHoldingCount=${buyRules.maxHoldingCount} / ` +
    `후보 ${beforeCount}개 → ${candidates.length}개`
  );
}

if (marketTemperature.level === "HOT") {
  buyRules.minScore = Math.min(buyRules.minScore, 8);
  buyRules.maxHoldingCount = Math.max(buyRules.maxHoldingCount, 8);

  const beforeCount = candidates.length;

  candidates = candidates.filter((item) => {
    return Number(item.discoverScore || 0) >= buyRules.minScore;
  });

  console.log(
    `[시장온도 HOT] 매수조건 완화: ` +
    `minScore=${buyRules.minScore}, ` +
    `maxHoldingCount=${buyRules.maxHoldingCount} / ` +
    `후보 ${beforeCount}개 → ${candidates.length}개`
  );
}

if (settings.leaderCoreEnabled) {
  const beforeLeaderCoreCount = candidates.length;

  const isLeaderCoreTime = isBetweenTime("09:20", "10:30");

  const leaderCandidates = candidates.filter((item) =>
    isLeaderCoreCandidate(item, marketTemperature)
  );

  if (isLeaderCoreTime) {
    candidates = leaderCandidates;

    buyRules.minScore = Math.max(
      buyRules.minScore,
      settings.leaderCoreMinScore
    );

    buyRules.maxHoldingCount = Math.min(
      buyRules.maxHoldingCount,
      settings.leaderCoreMaxHoldingCount
    );

    buyRules.perBuyAmount =
  budget.corePerBuyAmount;

    state.currentCoreMode = "LEADER_CORE_ONLY";

    console.log(
      `[LEADER CORE 전용시간] 09:20~10:30 / ` +
      `minScore=${buyRules.minScore}, ` +
      `perBuyAmount=${buyRules.perBuyAmount}, ` +
      `maxHoldingCount=${buyRules.maxHoldingCount} / ` +
      `후보 ${beforeLeaderCoreCount}개 → ${candidates.length}개`
    );
  } else if (leaderCandidates.length > 0) {
    candidates = leaderCandidates;

    buyRules.minScore = Math.max(
      buyRules.minScore,
      settings.leaderCoreMinScore
    );

    buyRules.maxHoldingCount = Math.min(
      buyRules.maxHoldingCount,
      settings.leaderCoreMaxHoldingCount
    );

    buyRules.perBuyAmount = budget.corePerBuyAmount;

    state.currentCoreMode = "LEADER_CORE";

    console.log(
      `[LEADER CORE 우선] 10:30 이후에도 대장주 후보 존재 / ` +
      `후보 ${beforeLeaderCoreCount}개 → ${candidates.length}개`
    );
  } else {
    buyRules.minScore = Math.max(buyRules.minScore, 10);

    state.currentCoreMode = "CORE_BACKUP";

    console.log(
      `[CORE 백업모드] 10:30 이후 Leader Core 후보 없음 / ` +
      `일반 Core 점수 ${buyRules.minScore} 이상으로 진행 / ` +
      `후보 ${beforeLeaderCoreCount}개 유지`
    );
  }
}


    if (!candidates || candidates.length === 0) {
      console.log("자동매수 후보가 없습니다.");
      return;
    }

    for (const item of candidates) {
  if (getCoreHoldingCount(state) >= buyRules.maxHoldingCount) {
    console.log(`[시장온도 기준] Core 최대 보유 ${buyRules.maxHoldingCount}개 도달`);
    break;
  }


if (isAlreadyHolding(state, item.code)) {
  console.log(
    `[매수제외] ${item.name} ${item.code} / 이미 보유중`
  );
  continue;
}



      if (isRecentlySold(state, item.code)) {
        

console.log(
  `[매수제외] ${item.name} ${item.code} / 당일 재매수 금지`
);

        continue;
      }

      let priceData = null;
      let currentPrice = 0;

      try {
        priceData = await fetchPrice(item.code);

        currentPrice = Number(
          priceData.currentPrice ||
          priceData.price ||
          item.currentPrice ||
          item.price ||
          0
        );
      } catch (err) {
  console.log(
    `[현재가 조회 실패 - 건너뜀] ${item.name} ${item.code} / ${err.message}`
  );
  continue;
}

      if (!currentPrice || currentPrice <= 0) {
        console.log(`[매수제외] ${item.name} ${item.code} / 현재가 없음`);
        continue;
      }

const isMorningEntry = isBetweenTime("09:20", "09:40");

if (!isMorningEntry) {
  const pullbackCheck = isPullbackReboundCandidate({
    ...item,
    currentPrice
  });

  if (!pullbackCheck.pass) {
    console.log(
      `[매수제외] ${item.name} ${item.code} / ${pullbackCheck.reason}`
    );
    continue;
  }

  console.log(
    `[눌림목 통과] ${item.name} ${item.code} / ` +
    `1차상승 ${pullbackCheck.firstRiseRate.toFixed(2)}% / ` +
    `고점대비 ${pullbackCheck.pullbackRate.toFixed(2)}% / ` +
    `저점반등 ${pullbackCheck.reboundFromLowRate.toFixed(2)}%`
  );
} else {
  console.log(
    `[장초반 매수모드] ${item.name} ${item.code} / 눌림목 조건 생략`
  );
}


      let bestStrategy = null;

      try {
        bestStrategy = await findBestStrategy(item.code);
      } catch (err) {
        console.warn(`[백테스트 실패] ${item.name} ${item.code} / ${err.message}`);
      }

if (!bestStrategy || Number(bestStrategy.profitRate || 0) < 6) {
  console.log(
    `[매수제외] ${item.name} ${item.code} / 백테스트 수익률 부족 ${
      bestStrategy
        ? Number(bestStrategy.profitRate || 0).toFixed(2)
        : "없음"
    }%`
  );
  continue;
}

if (isStrategyBlocked(state, bestStrategy.key || bestStrategy.strategyPreset)) {
  console.log(
    `[매수제외] ${item.name} ${item.code} / 전략 성과 부진 ${bestStrategy.name || bestStrategy.strategyName || bestStrategy.key}`
  );
  continue;
}

if (Number(bestStrategy.tradeCount || 0) < 2) {
  console.log(
    `[매수제외] ${item.name} ${item.code} / 백테스트 거래횟수 부족 ${bestStrategy.tradeCount}회`
  );
  continue;
}

const strategyPreset = bestStrategy.key;
const discoverScore = Number(item.discoverScore || 0);

if (strategyPreset === "safe" && discoverScore < settings.safeMinScore) {
  console.log(
    `[매수제외] ${item.name} ${item.code} / 안정형 점수 부족 ${discoverScore}`
  );
  continue;
}

if (strategyPreset === "trend" && discoverScore < settings.trendMinScore) {
  console.log(
    `[매수제외] ${item.name} ${item.code} / 추세형 점수 부족 ${discoverScore}`
  );
  continue;
}



if (settings.blockStoppedToday && wasStoppedToday(state, item.code)) {
  console.log(
    `[매수제외] ${item.name} ${item.code} / 오늘 손절 또는 손실 이력 있음`
  );
  continue;
}

if (wasBoughtToday(state, item.code)) {
  console.log(
    `[매수제외] ${item.name} ${item.code} / 오늘 이미 매수한 종목`
  );
  continue;
}

const changeRate = Number(
  item.changeRate ||
  item.fluctuationRate ||
  item.riseRate ||
  item.rate ||
  0
);

if (changeRate < 1.0) {
  console.log(
    `[매수제외] ${item.name} ${item.code} / 상승률 약함 ${changeRate.toFixed(2)}%`
  );
  continue;
}


const maxAllowedChangeRate =
  bestStrategy.key === "trend" &&
  Number(item.discoverScore || 0) >= 10
    ? 7
    : 5;

if (changeRate >= maxAllowedChangeRate) {
  console.log(
    `[매수제외] ${item.name} ${item.code} / 당일 급등 ${changeRate.toFixed(2)}% / 허용 ${maxAllowedChangeRate}%`
  );
  continue;
}


  const bought = paperBuy(
  state,
  {
    ...item,
    currentPrice,
    price: currentPrice,
    name:
      priceData.name && priceData.name !== item.code
        ? priceData.name
        : item.name
  },
  bestStrategy,
  buyRules.perBuyAmount
);

      if (bought) {
        console.log(
          `[모의매수] ${item.name} ${item.code} / ${bestStrategy.name} / 점수 ${item.discoverScore}`
        );
      }
    }

    state.lastRunAt = nowText();
    saveState(state);
  } catch (err) {
    console.error("서버 자동 모의매수 오류:", err.message);
  } finally {
    isRunning = false;
  }
}

async function runTurboAutoBuyOnce() {
  if (!settings.turboEnabled) return;

  if (!isBetweenTime(settings.turboStartTime, settings.turboEndTime)) {
    return;
  }

  const state = loadState();

  if (!state.serverAutoEnabled) {
    console.log("[TURBO] 서버 자동매매 OFF");
    return;
  }

  state.lastTurboCheckAt = nowText();

  let candidates = [];

  try {
    candidates = await discoverCandidates();
  } catch (err) {
    console.warn("[TURBO] 후보 발굴 실패:", err.message);
    saveState(state);
    return;
  }

  for (const item of candidates) {
    if (getTurboHoldingCount(state) >= settings.turboMaxHoldingCount) {
      break;
    }

    const discoverScore = Number(item.discoverScore || 0);
    const dayRiseRate = Number(
      item.changeRate ||
      item.fluctuationRate ||
      item.riseRate ||
      item.rate ||
      0
    );

    if (discoverScore < settings.turboMinScore) continue;
    if (isViLikeItem(item)) continue;
    if (isAlreadyHolding(state, item.code)) continue;
    if (wasTurboBoughtToday(state, item.code)) continue;

    if (wasStoppedToday(state, item.code)) {
  console.log("[TURBO 매수제외] 오늘 손절 또는 손실 이력 있음", item.name);
  continue;
}

    let priceData = null;

    try {
      priceData = await fetchPrice(item.code);
    } catch (err) {
      console.log("[TURBO] 현재가 조회 실패", item.code, err.message);
      continue;
    }

    const currentPrice = Number(priceData.currentPrice || 0);
    const currentVolume = Number(priceData.volume || item.volume || 0);

    if (!currentPrice || currentPrice <= 0) continue;

rememberWaveCandidate(state, item, priceData, currentPrice);

const leaderCheck = checkTurboLeaderCandidate(
  {
    ...item,
    ...priceData
  },
  currentPrice
);

if (!leaderCheck.pass) {
  console.log(
    `[TURBO 제외] ${priceData.name || item.name} ${item.code} / ${leaderCheck.reason}`
  );
  continue;
}

    const prev = state.turboSnapshots[item.code];

    state.turboSnapshots[item.code] = {
      price: currentPrice,
      volume: currentVolume,
      checkedAt: Date.now()
    };

    if (!prev) {
      continue;
    }

    const prevPrice = Number(prev.price || 0);
    const prevVolume = Number(prev.volume || 0);

    if (!prevPrice || prevPrice <= 0) continue;

    const oneMinuteRiseRate =
      ((currentPrice - prevPrice) / prevPrice) * 100;

    
    
    
const volumeDelta = Math.max(0, currentVolume - prevVolume);
const prevVolumeDelta = Number(prev.volumeDelta || 0);

const volumeSurge =
  prevVolumeDelta > 0
    ? volumeDelta >= prevVolumeDelta * 1.2
    : volumeDelta > 0;





    state.turboSnapshots[item.code].volumeDelta = volumeDelta;

    if (oneMinuteRiseRate < settings.turboMinOneMinuteRiseRate) {
      continue;
    }

    if (!volumeSurge) {
      continue;
    }

    console.log(
      `[TURBO 후보] ${priceData.name || item.name} ${item.code} / ` +
      `1분상승 ${oneMinuteRiseRate.toFixed(2)}% / ` +
      `당일상승 ${dayRiseRate.toFixed(2)}% / ` +
      `점수 ${discoverScore} / ` +
      `거래량증가 ${volumeDelta.toLocaleString()}`
    );

    paperTurboBuy(
      state,
      {
        ...item,
        name: priceData.name || item.name,
        currentPrice,
        volume: currentVolume
      },
      currentPrice
    );
  }

  saveState(state);
}

async function runWaveAutoBuyOnce() {
  if (!settings.waveEnabled) return;

  if (!isBetweenTime(settings.waveStartTime, settings.waveEndTime)) {
    return;
  }

  const state = loadState();

  if (!state.serverAutoEnabled) {
    console.log("[WAVE] 서버 자동매매 OFF");
    return;
  }

  const candidates = Object.values(state.waveCandidates || {});

  if (candidates.length === 0) {
    return;
  }

  for (const candidate of candidates) {
    if (getWaveHoldingCount(state) >= settings.waveMaxHoldingCount) break;
    if (getTodayWaveBuyCount(state) >= settings.waveMaxDailyBuyCount) break;
    if (isAlreadyHolding(state, candidate.code)) continue;
    if (wasWaveBoughtToday(state, candidate.code)) continue;

    if (wasStoppedToday(state, candidate.code)) {
  console.log("[WAVE 매수제외] 오늘 손절 또는 손실 이력 있음", candidate.name);
  continue;
}

    let priceData = null;

    try {
      priceData = await fetchPrice(candidate.code);
    } catch (err) {
  console.log(
    "[WAVE] 현재가 조회 실패",
    candidate.code,
    err.message
  );
  continue;
}

    const currentPrice = Number(priceData.currentPrice || 0);
    if (!currentPrice || currentPrice <= 0) continue;

    const check = checkWaveCandidate(candidate, priceData);

    if (!check.pass) {
      console.log(`[WAVE 제외] ${candidate.name} ${candidate.code} / ${check.reason}`);
      continue;
    }

    console.log(`[WAVE 후보] ${candidate.name} ${candidate.code} / ${check.reason}`);

    paperWaveBuy(state, candidate, currentPrice);
  }

  state.lastWaveCheckAt = nowText();
  saveState(state);
}

function startServerAutoTrader() {
  console.log("서버 자동 모의매매 시작");

  setInterval(() => {
  if (isBetweenTime(settings.turboStartTime, settings.turboEndTime)) {
    runTurboAutoBuyOnce();
  }
}, 60 * 1000);


setInterval(() => {
  const isMorningBuyTime = isBetweenTime("09:20", "10:00");

  if (isMorningBuyTime) {
    runServerAutoBuyOnce();
    return;
  }

  const now = new Date();
  const minute = now.getMinutes();

  if (minute % 10 === 0) {
    runServerAutoBuyOnce();
  }
}, 5 * 60 * 1000);

  setInterval(() => {
    checkServerAutoSellOnce();
  }, 30 * 1000);

  setInterval(() => {
  if (isBetweenTime(settings.waveStartTime, settings.waveEndTime)) {
    runWaveAutoBuyOnce();
  }
}, 60 * 1000);
}


async function runClosingProfitSell() {
  const state = loadState();

  if (!state.serverAutoEnabled) {
    console.log("서버 자동매매 OFF 상태입니다. 장마감 수익매도 중단");
    return { ok: false, message: "서버 자동매매 OFF 상태" };
  }

  const holdings = Array.isArray(state.holdings) ? [...state.holdings] : [];
  const sold = [];

  for (const holding of holdings) {
    const currentPrice = Number(holding.currentPrice || 0);
    const buyPrice = Number(holding.buyPrice || 0);
    const qty = Number(holding.qty || 0);

    if (buyPrice <= 0 || currentPrice <= 0 || qty <= 0) continue;

    const profitRate = ((currentPrice - buyPrice) / buyPrice) * 100;

    if (profitRate > 0) {
      const success = paperSell(
        state,
        holding,
        currentPrice,
        "장마감 수익종목 정리매도",
        "SELL_CLOSING_PROFIT"
      );

      if (success) {
        sold.push({
          code: holding.code,
          name: holding.name,
          price: currentPrice,
          qty,
          profitRate
        });
      }
    }
  }

  rebalanceCashIfNoHoldings(
  state,
  "장마감 수익매도 후 자동 8:2 재배분"
);

saveState(state);

console.log(`[장마감 수익매도] ${sold.length}개 종목 매도`);
return {
    ok: true,
    soldCount: sold.length,
    sold
  };
}

module.exports = {
  startServerAutoTrader,
  setServerAutoEnabled,
  runServerAutoBuyOnce,
  runTurboAutoBuyOnce,
  checkServerAutoSellOnce,
  runClosingProfitSell,
  runWaveAutoBuyOnce,
  loadState
};


function setServerAutoEnabled(enabled) {
  const state = loadState();

  state.serverAutoEnabled = !!enabled;
  state.serverAutoChangedAt = nowText();

  saveState(state);

  return state;
}
