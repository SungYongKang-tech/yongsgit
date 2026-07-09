const fs = require("fs");
const path = require("path");

const STATE_FILE = path.join(__dirname, "paper-state-core.json");
const API_BASE = "http://localhost:3000";

const settings = {
  totalCash: 100000000,

  serverAutoEnabledDefault: true,

  discoverScanLimit: 150,
discoverLimit: 100,
  minDiscoverScore: 7,

  coreEnabled: true,
 coreStartTime: "09:10",
coreEndTime: "11:00",
  coreMaxHoldingCount: 2,
  coreBuyAmount: 10000000,
  coreMaxChangeRate: 3.5,
  coreMinTradeVolumeRatio: 80,
  coreMinDayPositionRate: 50,
  coreMaxDayPositionRate: 80,

  volumeEnabled: true,
  volumeStartTime: "09:10",
volumeEndTime: "13:30",
  volumeMaxHoldingCount: 3,
  volumeBuyAmount: 8000000,
  volumeMinChangeRate: 0.8,
  volumeMaxChangeRate: 3.5,
  volumeMinTradeVolumeRatio: 120,
  volumeMinDayPositionRate: 45,
  volumeMaxDayPositionRate: 80,

  stopLossRate: -1.5,
  firstTakeProfitRate: 4.0,
  firstTakeProfitSellRatio: 0.3,
  trailingStartRate: 3.0,
  trailingStopRate: 1.0,

  coreStopLossRate: -1.7,
coreFirstTakeProfitRate: 4.0,
coreTrailingStartRate: 3.0,
coreTrailingStopRate: 1.0,

volumeStopLossRate: -1.2,
volumeFirstTakeProfitRate: 3.0,
volumeTrailingStartRate: 2.5,
volumeTrailingStopRate: 0.8,

  buyLoopMs: 60 * 1000,
  sellLoopMs: 30 * 1000,

  coreBuyCooldownMinutes: 10,
  volumeBuyCooldownMinutes: 5,

  minHoldMinutes: 3,

  candidateConfirmWaitMs: 60 * 1000,
candidateHistoryMaxAgeMs: 30 * 60 * 1000,

  dailyLossLimitRate: 0.01,

  endSellTime: "15:10",
endSellOnlyPositive: true,

coreEndSellOnlyPositive: true,
volumeEndSellOnlyPositive: false
};

function nowText() {
  return new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
}

function todayKey() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
}

function isBetweenTime(start, end) {
  const now = new Date();
  const hhmm = now.toLocaleTimeString("ko-KR", {
    timeZone: "Asia/Seoul",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit"
  });

  return hhmm >= start && hhmm <= end;
}

function loadState() {
  if (!fs.existsSync(STATE_FILE)) {
    return {
      holdings: [],
      tradeLogs: [],
      virtualResults: [],
      serverAutoEnabled: settings.serverAutoEnabledDefault,
      totalCash: settings.totalCash
    };
  }

  const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));

  if (!Array.isArray(state.holdings)) state.holdings = [];
if (!Array.isArray(state.tradeLogs)) state.tradeLogs = [];
if (!Array.isArray(state.virtualResults)) state.virtualResults = [];

if (!Array.isArray(state.pendingBuyCodes)) state.pendingBuyCodes = [];
if (!Array.isArray(state.pendingSellCodes)) state.pendingSellCodes = [];
  if (typeof state.serverAutoEnabled === "undefined") {
    state.serverAutoEnabled = settings.serverAutoEnabledDefault;
  }
  if (typeof state.totalCash === "undefined") {
    state.totalCash = settings.totalCash;
  }

  return state;
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function fetchJson(url) {
  const res = await fetch(url);
  const text = await res.text();

  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (e) {
    data = { rawText: text };
  }

  if (!res.ok) {
    throw new Error(data.message || data.error || `API 오류 ${res.status}`);
  }

  return data;
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const text = await res.text();

  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (e) {
    data = { rawText: text };
  }

  if (!res.ok || data.ok === false) {
    throw new Error(data.message || data.error || `POST API 오류 ${res.status}`);
  }

  return data;
}

async function fetchPrice(code) {
  const data = await fetchJson(`${API_BASE}/api/price?code=${code}`);

  return Math.abs(Number(
    data.currentPrice ||
    data.price ||
    data.curPrice ||
    data.raw?.cur_prc ||
    0
  ));
}

function isExcludedStock(item = {}) {
  const name = String(item.name || item.stockName || item.korName || "").trim();

  if (
    /KODEX|TIGER|ACE|SOL|HANARO|KOSEF|KBSTAR|ARIRANG|ETF|ETN|레버리지|인버스|스팩|SPAC/i.test(name)
  ) {
    return true;
  }

  // 우선주 제외: 삼성전자우, 두산2우B, 현대차3우B 등
  if (/우$|\d우B$|우B$|우선주/i.test(name)) {
    return true;
  }

  return false;
}

function getTradeVolumeRatio(item = {}) {
  const raw = item.raw || {};
  const value = String(
    raw.trde_pre ||
    item.trde_pre ||
    item.tradeVolumeRatio ||
    ""
  ).replace(/[+,]/g, "");

  return Number(value || 0);
}

function getDayPositionRate(item = {}, currentPrice) {
  const high = Math.abs(Number(item.high || item.highPrice || item.raw?.high_pric || 0));
  const low = Math.abs(Number(item.low || item.lowPrice || item.raw?.low_pric || 0));

  if (!high || !low || high <= low || !currentPrice) return 0;

  return ((currentPrice - low) / (high - low)) * 100;
}

function getOpenPositionRate(item = {}, currentPrice) {
  const open = Math.abs(Number(item.open || item.openPrice || item.raw?.open_pric || 0));

  if (!open || !currentPrice) return 0;

  return ((currentPrice - open) / open) * 100;
}

function getHoldingCount(state, strategyGroup) {
  return state.holdings.filter(h => h.strategyGroup === strategyGroup).length;
}

function getTodayRealizedProfit(state) {
  const today = todayKey();

  return (state.tradeLogs || [])
    .filter(log =>
      log.date === today &&
      typeof log.profit !== "undefined"
    )
    .reduce((sum, log) => sum + Number(log.profit || 0), 0);
}

function initDailyRiskIfNeeded(state) {
  const today = todayKey();

  if (state.dailyRiskDate === today) return;

  state.dailyRiskDate = today;
state.dailyBuyStopped = false;

state.coreCandidateHistory = {};
state.volumeCandidateHistory = {};

state.pendingBuyCodes = [];
state.pendingSellCodes = [];

  const holdingValue = (state.holdings || []).reduce((sum, h) => {
    return sum + Number(h.currentPrice || h.buyPrice || 0) * Number(h.qty || 0);
  }, 0);

  state.dailyStartAsset = Number(state.totalCash || 0) + holdingValue;
  state.dailyLossLimit = Math.floor(
  state.dailyStartAsset * settings.dailyLossLimitRate
);

  console.log(
    `[리스크 초기화] 시작자산 ${state.dailyStartAsset.toLocaleString()}원 / ` +
    `일일손실한도 ${state.dailyLossLimit.toLocaleString()}원`
  );
}

function checkDailyLossLimit(state) {
  initDailyRiskIfNeeded(state);

  const todayProfit = getTodayRealizedProfit(state);
  const limit = Number(state.dailyLossLimit || 0);

  if (limit > 0 && todayProfit <= -Math.abs(limit)) {
    state.dailyBuyStopped = true;
    state.dailyBuyStoppedAt = nowText();
    state.dailyBuyStoppedReason =
      `일일 손실한도 도달 / 실현손익 ${todayProfit.toLocaleString()}원 / 한도 ${limit.toLocaleString()}원`;

    return {
      stopped: true,
      reason: state.dailyBuyStoppedReason
    };
  }

  return {
    stopped: false,
    reason: `실현손익 ${todayProfit.toLocaleString()}원 / 한도 ${limit.toLocaleString()}원`
  };
}

function isAlreadyHolding(state, code) {
  return state.holdings.some(h => h.code === code);
}

function wasBoughtToday(state, code) {
  return state.tradeLogs.some(log =>
    log.code === code &&
    log.date === todayKey() &&
    ["CORE_BUY", "VOLUME_BUY"].includes(log.type)
  );
}


function getLastBuyTimeByStrategy(state, strategyGroup) {
  const logs = (state.tradeLogs || [])
    .filter(log =>
      log.date === todayKey() &&
      log.type === `${strategyGroup}_BUY`
    )
    .sort((a, b) => {
      const at = new Date(a.time || a.createdAt || a.timestamp || 0).getTime();
      const bt = new Date(b.time || b.createdAt || b.timestamp || 0).getTime();
      return bt - at;
    });

  if (!logs.length) return 0;

  const last = logs[0];

  return new Date(last.time || last.createdAt || last.timestamp || 0).getTime();
}

function isStrategyBuyCooldown(state, strategyGroup) {
  const cooldownMinutes = strategyGroup === "CORE"
    ? settings.coreBuyCooldownMinutes
    : settings.volumeBuyCooldownMinutes;

  const lastBuyTime = getLastBuyTimeByStrategy(state, strategyGroup);

  if (!lastBuyTime) return {
    blocked: false,
    reason: "최근 매수 없음"
  };

  const diffMinutes = (Date.now() - lastBuyTime) / 60000;

  if (diffMinutes < cooldownMinutes) {
    return {
      blocked: true,
      reason: `${strategyGroup} 매수쿨다운 ${diffMinutes.toFixed(1)}분 / 기준 ${cooldownMinutes}분`
    };
  }

  return {
    blocked: false,
    reason: `${strategyGroup} 쿨다운 통과 ${diffMinutes.toFixed(1)}분`
  };
}

async function discoverCandidates() {
  const data = await fetchJson(
    `${API_BASE}/api/discover?scanLimit=${settings.discoverScanLimit}&limit=${settings.discoverLimit}`
  );

  const rawItems = data.items || [];

  const filtered = rawItems
    .filter(item => !isExcludedStock(item))
    .filter(item => Number(item.discoverScore || 0) >= settings.minDiscoverScore)
    .sort((a, b) => Number(b.discoverScore || 0) - Number(a.discoverScore || 0));

  console.log(
    `[DISCOVER] 원본 ${rawItems.length}개 / 필터후 ${filtered.length}개 / ` +
    `scanLimit ${settings.discoverScanLimit} / limit ${settings.discoverLimit}`
  );

  return filtered;
}

function isCoreCandidateGettingStronger(state, item, price) {
  const code = item.code;
  if (!code) return true;

  if (!state.coreCandidateHistory) {
    state.coreCandidateHistory = {};
  }

  const now = Date.now();

  const current = {
    time: now,
    score: Number(item.discoverScore || 0),
    volumeRatio: getTradeVolumeRatio(item),
    dayPosition: getDayPositionRate(item, price),
    price: Number(price || 0)
  };

  const prev = state.coreCandidateHistory[code];

  state.coreCandidateHistory[code] = current;

  // 첫 발견은 통과
 if (!prev) {
  return {
    pass: false,
    reason: "첫 발견 / 1분 확인 대기"
  };
}

if (now - Number(prev.time || 0) < settings.candidateConfirmWaitMs) {
  return {
    pass: false,
    reason: "강화 확인 대기"
  };
}

  const scoreDiff = current.score - Number(prev.score || 0);
  const volumeDiff = current.volumeRatio - Number(prev.volumeRatio || 0);
  const priceDiffRate =
    prev.price > 0 ? ((current.price - prev.price) / prev.price) * 100 : 0;

  if (scoreDiff < 0) {
    return {
      pass: false,
      reason: `점수 하락 ${prev.score} → ${current.score}`
    };
  }

  if (volumeDiff < -30) {
    return {
      pass: false,
      reason: `거래량 약화 ${prev.volumeRatio.toFixed(1)}% → ${current.volumeRatio.toFixed(1)}%`
    };
  }

  if (priceDiffRate < -0.7) {
    return {
      pass: false,
      reason: `가격 약화 ${priceDiffRate.toFixed(2)}%`
    };
  }

  return {
    pass: true,
    reason:
      `강화 확인 / 점수 ${prev.score}→${current.score} / ` +
      `거래량 ${prev.volumeRatio.toFixed(1)}→${current.volumeRatio.toFixed(1)}% / ` +
      `가격 ${priceDiffRate.toFixed(2)}%`
  };
}

function isVolumeCandidateGettingStronger(state, item, price) {
  const code = item.code;
  if (!code) return true;

  if (!state.volumeCandidateHistory) {
    state.volumeCandidateHistory = {};
  }

  const current = {
    time: Date.now(),
    score: Number(item.discoverScore || 0),
    volumeRatio: getTradeVolumeRatio(item),
    dayPosition: getDayPositionRate(item, price),
    price: Number(price || 0)
  };

  const prev = state.volumeCandidateHistory[code];

  state.volumeCandidateHistory[code] = current;

  if (!prev) {
  return {
    pass: false,
    reason: "첫 발견 / 1분 확인 대기"
  };
}

if (Date.now() - Number(prev.time || 0) < settings.candidateConfirmWaitMs) {
  return {
    pass: false,
    reason: "강화 확인 대기"
  };
}

  const scoreDiff = current.score - Number(prev.score || 0);
  const volumeDiff = current.volumeRatio - Number(prev.volumeRatio || 0);
  const priceDiffRate =
    prev.price > 0 ? ((current.price - prev.price) / prev.price) * 100 : 0;

  if (scoreDiff < -1) {
    return {
      pass: false,
      reason: `점수 약화 ${prev.score} → ${current.score}`
    };
  }

  if (volumeDiff < -50) {
    return {
      pass: false,
      reason: `거래량 급감 ${prev.volumeRatio.toFixed(1)}% → ${current.volumeRatio.toFixed(1)}%`
    };
  }

  if (priceDiffRate < -0.9) {
    return {
      pass: false,
      reason: `가격 약화 ${priceDiffRate.toFixed(2)}%`
    };
  }

  return {
    pass: true,
    reason:
      `강화 확인 / 점수 ${prev.score}→${current.score} / ` +
      `거래량 ${prev.volumeRatio.toFixed(1)}→${current.volumeRatio.toFixed(1)}% / ` +
      `가격 ${priceDiffRate.toFixed(2)}%`
  };
}

function cleanupCandidateHistory(state) {
  const now = Date.now();
  const maxAge = settings.candidateHistoryMaxAgeMs;

  for (const key of Object.keys(state.coreCandidateHistory || {})) {
    if (now - Number(state.coreCandidateHistory[key].time || 0) > maxAge) {
      delete state.coreCandidateHistory[key];
    }
  }

  for (const key of Object.keys(state.volumeCandidateHistory || {})) {
    if (now - Number(state.volumeCandidateHistory[key].time || 0) > maxAge) {
      delete state.volumeCandidateHistory[key];
    }
  }
}

function judgeCoreBuy(state, item, price) {
  const changeRate = Number(item.changeRate || item.fluctuationRate || item.riseRate || item.rate || 0);
  const volumeRatio = getTradeVolumeRatio(item);
  const dayPosition = getDayPositionRate(item, price);

  if (!settings.coreEnabled) return { pass: false, reason: "CORE OFF" };
if (!isBetweenTime(settings.coreStartTime, settings.coreEndTime)) return { pass: false, reason: "CORE 시간 아님" };
if (getHoldingCount(state, "CORE") >= settings.coreMaxHoldingCount) return { pass: false, reason: "CORE 보유한도" };
if (isAlreadyHolding(state, item.code)) return { pass: false, reason: "이미 보유중" };
if (wasBoughtToday(state, item.code)) return { pass: false, reason: "오늘 이미 매수" };

const cooldown = isStrategyBuyCooldown(state, "CORE");

if (cooldown.blocked) {
  return { pass: false, reason: cooldown.reason };
}

  if (changeRate > settings.coreMaxChangeRate) {
    return { pass: false, reason: `상승률 과다 ${changeRate.toFixed(2)}%` };
  }

  if (volumeRatio < settings.coreMinTradeVolumeRatio) {
    return { pass: false, reason: `거래량 부족 ${volumeRatio.toFixed(1)}%` };
  }

  if (dayPosition < settings.coreMinDayPositionRate || dayPosition > settings.coreMaxDayPositionRate) {
    return { pass: false, reason: `당일위치 부적합 ${dayPosition.toFixed(1)}%` };
  }

  const rankCheck = isCoreCandidateGettingStronger(state, item, price);

  if (rankCheck !== true && !rankCheck.pass) {
    return {
      pass: false,
      reason: `후보 강화 미충족 / ${rankCheck.reason || "사유 없음"}`
    };
  }

  return {
    pass: true,
    reason:
      `CORE 통과 / ` +
      `상승 ${changeRate.toFixed(2)}% / ` +
      `거래량 ${volumeRatio.toFixed(1)}% / ` +
      `위치 ${dayPosition.toFixed(1)}% / ` +
      `후보강화 통과`
  };
}

function judgeVolumeBuy(state, item, price) {
  const changeRate = Number(item.changeRate || item.fluctuationRate || item.riseRate || item.rate || 0);
  const volumeRatio = getTradeVolumeRatio(item);
  const dayPosition = getDayPositionRate(item, price);
  const openPosition = getOpenPositionRate(item, price);

  if (!settings.volumeEnabled) return { pass: false, reason: "VOLUME OFF" };
if (!isBetweenTime(settings.volumeStartTime, settings.volumeEndTime)) return { pass: false, reason: "VOLUME 시간 아님" };
if (getHoldingCount(state, "VOLUME") >= settings.volumeMaxHoldingCount) return { pass: false, reason: "VOLUME 보유한도" };
if (isAlreadyHolding(state, item.code)) return { pass: false, reason: "이미 보유중" };
if (wasBoughtToday(state, item.code)) return { pass: false, reason: "오늘 이미 매수" };

const cooldown = isStrategyBuyCooldown(state, "VOLUME");

if (cooldown.blocked) {
  return { pass: false, reason: cooldown.reason };
}

  if (changeRate < settings.volumeMinChangeRate || changeRate > settings.volumeMaxChangeRate) {
    return { pass: false, reason: `상승률 부적합 ${changeRate.toFixed(2)}%` };
  }

  if (volumeRatio < settings.volumeMinTradeVolumeRatio) {
    return { pass: false, reason: `거래량 부족 ${volumeRatio.toFixed(1)}%` };
  }

  if (dayPosition < settings.volumeMinDayPositionRate || dayPosition > settings.volumeMaxDayPositionRate) {
    return { pass: false, reason: `당일위치 부적합 ${dayPosition.toFixed(1)}%` };
  }

  if (openPosition < 0) {
    return { pass: false, reason: `시가 아래 ${openPosition.toFixed(2)}%` };
  }

  const rankCheck = isVolumeCandidateGettingStronger(state, item, price);

if (rankCheck !== true && !rankCheck.pass) {
  return {
    pass: false,
    reason: `후보 강화 미충족 / ${rankCheck.reason || "사유 없음"}`
  };
}

  return {
  pass: true,
  reason:
    `VOLUME 통과 / ` +
    `상승 ${changeRate.toFixed(2)}% / ` +
    `거래량 ${volumeRatio.toFixed(1)}% / ` +
    `위치 ${dayPosition.toFixed(1)}% / ` +
    `시가대비 ${openPosition.toFixed(2)}% / ` +
    `후보강화 통과`
};
}

async function paperBuy(state, item, price, strategyGroup, reason) {
  if (!state.pendingBuyCodes) {
    state.pendingBuyCodes = [];
  }

  if (state.pendingBuyCodes.includes(item.code)) {
    console.log(`[${strategyGroup} 매수제외] ${item.name || item.code} / 매수 요청 진행중`);
    return false;
  }

  state.pendingBuyCodes.push(item.code);
  saveState(state);

  try {
    const buyAmount = strategyGroup === "CORE"
      ? settings.coreBuyAmount
      : settings.volumeBuyAmount;

    const availableCash = Number(state.totalCash || 0);
    const finalBuyAmount = Math.min(buyAmount, availableCash);
    const qty = Math.floor(finalBuyAmount / price);

    if (qty <= 0) {
      console.log(`[${strategyGroup} 매수제외] 수량 부족`, item.name || item.code);
      return false;
    }

    const name = item.name || item.stockName || item.korName || item.code;

    const result = await postJson(`${API_BASE}/api/core-paper-buy`, {
      code: item.code,
      name,
      price,
      qty,
      strategyGroup,
      reason
    });

    console.log(
      `[${strategyGroup} 매수요청 완료] ${name} / ${price}원 / ${qty}주 / ` +
      `현금 ${Number(result.totalCash || 0).toLocaleString()}원 / ${reason}`
    );

    state.holdings.push({
  code: item.code,
  name,
  strategyGroup,
  buyPrice: price,
  currentPrice: price,
  qty,
  buyAmount: price * qty,
  buyTime: Date.now()
});

state.tradeLogs.push({
  date: todayKey(),
  time: nowText(),
  type: `${strategyGroup}_BUY`,
  code: item.code,
  name,
  price,
  qty,
  amount: price * qty,
  strategyGroup,
  reason
});

    state.totalCash = Number(result.totalCash || state.totalCash || 0);

    state.lastBuyAt = nowText();
    state.lastBuyCode = item.code;
    state.lastBuyName = name;
    state.lastBuyStrategyGroup = strategyGroup;

    saveState(state);

    return true;
  } finally {
    state.pendingBuyCodes = state.pendingBuyCodes.filter(code => code !== item.code);
    saveState(state);
  }
}

async function paperSell(state, holding, sellPrice, sellQty, sellType, reason) {
  if (!state.pendingSellCodes) {
    state.pendingSellCodes = [];
  }

  const sellKey = `${holding.code}_${sellType}`;

  if (state.pendingSellCodes.includes(sellKey)) {
    console.log(`[${sellType} 제외] ${holding.name} / 매도 요청 진행중`);
    return false;
  }

  state.pendingSellCodes.push(sellKey);
  saveState(state);

  try {
    const qty = Math.min(Number(sellQty || 0), Number(holding.qty || 0));
    if (qty <= 0) return false;

    const result = await postJson(`${API_BASE}/api/core-paper-sell`, {
      code: holding.code,
      price: sellPrice,
      qty,
      sellType,
      reason
    });

    console.log(
      `[${sellType} 요청 완료] ${holding.name} / ${sellPrice}원 / ${qty}주 / ` +
      `손익 ${Number(result.profit || 0).toLocaleString()}원 / ` +
      `${Number(result.profitRate || 0).toFixed(2)}% / ${reason}`
    );

    holding.qty -= qty;

    if (holding.qty <= 0) {
      state.holdings = state.holdings.filter(h => h !== holding);
    }

    state.totalCash = Number(result.totalCash || state.totalCash || 0);

    state.tradeLogs.push({
  date: todayKey(),
  time: nowText(),
  type: sellType,
  code: holding.code,
  name: holding.name,
  price: sellPrice,
  qty,
  profit: Number(result.profit || 0),
  profitRate: Number(result.profitRate || 0),
  strategyGroup: holding.strategyGroup,
  reason
});

    state.lastSellAt = nowText();
    state.lastSellCode = holding.code;
    state.lastSellName = holding.name;
    state.lastSellType = sellType;
    state.lastSellReason = reason;

    saveState(state);

    return true;
  } finally {
    state.pendingSellCodes = state.pendingSellCodes.filter(code => code !== sellKey);
    saveState(state);
  }
}

function getSellSignal(holding, price) {
  const buyPrice = Number(holding.buyPrice || 0);
  if (!buyPrice || !price) return null;

  const buyTime = Number(holding.buyTime || 0);
  const holdMinutes = buyTime > 0 ? (Date.now() - buyTime) / 60000 : 999;

  if (holdMinutes < settings.minHoldMinutes) {
    return null;
  }

  const profitRate = ((price - buyPrice) / buyPrice) * 100;

  const isCore = holding.strategyGroup === "CORE";

  const stopLossRate = isCore
    ? settings.coreStopLossRate
    : settings.volumeStopLossRate;

  const firstTakeProfitRate = isCore
    ? settings.coreFirstTakeProfitRate
    : settings.volumeFirstTakeProfitRate;

  const trailingStartRate = isCore
    ? settings.coreTrailingStartRate
    : settings.volumeTrailingStartRate;

  const trailingStopRate = isCore
    ? settings.coreTrailingStopRate
    : settings.volumeTrailingStopRate;

  holding.highestPrice = Math.max(Number(holding.highestPrice || price), price);
  holding.lowestPrice = Math.min(Number(holding.lowestPrice || price), price);

  const highestProfitRate =
    ((holding.highestPrice - buyPrice) / buyPrice) * 100;

  const drawdownFromHigh =
    ((price - holding.highestPrice) / holding.highestPrice) * 100;

  // 1. 손절
  if (profitRate <= stopLossRate) {
    return {
      type: `${holding.strategyGroup}_STOP_LOSS`,
      qty: holding.qty,
      reason:
        `손절 ${profitRate.toFixed(2)}% / ` +
        `기준 ${stopLossRate.toFixed(2)}%`
    };
  }

  // 2. 1차 익절
  if (
    !holding.firstTakeProfitDone &&
    profitRate >= firstTakeProfitRate
  ) {
    const currentQty = Number(holding.qty || 0);
const sellQty = Math.min(
  currentQty,
  Math.max(1, Math.floor(currentQty * settings.firstTakeProfitSellRatio))
);

    holding.firstTakeProfitDone = true;

    return {
      type: `${holding.strategyGroup}_FIRST_TAKE_PROFIT`,
      qty: sellQty,
      reason:
        `1차 익절 ${profitRate.toFixed(2)}% / ` +
        `기준 ${firstTakeProfitRate.toFixed(2)}%`
    };
  }

  // 3. 트레일링 스탑
  if (
    highestProfitRate >= trailingStartRate &&
    drawdownFromHigh <= -Math.abs(trailingStopRate)
  ) {
    return {
      type: `${holding.strategyGroup}_TRAILING_STOP`,
      qty: holding.qty,
      reason:
        `트레일링 / 최고수익 ${highestProfitRate.toFixed(2)}% / ` +
        `고점대비 ${drawdownFromHigh.toFixed(2)}% / ` +
        `시작기준 ${trailingStartRate.toFixed(2)}% / ` +
        `이탈기준 ${trailingStopRate.toFixed(2)}%`
    };
  }

  // 4. 장마감 청산
  const now = new Date();
  const hhmm =
    String(now.getHours()).padStart(2, "0") +
    ":" +
    String(now.getMinutes()).padStart(2, "0");

  if (hhmm >= settings.endSellTime) {
  const endSellOnlyPositive = isCore
    ? settings.coreEndSellOnlyPositive
    : settings.volumeEndSellOnlyPositive;

  if (!endSellOnlyPositive || profitRate > 0) {
    return {
      type: `${holding.strategyGroup}_END_SELL`,
      qty: holding.qty,
      reason:
        `장마감 청산 ${profitRate.toFixed(2)}% / ` +
        `수익만청산 ${endSellOnlyPositive ? "Y" : "N"}`
    };
  }
}

  return null;
}

async function runBuyOnce() {
  console.log("[BUY] 1회 점검 시작");

  const state = loadState();

  if (!state.serverAutoEnabled) {
    console.log("[BUY] 서버 자동매매 OFF");
    return;
  }

  const risk = checkDailyLossLimit(state);
  cleanupCandidateHistory(state);

  if (risk.stopped) {
    console.log(`[BUY] 신규매수 중단 / ${risk.reason}`);
    saveState(state);
    return;
  }

  console.log("[BUY] 후보 조회 시작");

  const candidates = await discoverCandidates();

  console.log(`[BUY] 후보 조회 완료 / ${candidates.length}개`);

  console.log(
    `[BUY] 현재 보유 CORE ${getHoldingCount(state, "CORE")}개 / ` +
    `VOLUME ${getHoldingCount(state, "VOLUME")}개 / ` +
    `현금 ${Number(state.totalCash || 0).toLocaleString()}원`
  );

  let excludeLogCount = 0;
  const maxExcludeLogCount = 20;

  for (const item of candidates) {
    const price = Math.abs(Number(item.currentPrice || item.price || item.raw?.cur_prc || 0));
    const name = item.name || item.stockName || item.korName || item.code;

    if (!price) {
      if (excludeLogCount < maxExcludeLogCount) {
        console.log(`[후보제외] ${name} / 현재가 없음`);
        excludeLogCount++;
      }
      continue;
    }

    const coreJudge = judgeCoreBuy(state, item, price);

    if (coreJudge.pass) {
      const bought = await paperBuy(state, item, price, "CORE", coreJudge.reason);

      if (bought) {
        break;
      }

      continue;
    }

    if (excludeLogCount < maxExcludeLogCount) {
      console.log(`[CORE 제외] ${name} / ${coreJudge.reason}`);
      excludeLogCount++;
    }

    const volumeJudge = judgeVolumeBuy(state, item, price);

    if (volumeJudge.pass) {
      const bought = await paperBuy(state, item, price, "VOLUME", volumeJudge.reason);

      if (bought) {
        break;
      }

      continue;
    }

    if (excludeLogCount < maxExcludeLogCount) {
      console.log(`[VOLUME 제외] ${name} / ${volumeJudge.reason}`);
      excludeLogCount++;
    }
  }

  state.lastBuyCheckAt = nowText();
  saveState(state);

  console.log("[BUY] 1회 점검 종료");
}

async function checkSellOnce() {
  const state = loadState();

  if (!state.serverAutoEnabled) {
    console.log("[SELL] 서버 자동매매 OFF");
    return;
  }

  console.log("[SELL] 1회 점검 시작");
  console.log(`[SELL] 보유종목 ${state.holdings.length}개`);

  for (const holding of [...state.holdings]) {
    let price = 0;

    try {
      price = await fetchPrice(holding.code);
    } catch (err) {
      console.log(`[SELL 가격조회 실패] ${holding.name} / ${err.message}`);
      price = Number(holding.currentPrice || holding.buyPrice || 0);
    }

    if (!price) {
      console.log(`[SELL 제외] ${holding.name} / 현재가 없음`);
      continue;
    }

    holding.currentPrice = price;

    const signal = getSellSignal(holding, price);

    if (!signal) {
      const buyPrice = Number(holding.buyPrice || 0);
      const profitRate = buyPrice > 0
        ? ((price - buyPrice) / buyPrice) * 100
        : 0;

      console.log(
        `[SELL 유지] ${holding.name} / 현재가 ${price.toLocaleString()}원 / ${profitRate.toFixed(2)}%`
      );
      continue;
    }

    await paperSell(
  state,
  holding,
  price,
  signal.qty,
  signal.type,
  signal.reason
);
  }

  state.lastSellCheckAt = nowText();
  saveState(state);

  console.log("[SELL] 1회 점검 종료");
}

async function start() {
  console.log("SY Quant Core/Volume 전용 자동매매 시작");

  await runBuyOnce();
  await checkSellOnce();

  let buyRunning = false;
  let sellRunning = false;

  setInterval(async () => {
    if (buyRunning) return;

    buyRunning = true;
    try {
      await runBuyOnce();
    } catch (err) {
      console.error("[BUY LOOP 오류]", err.message);
    } finally {
      buyRunning = false;
    }
  }, settings.buyLoopMs);

  setInterval(async () => {
    if (sellRunning) return;

    sellRunning = true;
    try {
      await checkSellOnce();
    } catch (err) {
      console.error("[SELL LOOP 오류]", err.message);
    } finally {
      sellRunning = false;
    }
  }, settings.sellLoopMs);
}


start().catch(err => {
  console.error("[START 오류]", err.message);
});
