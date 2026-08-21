const fs = require("fs");
const path = require("path");

const STATE_FILE = path.join(__dirname, "paper-state-core.json");
const OPEN_HISTORY_FILE = path.join(__dirname, "open-learning-history.json");
const OPEN_MARKET_FILE = path.join(__dirname, "open-market.json");
const HOT_CANDIDATES_FILE = path.join(__dirname, "hot-candidates.json");
const HOT_HISTORY_FILE = path.join(__dirname, "hot-candidates-history.json");
// 같은 서버의 내부 API는 DNS 해석을 거치지 않도록 IPv4 loopback을 고정한다.
const API_BASE = process.env.SY_QUANT_API_BASE || "http://127.0.0.1:3000";


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
  openPriorityMaxCount: 20,
openFallbackScanLimit: 200,
openPriorityPriceDelayMs: 350,

// 한번 발견한 OPEN 후보를 집중 재확인
openFocusedCandidateMaxCount: 30,
openFocusedPriceDelayMs: 150,

// 새로운 종목 유입을 위해 60초마다 일반검색도 다시 실행
openFullRescanIntervalMs: 30 * 1000,
// 09:12 이후에도 신규 종목 유입을 막지 않고 API 부하만 낮춘다.
openLateFullRescanIntervalMs: 60 * 1000,

// OPEN 잠재후보: 초기에 기준 미달이어도 짧게 집중 추적 후 정식후보로 승격
openPotentialEnabled: true,
openPotentialMinScore: 7,
openPotentialMaxCount: 30,
// 상태에는 상위 20개를 유지하되 실제 현재가 재조회는 상위 10개만 수행
openPotentialRecheckCount: 15,
openPotentialCheckIntervalMs: 5 * 1000,
openPotentialMaxAgeSeconds: 900,
// 키움 현재가 API 과호출 방지를 위한 종목 간 조회 간격
openPotentialPriceDelayMs: 250,

  openEnabled: true,
  openBuyStartTime: "09:00",
  openBuyEndTime: "09:30",
  openForceSellTime: "14:50",
  // OPEN 시작 가용현금 기준 종목당 20%, 하루 최대 5종목 매수
  openInvestmentRatio: 0.20,
  openMaxHoldingCount: 5,

  openMinDiscoverScore: 9,
  // OPEN 4.0: 장전 조사 종목 중 장중 실제 강세가 확인된 종목만 매수
  openMinChangeRate: 0.5,
  openMaxChangeRate: 10.0,
  openMinTradeVolumeRatio: 80,
  openMinDayPositionRate: 45,
  openMaxDayPositionRate: 98,
  openMinOpenPositionRate: -0.2,
  openMaxOpenPositionRate: 12.0,

  // 장전 우선종목 + 실시간 HOT 교집합 조건
  openPriorityRequired: false,
  openHotRequired: false,
  openHotMinScore: 45,
  openHotMaxAgeSeconds: 60,
  openHotScoreWeight: 0.50,
  openHotMomentumWeight: 0.50,
  openHotMomentumBonusMax: 30,
  // 현재 TOP 후보에서 밀려난 종목도 짧게 보존해 OPEN 평가로 전달한다.
  openHotHistoryEnabled: true,
  openHotHistoryMaxAgeSeconds: 180,
  openHotHistoryMaxCount: 30,
  openHotHistoryPriceDelayMs: 120,
  openPriorityScoreWeight: 0.30,
  openHotBonusMax: 50,
  openPriorityBonusMax: 30,

  // HOT Scanner 발견 종목을 OPEN 후보로 직접 유입
  openDirectHotEnabled: true,
  openDirectHotMaxCount: 30,
  openHotDirectMinChangeRate: 1.0,
  openHotDirectMaxChangeRate: 25.0,
  openHotDirectMinTradeVolumeRatio: 90,
  openHotDirectMinDayPositionRate: 30,
  openHotDirectMaxDayPositionRate: 98,
  

  // 적극매수 테스트: HOT 후보는 20초·2회 이상 관찰 후 지속강도 확인
openConfirmWaitMs: 20 * 1000,
openMinObservationCount: 2,
openMinStrongObservationCount: 1,
openMomentumMinScore: 18,
// API 응답 지연을 고려해 최근 표본을 180초 보존
openMomentumSampleWindowMs: 600 * 1000,

// OPEN 후보 점수 상승 추세 보너스
openScoreTrendBonusPerPoint: 4,
openRecentScoreTrendBonusPerPoint: 6,
openScoreTrendMaxBonus: 20,

// 강화확인 가격 움직임 평가
openConfirmMinPriceRiseRate: -0.30,
openConfirmMaxPriceRiseRate: 5.0,
openConfirmPriceBonusLow: 3,
openConfirmPriceBonusMedium: 7,
openConfirmPriceBonusHigh: 10,

// 바로 직전 확인 대비 가격 약화 차단
openRecentPriceWeakBlockRate: -0.50,


  openMinHoldingSeconds: 120,
openStopLossRate: -1.0,
  openTrailingStartRate: 2.0,
  openTrailingStopRate: 0.8,
  openStagnationStartRate: 1.5,
  openStagnationSeconds: 300,
  openMinProfitToStagnationSell: 0.8,
  openMaxHoldingMinutes: 60,

  // 트레일링 진입 종목은 더 오래 보유
openTrailingMaxHoldingMinutes: 180,
openTrailingForceSellTime: "14:50",

  openBuyLoopMs: 5 * 1000,
  openSellLoopMs: 5 * 1000,
  openBuyRequestTimeoutMs: 15 * 1000,
  dailyLossLimitRate: 0.01,

  // 가상후보 추적은 분석자료 저장용이며, 실제 매수 점수에는 반영하지 않음
  openLearningTopCount: 10,
  openVirtualTrackingCount: 10,
  // 실제 매수되지 않은 상위 후보 중 화면에 표시할 분석 개수
  openMissedAnalysisTopCount: 3,
  openVirtualLoopMs: 30 * 1000,

  openMarketMaxAgeHours: 18,
openMarketMinSuccessCount: 5,
openMarketMaxBonus: 15,
openSectorMaxBonus: 15,

// OPEN 시장상황 강력 반영
openMarketDataRequired: false,

// 전체 시장 기본 차단선. 다만 25~39점 구간은 아래 "초강력 후보 예외"만 허용한다.
openMarketHardBlockScore: 40,
// 이 점수 미만은 어떤 후보도 예외 없이 매수하지 않는다.
openMarketAbsoluteBlockScore: 25,

// 매우 약한 시장(25~39점)에서도 종목 자체 흐름이 압도적으로 강한 경우만 예외 허용
openWeakMarketStrongOverrideEnabled: true,
openWeakMarketStrongMinDiscoverScore: 9,
openWeakMarketStrongMinMomentumScore: 75,
openWeakMarketStrongMinPricePersistence: 0.75,
openWeakMarketStrongMinVolumePersistence: 0.75,
openWeakMarketStrongMinObservationCount: 4,
openWeakMarketStrongMinStrongObservationCount: 3,

// 약세구간에서는 강한 섹터 종목만 허용
openMarketWeakScore: 50,
openWeakMarketMinSectorBias: -2,

// 보통 이하 시장에서는 최소한 섹터가 약세면 안 됨
openMarketCautionScore: 60,
openCautionMinSectorBias: 0,

// 시장과 관계없이 해당 종목 섹터가 강한 약세면 차단
openSectorHardBlockBias: -8,

// 시장자료가 약할 때 추가 강화
openCautionDiscoverScoreAdd: 1,
openCautionVolumeRatioAdd: 20,
openCautionMinPriceRiseAdd: 0.05,

openWeakDiscoverScoreAdd: 2,
openWeakVolumeRatioAdd: 50,
openWeakMinPriceRiseAdd: 0.10,

// 시장 강화 후 발견점수가 계산상 불가능해지는 것을 방지
openMaxRequiredDiscoverScore: 11,

// 엄격 통과 후보가 없을 때 실제 매수 기회를 만드는 보완매수
openFallbackBuyEnabled: true,
openFallbackBuyStartTime: "09:03",
openFallbackMinDiscoverScore: 9,
openFallbackMinChangeRate: 0.5,
openFallbackMaxChangeRate: 10.0,
openFallbackMinTradeVolumeRatio: 80,
openFallbackMinDayPositionRate: 35,
openFallbackMaxDayPositionRate: 98,
openFallbackMinOpenPositionRate: -0.5,
openFallbackMaxOpenPositionRate: 12.0,
openFallbackMaxFirstPriceDropRate: -0.30,
// 보완후보도 최소 20초·2회 지속강도는 확인하되 진입기회를 넓힌다.
openFallbackMomentumRequired: true,
// 8/19 삼성공조처럼 지속강도 40점대 후보가 보완매수되는 것을 막는다.
openFallbackMinMomentumScore: 50,
openLateFallbackStartTime: "09:12"
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

/*
 * OPEN 5.0 거래량 기준
 * 장 시작 직후에는 거래량이 아직 누적되지 않으므로 낮게 시작하고,
 * 시간이 지날수록 확인 기준을 단계적으로 높인다.
 */
function getOpenTimeVolumeRatio(hhmm = getCurrentHHMM()) {
  if (hhmm < "09:05") return 80;
  if (hhmm < "09:10") return 90;
  if (hhmm < "09:20") return 110;
  return 130;
}

function getOpenRequiredVolumeRatio(marketScore = 0, marketAvailable = false) {
  const hhmm = getCurrentHHMM();
  const timeBase = getOpenTimeVolumeRatio(hhmm);

  let marketAdd = 0;
  if (marketAvailable) {
    if (marketScore >= 80) marketAdd = 0;
    else if (marketScore >= 60) marketAdd = 10;
    else if (marketScore >= 40) marketAdd = 20;
    else marketAdd = 50;
  }

  return {
    hhmm,
    timeBase,
    marketAdd,
    required: timeBase + marketAdd
  };
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
  /* server.js의 주문 API가 관리하는 원장을 오래된 OPEN 스캔이 덮지 않게 한다. */
  const latest = fs.existsSync(STATE_FILE)
    ? readJsonFileSafe(STATE_FILE, {})
    : {};
  const merged = { ...state };
  for (const key of [
    "holdings", "tradeLogs", "virtualResults", "totalCash",
    "completedFullSellCodes", "completedOpenSellCodes"
  ]) {
    if (Object.prototype.hasOwnProperty.call(latest, key)) merged[key] = latest[key];
  }
  writeJsonFileAtomic(STATE_FILE, merged);
  replaceOpenStateSnapshot(state, merged);
}

function pushOpenLiveActivity(state, message, type = "INFO") {
  if (!Array.isArray(state.openLiveActivities)) state.openLiveActivities = [];
  const text = String(message || "").trim();
  if (!text) return;
  const last = state.openLiveActivities[state.openLiveActivities.length - 1];
  if (last && last.message === text && Date.now() - Number(last.atMs || 0) < 3000) return;
  state.openLiveActivities.push({
    at: nowText(),
    atMs: Date.now(),
    type,
    message: text
  });
  state.openLiveActivities = state.openLiveActivities.slice(-20);
}

function updateOpenLiveTracking(state, patch = {}, activityMessage = null, activityType = "INFO") {
  const previous = state.openLiveTracking && typeof state.openLiveTracking === "object"
    ? state.openLiveTracking
    : {};
  state.openLiveTracking = {
    ...previous,
    ...patch,
    date: todayKey(),
    updatedAt: nowText(),
    updatedAtMs: Date.now(),
    buyStartTime: settings.openBuyStartTime,
    buyEndTime: settings.openBuyEndTime,
    confirmWaitSeconds: Math.round(Number(settings.openConfirmWaitMs || 0) / 1000),
    minObservationCount: Number(settings.openMinObservationCount || 0),
    fallbackStartTime: settings.openFallbackBuyStartTime,
    fallbackMinDiscoverScore: Number(settings.openFallbackMinDiscoverScore || 0),
    maxHoldingCount: Number(settings.openMaxHoldingCount || 5),
    investmentRatio: Number(settings.openInvestmentRatio || 0.20)
  };
  if (activityMessage) pushOpenLiveActivity(state, activityMessage, activityType);
}

function ensureOpenDailyStats(state) {
  if (
    !state.openDailyStats ||
    typeof state.openDailyStats !== "object" ||
    state.openDailyStats.date !== todayKey()
  ) {
    state.openDailyStats = {
      date: todayKey(),
      scanCount: 0,
      candidateCodes: {},
      evaluatedCodes: {},
      strictPassedCodes: {},
      passWithoutMarketCodes: {},
      marketOnlyBlockedCodes: {},
      fallbackPassedCodes: {},
      selectedCodes: {},
      boughtCodes: {},
      hotInputCodes: {},
      latest: null
    };
  }
  for (const key of [
    "candidateCodes", "evaluatedCodes", "strictPassedCodes",
    "passWithoutMarketCodes", "marketOnlyBlockedCodes",
    "fallbackPassedCodes", "selectedCodes", "boughtCodes", "hotInputCodes"
  ]) {
    if (!state.openDailyStats[key] || typeof state.openDailyStats[key] !== "object") {
      state.openDailyStats[key] = {};
    }
  }
  return state.openDailyStats;
}

function addOpenDailyCode(target = {}, item = {}) {
  const code = normalizeOpenStockCode(item.code);
  if (!code) return;
  target[code] = item.name || item.stockName || item.korName || code;
}

function recordOpenDailyScan(state, { scanId, candidates = [], evaluated = [], strictPassed = [] } = {}) {
  const stats = ensureOpenDailyStats(state);
  stats.scanCount = Number(stats.scanCount || 0) + 1;

  for (const item of candidates) {
    addOpenDailyCode(stats.candidateCodes, item);
    if (
      item.source === "HOT" || item.originalSource === "HOT" ||
      item.isDirectHotCandidate === true || item.everDirectHotCandidate === true
    ) {
      addOpenDailyCode(stats.hotInputCodes, item);
    }
  }
  for (const entry of evaluated) {
    addOpenDailyCode(stats.evaluatedCodes, entry.item || entry.record || {});
    if (entry.record?.passWithoutMarket === true) {
      addOpenDailyCode(stats.passWithoutMarketCodes, entry.item || entry.record || {});
    }
    if (entry.record?.marketOnlyBlocked === true) {
      addOpenDailyCode(stats.marketOnlyBlockedCodes, entry.item || entry.record || {});
    }
  }
  for (const entry of strictPassed) addOpenDailyCode(stats.strictPassedCodes, entry.item || {});

  stats.latest = {
    scanId: Number(scanId || 0),
    checkedAt: nowText(),
    candidateCount: candidates.length,
    evaluatedCount: evaluated.length,
    strictPassedCount: strictPassed.length,
    passWithoutMarketCount: evaluated.filter(
      entry => entry.record?.passWithoutMarket === true
    ).length,
    marketOnlyBlockedCount: evaluated.filter(
      entry => entry.record?.marketOnlyBlocked === true
    ).length
  };
}

function recordOpenDailySelection(state, entry, fallback = false) {
  const stats = ensureOpenDailyStats(state);
  const item = entry?.item || {};
  addOpenDailyCode(stats.selectedCodes, item);
  if (fallback) addOpenDailyCode(stats.fallbackPassedCodes, item);
  stats.lastSelectedAt = nowText();
  stats.lastSelectedCode = normalizeOpenStockCode(item.code);
  stats.lastSelectedName = item.name || item.code || "";
  stats.lastSelectionType = fallback ? "FALLBACK" : "STRICT";
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value || 0)));
}

function parseOpenKstTimeMs(value) {
  const numeric = Number(value || 0);
  if (numeric > 1000000000000) return numeric;

  const text = String(value || "").trim();
  if (!text) return 0;

  const parsed = Date.parse(text);
  if (Number.isFinite(parsed)) return parsed;

  const match = text.match(
    /(\d{4})[.\/-]\s*(\d{1,2})[.\/-]\s*(\d{1,2}).*?(AM|PM|오전|오후)?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?/i
  );
  if (!match) return 0;

  let hour = Number(match[5]);
  const period = String(match[4] || "").toUpperCase();
  if ((period === "PM" || period === "오후") && hour < 12) hour += 12;
  if ((period === "AM" || period === "오전") && hour === 12) hour = 0;

  const iso =
    `${match[1]}-${String(match[2]).padStart(2, "0")}-${String(match[3]).padStart(2, "0")}` +
    `T${String(hour).padStart(2, "0")}:${match[6]}:${String(match[7] || "00").padStart(2, "0")}+09:00`;
  const result = Date.parse(iso);
  return Number.isFinite(result) ? result : 0;
}

function loadRecentHotHistoryItems() {
  if (!settings.openHotHistoryEnabled || !fs.existsSync(HOT_HISTORY_FILE)) return [];

  try {
    const history = readJsonFileSafe(HOT_HISTORY_FILE, {}) || {};
    if (String(history.date || "") !== todayKey()) return [];

    const detected = history.detected && typeof history.detected === "object"
      ? history.detected
      : {};
    const now = Date.now();
    const maxAgeMs = Number(settings.openHotHistoryMaxAgeSeconds || 180) * 1000;

    return Object.entries(detected)
      .map(([savedCode, record = {}]) => {
        const snapshot =
          record.latestSnapshot || record.latestItem || record.lastItem || record.latest || record.last ||
          record.item || record.snapshot || record;
        const code = String(snapshot.code || record.code || savedCode || "")
          .replace(/^A/i, "")
          .replace(/[^0-9]/g, "");
        if (!/^\d{6}$/.test(code)) return null;

        const lastDetectedAtMs = Number(
          record.lastDetectedAtMs || record.lastSeenAtMs || snapshot.updatedAtMs || 0
        ) || parseOpenKstTimeMs(
          record.lastDetectedAt || record.lastSeenAt || snapshot.updatedAt || history.updatedAt
        );
        if (!lastDetectedAtMs || now - lastDetectedAtMs > maxAgeMs) return null;

        return {
          ...snapshot,
          code,
          name:
            snapshot.name || snapshot.stockName || record.name || record.stockName || code,
          rank: Number(snapshot.rank || record.lastRank || record.bestRank || 0),
          // HOT-EARLY도 누적이력에 기록되므로 조기후보의 점수를
          // 최종 HOT 기준점수로 인위적으로 올리지 않는다.
          hotScore: snapshot.earlyHotCandidate === true
            ? Number(snapshot.hotScore || record.maxHotScore || 0)
            : Math.max(
                Number(settings.openHotMinScore || 45),
                Number(
                  snapshot.hotScore || record.lastHotScore ||
                  record.bestHotScore || record.maxHotScore || 0
                )
              ),
          earlyHotCandidate: snapshot.earlyHotCandidate === true,
          earlyHotStatus: snapshot.earlyHotStatus || null,
          changeRate: Number(
            snapshot.changeRate || record.lastChangeRate || record.maxChangeRate || 0
          ),
          tradeVolumeRatio: Number(
            snapshot.tradeVolumeRatio || snapshot.volumeRatio ||
            record.lastTradeVolumeRatio || record.maxTradeVolumeRatio || 0
          ),
          dayPositionRate: Number(
            snapshot.dayPositionRate || snapshot.dayPosition ||
            record.lastDayPositionRate || record.maxDayPositionRate || 0
          ),
          openMomentumScore: Number(
            snapshot.openMomentumScore || snapshot.hotMomentumScore ||
            record.lastMomentumScore || record.maxMomentumScore || 0
          ),
          firstDetectedAt: record.firstDetectedAt || null,
          lastDetectedAt: record.lastDetectedAt || null,
          lastDetectedAtMs,
          hotHistoryAgeSeconds: Math.max(0, (now - lastDetectedAtMs) / 1000),
          fromHotHistory: true
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        const timeDiff = Number(b.lastDetectedAtMs || 0) - Number(a.lastDetectedAtMs || 0);
        if (timeDiff !== 0) return timeDiff;
        return Number(b.openMomentumScore || 0) - Number(a.openMomentumScore || 0);
      })
      .slice(0, Number(settings.openHotHistoryMaxCount || 30));
  } catch (err) {
    console.log(`[OPEN HOT 누적이력 오류] ${err.message}`);
    return [];
  }
}

function loadHotCandidates() {
  try {
    const data = fs.existsSync(HOT_CANDIDATES_FILE)
      ? readJsonFileSafe(HOT_CANDIDATES_FILE, {})
      : {};
    const updatedAtMs = Number(data.updatedAtMs || 0);
    const ageSeconds = updatedAtMs > 0
      ? (Date.now() - updatedAtMs) / 1000
      : 9999;
    const finalItems = (Array.isArray(data.items)
      ? data.items
      : Array.isArray(data.rows)
        ? data.rows
        : Array.isArray(data.candidates)
          ? data.candidates
          : []);
    const earlyItems = Array.isArray(data.earlyRows) ? data.earlyRows : [];
    // 같은 종목이 최종 HOT에도 있으면 최종 HOT 자료가 우선한다.
    const currentMap = new Map();
    for (const item of earlyItems) {
      const code = String(item.code || "").replace(/[^0-9]/g, "");
      if (/^\d{6}$/.test(code)) currentMap.set(code, { ...item, fromHotHistory: false });
    }
    for (const item of finalItems) {
      const code = String(item.code || "").replace(/[^0-9]/g, "");
      if (/^\d{6}$/.test(code)) currentMap.set(code, { ...item, fromHotHistory: false });
    }
    const currentItems = Array.from(currentMap.values());
    const fresh = ageSeconds <= Number(settings.openHotMaxAgeSeconds || 60);
    const historyItems = loadRecentHotHistoryItems();
    const mergedByCode = new Map();

    for (const item of historyItems) {
      const code = String(item.code || "").replace(/[^0-9]/g, "");
      if (/^\d{6}$/.test(code)) mergedByCode.set(code, item);
    }
    if (fresh) {
      for (const item of currentItems) {
        const code = String(item.code || "").replace(/[^0-9]/g, "");
        if (/^\d{6}$/.test(code)) mergedByCode.set(code, item);
      }
    }

    const items = Array.from(mergedByCode.values());
    const byCode = {};

    for (const item of items) {
      const code = String(item.code || "").replace(/[^0-9]/g, "");
      if (!/^\d{6}$/.test(code)) continue;
      byCode[code] = item;
    }

    if (!items.length) {
      return {
        available: false,
        reason:
          `HOT 자료 사용불가 / 현재 ${currentItems.length}개 / ` +
          `누적 ${historyItems.length}개 / 경과 ${ageSeconds.toFixed(1)}초`,
        ageSeconds,
        items,
        byCode
      };
    }

    return {
      available: true,
      ageSeconds: fresh
        ? ageSeconds
        : Math.min(...historyItems.map(item => Number(item.hotHistoryAgeSeconds || 9999))),
      updatedAt: data.updatedAt || null,
      currentCount: fresh ? currentItems.length : 0,
      earlyCount: fresh ? earlyItems.length : 0,
      historyCount: historyItems.length,
      items,
      byCode
    };
  } catch (err) {
    return { available: false, reason: `HOT 자료 읽기 오류 / ${err.message}`, items: [], byCode: {} };
  }
}

function attachHotData(item = {}, hotData = {}) {
  const code = String(item.code || "").replace(/[^0-9]/g, "");
  const hot = hotData?.byCode?.[code] || null;

  return {
    ...item,
    hotMatched: Boolean(hot),
    everHotMatched: item.everHotMatched === true || Boolean(hot),
    hotScore: Number(hot?.hotScore ?? item.hotScore ?? 0),
    hotRank: Number(hot?.rank || 0),
    hotChangeRate: Number(hot?.changeRate || 0),
    hotVolumeRatio: Number(hot?.tradeVolumeRatio || hot?.volumeRatio || 0),
    hotDayPosition: Number(hot?.dayPositionRate || hot?.dayPosition || 0),
    hotMomentumScore: Number(hot?.openMomentumScore ?? item.hotMomentumScore ?? 0),
    hotPriceRise30s: Number(hot?.priceRise30s ?? item.hotPriceRise30s ?? 0),
    hotVolumeGrowth30s: Number(hot?.volumeGrowth30s ?? item.hotVolumeGrowth30s ?? 0),
    hotPricePersistence: Number(hot?.pricePersistence ?? item.hotPricePersistence ?? 0),
    hotVolumePersistence: Number(hot?.volumePersistence ?? item.hotVolumePersistence ?? 0),
    hotHighRefreshCount: Number(hot?.highRefreshCount ?? item.hotHighRefreshCount ?? 0),
    hotDurationSeconds: Number(hot?.hotDurationSeconds ?? item.hotDurationSeconds ?? 0),
    hotUpdatedAt: hot?.lastDetectedAt || hotData?.updatedAt || null,
    hotAgeSeconds: Number(hot?.hotHistoryAgeSeconds ?? hotData?.ageSeconds ?? 0),
    fromHotHistory: hot?.fromHotHistory === true
  };
}


function buildDirectHotCandidates(hotData = {}) {
  if (!settings.openDirectHotEnabled || !hotData?.available) return [];

  return (Array.isArray(hotData.items) ? hotData.items : [])
    .slice(0, Number(settings.openDirectHotMaxCount || 20))
    .map((hot, index) => {
      const code = String(hot.code || hot.stk_cd || hot.stockCode || "")
        .replace(/^A/i, "")
        .replace(/[^0-9]/g, "");
      if (!/^\d{6}$/.test(code)) return null;
      const hotScore = Number(hot.hotScore || 0);
      const isEarlyHot = hot.earlyHotCandidate === true || hot.candidateSource === "HOT_EARLY";
      return {
        ...hot,
        code,
        name: hot.name || hot.stockName || hot.korName || hot.stk_nm || code,
        source: "HOT",
        originalSource: isEarlyHot ? "HOT_EARLY" : "HOT",
        candidateSource: isEarlyHot ? "HOT_EARLY" : "HOT",
        isDirectHotCandidate: true,
        everDirectHotCandidate: true,
        // 조기후보는 HOT 최종점수 검사를 우회하되 OPEN 지속성 확인은 유지한다.
        hotMatched: !isEarlyHot,
        earlyHotCandidate: isEarlyHot,
        earlyHotStatus: hot.earlyHotStatus || null,
        hotRank: Number(hot.rank || index + 1),
        hotScore,
        discoverScore: Math.max(
          Number(settings.openMinDiscoverScore || 9),
          Number(hot.discoverScore ?? Math.max(7, Math.round(hotScore / 10)))
        ),
        changeRate: Number(hot.changeRate || hot.fluctuationRate || hot.riseRate || hot.rate || 0),
        tradeVolumeRatio: Number(hot.tradeVolumeRatio || hot.volumeRatio || hot.hotVolumeRatio || 0),
        dayPosition: Number(hot.dayPositionRate || hot.dayPosition || 0),
        hotMomentumScore: Number(hot.openMomentumScore || hot.hotMomentumScore || 0),
        hotPriceRise30s: Number(hot.priceRise30s || 0),
        hotVolumeGrowth30s: Number(hot.volumeGrowth30s || 0),
        hotPricePersistence: Number(hot.pricePersistence || 0),
        hotVolumePersistence: Number(hot.volumePersistence || 0),
        hotHighRefreshCount: Number(hot.highRefreshCount || 0),
        hotDurationSeconds: Number(hot.hotDurationSeconds || 0),
        fromHotHistory: hot.fromHotHistory === true,
        hotLastDetectedAt: hot.lastDetectedAt || null,
        hotLastDetectedAtMs: Number(hot.lastDetectedAtMs || 0)
      };
    })
    .filter(Boolean);
}

async function enrichHistoricalHotCandidates(rows = []) {
  const enriched = [];

  for (const row of rows) {
    if (!row.fromHotHistory) {
      enriched.push(row);
      continue;
    }

    try {
      const data = await fetchJson(
        `${API_BASE}/api/price?code=${encodeURIComponent(row.code)}`
      );
      const scoreInfo = calculateOpenDiscoverScore(data);
      enriched.push({
        ...row,
        ...data,
        ...scoreInfo,
        code: normalizeOpenStockCode(data.code || row.code || ""),
        name: data.name || row.name || row.code,
        source: "HOT",
        originalSource: "HOT",
        candidateSource: "HOT_HISTORY",
        isDirectHotCandidate: true,
        everDirectHotCandidate: true,
        hotMatched: true,
        fromHotHistory: true,
        discoverScore: Math.max(
          Number(settings.openFallbackMinDiscoverScore || 9),
          Number(row.discoverScore || 0),
          Number(scoreInfo.discoverScore || 0)
        )
      });
    } catch (err) {
      console.log(
        `[OPEN HOT 누적후보 조회실패] ${row.name || row.code} / ${err.message}`
      );
    }

    await sleep(Number(settings.openHotHistoryPriceDelayMs || 120));
  }

  return enriched;
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

  marketScore:
    Number(data.marketScore || 0),

  marketType:
    data.marketType || "NORMAL",

  sectorBias:
    data.sectorBias || {},

  newsScore:
    Number(data.newsScore || 0),

  reasons:
    Array.isArray(data.reasons)
      ? data.reasons
      : [],

  updatedAt:
    data.updatedAt || null,

  indicators:
    data.indicators || {},

  priorityStocks:
    Array.isArray(data.priorityStocks)
      ? data.priorityStocks
      : [],

  raw: data
};
  } catch (err) {
    return { available: false, reason: `시장자료 읽기 오류 / ${err.message}` };
  }
}

function getItemContextText(item = {}) {
  const values = [
    item.name, item.stockName, item.korName, item.industry, item.sector,
    item.theme, item.sectorName, item.industryName, item.prioritySector,
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

  if (
    /반도체|semiconductor|hbm|메모리|파운드리|웨이퍼|칩|pcb|후공정|패키징|sk하이닉스|삼성전자/.test(text)
  ) {
    sectors.push("semiconductor");
  }

  if (
    /인공지능|\bai\b|artificial intelligence|로봇|클라우드|데이터센터|소프트웨어|자율주행|스마트팩토리/.test(text)
  ) {
    sectors.push("ai");
  }

  if (
    /성장주|growth|인터넷|플랫폼|바이오|게임|2차전지|전기차/.test(text)
  ) {
    sectors.push("growth");
  }

  if (
    /정유|석유|원유|가스|에너지|energy|유전|태양광|풍력|원전/.test(text)
  ) {
    sectors.push("energy");
  }

  if (
    /통신|음식료|보험|은행|유틸리티|필수소비재|defensive/.test(text)
  ) {
    sectors.push("defensive");
  }

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
      virtualCandidates: [],
      virtualDroppedCandidates: [],
      virtualCandidateConsidered: {},
      virtualObservedCandidates: [],
      virtualRankingFinalizedAt: null
    };
  }

  if (!Array.isArray(history.days[date].virtualCandidates)) {
    history.days[date].virtualCandidates = [];
  }
  if (!Array.isArray(history.days[date].virtualObservedCandidates)) {
    history.days[date].virtualObservedCandidates = [];
  }
  if (!Array.isArray(history.days[date].virtualDroppedCandidates)) {
    history.days[date].virtualDroppedCandidates = [];
  }
  if (
    !history.days[date].virtualCandidateConsidered ||
    typeof history.days[date].virtualCandidateConsidered !== "object"
  ) {
    history.days[date].virtualCandidateConsidered = {};
  }

  return history.days[date];
}


function normalizeOpenStockCode(value) {
  const match = String(value || "").match(/\d{6}/);
  return match ? match[0] : "";
}


function classifyOpenRejectReason(reason = "", passed = false) {
  if (passed) {
    return { rejectCategory: "통과", rejectStage: "PASSED" };
  }

  const value = String(reason || "");

  if (/OPEN OFF|오늘 OPEN 종료|이미 매수|이미 보유|손실한도|매수시간/.test(value)) {
    return { rejectCategory: "운영상태", rejectStage: "STATE" };
  }
  if (/시장자료|시장절대|시장급락|섹터약세|약세장|주의장/.test(value)) {
    return { rejectCategory: "시장·섹터", rejectStage: "MARKET" };
  }
  if (/발견점수 부족|일반후보 추가확인|HOT 점수 부족/.test(value)) {
    return { rejectCategory: "발견점수 부족", rejectStage: "DISCOVER" };
  }
  if (/상승률 부적합/.test(value)) {
    return { rejectCategory: "상승률 부적합", rejectStage: "CHANGE_RATE" };
  }
  if (/거래량 부족|거래량 약화/.test(value)) {
    return { rejectCategory: "거래량 부족", rejectStage: "VOLUME" };
  }
  if (/당일위치 부적합|시가대비 부적합/.test(value)) {
    return { rejectCategory: "가격위치 부적합", rejectStage: "POSITION" };
  }
  if (/첫 발견|확인 대기|관찰 부족/.test(value)) {
    return { rejectCategory: "관찰 부족", rejectStage: "OBSERVATION" };
  }
  if (/지속성 부족|지속강도|점수 약화|가격 약화|가격 하락|가격 급등|상승힘 부족/.test(value)) {
    return { rejectCategory: "지속강도 부족", rejectStage: "MOMENTUM" };
  }

  return {
    rejectCategory: value || "기타 조건 미충족",
    rejectStage: "OTHER"
  };
}

function isOpenMarketRejectReason(reason = "") {
  return /시장자료 없음 차단|시장절대차단|시장급락 차단|섹터약세 차단|약세장 강한섹터 아님|주의장 섹터부족/.test(
    String(reason || "")
  );
}

function makeOpenCandidateLearningRecord(state, item, price, judged = {}) {
  const observedAtMs = Date.now();
  const code = normalizeOpenStockCode(item.code);
  const candidateHistory =
    state?.openCandidateHistory?.[code] || {};
  const observedMomentum =
    calculateOpenMomentumStrength(candidateHistory);
  const historyObservationCount = Array.isArray(candidateHistory.samples)
    ? candidateHistory.samples.length
    : 0;

  function judgedOrObserved(key, observedKey = key) {
    if (
      Object.prototype.hasOwnProperty.call(judged, key) &&
      Number.isFinite(Number(judged[key]))
    ) {
      return Number(judged[key]);
    }
    return Number(observedMomentum?.[observedKey] || 0);
  }

  const rejectInfo = classifyOpenRejectReason(
    judged.reason || "",
    judged.pass === true
  );
  const withoutMarketRejectInfo = classifyOpenRejectReason(
    judged.withoutMarketReason || judged.reason || "",
    judged.passWithoutMarket === true
  );

  const changeRate = Number(
    item.changeRate ||
    item.fluctuationRate ||
    item.riseRate ||
    item.rate ||
    0
  );

  const volumeRatio = getTradeVolumeRatio(item);
  const dayPosition = getDayPositionRate(item, price);
  const momentumScore = judgedOrObserved("momentumScore");
  const hasPriorityOrHotSignal =
    item.isPriorityCandidate === true ||
    item.source === "PRIORITY" ||
    item.hotMatched === true ||
    item.everHotMatched === true ||
    item.isDirectHotCandidate === true ||
    item.everDirectHotCandidate === true ||
    item.originalSource === "HOT" ||
    item.source === "HOT";
  const defaultRequiredDiscoverScore = Math.min(
    Number(settings.openMaxRequiredDiscoverScore || 11),
    Number(settings.openMinDiscoverScore || 0) +
      (hasPriorityOrHotSignal ? 0 : 1)
  );
  const diagnosticRankScore = Number((
    Number(item.discoverScore || 0) * 10 +
    Math.min(volumeRatio, 500) * 0.15 +
    dayPosition * 0.25 +
    momentumScore
  ).toFixed(1));

  return {
    code,
    name: item.name || item.stockName || item.korName || item.code || "",
    observedAt: nowText(),
    observedAtMs,
    price: Number(price || 0),
    discoverScore: Number(item.discoverScore || 0),
    changeRate,
    volumeRatio,
    dayPosition,
    openPosition: getOpenPositionRate(item, price),
    passed: judged.pass === true,
    passWithoutMarket: judged.passWithoutMarket === true,
    marketOnlyBlocked: judged.marketOnlyBlocked === true,
    withoutMarketReason: judged.withoutMarketReason || judged.reason || "",
    withoutMarketRejectCategory: withoutMarketRejectInfo.rejectCategory,
    withoutMarketRejectStage: withoutMarketRejectInfo.rejectStage,
    withoutMarketRankScore: Number(
      judged.withoutMarketRankScore ?? judged.rankScore ?? 0
    ),
    rankScore:
      judged.rankScore !== undefined &&
      Number.isFinite(Number(judged.rankScore))
        ? Number(judged.rankScore)
        : diagnosticRankScore,
    reason: judged.reason || "",
    rejectCategory: rejectInfo.rejectCategory,
    rejectStage: rejectInfo.rejectStage,
    source: item.source || "FALLBACK",
    originalSource: item.originalSource || item.source || "FALLBACK",
    isDirectHotCandidate:
      item.isDirectHotCandidate === true ||
      item.everDirectHotCandidate === true ||
      item.originalSource === "HOT" ||
      item.source === "HOT",
    hotMatched:
      item.hotMatched === true ||
      item.everHotMatched === true ||
      item.isDirectHotCandidate === true ||
      item.everDirectHotCandidate === true,
    isPriorityCandidate:
      item.isPriorityCandidate === true ||
      item.source === "PRIORITY",
    marketScore: Number(judged.marketScore || 0),
    marketType: judged.marketType || null,
    marketBonus: Number(judged.marketBonus || 0),
    sectorBonus: Number(judged.sectorBonus || 0),
    priorityBonus: Number(judged.priorityBonus || 0),
    scoreTrendBonus: Number(judged.scoreTrendBonus || 0),
    confirmPriceBonus: Number(judged.confirmPriceBonus || 0),
    momentumScore,
    priceRiseRate: judgedOrObserved("priceRiseRate"),
    volumeGrowthRate: judgedOrObserved("volumeGrowthRate"),
    scoreGrowth: judgedOrObserved("scoreGrowth"),
    pricePersistence: judgedOrObserved("pricePersistence"),
    volumePersistence: judgedOrObserved("volumePersistence"),
    observationCount:
      judged.observationCount !== undefined
        ? Number(judged.observationCount || 0)
        : historyObservationCount,
    strongObservationCount:
      judged.strongObservationCount !== undefined
        ? Number(judged.strongObservationCount || 0)
        : Number(observedMomentum.strongCount || 0),
    requiredDiscoverScore:
      Number(judged.requiredDiscoverScore || 0) ||
      defaultRequiredDiscoverScore,
    requiredVolumeRatio: Number(judged.requiredVolumeRatio || 0),
    requiredConfirmPriceRise: Number(judged.requiredConfirmPriceRise || 0),
    matchedSectors: Array.isArray(judged.matchedSectors) ? judged.matchedSectors : [],
    marketDataUpdatedAt: judged.marketDataUpdatedAt || null
  };
}


function getLearningCandidateSortScore(record = {}) {
  if (record.passWithoutMarket === true || record.passed === true) {
    return 100000 + Number(
      record.withoutMarketRankScore ?? record.rankScore ?? 0
    );
  }

  const baseScore =
    Number(record.discoverScore || 0) * 10 +
    Math.min(Number(record.volumeRatio || 0), 500) * 0.15 +
    Number(record.dayPosition || 0) * 0.25;

  /* 관찰용 순위에서도 과열 종목이 거래량만으로 상단을 차지하지 않게 한다. */
  const maxChangeRate = record.isDirectHotCandidate === true
    ? Number(settings.openHotDirectMaxChangeRate || 25)
    : Number(settings.openMaxChangeRate || 10);
  const changePenalty = Math.max(
    0,
    Number(record.changeRate || 0) - maxChangeRate
  ) * 10;
  const openPositionPenalty = Math.max(
    0,
    Number(record.openPosition || 0) - Number(settings.openMaxOpenPositionRate || 12)
  ) * 10;
  const dayPositionPenalty = Math.max(
    0,
    Number(record.dayPosition || 0) - Number(settings.openMaxDayPositionRate || 98)
  ) * 5;

  return baseScore - changePenalty - openPositionPenalty - dayPositionPenalty;
}

function refreshOpenVirtualCandidateRanks(day) {
  if (!Array.isArray(day.virtualCandidates)) day.virtualCandidates = [];
  day.virtualCandidates.sort((a, b) => {
    const scoreDiff =
      Number(b.counterfactualRankScore || 0) -
      Number(a.counterfactualRankScore || 0);
    if (scoreDiff !== 0) return scoreDiff;
    return Number(a.entryTimeMs || 0) - Number(b.entryTimeMs || 0);
  });
  day.virtualCandidates.forEach((candidate, index) => {
    candidate.rank = index + 1;
  });
}

function initializeOpenVirtualTracking(records, selectedCode = null) {
  const history = loadOpenHistory();
  const day = getOpenLearningDay(history);
  const normalizedSelectedCode = normalizeOpenStockCode(selectedCode);
  const maxCandidates = Number(settings.openVirtualTrackingCount || 10);
  let addedCount = 0;
  let changed = false;

  for (const source of records || []) {
    const record = source?.record || source;
    const code = normalizeOpenStockCode(record?.code);
    const price = Number(record?.price || 0);
    if (!code || !price || record?.passWithoutMarket !== true) continue;

    let candidate = day.virtualCandidates.find(
      row => normalizeOpenStockCode(row.code) === code
    );

    if (!candidate) {
      if (day.virtualCandidateConsidered[code]) continue;

      const firstCounterfactualRankScore = Number(
        record.withoutMarketRankScore ?? record.rankScore ?? 0
      );
      day.virtualCandidateConsidered[code] = {
        consideredAt: record.observedAt || nowText(),
        consideredAtMs: Number(record.observedAtMs || Date.now()),
        entryPrice: price,
        counterfactualRankScore: firstCounterfactualRankScore
      };

      if (day.virtualCandidates.length >= maxCandidates) {
        refreshOpenVirtualCandidateRanks(day);
        const lowest = day.virtualCandidates[day.virtualCandidates.length - 1];
        if (
          firstCounterfactualRankScore <=
          Number(lowest?.counterfactualRankScore || 0)
        ) {
          day.virtualCandidateOverflowCount =
            Number(day.virtualCandidateOverflowCount || 0) + 1;
          changed = true;
          continue;
        }

        day.virtualDroppedCandidates.push({
          ...lowest,
          active: false,
          droppedAt: nowText(),
          droppedAtMs: Date.now(),
          dropReason:
            `가상 TOP${maxCandidates} 순위교체 / ` +
            `${Number(lowest.counterfactualRankScore || 0).toFixed(1)}` +
            `→${firstCounterfactualRankScore.toFixed(1)}`
        });
        day.virtualDroppedCandidates = day.virtualDroppedCandidates.slice(-30);
        day.virtualCandidates = day.virtualCandidates.filter(
          row => normalizeOpenStockCode(row.code) !== normalizeOpenStockCode(lowest.code)
        );
        console.log(
          `[OPEN 가상순위 교체] ` +
          `${lowest.name || lowest.code} 제외 / ${record.name || code} 진입`
        );
      }

      const entryTimeMs = Number(record.observedAtMs || Date.now());
      candidate = {
        rank: 0,
        candidateGroup: "OPEN_BUYABLE",
        code,
        name: record.name || code,
        selectedForRealTrade: code === normalizedSelectedCode,
        missedAnalysisEligible: code !== normalizedSelectedCode,
        rejectReason: record.passed === true
          ? "실제 엄격조건 통과"
          : (record.reason || "시장차단"),
        marketOnlyBlockedAtEntry: record.marketOnlyBlocked === true,
        actualDecisionAtEntry: record.reason || "",
        eligibilityReason: record.withoutMarketReason || "시장제외 종목조건 통과",
        entryAt: record.observedAt || nowText(),
        entryTimeMs,
        entryPrice: price,
        firstEligibleAt: record.observedAt || nowText(),
        firstEligibleAtMs: entryTimeMs,
        firstEligiblePrice: price,
        discoverScore: Number(record.discoverScore || 0),
        rankScore: Number(record.rankScore || 0),
        counterfactualRankScore: Number(
          firstCounterfactualRankScore
        ),
        lastCounterfactualRankScore: Number(
          firstCounterfactualRankScore
        ),
        maxCounterfactualRankScore: Number(
          firstCounterfactualRankScore
        ),
        changeRate: Number(record.changeRate || 0),
        volumeRatio: Number(record.volumeRatio || 0),
        dayPosition: Number(record.dayPosition || 0),
        openPosition: Number(record.openPosition || 0),
        passedAtSelection: record.passed === true,
        passWithoutMarketAtSelection: true,
        selectionReason: record.withoutMarketReason || record.reason || "",
        active: true,
        sampleCount: 0,
        lastPrice: price,
        lastProfitRate: 0,
        highestPrice: price,
        lowestPrice: price,
        highestPriceAtMs: entryTimeMs,
        highestProfitRate: 0,
        lowestProfitRate: 0,
        exitAt: null,
        exitPrice: null,
        exitProfitRate: null,
        exitType: null,
        exitReason: null,
        holdingSeconds: null,
        profitCaptureRate: null
      };
      day.virtualCandidates.push(candidate);
      addedCount += 1;
      changed = true;
    } else {
      candidate.lastCounterfactualRankScore = Number(
        record.withoutMarketRankScore ?? record.rankScore ?? 0
      );
      candidate.maxCounterfactualRankScore = Math.max(
        Number(
          candidate.maxCounterfactualRankScore ??
          candidate.counterfactualRankScore ??
          0
        ),
        Number(record.withoutMarketRankScore ?? record.rankScore ?? 0)
      );
      candidate.lastEligibleAt = record.observedAt || nowText();
      candidate.lastEligibleAtMs = Number(record.observedAtMs || Date.now());
      candidate.lastEligiblePrice = price;
      changed = true;
    }
  }

  if (normalizedSelectedCode) {
    for (const candidate of day.virtualCandidates) {
      if (normalizeOpenStockCode(candidate.code) !== normalizedSelectedCode) continue;
      candidate.selectedForRealTrade = true;
      candidate.missedAnalysisEligible = false;
      changed = true;
    }
  }

  if (!changed) return;

  refreshOpenVirtualCandidateRanks(day);
  if (!day.virtualTrackingStartedAt && day.virtualCandidates.length > 0) {
    const firstEntry = [...day.virtualCandidates].sort(
      (a, b) => Number(a.entryTimeMs || 0) - Number(b.entryTimeMs || 0)
    )[0];
    day.virtualTrackingStartedAt = firstEntry?.entryAt || nowText();
    day.virtualTrackingStartedAtMs = Number(firstEntry?.entryTimeMs || Date.now());
  }
  day.virtualTrackingCompletedAt = null;

  if (addedCount > 0) {
    console.log(
      `[OPEN 시장제외 가상후보 등록] 신규 ${addedCount}개 / ` +
      `누적 ${day.virtualCandidates.length}개 / ` +
      day.virtualCandidates
        .slice(0, settings.openVirtualTrackingCount)
        .map(v => `${v.rank}.${v.name}`)
        .join(" | ")
    );
  }

  saveOpenHistory(history);
}

function initializeVirtualTrackingFromLatestCandidates() {
  const history = loadOpenHistory();
  const day = getOpenLearningDay(history);
  initializeOpenVirtualTracking(day.latestCandidates || [], null);
  finalizeOpenVirtualRanking();
}

function finalizeOpenVirtualRanking() {
  const history = loadOpenHistory();
  const day = getOpenLearningDay(history);
  if (day.virtualRankingFinalizedAt) return;
  refreshOpenVirtualCandidateRanks(day);

  day.virtualCandidates.forEach(candidate => {
    candidate.finalRank = Number(candidate.rank || 0);
  });

  const observations = day.candidateObservations &&
    typeof day.candidateObservations === "object"
      ? Object.values(day.candidateObservations)
      : [];

  day.virtualObservedCandidates = observations
    .filter(candidate => !candidate.firstEligibleWithoutMarketAtMs)
    .map(candidate => {
      const directHot = candidate.everDirectHotCandidate === true;
      const maxChangeRate = directHot
        ? Number(settings.openHotDirectMaxChangeRate || 25)
        : Number(settings.openMaxChangeRate || 10);
      const overheatReasons = [];
      if (Number(candidate.lastChangeRate || 0) > maxChangeRate) {
        overheatReasons.push(`상승률 ${Number(candidate.lastChangeRate || 0).toFixed(2)}%`);
      }
      if (Number(candidate.lastOpenPosition || 0) > Number(settings.openMaxOpenPositionRate || 12)) {
        overheatReasons.push(`시가대비 ${Number(candidate.lastOpenPosition || 0).toFixed(2)}%`);
      }
      if (Number(candidate.lastDayPosition || 0) > Number(settings.openMaxDayPositionRate || 98)) {
        overheatReasons.push(`당일위치 ${Number(candidate.lastDayPosition || 0).toFixed(1)}%`);
      }

      const observedRecord = {
        discoverScore: Number(candidate.lastDiscoverScore || 0),
        volumeRatio: Number(candidate.lastVolumeRatio || 0),
        dayPosition: Number(candidate.lastDayPosition || 0),
        openPosition: Number(candidate.lastOpenPosition || 0),
        changeRate: Number(candidate.lastChangeRate || 0),
        isDirectHotCandidate: directHot
      };

      return {
        candidateGroup: "MOMENTUM_OBSERVED",
        code: candidate.code || "",
        name: candidate.name || candidate.code || "",
        observedAt: candidate.lastSeenAt || null,
        price: Number(candidate.lastPrice || 0),
        discoverScore: Number(candidate.lastDiscoverScore || 0),
        changeRate: Number(candidate.lastChangeRate || 0),
        volumeRatio: Number(candidate.lastVolumeRatio || 0),
        dayPosition: Number(candidate.lastDayPosition || 0),
        openPosition: Number(candidate.lastOpenPosition || 0),
        reason: candidate.lastWithoutMarketReason || candidate.lastReason || "종목조건 미충족",
        rejectCategory:
          candidate.lastWithoutMarketRejectCategory ||
          candidate.lastRejectCategory ||
          "기타 조건 미충족",
        overheat: overheatReasons.length > 0,
        overheatReasons,
        observationScore: getLearningCandidateSortScore(observedRecord)
      };
    })
    .sort((a, b) => Number(b.observationScore || 0) - Number(a.observationScore || 0))
    .slice(0, settings.openVirtualTrackingCount)
    .map((candidate, index) => ({
      ...candidate,
      rank: index + 1
    }));

  day.virtualRankingFinalizedAt = nowText();
  day.virtualRankingSummary = {
    buyableCount: day.virtualCandidates.length,
    buyableTopCount: Math.min(
      day.virtualCandidates.length,
      Number(settings.openVirtualTrackingCount || 10)
    ),
    observedCount: day.virtualObservedCandidates.length
  };

  console.log(
    `[OPEN 가상순위 확정] ` +
    `매수가능 ${day.virtualCandidates.length}개 / ` +
    `관찰전용 ${day.virtualObservedCandidates.length}개`
  );
  saveOpenHistory(history);
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

  /* 실제 OPEN과 동일하게 손절을 제외한 익절·시간청산은 최소 보유시간 뒤 적용한다. */
  if (holdingSeconds < Number(settings.openMinHoldingSeconds || 120)) {
    return null;
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

  const trailingStarted =
    candidate.highestProfitRate >=
    settings.openTrailingStartRate;

  if (
    !trailingStarted &&
    holdingSeconds >=
      settings.openMaxHoldingMinutes * 60
  ) {
    return {
      type: "VIRTUAL_OPEN_TIME_SELL",
      reason:
        `가상 일반 시간청산 / ` +
        `트레일링 미진입 / ` +
        `현재 ${profitRate.toFixed(2)}%`
    };
  }

  if (
    trailingStarted &&
    holdingSeconds >=
      settings.openTrailingMaxHoldingMinutes * 60
  ) {
    return {
      type: "VIRTUAL_OPEN_TRAILING_TIME_SELL",
      reason:
        `가상 트레일링 최종청산 / ` +
        `최고 ${candidate.highestProfitRate.toFixed(2)}% / ` +
        `현재 ${profitRate.toFixed(2)}%`
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
  if (!isBetweenTime("09:00", settings.openTrailingForceSellTime)) return;

  const history = loadOpenHistory();
  const day = getOpenLearningDay(history);
  const changed = await updateOpenDelayComparisonOnce(history, day, Date.now());
  if (changed) saveOpenHistory(history);
}

function formatSignedRate(value) {
  const number = Number(value || 0);

  return (
    `${number >= 0 ? "+" : ""}` +
    `${number.toFixed(2)}%`
  );
}

function formatPrice(value) {
  const price = Number(value || 0);

  if (price <= 0) return "-";

  return (
    `${price.toLocaleString("ko-KR")}` +
    `원`
  );
}

async function checkOpenVirtualCandidatesOnce() {
  if (!isKoreanWeekday()) return;
  if (!isBetweenTime("09:00", settings.openTrailingForceSellTime)) return;

  const history = loadOpenHistory();
  const day = getOpenLearningDay(history);

  /* 5종목 매수완료로 매수루프가 먼저 멈춰도 09:30 최종 가상순위는 반드시 확정한다. */
  if (
    getCurrentHHMM() >= settings.openBuyEndTime &&
    !day.virtualRankingFinalizedAt
  ) {
    finalizeOpenVirtualRanking();
    return;
  }

  const candidates = Array.isArray(day.virtualCandidates)
    ? day.virtualCandidates
    : [];
  const summaryCandidates = [...candidates]
    .sort((a, b) => Number(a.rank || 0) - Number(b.rank || 0))
    .slice(0, Number(settings.openVirtualTrackingCount || 10));

  const active = candidates.filter(
    candidate => candidate.active === true
  );

  const now = Date.now();
  let changed = false;

  for (const candidate of active) {
    let price = 0;

    try {
      price = await fetchPrice(candidate.code);
    } catch (err) {
      console.log(
        `[OPEN 가상가격 실패] ` +
        `${candidate.name || candidate.code} / ` +
        `${err.message}`
      );
      continue;
    }

    if (!price) continue;

    const signal = getVirtualOpenSellSignal(
      candidate,
      price,
      now
    );

    if (signal) {
      completeVirtualCandidate(
        candidate,
        price,
        signal,
        now
      );

      changed = true;

      console.log(
        `[OPEN 가상종료] ` +
        `${candidate.name || candidate.code} / ` +
        `${signal.type} / ` +
        `${formatSignedRate(candidate.exitProfitRate)}`
      );
    }
  }

  const trackingCompleted =
    Boolean(day.virtualRankingFinalizedAt) &&
    summaryCandidates.length > 0 &&
    summaryCandidates.every(
      candidate => candidate.active !== true
    );

  /* 완료 로그와 요약은 하루에 한 번만 만든다. */
  if (
    trackingCompleted &&
    !day.virtualTrackingCompletedAt
  ) {
    const winCount = summaryCandidates.filter(
      candidate => Number(candidate.exitProfitRate || 0) > 0
    ).length;

    const lossCount = summaryCandidates.filter(
      candidate => Number(candidate.exitProfitRate || 0) < 0
    ).length;

    const avgProfitRate = summaryCandidates.reduce(
      (sum, candidate) =>
        sum + Number(candidate.exitProfitRate || 0),
      0
    ) / summaryCandidates.length;

    const best = [...summaryCandidates].sort(
      (a, b) =>
        Number(b.exitProfitRate || 0) -
        Number(a.exitProfitRate || 0)
    )[0] || null;

    const worst = [...summaryCandidates].sort(
      (a, b) =>
        Number(a.exitProfitRate || 0) -
        Number(b.exitProfitRate || 0)
    )[0] || null;

    const firstCandidate =
      summaryCandidates.find(
        candidate => Number(candidate.rank || 0) === 1
      ) || summaryCandidates[0] || null;

    day.virtualTrackingCompletedAt = nowText();

    day.virtualSummary = {
      sampleCount: summaryCandidates.length,
      winCount,
      lossCount,
      avgProfitRate,
      best,
      worst,
      firstCandidate: firstCandidate
        ? {
            rank: Number(firstCandidate.rank || 1),
            code: firstCandidate.code || "",
            name: firstCandidate.name || firstCandidate.code || "",
            entryPrice: Number(firstCandidate.entryPrice || 0),
            highestProfitRate: Number(firstCandidate.highestProfitRate || 0),
            lowestProfitRate: Number(firstCandidate.lowestProfitRate || 0),
            exitPrice: Number(firstCandidate.exitPrice || 0),
            exitProfitRate: Number(firstCandidate.exitProfitRate || 0),
            exitType: firstCandidate.exitType || null,
            exitReason: firstCandidate.exitReason || null
          }
        : null
    };

    changed = true;

    if (firstCandidate) {
      console.log(
        `[OPEN 가상추적 완료] ` +
        `1위 ${firstCandidate.name || firstCandidate.code}` +
        `(${firstCandidate.code || "-"}) / ` +
        `매수가 ${formatPrice(firstCandidate.entryPrice)} / ` +
        `최고 ${formatSignedRate(firstCandidate.highestProfitRate)} / ` +
        `최저 ${formatSignedRate(firstCandidate.lowestProfitRate)} / ` +
        `가상청산 ${formatSignedRate(firstCandidate.exitProfitRate)} / ` +
        `청산사유 ${firstCandidate.exitType || "-"}`
      );
    }

    console.log(
      `[OPEN 후보 참고통계] ` +
      `${summaryCandidates.length}종목 / ` +
      `승 ${winCount} / ` +
      `패 ${lossCount} / ` +
      `평균 ${formatSignedRate(avgProfitRate)}`
    );
  }

  /* 추적 중에도 최고·최저 수익률을 계속 저장한다. */
  if (changed || active.length > 0) {
    saveOpenHistory(history);
  }
}

function saveOpenCandidateLearning(evaluated) {
  const history = loadOpenHistory();
  const day = getOpenLearningDay(history);

  const sorted = [...evaluated].sort((a, b) => {
    return (
      getLearningCandidateSortScore(b.record) -
      getLearningCandidateSortScore(a.record)
    );
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
      passWithoutMarketCount: 0,
      firstEligibleWithoutMarketAt: null,
      firstEligibleWithoutMarketAtMs: null,
      firstEligibleWithoutMarketPrice: null,
      firstEligibleWithoutMarketRankScore: null,
      maxRankScore: 0,
      maxDiscoverScore: 0,
      maxVolumeRatio: 0,
      maxMomentumScore: 0,
      maxChangeRate: null,
      minChangeRate: null,
      firstSource: record.source || null,
      lastSource: record.source || null,
      everHotMatched: record.hotMatched === true,
      everDirectHotCandidate: record.isDirectHotCandidate === true,
      everPriorityCandidate: record.isPriorityCandidate === true,
      firstRejectCategory: record.rejectCategory || null,
      lastRejectCategory: record.rejectCategory || null,
      firstRejectStage: record.rejectStage || null,
      lastRejectStage: record.rejectStage || null,
      rejectCategoryCounts: {},
      rejectStageCounts: {},
      passedDiscoverStage: false,
      passedVolumeStage: false,
      passedMomentumStage: false,
      selected: false,
      timeline: []
    };

    prev.name = record.name;
    prev.lastSeenAt = record.observedAt;
    prev.observationCount += 1;
    if (record.passed) prev.passCount += 1;
    if (record.passWithoutMarket) {
      prev.passWithoutMarketCount =
        Number(prev.passWithoutMarketCount || 0) + 1;
      if (!prev.firstEligibleWithoutMarketAtMs) {
        prev.firstEligibleWithoutMarketAt = record.observedAt;
        prev.firstEligibleWithoutMarketAtMs = Number(record.observedAtMs || Date.now());
        prev.firstEligibleWithoutMarketPrice = Number(record.price || 0);
        prev.firstEligibleWithoutMarketRankScore = Number(
          record.withoutMarketRankScore || record.rankScore || 0
        );
      }
    }
    prev.lastPassed = record.passed;
    prev.lastPassWithoutMarket = record.passWithoutMarket === true;
    prev.lastMarketOnlyBlocked = record.marketOnlyBlocked === true;
    prev.everMarketOnlyBlocked =
      prev.everMarketOnlyBlocked === true || record.marketOnlyBlocked === true;
    prev.lastWithoutMarketReason = record.withoutMarketReason || record.reason || "";
    prev.lastWithoutMarketRejectCategory =
      record.withoutMarketRejectCategory || "기타 조건 미충족";
    prev.lastWithoutMarketRejectStage =
      record.withoutMarketRejectStage || "OTHER";
    prev.lastWithoutMarketRankScore = Number(record.withoutMarketRankScore || 0);
    prev.lastReason = record.reason;
    prev.lastRejectCategory = record.rejectCategory || "기타 조건 미충족";
    prev.lastRejectStage = record.rejectStage || "OTHER";
    prev.lastSource = record.source || prev.lastSource || null;
    prev.everHotMatched = prev.everHotMatched || record.hotMatched === true;
    prev.everDirectHotCandidate =
      prev.everDirectHotCandidate || record.isDirectHotCandidate === true;
    prev.everPriorityCandidate =
      prev.everPriorityCandidate ||
      record.isPriorityCandidate === true;

    if (!prev.firstRejectCategory) prev.firstRejectCategory = prev.lastRejectCategory;
    if (!prev.firstRejectStage) prev.firstRejectStage = prev.lastRejectStage;

    if (!prev.rejectCategoryCounts || typeof prev.rejectCategoryCounts !== "object") {
      prev.rejectCategoryCounts = {};
    }
    if (!prev.rejectStageCounts || typeof prev.rejectStageCounts !== "object") {
      prev.rejectStageCounts = {};
    }

    prev.rejectCategoryCounts[prev.lastRejectCategory] =
      Number(prev.rejectCategoryCounts[prev.lastRejectCategory] || 0) + 1;
    prev.rejectStageCounts[prev.lastRejectStage] =
      Number(prev.rejectStageCounts[prev.lastRejectStage] || 0) + 1;

    prev.passedDiscoverStage =
      prev.passedDiscoverStage ||
      !["DISCOVER", "STATE", "MARKET"].includes(prev.lastRejectStage);
    prev.passedVolumeStage =
      prev.passedVolumeStage ||
      ["POSITION", "OBSERVATION", "MOMENTUM", "PASSED"].includes(prev.lastRejectStage);
    prev.passedMomentumStage =
      prev.passedMomentumStage ||
      record.passed === true;

    prev.lastPrice = record.price;
    prev.lastChangeRate = Number(record.changeRate || 0);
    prev.lastDiscoverScore = record.discoverScore;
    prev.lastRankScore = record.rankScore;
    prev.lastVolumeRatio = record.volumeRatio;
    prev.lastDayPosition = record.dayPosition;
    prev.lastOpenPosition = record.openPosition;
    prev.lastMarketScore = record.marketScore;
    prev.lastMarketType = record.marketType;
    prev.lastMarketBonus = record.marketBonus;
    prev.lastSectorBonus = record.sectorBonus;
    prev.lastPriorityBonus = record.priorityBonus;
    prev.lastScoreTrendBonus = record.scoreTrendBonus;
    prev.lastConfirmPriceBonus = record.confirmPriceBonus;
    prev.lastMomentumScore = Number(record.momentumScore || 0);
    prev.lastPriceRiseRate = Number(record.priceRiseRate || 0);
    prev.lastVolumeGrowthRate = Number(record.volumeGrowthRate || 0);
    prev.lastScoreGrowth = Number(record.scoreGrowth || 0);
    prev.lastPricePersistence = Number(record.pricePersistence || 0);
    prev.lastVolumePersistence = Number(record.volumePersistence || 0);
    prev.lastObservationCount = Number(record.observationCount || 0);
    prev.lastStrongObservationCount = Number(record.strongObservationCount || 0);
    prev.lastRequiredDiscoverScore = record.requiredDiscoverScore;
    prev.lastRequiredVolumeRatio = record.requiredVolumeRatio;
    prev.lastRequiredConfirmPriceRise = record.requiredConfirmPriceRise;
    prev.lastMatchedSectors = record.matchedSectors;

    prev.maxRankScore = Math.max(prev.maxRankScore, record.rankScore);
    prev.maxDiscoverScore = Math.max(prev.maxDiscoverScore, record.discoverScore);
    prev.maxVolumeRatio = Math.max(prev.maxVolumeRatio, record.volumeRatio);
    prev.maxMomentumScore = Math.max(
      Number(prev.maxMomentumScore || 0),
      Number(record.momentumScore || 0)
    );

    if (!Array.isArray(prev.timeline)) prev.timeline = [];
    prev.timeline.push({
      observedAt: record.observedAt,
      price: Number(record.price || 0),
      discoverScore: Number(record.discoverScore || 0),
      rankScore: Number(record.rankScore || 0),
      momentumScore: Number(record.momentumScore || 0),
      changeRate: Number(record.changeRate || 0),
      volumeRatio: Number(record.volumeRatio || 0),
      dayPosition: Number(record.dayPosition || 0),
      openPosition: Number(record.openPosition || 0),
      priceRiseRate: Number(record.priceRiseRate || 0),
      volumeGrowthRate: Number(record.volumeGrowthRate || 0),
      pricePersistence: Number(record.pricePersistence || 0),
      volumePersistence: Number(record.volumePersistence || 0),
      passed: record.passed === true,
      passWithoutMarket: record.passWithoutMarket === true,
      marketOnlyBlocked: record.marketOnlyBlocked === true,
      withoutMarketReason: record.withoutMarketReason || "",
      withoutMarketRejectCategory:
        record.withoutMarketRejectCategory || "기타 조건 미충족",
      withoutMarketRejectStage: record.withoutMarketRejectStage || "OTHER",
      withoutMarketRankScore: Number(record.withoutMarketRankScore || 0),
      reason: record.reason || "",
      rejectCategory: record.rejectCategory || "기타 조건 미충족",
      rejectStage: record.rejectStage || "OTHER",
      source: record.source || "FALLBACK",
      hotMatched: record.hotMatched === true,
      isPriorityCandidate: record.isPriorityCandidate === true
    });
    prev.timeline = prev.timeline.slice(-60);

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

function recordOpenLearningBuy(item, price, qty, reason, judged = {}) {
  const history = loadOpenHistory();
  const day = getOpenLearningDay(history);
  const normalizedCode = normalizeOpenStockCode(item.code);
  const observation = day.candidateObservations[normalizedCode] || {};

  observation.selected = true;
  observation.selectedAt = nowText();
  observation.finalDecision = "실제 매수";
  observation.finalRejectCategory = "통과";
  observation.finalRejectStage = "PASSED";
  day.candidateObservations[String(item.code || "")] = observation;

  day.status = "HOLDING";
  if (!Array.isArray(day.selectedTrades)) day.selectedTrades = [];
  const selectedTrade = {
    code: normalizedCode,
    name: item.name || item.stockName || item.korName || item.code || "",
    selectedAt: nowText(),
    buyTimeMs: Date.now(),
    buyPrice: Number(price || 0),
    qty: Number(qty || 0),
    buyAmount: Number(price || 0) * Number(qty || 0),
    selectionReason: reason || "",
    selectionInputs: {
      discoverScore: Number(item.discoverScore || observation.lastDiscoverScore || 0),
      rankScore: Number(judged.rankScore ?? observation.lastRankScore ?? 0),
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
      marketScore: Number(judged.marketScore ?? observation.lastMarketScore ?? 0),
      marketType: judged.marketType || observation.lastMarketType || null,
      marketBonus: Number(judged.marketBonus ?? observation.lastMarketBonus ?? 0),
      sectorBonus: Number(judged.sectorBonus ?? observation.lastSectorBonus ?? 0),
      priorityBonus: Number(judged.priorityBonus ?? observation.lastPriorityBonus ?? 0),
      scoreTrendBonus: Number(judged.scoreTrendBonus ?? observation.lastScoreTrendBonus ?? 0),
      confirmPriceBonus: Number(judged.confirmPriceBonus ?? observation.lastConfirmPriceBonus ?? 0),
      momentumScore: Number(judged.momentumScore ?? observation.lastMomentumScore ?? 0),
      maxMomentumScore: Number(observation.maxMomentumScore || 0),
      priceRiseRate: Number(judged.priceRiseRate ?? observation.lastPriceRiseRate ?? 0),
      volumeGrowthRate: Number(judged.volumeGrowthRate ?? observation.lastVolumeGrowthRate ?? 0),
      scoreGrowth: Number(judged.scoreGrowth ?? observation.lastScoreGrowth ?? 0),
      pricePersistence: Number(judged.pricePersistence ?? observation.lastPricePersistence ?? 0),
      volumePersistence: Number(judged.volumePersistence ?? observation.lastVolumePersistence ?? 0),
      observationCount: Number(
        judged.observationCount ??
        observation.lastObservationCount ??
        observation.observationCount ??
        0
      ),
      strongObservationCount: Number(
        judged.strongObservationCount ??
        observation.lastStrongObservationCount ??
        0
      ),
      candidateTimeline: Array.isArray(observation.timeline)
        ? observation.timeline.slice(-20)
        : [],
      requiredDiscoverScore: Number(
        judged.requiredDiscoverScore ??
        observation.lastRequiredDiscoverScore ??
        0
      ),
      requiredVolumeRatio: Number(
        judged.requiredVolumeRatio ??
        observation.lastRequiredVolumeRatio ??
        0
      ),
      requiredConfirmPriceRise: Number(
        judged.requiredConfirmPriceRise ??
        observation.lastRequiredConfirmPriceRise ??
        0
      ),
      matchedSectors: Array.isArray(judged.matchedSectors)
        ? judged.matchedSectors
        : (Array.isArray(observation.lastMatchedSectors) ? observation.lastMatchedSectors : []),
      weakMarketStrongOverride: judged.weakMarketStrongOverride === true,
      weakMarketStrongOverrideReason: judged.weakMarketStrongOverrideReason || ""
    },
    highestPrice: Number(price || 0),
    lowestPrice: Number(price || 0),
    highestProfitRate: 0,
    lowestProfitRate: 0,
    lastPrice: Number(price || 0),
    lastProfitRate: 0
  };
  day.selectedTrades = day.selectedTrades.filter(row => String(row.code) !== String(normalizedCode));
  day.selectedTrades.push(selectedTrade);
  day.selectedTrade = selectedTrade;

  saveOpenHistory(history);
}

function updateOpenLearningHolding(holding, price) {
  const history = loadOpenHistory();
  const day = getOpenLearningDay(history);
  const trade = Array.isArray(day.selectedTrades)
    ? day.selectedTrades.find(row => String(row.code) === String(holding.code))
    : day.selectedTrade;

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
  const trade = Array.isArray(day.selectedTrades)
    ? (day.selectedTrades.find(row => String(row.code) === String(holding.code)) || {})
    : (day.selectedTrade || {});

  const buyPrice = Number(trade.buyPrice || holding.buyPrice || 0);
  const sellPrice = Number(price || 0);
  const sellProfitRate = Number(
    result.profitRate ??
    (buyPrice > 0 ? ((sellPrice - buyPrice) / buyPrice) * 100 : 0)
  );
  const highestProfitRate = Number(trade.highestProfitRate || 0);

  if (!Array.isArray(day.results)) day.results = [];
  day.status = "HOLDING";
  const completedResult = {
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
        : null,
    selectionInputs: trade.selectionInputs || {},
    selectionReason: trade.selectionReason || "",
    buyQualitySnapshot: {
      momentumScore: Number(trade.selectionInputs?.momentumScore || 0),
      maxMomentumScore: Number(trade.selectionInputs?.maxMomentumScore || 0),
      priceRiseRate: Number(trade.selectionInputs?.priceRiseRate || 0),
      volumeGrowthRate: Number(trade.selectionInputs?.volumeGrowthRate || 0),
      pricePersistence: Number(trade.selectionInputs?.pricePersistence || 0),
      volumePersistence: Number(trade.selectionInputs?.volumePersistence || 0),
      observationCount: Number(trade.selectionInputs?.observationCount || 0),
      strongObservationCount: Number(trade.selectionInputs?.strongObservationCount || 0)
    }
  };
  day.results = day.results.filter(row => String(row.code) !== String(holding.code));
  day.results.push(completedResult);
  day.result = completedResult;
  const totalSelected = Array.isArray(day.selectedTrades) ? day.selectedTrades.length : 1;
  day.status = day.results.length >= totalSelected ? "COMPLETED" : "HOLDING";

  saveOpenHistory(history);
}

function recordOpenLearningSkip(reason) {
  const history = loadOpenHistory();
  const day = getOpenLearningDay(history);

  if (day.status === "COMPLETED") return;

  const observations =
    day.candidateObservations &&
    typeof day.candidateObservations === "object"
      ? Object.values(day.candidateObservations)
      : [];

  const rejectSummary = {};
  for (const candidate of observations) {
    const classified = classifyOpenRejectReason(candidate.lastReason || "");
    const category =
      candidate.selected === true
        ? "실제 매수"
        : (candidate.lastRejectCategory || classified.rejectCategory);

    candidate.finalDecision =
      candidate.selected === true ? "실제 매수" : category;
    candidate.finalDecisionWithoutMarket = candidate.firstEligibleWithoutMarketAtMs
      ? "시장제외 매수가능"
      : (candidate.lastWithoutMarketRejectCategory || category);
    candidate.finalMarketOnlyBlocked = candidate.everMarketOnlyBlocked === true;
    candidate.finalRejectCategory = category;
    candidate.finalRejectStage =
      candidate.selected === true
        ? "PASSED"
        : (candidate.lastRejectStage || classified.rejectStage);
    candidate.finalizedAt = nowText();

    rejectSummary[category] =
      Number(rejectSummary[category] || 0) + 1;
  }

  day.candidateRejectSummary = rejectSummary;
  day.candidateLifecycleCompletedAt = nowText();

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
  state.openPotentialCandidates = {};
  state.openPotentialPromotedCount = 0;
  state.openPotentialExpiredCount = 0;
  state.lastOpenPotentialCheckAtMs = 0;
  state.openDiscoverOffset = 0;

state.lastOpenFullScanAtMs = 0;
state.lastOpenFullScanAt = null;

  state.openBuyAt = null;
  state.openBuyCode = null;
  state.openBuyName = null;
  state.openBuyCodes = [];
  state.openBuyNames = [];
  state.openBuyCount = 0;
  state.openAllocationBaseCash = Number(state.totalCash || 0);
  state.openPerPositionBudget =
    Number(state.openAllocationBaseCash || 0) * Number(settings.openInvestmentRatio || 0.20);
  state.openSellType = null;
  state.openSellReason = null;
  state.openTopCandidate = null;
  state.openLastScanSummary = null;
  state.openDailyStats = {
    date: today,
    scanCount: 0,
    candidateCodes: {},
    evaluatedCodes: {},
    strictPassedCodes: {},
    passWithoutMarketCodes: {},
    marketOnlyBlockedCodes: {},
    fallbackPassedCodes: {},
    selectedCodes: {},
    boughtCodes: {},
    hotInputCodes: {},
    latest: null
  };
  state.openLiveActivities = [];
  state.openLiveTracking = {
    date: today,
    stage: settings.openEnabled ? "WAITING" : "DISABLED",
    stageLabel: settings.openEnabled ? "OPEN 시작 대기" : "OPEN 설정 OFF",
    decision: settings.openEnabled ? `${settings.openBuyStartTime} 매수 시작 대기` : "OPEN 설정이 꺼져 있습니다.",
    updatedAt: nowText(),
    updatedAtMs: Date.now()
  };

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

  const baseAsset = Number(
    state.dailyStartAsset ||
    state.totalAsset ||
    settings.totalCash
  );

  const calculatedLimit =
    baseAsset *
    Number(settings.dailyLossLimitRate || 0);

  const limit =
    Number(state.dailyLossLimit || 0) > 0
      ? Number(state.dailyLossLimit)
      : calculatedLimit;

  if (
    limit > 0 &&
    todayProfit <= -Math.abs(limit)
  ) {
    return {
      stopped: true,
      reason:
        `일일 손실한도 도달 / ` +
        `실현손익 ${todayProfit.toLocaleString()}원 / ` +
        `한도 ${Math.round(limit).toLocaleString()}원`
    };
  }

  return {
    stopped: false,
    reason: "정상"
  };
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

async function postJson(url, body, timeoutMs = 0) {
  const controller = timeoutMs > 0 ? new AbortController() : null;
  const timer = controller
    ? setTimeout(() => controller.abort(), Number(timeoutMs))
    : null;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller?.signal
    });
    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; }
    catch { data = { rawText: text }; }
    if (!res.ok || data.ok === false) {
      const apiError = new Error(
        data.message || data.error || `POST API 오류 ${res.status}`
      );
      apiError.httpStatus = Number(res.status || 0);
      apiError.responseData = data;
      apiError.requestUrl = url;
      throw apiError;
    }
    return data;
  } catch (err) {
    if (err?.name === "AbortError") {
      const timeoutError = new Error(
        `주문 API 응답시간 초과 ${Math.round(Number(timeoutMs) / 1000)}초`
      );
      timeoutError.code = "ORDER_API_TIMEOUT";
      timeoutError.requestUrl = url;
      timeoutError.cause = err;
      throw timeoutError;
    }
    if (err && !err.requestUrl) err.requestUrl = url;
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function makeOpenRequestErrorDetail(err, extra = {}) {
  const cause = err?.cause || {};
  return {
    ...extra,
    name: err?.name || null,
    message: err?.message || "알 수 없는 오류",
    code: err?.code || cause?.code || null,
    causeName: cause?.name || null,
    causeMessage: cause?.message || null,
    errno: cause?.errno || null,
    syscall: cause?.syscall || null,
    address: cause?.address || null,
    port: cause?.port || null,
    httpStatus: Number(err?.httpStatus || 0) || null,
    requestUrl: err?.requestUrl || null
  };
}

function isRetryableOpenOrderError(err) {
  if (Number(err?.httpStatus || 0) > 0) return false;

  const cause = err?.cause || {};
  const text = [
    err?.message,
    err?.code,
    cause?.message,
    cause?.code
  ].filter(Boolean).join(" ");

  return /fetch failed|timeout|시간초과|시간 초과|ECONNRESET|ECONNREFUSED|EPIPE|UND_ERR|socket/i.test(text);
}

async function fetchPrice(code) {
  const data = await fetchJson(`${API_BASE}/api/price?code=${code}`);
  return Math.abs(Number(
    data.currentPrice || data.price || data.curPrice || data.raw?.cur_prc || 0
  ));
}

function isExcludedStock(item = {}) {
  const name = String(
    item.name || item.stockName || item.korName || ""
  ).trim();

  /*
   * OPEN은 국내 개별 보통주만 대상으로 한다.
   * ETF·ETN·선물·인버스·레버리지·스팩·우선주는
   * 후보 발굴, 관찰, 가상추적 및 실제매수에서 모두 제외한다.
   */
  const isFundOrDerivative =
    /(?:^|\s)(?:KODEX|TIGER|ACE|SOL|HANARO|KOSEF|KBSTAR|ARIRANG|RISE|PLUS|TIMEFOLIO|WOORI|1Q|FOCUS|마이티|히어로즈)(?:\s|$)/i.test(name) ||
    /ETF|ETN|인버스|레버리지|선물|선물지수|단일종목|2X|곱버스|TRF|채권혼합|액티브/i.test(name);

  if (isFundOrDerivative) return true;
  if (/스팩|SPAC/i.test(name)) return true;
  if (/우$|\d우B$|우B$|우선주/i.test(name)) return true;
  return false;
}

function getTradeVolumeRatio(item = {}) {
  const raw = item.raw || {};

  const trdePre =
    raw.trde_pre ??
    item.trde_pre ??
    null;

  /*
   * 키움 trde_pre는 전일 거래량 대비 증감률이다.
   * 예: +50 -> 실제 거래량비율 150%, -21.03 -> 78.97%.
   */
  if (trdePre !== null && trdePre !== "") {
    const changeRate = Number(
      String(trdePre)
        .replace(/[+,%]/g, "")
        .replace(/,/g, "")
        .trim()
    );

    return Number.isFinite(changeRate)
      ? Math.max(0, 100 + changeRate)
      : 0;
  }

  /* 이미 완성된 거래량비율이 들어온 경우에는 그대로 사용한다. */
  const ratio = Number(
    String(
      item.tradeVolumeRatio ??
      item.volumeRatio ??
      item.hotVolumeRatio ??
      0
    )
      .replace(/[+,%]/g, "")
      .replace(/,/g, "")
      .trim()
  );

  return Number.isFinite(ratio)
    ? Math.max(0, ratio)
    : 0;
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

function getOpenHoldingCount(state) {
  return (state.holdings || []).filter(h => h.strategyGroup === "OPEN").length;
}

function getOpenBuyCountToday(state) {
  return (state.tradeLogs || []).filter(log =>
    log.date === todayKey() && log.type === "OPEN_BUY"
  ).length;
}

function hasOpenHolding(state) {
  return getOpenHoldingCount(state) > 0;
}

function hasOpenBuyToday(state) {
  return getOpenBuyCountToday(state) > 0;
}

function isOpenBuyCapacityFull(state) {
  return Math.max(getOpenHoldingCount(state), getOpenBuyCountToday(state)) >=
    Number(settings.openMaxHoldingCount || 5);
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
        prioritySector: stock.sector || null,
        isPriorityCandidate: true
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

async function fetchFocusedCandidates(state) {
  const history = state.openCandidateHistory || {};

  const focusedList = Object.entries(history)
    .map(([code, row]) => ({
      code,
      ...row
    }))
    .filter(row => row.code)
    .sort((a, b) => {
      const aScore = Number(
        a.last?.score ??
        a.firstScore ??
        0
      );

      const bScore = Number(
        b.last?.score ??
        b.firstScore ??
        0
      );

      return bScore - aScore;
    })
    .slice(0, settings.openFocusedCandidateMaxCount);

  if (!focusedList.length) {
    return [];
  }

  const rows = [];

  for (const candidate of focusedList) {
    try {
      const data = await fetchJson(
        `${API_BASE}/api/price?code=${encodeURIComponent(candidate.code)}`
      );

      const item = {
        ...(candidate.itemSnapshot || {}),
        ...data,

        code: String(
          data.code ||
          candidate.code ||
          ""
        ),

        name:
          data.name ||
          candidate.itemSnapshot?.name ||
          candidate.name ||
          candidate.code,

        source:
          candidate.itemSnapshot?.source ||
          "FOCUSED",

        originalSource:
          candidate.itemSnapshot?.originalSource ||
          candidate.itemSnapshot?.source ||
          "FOCUSED",

        isDirectHotCandidate:
          candidate.itemSnapshot?.isDirectHotCandidate === true ||
          candidate.itemSnapshot?.everDirectHotCandidate === true ||
          candidate.itemSnapshot?.originalSource === "HOT" ||
          candidate.itemSnapshot?.source === "HOT",

        everDirectHotCandidate:
          candidate.itemSnapshot?.everDirectHotCandidate === true ||
          candidate.itemSnapshot?.isDirectHotCandidate === true ||
          candidate.itemSnapshot?.originalSource === "HOT" ||
          candidate.itemSnapshot?.source === "HOT",

        priorityRank:
          Number(
            candidate.itemSnapshot?.priorityRank ||
            0
          ),

        priorityScore:
          Number(
            candidate.itemSnapshot?.priorityScore ||
            0
          ),

        priorityReason:
          candidate.itemSnapshot?.priorityReason ||
          null,

        isPriorityCandidate:
          candidate.itemSnapshot?.isPriorityCandidate === true
      };

      const scoreInfo = calculateOpenDiscoverScore(item);

      rows.push({
        ...item,
        ...scoreInfo,
        source:
          candidate.itemSnapshot?.source ||
          "FOCUSED"
      });
    } catch (err) {
      console.log(
        `[OPEN 집중후보 조회실패] ` +
        `${candidate.name || candidate.code} / ` +
        `${err.message}`
      );
    }

    await sleep(settings.openFocusedPriceDelayMs);
  }

  console.log(
    `[OPEN 집중후보] 저장 ${focusedList.length}개 / ` +
    `조회성공 ${rows.length}개`
  );

  return rows;
}

function registerOpenPotentialCandidate(state, item, price, judged = {}) {
  if (!settings.openPotentialEnabled) return false;

  const code = String(item.code || "").replace(/[^0-9]/g, "");
  const discoverScore = Number(item.discoverScore || 0);
  if (!/^\d{6}$/.test(code)) return false;
  if (discoverScore < Number(settings.openPotentialMinScore || 0)) return false;

  if (!state.openPotentialCandidates || typeof state.openPotentialCandidates !== "object") {
    state.openPotentialCandidates = {};
  }

  const now = Date.now();
  const existing = state.openPotentialCandidates[code];
  const name = item.name || item.stockName || item.korName || code;

  const snapshot = {
    code,
    name,
    source: item.source || "FALLBACK",
    originalSource: item.originalSource || item.source || "FALLBACK",
    isDirectHotCandidate:
      item.isDirectHotCandidate === true ||
      item.everDirectHotCandidate === true ||
      item.originalSource === "HOT" ||
      item.source === "HOT",
    everDirectHotCandidate:
      item.everDirectHotCandidate === true ||
      item.isDirectHotCandidate === true ||
      item.originalSource === "HOT" ||
      item.source === "HOT",
    hotScore: Number(item.hotScore || 0),
    hotMomentumScore: Number(item.hotMomentumScore || 0),
    hotPriceRise30s: Number(item.hotPriceRise30s || 0),
    hotVolumeGrowth30s: Number(item.hotVolumeGrowth30s || 0),
    hotPricePersistence: Number(item.hotPricePersistence || 0),
    hotVolumePersistence: Number(item.hotVolumePersistence || 0),
    hotHighRefreshCount: Number(item.hotHighRefreshCount || 0),
    hotDurationSeconds: Number(item.hotDurationSeconds || 0),
    priorityRank: Number(item.priorityRank || 0),
    priorityScore: Number(item.priorityScore || 0),
    priorityReason: item.priorityReason || null,
    prioritySector: item.prioritySector || null,
    isPriorityCandidate:
      item.isPriorityCandidate === true ||
      item.source === "PRIORITY",
    industry: item.industry || null,
    sector: item.sector || null,
    theme: item.theme || null,
    sectorName: item.sectorName || null,
    industryName: item.industryName || null,
    sectorTags: Array.isArray(item.sectorTags) ? item.sectorTags : [],
    themeTags: Array.isArray(item.themeTags) ? item.themeTags : []
  };

  if (existing) {
    existing.lastSeenAt = nowText();
    existing.lastSeenAtMs = now;
    existing.lastPrice = Number(price || existing.lastPrice || 0);
    existing.lastScore = discoverScore;
    existing.maxScore = Math.max(Number(existing.maxScore || 0), discoverScore);
    existing.checkCount = Number(existing.checkCount || 0) + 1;
    existing.lastReason = judged.reason || existing.lastReason || "";
    existing.itemSnapshot = { ...existing.itemSnapshot, ...snapshot };
    return false;
  }

  state.openPotentialCandidates[code] = {
    code,
    name,
    status: "TRACKING",
    firstSeenAt: nowText(),
    firstSeenAtMs: now,
    firstPrice: Number(price || 0),
    firstScore: discoverScore,
    lastSeenAt: nowText(),
    lastSeenAtMs: now,
    lastPrice: Number(price || 0),
    lastScore: discoverScore,
    maxScore: discoverScore,
    checkCount: 1,
    lastReason: judged.reason || "초기 기준 미달",
    itemSnapshot: snapshot
  };

  const rows = Object.values(state.openPotentialCandidates)
    .sort((a, b) => {
      const scoreDiff = Number(b.maxScore || 0) - Number(a.maxScore || 0);
      if (scoreDiff !== 0) return scoreDiff;
      return Number(b.lastSeenAtMs || 0) - Number(a.lastSeenAtMs || 0);
    });

  const keep = rows.slice(0, Number(settings.openPotentialMaxCount || 20));
  const keepCodes = new Set(keep.map(row => row.code));
  for (const savedCode of Object.keys(state.openPotentialCandidates)) {
    if (!keepCodes.has(savedCode)) delete state.openPotentialCandidates[savedCode];
  }

  console.log(
    `[OPEN 잠재후보 등록] ${name}(${code}) / ` +
    `점수 ${discoverScore} / 사유 ${judged.reason || "초기 기준 미달"}`
  );
  return true;
}

function removeOpenPotentialCandidate(state, code, status = "REMOVED", reason = "") {
  if (!state.openPotentialCandidates?.[code]) return;
  const candidate = state.openPotentialCandidates[code];
  delete state.openPotentialCandidates[code];

  if (status === "PROMOTED") {
    state.openPotentialPromotedCount = Number(state.openPotentialPromotedCount || 0) + 1;
  } else if (status === "EXPIRED") {
    state.openPotentialExpiredCount = Number(state.openPotentialExpiredCount || 0) + 1;
  }

  console.log(
    `[OPEN 잠재후보 ${status}] ${candidate.name || code}(${code})` +
    `${reason ? ` / ${reason}` : ""}`
  );
}

async function fetchPotentialCandidates(state) {
  if (!settings.openPotentialEnabled) return [];
  if (!state.openPotentialCandidates || typeof state.openPotentialCandidates !== "object") {
    state.openPotentialCandidates = {};
  }

  const now = Date.now();
  const lastCheckedAt = Number(state.lastOpenPotentialCheckAtMs || 0);
  if (
    lastCheckedAt > 0 &&
    now - lastCheckedAt < Number(settings.openPotentialCheckIntervalMs || 5000)
  ) {
    return [];
  }
  state.lastOpenPotentialCheckAtMs = now;

  const active = Object.values(state.openPotentialCandidates)
    .filter(candidate => candidate?.code)
    .sort((a, b) => Number(b.maxScore || 0) - Number(a.maxScore || 0))
    .slice(0, Number(
      settings.openPotentialRecheckCount ||
      settings.openPotentialMaxCount ||
      10
    ));

  const rows = [];
  for (const candidate of active) {
    const ageSeconds = (now - Number(candidate.firstSeenAtMs || now)) / 1000;
    if (ageSeconds > Number(settings.openPotentialMaxAgeSeconds || 180)) {
      removeOpenPotentialCandidate(
        state,
        candidate.code,
        "EXPIRED",
        `${Math.floor(ageSeconds)}초 경과`
      );
      continue;
    }

    try {
      const data = await fetchJson(
        `${API_BASE}/api/price?code=${encodeURIComponent(candidate.code)}`
      );
      const item = {
        ...(candidate.itemSnapshot || {}),
        ...data,
        code: String(data.code || candidate.code || ""),
        name: data.name || candidate.name || candidate.code,
        source: "POTENTIAL",
        originalSource:
          candidate.itemSnapshot?.originalSource ||
          candidate.itemSnapshot?.source ||
          "POTENTIAL",
        isDirectHotCandidate:
          candidate.itemSnapshot?.isDirectHotCandidate === true ||
          candidate.itemSnapshot?.everDirectHotCandidate === true ||
          candidate.itemSnapshot?.originalSource === "HOT" ||
          candidate.itemSnapshot?.source === "HOT",
        everDirectHotCandidate:
          candidate.itemSnapshot?.everDirectHotCandidate === true ||
          candidate.itemSnapshot?.isDirectHotCandidate === true ||
          candidate.itemSnapshot?.originalSource === "HOT" ||
          candidate.itemSnapshot?.source === "HOT",
        potentialCandidate: true,
        potentialFirstScore: Number(candidate.firstScore || 0),
        potentialFirstPrice: Number(candidate.firstPrice || 0),
        potentialAgeSeconds: ageSeconds,
        isPriorityCandidate: candidate.itemSnapshot?.isPriorityCandidate === true,
        priorityRank: Number(candidate.itemSnapshot?.priorityRank || 0),
        priorityScore: Number(candidate.itemSnapshot?.priorityScore || 0),
        priorityReason: candidate.itemSnapshot?.priorityReason || null,
        prioritySector: candidate.itemSnapshot?.prioritySector || null
      };

      const scoreInfo = calculateOpenDiscoverScore(item);
      candidate.lastSeenAt = nowText();
      candidate.lastSeenAtMs = now;
      candidate.lastPrice = Math.abs(Number(data.currentPrice || data.price || data.raw?.cur_prc || 0));
      candidate.lastScore = Number(scoreInfo.discoverScore || 0);
      candidate.maxScore = Math.max(Number(candidate.maxScore || 0), candidate.lastScore);
      candidate.checkCount = Number(candidate.checkCount || 0) + 1;

      rows.push({ ...item, ...scoreInfo });
    } catch (err) {
      console.log(
        `[OPEN 잠재후보 조회실패] ${candidate.name || candidate.code} / ${err.message}`
      );
    }

    await sleep(Number(settings.openPotentialPriceDelayMs || 250));
  }

  if (active.length > 0) {
    console.log(
      `[OPEN 잠재후보 재확인] 저장 ${active.length}개 / 조회성공 ${rows.length}개`
    );
  }
  return rows;
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
  const now = Date.now();
  const hotData = loadHotCandidates();

  console.log(
    `[OPEN HOT 연결] ${hotData.available ? "정상" : "미사용"} / ` +
    `${hotData.available
      ? `후보 ${hotData.items.length}개 (현재 ${Number(hotData.currentCount || 0)} / 누적활성 ${Number(hotData.historyCount || 0)}) / ` +
        `경과 ${Number(hotData.ageSeconds || 0).toFixed(1)}초`
      : hotData.reason}`
  );

  /*
   * 이미 발견된 후보가 있으면 우선 빠르게 재확인한다.
   */
  const potentialRows =
    await fetchPotentialCandidates(state);

  const focusedRows =
    await fetchFocusedCandidates(state);

  /*
   * 일반검색 실행 조건
   *
   * 1. 저장된 집중후보가 없을 때
   * 2. 마지막 전체검색 후 60초가 지났을 때
   */
  const lastFullScanAtMs =
    Number(state.lastOpenFullScanAtMs || 0);

  const hhmm = getCurrentHHMM();
  const lateOpenPhase =
    hhmm >= String(settings.openLateFallbackStartTime || "09:12");

  const fullRescanIntervalMs = lateOpenPhase
    ? Number(settings.openLateFullRescanIntervalMs || 60 * 1000)
    : Number(settings.openFullRescanIntervalMs || 30 * 1000);

  const shouldRunFullScan =
    (
      focusedRows.length === 0 ||
      now - lastFullScanAtMs >=
        fullRescanIntervalMs
    );

  let priorityRows = [];
  let fallbackRows = [];

  if (shouldRunFullScan) {
    priorityRows =
      await fetchPriorityCandidates(marketData);

    fallbackRows =
      await fetchFallbackCandidates(state);

    state.lastOpenFullScanAtMs = Date.now();
    state.lastOpenFullScanAt = nowText();

    console.log(
      `[OPEN 전체검색 실행] ` +
      `우선 ${priorityRows.length}개 / ` +
      `일반 ${fallbackRows.length}개`
    );
  } else {
    const remainSeconds = Math.max(
      0,
      Math.ceil(
        (
          fullRescanIntervalMs -
          (now - lastFullScanAtMs)
        ) / 1000
      )
    );

    console.log(
      `[OPEN 전체검색 생략] ` +
      `${lateOpenPhase ? "마감보완단계 / " : ""}` +
      `집중후보 ${focusedRows.length}개 재확인 / ` +
      `다음 전체검색 약 ${remainSeconds}초 후`
    );
  }

  const directHotRows = await enrichHistoricalHotCandidates(
    buildDirectHotCandidates(hotData)
  );
  const merged = [];
  const seen = new Set();

  for (
    const sourceItem of [
      ...directHotRows,
      ...potentialRows,
      ...focusedRows,
      ...priorityRows,
      ...fallbackRows
    ]
  ) {
    const item = attachHotData(sourceItem, hotData);
    const code = String(item.code || "");

    if (
      !code ||
      seen.has(code) ||
      isExcludedStock(item)
    ) {
      continue;
    }

    seen.add(code);

    if (
      Number(item.discoverScore || 0) <
      settings.minDiscoverScore
    ) {
      continue;
    }

    merged.push(item);
  }

  merged.sort((a, b) => {
    const getSourceOrder = item => {
      if (item.source === "HOT") return 0;
      if (item.source === "POTENTIAL") return 1;
      if (item.source === "PRIORITY") return 2;
      if (item.source === "FOCUSED") return 3;
      return 4;
    };

    const sourceDiff =
      getSourceOrder(a) -
      getSourceOrder(b);

    if (sourceDiff !== 0) {
      return sourceDiff;
    }

    const priorityDiff =
      Number(b.priorityScore || 0) -
      Number(a.priorityScore || 0);

    if (priorityDiff !== 0) {
      return priorityDiff;
    }

    return (
      Number(b.discoverScore || 0) -
      Number(a.discoverScore || 0)
    );
  });

  console.log(
    `[OPEN DISCOVER 4.0] ` +
    `잠재 ${potentialRows.length}개 / ` +
    `집중 ${focusedRows.length}개 / ` +
    `우선 ${priorityRows.length}개 / ` +
    `HOT직접 ${directHotRows.length}개 / ` +
    `HOT누적 ${directHotRows.filter(item => item.fromHotHistory).length}개 / ` +
    `일반 ${fallbackRows.length}개 / ` +
    `최종 ${merged.length}개 / ` +
    `HOT유입 ${merged.filter(item => item.source === "HOT").length}개 / ` +
    `장전∩HOT ${merged.filter(item => item.isPriorityCandidate && item.hotMatched).length}개 / ` +
    `offset ${state.openDiscoverOffset}`
  );

  return merged;
}

function calculateOpenMomentumStrength(history = {}) {
  const samples = Array.isArray(history.samples) ? history.samples : [];
  const minCount = Number(settings.openMinObservationCount || 4);

  if (samples.length < minCount) {
    return {
      pass: false,
      momentumScore: 0,
      reason: `관찰 부족 ${samples.length}/${minCount}`
    };
  }

  const recent = samples.slice(-6);
  const first = recent[0];
  const last = recent[recent.length - 1];
  let priceUpCount = 0;
  let volumeUpCount = 0;
  let positionHoldCount = 0;

  for (let i = 1; i < recent.length; i++) {
    if (Number(recent[i].price || 0) >= Number(recent[i - 1].price || 0)) priceUpCount++;
    if (Number(recent[i].volumeRatio || 0) >= Number(recent[i - 1].volumeRatio || 0)) volumeUpCount++;
    if (Number(recent[i].dayPosition || 0) >= 65) positionHoldCount++;
  }

  const priceRiseRate = Number(first.price || 0) > 0
    ? ((Number(last.price || 0) - Number(first.price || 0)) / Number(first.price || 0)) * 100
    : 0;
  const volumeGrowthRate = Number(first.volumeRatio || 0) > 0
    ? ((Number(last.volumeRatio || 0) - Number(first.volumeRatio || 0)) / Number(first.volumeRatio || 0)) * 100
    : 0;
  const scoreGrowth = Number(last.score || 0) - Number(first.score || 0);
  const steps = Math.max(1, recent.length - 1);
  const pricePersistence = priceUpCount / steps;
  const volumePersistence = volumeUpCount / steps;

  let momentumScore = 0;
  momentumScore += clamp(priceRiseRate * 25, -15, 30);
  momentumScore += clamp(volumeGrowthRate * 0.15, -10, 25);
  momentumScore += clamp(scoreGrowth * 5, -10, 20);
  momentumScore += pricePersistence * 20;
  momentumScore += volumePersistence * 15;
  momentumScore += positionHoldCount * 3;

  const strongCount = [
    priceRiseRate >= 0.20,
    pricePersistence >= 0.60,
    volumePersistence >= 0.50,
    Number(last.dayPosition || 0) >= 65
  ].filter(Boolean).length;

  const pass =
    strongCount >= Number(settings.openMinStrongObservationCount || 3) &&
    momentumScore >= Number(settings.openMomentumMinScore || 35);

  return {
    pass,
    momentumScore,
    priceRiseRate,
    volumeGrowthRate,
    scoreGrowth,
    pricePersistence,
    volumePersistence,
    strongCount,
    reason:
      `지속강도 ${momentumScore.toFixed(1)} / ` +
      `가격 ${priceRiseRate >= 0 ? "+" : ""}${priceRiseRate.toFixed(2)}% / ` +
      `거래량증가 ${volumeGrowthRate >= 0 ? "+" : ""}${volumeGrowthRate.toFixed(1)}% / ` +
      `가격유지 ${(pricePersistence * 100).toFixed(0)}% / ` +
      `거래량유지 ${(volumePersistence * 100).toFixed(0)}% / ` +
      `당일위치 ${Number(last.dayPosition || 0).toFixed(1)}%`
  };
}


function evaluateOpenWeakMarketStrongOverride(state, item, marketData) {
  const marketScore = Number(marketData?.marketScore || 0);
  const absoluteBlockScore = Number(settings.openMarketAbsoluteBlockScore || 25);
  const hardBlockScore = Number(settings.openMarketHardBlockScore || 40);
  const history = state?.openCandidateHistory?.[String(item?.code || "")] || {};
  const momentum = calculateOpenMomentumStrength(history);
  const observationCount = Array.isArray(history.samples) ? history.samples.length : 0;
  const discoverScore = Number(item?.discoverScore || 0);

  const inOverrideZone =
    marketData?.available === true &&
    marketScore >= absoluteBlockScore &&
    marketScore < hardBlockScore;

  const pass =
    settings.openWeakMarketStrongOverrideEnabled === true &&
    inOverrideZone &&
    discoverScore >= Number(settings.openWeakMarketStrongMinDiscoverScore || 9) &&
    Number(momentum.momentumScore || 0) >=
      Number(settings.openWeakMarketStrongMinMomentumScore || 75) &&
    Number(momentum.pricePersistence || 0) >=
      Number(settings.openWeakMarketStrongMinPricePersistence || 0.75) &&
    Number(momentum.volumePersistence || 0) >=
      Number(settings.openWeakMarketStrongMinVolumePersistence || 0.75) &&
    observationCount >=
      Number(settings.openWeakMarketStrongMinObservationCount || 4) &&
    Number(momentum.strongCount || 0) >=
      Number(settings.openWeakMarketStrongMinStrongObservationCount || 3);

  return {
    pass,
    inOverrideZone,
    marketScore,
    absoluteBlockScore,
    hardBlockScore,
    discoverScore,
    momentumScore: Number(momentum.momentumScore || 0),
    priceRiseRate: Number(momentum.priceRiseRate || 0),
    volumeGrowthRate: Number(momentum.volumeGrowthRate || 0),
    scoreGrowth: Number(momentum.scoreGrowth || 0),
    pricePersistence: Number(momentum.pricePersistence || 0),
    volumePersistence: Number(momentum.volumePersistence || 0),
    observationCount,
    strongObservationCount: Number(momentum.strongCount || 0),
    reason:
      `약세장 초강력 후보 ${pass ? "통과" : "미충족"} / ` +
      `시장 ${marketScore}점 / 발견 ${discoverScore} / ` +
      `지속 ${Number(momentum.momentumScore || 0).toFixed(1)} / ` +
      `가격유지 ${(Number(momentum.pricePersistence || 0) * 100).toFixed(0)}% / ` +
      `거래량유지 ${(Number(momentum.volumePersistence || 0) * 100).toFixed(0)}% / ` +
      `관찰 ${observationCount}회 / 강한조건 ${Number(momentum.strongCount || 0)}개`
  };
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

  name:
    item.name ||
    item.stockName ||
    item.korName ||
    item.code ||
    "",

  itemSnapshot: {
    code: String(item.code || ""),

    name:
      item.name ||
      item.stockName ||
      item.korName ||
      item.code ||
      "",

    source: item.source || "FALLBACK",
    originalSource: item.originalSource || item.source || "FALLBACK",
    isDirectHotCandidate:
      item.isDirectHotCandidate === true ||
      item.everDirectHotCandidate === true ||
      item.originalSource === "HOT" ||
      item.source === "HOT",
    everDirectHotCandidate:
      item.everDirectHotCandidate === true ||
      item.isDirectHotCandidate === true ||
      item.originalSource === "HOT" ||
      item.source === "HOT",
    hotScore: Number(item.hotScore || 0),
    hotMomentumScore: Number(item.hotMomentumScore || 0),
    hotPriceRise30s: Number(item.hotPriceRise30s || 0),
    hotVolumeGrowth30s: Number(item.hotVolumeGrowth30s || 0),
    hotPricePersistence: Number(item.hotPricePersistence || 0),
    hotVolumePersistence: Number(item.hotVolumePersistence || 0),
    hotHighRefreshCount: Number(item.hotHighRefreshCount || 0),
    hotDurationSeconds: Number(item.hotDurationSeconds || 0),

    priorityRank:
      Number(item.priorityRank || 0),

    priorityScore:
      Number(item.priorityScore || 0),

    priorityReason:
      item.priorityReason || null,

    prioritySector:
      item.prioritySector || null,

    isPriorityCandidate:
      item.isPriorityCandidate === true ||
      item.source === "PRIORITY",

    industry:
      item.industry || null,

    sector:
      item.sector || null,

    theme:
      item.theme || null,

    sectorName:
      item.sectorName || null,

    industryName:
      item.industryName || null,

    sectorTags:
      Array.isArray(item.sectorTags)
        ? item.sectorTags
        : [],

    themeTags:
      Array.isArray(item.themeTags)
        ? item.themeTags
        : []
  },

  priceAt5Seconds: null,
  priceAt15Seconds: null,
  samples: [current],
  last: current
};
    state.openCandidateHistory[code] = history;
    return { pass: false, reason: "첫 발견 / 20초 확인 대기" };
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
  score: Number(history.firstScore || 0),
  volumeRatio: Number(history.firstVolumeRatio || 0),
  price: Number(history.firstPrice || 0)
};

if (!Array.isArray(history.samples)) history.samples = [];
history.samples.push(current);
history.samples = history.samples
  .filter(sample => now - Number(sample.time || 0) <= Number(settings.openMomentumSampleWindowMs || 60000))
  .slice(-12);

/*
 * 바로 직전 확인값을 보존한다.
 * history.last를 먼저 current로 바꾸면 직전 점수와 비교할 수 없다.
 */
const previous = {
  score: Number(history.last?.score ?? baseline.score),
  volumeRatio: Number(
    history.last?.volumeRatio ??
    baseline.volumeRatio
  ),
  dayPosition: Number(history.last?.dayPosition || 0),
  price: Number(history.last?.price ?? baseline.price)
};

history.last = current;
state.openCandidateHistory[code] = history;

  if (elapsedMs < settings.openConfirmWaitMs) {
    return {
      pass: false,
      reason: `OPEN 강화 확인 대기 ${Math.floor(elapsedMs / 1000)}초/${Math.floor(settings.openConfirmWaitMs / 1000)}초`
    };
  }

  /*
 * 첫 발견 이후 점수 변화
 */
const scoreDiff =
  current.score -
  Number(baseline.score || 0);

/*
 * 바로 직전 확인 대비 점수 변화
 */
const recentScoreDiff =
  current.score -
  Number(previous.score || 0);

const volumeDiff =
  current.volumeRatio -
  Number(baseline.volumeRatio || 0);

const priceDiffRate =
  Number(baseline.price || 0) > 0
    ? (
        (
          current.price -
          Number(baseline.price)
        ) /
        Number(baseline.price)
      ) * 100
    : 0;

    /*
 * 바로 직전 확인 가격 대비 현재 가격 변화율
 *
 * 첫 발견 이후에는 상승했더라도,
 * 최근 확인 사이에 가격이 꺾이는 종목을 차단하기 위해 사용한다.
 */
const recentPriceDiffRate =
  Number(previous.price || 0) > 0
    ? (
        (
          current.price -
          Number(previous.price)
        ) /
        Number(previous.price)
      ) * 100
    : 0;

    /*
 * 첫 발견 이후 가격 상승률 보너스
 *
 * -0.30%까지는 진입 후보를 유지하되 가격보너스는 없음
 * 0.10~0.30%: 3점
 * 0.30~0.60%: 7점
 * 0.60~1.00%: 10점
 * 1.00% 초과: 추격매수 차단
 */
let confirmPriceBonus = 0;

if (
  priceDiffRate >= 0.10 &&
  priceDiffRate < 0.30
) {
  confirmPriceBonus =
    settings.openConfirmPriceBonusLow;
} else if (
  priceDiffRate >= 0.30 &&
  priceDiffRate < 0.60
) {
  confirmPriceBonus =
    settings.openConfirmPriceBonusMedium;
} else if (
  priceDiffRate >= 0.60 &&
  priceDiffRate <=
    settings.openConfirmMaxPriceRiseRate
) {
  confirmPriceBonus =
    settings.openConfirmPriceBonusHigh;
}

/*
 * 점수가 지속적으로 상승하는 후보에 추가 점수를 준다.
 *
 * 첫 발견 대비 점수 상승:
 * 1점당 4점
 *
 * 직전 확인 대비 점수 상승:
 * 1점당 6점
 *
 * 최대 보너스:
 * 20점
 */
const scoreTrendBonus = Math.min(
  settings.openScoreTrendMaxBonus,

  Math.max(0, scoreDiff) *
    settings.openScoreTrendBonusPerPoint +

  Math.max(0, recentScoreDiff) *
    settings.openRecentScoreTrendBonusPerPoint
);

  if (scoreDiff < -1) return { pass: false, reason: `점수 약화 ${baseline.score}→${current.score}` };
  if (volumeDiff < -35) return { pass: false, reason: `거래량 약화 ${Number(baseline.volumeRatio || 0).toFixed(1)}→${current.volumeRatio.toFixed(1)}%` };
  if (priceDiffRate < -0.50) {
    return {
      pass: false,
      reason:
        `확인 중 가격 하락 ${priceDiffRate.toFixed(2)}% / ` +
        `허용 -0.50%`
    };
  }
  
  /*
 * 첫 발견 가격보다는 높더라도,
 * 바로 직전 확인보다 0.10% 이상 하락했다면
 * 매수 직전 상승 흐름이 꺾인 것으로 판단한다.
 */
if (
  recentPriceDiffRate <=
  settings.openRecentPriceWeakBlockRate
) {
  return {
    pass: false,

    reason:
      `매수 직전 가격 약화 ` +
      `${recentPriceDiffRate.toFixed(2)}% / ` +
      `전체 ${priceDiffRate >= 0 ? "+" : ""}` +
      `${priceDiffRate.toFixed(2)}% / ` +
      `차단기준 ${settings.openRecentPriceWeakBlockRate.toFixed(2)}%`
  };
}
  
  if (
  priceDiffRate >
  settings.openConfirmMaxPriceRiseRate
) {
  return {
    pass: false,
    reason:
      `확인 중 가격 급등 ${priceDiffRate.toFixed(2)}% / ` +
      `추격매수 상한 ${settings.openConfirmMaxPriceRiseRate.toFixed(2)}%`
  };
}

const momentum = calculateOpenMomentumStrength(history);
if (!momentum.pass) {
  return {
    pass: false,
    reason: `상승 지속성 부족 / ${momentum.reason}`,
    momentumScore: Number(momentum.momentumScore || 0),
    priceRiseRate: Number(momentum.priceRiseRate || 0),
    volumeGrowthRate: Number(momentum.volumeGrowthRate || 0),
    scoreGrowth: Number(momentum.scoreGrowth || 0),
    pricePersistence: Number(momentum.pricePersistence || 0),
    volumePersistence: Number(momentum.volumePersistence || 0),
    observationCount: Array.isArray(history.samples) ? history.samples.length : 0,
    strongObservationCount: Number(momentum.strongCount || 0)
  };
}

  return {
  pass: true,

  scoreDiff,
  recentScoreDiff,
  scoreTrendBonus,
  momentumScore: Number(momentum.momentumScore || 0),
  momentumReason: momentum.reason || "",
  priceRiseRate: Number(momentum.priceRiseRate || 0),
  volumeGrowthRate: Number(momentum.volumeGrowthRate || 0),
  scoreGrowth: Number(momentum.scoreGrowth || 0),
  pricePersistence: Number(momentum.pricePersistence || 0),
  volumePersistence: Number(momentum.volumePersistence || 0),
  observationCount: Array.isArray(history.samples) ? history.samples.length : 0,
  strongObservationCount: Number(momentum.strongCount || 0),

  confirmPriceRiseRate:
    Number(priceDiffRate || 0),

  recentPriceDiffRate:
    Number(recentPriceDiffRate || 0),

  confirmPriceBonus:
    Number(confirmPriceBonus || 0),

  delayComparison: {
    firstSeenAtMs:
      history.firstSeenAtMs,

    firstPrice:
      Number(history.firstPrice || 0),

    priceAt5Seconds:
      Number(
        history.priceAt5Seconds ||
        current.price ||
        0
      ),

    priceAt15Seconds:
      Number(
        history.priceAt15Seconds ||
        current.price ||
        0
      )
  },

  reason:
    `강화 확인 / ` +
    `점수 ${baseline.score}→${current.score} ` +
    `(전체 ${scoreDiff >= 0 ? "+" : ""}${scoreDiff}, ` +
    `직전 ${recentScoreDiff >= 0 ? "+" : ""}${recentScoreDiff}) / ` +
    `점수추세 +${scoreTrendBonus.toFixed(1)} / ` +
    `${momentum.reason} / ` +
    `가격 전체 ${priceDiffRate >= 0 ? "+" : ""}` +
    `${priceDiffRate.toFixed(2)}% / ` +
    `직전 ${recentPriceDiffRate >= 0 ? "+" : ""}` +
    `${recentPriceDiffRate.toFixed(2)}% / ` +
    `가격보너스 +${confirmPriceBonus.toFixed(1)} / ` +
    `거래량 ${Number(baseline.volumeRatio || 0).toFixed(1)}` +
    `→${current.volumeRatio.toFixed(1)}%`
};
}

function judgeOpenBuy(state, item, price, options = {}) {
  const ignoreMarketBlocks = options.ignoreMarketBlocks === true;
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
  const isHotSignal =
    item.hotMatched === true || item.everHotMatched === true ||
    item.isDirectHotCandidate === true || item.everDirectHotCandidate === true ||
    item.source === "HOT" || item.originalSource === "HOT";
  const discoverScore = Number(item.discoverScore || 0);
  const isPriorityCandidate =
    item.isPriorityCandidate === true ||
    item.source === "PRIORITY";
  const hotMatched = item.hotMatched === true;
  const isDirectHotCandidate =
    item.isDirectHotCandidate === true ||
    item.everDirectHotCandidate === true ||
    item.originalSource === "HOT" ||
    item.source === "HOT";
  const hotScore = Number(item.hotScore || 0);

  /*
   * 장전 시장자료를 실제 매수 허용·차단에 사용한다.
   */
  const marketData = loadOpenMarketData();

  const marketAdjust =
    calculateOpenMarketAdjustment(item, marketData);

  const marketScore =
    Number(marketAdjust.marketScore || 0);

  const sectorBias =
    Number(marketAdjust.sectorBonus || 0);

  const matchedSectors =
    Array.isArray(marketAdjust.matchedSectors)
      ? marketAdjust.matchedSectors
      : [];

  /*
   * 기본적인 OPEN 실행 상태부터 확인한다.
   */
  if (!settings.openEnabled) {
    return {
      pass: false,
      reason: "OPEN OFF"
    };
  }

  if (state.openCompleted) {
    return {
      pass: false,
      reason: "오늘 OPEN 종료"
    };
  }

  if (
    (state.holdings || []).some(
      holding =>
        String(holding.code) ===
        String(item.code)
    )
  ) {
    return {
      pass: false,
      reason: "동일 종목 이미 보유중"
    };
  }

  if (wasBoughtToday(state, item.code)) {
    return {
      pass: false,
      reason: "오늘 이미 매수한 종목"
    };
  }

  /*
   * 발견점수·상승률·시가대비 조건에서 탈락하더라도 실제 가격·거래량
   * 관찰표본은 먼저 누적한다. 이전에는 앞단 필터를 통과한 후보만
   * 지속강도가 계산되어 학습화면의 평가횟수는 늘면서 점수는 0이었다.
   */
  const strengthen = options.precomputedStrengthen ||
    isOpenCandidateGettingStronger(
      state,
      item,
      price
    );

  /*
   * 장전 우선종목과 HOT는 필수 교집합이 아니라 가점 신호로 사용한다.
   * 다만 둘 다 없는 일반검색 후보는 발견점수가 1점 더 높아야 한다.
   */
  const hasPriorityOrHotSignal =
    isPriorityCandidate || hotMatched || isDirectHotCandidate;

  if (
    !hasPriorityOrHotSignal &&
    discoverScore <
      Number(settings.openMinDiscoverScore || 0) + 1
  ) {
    return {
      pass: false,
      reason:
        `일반후보 추가확인 / 발견점수 ${discoverScore} / ` +
        `필요 ${Number(settings.openMinDiscoverScore || 0) + 1}`
    };
  }

  /* HOT에 실제 포착된 종목만 HOT 최소점수를 검사한다. */
  if (
    hotMatched &&
    hotScore < Number(settings.openHotMinScore || 0)
  ) {
    return {
      pass: false,
      reason:
        `HOT 점수 부족 ${hotScore.toFixed(1)} / ` +
        `기준 ${Number(settings.openHotMinScore || 0).toFixed(1)}`
    };
  }

  /*
   * open-market.json이 없거나 오래되면
   * 시장 방향을 판단할 수 없으므로 매수를 중단한다.
   */
  if (
    !ignoreMarketBlocks &&
    settings.openMarketDataRequired &&
    !marketData.available
  ) {
    return {
      pass: false,
      _precomputedStrengthen: strengthen,
      reason:
        `OPEN 시장자료 없음 차단 / ` +
        `${marketData.reason ||
          "사용 가능한 시장자료 없음"}`
    };
  }

  if (!ignoreMarketBlocks && !marketData.available) {
    console.log(
      `[OPEN 시장자료 보완운영] ${marketData.reason || "시장자료 없음"} / ` +
      `종목 자체 조건으로 선별`
    );
  }

  /*
   * 시장이 극단적으로 약하면 완전 차단한다.
   * 25~39점 구간은 발견·지속성·가격/거래량 유지가 모두 매우 강한 후보만 예외 허용한다.
   */
  const weakMarketStrongOverride =
    evaluateOpenWeakMarketStrongOverride(state, item, marketData);

  if (
    !ignoreMarketBlocks &&
    marketData.available &&
    marketScore < Number(settings.openMarketAbsoluteBlockScore || 25)
  ) {
    return {
      pass: false,
      _precomputedStrengthen: strengthen,
      reason:
        `OPEN 시장절대차단 / ` +
        `시장 ${marketScore}점 / ` +
        `절대기준 ${Number(settings.openMarketAbsoluteBlockScore || 25)}점`
    };
  }

  if (
    !ignoreMarketBlocks &&
    marketData.available &&
    marketScore < settings.openMarketHardBlockScore &&
    weakMarketStrongOverride.pass !== true
  ) {
    return {
      pass: false,
      _precomputedStrengthen: strengthen,
      reason:
        `OPEN 시장급락 차단 / ` +
        `시장 ${marketScore}점 / 기본기준 ${settings.openMarketHardBlockScore}점 / ` +
        `${weakMarketStrongOverride.reason}`
    };
  }

  if (
    !ignoreMarketBlocks &&
    marketData.available &&
    marketScore < settings.openMarketHardBlockScore &&
    weakMarketStrongOverride.pass === true
  ) {
    console.log(
      `[OPEN 약세장 초강력예외] ${item.name || item.code} / ` +
      `${weakMarketStrongOverride.reason}`
    );
  }

  /*
   * 종목이 속한 섹터가 강한 약세이면 차단한다.
   */
  if (
    !ignoreMarketBlocks &&
    marketData.available &&
    matchedSectors.length > 0 &&
    sectorBias <=
      settings.openSectorHardBlockBias
  ) {
    return {
      pass: false,
      _precomputedStrengthen: strengthen,
      reason:
        `OPEN 섹터약세 차단 / ` +
        `시장 ${marketScore}점 / ` +
        `섹터 ${matchedSectors.join(",")} ` +
        `${sectorBias.toFixed(1)} / ` +
        `기준 ${Number(
          settings.openSectorHardBlockBias
        ).toFixed(1)}`
    };
  }

  /*
   * 시장점수 40~49:
   * 강한 섹터에 속한 종목만 허용한다.
   */
  if (
    !ignoreMarketBlocks &&
    marketData.available &&
    marketScore <
      settings.openMarketWeakScore &&
    matchedSectors.length > 0 &&
    sectorBias <
      settings.openWeakMarketMinSectorBias
  ) {
    return {
      pass: false,
      _precomputedStrengthen: strengthen,
      reason:
        `OPEN 약세장 강한섹터 아님 / ` +
        `시장 ${marketScore}점 / ` +
        `섹터 ${
          matchedSectors.join(",") ||
          "미확인"
        } ${sectorBias.toFixed(1)} / ` +
        `필요 ${Number(
          settings.openWeakMarketMinSectorBias
        ).toFixed(1)} 이상`
    };
  }

  /*
   * 시장점수 50~59:
   * 확인 가능한 섹터가 약세이면 차단한다.
   */
  if (
    !ignoreMarketBlocks &&
    marketData.available &&
    marketScore <
      settings.openMarketCautionScore &&
    matchedSectors.length > 0 &&
    sectorBias <
      settings.openCautionMinSectorBias
  ) {
    return {
      pass: false,
      _precomputedStrengthen: strengthen,
      reason:
        `OPEN 주의장 섹터부족 / ` +
        `시장 ${marketScore}점 / ` +
        `섹터 ${matchedSectors.join(",")} ` +
        `${sectorBias.toFixed(1)} / ` +
        `필요 ${Number(
          settings.openCautionMinSectorBias
        ).toFixed(1)} 이상`
    };
  }

  /*
   * 시장상황에 따라 종목 자체 매수조건을 강화한다.
   */
  let requiredDiscoverScore =
    Number(settings.openMinDiscoverScore);

  const volumeRule = getOpenRequiredVolumeRatio(
    marketScore,
    marketData.available
  );

  let requiredVolumeRatio =
    Number(volumeRule.required);

  let requiredConfirmPriceRise =
    Number(
      settings.openConfirmMinPriceRiseRate
    );

  if (marketData.available) {
    /*
     * 시장점수 50~59:
     * 평소보다 강한 종목만 허용한다.
     */
    if (
      marketScore >=
        settings.openMarketWeakScore &&
      marketScore <
        settings.openMarketCautionScore
    ) {
      requiredDiscoverScore +=
        Number(
          settings.openCautionDiscoverScoreAdd ||
          0
        );

      requiredConfirmPriceRise +=
        Number(
          settings.openCautionMinPriceRiseAdd ||
          0
        );
    }

    /*
     * 시장점수 40~49:
     * 종목 자체 흐름을 크게 강화한다.
     */
    if (
      marketScore >=
        settings.openMarketHardBlockScore &&
      marketScore <
        settings.openMarketWeakScore
    ) {
      requiredDiscoverScore +=
        Number(
          settings.openWeakDiscoverScoreAdd ||
          0
        );

      requiredConfirmPriceRise +=
        Number(
          settings.openWeakMinPriceRiseAdd ||
          0
        );
    }
  }

  requiredDiscoverScore = Math.min(
    requiredDiscoverScore,
    Number(settings.openMaxRequiredDiscoverScore || 11)
  );

  const marketRequiredDiscoverScore = requiredDiscoverScore;
  const fallbackHotObservationEligible =
    settings.openFallbackBuyEnabled === true &&
    getCurrentHHMM() >= String(settings.openFallbackBuyStartTime || "09:07") &&
    isHotSignal &&
    discoverScore >= Number(settings.openFallbackMinDiscoverScore || 9);

  if (
    discoverScore < requiredDiscoverScore &&
    !fallbackHotObservationEligible
  ) {
    return {
      pass: false,
      reason:
        `발견점수 부족 ${discoverScore} / ` +
        `시장반영 기준 ${requiredDiscoverScore} / ` +
        `시장 ${marketScore}점`
    };
  }

  // 주의장에서도 HOT 9점 후보는 즉시 매수하지 않고 지속성 관찰 단계로만 진입시킨다.
  if (fallbackHotObservationEligible && discoverScore < requiredDiscoverScore) {
    requiredDiscoverScore = Number(settings.openFallbackMinDiscoverScore || 9);
  }

  const appliedMinChangeRate = isDirectHotCandidate
    ? Number(settings.openHotDirectMinChangeRate || 1.0)
    : Number(settings.openMinChangeRate);
  const appliedMaxChangeRate = isDirectHotCandidate
    ? Number(settings.openHotDirectMaxChangeRate || 15.0)
    : Number(settings.openMaxChangeRate);

  if (changeRate < appliedMinChangeRate || changeRate > appliedMaxChangeRate) {
    return {
      pass: false,
      reason: `${isDirectHotCandidate ? "HOT " : ""}상승률 부적합 ` +
        `${changeRate.toFixed(2)}% / 기준 ${appliedMinChangeRate.toFixed(2)}~${appliedMaxChangeRate.toFixed(2)}%`
    };
  }

  if (isDirectHotCandidate) {
    requiredVolumeRatio = Number(settings.openHotDirectMinTradeVolumeRatio || 90);
  }

  if (
    volumeRatio <
    requiredVolumeRatio
  ) {
    return {
      pass: false,
      reason:
        `거래량 부족 ` +
        `${volumeRatio.toFixed(1)}% / ` +
        `적용기준 ${requiredVolumeRatio.toFixed(1)}% / ` +
        `시간기준 ${volumeRule.timeBase.toFixed(1)}% / ` +
        `시장가산 +${volumeRule.marketAdd.toFixed(1)}%p / ` +
        `시장 ${marketScore}점`
    };
  }

  const appliedMinDayPosition = isDirectHotCandidate
    ? Number(settings.openHotDirectMinDayPositionRate || 45)
    : Number(settings.openMinDayPositionRate);
  const appliedMaxDayPosition = isDirectHotCandidate
    ? Number(settings.openHotDirectMaxDayPositionRate || 95)
    : Number(settings.openMaxDayPositionRate);

  if (
    dayPosition < appliedMinDayPosition ||
    dayPosition > appliedMaxDayPosition
  ) {
    return {
      pass: false,
      reason:
        `${isDirectHotCandidate ? "HOT " : ""}당일위치 부적합 ` +
        `${dayPosition.toFixed(1)}% / 기준 ${appliedMinDayPosition.toFixed(1)}~${appliedMaxDayPosition.toFixed(1)}%`
    };
  }

  if (
    openPosition <
      settings.openMinOpenPositionRate ||
    openPosition >
      settings.openMaxOpenPositionRate
  ) {
    return {
      pass: false,
      reason:
        `시가대비 부적합 ` +
        `${openPosition.toFixed(2)}%`
    };
  }

  /*
   * 첫 발견 이후 점수와 가격이 실제로 강화되는지 확인한다.
   */
  /*
   * 최초 발견, 확인 대기, 점수약화 등
   * 기존 강화 판정부터 먼저 처리해야 한다.
   */
  if (!strengthen.pass) {
    return {
      pass: false,
      reason: strengthen.reason,
      momentumScore: Number(strengthen.momentumScore || 0),
      priceRiseRate: Number(strengthen.priceRiseRate || 0),
      volumeGrowthRate: Number(strengthen.volumeGrowthRate || 0),
      scoreGrowth: Number(strengthen.scoreGrowth || 0),
      pricePersistence: Number(strengthen.pricePersistence || 0),
      volumePersistence: Number(strengthen.volumePersistence || 0),
      observationCount: Number(strengthen.observationCount || 0),
      strongObservationCount: Number(strengthen.strongObservationCount || 0),
      fallbackWatchCandidate: fallbackHotObservationEligible,
      marketRequiredDiscoverScore,
      requiredDiscoverScore,
      requiredVolumeRatio,
      requiredConfirmPriceRise
    };
  }

  const confirmPriceRiseRate =
    Number(
      strengthen.confirmPriceRiseRate || 0
    );

  /*
   * 시장이 약할수록 더 높은 확인 상승률을 요구한다.
   */
  if (
    confirmPriceRiseRate <
    requiredConfirmPriceRise
  ) {
    return {
      pass: false,
      reason:
        `시장반영 상승힘 부족 / ` +
        `확인가격 ` +
        `${confirmPriceRiseRate.toFixed(2)}% / ` +
        `필요 ` +
        `${requiredConfirmPriceRise.toFixed(2)}% / ` +
        `시장 ${marketScore}점`
    };
  }

  const baseRankScore =
    discoverScore * 10 +
    Math.min(volumeRatio, 500) * 0.15 +
    dayPosition * 0.25 +
    Math.max(0, 4 - changeRate) * 5;

  /*
   * 우선종목 여부는 검색순서에 이미 반영되므로
   * 최종 매수점수에는 작은 보너스만 적용한다.
   */
  const priorityBonus = isPriorityCandidate
    ? Math.max(
        0,
        Math.min(
          Number(settings.openPriorityBonusMax || 30),
          Number(item.priorityScore || 0) *
            Number(settings.openPriorityScoreWeight || 0.30)
        )
      )
    : 0;

  const hotBonus = hotMatched
    ? Math.max(
        0,
        Math.min(
          Number(settings.openHotBonusMax || 50),
          hotScore * Number(settings.openHotScoreWeight || 0.50)
        )
      )
    : 0;

  /* HOT 스캐너가 계산한 최근 30초 상승 지속성 보너스 */
  const hotMomentumScore = Number(item.hotMomentumScore || 0);
  const hotMomentumBonus = hotMatched
    ? Math.max(
        0,
        Math.min(
          Number(settings.openHotMomentumBonusMax || 30),
          hotMomentumScore * Number(settings.openHotMomentumWeight || 0.50)
        )
      )
    : 0;

  /*
   * 첫 발견 이후 점수상승 추세 보너스
   */
  const scoreTrendBonus =
    Number(
      strengthen.scoreTrendBonus || 0
    );

  /*
   * 확인기간 가격상승 보너스
   */
  const confirmPriceBonus =
    Number(
      strengthen.confirmPriceBonus || 0
    );

  const momentumScore =
    Number(strengthen.momentumScore || 0);

  const rankScore =
    baseRankScore +
    Number(
      marketAdjust.totalBonus || 0
    ) +
    priorityBonus +
    hotBonus +
    hotMomentumBonus +
    scoreTrendBonus +
    confirmPriceBonus +
    momentumScore;

  return {
    pass: true,

    rankScore,
    baseRankScore,

    marketScore,
    marketType:
      marketAdjust.marketType || null,

    marketBonus:
      Number(
        marketAdjust.marketBonus || 0
      ),

    sectorBonus:
      Number(
        marketAdjust.sectorBonus || 0
      ),

    priorityBonus:
      Number(priorityBonus || 0),

    hotScore,
    hotBonus:
      Number(hotBonus || 0),
    hotMomentumScore: Number(hotMomentumScore || 0),
    hotMomentumBonus: Number(hotMomentumBonus || 0),
    hotPriceRise30s: Number(item.hotPriceRise30s || 0),
    hotVolumeGrowth30s: Number(item.hotVolumeGrowth30s || 0),
    hotPricePersistence: Number(item.hotPricePersistence || 0),
    hotVolumePersistence: Number(item.hotVolumePersistence || 0),
    hotHighRefreshCount: Number(item.hotHighRefreshCount || 0),
    hotDurationSeconds: Number(item.hotDurationSeconds || 0),
    hotMatched,
    fallbackWatchCandidate: fallbackHotObservationEligible,
    marketRequiredDiscoverScore,

    scoreTrendBonus:
      Number(scoreTrendBonus || 0),

    momentumScore:
      Number(momentumScore || 0),

    momentumReason:
      strengthen.momentumReason || "",
    priceRiseRate: Number(strengthen.priceRiseRate || 0),
    volumeGrowthRate: Number(strengthen.volumeGrowthRate || 0),
    scoreGrowth: Number(strengthen.scoreGrowth || 0),
    pricePersistence: Number(strengthen.pricePersistence || 0),
    volumePersistence: Number(strengthen.volumePersistence || 0),
    observationCount: Number(strengthen.observationCount || 0),
    strongObservationCount: Number(strengthen.strongObservationCount || 0),
    weakMarketStrongOverride: weakMarketStrongOverride.pass === true,
    weakMarketStrongOverrideReason: weakMarketStrongOverride.reason,

    confirmPriceRiseRate,

    recentPriceDiffRate:
      Number(
        strengthen.recentPriceDiffRate ||
        0
      ),

    confirmPriceBonus:
      Number(confirmPriceBonus || 0),

    scoreDiff:
      Number(
        strengthen.scoreDiff || 0
      ),

    recentScoreDiff:
      Number(
        strengthen.recentScoreDiff || 0
      ),

    priorityReason:
      item.priorityReason || null,

    matchedSectors,

    marketDataUpdatedAt:
      marketData.updatedAt || null,

    delayComparison:
      strengthen.delayComparison || null,

    requiredDiscoverScore,
    requiredVolumeRatio,
    requiredConfirmPriceRise,

    reason:
      `OPEN 통과 / ` +
      `${
        isDirectHotCandidate
          ? (fallbackHotObservationEligible && discoverScore < marketRequiredDiscoverScore
              ? "HOT 9점 관찰통과"
              : "HOT 직접유입")
          : item.source === "PRIORITY"
          ? "장전우선"
          : isPriorityCandidate
            ? "장전집중"
          : item.source === "FOCUSED"
            ? "집중후보"
            : "일반검색"
      } / ` +
      `발견 ${discoverScore}` +
      `(${requiredDiscoverScore}${marketRequiredDiscoverScore !== requiredDiscoverScore ? `, 시장엄격 ${marketRequiredDiscoverScore}` : ""}) / ` +
      `상승 ${changeRate.toFixed(2)}% / ` +
      `거래량 ${volumeRatio.toFixed(1)}%` +
      `(${requiredVolumeRatio.toFixed(1)}%) / ` +
      `위치 ${dayPosition.toFixed(1)}% / ` +
      `시가대비 ${openPosition.toFixed(2)}% / ` +
      `기본점수 ${baseRankScore.toFixed(1)} / ` +
      `점수추세 +${scoreTrendBonus.toFixed(1)} / ` +
      `지속강도 ${momentumScore.toFixed(1)} / ` +
      `가격 전체 ${confirmPriceRiseRate.toFixed(2)}%` +
      `(기준 ${requiredConfirmPriceRise.toFixed(2)}%) / ` +
      `가격 직전 ${Number(
        strengthen.recentPriceDiffRate || 0
      ).toFixed(2)}% / ` +
      `가격보너스 +${confirmPriceBonus.toFixed(1)} / ` +
      `장전점수 ${Number(item.priorityScore || 0).toFixed(1)} ` +
      `(보너스 +${priorityBonus.toFixed(1)}) / ` +
      `HOT ${hotScore.toFixed(1)} ` +
      `(보너스 +${hotBonus.toFixed(1)}) / ` +
      `HOT지속 ${hotMomentumScore.toFixed(1)} ` +
      `(보너스 +${hotMomentumBonus.toFixed(1)}) / ` +
      `${marketAdjust.reason} / ` +
      `${weakMarketStrongOverride.pass ? "약세장 초강력예외 통과 / " : ""}` +
      `최종점수 ${rankScore.toFixed(1)}`
  };
}

/*
 * 실제 주문판정은 그대로 유지하고, 시장·섹터 차단으로 끝난 후보만
 * 동일한 관찰표본을 재사용해 종목 자체 조건을 끝까지 가상평가한다.
 */
function judgeOpenBuyWithDiagnostics(state, item, price) {
  const judged = judgeOpenBuy(state, item, price);
  const marketRejected = isOpenMarketRejectReason(judged.reason);
  const precomputedStrengthen = judged._precomputedStrengthen;
  delete judged._precomputedStrengthen;

  if (judged.pass === true) {
    judged.passWithoutMarket = true;
    judged.marketOnlyBlocked = false;
    judged.withoutMarketReason = judged.reason || "OPEN 통과";
    judged.withoutMarketRankScore = Number(judged.rankScore || 0);
    return judged;
  }

  if (!marketRejected) {
    judged.passWithoutMarket = false;
    judged.marketOnlyBlocked = false;
    judged.withoutMarketReason = judged.reason || "종목조건 미충족";
    judged.withoutMarketRankScore = 0;
    return judged;
  }

  const diagnosticMarketData = loadOpenMarketData();
  const diagnosticMarketAdjust = calculateOpenMarketAdjustment(
    item,
    diagnosticMarketData
  );
  judged.marketScore = Number(diagnosticMarketAdjust.marketScore || 0);
  judged.marketType = diagnosticMarketAdjust.marketType || null;
  judged.marketBonus = Number(diagnosticMarketAdjust.marketBonus || 0);
  judged.sectorBonus = Number(diagnosticMarketAdjust.sectorBonus || 0);
  judged.matchedSectors = Array.isArray(diagnosticMarketAdjust.matchedSectors)
    ? diagnosticMarketAdjust.matchedSectors
    : [];
  judged.marketDataUpdatedAt = diagnosticMarketData.updatedAt || null;

  const shadow = judgeOpenBuy(state, item, price, {
    ignoreMarketBlocks: true,
    precomputedStrengthen
  });
  delete shadow._precomputedStrengthen;

  judged.passWithoutMarket = shadow.pass === true;
  judged.marketOnlyBlocked = shadow.pass === true;
  judged.withoutMarketReason = shadow.reason || "시장제외 가상평가 결과 없음";
  judged.withoutMarketRankScore = Number(shadow.rankScore || 0);
  judged.withoutMarketDiagnostic = {
    pass: shadow.pass === true,
    reason: shadow.reason || "",
    rankScore: Number(shadow.rankScore || 0),
    baseRankScore: Number(shadow.baseRankScore || 0),
    momentumScore: Number(shadow.momentumScore || 0),
    requiredDiscoverScore: Number(shadow.requiredDiscoverScore || 0),
    requiredVolumeRatio: Number(shadow.requiredVolumeRatio || 0),
    requiredConfirmPriceRise: Number(shadow.requiredConfirmPriceRise || 0)
  };
  return judged;
}

function makeOpenBuyDiagnostic(item, price, judged = {}) {
  return {
      discoverScore: Number(item.discoverScore || 0),
      baseRankScore: Number(judged.baseRankScore || 0),
      rankScore: Number(judged.rankScore || 0),
      scoreTrendBonus: Number(judged.scoreTrendBonus || 0),
      momentumScore: Number(judged.momentumScore || 0),
      momentumReason: judged.momentumReason || "",
      priceRiseRate: Number(judged.priceRiseRate || 0),
      volumeGrowthRate: Number(judged.volumeGrowthRate || 0),
      scoreGrowth: Number(judged.scoreGrowth || 0),
      pricePersistence: Number(judged.pricePersistence || 0),
      volumePersistence: Number(judged.volumePersistence || 0),
      observationCount: Number(judged.observationCount || 0),
      strongObservationCount: Number(judged.strongObservationCount || 0),
      weakMarketStrongOverride: judged.weakMarketStrongOverride === true,
      weakMarketStrongOverrideReason: judged.weakMarketStrongOverrideReason || "",
      hotMomentumScore: Number(judged.hotMomentumScore || item.hotMomentumScore || 0),
      hotMomentumBonus: Number(judged.hotMomentumBonus || 0),
      hotPriceRise30s: Number(judged.hotPriceRise30s || item.hotPriceRise30s || 0),
      hotVolumeGrowth30s: Number(judged.hotVolumeGrowth30s || item.hotVolumeGrowth30s || 0),
      hotPricePersistence: Number(judged.hotPricePersistence || item.hotPricePersistence || 0),
      hotVolumePersistence: Number(judged.hotVolumePersistence || item.hotVolumePersistence || 0),
      hotHighRefreshCount: Number(judged.hotHighRefreshCount || item.hotHighRefreshCount || 0),
      hotDurationSeconds: Number(judged.hotDurationSeconds || item.hotDurationSeconds || 0),
      confirmPriceBonus: Number(judged.confirmPriceBonus || 0),
      confirmPriceRiseRate: Number(judged.confirmPriceRiseRate || 0),
      recentPriceDiffRate: Number(judged.recentPriceDiffRate || 0),
      marketScore: Number(judged.marketScore || 0),
      marketType: judged.marketType || null,
      marketBonus: Number(judged.marketBonus || 0),
      sectorBonus: Number(judged.sectorBonus || 0),
      priorityBonus: Number(judged.priorityBonus || 0),
      volumeRatio: getTradeVolumeRatio(item),
      dayPosition: getDayPositionRate(item, price),
      openPosition: getOpenPositionRate(item, price),
      changeRate: Number(
        item.changeRate ||
        item.fluctuationRate ||
        item.riseRate ||
        item.rate ||
        0
      ),
      source: item.source || "FALLBACK",
      matchedSectors: Array.isArray(judged.matchedSectors)
        ? judged.matchedSectors
        : []
  };
}

function replaceOpenStateSnapshot(target, source) {
  for (const key of Object.keys(target || {})) delete target[key];
  Object.assign(target, source || {});
}

async function paperOpenBuy(state, item, price, reason, judged = {}) {
  const code = normalizeOpenStockCode(item.code);
  const name = item.name || item.stockName || item.korName || code;
  if (!code) {
    console.log(`[OPEN 매수차단] ${name || "종목미상"} / 종목코드 오류`);
    return { ok: false, reason: "종목코드 오류" };
  }

  if (!Array.isArray(state.pendingBuyCodes)) state.pendingBuyCodes = [];
  if (state.pendingBuyCodes.map(normalizeOpenStockCode).includes(code)) {
    console.log(`[OPEN 매수차단] ${name}(${code}) / 동일 종목 주문 처리 중`);
    return { ok: false, reason: "동일 종목 주문 처리 중" };
  }

  state.pendingBuyCodes.push(code);
  saveState(state);

  try {
    const availableCash = Number(state.totalCash || 0);
    const allocationBaseCash = Number(
      state.openAllocationBaseCash || state.dailyStartAsset || availableCash
    );
    const targetBuyAmount = allocationBaseCash * Number(settings.openInvestmentRatio || 0.20);
    const buyAmount = Math.min(availableCash, targetBuyAmount);
    const qty = Math.floor(buyAmount / Number(price || 0));
    if (qty <= 0) {
      const failReason = `주문가능 수량 0주 / 현금 ${availableCash.toLocaleString()}원`;
      console.log(`[OPEN 매수차단] ${name}(${code}) / ${failReason}`);
      return { ok: false, reason: failReason };
    }

    const buyDiagnostic = makeOpenBuyDiagnostic(item, price, judged);
    console.log(
      `[OPEN 매수요청] ${name}(${code}) / ${Number(price).toLocaleString()}원 / ` +
      `${qty}주 / ${Number(price * qty).toLocaleString()}원 / ` +
      `최종 ${buyDiagnostic.rankScore.toFixed(1)}점`
    );

    const orderUrl = `${API_BASE}/api/core-paper-buy`;
    const orderBody = {
      code,
      name,
      price,
      qty,
      strategyGroup: "OPEN",
      reason,
      openDiagnostic: buyDiagnostic,
      openMaxHoldingCount: Number(settings.openMaxHoldingCount || 5)
    };

    let result = null;
    let lastOrderError = null;

    // 내부 HTTP 연결이 순간적으로 끊긴 경우에만 1회 재시도한다.
    // 첫 요청이 실제 저장된 뒤 응답만 유실된 상황은 상태파일을 먼저 확인해
    // 중복 주문을 만들지 않는다.
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        result = await postJson(
          orderUrl,
          orderBody,
          Number(settings.openBuyRequestTimeoutMs || 15000)
        );
        break;
      } catch (err) {
        lastOrderError = err;
        console.error(
          "[OPEN 주문통신오류]",
          makeOpenRequestErrorDetail(err, { code, name, attempt })
        );

        const latestAfterError = loadState();
        const savedHolding = (latestAfterError.holdings || []).find(
          holding =>
            normalizeOpenStockCode(holding.code) === code &&
            String(holding.strategyGroup || "").toUpperCase() === "OPEN"
        );
        const savedBuyLog = (latestAfterError.tradeLogs || []).find(
          log =>
            String(log.date || "").slice(0, 10) === todayKey() &&
            log.type === "OPEN_BUY" &&
            normalizeOpenStockCode(log.code) === code
        );

        if (savedHolding && savedBuyLog) {
          result = {
            ok: true,
            recoveredAfterResponseFailure: true,
            totalCash: Number(latestAfterError.totalCash || 0),
            openBuyCount: getOpenBuyCountToday(latestAfterError),
            openCompleted: latestAfterError.openCompleted === true
          };
          replaceOpenStateSnapshot(state, latestAfterError);
          console.log(
            `[OPEN 주문복구확인] ${name}(${code}) / ` +
            `응답은 실패했지만 상태파일에서 매수완료 확인`
          );
          break;
        }

        if (attempt >= 2 || !isRetryableOpenOrderError(err)) break;

        console.log(
          `[OPEN 주문재시도] ${name}(${code}) / 0.8초 후 1회 재시도`
        );
        await sleep(800);
      }
    }

    if (!result?.ok) {
      throw lastOrderError || new Error("OPEN 내부 주문 API 응답 없음");
    }

    // 매수 API가 저장한 최신 상태를 다시 읽어 CORE 매도 등 동시 변경을 덮어쓰지 않는다.
    replaceOpenStateSnapshot(state, loadState());
    recordOpenLearningBuy(item, price, qty, reason, judged);

    console.log(
      `[OPEN 매수진단] ${name} / ` +
      `최종 ${buyDiagnostic.rankScore.toFixed(1)}점 / ` +
      `기본 ${buyDiagnostic.baseRankScore.toFixed(1)} / ` +
      `점수추세 +${buyDiagnostic.scoreTrendBonus.toFixed(1)} / ` +
      `지속강도 ${buyDiagnostic.momentumScore.toFixed(1)} / ` +
      `HOT지속 ${buyDiagnostic.hotMomentumScore.toFixed(1)} / ` +
      `가격보너스 +${buyDiagnostic.confirmPriceBonus.toFixed(1)} / ` +
      `시장 ${buyDiagnostic.marketBonus >= 0 ? "+" : ""}${buyDiagnostic.marketBonus.toFixed(1)} / ` +
      `섹터 ${buyDiagnostic.sectorBonus >= 0 ? "+" : ""}${buyDiagnostic.sectorBonus.toFixed(1)} / ` +
      `확인가격 ${buyDiagnostic.confirmPriceRiseRate >= 0 ? "+" : ""}${buyDiagnostic.confirmPriceRiseRate.toFixed(2)}% / ` +
      `직전 ${buyDiagnostic.recentPriceDiffRate >= 0 ? "+" : ""}${buyDiagnostic.recentPriceDiffRate.toFixed(2)}%`
    );

    console.log(
      `[OPEN 매수완료] ${name} / ${price.toLocaleString()}원 / ${qty}주 / ` +
      `${getOpenBuyCountToday(state)}/${Number(settings.openMaxHoldingCount || 5)}종목 / ` +
      `종목예산 ${targetBuyAmount.toLocaleString()}원 / ` +
      `현금 ${Number(result.totalCash ?? state.totalCash ?? 0).toLocaleString()}원`
    );
    return { ok: true, reason: "매수완료", result };
  } catch (err) {
    const failReason = err?.message || "알 수 없는 주문 오류";
    console.error(
      `[OPEN 매수실패] ${name}(${code}) / ${failReason}`,
      makeOpenRequestErrorDetail(err, { code, name })
    );
    return { ok: false, reason: failReason };
  } finally {
    // 정리할 때도 최신 파일을 기준으로 하여 다른 루프의 상태 변경을 보존한다.
    const latestState = loadState();
    if (!Array.isArray(latestState.pendingBuyCodes)) latestState.pendingBuyCodes = [];
    latestState.pendingBuyCodes = latestState.pendingBuyCodes.filter(
      savedCode => normalizeOpenStockCode(savedCode) !== code
    );
    saveState(latestState);
    replaceOpenStateSnapshot(state, latestState);
  }
}

function getOpenSellSignal(holding, price) {
  const buyPrice = Number(holding.buyPrice || 0);
  if (!buyPrice || !price) return null;

  const now = Date.now();
  const buyTimeMs =
    Number(holding.buyTimeMs || 0) ||
    Date.parse(String(holding.buyAt || "")) ||
    Date.parse(String(holding.buyTime || ""));
  const holdMinutes = Number.isFinite(buyTimeMs) && buyTimeMs > 0
    ? Math.max(0, (now - buyTimeMs) / 60000)
    : 0;
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

  const makeSignal = (type, reason) => ({
    type,
    qty: holding.qty,
    reason,
    signalAt: nowText(),
    signalAtMs: now,
    signalPrice: Number(price || 0),
    profitRate: Number(profitRate.toFixed(4)),
    highestProfitRate: Number(highestProfitRate.toFixed(4)),
    drawdownFromHigh: Number(drawdownFromHigh.toFixed(4)),
    holdMinutes: Number(holdMinutes.toFixed(2))
  });

  if (profitRate <= settings.openStopLossRate) {
    return makeSignal(
      "OPEN_STOP_LOSS",
      `OPEN 손절 ${profitRate.toFixed(2)}% / 기준 ${settings.openStopLossRate.toFixed(2)}%`
    );
  }

  const holdSeconds = holdMinutes * 60;
  if (holdSeconds < Number(settings.openMinHoldingSeconds || 120)) {
    return null;
  }

  if (highestProfitRate >= settings.openTrailingStartRate && drawdownFromHigh <= -Math.abs(settings.openTrailingStopRate)) {
    return makeSignal(
      "OPEN_TRAILING_SELL",
      `OPEN 전량익절 / 최고 ${highestProfitRate.toFixed(2)}% / 현재 ${profitRate.toFixed(2)}% / 고점대비 ${drawdownFromHigh.toFixed(2)}%`
    );
  }

  if (
    highestProfitRate >= settings.openStagnationStartRate &&
    profitRate >= settings.openMinProfitToStagnationSell &&
    secondsFromHigh >= settings.openStagnationSeconds
  ) {
    return makeSignal(
      "OPEN_STAGNATION_SELL",
      `OPEN 상승주춤 / 최고 ${highestProfitRate.toFixed(2)}% / 현재 ${profitRate.toFixed(2)}% / 고가 미갱신 ${Math.floor(secondsFromHigh)}초`
    );
  }

/*
 * 트레일링 시작 여부
 *
 * 최고수익률이 +0.7% 이상이었다면
 * 트레일링 관리가 시작된 종목으로 판단한다.
 */
const trailingStarted =
  highestProfitRate >=
  settings.openTrailingStartRate;

/*
 * 트레일링이 시작되지 않은 종목
 *
 * 추세 미진입 종목:
 * - 최대 보유시간 기준으로 청산
 * - 신규매수 종료시각과 무관하게 보유 관리
 */
if (
  !trailingStarted &&
  (
    holdMinutes >=
      settings.openMaxHoldingMinutes ||
    hhmm >=
      settings.openForceSellTime
  )
) {
  return makeSignal(
    "OPEN_TIME_SELL",
    `OPEN 일반 시간청산 / ` +
    `트레일링 미진입 / ` +
    `최고 ${highestProfitRate.toFixed(2)}% / ` +
    `현재 ${profitRate.toFixed(2)}% / ` +
    `보유 ${holdMinutes.toFixed(1)}분 / ` +
    `현재시각 ${hhmm}`
  );
}

/*
 * 트레일링이 시작된 종목
 *
 * 신규매수 종료 후에도 계속 보유한다.
 * 다만 무한 보유를 막기 위해:
 * - 트레일링 최대 보유시간
 * - 또는 최종 강제청산 시각
 */
if (
  trailingStarted &&
  (
    holdMinutes >=
      settings.openTrailingMaxHoldingMinutes ||
    hhmm >=
      settings.openTrailingForceSellTime
  )
) {
  return makeSignal(
    "OPEN_TRAILING_TIME_SELL",
    `OPEN 트레일링 최종청산 / ` +
    `최고 ${highestProfitRate.toFixed(2)}% / ` +
    `현재 ${profitRate.toFixed(2)}% / ` +
    `보유 ${holdMinutes.toFixed(1)}분 / ` +
    `현재시각 ${hhmm}`
  );
}

  return null;
}

async function paperOpenSell(state, holding, price, signal) {
  const normalizedCode = normalizeOpenStockCode(holding.code);
  const sellKey = `${todayKey()}_${normalizedCode}`;
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
      reason: signal.reason,
      signalAt: signal.signalAt || null,
      signalAtMs: Number(signal.signalAtMs || 0),
      signalPrice: Number(signal.signalPrice || price || 0)
    });

    recordOpenLearningSell(holding, price, signal, result);
    // 주문 API가 저장한 최신 보유·현금·거래원장을 다시 읽는다.
    replaceOpenStateSnapshot(state, loadState());

    state.openCompleted = true;
    state.openSkipped = false;
    state.openCompletedAt = nowText();
    state.openSellType = signal.type;
    state.openSellReason = signal.reason;
    saveState(state);

    console.log(`[${signal.type} 완료] ${holding.name} / ${price.toLocaleString()}원 / 손익 ${Number(result.profit || 0).toLocaleString()}원`);
    return true;
  } finally {
    const latestState = loadState();
    if (!Array.isArray(latestState.pendingSellCodes)) latestState.pendingSellCodes = [];
    latestState.pendingSellCodes = latestState.pendingSellCodes.filter(key => key !== sellKey);
    saveState(latestState);
    replaceOpenStateSnapshot(state, latestState);
  }
}


function getOpenRejectCategory(reason = "") {
  const text = String(reason || "");

  if (text.includes("첫 발견") || text.includes("확인 대기")) return "20초 강화확인 대기";
  if (text.includes("점수 약화") || text.includes("거래량 약화") || text.includes("가격 하락")) return "강화확인 실패";
  if (
    /시장절대차단|시장급락 차단|섹터약세 차단|약세장 강한섹터 아님|주의장 섹터부족|시장자료 없음 차단/.test(text)
  ) return "시장·섹터";
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
      : ` / ${judged.reason || "탈락"}`) +
    (
      judged.pass !== true && judged.passWithoutMarket === true
        ? ` / 시장제외 통과 ${Number(judged.withoutMarketRankScore || 0).toFixed(1)}`
        : judged.pass !== true && isOpenMarketRejectReason(judged.reason)
          ? ` / 시장제외 결과 ${judged.withoutMarketReason || "미확인"}`
          : ""
    )
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
  const passWithoutMarketCount = evaluated.filter(
    entry => entry.record?.passWithoutMarket === true
  ).length;
  const marketOnlyBlockedCount = evaluated.filter(
    entry => entry.record?.marketOnlyBlocked === true
  ).length;

  console.log(
    `[OPEN 스캔요약] #${scanId} ${hhmm} / ` +
    `발굴 ${candidates.length} / 평가 ${evaluated.length} / 실제통과 ${passed.length} / ` +
    `시장제외통과 ${passWithoutMarketCount} / 시장만차단 ${marketOnlyBlockedCount} / ` +
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

function makeOpenFallbackEntry(state, entry) {
  const { item, price } = entry;
  const strictRejectReason = String(entry?.judged?.reason || "");
  const discoverScore = Number(item.discoverScore || 0);
  const changeRate = Number(
    item.changeRate || item.fluctuationRate || item.riseRate || item.rate || 0
  );
  const volumeRatio = getTradeVolumeRatio(item);
  const dayPosition = getDayPositionRate(item, price);
  const openPosition = getOpenPositionRate(item, price);
  const isHotSignal =
    item.hotMatched === true || item.everHotMatched === true ||
    item.isDirectHotCandidate === true || item.everDirectHotCandidate === true ||
    item.source === "HOT" || item.originalSource === "HOT";
  const fallbackMarketData = loadOpenMarketData();
  const fallbackMarketAdjust =
    calculateOpenMarketAdjustment(item, fallbackMarketData);
  const fallbackMarketScore = fallbackMarketData.available
    ? Number(fallbackMarketData.marketScore || 0)
    : 0;
  const fallbackVolumeRule = getOpenRequiredVolumeRatio(
    fallbackMarketScore,
    fallbackMarketData.available
  );
  const fallbackRequiredVolumeRatio = Number(fallbackVolumeRule.required);
  const history = state.openCandidateHistory?.[String(item.code || "")] || {};
  const firstPrice = Number(history.firstPrice || price || 0);
  const firstPriceDiffRate = firstPrice > 0
    ? ((Number(price) - firstPrice) / firstPrice) * 100
    : 0;

  const samples = Array.isArray(history.samples) ? history.samples : [];
  const previousSample = samples.length >= 2
    ? samples[samples.length - 2]
    : null;
  const previousPrice = Number(previousSample?.price || 0);
  const recentPriceDiffRate = previousPrice > 0
    ? ((Number(price) - previousPrice) / previousPrice) * 100
    : 0;

  // 보완매수는 엄격판정의 시장·섹터 차단을 절대 우회하지 않는다.
  // 25~39점 약세장의 초강력 후보는 judgeOpenBuy()에서 먼저 예외 통과되어야 한다.
  if (
    /시장절대차단|시장급락 차단|섹터약세 차단|약세장 강한섹터 아님|주의장 섹터부족|시장자료 없음 차단/.test(
      strictRejectReason
    )
  ) return null;

  // 엄격판정에서 실제 상승흐름 훼손으로 탈락한 후보도 보완매수가 다시 살리지 않는다.
  if (
    /매수 직전 가격 약화|확인 중 가격 하락|확인 중 가격 급등|상승 지속성 부족|점수 약화|거래량 약화/.test(
      strictRejectReason
    )
  ) return null;

  if (discoverScore < settings.openFallbackMinDiscoverScore) return null;
  const configuredFallbackMax = Number(settings.openFallbackMaxChangeRate || 8.0);
  const fallbackMaxChangeRate = isHotSignal
    ? Math.min(
        Number(settings.openHotDirectMaxChangeRate || configuredFallbackMax),
        configuredFallbackMax
      )
    : configuredFallbackMax;
  if (
    changeRate < settings.openFallbackMinChangeRate ||
    changeRate > fallbackMaxChangeRate
  ) return null;
  if (
    volumeRatio < Math.max(
      fallbackRequiredVolumeRatio,
      Number(settings.openFallbackMinTradeVolumeRatio || 0)
    )
  ) return null;
  if (
    dayPosition < settings.openFallbackMinDayPositionRate ||
    dayPosition > settings.openFallbackMaxDayPositionRate
  ) return null;
  if (
    openPosition < settings.openFallbackMinOpenPositionRate ||
    openPosition > settings.openFallbackMaxOpenPositionRate
  ) return null;
  if (firstPriceDiffRate < settings.openFallbackMaxFirstPriceDropRate) return null;
  if (
    recentPriceDiffRate <= Number(settings.openRecentPriceWeakBlockRate || -0.50)
  ) return null;

  const momentum = calculateOpenMomentumStrength(history);
  if (
    settings.openFallbackMomentumRequired &&
    (
      !momentum.pass ||
      Number(momentum.momentumScore || 0) < Number(settings.openFallbackMinMomentumScore || 30)
    )
  ) return null;

  const isPriorityCandidate =
    item.isPriorityCandidate === true || item.source === "PRIORITY";
  const hotMatched = item.hotMatched === true;
  const hotScore = Number(item.hotScore || 0);
  const sourceBonus = isPriorityCandidate ? 15 : hotMatched ? 10 : 0;
  const rankScore =
    discoverScore * 10 +
    Math.min(volumeRatio, 500) * 0.12 +
    dayPosition * 0.20 +
    Math.max(0, changeRate) * 2 +
    sourceBonus +
    Math.min(20, hotScore * 0.20) +
    Math.max(-10, firstPriceDiffRate * 10) +
    Number(momentum.momentumScore || 0);

  return {
    item,
    price,
    judged: {
      pass: true,
      fallbackBuy: true,
      fallbackWatchCandidate: isHotSignal,
      rankScore,
      baseRankScore: rankScore,
      marketScore: fallbackMarketScore,
      marketType: fallbackMarketData.available
        ? (fallbackMarketData.marketType || "FALLBACK")
        : "FALLBACK",
      marketBonus: Number(fallbackMarketAdjust.marketBonus || 0),
      sectorBonus: Number(fallbackMarketAdjust.sectorBonus || 0),
      priorityBonus: isPriorityCandidate ? 15 : 0,
      hotScore,
      hotBonus: hotMatched ? Math.min(20, hotScore * 0.20) : 0,
      hotMatched,
      scoreTrendBonus: 0,
      momentumScore: Number(momentum.momentumScore || 0),
      momentumReason: momentum.reason || "",
      priceRiseRate: Number(momentum.priceRiseRate || 0),
      volumeGrowthRate: Number(momentum.volumeGrowthRate || 0),
      scoreGrowth: Number(momentum.scoreGrowth || 0),
      pricePersistence: Number(momentum.pricePersistence || 0),
      volumePersistence: Number(momentum.volumePersistence || 0),
      observationCount: samples.length,
      strongObservationCount: Number(momentum.strongCount || 0),
      confirmPriceRiseRate: firstPriceDiffRate,
      recentPriceDiffRate,
      confirmPriceBonus: 0,
      matchedSectors: Array.isArray(fallbackMarketAdjust.matchedSectors)
        ? fallbackMarketAdjust.matchedSectors
        : [],
      requiredDiscoverScore: settings.openFallbackMinDiscoverScore,
      requiredVolumeRatio: fallbackRequiredVolumeRatio,
      requiredConfirmPriceRise: settings.openFallbackMaxFirstPriceDropRate,
      reason:
        `OPEN 보완매수 / 발견 ${discoverScore} / 상승 ${changeRate.toFixed(2)}% / ` +
        `거래량 ${volumeRatio.toFixed(1)}% (기준 ${fallbackRequiredVolumeRatio.toFixed(1)}%, ` +
        `시간 ${fallbackVolumeRule.timeBase.toFixed(1)}%, 시장가산 +${fallbackVolumeRule.marketAdd.toFixed(1)}%p) / ` +
        `위치 ${dayPosition.toFixed(1)}% / ` +
        `시가대비 ${openPosition.toFixed(2)}% / 최초대비 ${firstPriceDiffRate.toFixed(2)}% / ` +
        `직전대비 ${recentPriceDiffRate.toFixed(2)}% / ` +
        `${momentum.reason} / 최종점수 ${rankScore.toFixed(1)}`
    }
  };
}

function selectOpenFallbackCandidate(state, evaluated, hhmm) {
  if (!settings.openFallbackBuyEnabled) return null;
  if (hhmm < settings.openFallbackBuyStartTime) return null;

  const rows = evaluated
    .map(entry => makeOpenFallbackEntry(state, entry))
    .filter(Boolean)
    .sort((a, b) => Number(b.judged.rankScore || 0) - Number(a.judged.rankScore || 0));

  return rows[0] || null;
}

async function runOpenBuyOnce() {
  if (!isKoreanWeekday()) return;

  const state = loadState();
  initOpenDayIfNeeded(state);

  if (!state.serverAutoEnabled || !settings.openEnabled) return;
  if (state.openCompleted || isOpenBuyCapacityFull(state)) return;

  const hhmm = getCurrentHHMM();
  if (hhmm < settings.openBuyStartTime) {
    updateOpenLiveTracking(state, {
      stage: "WAITING",
      stageLabel: "OPEN 시작 대기",
      decision: `${settings.openBuyStartTime}부터 후보 검색을 시작합니다.`,
      currentTime: hhmm
    });
    saveState(state);
    return;
  }

  if (hhmm >= settings.openBuyEndTime) {
    const buyCount = getOpenBuyCountToday(state);
    state.openCompleted = true;
    state.openSkipped = buyCount === 0;
    state.openCompletedAt = nowText();
    state.openSkipReason = buyCount === 0
      ? "OPEN 매수시간 종료 / 적합 후보 없음"
      : `OPEN 매수시간 종료 / ${buyCount}종목 매수 완료`;
    updateOpenLiveTracking(state, {
      stage: buyCount === 0 ? "SKIPPED" : "COMPLETED",
      stageLabel: buyCount === 0 ? "OPEN 종료 · 미매수" : "OPEN 운영 종료 · 매수완료",
      decision: state.openSkipReason,
      currentTime: hhmm
    }, state.openSkipReason, buyCount === 0 ? "WARN" : "SUCCESS");
    saveState(state);
    initializeVirtualTrackingFromLatestCandidates();
    if (buyCount === 0) recordOpenLearningSkip(state.openSkipReason);
    console.log(`[OPEN 종료] ${state.openSkipReason}`);
    return;
  }

  const scanId = ++openScanSequence;
  const scanStartedAt = Date.now();
  updateOpenLiveTracking(state, {
    stage: "SCANNING",
    stageLabel: "후보 검색 중",
    decision: "HOT·잠재·장전 우선·일반검색 후보를 수집하고 있습니다.",
    currentTime: hhmm,
    scanId,
    scanStartedAtMs: scanStartedAt,
    potentialCount: Object.keys(state.openPotentialCandidates || {}).length
  }, `#${scanId} 후보 검색 시작`);
  saveState(state);

  console.log(
    `[OPEN 스캔시작] #${scanId} ${hhmm} / ` +
    `매수시간 ${settings.openBuyStartTime}~${settings.openBuyEndTime} / ` +
    `실제매수 확인 ${settings.openConfirmWaitMs / 1000}초 / ` +
    `잠재후보 ${Object.keys(state.openPotentialCandidates || {}).length}개 / ` +
    `현금 ${Number(state.totalCash || 0).toLocaleString()}원`
  );

  const risk = checkDailyLossLimit(state);
  if (risk.stopped) {
    state.openCompleted = true;
    state.openSkipped = true;
    state.openCompletedAt = nowText();
    state.openSkipReason = risk.reason;
    updateOpenLiveTracking(state, {
      stage: "BLOCKED",
      stageLabel: "위험관리 차단",
      decision: risk.reason,
      currentTime: hhmm
    }, risk.reason, "ERROR");
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
  updateOpenLiveTracking(state, {
    stage: "EVALUATING",
    stageLabel: "후보 평가 중",
    decision: `${candidates.length}개 후보의 가격·거래량·지속강도를 평가하고 있습니다.`,
    candidateCount: candidates.length,
    currentTime: hhmm
  });
  saveState(state);
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

    const judged = judgeOpenBuyWithDiagnostics(state, item, price);
    evaluated.push({
      item,
      price,
      judged,
      record: makeOpenCandidateLearningRecord(state, item, price, judged)
    });

    if (judged.pass) {
      if (item.potentialCandidate === true) {
        removeOpenPotentialCandidate(
          state,
          String(item.code || ""),
          "PROMOTED",
          `정식후보 통과 / 점수 ${Number(item.discoverScore || 0)}`
        );
      }
      passed.push({ item, price, judged });
      continue;
    }

    const potentialReason = String(judged.reason || "");
    const canTrackPotential =
      settings.openPotentialEnabled &&
      Number(item.discoverScore || 0) >= Number(settings.openPotentialMinScore || 7) &&
      (
        settings.openPriorityRequired !== true ||
        item.isPriorityCandidate === true ||
        item.source === "PRIORITY" ||
        item.potentialCandidate === true
      ) &&
      !/OPEN OFF|오늘 OPEN 종료|오늘 OPEN 이미 매수|이미 보유|오늘 이미 매수|시장자료 없음 차단|시장절대차단|시장급락 차단/.test(potentialReason);

    if (canTrackPotential) {
      registerOpenPotentialCandidate(state, item, price, judged);
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
  initializeOpenVirtualTracking(evaluated, null);

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

  // 마지막 스캔값과 별도로 하루 누적 후보·평가·통과 종목을 보존한다.
  const strictPassedRows = passed.filter(
    entry => entry.judged?.fallbackWatchCandidate !== true
  );
  const fallbackObservedRows = passed.filter(
    entry => entry.judged?.fallbackWatchCandidate === true
  );
  recordOpenDailyScan(state, {
    scanId,
    candidates,
    evaluated,
    strictPassed: strictPassedRows
  });
  for (const entry of fallbackObservedRows) {
    addOpenDailyCode(ensureOpenDailyStats(state).fallbackPassedCodes, entry.item || {});
  }

  const topEvaluated = [...evaluated]
    .sort((a, b) =>
      getLearningCandidateSortScore(b.record) -
      getLearningCandidateSortScore(a.record)
    )[0] || null;

  state.openLastScanSummary = {
    scanId,
    checkedAt: nowText(),
    checkedAtMs: Date.now(),
    candidateCount: candidates.length,
    evaluatedCount: evaluated.length,
    passedCount: passed.length,
    strictPassedCount: strictPassedRows.length,
    fallbackPassedCount: fallbackObservedRows.length,
    passWithoutMarketCount: evaluated.filter(
      entry => entry.record?.passWithoutMarket === true
    ).length,
    marketOnlyBlockedCount: evaluated.filter(
      entry => entry.record?.marketOnlyBlocked === true
    ).length,
    potentialCount: Object.keys(state.openPotentialCandidates || {}).length,
    potentialPromotedCount: Number(state.openPotentialPromotedCount || 0),
    potentialExpiredCount: Number(state.openPotentialExpiredCount || 0),
    rejectCounts,
    marketScore: marketData.available
      ? Number(marketData.marketScore || 0)
      : null,
    marketType: marketData.available
      ? marketData.marketType || null
      : null,
    topCandidate: topEvaluated
      ? {
          ...topEvaluated.record,
          rejectCategory: topEvaluated.judged.pass
            ? null
            : getOpenRejectCategory(topEvaluated.judged.reason),
          rejectReason: topEvaluated.judged.pass
            ? null
            : topEvaluated.judged.reason
        }
      : null
  };

  if (topEvaluated) {
    state.openTopCandidate = state.openLastScanSummary.topCandidate;
  }

  const liveTop = state.openLastScanSummary.topCandidate;
  const topDecision = liveTop
    ? (liveTop.passed
        ? "엄격 조건 통과 · 최종 순위 비교 중"
        : (liveTop.rejectReason || "추가 관찰 또는 조건 충족 대기"))
    : "현재 평가 가능한 후보가 없습니다.";
  updateOpenLiveTracking(state, {
    stage: passed.length ? "SELECTING" : "OBSERVING",
    stageLabel: passed.length ? "매수 후보 선정 중" : "후보 관찰 중",
    decision: topDecision,
    scanId,
    currentTime: hhmm,
    candidateCount: candidates.length,
    evaluatedCount: evaluated.length,
    strictPassedCount: strictPassedRows.length,
    fallbackPassedCount: fallbackObservedRows.length,
    potentialCount: Object.keys(state.openPotentialCandidates || {}).length,
    rejectCounts,
    topCandidate: liveTop,
    scanElapsedMs: Date.now() - scanStartedAt
  }, liveTop ? `현재 1위 ${liveTop.name || liveTop.code} / ${topDecision}` : `#${scanId} 평가 후보 없음`);

  saveState(state);

  const elapsedMs = Date.now() - scanStartedAt;

  if (!passed.length) {
    const fallback = selectOpenFallbackCandidate(state, evaluated, hhmm);

    if (!fallback) {
      updateOpenLiveTracking(state, {
        stage: "OBSERVING",
        stageLabel: hhmm >= settings.openFallbackBuyStartTime ? "보완후보 관찰 중" : "엄격후보 관찰 중",
        decision: topEvaluated?.judged?.reason || "통과 후보가 없어 다음 스캔을 기다립니다.",
        strictPassedCount: 0,
        fallbackPassedCount: 0,
        nextCheckExpectedMs: Date.now() + Number(settings.openBuyLoopMs || 5000)
      });
      saveState(state);
      console.log(
        `[OPEN 스캔종료] #${scanId} 엄격·보완 후보 모두 없음 / ` +
        `소요 ${(elapsedMs / 1000).toFixed(1)}초`
      );
      return;
    }

    passed.push(fallback);
    recordOpenDailySelection(state, fallback, true);
    updateOpenLiveTracking(state, {
      stage: "FALLBACK_SELECTED",
      stageLabel: "보완매수 후보 선정",
      decision: fallback.judged.reason,
      fallbackPassedCount: 1,
      topCandidate: {
        ...fallback.record,
        name: fallback.item.name || fallback.item.code,
        code: fallback.item.code,
        price: fallback.price,
        passed: true,
        fallbackBuy: true,
        rankScore: Number(fallback.judged.rankScore || 0),
        momentumScore: Number(fallback.judged.momentumScore || 0),
        reason: fallback.judged.reason
      }
    }, `보완후보 ${fallback.item.name || fallback.item.code} 선정`);
    saveState(state);
    console.log(
      `[OPEN 보완선정] #${scanId} ` +
      `${makeOpenCandidateLogText(fallback.item, fallback.price, fallback.judged)} / ` +
      `엄격 통과 0개 → 안전 최소조건 최고 후보 매수 진행`
    );
  }

  passed.sort(
    (a, b) =>
      Number(b.judged.rankScore || 0) -
      Number(a.judged.rankScore || 0)
  );

  const alreadyBoughtCodes = new Set(
    (state.tradeLogs || [])
      .filter(log => log.date === todayKey() && log.type === "OPEN_BUY")
      .map(log => String(log.code || ""))
  );
  const best = passed.find(row => !alreadyBoughtCodes.has(String(row.item.code || "")));

  if (!best) {
    updateOpenLiveTracking(state, {
      stage: "OBSERVING",
      stageLabel: "추가 후보 관찰 중",
      decision: "통과 후보가 모두 오늘 이미 매수한 종목이라 새 후보를 기다립니다.",
      boughtCount: getOpenBuyCountToday(state),
      maxBuyCount: Number(settings.openMaxHoldingCount || 5)
    });
    saveState(state);
    return;
  }

  initializeOpenDelayComparison(best.item, best.judged);
  initializeOpenVirtualTracking(evaluated, best.item.code);
  recordOpenDailySelection(
    state,
    best,
    best.judged.fallbackBuy === true || best.judged.fallbackWatchCandidate === true
  );

  console.log(
    `[OPEN 최종선정] #${scanId} ` +
    `${makeOpenCandidateLogText(best.item, best.price, best.judged)} / ` +
    `기본 ${Number(best.judged.baseRankScore || 0).toFixed(1)} / ` +
    `시장 ${Number(best.judged.marketBonus || 0) >= 0 ? "+" : ""}${Number(best.judged.marketBonus || 0).toFixed(1)} / ` +
    `섹터 ${Number(best.judged.sectorBonus || 0) >= 0 ? "+" : ""}${Number(best.judged.sectorBonus || 0).toFixed(1)} / ` +
    `장전 ${Number(best.item.priorityScore || 0).toFixed(1)}→+${Number(best.judged.priorityBonus || 0).toFixed(1)} / ` +
    `HOT ${Number(best.judged.hotScore || 0).toFixed(1)}→+${Number(best.judged.hotBonus || 0).toFixed(1)} / ` +
    `통과 ${passed.length}개 / 소요 ${(elapsedMs / 1000).toFixed(1)}초`
  );

  updateOpenLiveTracking(state, {
    stage: "BUYING",
    stageLabel: "매수 주문 처리 중",
    decision: best.judged.reason,
    selectedCode: String(best.item.code || ""),
    selectedName: best.item.name || best.item.code || "",
    selectedPrice: Number(best.price || 0),
    topCandidate: {
      ...best.item,
      price: Number(best.price || 0),
      rankScore: Number(best.judged.rankScore || 0),
      momentumScore: Number(best.judged.momentumScore || 0),
      reason: best.judged.reason,
      passed: true
    }
  }, `최종선정 ${best.item.name || best.item.code} · 매수 주문 처리`);
  saveState(state);

  const buyResult = await paperOpenBuy(
    state,
    best.item,
    best.price,
    best.judged.reason,
    best.judged
  );
  const bought = buyResult?.ok === true;
  const buyFailureReason = bought ? "" : (buyResult?.reason || "매수 실패 또는 중복차단");

  updateOpenLiveTracking(state, {
    stage: bought
      ? (isOpenBuyCapacityFull(state) ? "BOUGHT" : "OBSERVING")
      : "BUY_FAILED",
    stageLabel: bought
      ? (isOpenBuyCapacityFull(state)
          ? `OPEN 최대 ${Number(settings.openMaxHoldingCount || 5)}종목 매수완료`
          : "OPEN 추가 후보 관찰 중")
      : "매수 실패",
    decision: bought
      ? `${best.item.name || best.item.code} 매수완료 · ${getOpenBuyCountToday(state)}/${Number(settings.openMaxHoldingCount || 5)}종목`
      : `${best.item.name || best.item.code} 매수실패 / ${buyFailureReason}`,
    bought: Boolean(bought),
    selectedCode: String(best.item.code || ""),
    selectedName: best.item.name || best.item.code || "",
    selectedPrice: Number(best.price || 0)
  }, bought
    ? `${best.item.name || best.item.code} OPEN 매수완료`
    : `${best.item.name || best.item.code} 매수 실패 / ${buyFailureReason}`,
    bought ? "SUCCESS" : "ERROR");
  saveState(state);

  console.log(
    `[OPEN 매수결과] #${scanId} ` +
    `${best.item.name || best.item.code} / ` +
    `${bought ? "매수완료" : `매수실패 / ${buyFailureReason}`}`
  );
}

async function checkOpenSellOnce() {
  if (!isKoreanWeekday()) return;
  if (!isBetweenTime("09:00", settings.openTrailingForceSellTime)) return;

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
