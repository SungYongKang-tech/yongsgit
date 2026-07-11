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

  openEnabled: true,
  openBuyStartTime: "09:00",
  openBuyEndTime: "09:05",
  openForceSellTime: "09:30",
  openInvestmentRatio: 1.0,

  openMinDiscoverScore: 10,
  openMinChangeRate: 0.5,
  openMaxChangeRate: 4.0,
  openMinTradeVolumeRatio: 180,
  openMinDayPositionRate: 55,
  openMaxDayPositionRate: 85,
  openMinOpenPositionRate: 0.2,
  openMaxOpenPositionRate: 3.5,
  openConfirmWaitMs: 15 * 1000,

  openStopLossRate: -0.7,
  openTrailingStartRate: 0.7,
  openTrailingStopRate: 0.3,
  openStagnationStartRate: 0.4,
  openStagnationSeconds: 90,
  openMinProfitToStagnationSell: 0.15,
  openMaxHoldingMinutes: 30,

  openBuyLoopMs: 15 * 1000,
  openSellLoopMs: 5 * 1000,
  dailyLossLimitRate: 0.01
};

function nowText() {
  return new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
}

function todayKey() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
}

function getCurrentHHMM() {
  return new Date().toLocaleTimeString("ko-KR", {
    timeZone: "Asia/Seoul",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit"
  });
}

function isBetweenTime(start, end) {
  const hhmm = getCurrentHHMM();
  return hhmm >= start && hhmm <= end;
}

function loadState() {
  if (!fs.existsSync(STATE_FILE)) {
    return {
      holdings: [],
      tradeLogs: [],
      virtualResults: [],
      pendingBuyCodes: [],
      pendingSellCodes: [],
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
  if (typeof state.totalCash === "undefined") state.totalCash = settings.totalCash;
  return state;
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function initOpenDayIfNeeded(state) {
  const today = todayKey();
  if (state.openDate === today) return;

  state.openDate = today;
  state.openEnabled = settings.openEnabled;
  state.openCompleted = !settings.openEnabled;
  state.openSkipped = !settings.openEnabled;
  state.openCompletedAt = settings.openEnabled ? null : nowText();
  state.openSkipReason = settings.openEnabled ? null : "OPEN 설정 OFF";
  state.openCandidateHistory = {};
  state.openBuyAt = null;
  state.openBuyCode = null;
  state.openBuyName = null;
  state.openSellType = null;
  state.openSellReason = null;

  if (!Array.isArray(state.pendingBuyCodes)) state.pendingBuyCodes = [];
  if (!Array.isArray(state.pendingSellCodes)) state.pendingSellCodes = [];
  saveState(state);
}

function getTodayRealizedProfit(state) {
  const today = todayKey();
  return (state.tradeLogs || [])
    .filter(log => log.date === today && typeof log.profit !== "undefined")
    .reduce((sum, log) => sum + Number(log.profit || 0), 0);
}

function checkDailyLossLimit(state) {
  const todayProfit = getTodayRealizedProfit(state);
  const limit = Number(state.dailyLossLimit || 0);
  if (limit > 0 && todayProfit <= -Math.abs(limit)) {
    return {
      stopped: true,
      reason: `일일 손실한도 도달 / 실현손익 ${todayProfit.toLocaleString()}원 / 한도 ${limit.toLocaleString()}원`
    };
  }
  return { stopped: false, reason: "정상" };
}

async function fetchJson(url) {
  const res = await fetch(url);
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; }
  catch { data = { rawText: text }; }
  if (!res.ok) throw new Error(data.message || data.error || `API 오류 ${res.status}`);
  return data;
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; }
  catch { data = { rawText: text }; }
  if (!res.ok || data.ok === false) {
    throw new Error(data.message || data.error || `POST API 오류 ${res.status}`);
  }
  return data;
}

async function fetchPrice(code) {
  const data = await fetchJson(`${API_BASE}/api/price?code=${code}`);
  return Math.abs(Number(
    data.currentPrice || data.price || data.curPrice || data.raw?.cur_prc || 0
  ));
}

function isExcludedStock(item = {}) {
  const name = String(item.name || item.stockName || item.korName || "").trim();
  if (/KODEX|TIGER|ACE|SOL|HANARO|KOSEF|KBSTAR|ARIRANG|ETF|ETN|레버리지|인버스|스팩|SPAC/i.test(name)) return true;
  if (/우$|\d우B$|우B$|우선주/i.test(name)) return true;
  return false;
}

function getTradeVolumeRatio(item = {}) {
  const raw = item.raw || {};
  const value = String(raw.trde_pre || item.trde_pre || item.tradeVolumeRatio || "")
    .replace(/[+,]/g, "");
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

function hasOpenHolding(state) {
  return (state.holdings || []).some(h => h.strategyGroup === "OPEN");
}

function hasOpenBuyToday(state) {
  return (state.tradeLogs || []).some(log =>
    log.date === todayKey() && log.type === "OPEN_BUY"
  );
}

function wasBoughtToday(state, code) {
  return (state.tradeLogs || []).some(log =>
    log.date === todayKey() &&
    log.code === code &&
    ["OPEN_BUY", "CORE_BUY", "VOLUME_BUY"].includes(log.type)
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

  console.log(`[OPEN DISCOVER] 원본 ${rawItems.length}개 / 필터후 ${filtered.length}개`);
  return filtered;
}

function isOpenCandidateGettingStronger(state, item, price) {
  const code = item.code;
  if (!code) return { pass: false, reason: "종목코드 없음" };
  if (!state.openCandidateHistory) state.openCandidateHistory = {};

  const now = Date.now();
  const current = {
    time: now,
    score: Number(item.discoverScore || 0),
    volumeRatio: getTradeVolumeRatio(item),
    dayPosition: getDayPositionRate(item, price),
    price: Number(price || 0)
  };
  const prev = state.openCandidateHistory[code];
  state.openCandidateHistory[code] = current;

  if (!prev) return { pass: false, reason: "첫 발견 / 15초 확인 대기" };
  if (now - Number(prev.time || 0) < settings.openConfirmWaitMs) {
    return { pass: false, reason: "OPEN 강화 확인 대기" };
  }

  const scoreDiff = current.score - Number(prev.score || 0);
  const volumeDiff = current.volumeRatio - Number(prev.volumeRatio || 0);
  const priceDiffRate = prev.price > 0
    ? ((current.price - prev.price) / prev.price) * 100
    : 0;

  if (scoreDiff < 0) return { pass: false, reason: `점수 약화 ${prev.score}→${current.score}` };
  if (volumeDiff < -20) return { pass: false, reason: `거래량 약화 ${prev.volumeRatio.toFixed(1)}→${current.volumeRatio.toFixed(1)}%` };
  if (priceDiffRate < 0) return { pass: false, reason: `확인 중 가격 하락 ${priceDiffRate.toFixed(2)}%` };

  return {
    pass: true,
    reason: `강화 확인 / 점수 ${prev.score}→${current.score} / 거래량 ${prev.volumeRatio.toFixed(1)}→${current.volumeRatio.toFixed(1)}% / 가격 ${priceDiffRate.toFixed(2)}%`
  };
}

function judgeOpenBuy(state, item, price) {
  const changeRate = Number(item.changeRate || item.fluctuationRate || item.riseRate || item.rate || 0);
  const volumeRatio = getTradeVolumeRatio(item);
  const dayPosition = getDayPositionRate(item, price);
  const openPosition = getOpenPositionRate(item, price);
  const discoverScore = Number(item.discoverScore || 0);

  if (!settings.openEnabled) return { pass: false, reason: "OPEN OFF" };
  if (!isBetweenTime(settings.openBuyStartTime, settings.openBuyEndTime)) return { pass: false, reason: "OPEN 시간 아님" };
  if (state.openCompleted) return { pass: false, reason: "오늘 OPEN 종료" };
  if (hasOpenBuyToday(state)) return { pass: false, reason: "오늘 OPEN 이미 매수" };
  if ((state.holdings || []).length > 0) return { pass: false, reason: "기존 보유종목 있음" };
  if (wasBoughtToday(state, item.code)) return { pass: false, reason: "오늘 이미 매수한 종목" };
  if (discoverScore < settings.openMinDiscoverScore) return { pass: false, reason: `발견점수 부족 ${discoverScore}` };
  if (changeRate < settings.openMinChangeRate || changeRate > settings.openMaxChangeRate) return { pass: false, reason: `상승률 부적합 ${changeRate.toFixed(2)}%` };
  if (volumeRatio < settings.openMinTradeVolumeRatio) return { pass: false, reason: `거래량 부족 ${volumeRatio.toFixed(1)}%` };
  if (dayPosition < settings.openMinDayPositionRate || dayPosition > settings.openMaxDayPositionRate) return { pass: false, reason: `당일위치 부적합 ${dayPosition.toFixed(1)}%` };
  if (openPosition < settings.openMinOpenPositionRate || openPosition > settings.openMaxOpenPositionRate) return { pass: false, reason: `시가대비 부적합 ${openPosition.toFixed(2)}%` };

  const strengthen = isOpenCandidateGettingStronger(state, item, price);
  if (!strengthen.pass) return { pass: false, reason: strengthen.reason };

  const rankScore =
    discoverScore * 10 +
    Math.min(volumeRatio, 500) * 0.15 +
    dayPosition * 0.25 +
    Math.max(0, 4 - changeRate) * 5;

  return {
    pass: true,
    rankScore,
    reason: `OPEN 통과 / 발견 ${discoverScore} / 상승 ${changeRate.toFixed(2)}% / 거래량 ${volumeRatio.toFixed(1)}% / 위치 ${dayPosition.toFixed(1)}% / 시가대비 ${openPosition.toFixed(2)}% / 순위점수 ${rankScore.toFixed(1)}`
  };
}

async function paperOpenBuy(state, item, price, reason) {
  if (state.pendingBuyCodes.includes(item.code)) return false;
  state.pendingBuyCodes.push(item.code);
  saveState(state);

  try {
    const availableCash = Number(state.totalCash || 0);
    const buyAmount = availableCash * settings.openInvestmentRatio;
    const qty = Math.floor(buyAmount / price);
    if (qty <= 0) return false;

    const name = item.name || item.stockName || item.korName || item.code;
    const result = await postJson(`${API_BASE}/api/core-paper-buy`, {
      code: item.code,
      name,
      price,
      qty,
      strategyGroup: "OPEN",
      reason
    });

    state.holdings.push({
      code: item.code,
      name,
      strategyGroup: "OPEN",
      buyPrice: price,
      currentPrice: price,
      qty,
      buyAmount: price * qty,
      buyTime: Date.now(),
      highestPrice: price,
      highestPriceAt: Date.now(),
      lowestPrice: price
    });

    state.tradeLogs.push({
      date: todayKey(),
      time: nowText(),
      type: "OPEN_BUY",
      code: item.code,
      name,
      price,
      qty,
      amount: price * qty,
      strategyGroup: "OPEN",
      reason
    });

    state.totalCash = Number(result.totalCash ?? state.totalCash ?? 0);
    state.openSkipped = false;
    state.openBuyAt = nowText();
    state.openBuyCode = item.code;
    state.openBuyName = name;
    saveState(state);

    console.log(`[OPEN 매수완료] ${name} / ${price.toLocaleString()}원 / ${qty}주 / 현금 ${state.totalCash.toLocaleString()}원`);
    return true;
  } finally {
    state.pendingBuyCodes = state.pendingBuyCodes.filter(code => code !== item.code);
    saveState(state);
  }
}

function getOpenSellSignal(holding, price) {
  const buyPrice = Number(holding.buyPrice || 0);
  if (!buyPrice || !price) return null;

  const now = Date.now();
  const buyTime = Number(holding.buyTime || 0);
  const holdMinutes = buyTime > 0 ? (now - buyTime) / 60000 : 999;
  const profitRate = ((price - buyPrice) / buyPrice) * 100;

  if (!holding.highestPrice || price > Number(holding.highestPrice || 0)) {
    holding.highestPrice = price;
    holding.highestPriceAt = now;
  }
  holding.lowestPrice = Math.min(Number(holding.lowestPrice || price), price);

  const highestProfitRate = ((Number(holding.highestPrice) - buyPrice) / buyPrice) * 100;
  const drawdownFromHigh = ((price - Number(holding.highestPrice)) / Number(holding.highestPrice)) * 100;
  const secondsFromHigh = holding.highestPriceAt
    ? (now - Number(holding.highestPriceAt)) / 1000
    : 0;
  const hhmm = getCurrentHHMM();

  if (profitRate <= settings.openStopLossRate) {
    return { type: "OPEN_STOP_LOSS", qty: holding.qty, reason: `OPEN 손절 ${profitRate.toFixed(2)}% / 기준 ${settings.openStopLossRate.toFixed(2)}%` };
  }

  if (highestProfitRate >= settings.openTrailingStartRate && drawdownFromHigh <= -Math.abs(settings.openTrailingStopRate)) {
    return {
      type: "OPEN_TRAILING_SELL",
      qty: holding.qty,
      reason: `OPEN 전량익절 / 최고 ${highestProfitRate.toFixed(2)}% / 현재 ${profitRate.toFixed(2)}% / 고점대비 ${drawdownFromHigh.toFixed(2)}%`
    };
  }

  if (
    highestProfitRate >= settings.openStagnationStartRate &&
    profitRate >= settings.openMinProfitToStagnationSell &&
    secondsFromHigh >= settings.openStagnationSeconds
  ) {
    return {
      type: "OPEN_STAGNATION_SELL",
      qty: holding.qty,
      reason: `OPEN 상승주춤 / 최고 ${highestProfitRate.toFixed(2)}% / 현재 ${profitRate.toFixed(2)}% / 고가 미갱신 ${Math.floor(secondsFromHigh)}초`
    };
  }

  if (holdMinutes >= settings.openMaxHoldingMinutes || hhmm >= settings.openForceSellTime) {
    return {
      type: "OPEN_TIME_SELL",
      qty: holding.qty,
      reason: `OPEN 시간청산 / 보유 ${holdMinutes.toFixed(1)}분 / 수익 ${profitRate.toFixed(2)}% / 현재시각 ${hhmm}`
    };
  }

  return null;
}

async function paperOpenSell(state, holding, price, signal) {
  const sellKey = `${holding.code}_${signal.type}`;
  if (state.pendingSellCodes.includes(sellKey)) return false;
  state.pendingSellCodes.push(sellKey);
  saveState(state);

  try {
    const qty = Number(holding.qty || 0);
    if (qty <= 0) return false;

    const result = await postJson(`${API_BASE}/api/core-paper-sell`, {
      code: holding.code,
      price,
      qty,
      sellType: signal.type,
      reason: signal.reason
    });

    state.holdings = state.holdings.filter(h => h !== holding);
    state.totalCash = Number(result.totalCash ?? state.totalCash ?? 0);
    state.tradeLogs.push({
      date: todayKey(),
      time: nowText(),
      type: signal.type,
      code: holding.code,
      name: holding.name,
      price,
      qty,
      profit: Number(result.profit || 0),
      profitRate: Number(result.profitRate || 0),
      strategyGroup: "OPEN",
      reason: signal.reason
    });

    state.openCompleted = true;
    state.openSkipped = false;
    state.openCompletedAt = nowText();
    state.openSellType = signal.type;
    state.openSellReason = signal.reason;
    saveState(state);

    console.log(`[${signal.type} 완료] ${holding.name} / ${price.toLocaleString()}원 / 손익 ${Number(result.profit || 0).toLocaleString()}원`);
    return true;
  } finally {
    state.pendingSellCodes = state.pendingSellCodes.filter(key => key !== sellKey);
    saveState(state);
  }
}

async function runOpenBuyOnce() {
  const state = loadState();
  initOpenDayIfNeeded(state);

  if (!state.serverAutoEnabled || !settings.openEnabled) return;
  if (state.openCompleted || hasOpenHolding(state) || hasOpenBuyToday(state)) return;

  const hhmm = getCurrentHHMM();
  if (hhmm < settings.openBuyStartTime) return;

  if (hhmm > settings.openBuyEndTime) {
    state.openCompleted = true;
    state.openSkipped = true;
    state.openCompletedAt = nowText();
    state.openSkipReason = "OPEN 매수시간 종료 / 적합 후보 없음";
    saveState(state);
    console.log(`[OPEN 종료] ${state.openSkipReason}`);
    return;
  }

  const risk = checkDailyLossLimit(state);
  if (risk.stopped) {
    state.openCompleted = true;
    state.openSkipped = true;
    state.openCompletedAt = nowText();
    state.openSkipReason = risk.reason;
    saveState(state);
    console.log(`[OPEN 중단] ${risk.reason}`);
    return;
  }

  const candidates = await discoverCandidates();
  const passed = [];
  let logged = 0;

  for (const item of candidates) {
    const price = Math.abs(Number(item.currentPrice || item.price || item.raw?.cur_prc || 0));
    const name = item.name || item.stockName || item.korName || item.code;
    if (!price) continue;

    const judged = judgeOpenBuy(state, item, price);
    if (judged.pass) passed.push({ item, price, judged });
    else if (logged < 10) {
      console.log(`[OPEN 제외] ${name} / ${judged.reason}`);
      logged++;
    }
  }

  saveState(state);
  if (!passed.length) {
    console.log("[OPEN] 현재 통과 후보 없음");
    return;
  }

  passed.sort((a, b) => b.judged.rankScore - a.judged.rankScore);
  const best = passed[0];
  console.log(`[OPEN 최종선정] ${best.item.name || best.item.code} / 점수 ${best.judged.rankScore.toFixed(1)} / 통과후보 ${passed.length}개`);
  await paperOpenBuy(state, best.item, best.price, best.judged.reason);
}

async function checkOpenSellOnce() {
  const state = loadState();
  initOpenDayIfNeeded(state);
  if (!state.serverAutoEnabled) return;

  const openHoldings = (state.holdings || []).filter(h => h.strategyGroup === "OPEN");
  for (const holding of openHoldings) {
    let price = 0;
    try { price = await fetchPrice(holding.code); }
    catch (err) {
      console.log(`[OPEN 가격조회 실패] ${holding.name} / ${err.message}`);
      price = Number(holding.currentPrice || holding.buyPrice || 0);
    }
    if (!price) continue;

    holding.currentPrice = price;
    const signal = getOpenSellSignal(holding, price);
    if (!signal) {
      const rate = ((price - Number(holding.buyPrice)) / Number(holding.buyPrice)) * 100;
      console.log(`[OPEN 유지] ${holding.name} / ${price.toLocaleString()}원 / ${rate.toFixed(2)}%`);
      saveState(state);
      continue;
    }
    await paperOpenSell(state, holding, price, signal);
  }
}

let started = false;

async function start() {
  console.log("SY Quant OPEN 전용 자동매매 시작");
  await runOpenBuyOnce();
  await checkOpenSellOnce();

  let buyRunning = false;
  let sellRunning = false;

  setInterval(async () => {
    if (buyRunning) return;
    buyRunning = true;
    try { await runOpenBuyOnce(); }
    catch (err) { console.error("[OPEN BUY LOOP 오류]", err.message); }
    finally { buyRunning = false; }
  }, settings.openBuyLoopMs);

  setInterval(async () => {
    if (sellRunning) return;
    sellRunning = true;
    try { await checkOpenSellOnce(); }
    catch (err) { console.error("[OPEN SELL LOOP 오류]", err.message); }
    finally { sellRunning = false; }
  }, settings.openSellLoopMs);
}

function startOpenStrategy() {
  if (started) {
    console.log("[OPEN START] 이미 실행 중입니다.");
    return;
  }
  started = true;
  start().catch(err => {
    started = false;
    console.error("[OPEN START 오류]", err.message);
  });
}

module.exports = {
  startOpenStrategy,
  runOpenBuyOnce,
  checkOpenSellOnce,
  loadState,
  saveState
};
