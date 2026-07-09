const fs = require("fs");
const path = require("path");

const STATE_FILE = path.join(__dirname, "paper-state.json");
const API_BASE = "http://localhost:3000";

const settings = {
  totalCash: 100000000,

  serverAutoEnabledDefault: true,

  discoverScanLimit: 300,
  discoverLimit: 150,
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
  sellLoopMs: 30 * 1000
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

function isExcludedStock(item = {}) {
  const name = String(item.name || item.stockName || item.korName || "").trim();

  return /KODEX|TIGER|ACE|SOL|HANARO|KOSEF|KBSTAR|ARIRANG|ETF|ETN|레버리지|인버스|스팩|SPAC/i.test(name)
    || name.endsWith("우");
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

  return (data.items || [])
    .filter(item => !isExcludedStock(item))
    .filter(item => Number(item.discoverScore || 0) >= settings.minDiscoverScore)
    .sort((a, b) => Number(b.discoverScore || 0) - Number(a.discoverScore || 0));
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

  for (const item of candidates) {
    const price = Math.abs(Number(item.currentPrice || item.price || item.raw?.cur_prc || 0));
    if (!price) continue;

    const coreJudge = judgeCoreBuy(state, item, price);
    if (coreJudge.pass) {
      paperBuy(state, item, price, "CORE", coreJudge.reason);
      continue;
    }

    const volumeJudge = judgeVolumeBuy(state, item, price);
    if (volumeJudge.pass) {
      paperBuy(state, item, price, "VOLUME", volumeJudge.reason);
      continue;
    }
  }

  state.lastBuyCheckAt = nowText();
  saveState(state);

  console.log("[BUY] 1회 점검 종료");
}

function checkSellOnce() {
  const state = loadState();

  if (!state.serverAutoEnabled) {
    console.log("[SELL] 서버 자동매매 OFF");
    return;
  }

  for (const holding of [...state.holdings]) {
    const price = Number(holding.currentPrice || holding.buyPrice || 0);
    const buyPrice = Number(holding.buyPrice || 0);

    if (!price || !buyPrice) continue;

    const profitRate = ((price - buyPrice) / buyPrice) * 100;

    holding.highestPrice = Math.max(Number(holding.highestPrice || price), price);
    holding.lowestPrice = Math.min(Number(holding.lowestPrice || price), price);

    if (profitRate <= settings.stopLossRate) {
      console.log(`[매도필요] ${holding.name} / 손절 ${profitRate.toFixed(2)}%`);
    }
  }

  state.lastSellCheckAt = nowText();
  saveState(state);
}


async function start() {
  console.log("SY Quant Core/Volume 전용 자동매매 시작");

  await runBuyOnce();
  checkSellOnce();

  let buyRunning = false;

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

  setInterval(() => {
    try {
      checkSellOnce();
    } catch (err) {
      console.error("[SELL LOOP 오류]", err.message);
    }
  }, settings.sellLoopMs);
}

start().catch(err => {
  console.error("[START 오류]", err.message);
});
