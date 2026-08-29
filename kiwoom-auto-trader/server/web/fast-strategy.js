const fs = require("fs");
const path = require("path");

const API_BASE = process.env.SY_QUANT_API_BASE || "http://127.0.0.1:3000";

// SY Quant MASTER 단일계좌 공통 자금관리
const portfolioManager = require("./portfolio-manager");
const STATE_FILE = path.join(__dirname, "paper-state-fast.json");
const HOT_CANDIDATES_FILE = path.join(__dirname, "hot-candidates.json");
const HOT_HISTORY_FILE = path.join(__dirname, "hot-candidates-history.json");
const OPEN_MARKET_FILE = path.join(__dirname, "open-market.json");

const STRATEGY_VERSION = "1.3.3-MASTER";

const FAST_MASTER_POSITION_RATIO = 0.10;

const SETTINGS = {
  enabled: true,
  initialCapital: 50000000,
  positionRatio: 0.20,
  maxHoldingCount: 5,
  maxDailyBuyCount: 5,
  // 장초 5개 슬롯을 너무 빨리 소진하지 않도록 09:10 전에는 4회까지만 허용한다.
  earlyReservedSlotUntil: "09:10",
  earlyMaxDailyBuyCount: 4,

  buyStartTime: "09:00",
  buyEndTime: "10:30",
  sellStartTime: "09:00",
  forceSellTime: "15:10",
  sellEndTime: "15:20",
  buyLoopMs: 3 * 1000,
  sellOnlyLoopMs: 10 * 1000,
  idleLoopMs: 30 * 1000,

  hotFileMaxAgeMs: 25 * 1000,
  candidateMaxAgeMs: 20 * 60 * 1000,
  candidateMaxCount: 50,
  candidateRealtimeCheckCount: 5,
  realtimeEnrichCooldownMs: 12 * 1000,
  sampleWindowMs: 150 * 1000,
  minSampleCount: 3,
  minPricePersistence: 0.67,
  minVolumePersistence: 0.50,
  minPriceRiseRate: 0.05,
  maxPriceRiseRate: 2.50,

  firstMinChangeRate: 1.0,
  firstMaxChangeRate: 7.0,
  minChangeRate: 1.5,
  maxChangeRate: 10.0,
  minDayPositionRate: 70,
  minDiscoverScore: 7,
  minTradeAmount: 300000000,
  minHotScore: 55,
  minOpenMomentumScore: 25,
  minSourceCount: 2,
  minSectorPeerCount: 3,

  marketDataRequired: true,
  absoluteMarketBlockScore: 15,
  extremeWeakMarketScore: 20,
  extremeWeakMinVolumeRatio: 180,
  weakMarketScore: 25,
  weakMinSampleCount: 4,
  weakMinOpenMomentumScore: 55,
  weakMinHotScore: 70,
  weakMinPersistence: 0.75,

  // 초약세장에서도 개별주가 장 초반부터 독립적으로 치고 나갈 때의 전용 경로다.
  earlyBreakoutFirstMinChangeRate: 1.5,
  earlyBreakoutFirstMaxChangeRate: 7.0,
  earlyBreakoutMinChangeRate: 1.5,
  earlyBreakoutMaxChangeRate: 8.0,
  earlyBreakoutMinVolumeRatio: 110,
  earlyBreakoutMinDayPositionRate: 65,
  earlyBreakoutMinDiscoverScore: 5,
  earlyBreakoutMinHotScore: 58,
  earlyBreakoutMinMomentumScore: 50,
  earlyBreakoutMinSampleCount: 2,
  earlyBreakoutMinPricePersistence: 0.67,
  earlyBreakoutMinVolumePersistence: 0.50,
  earlyBreakoutMaxPriceRiseRate: 1.50,
  earlyBreakoutMinTradeAmount: 300000000,
  earlyBreakoutMinSourceCount: 2,

  // 이미 7%를 넘겨 발견된 종목은 거래량 절대값·교차소스가 강한 경우에만 제한 허용한다.
  lateContinuationFirstMinChangeRate: 7.0,
  lateContinuationFirstMaxChangeRate: 15.0,
  lateContinuationMinChangeRate: 7.0,
  lateContinuationMaxChangeRate: 18.0,
  lateContinuationMinAbsoluteVolume: 500000,
  lateContinuationMinDayPositionRate: 70,
  lateContinuationMinDiscoverScore: 5,
  lateContinuationMinHotScore: 57.5,
  lateContinuationMinMomentumScore: 55,
  lateContinuationMinSampleCount: 2,
  lateContinuationMinPricePersistence: 0.67,
  lateContinuationMaxPriceRiseRate: 2.50,
  lateContinuationMinTradeAmount: 2000000000,
  lateContinuationMinSourceCount: 3,

  // 신규매수는 신선한 시세만 사용하고, 보유매도는 위험관리 우선으로
  // 서버의 fast-sell 5초 비상 캐시까지 허용한다.
  buyMaxQuoteAgeMs: 3 * 1000,
  sellMaxQuoteAgeMs: 5 * 1000,
  buyPriceRequestTimeoutMs: 5 * 1000,
  // 서버 가격큐 대기 + 키움 조회시간까지 감안해 매도는 더 오래 기다린다.
  sellPriceRequestTimeoutMs: 12 * 1000,
  // 매도 현재가 조회가 일시 실패하면 짧게 1회만 재시도한다.
  // 첫 요청 실패 뒤 오래 기다리며 다른 FAST 보유종목 점검을 막지 않도록 250ms만 둔다.
  sellPriceRetryCount: 1,
  sellPriceRetryDelayMs: 250,

  stopLossRate: -1.0,
  protectStartProfitRate: 2.0,
  protectFloorProfitRate: 0.3,
  trailingStartProfitRate: 5.0,
  trailingStopRate: 1.5,
  strongTrailingStartProfitRate: 10.0,
  strongTrailingStopRate: 2.5,
  stagnationMinutes: 10,
  stagnationMaxProfitRate: 0.2,
  stagnationMaxPeakRate: 0.5,
  weakMaxHoldingMinutes: 60,
  weakMaxHoldingPeakRate: 2.0
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
  const hour = parts.find(part => part.type === "hour")?.value || "00";
  const minute = parts.find(part => part.type === "minute")?.value || "00";
  return `${hour}:${minute}`;
}

function getEffectiveDailyBuyLimit(hhmm = getCurrentHHMM()) {
  if (hhmm < SETTINGS.earlyReservedSlotUntil) {
    return Math.min(
      SETTINGS.maxDailyBuyCount,
      SETTINGS.earlyMaxDailyBuyCount
    );
  }
  return SETTINGS.maxDailyBuyCount;
}

function isKoreanWeekday() {
  const day = new Date().toLocaleDateString("en-US", {
    timeZone: "Asia/Seoul",
    weekday: "short"
  });
  return day !== "Sat" && day !== "Sun";
}

function toNumber(value, fallback = 0) {
  const cleaned = String(value ?? "")
    .replace(/[+,%]/g, "")
    .replace(/,/g, "")
    .trim();
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value || 0)));
}

function normalizeCode(value) {
  const match = String(value || "").replace(/^A/i, "").match(/\d{6}/);
  return match ? match[0] : "";
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    console.error(`[FAST JSON 읽기 실패] ${path.basename(filePath)} / ${error.message}`);
    return fallback;
  }
}

function writeJsonAtomic(filePath, value) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tempPath = path.join(dir, `.${base}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(tempPath, filePath);
}


function getFastMasterSnapshot() {
  const masterState = portfolioManager.loadMasterState();
  portfolioManager.ensureMasterState(masterState);

  return {
    masterState,
    ...portfolioManager.getStrategyAccountSnapshot(
      masterState,
      "FAST"
    )
  };
}

function applyMasterAccountToFastState(state) {
  const snapshot = getFastMasterSnapshot();

  state.accountMode = "MASTER_SHARED";
  state.initialCapital = snapshot.initialCapital;
  state.totalCash = snapshot.totalCash;
  state.holdings = snapshot.holdings;
  state.tradeLogs = snapshot.tradeLogs;
  state.masterTotalAsset = snapshot.totalAsset;
  state.masterStrategyExposure = snapshot.strategyExposure;

  return state;
}

function persistFastHoldingMarksToMaster(state) {
  if (!Array.isArray(state?.holdings)) {
    return {
      ok: true,
      updated: 0
    };
  }

  return portfolioManager.updateStrategyHoldingMarks(
    "FAST",
    state.holdings
  );
}

function makeFastLocalStateForSave(state) {
  const localState = JSON.parse(
    JSON.stringify(state || {})
  );

  localState.accountMode = "MASTER_SHARED";

  // 돈/보유/거래는 MASTER paper-state-core.json이 유일한 원본.
  delete localState.initialCapital;
  delete localState.totalCash;
  delete localState.holdings;
  delete localState.tradeLogs;
  delete localState.masterTotalAsset;
  delete localState.masterStrategyExposure;

  return localState;
}

function createInitialState() {
  return {
    version: 1,
    strategy: "FAST",
    strategyVersion: STRATEGY_VERSION,
    createdAt: nowText(),
    updatedAt: nowText(),
    initialCapital: SETTINGS.initialCapital,
    totalCash: SETTINGS.initialCapital,
    holdings: [],
    tradeLogs: [],
    candidateDate: todayKey(),
    candidates: [],
    dailyStats: {},
    lastRunAt: null,
    lastRunAtMs: 0,
    lastRunReason: "FAST 시작 전"
  };
}

function normalizeState(state = {}) {
  if (!Array.isArray(state.candidates)) state.candidates = [];
  if (!state.dailyStats || typeof state.dailyStats !== "object") {
    state.dailyStats = {};
  }

  state.strategy = "FAST";
  state.strategyVersion = STRATEGY_VERSION;
  state.accountMode = "MASTER_SHARED";

  if (state.candidateDate !== todayKey()) {
    state.candidateDate = todayKey();
    state.candidates = [];
  }

  applyMasterAccountToFastState(state);

  return state;
}

function loadFastState() {
  if (!fs.existsSync(STATE_FILE)) {
    const initial = createInitialState();
    normalizeState(initial);
    saveFastState(initial);
    return initial;
  }

  return normalizeState(
    readJson(
      STATE_FILE,
      createInitialState()
    ) || createInitialState()
  );
}

function saveFastState(state) {
  state.updatedAt = nowText();

  // FAST 보유의 현재가/최고가/수익률 등 위험관리 값을 MASTER에 반영.
  persistFastHoldingMarksToMaster(state);

  // FAST 파일에는 후보·관찰·dailyStats만 저장.
  writeJsonAtomic(
    STATE_FILE,
    makeFastLocalStateForSave(state)
  );

  return state;
}

function resetFastState() {
  // FAST 로컬 후보/통계만 초기화한다.
  // MASTER 현금/보유/거래는 최종 통합 리셋 API가 별도로 담당한다.
  const state = createInitialState();
  normalizeState(state);

  state.candidates = [];
  state.dailyStats = {};
  state.candidateDate = todayKey();
  state.lastRunAt = null;
  state.lastRunAtMs = 0;
  state.lastRunReason = "FAST 로컬상태 초기화";

  saveFastState(state);
  return state;
}

function getDailyStats(state, date = todayKey()) {
  if (
    !state.dailyStats[date] ||
    typeof state.dailyStats[date] !== "object"
  ) {
    state.dailyStats[date] = {
      date,
      buyCount: 0,
      sellCount: 0,
      winCount: 0,
      lossCount: 0,
      realizedProfit: 0,
      boughtCodes: {},
      evaluatedCount: 0,
      passedCount: 0,
      allocationBaseAsset: 0,
      positionAmount: 0,
      positionRatio: FAST_MASTER_POSITION_RATIO
    };
  }

  const daily = state.dailyStats[date];

  if (
    !daily.boughtCodes ||
    typeof daily.boughtCodes !== "object"
  ) {
    daily.boughtCodes = {};
  }

  if (
    !Number.isFinite(Number(daily.allocationBaseAsset)) ||
    Number(daily.allocationBaseAsset) <= 0 ||
    !Number.isFinite(Number(daily.positionAmount)) ||
    Number(daily.positionAmount) <= 0
  ) {
    const masterState =
      portfolioManager.loadMasterState();

    const baseAsset = Math.max(
      0,
      Math.floor(
        portfolioManager.getEquity(masterState)
      )
    );

    daily.allocationBaseAsset = baseAsset;
    daily.positionRatio = FAST_MASTER_POSITION_RATIO;
    daily.positionAmount = Math.floor(
      baseAsset * FAST_MASTER_POSITION_RATIO
    );
    daily.allocationFixedAt = nowText();
  }

  return daily;
}

function getMarketData() {
  const raw = readJson(OPEN_MARKET_FILE, {}) || {};
  const date = String(raw.date || raw.checkedDate || raw.updatedDate || "").slice(0, 10);
  if (date && date !== todayKey()) {
    return { available: false, score: 0, type: "STALE", reason: "전일 시장자료" };
  }
  const score = toNumber(
    raw.marketScore ??
    raw.finalMarketScore ??
    raw.score ??
    raw.totalScore ??
    0
  );
  return {
    available: score > 0,
    score,
    type: String(raw.marketType || raw.type || raw.level || "UNKNOWN"),
    reason: raw.reason || raw.summary || null
  };
}

function isExcludedStock(item = {}) {
  const name = String(item.name || item.stockName || item.korName || "").trim();
  return (
    !name ||
    /KODEX|TIGER|ACE|SOL|HANARO|KOSEF|KBSTAR|ARIRANG|ETF|ETN|레버리지|인버스|스팩|SPAC/i.test(name) ||
    /우$|\d우B$|우B$|우선주/i.test(name)
  );
}

function getDynamicMinVolumeRatio(hhmm = getCurrentHHMM()) {
  if (hhmm < "09:05") return 80;
  if (hhmm < "09:10") return 90;
  return 100;
}

function calculateDayPosition(item, currentPrice) {
  const high = Math.abs(toNumber(item.high || item.highPrice || item.raw?.high_pric));
  const low = Math.abs(toNumber(item.low || item.lowPrice || item.raw?.low_pric));
  if (high > low && currentPrice > 0) {
    return clamp(((currentPrice - low) / (high - low)) * 100, 0, 100);
  }
  return clamp(toNumber(item.dayPosition), 0, 100);
}

function calculateRealtimeHotScore(item, currentPrice) {
  const changeRate = toNumber(item.changeRate);
  const volumeRatio = toNumber(item.tradeVolumeRatio);
  const dayPosition = calculateDayPosition(item, currentPrice);
  const changeScore = Math.min(40, Math.max(0, changeRate) * 8);
  const volumeScore = Math.min(35, Math.max(0, volumeRatio - 100) / 5);
  const positionScore = Math.min(25, Math.max(0, dayPosition) * 0.25);
  return changeScore + volumeScore + positionScore;
}

function calculateRealtimeDiscoverScore(item, currentPrice) {
  const changeRate = toNumber(item.changeRate);
  const volume = Math.abs(toNumber(item.volume || item.raw?.trde_qty));
  const open = Math.abs(toNumber(item.open || item.openPrice || item.raw?.open_pric));
  const dayPosition = calculateDayPosition(item, currentPrice);
  let score = 0;

  if (changeRate >= 0.3 && changeRate <= 5) score += 4;
  else if (changeRate > 5 && changeRate <= 9) score += 2;
  else if (changeRate > 9 && changeRate <= 15) score += 1;
  else if (changeRate < -2.5) score -= 2;

  if (volume >= 1000000) score += 4;
  else if (volume >= 500000) score += 3;
  else if (volume >= 100000) score += 2;
  else if (volume >= 50000) score += 1;

  if (open > 0 && currentPrice > open) score += 2;
  if (dayPosition >= 40 && dayPosition <= 85) score += 2;
  else if (dayPosition > 85 && dayPosition <= 96) score += 1;
  else if (dayPosition > 96) score -= 1;
  return score;
}

function loadHotInputs() {
  const hot = readJson(HOT_CANDIDATES_FILE, {}) || {};
  const history = readJson(HOT_HISTORY_FILE, {}) || {};
  const hotAgeMs = Date.now() - toNumber(hot.updatedAtMs);

  if (
    hot.date !== todayKey() ||
    hotAgeMs < 0 ||
    hotAgeMs > SETTINGS.hotFileMaxAgeMs
  ) {
    return { rows: [], hotAgeMs, reason: `HOT 자료 대기 ${Math.max(0, Math.round(hotAgeMs / 1000))}초` };
  }

  const rowMap = new Map();
  for (const row of [
    ...(Array.isArray(hot.observationRows) ? hot.observationRows : []),
    ...(Array.isArray(hot.items) ? hot.items : []),
    ...(Array.isArray(hot.earlyRows) ? hot.earlyRows : [])
  ]) {
    const code = normalizeCode(row.code || row.stk_cd);
    if (!code) continue;
    const previous = rowMap.get(code) || {};
    rowMap.set(code, {
      ...previous,
      ...row,
      code,
      sources: Array.from(new Set([
        ...(Array.isArray(previous.sources) ? previous.sources : []),
        ...(Array.isArray(row.sources) ? row.sources : [])
      ]))
    });
  }

  const detected = history.date === todayKey() && history.detected
    ? history.detected
    : {};
  const rows = Array.from(rowMap.values()).map(row => {
    const record = detected[row.code] || {};
    return {
      ...row,
      firstDetectedAt: record.firstDetectedAt || row.hotDetectedAt || null,
      firstDetectedAtMs: toNumber(record.firstDetectedAtMs || row.hotDetectedAtMs),
      firstChangeRate: toNumber(record.firstChangeRate ?? row.changeRate),
      firstPrice: toNumber(record.firstPrice ?? row.currentPrice ?? row.price),
      detectionCount: toNumber(record.detectionCount || 0),
      sources: Array.from(new Set([
        ...(Array.isArray(row.sources) ? row.sources : []),
        ...(Array.isArray(record.sources) ? record.sources : [])
      ]))
    };
  });

  return { rows, hotAgeMs, hotUpdatedAtMs: toNumber(hot.updatedAtMs), reason: null };
}

function makeSample(item, observedAtMs) {
  return {
    observedAtMs,
    price: Math.abs(toNumber(item.currentPrice || item.price)),
    changeRate: toNumber(item.changeRate),
    volumeRatio: toNumber(item.tradeVolumeRatio),
    dayPosition: toNumber(item.dayPosition),
    hotScore: toNumber(item.hotScore),
    momentumScore: toNumber(item.openMomentumScore)
  };
}

function updateCandidateObservation(state, item, sourceObservedAtMs) {
  const nowMs = Date.now();
  const code = normalizeCode(item.code);
  let candidate = state.candidates.find(row => row.code === code);

  if (!candidate) {
    candidate = {
      code,
      name: item.name || code,
      firstSeenAt: item.firstDetectedAt || nowText(),
      firstSeenAtMs: toNumber(item.firstDetectedAtMs || nowMs),
      firstChangeRate: toNumber(item.firstChangeRate ?? item.changeRate),
      firstPrice: toNumber(item.firstPrice ?? item.currentPrice ?? item.price),
      lastSeenAt: nowText(),
      lastSeenAtMs: nowMs,
      lastSourceObservedAtMs: 0,
      samples: [],
      status: "WATCH",
      reason: "초기관찰"
    };
    state.candidates.push(candidate);
  }

  candidate.name = item.name || candidate.name || code;
  candidate.lastSeenAt = nowText();
  candidate.lastSeenAtMs = nowMs;
  candidate.snapshot = { ...item, code };

  if (
    sourceObservedAtMs > 0 &&
    sourceObservedAtMs > toNumber(candidate.lastSourceObservedAtMs)
  ) {
    candidate.samples.push(makeSample(item, sourceObservedAtMs));
    candidate.lastSourceObservedAtMs = sourceObservedAtMs;
  }

  candidate.samples = candidate.samples
    .filter(sample => nowMs - toNumber(sample.observedAtMs) <= SETTINGS.sampleWindowMs)
    .slice(-20);
  return candidate;
}

function calculatePersistence(samples = []) {
  let priceUpCount = 0;
  let volumeUpCount = 0;
  for (let index = 1; index < samples.length; index++) {
    if (toNumber(samples[index].price) >= toNumber(samples[index - 1].price)) priceUpCount++;
    if (toNumber(samples[index].volumeRatio) >= toNumber(samples[index - 1].volumeRatio)) volumeUpCount++;
  }
  const steps = Math.max(1, samples.length - 1);
  const first = samples[0] || {};
  const last = samples[samples.length - 1] || {};
  const priceRiseRate = toNumber(first.price) > 0
    ? ((toNumber(last.price) - toNumber(first.price)) / toNumber(first.price)) * 100
    : 0;
  return {
    sampleCount: samples.length,
    pricePersistence: priceUpCount / steps,
    volumePersistence: volumeUpCount / steps,
    priceRiseRate
  };
}

function evaluateCandidate(candidate, snapshot, marketData) {
  const currentPrice = Math.abs(toNumber(snapshot.currentPrice || snapshot.price));
  const changeRate = toNumber(snapshot.changeRate);
  const firstChangeRate = toNumber(candidate.firstChangeRate ?? snapshot.firstChangeRate ?? changeRate);
  const volumeRatio = toNumber(snapshot.tradeVolumeRatio);
  const dayPosition = calculateDayPosition(snapshot, currentPrice);
  const openPrice = Math.abs(toNumber(snapshot.open || snapshot.openPrice || snapshot.raw?.open_pric));
  const openPositionRate = openPrice > 0
    ? ((currentPrice - openPrice) / openPrice) * 100
    : 0;
  const absoluteVolume = Math.abs(toNumber(snapshot.volume || snapshot.raw?.trde_qty));
  const tradeAmount = Math.max(
    Math.abs(toNumber(snapshot.tradeAmount || snapshot.tradeValue)),
    currentPrice * absoluteVolume
  );
  const hotScore = toNumber(snapshot.hotScore);
  const momentumScore = toNumber(snapshot.openMomentumScore);
  const discoverScore = toNumber(snapshot.discoverScore);
  const sourceCount = Array.isArray(snapshot.sources) ? snapshot.sources.length : 0;
  const sectorPeerCount = toNumber(snapshot.sectorPeerCount);
  const persistence = calculatePersistence(candidate.samples || []);
  const minVolumeRatio = getDynamicMinVolumeRatio();
  const broadConfirmation =
    sourceCount >= SETTINGS.minSourceCount ||
    sectorPeerCount >= SETTINGS.minSectorPeerCount ||
    hotScore >= 75;

  const standardChecks = [
    ["excluded", !isExcludedStock(snapshot), "제외종목"],
    ["price", currentPrice > 0, "현재가 없음"],
    ["marketData", !SETTINGS.marketDataRequired || marketData.available, "당일 시장자료 없음"],
    ["marketAbsolute", !marketData.available || marketData.score >= SETTINGS.absoluteMarketBlockScore, `시장절대차단 ${marketData.score.toFixed(1)}점`],
    ["firstChange", firstChangeRate >= SETTINGS.firstMinChangeRate && firstChangeRate <= SETTINGS.firstMaxChangeRate, `최초상승 ${firstChangeRate.toFixed(2)}%`],
    ["currentChange", changeRate >= SETTINGS.minChangeRate && changeRate <= SETTINGS.maxChangeRate, `현재상승 ${changeRate.toFixed(2)}%`],
    ["volume", volumeRatio >= minVolumeRatio, `거래량 ${volumeRatio.toFixed(1)}% / 기준 ${minVolumeRatio}%`],
    ["dayPosition", dayPosition >= SETTINGS.minDayPositionRate, `당일위치 ${dayPosition.toFixed(1)}%`],
    ["openPosition", openPrice <= 0 || openPositionRate >= 0, `시가대비 ${openPositionRate.toFixed(2)}%`],
    ["discover", discoverScore >= SETTINGS.minDiscoverScore, `발견 ${discoverScore.toFixed(1)}점`],
    ["hot", hotScore >= SETTINGS.minHotScore, `HOT ${hotScore.toFixed(1)}점`],
    ["momentum", momentumScore >= SETTINGS.minOpenMomentumScore, `지속 ${momentumScore.toFixed(1)}점`],
    ["samples", persistence.sampleCount >= SETTINGS.minSampleCount, `관찰 ${persistence.sampleCount}/${SETTINGS.minSampleCount}회`],
    ["pricePersistence", persistence.pricePersistence >= SETTINGS.minPricePersistence, `가격지속 ${(persistence.pricePersistence * 100).toFixed(0)}%`],
    ["volumePersistence", persistence.volumePersistence >= SETTINGS.minVolumePersistence, `거래량지속 ${(persistence.volumePersistence * 100).toFixed(0)}%`],
    ["priceRise", persistence.priceRiseRate >= SETTINGS.minPriceRiseRate && persistence.priceRiseRate <= SETTINGS.maxPriceRiseRate, `관찰상승 ${persistence.priceRiseRate.toFixed(2)}%`],
    ["tradeAmount", tradeAmount >= SETTINGS.minTradeAmount, `거래대금 ${Math.round(tradeAmount / 100000000)}억원`],
    ["broadConfirmation", broadConfirmation, `교차확인 순위 ${sourceCount}·섹터 ${sectorPeerCount}`]
  ];

  if (marketData.available && marketData.score < SETTINGS.weakMarketScore) {
    standardChecks.push(
      ["weakSamples", persistence.sampleCount >= SETTINGS.weakMinSampleCount, `약세장 관찰 ${persistence.sampleCount}/${SETTINGS.weakMinSampleCount}회`],
      ["weakMomentum", momentumScore >= SETTINGS.weakMinOpenMomentumScore, `약세장 지속 ${momentumScore.toFixed(1)}점`],
      ["weakHot", hotScore >= SETTINGS.weakMinHotScore, `약세장 HOT ${hotScore.toFixed(1)}점`],
      ["weakPricePersistence", persistence.pricePersistence >= SETTINGS.weakMinPersistence, `약세장 가격지속 ${(persistence.pricePersistence * 100).toFixed(0)}%`],
      ["weakVolumePersistence", persistence.volumePersistence >= SETTINGS.weakMinPersistence, `약세장 거래량지속 ${(persistence.volumePersistence * 100).toFixed(0)}%`],
      ["weakSources", sourceCount >= SETTINGS.minSourceCount, `약세장 순위교차 ${sourceCount}/${SETTINGS.minSourceCount}`]
    );
  }

  if (
    marketData.available &&
    marketData.score >= SETTINGS.absoluteMarketBlockScore &&
    marketData.score < SETTINGS.extremeWeakMarketScore
  ) {
    standardChecks.push([
      "extremeWeakVolume",
      volumeRatio >= SETTINGS.extremeWeakMinVolumeRatio,
      `초약세장 거래량 ${volumeRatio.toFixed(1)}% / 기준 ${SETTINGS.extremeWeakMinVolumeRatio}%`
    ]);
  }

  const commonTrackChecks = [
    ["excluded", !isExcludedStock(snapshot), "제외종목"],
    ["price", currentPrice > 0, "현재가 없음"],
    ["marketData", !SETTINGS.marketDataRequired || marketData.available, "당일 시장자료 없음"],
    ["marketAbsolute", !marketData.available || marketData.score >= SETTINGS.absoluteMarketBlockScore, `시장절대차단 ${marketData.score.toFixed(1)}점`]
  ];
  const weakBreakoutTrackEnabled = (
    marketData.available &&
    marketData.score >= SETTINGS.absoluteMarketBlockScore &&
    marketData.score < SETTINGS.weakMarketScore
  );
  const earlyBreakoutActive = weakBreakoutTrackEnabled && (
    firstChangeRate >= SETTINGS.earlyBreakoutFirstMinChangeRate &&
    firstChangeRate <= SETTINGS.earlyBreakoutFirstMaxChangeRate
  );
  const lateContinuationActive = weakBreakoutTrackEnabled && (
    firstChangeRate >= SETTINGS.lateContinuationFirstMinChangeRate &&
    firstChangeRate <= SETTINGS.lateContinuationFirstMaxChangeRate
  );

  const trackResults = [{ name: "STANDARD", checks: standardChecks }];

  if (earlyBreakoutActive) {
    trackResults.unshift({
      name: "EARLY_BREAKOUT",
      checks: [
        ...commonTrackChecks,
        ["currentChange", changeRate >= SETTINGS.earlyBreakoutMinChangeRate && changeRate <= SETTINGS.earlyBreakoutMaxChangeRate, `초기돌파 상승 ${changeRate.toFixed(2)}%`],
        ["volume", volumeRatio >= SETTINGS.earlyBreakoutMinVolumeRatio, `초기돌파 거래량 ${volumeRatio.toFixed(1)}% / 기준 ${SETTINGS.earlyBreakoutMinVolumeRatio}%`],
        ["dayPosition", dayPosition >= SETTINGS.earlyBreakoutMinDayPositionRate, `초기돌파 당일위치 ${dayPosition.toFixed(1)}%`],
        ["openPosition", openPrice <= 0 || openPositionRate >= 0, `시가대비 ${openPositionRate.toFixed(2)}%`],
        ["discover", discoverScore >= SETTINGS.earlyBreakoutMinDiscoverScore, `초기돌파 발견 ${discoverScore.toFixed(1)}점`],
        ["hot", hotScore >= SETTINGS.earlyBreakoutMinHotScore, `초기돌파 HOT ${hotScore.toFixed(1)}점`],
        ["momentum", momentumScore >= SETTINGS.earlyBreakoutMinMomentumScore, `초기돌파 지속 ${momentumScore.toFixed(1)}점`],
        ["samples", persistence.sampleCount >= SETTINGS.earlyBreakoutMinSampleCount, `초기돌파 관찰 ${persistence.sampleCount}/${SETTINGS.earlyBreakoutMinSampleCount}회`],
        ["pricePersistence", persistence.pricePersistence >= SETTINGS.earlyBreakoutMinPricePersistence, `초기돌파 가격지속 ${(persistence.pricePersistence * 100).toFixed(0)}%`],
        ["volumePersistence", persistence.volumePersistence >= SETTINGS.earlyBreakoutMinVolumePersistence, `초기돌파 거래량지속 ${(persistence.volumePersistence * 100).toFixed(0)}%`],
        ["priceRise", persistence.priceRiseRate >= SETTINGS.minPriceRiseRate && persistence.priceRiseRate <= SETTINGS.earlyBreakoutMaxPriceRiseRate, `초기돌파 관찰상승 ${persistence.priceRiseRate.toFixed(2)}%`],
        ["tradeAmount", tradeAmount >= SETTINGS.earlyBreakoutMinTradeAmount, `초기돌파 거래대금 ${Math.round(tradeAmount / 100000000)}억원`],
        ["sources", sourceCount >= SETTINGS.earlyBreakoutMinSourceCount, `초기돌파 순위교차 ${sourceCount}/${SETTINGS.earlyBreakoutMinSourceCount}`]
      ]
    });
  }

  if (lateContinuationActive) {
    trackResults.unshift({
      name: "LATE_CONTINUATION",
      checks: [
        ...commonTrackChecks,
        ["currentChange", changeRate >= SETTINGS.lateContinuationMinChangeRate && changeRate <= SETTINGS.lateContinuationMaxChangeRate, `후기지속 상승 ${changeRate.toFixed(2)}%`],
        ["absoluteVolume", absoluteVolume >= SETTINGS.lateContinuationMinAbsoluteVolume, `후기지속 거래량 ${absoluteVolume.toLocaleString()}주`],
        ["dayPosition", dayPosition >= SETTINGS.lateContinuationMinDayPositionRate, `후기지속 당일위치 ${dayPosition.toFixed(1)}%`],
        ["openPosition", openPrice <= 0 || openPositionRate >= 0, `시가대비 ${openPositionRate.toFixed(2)}%`],
        ["discover", discoverScore >= SETTINGS.lateContinuationMinDiscoverScore, `후기지속 발견 ${discoverScore.toFixed(1)}점`],
        ["hot", hotScore >= SETTINGS.lateContinuationMinHotScore, `후기지속 HOT ${hotScore.toFixed(1)}점`],
        ["momentum", momentumScore >= SETTINGS.lateContinuationMinMomentumScore, `후기지속 지속 ${momentumScore.toFixed(1)}점`],
        ["samples", persistence.sampleCount >= SETTINGS.lateContinuationMinSampleCount, `후기지속 관찰 ${persistence.sampleCount}/${SETTINGS.lateContinuationMinSampleCount}회`],
        ["pricePersistence", persistence.pricePersistence >= SETTINGS.lateContinuationMinPricePersistence, `후기지속 가격지속 ${(persistence.pricePersistence * 100).toFixed(0)}%`],
        ["priceRise", persistence.priceRiseRate >= SETTINGS.minPriceRiseRate && persistence.priceRiseRate <= SETTINGS.lateContinuationMaxPriceRiseRate, `후기지속 관찰상승 ${persistence.priceRiseRate.toFixed(2)}%`],
        ["tradeAmount", tradeAmount >= SETTINGS.lateContinuationMinTradeAmount, `후기지속 거래대금 ${Math.round(tradeAmount / 100000000)}억원`],
        ["sources", sourceCount >= SETTINGS.lateContinuationMinSourceCount, `후기지속 순위교차 ${sourceCount}/${SETTINGS.lateContinuationMinSourceCount}`]
      ]
    });
  }

  const evaluatedTracks = trackResults.map(track => ({
    ...track,
    failedChecks: track.checks.filter(([, pass]) => !pass)
  }));
  const selectedTrack = (
    evaluatedTracks.find(track => track.failedChecks.length === 0) ||
    evaluatedTracks.sort((a, b) => a.failedChecks.length - b.failedChecks.length)[0]
  );
  const failedChecks = selectedTrack.failedChecks;
  const failed = failedChecks[0] || null;
  const failedKeys = failedChecks.map(([key]) => key);
  const failedReasons = failedChecks.map(([, , reason]) => reason);
  const fastScore = clamp(
    hotScore * 0.35 +
    momentumScore * 0.35 +
    persistence.pricePersistence * 15 +
    persistence.volumePersistence * 10 +
    Math.min(10, sourceCount * 4) +
    Math.min(5, sectorPeerCount),
    0,
    100
  );

  return {
    pass: !failed,
    failedKey: failed?.[0] || null,
    failedKeys,
    failedReasons,
    failedCount: failedChecks.length,
    reason: failed ? failed[2] : `FAST ${selectedTrack.name} 조건 통과`,
    secondaryReason: failedReasons.slice(1, 4).join(" · ") || null,
    diagnosticReason: failed
      ? failedReasons.slice(0, 4).join(" · ")
      : `FAST ${selectedTrack.name} 조건 통과`,
    currentPrice,
    changeRate,
    firstChangeRate,
    volumeRatio,
    dayPosition,
    openPositionRate,
    tradeAmount,
    hotScore,
    momentumScore,
    discoverScore,
    sourceCount,
    sectorPeerCount,
    sampleCount: persistence.sampleCount,
    pricePersistence: persistence.pricePersistence,
    volumePersistence: persistence.volumePersistence,
    priceRiseRate: persistence.priceRiseRate,
    fastScore,
    marketScore: marketData.score,
    marketType: marketData.type,
    weakMarket: marketData.available && marketData.score < SETTINGS.weakMarketScore,
    entryTrack: selectedTrack.name,
    availableTracks: evaluatedTracks.map(track => ({
      name: track.name,
      failedCount: track.failedChecks.length
    })),
    realtimeEnriched: snapshot._fastRealtimeEnriched === true
  };
}

function getCandidateStatus(evaluation) {
  if (evaluation.pass) return "READY";
  return evaluation.failedKeys.includes("marketAbsolute") ? "BLOCK" : "WATCH";
}

function applyCandidateEvaluation(candidate, snapshot, evaluation) {
  candidate.snapshot = { ...snapshot, code: candidate.code };
  candidate.evaluation = evaluation;
  candidate.fastScore = Number(evaluation.fastScore.toFixed(1));
  candidate.status = getCandidateStatus(evaluation);
  candidate.reason = evaluation.reason;
  candidate.secondaryReason = evaluation.secondaryReason;
  candidate.diagnosticReason = evaluation.diagnosticReason;
  candidate.failedKeys = evaluation.failedKeys;
}

const REALTIME_DERIVED_FAILURE_KEYS = new Set([
  "dayPosition",
  "openPosition",
  "discover",
  "hot",
  "tradeAmount",
  "broadConfirmation",
  "weakHot"
]);

function canRealtimeRecheck(candidate, evaluation) {
  if (!evaluation || evaluation.failedKeys.includes("marketData")) return false;
  if (evaluation.failedKeys.includes("marketAbsolute")) return false;
  if (evaluation.pass) return true;
  if (!evaluation.failedKeys.length) return false;
  if (!evaluation.failedKeys.every(key => REALTIME_DERIVED_FAILURE_KEYS.has(key))) return false;
  const lastCheckAtMs = toNumber(candidate.lastRealtimeCheckAtMs);
  return !lastCheckAtMs || Date.now() - lastCheckAtMs >= SETTINGS.realtimeEnrichCooldownMs;
}

function ingestCandidates(state, marketData) {
  const hot = loadHotInputs();
  if (!hot.rows.length) return { evaluations: [], reason: hot.reason || "HOT 후보 없음" };

  const sourceObservedAtMs = toNumber(hot.hotUpdatedAtMs || Date.now());
  const evaluations = [];
  for (const item of hot.rows) {
    if (!normalizeCode(item.code)) continue;
    const candidate = updateCandidateObservation(state, item, sourceObservedAtMs);
    const evaluation = evaluateCandidate(candidate, item, marketData);
    applyCandidateEvaluation(candidate, item, evaluation);
    evaluations.push({ candidate, snapshot: item, evaluation });
  }

  const nowMs = Date.now();
  state.candidates = state.candidates
    .filter(candidate => nowMs - toNumber(candidate.lastSeenAtMs) <= SETTINGS.candidateMaxAgeMs)
    .sort((a, b) => toNumber(b.fastScore) - toNumber(a.fastScore))
    .slice(0, SETTINGS.candidateMaxCount);

  evaluations.sort((a, b) => b.evaluation.fastScore - a.evaluation.fastScore);
  return { evaluations, reason: null };
}

async function fetchJson(url, timeoutMs = SETTINGS.buyPriceRequestTimeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch (_) {
      data = { rawText: text };
    }
    if (!response.ok || data.ok === false) {
      throw new Error(data.message || data.error || `API 오류 ${response.status}`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function getFastPrice(code, source = "fast") {
  const normalizedSource = String(source || "").toLowerCase();
  const isSellRequest = normalizedSource === "fast-sell";
  const timeoutMs = isSellRequest
    ? SETTINGS.sellPriceRequestTimeoutMs
    : SETTINGS.buyPriceRequestTimeoutMs;
  const maxQuoteAgeMs = isSellRequest
    ? SETTINGS.sellMaxQuoteAgeMs
    : SETTINGS.buyMaxQuoteAgeMs;
  const maxAttempts = isSellRequest
    ? 1 + Math.max(0, toNumber(SETTINGS.sellPriceRetryCount))
    : 1;

  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const data = await fetchJson(
        `${API_BASE}/api/price?code=${encodeURIComponent(code)}&source=${encodeURIComponent(source)}`,
        timeoutMs
      );
      const currentPrice = Math.abs(
        toNumber(data.currentPrice || data.price || data.raw?.cur_prc)
      );
      const observedAtMs = toNumber(data.quoteObservedAtMs || data.cachedAtMs);
      const quoteAgeMs = observedAtMs > 0
        ? Math.max(0, Date.now() - observedAtMs)
        : 0;

      if (!currentPrice) throw new Error("현재가 없음");
      if (observedAtMs > 0 && quoteAgeMs > maxQuoteAgeMs) {
        throw new Error(
          `시세 오래됨 ${Math.round(quoteAgeMs / 1000)}초 / ` +
          `허용 ${Math.round(maxQuoteAgeMs / 1000)}초`
        );
      }

      return { ...data, currentPrice, quoteAgeMs };
    } catch (error) {
      lastError = error;

      if (attempt >= maxAttempts) break;

      console.warn(
        `[FAST 매도시세 재시도] ${normalizeCode(code) || code} / ` +
        `${attempt}/${maxAttempts - 1} / ${error.message}`
      );
      await sleep(SETTINGS.sellPriceRetryDelayMs);
    }
  }

  throw lastError || new Error("FAST 현재가 조회 실패");
}

function buildRealtimeSnapshot(snapshot, priceData) {
  const raw = priceData.raw || {};
  const currentPrice = Math.abs(toNumber(priceData.currentPrice || snapshot.currentPrice));
  const merged = {
    ...snapshot,
    currentPrice,
    price: currentPrice,
    changeRate: toNumber(priceData.changeRate ?? snapshot.changeRate),
    open: Math.abs(toNumber(priceData.open || raw.open_pric || snapshot.open)),
    high: Math.abs(toNumber(priceData.high || raw.high_pric || snapshot.high)),
    low: Math.abs(toNumber(priceData.low || raw.low_pric || snapshot.low)),
    volume: Math.abs(toNumber(priceData.volume || raw.trde_qty || snapshot.volume)),
    quoteObservedAtMs: toNumber(priceData.quoteObservedAtMs || Date.now()),
    quoteAgeMs: toNumber(priceData.quoteAgeMs),
    _fastRealtimeEnriched: true,
    raw: { ...(snapshot.raw || {}), ...raw }
  };
  merged.dayPosition = calculateDayPosition(merged, currentPrice);
  merged.hotScore = Number(calculateRealtimeHotScore(merged, currentPrice).toFixed(1));
  merged.discoverScore = calculateRealtimeDiscoverScore(merged, currentPrice);
  return merged;
}

function wasBoughtToday(state, code) {
  return Boolean(getDailyStats(state).boughtCodes[normalizeCode(code)]);
}

function paperBuy(state, candidate, snapshot, evaluation) {
  const daily = getDailyStats(state);
  const code = normalizeCode(candidate.code);

  if (!evaluation.pass) return false;

  applyMasterAccountToFastState(state);

  const masterState =
    portfolioManager.loadMasterState();

  portfolioManager.ensureMasterState(masterState);

  const strategyCheck =
    portfolioManager.canStrategyTrade(
      masterState,
      "FAST"
    );

  if (!strategyCheck.ok) {
    candidate.status = "WATCH";
    candidate.reason =
      `MASTER / ${strategyCheck.reason}`;
    return false;
  }

  const duplicate =
    portfolioManager.findHoldingByCode(
      masterState,
      code
    );

  if (duplicate) {
    const owner =
      duplicate.ownerStrategy ||
      duplicate.strategyGroup ||
      duplicate.strategy ||
      "UNKNOWN";

    candidate.status = "WATCH";
    candidate.reason =
      `MASTER 동일종목 보유중 / ${owner}`;
    return false;
  }

  if (wasBoughtToday(state, code)) return false;
  if (state.holdings.length >= SETTINGS.maxHoldingCount) return false;

  const hhmm = getCurrentHHMM();
  const effectiveDailyBuyLimit = getEffectiveDailyBuyLimit(hhmm);
  if (toNumber(daily.buyCount) >= effectiveDailyBuyLimit) {
    candidate.status = "WATCH";
    candidate.reason = hhmm < SETTINGS.earlyReservedSlotUntil
      ? `FAST 5번째 슬롯 예약 / ${SETTINGS.earlyReservedSlotUntil} 이후 재평가`
      : `FAST 하루 매수한도 ${SETTINGS.maxDailyBuyCount}회`;
    return false;
  }

  const price =
    Math.abs(toNumber(evaluation.currentPrice));

  if (!price) return false;

  const dailyPositionAmount =
    Math.max(
      0,
      toNumber(daily.positionAmount)
    );

  const availability =
    portfolioManager.getAvailableCash(
      masterState,
      { strategy: "FAST" }
    );

  const targetAmount = Math.min(
    dailyPositionAmount,
    toNumber(availability.availableCash)
  );

  const qty = Math.floor(
    targetAmount / price
  );

  // 기존 FAST 규칙 유지:
  // 목표금액의 95% 미만밖에 살 수 없으면 신규매수를 포기한다.
  if (
    qty <= 0 ||
    targetAmount < dailyPositionAmount * 0.95
  ) {
    candidate.status = "WATCH";
    candidate.reason =
      `MASTER 가용현금 부족 / ` +
      `${toNumber(availability.availableCash).toLocaleString("ko-KR")}원`;
    return false;
  }

  const timestampMs = Date.now();

  const result = portfolioManager.executeBuy({
    strategy: "FAST",
    code,
    name:
      candidate.name ||
      snapshot.name ||
      code,
    price,
    requestedAmount: targetAmount,
    timestampMs,
    buyAt: nowText(),
    holding: {
      name:
        candidate.name ||
        snapshot.name ||
        code,
      highestPrice: price,
      firstChangeRate: evaluation.firstChangeRate,
      buyChangeRate: evaluation.changeRate,
      buyVolumeRatio: evaluation.volumeRatio,
      buyDayPosition: evaluation.dayPosition,
      fastScore: evaluation.fastScore,
      marketScore: evaluation.marketScore,
      maxProfitRate: 0,
      profitRate: 0,
      entryTrack:
        evaluation.entryTrack || "STANDARD",
      reason:
        `FAST ${evaluation.entryTrack || "STANDARD"} 재검증 통과`
    },
    logType: "FAST_BUY",
    tradeLog: {
      evaluation
    }
  });

  if (!result.ok) {
    candidate.status = "WATCH";
    candidate.reason =
      `MASTER / ${result.reason || "매수승인 실패"}`;
    applyMasterAccountToFastState(state);
    return false;
  }

  applyMasterAccountToFastState(state);

  daily.buyCount =
    toNumber(daily.buyCount) + 1;

  daily.boughtCodes[code] =
    result.holding?.name ||
    candidate.name ||
    code;

  candidate.status = "BOUGHT";
  candidate.reason =
    `FAST ${evaluation.entryTrack || "STANDARD"} ` +
    `매수 ${price.toLocaleString()}원`;

  console.log(
    `[FAST MASTER BUY] ` +
    `${result.holding?.name || candidate.name || code}(${code}) / ` +
    `${price.toLocaleString()}원 / ` +
    `${toNumber(result.qty).toLocaleString()}주 / ` +
    `${toNumber(result.buyAmount).toLocaleString()}원 / ` +
    `상승 ${evaluation.changeRate.toFixed(2)}% / ` +
    `FAST ${evaluation.fastScore.toFixed(1)}점`
  );

  return true;
}

function paperSell(state, holding, price, type, reason) {
  const sellPrice = Math.abs(toNumber(price));

  if (!holding || !sellPrice) {
    return false;
  }

  persistFastHoldingMarksToMaster(state);

  const result = portfolioManager.executeSell({
    strategy: "FAST",
    positionId:
      holding.positionId || null,
    code: holding.code,
    price: sellPrice,
    logType: type,
    reason,
    tradeLog: {
      maxProfitRate:
        toNumber(holding.maxProfitRate),
      drawdownFromHigh:
        toNumber(holding.drawdownFromHigh),
      fastScore:
        toNumber(holding.fastScore),
      entryTrack:
        holding.entryTrack || "STANDARD"
    }
  });

  if (!result.ok) {
    console.log(
      `[FAST MASTER SELL 실패] ` +
      `${holding.name}(${holding.code}) / ` +
      `${result.reason || "알 수 없는 오류"}`
    );
    applyMasterAccountToFastState(state);
    return false;
  }

  applyMasterAccountToFastState(state);

  const profit =
    toNumber(result.profit);

  const profitRate =
    toNumber(result.profitRate);

  const daily = getDailyStats(state);

  daily.sellCount =
    toNumber(daily.sellCount) + 1;

  daily.realizedProfit =
    toNumber(daily.realizedProfit) + profit;

  if (profit > 0) {
    daily.winCount =
      toNumber(daily.winCount) + 1;
  } else if (profit < 0) {
    daily.lossCount =
      toNumber(daily.lossCount) + 1;
  }

  console.log(
    `[FAST MASTER SELL] ` +
    `${holding.name}(${holding.code}) / ` +
    `${sellPrice.toLocaleString()}원 / ` +
    `${profitRate >= 0 ? "+" : ""}${profitRate.toFixed(2)}% / ` +
    `${reason}`
  );

  return true;
}

function getSellDecision(holding, price, hhmm = getCurrentHHMM()) {
  const buyPrice = toNumber(holding.buyPrice);
  const highestPrice = Math.max(toNumber(holding.highestPrice), price);
  const profitRate = buyPrice > 0 ? ((price - buyPrice) / buyPrice) * 100 : 0;
  const maxProfitRate = buyPrice > 0 ? ((highestPrice - buyPrice) / buyPrice) * 100 : 0;
  const drawdownRate = highestPrice > 0 ? ((price - highestPrice) / highestPrice) * 100 : 0;
  const holdingMinutes = Math.max(0, (Date.now() - toNumber(holding.buyAtMs)) / 60000);

  if (profitRate <= SETTINGS.stopLossRate) {
    return { sell: true, type: "FAST_STOP_LOSS", reason: `초기손절 ${profitRate.toFixed(2)}%`, profitRate, maxProfitRate, drawdownRate };
  }
  if (
    maxProfitRate >= SETTINGS.protectStartProfitRate &&
    maxProfitRate < SETTINGS.trailingStartProfitRate &&
    profitRate <= SETTINGS.protectFloorProfitRate
  ) {
    return { sell: true, type: "FAST_PROTECT_SELL", reason: `수익 후 본전보호 / 최고 ${maxProfitRate.toFixed(2)}%`, profitRate, maxProfitRate, drawdownRate };
  }
  if (
    maxProfitRate >= SETTINGS.strongTrailingStartProfitRate &&
    drawdownRate <= -SETTINGS.strongTrailingStopRate
  ) {
    return { sell: true, type: "FAST_STRONG_TRAILING_SELL", reason: `강한 상승 트레일링 / 최고 ${maxProfitRate.toFixed(2)}% / 고점대비 ${drawdownRate.toFixed(2)}%`, profitRate, maxProfitRate, drawdownRate };
  }
  if (
    maxProfitRate >= SETTINGS.trailingStartProfitRate &&
    maxProfitRate < SETTINGS.strongTrailingStartProfitRate &&
    drawdownRate <= -SETTINGS.trailingStopRate
  ) {
    return { sell: true, type: "FAST_TRAILING_SELL", reason: `수익 트레일링 / 최고 ${maxProfitRate.toFixed(2)}% / 고점대비 ${drawdownRate.toFixed(2)}%`, profitRate, maxProfitRate, drawdownRate };
  }
  if (
    holdingMinutes >= SETTINGS.stagnationMinutes &&
    maxProfitRate < SETTINGS.stagnationMaxPeakRate &&
    profitRate <= SETTINGS.stagnationMaxProfitRate
  ) {
    return { sell: true, type: "FAST_STAGNATION_SELL", reason: `초기정체 ${holdingMinutes.toFixed(0)}분 / 최고 ${maxProfitRate.toFixed(2)}%`, profitRate, maxProfitRate, drawdownRate };
  }
  if (
    holdingMinutes >= SETTINGS.weakMaxHoldingMinutes &&
    maxProfitRate < SETTINGS.weakMaxHoldingPeakRate
  ) {
    return { sell: true, type: "FAST_TIME_SELL", reason: `약한 종목 시간청산 ${holdingMinutes.toFixed(0)}분 / 최고 ${maxProfitRate.toFixed(2)}%`, profitRate, maxProfitRate, drawdownRate };
  }
  if (hhmm >= SETTINGS.forceSellTime) {
    return { sell: true, type: "FAST_FORCE_SELL", reason: `장마감 청산 ${SETTINGS.forceSellTime}`, profitRate, maxProfitRate, drawdownRate };
  }
  return { sell: false, profitRate, maxProfitRate, drawdownRate };
}

async function checkHoldings(state) {
  const hhmm = getCurrentHHMM();
  if (hhmm < SETTINGS.sellStartTime || hhmm > SETTINGS.sellEndTime) return;

  for (const holding of [...state.holdings]) {
    try {
      const priceData = await getFastPrice(holding.code, "fast-sell");
      const price = toNumber(priceData.currentPrice);
      holding.currentPrice = price;
      holding.highestPrice = Math.max(toNumber(holding.highestPrice), price);
      const decision = getSellDecision(holding, price, hhmm);
      holding.profitRate = Number(decision.profitRate.toFixed(2));
      holding.maxProfitRate = Number(decision.maxProfitRate.toFixed(2));
      holding.drawdownFromHigh = Number(decision.drawdownRate.toFixed(2));
      holding.lastPriceAt = nowText();
      holding.lastPriceSuccessAt = holding.lastPriceAt;
      holding.lastPriceSuccessAtMs = Date.now();
      holding.priceFailCount = 0;
      holding.lastPriceError = null;
      holding.lastPriceErrorAt = null;
      holding.lastPriceErrorAtMs = 0;
      if (decision.sell) paperSell(state, holding, price, decision.type, decision.reason);
    } catch (error) {
      holding.priceFailCount = toNumber(holding.priceFailCount) + 1;
      holding.lastPriceError = error.message;
      holding.lastPriceErrorAt = nowText();
      holding.lastPriceErrorAtMs = Date.now();
      console.warn(
        `[FAST 보유조회 실패] ${holding.name} / 연속 ${holding.priceFailCount}회 / ${error.message}`
      );
      if (holding.priceFailCount === 3 || holding.priceFailCount % 5 === 0) {
        console.error(
          `[FAST 시세위험] ${holding.name}(${holding.code}) / ` +
          `보유 현재가 연속 ${holding.priceFailCount}회 조회 실패 / ` +
          `마지막 성공 ${holding.lastPriceSuccessAt || holding.lastPriceAt || "없음"}`
        );
      }
    }
    await sleep(120);
  }
}

async function tryFastBuys(state, evaluations, marketData) {
  const daily = getDailyStats(state);
  const hhmm = getCurrentHHMM();
  const effectiveDailyBuyLimit = getEffectiveDailyBuyLimit(hhmm);

  if (state.holdings.length >= SETTINGS.maxHoldingCount) return;
  if (toNumber(daily.buyCount) >= effectiveDailyBuyLimit) {
    if (
      hhmm < SETTINGS.earlyReservedSlotUntil &&
      toNumber(daily.buyCount) >= SETTINGS.earlyMaxDailyBuyCount
    ) {
      const nowMs = Date.now();
      if (nowMs - toNumber(daily.lastReservedSlotLogAtMs) >= 60 * 1000) {
        daily.lastReservedSlotLogAtMs = nowMs;
        console.log(
          `[FAST 슬롯예약] ${hhmm} / ` +
          `09:10 전 ${SETTINGS.earlyMaxDailyBuyCount}회 사용 완료 / ` +
          `5번째 매수는 ${SETTINGS.earlyReservedSlotUntil} 이후 허용`
        );
      }
    }
    return;
  }

  const targets = evaluations
    .filter(row => canRealtimeRecheck(row.candidate, row.evaluation))
    .filter(row => !state.holdings.some(item => item.code === row.candidate.code))
    .filter(row => !wasBoughtToday(state, row.candidate.code))
    .slice(0, SETTINGS.candidateRealtimeCheckCount);

  for (const target of targets) {
    try {
      target.candidate.lastRealtimeCheckAtMs = Date.now();
      target.candidate.lastRealtimeCheckAt = nowText();
      const priceData = await getFastPrice(target.candidate.code, "fast");
      const realtimeSnapshot = buildRealtimeSnapshot(target.snapshot, priceData);
      const realtimeEvaluation = evaluateCandidate(target.candidate, realtimeSnapshot, marketData);
      applyCandidateEvaluation(target.candidate, realtimeSnapshot, realtimeEvaluation);

      if (realtimeEvaluation.pass) {
        paperBuy(state, target.candidate, realtimeSnapshot, realtimeEvaluation);
      }
    } catch (error) {
      target.candidate.status = "WATCH";
      target.candidate.reason = `실시간 재확인 실패 / ${error.message}`;
      target.candidate.diagnosticReason = target.candidate.reason;
      console.warn(`[FAST 후보조회 실패] ${target.candidate.name} / ${error.message}`);
    }

    if (
      state.holdings.length >= SETTINGS.maxHoldingCount ||
      toNumber(daily.buyCount) >= getEffectiveDailyBuyLimit(getCurrentHHMM())
    ) break;
    await sleep(120);
  }
}

function calculatePortfolio(state) {
  const snapshot = getFastMasterSnapshot();

  const fastHoldings =
    Array.isArray(state?.holdings)
      ? state.holdings
      : snapshot.holdings;

  const holdingsValue = fastHoldings.reduce(
    (sum, holding) =>
      sum +
      toNumber(
        holding.currentPrice ||
        holding.buyPrice
      ) *
      toNumber(holding.qty),
    0
  );

  const unrealizedProfit = fastHoldings.reduce(
    (sum, holding) =>
      sum +
      (
        toNumber(
          holding.currentPrice ||
          holding.buyPrice
        ) -
        toNumber(holding.buyPrice)
      ) *
      toNumber(holding.qty),
    0
  );

  const fastLogs =
    portfolioManager.getStrategyTradeLogs(
      snapshot.masterState,
      "FAST"
    );

  const realizedProfit = fastLogs.reduce(
    (sum, log) =>
      sum +
      (
        String(log.type || "").includes("SELL")
          ? toNumber(log.profit)
          : 0
      ),
    0
  );

  return {
    totalAsset:
      portfolioManager.getEquity(
        snapshot.masterState
      ),
    cash:
      toNumber(snapshot.masterState.totalCash),
    holdingsValue,
    strategyHoldingsValue: holdingsValue,
    strategyExposure: snapshot.strategyExposure,
    realizedProfit,
    unrealizedProfit
  };
}

function getFastSummary(stateInput = null) {
  const state = stateInput || loadFastState();
  const daily = getDailyStats(state);
  const portfolio = calculatePortfolio(state);
  const candidates = [...state.candidates]
    .sort((a, b) => toNumber(b.fastScore) - toNumber(a.fastScore));
  return {
    strategy: "FAST",
    strategyVersion: STRATEGY_VERSION,
    updatedAt: state.updatedAt,
    lastRunAt: state.lastRunAt,
    lastRunReason: state.lastRunReason,
    initialCapital: toNumber(state.initialCapital),
    allocationDate: daily.date,
    allocationFixedAt: daily.allocationFixedAt || null,
    allocationBaseAsset: toNumber(daily.allocationBaseAsset),
    positionRatio: FAST_MASTER_POSITION_RATIO,
    positionAmount: toNumber(daily.positionAmount),
    maxHoldingCount: SETTINGS.maxHoldingCount,
    maxDailyBuyCount: SETTINGS.maxDailyBuyCount,
    earlyReservedSlotUntil: SETTINGS.earlyReservedSlotUntil,
    earlyMaxDailyBuyCount: SETTINGS.earlyMaxDailyBuyCount,
    effectiveDailyBuyLimit: getEffectiveDailyBuyLimit(),
    buyStartTime: SETTINGS.buyStartTime,
    buyEndTime: SETTINGS.buyEndTime,
    absoluteMarketBlockScore: SETTINGS.absoluteMarketBlockScore,
    extremeWeakMarketScore: SETTINGS.extremeWeakMarketScore,
    extremeWeakMinVolumeRatio: SETTINGS.extremeWeakMinVolumeRatio,
    weakMarketScore: SETTINGS.weakMarketScore,
    ...portfolio,
    holdingCount: state.holdings.length,
    todayBuyCount: toNumber(daily.buyCount),
    todaySellCount: toNumber(daily.sellCount),
    todayWinCount: toNumber(daily.winCount),
    todayLossCount: toNumber(daily.lossCount),
    readyCount: candidates.filter(item => item.status === "READY").length,
    candidateCount: candidates.length,
    market: getMarketData(),
    holdings: state.holdings,
    candidates: candidates.slice(0, 30),
    recentTrades: state.tradeLogs.slice(-30).reverse()
  };
}

let runPromise = null;

async function runFastOnce() {
  if (runPromise) return runPromise;
  runPromise = (async () => {
    const state = loadFastState();
    const hhmm = getCurrentHHMM();

    if (!SETTINGS.enabled || !isKoreanWeekday()) {
      state.lastRunReason = !SETTINGS.enabled ? "FAST OFF" : "휴장일";
      state.lastRunAt = nowText();
      state.lastRunAtMs = Date.now();
      saveFastState(state);
      return { ok: true, state, summary: getFastSummary(state), reason: state.lastRunReason };
    }

    await checkHoldings(state);

    let runReason = "보유종목 위험점검";
    if (hhmm >= SETTINGS.buyStartTime && hhmm <= SETTINGS.buyEndTime) {
      const marketData = getMarketData();
      const result = ingestCandidates(state, marketData);
      const daily = getDailyStats(state);
      daily.evaluatedCount = toNumber(daily.evaluatedCount) + result.evaluations.length;
      daily.passedCount = toNumber(daily.passedCount) + result.evaluations.filter(row => row.evaluation.pass).length;
      await tryFastBuys(state, result.evaluations, marketData);
      runReason = result.reason || (
        `후보 ${result.evaluations.length}개 / ` +
        `READY ${result.evaluations.filter(row => row.evaluation.pass).length}개`
      );
    } else if (hhmm < SETTINGS.buyStartTime) {
      runReason = `${SETTINGS.buyStartTime} 매수 시작 대기`;
    } else if (hhmm >= SETTINGS.forceSellTime) {
      runReason = "FAST 장마감 청산점검";
    } else {
      runReason = "FAST 신규매수 종료 / 보유관리";
    }

    state.lastRunAt = nowText();
    state.lastRunAtMs = Date.now();
    state.lastRunReason = runReason;
    saveFastState(state);
    return { ok: true, state, summary: getFastSummary(state), reason: runReason };
  })().catch(error => {
    console.error("[FAST RUN 오류]", error.stack || error.message);
    throw error;
  }).finally(() => {
    runPromise = null;
  });
  return runPromise;
}

function getNextLoopMs() {
  const hhmm = getCurrentHHMM();
  if (hhmm >= SETTINGS.buyStartTime && hhmm <= SETTINGS.buyEndTime) {
    return SETTINGS.buyLoopMs;
  }
  if (hhmm >= SETTINGS.sellStartTime && hhmm <= SETTINGS.sellEndTime) {
    return SETTINGS.sellOnlyLoopMs;
  }
  return SETTINGS.idleLoopMs;
}

let started = false;
let timer = null;

async function fastLoop() {
  if (!started) return;
  try {
    await runFastOnce();
  } catch (_) {
    // 오류는 runFastOnce에서 기록하고 다음 주기에 자동 복구한다.
  }
  if (!started) return;
  timer = setTimeout(fastLoop, getNextLoopMs());
  if (typeof timer.unref === "function") timer.unref();
}

function startFastStrategy() {
  if (started) {
    console.log("[FAST] 이미 실행 중");
    return;
  }
  started = true;
  console.log(
    `[FAST] V${STRATEGY_VERSION} 시작 / MASTER 단일계좌 / ` +
    `종목당 당일 MASTER 기준자산 ${(FAST_MASTER_POSITION_RATIO * 100).toFixed(0)}% / 최대 ${SETTINGS.maxHoldingCount}종목 / ` +
    `매수 ${SETTINGS.buyStartTime}~${SETTINGS.buyEndTime} / ` +
    `${SETTINGS.earlyReservedSlotUntil} 전 최대 ${SETTINGS.earlyMaxDailyBuyCount}회`
  );
  void fastLoop();
}

module.exports = {
  startFastStrategy,
  runFastOnce,
  loadFastState,
  getFastSummary,
  resetFastState,
  __test: {
    SETTINGS,
    getDailyStats,
    getEffectiveDailyBuyLimit,
    paperBuy,
    calculatePersistence,
    evaluateCandidate,
    buildRealtimeSnapshot,
    canRealtimeRecheck,
    calculateRealtimeHotScore,
    calculateRealtimeDiscoverScore,
    getSellDecision,
    calculatePortfolio
  }
};
