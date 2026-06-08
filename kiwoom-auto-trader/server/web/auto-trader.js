const fs = require("fs");
const path = require("path");

const STATE_FILE = path.join(__dirname, "paper-state.json");

const API_BASE = "http://localhost:3000";


const settings = {
  totalCash: 100000000,
  maxHoldingCount: 8,

  perBuyAmount: 10000000,
  dailyMaxLoss: 5000000,
  maxConsecutiveLoss: 3,

  discoverLimit: 300,
  minScore: 7,
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
};



let isRunning = false;

function loadState() {
  if (!fs.existsSync(STATE_FILE)) {
    return {
  holdings: [],
  tradeLogs: [],
  virtualResults: [],
  lastRunAt: null,
  lastSellCheckAt: null,
  serverAutoEnabled: true
};
  }

  const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));

if (state.serverAutoEnabled === undefined) {
  state.serverAutoEnabled = true;
}

return state;
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
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


function getTodayRealizedProfit(state) {
  const today = todayKey();

  const results = [
    ...(state.virtualResults || []),
    ...(state.results || [])
  ];

  return results
    .filter((item) => item.date === today)
    .reduce((sum, item) => {
      return sum + Number(item.profit || 0);
    }, 0);
}

function isDailyLossLimitReached(state) {
  const todayProfit = getTodayRealizedProfit(state);

  return todayProfit <= -Math.abs(settings.dailyMaxLoss);
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









function getAvailableSlots(state) {
  return Math.max(0, settings.maxHoldingCount - state.holdings.length);
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

  const passedResults = results
    .filter((item) => item.passed)
    .sort((a, b) => b.profitRate - a.profitRate);

  return passedResults[0] || null;
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

function paperBuy(state, item, strategy) {
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

  const qty = Math.floor(settings.perBuyAmount / price);

  if (qty <= 0) return false;

  const holding = {
    code: item.code,
    name: item.name && item.name !== item.code ? item.name : (item.stockName || item.korName || item.code),
    buyPrice: price,
    qty,
    currentPrice: price,
    highestPrice: price,
    autoTrade: true,
    strategyPreset: strategy.key,
    strategyName: strategy.name,
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

  state.tradeLogs.push({
    type: "BUY",
    code: item.code,
    name: item.name,
    price,
    qty,
    strategyPreset: strategy.key,
    strategyName: strategy.name,
    reason: `서버 자동 모의매수 / 최고전략 ${strategy.name} / 백테스트 수익률 ${strategy.profitRate.toFixed(2)}%`,
    date: todayKey(),
    time: nowText()
  });

  return true;
}







function paperSell(state, holding, sellPrice, reason, actionType = "SELL", sellQtyInput = null) {
  if (!holding) return false;

  if (!state.sellKeys) {
    state.sellKeys = {};
  }

  const isPartialSell = actionType === "FIRST_TAKE_PROFIT";

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
    reason: reason || "서버 매도",
    strategyPreset: holding.strategyPreset,
    strategyName: holding.strategyName,
    date: new Date().toISOString().slice(0, 10),
    time: new Date().toLocaleString("ko-KR")
  });

  state.totalCash = Number(state.totalCash || 0) + sellAmount;

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
        Number(holding.highestPrice || holding.buyPrice || 0),
        currentPrice
      );

      const buyPrice = Number(holding.buyPrice || 0);

      const profitRate =
        buyPrice > 0
          ? ((currentPrice - buyPrice) / buyPrice) * 100
          : 0;

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

if (maxProfitRate >= settings.breakEvenTriggerRate) {
  holding.breakEvenActivated = true;
}

if (
  holding.breakEvenActivated &&
  profitRate <= settings.breakEvenSellRate &&
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
    pullbackRate >= 0.7 &&
    pullbackRate <= 3.5 &&
    reboundFromLowRate >= 0.7 &&
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



async function runServerAutoBuyOnce() {
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


if (isDailyLossLimitReached(state)) {


      console.log(
        `[일일 손실 제한] 오늘 손실이 ${settings.dailyMaxLoss}원 이상입니다. 자동매수를 중단합니다.`
      );
      return;
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

    const candidates = await discoverCandidates();

    if (!candidates || candidates.length === 0) {
      console.log("자동매수 후보가 없습니다.");
      return;
    }

    for (const item of candidates) {
      if (getAvailableSlots(state) <= 0) break;


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
       console.log(`[현재가 조회 실패 - 건너뜀] ${item.name} ${item.code}`);
        continue;
      }

      if (!currentPrice || currentPrice <= 0) {
        console.log(`[매수제외] ${item.name} ${item.code} / 현재가 없음`);
        continue;
      }

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


if (
  bestStrategy.key === "trend" &&
  Number(item.discoverScore || 0) < 8
) {
  console.log(
    `[매수제외] ${item.name} ${item.code} / 추세형 점수 부족 ${item.discoverScore}`
  );
  continue;
}

if (wasStoppedToday(state, item.code)) {
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


const maxAllowedChangeRate =
  (item.strategyPreset === "trend" || item.strategy === "trend") &&
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
        bestStrategy
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








function startServerAutoTrader() {
  console.log("서버 자동 모의매매 시작");

  setInterval(() => {
  runServerAutoBuyOnce();
}, 10 * 60 * 1000);

  
setInterval(() => {
    checkServerAutoSellOnce();
  }, 30 * 1000);
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
  checkServerAutoSellOnce,
  runClosingProfitSell,
  loadState
};



function setServerAutoEnabled(enabled) {
  const state = loadState();

  state.serverAutoEnabled = !!enabled;
  state.serverAutoChangedAt = new Date().toLocaleString("ko-KR");

  saveState(state);

  return state;
}
