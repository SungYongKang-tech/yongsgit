const fs = require("fs");
const path = require("path");

const API_BASE = process.env.SY_QUANT_API_BASE || "http://127.0.0.1:3000";

// SY Quant MASTER 단일계좌 공통 자금관리
const portfolioManager = require("./portfolio-manager");
const STATE_FILE = path.join(__dirname, "paper-state-wave.json");
const HOT_HISTORY_FILE = path.join(__dirname, "hot-candidates-history.json");
const OPEN_MARKET_FILE = path.join(__dirname, "open-market.json");

const STRATEGY_VERSION = "1.6.0-MASTER";
const ANALYSIS_RULE_VERSION = "20260902-best-trigger-profit-engine-v11";
const WATCH_CAP_DROP_REASON = "활성후보 상한 / 우선순위 밖";

const SETTINGS = {
  enabled: true,
  initialCapital: 100000000,

  // WAVE는 당일 급등 추격이 아니라 2차 상승 파동을 노린다.
  buyStartTime: "09:00",
  buyEndTime: "14:50",
  sellCheckStartTime: "09:00",
  sellCheckEndTime: "15:20",
  evaluationStartTime: "09:00",
  evaluationEndTime: "15:10",
  loopMs: 5 * 60 * 1000,

  // 후보평가는 5분 주기를 유지하되 보유종목 현재가 위험관리는 1분마다 우선 확인한다.
  holdingCheckMs: 60 * 1000,
  // 서버에서 진행 중인 1건(최대 8초) 뒤 SELL 2건이 순차 실행돼도 먼저 포기하지 않는다.
  holdingPriceTimeoutMs: 20 * 1000,
  holdingPriceRetryCount: 1,
  holdingPriceRetryDelayMs: 500,
  holdingPriceBatchSize: 2,
  holdingMaxQuoteAgeMs: 5 * 1000,
  candidateMaxQuoteAgeMs: 15 * 1000,

  // 장중에는 TRIGGER → READY → 고득점 WATCH를 우선 평가하되,
  // 나머지 후보도 굶지 않도록 상위 8개 + 가장 오래 평가시도하지 않은 4개를 섞는다.
  // TRIGGER는 다음 평가에서 재확인 후에만 매수한다.
  liveEvaluationBatchSize: 12,
  livePriorityBatchSize: 8,
  liveRotationBatchSize: 4,

  // 장 마감 후에는 활성 WATCH 전체를 1회 사전분석하고,
  // 다음 거래일 08:45 이후 장전자료 갱신 후 다시 1회 전체 재평가한다.
  afterClosePreEvalStartTime: "15:30",
  morningPreEvalStartTime: "08:45",
  morningPreEvalEndTime: "08:59",
  preEvaluationBatchSize: 40,
  retryUnevaluatedBatchSize: 8,
  preEvaluationMaxRetryCount: 2,
  evaluationDelayMs: 350,

  // 후보 유입: HOT 누적이력 + OPEN 장전 우선종목
  maxWatchCount: 40,
  hotIngestMaxCount: 25,
  marketPriorityIngestMaxCount: 10,
  hotMinScore: 65,
  hotMinChangeRate: 2.0,
  hotMaxChangeRate: 25.0,
  hotMinDetectionCount: 2,
  // 기존 HOT 누적파일에 이미 비정상 거래량비율이 남아 있어도 WAVE 점수에 전파하지 않는다.
  hotVolumeRatioSanityMax: 5000,
  watchMaxTradingDays: 12,

  // 점수: WHY 30 + MONEY 20 + SECTOR 15 + TREND 10 + PULLBACK 15 + REBOUND 10
  whyMinScore: 12,
  foundationMinScore: 35, // WHY + MONEY + SECTOR
  totalBuyMinScore: 65,
  minWatchTradingDaysBeforeBuy: 1,
  pullbackMinScoreForReady: 7,
  // 눌림 점수만 높고 현재가가 전고점에 거의 붙어 있는 종목의 추격매수를 막는다.
  // 현재가는 관찰구간 고점 대비 최소 1.5% 아래에 있어야 READY로 승격한다.
  readyMinPullbackDepthRate: 1.5,
  reboundMinScoreForBuy: 6,

  // V1.5.1 진입 안전장치
  // 전일 급등 종목은 다음날 장 초반 즉시 추격하지 않는다.
  previousDaySurgeRate: 10.0,
  previousDayExtremeSurgeRate: 20.0,
  previousDaySurgeCooldownEndTime: "09:30",
  previousDayExtremeSurgeCooldownEndTime: "10:00",

  // TRIGGER는 한 번 잡혔다고 바로 사지 않는다.
  // 최소 다음 5분 평가에서도 조건이 유지되어야 실제 HOLD(매수)로 전환한다.
  triggerConfirmMinMs: 4 * 60 * 1000,
  triggerConfirmMaxDipRate: -0.5,

  // READY는 "좋은 종목 + 실제 눌림" 상태여야 한다.
  // 당일 +10% 이상 급등 중인 종목은 1차 파동(IMPULSE)으로 보고 READY로 올리지 않는다.
  // 다음 거래일부터 상승률이 진정되고 눌림 조건이 유지되면 다시 READY 평가한다.
  readyMaxCurrentDayChangeRate: 10.0,

  // READY 종목도 실제 매수 순간 +7%를 넘으면 추격하지 않는다.
  currentDayMaxChangeRateForBuy: 7.0,

  // MASTER 단일계좌에서 WAVE 종목당 최초자산 10%를 요청한다.
  positionRatio: 0.10,
  maxHoldingCount: 5,
  maxDailyBuyCount: 2,
  // OPEN 시장점수가 절대약세 구간이면 WAVE는 완전차단하지 않고 신규노출만 1종목으로 줄인다.
  weakMarketScore: 25,
  weakMarketMaxDailyBuyCount: 1,

  // V1.6.0 수익형 BEST TRIGGER 선발
  waveBestTriggerEnabled: true,

  // 시장별 진입 품질.
  // 60점 이상: 기존 기준 유지
  // 40~59점: 한 단계 강화
  // 0~39점: 최고 품질 후보만 매수
  waveMarketTierNormalMinScore: 65,
  waveMarketTierNormalMinFoundation: 35,
  waveMarketTierNormalMinRebound: 6,

  waveMarketTierCautionMinScore: 70,
  waveMarketTierCautionMinFoundation: 38,
  waveMarketTierCautionMinRebound: 7,

  waveMarketTierWeakMinScore: 75,
  waveMarketTierWeakMinFoundation: 40,
  waveMarketTierWeakMinRebound: 8,

  // +4% 도달 시 절반 수익확정 후 나머지는 큰 파동을 추적한다.
  firstTakeProfitEnabled: true,
  firstTakeProfitRate: 4.0,
  firstTakeProfitRatio: 0.50,

  // 매도: 작은 흔들림은 허용하고 파동 종료를 잡는다.
  stopLossRate: -5.0,
  structureStopBufferRate: -1.5,
  // 장기 시간청산 전에도 손실·추세약화·MA5 이탈이 겹치면 다음 갭 위험을 줄인다.
  weakTrendSellEnabled: true,
  weakTrendSellMinTradingDays: 1,
  weakTrendSellMaxProfitRate: 0.0,
  weakTrendSellMaxTrendScore: 4,
  // v1.5.9: WAVE가 수익권에 들어온 뒤 다시 손실권으로 돌아가는 것을 줄인다.
  // +3%부터 최소수익 보호, +5%부터 고점 트레일링을 시작한다.
  protectStartProfitRate: 3.0,
  protectFloorProfitRate: 0.8,
  // 최고수익이 커질수록 최소 보존수익도 단계적으로 올린다.
  protectTier5StartProfitRate: 5.0,
  protectTier5FloorProfitRate: 2.0,
  protectTier7StartProfitRate: 7.0,
  protectTier7FloorProfitRate: 3.5,
  protectTier10StartProfitRate: 10.0,
  protectTier10FloorProfitRate: 5.5,
  protectTier15StartProfitRate: 15.0,
  protectTier15FloorProfitRate: 8.5,
  trailingStartProfitRate: 5.0,
  trailingStopRate: 2.0,
  strongTrailingStartProfitRate: 10.0,
  strongTrailingStopRate: 1.5,

  // 2거래일 이상 자금만 묶고 방향성이 없는 종목은 회수한다.
  stagnationSellEnabled: true,
  stagnationMinTradingDays: 2,
  stagnationMaxAbsProfitRate: 1.0,
  stagnationMaxProfitEverRate: 2.5,
  stagnationMaxTrendScore: 6,
  stagnationMaxMa5Rate: 0.5,

  maxHoldingTradingDays: 10,
  hardMaxHoldingTradingDays: 15,

  // 데이터 캐시. 키움 호출량을 줄이기 위해 종목별 데이터는 일정 시간 재사용한다.
  dailyCacheMs: 30 * 60 * 1000,
  flowCacheMs: 60 * 60 * 1000,
  newsCacheMs: 6 * 60 * 60 * 1000,
  newsMaxItems: 8,
  newsLookbackDays: 3
};

const dailyCache = new Map();
const flowCache = new Map();
const newsCache = new Map();

function nowText() {
  return new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
}

function todayKey() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
}

function todayYmd() {
  return todayKey().replace(/-/g, "");
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

function isKoreanWeekday() {
  const day = new Date().toLocaleDateString("en-US", {
    timeZone: "Asia/Seoul",
    weekday: "short"
  });
  return day !== "Sat" && day !== "Sun";
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value || 0)));
}

function sanitizeWaveHotVolumeRatio(value) {
  return clamp(toNumber(value), 0, Number(SETTINGS.hotVolumeRatioSanityMax || 5000));
}

function toNumber(value, fallback = 0) {
  const cleaned = String(value ?? "")
    .replace(/[+,%]/g, "")
    .replace(/,/g, "")
    .trim();
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeCode(value) {
  const match = String(value || "").match(/\d{6}/);
  return match ? match[0] : "";
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function writeJsonAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const temp = path.join(dir, `.${base}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(temp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(temp, filePath);
}


function getWaveMasterSnapshot() {
  const masterState = portfolioManager.loadMasterState();
  portfolioManager.ensureMasterState(masterState);

  return {
    masterState,
    ...portfolioManager.getStrategyAccountSnapshot(
      masterState,
      "WAVE"
    )
  };
}

function applyMasterAccountToWaveState(state) {
  const snapshot = getWaveMasterSnapshot();

  state.accountMode = "MASTER_SHARED";
  state.initialCapital = snapshot.initialCapital;
  state.totalCash = snapshot.totalCash;
  state.holdings = snapshot.holdings;
  state.tradeLogs = snapshot.tradeLogs;
  state.masterTotalAsset = snapshot.totalAsset;
  state.masterStrategyExposure = snapshot.strategyExposure;

  return state;
}

function persistWaveHoldingMarksToMaster(state) {
  if (!Array.isArray(state?.holdings)) {
    return {
      ok: true,
      updated: 0
    };
  }

  return portfolioManager.updateStrategyHoldingMarks(
    "WAVE",
    state.holdings
  );
}

function makeWaveLocalStateForSave(state) {
  const localState = JSON.parse(
    JSON.stringify(state || {})
  );

  localState.accountMode = "MASTER_SHARED";

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
    version: 2,
    strategy: "WAVE",
    strategyVersion: STRATEGY_VERSION,
    createdAt: nowText(),
    updatedAt: nowText(),
    initialCapital: SETTINGS.initialCapital,
    totalCash: SETTINGS.initialCapital,
    watchlist: [],
    holdings: [],
    tradeLogs: [],
    dailyStats: {},
    evaluationCursor: 0,
    preEvaluation: {
      afterCloseDate: null,
      afterCloseAt: null,
      afterCloseRetryCount: 0,
      morningDate: null,
      morningAt: null,
      morningRetryCount: 0,
      analysisRuleVersion: ANALYSIS_RULE_VERSION,
      ruleRefreshPending: false,
      ruleRefreshReason: null
    },
    lastRunAt: null,
    lastRunAtMs: 0,
    lastRunSummary: null
  };
}

function loadState() {
  if (!fs.existsSync(STATE_FILE)) {
    const state = createInitialState();
    applyMasterAccountToWaveState(state);
    saveState(state);
    return state;
  }

  try {
    const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    if (!Array.isArray(state.watchlist)) state.watchlist = [];

    // 구버전 상태파일에 남아 있는 비정상 HOT 거래량비율도 로드 즉시 정리한다.
    // 점수 로직은 200% 이상에서 이미 상한이지만, 상태/진단값 자체도 정상 범위로 맞춘다.
    for (const candidate of state.watchlist) {
      candidate.hotVolumeRatio = sanitizeWaveHotVolumeRatio(candidate.hotVolumeRatio);
    }

    // 예전 WAVE 독립계좌 값은 무시하고 MASTER 값을 사용한다.
    applyMasterAccountToWaveState(state);
    if (!state.dailyStats || typeof state.dailyStats !== "object") state.dailyStats = {};
    if (!Number.isFinite(Number(state.evaluationCursor))) state.evaluationCursor = 0;
    if (!state.preEvaluation || typeof state.preEvaluation !== "object") {
      state.preEvaluation = {
        afterCloseDate: null,
        afterCloseAt: null,
        afterCloseRetryCount: 0,
        morningDate: null,
        morningAt: null,
        morningRetryCount: 0,
        analysisRuleVersion: null
      };
    }
    if (!Number.isFinite(Number(state.preEvaluation.afterCloseRetryCount))) {
      state.preEvaluation.afterCloseRetryCount = 0;
    }
    if (!Number.isFinite(Number(state.preEvaluation.morningRetryCount))) {
      state.preEvaluation.morningRetryCount = 0;
    }

    // 점수/READY 규칙이 바뀐 버전을 배포했는데 같은 날 이미 사전평가가 끝난 상태라면,
    // 날짜만 보고 재평가를 건너뛰면 기존 READY 상태가 그대로 남을 수 있다.
    // 분석규칙 버전이 달라지면 장마감/장전 사전평가 완료표시를 무효화하여
    // 기존 WATCH/READY/TRIGGER 후보 전체를 새 규칙으로 반드시 한 번 다시 계산한다.
    if (state.preEvaluation.analysisRuleVersion !== ANALYSIS_RULE_VERSION) {
      state.preEvaluation.afterCloseDate = null;
      state.preEvaluation.afterCloseAt = null;
      state.preEvaluation.morningDate = null;
      state.preEvaluation.morningAt = null;
      state.preEvaluation.afterCloseRetryCount = 0;
      state.preEvaluation.morningRetryCount = 0;
      state.preEvaluation.analysisRuleVersion = ANALYSIS_RULE_VERSION;
      state.preEvaluation.ruleRefreshPending = true;
      state.preEvaluation.ruleRefreshReason = `분석규칙 변경 → ${ANALYSIS_RULE_VERSION}`;

      // 진입규칙이 바뀌었으면 기존 TRIGGER 확인시간을 새 규칙으로 이어받지 않는다.
      // 장전/장후뿐 아니라 LIVE TRIGGER도 READY로 되돌려, 배포 이후 장중에서
      // 1차 TRIGGER → 다음 평가 재확인(최소 4분)을 새 규칙으로 다시 거치게 한다.
      for (const candidate of state.watchlist) {
        if (candidate.status !== "TRIGGER") continue;
        candidate.preSignalStatus = "TRIGGER";
        candidate.preSignalMode = candidate.lastEvaluationMode || "RULE_MIGRATION";
        candidate.preSignalAt = candidate.lastEvaluatedAt || nowText();
        candidate.preSignalAtMs = toNumber(candidate.lastEvaluatedAtMs || Date.now());
        candidate.preSignalPrice = toNumber(candidate.lastPrice || candidate.triggerPrice);
        candidate.preSignalScore = toNumber(candidate.lastAnalysis?.totalScore || candidate.triggerScore);
        candidate.status = candidate.lastAnalysis?.readyEligible === false ? "WATCH" : "READY";
        if (candidate.lastAnalysis) {
          candidate.lastAnalysis.preSignalStatus = "TRIGGER";
          candidate.lastAnalysis.preSignalBuyEligible = candidate.lastAnalysis.buyEligible === true;
          candidate.lastAnalysis.preSignalReason = candidate.lastAnalysis.buyReason || null;
          candidate.lastAnalysis.triggerConfirmed = false;
          candidate.lastAnalysis.triggerAgeMs = 0;
          candidate.lastAnalysis.triggerPrice = 0;
          candidate.lastAnalysis.triggerPriceHoldRate = 0;
          candidate.lastAnalysis.buyEligible = false;
          candidate.lastAnalysis.buyReason = null;
        }
        clearLiveTrigger(candidate);
      }
    }

    // 상태표시는 실제 보호 규칙 시작값(+5%)과 맞춘다. 구버전 상태파일의 보유종목도
    // 다음 가격조회 전부터 PROTECT 여부가 일관되게 보이도록 저장된 최고가를 이용한다.
    for (const holding of state.holdings) {
      const buyPrice = toNumber(holding.buyPrice);
      const storedMaxProfitRate = buyPrice > 0
        ? Math.max(
          toNumber(holding.maxProfitRate),
          ((toNumber(holding.highestPrice || holding.currentPrice) - buyPrice) / buyPrice) * 100
        )
        : toNumber(holding.maxProfitRate);
      if (storedMaxProfitRate >= SETTINGS.protectStartProfitRate) {
        holding.protectActive = true;
        if (!holding.protectActivatedAt) holding.protectActivatedAt = holding.lastCheckedAt || nowText();
        const candidate = state.watchlist.find(item => item.code === holding.code);
        if (candidate && candidate.status === "HOLD") candidate.status = "PROTECT";
      }
      if (storedMaxProfitRate >= SETTINGS.trailingStartProfitRate) {
        holding.trailingActive = true;
        if (!holding.trailingActivatedAt) holding.trailingActivatedAt = holding.lastCheckedAt || nowText();
      }
    }

    state.version = 2;
    state.strategyVersion = STRATEGY_VERSION;
    return state;
  } catch (err) {
    console.error("[WAVE 상태파일 읽기 오류]", err.message);
    const fallbackState = createInitialState();
    applyMasterAccountToWaveState(fallbackState);
    fallbackState.localStateReadError = err.message;
    fallbackState.localStateReadErrorAt = nowText();
    return fallbackState;
  }
}

function clearLiveTrigger(candidate) {
  candidate.triggerAt = null;
  candidate.triggerAtMs = 0;
  candidate.triggerPrice = 0;
  candidate.triggerScore = 0;
  candidate.triggerDate = null;
}

function saveState(state) {
  state.updatedAt = nowText();
  state.updatedAtMs = Date.now();

  persistWaveHoldingMarksToMaster(state);

  writeJsonAtomic(
    STATE_FILE,
    makeWaveLocalStateForSave(state)
  );
}

function calculatePortfolioSnapshot(state) {
  const snapshot = getWaveMasterSnapshot();

  const waveHoldings = Array.isArray(state?.holdings)
    ? state.holdings
    : snapshot.holdings;

  const invested = waveHoldings.reduce(
    (sum, item) =>
      sum +
      toNumber(item.currentPrice || item.buyPrice) *
      toNumber(item.qty),
    0
  );

  const unrealizedProfit = waveHoldings.reduce(
    (sum, item) =>
      sum +
      (
        toNumber(item.currentPrice || item.buyPrice) -
        toNumber(item.buyPrice)
      ) *
      toNumber(item.qty),
    0
  );

  return {
    totalCash: toNumber(snapshot.masterState.totalCash),
    invested,
    strategyInvested: invested,
    equity: portfolioManager.getEquity(snapshot.masterState),
    masterEquity: portfolioManager.getEquity(snapshot.masterState),
    unrealizedProfit
  };
}

function ensureDailyStats(state) {
  const date = todayKey();
  if (!state.dailyStats[date]) {
    const opening = calculatePortfolioSnapshot(state);
    state.dailyStats[date] = {
      date,
      discovered: 0,
      evaluated: 0,
      ready: 0,
      trigger: 0,
      bought: 0,
      sold: 0,
      realizedProfit: 0,
      startEquity: opening.equity,
      startCash: opening.totalCash,
      startInvested: opening.invested,
      startUnrealizedProfit: opening.unrealizedProfit,
      startSnapshotAt: nowText(),
      startSnapshotBasis: "DAY_FIRST_RUN"
    };
  } else if (
    state.dailyStats[date].startEquity === undefined ||
    state.dailyStats[date].startEquity === null ||
    !Number.isFinite(Number(state.dailyStats[date].startEquity))
  ) {
    // 구버전 당일 통계에는 장 시작자산이 없다. 배포 뒤 첫 스냅샷부터 손익을 추적하되,
    // 이를 진짜 장 시작값으로 오인하지 않도록 기준 종류를 함께 남긴다.
    const opening = calculatePortfolioSnapshot(state);
    Object.assign(state.dailyStats[date], {
      startEquity: opening.equity,
      startCash: opening.totalCash,
      startInvested: opening.invested,
      startUnrealizedProfit: opening.unrealizedProfit,
      startSnapshotAt: nowText(),
      startSnapshotBasis: "MIGRATED_CURRENT_SNAPSHOT"
    });
  }
  return state.dailyStats[date];
}

function loadJson(filePath, fallback = {}) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_) {
    return fallback;
  }
}

function inferSectorKey(text = "") {
  const value = String(text || "").toLowerCase().trim();
  const tokens = value.split(/[\s,;/|()[\]{}]+/).filter(Boolean);
  for (const key of ["semiconductor", "ai", "growth", "energy", "defensive"]) {
    if (tokens.includes(key)) return key;
  }
  if (/반도체|hbm|메모리|파운드리|웨이퍼|pcb|후공정|패키징|칩|semiconductor/.test(value)) return "semiconductor";
  if (/ai|인공지능|로봇|데이터센터|클라우드|소프트웨어|자율주행|스마트팩토리/.test(value)) return "ai";
  if (/2차전지|배터리|양극재|바이오|게임|인터넷|플랫폼|성장주|전기차/.test(value)) return "growth";
  if (/원전|정유|유가|석유|가스|에너지|태양광|풍력|전력기기/.test(value)) return "energy";
  if (/은행|보험|통신|유틸리티|필수소비재|방어주/.test(value)) return "defensive";
  return null;
}

function makeCandidateBase({ code, name, source, snapshot = {}, priority = {} }) {
  const normalizedCode = normalizeCode(code);
  const sectorText = [
    snapshot.sector,
    snapshot.sectorKey,
    snapshot.industry,
    snapshot.theme,
    priority.sector,
    priority.reason
  ].filter(Boolean).join(" ");

  return {
    code: normalizedCode,
    name: name || normalizedCode,
    status: "DISCOVERED",
    source: source || "HOT",
    sources: [source || "HOT"],
    discoveredDate: todayKey(),
    discoveredAt: nowText(),
    discoveredAtMs: Date.now(),
    discoveryPrice: toNumber(snapshot.currentPrice || snapshot.price || 0),
    peakPrice: toNumber(snapshot.currentPrice || snapshot.price || 0),
    pullbackLowPrice: toNumber(snapshot.currentPrice || snapshot.price || 0),
    lastPrice: toNumber(snapshot.currentPrice || snapshot.price || 0),
    hotScore: toNumber(snapshot.hotScore || snapshot.maxHotScore || 0),
    hotDetectionCount: toNumber(snapshot.detectionCount || snapshot.episodeDetectionCount || 0),
    hotMaxChangeRate: toNumber(snapshot.maxChangeRate || snapshot.changeRate || 0),
    hotVolumeRatio: sanitizeWaveHotVolumeRatio(
      snapshot.maxTradeVolumeRatio || snapshot.tradeVolumeRatio || 0
    ),
    hotMomentumScore: toNumber(snapshot.maxMomentumScore || snapshot.openMomentumScore || 0),
    sectorPeerCount: toNumber(snapshot.sectorPeerCount || 0),
    sectorPowerScore: toNumber(snapshot.sectorPowerScore || 0),
    sector: snapshot.sector || snapshot.sectorKey || priority.sector || null,
    sectorKey: inferSectorKey(sectorText),
    priorityScore: toNumber(priority.priorityScore || 0),
    priorityReason: priority.reason || null,
    representativeNews: priority.representativeNews || null,
    lastEvaluatedAt: null,
    lastEvaluatedAtMs: 0,
    lastAnalysis: null,
    readyAt: null,
    boughtAt: null,
    soldAt: null,
    dropReason: null
  };
}

function upsertCandidate(state, incoming) {
  if (!incoming?.code) return false;
  const existing = state.watchlist.find(item => item.code === incoming.code);

  if (!existing) {
    state.watchlist.push(incoming);
    ensureDailyStats(state).discovered += 1;
    console.log(`[WAVE 발견] ${incoming.name}(${incoming.code}) / ${incoming.source}`);
    return true;
  }

  const sources = new Set([...(existing.sources || []), ...(incoming.sources || []), incoming.source].filter(Boolean));
  existing.sources = Array.from(sources);
  existing.hotScore = Math.max(toNumber(existing.hotScore), toNumber(incoming.hotScore));
  existing.hotDetectionCount = Math.max(toNumber(existing.hotDetectionCount), toNumber(incoming.hotDetectionCount));
  existing.hotMaxChangeRate = Math.max(toNumber(existing.hotMaxChangeRate), toNumber(incoming.hotMaxChangeRate));
  existing.hotVolumeRatio = sanitizeWaveHotVolumeRatio(Math.max(
    toNumber(existing.hotVolumeRatio),
    toNumber(incoming.hotVolumeRatio)
  ));
  existing.hotMomentumScore = Math.max(toNumber(existing.hotMomentumScore), toNumber(incoming.hotMomentumScore));
  existing.sectorPeerCount = Math.max(toNumber(existing.sectorPeerCount), toNumber(incoming.sectorPeerCount));
  existing.sectorPowerScore = Math.max(toNumber(existing.sectorPowerScore), toNumber(incoming.sectorPowerScore));
  existing.priorityScore = Math.max(toNumber(existing.priorityScore), toNumber(incoming.priorityScore));
  existing.priorityReason = incoming.priorityReason || existing.priorityReason || null;
  existing.representativeNews = incoming.representativeNews || existing.representativeNews || null;
  existing.sector = incoming.sector || existing.sector || null;
  existing.sectorKey = incoming.sectorKey || existing.sectorKey || null;
  if (!existing.discoveryPrice && incoming.discoveryPrice) existing.discoveryPrice = incoming.discoveryPrice;

  // 활성후보 상한 때문에 밀린 후보는 같은 날 반복 재등록하지 않는다.
  // 다음 거래일 새 자료가 들어오면 WATCH로 한 번 복귀시켜 다시 우선순위를 비교한다.
  if (
    existing.status === "DROPPED" &&
    String(existing.dropReason || "").startsWith(WATCH_CAP_DROP_REASON) &&
    existing.dropDate !== todayKey()
  ) {
    existing.status = "WATCH";
    existing.dropReason = null;
    existing.dropDate = null;
    existing.droppedAt = null;
    existing.droppedAtMs = 0;
    existing.reactivatedAt = nowText();
    existing.reactivatedDate = todayKey();
  }
  if (!["HOLD", "PROTECT", "SOLD", "DROPPED"].includes(existing.status)) {
    if (existing.status === "DISCOVERED") existing.status = "WATCH";
  }
  return false;
}

function ingestHotCandidates(state) {
  const history = loadJson(HOT_HISTORY_FILE, {});
  if (history.date !== todayKey() || !history.detected || typeof history.detected !== "object") return 0;

  const rows = Object.values(history.detected)
    .map(record => {
      const latest = record.latestSnapshot || {};
      return {
        record,
        latest,
        score: Math.max(toNumber(record.maxHotScore), toNumber(latest.hotScore)),
        changeRate: Math.max(toNumber(record.maxChangeRate), toNumber(latest.changeRate)),
        detectionCount: Math.max(toNumber(record.detectionCount), toNumber(record.episodeDetectionCount)),
        lastDetectedAtMs: toNumber(record.lastDetectedAtMs)
      };
    })
    .filter(row => {
      return row.score >= SETTINGS.hotMinScore &&
        row.changeRate >= SETTINGS.hotMinChangeRate &&
        row.changeRate <= SETTINGS.hotMaxChangeRate &&
        row.detectionCount >= SETTINGS.hotMinDetectionCount;
    })
    .sort((a, b) => b.score - a.score || b.lastDetectedAtMs - a.lastDetectedAtMs)
    .slice(0, SETTINGS.hotIngestMaxCount);

  let added = 0;
  for (const row of rows) {
    const record = row.record;
    const latest = row.latest;
    const candidate = makeCandidateBase({
      code: record.code || latest.code,
      name: record.name || latest.name,
      source: "HOT",
      snapshot: {
        ...latest,
        maxHotScore: record.maxHotScore,
        maxChangeRate: record.maxChangeRate,
        maxTradeVolumeRatio: record.maxTradeVolumeRatio,
        maxMomentumScore: record.maxMomentumScore,
        detectionCount: record.detectionCount,
        episodeDetectionCount: record.episodeDetectionCount
      }
    });
    if (upsertCandidate(state, candidate)) added++;
  }
  return added;
}

function ingestMarketPriorityCandidates(state) {
  const market = loadJson(OPEN_MARKET_FILE, {});
  // 자정 이후 전일 open-market.json을 새 후보로 오인하지 않는다.
  if (String(market.date || "") !== todayKey()) return 0;
  const priorityStocks = Array.isArray(market.priorityStocks) ? market.priorityStocks : [];
  let added = 0;

  for (const row of priorityStocks.slice(0, SETTINGS.marketPriorityIngestMaxCount)) {
    if (toNumber(row.priorityScore) <= 0) continue;
    const candidate = makeCandidateBase({
      code: row.code,
      name: row.name,
      source: "MARKET_PRIORITY",
      priority: row
    });
    if (upsertCandidate(state, candidate)) added++;
  }
  return added;
}

async function fetchJson(url, timeout = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; }
    catch (_) { data = { rawText: text }; }
    if (!response.ok) {
      throw new Error(data.message || data.error || `HTTP ${response.status}`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function validateWavePriceData(data = {}, maxQuoteAgeMs = 0, label = "WAVE") {
  const currentPrice = toNumber(data.currentPrice);
  if (currentPrice <= 0) throw new Error(`${label} 현재가 없음`);

  const observedAtMs = toNumber(data.quoteObservedAtMs || data.cachedAtMs);
  const quoteAgeMs = observedAtMs > 0 ? Math.max(0, Date.now() - observedAtMs) : 0;
  data.waveQuoteAgeMs = quoteAgeMs;

  if (maxQuoteAgeMs > 0 && observedAtMs > 0 && quoteAgeMs > maxQuoteAgeMs) {
    throw new Error(
      `${label} 시세 오래됨 ${Math.round(quoteAgeMs / 1000)}초 / ` +
      `허용 ${Math.round(maxQuoteAgeMs / 1000)}초`
    );
  }
  return data;
}

async function getPrice(code, timeout = 12000, source = "wave", maxQuoteAgeMs = SETTINGS.candidateMaxQuoteAgeMs) {
  const normalizedSource = String(source || "wave").toLowerCase();
  const data = await fetchJson(
    `${API_BASE}/api/price?code=${encodeURIComponent(code)}&source=${encodeURIComponent(normalizedSource)}`,
    timeout
  );
  return validateWavePriceData(data, maxQuoteAgeMs, normalizedSource === "sell" ? "WAVE 보유" : "WAVE 후보");
}

async function getHoldingPriceWithRetry(code) {
  let lastError = null;
  const attempts = Math.max(1, SETTINGS.holdingPriceRetryCount + 1);

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await getPrice(
        code,
        SETTINGS.holdingPriceTimeoutMs,
        "sell",
        SETTINGS.holdingMaxQuoteAgeMs
      );
    } catch (err) {
      lastError = err;
      if (attempt < attempts) await sleep(SETTINGS.holdingPriceRetryDelayMs);
    }
  }

  throw lastError || new Error("보유 현재가 조회 실패");
}

async function getDaily(code) {
  const cached = dailyCache.get(code);
  if (cached && Date.now() - cached.atMs <= SETTINGS.dailyCacheMs) return cached.data;
  const data = await fetchJson(`${API_BASE}/api/daily?code=${encodeURIComponent(code)}&days=35`, 15000);
  dailyCache.set(code, { atMs: Date.now(), data });
  return data;
}

async function getInvestorFlow(code) {
  const cached = flowCache.get(code);
  if (cached && Date.now() - cached.atMs <= SETTINGS.flowCacheMs) return cached.data;
  try {
    const data = await fetchJson(`${API_BASE}/api/wave-investor-flow?code=${encodeURIComponent(code)}&days=5`, 15000);
    flowCache.set(code, { atMs: Date.now(), data });
    return data;
  } catch (err) {
    const data = { ok: false, error: err.message, rows: [] };
    flowCache.set(code, { atMs: Date.now(), data });
    return data;
  }
}

function decodeXmlText(value = "") {
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchStockNews(name) {
  const key = String(name || "").trim();
  const cached = newsCache.get(key);
  if (cached && Date.now() - cached.atMs <= SETTINGS.newsCacheMs) return cached.data;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const params = new URLSearchParams({
      q: `"${key}" 주식 when:${SETTINGS.newsLookbackDays}d`,
      hl: "ko",
      gl: "KR",
      ceid: "KR:ko"
    });
    const response = await fetch(`https://news.google.com/rss/search?${params.toString()}`, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "application/rss+xml,text/xml"
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const xml = await response.text();
    const items = [...String(xml || "").matchAll(/<item>([\s\S]*?)<\/item>/g)]
      .slice(0, SETTINGS.newsMaxItems)
      .map(match => {
        const block = match[1];
        return {
          title: decodeXmlText(block.match(/<title>([\s\S]*?)<\/title>/)?.[1] || ""),
          link: decodeXmlText(block.match(/<link>([\s\S]*?)<\/link>/)?.[1] || ""),
          pubDate: decodeXmlText(block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] || "")
        };
      })
      .filter(item => item.title);

    newsCache.set(key, { atMs: Date.now(), data: items });
    return items;
  } catch (err) {
    console.log(`[WAVE 뉴스 조회실패] ${key} / ${err.message}`);
    const items = [];
    newsCache.set(key, { atMs: Date.now(), data: items });
    return items;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeNewsMatchText(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/(?:주식회사|㈜|\(주\))/g, "")
    .replace(/[^0-9a-z가-힣]/g, "");
}

function headlineMentionsCandidate(title = "", candidateName = "") {
  const normalizedTitle = normalizeNewsMatchText(title);
  const normalizedName = normalizeNewsMatchText(candidateName);
  if (normalizedName.length < 2) return false;
  return normalizedTitle.includes(normalizedName);
}

function scoreWhy(candidate, newsItems = []) {
  // WAVE WHY는 단순 긍정 단어보다 "확정된 사실"을 우선한다.
  // 기대/전망/목표가/방송형 제목만으로 S급이 되는 것을 막는다.
  const hardEvent = /공급계약|수주|계약 체결|흑자전환|사상 최대|최대 실적|영업이익|매출|증설|공장 구축|신규 팹|양산|승인|허가|대형 고객|납품|생산능력 확대|신규 사업|투입|투자해|투자하여|투자한다/i;
  const quantified = /\d[\d,.]*\s*(?:억|억원|조|조원|%|배|만주|억원대)/i;
  const expectation = /기대|전망|예상|목표가|주목|가능성|관심|수혜 기대|D-?\s*\d|발표 D-?\s*\d|될 것|전망된다/i;
  const commentary = /급등수사본부|특징주|장중수급포착|마감시황|주식마감|대응전략|초고수|옥석 가리기|밀릴때마다|추천|주목해야/i;
  const normalPositive = /호재|성장|회복|개선|확대|협력|투자|개발|진출|상용화|수혜|강세|반등|회복세/i;
  const severeNegative = /횡령|배임|거래정지|상장폐지|감사의견|부도|회생절차|유상증자|전환사채|CB 발행|리콜|영업정지/i;
  const normalNegative = /적자|실적 부진|감소|악재|규제|급락|우려|하향|축소|중단/i;

  // Google 검색은 따옴표 검색이어도 다른 종목 제목이 섞일 수 있다.
  // 장전 우선종목 대표뉴스는 이미 종목 연결이 검증된 자료로 보고 유지하되,
  // 일반 Google 뉴스는 제목에 후보명이 실제로 들어간 경우만 WHY 계산에 쓴다.
  const matchedNewsItems = newsItems.filter(item =>
    headlineMentionsCandidate(item?.title, candidate.name)
  );
  const titles = [
    ...(candidate.representativeNews ? [{ title: candidate.representativeNews, source: "PRIORITY" }] : []),
    ...matchedNewsItems.map(item => ({ ...item, source: "GOOGLE" }))
  ];

  let score = 0;
  let confirmedCount = 0;
  let quantifiedCount = 0;
  let expectationCount = 0;
  let commentaryCount = 0;
  let positiveCount = 0;
  let severeNegativeCount = 0;
  let negativeCount = 0;

  for (const item of titles) {
    const title = String(item.title || "");
    const hasExpectation = expectation.test(title);
    const hasCommentary = commentary.test(title);
    const hasHardEvent = hardEvent.test(title);
    const hasQuantifiedFact = hasHardEvent && quantified.test(title) && !hasExpectation;
    const hasConfirmedFact = hasHardEvent && !hasExpectation && !hasCommentary;

    if (hasQuantifiedFact) {
      score += quantifiedCount === 0 ? 22 : 3;
      quantifiedCount++;
      confirmedCount++;
    } else if (hasConfirmedFact) {
      score += confirmedCount === 0 ? 18 : 3;
      confirmedCount++;
    } else if (hasExpectation && (hasHardEvent || normalPositive.test(title))) {
      // 기대/전망성 기사는 보조 재료로만 사용한다.
      score += expectationCount === 0 ? 4 : 1;
      expectationCount++;
    } else if (normalPositive.test(title)) {
      score += positiveCount === 0 ? 6 : 1;
      positiveCount++;
    }

    if (hasCommentary) commentaryCount++;

    if (severeNegative.test(title)) {
      score -= 15;
      severeNegativeCount++;
    } else if (normalNegative.test(title)) {
      score -= 4;
      negativeCount++;
    }
  }

  // 장전 우선종목 점수는 보조신호다. 재료의 확정성을 대신하지 못한다.
  if (toNumber(candidate.priorityScore) >= 20) score += 3;
  else if (toNumber(candidate.priorityScore) >= 10) score += 1;

  // HOT만으로는 재료 점수를 높이지 않는다.
  if (!titles.length && (candidate.sources || []).includes("HOT")) score = Math.max(score, 3);

  // 확정재료가 하나도 없으면 기대/전망/시장코멘트만으로 A/S급이 되지 않게 상한을 둔다.
  if (confirmedCount === 0) score = Math.min(score, 17);

  score = clamp(score, 0, 30);
  const grade = confirmedCount > 0 && score >= 25
    ? "S"
    : score >= 18
      ? "A"
      : score >= 8
        ? "B"
        : "C";

  const certainty = confirmedCount > 0
    ? (quantifiedCount > 0 ? "CONFIRMED_QUANT" : "CONFIRMED")
    : (expectationCount > 0 ? "EXPECTATION" : "WEAK");

  return {
    score,
    grade,
    certainty,
    confirmedCount,
    quantifiedCount,
    expectationCount,
    commentaryCount,
    positiveCount,
    severeNegativeCount,
    negativeCount,
    newsCount: titles.length,
    unmatchedNewsCount: Math.max(0, newsItems.length - matchedNewsItems.length),
    headlines: titles.slice(0, 5).map(item => item.title)
  };
}

function scoreMoney(candidate, flowData = {}, dailyItems = [], priceData = {}) {
  const rows = Array.isArray(flowData.rows) ? flowData.rows.slice(-5) : [];
  const foreignSum = rows.reduce((sum, row) => sum + toNumber(row.foreignNetBuy), 0);
  const institutionSum = rows.reduce((sum, row) => sum + toNumber(row.institutionNetBuy), 0);
  const foreignPositiveDays = rows.filter(row => toNumber(row.foreignNetBuy) > 0).length;
  const institutionPositiveDays = rows.filter(row => toNumber(row.institutionNetBuy) > 0).length;

  // ka10060 acc_trde_prica가 일부 종목에서 누적거래량과 같은 숫자로 들어오는 사례가 있었다.
  // 현재가 API의 누적거래량 × 현재가로 백만원 단위 거래대금을 교차검증하고,
  // 명백한 단위/필드 오류일 때만 추정값으로 보정한다. 정상값은 그대로 유지한다.
  const reportedTradeValueMillion = rows.length
    ? toNumber(rows[rows.length - 1].tradingValueMillion)
    : 0;
  const currentPriceForTradeValue = toNumber(
    priceData.currentPrice || candidate.lastPrice || candidate.discoveryPrice
  );
  const currentVolumeForTradeValue = toNumber(priceData.volume);
  const estimatedTradeValueMillion =
    currentPriceForTradeValue > 0 && currentVolumeForTradeValue > 0
      ? (currentPriceForTradeValue * currentVolumeForTradeValue) / 1000000
      : 0;

  const sameAsVolume =
    reportedTradeValueMillion > 0 &&
    currentVolumeForTradeValue > 0 &&
    Math.abs(reportedTradeValueMillion - currentVolumeForTradeValue) / currentVolumeForTradeValue <= 0.01;
  const implausibleVsEstimate =
    reportedTradeValueMillion > 0 &&
    estimatedTradeValueMillion > 0 &&
    (reportedTradeValueMillion > estimatedTradeValueMillion * 5 ||
      reportedTradeValueMillion < estimatedTradeValueMillion / 5);
  const tradeValueCorrected =
    estimatedTradeValueMillion > 0 && (sameAsVolume || implausibleVsEstimate);
  const latestTradeValue = tradeValueCorrected
    ? estimatedTradeValueMillion
    : reportedTradeValueMillion;

  let foreignScore = 0;
  if (foreignSum > 0) foreignScore += 2;
  if (foreignPositiveDays >= 3) foreignScore += 2;
  if (foreignSum >= 5000) foreignScore += 1; // 백만원 단위: 50억원
  foreignScore = clamp(foreignScore, 0, 5);

  let institutionScore = 0;
  if (institutionSum > 0) institutionScore += 2;
  if (institutionPositiveDays >= 3) institutionScore += 2;
  if (institutionSum >= 5000) institutionScore += 1;
  institutionScore = clamp(institutionScore, 0, 5);

  let liquidityScore = 0;
  if (latestTradeValue >= 30000) liquidityScore = 5;      // 300억원+
  else if (latestTradeValue >= 15000) liquidityScore = 4;
  else if (latestTradeValue >= 5000) liquidityScore = 3;
  else if (latestTradeValue >= 1000) liquidityScore = 2;
  else if (latestTradeValue > 0) liquidityScore = 1;

  let persistenceScore = 0;
  if (toNumber(candidate.hotDetectionCount) >= 10) persistenceScore += 2;
  else if (toNumber(candidate.hotDetectionCount) >= 4) persistenceScore += 1;
  if (toNumber(candidate.hotVolumeRatio) >= 200) persistenceScore += 2;
  else if (toNumber(candidate.hotVolumeRatio) >= 120) persistenceScore += 1;
  if (toNumber(candidate.hotMomentumScore) >= 50) persistenceScore += 1;
  persistenceScore = clamp(persistenceScore, 0, 5);

  // 투자자 API가 없는 경우 외국인/기관 점수는 0점 그대로 두고 데이터 부족을 명시한다.
  const score = clamp(foreignScore + institutionScore + liquidityScore + persistenceScore, 0, 20);

  return {
    score,
    foreignScore,
    institutionScore,
    liquidityScore,
    persistenceScore,
    foreignSum,
    institutionSum,
    foreignPositiveDays,
    institutionPositiveDays,
    latestTradeValueMillion: latestTradeValue,
    reportedTradeValueMillion,
    estimatedTradeValueMillion,
    tradeValueCorrected,
    tradeValueCorrectionReason: tradeValueCorrected
      ? (sameAsVolume ? "누적거래대금이 누적거래량과 동일" : "현재가×누적거래량 대비 5배 이상 괴리")
      : null,
    flowAvailable: rows.length > 0
  };
}

function scoreSector(candidate, marketData = {}, newsItems = []) {
  const matchedSectorNewsItems = newsItems.filter(item =>
    headlineMentionsCandidate(item?.title, candidate.name)
  );
  const sectorEvidenceText = [
    candidate.sectorKey,
    candidate.sector,
    candidate.priorityReason,
    candidate.representativeNews,
    ...matchedSectorNewsItems.map(item => item?.title)
  ].filter(Boolean).join(" ");
  const key = candidate.sectorKey || inferSectorKey(sectorEvidenceText);
  const sectorBias = key ? toNumber(marketData.sectorBias?.[key]) : 0;
  const newsBias = key ? toNumber(marketData.sectorNewsScores?.[key]) : 0;

  let marketScore = 0;
  if (key) {
    if (sectorBias >= 10) marketScore = 8;
    else if (sectorBias >= 5) marketScore = 6;
    else if (sectorBias >= 0) marketScore = 4;
    else if (sectorBias > -5) marketScore = 2;
  }

  let newsScore = 0;
  if (key) {
    if (newsBias >= 4) newsScore = 4;
    else if (newsBias >= 1) newsScore = 3;
    else if (newsBias >= 0) newsScore = 2;
  }

  let breadthScore = 0;
  const sectorPower = toNumber(candidate.sectorPowerScore);
  const peerCount = toNumber(candidate.sectorPeerCount);
  if (sectorPower >= 4 || peerCount >= 5) breadthScore = 3;
  else if (sectorPower >= 2 || peerCount >= 3) breadthScore = 2;
  else if (toNumber(candidate.hotScore) >= 85 && toNumber(candidate.hotMomentumScore) >= 50) breadthScore = 1;

  return {
    score: clamp(marketScore + newsScore + breadthScore, 0, 15),
    sectorKey: key,
    classified: Boolean(key),
    sectorBias,
    newsBias,
    marketScore,
    newsScore,
    breadthScore,
    sectorPeerCount: peerCount,
    sectorPowerScore: sectorPower
  };
}

function avg(values = []) {
  const rows = values.map(Number).filter(Number.isFinite);
  return rows.length ? rows.reduce((sum, value) => sum + value, 0) / rows.length : 0;
}

function scoreTrend(dailyItems = [], currentPrice = 0) {
  const items = [...dailyItems].filter(item => toNumber(item.close) > 0);
  if (items.length < 20) {
    return { score: 0, ma5: 0, ma20: 0, reason: "일봉 20개 미만" };
  }

  const closes = items.map(item => toNumber(item.close));
  const lows = items.map(item => toNumber(item.low));
  const close = currentPrice || closes[closes.length - 1];
  const ma5 = avg(closes.slice(-5));
  const ma20 = avg(closes.slice(-20));
  const prevMa5 = avg(closes.slice(-6, -1));
  const prevMa20 = avg(closes.slice(-21, -1));

  const recentLow = Math.min(...lows.slice(-5));
  const previousLow = Math.min(...lows.slice(-10, -5));

  let score = 0;
  if (close >= ma5) score += 2;
  if (ma5 > ma20) score += 3;
  if (ma5 > prevMa5) score += 2;
  if (ma20 >= prevMa20) score += 1;
  if (recentLow >= previousLow) score += 2;

  return {
    score: clamp(score, 0, 10),
    ma5,
    ma20,
    prevMa5,
    prevMa20,
    recentLow,
    previousLow,
    close
  };
}

function findDiscoveryIndex(dailyItems = [], discoveredDate = todayKey()) {
  const target = String(discoveredDate || "").replace(/-/g, "");
  let index = dailyItems.findIndex(item => String(item.date || "").replace(/-/g, "") >= target);
  if (index < 0) index = Math.max(0, dailyItems.length - 5);
  return index;
}

function getCompletedDailyItems(dailyItems = []) {
  const items = [...dailyItems];
  if (!items.length) return items;

  const latestDate = String(items[items.length - 1]?.date || "").replace(/-/g, "");
  const today = todayYmd();
  const hhmm = getCurrentHHMM();
  const liveSession = isKoreanWeekday() && hhmm >= "09:00" && hhmm <= "15:30";

  // 장중이고 API 마지막 봉이 오늘 봉이면 미완성 거래량이므로 제외한다.
  // 장 마감 후와 다음날 장전에는 마지막 봉이 완성봉이므로 그대로 사용한다.
  if (liveSession && latestDate === today && items.length >= 2) {
    return items.slice(0, -1);
  }
  return items;
}

function scorePullback(candidate, dailyItems = [], currentPrice = 0, trend = {}) {
  if (!dailyItems.length || !currentPrice) {
    return { score: 0, pullbackRate: 0, peakPrice: 0, pullbackLowPrice: 0, volumeContraction: 0 };
  }

  const startIndex = findDiscoveryIndex(dailyItems, candidate.discoveredDate);
  const afterDiscovery = dailyItems.slice(startIndex);
  const peakPrice = Math.max(
    toNumber(candidate.peakPrice),
    ...afterDiscovery.map(item => toNumber(item.high)),
    currentPrice
  );
  const pullbackLowPrice = Math.min(
    ...afterDiscovery.map(item => toNumber(item.low)).filter(value => value > 0),
    toNumber(candidate.pullbackLowPrice) || currentPrice,
    currentPrice
  );
  const pullbackRate = peakPrice > 0 ? ((currentPrice - peakPrice) / peakPrice) * 100 : 0;

  let priceScore = 0;
  if (pullbackRate <= -2 && pullbackRate >= -7) priceScore = 8;
  else if (pullbackRate < -1 && pullbackRate > -2) priceScore = 5;
  else if (pullbackRate < -7 && pullbackRate >= -9) priceScore = 4;
  else if (pullbackRate >= -1 && pullbackRate <= 1.5) priceScore = 2;

  // 장중에는 오늘 미완성봉을 제외하고, 장 마감 후/장전에는 최신 완료봉까지 사용한다.
  const completed = getCompletedDailyItems(dailyItems);
  const recent = completed.slice(-3);
  const recentVolume = recent.length ? avg(recent.map(item => toNumber(item.volume))) : 0;
  const peakVolume = completed.length ? Math.max(...completed.slice(-7).map(item => toNumber(item.volume))) : 0;
  const volumeContraction = peakVolume > 0 ? recentVolume / peakVolume : 1;

  let volumeScore = 0;
  if (volumeContraction >= 0.35 && volumeContraction <= 0.70) volumeScore = 4;
  else if (volumeContraction > 0.20 && volumeContraction < 0.85) volumeScore = 3;
  else if (volumeContraction <= 1.0) volumeScore = 1;

  let supportScore = 0;
  if (trend.ma20 > 0 && currentPrice >= trend.ma20) supportScore += 2;
  if (trend.ma5 > 0 && currentPrice >= trend.ma5 * 0.97) supportScore += 1;

  return {
    score: clamp(priceScore + volumeScore + supportScore, 0, 15),
    priceScore,
    volumeScore,
    supportScore,
    pullbackRate,
    peakPrice,
    pullbackLowPrice,
    volumeContraction
  };
}

function getLatestCompletedDayChangeRate(dailyItems = []) {
  const completed = getCompletedDailyItems(dailyItems);
  if (completed.length < 2) return 0;

  const latest = completed[completed.length - 1];
  const before = completed[completed.length - 2];
  const latestClose = toNumber(latest?.close);
  const beforeClose = toNumber(before?.close);
  if (latestClose <= 0 || beforeClose <= 0) return 0;

  return ((latestClose - beforeClose) / beforeClose) * 100;
}

function scoreRebound(priceData = {}, dailyItems = [], candidate = {}) {
  const current = toNumber(priceData.currentPrice);
  const open = toNumber(priceData.open);
  const high = toNumber(priceData.high);
  const low = toNumber(priceData.low);
  const volume = toNumber(priceData.volume);
  const changeRate = toNumber(priceData.changeRate);

  const completed = getCompletedDailyItems(dailyItems);
  const previous = completed.length ? completed[completed.length - 1] : null;
  const prevClose = toNumber(previous?.close);
  const prevHigh = toNumber(previous?.high);
  const prevVolume = toNumber(previous?.volume);

  const previousEvaluationPrice =
    toNumber(candidate.lastAnalysis?.currentPrice) ||
    toNumber(candidate.lastPrice) ||
    toNumber(candidate.discoveryPrice) ||
    0;

  const openRate = open > 0 ? ((current - open) / open) * 100 : 0;
  const sinceLastEvalRate = previousEvaluationPrice > 0
    ? ((current - previousEvaluationPrice) / previousEvaluationPrice) * 100
    : 0;
  const dayPosition = high > low && current > 0 ? ((current - low) / (high - low)) * 100 : 0;
  const recoveryFromLowRate = low > 0 ? ((current - low) / low) * 100 : 0;
  const highDrawdownRate = high > 0 ? ((current - high) / high) * 100 : 0;

  // 반등 구조와 첫 상승 신호를 분리한다. 첫 TRIGGER는 직전평가 대비 상승까지 필요하지만,
  // 다음 확인에서는 이 구조가 유지되면 횡보·미세조정을 허용한다.
  const reboundStructureIntact =
    open > 0 &&
    openRate >= -1.5 &&
    dayPosition >= 55 &&
    recoveryFromLowRate >= 1.0 &&
    highDrawdownRate >= -5.0;
  const trueRebound = reboundStructureIntact && sinceLastEvalRate >= 0.15;

  let score = 0;
  if (changeRate >= 1.0) score += 1;
  else if (changeRate > 0) score += 0.5;

  if (openRate >= 0) score += 2;
  else if (openRate >= -1.0) score += 1;

  if (sinceLastEvalRate >= 0.50) score += 2;
  else if (sinceLastEvalRate >= 0.15) score += 1;

  if (dayPosition >= 70) score += 2;
  else if (dayPosition >= 55) score += 1;

  if (recoveryFromLowRate >= 2.0) score += 1;
  if (highDrawdownRate >= -2.0) score += 1;
  if (prevHigh > 0 && current > prevHigh) score += 1;
  if (prevVolume > 0 && volume >= prevVolume * 0.60) score += 1;

  // 실제 반등 구조가 아니면 REBOUND가 6점 이상으로 올라가 TRIGGER가 되는 것을 원천 차단한다.
  if (!trueRebound) score = Math.min(score, 5);

  return {
    score: clamp(Math.round(score), 0, 10),
    changeRate,
    openRate,
    sinceLastEvalRate,
    dayPosition,
    recoveryFromLowRate,
    highDrawdownRate,
    reboundStructureIntact,
    trueRebound,
    current,
    open,
    high,
    low,
    previousEvaluationPrice,
    prevClose,
    prevHigh,
    volume,
    prevVolume
  };
}

function tradingDaysSince(dailyItems = [], dateText = todayKey()) {
  const target = String(dateText || "").replace(/-/g, "");
  const dates = Array.from(new Set(
    dailyItems
      .map(item => String(item.date || "").replace(/-/g, ""))
      .filter(Boolean)
  )).sort();

  let count = Math.max(0, dates.filter(date => date >= target).length - 1);

  // 09:00 직후 키움 일봉에 오늘 봉이 아직 생기지 않아도
  // 전 거래일에 발견한 후보가 0거래일로 남아 매수자격을 잃지 않게 한다.
  const today = todayYmd();
  const hhmm = getCurrentHHMM();
  const liveSession = isKoreanWeekday() && hhmm >= "09:00" && hhmm <= "15:30";
  const hasTodayBar = dates.includes(today);

  if (liveSession && target < today && !hasTodayBar) {
    count += 1;
  }

  return count;
}

async function analyzeCandidate(candidate, priceData, dailyData, flowData, newsItems, marketData) {
  const dailyItems = Array.isArray(dailyData?.items) ? dailyData.items : [];
  const currentPrice = toNumber(priceData.currentPrice);
  const why = scoreWhy(candidate, newsItems);
  const money = scoreMoney(candidate, flowData, dailyItems, priceData);
  const sector = scoreSector(candidate, marketData, newsItems);
  const trend = scoreTrend(dailyItems, currentPrice);
  const pullback = scorePullback(candidate, dailyItems, currentPrice, trend);
  const rebound = scoreRebound(priceData, dailyItems, candidate);

  const foundationScore = why.score + money.score + sector.score;
  const totalScore = foundationScore + trend.score + pullback.score + rebound.score;
  const ageTradingDays = tradingDaysSince(dailyItems, candidate.discoveredDate);
  const marketScore = toNumber(marketData.marketScore);
  const marketType = String(marketData.marketType || "");
  const weakMarketRiskLimited = marketScore > 0 && marketScore < SETTINGS.weakMarketScore;

  // 당일 급등은 "반등"이 아니라 1차 급등(IMPULSE)일 수 있다.
  // +10% 이상이면 READY를 막고 WATCH에서 눌림을 기다린다.
  const readyBlockedBySurge =
    rebound.changeRate >= SETTINGS.readyMaxCurrentDayChangeRate;

  // pullback.score는 거래량감소·지지점수까지 합산하므로 실제 가격 눌림이 거의 없어도
  // READY 기준을 넘을 수 있다. 현재가가 관찰구간 고점에 너무 가까우면 2차 파동 진입이
  // 아니라 전고점 추격이 되므로, 가격 자체의 최소 눌림 깊이를 별도로 확인한다.
  const currentPullbackDepthRate = Math.max(0, -toNumber(pullback.pullbackRate));
  const readyBlockedByShallowPullback =
    currentPullbackDepthRate < SETTINGS.readyMinPullbackDepthRate;

  const readyEligible =
    why.score >= SETTINGS.whyMinScore &&
    foundationScore >= SETTINGS.foundationMinScore &&
    pullback.score >= SETTINGS.pullbackMinScoreForReady &&
    !readyBlockedBySurge &&
    !readyBlockedByShallowPullback;

  const readyBlockReason = readyBlockedBySurge
    ? `당일 급등 ${rebound.changeRate >= 0 ? "+" : ""}${rebound.changeRate.toFixed(2)}% / ` +
      `READY 기준 +${SETTINGS.readyMaxCurrentDayChangeRate.toFixed(0)}% 이상·눌림 대기`
    : readyBlockedByShallowPullback
      ? `전고점 대비 실제 눌림 ${currentPullbackDepthRate.toFixed(2)}% / ` +
        `최소 ${SETTINGS.readyMinPullbackDepthRate.toFixed(2)}% 필요`
      : null;

  // V1.5.1: 전일 급등 쿨다운.
  // 전일 +10% 이상이면 다음 거래일 장 초반 즉시 재진입하지 않고,
  // +20% 이상이면 10시까지 가격구조를 더 확인한다.
  const previousDayChangeRate = getLatestCompletedDayChangeRate(dailyItems);
  const previousDaySurge = previousDayChangeRate >= SETTINGS.previousDaySurgeRate;
  const previousDayExtremeSurge = previousDayChangeRate >= SETTINGS.previousDayExtremeSurgeRate;
  const surgeCooldownEndTime = previousDayExtremeSurge
    ? SETTINGS.previousDayExtremeSurgeCooldownEndTime
    : SETTINGS.previousDaySurgeCooldownEndTime;
  const previousDaySurgeCooldownBlocked =
    previousDaySurge &&
    isKoreanWeekday() &&
    getCurrentHHMM() < surgeCooldownEndTime;

  const triggerBlockReason = previousDaySurgeCooldownBlocked
    ? `전일 급등 +${previousDayChangeRate.toFixed(2)}% / ${surgeCooldownEndTime}까지 가격구조 확인`
    : (!rebound.trueRebound
      ? `진짜 반등 미확인 / 시가대비 ${rebound.openRate.toFixed(2)}% / 직전평가대비 ${rebound.sinceLastEvalRate.toFixed(2)}% / 당일위치 ${rebound.dayPosition.toFixed(0)}%`
      : null);

  // TRIGGER는 READY 중 실제 반등·총점·추격방지 조건까지 모두 충족한 상태다.
  // V1.5.1부터는 시가 대비 계속 밀리는 종목은 REBOUND 점수가 높아도 TRIGGER가 될 수 없다.
  const triggerEligible =
    readyEligible &&
    totalScore >= SETTINGS.totalBuyMinScore &&
    rebound.score >= SETTINGS.reboundMinScoreForBuy &&
    rebound.trueRebound === true &&
    rebound.changeRate <= SETTINGS.currentDayMaxChangeRateForBuy &&
    pullback.pullbackRate >= -9.5 &&
    !previousDaySurgeCooldownBlocked;

  // V10: TRIGGER 재확인도 최초 진입과 같은 수준의 실제 반등을 다시 요구한다.
  // 단순히 구조만 버틴 채 횡보하는 종목(오늘 다스코·마키나락스 사례)이
  // 4~5분 경과만으로 매수되는 것을 막는다.
  const triggerMaintainEligible =
    readyEligible &&
    totalScore >= SETTINGS.totalBuyMinScore &&
    rebound.score >= SETTINGS.reboundMinScoreForBuy &&
    rebound.reboundStructureIntact === true &&
    rebound.trueRebound === true &&
    rebound.changeRate <= SETTINGS.currentDayMaxChangeRateForBuy &&
    pullback.pullbackRate >= -9.5 &&
    !previousDaySurgeCooldownBlocked;

  // buyEligible은 점수·관찰기간 기준만 뜻한다.
  // 실제 매수는 evaluateWatchCandidates에서 TRIGGER가 다음 평가까지 유지됐는지 한 번 더 확인한다.
  const buyEligible =
    triggerEligible &&
    ageTradingDays >= SETTINGS.minWatchTradingDaysBeforeBuy;

  return {
    analysisRuleVersion: ANALYSIS_RULE_VERSION,
    checkedAt: nowText(),
    checkedAtMs: Date.now(),
    currentPrice,
    why,
    money,
    sector,
    trend,
    pullback,
    rebound,
    foundationScore,
    totalScore,
    ageTradingDays,
    marketScore,
    marketType,
    weakMarketRiskLimited,
    readyEligible,
    triggerEligible,
    triggerMaintainEligible,
    readyBlockedBySurge,
    readyBlockedByShallowPullback,
    currentPullbackDepthRate,
    readyBlockReason,
    previousDayChangeRate,
    previousDaySurge,
    previousDayExtremeSurge,
    previousDaySurgeCooldownBlocked,
    surgeCooldownEndTime,
    triggerBlockReason,
    buyEligible,
    buyReason: buyEligible
      ? `WAVE 1차 TRIGGER 조건 충족 / WHY ${why.score} MONEY ${money.score} SECTOR ${sector.score} / ` +
        `TREND ${trend.score} PULLBACK ${pullback.score} REBOUND ${rebound.score} / 총 ${totalScore} / 다음 평가 확인 필요`
      : null
  };
}

function getTriggerReadiness({
  analysis = {},
  mode = "LIVE",
  previousStatus = "WATCH",
  previousTriggerPrice = 0,
  triggerPriceHoldRate = 0
} = {}) {
  const normalizedMode = String(mode || "LIVE").toUpperCase();
  const observationReady =
    toNumber(analysis.ageTradingDays) >= SETTINGS.minWatchTradingDaysBeforeBuy;
  const preSignalTriggerReady = analysis.triggerEligible === true;
  const liveTriggerStartReady = preSignalTriggerReady && observationReady;
  const triggerPriceMaintained =
    toNumber(previousTriggerPrice) <= 0 ||
    toNumber(triggerPriceHoldRate) >= SETTINGS.triggerConfirmMaxDipRate;
  const triggerMaintainReady =
    analysis.triggerMaintainEligible === true &&
    observationReady &&
    triggerPriceMaintained;

  const triggerReady = normalizedMode !== "LIVE"
    ? preSignalTriggerReady
    : previousStatus === "TRIGGER"
      ? triggerMaintainReady
      : liveTriggerStartReady;

  let blockReason = analysis.triggerBlockReason || "최종조건 이탈";
  if (!observationReady && preSignalTriggerReady) {
    blockReason =
      `관찰 ${toNumber(analysis.ageTradingDays)} / ` +
      `${SETTINGS.minWatchTradingDaysBeforeBuy}거래일 필요`;
  } else if (previousStatus === "TRIGGER" && !triggerPriceMaintained) {
    blockReason =
      `TRIGGER가 대비 ${toNumber(triggerPriceHoldRate).toFixed(2)}% / ` +
      `허용 ${SETTINGS.triggerConfirmMaxDipRate.toFixed(2)}%`;
  } else if (previousStatus === "TRIGGER" && analysis.triggerMaintainEligible !== true) {
    const reboundScore = toNumber(analysis.rebound?.score);
    const trueRebound = analysis.rebound?.trueRebound === true;

    if (!trueRebound) {
      blockReason =
        `재확인 반등 미충족 / REBOUND ${reboundScore}/${SETTINGS.reboundMinScoreForBuy} / ` +
        `시가대비 ${toNumber(analysis.rebound?.openRate).toFixed(2)}% / ` +
        `직전평가대비 ${toNumber(analysis.rebound?.sinceLastEvalRate).toFixed(2)}% / ` +
        `당일위치 ${toNumber(analysis.rebound?.dayPosition).toFixed(0)}%`;
    } else if (reboundScore < SETTINGS.reboundMinScoreForBuy) {
      blockReason =
        `재확인 REBOUND 부족 ${reboundScore}/${SETTINGS.reboundMinScoreForBuy} / ` +
        `직전평가대비 ${toNumber(analysis.rebound?.sinceLastEvalRate).toFixed(2)}%`;
    } else {
      blockReason =
        `TRIGGER 재확인 최종조건 이탈 / 총 ${toNumber(analysis.totalScore)} / ` +
        `당일 ${toNumber(analysis.rebound?.changeRate).toFixed(2)}% / ` +
        `눌림 ${toNumber(analysis.pullback?.pullbackRate).toFixed(2)}%`;
    }
  }

  return {
    observationReady,
    preSignalTriggerReady,
    liveTriggerStartReady,
    triggerPriceMaintained,
    triggerMaintainReady,
    triggerReady,
    blockReason
  };
}

function getTodayBuyCount(state) {
  const date = todayKey();

  try {
    const masterState =
      portfolioManager.loadMasterState();

    return portfolioManager
      .getStrategyTradeLogs(masterState, "WAVE")
      .filter(
        log =>
          log.date === date &&
          log.type === "WAVE_BUY"
      )
      .length;
  } catch (_) {
    return (state.tradeLogs || []).filter(
      log =>
        log.date === date &&
        log.type === "WAVE_BUY"
    ).length;
  }
}

function isBuyTime() {
  const hhmm = getCurrentHHMM();
  return isKoreanWeekday() && hhmm >= SETTINGS.buyStartTime && hhmm <= SETTINGS.buyEndTime;
}

function isSellCheckTime() {
  const hhmm = getCurrentHHMM();
  return isKoreanWeekday() && hhmm >= SETTINGS.sellCheckStartTime && hhmm <= SETTINGS.sellCheckEndTime;
}

function getWaveRunPhase() {
  if (!isKoreanWeekday()) return "OFF";
  const hhmm = getCurrentHHMM();
  if (hhmm >= SETTINGS.evaluationStartTime && hhmm <= SETTINGS.evaluationEndTime) return "LIVE";
  if (hhmm >= SETTINGS.afterClosePreEvalStartTime) return "AFTER_CLOSE_PREP";
  if (hhmm >= SETTINGS.morningPreEvalStartTime && hhmm <= SETTINGS.morningPreEvalEndTime) return "MORNING_PREP";
  if (hhmm > SETTINGS.evaluationEndTime && hhmm <= SETTINGS.sellCheckEndTime) return "SELL_ONLY";
  return "OFF";
}

function getWaveRuntimeSettings(masterState = null) {
  try {
    const state = masterState || portfolioManager.loadMasterState();
    portfolioManager.ensureMasterState(state);
    const runtime = portfolioManager.getStrategyRuntimeSettings(state, "WAVE");
    if (runtime) return runtime;
  } catch (error) {
    console.warn(`[WAVE 런타임설정 조회 실패] ${error.message}`);
  }
  return {
    buyEnabled: SETTINGS.enabled !== false,
    positionRatio: SETTINGS.positionRatio,
    maxHoldingCount: SETTINGS.maxHoldingCount,
    maxDailyBuyCount: SETTINGS.maxDailyBuyCount,
    maxExposureRate: 1
  };
}

function getEffectiveDailyBuyLimit(analysis = {}, masterState = null) {
  const runtime = getWaveRuntimeSettings(masterState);
  const maxDailyBuyCount = Number(runtime.maxDailyBuyCount || 0);
  const marketScore = toNumber(analysis.marketScore);
  if (marketScore > 0 && marketScore < SETTINGS.weakMarketScore) {
    return Math.max(
      0,
      Math.min(maxDailyBuyCount, SETTINGS.weakMarketMaxDailyBuyCount)
    );
  }
  return maxDailyBuyCount;
}

function logWaveBuyBlock(candidate, reason) {
  const text = String(reason || "매수 실행조건 미충족");
  const nowMs = Date.now();
  if (
    candidate.lastBuyBlockReason === text &&
    nowMs - toNumber(candidate.lastBuyBlockAtMs) < SETTINGS.loopMs
  ) return;
  candidate.lastBuyBlockReason = text;
  candidate.lastBuyBlockAt = nowText();
  candidate.lastBuyBlockAtMs = nowMs;
  console.log(`[WAVE 매수보류] ${candidate.name} / ${text}`);
}


function getWaveMarketEntryThresholds(analysis = {}) {
  const marketScore = toNumber(analysis.marketScore);

  if (marketScore < 40) {
    return {
      tier: "WEAK",
      minScore: toNumber(SETTINGS.waveMarketTierWeakMinScore, 75),
      minFoundation: toNumber(SETTINGS.waveMarketTierWeakMinFoundation, 40),
      minRebound: toNumber(SETTINGS.waveMarketTierWeakMinRebound, 8)
    };
  }

  if (marketScore < 60) {
    return {
      tier: "CAUTION",
      minScore: toNumber(SETTINGS.waveMarketTierCautionMinScore, 70),
      minFoundation: toNumber(SETTINGS.waveMarketTierCautionMinFoundation, 38),
      minRebound: toNumber(SETTINGS.waveMarketTierCautionMinRebound, 7)
    };
  }

  return {
    tier: "NORMAL",
    minScore: toNumber(SETTINGS.waveMarketTierNormalMinScore, 65),
    minFoundation: toNumber(SETTINGS.waveMarketTierNormalMinFoundation, 35),
    minRebound: toNumber(SETTINGS.waveMarketTierNormalMinRebound, 6)
  };
}

function evaluateWaveProfitEntryQuality(candidate, analysis = {}) {
  const threshold = getWaveMarketEntryThresholds(analysis);
  const score = toNumber(analysis.totalScore);
  const foundation = toNumber(analysis.foundationScore);
  const rebound = toNumber(analysis.rebound?.score);
  const sinceLastEvalRate = toNumber(analysis.rebound?.sinceLastEvalRate);

  const pass =
    score >= threshold.minScore &&
    foundation >= threshold.minFoundation &&
    rebound >= threshold.minRebound;

  return {
    pass,
    threshold,
    score,
    foundation,
    rebound,
    sinceLastEvalRate,
    rankScore:
      score * 1000 +
      rebound * 100 +
      foundation * 10 +
      sinceLastEvalRate
  };
}

function paperBuy(state, candidate, analysis) {
  const entryQuality = evaluateWaveProfitEntryQuality(candidate, analysis);

  if (SETTINGS.waveBestTriggerEnabled === true && !entryQuality.pass) {
    logWaveBuyBlock(
      candidate,
      `수익형 진입기준 미충족 / 시장구간 ${entryQuality.threshold.tier} / ` +
      `총 ${entryQuality.score}/${entryQuality.threshold.minScore} / ` +
      `기초 ${entryQuality.foundation}/${entryQuality.threshold.minFoundation} / ` +
      `REBOUND ${entryQuality.rebound}/${entryQuality.threshold.minRebound}`
    );
    return false;
  }

  const price = toNumber(analysis.currentPrice);

  if (!price) {
    logWaveBuyBlock(candidate, "현재가 없음");
    return false;
  }

  applyMasterAccountToWaveState(state);

  const masterState =
    portfolioManager.loadMasterState();

  portfolioManager.ensureMasterState(masterState);

  const runtime = getWaveRuntimeSettings(masterState);
  if (!runtime.buyEnabled) {
    logWaveBuyBlock(candidate, "MASTER / WAVE 신규매수 금지");
    return false;
  }

  const strategyCheck =
    portfolioManager.canStrategyTrade(
      masterState,
      "WAVE"
    );

  if (!strategyCheck.ok) {
    logWaveBuyBlock(
      candidate,
      `MASTER / ${strategyCheck.reason}`
    );
    return false;
  }

  const duplicate =
    portfolioManager.findHoldingByCode(
      masterState,
      candidate.code
    );

  if (duplicate) {
    const owner =
      duplicate.ownerStrategy ||
      duplicate.strategyGroup ||
      duplicate.strategy ||
      "UNKNOWN";

    logWaveBuyBlock(
      candidate,
      `MASTER 동일종목 보유중 / ${owner}`
    );
    return false;
  }

  if (state.holdings.length >= Number(runtime.maxHoldingCount || 0)) {
    logWaveBuyBlock(
      candidate,
      `WAVE 보유한도 ${state.holdings.length}/${runtime.maxHoldingCount}종목`
    );
    return false;
  }

  const todayBuyCount = getTodayBuyCount(state);
  const effectiveDailyBuyLimit =
    getEffectiveDailyBuyLimit(analysis, masterState);

  if (todayBuyCount >= effectiveDailyBuyLimit) {
    const weakMarketText =
      analysis.weakMarketRiskLimited
        ? ` / 매우 약한 시장 ${toNumber(analysis.marketScore).toFixed(1)}점`
        : "";

    logWaveBuyBlock(
      candidate,
      `오늘 매수한도 ${todayBuyCount}/${effectiveDailyBuyLimit}종목${weakMarketText}`
    );
    return false;
  }

  const targetAmount =
    toNumber(masterState.initialCapital) *
    Number(runtime.positionRatio || 0);

  const availability =
    portfolioManager.getAvailableCash(
      masterState,
      { strategy: "WAVE" }
    );

  const requestedAmount = Math.min(
    targetAmount,
    toNumber(availability.availableCash)
  );

  if (requestedAmount < price) {
    logWaveBuyBlock(
      candidate,
      `MASTER 가용현금 부족 / ${toNumber(availability.availableCash).toLocaleString("ko-KR")}원`
    );
    return false;
  }

  const buyTimeMs = Date.now();

  const result = portfolioManager.executeBuy({
    strategy: "WAVE",
    code: candidate.code,
    name: candidate.name,
    price,
    requestedAmount,
    timestampMs: buyTimeMs,
    buyAt: nowText(),
    holding: {
      name: candidate.name,
      highestPrice: price,
      lowestPrice: price,
      buyTime: nowText(),
      buyTimeMs,
      pullbackLowPrice:
        toNumber(analysis.pullback.pullbackLowPrice),
      peakBeforeBuy:
        toNumber(analysis.pullback.peakPrice),
      buyScore:
        toNumber(analysis.totalScore),
      buyFoundationScore:
        toNumber(analysis.foundationScore),
      buyAnalysis: analysis
    },
    logType: "WAVE_BUY",
    tradeLog: {
      score: analysis.totalScore,
      foundationScore: analysis.foundationScore,
      whyScore: analysis.why.score,
      moneyScore: analysis.money.score,
      sectorScore: analysis.sector.score,
      trendScore: analysis.trend.score,
      pullbackScore: analysis.pullback.score,
      reboundScore: analysis.rebound.score,
      marketScore: toNumber(analysis.marketScore),
      effectiveDailyBuyLimit,
      entryTier: entryQuality.threshold.tier,
      entryRankScore: entryQuality.rankScore,
      reason: analysis.buyReason
    }
  });

  if (!result.ok) {
    logWaveBuyBlock(
      candidate,
      `MASTER / ${result.reason || "매수승인 실패"}`
    );
    applyMasterAccountToWaveState(state);
    return false;
  }

  applyMasterAccountToWaveState(state);

  candidate.status = "HOLD";
  candidate.boughtAt = nowText();
  candidate.boughtDate = todayKey();
  candidate.buyPrice = price;
  candidate.buyScore = analysis.totalScore;
  candidate.pullbackLowPrice =
    toNumber(analysis.pullback.pullbackLowPrice);
  candidate.positionId =
    result.holding?.positionId || null;
  candidate.lastBuyBlockReason = null;
  candidate.lastBuyBlockAt = null;
  candidate.lastBuyBlockAtMs = 0;

  ensureDailyStats(state).bought += 1;

  console.log(
    `[WAVE MASTER 모의매수] ${candidate.name} / ` +
    `${price.toLocaleString()}원 / ${result.qty}주 / ` +
    `${toNumber(result.buyAmount).toLocaleString()}원 / ` +
    `총점 ${analysis.totalScore}`
  );

  return true;
}

function getWaveProtectFloorProfitRate(maxProfitRateValue) {
  const maxProfitRate = toNumber(maxProfitRateValue);

  if (maxProfitRate >= SETTINGS.protectTier15StartProfitRate) {
    return SETTINGS.protectTier15FloorProfitRate;
  }
  if (maxProfitRate >= SETTINGS.protectTier10StartProfitRate) {
    return SETTINGS.protectTier10FloorProfitRate;
  }
  if (maxProfitRate >= SETTINGS.protectTier7StartProfitRate) {
    return SETTINGS.protectTier7FloorProfitRate;
  }
  if (maxProfitRate >= SETTINGS.protectTier5StartProfitRate) {
    return SETTINGS.protectTier5FloorProfitRate;
  }
  return SETTINGS.protectFloorProfitRate;
}

function paperSell(state, holding, price, type, reason) {
  const sellPrice = toNumber(price);

  if (!sellPrice || !holding) {
    return false;
  }

  const qty = toNumber(holding.qty);
  const buyPrice = toNumber(holding.buyPrice);

  if (qty <= 0 || buyPrice <= 0) {
    return false;
  }

  persistWaveHoldingMarksToMaster(state);

  const maxProfitRate =
    buyPrice > 0
      ? (
          (
            toNumber(holding.highestPrice) -
            buyPrice
          ) /
          buyPrice
        ) * 100
      : 0;

  const maxLossRate =
    buyPrice > 0
      ? (
          (
            toNumber(holding.lowestPrice) -
            buyPrice
          ) /
          buyPrice
        ) * 100
      : 0;

  const result = portfolioManager.executeSell({
    strategy: "WAVE",
    positionId: holding.positionId || null,
    code: holding.code,
    price: sellPrice,
    logType: type,
    reason,
    tradeLog: {
      maxProfitRate,
      maxLossRate
    }
  });

  if (!result.ok) {
    console.log(
      `[WAVE MASTER 매도실패] ${holding.name} / ` +
      `${result.reason || "알 수 없는 오류"}`
    );
    applyMasterAccountToWaveState(state);
    return false;
  }

  applyMasterAccountToWaveState(state);

  const profit = toNumber(result.profit);
  const profitRate = toNumber(result.profitRate);

  const candidate =
    state.watchlist.find(
      item => item.code === holding.code
    );

  if (candidate) {
    candidate.status = "SOLD";
    candidate.soldAt = nowText();
    candidate.soldDate = todayKey();
    candidate.sellPrice = sellPrice;
    candidate.sellType = type;
    candidate.sellReason = reason;
    candidate.realizedProfitRate = profitRate;
  }

  const stats = ensureDailyStats(state);
  stats.sold += 1;
  stats.realizedProfit += profit;

  console.log(
    `[WAVE MASTER 모의매도] ${holding.name} / ` +
    `${type} / ${profitRate.toFixed(2)}% / ${reason}`
  );

  return true;
}


function paperPartialSell(state, holding, price, sellQty, type, reason) {
  const sellPrice = toNumber(price);
  const qty = Math.max(0, Math.floor(toNumber(sellQty)));
  const buyPrice = toNumber(holding?.buyPrice);

  if (!holding || !sellPrice || qty <= 0 || buyPrice <= 0) {
    return false;
  }

  persistWaveHoldingMarksToMaster(state);

  const maxProfitRate =
    ((toNumber(holding.highestPrice) - buyPrice) / buyPrice) * 100;
  const maxLossRate =
    ((toNumber(holding.lowestPrice) - buyPrice) / buyPrice) * 100;

  const result = portfolioManager.executeSell({
    strategy: "WAVE",
    positionId: holding.positionId || null,
    code: holding.code,
    price: sellPrice,
    qty,
    logType: type,
    reason,
    tradeLog: {
      maxProfitRate,
      maxLossRate,
      partialTakeProfit: true
    }
  });

  if (!result.ok) {
    console.log(
      `[WAVE MASTER 부분익절 실패] ${holding.name} / ` +
      `${result.reason || "알 수 없는 오류"}`
    );
    applyMasterAccountToWaveState(state);
    return false;
  }

  applyMasterAccountToWaveState(state);

  const remaining = state.holdings.find(
    item =>
      String(item.positionId || "") === String(holding.positionId || "") ||
      item.code === holding.code
  );

  if (remaining) {
    remaining.waveFirstTakeProfitDone = true;
    remaining.waveFirstTakeProfitAt = nowText();
    remaining.waveFirstTakeProfitAtMs = Date.now();
    remaining.waveFirstTakeProfitPrice = sellPrice;
    remaining.waveFirstTakeProfitQty = qty;
    remaining.waveFirstTakeProfitRate =
      buyPrice > 0 ? ((sellPrice - buyPrice) / buyPrice) * 100 : 0;
    remaining.protectActive = true;
    persistWaveHoldingMarksToMaster(state);
  }

  const candidate = state.watchlist.find(
    item => item.code === holding.code
  );
  if (candidate && remaining) {
    candidate.status = "PROTECT";
  }

  const stats = ensureDailyStats(state);
  stats.sold += 1;
  stats.realizedProfit += toNumber(result.profit);

  console.log(
    `[WAVE 1차 부분익절] ${holding.name} / ` +
    `${qty}주 / ${toNumber(result.profitRate).toFixed(2)}% / ` +
    `잔여 ${toNumber(result.remainingQty)}주 / ${reason}`
  );

  return true;
}

function applyHoldingPriceRisk(state, holding, priceData = {}) {
  const price = toNumber(priceData.currentPrice);
  const buyPrice = toNumber(holding.buyPrice);
  if (!price || !buyPrice) return { sold: false, price: 0 };

  holding.currentPrice = price;
  holding.highestPrice = Math.max(toNumber(holding.highestPrice || price), price);
  holding.lowestPrice = Math.min(toNumber(holding.lowestPrice || price), price);

  const profitRate = ((price - buyPrice) / buyPrice) * 100;
  const maxProfitRate = ((toNumber(holding.highestPrice) - buyPrice) / buyPrice) * 100;
  const drawdownFromHigh = ((price - toNumber(holding.highestPrice)) / toNumber(holding.highestPrice)) * 100;

  holding.lastCheckedAt = nowText();
  holding.lastCheckedAtMs = Date.now();
  holding.profitRate = profitRate;
  holding.maxProfitRate = maxProfitRate;
  holding.drawdownFromHigh = drawdownFromHigh;

  // 본전보호는 +5%부터 실제로 동작하므로 화면 상태도 같은 시점에 PROTECT로 맞춘다.
  // +8%부터 시작하는 고점 트레일링은 별도 플래그로 기록한다.
  const protectionActive = maxProfitRate >= SETTINGS.protectStartProfitRate;
  const trailingActive = maxProfitRate >= SETTINGS.trailingStartProfitRate;
  const protectFloorProfitRate = getWaveProtectFloorProfitRate(maxProfitRate);
  if (protectionActive && holding.protectActive !== true) {
    holding.protectActivatedAt = nowText();
    holding.protectActivatedAtMs = Date.now();
  }
  if (trailingActive && holding.trailingActive !== true) {
    holding.trailingActivatedAt = nowText();
    holding.trailingActivatedAtMs = Date.now();
  }
  holding.protectActive = protectionActive;
  holding.trailingActive = trailingActive;

  if (protectionActive) {
    const candidate = state.watchlist.find(item => item.code === holding.code);
    if (candidate && candidate.status === "HOLD") candidate.status = "PROTECT";
  }

  if (profitRate <= SETTINGS.stopLossRate) {
    return {
      sold: paperSell(state, holding, price, "WAVE_STOP_LOSS",
        `초기 손절 ${profitRate.toFixed(2)}% / 기준 ${SETTINGS.stopLossRate.toFixed(2)}%`),
      price,
      profitRate,
      maxProfitRate,
      drawdownFromHigh
    };
  }

  const structuralStop = toNumber(holding.pullbackLowPrice) > 0
    ? toNumber(holding.pullbackLowPrice) * (1 + SETTINGS.structureStopBufferRate / 100)
    : 0;
  if (structuralStop > 0 && price <= structuralStop && profitRate < 0) {
    return {
      sold: paperSell(state, holding, price, "WAVE_STRUCTURE_STOP",
        `눌림 저점 이탈 / 기준 ${Math.round(structuralStop).toLocaleString()}원 / 현재 ${price.toLocaleString()}원`),
      price,
      profitRate,
      maxProfitRate,
      drawdownFromHigh
    };
  }

  if (
    SETTINGS.firstTakeProfitEnabled === true &&
    holding.waveFirstTakeProfitDone !== true &&
    profitRate >= toNumber(SETTINGS.firstTakeProfitRate, 4.0)
  ) {
    const currentQty = Math.max(0, Math.floor(toNumber(holding.qty)));
    const sellQty = Math.max(
      1,
      Math.floor(currentQty * toNumber(SETTINGS.firstTakeProfitRatio, 0.50))
    );

    if (currentQty >= 2 && sellQty < currentQty) {
      const partialDone = paperPartialSell(
        state,
        holding,
        price,
        sellQty,
        "WAVE_FIRST_TAKE_PROFIT",
        `1차 부분익절 / 현재 ${profitRate.toFixed(2)}% / ` +
        `기준 ${toNumber(SETTINGS.firstTakeProfitRate, 4.0).toFixed(2)}% / ` +
        `비율 ${(toNumber(SETTINGS.firstTakeProfitRatio, 0.50) * 100).toFixed(0)}%`
      );

      if (partialDone) {
        return {
          sold: false,
          partialSold: true,
          price,
          profitRate,
          maxProfitRate,
          drawdownFromHigh
        };
      }
    }
  }

  if (
    maxProfitRate >= SETTINGS.strongTrailingStartProfitRate &&
    drawdownFromHigh <= -Math.abs(SETTINGS.strongTrailingStopRate)
  ) {
    return {
      sold: paperSell(state, holding, price, "WAVE_STRONG_TRAILING_SELL",
        `강한 수익보호 / 최고 ${maxProfitRate.toFixed(2)}% / 고점대비 ${drawdownFromHigh.toFixed(2)}%`),
      price,
      profitRate,
      maxProfitRate,
      drawdownFromHigh
    };
  }

  if (
    maxProfitRate >= SETTINGS.trailingStartProfitRate &&
    drawdownFromHigh <= -Math.abs(SETTINGS.trailingStopRate)
  ) {
    return {
      sold: paperSell(state, holding, price, "WAVE_TRAILING_SELL",
        `수익 트레일링 / 최고 ${maxProfitRate.toFixed(2)}% / 고점대비 ${drawdownFromHigh.toFixed(2)}%`),
      price,
      profitRate,
      maxProfitRate,
      drawdownFromHigh
    };
  }

  if (
    maxProfitRate >= SETTINGS.protectStartProfitRate &&
    profitRate <= protectFloorProfitRate
  ) {
    return {
      sold: paperSell(state, holding, price, "WAVE_PROTECT_SELL",
        `단계형 수익보호 / 최고 ${maxProfitRate.toFixed(2)}% / ` +
        `현재 ${profitRate.toFixed(2)}% / 보호선 ${protectFloorProfitRate.toFixed(2)}%`),
      price,
      profitRate,
      maxProfitRate,
      drawdownFromHigh
    };
  }

  return { sold: false, price, profitRate, maxProfitRate, drawdownFromHigh };
}

function getWeakTrendExitDecision(holdingDaysValue, priceRisk = {}, trend = {}) {
  const holdingDays = toNumber(holdingDaysValue);
  const profitRate = toNumber(priceRisk.profitRate);
  const price = toNumber(priceRisk.price);
  const ma5 = toNumber(trend.ma5);
  const trendScore = toNumber(trend.score);
  const ma5Rate = ma5 > 0 && price > 0 ? ((price - ma5) / ma5) * 100 : 0;
  const shouldSell =
    SETTINGS.weakTrendSellEnabled === true &&
    holdingDays >= SETTINGS.weakTrendSellMinTradingDays &&
    profitRate < SETTINGS.weakTrendSellMaxProfitRate &&
    trendScore <= SETTINGS.weakTrendSellMaxTrendScore &&
    ma5 > 0 &&
    price < ma5;

  return { shouldSell, holdingDays, profitRate, trendScore, ma5, ma5Rate };
}

function getStagnationExitDecision(holdingDaysValue, priceRisk = {}, trend = {}) {
  const holdingDays = toNumber(holdingDaysValue);
  const profitRate = toNumber(priceRisk.profitRate);
  const maxProfitRate = toNumber(priceRisk.maxProfitRate);
  const price = toNumber(priceRisk.price);
  const ma5 = toNumber(trend.ma5);
  const trendScore = toNumber(trend.score);
  const ma5Rate = ma5 > 0 && price > 0
    ? ((price - ma5) / ma5) * 100
    : 999;

  const shouldSell =
    SETTINGS.stagnationSellEnabled === true &&
    holdingDays >= SETTINGS.stagnationMinTradingDays &&
    Math.abs(profitRate) <= SETTINGS.stagnationMaxAbsProfitRate &&
    maxProfitRate < SETTINGS.stagnationMaxProfitEverRate &&
    trendScore <= SETTINGS.stagnationMaxTrendScore &&
    ma5 > 0 &&
    ma5Rate <= SETTINGS.stagnationMaxMa5Rate;

  return {
    shouldSell,
    holdingDays,
    profitRate,
    maxProfitRate,
    trendScore,
    ma5,
    ma5Rate
  };
}

async function checkHoldingSell(state, holding, options = {}) {
  let priceData = options.priceData || null;
  if (!priceData) {
    try {
      priceData = await getHoldingPriceWithRetry(holding.code);
    } catch (err) {
      console.log(`[WAVE 보유 현재가조회 실패] ${holding.name} / 재시도 후 실패 / ${err.message}`);
      return false;
    }
  }

  holding.lastPriceCheckSource = options.source || "WAVE_MAIN";
  const priceRisk = applyHoldingPriceRisk(state, holding, priceData);
  if (priceRisk.sold || options.priceOnly === true || !priceRisk.price) return priceRisk.sold;

  let dailyData;
  try {
    dailyData = await getDaily(holding.code);
  } catch (err) {
    // 현재가 기반 손절·트레일링·수익보호는 위에서 이미 완료했다.
    console.log(`[WAVE 보유 일봉조회 실패] ${holding.name} / 현재가 위험관리 완료 / ${err.message}`);
    return false;
  }

  const dailyItems = Array.isArray(dailyData.items) ? dailyData.items : [];
  const trend = scoreTrend(dailyItems, priceRisk.price);
  const holdingDays = tradingDaysSince(dailyItems, holding.buyDate);
  holding.holdingTradingDays = holdingDays;
  holding.trendScore = trend.score;
  const weakTrendExit = getWeakTrendExitDecision(holdingDays, priceRisk, trend);
  holding.ma5 = weakTrendExit.ma5;
  holding.ma5Rate = weakTrendExit.ma5Rate;

  if (weakTrendExit.shouldSell) {
    return paperSell(
      state,
      holding,
      priceRisk.price,
      "WAVE_WEAK_TREND_SELL",
      `초기 추세약화 / 보유 ${holdingDays}거래일 / 수익 ${priceRisk.profitRate.toFixed(2)}% / ` +
      `추세 ${trend.score}점 / MA5 대비 ${weakTrendExit.ma5Rate.toFixed(2)}%`
    );
  }

  const stagnationExit = getStagnationExitDecision(
    holdingDays,
    priceRisk,
    trend
  );

  if (stagnationExit.shouldSell) {
    return paperSell(
      state,
      holding,
      priceRisk.price,
      "WAVE_STAGNATION_SELL",
      `정체자금 회수 / 보유 ${holdingDays}거래일 / 현재 ${priceRisk.profitRate.toFixed(2)}% / ` +
      `최고 ${priceRisk.maxProfitRate.toFixed(2)}% / 추세 ${trend.score}점 / ` +
      `MA5 대비 ${stagnationExit.ma5Rate.toFixed(2)}%`
    );
  }

  if (holdingDays >= SETTINGS.hardMaxHoldingTradingDays) {
    return paperSell(state, holding, priceRisk.price, "WAVE_MAX_TIME_SELL",
      `최대 보유 ${holdingDays}거래일 / 현재 ${priceRisk.profitRate.toFixed(2)}%`);
  }

  if (holdingDays >= SETTINGS.maxHoldingTradingDays) {
    if (priceRisk.profitRate < 2.0 || trend.score < 4) {
      return paperSell(state, holding, priceRisk.price, "WAVE_TIME_TREND_SELL",
        `보유 ${holdingDays}거래일 / 수익 ${priceRisk.profitRate.toFixed(2)}% / 추세 ${trend.score}점`);
    }
  }

  return false;
}

function dropExpiredOrBrokenCandidates(state) {
  for (const candidate of state.watchlist) {
    if (["HOLD", "PROTECT", "SOLD", "DROPPED"].includes(candidate.status)) continue;
    const analysis = candidate.lastAnalysis;
    if (!analysis) continue;

    if (analysis.ageTradingDays > SETTINGS.watchMaxTradingDays) {
      candidate.status = "DROPPED";
      candidate.dropReason = `관찰기간 ${analysis.ageTradingDays}거래일 초과`;
      continue;
    }

    if (analysis.pullback?.pullbackRate < -12) {
      candidate.status = "DROPPED";
      candidate.dropReason = `눌림 -12% 초과 / ${analysis.pullback.pullbackRate.toFixed(2)}%`;
      continue;
    }

    if (analysis.why?.severeNegativeCount > 0 && analysis.why.score < SETTINGS.whyMinScore) {
      candidate.status = "DROPPED";
      candidate.dropReason = "중대 부정재료 감지";
    }
  }
}

function trimWatchlist(state) {
  const active = state.watchlist.filter(item => !["SOLD", "DROPPED"].includes(item.status));

  active.sort((a, b) => {
    const statusRank = status => status === "PROTECT" ? 6 : status === "HOLD" ? 5 :
      status === "TRIGGER" ? 4 : status === "READY" ? 3 :
        ["WATCH", "DISCOVERED"].includes(status) ? 2 : 1;
    const statusDiff = statusRank(b.status) - statusRank(a.status);
    if (statusDiff !== 0) return statusDiff;

    const capacityScore = candidate => candidate.lastAnalysis
      ? toNumber(candidate.lastAnalysis.totalScore) +
        toNumber(candidate.hotScore) * 0.1 +
        toNumber(candidate.priorityScore) * 0.1
      : Math.max(toNumber(candidate.hotScore), toNumber(candidate.priorityScore));
    const aScore = capacityScore(a);
    const bScore = capacityScore(b);
    return bScore - aScore;
  });

  const kept = active.slice(0, SETTINGS.maxWatchCount);
  const overflow = active.slice(SETTINGS.maxWatchCount);
  for (const candidate of overflow) {
    candidate.status = "DROPPED";
    candidate.dropReason = `${WATCH_CAP_DROP_REASON} / 최대 ${SETTINGS.maxWatchCount}개`;
    candidate.dropDate = todayKey();
    candidate.droppedAt = nowText();
    candidate.droppedAtMs = Date.now();
  }

  // 상한 밖 후보도 상태파일에 남겨야 다음 5분 실행에서 같은 종목을 신규 발견으로
  // 다시 추가하지 않는다. 종목코드 기준으로 중복을 제거하고 최근 이력만 보관한다.
  const keptCodes = new Set(kept.map(item => item.code));
  const closedByCode = new Map();
  for (const candidate of [
    ...overflow,
    ...state.watchlist.filter(item => ["SOLD", "DROPPED"].includes(item.status))
  ]) {
    if (!candidate?.code || keptCodes.has(candidate.code) || closedByCode.has(candidate.code)) continue;
    closedByCode.set(candidate.code, candidate);
  }

  const closed = Array.from(closedByCode.values())
    .sort((a, b) =>
      toNumber(b.soldAtMs || b.droppedAtMs || b.lastEvaluatedAtMs) -
      toNumber(a.soldAtMs || a.droppedAtMs || a.lastEvaluatedAtMs)
    )
    .slice(0, 120);

  state.watchlist = [...kept, ...closed];
}

async function evaluateWatchCandidates(state, options = {}) {
  const mode = String(options.mode || "LIVE").toUpperCase();
  const active = state.watchlist
    .filter(item => ["DISCOVERED", "WATCH", "READY", "TRIGGER"].includes(item.status));

  if (!active.length) {
    return { evaluated: 0, ready: 0, trigger: 0, bought: 0, soldDuringEvaluation: 0, attempted: 0, mode };
  }

  let candidates = [...active];

  if (options.onlyUnevaluated === true) {
    candidates = candidates.filter(item => !item.lastAnalysis);
  }

  if (mode === "LIVE") {
    // 장중은 READY를 최우선, 그 다음 사전분석 총점/기초점수가 높은 WATCH 순으로 본다.
    candidates.sort((a, b) => {
      const statusRank = status => status === "TRIGGER" ? 4 : status === "READY" ? 3 : status === "WATCH" ? 2 : 1;
      const statusDiff = statusRank(b.status) - statusRank(a.status);
      if (statusDiff !== 0) return statusDiff;

      const totalDiff = toNumber(b.lastAnalysis?.totalScore) - toNumber(a.lastAnalysis?.totalScore);
      if (totalDiff !== 0) return totalDiff;

      const foundationDiff = toNumber(b.lastAnalysis?.foundationScore) - toNumber(a.lastAnalysis?.foundationScore);
      if (foundationDiff !== 0) return foundationDiff;

      const pullbackDiff = toNumber(b.lastAnalysis?.pullback?.score) - toNumber(a.lastAnalysis?.pullback?.score);
      if (pullbackDiff !== 0) return pullbackDiff;

      return toNumber(b.hotScore) - toNumber(a.hotScore);
    });
  } else {
    // 사전분석은 미평가 후보를 먼저 처리하고, 나머지는 기존 점수 높은 순으로 갱신한다.
    candidates.sort((a, b) => {
      const noAnalysisDiff = Number(!b.lastAnalysis) - Number(!a.lastAnalysis);
      if (noAnalysisDiff !== 0) return noAnalysisDiff;
      return (
        toNumber(b.lastAnalysis?.totalScore) - toNumber(a.lastAnalysis?.totalScore) ||
        toNumber(b.hotScore) - toNumber(a.hotScore)
      );
    });
  }

  const defaultBatchSize = mode === "LIVE"
    ? SETTINGS.liveEvaluationBatchSize
    : SETTINGS.preEvaluationBatchSize;
  const batchSize = Math.max(1, Number(options.batchSize || defaultBatchSize));

  let batch;
  if (mode === "LIVE" && candidates.length > batchSize) {
    const prioritySize = Math.min(
      batchSize,
      Math.max(1, Number(SETTINGS.livePriorityBatchSize || Math.ceil(batchSize * 2 / 3)))
    );
    const rotationSize = Math.min(
      batchSize - prioritySize,
      Math.max(0, Number(SETTINGS.liveRotationBatchSize || (batchSize - prioritySize)))
    );
    const priorityRows = candidates.slice(0, prioritySize);
    const priorityCodes = new Set(priorityRows.map(item => item.code));

    // API 실패 후보도 '평가 시도' 시각을 기록한다. 성공한 시각(lastEvaluatedAtMs)만 보면
    // 실패 후보가 영원히 가장 오래된 후보로 남아 순환 슬롯을 독점할 수 있다.
    const rotationRows = candidates
      .filter(item => !priorityCodes.has(item.code))
      .sort((a, b) => {
        const aAttempt = toNumber(
          a.lastEvaluationAttemptAtMs || a.lastEvaluatedAtMs || a.discoveredAtMs
        );
        const bAttempt = toNumber(
          b.lastEvaluationAttemptAtMs || b.lastEvaluatedAtMs || b.discoveredAtMs
        );
        if (aAttempt !== bAttempt) return aAttempt - bAttempt;
        return toNumber(b.lastAnalysis?.totalScore) - toNumber(a.lastAnalysis?.totalScore);
      })
      .slice(0, rotationSize);

    const selectedCodes = new Set([...priorityRows, ...rotationRows].map(item => item.code));
    const fillRows = candidates
      .filter(item => !selectedCodes.has(item.code))
      .slice(0, Math.max(0, batchSize - priorityRows.length - rotationRows.length));
    batch = [...priorityRows, ...rotationRows, ...fillRows];
  } else {
    batch = candidates.slice(0, batchSize);
  }
  const rawMarketData = loadJson(OPEN_MARKET_FILE, {});
  const marketData = String(rawMarketData.date || "") === todayKey()
    ? rawMarketData
    : {};
  let evaluated = 0;
  let ready = 0;
  let trigger = 0;
  let bought = 0;
  let soldDuringEvaluation = 0;
  const waveBuyPool = [];

  for (const candidate of batch) {
    candidate.lastEvaluationAttemptAt = nowText();
    candidate.lastEvaluationAttemptAtMs = Date.now();
    try {
      const [priceData, dailyData, flowData, newsItems] = await Promise.all([
        getPrice(candidate.code),
        getDaily(candidate.code),
        getInvestorFlow(candidate.code),
        fetchStockNews(candidate.name)
      ]);

      // TRIGGER 확인시간은 같은 거래일 LIVE 평가끼리만 이어진다.
      // 전일 또는 구버전 TRIGGER가 남아 있으면 READY에서 장중 확인을 새로 시작한다.
      if (mode === "LIVE" && candidate.status === "TRIGGER" && candidate.triggerDate !== todayKey()) {
        candidate.status = "READY";
        clearLiveTrigger(candidate);
      }

      const previousStatusRaw = candidate.status;
      const previousStatus = previousStatusRaw === "DISCOVERED" ? "WATCH" : previousStatusRaw;
      const previousTriggerAtMs = toNumber(candidate.triggerAtMs);
      const previousTriggerPrice = toNumber(candidate.triggerPrice);

      const analysis = await analyzeCandidate(candidate, priceData, dailyData, flowData, newsItems, marketData);

      const foundationReady = analysis.readyEligible === true;
      const triggerAgeMs = mode === "LIVE" && previousStatus === "TRIGGER" && previousTriggerAtMs > 0
        ? Date.now() - previousTriggerAtMs
        : 0;
      const triggerPriceHoldRate = previousTriggerPrice > 0
        ? ((analysis.currentPrice - previousTriggerPrice) / previousTriggerPrice) * 100
        : 0;
      const triggerDecision = getTriggerReadiness({
        analysis,
        mode,
        previousStatus,
        previousTriggerPrice,
        triggerPriceHoldRate
      });
      const triggerReady = triggerDecision.triggerReady;
      const triggerConfirmed =
        mode === "LIVE" &&
        previousStatus === "TRIGGER" &&
        candidate.triggerDate === todayKey() &&
        triggerReady &&
        triggerAgeMs >= SETTINGS.triggerConfirmMinMs;

      const scoreBuyEligible = analysis.buyEligible === true;
      // 방어적 최종 게이트: TRIGGER 유지판정이 잘못 완화되더라도 실제 매수 직전에는
      // 반드시 현재 평가 자체가 다시 1차 TRIGGER 조건(trueRebound + REBOUND 최소점수)을 만족해야 한다.
      const confirmationSignalReady =
        analysis.triggerEligible === true &&
        analysis.rebound?.trueRebound === true &&
        toNumber(analysis.rebound?.score) >= SETTINGS.reboundMinScoreForBuy;

      analysis.triggerConfirmed = triggerConfirmed;
      analysis.triggerAgeMs = triggerAgeMs;
      analysis.triggerPrice = previousTriggerPrice;
      analysis.triggerPriceHoldRate = triggerPriceHoldRate;
      analysis.triggerPriceMaintained = triggerDecision.triggerPriceMaintained;
      analysis.triggerMaintainReady = triggerDecision.triggerMaintainReady;
      analysis.triggerMaintainBlockReason = triggerDecision.blockReason;
      analysis.observationReady = triggerDecision.observationReady;
      analysis.confirmationSignalReady = confirmationSignalReady;
      analysis.preSignalBuyEligible = mode !== "LIVE" && scoreBuyEligible;
      analysis.buyEligible =
        mode === "LIVE" &&
        triggerDecision.observationReady &&
        triggerConfirmed &&
        confirmationSignalReady;
      analysis.buyReason = analysis.buyEligible
        ? `WAVE TRIGGER 재확인 완료 / 유지 ${Math.round(triggerAgeMs / 60000)}분 / ` +
          `REBOUND ${analysis.rebound.score} / 직전평가대비 ${analysis.rebound.sinceLastEvalRate.toFixed(2)}% / ` +
          `TRIGGER가 대비 ${triggerPriceHoldRate.toFixed(2)}% / 총 ${analysis.totalScore}`
        : analysis.buyReason;

      candidate.lastPrice = analysis.currentPrice;
      candidate.peakPrice = Math.max(toNumber(candidate.peakPrice), toNumber(analysis.pullback.peakPrice), analysis.currentPrice);
      candidate.pullbackLowPrice = Math.min(
        ...[toNumber(candidate.pullbackLowPrice), toNumber(analysis.pullback.pullbackLowPrice), analysis.currentPrice]
          .filter(value => value > 0)
      );
      candidate.lastAnalysis = analysis;
      candidate.lastEvaluatedAt = analysis.checkedAt;
      candidate.lastEvaluatedAtMs = analysis.checkedAtMs;
      candidate.lastEvaluationMode = mode;
      candidate.status = previousStatus;

      if (mode !== "LIVE") {
        // 장후/장전 평가는 다음 장의 우선순위만 만든다. 실제 TRIGGER 시간은 만들거나
        // 확인하지 않으며, 장중 첫 평가에서 TRIGGER를 새로 만든 뒤 다음 평가에서 산다.
        const preSignalStatus = triggerDecision.preSignalTriggerReady
          ? "TRIGGER"
          : foundationReady ? "READY" : "WATCH";
        candidate.preSignalStatus = preSignalStatus;
        candidate.preSignalMode = mode;
        candidate.preSignalDate = todayKey();
        candidate.preSignalAt = analysis.checkedAt;
        candidate.preSignalAtMs = analysis.checkedAtMs;
        candidate.preSignalPrice = analysis.currentPrice;
        candidate.preSignalScore = analysis.totalScore;
        analysis.preSignalStatus = preSignalStatus;
        analysis.preSignalReason = analysis.buyReason;
        analysis.triggerConfirmed = false;
        analysis.triggerAgeMs = 0;
        analysis.triggerPrice = 0;
        analysis.triggerPriceHoldRate = 0;
        analysis.buyReason = null;
        clearLiveTrigger(candidate);

        if (!foundationReady) {
          candidate.status = "WATCH";
          candidate.readyBlockReason = analysis.readyBlockReason ||
            `READY 조건 재확인 필요 / WHY ${analysis.why.score} / 기초 ${analysis.foundationScore} / 눌림 ${analysis.pullback.score}`;
          candidate.readyBlockedAt = nowText();
        } else {
          candidate.status = "READY";
          candidate.readyAt = previousStatus === "READY" ? candidate.readyAt : nowText();
          candidate.readyBlockReason = null;
          candidate.readyBlockedAt = null;
        }

        if (preSignalStatus === "TRIGGER") {
          console.log(
            `[WAVE 사전 TRIGGER] ${candidate.name} / 총 ${analysis.totalScore} / ` +
            `다음 LIVE 평가부터 2회 확인 / 모드 ${mode}`
          );
        }
      } else if (!foundationReady) {
        candidate.status = "WATCH";
        candidate.readyBlockReason = analysis.readyBlockReason ||
          `READY 조건 재확인 필요 / WHY ${analysis.why.score} / 기초 ${analysis.foundationScore} / 눌림 ${analysis.pullback.score}`;
        candidate.readyBlockedAt = nowText();
        clearLiveTrigger(candidate);

        if (["READY", "TRIGGER"].includes(previousStatus)) {
          console.log(
            `[WAVE READY 보류] ${candidate.name} / ${candidate.readyBlockReason} / 모드 ${mode}`
          );
        }
      } else if (triggerReady) {
        candidate.status = "TRIGGER";
        candidate.readyBlockReason = null;
        candidate.readyBlockedAt = null;

        if (previousStatus !== "TRIGGER") {
          candidate.triggerAt = nowText();
          candidate.triggerAtMs = Date.now();
          candidate.triggerPrice = analysis.currentPrice;
          candidate.triggerScore = analysis.totalScore;
          candidate.triggerDate = todayKey();
          console.log(
            `[WAVE TRIGGER] ${candidate.name} / 총 ${analysis.totalScore} / ` +
            `REBOUND ${analysis.rebound.score} / 당일 ${analysis.rebound.changeRate.toFixed(2)}% / ` +
            `시가대비 ${analysis.rebound.openRate.toFixed(2)}% / 직전평가대비 ${analysis.rebound.sinceLastEvalRate.toFixed(2)}% / ` +
            `관찰 ${analysis.ageTradingDays}거래일 / 다음 평가 확인 / 모드 ${mode}`
          );
        } else if (triggerConfirmed) {
          console.log(
            `[WAVE TRIGGER 확인] ${candidate.name} / 유지 ${Math.round(triggerAgeMs / 60000)}분 / ` +
            `총 ${analysis.totalScore} / REBOUND ${analysis.rebound.score} / ` +
            `TRIGGER가 대비 ${triggerPriceHoldRate.toFixed(2)}% / 모드 ${mode}`
          );
        }
      } else {
        candidate.status = "READY";
        candidate.readyAt = previousStatus === "READY" ? candidate.readyAt : nowText();
        candidate.readyBlockReason =
          analysis.triggerEligible === true && !triggerDecision.observationReady
            ? triggerDecision.blockReason
            : null;
        candidate.readyBlockedAt = candidate.readyBlockReason ? nowText() : null;
        clearLiveTrigger(candidate);

        if (previousStatus === "TRIGGER") {
          console.log(
            `[WAVE TRIGGER 해제] ${candidate.name} / ${triggerDecision.blockReason} / 모드 ${mode}`
          );
        } else if (previousStatus !== "READY") {
          console.log(
            `[WAVE READY] ${candidate.name} / 총 ${analysis.totalScore} / ` +
            `WHY ${analysis.why.score} MONEY ${analysis.money.score} SECTOR ${analysis.sector.score} / ` +
            `눌림 ${analysis.pullback.pullbackRate.toFixed(2)}% / 반등 ${analysis.rebound.score} / ` +
            `당일 ${analysis.rebound.changeRate.toFixed(2)}% / 모드 ${mode}`
          );
        }
      }

      if (candidate.status === "READY") ready++;
      if (candidate.status === "TRIGGER") trigger++;

      if (mode === "LIVE" && analysis.buyEligible && isBuyTime()) {
        const entryQuality = evaluateWaveProfitEntryQuality(candidate, analysis);

        if (entryQuality.pass) {
          waveBuyPool.push({
            candidate,
            analysis,
            entryQuality
          });
        } else {
          console.log(
            `[WAVE 수익형 보류] ${candidate.name} / ` +
            `시장구간 ${entryQuality.threshold.tier} / ` +
            `총 ${entryQuality.score}/${entryQuality.threshold.minScore} / ` +
            `기초 ${entryQuality.foundation}/${entryQuality.threshold.minFoundation} / ` +
            `REBOUND ${entryQuality.rebound}/${entryQuality.threshold.minRebound}`
          );
        }
      }

      evaluated++;
      ensureDailyStats(state).evaluated += 1;
      if (candidate.status === "READY") ensureDailyStats(state).ready += 1;
      if (candidate.status === "TRIGGER") ensureDailyStats(state).trigger += 1;

    } catch (err) {
      candidate.lastError = err.message;
      candidate.lastErrorAt = nowText();
      candidate.lastEvaluationMode = mode;
      console.log(`[WAVE 후보평가 실패] ${candidate.name}(${candidate.code}) / ${err.message} / 모드 ${mode}`);
    }

    if (
      mode === "LIVE" &&
      Date.now() - lastHoldingCheckAtMs >= SETTINGS.holdingCheckMs
    ) {
      soldDuringEvaluation += await checkAllHoldings(state, {
        priceOnly: true,
        source: "WAVE_EVALUATION_CHECKPOINT"
      });
    }

    await sleep(SETTINGS.evaluationDelayMs);
  }


  // 후보 한 건씩 즉시 사지 않고 이번 LIVE 배치의 확정 TRIGGER를 모두 평가한 뒤
  // 총점 → REBOUND → FOUNDATION → 최근 상승강도 순으로 BEST 후보부터 매수한다.
  if (
    mode === "LIVE" &&
    isBuyTime() &&
    SETTINGS.waveBestTriggerEnabled === true &&
    waveBuyPool.length > 0
  ) {
    waveBuyPool.sort((a, b) =>
      toNumber(b.entryQuality.rankScore) -
      toNumber(a.entryQuality.rankScore)
    );

    console.log(
      `[WAVE BEST TRIGGER] 후보 ${waveBuyPool.length}개 / ` +
      waveBuyPool
        .map((row, index) =>
          `${index + 1}.${row.candidate.name}` +
          `(총${row.entryQuality.score}/R${row.entryQuality.rebound}/` +
          `기초${row.entryQuality.foundation}/시장${toNumber(row.analysis.marketScore).toFixed(1)})`
        )
        .join(" | ")
    );

    for (const row of waveBuyPool) {
      if (paperBuy(state, row.candidate, row.analysis)) {
        bought++;
      }
    }
  }

  return { evaluated, ready, trigger, bought, soldDuringEvaluation, attempted: batch.length, mode };
}

async function checkAllHoldings(state, options = {}) {
  if (!isSellCheckTime()) return 0;

  const holdings = [...state.holdings];
  if (!holdings.length) {
    lastHoldingCheckAtMs = Date.now();
    return 0;
  }

  let sold = 0;
  const batchSize = Math.max(1, Math.floor(toNumber(SETTINGS.holdingPriceBatchSize, 1)));

  // 현재가는 소규모 병렬 배치로 받아 5종목 보유 시에도 1분 위험점검이 길게 밀리지 않게 한다.
  // 매도·상태변경은 아래에서 순차 처리하여 같은 state를 동시에 수정하지 않는다.
  for (let offset = 0; offset < holdings.length; offset += batchSize) {
    const batch = holdings.slice(offset, offset + batchSize);
    const priceResults = await Promise.allSettled(
      batch.map(holding => getHoldingPriceWithRetry(holding.code))
    );

    for (let index = 0; index < batch.length; index++) {
      const holding = batch[index];
      const priceResult = priceResults[index];

      if (priceResult.status !== "fulfilled") {
        console.log(
          `[WAVE 보유 현재가조회 실패] ${holding.name}(${holding.code}) / ` +
          `재시도 후 실패 / ${priceResult.reason?.message || priceResult.reason}`
        );
        continue;
      }

      // 같은 실행 안에서 이미 매도된 보유종목이면 중복 처리하지 않는다.
      if (!state.holdings.some(item => item.code === holding.code)) continue;
      if (await checkHoldingSell(state, holding, {
        ...options,
        priceData: priceResult.value
      })) {
        sold++;
      }
    }

    if (offset + batchSize < holdings.length) {
      await sleep(SETTINGS.evaluationDelayMs);
    }
  }

  lastHoldingCheckAtMs = Date.now();
  return sold;
}

function makeSummary(state) {
  const activeWatch = state.watchlist.filter(item => ["DISCOVERED", "WATCH", "READY", "TRIGGER"].includes(item.status));
  const watchOnly = activeWatch.filter(item => ["DISCOVERED", "WATCH"].includes(item.status));
  const ready = activeWatch.filter(item => item.status === "READY");
  const trigger = activeWatch.filter(item => item.status === "TRIGGER");
  const prepTrigger = activeWatch.filter(item => item.preSignalStatus === "TRIGGER");
  const realizedProfit = state.tradeLogs
    .filter(log => String(log.type || "").startsWith("WAVE_") && String(log.type || "") !== "WAVE_BUY" && Number.isFinite(Number(log.profit)))
    .reduce((sum, log) => sum + Number(log.profit || 0), 0);
  const date = todayKey();
  const todayStats = state.dailyStats?.[date] || null;
  const todaySellLogs = state.tradeLogs.filter(log =>
    log.date === date &&
    String(log.type || "").startsWith("WAVE_") &&
    String(log.type || "") !== "WAVE_BUY" &&
    Number.isFinite(Number(log.profit))
  );
  const todayRealizedProfit = todaySellLogs.reduce(
    (sum, log) => sum + toNumber(log.profit),
    0
  );
  const portfolio = calculatePortfolioSnapshot(state);
  const hasStartEquity =
    todayStats?.startEquity !== undefined &&
    todayStats?.startEquity !== null &&
    Number.isFinite(Number(todayStats.startEquity));
  const startEquity = hasStartEquity ? Number(todayStats.startEquity) : null;
  /*
   * MASTER 자산/현금은 계좌 전체 값이지만,
   * WAVE 화면과 WAVE 로그의 "당일손익"은 WAVE 전략 기여분만 계산한다.
   * 오늘 실현손익 + 장 시작 대비 WAVE 보유손익 변화 = WAVE 당일손익.
   */
  const dailyStartUnrealizedProfit = hasStartEquity
    ? toNumber(todayStats?.startUnrealizedProfit)
    : 0;
  const todayUnrealizedChange = hasStartEquity
    ? portfolio.unrealizedProfit - dailyStartUnrealizedProfit
    : portfolio.unrealizedProfit;
  const todayEquityChange =
    todayRealizedProfit + todayUnrealizedChange;
  const masterInitialCapital = toNumber(
    getWaveMasterSnapshot().masterState.initialCapital,
    SETTINGS.initialCapital
  );
  const todayReturnRate = masterInitialCapital > 0
    ? (todayEquityChange / masterInitialCapital) * 100
    : 0;
  const latestHoldingPriceCheck = state.holdings
    .slice()
    .sort((a, b) => toNumber(b.lastCheckedAtMs) - toNumber(a.lastCheckedAtMs))[0] || null;
  const holdingPriceFreshCount = state.holdings.filter(item =>
    toNumber(item.lastCheckedAtMs) > 0 &&
    Date.now() - toNumber(item.lastCheckedAtMs) <= SETTINGS.holdingCheckMs * 2
  ).length;

  return {
    updatedAt: nowText(),
    totalCash: portfolio.totalCash,
    invested: portfolio.invested,
    equity: portfolio.equity,
    realizedProfit,
    unrealizedProfit: portfolio.unrealizedProfit,
    todayRealizedProfit,
    todayUnrealizedProfit: portfolio.unrealizedProfit,
    todayUnrealizedChange,
    todayEquityChange,
    todayNetProfit: todayEquityChange,
    todayReturnRate,
    todaySoldCount: todaySellLogs.length,
    dailyStartEquity: startEquity,
    dailyStartUnrealizedProfit,
    dailyStartSnapshotAt: todayStats?.startSnapshotAt || null,
    dailyStartSnapshotBasis: todayStats?.startSnapshotBasis || null,
    candidateCount: activeWatch.length,
    watchCount: watchOnly.length,
    readyCount: ready.length,
    triggerCount: trigger.length,
    prepTriggerCount: prepTrigger.length,
    readyEvaluationCount: toNumber(todayStats?.ready),
    triggerEvaluationCount: toNumber(todayStats?.trigger),
    holdingCount: state.holdings.length,
    holdingPriceFreshCount,
    lastHoldingPriceCheckAt: latestHoldingPriceCheck?.lastCheckedAt || null,
    lastHoldingPriceCheckAtMs: toNumber(latestHoldingPriceCheck?.lastCheckedAtMs),
    lastHoldingMonitorAt: state.lastHoldingMonitorAt || null,
    todayBuyCount: getTodayBuyCount(state),
    topCandidates: activeWatch
      .slice()
      .sort((a, b) => toNumber(b.lastAnalysis?.totalScore) - toNumber(a.lastAnalysis?.totalScore))
      .slice(0, 10)
      .map(item => ({
        code: item.code,
        name: item.name,
        status: item.status,
        preSignalStatus: item.preSignalStatus || null,
        preSignalMode: item.preSignalMode || null,
        score: toNumber(item.lastAnalysis?.totalScore),
        foundationScore: toNumber(item.lastAnalysis?.foundationScore),
        why: toNumber(item.lastAnalysis?.why?.score),
        money: toNumber(item.lastAnalysis?.money?.score),
        sector: toNumber(item.lastAnalysis?.sector?.score),
        trend: toNumber(item.lastAnalysis?.trend?.score),
        pullback: toNumber(item.lastAnalysis?.pullback?.score),
        rebound: toNumber(item.lastAnalysis?.rebound?.score),
        pullbackRate: toNumber(item.lastAnalysis?.pullback?.pullbackRate),
        lastPrice: toNumber(item.lastPrice)
      }))
  };
}

function refreshSummaryAndDailyStats(state) {
  const stats = ensureDailyStats(state);
  const summary = makeSummary(state);

  stats.endEquity = summary.equity;
  stats.endCash = summary.totalCash;
  stats.endInvested = summary.invested;
  stats.endUnrealizedProfit = summary.unrealizedProfit;
  stats.realizedProfit = summary.todayRealizedProfit;
  stats.unrealizedChange = summary.todayUnrealizedChange;
  stats.equityChange = summary.todayEquityChange;
  stats.netProfit = summary.todayNetProfit;
  stats.returnRate = summary.todayReturnRate;
  stats.lastSnapshotAt = nowText();
  return summary;
}

let running = false;
let timer = null;
let alignmentTimer = null;
let holdingTimer = null;
let holdingAlignmentTimer = null;
let holdingMonitorRunning = false;
let lastHoldingCheckAtMs = 0;
let started = false;

async function runWaveHoldingMonitorOnce() {
  if (running || holdingMonitorRunning) {
    return { ok: false, skipped: true, reason: "WAVE 다른 실행 중" };
  }

  holdingMonitorRunning = true;
  const state = loadState();

  try {
    if (!SETTINGS.enabled) return { ok: false, skipped: true, reason: "WAVE OFF" };
    if (!isSellCheckTime()) return { ok: true, skipped: true, reason: "WAVE 매도점검 시간 외" };
    if (!state.holdings.length) return { ok: true, skipped: true, reason: "WAVE 보유종목 없음" };

    const sold = await checkAllHoldings(state, {
      priceOnly: true,
      source: "WAVE_FAST_TIMER"
    });

    state.lastHoldingMonitorAt = nowText();
    state.lastHoldingMonitorAtMs = Date.now();
    state.summary = refreshSummaryAndDailyStats(state);
    saveState(state);

    if (sold > 0) {
      console.log(
        `[WAVE 1분 보유감시] 매도 ${sold} / 보유 ${state.summary.holdingCount} / ` +
        `오늘손익 ${toNumber(state.summary.todayEquityChange).toLocaleString("ko-KR")}원`
      );
    }

    return { ok: true, sold, state };
  } catch (err) {
    console.error("[WAVE 1분 보유감시 오류]", err.message);
    state.lastHoldingMonitorError = err.message;
    state.lastHoldingMonitorErrorAt = nowText();
    saveState(state);
    return { ok: false, reason: err.message, state };
  } finally {
    holdingMonitorRunning = false;
  }
}

async function runWaveOnce() {
  if (running) return { ok: false, reason: "WAVE 실행 중" };

  // 1분 보유감시와 5분 전체평가가 겹치면 짧게 기다려 state 파일 덮어쓰기를 방지한다.
  if (holdingMonitorRunning) {
    const waitDeadline = Date.now() + SETTINGS.holdingPriceTimeoutMs * 2 + 3000;
    while (holdingMonitorRunning && Date.now() < waitDeadline) {
      await sleep(250);
    }
  }
  if (running || holdingMonitorRunning) {
    return { ok: false, reason: "WAVE 보유감시 중" };
  }

  running = true;

  const state = loadState();
  try {
    if (!SETTINGS.enabled) return { ok: false, reason: "WAVE OFF" };
    const phase = getWaveRunPhase();
    const date = todayKey();

    // OFF 구간에는 후보 API/파일을 반복 조회하지 않는다. 5분 타이머는 유지하되
    // 실제 후보 적재와 상태 저장은 LIVE/SELL_ONLY/사전평가 구간에서만 수행한다.
    if (!isKoreanWeekday() || phase === "OFF") {
      return { ok: true, skipped: true, reason: `WAVE ${phase}`, state };
    }

    const activeBeforeRun = state.watchlist
      .filter(item => ["DISCOVERED", "WATCH", "READY", "TRIGGER"].includes(item.status));
    const unevaluatedBeforeRun = activeBeforeRun.filter(item => !item.lastAnalysis);
    const firstAfterClosePass = phase === "AFTER_CLOSE_PREP" && state.preEvaluation.afterCloseDate !== date;
    const firstMorningPass = phase === "MORNING_PREP" && state.preEvaluation.morningDate !== date;
    const afterCloseRetryAllowed =
      phase === "AFTER_CLOSE_PREP" &&
      !firstAfterClosePass &&
      unevaluatedBeforeRun.length > 0 &&
      toNumber(state.preEvaluation.afterCloseRetryCount) < SETTINGS.preEvaluationMaxRetryCount;
    const morningRetryAllowed =
      phase === "MORNING_PREP" &&
      !firstMorningPass &&
      unevaluatedBeforeRun.length > 0 &&
      toNumber(state.preEvaluation.morningRetryCount) < SETTINGS.preEvaluationMaxRetryCount;

    // 장후/장전 전체 평가는 하루 1회, 미평가 후보 재시도는 최대 2회만 한다.
    // 완료 뒤 5분 타이머가 돌아도 후보를 재적재하지 않아 발견/제외 로그가 증식하지 않는다.
    if (phase === "AFTER_CLOSE_PREP" && !firstAfterClosePass && !afterCloseRetryAllowed) {
      return { ok: true, skipped: true, reason: "WAVE 장후 사전평가 완료", state };
    }
    if (phase === "MORNING_PREP" && !firstMorningPass && !morningRetryAllowed) {
      return { ok: true, skipped: true, reason: "WAVE 장전 사전평가 완료", state };
    }

    let hotAdded = 0;
    let priorityAdded = 0;
    const shouldIngest = phase === "LIVE" || firstAfterClosePass || firstMorningPass;
    if (shouldIngest) {
      hotAdded = ingestHotCandidates(state);
      priorityAdded = ingestMarketPriorityCandidates(state);
      // 적재 직후 상한을 먼저 적용해야 사전평가 배치 40개와 활성후보 40개가 일치한다.
      trimWatchlist(state);
    }

    let sold = 0;
    let evaluation = {
      evaluated: 0,
      ready: 0,
      trigger: 0,
      bought: 0,
      soldDuringEvaluation: 0,
      attempted: 0,
      mode: "OFF"
    };

    sold = await checkAllHoldings(state);

    if (phase === "LIVE") {
      evaluation = await evaluateWatchCandidates(state, {
        mode: "LIVE",
        batchSize: SETTINGS.liveEvaluationBatchSize
      });
    } else if (phase === "AFTER_CLOSE_PREP") {
      evaluation = await evaluateWatchCandidates(state, {
        mode: "AFTER_CLOSE_PREP",
        batchSize: firstAfterClosePass
          ? SETTINGS.preEvaluationBatchSize
          : SETTINGS.retryUnevaluatedBatchSize,
        onlyUnevaluated: !firstAfterClosePass
      });
      state.preEvaluation.afterCloseDate = date;
      state.preEvaluation.afterCloseAt = nowText();
      state.preEvaluation.afterCloseRetryCount = firstAfterClosePass
        ? 0
        : toNumber(state.preEvaluation.afterCloseRetryCount) + 1;
      state.preEvaluation.analysisRuleVersion = ANALYSIS_RULE_VERSION;
      state.preEvaluation.ruleRefreshPending = false;
      console.log(
        `[WAVE 야간사전평가] 시도 ${evaluation.attempted} / 완료 ${evaluation.evaluated} / ` +
        `READY ${state.watchlist.filter(item => item.status === "READY").length} / ` +
        `사전TRIGGER ${state.watchlist.filter(item =>
          ["WATCH", "READY"].includes(item.status) &&
          item.preSignalStatus === "TRIGGER" &&
          item.preSignalMode === "AFTER_CLOSE_PREP" &&
          item.preSignalDate === date
        ).length}`
      );
    } else if (phase === "MORNING_PREP") {
      // 08:40에 갱신된 open-market 데이터를 반영하기 위해 장전에는 활성 후보 전체를 다시 본다.
      dailyCache.clear();
      flowCache.clear();
      evaluation = await evaluateWatchCandidates(state, {
        mode: "MORNING_PREP",
        batchSize: firstMorningPass
          ? SETTINGS.preEvaluationBatchSize
          : SETTINGS.retryUnevaluatedBatchSize,
        onlyUnevaluated: !firstMorningPass
      });
      state.preEvaluation.morningDate = date;
      state.preEvaluation.morningAt = nowText();
      state.preEvaluation.morningRetryCount = firstMorningPass
        ? 0
        : toNumber(state.preEvaluation.morningRetryCount) + 1;
      state.preEvaluation.analysisRuleVersion = ANALYSIS_RULE_VERSION;
      state.preEvaluation.ruleRefreshPending = false;
      console.log(
        `[WAVE 장전사전평가] 시도 ${evaluation.attempted} / 완료 ${evaluation.evaluated} / ` +
        `READY ${state.watchlist.filter(item => item.status === "READY").length} / ` +
        `사전TRIGGER ${state.watchlist.filter(item =>
          ["WATCH", "READY"].includes(item.status) &&
          item.preSignalStatus === "TRIGGER" &&
          item.preSignalMode === "MORNING_PREP" &&
          item.preSignalDate === date
        ).length}`
      );
    }

    sold += toNumber(evaluation.soldDuringEvaluation);

    dropExpiredOrBrokenCandidates(state);
    trimWatchlist(state);

    state.lastRunAt = nowText();
    state.lastRunAtMs = Date.now();
    state.lastRunSummary = {
      hotAdded,
      priorityAdded,
      ...evaluation,
      sold,
      phase,
      hhmm: getCurrentHHMM()
    };
    state.summary = refreshSummaryAndDailyStats(state);
    saveState(state);

    console.log(
      `[WAVE ${phase}] 후보+${hotAdded + priorityAdded} / 평가 ${evaluation.evaluated} / ` +
      `READY ${state.summary.readyCount} / TRIGGER ${state.summary.triggerCount} / 보유 ${state.summary.holdingCount} / ` +
      `오늘매수 ${state.summary.todayBuyCount} / 매도 ${sold} / ` +
      `당일손익 ${toNumber(state.summary.todayNetProfit).toLocaleString("ko-KR")}원 ` +
      `(${toNumber(state.summary.todayReturnRate).toFixed(3)}%)`
    );

    return { ok: true, state };
  } catch (err) {
    console.error("[WAVE 실행 오류]", err.message);
    state.lastRunError = err.message;
    state.lastRunErrorAt = nowText();
    saveState(state);
    return { ok: false, reason: err.message, state };
  } finally {
    running = false;
  }
}

function startWaveStrategy() {
  if (started) {
    console.log("[WAVE] 이미 실행 중");
    return;
  }
  started = true;
  console.log(
    `[WAVE] 시작 v${STRATEGY_VERSION} / 매수 ${SETTINGS.buyStartTime}~${SETTINGS.buyEndTime} / ` +
    `장마감 사전분석 ${SETTINGS.afterClosePreEvalStartTime}~ / 장전 재분석 ${SETTINGS.morningPreEvalStartTime}~${SETTINGS.morningPreEvalEndTime} / ` +
    `WHY+MONEY+SECTOR ${SETTINGS.foundationMinScore}점 이상 / 총 ${SETTINGS.totalBuyMinScore}점 이상`
  );

  // 서버 시작 시 후보를 즉시 적재한다. 장 마감 후라면 활성 WATCH 전체 사전분석까지 진행하지만
  // 실제 모의매수는 isBuyTime() + LIVE 평가에서만 허용한다.
  runWaveOnce().catch(err => console.error("[WAVE 시작 1회 오류]", err.message));

  // 재시작 시각과 무관하게 5분 정각(09:00, 09:05, 09:10...)에 맞춰 실행한다.
  // 따라서 전날 저녁에 서버를 재시작해도 다음 거래일 09:00에 WAVE 평가가 즉시 시작된다.
  const nowMs = Date.now();
  const remainder = nowMs % SETTINGS.loopMs;
  const firstDelayMs = remainder === 0 ? SETTINGS.loopMs : SETTINGS.loopMs - remainder;

  alignmentTimer = setTimeout(() => {
    runWaveOnce().catch(err => console.error("[WAVE 정각 실행 오류]", err.message));

    timer = setInterval(() => {
      runWaveOnce().catch(err => console.error("[WAVE 반복 오류]", err.message));
    }, SETTINGS.loopMs);

    if (typeof timer.unref === "function") timer.unref();
  }, firstDelayMs);

  if (typeof alignmentTimer.unref === "function") alignmentTimer.unref();

  // 5분 후보평가와 겹치지 않도록 매분 30초 지점에 보유종목 현재가 위험관리만 빠르게 수행한다.
  const holdingInterval = SETTINGS.holdingCheckMs;
  const holdingTargetOffset = Math.floor(holdingInterval / 2);
  const holdingCurrentOffset = Date.now() % holdingInterval;
  let firstHoldingDelayMs =
    (holdingTargetOffset - holdingCurrentOffset + holdingInterval) % holdingInterval;
  if (firstHoldingDelayMs === 0) firstHoldingDelayMs = holdingInterval;

  holdingAlignmentTimer = setTimeout(() => {
    runWaveHoldingMonitorOnce().catch(err =>
      console.error("[WAVE 보유감시 정렬 실행 오류]", err.message)
    );

    holdingTimer = setInterval(() => {
      runWaveHoldingMonitorOnce().catch(err =>
        console.error("[WAVE 보유감시 반복 오류]", err.message)
      );
    }, holdingInterval);

    if (typeof holdingTimer.unref === "function") holdingTimer.unref();
  }, firstHoldingDelayMs);

  if (typeof holdingAlignmentTimer.unref === "function") holdingAlignmentTimer.unref();
}

function getWaveSummary() {
  const state = loadState();
  return makeSummary(state);
}

module.exports = {
  SETTINGS,
  STATE_FILE,
  startWaveStrategy,
  runWaveOnce,
  runWaveHoldingMonitorOnce,
  loadWaveState: loadState,
  getWaveSummary,
  // 순수 점수함수는 가상검증/테스트용으로 내보낸다.
  scoreWhy,
  scoreMoney,
  scoreSector,
  scoreTrend,
  scorePullback,
  scoreRebound,
  analyzeCandidate,
  getTriggerReadiness,
  inferSectorKey,
  headlineMentionsCandidate,
  validateWavePriceData,
  getEffectiveDailyBuyLimit,
  getWeakTrendExitDecision,
  getStagnationExitDecision,
  applyHoldingPriceRisk,
  calculatePortfolioSnapshot,
  getWaveProtectFloorProfitRate
};
