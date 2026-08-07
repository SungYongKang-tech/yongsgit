const fs = require("fs");
const path = require("path");

const STATE_FILE = path.join(__dirname, "paper-state-core.json");
const MANUAL_SELL_REQUEST_DIR = path.join(__dirname, "manual-sell-requests");
const MANUAL_SELL_RESULT_DIR = path.join(__dirname, "manual-sell-results");
const MANUAL_SELL_REQUEST_TTL_MS = 90 * 1000;


for (const dir of [MANUAL_SELL_REQUEST_DIR, MANUAL_SELL_RESULT_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
const HOT_CANDIDATES_FILE = path.join(__dirname, "hot-candidates.json");
const API_BASE = "http://localhost:3000";

const {
  startHotScanner
} = require("./hot-scanner");


function sleepSync(ms) {
  const sab = new SharedArrayBuffer(4);
  const view = new Int32Array(sab);
  Atomics.wait(view, 0, 0, ms);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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

function loadHotCandidates() {
  if (!settings.hotScannerEnabled) {
    return [];
  }

  if (!fs.existsSync(HOT_CANDIDATES_FILE)) {
    return [];
  }

  try {
    const data = readJsonFileSafe(
      HOT_CANDIDATES_FILE,
      {
        date: todayKey(),
        updatedAtMs: 0,
        rows: []
      }
    );

    if (!data || data.date !== todayKey()) {
      return [];
    }

    const updatedAtMs =
      Number(data.updatedAtMs || 0);

    const fileAgeMs =
      updatedAtMs > 0
        ? Date.now() - updatedAtMs
        : Number.MAX_SAFE_INTEGER;

    if (
      fileAgeMs >
      settings.hotCandidateFileMaxAgeMs
    ) {
      console.log(
        `[HOT 후보 제외] 파일 오래됨 / ` +
        `${Math.floor(fileAgeMs / 1000)}초 경과`
      );

      return [];
    }

    const rows =
      Array.isArray(data.rows)
        ? data.rows
        : [];

    return rows
      .filter(item => {
        const code =
          String(item.code || "").trim();

        const price = Math.abs(Number(
          item.currentPrice ||
          item.price ||
          item.raw?.cur_prc ||
          0
        ));

        return code && price > 0;
      })
      .filter(item =>
        !isExcludedStock(item)
      )
      .filter(item =>
        Number(item.discoverScore || 0) >=
        settings.hotCandidateMinDiscoverScore
      )
      .sort(
        (a, b) =>
          Number(b.hotScore || 0) -
          Number(a.hotScore || 0)
      )
      .slice(
        0,
        settings.hotCandidateMaxCount
      )
      .map(item => ({
        ...item,

        code:
          String(item.code || "")
            .padStart(6, "0"),

        candidateSource: "HOT"
      }));
  } catch (err) {
    console.error(
      "[HOT 후보 읽기 오류]",
      err.message
    );

    return [];
  }
}

function mergeBuyCandidates(
  hotCandidates = [],
  discoveredCandidates = []
) {
  const candidateMap = new Map();

  /*
   * 일반 후보를 먼저 넣고
   * HOT 후보를 나중에 넣는다.
   *
   * 같은 종목이면 HOT의 최신 정보가
   * 일반 후보 정보를 덮어쓴다.
   */
  for (
    const item of discoveredCandidates
  ) {
    const code =
      String(item.code || "")
        .padStart(6, "0");

    if (!code || code === "000000") {
      continue;
    }

    candidateMap.set(code, {
      ...item,
      code,
      candidateSource:
        item.candidateSource ||
        "DISCOVER"
    });
  }

  for (const item of hotCandidates) {
    const code =
      String(item.code || "")
        .padStart(6, "0");

    if (!code || code === "000000") {
      continue;
    }

    const existing =
      candidateMap.get(code) || {};

    candidateMap.set(code, {
      ...existing,
      ...item,

      code,

      raw: {
        ...(existing.raw || {}),
        ...(item.raw || {})
      },

      candidateSource: "HOT"
    });
  }

  return Array.from(
    candidateMap.values()
  ).sort((a, b) => {
    /*
     * HOT 후보 우선
     */
    const aHot =
      a.candidateSource === "HOT"
        ? 1
        : 0;

    const bHot =
      b.candidateSource === "HOT"
        ? 1
        : 0;

    if (aHot !== bHot) {
      return bHot - aHot;
    }

    /*
     * 같은 출처에서는 HOT 점수,
     * 발견점수 순서
     */
    const hotScoreDiff =
      Number(b.hotScore || 0) -
      Number(a.hotScore || 0);

    if (hotScoreDiff !== 0) {
      return hotScoreDiff;
    }

    return (
      Number(b.discoverScore || 0) -
      Number(a.discoverScore || 0)
    );
  });
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

  // BUY LOOP 경량화: 한 번에 조회·평가하는 범위를 줄여 매도 점검 지연을 방지
  discoverScanLimit: 40,
  discoverLimit: 40,
minDiscoverScore: 7,

// 장 초반 CORE/VOLUME 후보 검색 강화
earlyDiscoverEndTime: "09:30",
midDiscoverEndTime: "10:00",

earlyDiscoverScanLimit: 50,
midDiscoverScanLimit: 40,

earlyBuyLoopMs: 30 * 1000,
midBuyLoopMs: 45 * 1000,

  coreEnabled: true,
 coreStartTime: "09:10",
coreEndTime: "11:00",
// 종목당 투자비율 (총 운용자산 기준)
buyAssetRatio: 0.125,

  coreMaxHoldingCount: 4,
  coreMaxChangeRate: 6.0,
  coreMinTradeVolumeRatio: 80,
  coreMinDayPositionRate: 50,
  coreMaxDayPositionRate: 80,

  volumeEnabled: true,
  volumeStartTime: "09:10",
volumeEndTime: "13:30",

// OPEN 우선운영: OPEN 매수 완료 전에는 최대 09:30까지
// CORE/VOLUME 후보 분석은 계속하고 실제 신규주문과 스위칭만 보류
openPriorityBuyBlockEnabled: true,
openPriorityBuyBlockEndTime: "09:30",
  volumeMaxHoldingCount: 4,
  volumeMinChangeRate: 0.8,
  volumeMaxChangeRate: 8.0,
  volumeMinTradeVolumeRatio: 120,
  volumeMinDayPositionRate: 45,
  volumeMaxDayPositionRate: 80,

  // 저유동성 종목 매수 차단
  // 거래량비율이 높아도 실제 누적 거래량·거래대금이 작으면 체결 공백과 슬리피지가 커질 수 있다.
  liquidityFilterEnabled: true,
  coreMinAbsoluteVolume: 50000,
  volumeMinAbsoluteVolume: 100000,
  coreMinTradeAmount: 100000000,
  volumeMinTradeAmount: 100000000,

  // 고가·중고가 종목 보완 통과 기준
  // 기본 거래량에는 못 미쳐도 거래대금이 충분하면 최소 체결량을 확인한 뒤 허용한다.
  coreAltMinAbsoluteVolume: 5000,
  coreAltMinTradeAmount: 200000000,
  volumeAltMinAbsoluteVolume: 50000,
  volumeAltMinTradeAmount: 300000000,

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

// VOLUME 초반 과열 매수 차단
// 거래량과 상승률은 높은데 고가권을 유지하지 못하면 매수하지 않는다.
volumeOverheatBlockEnabled: true,
volumeOverheatMinVolumeRatio: 200,
volumeOverheatMinChangeRate: 6.0,
volumeOverheatMinDayPositionRate: 75,

// 보유추세 붕괴 조기매도
// 가격·당일위치·보유점수가 동시에 무너진 경우에만 조기매도한다.
holdingWeakSellEnabled: true,
holdingWeakSellMinHoldMinutes: 10,
holdingWeakSellMaxScore: 55,
holdingWeakSellMaxProfitRate: -0.3,
holdingWeakSellMaxDayPositionRate: 25,
holdingWeakSellMinScoreDrop: -50,

// 보유점수 이력 저장: 손절·익절 당시 매수 후 추세 분석용
holdingScoreHistoryIntervalMs: 30 * 1000,
holdingScoreHistoryMaxCount: 120,

  buyLoopMs: 60 * 1000,
  sellLoopMs: 10 * 1000,

  coreBuyCooldownMinutes: 10,
  volumeBuyCooldownMinutes: 5,

  minHoldMinutes: 3,

candidateConfirmWaitMs: 30 * 1000,
candidateHistoryMaxAgeMs: 30 * 60 * 1000,

// 후보 강화 목록
candidateWatchMaxCount: 10,
candidateWatchMaxAgeMs: 30 * 60 * 1000,

candidateWatchLoopMs: 30 * 1000,
candidateWatchPriceDelayMs: 350,

// HOT Scanner 후보
hotScannerEnabled: true,

// HOT 파일이 이 시간보다 오래됐으면 사용하지 않음
hotCandidateFileMaxAgeMs: 90 * 1000,

// CORE/VOLUME에 넘길 HOT 후보 최대 수
hotCandidateMaxCount: 30,

// HOT 후보 최소 발견점수
hotCandidateMinDiscoverScore: 7,


// 후보 재평가 분석
candidateNearMissMaxCount: 10,
candidateNearMissLogCount: 5,

// BUY LOOP 1회 최대 평가 후보 수. HOT 후보는 병합 정렬에서 우선 유지된다.
buyCandidateEvalMaxCount: 60,

// 후보목록 상세 로그는 전략별 상위 N개만 출력
candidateScoreLogMaxCount: 5,

// 운영상 차단된 우수 후보 추적
operationalBlockedCandidateMaxCount: 20,

// 종목별 매수 판단 이력
// 같은 종목·전략은 한 행으로 합치고 최초/최고/최종 판단을 보존한다.
candidateDecisionHistoryMaxCount: 2000,

breakEvenStartRate: 2.0,
breakEvenProtectRate: 0.2,

  dailyLossLimitRate: 0.01,

  endSellTime: "15:10",
endSellOnlyPositive: true,

coreEndSellOnlyPositive: true,
volumeEndSellOnlyPositive: false,

// 보유종목 자동 스위칭
switchEnabled: true,

switchMinScoreGap: 20,
switchMaxHoldingProfitRate: 1.0,
switchMinHoldingMinutes: 10,
switchCooldownMinutes: 30,

// 시장온도별 매수조건 자동조정
marketConditionAdjustEnabled: true,

// 약세장도 전면 차단하지 않고 조건을 강화해 선별 매수
marketColdBuyBlocked: false,

// 강세 완화값
hotCoreVolumeRelax: 10,
hotVolumeVolumeRelax: 20,
hotDiscoverScoreRelax: 1,

// 주의 강화값
cautionCoreVolumeAdd: 5,
cautionVolumeVolumeAdd: 20,
cautionDiscoverScoreAdd: 1,

// CORE 거래량 기준 허용오차. 시장조정 기준보다 최대 3%p 부족해도 통과
coreVolumeRatioTolerance: 3,

// 약세 강화값: 전면 차단 대신 우수 후보만 선별
coldCoreVolumeAdd: 10,
coldVolumeVolumeAdd: 30,
coldDiscoverScoreAdd: 2

};

function nowText() {
  return new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
}

function todayKey() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
}

function isBetweenTime(start, end) {
  const hhmm = getCurrentHHMM();
  return hhmm >= start && hhmm <= end;
}

/*
 * OPEN 우선운영 중 실제 CORE/VOLUME 주문 차단 여부
 *
 * - 09:30 이전
 * - OPEN 실제 매수가 아직 완료되지 않음
 *
 * 후보검색, 점수계산, 후보강화 목록은 계속 수행한다.
 * 실제 매수와 보유종목 스위칭 주문만 차단한다.
 */
function isOpenPriorityBuyBlocked(state = {}) {
  if (!settings.openPriorityBuyBlockEnabled) {
    return false;
  }

  const hhmm = getCurrentHHMM();

  if (hhmm >= settings.openPriorityBuyBlockEndTime) {
    return false;
  }

  return state.openCompleted !== true;
}

function getOpenPriorityBlockReason(state = {}) {
  return (
    `OPEN 선정 진행 중 / ` +
    `매수 완료 또는 ${settings.openPriorityBuyBlockEndTime}부터 ` +
    `CORE/VOLUME 신규주문 허용`
  );
}

function loadState() {
  if (!fs.existsSync(STATE_FILE)) {
    return {
      holdings: [],
      tradeLogs: [],
      virtualResults: [],

      pendingBuyCodes: [],
      pendingSellCodes: [],

      coreCandidateWatchList: [],
      volumeCandidateWatchList: [],

      candidateDecisionHistory: {
        date: todayKey(),
        updatedAt: null,
        rows: []
      },

      operationalBlockedCandidateAnalysis: {
        date: todayKey(),
        updatedAt: null,
        rows: []
      },

      buyDecisionStats: {
        date: todayKey(),

        CORE: {
          checked: 0,
          passed: 0,
          bought: 0,

          conditionRejected: {},
          operationalBlocked: {},
          sources: {}
        },

        VOLUME: {
          checked: 0,
          passed: 0,
          bought: 0,

          conditionRejected: {},
          operationalBlocked: {},
          sources: {}
        }
      },

      lastSwitchAtByStrategy: {
        CORE: 0,
        VOLUME: 0
      },

      serverAutoEnabled:
        settings.serverAutoEnabledDefault,

      totalCash:
        settings.totalCash
    };
  }

  const state =
    readJsonFileSafe(STATE_FILE);

  /*
   * 기본 배열 보정
   */
  if (!Array.isArray(state.holdings)) {
    state.holdings = [];
  }

  if (!Array.isArray(state.tradeLogs)) {
    state.tradeLogs = [];
  }

  if (!Array.isArray(state.virtualResults)) {
    state.virtualResults = [];
  }

  if (!Array.isArray(state.pendingBuyCodes)) {
    state.pendingBuyCodes = [];
  }

  if (!Array.isArray(state.pendingSellCodes)) {
    state.pendingSellCodes = [];
  }

  if (
    !Array.isArray(
      state.coreCandidateWatchList
    )
  ) {
    state.coreCandidateWatchList = [];
  }

  if (
    !Array.isArray(
      state.volumeCandidateWatchList
    )
  ) {
    state.volumeCandidateWatchList = [];
  }

  /*
   * 종목별 매수 판단 이력 보정
   */
  if (
    !state.candidateDecisionHistory ||
    state.candidateDecisionHistory.date !== todayKey()
  ) {
    state.candidateDecisionHistory = {
      date: todayKey(),
      updatedAt: null,
      rows: []
    };
  }

  if (
    !Array.isArray(
      state.candidateDecisionHistory.rows
    )
  ) {
    state.candidateDecisionHistory.rows = [];
  }

  /*
   * 운영상 차단 후보 분석 보정
   */
  if (
    !state.operationalBlockedCandidateAnalysis ||
    state.operationalBlockedCandidateAnalysis
      .date !== todayKey()
  ) {
    state.operationalBlockedCandidateAnalysis = {
      date: todayKey(),
      updatedAt: null,
      rows: []
    };
  }

  if (
    !Array.isArray(
      state.operationalBlockedCandidateAnalysis
        .rows
    )
  ) {
    state.operationalBlockedCandidateAnalysis
      .rows = [];
  }

  /*
   * 매수 판단 통계 초기화
   */
  const today = todayKey();

  if (
    !state.buyDecisionStats ||
    state.buyDecisionStats.date !== today
  ) {
    state.buyDecisionStats = {
      date: today,

      CORE: {
        checked: 0,
        passed: 0,
        bought: 0,

        conditionRejected: {},
        operationalBlocked: {},
        sources: {}
      },

      VOLUME: {
        checked: 0,
        passed: 0,
        bought: 0,

        conditionRejected: {},
        operationalBlocked: {},
        sources: {}
      }
    };
  }

  /*
   * 전략별 기존 상태파일 보정
   */
  for (
    const strategyGroup of [
      "CORE",
      "VOLUME"
    ]
  ) {
    if (
      !state.buyDecisionStats[
        strategyGroup
      ]
    ) {
      state.buyDecisionStats[
        strategyGroup
      ] = {
        checked: 0,
        passed: 0,
        bought: 0,

        conditionRejected: {},
        operationalBlocked: {},
        sources: {}
      };
    }

    const stats =
      state.buyDecisionStats[
        strategyGroup
      ];

    if (
      !stats.conditionRejected ||
      typeof stats.conditionRejected !==
        "object"
    ) {
      stats.conditionRejected = {};
    }

    if (
      !stats.operationalBlocked ||
      typeof stats.operationalBlocked !==
        "object"
    ) {
      stats.operationalBlocked = {};
    }

    if (
      !stats.sources ||
      typeof stats.sources !== "object"
    ) {
      stats.sources = {};
    }

    /*
     * 예전 rejected 데이터 호환
     */
    if (
      stats.rejected &&
      typeof stats.rejected === "object"
    ) {
      for (
        const [reason, count] of
        Object.entries(stats.rejected)
      ) {
        if (
          typeof stats.conditionRejected[
            reason
          ] === "undefined"
        ) {
          stats.conditionRejected[
            reason
          ] = Number(count || 0);
        }
      }
    }
  }

  /*
   * 스위칭 쿨다운 상태 보정
   */
  if (
    !state.lastSwitchAtByStrategy ||
    typeof state.lastSwitchAtByStrategy !==
      "object"
  ) {
    state.lastSwitchAtByStrategy = {
      CORE: 0,
      VOLUME: 0
    };
  }

  if (
    typeof state.lastSwitchAtByStrategy
      .CORE !== "number"
  ) {
    state.lastSwitchAtByStrategy.CORE = 0;
  }

  if (
    typeof state.lastSwitchAtByStrategy
      .VOLUME !== "number"
  ) {
    state.lastSwitchAtByStrategy.VOLUME = 0;
  }

  /*
   * 서버 자동매매·현금 기본값
   */
  if (
    typeof state.serverAutoEnabled ===
    "undefined"
  ) {
    state.serverAutoEnabled =
      settings.serverAutoEnabledDefault;
  }

  if (
    typeof state.totalCash ===
    "undefined"
  ) {
    state.totalCash =
      settings.totalCash;
  }

  return state;
}

function saveState(state) {
  writeJsonFileAtomic(STATE_FILE, state);
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

async function fetchCandidateRealtime(code, fallback = {}) {
  const data = await fetchJson(
    `${API_BASE}/api/price?code=${encodeURIComponent(code)}`
  );

  const raw = data.raw || {};

  const currentPrice = Math.abs(Number(
    data.currentPrice ||
    data.price ||
    data.curPrice ||
    raw.cur_prc ||
    fallback.currentPrice ||
    fallback.price ||
    0
  ));

  const high = Math.abs(Number(
    data.high ||
    data.highPrice ||
    raw.high_pric ||
    fallback.high ||
    fallback.highPrice ||
    0
  ));

  const low = Math.abs(Number(
    data.low ||
    data.lowPrice ||
    raw.low_pric ||
    fallback.low ||
    fallback.lowPrice ||
    0
  ));

  const open = Math.abs(Number(
    data.open ||
    data.openPrice ||
    raw.open_pric ||
    fallback.open ||
    fallback.openPrice ||
    0
  ));

  const changeRate = Number(
    data.changeRate ??
    data.fluctuationRate ??
    data.riseRate ??
    data.rate ??
    raw.flu_rt ??
    fallback.changeRate ??
    0
  );

  const tradeVolumeRatioRaw =
    raw.trde_pre ??
    data.trde_pre ??
    data.tradeVolumeRatio ??
    fallback.tradeVolumeRatio ??
    fallback.volumeRatio ??
    0;

  const tradeVolumeRatio = Number(
    String(tradeVolumeRatioRaw)
      .replace(/[+,]/g, "") || 0
  );

  const discoverScore = Number(
    data.discoverScore ??
    fallback.discoverScore ??
    0
  );

  return {
    code,
    name:
      data.name ||
      data.stockName ||
      data.korName ||
      fallback.name ||
      code,

    currentPrice,
    price: currentPrice,
    high,
    low,
    open,
    changeRate,
    tradeVolumeRatio,
    trde_pre: tradeVolumeRatioRaw,
    discoverScore,

    raw: {
      ...raw,
      cur_prc: currentPrice,
      high_pric: high,
      low_pric: low,
      open_pric: open,
      trde_pre: tradeVolumeRatioRaw
    }
  };
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

function getAbsoluteVolume(item = {}) {
  const raw = item.raw || {};

  const value =
    item.volume ??
    item.currentVolume ??
    item.tradeVolume ??
    raw.trde_qty ??
    raw.acc_trde_qty ??
    raw.now_trde_qty ??
    0;

  const number = Number(
    String(value ?? 0)
      .replace(/[+,]/g, "")
      .trim()
  );

  return Number.isFinite(number)
    ? Math.max(0, Math.abs(number))
    : 0;
}

function getTradeAmount(item = {}, currentPrice = 0) {
  const raw = item.raw || {};
  const volume = getAbsoluteVolume(item);
  const price = Math.abs(Number(
    currentPrice ||
    item.currentPrice ||
    item.price ||
    raw.cur_prc ||
    0
  ));

  // 키움 거래대금 필드는 API별 단위가 다를 수 있으므로
  // 누적거래량 × 현재가로 동일한 원 단위 값을 계산한다.
  return volume > 0 && price > 0
    ? volume * price
    : 0;
}

function checkAbsoluteLiquidity(
  absoluteVolume,
  tradeAmount,
  minAbsoluteVolume,
  minTradeAmount,
  altMinAbsoluteVolume,
  altMinTradeAmount
) {
  const standardPass =
    absoluteVolume >= minAbsoluteVolume &&
    tradeAmount >= minTradeAmount;

  const highValuePass =
    absoluteVolume >= altMinAbsoluteVolume &&
    tradeAmount >= altMinTradeAmount;

  return {
    pass: standardPass || highValuePass,
    standardPass,
    highValuePass
  };
}

function makeLiquidityLog(
  strategyGroup,
  absoluteVolume,
  minAbsoluteVolume,
  tradeAmount,
  minTradeAmount,
  altMinAbsoluteVolume,
  altMinTradeAmount
) {
  return (
    `저유동성 차단 / ` +
    `누적거래량 ${Math.round(absoluteVolume).toLocaleString("ko-KR")}주 / ` +
    `거래대금 ${Math.round(tradeAmount).toLocaleString("ko-KR")}원 / ` +
    `기본기준 ${Math.round(minAbsoluteVolume).toLocaleString("ko-KR")}주+` +
    `${Math.round(minTradeAmount).toLocaleString("ko-KR")}원 / ` +
    `고액거래 보완기준 ${Math.round(altMinAbsoluteVolume).toLocaleString("ko-KR")}주+` +
    `${Math.round(altMinTradeAmount).toLocaleString("ko-KR")}원 / ` +
    `${strategyGroup}`
  );
}

function getTradeVolumeRatio(item = {}) {
  const raw = item.raw || {};

  const originalValue =
    raw.trde_pre ??
    item.trde_pre ??
    null;

  // 키움 trde_pre:
  // 전일 전체 거래량 대비 현재 누적 거래량 증감률
  // -21.03이면 실제 거래량비율은 78.97%
  if (
    originalValue !== null &&
    originalValue !== ""
  ) {
    const changeRate = Number(
      String(originalValue)
        .replace(/[+,]/g, "")
    );

    if (Number.isFinite(changeRate)) {
      return Math.max(0, 100 + changeRate);
    }
  }

  // 이미 비율로 저장된 데이터가 있을 때의 예비값
  const fallbackValue =
    item.tradeVolumeRatio ??
    item.volumeRatio ??
    0;

  return Number(
    String(fallbackValue)
      .replace(/[+,]/g, "") || 0
  );
}

function getTradeVolumeRatioRaw(item = {}) {
  const raw = item.raw || {};

  return (
    raw.trde_pre ??
    item.trde_pre ??
    item.tradeVolumeRatio ??
    ""
  );
}

function makeVolumeRatioLog(item, strategyGroup, volumeRatio, minVolumeRatio) {
  const shortage = Math.max(0, minVolumeRatio - volumeRatio);
  const rawValue = getTradeVolumeRatioRaw(item);

  return (
    `거래량비율 ${volumeRatio.toFixed(1)}% / ` +
    `기준 ${strategyGroup} ${Number(minVolumeRatio).toFixed(1)}% / ` +
    `부족 ${shortage.toFixed(1)}%p` +
    (rawValue !== ""
      ? ` / 원본 trde_pre=${String(rawValue)}`
      : "")
  );
}

function makeMinMaxLog(
  label,
  strategyGroup,
  currentValue,
  minValue,
  maxValue,
  unit = "%"
) {
  let differenceText = "";

  if (currentValue < minValue) {
    differenceText =
      ` / 최소기준 미달 ${(minValue - currentValue).toFixed(2)}%p`;
  } else if (currentValue > maxValue) {
    differenceText =
      ` / 최대기준 초과 ${(currentValue - maxValue).toFixed(2)}%p`;
  }

  return (
    `${label} ${currentValue.toFixed(2)}${unit} / ` +
    `${strategyGroup} 기준 ${Number(minValue).toFixed(2)}~` +
    `${Number(maxValue).toFixed(2)}${unit}` +
    differenceText
  );
}

function makeMaxLog(
  label,
  strategyGroup,
  currentValue,
  maxValue,
  unit = "%"
) {
  const excess = Math.max(0, currentValue - maxValue);

  return (
    `${label} ${currentValue.toFixed(2)}${unit} / ` +
    `${strategyGroup} 최대기준 ${Number(maxValue).toFixed(2)}${unit} / ` +
    `초과 ${excess.toFixed(2)}%p`
  );
}

function makeMinLog(
  label,
  strategyGroup,
  currentValue,
  minValue,
  unit = "%"
) {
  const shortage = Math.max(0, minValue - currentValue);

  return (
    `${label} ${currentValue.toFixed(2)}${unit} / ` +
    `${strategyGroup} 최소기준 ${Number(minValue).toFixed(2)}${unit} / ` +
    `부족 ${shortage.toFixed(2)}%p`
  );
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

function calculateMarketTemperature(
  candidates = []
) {
  const rows =
    Array.isArray(candidates)
      ? candidates.filter(item => {
          const rawChangeRate =
            item.changeRate ??
            item.fluctuationRate ??
            item.riseRate ??
            item.rate ??
            item.raw?.flu_rt;

          if (
            rawChangeRate === undefined ||
            rawChangeRate === null ||
            rawChangeRate === ""
          ) {
            return false;
          }

          return Number.isFinite(
            Number(rawChangeRate)
          );
        })
      : [];

  const total = rows.length;

  /*
   * 대상 종목이 너무 적으면
   * 이전 시장점수를 과도하게 변경하지 않도록
   * 중립값으로 처리한다.
   */
  if (total < 10) {
    return {
      level: "NORMAL",
      label: "보통",
      score: 50,

      advanceRatio: 0,
      declineRatio: 0,
      flatRatio: 0,

      volumePassRatio: 0,
      averageChangeRate: 0,

      breadthScore: 50,
      changeScore: 50,
      volumeScore: 50,

      total,
      advanceCount: 0,
      declineCount: 0,
      flatCount: 0,
      volumePassCount: 0,

      reason:
        `시장점수 계산 대상 부족 / ${total}개`,

      checkedAt: nowText(),
      checkedDate: todayKey()
    };
  }

  let advanceCount = 0;
  let declineCount = 0;
  let flatCount = 0;
  let volumePassCount = 0;
  let changeRateSum = 0;

  for (const item of rows) {
    const changeRate = Number(
      item.changeRate ??
      item.fluctuationRate ??
      item.riseRate ??
      item.rate ??
      item.raw?.flu_rt ??
      0
    );

    const volumeRatio =
      getTradeVolumeRatio(item);

    changeRateSum += changeRate;

    /*
     * ±0.1% 이내는 보합으로 처리
     */
    if (changeRate > 0.1) {
      advanceCount++;
    } else if (changeRate < -0.1) {
      declineCount++;
    } else {
      flatCount++;
    }

    /*
     * 시장 거래량 기준은
     * CORE 최소기준 80% 사용
     */
    if (
      volumeRatio >=
      settings.coreMinTradeVolumeRatio
    ) {
      volumePassCount++;
    }
  }

  const advanceRatio =
    (advanceCount / total) * 100;

  const declineRatio =
    (declineCount / total) * 100;

  const flatRatio =
    (flatCount / total) * 100;

  const volumePassRatio =
    (volumePassCount / total) * 100;

  const averageChangeRate =
    changeRateSum / total;

  /*
   * 1. 시장 확산도 점수
   *
   * 상승과 하락이 같으면 50점
   * 전 종목 상승이면 최대 85점
   * 전 종목 하락이면 최소 15점
   */
  const breadthScore =
    Math.max(
      15,
      Math.min(
        85,
        50 +
        (
          advanceRatio -
          declineRatio
        ) * 0.35
      )
    );

  /*
   * 2. 평균 등락률 점수
   *
   * 평균 0% = 50점
   * 평균 +2.5% = 100점
   * 평균 -2.5% = 0점
   */
  const changeScore =
    Math.max(
      0,
      Math.min(
        100,
        50 +
        averageChangeRate * 20
      )
    );

  /*
   * 3. 거래량 점수
   *
   * 거래량 통과율 50% = 50점
   * 거래량은 매수·매도 방향을
   * 알 수 없으므로 영향도를 낮춘다.
   */
  const volumeScore =
    Math.max(
      25,
      Math.min(
        75,
        50 +
        (
          volumePassRatio - 50
        ) * 0.5
      )
    );

  /*
   * 최종 시장점수
   *
   * 확산도 45%
   * 평균등락 40%
   * 거래량 15%
   */
  const score =
    Math.max(
      0,
      Math.min(
        100,
        breadthScore * 0.45 +
        changeScore * 0.40 +
        volumeScore * 0.15
      )
    );

  let level = "NORMAL";
  let label = "보통";

  if (score >= 70) {
    level = "HOT";
    label = "강세";
  } else if (score >= 50) {
    level = "NORMAL";
    label = "보통";
  } else if (score >= 35) {
    level = "CAUTION";
    label = "주의";
  } else {
    level = "COLD";
    label = "약세";
  }

  return {
    level,
    label,

    score:
      Number(score.toFixed(1)),

    advanceRatio:
      Number(advanceRatio.toFixed(1)),

    declineRatio:
      Number(declineRatio.toFixed(1)),

    flatRatio:
      Number(flatRatio.toFixed(1)),

    volumePassRatio:
      Number(volumePassRatio.toFixed(1)),

    averageChangeRate:
      Number(
        averageChangeRate.toFixed(2)
      ),

    breadthScore:
      Number(breadthScore.toFixed(1)),

    changeScore:
      Number(changeScore.toFixed(1)),

    volumeScore:
      Number(volumeScore.toFixed(1)),

    total,
    advanceCount,
    declineCount,
    flatCount,
    volumePassCount,

    reason:
      `상승 ${advanceCount}/${total}개 / ` +
      `하락 ${declineCount}/${total}개 / ` +
      `평균등락 ${averageChangeRate.toFixed(2)}% / ` +
      `거래량통과 ${volumePassCount}/${total}개`,

    checkedAt: nowText(),
    checkedDate: todayKey()
  };
}

function getMarketAdjustedBuySettings(
  state,
  strategyGroup
) {
  const market =
    state.marketTemperature || {};

  const level =
    String(market.level || "NORMAL");

  const score =
    Number(market.score ?? 50);

  const baseMinVolumeRatio =
    strategyGroup === "CORE"
      ? settings.coreMinTradeVolumeRatio
      : settings.volumeMinTradeVolumeRatio;

  const result = {
    level,
    score,

    buyBlocked: false,

    minVolumeRatio:
      baseMinVolumeRatio,

    minDiscoverScore:
      settings.minDiscoverScore,

    label:
      market.label || "보통",

    reason:
      `시장 ${market.label || "보통"} ` +
      `${score.toFixed(1)}점 / 기본조건`
  };

  if (
    !settings.marketConditionAdjustEnabled
  ) {
    result.reason =
      `시장조건 자동조정 OFF / ` +
      `${result.label} ${score.toFixed(1)}점`;

    return result;
  }

  /*
   * 강세
   * 거래량·발견점수를 소폭 완화한다.
   */
  if (level === "HOT") {
    result.minVolumeRatio =
      Math.max(
        0,
        baseMinVolumeRatio -
          (
            strategyGroup === "CORE"
              ? settings.hotCoreVolumeRelax
              : settings.hotVolumeVolumeRelax
          )
      );

    result.minDiscoverScore =
      Math.max(
        0,
        settings.minDiscoverScore -
          settings.hotDiscoverScoreRelax
      );

    result.reason =
      `시장 강세 ${score.toFixed(1)}점 / ` +
      `거래량기준 ${baseMinVolumeRatio}→` +
      `${result.minVolumeRatio}% / ` +
      `발견점수 ${settings.minDiscoverScore}→` +
      `${result.minDiscoverScore}`;

    return result;
  }

  /*
   * 주의
   * 거래량과 발견점수를 강화한다.
   */
  if (level === "CAUTION") {
    result.minVolumeRatio =
      baseMinVolumeRatio +
      (
        strategyGroup === "CORE"
          ? settings.cautionCoreVolumeAdd
          : settings.cautionVolumeVolumeAdd
      );

    result.minDiscoverScore =
      settings.minDiscoverScore +
      settings.cautionDiscoverScoreAdd;

    result.reason =
      `시장 주의 ${score.toFixed(1)}점 / ` +
      `거래량기준 ${baseMinVolumeRatio}→` +
      `${result.minVolumeRatio}% / ` +
      `발견점수 ${settings.minDiscoverScore}→` +
      `${result.minDiscoverScore}`;

    return result;
  }

  /*
   * 약세
   *
   * 예전처럼 시장 전체를 이유로 전 종목을 막지 않는다.
   * 차단 옵션이 켜진 경우에만 중단하고, 기본값에서는
   * 거래량과 발견점수를 강화해 상대적으로 강한 종목만 선별한다.
   */
  if (level === "COLD") {
    if (settings.marketColdBuyBlocked) {
      result.buyBlocked = true;

      result.reason =
        `시장 약세 ${score.toFixed(1)}점 / ` +
        `신규매수 중단`;

      return result;
    }

    result.minVolumeRatio =
      baseMinVolumeRatio +
      (
        strategyGroup === "CORE"
          ? settings.coldCoreVolumeAdd
          : settings.coldVolumeVolumeAdd
      );

    result.minDiscoverScore =
      settings.minDiscoverScore +
      settings.coldDiscoverScoreAdd;

    result.reason =
      `시장 약세 ${score.toFixed(1)}점 / 선별매수 / ` +
      `거래량기준 ${baseMinVolumeRatio}→` +
      `${result.minVolumeRatio}% / ` +
      `발견점수 ${settings.minDiscoverScore}→` +
      `${result.minDiscoverScore}`;

    return result;
  }

  // 보통은 기존 조건 유지
  result.reason =
    `시장 보통 ${score.toFixed(1)}점 / ` +
    `기존조건 유지`;

  return result;
}

function calculateCandidateWatchScore(
  item,
  price,
  strategyGroup
) {
  const discoverScore = Number(
    item.discoverScore || 0
  );

  const volumeRatio =
    getTradeVolumeRatio(item);

  const dayPosition =
    getDayPositionRate(item, price);

  const changeRate = Number(
    item.changeRate ||
    item.fluctuationRate ||
    item.riseRate ||
    item.rate ||
    0
  );

  const minVolumeRatio =
    strategyGroup === "CORE"
      ? settings.coreMinTradeVolumeRatio
      : settings.volumeMinTradeVolumeRatio;

  const minDayPosition =
    strategyGroup === "CORE"
      ? settings.coreMinDayPositionRate
      : settings.volumeMinDayPositionRate;

  const maxDayPosition =
    strategyGroup === "CORE"
      ? settings.coreMaxDayPositionRate
      : settings.volumeMaxDayPositionRate;

  const discoverPart =
    discoverScore * 10;

  const volumeFit =
    minVolumeRatio > 0
      ? Math.min(
          volumeRatio / minVolumeRatio,
          1.5
        )
      : 0;

  const volumePart =
    volumeFit * 20;

  let dayPositionFit = 0;

  if (
    dayPosition >= minDayPosition &&
    dayPosition <= maxDayPosition
  ) {
    dayPositionFit = 1;
  } else if (
    dayPosition < minDayPosition
  ) {
    dayPositionFit = Math.max(
      0,
      1 -
        (
          minDayPosition -
          dayPosition
        ) / 30
    );
  } else {
    dayPositionFit = Math.max(
      0,
      1 -
        (
          dayPosition -
          maxDayPosition
        ) / 30
    );
  }

  const dayPositionPart =
    dayPositionFit * 15;

  const minChangeRate =
    strategyGroup === "CORE"
      ? 0
      : settings.volumeMinChangeRate;

  const maxChangeRate =
    strategyGroup === "CORE"
      ? settings.coreMaxChangeRate
      : settings.volumeMaxChangeRate;

  let changeRatePart = 0;

  if (strategyGroup === "VOLUME") {
    /*
     * VOLUME 상승률 점수
     *
     * 거래량이 터진 초기 강세를 우선하고,
     * 이미 많이 오른 종목은 추격 위험으로 감점한다.
     *
     * 0.8~2% : 6~12점
     * 2~4%   : 12~15점 (최적 구간)
     * 4~6%   : 15~8점
     * 6~8%   : 8~2점
     * 8% 초과: 기본 매수조건에서 차단
     */
    if (
      changeRate >= minChangeRate &&
      changeRate < 2.0
    ) {
      const position =
        (changeRate - minChangeRate) /
        Math.max(0.0001, 2.0 - minChangeRate);

      changeRatePart = 6 + position * 6;
    } else if (
      changeRate >= 2.0 &&
      changeRate < 4.0
    ) {
      const position =
        (changeRate - 2.0) / 2.0;

      changeRatePart = 12 + position * 3;
    } else if (
      changeRate >= 4.0 &&
      changeRate < 6.0
    ) {
      const position =
        (changeRate - 4.0) / 2.0;

      changeRatePart = 15 - position * 7;
    } else if (
      changeRate >= 6.0 &&
      changeRate <= maxChangeRate
    ) {
      const position =
        (changeRate - 6.0) /
        Math.max(0.0001, maxChangeRate - 6.0);

      changeRatePart = 8 - position * 6;
    }
  } else if (
    changeRate >= minChangeRate &&
    changeRate <= maxChangeRate
  ) {
    /* CORE는 기존 선형 상승률 점수를 유지한다. */
    const range = Math.max(
      0.0001,
      maxChangeRate - minChangeRate
    );

    const position =
      (changeRate - minChangeRate) /
      range;

    changeRatePart = Math.min(
      15,
      position * 15
    );
  } else if (
    changeRate > maxChangeRate
  ) {
    const excess =
      changeRate - maxChangeRate;

    changeRatePart = Math.max(
      0,
      15 - excess * 3
    );
  }

  /*
   * 최초 발견값 대비 현재 추세 변화
   *
   * 후보 재평가 시 item.watchBaseline에
   * 최초가격·최초위치·최초거래량을 넣는다.
   */
  const baseline =
    item.watchBaseline || {};

  const firstPrice =
    Number(baseline.firstPrice || 0);

  const firstDayPosition =
    Number(
      baseline.firstDayPosition || 0
    );

  const firstVolumeRatio =
    Number(
      baseline.firstVolumeRatio || 0
    );

  const priceDiffRate =
    firstPrice > 0
      ? (
          (Number(price) - firstPrice) /
          firstPrice
        ) * 100
      : 0;

  const dayPositionDiff =
    firstDayPosition > 0
      ? dayPosition - firstDayPosition
      : 0;

  const volumeDiff =
    firstVolumeRatio > 0
      ? volumeRatio - firstVolumeRatio
      : 0;

  /*
   * 가격 약화 감점
   */
  let priceWeaknessPenalty = 0;

  if (priceDiffRate <= -2.0) {
    priceWeaknessPenalty = -15;
  } else if (
    priceDiffRate <= -1.0
  ) {
    priceWeaknessPenalty = -10;
  } else if (
    priceDiffRate <= -0.5
  ) {
    priceWeaknessPenalty = -5;
  }

  /*
   * 당일위치 하락 감점
   */
  let dayPositionDropPenalty = 0;

  if (dayPositionDiff <= -40) {
    dayPositionDropPenalty = -25;
  } else if (
    dayPositionDiff <= -30
  ) {
    dayPositionDropPenalty = -20;
  } else if (
    dayPositionDiff <= -20
  ) {
    dayPositionDropPenalty = -12;
  } else if (
    dayPositionDiff <= -10
  ) {
    dayPositionDropPenalty = -5;
  }

  /*
   * 거래량은 증가하지만 가격과 위치가
   * 함께 하락하면 매도 거래 증가 가능성이 큼.
   */
  let bearishVolumePenalty = 0;

  if (
    volumeDiff >= 100 &&
    priceDiffRate <= -1.0 &&
    dayPositionDiff <= -20
  ) {
    bearishVolumePenalty = -20;
  } else if (
    volumeDiff >= 30 &&
    priceDiffRate <= -0.5 &&
    dayPositionDiff <= -10
  ) {
    bearishVolumePenalty = -10;
  }

  const baseTotal =
    discoverPart +
    volumePart +
    dayPositionPart +
    changeRatePart;

  const trendPenalty =
    priceWeaknessPenalty +
    dayPositionDropPenalty +
    bearishVolumePenalty;

  const total = Math.max(
    0,
    baseTotal + trendPenalty
  );

  return {
    total,
    baseTotal,
    trendPenalty,

    discoverPart,
    volumePart,
    dayPositionPart,
    changeRatePart,

    priceWeaknessPenalty,
    dayPositionDropPenalty,
    bearishVolumePenalty,

    discoverScore,
    volumeRatio,
    dayPosition,
    changeRate,

    firstPrice,
    firstVolumeRatio,
    firstDayPosition,

    priceDiffRate,
    volumeDiff,
    dayPositionDiff,

    minVolumeRatio,
    minDayPosition,
    maxDayPosition
  };
}

function calculateHoldingScore(
  holding,
  realtimeItem,
  price
) {
  const strategyGroup =
    holding.strategyGroup;

  /*
   * 매수 당시 발견점수는 실시간 가격 API에서
   * 제공되지 않을 수 있으므로 보유정보 값을 유지한다.
   */
 const item = {
  ...realtimeItem,

  discoverScore: Number(
    holding.discoverScore ||
    realtimeItem.discoverScore ||
    0
  ),

  watchBaseline: {
    firstPrice: Number(
      holding.buyPrice || 0
    ),

    firstVolumeRatio: Number(
      holding.buyTradeVolumeRatio || 0
    ),

    firstDayPosition: Number(
      holding.buyDayPositionRate || 0
    )
  }
};

  const scoreDetail =
    calculateCandidateWatchScore(
      item,
      price,
      strategyGroup
    );

  const buyPrice =
    Number(holding.buyPrice || 0);

  const profitRate =
    buyPrice > 0
      ? ((price - buyPrice) / buyPrice) * 100
      : 0;

  const buyVolumeRatio =
    Number(
      holding.buyTradeVolumeRatio || 0
    );

  const currentVolumeRatio =
    Number(scoreDetail.volumeRatio || 0);

  const volumeDiff =
    currentVolumeRatio -
    buyVolumeRatio;

  const buyDayPosition =
    Number(
      holding.buyDayPositionRate || 0
    );

  const currentDayPosition =
    Number(scoreDetail.dayPosition || 0);

  const dayPositionDiff =
    currentDayPosition -
    buyDayPosition;

  const buyScore =
    Number(
      holding.candidateWatchScore ||
      holding.finalBuyScore ||
      0
    );

  /*
   * 기본 후보점수에 매수 후 추세 변화를 추가 반영한다.
   *
   * 가격수익률:
   * 1% 상승당 +5점, 1% 하락당 -5점
   * 최대 ±20점
   */
  const profitTrendPart =
    Math.max(
      -20,
      Math.min(
        20,
        profitRate * 5
      )
    );

  /*
   * 당일위치 변화:
   * 10%p 상승당 +2점,
   * 10%p 하락당 -4점
   * 하락을 상승보다 더 크게 평가한다.
   */
  const dayPositionTrendPart =
    dayPositionDiff >= 0
      ? Math.min(
          10,
          (dayPositionDiff / 10) * 2
        )
      : Math.max(
          -20,
          (dayPositionDiff / 10) * 4
        );

  /*
   * 거래량 증가 자체는 매수세인지 매도세인지
   * 구분하기 어려우므로 가중치를 작게 둔다.
   */
  const volumeTrendPart =
    volumeDiff >= 0
      ? Math.min(
          5,
          volumeDiff / 50
        )
      : Math.max(
          -10,
          volumeDiff / 20
        );

  /*
   * 거래량이 증가하면서 가격과 위치가 모두 하락하면
   * 매도 거래량 증가로 판단하여 추가 감점한다.
   */
  let bearishVolumePenalty = 0;

  if (
    volumeDiff > 20 &&
    profitRate < -0.3 &&
    dayPositionDiff < -10
  ) {
    bearishVolumePenalty = -15;
  }

  if (
    volumeDiff > 50 &&
    profitRate < -1.0 &&
    dayPositionDiff < -20
  ) {
    bearishVolumePenalty = -25;
  }

  const baseScore =
    Number(scoreDetail.total || 0);

  const holdingScore =
    Math.max(
      0,
      baseScore +
      profitTrendPart +
      dayPositionTrendPart +
      volumeTrendPart +
      bearishVolumePenalty
    );

  return {
    holdingScore:
      Number(holdingScore.toFixed(1)),

    baseScore:
      Number(baseScore.toFixed(1)),

    buyScore:
      Number(buyScore.toFixed(1)),

    scoreDiff:
      Number(
        (holdingScore - buyScore).toFixed(1)
      ),

    profitRate:
      Number(profitRate.toFixed(2)),

    buyVolumeRatio:
      Number(buyVolumeRatio.toFixed(1)),

    currentVolumeRatio:
      Number(currentVolumeRatio.toFixed(1)),

    volumeDiff:
      Number(volumeDiff.toFixed(1)),

    buyDayPosition:
      Number(buyDayPosition.toFixed(1)),

    currentDayPosition:
      Number(currentDayPosition.toFixed(1)),

    dayPositionDiff:
      Number(dayPositionDiff.toFixed(1)),

    profitTrendPart:
      Number(profitTrendPart.toFixed(1)),

    dayPositionTrendPart:
      Number(
        dayPositionTrendPart.toFixed(1)
      ),

    volumeTrendPart:
      Number(volumeTrendPart.toFixed(1)),

    bearishVolumePenalty,

    scoreDetail
  };
}

function isBasicCoreCandidate(
  item,
  price
) {
  const changeRate = Number(
    item.changeRate ||
    item.fluctuationRate ||
    item.riseRate ||
    item.rate ||
    0
  );

  const volumeRatio =
    getTradeVolumeRatio(item);

  const dayPosition =
    getDayPositionRate(item, price);

  // CORE 상승률 상한
  if (
    changeRate >
    settings.coreMaxChangeRate
  ) {
    return false;
  }

  // CORE 거래량 기준
  if (
    volumeRatio <
    settings.coreMinTradeVolumeRatio
  ) {
    return false;
  }

  // CORE 당일위치 범위
  if (
    dayPosition <
      settings.coreMinDayPositionRate ||
    dayPosition >
      settings.coreMaxDayPositionRate
  ) {
    return false;
  }

  return true;
}

function isBasicVolumeCandidate(
  item,
  price
) {
  const changeRate = Number(
    item.changeRate ||
    item.fluctuationRate ||
    item.riseRate ||
    item.rate ||
    0
  );

  const volumeRatio =
    getTradeVolumeRatio(item);

  const dayPosition =
    getDayPositionRate(item, price);

  const openPosition =
    getOpenPositionRate(item, price);

  // VOLUME 상승률 범위
  if (
    changeRate <
      settings.volumeMinChangeRate ||
    changeRate >
      settings.volumeMaxChangeRate
  ) {
    return false;
  }

  // VOLUME 거래량 기준
  if (
    volumeRatio <
    settings.volumeMinTradeVolumeRatio
  ) {
    return false;
  }

  // VOLUME 당일위치 범위
  if (
    dayPosition <
      settings.volumeMinDayPositionRate ||
    dayPosition >
      settings.volumeMaxDayPositionRate
  ) {
    return false;
  }

  // VOLUME은 시가 이상이어야 함
  if (openPosition < 0) {
    return false;
  }

  return true;
}

function updateCandidateWatchList(
  state,
  item,
  price,
  strategyGroup
) {
  const code = String(item.code || "").trim();

  if (!code || !price) return;

  const listKey =
    strategyGroup === "CORE"
      ? "coreCandidateWatchList"
      : "volumeCandidateWatchList";

  if (!Array.isArray(state[listKey])) {
    state[listKey] = [];
  }

  const now = Date.now();

  const name =
    item.name ||
    item.stockName ||
    item.korName ||
    code;

  const discoverScore = Number(
    item.discoverScore || 0
  );

  const volumeRatio =
    getTradeVolumeRatio(item);

  const dayPosition =
    getDayPositionRate(item, price);

  const openPosition =
    getOpenPositionRate(item, price);

  const changeRate = Number(
    item.changeRate ||
    item.fluctuationRate ||
    item.riseRate ||
    item.rate ||
    0
  );

  const high = Math.abs(Number(
    item.high ||
    item.highPrice ||
    item.raw?.high_pric ||
    0
  ));

  const low = Math.abs(Number(
    item.low ||
    item.lowPrice ||
    item.raw?.low_pric ||
    0
  ));

  const open = Math.abs(Number(
    item.open ||
    item.openPrice ||
    item.raw?.open_pric ||
    0
  ));

  const rawTradeVolumeRatio =
    getTradeVolumeRatioRaw(item);

const existing = state[listKey].find(
  candidate => candidate.code === code
);

if (existing) {
  item.watchBaseline = {
    firstPrice: Number(
      existing.firstPrice || 0
    ),

    firstVolumeRatio: Number(
      existing.firstVolumeRatio || 0
    ),

    firstDayPosition: Number(
      existing.firstDayPosition || 0
    )
  };
}

const watchScoreDetail =
  calculateCandidateWatchScore(
    item,
    price,
    strategyGroup
  );

const watchScore =
  Number(watchScoreDetail.total || 0);

  const itemSnapshot = {
    code,
    name,

    currentPrice: Number(price),
    price: Number(price),

    high,
    low,
    open,

    discoverScore,
    changeRate,

    tradeVolumeRatio: volumeRatio,
    trde_pre: rawTradeVolumeRatio,

    dayPosition,
    openPosition,

    raw: {
      ...(item.raw || {}),
      cur_prc: Number(price),
      high_pric: high,
      low_pric: low,
      open_pric: open,
      trde_pre: rawTradeVolumeRatio
    }
  };


  if (existing) {
    existing.name = name;
    existing.strategyGroup = strategyGroup;

    existing.lastSeenAt = now;
    existing.lastSeenAtText = nowText();

    existing.currentPrice = Number(price);
    existing.discoverScore = discoverScore;
    existing.volumeRatio = volumeRatio;
    existing.dayPosition = dayPosition;
    existing.openPosition = openPosition;
    existing.changeRate = changeRate;
    existing.watchScore = watchScore;
    existing.watchScoreDetail =
  watchScoreDetail;

    existing.rawTradeVolumeRatio =
      rawTradeVolumeRatio;

    existing.itemSnapshot = itemSnapshot;
  } else {
    state[listKey].push({
      code,
      name,
      strategyGroup,

      firstSeenAt: now,
      firstSeenAtText: nowText(),

      lastSeenAt: now,
      lastSeenAtText: nowText(),

      firstPrice: Number(price),
      currentPrice: Number(price),

      firstDiscoverScore: discoverScore,
      discoverScore,

      firstVolumeRatio: volumeRatio,
      volumeRatio,

      firstDayPosition: dayPosition,
      dayPosition,

      firstOpenPosition: openPosition,
      openPosition,

      firstChangeRate: changeRate,
      changeRate,

      watchScore,
      watchScoreDetail,

      rawTradeVolumeRatio,

      itemSnapshot
    });
  }

  state[listKey] = state[listKey]
    .filter(candidate =>
      now - Number(candidate.lastSeenAt || 0) <=
      settings.candidateWatchMaxAgeMs
    )
    .sort(
      (a, b) =>
        Number(b.watchScore || 0) -
        Number(a.watchScore || 0)
    )
    .slice(
      0,
      settings.candidateWatchMaxCount
    );
}

function makeCandidateWatchScoreLog(
  candidate
) {
  const detail =
    candidate.watchScoreDetail || {};

  return (
    `${candidate.name} / ` +
    `${candidate.strategyGroup} / ` +
    `최종 ${Number(
      candidate.watchScore || 0
    ).toFixed(1)}점 / ` +

    `기본 ${Number(
      detail.baseTotal ??
      candidate.watchScore ??
      0
    ).toFixed(1)} / ` +

    `추세감점 ${Number(
      detail.trendPenalty || 0
    ).toFixed(1)} / ` +

    `발견 ${Number(
      detail.discoverPart || 0
    ).toFixed(1)} / ` +

    `거래량 ${Number(
      detail.volumePart || 0
    ).toFixed(1)} / ` +

    `위치 ${Number(
      detail.dayPositionPart || 0
    ).toFixed(1)} / ` +

    `상승률 ${Number(
      detail.changeRatePart || 0
    ).toFixed(1)}`
  );
}

function makeBuyConditionDetailLog(
  item,
  price,
  strategyGroup
) {
  const changeRate = Number(
    item.changeRate ||
    item.fluctuationRate ||
    item.riseRate ||
    item.rate ||
    0
  );

  const volumeRatio =
    getTradeVolumeRatio(item);

  const dayPosition =
    getDayPositionRate(item, price);

  const openPosition =
    getOpenPositionRate(item, price);

  const discoverScore =
    Number(item.discoverScore || 0);

  return (
    `${strategyGroup} / ` +
    `발견점수 ${discoverScore.toFixed(1)} / ` +
    `상승률 ${changeRate.toFixed(2)}% / ` +
    `거래량비율 ${volumeRatio.toFixed(1)}% / ` +
    `당일위치 ${dayPosition.toFixed(1)}% / ` +
    `시가대비 ${openPosition.toFixed(2)}%`
  );
}


function calculateCandidateNearMiss(
  item,
  price,
  strategyGroup,
  judged
) {
  const changeRate = Number(
    item.changeRate ||
    item.fluctuationRate ||
    item.riseRate ||
    item.rate ||
    0
  );

  const volumeRatio =
    getTradeVolumeRatio(item);

  const dayPosition =
    getDayPositionRate(item, price);

  const discoverScore =
    Number(item.discoverScore || 0);

  const minVolumeRatio =
    strategyGroup === "CORE"
      ? settings.coreMinTradeVolumeRatio
      : settings.volumeMinTradeVolumeRatio;

  const minChangeRate =
    strategyGroup === "CORE"
      ? 0
      : settings.volumeMinChangeRate;

  const maxChangeRate =
    strategyGroup === "CORE"
      ? settings.coreMaxChangeRate
      : settings.volumeMaxChangeRate;

  const minDayPosition =
    strategyGroup === "CORE"
      ? settings.coreMinDayPositionRate
      : settings.volumeMinDayPositionRate;

  const maxDayPosition =
    strategyGroup === "CORE"
      ? settings.coreMaxDayPositionRate
      : settings.volumeMaxDayPositionRate;

  const gaps = [];

  if (changeRate < minChangeRate) {
    gaps.push({
      key: "상승률 최소",
      gap: minChangeRate - changeRate,
      tolerance: 1.0,
      text:
        `상승률 최소기준 미달 ` +
        `${(minChangeRate - changeRate).toFixed(2)}%p`
    });
  } else if (changeRate > maxChangeRate) {
    gaps.push({
      key: "상승률 최대",
      gap: changeRate - maxChangeRate,
      tolerance: 2.0,
      text:
        `상승률 최대기준 초과 ` +
        `${(changeRate - maxChangeRate).toFixed(2)}%p`
    });
  }

  if (volumeRatio < minVolumeRatio) {
    gaps.push({
      key: "거래량",
      gap: minVolumeRatio - volumeRatio,
      tolerance: Math.max(50, minVolumeRatio),
      text:
        `거래량 부족 ` +
        `${(minVolumeRatio - volumeRatio).toFixed(1)}%p`
    });
  }

  if (dayPosition < minDayPosition) {
    gaps.push({
      key: "당일위치 최소",
      gap: minDayPosition - dayPosition,
      tolerance: 30,
      text:
        `당일위치 최소기준 미달 ` +
        `${(minDayPosition - dayPosition).toFixed(1)}%p`
    });
  } else if (dayPosition > maxDayPosition) {
    gaps.push({
      key: "당일위치 최대",
      gap: dayPosition - maxDayPosition,
      tolerance: 30,
      text:
        `당일위치 최대기준 초과 ` +
        `${(dayPosition - maxDayPosition).toFixed(1)}%p`
    });
  }

  const normalizedPenalty = gaps.reduce(
    (sum, row) =>
      sum +
      Math.min(
        1,
        Number(row.gap || 0) /
        Math.max(0.0001, Number(row.tolerance || 1))
      ),
    0
  );

  const possibilityScore = Math.max(
    0,
    Math.min(
      100,
      100 -
      normalizedPenalty * 45
    )
  );

  const primaryGap = [...gaps].sort(
    (a, b) =>
      (
        Number(a.gap || 0) /
        Math.max(0.0001, Number(a.tolerance || 1))
      ) -
      (
        Number(b.gap || 0) /
        Math.max(0.0001, Number(b.tolerance || 1))
      )
  )[0] || null;

  return {
    possibilityScore:
      Number(possibilityScore.toFixed(1)),

    rejectCategory:
      classifyBuyRejectReason(
        judged?.reason || ""
      ),

    primaryGap:
      primaryGap?.text ||
      judged?.reason ||
      "기준 미충족",

    gaps,

    discoverScore,
    changeRate,
    volumeRatio,
    dayPosition,

    currentPrice: Number(price || 0)
  };
}

function updateCandidateNearMissList(
  state,
  candidate,
  item,
  price,
  strategyGroup,
  judged,
  scoreChanges
) {
  if (!state.candidateNearMissAnalysis) {
    state.candidateNearMissAnalysis = {
      date: todayKey(),
      updatedAt: null,
      rows: []
    };
  }

  if (
    state.candidateNearMissAnalysis.date !==
    todayKey()
  ) {
    state.candidateNearMissAnalysis = {
      date: todayKey(),
      updatedAt: null,
      rows: []
    };
  }

  const analysis =
    calculateCandidateNearMiss(
      item,
      price,
      strategyGroup,
      judged
    );

  const row = {
    code: candidate.code,
    name: candidate.name,
    strategyGroup,

    checkedAt: nowText(),

    possibilityScore:
      analysis.possibilityScore,

    rejectCategory:
      analysis.rejectCategory,

    primaryGap:
      analysis.primaryGap,

    rejectReason:
      judged?.reason || "",

    discoverScore:
      analysis.discoverScore,

    firstWatchScore:
      Number(
        scoreChanges.firstWatchScore || 0
      ),

    latestWatchScore:
      Number(
        scoreChanges.latestWatchScore || 0
      ),

    watchScoreDiff:
      Number(
        scoreChanges.watchScoreDiff || 0
      ),

    firstPrice:
      Number(candidate.firstPrice || 0),

    currentPrice:
      Number(price || 0),

    priceDiffRate:
      Number(
        scoreChanges.priceDiffRate || 0
      ),

    firstVolumeRatio:
      Number(
        candidate.firstVolumeRatio || 0
      ),

    currentVolumeRatio:
      analysis.volumeRatio,

    volumeDiff:
      Number(
        scoreChanges.volumeDiff || 0
      ),

    firstDayPosition:
      Number(
        candidate.firstDayPosition || 0
      ),

    currentDayPosition:
      analysis.dayPosition,

    dayPositionDiff:
      Number(
        scoreChanges.dayPositionDiff || 0
      )
  };

  const key =
    `${strategyGroup}_${candidate.code}`;

  const rows =
    state.candidateNearMissAnalysis.rows ||
    [];

  const existingIndex =
    rows.findIndex(
      item =>
        `${item.strategyGroup}_${item.code}` ===
        key
    );

  if (existingIndex >= 0) {
    rows[existingIndex] = row;
  } else {
    rows.push(row);
  }

  state.candidateNearMissAnalysis.rows =
    rows
      .sort(
        (a, b) =>
          Number(b.possibilityScore || 0) -
          Number(a.possibilityScore || 0)
      )
      .slice(
        0,
        settings.candidateNearMissMaxCount
      );

  state.candidateNearMissAnalysis.updatedAt =
    nowText();
}

function logCandidateNearMissSummary(state) {
  const rows =
    state.candidateNearMissAnalysis?.rows ||
    [];

  if (!rows.length) {
    return;
  }

  const top = rows.slice(
    0,
    settings.candidateNearMissLogCount
  );

  console.log(
    `[아까운 후보 TOP${top.length}] ` +
    top.map((row, index) =>
      `${index + 1}.${row.name}/${row.strategyGroup} ` +
      `${Number(row.possibilityScore || 0).toFixed(1)}점 ` +
      `(${row.primaryGap})`
    ).join(" | ")
  );
}

function classifyBuyRejectReason(reason = "") {
  const text = String(reason || "");

  if (text.includes("저유동성 차단")) {
    return "절대 유동성 부족";
  }

  if (text.includes("거래량비율")) {
    return "거래량 부족";
  }

  if (
    text.includes("상승률") ||
    text.includes("상승률 과다")
  ) {
    return "상승률 부적합";
  }

  if (text.includes("당일위치")) {
    return "당일위치 부적합";
  }

  if (
    text.includes("시가대비") ||
    text.includes("시가 아래")
  ) {
    return "시가대비 부적합";
  }

  if (text.includes("첫 발견")) {
    return "첫 발견 대기";
  }

  if (text.includes("강화 확인 대기")) {
    return "후보 강화 대기";
  }

  if (
    text.includes("점수 하락") ||
    text.includes("점수 약화")
  ) {
    return "후보 점수 약화";
  }

  if (
    text.includes("거래량 약화") ||
    text.includes("거래량 급감")
  ) {
    return "후보 거래량 약화";
  }

  if (text.includes("가격 약화")) {
    return "후보 가격 약화";
  }

  if (text.includes("보유한도")) {
    return "보유한도";
  }

  if (text.includes("이미 보유중")) {
    return "이미 보유중";
  }

  if (
    text.includes("오늘 이미 매수") ||
    text.includes("오늘 매수한 종목")
  ) {
    return "오늘 이미 매수";
  }

  if (text.includes("매수쿨다운")) {
    return "매수 쿨다운";
  }

  if (text.includes("시간 아님")) {
    return "매수시간 아님";
  }

  if (text.includes("종목코드 없음")) {
    return "종목코드 없음";
  }

  return "기타";
}

function isOperationalBuyBlock(category = "") {
  return [
    "보유한도",
    "이미 보유중",
    "오늘 이미 매수",
    "매수 쿨다운",
    "매수시간 아님"
  ].includes(String(category || ""));
}


function updateOperationalBlockedCandidate(
  state,
  item,
  price,
  strategyGroup,
  judged
) {
  const category =
    classifyBuyRejectReason(
      judged?.reason || ""
    );

  // 운영상 차단 사유가 아니면 저장하지 않음
  if (!isOperationalBuyBlock(category)) {
    return;
  }

  const today = todayKey();

  if (
    !state.operationalBlockedCandidateAnalysis ||
    state.operationalBlockedCandidateAnalysis.date !==
      today
  ) {
    state.operationalBlockedCandidateAnalysis = {
      date: today,
      updatedAt: null,
      rows: []
    };
  }

  const analysis =
    state.operationalBlockedCandidateAnalysis;

  if (!Array.isArray(analysis.rows)) {
    analysis.rows = [];
  }

  const code =
    String(item.code || "").trim();

  if (!code || !price) {
    return;
  }

  const key =
    `${strategyGroup}_${code}`;

  const existing =
    analysis.rows.find(
      row =>
        `${row.strategyGroup}_${row.code}` ===
        key
    );

  const basicPassed =
    strategyGroup === "CORE"
      ? isBasicCoreCandidate(item, price)
      : isBasicVolumeCandidate(item, price);

  // 신규 등록만 기본조건 통과 필수
  // 이미 저장된 종목은 조건을 벗어나도 계속 추적
  if (!existing && !basicPassed) {
    return;
  }

  const name =
    item.name ||
    item.stockName ||
    item.korName ||
    code;

  const now = Date.now();

  const discoverScore =
    Number(item.discoverScore || 0);

  const volumeRatio =
    getTradeVolumeRatio(item);

  const dayPosition =
    getDayPositionRate(item, price);

  const changeRate = Number(
    item.changeRate ||
    item.fluctuationRate ||
    item.riseRate ||
    item.rate ||
    0
  );

  if (existing) {
    existing.name = name;

    existing.lastCheckedAt = now;
    existing.lastCheckedAtText = nowText();

    existing.currentPrice =
      Number(price);

    existing.highestPrice =
      Math.max(
        Number(existing.highestPrice || 0),
        Number(price)
      );

    existing.discoverScore =
      discoverScore;

    existing.volumeRatio =
      volumeRatio;

    existing.dayPosition =
      dayPosition;

    existing.changeRate =
      changeRate;

    existing.blockReason =
      judged?.reason || category;

    existing.blockCategory =
      category;

    const firstPrice =
      Number(existing.firstBlockedPrice || 0);

    existing.currentAfterBlockRate =
      firstPrice > 0
        ? (
            (
              Number(price) -
              firstPrice
            ) /
            firstPrice
          ) * 100
        : 0;

    existing.highestAfterBlockRate =
      firstPrice > 0
        ? (
            (
              Number(existing.highestPrice || 0) -
              firstPrice
            ) /
            firstPrice
          ) * 100
        : 0;
  } else {
    analysis.rows.push({
      code,
      name,
      strategyGroup,

      blockCategory: category,
      blockReason:
        judged?.reason || category,

      firstBlockedAt: now,
      firstBlockedAtText: nowText(),

      lastCheckedAt: now,
      lastCheckedAtText: nowText(),

      firstBlockedPrice:
        Number(price),

      currentPrice:
        Number(price),

      highestPrice:
        Number(price),

      currentAfterBlockRate: 0,
      highestAfterBlockRate: 0,

      discoverScore,
      volumeRatio,
      dayPosition,
      changeRate
    });
  }

  analysis.rows = analysis.rows
    .sort(
      (a, b) =>
        Number(
          b.highestAfterBlockRate || 0
        ) -
        Number(
          a.highestAfterBlockRate || 0
        )
    )
    .slice(
      0,
      settings
        .operationalBlockedCandidateMaxCount
    );

  analysis.updatedAt = nowText();
}



function buildCandidateDecisionSnapshot(
  item = {},
  price = 0,
  strategyGroup,
  judged,
  source = "DISCOVER"
) {
  const currentPrice = Math.abs(Number(
    price ||
    item.currentPrice ||
    item.price ||
    item.raw?.cur_prc ||
    0
  ));

  const code = String(item.code || "")
    .trim()
    .padStart(6, "0");

  const changeRate = Number(
    item.changeRate ??
    item.fluctuationRate ??
    item.riseRate ??
    item.rate ??
    item.raw?.flu_rt ??
    0
  );

  const tradeVolumeRatio =
    getTradeVolumeRatio(item);

  const dayPosition =
    getDayPositionRate(item, currentPrice);

  const openPosition =
    getOpenPositionRate(item, currentPrice);

  const watchScore = Number(
    item.watchScore ??
    item.candidateWatchScore ??
    item.watchScoreDetail?.total ??
    0
  );

  const passed = judged?.pass === true;
  const rejectReason = passed
    ? null
    : String(judged?.reason || "기타");

  return {
    date: todayKey(),
    checkedAtMs: Date.now(),
    checkedAt: nowText(),

    code,
    name:
      item.name ||
      item.stockName ||
      item.korName ||
      code,

    strategyGroup,
    source: String(source || "DISCOVER"),

    price: currentPrice,
    changeRate,
    tradeVolumeRatio,
    dayPosition,
    openPosition,
    discoverScore: Number(item.discoverScore || 0),
    watchScore,
    hotScore: Number(item.hotScore || 0),

    marketLevel:
      item.marketTemperature?.level || null,
    marketScore: Number(
      item.marketTemperature?.score || 0
    ),

    passed,
    rejectCategory: passed
      ? "조건 통과"
      : classifyBuyRejectReason(rejectReason),
    rejectReason,

    switchAllowed:
      judged?.switchResult?.allowed === true,
    bought: false,
    boughtAt: null,
    buyPrice: 0
  };
}

function updateCandidateDecisionHistory(
  state,
  item,
  price,
  strategyGroup,
  judged,
  source = "DISCOVER"
) {
  if (
    !["CORE", "VOLUME"].includes(strategyGroup)
  ) {
    return;
  }

  const snapshot = buildCandidateDecisionSnapshot(
    item,
    price,
    strategyGroup,
    judged,
    source
  );

  if (
    !snapshot.code ||
    snapshot.code === "000000"
  ) {
    return;
  }

  if (
    !state.candidateDecisionHistory ||
    state.candidateDecisionHistory.date !== todayKey()
  ) {
    state.candidateDecisionHistory = {
      date: todayKey(),
      updatedAt: null,
      rows: []
    };
  }

  const history = state.candidateDecisionHistory;

  if (!Array.isArray(history.rows)) {
    history.rows = [];
  }

  const key = `${strategyGroup}_${snapshot.code}`;
  const existing = history.rows.find(
    row => `${row.strategyGroup}_${row.code}` === key
  );

  if (!existing) {
    history.rows.push({
      date: snapshot.date,
      code: snapshot.code,
      name: snapshot.name,
      strategyGroup,

      sources: [snapshot.source],
      checkCount: 1,

      first: snapshot,
      best: snapshot,
      latest: snapshot,

      everPassed: snapshot.passed,
      passedCount: snapshot.passed ? 1 : 0,

      bought: false,
      boughtAt: null,
      buyPrice: 0
    });
  } else {
    existing.name = snapshot.name || existing.name;
    existing.checkCount = Number(existing.checkCount || 0) + 1;

    if (!Array.isArray(existing.sources)) {
      existing.sources = [];
    }

    if (!existing.sources.includes(snapshot.source)) {
      existing.sources.push(snapshot.source);
    }

    existing.latest = snapshot;
    existing.everPassed =
      existing.everPassed === true || snapshot.passed;

    if (snapshot.passed) {
      existing.passedCount =
        Number(existing.passedCount || 0) + 1;
    }

    const existingBest = existing.best || {};

    const snapshotStrength =
      Number(snapshot.watchScore || 0) * 10000 +
      Number(snapshot.discoverScore || 0) * 100 +
      Number(snapshot.changeRate || 0);

    const existingStrength =
      Number(existingBest.watchScore || 0) * 10000 +
      Number(existingBest.discoverScore || 0) * 100 +
      Number(existingBest.changeRate || 0);

    if (
      snapshot.passed &&
      existingBest.passed !== true
    ) {
      existing.best = snapshot;
    } else if (
      snapshot.passed === existingBest.passed &&
      snapshotStrength > existingStrength
    ) {
      existing.best = snapshot;
    }
  }

  history.rows = history.rows
    .sort((a, b) =>
      Number(b.latest?.checkedAtMs || 0) -
      Number(a.latest?.checkedAtMs || 0)
    )
    .slice(0, settings.candidateDecisionHistoryMaxCount);

  history.updatedAt = nowText();
}

function recordBuyDecision(
  state,
  strategyGroup,
  judged,
  source = "DISCOVER",
  item = {},
  price = 0
) {
  if (
    !["CORE", "VOLUME"].includes(
      strategyGroup
    )
  ) {
    return;
  }

  updateCandidateDecisionHistory(
    state,
    item,
    price,
    strategyGroup,
    judged,
    source
  );

  if (!state.buyDecisionStats) {
    state.buyDecisionStats = {
      date: todayKey(),

      CORE: {
        checked: 0,
        passed: 0,
        bought: 0,

        conditionRejected: {},
        operationalBlocked: {},
        sources: {}
      },

      VOLUME: {
        checked: 0,
        passed: 0,
        bought: 0,

        conditionRejected: {},
        operationalBlocked: {},
        sources: {}
      }
    };
  }

  if (
    !state.buyDecisionStats[strategyGroup]
  ) {
    state.buyDecisionStats[strategyGroup] = {
      checked: 0,
      passed: 0,
      bought: 0,

      conditionRejected: {},
      operationalBlocked: {},
      sources: {}
    };
  }

  const stats =
    state.buyDecisionStats[strategyGroup];

  stats.checked =
    Number(stats.checked || 0) + 1;

  if (judged?.pass) {
    stats.passed =
      Number(stats.passed || 0) + 1;
  } else {
    const category =
      classifyBuyRejectReason(
        judged?.reason || "기타"
      );

    if (
      !stats.conditionRejected ||
      typeof stats.conditionRejected !==
        "object"
    ) {
      stats.conditionRejected = {};
    }

    if (
      !stats.operationalBlocked ||
      typeof stats.operationalBlocked !==
        "object"
    ) {
      stats.operationalBlocked = {};
    }

    if (isOperationalBuyBlock(category)) {
      stats.operationalBlocked[category] =
        Number(
          stats.operationalBlocked[category] ||
          0
        ) + 1;
    } else {
      stats.conditionRejected[category] =
        Number(
          stats.conditionRejected[category] ||
          0
        ) + 1;
    }
  }

  const sourceKey =
    source === "WATCH"
      ? "후보재평가"
      : source === "HOT"
        ? "HOT"
        : "전체검색";

  if (
    !stats.sources ||
    typeof stats.sources !== "object"
  ) {
    stats.sources = {};
  }

  stats.sources[sourceKey] =
    Number(stats.sources[sourceKey] || 0) + 1;
}

function recordBuySuccess(
  state,
  strategyGroup,
  item = {},
  price = 0
) {
  if (
    state.buyDecisionStats &&
    state.buyDecisionStats[strategyGroup]
  ) {
    const stats =
      state.buyDecisionStats[strategyGroup];

    stats.bought =
      Number(stats.bought || 0) + 1;
  }

  const code = String(item.code || "")
    .trim()
    .padStart(6, "0");

  const rows =
    state.candidateDecisionHistory?.rows;

  if (!Array.isArray(rows) || !code) {
    return;
  }

  const row = rows.find(
    candidate =>
      candidate.strategyGroup === strategyGroup &&
      String(candidate.code || "").padStart(6, "0") === code
  );

  if (!row) return;

  row.bought = true;
  row.boughtAt = nowText();
  row.buyPrice = Number(price || 0);

  if (row.latest) {
    row.latest.bought = true;
    row.latest.boughtAt = row.boughtAt;
    row.latest.buyPrice = row.buyPrice;
  }
}

function logBuyDecisionSummary(state) {
  const allStats =
    state.buyDecisionStats;

  if (!allStats) return;

  for (const strategyGroup of [
    "CORE",
    "VOLUME"
  ]) {
    const stats =
      allStats[strategyGroup];

    if (!stats) continue;

    const conditionEntries =
      Object.entries(
        stats.conditionRejected || {}
      ).sort(
        (a, b) =>
          Number(b[1] || 0) -
          Number(a[1] || 0)
      );

    const operationalEntries =
      Object.entries(
        stats.operationalBlocked || {}
      ).sort(
        (a, b) =>
          Number(b[1] || 0) -
          Number(a[1] || 0)
      );

    const conditionText =
      conditionEntries.length
        ? conditionEntries
            .map(
              ([reason, count]) =>
                `${reason} ${count}건`
            )
            .join(" / ")
        : "조건 탈락 없음";

    const operationalText =
      operationalEntries.length
        ? operationalEntries
            .map(
              ([reason, count]) =>
                `${reason} ${count}건`
            )
            .join(" / ")
        : "운영 차단 없음";

    console.log(
      `[${strategyGroup} 판단통계] ` +
      `검사 ${Number(
        stats.checked || 0
      )}건 / ` +
      `통과 ${Number(
        stats.passed || 0
      )}건 / ` +
      `매수 ${Number(
        stats.bought || 0
      )}건`
    );

    console.log(
      `[${strategyGroup} 조건탈락] ` +
      conditionText
    );

    console.log(
      `[${strategyGroup} 운영차단] ` +
      operationalText
    );
  }
}

function removeCandidateFromWatchLists(state, code) {
  state.coreCandidateWatchList =
    (state.coreCandidateWatchList || [])
      .filter(candidate => candidate.code !== code);

  state.volumeCandidateWatchList =
    (state.volumeCandidateWatchList || [])
      .filter(candidate => candidate.code !== code);
}

function cleanupCandidateWatchLists(state) {
  const now = Date.now();
  const maxAge = settings.candidateWatchMaxAgeMs;

  for (const listKey of [
    "coreCandidateWatchList",
    "volumeCandidateWatchList"
  ]) {
    if (!Array.isArray(state[listKey])) {
      state[listKey] = [];
      continue;
    }

    state[listKey] = state[listKey]
      .filter(candidate =>
        now - Number(candidate.lastSeenAt || 0) <= maxAge
      )
      .sort(
        (a, b) =>
          Number(b.watchScore || 0) -
          Number(a.watchScore || 0)
      )
      .slice(0, settings.candidateWatchMaxCount);
  }
}

function buildWatchCandidateItem(candidate, realtimeItem) {
  const snapshot = candidate.itemSnapshot || {};

  return {
    ...snapshot,
    ...realtimeItem,

    code: candidate.code,

    name:
      realtimeItem.name ||
      candidate.name ||
      snapshot.name ||
      candidate.code,

    currentPrice: Number(
      realtimeItem.currentPrice ||
      candidate.currentPrice ||
      snapshot.currentPrice ||
      0
    ),

    price: Number(
      realtimeItem.currentPrice ||
      candidate.currentPrice ||
      snapshot.currentPrice ||
      0
    ),

    discoverScore: Number(
      realtimeItem.discoverScore ??
      candidate.discoverScore ??
      snapshot.discoverScore ??
      0
    ),

    changeRate: Number(
      realtimeItem.changeRate ??
      candidate.changeRate ??
      snapshot.changeRate ??
      0
    ),

    tradeVolumeRatio: Number(
      realtimeItem.tradeVolumeRatio ??
      candidate.volumeRatio ??
      snapshot.tradeVolumeRatio ??
      0
    ),

    trde_pre:
      realtimeItem.trde_pre ??
      candidate.rawTradeVolumeRatio ??
      snapshot.trde_pre ??
      candidate.volumeRatio ??
      0,

    raw: {
      ...(snapshot.raw || {}),
      ...(realtimeItem.raw || {})
    }
  };
}

function getHoldingCount(state, strategyGroup) {
  return state.holdings.filter(h => h.strategyGroup === strategyGroup).length;
}

function getHoldingCurrentScore(holding) {
  return Number(
    holding.holdingScore ??
    holding.candidateWatchScore ??
    holding.finalBuyScore ??
    0
  );
}

function getHoldingProfitRate(holding) {
  const buyPrice =
    Number(holding.buyPrice || 0);

  const currentPrice =
    Number(
      holding.currentPrice ||
      holding.buyPrice ||
      0
    );

  if (!buyPrice || !currentPrice) {
    return 0;
  }

  return (
    (currentPrice - buyPrice) /
    buyPrice
  ) * 100;
}

function getHoldingMinutes(holding) {
  const buyTime =
    Number(holding.buyTime || 0);

  if (!buyTime) {
    return 999;
  }

  return (
    Date.now() - buyTime
  ) / 60000;
}

function findLowestHolding(
  state,
  strategyGroup
) {
  const rows =
    (state.holdings || [])
      .filter(
        holding =>
          holding.strategyGroup ===
          strategyGroup
      )
      .map(holding => ({
        holding,

        holdingScore:
          getHoldingCurrentScore(
            holding
          ),

        profitRate:
          getHoldingProfitRate(
            holding
          ),

        holdMinutes:
          getHoldingMinutes(
            holding
          )
      }))
      .sort(
        (a, b) =>
          Number(a.holdingScore || 0) -
          Number(b.holdingScore || 0)
      );

  return rows[0] || null;
}

function getCandidateCurrentScore(
  state,
  item,
  price,
  strategyGroup
) {
  const list =
    strategyGroup === "CORE"
      ? state.coreCandidateWatchList || []
      : state.volumeCandidateWatchList || [];

  const code =
    String(item.code || "")
      .padStart(6, "0");

  const watched =
    list.find(
      row =>
        String(row.code || "")
          .padStart(6, "0") ===
        code
    );

  if (watched) {
    return Number(
      watched.watchScore || 0
    );
  }

  const detail =
    calculateCandidateWatchScore(
      item,
      price,
      strategyGroup
    );

  return Number(detail.total || 0);
}

function evaluateSwitchCandidate(
  state,
  item,
  price,
  strategyGroup
) {
  const candidateScore =
    getCandidateCurrentScore(
      state,
      item,
      price,
      strategyGroup
    );

  const lowest =
    findLowestHolding(
      state,
      strategyGroup
    );

  if (!lowest) {
    return {
      allowed: false,
      reason: "비교할 보유종목 없음"
    };
  }

  const holding =
    lowest.holding;

  const holdingScore =
    Number(lowest.holdingScore || 0);

  const profitRate =
    Number(lowest.profitRate || 0);

  const holdMinutes =
    Number(lowest.holdMinutes || 0);

  const scoreGap =
    candidateScore - holdingScore;

  const lastSwitchAt =
    Number(
      state.lastSwitchAtByStrategy?.[
        strategyGroup
      ] || 0
    );

  const cooldownMinutes =
    lastSwitchAt > 0
      ? (
          Date.now() - lastSwitchAt
        ) / 60000
      : 999;

  const reasons = [];

  if (
    scoreGap <
    settings.switchMinScoreGap
  ) {
    reasons.push(
      `점수차 부족 ${scoreGap.toFixed(1)}점 / ` +
      `기준 ${settings.switchMinScoreGap}점`
    );
  }

  if (
    profitRate >
    settings.switchMaxHoldingProfitRate
  ) {
    reasons.push(
      `보유종목 수익 ${profitRate.toFixed(2)}% / ` +
      `교체상한 ${settings.switchMaxHoldingProfitRate.toFixed(2)}%`
    );
  }

  if (
    holdMinutes <
    settings.switchMinHoldingMinutes
  ) {
    reasons.push(
      `보유시간 ${holdMinutes.toFixed(1)}분 / ` +
      `기준 ${settings.switchMinHoldingMinutes}분`
    );
  }

  if (
    cooldownMinutes <
    settings.switchCooldownMinutes
  ) {
    reasons.push(
      `스위칭 쿨다운 ${cooldownMinutes.toFixed(1)}분 / ` +
      `기준 ${settings.switchCooldownMinutes}분`
    );
  }

  return {
    allowed:
      reasons.length === 0,

    strategyGroup,

    candidateCode:
      item.code,

    candidateName:
      item.name || item.code,

    candidatePrice:
      Number(price || 0),

    candidateScore:
      Number(candidateScore.toFixed(1)),

    holdingCode:
      holding.code,

    holdingName:
      holding.name || holding.code,

    holdingScore:
      Number(holdingScore.toFixed(1)),

    holdingProfitRate:
      Number(profitRate.toFixed(2)),

    holdingMinutes:
      Number(holdMinutes.toFixed(1)),

    scoreGap:
      Number(scoreGap.toFixed(1)),

    reason:
      reasons.length === 0
        ? `교체조건 충족 / 점수차 ${scoreGap.toFixed(1)}점`
        : reasons.join(" / ")
  };
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

  if (state.dailyRiskDate === today) {
    return;
  }

  state.dailyRiskDate = today;
  state.dailyBuyStopped = false;

  state.dailyBuyStoppedAt = null;
  state.dailyBuyStoppedReason = null;

  /*
   * 후보 이력 초기화
   */
  state.coreCandidateHistory = {};
  state.volumeCandidateHistory = {};

  state.coreCandidateWatchList = [];
  state.volumeCandidateWatchList = [];

  /*
   * 시장온도 초기화
   */
  state.marketTemperature = {
    level: "NORMAL",
    label: "보통",
    score: 50,

    advanceRatio: 0,
    declineRatio: 0,
    volumePassRatio: 0,
    averageChangeRate: 0,

    total: 0,

    reason: "오늘 시장온도 계산 전",

    checkedAt: nowText(),
    checkedDate: today
  };

  /*
   * 아까운 후보 분석 초기화
   */
  state.candidateNearMissAnalysis = {
    date: today,
    updatedAt: null,
    rows: []
  };

  /*
   * 운영상 차단 후보 분석 초기화
   */
  state.operationalBlockedCandidateAnalysis = {
    date: today,
    updatedAt: null,
    rows: []
  };

  /*
   * 매수 판단 통계 초기화
   */
  state.buyDecisionStats = {
    date: today,

    CORE: {
      checked: 0,
      passed: 0,
      bought: 0,

      conditionRejected: {},
      operationalBlocked: {},
      sources: {}
    },

    VOLUME: {
      checked: 0,
      passed: 0,
      bought: 0,

      conditionRejected: {},
      operationalBlocked: {},
      sources: {}
    }
  };

  /*
   * 진행 중 주문 초기화
   */
  state.pendingBuyCodes = [];
  state.pendingSellCodes = [];

  /*
   * 전략별 스위칭 쿨다운 초기화
   */
  state.lastSwitchAtByStrategy = {
    CORE: 0,
    VOLUME: 0
  };

  /*
   * 현재 보유금액 계산
   */
  const holdingValue =
    (state.holdings || []).reduce(
      (sum, holding) => {
        const currentPrice =
          Number(
            holding.currentPrice ||
            holding.buyPrice ||
            0
          );

        const qty =
          Number(holding.qty || 0);

        return (
          sum +
          currentPrice * qty
        );
      },
      0
    );

  /*
   * 하루 시작 기준값 저장
   *
   * 전일부터 이어진 보유종목의 기존 평가손익은
   * 오늘 손익에 다시 포함되지 않도록 장 시작 기준으로 고정한다.
   */
  const dailyStartHoldingProfit =
    (state.holdings || []).reduce(
      (sum, holding) => {
        const buyPrice = Number(holding.buyPrice || 0);
        const currentPrice = Number(
          holding.currentPrice || holding.buyPrice || 0
        );
        const qty = Number(holding.qty || 0);

        return sum + (currentPrice - buyPrice) * qty;
      },
      0
    );

  state.dailyStartDate = today;
  state.dailyStartAsset =
    Number(state.totalCash || 0) +
    holdingValue;
  state.dailyStartHoldingProfit =
    dailyStartHoldingProfit;
  state.dailyStartCapturedAt = nowText();

  /*
   * 일일 손실한도 계산
   */
  state.dailyLossLimit =
    Math.floor(
      state.dailyStartAsset *
      settings.dailyLossLimitRate
    );

  console.log(
    `[리스크 초기화] ` +
    `시작자산 ${state.dailyStartAsset.toLocaleString()}원 / ` +
    `보유평가 ${holdingValue.toLocaleString()}원 / ` +
    `시작평가손익 ${Number(
      state.dailyStartHoldingProfit || 0
    ).toLocaleString()}원 / ` +
    `현금 ${Number(
      state.totalCash || 0
    ).toLocaleString()}원 / ` +
    `일일손실한도 ${state.dailyLossLimit.toLocaleString()}원`
  );
}

function getCurrentAssetSnapshot(state) {
  const holdings = Array.isArray(state.holdings)
    ? state.holdings
    : [];

  const holdingEvalAmount = holdings.reduce(
    (sum, holding) => {
      const currentPrice = Number(
        holding.currentPrice ||
        holding.buyPrice ||
        0
      );

      const qty = Number(holding.qty || 0);

      return sum + currentPrice * qty;
    },
    0
  );

  const holdingBuyAmount = holdings.reduce(
    (sum, holding) =>
      sum +
      Number(holding.buyPrice || 0) *
      Number(holding.qty || 0),
    0
  );

  const cash = Number(state.totalCash || 0);
  const currentAsset = cash + holdingEvalAmount;

  return {
    cash,
    holdingEvalAmount,
    holdingProfit:
      holdingEvalAmount - holdingBuyAmount,
    currentAsset
  };
}

function checkDailyLossLimit(state) {
  initDailyRiskIfNeeded(state);

  const asset = getCurrentAssetSnapshot(state);
  const dailyStartAsset = Number(
    state.dailyStartAsset || asset.currentAsset || 0
  );

  /*
   * 일일 손실한도는 매도 완료된 실현손익뿐 아니라
   * 현재 보유종목의 평가손익 변동까지 포함한
   * 오늘 총자산 증감으로 판단한다.
   *
   * 전일부터 이어진 평가손익은 dailyStartAsset에 이미
   * 포함되어 있으므로 오늘 발생한 변동만 계산된다.
   */
  const todayAssetProfit =
    asset.currentAsset - dailyStartAsset;

  const todayRealizedProfit =
    getTodayRealizedProfit(state);

  const limit = Number(state.dailyLossLimit || 0);

  if (
    limit > 0 &&
    todayAssetProfit <= -Math.abs(limit)
  ) {
    state.dailyBuyStopped = true;
    state.dailyBuyStoppedAt = nowText();
    state.dailyBuyStoppedReason =
      `일일 손실한도 도달 / ` +
      `오늘 총자산손익 ${todayAssetProfit.toLocaleString()}원 / ` +
      `오늘 실현손익 ${todayRealizedProfit.toLocaleString()}원 / ` +
      `현재 보유평가손익 ${asset.holdingProfit.toLocaleString()}원 / ` +
      `한도 ${limit.toLocaleString()}원`;

    return {
      stopped: true,
      reason: state.dailyBuyStoppedReason,
      todayAssetProfit,
      todayRealizedProfit,
      currentHoldingProfit: asset.holdingProfit,
      currentAsset: asset.currentAsset,
      dailyStartAsset,
      limit
    };
  }

  return {
    stopped: false,
    reason:
      `오늘 총자산손익 ${todayAssetProfit.toLocaleString()}원 / ` +
      `오늘 실현손익 ${todayRealizedProfit.toLocaleString()}원 / ` +
      `현재 보유평가손익 ${asset.holdingProfit.toLocaleString()}원 / ` +
      `한도 ${limit.toLocaleString()}원`,
    todayAssetProfit,
    todayRealizedProfit,
    currentHoldingProfit: asset.holdingProfit,
    currentAsset: asset.currentAsset,
    dailyStartAsset,
    limit
  };
}

function isAlreadyHolding(state, code) {
  return state.holdings.some(h => h.code === code);
}

function wasBoughtToday(state, code) {
  return state.tradeLogs.some(log =>
    log.code === code &&
    log.date === todayKey() &&
    ["OPEN_BUY", "CORE_BUY", "VOLUME_BUY"].includes(log.type)
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

async function discoverCandidates(
  state,
  mode = "CORE_VOLUME"
) {
  const offset =
    Number(state.discoverOffset || 0);

  const scanLimit =
    getDynamicDiscoverScanLimit(mode);

  const data = await fetchJson(
    `${API_BASE}/api/discover?offset=${offset}` +
    `&scanLimit=${scanLimit}` +
    `&limit=${settings.discoverLimit}`
  );

  state.discoverOffset =
    Number(data.nextOffset || 0);

  state.lastDiscoverOffsetAt =
    nowText();

  const rawItems =
    Array.isArray(data.items)
      ? data.items
      : [];

  /*
   * 시장점수용 데이터
   *
   * 발견점수 조건을 적용하지 않는다.
   * ETF·ETN·우선주 등 제외종목만 제거한다.
   */
  const marketRows =
    rawItems.filter(item =>
      !isExcludedStock(item)
    );

  /*
   * 실제 매수 후보
   *
   * 기존처럼 발견점수 기준을 적용한다.
   */
  const candidates =
    marketRows
      .filter(item =>
        Number(item.discoverScore || 0) >=
        settings.minDiscoverScore
      )
      .sort(
        (a, b) =>
          Number(b.discoverScore || 0) -
          Number(a.discoverScore || 0)
      );

  console.log(
    `[DISCOVER] 원본 ${rawItems.length}개 / ` +
    `시장계산 ${marketRows.length}개 / ` +
    `매수후보 ${candidates.length}개 / ` +
    `offset ${offset} → ${state.discoverOffset} / ` +
    `scanLimit ${scanLimit} / ` +
    `mode ${mode}`
  );

  return {
    candidates,
    marketRows
  };
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

function getDynamicDiscoverScanLimit(mode = "CORE_VOLUME") {
  const hhmm = getCurrentHHMM();

  if (
    hhmm >= settings.coreStartTime &&
    hhmm < settings.earlyDiscoverEndTime
  ) {
    return settings.earlyDiscoverScanLimit;
  }

  if (
    hhmm >= settings.earlyDiscoverEndTime &&
    hhmm < settings.midDiscoverEndTime
  ) {
    return settings.midDiscoverScanLimit;
  }

  return settings.discoverScanLimit;
}

function getDynamicBuyLoopMs() {
  const hhmm = getCurrentHHMM();

  if (
    hhmm >= settings.coreStartTime &&
    hhmm < settings.earlyDiscoverEndTime
  ) {
    return settings.earlyBuyLoopMs;
  }

  if (
    hhmm >= settings.earlyDiscoverEndTime &&
    hhmm < settings.midDiscoverEndTime
  ) {
    return settings.midBuyLoopMs;
  }

  return settings.buyLoopMs;
}







function isCoreCandidateGettingStronger(state, item, price) {
  const code = item.code;
  if (!code) {
  return {
    pass: false,
    reason: "종목코드 없음"
  };
}

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

if (!prev) {
  state.coreCandidateHistory[code] = current;

  return {
    pass: false,
    reason: "첫 발견 / 30초 확인 대기"
  };
}

if (
  now - Number(prev.time || 0) <
  settings.candidateConfirmWaitMs
) {
  return {
    pass: false,
    reason:
      `강화 확인 대기 / ` +
      `${((now - Number(prev.time || 0)) / 1000).toFixed(0)}초 / ` +
      `기준 ${(settings.candidateConfirmWaitMs / 1000).toFixed(0)}초`
  };
}

state.coreCandidateHistory[code] = current;



  const scoreDiff =
  current.score -
  Number(prev.score || 0);

const prevVolumeRatio =
  Number(prev.volumeRatio || 0);

const volumeDropRate =
  prevVolumeRatio > 0
    ? (
        (current.volumeRatio -
          prevVolumeRatio) /
        prevVolumeRatio
      ) * 100
    : 0;

const priceDiffRate =
  Number(prev.price || 0) > 0
    ? (
        (current.price -
          Number(prev.price)) /
        Number(prev.price)
      ) * 100
    : 0;

if (scoreDiff < -1) {
  return {
    pass: false,
    reason:
      `점수 약화 ${prev.score} → ${current.score}`
  };
}

if (volumeDropRate < -20) {
  return {
    pass: false,
    reason:
      `거래량 약화 ` +
      `${prevVolumeRatio.toFixed(1)}% → ` +
      `${current.volumeRatio.toFixed(1)}% / ` +
      `${Math.abs(volumeDropRate).toFixed(1)}% 감소`
  };
}

  if (priceDiffRate < -0.4) {
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

function isVolumeCandidateGettingStronger(
  state,
  item,
  price
) {
  const code = item.code;

  if (!code) {
    return {
      pass: false,
      reason: "종목코드 없음"
    };
  }

  if (!state.volumeCandidateHistory) {
    state.volumeCandidateHistory = {};
  }

  const now = Date.now();

  const current = {
    time: now,
    score: Number(item.discoverScore || 0),
    volumeRatio: getTradeVolumeRatio(item),
    dayPosition: getDayPositionRate(item, price),
    price: Number(price || 0)
  };

  const prev =
    state.volumeCandidateHistory[code];

  // 처음 발견됐을 때만 기준값 저장
  if (!prev) {
    state.volumeCandidateHistory[code] = current;

    return {
      pass: false,
      reason: "첫 발견 / 30초 확인 대기"
    };
  }

  const elapsedMs =
    now - Number(prev.time || 0);

  //30초가 지나기 전에는 기준값을 덮어쓰지 않음
  if (
    elapsedMs <
    settings.candidateConfirmWaitMs
  ) {
    return {
      pass: false,
      reason:
        `강화 확인 대기 / ` +
        `${(elapsedMs / 1000).toFixed(0)}초 / ` +
        `기준 ${(settings.candidateConfirmWaitMs / 1000).toFixed(0)}초`
    };
  }

  //30초가 지난 경우에만 다음 비교 기준으로 갱신
  state.volumeCandidateHistory[code] =
    current;

const scoreDiff =
  current.score -
  Number(prev.score || 0);

const prevVolumeRatio =
  Number(prev.volumeRatio || 0);

const volumeDropRate =
  prevVolumeRatio > 0
    ? (
        (current.volumeRatio -
          prevVolumeRatio) /
        prevVolumeRatio
      ) * 100
    : 0;

const priceDiffRate =
  Number(prev.price || 0) > 0
    ? (
        (current.price -
          Number(prev.price)) /
        Number(prev.price)
      ) * 100
    : 0;

  if (scoreDiff < -1) {
    return {
      pass: false,
      reason:
        `점수 약화 ${prev.score} → ${current.score}`
    };
  }

if (volumeDropRate < -25) {
  return {
    pass: false,
    reason:
      `거래량 급감 ` +
      `${prevVolumeRatio.toFixed(1)}% → ` +
      `${current.volumeRatio.toFixed(1)}% / ` +
      `${Math.abs(volumeDropRate).toFixed(1)}% 감소`
  };
}

  if (priceDiffRate < -0.3) {
    return {
      pass: false,
      reason:
        `가격 약화 ${priceDiffRate.toFixed(2)}%`
    };
  }

  return {
    pass: true,
    reason:
      `강화 확인 / ` +
      `점수 ${prev.score}→${current.score} / ` +
      `거래량 ${Number(prev.volumeRatio || 0).toFixed(1)}→` +
      `${current.volumeRatio.toFixed(1)}% / ` +
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
  const changeRate = Number(
    item.changeRate ||
    item.fluctuationRate ||
    item.riseRate ||
    item.rate ||
    0
  );

  const volumeRatio =
    getTradeVolumeRatio(item);

  const absoluteVolume =
    getAbsoluteVolume(item);

  const tradeAmount =
    getTradeAmount(item, price);

  const dayPosition =
    getDayPositionRate(item, price);

  const discoverScore =
    Number(item.discoverScore || 0);

  const marketCondition =
    getMarketAdjustedBuySettings(
      state,
      "CORE"
    );

  if (!settings.coreEnabled) {
    return {
      pass: false,
      reason: "CORE OFF"
    };
  }

  if (
    !isBetweenTime(
      settings.coreStartTime,
      settings.coreEndTime
    )
  ) {
    return {
      pass: false,
      reason: "CORE 시간 아님"
    };
  }

  if (
    marketCondition.buyBlocked
  ) {
    return {
      pass: false,
      reason:
        `시장조건 차단 / ` +
        marketCondition.reason
    };
  }

  if (
    isAlreadyHolding(
      state,
      item.code
    )
  ) {
    return {
      pass: false,
      reason: "이미 보유중"
    };
  }

  if (
    wasBoughtToday(
      state,
      item.code
    )
  ) {
    return {
      pass: false,
      reason: "오늘 이미 매수"
    };
  }

  const cooldown =
    isStrategyBuyCooldown(
      state,
      "CORE"
    );

  if (cooldown.blocked) {
    return {
      pass: false,
      reason: cooldown.reason
    };
  }

  const adjustedMinVolumeRatio =
    marketCondition.minVolumeRatio;

  const adjustedMinDiscoverScore =
    marketCondition.minDiscoverScore;

  /*
   * 시장상태에 따라 조정된
   * 최소 발견점수 검사
   */
  if (
    discoverScore <
    adjustedMinDiscoverScore
  ) {
    return {
      pass: false,
      reason:
        `발견점수 부족 ` +
        `${discoverScore.toFixed(1)} / ` +
        `시장조정 기준 ` +
        `${adjustedMinDiscoverScore.toFixed(1)} / ` +
        marketCondition.reason
    };
  }

  /*
   * CORE 상승률 상한
   */
  if (
    changeRate >
    settings.coreMaxChangeRate
  ) {
    return {
      pass: false,
      reason: makeMaxLog(
        "상승률",
        "CORE",
        changeRate,
        settings.coreMaxChangeRate
      )
    };
  }

  /*
   * 시장상태에 따라 조정된
   * 거래량 기준 검사
   */
  const effectiveCoreMinVolumeRatio = Math.max(
    0,
    adjustedMinVolumeRatio -
      Number(settings.coreVolumeRatioTolerance || 0)
  );

  if (
    volumeRatio <
    effectiveCoreMinVolumeRatio
  ) {
    return {
      pass: false,
      reason:
        makeVolumeRatioLog(
          item,
          "CORE",
          volumeRatio,
          adjustedMinVolumeRatio
        ) +
        ` / 허용하한 ${effectiveCoreMinVolumeRatio.toFixed(1)}%` +
        ` / ${marketCondition.reason}`
    };
  }

  if (volumeRatio < adjustedMinVolumeRatio) {
    console.log(
      `[CORE 거래량 허용통과] ${item.name || item.code} / ` +
      `거래량 ${volumeRatio.toFixed(1)}% / ` +
      `기준 ${adjustedMinVolumeRatio.toFixed(1)}% / ` +
      `허용하한 ${effectiveCoreMinVolumeRatio.toFixed(1)}%`
    );
  }

  /*
   * 저유동성 종목 차단
   * 비율이 좋아도 절대 체결량이 부족하면 손절 구간을 건너뛸 수 있다.
   */
  if (settings.liquidityFilterEnabled) {
    const minAbsoluteVolume =
      settings.coreMinAbsoluteVolume;

    const minTradeAmount =
      settings.coreMinTradeAmount;

    const liquidity = checkAbsoluteLiquidity(
      absoluteVolume,
      tradeAmount,
      minAbsoluteVolume,
      minTradeAmount,
      settings.coreAltMinAbsoluteVolume,
      settings.coreAltMinTradeAmount
    );

    if (!liquidity.pass) {
      return {
        pass: false,
        reason: makeLiquidityLog(
          "CORE",
          absoluteVolume,
          minAbsoluteVolume,
          tradeAmount,
          minTradeAmount,
          settings.coreAltMinAbsoluteVolume,
          settings.coreAltMinTradeAmount
        )
      };
    }
  }

  /*
   * CORE 당일위치 범위
   */
  if (
    dayPosition <
      settings.coreMinDayPositionRate ||
    dayPosition >
      settings.coreMaxDayPositionRate
  ) {
    return {
      pass: false,
      reason: makeMinMaxLog(
        "당일위치",
        "CORE",
        dayPosition,
        settings.coreMinDayPositionRate,
        settings.coreMaxDayPositionRate
      )
    };
  }

  /*
   * 후보 강화 확인
   */
  const rankCheck =
    isCoreCandidateGettingStronger(
      state,
      item,
      price
    );

  if (
    rankCheck !== true &&
    !rankCheck.pass
  ) {
    return {
      pass: false,
      reason:
        `후보 강화 미충족 / ` +
        `${rankCheck.reason || "사유 없음"}`
    };
  }

  /*
   * 보유한도 도달 시
   * 자동 스위칭 검토
   */
  const coreHoldingFull =
    getHoldingCount(
      state,
      "CORE"
    ) >=
    settings.coreMaxHoldingCount;

  if (coreHoldingFull) {
    const switchResult =
      evaluateSwitchCandidate(
        state,
        item,
        price,
        "CORE"
      );

    return {
      pass: false,

      reason:
        switchResult.allowed
          ? (
              `CORE 보유한도 / ` +
              `스위칭 조건 충족 / ` +
              `${switchResult.holdingName}→` +
              `${switchResult.candidateName}`
            )
          : (
              `CORE 보유한도 / ` +
              `스위칭 제외 / ` +
              switchResult.reason
            ),

      switchResult
    };
  }

  /*
   * 최종 통과
   */
  return {
    pass: true,

    reason:
      `CORE 통과 / ` +
      `발견점수 ${discoverScore.toFixed(1)} / ` +
      `상승 ${changeRate.toFixed(2)}% / ` +
      `거래량 ${volumeRatio.toFixed(1)}% / ` +
      `위치 ${dayPosition.toFixed(1)}% / ` +
      `후보강화 통과 / ` +
      marketCondition.reason
  };
}

function judgeVolumeBuy(state, item, price) {
  const changeRate = Number(
    item.changeRate ||
    item.fluctuationRate ||
    item.riseRate ||
    item.rate ||
    0
  );

  const volumeRatio =
    getTradeVolumeRatio(item);

  const absoluteVolume =
    getAbsoluteVolume(item);

  const tradeAmount =
    getTradeAmount(item, price);

  const dayPosition =
    getDayPositionRate(item, price);

  const openPosition =
    getOpenPositionRate(item, price);

  const discoverScore =
    Number(item.discoverScore || 0);

  const marketCondition =
    getMarketAdjustedBuySettings(
      state,
      "VOLUME"
    );

  if (!settings.volumeEnabled) {
    return {
      pass: false,
      reason: "VOLUME OFF"
    };
  }

  if (
    !isBetweenTime(
      settings.volumeStartTime,
      settings.volumeEndTime
    )
  ) {
    return {
      pass: false,
      reason: "VOLUME 시간 아님"
    };
  }

  if (marketCondition.buyBlocked) {
    return {
      pass: false,
      reason:
        `시장조건 차단 / ` +
        marketCondition.reason
    };
  }

  if (
    isAlreadyHolding(
      state,
      item.code
    )
  ) {
    return {
      pass: false,
      reason: "이미 보유중"
    };
  }

  if (
    wasBoughtToday(
      state,
      item.code
    )
  ) {
    return {
      pass: false,
      reason: "오늘 이미 매수"
    };
  }

  const cooldown =
    isStrategyBuyCooldown(
      state,
      "VOLUME"
    );

  if (cooldown.blocked) {
    return {
      pass: false,
      reason: cooldown.reason
    };
  }

  const adjustedMinVolumeRatio =
    marketCondition.minVolumeRatio;

  const adjustedMinDiscoverScore =
    marketCondition.minDiscoverScore;

  /*
   * 시장온도에 따라 조정된 발견점수 기준
   */
  if (
    discoverScore <
    adjustedMinDiscoverScore
  ) {
    return {
      pass: false,
      reason:
        `발견점수 부족 ` +
        `${discoverScore.toFixed(1)} / ` +
        `시장조정 기준 ` +
        `${adjustedMinDiscoverScore.toFixed(1)} / ` +
        marketCondition.reason
    };
  }

  /*
   * VOLUME 상승률 범위
   */
  if (
    changeRate <
      settings.volumeMinChangeRate ||
    changeRate >
      settings.volumeMaxChangeRate
  ) {
    return {
      pass: false,
      reason: makeMinMaxLog(
        "상승률",
        "VOLUME",
        changeRate,
        settings.volumeMinChangeRate,
        settings.volumeMaxChangeRate
      )
    };
  }

  /*
   * 시장온도에 따라 조정된 거래량 기준
   */
  if (
    volumeRatio <
    adjustedMinVolumeRatio
  ) {
    return {
      pass: false,
      reason:
        makeVolumeRatioLog(
          item,
          "VOLUME",
          volumeRatio,
          adjustedMinVolumeRatio
        ) +
        ` / ${marketCondition.reason}`
    };
  }

  /*
   * 저유동성 종목 차단
   * VOLUME 전략은 순간 거래량 증가보다 실제 누적 체결량을 더 엄격하게 본다.
   */
  if (settings.liquidityFilterEnabled) {
    const minAbsoluteVolume =
      settings.volumeMinAbsoluteVolume;

    const minTradeAmount =
      settings.volumeMinTradeAmount;

    const liquidity = checkAbsoluteLiquidity(
      absoluteVolume,
      tradeAmount,
      minAbsoluteVolume,
      minTradeAmount,
      settings.volumeAltMinAbsoluteVolume,
      settings.volumeAltMinTradeAmount
    );

    if (!liquidity.pass) {
      return {
        pass: false,
        reason: makeLiquidityLog(
          "VOLUME",
          absoluteVolume,
          minAbsoluteVolume,
          tradeAmount,
          minTradeAmount,
          settings.volumeAltMinAbsoluteVolume,
          settings.volumeAltMinTradeAmount
        )
      };
    }
  }

  /*
   * VOLUME 당일위치 범위
   */
  if (
    dayPosition <
      settings.volumeMinDayPositionRate ||
    dayPosition >
      settings.volumeMaxDayPositionRate
  ) {
    return {
      pass: false,
      reason: makeMinMaxLog(
        "당일위치",
        "VOLUME",
        dayPosition,
        settings.volumeMinDayPositionRate,
        settings.volumeMaxDayPositionRate
      )
    };
  }

  /*
 * VOLUME 초반 과열 차단
 *
 * 거래량과 상승률은 매우 높지만
 * 당일 고가권을 충분히 유지하지 못하는 종목은
 * 순간 체결 폭증 후 밀릴 가능성이 있어 매수하지 않는다.
 */
if (
  settings.volumeOverheatBlockEnabled &&
  volumeRatio >=
    settings.volumeOverheatMinVolumeRatio &&
  changeRate >=
    settings.volumeOverheatMinChangeRate &&
  dayPosition <
    settings.volumeOverheatMinDayPositionRate
) {
  return {
    pass: false,
    reason:
      `VOLUME 초반 과열 / ` +
      `상승률 ${changeRate.toFixed(2)}% / ` +
      `거래량 ${volumeRatio.toFixed(1)}% / ` +
      `당일위치 ${dayPosition.toFixed(1)}% / ` +
      `필요위치 ${settings.volumeOverheatMinDayPositionRate.toFixed(1)}% 이상`
  };
}

  /*
   * VOLUME은 시가 이상이어야 함
   */
  if (openPosition < 0) {
    return {
      pass: false,
      reason:
        `시가대비 ${openPosition.toFixed(2)}% / ` +
        `VOLUME 최소기준 0.00% / ` +
        `부족 ${Math.abs(openPosition).toFixed(2)}%p`
    };
  }

  /*
   * 후보 강화 확인
   */
  const rankCheck =
    isVolumeCandidateGettingStronger(
      state,
      item,
      price
    );

  if (
    rankCheck !== true &&
    !rankCheck.pass
  ) {
    return {
      pass: false,
      reason:
        `후보 강화 미충족 / ` +
        `${rankCheck.reason || "사유 없음"}`
    };
  }

  /*
   * 보유한도 도달 시 자동 스위칭 검토
   */
  const volumeHoldingFull =
    getHoldingCount(
      state,
      "VOLUME"
    ) >=
    settings.volumeMaxHoldingCount;

  if (volumeHoldingFull) {
    const switchResult =
      evaluateSwitchCandidate(
        state,
        item,
        price,
        "VOLUME"
      );

    return {
      pass: false,

      reason:
        switchResult.allowed
          ? (
              `VOLUME 보유한도 / ` +
              `스위칭 조건 충족 / ` +
              `${switchResult.holdingName}→` +
              `${switchResult.candidateName}`
            )
          : (
              `VOLUME 보유한도 / ` +
              `스위칭 제외 / ` +
              switchResult.reason
            ),

      switchResult
    };
  }

  /*
   * 최종 통과
   */
  return {
    pass: true,

    reason:
      `VOLUME 통과 / ` +
      `발견점수 ${discoverScore.toFixed(1)} / ` +
      `상승 ${changeRate.toFixed(2)}% / ` +
      `거래량 ${volumeRatio.toFixed(1)}% / ` +
      `위치 ${dayPosition.toFixed(1)}% / ` +
      `시가대비 ${openPosition.toFixed(2)}% / ` +
      `후보강화 통과 / ` +
      marketCondition.reason
  };
}


/*
 * 후보강도 진단값
 *
 * 실제 매수 통과조건에는 사용하지 않고,
 * 장 종료 후 매수 품질 분석을 위한 기록값으로만 사용한다.
 */
function calculateCandidateStrengthDiagnostic(
  scoreDetail = {}
) {
  const priceDiffRate = Number(
    scoreDetail.priceDiffRate || 0
  );

  const volumeDiff = Number(
    scoreDetail.volumeDiff || 0
  );

  const dayPositionDiff = Number(
    scoreDetail.dayPositionDiff || 0
  );

  const trendPenalty = Number(
    scoreDetail.trendPenalty || 0
  );

  let score = 50;

  // 최초 발견 이후 가격 흐름
  score += Math.max(
    -25,
    Math.min(25, priceDiffRate * 20)
  );

  // 당일위치 변화
  score += Math.max(
    -20,
    Math.min(20, dayPositionDiff * 0.5)
  );

  // 거래량 변화는 가격 방향을 알 수 없으므로 소폭만 반영
  score += Math.max(
    -5,
    Math.min(5, volumeDiff / 20)
  );

  // 기존 후보점수의 추세 감점 반영
  score += Math.max(-20, trendPenalty);

  score = Math.max(0, Math.min(100, score));

  let label = "보통";

  if (score >= 70) {
    label = "강함";
  } else if (score < 40) {
    label = "약함";
  }

  return {
    score: Number(score.toFixed(1)),
    label,
    priceDiffRate:
      Number(priceDiffRate.toFixed(2)),
    volumeDiff:
      Number(volumeDiff.toFixed(1)),
    dayPositionDiff:
      Number(dayPositionDiff.toFixed(1)),
    trendPenalty:
      Number(trendPenalty.toFixed(1))
  };
}


async function paperBuy(
  state,
  item,
  price,
  strategyGroup,
  reason
) {
  if (!state.pendingBuyCodes) {
    state.pendingBuyCodes = [];
  }

  if (
    state.pendingBuyCodes.includes(item.code)
  ) {
    console.log(
      `[${strategyGroup} 매수제외] ` +
      `${item.name || item.code} / ` +
      `매수 요청 진행중`
    );

    return false;
  }

  state.pendingBuyCodes.push(item.code);
  saveState(state);

  try {
    const availableCash =
      Number(state.totalCash || 0);

    // 아침에 저장된 시작자산
    const dailyStartAsset =
      Number(
        state.dailyStartAsset ||
        settings.totalCash ||
        0
      );

    // 시작자산의 1/8
    const calculatedBuyAmount =
      Math.floor(
        dailyStartAsset *
        settings.buyAssetRatio
      );

    // 실제 매수금액은 남은 현금 한도 내
    const finalBuyAmount =
      Math.min(
        calculatedBuyAmount,
        availableCash
      );

    const qty =
      Math.floor(finalBuyAmount / price);

    if (qty <= 0) {
      console.log(
        `[${strategyGroup} 매수제외] 수량 부족 / ` +
        `${item.name || item.code} / ` +
        `시작자산 ${dailyStartAsset.toLocaleString()}원 / ` +
        `기준매수금 ${calculatedBuyAmount.toLocaleString()}원 / ` +
        `남은현금 ${availableCash.toLocaleString()}원`
      );

      return false;
    }

    const watchList =
      strategyGroup === "CORE"
        ? state.coreCandidateWatchList || []
        : state.volumeCandidateWatchList || [];

    const normalizedCode =
      String(item.code || "").padStart(6, "0");

    const watchItem =
      watchList.find(
        row =>
          String(row.code || "").padStart(6, "0") ===
          normalizedCode
      ) || null;

    const watchScoreDetail =
      watchItem?.watchScoreDetail ??
      item.watchScoreDetail ??
      null;

    const name =
      item.name ||
      item.stockName ||
      item.korName ||
      watchItem?.name ||
      item.code;

    console.log(
      `[${strategyGroup} 매수조건 상세] ${name} / ` +
      makeBuyConditionDetailLog(
        item,
        price,
        strategyGroup
      )
    );

    const result = await postJson(
      `${API_BASE}/api/core-paper-buy`,
      {
        code: item.code,
        name,
        price,
        qty,
        strategyGroup,
        reason
      }
    );

    console.log(
      `[${strategyGroup} 매수요청 완료] ${name} / ` +
      `${price}원 / ${qty}주 / ` +
      `현금 ${Number(result.totalCash || 0).toLocaleString()}원 / ` +
      `${reason}`
    );

    if (
      strategyGroup === "CORE" ||
      strategyGroup === "VOLUME"
    ) {
      recordBuySuccess(
        state,
        strategyGroup,
        item,
        price
      );
    }

    const buyChangeRate = Number(
      item.changeRate ??
      item.fluctuationRate ??
      item.riseRate ??
      item.rate ??
      watchScoreDetail?.changeRate ??
      watchItem?.itemSnapshot?.changeRate ??
      0
    );

    const itemVolumeRatio =
      getTradeVolumeRatio(item);

    const buyTradeVolumeRatio = Number(
      itemVolumeRatio ||
      watchScoreDetail?.volumeRatio ||
      watchItem?.itemSnapshot?.tradeVolumeRatio ||
      0
    );

    const itemDayPosition =
      getDayPositionRate(item, price);

    const buyDayPositionRate = Number(
      itemDayPosition ||
      watchScoreDetail?.dayPosition ||
      watchItem?.itemSnapshot?.dayPosition ||
      0
    );

    const itemOpenPosition =
      getOpenPositionRate(item, price);

    const buyOpenPositionRate = Number(
      itemOpenPosition ||
      watchItem?.itemSnapshot?.openPosition ||
      0
    );

    const discoverScore = Number(
      item.discoverScore ??
      watchScoreDetail?.discoverScore ??
      watchItem?.itemSnapshot?.discoverScore ??
      0
    );

    const finalBuyScore = Number(
      item.finalBuyScore ??
      item.finalScore ??
      item.rankScore ??
      watchItem?.watchScore ??
      item.watchScore ??
      0
    );

    const marketScore = Number(
      item.marketScore?.score ??
      item.marketScore ??
      watchScoreDetail?.marketScore?.score ??
      watchScoreDetail?.marketScore ??
      state.marketTemperature?.score ??
      0
    );

    const sectorPowerScore = Number(
      item.sectorPowerScore ??
      item.sectorScore ??
      watchScoreDetail?.sectorPowerScore ??
      watchScoreDetail?.sectorScore ??
      0
    );

    const leaderStrengthScore = Number(
      item.leaderStrengthScore ??
      item.candidateStrengthScore ??
      watchScoreDetail?.leaderStrengthScore ??
      watchScoreDetail?.candidateStrengthScore ??
      0
    );

    const candidateWatchScore = Number(
      watchItem?.watchScore ??
      item.watchScore ??
      0
    );

    const candidateStrengthDiagnostic =
      calculateCandidateStrengthDiagnostic(
        watchScoreDetail || {}
      );

    /*
     * 기존 후보강도 값이 있으면 그대로 사용하고,
     * 없을 때만 진단점수를 사용한다.
     */
    const candidateStrengthScore = Number(
      item.candidateStrengthScore ??
      item.leaderStrengthScore ??
      watchScoreDetail?.candidateStrengthScore ??
      watchScoreDetail?.leaderStrengthScore ??
      candidateStrengthDiagnostic.score ??
      0
    );

    const commonBuyData = {
      discoverScore: Math.round(discoverScore),

      finalBuyScore: Math.round(finalBuyScore),
      finalBuyScoreDetail:
        watchScoreDetail,

      marketScore: Math.round(marketScore),
      marketTemperature:
        state.marketTemperature || null,

      sectorPowerScore: Math.round(sectorPowerScore),
      leaderStrengthScore: Math.round(leaderStrengthScore),
      candidateStrengthScore: Math.round(candidateStrengthScore),

      candidateWatchScore: Math.round(candidateWatchScore),
      candidateWatchScoreDetail:
        watchScoreDetail,

      candidateStrengthLabel:
        candidateStrengthDiagnostic.label,

      candidateBaseScore: Math.round(Number(
        watchScoreDetail?.baseTotal ??
        candidateWatchScore ??
        0
      )),

      candidateTrendPenalty: Math.round(Number(
        watchScoreDetail?.trendPenalty || 0
      )),

      buyPriceDiffRate: Number(
        watchScoreDetail?.priceDiffRate || 0
      ),

      buyVolumeDiff: Number(
        watchScoreDetail?.volumeDiff || 0
      ),

      buyDayPositionDiff: Number(
        watchScoreDetail?.dayPositionDiff || 0
      ),

      candidateFirstVolumeRatio: Number(
        watchScoreDetail?.firstVolumeRatio ??
        watchItem?.firstVolumeRatio ??
        0
      ),

      candidateFirstDayPosition: Number(
        watchScoreDetail?.firstDayPosition ??
        watchItem?.firstDayPosition ??
        0
      ),

      candidateFirstSeenAt:
        watchItem?.firstSeenAt ?? null,

      candidateFirstSeenAtText:
        watchItem?.firstSeenAtText ?? null,

      candidateLastSeenAt:
        watchItem?.lastSeenAt ?? null,

      candidateLastSeenAtText:
        watchItem?.lastSeenAtText ?? null,

      candidateFirstPrice: Number(
        watchItem?.firstPrice ?? 0
      ),

      buyChangeRate,
      buyTradeVolumeRatio,
      buyDayPositionRate,
      buyOpenPositionRate
    };

    console.log(
      `[${strategyGroup} 매수진단] ${name} / ` +
      `후보강도 ${candidateStrengthDiagnostic.label} ` +
      `${candidateStrengthScore.toFixed(1)}점 / ` +
      `기본 ${Number(
        watchScoreDetail?.baseTotal ??
        candidateWatchScore ??
        0
      ).toFixed(1)}점 / ` +
      `추세감점 ${Number(
        watchScoreDetail?.trendPenalty || 0
      ).toFixed(1)}점 / ` +
      `최초대비 가격 ${Number(
        watchScoreDetail?.priceDiffRate || 0
      ).toFixed(2)}% / ` +
      `거래량 ${Number(
        watchScoreDetail?.volumeDiff || 0
      ).toFixed(1)}%p / ` +
      `당일위치 ${Number(
        watchScoreDetail?.dayPositionDiff || 0
      ).toFixed(1)}%p`
    );

    state.holdings.push({
      code: item.code,
      name,
      strategyGroup,

      buyPrice: price,
      currentPrice: price,
      qty,
      buyAmount: price * qty,
      buyTime: Date.now(),
      buyTimeText: nowText(),

      highestPrice: price,
      lowestPrice: price,
      highestPriceAt: Date.now(),

      // 매수 시점부터 보유점수·가격 흐름을 기록한다.
      holdingScoreHistory: [{
        checkedAt: Date.now(),
        checkedAtText: nowText(),
        price: Number(price),
        profitRate: 0,
        holdingScore: Number(
          candidateWatchScore ||
          finalBuyScore ||
          0
        ),
        scoreDiff: 0,
        tradeVolumeRatio: Number(
          buyTradeVolumeRatio || 0
        ),
        dayPositionRate: Number(
          buyDayPositionRate || 0
        ),
        changeRate: Number(
          buyChangeRate || 0
        )
      }],

      ...commonBuyData,

      buyReason: reason
    });

    state.tradeLogs.push({
      date: todayKey(),
      time: nowText(),
      type: `${strategyGroup}_BUY`,

      code: item.code,
      name,
      strategyGroup,

      price,
      buyPrice: price,
      qty,
      amount: price * qty,
      buyAmount: price * qty,

      ...commonBuyData,

      reason
    });

    state.totalCash = Number(
      result.totalCash ||
      state.totalCash ||
      0
    );

    state.lastBuyAt = nowText();
    state.lastBuyCode = item.code;
    state.lastBuyName = name;
    state.lastBuyStrategyGroup =
      strategyGroup;

    saveState(state);

    return true;
  } finally {
    state.pendingBuyCodes =
      state.pendingBuyCodes.filter(
        code => code !== item.code
      );

    saveState(state);
  }
}

async function executeSwitch(
  state,
  item,
  price,
  strategyGroup,
  switchResult
) {
  if (!settings.switchEnabled) {
    return false;
  }

  const oldHolding =
    (state.holdings || []).find(
      holding =>
        holding.code ===
        switchResult.holdingCode &&
        holding.strategyGroup ===
        strategyGroup
    );

  if (!oldHolding) {
    console.log(
      `[SWITCH 취소] 기존 보유종목 없음 / ` +
      `${switchResult.holdingName}`
    );

    return false;
  }

  const sellSignal =
    makeSwitchSellSignal(
      oldHolding,
      item,
      switchResult
    );

  console.log(
    `[SWITCH 시작] ${strategyGroup} / ` +
    `${oldHolding.name} → ` +
    `${item.name || item.code} / ` +
    `점수 ${switchResult.holdingScore.toFixed(1)}→` +
    `${switchResult.candidateScore.toFixed(1)}`
  );

 const sellSuccess =
  await paperSell(
    state,
    oldHolding,
    Number(
      oldHolding.currentPrice ||
      oldHolding.buyPrice ||
      0
    ),
    Number(sellSignal.qty || 0),
    sellSignal.type,
    sellSignal.reason
  );

  if (!sellSuccess) {
    console.log(
      `[SWITCH 실패] 기존 종목 매도 실패 / ` +
      `${oldHolding.name}`
    );

    return false;
  }

  /*
   * paperSell에서 상태를 저장했으므로
   * 최신 상태를 다시 읽는다.
   */
  const refreshedState =
    loadState();

  refreshedState.lastSwitchAtByStrategy =
    refreshedState.lastSwitchAtByStrategy ||
    {
      CORE: 0,
      VOLUME: 0
    };

  refreshedState.lastSwitchAtByStrategy[
    strategyGroup
  ] = Date.now();

  const buySuccess =
    await paperBuy(
      refreshedState,
      item,
      price,
      strategyGroup,
      `스위칭 매수 / ` +
      `${oldHolding.name}→` +
      `${item.name || item.code} / ` +
      `점수차 ${switchResult.scoreGap.toFixed(1)}점`
    );

  if (!buySuccess) {
    console.log(
      `[SWITCH 부분완료] 기존 종목은 매도했지만 ` +
      `신규후보 매수 실패 / ` +
      `${item.name || item.code}`
    );

    saveState(refreshedState);
    return false;
  }

  console.log(
    `[SWITCH 완료] ${strategyGroup} / ` +
    `${oldHolding.name} → ` +
    `${item.name || item.code}`
  );

  return true;
}

async function paperSell(
  state,
  holding,
  sellPrice,
  sellQty,
  sellType,
  reason,
  sellSignalDetail = null
) {
  if (!state.pendingSellCodes) {
    state.pendingSellCodes = [];
  }

  const sellKey =
    `${holding.code}_${sellType}`;

  const sameCodeSellPending =
    state.pendingSellCodes.some(key =>
      String(key || "").startsWith(`${holding.code}_`)
    );

  if (sameCodeSellPending) {
    console.log(
      `[${sellType} 제외] ${holding.name} / 동일 종목 매도 요청 진행중`
    );
    return false;
  }

  state.pendingSellCodes.push(sellKey);
  saveState(state);

  try {
    const qty = Math.min(
      Number(sellQty || 0),
      Number(holding.qty || 0)
    );

    if (qty <= 0) {
      return false;
    }

    const sellSignalAt =
      sellSignalDetail?.signalAt ||
      nowText();

    const sellSignalPrice = Number(
      sellSignalDetail?.signalPrice ??
      sellPrice ??
      0
    );

    const sellOrderRequestedAt = nowText();

    const result = await postJson(
      `${API_BASE}/api/core-paper-sell`,
      {
        code: holding.code,
        price: sellPrice,
        qty,
        sellType,
        reason,
        manualSell: sellSignalDetail?.manualSell === true,
        manualRequestId: sellSignalDetail?.manualRequestId || null
      }
    );

    console.log(
      `[${sellType} 요청 완료] ${holding.name} / ` +
      `${sellPrice}원 / ${qty}주 / ` +
      `손익 ${Number(result.profit || 0).toLocaleString()}원 / ` +
      `${Number(result.profitRate || 0).toFixed(2)}% / ` +
      `${reason}`
    );

    holding.qty -= qty;

    if (holding.qty <= 0) {
      state.holdings =
        state.holdings.filter(
          row => row !== holding
        );
    }

    state.totalCash = Number(
      result.totalCash ||
      state.totalCash ||
      0
    );

    const buyPrice =
      Number(holding.buyPrice || 0);

    const highestPrice = Number(
      holding.highestPrice ||
      sellPrice ||
      buyPrice ||
      0
    );

    const lowestPrice = Number(
      holding.lowestPrice ||
      sellPrice ||
      buyPrice ||
      0
    );

    const maxProfitRate =
      buyPrice > 0
        ? (
            (highestPrice - buyPrice) /
            buyPrice
          ) * 100
        : 0;

    const maxLossRate =
      buyPrice > 0
        ? (
            (lowestPrice - buyPrice) /
            buyPrice
          ) * 100
        : 0;

    const holdingMinutes =
      Number(holding.buyTime || 0) > 0
        ? (
            Date.now() -
            Number(holding.buyTime)
          ) / 60000
        : 0;

    const holdingScoreHistory =
      Array.isArray(holding.holdingScoreHistory)
        ? holding.holdingScoreHistory
        : [];

const sellTypeText =
  String(sellType || "");

const finalProfitRate =
  Number(result.profitRate || 0);

/*
 * 정식 손절 또는 보유추세 붕괴 매도
 *
 * STOP_LOSS:
 * 일반 손절선 도달
 *
 * WEAK_TREND_SELL:
 * 손절선 도달 전이라도 보유점수·당일위치·수익률이
 * 동시에 무너져 조기 청산한 경우
 */
const isStopLoss =
  sellTypeText.includes("STOP_LOSS") ||
  sellTypeText.includes("WEAK_TREND_SELL");

/*
 * 실제 매도 결과가 손실인지 구분
 *
 * 손절 사유가 아니더라도 음수 수익률로 매도됐다면
 * 손실 매도로 분류한다.
 */
const isLossExit =
  finalProfitRate < 0;

const sellAnalysis = {
  sellType: sellTypeText,
  isStopLoss,
  isLossExit,
  sellHoldingScore:
    holding.holdingScore,

  sellHoldingScoreDiff:
    holding.holdingScoreDiff,

  discoveredAt:
    holding.candidateFirstSeenAt ?? null,

      discoveredAtText:
        holding.candidateFirstSeenAtText ?? null,
      buyTime: Number(holding.buyTime || 0),
      buyTimeText:
        holding.buyTimeText || null,
      sellTime: Date.now(),
      sellTimeText: nowText(),
      holdingMinutes: Number(
        holdingMinutes.toFixed(2)
      ),

      discoverScore: Number(
        holding.discoverScore || 0
      ),
      finalBuyScore: Number(
        holding.finalBuyScore || 0
      ),
      candidateWatchScore: Number(
        holding.candidateWatchScore || 0
      ),
      candidateStrengthScore: Number(
        holding.candidateStrengthScore || 0
      ),
      marketScore: Number(
        holding.marketScore || 0
      ),
      sectorPowerScore: Number(
        holding.sectorPowerScore || 0
      ),
      leaderStrengthScore: Number(
        holding.leaderStrengthScore || 0
      ),

      buyChangeRate: Number(
        holding.buyChangeRate || 0
      ),
      buyTradeVolumeRatio: Number(
        holding.buyTradeVolumeRatio || 0
      ),
      buyDayPositionRate: Number(
        holding.buyDayPositionRate || 0
      ),
      buyOpenPositionRate: Number(
        holding.buyOpenPositionRate || 0
      ),

      highestPrice,
      lowestPrice,
      highestProfitRate: Number(
        maxProfitRate.toFixed(3)
      ),
      lowestProfitRate: Number(
        maxLossRate.toFixed(3)
      ),
      finalProfitRate: Number(
        result.profitRate || 0
      ),
      finalProfit: Number(
        result.profit || 0
      ),

      holdingScore: Number(
        holding.holdingScore || 0
      ),
      holdingScoreDiff: Number(
        holding.holdingScoreDiff || 0
      ),
      currentTradeVolumeRatio: Number(
        holding.currentTradeVolumeRatio || 0
      ),
      currentDayPositionRate: Number(
        holding.currentDayPositionRate || 0
      ),
      currentChangeRate: Number(
        holding.currentChangeRate || 0
      ),
      holdingScoreUpdatedAt:
        holding.holdingScoreUpdatedAt ?? null,
      holdingScoreUpdatedAtText:
        holding.holdingScoreUpdatedAtText ?? null,

      scoreHistoryCount:
        holdingScoreHistory.length,
      holdingScoreHistory,

      sellSignalAt,
      sellSignalPrice,
      sellOrderRequestedAt,
      reason
    };

    state.tradeLogs.push({
      date: todayKey(),
      time: nowText(),
      type: sellType,

      code: holding.code,
      name: holding.name,
      strategyGroup:
        holding.strategyGroup,

      buyPrice,
      sellPrice,
      price: sellPrice,
      qty,

      profit:
        Number(result.profit || 0),

      profitRate:
        Number(result.profitRate || 0),

      highestPrice,
      lowestPrice,
      maxProfitRate,
      maxLossRate,
      holdingMinutes,

      discoverScore: Number(
        holding.discoverScore || 0
      ),

      finalBuyScore: Number(
        holding.finalBuyScore || 0
      ),

      finalBuyScoreDetail:
        holding.finalBuyScoreDetail ??
        holding.candidateWatchScoreDetail ??
        null,

      marketScore: Number(
        holding.marketScore || 0
      ),

      marketTemperature:
        holding.marketTemperature ||
        null,

      sectorPowerScore: Number(
        holding.sectorPowerScore || 0
      ),

      leaderStrengthScore: Number(
        holding.leaderStrengthScore || 0
      ),

      candidateStrengthScore: Number(
        holding.candidateStrengthScore || 0
      ),

      candidateWatchScore: Number(
        holding.candidateWatchScore || 0
      ),

      candidateWatchScoreDetail:
        holding.candidateWatchScoreDetail ??
        holding.finalBuyScoreDetail ??
        null,

      candidateFirstSeenAt:
        holding.candidateFirstSeenAt ??
        null,

      candidateFirstSeenAtText:
        holding.candidateFirstSeenAtText ??
        null,

      candidateLastSeenAt:
        holding.candidateLastSeenAt ??
        null,

      candidateLastSeenAtText:
        holding.candidateLastSeenAtText ??
        null,

      candidateFirstPrice: Number(
        holding.candidateFirstPrice || 0
      ),

      buyChangeRate: Number(
        holding.buyChangeRate || 0
      ),

      buyTradeVolumeRatio: Number(
        holding.buyTradeVolumeRatio || 0
      ),

      buyDayPositionRate: Number(
        holding.buyDayPositionRate || 0
      ),

      buyOpenPositionRate: Number(
        holding.buyOpenPositionRate || 0
      ),

      candidateStrengthLabel:
        holding.candidateStrengthLabel ||
        "-",

      candidateBaseScore: Number(
        holding.candidateBaseScore || 0
      ),

      candidateTrendPenalty: Number(
        holding.candidateTrendPenalty || 0
      ),

      buyPriceDiffRate: Number(
        holding.buyPriceDiffRate || 0
      ),

      buyVolumeDiff: Number(
        holding.buyVolumeDiff || 0
      ),

      buyDayPositionDiff: Number(
        holding.buyDayPositionDiff || 0
      ),

      sellSignalAt,
      sellSignalPrice,
      sellOrderRequestedAt,
      sellExecutedAt: nowText(),

      sellSlippageRate:
        sellSignalPrice > 0
          ? Number(
              (
                (
                  Number(sellPrice || 0) -
                  sellSignalPrice
                ) /
                sellSignalPrice *
                100
              ).toFixed(3)
            )
          : 0,

      reason,

      // 장 종료 후 손절·익절 품질 분석에서 사용한다.
      sellAnalysis
    });

    state.lastSellAt = nowText();
    state.lastSellCode = holding.code;
    state.lastSellName = holding.name;
    state.lastSellType = sellType;
    state.lastSellReason = reason;

    saveState(state);

    return true;
  } finally {
    state.pendingSellCodes =
      state.pendingSellCodes.filter(
        key => key !== sellKey
      );

    saveState(state);
  }
}


function cleanupStaleManualSellFiles() {
  const now = Date.now();

  for (const [dir, suffixes] of [
    [MANUAL_SELL_REQUEST_DIR, [".json", ".json.processing"]],
    [MANUAL_SELL_RESULT_DIR, [".json"]]
  ]) {
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch (_) {
      continue;
    }

    for (const name of names) {
      if (!suffixes.some(suffix => name.endsWith(suffix))) continue;
      const filePath = path.join(dir, name);
      try {
        const stat = fs.statSync(filePath);
        if (now - stat.mtimeMs > MANUAL_SELL_REQUEST_TTL_MS) {
          fs.unlinkSync(filePath);
          console.log(`[수동매도 오래된 파일 정리] ${name}`);
        }
      } catch (_) {}
    }
  }
}

function clearStaleManualSellLock(state, code) {
  if (!Array.isArray(state.pendingSellCodes)) {
    state.pendingSellCodes = [];
    return false;
  }

  const before = state.pendingSellCodes.length;
  state.pendingSellCodes = state.pendingSellCodes.filter(key => {
    const text = String(key || "");
    return !(
      text.startsWith(`${code}_`) &&
      text.includes("MANUAL_SELL")
    );
  });

  return state.pendingSellCodes.length !== before;
}

function writeManualSellResult(requestId, payload) {
  const resultPath = path.join(
    MANUAL_SELL_RESULT_DIR,
    `${requestId}.json`
  );
  writeJsonFileAtomic(resultPath, {
    requestId,
    completedAt: nowText(),
    completedAtMs: Date.now(),
    ...payload
  });
}

async function processManualSellRequests() {
  cleanupStaleManualSellFiles();

  let files = [];
  try {
    files = fs.readdirSync(MANUAL_SELL_REQUEST_DIR)
      .filter(name => name.endsWith('.json'))
      .sort();
  } catch (err) {
    console.error('[수동매도 요청목록 오류]', err.message);
    return;
  }

  for (const fileName of files.slice(0, 10)) {
    const requestPath = path.join(MANUAL_SELL_REQUEST_DIR, fileName);
    const processingPath = `${requestPath}.processing`;
    let request = null;

    try {
      // rename에 성공한 CORE 프로세스만 해당 요청을 처리한다.
      fs.renameSync(requestPath, processingPath);
      request = readJsonFileSafe(processingPath, null);

      const requestId = String(request?.requestId || fileName.replace(/\.json$/, ''));
      const code = String(request?.code || '')
        .replace(/^A/, '')
        .trim()
        .padStart(6, '0');

      if (!code || code === '000000') {
        writeManualSellResult(requestId, {
          ok: false,
          status: 400,
          message: '매도할 종목코드가 없습니다.'
        });
        continue;
      }

      const state = loadState();
      const holding = (state.holdings || []).find(row =>
        String(row.code || '').replace(/^A/, '').padStart(6, '0') === code
      );

      if (!holding || Number(holding.qty || 0) <= 0) {
        writeManualSellResult(requestId, {
          ok: false,
          status: 404,
          message: '매도 가능한 보유종목이 없습니다.'
        });
        continue;
      }

      const sellPrice = await fetchPrice(code);
      if (!sellPrice) {
        throw new Error('현재가를 확인할 수 없어 매도하지 않았습니다.');
      }

      // 현재가 조회 중 자동매도가 발생했는지 최신 상태에서 재확인한다.
      const latestState = loadState();
      const latestHolding = (latestState.holdings || []).find(row =>
        String(row.code || '').replace(/^A/, '').padStart(6, '0') === code
      );

      if (!latestHolding || Number(latestHolding.qty || 0) <= 0) {
        writeManualSellResult(requestId, {
          ok: false,
          status: 409,
          message: '현재가 조회 중 이미 매도된 종목입니다.'
        });
        continue;
      }

      const qty = Number(latestHolding.qty || 0);
      const buyPrice = Number(latestHolding.buyPrice || 0);
      const strategyGroup = String(latestHolding.strategyGroup || 'CORE').toUpperCase();
      const sellType = `${strategyGroup}_MANUAL_SELL`;
      const reason = '대시보드 수동 현재가 전량매도';

      // 이전 비정상 종료로 남은 수동매도 잠금만 제거한다.
      // 자동매도 잠금은 건드리지 않아 실제 중복매도는 계속 차단한다.
      if (clearStaleManualSellLock(latestState, code)) {
        saveState(latestState);
        console.log(`[수동매도 오래된 잠금 정리] ${latestHolding.name}(${code})`);
      }

      const sold = await paperSell(
        latestState,
        latestHolding,
        sellPrice,
        qty,
        sellType,
        reason,
        {
          signalAt: nowText(),
          signalPrice: sellPrice,
          manualSell: true,
          manualRequestId: requestId
        }
      );

      if (!sold) {
        writeManualSellResult(requestId, {
          ok: false,
          status: 409,
          message: '동일 종목 매도 요청이 이미 진행 중입니다.'
        });
        continue;
      }

      const profit = Math.floor((sellPrice - buyPrice) * qty);
      const profitRate = buyPrice > 0
        ? ((sellPrice - buyPrice) / buyPrice) * 100
        : 0;
      const completedState = loadState();

      console.log(
        `[수동매도 완료] ${latestHolding.name}(${code}) / ` +
        `${sellPrice.toLocaleString()}원 / ${qty.toLocaleString()}주 / ` +
        `손익 ${profit.toLocaleString()}원 (${profitRate.toFixed(2)}%) / ` +
        `요청 ${requestId}`
      );

      writeManualSellResult(requestId, {
        ok: true,
        status: 200,
        message: '현재가 전량매도 완료',
        code,
        name: latestHolding.name,
        strategyGroup,
        sellType,
        sellPrice,
        qty,
        profit,
        profitRate,
        totalCash: Number(completedState.totalCash || 0)
      });
    } catch (err) {
      const requestId = String(
        request?.requestId || fileName.replace(/\.json$/, '')
      );
      console.error('[수동매도 처리 오류]', requestId, err?.stack || err?.message || err);
      writeManualSellResult(requestId, {
        ok: false,
        status: 500,
        message: err?.message || '수동 매도 처리 중 오류가 발생했습니다.'
      });
    } finally {
      if (fs.existsSync(processingPath)) {
        try { fs.unlinkSync(processingPath); } catch (_) {}
      }
    }
  }
}


function getSellSignal(holding, price) {
  const buyPrice = Number(
    holding.buyPrice || 0
  );

  if (!buyPrice || !price) {
    return null;
  }

  const profitRate =
    ((price - buyPrice) / buyPrice) * 100;

  const isCore =
    holding.strategyGroup === "CORE";

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

  holding.highestPrice = Math.max(
    Number(
      holding.highestPrice ||
      buyPrice ||
      price
    ),
    price
  );

  holding.lowestPrice = Math.min(
    Number(
      holding.lowestPrice ||
      buyPrice ||
      price
    ),
    price
  );

  const highestProfitRate =
    (
      (
        holding.highestPrice -
        buyPrice
      ) /
      buyPrice
    ) * 100;

  const drawdownFromHigh =
    holding.highestPrice > 0
      ? (
          (
            price -
            holding.highestPrice
          ) /
          holding.highestPrice
        ) * 100
      : 0;

  /*
   * 1. 손절
   *
   * 손절은 최소 보유시간과 관계없이 즉시 판단한다.
   * 매수 직후 급락해도 3분 동안 기다리지 않는다.
   */
  if (profitRate <= stopLossRate) {
    return {
      type:
        `${holding.strategyGroup}_STOP_LOSS`,

      qty:
        Number(holding.qty || 0),

      reason:
        `손절 ${profitRate.toFixed(2)}% / ` +
        `기준 ${stopLossRate.toFixed(2)}%`,

      signalAt: nowText(),
      signalPrice: Number(price),
      signalProfitRate: Number(
        profitRate.toFixed(2)
      ),
      signalStopLossRate: Number(
        stopLossRate.toFixed(2)
      )
    };
  }

  /*
   * 손절 외의 익절·본전방어·트레일링은
   * 최소 보유시간을 지난 후부터 판단한다.
   */
  const buyTime =
    Number(holding.buyTime || 0);

  const holdMinutes =
    buyTime > 0
      ? (Date.now() - buyTime) / 60000
      : 999;

  if (
    holdMinutes <
    settings.minHoldMinutes
  ) {
    return null;
  }

  /*
 * 2. 보유추세 붕괴 조기매도
 *
 * 일반 손절선까지 기다리지 않고,
 * 보유점수·당일위치·수익률이 동시에 무너진 경우에만 청산한다.
 */
const holdingScore =
  Number(holding.holdingScore || 0);

const holdingScoreDiff =
  Number(holding.holdingScoreDiff || 0);

const currentDayPosition =
  Number(holding.currentDayPositionRate || 0);

if (
  settings.holdingWeakSellEnabled &&
  holdMinutes >=
    settings.holdingWeakSellMinHoldMinutes &&
  holdingScore <=
    settings.holdingWeakSellMaxScore &&
  holdingScoreDiff <=
    settings.holdingWeakSellMinScoreDrop &&
  profitRate <=
    settings.holdingWeakSellMaxProfitRate &&
  currentDayPosition <=
    settings.holdingWeakSellMaxDayPositionRate
) {
  return {
    type:
      `${holding.strategyGroup}_WEAK_TREND_SELL`,

    qty:
      Number(holding.qty || 0),

    reason:
      `보유추세 붕괴 / ` +
      `수익 ${profitRate.toFixed(2)}% / ` +
      `보유점수 ${holdingScore.toFixed(1)}점 / ` +
      `점수변화 ${holdingScoreDiff.toFixed(1)}점 / ` +
      `당일위치 ${currentDayPosition.toFixed(1)}%`
  };
}

  // 2. 1차 익절
  if (
    !holding.firstTakeProfitDone &&
    profitRate >= firstTakeProfitRate
  ) {
    const currentQty =
      Number(holding.qty || 0);

    const sellQty =
      Math.min(
        currentQty,
        Math.max(
          1,
          Math.floor(
            currentQty *
            settings.firstTakeProfitSellRatio
          )
        )
      );

    /*
     * 실제 매도 성공 전에 여기서 true로 바꾸면,
     * 매도 API 실패 시에도 익절 완료로 남을 수 있다.
     *
     * 가능하면 paperSell 성공 이후에
     * firstTakeProfitDone을 저장하는 것이 더 안전하다.
     */
    holding.firstTakeProfitDone = true;

    return {
      type:
        `${holding.strategyGroup}_FIRST_TAKE_PROFIT`,

      qty:
        sellQty,

      reason:
        `1차 익절 ${profitRate.toFixed(2)}% / ` +
        `기준 ${firstTakeProfitRate.toFixed(2)}%`
    };
  }

  // 3. 본전 방어
  if (
    highestProfitRate >=
      settings.breakEvenStartRate &&
    profitRate <=
      settings.breakEvenProtectRate
  ) {
    return {
      type:
        `${holding.strategyGroup}_BREAK_EVEN_SELL`,

      qty:
        Number(holding.qty || 0),

      reason:
        `본전방어 / ` +
        `최고수익 ${highestProfitRate.toFixed(2)}% / ` +
        `현재수익 ${profitRate.toFixed(2)}% / ` +
        `방어기준 ${settings.breakEvenProtectRate.toFixed(2)}%`
    };
  }

  // 4. 트레일링 스탑
  if (
    highestProfitRate >=
      trailingStartRate &&
    drawdownFromHigh <=
      -Math.abs(trailingStopRate)
  ) {
    return {
      type:
        `${holding.strategyGroup}_TRAILING_STOP`,

      qty:
        Number(holding.qty || 0),

      reason:
        `트레일링 / ` +
        `최고수익 ${highestProfitRate.toFixed(2)}% / ` +
        `고점대비 ${drawdownFromHigh.toFixed(2)}% / ` +
        `시작기준 ${trailingStartRate.toFixed(2)}% / ` +
        `이탈기준 ${trailingStopRate.toFixed(2)}%`
    };
  }

  // 5. 장마감 청산
  const hhmm =
    new Date().toLocaleTimeString(
      "ko-KR",
      {
        timeZone: "Asia/Seoul",
        hour12: false,
        hour: "2-digit",
        minute: "2-digit"
      }
    );

  if (hhmm >= settings.endSellTime) {
    const endSellOnlyPositive = isCore
      ? settings.coreEndSellOnlyPositive
      : settings.volumeEndSellOnlyPositive;

    if (
      !endSellOnlyPositive ||
      profitRate > 0
    ) {
      return {
        type:
          `${holding.strategyGroup}_END_SELL`,

        qty:
          Number(holding.qty || 0),

        reason:
          `장마감 청산 ${profitRate.toFixed(2)}% / ` +
          `수익만청산 ${
            endSellOnlyPositive
              ? "Y"
              : "N"
          }`
      };
    }
  }

  return null;
}

function makeSwitchSellSignal(
  holding,
  candidate,
  switchResult
) {
  return {
    type:
      `${holding.strategyGroup}_SWITCH_SELL`,

    qty:
      Number(holding.qty || 0),

    reason:
      `우수후보 교체 / ` +
      `${holding.name} ` +
      `${switchResult.holdingScore.toFixed(1)}점 → ` +
      `${candidate.name || candidate.code} ` +
      `${switchResult.candidateScore.toFixed(1)}점 / ` +
      `차이 ${switchResult.scoreGap.toFixed(1)}점`
  };
}


async function runCandidateWatchOnce() {
  if (!isKoreanWeekday()) {
    return;
  }

  const hhmm = getCurrentHHMM();

  const coreBuyTime =
    settings.coreEnabled &&
    hhmm >= settings.coreStartTime &&
    hhmm <= settings.coreEndTime;

  const volumeBuyTime =
    settings.volumeEnabled &&
    hhmm >= settings.volumeStartTime &&
    hhmm <= settings.volumeEndTime;

  if (!coreBuyTime && !volumeBuyTime) {
    return;
  }

  const state = loadState();
  const openPriorityBuyBlocked =
    isOpenPriorityBuyBlocked(state);

  if (openPriorityBuyBlocked) {
    console.log(
      `[후보재평가 보류] ${getOpenPriorityBlockReason(state)} / ` +
      `OPEN API 우선사용`
    );
    return;
  }

  initDailyRiskIfNeeded(state);
  cleanupCandidateHistory(state);
  cleanupCandidateWatchLists(state);

  if (!state.serverAutoEnabled) {
    return;
  }

  const risk = checkDailyLossLimit(state);

  if (risk.stopped) {
    console.log(
      `[후보재평가 중단] ${risk.reason}`
    );
    saveState(state);
    return;
  }

  const watchTargets = [];

  if (coreBuyTime) {
    for (const candidate of state.coreCandidateWatchList || []) {
      watchTargets.push({
        ...candidate,
        recheckStrategy: "CORE"
      });
    }
  }

  if (volumeBuyTime) {
    for (const candidate of state.volumeCandidateWatchList || []) {
      watchTargets.push({
        ...candidate,
        recheckStrategy: "VOLUME"
      });
    }
  }

  // 같은 종목·같은 전략 중복 제거
  const uniqueTargets = Array.from(
    new Map(
      watchTargets.map(candidate => [
        `${candidate.recheckStrategy}_${candidate.code}`,
        candidate
      ])
    ).values()
  );

  if (!uniqueTargets.length) {
    return;
  }

  console.log(
    `[후보재평가] 시작 / 대상 ${uniqueTargets.length}개`
  );

  for (const candidate of uniqueTargets) {
    const strategyGroup = candidate.recheckStrategy;

    if (
      isAlreadyHolding(state, candidate.code) ||
      wasBoughtToday(state, candidate.code)
    ) {
      removeCandidateFromWatchLists(
        state,
        candidate.code
      );
      continue;
    }

    let realtimeItem;

    try {
      realtimeItem = await fetchCandidateRealtime(
        candidate.code,
        {
          ...(candidate.itemSnapshot || {}),
          name: candidate.name,
          currentPrice: candidate.currentPrice,
          discoverScore: candidate.discoverScore,
          changeRate: candidate.changeRate,
          volumeRatio: candidate.volumeRatio,
          tradeVolumeRatio: candidate.volumeRatio
        }
      );
    } catch (err) {
      console.log(
        `[후보재평가 실패] ${candidate.name} / ` +
        `${err.message}`
      );
      continue;
    }

    const item = buildWatchCandidateItem(
  candidate,
  realtimeItem
);

const price = Math.abs(Number(
  item.currentPrice ||
  item.price ||
  0
));

if (!price) {
  continue;
}

item.watchBaseline = {
  firstPrice: Number(
    candidate.firstPrice || 0
  ),

  firstVolumeRatio: Number(
    candidate.firstVolumeRatio || 0
  ),

  firstDayPosition: Number(
    candidate.firstDayPosition || 0
  )
};

const latestWatchScoreDetail =
  calculateCandidateWatchScore(
    item,
    price,
    strategyGroup
  );

const firstWatchScore =
  Number(candidate.watchScore || 0);

const latestWatchScore =
  Number(latestWatchScoreDetail.total || 0);

const watchScoreDiff =
  latestWatchScore - firstWatchScore;

item.watchScore =
  latestWatchScore;

item.watchScoreDetail =
  latestWatchScoreDetail;

updateCandidateWatchList(
  state,
  item,
  price,
  strategyGroup
);

    const priceDiffRate =
      Number(candidate.firstPrice || 0) > 0
        ? (
            (price - Number(candidate.firstPrice)) /
            Number(candidate.firstPrice)
          ) * 100
        : 0;

    const volumeRatio =
      getTradeVolumeRatio(item);

    const volumeDiff =
      volumeRatio -
      Number(candidate.firstVolumeRatio || 0);

    const dayPosition =
      getDayPositionRate(item, price);

    const dayPositionDiff =
      dayPosition -
      Number(candidate.firstDayPosition || 0);

    const discoverScoreDiff =
      Number(item.discoverScore || 0) -
      Number(candidate.firstDiscoverScore || 0);

    console.log(
      `[후보재평가] ${candidate.name} / ${strategyGroup} / ` +
      `가격 ${Number(candidate.firstPrice || 0).toLocaleString()}→` +
      `${price.toLocaleString()}원 ` +
      `(${priceDiffRate >= 0 ? "+" : ""}${priceDiffRate.toFixed(2)}%) / ` +
      `강화점수 ${firstWatchScore.toFixed(1)}→` +
      `${latestWatchScore.toFixed(1)} ` +
      `(${watchScoreDiff >= 0 ? "+" : ""}${watchScoreDiff.toFixed(1)}) / ` +
      `발견점수 ${Number(candidate.firstDiscoverScore || 0).toFixed(1)}→` +
      `${Number(item.discoverScore || 0).toFixed(1)} ` +
      `(${discoverScoreDiff >= 0 ? "+" : ""}${discoverScoreDiff.toFixed(1)}) / ` +
      `거래량 ${Number(candidate.firstVolumeRatio || 0).toFixed(1)}→` +
      `${volumeRatio.toFixed(1)}% ` +
      `(${volumeDiff >= 0 ? "+" : ""}${volumeDiff.toFixed(1)}%p) / ` +
      `위치 ${Number(candidate.firstDayPosition || 0).toFixed(1)}→` +
      `${dayPosition.toFixed(1)}% ` +
      `(${dayPositionDiff >= 0 ? "+" : ""}${dayPositionDiff.toFixed(1)}%p)`
    );

    console.log(
      `[후보재평가 점수상세] ${candidate.name} / ${strategyGroup} / ` +
      `발견 ${Number(latestWatchScoreDetail.discoverPart || 0).toFixed(1)} / ` +
      `거래량 ${Number(latestWatchScoreDetail.volumePart || 0).toFixed(1)} / ` +
      `위치 ${Number(latestWatchScoreDetail.dayPositionPart || 0).toFixed(1)} / ` +
      `상승률 ${Number(latestWatchScoreDetail.changeRatePart || 0).toFixed(1)}`
    );

    const judged = strategyGroup === "CORE"
      ? judgeCoreBuy(state, item, price)
      : judgeVolumeBuy(state, item, price);

      if (
  !openPriorityBuyBlocked &&
  !judged.pass &&
  judged.switchResult?.allowed &&
  settings.switchEnabled
) {
  const switched =
    await executeSwitch(
      state,
      item,
      price,
      strategyGroup,
      judged.switchResult
    );

  if (switched) {
  console.log(
    "[후보재평가] 스위칭 완료 / 이번 재평가 종료"
  );
  return;
}

  continue;
}

      recordBuyDecision(
  state,
  strategyGroup,
  judged,
  "WATCH",
  item,
  price
);

if (!judged.pass) {
  updateOperationalBlockedCandidate(
    state,
    item,
    price,
    strategyGroup,
    judged
  );
}

    if (!judged.pass) {
      updateCandidateNearMissList(
        state,
        candidate,
        item,
        price,
        strategyGroup,
        judged,
        {
          firstWatchScore,
          latestWatchScore,
          watchScoreDiff,
          priceDiffRate,
          volumeDiff,
          dayPositionDiff
        }
      );

      const nearMiss =
        calculateCandidateNearMiss(
          item,
          price,
          strategyGroup,
          judged
        );

      console.log(
        `[후보재평가 제외] ${candidate.name} / ` +
        `${strategyGroup} / ${judged.reason} / ` +
        `매수가능성 ${nearMiss.possibilityScore.toFixed(1)}점 / ` +
        `${nearMiss.primaryGap}`
      );

      await sleep(settings.candidateWatchPriceDelayMs);
      continue;
    }

    console.log(
      `[후보재평가 통과] ${candidate.name} / ` +
      `${strategyGroup} / ${judged.reason}`
    );

    if (openPriorityBuyBlocked) {
      console.log(
        `[후보재평가 매수보류] ${candidate.name} / ` +
        `${strategyGroup} / ${getOpenPriorityBlockReason(state)}`
      );
      await sleep(settings.candidateWatchPriceDelayMs);
      continue;
    }

    const bought = await paperBuy(
      state,
      item,
      price,
      strategyGroup,
      `후보 재평가 통과 / ${judged.reason}`
    );

    if (bought) {
      removeCandidateFromWatchLists(
        state,
        candidate.code
      );

      saveState(state);
      break;
    }

    await sleep(settings.candidateWatchPriceDelayMs);
  }

  state.lastCandidateWatchCheckAt = nowText();

logBuyDecisionSummary(state);
logCandidateNearMissSummary(state);

saveState(state);

console.log("[후보재평가] 종료");
}

async function runBuyOnce() {
  const buyStartedAt = Date.now();

  if (!isKoreanWeekday()) {
    return;
  }

  const hhmm = getCurrentHHMM();

  const coreBuyTime =
    settings.coreEnabled &&
    hhmm >= settings.coreStartTime &&
    hhmm <= settings.coreEndTime;

  const volumeBuyTime =
    settings.volumeEnabled &&
    hhmm >= settings.volumeStartTime &&
    hhmm <= settings.volumeEndTime;

  // CORE와 VOLUME 매수시간이 모두 아니면 후보조회 없이 종료
  if (!coreBuyTime && !volumeBuyTime) {
    return;
  }

  console.log("[BUY] 1회 점검 시작");

  const state = loadState();
  const openPriorityBuyBlocked =
    isOpenPriorityBuyBlocked(state);

  if (openPriorityBuyBlocked) {
    console.log(
      `[BUY 점검보류] ${getOpenPriorityBlockReason(state)} / ` +
      `OPEN API 우선사용을 위해 CORE/VOLUME 후보검색도 생략`
    );
    return;
  }

  if (!state.serverAutoEnabled) {
    console.log("[BUY] 서버 자동매매 OFF");
    return;
  }

  const risk = checkDailyLossLimit(state);

  if (risk.stopped) {
    console.log(`[BUY] 신규매수 중단 / ${risk.reason}`);
    saveState(state);
    return;
  }

  cleanupCandidateHistory(state);
  cleanupCandidateWatchLists(state);

console.log("[BUY] 후보 조회 시작");

/*
 * 1. 기존 순차검색 후보
 */
let discoverResult;

try {
  discoverResult = await discoverCandidates(
    state,
    "CORE_VOLUME"
  );
} catch (err) {
  console.error(
    `[BUY 후보조회 실패] ${err?.message || err} / ` +
    `이번 BUY 점검만 건너뜀`
  );
  return;
}

const discoveredCandidates =
  discoverResult.candidates || [];

const marketRows =
  discoverResult.marketRows || [];
/*
 * 2. HOT Scanner가 찾은 후보
 */
const hotCandidates =
  loadHotCandidates();

/*
 * 3. 종목코드 기준 중복 제거 및 병합
 */
const mergedCandidates =
  mergeBuyCandidates(
    hotCandidates,
    discoveredCandidates
  );

/*
 * 신규 전체검색 자체를 40~50종목 단위로 나누므로,
 * 이번 회차에서 조회된 후보는 HOT 후보까지 포함해 모두 평가한다.
 * 가능성 기준으로 종목을 사전 탈락시키지 않고 offset 순환으로 전 종목을 확인한다.
 */
const candidates = mergedCandidates.slice(
  0,
  Math.max(10, Number(settings.buyCandidateEvalMaxCount || 60))
);

console.log(
  `[BUY] 후보 조회 완료 / ` +
  `HOT ${hotCandidates.length}개 / ` +
  `전체검색 ${discoveredCandidates.length}개 / ` +
  `병합후 ${mergedCandidates.length}개 / ` +
  `이번평가 ${candidates.length}개`
);

if (hotCandidates.length > 0) {
  console.log(
    `[HOT 후보] ` +
    hotCandidates
      .slice(0, 10)
      .map(item =>
        `${item.name || item.code}` +
        `(${Number(
          item.changeRate || 0
        ).toFixed(2)}%/` +
        `${Number(
          item.hotScore || 0
        ).toFixed(1)}점)`
      )
      .join(", ")
  );
}

const marketTemperature =
  calculateMarketTemperature(
    marketRows
  );

state.marketTemperature =
  marketTemperature;

console.log(
  `[시장온도] ${marketTemperature.label} / ` +
  `${marketTemperature.score.toFixed(1)}점 / ` +
  `상승 ${marketTemperature.advanceRatio.toFixed(1)}% / ` +
  `하락 ${marketTemperature.declineRatio.toFixed(1)}% / ` +
  `평균등락 ${marketTemperature.averageChangeRate.toFixed(2)}% / ` +
  `거래량통과 ${marketTemperature.volumePassRatio.toFixed(1)}% / ` +
  `세부 확산 ${Number(
    marketTemperature.breadthScore || 0
  ).toFixed(1)}·` +
  `등락 ${Number(
    marketTemperature.changeScore || 0
  ).toFixed(1)}·` +
  `거래량 ${Number(
    marketTemperature.volumeScore || 0
  ).toFixed(1)} / ` +
  `대상 ${marketTemperature.total}개`
);

  console.log(
    `[BUY] 현재 보유 OPEN ${getHoldingCount(state, "OPEN")}개 / ` +
    `CORE ${getHoldingCount(state, "CORE")}개 / ` +
    `VOLUME ${getHoldingCount(state, "VOLUME")}개 / ` +
    `현금 ${Number(state.totalCash || 0).toLocaleString()}원`
  );

  let excludeLogCount = 0;
  const maxExcludeLogCount = 8;

  for (const item of candidates) {
    const price = Math.abs(
      Number(
        item.currentPrice ||
        item.price ||
        item.raw?.cur_prc ||
        0
      )
    );

    const name =
      item.name ||
      item.stockName ||
      item.korName ||
      item.code;

      const candidateSource =
  item.candidateSource || "DISCOVER";

if (candidateSource === "HOT") {
  console.log(
    `[HOT 즉시평가] ${name}(${item.code}) / ` +
    `상승률 ${Number(
      item.changeRate || 0
    ).toFixed(2)}% / ` +
    `거래량비율 ${getTradeVolumeRatio(
      item
    ).toFixed(1)}% / ` +
    `HOT점수 ${Number(
      item.hotScore || 0
    ).toFixed(1)}`
  );
}

    if (!price) {
      if (excludeLogCount < maxExcludeLogCount) {
        console.log(
          `[후보제외] ${name} / 현재가 없음`
        );
        excludeLogCount++;
      }

      continue;
    }

    // 보유중이거나 오늘 이미 매수한 종목은 후보목록에 넣지 않음
    

  if (
  !isAlreadyHolding(state, item.code) &&
  !wasBoughtToday(state, item.code)
) {
  // CORE 기본조건을 만족한 종목만
  // CORE 후보 강화 목록에 등록
  if (
    coreBuyTime &&
    isBasicCoreCandidate(
      item,
      price
    )
  ) {
    updateCandidateWatchList(
      state,
      item,
      price,
      "CORE"
    );
  }

  // VOLUME 기본조건을 만족한 종목만
  // VOLUME 후보 강화 목록에 등록
  if (
    volumeBuyTime &&
    isBasicVolumeCandidate(
      item,
      price
    )
  ) {
    updateCandidateWatchList(
      state,
      item,
      price,
      "VOLUME"
    );
  }
}

    // CORE 매수 판단
    if (coreBuyTime) {
      const coreJudge = judgeCoreBuy(
        state,
        item,
        price
      );

      if (
  !openPriorityBuyBlocked &&
  !coreJudge.pass &&
  coreJudge.switchResult?.allowed &&
  settings.switchEnabled
) {
  const switched =
    await executeSwitch(
      state,
      item,
      price,
      "CORE",
      coreJudge.switchResult
    );

 if (switched) {
  console.log(
    "[BUY] CORE 스위칭 완료 / 이번 매수점검 종료"
  );
  return;
}

continue;
}


recordBuyDecision(
  state,
  "CORE",
  coreJudge,
  item.candidateSource || "DISCOVER",
  item,
  price
);

if (!coreJudge.pass) {
  updateOperationalBlockedCandidate(
    state,
    item,
    price,
    "CORE",
    coreJudge
  );
}

      if (coreJudge.pass) {
        if (openPriorityBuyBlocked) {
          console.log(
            `[CORE 매수보류] ${name} / ` +
            `${getOpenPriorityBlockReason(state)}`
          );
          continue;
        }

        const bought = await paperBuy(
          state,
          item,
          price,
          "CORE",
          coreJudge.reason
        );

        if (bought) {
          break;
        }

        continue;
      }

      if (excludeLogCount < maxExcludeLogCount) {
        console.log(
          `[CORE 제외] ${name} / ${coreJudge.reason}`
        );
        excludeLogCount++;
      }
    }

    // VOLUME 매수 판단
    if (volumeBuyTime) {
  const volumeJudge = judgeVolumeBuy(
    state,
    item,
    price
  );

  if (
  !openPriorityBuyBlocked &&
  !volumeJudge.pass &&
  volumeJudge.switchResult?.allowed &&
  settings.switchEnabled
) {
  const switched =
    await executeSwitch(
      state,
      item,
      price,
      "VOLUME",
      volumeJudge.switchResult
    );

  if (switched) {
    console.log(
      "[BUY] VOLUME 스위칭 완료 / 이번 매수점검 종료"
    );
    return;
  }

  continue;
}

  recordBuyDecision(
  state,
  "VOLUME",
  volumeJudge,
  item.candidateSource || "DISCOVER",
  item,
  price
);

  if (!volumeJudge.pass) {
  updateOperationalBlockedCandidate(
    state,
    item,
    price,
    "VOLUME",
    volumeJudge
  );
}

      if (volumeJudge.pass) {
        if (openPriorityBuyBlocked) {
          console.log(
            `[VOLUME 매수보류] ${name} / ` +
            `${getOpenPriorityBlockReason(state)}`
          );
          continue;
        }

        const bought = await paperBuy(
          state,
          item,
          price,
          "VOLUME",
          volumeJudge.reason
        );

        if (bought) {
          break;
        }

        continue;
      }

      if (excludeLogCount < maxExcludeLogCount) {
        console.log(
          `[VOLUME 제외] ${name} / ${volumeJudge.reason}`
        );
        excludeLogCount++;
      }
    }
  }

  // 후보 전체 검사가 끝난 뒤 한 번만 출력
  console.log(
    `[후보 강화 목록] ` +
    `CORE ${state.coreCandidateWatchList.length}개 / ` +
    `VOLUME ${state.volumeCandidateWatchList.length}개`
  );

  const coreWatchNames =
    state.coreCandidateWatchList
      .map(
        candidate =>
          `${candidate.name}(` +
          `${Number(candidate.watchScore || 0).toFixed(1)}` +
          `)`
      )
      .join(", ");

  const volumeWatchNames =
    state.volumeCandidateWatchList
      .map(
        candidate =>
          `${candidate.name}(` +
          `${Number(candidate.watchScore || 0).toFixed(1)}` +
          `)`
      )
      .join(", ");

  console.log(
    `[CORE 후보목록] ${coreWatchNames || "없음"}`
  );

  console.log(
    `[VOLUME 후보목록] ${volumeWatchNames || "없음"}`
  );

  for (
  const candidate of
  (state.coreCandidateWatchList || []).slice(
    0,
    Number(settings.candidateScoreLogMaxCount || 5)
  )
) {
  console.log(
    `[CORE 후보점수] ` +
    makeCandidateWatchScoreLog(candidate)
  );
}

for (
  const candidate of
  (state.volumeCandidateWatchList || []).slice(
    0,
    Number(settings.candidateScoreLogMaxCount || 5)
  )
) {
  console.log(
    `[VOLUME 후보점수] ` +
    makeCandidateWatchScoreLog(candidate)
  );
}

 state.lastBuyCheckAt = nowText();

logBuyDecisionSummary(state);

saveState(state);

console.log(
  `[BUY] 1회 점검 종료 / 소요 ${((Date.now() - buyStartedAt) / 1000).toFixed(1)}초`
);
}

async function checkSellOnce() {
  if (!isKoreanWeekday()) return;
  if (!isBetweenTime("09:00", "15:20")) return;

  const state = loadState();

  if (!state.serverAutoEnabled) {
    console.log("[SELL] 서버 자동매매 OFF");
    return;
  }

  const coreVolumeHoldings = (state.holdings || []).filter(
    holding =>
      holding.strategyGroup === "CORE" ||
      holding.strategyGroup === "VOLUME"
  );

  // CORE/VOLUME 보유종목이 없으면 로그 없이 종료
  if (coreVolumeHoldings.length === 0) {
    return;
  }

  console.log("[SELL] 1회 점검 시작");
  console.log(
    `[SELL] CORE/VOLUME 보유종목 ${coreVolumeHoldings.length}개`
  );

  for (const holding of coreVolumeHoldings) {

   let price = 0;
let realtimeItem = null;

try {
  realtimeItem =
    await fetchCandidateRealtime(
      holding.code,
      {
        name: holding.name,

        currentPrice:
          holding.currentPrice ||
          holding.buyPrice,

        discoverScore:
          holding.discoverScore || 0,

        changeRate:
          holding.buyChangeRate || 0,

        tradeVolumeRatio:
          holding.buyTradeVolumeRatio || 0
      }
    );

  price = Number(
    realtimeItem.currentPrice || 0
  );
} catch (err) {
  console.log(
    `[SELL 가격조회 실패] ` +
    `${holding.name} / ${err.message}`
  );

  price = Number(
    holding.currentPrice ||
    holding.buyPrice ||
    0
  );
}
    

    if (!price) {
      console.log(`[SELL 제외] ${holding.name} / 현재가 없음`);
      continue;
    }

    holding.currentPrice = price;

/*
 * 실시간 상세정보가 있을 때
 * 보유 종목 점수를 다시 계산한다.
 */
if (realtimeItem) {
  const holdingAnalysis =
    calculateHoldingScore(
      holding,
      realtimeItem,
      price
    );

  const previousHoldingScore =
    Number(
      holding.holdingScore ??
      holdingAnalysis.buyScore ??
      0
    );

  holding.previousHoldingScore =
    previousHoldingScore;

  holding.holdingScore =
    holdingAnalysis.holdingScore;

  holding.holdingScoreDiff =
    holdingAnalysis.scoreDiff;

  holding.holdingScoreDetail =
    holdingAnalysis;

  holding.holdingScoreUpdatedAt =
    Date.now();

  holding.holdingScoreUpdatedAtText =
    nowText();

  holding.currentTradeVolumeRatio =
    holdingAnalysis.currentVolumeRatio;

  holding.currentDayPositionRate =
    holdingAnalysis.currentDayPosition;

  holding.currentChangeRate =
    Number(
      realtimeItem.changeRate || 0
    );

  // 30초 간격으로 보유점수 이력을 누적한다.
  if (!Array.isArray(holding.holdingScoreHistory)) {
    holding.holdingScoreHistory = [];
  }

  const historyNow = Date.now();
  const lastHistory =
    holding.holdingScoreHistory[
      holding.holdingScoreHistory.length - 1
    ];

  if (
    !lastHistory ||
    historyNow - Number(lastHistory.checkedAt || 0) >=
      settings.holdingScoreHistoryIntervalMs
  ) {
    holding.holdingScoreHistory.push({
      checkedAt: historyNow,
      checkedAtText: nowText(),
      price: Number(price),
      profitRate: Number(
        holdingAnalysis.profitRate || 0
      ),
      holdingScore: Number(
        holdingAnalysis.holdingScore || 0
      ),
      scoreDiff: Number(
        holdingAnalysis.scoreDiff || 0
      ),
      tradeVolumeRatio: Number(
        holdingAnalysis.currentVolumeRatio || 0
      ),
      dayPositionRate: Number(
        holdingAnalysis.currentDayPosition || 0
      ),
      changeRate: Number(
        realtimeItem.changeRate || 0
      ),
      bearishVolumePenalty: Number(
        holdingAnalysis.bearishVolumePenalty || 0
      )
    });

    holding.holdingScoreHistory =
      holding.holdingScoreHistory.slice(
        -settings.holdingScoreHistoryMaxCount
      );
  }

  console.log(
    `[보유점수] ${holding.name} / ` +
    `${holding.strategyGroup} / ` +
    `${previousHoldingScore.toFixed(1)}→` +
    `${holdingAnalysis.holdingScore.toFixed(1)}점 / ` +
    `매수점수 ${holdingAnalysis.buyScore.toFixed(1)} / ` +
    `수익 ${holdingAnalysis.profitRate.toFixed(2)}% / ` +
    `거래량 ${holdingAnalysis.buyVolumeRatio.toFixed(1)}→` +
    `${holdingAnalysis.currentVolumeRatio.toFixed(1)}% / ` +
    `위치 ${holdingAnalysis.buyDayPosition.toFixed(1)}→` +
    `${holdingAnalysis.currentDayPosition.toFixed(1)}%`
  );

  if (
    holdingAnalysis.bearishVolumePenalty < 0
  ) {
    console.log(
      `[보유추세 경고] ${holding.name} / ` +
      `${holding.strategyGroup} / ` +
      `거래량 증가 중 가격·위치 하락 / ` +
      `추가감점 ${holdingAnalysis.bearishVolumePenalty}점`
    );
  }
}

const signal =
  getSellSignal(holding, price);

    if (!signal) {
      const buyPrice = Number(holding.buyPrice || 0);

      const profitRate = buyPrice > 0
        ? ((price - buyPrice) / buyPrice) * 100
        : 0;

     console.log(
  `[SELL 유지] ${holding.name} / ` +
  `현재가 ${price.toLocaleString()}원 / ` +
  `${profitRate.toFixed(2)}% / ` +
  `보유점수 ${Number(
    holding.holdingScore || 0
  ).toFixed(1)}점`
);
      continue;
    }

    await paperSell(
      state,
      holding,
      price,
      signal.qty,
      signal.type,
      signal.reason,
      signal
    );
  }

  state.lastSellCheckAt = nowText();
  saveState(state);

  console.log("[SELL] 1회 점검 종료");
}

async function start() {
  console.log(
    "SY Quant CORE/VOLUME 자동매매 시작"
  );

  /*
   * HOT Scanner는 직접 매수하지 않고
   * 별도 후보 파일만 갱신한다.
   */
  startHotScanner();

  /*
   * 각 작업의 중복 실행을 막는다.
   * 매수 전체검색이 오래 걸리는 동안 다른 전체검색이
   * 겹치지 않도록 공통 busy 상태도 함께 확인한다.
   */
  let buyRunning = false;
  let candidateWatchRunning = false;
  let sellRunning = false;
  let sellPending = false;
  let lastSellPriorityCheckAt = 0;

  let buyTimer = null;
  let candidateWatchTimer = null;
  let sellTimer = null;

  function isTraderBusy() {
    return (
      buyRunning ||
      candidateWatchRunning ||
      sellRunning
    );
  }

  async function ensureSellPriorityBeforeLongTask(taskName) {
    /*
     * 매수 전체검색과 후보 재평가는 20초 이상 걸릴 수 있다.
     * 마지막 매도점검 시각과 관계없이 장시간 작업 직전에
     * 반드시 한 번 매도점검을 끝낸 뒤 다음 작업을 시작한다.
     */
    if (sellRunning) {
      return;
    }

    console.log(
      `[${taskName}] 시작 전 매도 우선 점검`
    );

    await runSellSafely();
  }

  async function runBuySafely() {
    if (isTraderBusy()) {
      console.log(
        "[BUY LOOP] 다른 작업 진행중 / 이번 점검 건너뜀"
      );
      return;
    }

    await ensureSellPriorityBeforeLongTask("BUY");

    if (isTraderBusy()) {
      console.log(
        "[BUY LOOP] 매도 우선 점검 진행중 / 이번 점검 건너뜀"
      );
      return;
    }

    buyRunning = true;

    try {
      await runBuyOnce();
    } catch (err) {
      console.error(
        "[BUY LOOP 오류]",
        err?.stack || err?.message || err
      );
    } finally {
      buyRunning = false;

      // BUY 중 건너뛴 매도 점검은 작업 종료 직후 우선 실행
      if (sellPending && !candidateWatchRunning && !sellRunning) {
        await runSellSafely();
      }
    }
  }

  async function runCandidateWatchSafely() {
    if (isTraderBusy()) {
      console.log(
        "[후보재평가 LOOP] 다른 작업 진행중 / 이번 점검 건너뜀"
      );
      return;
    }

    await ensureSellPriorityBeforeLongTask("후보재평가");

    if (isTraderBusy()) {
      console.log(
        "[후보재평가 LOOP] 매도 우선 점검 진행중 / 이번 점검 건너뜀"
      );
      return;
    }

    candidateWatchRunning = true;

    try {
      await runCandidateWatchOnce();
    } catch (err) {
      console.error(
        "[후보재평가 LOOP 오류]",
        err?.stack || err?.message || err
      );
    } finally {
      candidateWatchRunning = false;

      // 후보재평가 중 건너뛴 매도 점검은 종료 직후 우선 실행
      if (sellPending && !buyRunning && !sellRunning) {
        await runSellSafely();
      }
    }
  }

  async function runSellSafely() {
    /*
     * 매도 점검은 매수 전체검색보다 우선해야 하지만,
     * 같은 상태파일을 동시에 저장하지 않도록 겹침은 막는다.
     */
    if (isTraderBusy()) {
      sellPending = true;
      console.log(
        "[SELL LOOP] 다른 작업 진행중 / 종료 직후 우선 점검 예약"
      );
      return;
    }

    sellPending = false;
    sellRunning = true;
    lastSellPriorityCheckAt = Date.now();

    try {
      // 수동매도 요청은 상태파일을 직접 수정하지 않고 CORE 프로세스가 우선 처리한다.
      await processManualSellRequests();
      await checkSellOnce();
    } catch (err) {
      console.error(
        "[SELL LOOP 오류]",
        err?.stack || err?.message || err
      );
    } finally {
      sellRunning = false;
      lastSellPriorityCheckAt = Date.now();
    }
  }

  /*
   * 장 초반 30초, 중반 45초, 이후 60초처럼
   * 현재 시간대에 맞춰 다음 매수 점검 주기를 다시 계산한다.
   */
  function scheduleNextBuyLoop() {
    const delay = Math.max(
      1000,
      Number(getDynamicBuyLoopMs() || settings.buyLoopMs)
    );

    buyTimer = setTimeout(async () => {
      try {
        await runBuySafely();
      } finally {
        scheduleNextBuyLoop();
      }
    }, delay);

    if (typeof buyTimer.unref === "function") {
      // PM2 프로세스는 다른 반복 타이머로 유지되지만
      // 종료 시 이 타이머만으로 프로세스가 붙잡히지 않게 한다.
      buyTimer.unref();
    }
  }

  /*
   * 시작 직후 1회 점검한다.
   * 매수 시간이 아니면 runBuyOnce 내부에서 바로 종료한다.
   */
  await runBuySafely();
  await runSellSafely();

  scheduleNextBuyLoop();

  candidateWatchTimer = setInterval(
    () => {
      void runCandidateWatchSafely();
    },
    Math.max(
      1000,
      Number(settings.candidateWatchLoopMs || 30000)
    )
  );

  sellTimer = setInterval(
    () => {
      void runSellSafely();
    },
    Math.max(
      1000,
      Number(settings.sellLoopMs || 10000)
    )
  );

  console.log(
    `[LOOP 시작] 매수 동적 ${getDynamicBuyLoopMs() / 1000}초 / ` +
    `후보재평가 ${settings.candidateWatchLoopMs / 1000}초 / ` +
    `매도 ${settings.sellLoopMs / 1000}초`
  );

  /*
   * start() Promise가 바로 종료되어도 타이머는 계속 동작한다.
   * 아래 참조는 디버깅과 향후 종료 처리용이다.
   */
  return {
    buyTimer,
    candidateWatchTimer,
    sellTimer
  };
}

let started = false;

function startServerAutoTrader() {
  if (started) {
    console.log("[START] SY Quant 자동매매가 이미 실행 중입니다.");
    return;
  }

  started = true;

  start().catch(err => {
    started = false;
    console.error("[START 오류]", err.message);
  });
}

function setServerAutoEnabled(enabled) {
  const state = loadState();

  state.serverAutoEnabled = enabled === true;
  state.serverAutoChangedAt = nowText();

  saveState(state);

  console.log(
    `[AUTO] 서버 자동매매 ${state.serverAutoEnabled ? "ON" : "OFF"}`
  );

  return state;
}

module.exports = {
  startServerAutoTrader,

  runServerAutoBuyOnce: runBuyOnce,
  checkServerAutoSellOnce: checkSellOnce,

  setServerAutoEnabled,
  loadState,
  saveState
};
