const fs = require("fs");
const path = require("path");

const STATE_FILE = path.join(__dirname, "paper-state.json");
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

  buyLoopMs: 60 * 1000,
  sellLoopMs: 30 * 1000,

  dailyLossLimitRate: 0.01,

  endSellTime: "15:10",
endSellOnlyPositive: true
};

function nowText() {
  return new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
}

function todayKey() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
}

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
      serverAutoEnabled: settings.serverAutoEnabledDefault,
      totalCash: settings.totalCash
    };
  }

  const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));

  if (!Array.isArray(state.holdings)) state.holdings = [];
  if (!Array.isArray(state.tradeLogs)) state.tradeLogs = [];
  if (!Array.isArray(state.virtualResults)) state.virtualResults = [];
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

function judgeCoreBuy(state, item, price) {
  const changeRate = Number(item.changeRate || item.fluctuationRate || item.riseRate || item.rate || 0);
  const volumeRatio = getTradeVolumeRatio(item);
  const dayPosition = getDayPositionRate(item, price);

  if (!settings.coreEnabled) return { pass: false, reason: "CORE OFF" };
  if (!isBetweenTime(settings.coreStartTime, settings.coreEndTime)) return { pass: false, reason: "CORE 시간 아님" };
  if (getHoldingCount(state, "CORE") >= settings.coreMaxHoldingCount) return { pass: false, reason: "CORE 보유한도" };
  if (isAlreadyHolding(state, item.code)) return { pass: false, reason: "이미 보유중" };
  if (wasBoughtToday(state, item.code)) return { pass: false, reason: "오늘 이미 매수" };

  if (changeRate > settings.coreMaxChangeRate) return { pass: false, reason: `상승률 과다 ${changeRate.toFixed(2)}%` };
  if (volumeRatio < settings.coreMinTradeVolumeRatio) return { pass: false, reason: `거래량 부족 ${volumeRatio.toFixed(1)}%` };
  if (dayPosition < settings.coreMinDayPositionRate || dayPosition > settings.coreMaxDayPositionRate) {
    return { pass: false, reason: `당일위치 부적합 ${dayPosition.toFixed(1)}%` };
  }

  return {
    pass: true,
    reason: `CORE 통과 / 상승 ${changeRate.toFixed(2)}% / 거래량 ${volumeRatio.toFixed(1)}% / 위치 ${dayPosition.toFixed(1)}%`
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

  return {
    pass: true,
    reason: `VOLUME 통과 / 상승 ${changeRate.toFixed(2)}% / 거래량 ${volumeRatio.toFixed(1)}% / 위치 ${dayPosition.toFixed(1)}% / 시가대비 ${openPosition.toFixed(2)}%`
  };
}

function paperBuy(state, item, price, strategyGroup, reason) {
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

  const holding = {
    code: item.code,
    name: item.name || item.stockName || item.korName || item.code,
    strategyGroup,
    buyPrice: price,
    currentPrice: price,
    highestPrice: price,
    lowestPrice: price,
    qty,
    buyAmount: price * qty,
    buyTime: nowText(),
    buyTimeMs: Date.now(),
    buyAt: new Date().toISOString(),
    date: todayKey()
  };

  state.holdings.push(holding);
  state.totalCash = availableCash - price * qty;

  state.tradeLogs.push({
    type: `${strategyGroup}_BUY`,
    strategyGroup,
    code: holding.code,
    name: holding.name,
    price,
    buyPrice: price,
    qty,
    buyAmount: price * qty,
    reason,
    date: todayKey(),
    time: nowText()
  });

  console.log(`[${strategyGroup} 매수] ${holding.name} / ${price}원 / ${qty}주 / ${reason}`);
  return true;
}

function paperSell(state, holding, sellPrice, sellQty, sellType, reason) {
  const qty = Math.min(Number(sellQty || 0), Number(holding.qty || 0));
  if (qty <= 0) return false;

  const buyPrice = Number(holding.buyPrice || 0);
  const profit = Math.floor((sellPrice - buyPrice) * qty);
  const profitRate = buyPrice > 0
    ? ((sellPrice - buyPrice) / buyPrice) * 100
    : 0;

  holding.qty -= qty;

  state.totalCash = Number(state.totalCash || 0) + sellPrice * qty;

  state.tradeLogs.push({
    type: sellType,
    strategyGroup: holding.strategyGroup,
    code: holding.code,
    name: holding.name,
    buyPrice,
    sellPrice,
    price: sellPrice,
    qty,
    profit,
    profitRate,
    reason,
    date: todayKey(),
    time: nowText()
  });

  state.virtualResults.push({
    code: holding.code,
    name: holding.name,
    strategyGroup: holding.strategyGroup,
    buyPrice,
    sellPrice,
    qty,
    profit,
    profitRate,
    reason,
    date: todayKey(),
    sellTime: new Date().toISOString()
  });

  console.log(
    `[${sellType}] ${holding.name} / ${sellPrice}원 / ${qty}주 / ` +
    `손익 ${profit.toLocaleString()}원 / ${profitRate.toFixed(2)}% / ${reason}`
  );

  if (holding.qty <= 0) {
    state.holdings = state.holdings.filter(h => h !== holding);
  }

  return true;
}

function getSellSignal(holding, price) {
  const buyPrice = Number(holding.buyPrice || 0);
  if (!buyPrice || !price) return null;

  const profitRate = ((price - buyPrice) / buyPrice) * 100;

  holding.highestPrice = Math.max(Number(holding.highestPrice || price), price);
  holding.lowestPrice = Math.min(Number(holding.lowestPrice || price), price);

  const highestProfitRate =
    ((holding.highestPrice - buyPrice) / buyPrice) * 100;

  const drawdownFromHigh =
    ((price - holding.highestPrice) / holding.highestPrice) * 100;

  // 1. 손절
  if (profitRate <= settings.stopLossRate) {
    return {
      type: `${holding.strategyGroup}_STOP_LOSS`,
      qty: holding.qty,
      reason: `손절 ${profitRate.toFixed(2)}%`
    };
  }

  // 2. 1차 익절
  if (
    !holding.firstTakeProfitDone &&
    profitRate >= settings.firstTakeProfitRate
  ) {
    const sellQty = Math.max(
      1,
      Math.floor(Number(holding.qty || 0) * settings.firstTakeProfitSellRatio)
    );

    holding.firstTakeProfitDone = true;

    return {
      type: `${holding.strategyGroup}_FIRST_TAKE_PROFIT`,
      qty: sellQty,
      reason: `1차 익절 ${profitRate.toFixed(2)}%`
    };
  }

  // 3. 트레일링 스탑
  if (
    highestProfitRate >= settings.trailingStartRate &&
    drawdownFromHigh <= -Math.abs(settings.trailingStopRate)
  ) {
    return {
      type: `${holding.strategyGroup}_TRAILING_STOP`,
      qty: holding.qty,
      reason:
        `트레일링 / 최고수익 ${highestProfitRate.toFixed(2)}% / ` +
        `고점대비 ${drawdownFromHigh.toFixed(2)}%`
    };
  }

    // 4. 장마감 청산
  const now = new Date();
  const hhmm =
    String(now.getHours()).padStart(2, "0") +
    ":" +
    String(now.getMinutes()).padStart(2, "0");

  if (hhmm >= settings.endSellTime) {
    if (!settings.endSellOnlyPositive || profitRate > 0) {
      return {
        type: `${holding.strategyGroup}_END_SELL`,
        qty: holding.qty,
        reason: `장마감 청산 ${profitRate.toFixed(2)}%`
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

  console.log("[BUY] 후보 조회 시작");

  const candidates = await discoverCandidates();

  console.log(`[BUY] 후보 조회 완료 / ${candidates.length}개`);

  console.log(
  `[BUY] 현재 보유 CORE ${getHoldingCount(state, "CORE")}개 / ` +
  `VOLUME ${getHoldingCount(state, "VOLUME")}개 / ` +
  `현금 ${Number(state.totalCash || 0).toLocaleString()}원`
);

  for (const item of candidates) {
  const price = Math.abs(Number(item.currentPrice || item.price || item.raw?.cur_prc || 0));
  const name = item.name || item.stockName || item.korName || item.code;

  if (!price) {
    console.log(`[후보제외] ${name} / 현재가 없음`);
    continue;
  }

  const coreJudge = judgeCoreBuy(state, item, price);
  if (coreJudge.pass) {
    paperBuy(state, item, price, "CORE", coreJudge.reason);
    continue;
  }

  console.log(`[CORE 제외] ${name} / ${coreJudge.reason}`);

  const volumeJudge = judgeVolumeBuy(state, item, price);
  if (volumeJudge.pass) {
    paperBuy(state, item, price, "VOLUME", volumeJudge.reason);
    continue;
  }

  console.log(`[VOLUME 제외] ${name} / ${volumeJudge.reason}`);
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

    paperSell(
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
