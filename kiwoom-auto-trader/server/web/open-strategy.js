const fs = require("fs");
const path = require("path");

const STATE_FILE = path.join(__dirname, "paper-state-core.json");
const OPEN_HISTORY_FILE = path.join(__dirname, "open-learning-history.json");
const OPEN_MARKET_FILE = path.join(__dirname, "open-market.json");
const API_BASE = "http://localhost:3000";


function sleepSync(ms) {
  const sab = new SharedArrayBuffer(4);
  const view = new Int32Array(sab);
  Atomics.wait(view, 0, 0, ms);
}

function readJsonFileSafe(filePath, fallbackValue = null, attempts = 5) {
  if (!fs.existsSync(filePath)) return fallbackValue;

  let lastError = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const text = fs.readFileSync(filePath, "utf8");
      if (!text.trim()) throw new Error("빈 JSON 파일");
      return JSON.parse(text);
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) sleepSync(50);
    }
  }

  throw new Error(`${path.basename(filePath)} 읽기 실패: ${lastError?.message || "알 수 없는 오류"}`);
}

function writeJsonFileAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tempPath = path.join(dir, `.${base}.${process.pid}.${Date.now()}.tmp`);
  const json = JSON.stringify(data, null, 2);

  try {
    fs.writeFileSync(tempPath, json, "utf8");
    const fd = fs.openSync(tempPath, "r");
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tempPath, filePath);
  } finally {
    if (fs.existsSync(tempPath)) {
      try { fs.unlinkSync(tempPath); } catch (_) {}
    }
  }
}

function isKoreanWeekday() {
  const day = new Date().toLocaleDateString("en-US", {
    timeZone: "Asia/Seoul",
    weekday: "short"
  });
  return day !== "Sat" && day !== "Sun";
}


const settings = {
  totalCash: 100000000,
  serverAutoEnabledDefault: true,

  discoverScanLimit: 150,
  discoverLimit: 100,
  minDiscoverScore: 7,

  // OPEN 2.0: 장전 우선종목을 먼저 감시하고 일반검색은 보완용으로 순환
  openPriorityMaxCount: 15,
  openFallbackScanLimit: 200,
  openPriorityPriceDelayMs: 350,

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

  openBuyLoopMs: 5 * 1000,
  openSellLoopMs: 5 * 1000,
  dailyLossLimitRate: 0.01,

  // 가상후보 추적은 분석자료 저장용이며, 실제 매수 점수에는 반영하지 않음
  openLearningTopCount: 10,
  openVirtualTrackingCount: 10,
  openVirtualLoopMs: 30 * 1000,

  openMarketMaxAgeHours: 96,
  openMarketMinSuccessCount: 5,
  openMarketMaxBonus: 15,
  openSectorMaxBonus: 15
};

function nowText() {
  return new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
}

function todayKey() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
}

function getCurrentHHMM() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit"
  }).formatToParts(new Date());

  const hour =
    parts.find(part => part.type === "hour")?.value || "00";

  const minute =
    parts.find(part => part.type === "minute")?.value || "00";

  return `${hour}:${minute}`;
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

  const state = readJsonFileSafe(STATE_FILE);
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
  writeJsonFileAtomic(STATE_FILE, state);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value || 0)));
}

function loadOpenMarketData() {
  if (!fs.existsSync(OPEN_MARKET_FILE)) {
    return { available: false, reason: "open-market.json 없음" };
  }

  try {
    const data = readJsonFileSafe(OPEN_MARKET_FILE);
    const ageHours = data.updatedAtMs
      ? (Date.now() - Number(data.updatedAtMs)) / 3600000
      : 9999;
    const statusOk = ["OK", "PARTIAL"].includes(String(data.status || "").toUpperCase());
    const enoughData = Number(data.successCount || 0) >= settings.openMarketMinSuccessCount;
    const fresh = ageHours <= settings.openMarketMaxAgeHours;

    if (!statusOk || !enoughData || !fresh) {
      return {
        available: false,
        reason: `시장자료 사용불가 / 상태 ${data.status || "-"} / 성공 ${data.successCount || 0} / 경과 ${ageHours.toFixed(1)}시간`,
        raw: data
      };
    }

    return {
      available: true,
      ageHours,
      marketScore: Number(data.marketScore || 0),
      marketType: data.marketType || "NORMAL",
      sectorBias: data.sectorBias || {},
      newsScore: Number(data.newsScore || 0),
      reasons: Array.isArray(data.reasons) ? data.reasons : [],
      updatedAt: data.updatedAt || null,
      indicators: data.indicators || {},
      raw: data
    };
  } catch (err) {
    return { available: false, reason: `시장자료 읽기 오류 / ${err.message}` };
  }
}

function getItemContextText(item = {}) {
  const values = [
    item.name, item.stockName, item.korName, item.industry, item.sector,
    item.theme, item.sectorName, item.industryName,
    ...(Array.isArray(item.sectorTags) ? item.sectorTags : []),
    ...(Array.isArray(item.themeTags) ? item.themeTags : []),
    ...(Array.isArray(item.discoverReasons) ? item.discoverReasons : []),
    item.raw?.업종명, item.raw?.theme_nm, item.raw?.sector_nm
  ];
  return values.filter(Boolean).join(" ").toLowerCase();
}

function detectOpenSectors(item = {}) {
  const text = getItemContextText(item);
  const sectors = [];

  if (/반도체|hbm|메모리|파운드리|웨이퍼|칩|pcb|후공정|패키징|sk하이닉스|삼성전자/.test(text)) sectors.push("semiconductor");
  if (/인공지능|\bai\b|로봇|클라우드|데이터센터|소프트웨어|자율주행|스마트팩토리/.test(text)) sectors.push("ai");
  if (/성장주|인터넷|플랫폼|바이오|게임|2차전지|전기차/.test(text)) sectors.push("growth");
  if (/정유|석유|원유|가스|에너지|유전|태양광|풍력|원전/.test(text)) sectors.push("energy");
  if (/통신|음식료|보험|은행|유틸리티|필수소비재/.test(text)) sectors.push("defensive");

  return [...new Set(sectors)];
}

function calculateOpenMarketAdjustment(item, marketData) {
  if (!marketData?.available) {
    return { marketBonus: 0, sectorBonus: 0, totalBonus: 0, matchedSectors: [], reason: marketData?.reason || "시장자료 없음" };
  }

  const score = Number(marketData.marketScore || 0);
  let marketBonus = 0;
  if (score >= 85) marketBonus = 15;
  else if (score >= 75) marketBonus = 11;
  else if (score >= 65) marketBonus = 7;
  else if (score >= 55) marketBonus = 3;
  else if (score < 45) marketBonus = -5;

  marketBonus = clamp(marketBonus, -5, settings.openMarketMaxBonus);

  const matchedSectors = detectOpenSectors(item);
  const biases = matchedSectors.map(key => Number(marketData.sectorBias?.[key] || 0));
  const strongestBias = biases.length ? Math.max(...biases) : 0;
  const weakestBias = biases.length ? Math.min(...biases) : 0;
  let sectorBonus = strongestBias > 0 ? strongestBias : weakestBias;
  sectorBonus = clamp(sectorBonus, -10, settings.openSectorMaxBonus);

  return {
    marketBonus,
    sectorBonus,
    totalBonus: marketBonus + sectorBonus,
    matchedSectors,
    marketScore: score,
    marketType: marketData.marketType,
    strongestBias,
    reason: `시장 ${score}점/${marketData.marketType} ${marketBonus >= 0 ? "+" : ""}${marketBonus.toFixed(1)} / 섹터 ${matchedSectors.join(",") || "없음"} ${sectorBonus >= 0 ? "+" : ""}${sectorBonus.toFixed(1)}`
  };
}

function loadOpenHistory() {
  if (!fs.existsSync(OPEN_HISTORY_FILE)) {
    return { version: 1, updatedAt: null, days: {} };
  }

  try {
    const data = readJsonFileSafe(OPEN_HISTORY_FILE);
    if (!data || typeof data !== "object") throw new Error("형식 오류");
    if (!data.days || typeof data.days !== "object") data.days = {};
    return data;
  } catch (err) {
    console.error("[OPEN 학습파일 읽기 오류]", err.message);
    return { version: 1, updatedAt: null, days: {} };
  }
}

function saveOpenHistory(history) {
  history.updatedAt = nowText();
  writeJsonFileAtomic(OPEN_HISTORY_FILE, history);
}

function getOpenLearningDay(history) {
  const date = todayKey();

  if (!history.days[date]) {
    history.days[date] = {
      date,
      createdAt: nowText(),
      status: "WAITING",
      latestCandidates: [],
      candidateObservations: {},
      selectedTrade: null,
      result: null,
      virtualTrackingStartedAt: null,
      virtualTrackingCompletedAt: null,
      virtualCandidates: []
    };
  }

  return history.days[date];
}

function makeOpenCandidateLearningRecord(item, price, judged) {
  const changeRate = Number(
    item.changeRate ||
    item.fluctuationRate ||
    item.riseRate ||
    item.rate ||
    0
  );

  return {
    code: String(item.code || ""),
    name: item.name || item.stockName || item.korName || item.code || "",
    observedAt: nowText(),
    price: Number(price || 0),
    discoverScore: Number(item.discoverScore || 0),
    changeRate,
    volumeRatio: getTradeVolumeRatio(item),
    dayPosition: getDayPositionRate(item, price),
    openPosition: getOpenPositionRate(item, price),
    passed: judged.pass === true,
    rankScore: Number(judged.rankScore || 0),
    reason: judged.reason || "",
    marketScore: Number(judged.marketScore || 0),
    marketType: judged.marketType || null,
    marketBonus: Number(judged.marketBonus || 0),
    sectorBonus: Number(judged.sectorBonus || 0),
    matchedSectors: Array.isArray(judged.matchedSectors) ? judged.matchedSectors : [],
    marketDataUpdatedAt: judged.marketDataUpdatedAt || null
  };
}


function getLearningCandidateSortScore(record = {}) {
  if (record.passed) return 100000 + Number(record.rankScore || 0);
  return (
    Number(record.discoverScore || 0) * 10 +
    Math.min(Number(record.volumeRatio || 0), 500) * 0.15 +
    Number(record.dayPosition || 0) * 0.25
  );
}

function initializeOpenVirtualTracking(records, selectedCode = null) {
  const history = loadOpenHistory();
  const day = getOpenLearningDay(history);

  if (Array.isArray(day.virtualCandidates) && day.virtualCandidates.length > 0) {
    return;
  }

  const unique = [];
  const seen = new Set();

  for (const source of records || []) {
    const record = source?.record || source;
    const code = String(record?.code || "");
    const price = Number(record?.price || 0);
    if (!code || !price || seen.has(code)) continue;
    seen.add(code);
    unique.push(record);
  }

  unique.sort((a, b) => getLearningCandidateSortScore(b) - getLearningCandidateSortScore(a));

  const startedAtMs = Date.now();
  day.virtualTrackingStartedAt = nowText();
  day.virtualTrackingStartedAtMs = startedAtMs;
  day.virtualTrackingCompletedAt = null;
  day.virtualCandidates = unique
    .slice(0, settings.openVirtualTrackingCount)
    .map((record, index) => ({
      rank: index + 1,
      code: String(record.code || ""),
      name: record.name || record.code || "",
      selectedForRealTrade: String(record.code || "") === String(selectedCode || ""),
      entryAt: nowText(),
      entryTimeMs: startedAtMs,
      entryPrice: Number(record.price || 0),
      discoverScore: Number(record.discoverScore || 0),
      rankScore: Number(record.rankScore || 0),
      changeRate: Number(record.changeRate || 0),
      volumeRatio: Number(record.volumeRatio || 0),
      dayPosition: Number(record.dayPosition || 0),
      openPosition: Number(record.openPosition || 0),
      passedAtSelection: record.passed === true,
      selectionReason: record.reason || "",
      active: true,
      sampleCount: 0,
      lastPrice: Number(record.price || 0),
      lastProfitRate: 0,
      highestPrice: Number(record.price || 0),
      lowestPrice: Number(record.price || 0),
      highestPriceAtMs: startedAtMs,
      highestProfitRate: 0,
      lowestProfitRate: 0,
      exitAt: null,
      exitPrice: null,
      exitProfitRate: null,
      exitType: null,
      exitReason: null,
      holdingSeconds: null,
      profitCaptureRate: null
    }));

  if (day.virtualCandidates.length > 0) {
    console.log(
      `[OPEN 가상추적 시작] ${day.virtualCandidates.length}종목 / ` +
      day.virtualCandidates.map(v => `${v.rank}.${v.name}`).join(" | ")
    );
  }

  saveOpenHistory(history);
}

function initializeVirtualTrackingFromLatestCandidates() {
  const history = loadOpenHistory();
  const day = getOpenLearningDay(history);
  if (Array.isArray(day.virtualCandidates) && day.virtualCandidates.length > 0) return;
  initializeOpenVirtualTracking(day.latestCandidates || [], null);
}

function getVirtualOpenSellSignal(candidate, price, now = Date.now()) {
  const buyPrice = Number(candidate.entryPrice || 0);
  if (!buyPrice || !price) return null;

  const profitRate = ((price - buyPrice) / buyPrice) * 100;

  if (!candidate.highestPrice || price > Number(candidate.highestPrice || 0)) {
    candidate.highestPrice = price;
    candidate.highestPriceAtMs = now;
  }
  candidate.lowestPrice = Math.min(Number(candidate.lowestPrice || price), price);

  candidate.lastPrice = price;
  candidate.lastProfitRate = profitRate;
  candidate.sampleCount = Number(candidate.sampleCount || 0) + 1;
  candidate.highestProfitRate =
    ((Number(candidate.highestPrice || price) - buyPrice) / buyPrice) * 100;
  candidate.lowestProfitRate =
    ((Number(candidate.lowestPrice || price) - buyPrice) / buyPrice) * 100;

  const drawdownFromHigh =
    ((price - Number(candidate.highestPrice || price)) /
      Number(candidate.highestPrice || price)) * 100;
  const secondsFromHigh = candidate.highestPriceAtMs
    ? (now - Number(candidate.highestPriceAtMs)) / 1000
    : 0;
  const holdingSeconds = candidate.entryTimeMs
    ? Math.max(0, Math.floor((now - Number(candidate.entryTimeMs)) / 1000))
    : 0;

  if (profitRate <= settings.openStopLossRate) {
    return {
      type: "VIRTUAL_OPEN_STOP_LOSS",
      reason: `가상 손절 ${profitRate.toFixed(2)}%`
    };
  }

  if (
    candidate.highestProfitRate >= settings.openTrailingStartRate &&
    drawdownFromHigh <= -Math.abs(settings.openTrailingStopRate)
  ) {
    return {
      type: "VIRTUAL_OPEN_TRAILING_SELL",
      reason:
        `가상 트레일링 / 최고 ${candidate.highestProfitRate.toFixed(2)}% / ` +
        `현재 ${profitRate.toFixed(2)}%`
    };
  }

  if (
    candidate.highestProfitRate >= settings.openStagnationStartRate &&
    profitRate >= settings.openMinProfitToStagnationSell &&
    secondsFromHigh >= settings.openStagnationSeconds
  ) {
    return {
      type: "VIRTUAL_OPEN_STAGNATION_SELL",
      reason:
        `가상 상승주춤 / 최고 ${candidate.highestProfitRate.toFixed(2)}% / ` +
        `현재 ${profitRate.toFixed(2)}% / 고가 미갱신 ${Math.floor(secondsFromHigh)}초`
    };
  }

  if (holdingSeconds >= settings.openMaxHoldingMinutes * 60) {
    return {
      type: "VIRTUAL_OPEN_TIME_SELL",
      reason: `가상 30분 청산 / 현재 ${profitRate.toFixed(2)}%`
    };
  }

  return null;
}

function completeVirtualCandidate(candidate, price, signal, now = Date.now()) {
  const buyPrice = Number(candidate.entryPrice || 0);
  const profitRate = buyPrice > 0 ? ((price - buyPrice) / buyPrice) * 100 : 0;

  candidate.active = false;
  candidate.exitAt = nowText();
  candidate.exitPrice = Number(price || 0);
  candidate.exitProfitRate = profitRate;
  candidate.exitType = signal.type;
  candidate.exitReason = signal.reason;
  candidate.holdingSeconds = candidate.entryTimeMs
    ? Math.max(0, Math.floor((now - Number(candidate.entryTimeMs)) / 1000))
    : null;
  candidate.profitCaptureRate = Number(candidate.highestProfitRate || 0) > 0
    ? (profitRate / Number(candidate.highestProfitRate)) * 100
    : null;
}

function initializeOpenDelayComparison(item, judged) {
  const comparison = judged?.delayComparison;
  if (!comparison) return;

  const history = loadOpenHistory();
  const day = getOpenLearningDay(history);
  if (day.openDelayComparison?.code) return;

  const now = Date.now();
  const name = item.name || item.stockName || item.korName || item.code || "";
  const variants = [
    { key: "IMMEDIATE_0S", label: "즉시 0초", delaySeconds: 0, entryPrice: Number(comparison.firstPrice || 0) },
    { key: "CONFIRM_5S", label: "5초 확인", delaySeconds: 5, entryPrice: Number(comparison.priceAt5Seconds || 0) },
    { key: "CONFIRM_15S", label: "15초 확인", delaySeconds: 15, entryPrice: Number(comparison.priceAt15Seconds || 0) }
  ].filter(v => v.entryPrice > 0);

  day.openDelayComparison = {
    code: String(item.code || ""),
    name,
    createdAt: nowText(),
    firstSeenAtMs: Number(comparison.firstSeenAtMs || now),
    variants: variants.map(v => ({
      ...v,
      entryAtMs: Number(comparison.firstSeenAtMs || now) + v.delaySeconds * 1000,
      active: true,
      highestPrice: v.entryPrice,
      lowestPrice: v.entryPrice,
      highestPriceAtMs: Number(comparison.firstSeenAtMs || now) + v.delaySeconds * 1000,
      highestProfitRate: 0,
      lowestProfitRate: 0,
      lastPrice: v.entryPrice,
      lastProfitRate: 0,
      sampleCount: 0,
      exitAt: null,
      exitPrice: null,
      exitProfitRate: null,
      exitType: null,
      exitReason: null,
      holdingSeconds: null
    }))
  };

  console.log(`[OPEN 진입비교 시작] ${name} / ` + variants.map(v => `${v.label} ${v.entryPrice.toLocaleString()}원`).join(" | "));
  saveOpenHistory(history);
}

function getOpenDelayComparisonSellSignal(variant, price, now = Date.now()) {
  const candidate = {
    entryPrice: variant.entryPrice,
    entryTimeMs: variant.entryAtMs,
    highestPrice: variant.highestPrice,
    lowestPrice: variant.lowestPrice,
    highestPriceAtMs: variant.highestPriceAtMs,
    sampleCount: variant.sampleCount,
    lastPrice: variant.lastPrice,
    lastProfitRate: variant.lastProfitRate,
    highestProfitRate: variant.highestProfitRate,
    lowestProfitRate: variant.lowestProfitRate
  };
  const signal = getVirtualOpenSellSignal(candidate, price, now);
  Object.assign(variant, {
    highestPrice: candidate.highestPrice,
    lowestPrice: candidate.lowestPrice,
    highestPriceAtMs: candidate.highestPriceAtMs,
    sampleCount: candidate.sampleCount,
    lastPrice: candidate.lastPrice,
    lastProfitRate: candidate.lastProfitRate,
    highestProfitRate: candidate.highestProfitRate,
    lowestProfitRate: candidate.lowestProfitRate
  });
  return signal;
}

async function updateOpenDelayComparisonOnce(history, day, now = Date.now()) {
  const comparison = day.openDelayComparison;
  if (!comparison?.code || !Array.isArray(comparison.variants)) return false;
  const active = comparison.variants.filter(v => v.active === true && now >= Number(v.entryAtMs || 0));
  if (!active.length) return false;

  let price = 0;
  try { price = await fetchPrice(comparison.code); }
  catch (err) {
    console.log(`[OPEN 진입비교 가격실패] ${comparison.name} / ${err.message}`);
    return false;
  }
  if (!price) return false;

  for (const variant of active) {
    const signal = getOpenDelayComparisonSellSignal(variant, price, now);
    if (!signal) continue;
    completeVirtualCandidate(variant, price, signal, now);
    variant.exitType = String(signal.type || "").replace("VIRTUAL_OPEN_", "DELAY_");
    console.log(`[OPEN 진입비교 종료] ${comparison.name} / ${variant.label} / ${Number(variant.exitProfitRate || 0).toFixed(2)}%`);
  }

  if (comparison.variants.every(v => v.active !== true)) {
    comparison.completedAt = nowText();
    comparison.summary = comparison.variants.map(v => ({
      key: v.key,
      label: v.label,
      entryPrice: v.entryPrice,
      exitPrice: v.exitPrice,
      profitRate: v.exitProfitRate,
      highestProfitRate: v.highestProfitRate,
      lowestProfitRate: v.lowestProfitRate,
      holdingSeconds: v.holdingSeconds,
      exitType: v.exitType
    }));
    console.log(`[OPEN 진입비교 완료] ${comparison.name} / ` + comparison.summary.map(v => `${v.label} ${Number(v.profitRate || 0).toFixed(2)}%`).join(" | "));
  }
  return true;
}

async function checkOpenDelayComparisonOnce() {
  if (!isKoreanWeekday()) return;
  if (!isBetweenTime("09:00", "09:40")) return;

  const history = loadOpenHistory();
  const day = getOpenLearningDay(history);
  const changed = await updateOpenDelayComparisonOnce(history, day, Date.now());
  if (changed) saveOpenHistory(history);
}

async function checkOpenVirtualCandidatesOnce() {
  if (!isKoreanWeekday()) return;
  if (!isBetweenTime("09:00", "09:40")) return;

  const history = loadOpenHistory();
  const day = getOpenLearningDay(history);
  const candidates = Array.isArray(day.virtualCandidates) ? day.virtualCandidates : [];
  const active = candidates.filter(candidate => candidate.active === true);
  const now = Date.now();
  let changed = false;

  for (const candidate of active) {
    let price = 0;
    try {
      price = await fetchPrice(candidate.code);
    } catch (err) {
      console.log(`[OPEN 가상가격 실패] ${candidate.name} / ${err.message}`);
      continue;
    }

    if (!price) continue;

    const signal = getVirtualOpenSellSignal(candidate, price, now);
    if (signal) {
      completeVirtualCandidate(candidate, price, signal, now);
      changed = true;
      console.log(
        `[OPEN 가상종료] ${candidate.name} / ${signal.type} / ` +
        `${Number(candidate.exitProfitRate || 0).toFixed(2)}%`
      );
    }
  }

  if (candidates.length > 0 && candidates.every(candidate => candidate.active !== true)) {
    day.virtualTrackingCompletedAt = nowText();
    day.virtualSummary = {
      sampleCount: candidates.length,
      winCount: candidates.filter(v => Number(v.exitProfitRate || 0) > 0).length,
      lossCount: candidates.filter(v => Number(v.exitProfitRate || 0) < 0).length,
      avgProfitRate:
        candidates.reduce((sum, v) => sum + Number(v.exitProfitRate || 0), 0) /
        candidates.length,
      best: [...candidates].sort(
        (a, b) => Number(b.exitProfitRate || 0) - Number(a.exitProfitRate || 0)
      )[0] || null,
      worst: [...candidates].sort(
        (a, b) => Number(a.exitProfitRate || 0) - Number(b.exitProfitRate || 0)
      )[0] || null
    };

    console.log(
      `[OPEN 가상추적 완료] ${candidates.length}종목 / ` +
      `승 ${day.virtualSummary.winCount} / 패 ${day.virtualSummary.lossCount} / ` +
      `평균 ${day.virtualSummary.avgProfitRate.toFixed(2)}%`
    );
  }

  if (changed || active.length > 0) saveOpenHistory(history);
}

function saveOpenCandidateLearning(evaluated) {
  const history = loadOpenHistory();
  const day = getOpenLearningDay(history);

  const sorted = [...evaluated].sort((a, b) => {
    if (a.record.passed !== b.record.passed) {
      return a.record.passed ? -1 : 1;
    }

    const aScore = a.record.rankScore || a.record.discoverScore;
    const bScore = b.record.rankScore || b.record.discoverScore;
    return bScore - aScore;
  });

  day.latestCandidates = sorted
    .slice(0, settings.openLearningTopCount)
    .map((entry, index) => ({
      rank: index + 1,
      ...entry.record
    }));

  for (const entry of sorted) {
    const record = entry.record;
    if (!record.code) continue;

    const prev = day.candidateObservations[record.code] || {
      code: record.code,
      name: record.name,
      firstSeenAt: record.observedAt,
      observationCount: 0,
      passCount: 0,
      maxRankScore: 0,
      maxDiscoverScore: 0,
      maxVolumeRatio: 0,
      maxChangeRate: null,
      minChangeRate: null
    };

    prev.name = record.name;
    prev.lastSeenAt = record.observedAt;
    prev.observationCount += 1;
    if (record.passed) prev.passCount += 1;
    prev.lastPassed = record.passed;
    prev.lastReason = record.reason;
    prev.lastPrice = record.price;
    prev.lastDiscoverScore = record.discoverScore;
    prev.lastRankScore = record.rankScore;
    prev.lastVolumeRatio = record.volumeRatio;
    prev.lastDayPosition = record.dayPosition;
    prev.lastOpenPosition = record.openPosition;
    prev.lastMarketScore = record.marketScore;
    prev.lastMarketType = record.marketType;
    prev.lastMarketBonus = record.marketBonus;
    prev.lastSectorBonus = record.sectorBonus;
    prev.lastMatchedSectors = record.matchedSectors;

    prev.maxRankScore = Math.max(prev.maxRankScore, record.rankScore);
    prev.maxDiscoverScore = Math.max(prev.maxDiscoverScore, record.discoverScore);
    prev.maxVolumeRatio = Math.max(prev.maxVolumeRatio, record.volumeRatio);
    prev.maxChangeRate =
      prev.maxChangeRate === null
        ? record.changeRate
        : Math.max(prev.maxChangeRate, record.changeRate);
    prev.minChangeRate =
      prev.minChangeRate === null
        ? record.changeRate
        : Math.min(prev.minChangeRate, record.changeRate);

    day.candidateObservations[record.code] = prev;
  }

  day.status = "SCANNING";
  day.lastCandidateScanAt = nowText();
  saveOpenHistory(history);
}

function recordOpenLearningBuy(item, price, qty, reason) {
  const history = loadOpenHistory();
  const day = getOpenLearningDay(history);
  const observation = day.candidateObservations[String(item.code || "")] || {};

  day.status = "HOLDING";
  day.selectedTrade = {
    code: String(item.code || ""),
    name: item.name || item.stockName || item.korName || item.code || "",
    selectedAt: nowText(),
    buyTimeMs: Date.now(),
    buyPrice: Number(price || 0),
    qty: Number(qty || 0),
    buyAmount: Number(price || 0) * Number(qty || 0),
    selectionReason: reason || "",
    selectionInputs: {
      discoverScore: Number(item.discoverScore || observation.lastDiscoverScore || 0),
      rankScore: Number(observation.lastRankScore || 0),
      changeRate: Number(
        item.changeRate ||
        item.fluctuationRate ||
        item.riseRate ||
        item.rate ||
        0
      ),
      volumeRatio: getTradeVolumeRatio(item) || Number(observation.lastVolumeRatio || 0),
      dayPosition: getDayPositionRate(item, price) || Number(observation.lastDayPosition || 0),
      openPosition: getOpenPositionRate(item, price) || Number(observation.lastOpenPosition || 0),
      marketScore: Number(observation.lastMarketScore || 0),
      marketType: observation.lastMarketType || null,
      marketBonus: Number(observation.lastMarketBonus || 0),
      sectorBonus: Number(observation.lastSectorBonus || 0),
      matchedSectors: Array.isArray(observation.lastMatchedSectors) ? observation.lastMatchedSectors : []
    },
    highestPrice: Number(price || 0),
    lowestPrice: Number(price || 0),
    highestProfitRate: 0,
    lowestProfitRate: 0,
    lastPrice: Number(price || 0),
    lastProfitRate: 0
  };

  saveOpenHistory(history);
}

function updateOpenLearningHolding(holding, price) {
  const history = loadOpenHistory();
  const day = getOpenLearningDay(history);
  const trade = day.selectedTrade;

  if (!trade || String(trade.code) !== String(holding.code)) return;

  const buyPrice = Number(trade.buyPrice || holding.buyPrice || 0);
  if (!buyPrice) return;

  const currentPrice = Number(price || 0);
  const profitRate = ((currentPrice - buyPrice) / buyPrice) * 100;

  trade.lastUpdatedAt = nowText();
  trade.lastPrice = currentPrice;
  trade.lastProfitRate = profitRate;
  trade.highestPrice = Math.max(Number(trade.highestPrice || buyPrice), currentPrice);
  trade.lowestPrice = Math.min(Number(trade.lowestPrice || buyPrice), currentPrice);
  trade.highestProfitRate =
    ((trade.highestPrice - buyPrice) / buyPrice) * 100;
  trade.lowestProfitRate =
    ((trade.lowestPrice - buyPrice) / buyPrice) * 100;

  saveOpenHistory(history);
}

function recordOpenLearningSell(holding, price, signal, result) {
  const history = loadOpenHistory();
  const day = getOpenLearningDay(history);
  const trade = day.selectedTrade || {};

  const buyPrice = Number(trade.buyPrice || holding.buyPrice || 0);
  const sellPrice = Number(price || 0);
  const sellProfitRate = Number(
    result.profitRate ??
    (buyPrice > 0 ? ((sellPrice - buyPrice) / buyPrice) * 100 : 0)
  );
  const highestProfitRate = Number(trade.highestProfitRate || 0);

  day.status = "COMPLETED";
  day.result = {
    code: holding.code,
    name: holding.name,
    completedAt: nowText(),
    sellType: signal.type,
    sellReason: signal.reason,
    buyPrice,
    sellPrice,
    qty: Number(holding.qty || 0),
    profit: Number(result.profit || 0),
    profitRate: sellProfitRate,
    highestPrice: Number(trade.highestPrice || holding.highestPrice || sellPrice),
    lowestPrice: Number(trade.lowestPrice || holding.lowestPrice || sellPrice),
    highestProfitRate,
    lowestProfitRate: Number(trade.lowestProfitRate || 0),
    holdingSeconds: trade.buyTimeMs
      ? Math.max(0, Math.floor((Date.now() - Number(trade.buyTimeMs)) / 1000))
      : null,
    profitCaptureRate:
      highestProfitRate > 0
        ? (sellProfitRate / highestProfitRate) * 100
        : null
  };

  saveOpenHistory(history);
}

function recordOpenLearningSkip(reason) {
  const history = loadOpenHistory();
  const day = getOpenLearningDay(history);

  if (day.status === "COMPLETED") return;

  day.status = "SKIPPED";
  day.result = {
    completedAt: nowText(),
    sellType: "OPEN_SKIPPED",
    sellReason: reason || "OPEN 미실행"
  };

  saveOpenHistory(history);
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
  state.openDiscoverOffset = 0;
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

async function fetchPriorityCandidates(marketData = {}) {
  const priorityStocks = Array.isArray(marketData.priorityStocks)
    ? marketData.priorityStocks.slice(0, settings.openPriorityMaxCount)
    : [];

  if (!priorityStocks.length) return [];

  const rows = [];

  for (const stock of priorityStocks) {
    try {
      const data = await fetchJson(
        `${API_BASE}/api/price?code=${encodeURIComponent(stock.code)}`
      );

      const item = {
        ...data,
        code: String(data.code || stock.code || ""),
        name: data.name || stock.name || stock.code,
        priorityRank: Number(stock.rank || 0),
        priorityScore: Number(stock.priorityScore || 0),
        priorityReason: stock.reason || "장전 우선종목",
        prioritySector: stock.sector || null
      };

      const scoreInfo = calculateOpenDiscoverScore(item);
      rows.push({ ...item, ...scoreInfo, source: "PRIORITY" });
    } catch (err) {
      console.log(`[OPEN 우선종목 조회실패] ${stock.name || stock.code} / ${err.message}`);
    }

    await sleep(settings.openPriorityPriceDelayMs);
  }

  return rows;
}

function calculateOpenDiscoverScore(item = {}) {
  const rate = Number(item.changeRate || item.fluctuationRate || item.riseRate || item.rate || 0);
  const volume = Number(item.volume || item.raw?.trde_qty || 0);
  const high = Number(item.high || item.highPrice || item.raw?.high_pric || 0);
  const low = Number(item.low || item.lowPrice || item.raw?.low_pric || 0);
  const open = Number(item.open || item.openPrice || item.raw?.open_pric || 0);
  const currentPrice = Number(item.currentPrice || item.price || item.raw?.cur_prc || 0);

  let score = 0;
  const reasons = [];

  if (rate >= 0.3 && rate <= 5) {
    score += 4;
    reasons.push(`빠른상승 ${rate.toFixed(2)}%`);
  } else if (rate > 5 && rate <= 9) {
    score += 2;
    reasons.push(`강한상승 ${rate.toFixed(2)}%`);
  } else if (rate > 9 && rate <= 15) {
    score += 1;
    reasons.push(`과열전 관찰 ${rate.toFixed(2)}%`);
  } else if (rate < -2.5) {
    score -= 2;
    reasons.push(`하락폭 큼 ${rate.toFixed(2)}%`);
  }

  if (volume >= 1000000) score += 4;
  else if (volume >= 500000) score += 3;
  else if (volume >= 100000) score += 2;
  else if (volume >= 50000) score += 1;

  if (open > 0 && currentPrice > open) {
    score += 2;
    reasons.push("시가 대비 상승");
  }

  if (high > low && currentPrice > 0) {
    const position = ((currentPrice - low) / (high - low)) * 100;
    if (position >= 40 && position <= 85) score += 2;
    else if (position > 85 && position <= 96) score += 1;
    else if (position > 96) score -= 1;
  }

  return {
    discoverScore: score,
    discoverReasons: reasons
  };
}

async function fetchFallbackCandidates(state) {
  const offset = Number(state.openDiscoverOffset || 0);
  const data = await fetchJson(
    `${API_BASE}/api/discover?offset=${offset}` +
    `&scanLimit=${settings.openFallbackScanLimit}` +
    `&limit=${settings.discoverLimit}`
  );

  state.openDiscoverOffset = Number(data.nextOffset || 0);
  state.lastOpenDiscoverAt = nowText();

  return (data.items || []).map(item => ({ ...item, source: "FALLBACK" }));
}

async function discoverCandidates(state, marketData = {}) {
  const priorityRows = await fetchPriorityCandidates(marketData);
  const fallbackRows = await fetchFallbackCandidates(state);

  const merged = [];
  const seen = new Set();

  for (const item of [...priorityRows, ...fallbackRows]) {
    const code = String(item.code || "");
    if (!code || seen.has(code) || isExcludedStock(item)) continue;
    seen.add(code);

    if (Number(item.discoverScore || 0) < settings.minDiscoverScore) continue;
    merged.push(item);
  }

  merged.sort((a, b) => {
    const sourceDiff = (a.source === "PRIORITY" ? 0 : 1) - (b.source === "PRIORITY" ? 0 : 1);
    if (sourceDiff !== 0) return sourceDiff;
    const priorityDiff = Number(b.priorityScore || 0) - Number(a.priorityScore || 0);
    if (priorityDiff !== 0) return priorityDiff;
    return Number(b.discoverScore || 0) - Number(a.discoverScore || 0);
  });

  console.log(
    `[OPEN DISCOVER 2.0] 우선 ${priorityRows.length}개 / ` +
    `일반 ${fallbackRows.length}개 / 최종 ${merged.length}개 / ` +
    `offset ${state.openDiscoverOffset}`
  );

  return merged;
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

  let history = state.openCandidateHistory[code];
  if (!history || !history.firstSeenAtMs) {
    history = {
      firstSeenAtMs: now,
      firstSeenAt: nowText(),
      firstPrice: current.price,
      firstScore: current.score,
      firstVolumeRatio: current.volumeRatio,
      priceAt5Seconds: null,
      priceAt15Seconds: null,
      last: current
    };
    state.openCandidateHistory[code] = history;
    return { pass: false, reason: "첫 발견 / 15초 확인 대기" };
  }

  const elapsedMs = now - Number(history.firstSeenAtMs || now);
  if (elapsedMs >= 5000 && !history.priceAt5Seconds) {
    history.priceAt5Seconds = current.price;
    history.priceAt5SecondsAt = nowText();
  }
  if (elapsedMs >= settings.openConfirmWaitMs && !history.priceAt15Seconds) {
    history.priceAt15Seconds = current.price;
    history.priceAt15SecondsAt = nowText();
  }

  const baseline = {
    score: history.firstScore,
    volumeRatio: history.firstVolumeRatio,
    price: history.firstPrice
  };
  history.last = current;
  state.openCandidateHistory[code] = history;

  if (elapsedMs < settings.openConfirmWaitMs) {
    return {
      pass: false,
      reason: `OPEN 강화 확인 대기 ${Math.floor(elapsedMs / 1000)}초/15초`
    };
  }

  const scoreDiff = current.score - Number(baseline.score || 0);
  const volumeDiff = current.volumeRatio - Number(baseline.volumeRatio || 0);
  const priceDiffRate = Number(baseline.price || 0) > 0
    ? ((current.price - Number(baseline.price)) / Number(baseline.price)) * 100
    : 0;

  if (scoreDiff < 0) return { pass: false, reason: `점수 약화 ${baseline.score}→${current.score}` };
  if (volumeDiff < -20) return { pass: false, reason: `거래량 약화 ${Number(baseline.volumeRatio || 0).toFixed(1)}→${current.volumeRatio.toFixed(1)}%` };
  if (priceDiffRate < 0) return { pass: false, reason: `확인 중 가격 하락 ${priceDiffRate.toFixed(2)}%` };

  return {
    pass: true,
    delayComparison: {
      firstSeenAtMs: history.firstSeenAtMs,
      firstPrice: Number(history.firstPrice || 0),
      priceAt5Seconds: Number(history.priceAt5Seconds || current.price || 0),
      priceAt15Seconds: Number(history.priceAt15Seconds || current.price || 0)
    },
    reason: `강화 확인 / 점수 ${baseline.score}→${current.score} / 거래량 ${Number(baseline.volumeRatio || 0).toFixed(1)}→${current.volumeRatio.toFixed(1)}% / 가격 ${priceDiffRate.toFixed(2)}%`
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
  if ((state.holdings || []).some(h => String(h.code) === String(item.code))) {
    return { pass: false, reason: "동일 종목 이미 보유중" };
  }
  if (wasBoughtToday(state, item.code)) return { pass: false, reason: "오늘 이미 매수한 종목" };
  if (discoverScore < settings.openMinDiscoverScore) return { pass: false, reason: `발견점수 부족 ${discoverScore}` };
  if (changeRate < settings.openMinChangeRate || changeRate > settings.openMaxChangeRate) return { pass: false, reason: `상승률 부적합 ${changeRate.toFixed(2)}%` };
  if (volumeRatio < settings.openMinTradeVolumeRatio) return { pass: false, reason: `거래량 부족 ${volumeRatio.toFixed(1)}%` };
  if (dayPosition < settings.openMinDayPositionRate || dayPosition > settings.openMaxDayPositionRate) return { pass: false, reason: `당일위치 부적합 ${dayPosition.toFixed(1)}%` };
  if (openPosition < settings.openMinOpenPositionRate || openPosition > settings.openMaxOpenPositionRate) return { pass: false, reason: `시가대비 부적합 ${openPosition.toFixed(2)}%` };

  const strengthen = isOpenCandidateGettingStronger(state, item, price);
  if (!strengthen.pass) return { pass: false, reason: strengthen.reason };

  const baseRankScore =
    discoverScore * 10 +
    Math.min(volumeRatio, 500) * 0.15 +
    dayPosition * 0.25 +
    Math.max(0, 4 - changeRate) * 5;

  // 실제 OPEN 최종점수는 현재 시점의 시장·섹터 정보만 반영한다.
  // 과거 유사사례나 가상추적 결과는 매수 점수에 반영하지 않는다.
  const marketData = loadOpenMarketData();
  const marketAdjust = calculateOpenMarketAdjustment(item, marketData);
  const priorityBonus = item.source === "PRIORITY"
    ? Math.max(0, Math.min(12, Number(item.priorityScore || 0) * 0.4))
    : 0;
  const rankScore = baseRankScore + marketAdjust.totalBonus + priorityBonus;

  return {
    pass: true,
    rankScore,
    baseRankScore,
    marketScore: Number(marketAdjust.marketScore || 0),
    marketType: marketAdjust.marketType || null,
    marketBonus: Number(marketAdjust.marketBonus || 0),
    sectorBonus: Number(marketAdjust.sectorBonus || 0),
    priorityBonus: Number(priorityBonus || 0),
    priorityReason: item.priorityReason || null,
    matchedSectors: marketAdjust.matchedSectors || [],
    marketDataUpdatedAt: marketData.updatedAt || null,
    delayComparison: strengthen.delayComparison || null,
    reason: `OPEN 통과 / ${item.source === "PRIORITY" ? "장전우선" : "일반검색"} / 발견 ${discoverScore} / 상승 ${changeRate.toFixed(2)}% / 거래량 ${volumeRatio.toFixed(1)}% / 위치 ${dayPosition.toFixed(1)}% / 시가대비 ${openPosition.toFixed(2)}% / 기본점수 ${baseRankScore.toFixed(1)} / 우선보너스 ${priorityBonus.toFixed(1)} / ${marketAdjust.reason} / 최종점수 ${rankScore.toFixed(1)}`
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
    recordOpenLearningBuy(item, price, qty, reason);

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

    recordOpenLearningSell(holding, price, signal, result);

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


function getOpenRejectCategory(reason = "") {
  const text = String(reason || "");

  if (text.includes("첫 발견") || text.includes("확인 대기")) return "15초 강화확인 대기";
  if (text.includes("점수 약화") || text.includes("거래량 약화") || text.includes("가격 하락")) return "강화확인 실패";
  if (text.includes("발견점수 부족")) return "발견점수 부족";
  if (text.includes("상승률 부적합")) return "상승률 부적합";
  if (text.includes("거래량 부족")) return "거래량 부족";
  if (text.includes("당일위치 부적합")) return "당일위치 부적합";
  if (text.includes("시가대비 부적합")) return "시가대비 부적합";
  if (text.includes("동일 종목 이미 보유")) return "이미 보유";
  if (text.includes("오늘 이미 매수")) return "당일 재매수 차단";
  if (text.includes("오늘 OPEN 이미 매수")) return "OPEN 이미 완료";
  if (text.includes("OPEN 시간 아님")) return "매수시간 외";
  if (text.includes("OPEN OFF")) return "OPEN OFF";
  return "기타";
}

function makeOpenCandidateLogText(item, price, judged = {}) {
  const name = item.name || item.stockName || item.korName || item.code || "-";
  const discoverScore = Number(item.discoverScore || 0);
  const changeRate = Number(
    item.changeRate ||
    item.fluctuationRate ||
    item.riseRate ||
    item.rate ||
    0
  );
  const volumeRatio = getTradeVolumeRatio(item);
  const dayPosition = getDayPositionRate(item, price);
  const openPosition = getOpenPositionRate(item, price);

  return (
    `${name}(${item.code || "-"}) / ` +
    `${item.source === "PRIORITY" ? `우선${item.priorityRank || ""} / ` : "일반 / "}` +
    `현재가 ${Number(price || 0).toLocaleString()} / ` +
    `발견 ${discoverScore} / 상승 ${changeRate.toFixed(2)}% / ` +
    `거래량 ${volumeRatio.toFixed(1)}% / 위치 ${dayPosition.toFixed(1)}% / ` +
    `시가대비 ${openPosition.toFixed(2)}%` +
    (judged.pass
      ? ` / 최종 ${Number(judged.rankScore || 0).toFixed(1)}`
      : ` / ${judged.reason || "탈락"}`)
  );
}

function logOpenScanSummary({
  scanId,
  hhmm,
  candidates,
  evaluated,
  passed,
  rejectCounts,
  rejectExamples,
  marketData
}) {
  console.log(
    `[OPEN 스캔요약] #${scanId} ${hhmm} / ` +
    `발굴 ${candidates.length} / 평가 ${evaluated.length} / 통과 ${passed.length} / ` +
    `시장 ${marketData.available ? `${marketData.marketScore}점 ${marketData.marketType}` : "미사용"}`
  );

  const rejectText = Object.entries(rejectCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => `${reason} ${count}`)
    .join(" | ");

  if (rejectText) {
    console.log(`[OPEN 탈락집계] ${rejectText}`);
  }

  Object.entries(rejectExamples).forEach(([category, examples]) => {
    if (!examples.length) return;
    console.log(
      `[OPEN 탈락예시] ${category} / ` +
      examples.join(" || ")
    );
  });

  if (passed.length > 0) {
    const topText = [...passed]
      .sort((a, b) => Number(b.judged.rankScore || 0) - Number(a.judged.rankScore || 0))
      .slice(0, 5)
      .map((entry, index) =>
        `${index + 1}.${makeOpenCandidateLogText(entry.item, entry.price, entry.judged)}`
      )
      .join(" || ");

    console.log(`[OPEN 통과후보 TOP${Math.min(5, passed.length)}] ${topText}`);
  }
}

let openScanSequence = 0;

async function runOpenBuyOnce() {
  if (!isKoreanWeekday()) return;

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
    initializeVirtualTrackingFromLatestCandidates();
    recordOpenLearningSkip(state.openSkipReason);
    console.log(`[OPEN 종료] ${state.openSkipReason}`);
    return;
  }

  const scanId = ++openScanSequence;
  const scanStartedAt = Date.now();

  console.log(
    `[OPEN 스캔시작] #${scanId} ${hhmm} / ` +
    `매수시간 ${settings.openBuyStartTime}~${settings.openBuyEndTime} / ` +
    `실제매수 확인 ${settings.openConfirmWaitMs / 1000}초 / ` +
    `현금 ${Number(state.totalCash || 0).toLocaleString()}원`
  );

  const risk = checkDailyLossLimit(state);
  if (risk.stopped) {
    state.openCompleted = true;
    state.openSkipped = true;
    state.openCompletedAt = nowText();
    state.openSkipReason = risk.reason;
    saveState(state);
    recordOpenLearningSkip(risk.reason);
    console.log(`[OPEN 중단] #${scanId} ${risk.reason}`);
    return;
  }

  const marketData = loadOpenMarketData();
  if (marketData.available) {
    console.log(
      `[OPEN 시장연결] #${scanId} 점수 ${marketData.marketScore} / ` +
      `유형 ${marketData.marketType} / 경과 ${marketData.ageHours.toFixed(1)}시간`
    );
  } else {
    console.log(`[OPEN 시장연결] #${scanId} 미사용 / ${marketData.reason}`);
  }

  const candidates = await discoverCandidates(state, marketData);
  const passed = [];
  const evaluated = [];
  const rejectCounts = {};
  const rejectExamples = {};

  for (const item of candidates) {
    const price = Math.abs(
      Number(item.currentPrice || item.price || item.raw?.cur_prc || 0)
    );

    if (!price) {
      rejectCounts["현재가 오류"] = (rejectCounts["현재가 오류"] || 0) + 1;
      continue;
    }

    const judged = judgeOpenBuy(state, item, price);
    evaluated.push({
      item,
      price,
      judged,
      record: makeOpenCandidateLearningRecord(item, price, judged)
    });

    if (judged.pass) {
      passed.push({ item, price, judged });
      continue;
    }

    const category = getOpenRejectCategory(judged.reason);
    rejectCounts[category] = (rejectCounts[category] || 0) + 1;

    if (!rejectExamples[category]) rejectExamples[category] = [];
    if (rejectExamples[category].length < 2) {
      rejectExamples[category].push(
        makeOpenCandidateLogText(item, price, judged)
      );
    }
  }

  saveState(state);
  saveOpenCandidateLearning(evaluated);

  logOpenScanSummary({
    scanId,
    hhmm,
    candidates,
    evaluated,
    passed,
    rejectCounts,
    rejectExamples,
    marketData
  });

  const elapsedMs = Date.now() - scanStartedAt;

  if (!passed.length) {
    console.log(
      `[OPEN 스캔종료] #${scanId} 통과후보 없음 / ` +
      `소요 ${(elapsedMs / 1000).toFixed(1)}초`
    );
    return;
  }

  passed.sort(
    (a, b) =>
      Number(b.judged.rankScore || 0) -
      Number(a.judged.rankScore || 0)
  );

  const best = passed[0];

  initializeOpenDelayComparison(best.item, best.judged);
  initializeOpenVirtualTracking(evaluated, best.item.code);

  console.log(
    `[OPEN 최종선정] #${scanId} ` +
    `${makeOpenCandidateLogText(best.item, best.price, best.judged)} / ` +
    `기본 ${Number(best.judged.baseRankScore || 0).toFixed(1)} / ` +
    `시장 ${Number(best.judged.marketBonus || 0) >= 0 ? "+" : ""}${Number(best.judged.marketBonus || 0).toFixed(1)} / ` +
    `섹터 ${Number(best.judged.sectorBonus || 0) >= 0 ? "+" : ""}${Number(best.judged.sectorBonus || 0).toFixed(1)} / ` +
    `우선 ${Number(best.judged.priorityBonus || 0) >= 0 ? "+" : ""}${Number(best.judged.priorityBonus || 0).toFixed(1)} / ` +
    `통과 ${passed.length}개 / 소요 ${(elapsedMs / 1000).toFixed(1)}초`
  );

  const bought = await paperOpenBuy(
    state,
    best.item,
    best.price,
    best.judged.reason
  );

  console.log(
    `[OPEN 매수결과] #${scanId} ` +
    `${best.item.name || best.item.code} / ` +
    `${bought ? "매수완료" : "매수실패 또는 중복차단"}`
  );
}

async function checkOpenSellOnce() {
  if (!isKoreanWeekday()) return;
  if (!isBetweenTime("09:00", "09:40")) return;

  try { await checkOpenDelayComparisonOnce(); }
  catch (err) { console.log(`[OPEN 진입비교 점검오류] ${err.message}`); }

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
    updateOpenLearningHolding(holding, price);
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
  await checkOpenVirtualCandidatesOnce();

  let buyRunning = false;
  let sellRunning = false;
  let virtualRunning = false;

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

  setInterval(async () => {
    if (virtualRunning) return;
    virtualRunning = true;
    try { await checkOpenVirtualCandidatesOnce(); }
    catch (err) { console.error("[OPEN VIRTUAL LOOP 오류]", err.message); }
    finally { virtualRunning = false; }
  }, settings.openVirtualLoopMs);
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
  checkOpenVirtualCandidatesOnce,
  checkOpenDelayComparisonOnce,
  loadOpenMarketData,
  calculateOpenMarketAdjustment,
  loadState,
  saveState
};
