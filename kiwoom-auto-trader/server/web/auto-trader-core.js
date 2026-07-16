const fs = require("fs");
const path = require("path");

const STATE_FILE = path.join(__dirname, "paper-state-core.json");
const API_BASE = "http://localhost:3000";


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

// 장 초반 CORE/VOLUME 후보 검색 강화
earlyDiscoverEndTime: "09:30",
midDiscoverEndTime: "10:00",

earlyDiscoverScanLimit: 300,
midDiscoverScanLimit: 225,

earlyBuyLoopMs: 30 * 1000,
midBuyLoopMs: 45 * 1000,

  coreEnabled: true,
 coreStartTime: "09:10",
coreEndTime: "11:00",
// 종목당 투자비율 (총 운용자산 기준)
buyAssetRatio: 0.125,

  coreMaxHoldingCount: 4,
  coreMaxChangeRate: 4.5,
  coreMinTradeVolumeRatio: 80,
  coreMinDayPositionRate: 50,
  coreMaxDayPositionRate: 80,

  volumeEnabled: true,
  volumeStartTime: "09:10",
volumeEndTime: "13:30",
  volumeMaxHoldingCount: 4,
  volumeMinChangeRate: 0.8,
  volumeMaxChangeRate: 6.0,
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

candidateConfirmWaitMs: 30 * 1000,
candidateHistoryMaxAgeMs: 30 * 60 * 1000,

// 후보 강화 목록
candidateWatchMaxCount: 10,
candidateWatchMaxAgeMs: 30 * 60 * 1000,

candidateWatchLoopMs: 30 * 1000,
candidateWatchPriceDelayMs: 350,

// 후보 재평가 분석
candidateNearMissMaxCount: 10,
candidateNearMissLogCount: 5,

// 운영상 차단된 우수 후보 추적
operationalBlockedCandidateMaxCount: 20,

breakEvenStartRate: 2.0,
breakEvenProtectRate: 0.2,

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
  const hhmm = getCurrentHHMM();
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

  const state = readJsonFileSafe(STATE_FILE);

  if (!Array.isArray(state.holdings)) state.holdings = [];
  if (!Array.isArray(state.tradeLogs)) state.tradeLogs = [];
  if (!Array.isArray(state.virtualResults)) state.virtualResults = [];

  if (!Array.isArray(state.pendingBuyCodes)) state.pendingBuyCodes = [];
  if (!Array.isArray(state.pendingSellCodes)) state.pendingSellCodes = [];

  if (!Array.isArray(state.coreCandidateWatchList)) {
    state.coreCandidateWatchList = [];
  }

  if (!Array.isArray(state.volumeCandidateWatchList)) {
    state.volumeCandidateWatchList = [];
  }

  if (
  !state.operationalBlockedCandidateAnalysis ||
  state.operationalBlockedCandidateAnalysis.date !==
    todayKey()
) {
  state.operationalBlockedCandidateAnalysis = {
    date: todayKey(),
    updatedAt: null,
    rows: []
  };
}

if (
  !Array.isArray(
    state.operationalBlockedCandidateAnalysis.rows
  )
) {
  state.operationalBlockedCandidateAnalysis.rows = [];
}

  // ✅ 매수 판단 통계 초기화
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

  // 기존 상태파일 보정
  for (const strategyGroup of ["CORE", "VOLUME"]) {
  if (!state.buyDecisionStats[strategyGroup]) {
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

  if (
    !stats.conditionRejected ||
    typeof stats.conditionRejected !== "object"
  ) {
    stats.conditionRejected = {};
  }

  if (
    !stats.operationalBlocked ||
    typeof stats.operationalBlocked !== "object"
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
   * 기존 rejected 데이터 호환
   * 예전 상태파일에 rejected가 있으면
   * 일단 conditionRejected로 옮겨 화면이 비지 않게 함
   */
  if (
    stats.rejected &&
    typeof stats.rejected === "object"
  ) {
    for (
      const [reason, count]
      of Object.entries(stats.rejected)
    ) {
      if (
        typeof stats.conditionRejected[reason] ===
        "undefined"
      ) {
        stats.conditionRejected[reason] =
          Number(count || 0);
      }
    }
  }
}

  if (typeof state.serverAutoEnabled === "undefined") {
    state.serverAutoEnabled = settings.serverAutoEnabledDefault;
  }

  if (typeof state.totalCash === "undefined") {
    state.totalCash = settings.totalCash;
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

function calculateMarketTemperature(candidates = []) {
  const rows = Array.isArray(candidates)
    ? candidates.filter(item => {
        const changeRate = Number(
          item.changeRate ||
          item.fluctuationRate ||
          item.riseRate ||
          item.rate ||
          item.raw?.flu_rt ||
          0
        );

        return Number.isFinite(changeRate);
      })
    : [];

  const total = rows.length;

  if (total === 0) {
    return {
      level: "NORMAL",
      label: "보통",
      score: 50,
      advanceRatio: 0,
      volumePassRatio: 0,
      averageChangeRate: 0,
      total: 0,
      reason: "시장온도 계산 대상 없음",
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
      item.changeRate ||
      item.fluctuationRate ||
      item.riseRate ||
      item.rate ||
      item.raw?.flu_rt ||
      0
    );

    const volumeRatio =
      getTradeVolumeRatio(item);

    changeRateSum += changeRate;

    if (changeRate > 0.1) {
      advanceCount++;
    } else if (changeRate < -0.1) {
      declineCount++;
    } else {
      flatCount++;
    }

    if (
      volumeRatio >=
      settings.coreMinTradeVolumeRatio
    ) {
      volumePassCount++;
    }
  }

  const advanceRatio =
    total > 0
      ? (advanceCount / total) * 100
      : 0;

  const declineRatio =
    total > 0
      ? (declineCount / total) * 100
      : 0;

  const volumePassRatio =
    total > 0
      ? (volumePassCount / total) * 100
      : 0;

  const averageChangeRate =
    total > 0
      ? changeRateSum / total
      : 0;

  /*
   * 시장온도 점수
   *
   * 상승종목 비율: 최대 50점
   * 평균 등락률: 최대 ±25점
   * 거래량 통과 비율: 최대 25점
   */
  const advanceScore =
    advanceRatio * 0.5;

  const changeScore =
    Math.max(
      -25,
      Math.min(
        25,
        averageChangeRate * 10
      )
    );

  const volumeScore =
    volumePassRatio * 0.25;

  const score = Math.max(
    0,
    Math.min(
      100,
      25 +
      advanceScore +
      changeScore +
      volumeScore
    )
  );

  let level = "NORMAL";
  let label = "보통";

  if (score >= 75) {
    level = "HOT";
    label = "강세";
  } else if (score >= 55) {
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

    score: Number(score.toFixed(1)),
    advanceRatio:
      Number(advanceRatio.toFixed(1)),
    declineRatio:
      Number(declineRatio.toFixed(1)),
    volumePassRatio:
      Number(volumePassRatio.toFixed(1)),
    averageChangeRate:
      Number(averageChangeRate.toFixed(2)),

    total,
    advanceCount,
    declineCount,
    flatCount,
    volumePassCount,

    reason:
      `상승 ${advanceCount}/${total}개 / ` +
      `평균등락 ${averageChangeRate.toFixed(2)}% / ` +
      `거래량통과 ${volumePassCount}/${total}개`,

    checkedAt: nowText(),
    checkedDate: todayKey()
  };
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
  } else if (dayPosition < minDayPosition) {
    dayPositionFit = Math.max(
      0,
      1 -
        (minDayPosition - dayPosition) / 30
    );
  } else {
    dayPositionFit = Math.max(
      0,
      1 -
        (dayPosition - maxDayPosition) / 30
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

if (
  changeRate >= minChangeRate &&
  changeRate <= maxChangeRate
) {
  const range =
    Math.max(
      0.0001,
      maxChangeRate - minChangeRate
    );

  const position =
    (changeRate - minChangeRate) /
    range;

  changeRatePart =
    Math.min(
      15,
      position * 15
    );
} else if (changeRate > maxChangeRate) {
  const excess =
    changeRate - maxChangeRate;

  changeRatePart =
    Math.max(
      0,
      15 - excess * 3
    );
}

  const total =
    discoverPart +
    volumePart +
    dayPositionPart +
    changeRatePart;

  return {
    total,
    discoverPart,
    volumePart,
    dayPositionPart,
    changeRatePart,

    discoverScore,
    volumeRatio,
    dayPosition,
    changeRate,

    minVolumeRatio,
    minDayPosition,
    maxDayPosition
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

  const existing = state[listKey].find(
    candidate => candidate.code === code
  );

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
    `최종 ${Number(candidate.watchScore || 0).toFixed(1)}점 / ` +
    `발견 ${Number(detail.discoverPart || 0).toFixed(1)} / ` +
    `거래량 ${Number(detail.volumePart || 0).toFixed(1)} / ` +
    `위치 ${Number(detail.dayPositionPart || 0).toFixed(1)} / ` +
    `상승률 ${Number(detail.changeRatePart || 0).toFixed(1)}`
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



function recordBuyDecision(
  state,
  strategyGroup,
  judged,
  source = "DISCOVER"
) {
  if (
    !["CORE", "VOLUME"].includes(
      strategyGroup
    )
  ) {
    return;
  }

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

    return;
  }

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

  // 전체검색과 후보재평가 출처 집계
  const sourceKey =
    source === "WATCH"
      ? "후보재평가"
      : "전체검색";

  if (
    !stats.sources ||
    typeof stats.sources !== "object"
  ) {
    stats.sources = {};
  }

  stats.sources[sourceKey] =
    Number(stats.sources[sourceKey] || 0) +
    1;
}

function recordBuySuccess(
  state,
  strategyGroup
) {
  if (
    !state.buyDecisionStats ||
    !state.buyDecisionStats[strategyGroup]
  ) {
    return;
  }

  const stats =
    state.buyDecisionStats[strategyGroup];

  stats.bought =
    Number(stats.bought || 0) + 1;
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
state.coreCandidateWatchList = [];
state.volumeCandidateWatchList = [];

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

state.candidateNearMissAnalysis = {
  date: today,
  updatedAt: null,
  rows: []
};

state.operationalBlockedCandidateAnalysis = {
  date: today,
  updatedAt: null,
  rows: []
};

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

async function discoverCandidates(state, mode = "CORE_VOLUME") {
  const offset = Number(state.discoverOffset || 0);
  const scanLimit = getDynamicDiscoverScanLimit(mode);

  const data = await fetchJson(
    `${API_BASE}/api/discover?offset=${offset}` +
    `&scanLimit=${scanLimit}` +
    `&limit=${settings.discoverLimit}`
  );

  state.discoverOffset = Number(data.nextOffset || 0);
  state.lastDiscoverOffsetAt = nowText();

  const rawItems = data.items || [];

  const filtered = rawItems
    .filter(item => !isExcludedStock(item))
    .filter(item => Number(item.discoverScore || 0) >= settings.minDiscoverScore)
    .sort(
      (a, b) =>
        Number(b.discoverScore || 0) -
        Number(a.discoverScore || 0)
    );

  console.log(
    `[DISCOVER] 원본 ${rawItems.length}개 / ` +
    `필터후 ${filtered.length}개 / ` +
    `offset ${offset} → ${state.discoverOffset} / ` +
    `scanLimit ${scanLimit} / ` +
    `mode ${mode} / ` +
    `limit ${settings.discoverLimit}`
  );

  return filtered;
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

  if (priceDiffRate < -0.9) {
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

  if (volumeRatio < settings.coreMinTradeVolumeRatio) {
  return {
    pass: false,
    reason: makeVolumeRatioLog(
      item,
      "CORE",
      volumeRatio,
      settings.coreMinTradeVolumeRatio
    )
  };
}

 if (
  dayPosition < settings.coreMinDayPositionRate ||
  dayPosition > settings.coreMaxDayPositionRate
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

  if (
  changeRate < settings.volumeMinChangeRate ||
  changeRate > settings.volumeMaxChangeRate
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

  if (volumeRatio < settings.volumeMinTradeVolumeRatio) {
  return {
    pass: false,
    reason: makeVolumeRatioLog(
      item,
      "VOLUME",
      volumeRatio,
      settings.volumeMinTradeVolumeRatio
    )
  };
}

 if (
  dayPosition < settings.volumeMinDayPositionRate ||
  dayPosition > settings.volumeMaxDayPositionRate
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

  if (openPosition < 0) {
  return {
    pass: false,
    reason:
      `시가대비 ${openPosition.toFixed(2)}% / ` +
      `VOLUME 최소기준 0.00% / ` +
      `부족 ${Math.abs(openPosition).toFixed(2)}%p`
  };
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
        strategyGroup
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

    const candidateStrengthScore = Number(
      item.candidateStrengthScore ??
      item.leaderStrengthScore ??
      watchScoreDetail?.candidateStrengthScore ??
      watchScoreDetail?.leaderStrengthScore ??
      0
    );

    const candidateWatchScore = Number(
      watchItem?.watchScore ??
      item.watchScore ??
      0
    );

    const commonBuyData = {
      discoverScore,

      finalBuyScore,
      finalBuyScoreDetail:
        watchScoreDetail,

      marketScore,
      marketTemperature:
        state.marketTemperature || null,

      sectorPowerScore,
      leaderStrengthScore,
      candidateStrengthScore,

      candidateWatchScore,
      candidateWatchScoreDetail:
        watchScoreDetail,

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

    state.holdings.push({
      code: item.code,
      name,
      strategyGroup,

      buyPrice: price,
      currentPrice: price,
      qty,
      buyAmount: price * qty,
      buyTime: Date.now(),

      highestPrice: price,
      lowestPrice: price,
      highestPriceAt: Date.now(),

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


async function paperSell(
  state,
  holding,
  sellPrice,
  sellQty,
  sellType,
  reason
) {
  if (!state.pendingSellCodes) {
    state.pendingSellCodes = [];
  }

  const sellKey =
    `${holding.code}_${sellType}`;

  if (
    state.pendingSellCodes.includes(sellKey)
  ) {
    console.log(
      `[${sellType} 제외] ${holding.name} / 매도 요청 진행중`
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

    const result = await postJson(
      `${API_BASE}/api/core-paper-sell`,
      {
        code: holding.code,
        price: sellPrice,
        qty,
        sellType,
        reason
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
    state.pendingSellCodes =
      state.pendingSellCodes.filter(
        key => key !== sellKey
      );

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

  // 2-1. 본전 방어
if (
  highestProfitRate >= settings.breakEvenStartRate &&
  profitRate <= settings.breakEvenProtectRate
) {
  return {
    type: `${holding.strategyGroup}_BREAK_EVEN_SELL`,
    qty: holding.qty,
    reason:
      `본전방어 / 최고수익 ${highestProfitRate.toFixed(2)}% / ` +
      `현재수익 ${profitRate.toFixed(2)}% / ` +
      `방어기준 ${settings.breakEvenProtectRate.toFixed(2)}%`
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
  const hhmm = new Date().toLocaleTimeString("ko-KR", {
  timeZone: "Asia/Seoul",
  hour12: false,
  hour: "2-digit",
  minute: "2-digit"
});

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

      recordBuyDecision(
  state,
  strategyGroup,
  judged,
  "WATCH"
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

  const candidates = await discoverCandidates(
    state,
    "CORE_VOLUME"
  );

  console.log(
    `[BUY] 후보 조회 완료 / ${candidates.length}개`
  );

  const marketTemperature =
  calculateMarketTemperature(candidates);

state.marketTemperature =
  marketTemperature;

console.log(
  `[시장온도] ${marketTemperature.label} / ` +
  `${marketTemperature.score.toFixed(1)}점 / ` +
  `상승비율 ${marketTemperature.advanceRatio.toFixed(1)}% / ` +
  `평균등락 ${marketTemperature.averageChangeRate.toFixed(2)}% / ` +
  `거래량통과 ${marketTemperature.volumePassRatio.toFixed(1)}% / ` +
  `대상 ${marketTemperature.total}개`
);

  console.log(
    `[BUY] 현재 보유 OPEN ${getHoldingCount(state, "OPEN")}개 / ` +
    `CORE ${getHoldingCount(state, "CORE")}개 / ` +
    `VOLUME ${getHoldingCount(state, "VOLUME")}개 / ` +
    `현금 ${Number(state.totalCash || 0).toLocaleString()}원`
  );

  let excludeLogCount = 0;
  const maxExcludeLogCount = 20;

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


recordBuyDecision(
  state,
  "CORE",
  coreJudge,
  "DISCOVER"
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

  recordBuyDecision(
    state,
    "VOLUME",
    volumeJudge,
    "DISCOVER"
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
  state.coreCandidateWatchList || []
) {
  console.log(
    `[CORE 후보점수] ` +
    makeCandidateWatchScoreLog(candidate)
  );
}

for (
  const candidate of
  state.volumeCandidateWatchList || []
) {
  console.log(
    `[VOLUME 후보점수] ` +
    makeCandidateWatchScoreLog(candidate)
  );
}

 state.lastBuyCheckAt = nowText();

logBuyDecisionSummary(state);

saveState(state);

console.log("[BUY] 1회 점검 종료");
}

async function checkSellOnce() {
  if (!isKoreanWeekday()) return;
  if (!isBetweenTime("09:00", "15:20")) return;

  const state = loadState();

  if (!state.serverAutoEnabled) {
    console.log("[SELL] 서버 자동매매 OFF");
    return;
  }

  console.log("[SELL] 1회 점검 시작");
  const coreVolumeHoldings = (state.holdings || []).filter(
    holding =>
      holding.strategyGroup === "CORE" ||
      holding.strategyGroup === "VOLUME"
  );

  console.log(`[SELL] CORE/VOLUME 보유종목 ${coreVolumeHoldings.length}개`);

  for (const holding of coreVolumeHoldings) {

   
    let price = 0;

    try {
      price = await fetchPrice(holding.code);
    } catch (err) {
      console.log(`[SELL 가격조회 실패] ${holding.name} / ${err.message}`);
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

    const signal = getSellSignal(holding, price);

    if (!signal) {
      const buyPrice = Number(holding.buyPrice || 0);

      const profitRate = buyPrice > 0
        ? ((price - buyPrice) / buyPrice) * 100
        : 0;

      console.log(
        `[SELL 유지] ${holding.name} / ` +
        `현재가 ${price.toLocaleString()}원 / ` +
        `${profitRate.toFixed(2)}%`
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
  console.log("SY Quant CORE/VOLUME 자동매매 시작");

  await runBuyOnce();
  await checkSellOnce();

let buyRunning = false;
let candidateWatchRunning = false;
let sellRunning = false;

 function scheduleNextBuyLoop() {
  const delay = getDynamicBuyLoopMs();

  setTimeout(async () => {
    if (
  buyRunning ||
  candidateWatchRunning
) {
  scheduleNextBuyLoop();
  return;
}

    buyRunning = true;

    try {
      await runBuyOnce();
    } catch (err) {
      console.error("[BUY LOOP 오류]", err.message);
    } finally {
      buyRunning = false;
      scheduleNextBuyLoop();
    }
  }, delay);
}

setInterval(async () => {
  if (
    candidateWatchRunning ||
    buyRunning
  ) {
    return;
  }

  candidateWatchRunning = true;

  try {
    await runCandidateWatchOnce();
  } catch (err) {
    console.error(
      "[후보재평가 LOOP 오류]",
      err.message
    );
  } finally {
    candidateWatchRunning = false;
  }
}, settings.candidateWatchLoopMs);

scheduleNextBuyLoop();

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
