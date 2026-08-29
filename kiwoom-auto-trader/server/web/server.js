require("dotenv").config();

const express = require("express");
const cors = require("cors");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

// SY Quant MASTER 단일계좌 공통 자금관리
const portfolioManager = require("./portfolio-manager");

const app = express();
const PORT = 3000;


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


app.use(cors());
app.use(express.json());

const stocksPath = path.join(__dirname, "stocks.json");

let STOCK_MASTER = [];

try {
  STOCK_MASTER = JSON.parse(fs.readFileSync(stocksPath, "utf-8"));
  console.log("종목 목록 로드 완료:", STOCK_MASTER.length);
} catch (error) {
  console.error("stocks.json 로드 실패:", error.message);
}

const STOCK_MASTER_BY_CODE = new Map(
  STOCK_MASTER.map(stock => [
    String(stock.code || stock.stk_cd || "").replace(/^A/i, "").padStart(6, "0"),
    stock
  ])
);

function getStockMarketMetadata(code, fallback = {}) {
  const stock = STOCK_MASTER_BY_CODE.get(
    String(code || "").replace(/^A/i, "").padStart(6, "0")
  ) || {};

  const marketSegment =
    stock.marketSegment ??
    stock.market ??
    stock.marketType ??
    stock.marketName ??
    stock.exchange ??
    fallback.marketSegment ??
    fallback.market ??
    fallback.marketType ??
    fallback.marketName ??
    fallback.exchange ??
    null;

  const sectorKey =
    stock.sectorKey ??
    stock.sectorCode ??
    stock.industryCode ??
    stock["업종코드"] ??
    stock.sector ??
    stock.industry ??
    fallback.sectorKey ??
    fallback.sectorCode ??
    fallback.industryCode ??
    fallback["업종코드"] ??
    fallback.sector ??
    fallback.industry ??
    null;

  const sectorName =
    stock.sectorName ??
    stock.industryName ??
    stock["업종명"] ??
    stock.sector ??
    stock.industry ??
    fallback.sectorName ??
    fallback.industryName ??
    fallback["업종명"] ??
    fallback.sector ??
    fallback.industry ??
    sectorKey ??
    null;

  const industryName =
    stock.industryName ??
    stock.sectorName ??
    stock["업종명"] ??
    fallback.industryName ??
    fallback.sectorName ??
    fallback["업종명"] ??
    sectorName;

  return {
    marketSegment,
    market: marketSegment,
    sectorKey,
    sector: sectorName,
    sectorName,
    industryName
  };
}

const PAPER_STATE_FILE = path.join(
  __dirname,
  "paper-state-core.json"
);

// auto-trader-core의 3-way 병합 저장기를 서버 API에서도 공유한다.
// require는 아래쪽에서 완료되므로 API가 호출되기 전까지 함수 참조만 보관한다.
let sharedLoadPaperState = null;
let sharedSavePaperState = null;

const MANUAL_SELL_REQUEST_DIR = path.join(__dirname, "manual-sell-requests");
const MANUAL_SELL_RESULT_DIR = path.join(__dirname, "manual-sell-results");
const MANUAL_SELL_REQUEST_TTL_MS = 90 * 1000;

for (const dir of [MANUAL_SELL_REQUEST_DIR, MANUAL_SELL_RESULT_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const OPEN_HISTORY_FILE = path.join(
  __dirname,
  "open-learning-history.json"
);

const HOT_CANDIDATES_FILE = path.join(
  __dirname,
  "hot-candidates.json"
);

const HOT_HISTORY_FILE = path.join(
  __dirname,
  "hot-candidates-history.json"
);

const DAILY_CODE_CHANGES_FILE = path.join(
  __dirname,
  "daily-code-changes.json"
);

const AUTO_TRADER_CORE_FILE = path.join(
  __dirname,
  "auto-trader-core.js"
);

const CODE_CHANGE_LOG_FILE = path.join(
  __dirname,
  "code-change-log.json"
);

const CODE_CHANGE_HISTORY_FILE = path.join(
  __dirname,
  "sy-quant-change-history.json"
);

function todayKstKey() {
  return new Date().toLocaleDateString("sv-SE", {
    timeZone: "Asia/Seoul"
  });
}

function loadDailyCodeChanges() {
  const fallback = {
    version: 1,
    days: {}
  };

  const data = readJsonFileSafe(
    DAILY_CODE_CHANGES_FILE,
    fallback
  ) || fallback;

  if (!data.days || typeof data.days !== "object") {
    data.days = {};
  }

  return data;
}

function saveDailyCodeChanges(data) {
  writeJsonFileAtomic(
    DAILY_CODE_CHANGES_FILE,
    data
  );
}

function parseSettingValue(source, key) {
  const escapedKey = String(key).replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );

  const pattern = new RegExp(
    `(?:^|\\n)\\s*${escapedKey}\\s*:\\s*([^,\\n}]+)`,
    "m"
  );

  const match = source.match(pattern);

  if (!match) {
    return null;
  }

  const raw = String(match[1] || "")
    .replace(/\/\/.*$/, "")
    .trim();

  if (/^true$/i.test(raw)) return true;
  if (/^false$/i.test(raw)) return false;

  if (/^["'`].*["'`]$/.test(raw)) {
    return raw.slice(1, -1);
  }

  const normalized = raw
    .replace(/\s+/g, "")
    .replace(/\*1000$/i, "000");

  const number = Number(normalized);

  if (Number.isFinite(number)) {
    return number;
  }

  if (/^[\d.]+(?:\s*\*\s*[\d.]+)+$/.test(raw)) {
    return raw
      .split("*")
      .map(value => Number(value.trim()))
      .reduce((product, value) => product * value, 1);
  }

  return raw;
}

function getCurrentTradingSettings() {
  const keys = [
    "buyAssetRatio",
    "coreStartTime",
    "coreEndTime",
    "coreMaxHoldingCount",
    "coreMaxDailyBuyCount",
    "coreMaxChangeRate",
    "coreMinTradeVolumeRatio",
    "coreMinDayPositionRate",
    "coreMaxDayPositionRate",
    "coreConfirmMinPriceRiseRate",
    "coreMinCandidateStrengthScore",
    "coreTrendObservationMinCount",
    "coreTrendObservationWindowMs",
    "coreTrendMinElapsedMs",
    "coreTrendMinPricePersistence",
    "coreTrendMaxDayPositionDrop",
    "coreTrendMinVolumeRetentionRate",
    "coreStopLossRate",
    "coreBreakEvenStartRate",
    "coreBreakEvenProtectRate",
    "coreBreakEvenWeakMaxHoldingScore",
    "coreBreakEvenWeakMaxDayPositionRate",
    "coreBreakEvenWeakMinScoreDrop",
    "coreFirstTakeProfitRate",
    "coreTrailingStartRate",
    "coreTrailingStopRate",
    "volumeStartTime",
    "volumeEndTime",
    "volumeMaxHoldingCount",
    "volumeMaxDailyBuyCount",
    "volumeMinChangeRate",
    "volumeMaxChangeRate",
    "volumeMinTradeVolumeRatio",
    "volumeMinDayPositionRate",
    "volumeMaxDayPositionRate",
    "volumeMinCandidateStrengthScore",
    "volumeLateChaseBlockEnabled",
    "volumeLateChaseMinChangeRate",
    "volumeLateChaseMinCandidateStrengthScore",
    "volumeRecentHighGuardEnabled",
    "volumeRecentHighWindowMs",
    "volumeRecentHighMinSampleCount",
    "volumeRecentHighMaxEntryDrawdownRate",
    "volumePullbackEntryEnabled",
    "volumePullbackMinRate",
    "volumePullbackMaxRate",
    "volumeReboundMinRate",
    "volumePullbackMaxWaitMs",
    "volumePullbackMinVolumeRetentionRate",
    "volumePullbackMaxDayPositionDrop",
    "volumeStopLossRate",
    "volumeBreakEvenStartRate",
    "volumeBreakEvenProtectRate",
    "volumeFirstTakeProfitRate",
    "volumeTrailingStartRate",
    "volumeTrailingStopRate",
    "openPriorityBuyBlockEndTime",
    "leaderWatchMaxAgeMs",
    "buyQuoteMaxAgeMs",
    "marketTemperatureMinSampleCount",
    "marketTemperatureEarlyTradeMinSampleCount",
    "marketTemperatureSegmentMinSampleCount",
    "marketTemperatureSampleMaxAgeMs",
    "marketTemperatureLastReadyMaxAgeMs",
    "marketTemperatureAccumulatingBuyBlocked",
    "marketTemperatureAccumulatingFallbackScore",
    "sellLoopMs",
    "minHoldMinutes",
    "lossExitBuyCooldownMinutes",
    "maxDailyLossExitCount",
    "breakEvenStartRate",
    "breakEvenProtectRate",
    "holdingWeakSellEnabled",
    "holdingWeakSellMinHoldMinutes",
    "holdingWeakSellMaxScore",
    "holdingWeakSellMaxProfitRate",
    "holdingWeakSellMaxDayPositionRate",
    "holdingWeakSellMinScoreDrop",
    "volumeOverheatBlockEnabled",
    "volumeOverheatMinVolumeRatio",
    "volumeOverheatMinChangeRate",
    "volumeOverheatMinDayPositionRate",
    "dailyLossLimitRate",
    "endSellTime",
    "coreEndSellOnlyPositive",
    "volumeEndSellOnlyPositive"
  ];

  if (!fs.existsSync(AUTO_TRADER_CORE_FILE)) {
    return {
      available: false,
      file: "auto-trader-core.js",
      updatedAt: null,
      values: {}
    };
  }

  const source = fs.readFileSync(
    AUTO_TRADER_CORE_FILE,
    "utf8"
  );

  const values = {};

  for (const key of keys) {
    const value = parseSettingValue(
      source,
      key
    );

    if (value !== null) {
      values[key] = value;
    }
  }

  const stat = fs.statSync(
    AUTO_TRADER_CORE_FILE
  );

  return {
    available: true,
    file: "auto-trader-core.js",
    updatedAt: stat.mtime.toLocaleString(
      "ko-KR",
      { timeZone: "Asia/Seoul" }
    ),
    values
  };
}


function loadCodeChangeHistory() {
  const fallback = {
    version: 1,
    importedIds: [],
    days: {}
  };

  const data = readJsonFileSafe(
    CODE_CHANGE_HISTORY_FILE,
    fallback
  ) || fallback;

  if (!Array.isArray(data.importedIds)) {
    data.importedIds = [];
  }

  if (!data.days || typeof data.days !== "object") {
    data.days = {};
  }

  return data;
}

function saveCodeChangeHistory(data) {
  writeJsonFileAtomic(
    CODE_CHANGE_HISTORY_FILE,
    data
  );
}

function normalizeCodeChange(change = {}, fallbackDate = todayKstKey()) {
  const date = String(
    change.date || fallbackDate
  ).trim();

  const file = String(
    change.file || "알 수 없는 파일"
  ).trim();

  const title = String(
    change.title || change.description || "코드 수정"
  ).trim();

  const description = String(
    change.description || change.title || ""
  ).trim();

  const time = String(
    change.time || change.changedAt || ""
  ).trim();

  const category = String(
    change.category || "기타"
  ).trim();

  const effectiveFrom = String(
    change.effectiveFrom || "서버 재시작 이후"
  ).trim();

  const verification = String(
    change.verification || "다음 거래일 확인"
  ).trim();

  const rawId = String(change.id || "").trim();

  const generatedId = require("crypto")
    .createHash("sha1")
    .update(
      [
        date,
        time,
        file,
        category,
        title,
        description,
        effectiveFrom,
        verification
      ].join("|")
    )
    .digest("hex")
    .slice(0, 16);

  return {
    id: rawId || generatedId,
    date,
    time,
    file,
    category,
    title,
    description,
    effectiveFrom,
    verification
  };
}

function importCodeChangeLog() {
  if (!fs.existsSync(CODE_CHANGE_LOG_FILE)) {
    return {
      imported: 0,
      skipped: 0,
      fileFound: false
    };
  }

  const packageLog = readJsonFileSafe(
    CODE_CHANGE_LOG_FILE,
    { date: todayKstKey(), changes: [] }
  ) || { date: todayKstKey(), changes: [] };

  const changes = Array.isArray(packageLog.changes)
    ? packageLog.changes
    : [];

  const history = loadCodeChangeHistory();
  const importedIdSet = new Set(history.importedIds);
  let imported = 0;
  let skipped = 0;

  for (const rawChange of changes) {
    const change = normalizeCodeChange(
      rawChange,
      packageLog.date || todayKstKey()
    );

    if (importedIdSet.has(change.id)) {
      skipped++;
      continue;
    }

    if (!Array.isArray(history.days[change.date])) {
      history.days[change.date] = [];
    }

    history.days[change.date].push({
      ...change,
      importedAt: new Date().toLocaleString(
        "ko-KR",
        { timeZone: "Asia/Seoul" }
      )
    });

    importedIdSet.add(change.id);
    imported++;
  }

  history.importedIds = Array.from(importedIdSet).slice(-2000);

  const dates = Object.keys(history.days)
    .sort()
    .reverse();

  for (const oldDate of dates.slice(180)) {
    delete history.days[oldDate];
  }

  if (imported > 0) {
    saveCodeChangeHistory(history);
    console.log(
      `[코드 변경기록 자동반영] ${imported}건 추가 / ${skipped}건 중복`
    );
  }

  return {
    imported,
    skipped,
    fileFound: true
  };
}

function getCodeChangesForDate(date) {
  const history = loadCodeChangeHistory();
  const items = Array.isArray(history.days?.[date])
    ? history.days[date]
    : [];

  return items
    .slice()
    .sort((a, b) => {
      const timeA = String(a.time || "");
      const timeB = String(b.time || "");
      return timeA.localeCompare(timeB);
    });
}


function loadPaperState() {
  if (typeof sharedLoadPaperState === "function") {
    return sharedLoadPaperState();
  }

  if (!fs.existsSync(PAPER_STATE_FILE)) {
    return {
      holdings: [],
      tradeLogs: [],
      virtualResults: [],
      totalCash: 100000000,
      initialCapital: 100000000,
      serverAutoEnabled: true
    };
  }

  const state = readJsonFileSafe(PAPER_STATE_FILE);

  if (!Array.isArray(state.holdings)) state.holdings = [];
  if (!Array.isArray(state.tradeLogs)) state.tradeLogs = [];
  if (!Array.isArray(state.virtualResults)) {
    state.virtualResults = [];
  }

  if (typeof state.totalCash === "undefined") {
    state.totalCash = 100000000;
  }

  return state;
}

function savePaperState(state, options = {}) {
  if (
    options.force !== true &&
    typeof sharedSavePaperState === "function"
  ) {
    return sharedSavePaperState(state);
  }

  writeJsonFileAtomic(PAPER_STATE_FILE, state);
  return state;
}

const REPORT_STRATEGY_GROUPS = new Set(["OPEN", "CORE", "VOLUME", "WAVE", "FAST"]);

const REPORT_BUY_TYPES = new Set([
  "OPEN_BUY",
  "CORE_BUY",
  "VOLUME_BUY",
  "WAVE_BUY",
  "FAST_BUY"
]);

/*
 * 성과집계용 매도 타입.
 * 이 목록은 현재 표준 타입을 빠르게 판별하기 위한 것이고, 실제 집계는
 * isReportSellLog()에서 과거/추가 매도 타입도 자동 판별한다.
 */
const REPORT_SELL_TYPES = new Set([
  "SELL",
  "SELL_ALL",
  "OPEN_MANUAL_SELL",
  "CORE_MANUAL_SELL",
  "VOLUME_MANUAL_SELL",
  "OPEN_STOP_LOSS",
  "OPEN_TRAILING_SELL",
  "OPEN_STAGNATION_SELL",
  "OPEN_TIME_SELL",
  "CORE_STOP_LOSS",
  "CORE_FIRST_TAKE_PROFIT",
  "CORE_BREAK_EVEN_SELL",
  "CORE_TRAILING_STOP",
  "CORE_END_SELL",
  "VOLUME_STOP_LOSS",
  "VOLUME_FIRST_TAKE_PROFIT",
  "VOLUME_BREAK_EVEN_SELL",
  "VOLUME_TRAILING_STOP",
  "VOLUME_END_SELL",

  "WAVE_STOP_LOSS",
  "WAVE_STRUCTURE_STOP",
  "WAVE_PROTECT_SELL",
  "WAVE_TRAILING_SELL",
  "WAVE_STRONG_TRAILING_SELL",
  "WAVE_WEAK_TREND_SELL",
  "WAVE_TIME_TREND_SELL",
  "WAVE_MAX_TIME_SELL",

  "FAST_STOP_LOSS",
  "FAST_PROTECT_SELL",
  "FAST_TRAILING_SELL",
  "FAST_STRONG_TRAILING_SELL",
  "FAST_STAGNATION_SELL",
  "FAST_WEAK_TIME_SELL",
  "FAST_FORCE_SELL",
  "FAST_TIME_SELL"
]);

function reportNormalizeCode(code) {
  return String(code || "")
    .replace(/^A/i, "")
    .trim()
    .padStart(6, "0");
}

function reportExplicitStrategy(log = {}) {
  for (const value of [
    log.__reportStrategyGroup,
    log.strategyGroup,
    log.group
  ]) {
    const normalized = String(value || "").toUpperCase().trim();
    if (REPORT_STRATEGY_GROUPS.has(normalized)) return normalized;
  }

  const type = String(log.type || "").toUpperCase().trim();
  for (const group of REPORT_STRATEGY_GROUPS) {
    if (type === group || type.startsWith(`${group}_`)) return group;
  }

  return null;
}

function reportStrategy(log = {}) {
  // 과거 CORE 로그는 strategyGroup이 없는 경우가 있어 CORE를 기본값으로 유지한다.
  return reportExplicitStrategy(log) || "CORE";
}

function isReportBuyLog(log = {}) {
  const type = String(log.type || "").toUpperCase().trim();
  if (REPORT_BUY_TYPES.has(type)) return true;

  const qty = Number(log.qty || 0);
  const buyPrice = Number(log.buyPrice || log.price || 0);

  // BUY/TURBO_BUY/LEADER_BUY/EARLY_BUY 등 과거 매수로그도 복원한다.
  return (type === "BUY" || type.endsWith("_BUY")) && qty > 0 && buyPrice > 0;
}

function isReportSellLog(log = {}) {
  const type = String(log.type || "").toUpperCase().trim();
  if (!type || isReportBuyLog(log)) return false;
  if (REPORT_SELL_TYPES.has(type)) return true;

  const qty = Number(log.qty || 0);
  const sellPrice = Number(log.sellPrice || log.price || 0);
  const hasProfit =
    Object.prototype.hasOwnProperty.call(log, "profit") &&
    Number.isFinite(Number(log.profit));
  const sellLikeType = /(SELL|STOP|TAKE_PROFIT|TRAIL|BREAK_EVEN|PROTECT|STAGNATION|STAGNANT|TIME_EXIT|TIME_SELL|END_)/.test(type);

  // 과거/신규 매도 타입이 REPORT_SELL_TYPES에 없어도 실제 체결손익 로그면 집계한다.
  return qty > 0 && sellPrice > 0 && hasProfit && sellLikeType;
}

function reportTimestampMs(log = {}) {
  const numericCandidates = [
    log.timestampMs,
    log.sellTimeMs,
    log.buyTimeMs,
    log.buyTime,
    log.signalAtMs
  ];

  for (const value of numericCandidates) {
    const number = Number(value || 0);
    if (Number.isFinite(number) && number > 0) return number;
  }

  for (const value of [log.sellTime, log.buyAt, log.time]) {
    const parsed = Date.parse(String(value || ""));
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }

  return 0;
}

function reportBuyIdentity(log = {}, index = 0) {
  if (log.positionId) return `POSITION|${String(log.positionId)}`;

  const code = reportNormalizeCode(log.code);
  const strategy = reportStrategy(log);
  const date = String(log.date || "").slice(0, 10);
  const timeMs = reportTimestampMs(log);

  if (timeMs > 0) {
    return `BUY_TIME|${strategy}|${code}|${timeMs}`;
  }

  return [
    "BUY_LEGACY",
    date,
    strategy,
    code,
    Number(log.buyPrice || log.price || 0),
    Number(log.qty || 0),
    String(log.time || ""),
    index
  ].join("|");
}

function buildReportPositionSummary(
  tradeLogs = [],
  holdings = [],
  selectedSellLogs = null
) {
  const allLogs = Array.isArray(tradeLogs) ? tradeLogs : [];
  const buyLogs = allLogs.filter(isReportBuyLog);
  const sellLogs = Array.isArray(selectedSellLogs)
    ? selectedSellLogs
    : allLogs.filter(isReportSellLog);

  const buyRecords = buyLogs.map((log, index) => ({
    identity: reportBuyIdentity(log, index),
    log,
    index,
    code: reportNormalizeCode(log.code),
    strategyGroup: reportStrategy(log),
    date: String(log.date || "").slice(0, 10),
    timeMs: reportTimestampMs(log),
    qty: Number(log.qty || 0),
    positionId: log.positionId ? String(log.positionId) : null
  }));

  const uniqueBuyRecords = [];
  const seenBuyIdentities = new Set();
  for (const record of buyRecords) {
    if (seenBuyIdentities.has(record.identity)) continue;
    seenBuyIdentities.add(record.identity);
    uniqueBuyRecords.push(record);
  }

  function findBuyRecord(sellLog) {
    const positionId = sellLog.positionId
      ? String(sellLog.positionId)
      : null;

    if (positionId) {
      const exact = uniqueBuyRecords.find(
        record => record.positionId === positionId
      );
      if (exact) return exact;
    }

    const code = reportNormalizeCode(sellLog.code);
    const explicitStrategyGroup = reportExplicitStrategy(sellLog);
    const date = String(sellLog.date || "").slice(0, 10);
    const explicitBuyTime = Number(
      sellLog.buyTime || sellLog.buyTimeMs || 0
    );

    if (explicitBuyTime > 0) {
      const exactTime = uniqueBuyRecords.find(record =>
        record.code === code &&
        (!explicitStrategyGroup || record.strategyGroup === explicitStrategyGroup) &&
        record.timeMs === explicitBuyTime
      );
      if (exactTime) return exactTime;
    }

    const sellTimeMs = reportTimestampMs(sellLog);
    const candidates = uniqueBuyRecords
      .filter(record =>
        record.code === code &&
        (!explicitStrategyGroup || record.strategyGroup === explicitStrategyGroup) &&
        (!date || !record.date || record.date === date) &&
        (!sellTimeMs || !record.timeMs || record.timeMs <= sellTimeMs)
      )
      .sort((a, b) => {
        if (a.timeMs !== b.timeMs) return b.timeMs - a.timeMs;
        return b.index - a.index;
      });

    return candidates[0] || null;
  }

  const positionMap = new Map();
  const resolvedSellLogs = [];

  sellLogs.forEach((log, sellIndex) => {
    const buyRecord = findBuyRecord(log);
    const code = reportNormalizeCode(log.code);
    const strategyGroup =
      buyRecord?.strategyGroup ||
      reportExplicitStrategy(log) ||
      "CORE";
    const date = String(log.date || "").slice(0, 10);
    const positionId = log.positionId
      ? String(log.positionId)
      : buyRecord?.positionId || null;
    const identity = positionId
      ? `POSITION|${positionId}`
      : buyRecord?.identity || `SELL_LEGACY|${date}|${strategyGroup}|${code}`;

    if (!positionMap.has(identity)) {
      positionMap.set(identity, {
        identity,
        positionId,
        code,
        name: log.name || buyRecord?.log?.name || code,
        date,
        strategyGroup,
        strategyName:
          log.strategyName || buyRecord?.log?.strategyName || "",
        strategyPreset:
          log.strategyPreset || buyRecord?.log?.strategyPreset || "",
        buyRecord,
        buyQty: Number(buyRecord?.qty || 0),
        soldQty: 0,
        sellFillCount: 0,
        profit: 0,
        soldCost: 0,
        highestProfitRate: null,
        lowestProfitRate: null,
        firstSellIndex: sellIndex,
        lastSellLog: null,
        sellLogs: []
      });
    }

    const position = positionMap.get(identity);
    const qty = Number(log.qty || 0);
    const buyPrice = Number(
      log.buyPrice || buyRecord?.log?.buyPrice || buyRecord?.log?.price || 0
    );
    const profit = Number(log.profit || 0);
    const fillProfitRate = Number(log.profitRate || 0);

    position.soldQty += qty;
    position.sellFillCount += 1;
    position.profit += profit;
    position.soldCost += Math.max(0, buyPrice * qty);
    position.highestProfitRate = position.highestProfitRate === null
      ? fillProfitRate
      : Math.max(position.highestProfitRate, fillProfitRate);
    position.lowestProfitRate = position.lowestProfitRate === null
      ? fillProfitRate
      : Math.min(position.lowestProfitRate, fillProfitRate);
    const resolvedLog = {
      ...log,
      __reportStrategyGroup: strategyGroup
    };
    position.lastSellLog = resolvedLog;
    position.sellLogs.push(resolvedLog);
    resolvedSellLogs.push(resolvedLog);
  });

  const positions = Array.from(positionMap.values()).map(position => {
    const sameCodePositions = Array.from(positionMap.values()).filter(row =>
      row.code === position.code &&
      row.strategyGroup === position.strategyGroup
    );
    const isOpen = (Array.isArray(holdings) ? holdings : []).some(holding => {
      if (
        position.positionId &&
        holding.positionId
      ) {
        return String(holding.positionId) === position.positionId;
      }

      if (
        reportNormalizeCode(holding.code) !== position.code ||
        reportStrategy(holding) !== position.strategyGroup
      ) {
        return false;
      }

      const holdingTime = reportTimestampMs(holding);
      const buyTime = Number(position.buyRecord?.timeMs || 0);
      if (holdingTime > 0 && buyTime > 0) return holdingTime === buyTime;

      return sameCodePositions.length === 1;
    });

    const qtyClosed =
      position.buyQty <= 0 || position.soldQty >= position.buyQty;
    const isClosed = !isOpen && qtyClosed;
    const profitRate = position.soldCost > 0
      ? (position.profit / position.soldCost) * 100
      : Number(position.lastSellLog?.profitRate || 0);

    return {
      ...position,
      profitRate,
      isOpen,
      isClosed,
      isPartialOpen: isOpen && position.soldQty > 0
    };
  });

  return {
    buyRecords: uniqueBuyRecords,
    sellLogs: resolvedSellLogs,
    resolvedSellLogs,
    positions,
    closedPositions: positions.filter(position => position.isClosed),
    partialOpenPositions: positions.filter(position => position.isPartialOpen)
  };
}

function getSavedToken() {
  return fs.readFileSync("token.txt", "utf8").trim();
}

function getBacktestPresetSetting(preset) {
  if (preset === "trend") {
    return {
      name: "추세형",
      targetRate: 5,
      stopRate: -3,
      trailingRate: 3
    };
  }

  if (preset === "short") {
    return {
      name: "단타형",
      targetRate: 2.5,
      stopRate: -1.5,
      trailingRate: 1.5
    };
  }

  if (preset === "safe") {
    return {
      name: "안정형",
      targetRate: 3,
      stopRate: -2,
      trailingRate: 2
    };
  }

  return {
    name: "기본형",
    targetRate: 4,
    stopRate: -2.5,
    trailingRate: 2
  };
}

function runSimpleBacktest(items, presetSetting) {
  if (!items || items.length < 2) {
    return {
      passed: false,
      finalProfitRate: 0,
      winRate: 0,
      tradeCount: 0,
      message: "일봉 데이터 부족"
    };
  }

  let tradeCount = 0;
  let winCount = 0;
  let totalProfitRate = 0;

  for (let i = 1; i < items.length; i++) {
    const prev = items[i - 1];
    const cur = items[i];

    const prevClose = Number(prev.close || 0);
    const close = Number(cur.close || 0);
    const high = Number(cur.high || 0);
    const low = Number(cur.low || 0);

    if (!prevClose || !close || !high || !low) continue;

    const dayRate = ((close - prevClose) / prevClose) * 100;

    if (dayRate <= 0) continue;

    tradeCount++;

    const highRate = ((high - prevClose) / prevClose) * 100;
    const lowRate = ((low - prevClose) / prevClose) * 100;

    let resultRate = dayRate;

    if (highRate >= presetSetting.targetRate) {
      resultRate = presetSetting.targetRate;
    }

    if (lowRate <= presetSetting.stopRate) {
      resultRate = presetSetting.stopRate;
    }

    totalProfitRate += resultRate;

    if (resultRate > 0) {
      winCount++;
    }
  }

  const winRate =
    tradeCount > 0 ? (winCount / tradeCount) * 100 : 0;

  return {
    passed:
      tradeCount >= 2 &&
      totalProfitRate > 0 &&
      winRate >= 40,
    finalProfitRate: totalProfitRate,
    profitRate: totalProfitRate,
    winRate,
    tradeCount
  };
}

app.get("/api/backtest", async (req, res) => {
  try {
    const code = String(req.query.code || "").trim();
    const preset = String(req.query.preset || "trend").trim();
    const days = Number(req.query.days || 30);

    if (!code) {
      return res.status(400).json({
        message: "종목코드가 없습니다."
      });
    }

    const dailyRes = await fetch(
      `http://localhost:${PORT}/api/daily?code=${code}&days=${days}`
    );

    const dailyData = await dailyRes.json();

    if (!dailyRes.ok) {
      return res.status(500).json({
        message: "일봉 조회 실패",
        error: dailyData
      });
    }

    const presetSetting = getBacktestPresetSetting(preset);
    const result = runSimpleBacktest(
      dailyData.items || [],
      presetSetting
    );

    res.json({
      code,
      preset,
      presetName: presetSetting.name,
      days,
      ...result
    });
  } catch (error) {
    console.error("/api/backtest 오류:", error);

    res.status(500).json({
      message: "백테스트 실패",
      error: error.message
    });
  }
});




function calculateDiscoverScore(item) {
  const rate = parseFloat(item.changeRate);
  const volume = Number(item.volume || 0);
  const high = Number(item.high || 0);
  const low = Number(item.low || 0);
  const open = Number(item.open || item.openPrice || 0);
  const currentPrice = Number(item.currentPrice || item.price || 0);

  let score = 0;
  const reasons = [];

  const scoreDetails = {
  rate: 0,
  volume: 0,
  openStrength: 0,
  dayPosition: 0
};

  // 상승률: 기존보다 넓게 허용
  if (!isNaN(rate)) {
    if (rate >= 0.3 && rate <= 5) {
      score += 4;
      scoreDetails.rate += 4;
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
  }

  // 거래량: 10만 이상도 적극 반영
  if (volume >= 1000000) {
    score += 4;
    scoreDetails.volume += 4;
    reasons.push("거래량 100만 이상");
  } else if (volume >= 500000) {
    score += 3;
    scoreDetails.volume += 3;
    reasons.push("거래량 50만 이상");
  } else if (volume >= 100000) {
    score += 2;
    scoreDetails.volume += 2;
    reasons.push("거래량 10만 이상");
  } else if (volume >= 50000) {
    score += 1;
    scoreDetails.volume += 1;
    reasons.push("거래량 5만 이상");
  }

  // 시가 대비 상승이면 가점
  if (open > 0 && currentPrice > open) {
    score += 2;
    scoreDetails.openStrength += 2;
    reasons.push("시가 대비 상승");
  }

  // 당일 위치: 고점 추격을 완전히 막지 않고 감점만
  if (high > 0 && low > 0 && currentPrice > 0) {
    const range = high - low;

    if (range > 0) {
      const closePosition = ((currentPrice - low) / range) * 100;

      if (closePosition >= 40 && closePosition <= 85) {
        score += 2;
        scoreDetails.dayPosition += 2;
        reasons.push("당일 중상단");
      } else if (closePosition > 85 && closePosition <= 96) {
        score += 1;
        scoreDetails.dayPosition += 1;
        reasons.push("고가권 강세");
      } else if (closePosition > 96) {
        score -= 1;
         scoreDetails.dayPosition -= 1;
        reasons.push("고점 추격주의");
      }
    }
  }

  return {
    discoverScore: score,
    discoverReasons: reasons,
    discoverScoreDetails: scoreDetails
  };
}



const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));








/*
 * HOT 후보 API
 *
 * 키움 순위정보 API의 거래량급증(ka10023),
 * 전일대비등락률상위(ka10027), 당일거래량상위(ka10030)를 합친다.
 * 이후 상위 종목의 현재가 상세정보를 조회해 고가·저가·거래량비율을 보완한다.
 */
// 60초 캐시는 5초 스캐너가 같은 가격을 반복 관찰하게 만들어
// 상승 초기의 가격·거래량 변화속도를 0으로 기록했다.
const HOT_API_EARLY_CACHE_MS = 8 * 1000;
const HOT_API_NORMAL_CACHE_MS = 15 * 1000;
// 장초반 OPEN 현재가 조회와 겹칠 때 키움 API가 밀리지 않도록
// HOT 상세보완은 전 시간대 상위 2종목만 수행한다.
// 순위 응답 지연으로 CORE/VOLUME 후보평가가 밀리는 것을 우선 방지한다.
// 나머지는 순위 API 원본값을 써서 후보 발굴 범위는 유지한다.
const HOT_DETAIL_ENRICH_LIMIT = 2;
const HOT_OPEN_DETAIL_ENRICH_LIMIT = 2;
const HOT_DETAIL_ENRICH_DELAY_MS = 400;
const HOT_DETAIL_REQUEST_TIMEOUT_MS = 5 * 1000;
const HOT_KIWOOM_PRICE_TIMEOUT_MS = 3500;
const OPEN_KIWOOM_PRICE_TIMEOUT_MS = 4500;
const FAST_KIWOOM_PRICE_TIMEOUT_MS = 4 * 1000;
const MARKET_KIWOOM_PRICE_TIMEOUT_MS = 4 * 1000;
const TRADING_KIWOOM_PRICE_TIMEOUT_MS = 5 * 1000;
const SELL_KIWOOM_PRICE_TIMEOUT_MS = 5 * 1000;
const KIWOOM_PRICE_REQUEST_TIMEOUT_MS = 8 * 1000;
const HOT_STALE_CACHE_MAX_AGE_MS = 5 * 60 * 1000;
let hotApiCache = {
  cachedAt: 0,
  data: null
};
let hotApiRunningPromise = null;

function getHotApiCacheMs() {
  const hhmm = new Date().toLocaleTimeString("en-GB", {
    timeZone: "Asia/Seoul",
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit"
  }).slice(0, 5);
  return hhmm < "09:30" ? HOT_API_EARLY_CACHE_MS : HOT_API_NORMAL_CACHE_MS;
}

function getHotDetailEnrichLimit() {
  const hhmm = new Date().toLocaleTimeString("en-GB", {
    timeZone: "Asia/Seoul",
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit"
  }).slice(0, 5);
  return hhmm >= "09:00" && hhmm <= "09:30"
    ? HOT_OPEN_DETAIL_ENRICH_LIMIT
    : HOT_DETAIL_ENRICH_LIMIT;
}

function hotToNumber(value) {
  const number = Number(
    String(value ?? 0)
      .replace(/[+,%]/g, "")
      .replace(/,/g, "")
      .trim()
  );
  return Number.isFinite(number) ? number : 0;
}

function findFirstArrayByKeys(data, keys = []) {
  if (!data || typeof data !== "object") return [];

  for (const key of keys) {
    if (Array.isArray(data[key])) return data[key];
  }

  for (const value of Object.values(data)) {
    if (Array.isArray(value) && value.length > 0 && typeof value[0] === "object") {
      return value;
    }
  }

  return [];
}

async function requestKiwoomRank(apiId, body) {
  let token = getSavedToken();
  const url = `${process.env.KIWOOM_BASE_URL}/api/dostk/rkinfo`;

  async function request(currentToken) {
    return axios.post(url, body, {
      headers: {
        "Content-Type": "application/json;charset=UTF-8",
        authorization: `Bearer ${currentToken}`,
        "api-id": apiId
      },
      timeout: 10000
    });
  }

  let result = await request(token);
  let data = result.data || {};

  if (isTokenError(data)) {
    console.log(`[HOT API] ${apiId} 토큰 만료 → 자동 재발급`);
    token = await refreshKiwoomToken();
    result = await request(token);
    data = result.data || {};
  }

  const returnCode = String(data.return_code ?? data.returnCode ?? "0");
  if (returnCode && returnCode !== "0") {
    throw new Error(`${apiId} 실패: ${data.return_msg || data.message || returnCode}`);
  }

  return data;
}

function normalizeHotRankRow(row = {}, source) {
  const code = String(
    row.stk_cd || row.code || row.stockCode || ""
  ).replace(/^A/, "").trim().padStart(6, "0");

  if (!code || code === "000000") return null;

  const currentPrice = Math.abs(hotToNumber(
    row.cur_prc || row.currentPrice || row.price || row.exp_cntr_pric || 0
  ));
  const changeRate = hotToNumber(
    row.flu_rt ?? row.changeRate ?? row.pred_rt ?? 0
  );
  const currentVolume = Math.abs(hotToNumber(
    row.now_trde_qty || row.trde_qty || row.volume || row.exp_cntr_qty || 0
  ));
  const surgeRate = hotToNumber(row.sdnin_rt ?? row.surgeRate ?? 0);

  return {
    code,
    name: row.stk_nm || row.name || code,
    ...getStockMarketMetadata(code, row),
    currentPrice,
    price: currentPrice,
    changeRate,
    volume: currentVolume,
    tradeAmount: Math.abs(hotToNumber(row.trde_amt || row.tradeAmount || 0)),
    tradeVolumeRatio: surgeRate ? Math.max(0, 100 + surgeRate) : 0,
    sources: [source],
    rawRank: row
  };
}

function mergeHotRankRows(groups = []) {
  const map = new Map();

  for (const { source, rows } of groups) {
    for (const raw of rows) {
      const item = normalizeHotRankRow(raw, source);
      if (!item) continue;

      const existing = map.get(item.code);
      if (!existing) {
        map.set(item.code, item);
        continue;
      }

      map.set(item.code, {
        ...existing,
        ...item,
        currentPrice: item.currentPrice || existing.currentPrice,
        price: item.currentPrice || existing.currentPrice,
        changeRate: item.changeRate || existing.changeRate,
        volume: Math.max(existing.volume || 0, item.volume || 0),
        tradeAmount: Math.max(existing.tradeAmount || 0, item.tradeAmount || 0),
        tradeVolumeRatio: Math.max(
          existing.tradeVolumeRatio || 0,
          item.tradeVolumeRatio || 0
        ),
        sources: Array.from(new Set([...(existing.sources || []), source])),
        rawRank: {
          ...(existing.rawRank || {}),
          ...(item.rawRank || {})
        }
      });
    }
  }

  return Array.from(map.values());
}

function selectHotCoverage(rows = [], limit = 50) {
  const safeLimit = Math.max(1, Math.min(60, Number(limit || 50)));
  const earlyQuota = Math.max(10, Math.ceil(safeLimit * 0.40));
  const multiSourceQuota = Math.max(10, Math.ceil(safeLimit * 0.40));
  const changeQuota = Math.max(5, safeLimit - earlyQuota - multiSourceQuota);
  const tradeAmountOf = item => Math.max(
    Number(item.tradeAmount || 0),
    Number(item.currentPrice || 0) * Number(item.volume || 0)
  );
  const sourceFirstSort = (a, b) =>
    (b.sources?.length || 0) - (a.sources?.length || 0) ||
    Number(b.tradeVolumeRatio || 0) - Number(a.tradeVolumeRatio || 0) ||
    tradeAmountOf(b) - tradeAmountOf(a) ||
    Number(b.changeRate || 0) - Number(a.changeRate || 0);
  const earlySort = (a, b) =>
    (b.sources?.length || 0) - (a.sources?.length || 0) ||
    Number(b.tradeVolumeRatio || 0) - Number(a.tradeVolumeRatio || 0) ||
    tradeAmountOf(b) - tradeAmountOf(a) ||
    Number(b.changeRate || 0) - Number(a.changeRate || 0);
  const changeSort = (a, b) =>
    Number(b.changeRate || 0) - Number(a.changeRate || 0) ||
    (b.sources?.length || 0) - (a.sources?.length || 0) ||
    tradeAmountOf(b) - tradeAmountOf(a);

  const selected = new Map();
  const append = (items, quota = Infinity, coverageGroup = "FILL") => {
    let added = 0;
    for (const item of items) {
      if (selected.size >= safeLimit || added >= quota) break;
      if (selected.has(item.code)) continue;
      selected.set(item.code, { ...item, hotCoverageGroup: coverageGroup });
      added++;
    }
  };

  append(
    rows
      .filter(item => Number(item.changeRate || 0) >= 0.5 && Number(item.changeRate || 0) <= 8)
      .sort(earlySort),
    earlyQuota,
    "EARLY"
  );
  append([...rows].sort(sourceFirstSort), multiSourceQuota, "MULTI_SOURCE");
  append([...rows].sort(changeSort), changeQuota, "CHANGE_RATE");
  append([...rows].sort(sourceFirstSort), Infinity, "FILL");
  return Array.from(selected.values()).slice(0, safeLimit);
}

async function enrichHotCandidate(item) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    HOT_DETAIL_REQUEST_TIMEOUT_MS
  );

  try {
    const priceRes = await fetch(
      `http://localhost:${PORT}/api/price?code=${encodeURIComponent(item.code)}&source=hot`,
      { signal: controller.signal }
    );
    const priceData = await priceRes.json();

    if (!priceRes.ok) {
      throw new Error(priceData.message || `현재가 API ${priceRes.status}`);
    }

    const raw = priceData.raw || {};
    const trdePreRaw = raw.trde_pre ?? priceData.trde_pre ?? null;
    const previousDayVolumeRatio =
      trdePreRaw !== null && trdePreRaw !== ""
        ? Math.max(0, 100 + hotToNumber(trdePreRaw))
        : 0;

    return {
      ...item,
      name: priceData.name || item.name,
      currentPrice: Math.abs(hotToNumber(priceData.currentPrice || item.currentPrice)),
      price: Math.abs(hotToNumber(priceData.currentPrice || item.currentPrice)),
      changeRate: hotToNumber(priceData.changeRate ?? item.changeRate),
      volume: Math.abs(hotToNumber(priceData.volume || item.volume)),
      open: Math.abs(hotToNumber(priceData.open || raw.open_pric || 0)),
      high: Math.abs(hotToNumber(priceData.high || raw.high_pric || 0)),
      low: Math.abs(hotToNumber(priceData.low || raw.low_pric || 0)),
      tradeVolumeRatio: Math.max(
        Number(item.tradeVolumeRatio || 0),
        previousDayVolumeRatio
      ),
      trde_pre: trdePreRaw,
      raw: {
        ...raw,
        trde_pre: trdePreRaw
      }
    };
  } catch (err) {
    console.warn(
      `[HOT API 상세조회 실패] ${item.code} / ` +
      `${err.name === "AbortError" ? `${Math.round(HOT_DETAIL_REQUEST_TIMEOUT_MS / 1000)}초 시간초과` : err.message} / ` +
      `순위 API 원본값 유지`
    );
    return item;
  } finally {
    clearTimeout(timer);
  }
}

async function buildHotCandidates(limit) {
  const startedAt = Date.now();
  const safeLimit = Math.max(1, Math.min(50, Number(limit || 30)));

  const requests = [
    {
      apiId: "ka10023",
      source: "VOLUME_SURGE",
      keys: ["trde_qty_sdnin", "items", "output"],
      body: {
        mrkt_tp: "000",
        sort_tp: "2",
        tm_tp: "1",
        trde_qty_tp: "10",
        tm: "5",
        stk_cnd: "20",
        pric_tp: "8",
        stex_tp: "3"
      }
    },
    {
      apiId: "ka10027",
      source: "CHANGE_RATE",
      keys: ["pred_pre_flu_rt_upper", "items", "output"],
      body: {
        mrkt_tp: "000",
        sort_tp: "1",
        trde_qty_cnd: "0010",
        stk_cnd: "4",
        crd_cnd: "0",
        updown_incls: "0",
        pric_cnd: "8",
        trde_prica_cnd: "10",
        stex_tp: "3"
      }
    },
    {
      apiId: "ka10030",
      source: "TODAY_VOLUME",
      keys: ["tdy_trde_qty_upper", "items", "output"],
      body: {
        mrkt_tp: "000",
        sort_tp: "1",
        trde_qty_cnd: "10",
        stk_cnd: "4",
        crd_cnd: "0",
        pric_cnd: "8",
        stex_tp: "3"
      }
    }
  ];

  const settled = await Promise.allSettled(
    requests.map(async request => {
      const data = await requestKiwoomRank(request.apiId, request.body);
      return {
        source: request.source,
        rows: findFirstArrayByKeys(data, request.keys)
      };
    })
  );
  const rankElapsedMs = Date.now() - startedAt;

  const groups = [];
  const errors = [];

  settled.forEach((result, index) => {
    if (result.status === "fulfilled") {
      groups.push(result.value);
    } else {
      errors.push(`${requests[index].apiId}: ${result.reason?.message || "실패"}`);
    }
  });

  if (groups.length === 0) {
    throw new Error(`키움 HOT 순위조회 전체 실패 / ${errors.join(" | ")}`);
  }

  const mergedAll = mergeHotRankRows(groups)
    .filter(item => item.currentPrice > 0)
    .filter(item => item.changeRate > 0);
  const merged = selectHotCoverage(
    mergedAll,
    Math.min(60, safeLimit + 10)
  );

  const detailStartedAt = Date.now();
  const detailEnrichLimit = getHotDetailEnrichLimit();
  const enriched = [];
  for (let index = 0; index < merged.length; index++) {
    const item = merged[index];

    if (index < detailEnrichLimit) {
      enriched.push(await enrichHotCandidate(item));

      if (index < detailEnrichLimit - 1) {
        await sleep(HOT_DETAIL_ENRICH_DELAY_MS);
      }
    } else {
      // 순위 API 원본값을 그대로 사용해 현재가 상세조회 호출량을 제한한다.
      enriched.push(item);
    }
  }

  const items = selectHotCoverage(
    enriched.filter(item => item.currentPrice > 0),
    safeLimit
  );

  const detailElapsedMs = Date.now() - detailStartedAt;
  const totalElapsedMs = Date.now() - startedAt;
  console.log(
    `[HOT API 성능] 순위 ${(rankElapsedMs / 1000).toFixed(1)}초 / ` +
    `상세 ${(detailElapsedMs / 1000).toFixed(1)}초 / ` +
    `전체 ${(totalElapsedMs / 1000).toFixed(1)}초 / ` +
    `병합원본 ${mergedAll.length}개 / 상세대상 ${merged.length}개 / 결과 ${items.length}개 / ` +
    `순위부분오류 ${errors.length}건`
  );

  return {
    ok: true,
    source: "KIWOOM_RANK_KA10023_KA10027_KA10030",
    updatedAt: new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }),
    count: items.length,
    partialErrors: errors,
    items
  };
}

app.get("/api/hot-candidates", async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(50, Number(req.query.limit || 30)));
    const cacheAge = Date.now() - Number(hotApiCache.cachedAt || 0);

    if (hotApiCache.data && cacheAge <= getHotApiCacheMs()) {
      return res.json({
        ...hotApiCache.data,
        cached: true,
        items: hotApiCache.data.items.slice(0, limit)
      });
    }

    if (!hotApiRunningPromise) {
      hotApiRunningPromise = buildHotCandidates(Math.max(30, limit))
        .then(data => {
          hotApiCache = { cachedAt: Date.now(), data };
          return data;
        })
        .finally(() => {
          hotApiRunningPromise = null;
        });
    }

    const data = await hotApiRunningPromise;
    return res.json({
      ...data,
      cached: false,
      items: data.items.slice(0, limit)
    });
  } catch (error) {
    console.error("/api/hot-candidates 오류:", error);

    const staleAgeMs = Date.now() - Number(hotApiCache.cachedAt || 0);
    if (
      hotApiCache.data &&
      staleAgeMs >= 0 &&
      staleAgeMs <= HOT_STALE_CACHE_MAX_AGE_MS
    ) {
      const fallbackLimit = Math.max(
        1,
        Math.min(50, Number(req.query.limit || 30))
      );
      console.warn(
        `[HOT API 캐시대체] 신규조회 실패 / ` +
        `캐시 ${Math.round(staleAgeMs / 1000)}초 / ` +
        `${error.message}`
      );
      return res.json({
        ...hotApiCache.data,
        ok: true,
        cached: true,
        staleFallback: true,
        cacheAgeMs: staleAgeMs,
        partialErrors: [
          ...(hotApiCache.data.partialErrors || []),
          `신규조회 실패: ${error.message}`
        ],
        items: (hotApiCache.data.items || []).slice(0, fallbackLimit)
      });
    }

    return res.status(500).json({
      ok: false,
      message: "HOT 후보 조회 실패",
      error: error.message,
      items: []
    });
  }
});

app.get("/api/discover", async (req, res) => {
  try {
    const scanLimit = Math.max(1, Math.min(60, Number(req.query.scanLimit || 40)));
    const resultLimit = Math.max(1, Math.min(60, Number(req.query.limit || 40)));
    const offset = Math.max(0, Number(req.query.offset || 0));
    const requestSource = String(req.query.source || "market").toLowerCase();
    const budgetMs = Math.max(0, Math.min(30000, Number(req.query.budgetMs || 0)));
    const startedAtMs = Date.now();

    const targets = STOCK_MASTER.slice(offset, offset + scanLimit);

    console.log(
      `[DISCOVER] offset=${offset} scan=${scanLimit} total=${STOCK_MASTER.length} / ` +
      `source=${requestSource} / budget=${budgetMs || "none"}ms`
    );

    const marketItems = [];
    let processedCount = 0;

    for (const stock of targets) {
      if (budgetMs > 0 && processedCount > 0 && Date.now() - startedAtMs >= budgetMs) {
        break;
      }

      processedCount += 1;
      try {
        // /api/price 내부 큐가 키움 현재가 요청 간격을 직렬 제어한다.
        // OPEN 일반검색은 open-discover 저우선순위로 넣어 실제 후보 재확인을 방해하지 않는다.
        const priceRes = await fetch(
          `http://localhost:${PORT}/api/price?code=${stock.code}&source=${encodeURIComponent(requestSource)}`
        );

        const priceData = await priceRes.json();
        if (!priceRes.ok) continue;

        const scoreInfo = calculateDiscoverScore(priceData);
        marketItems.push({
          ...priceData,
          ...getStockMarketMetadata(stock.code, stock),
          ...scoreInfo
        });
      } catch (err) {
        console.warn("발굴 개별 종목 실패:", stock.code, err.message);
      }
    }

    const nextOffset =
      offset + processedCount >= STOCK_MASTER.length
        ? 0
        : offset + processedCount;

    const sorted = marketItems
      .filter((item) => Number(item.discoverScore || 0) > 0)
      .sort(
        (a, b) =>
          Number(b.discoverScore || 0) -
          Number(a.discoverScore || 0)
      );

    res.json({
      offset,
      nextOffset,
      totalStocks: STOCK_MASTER.length,
      requestedScanCount: targets.length,
      scanCount: processedCount,
      marketCount: marketItems.length,
      elapsedMs: Date.now() - startedAtMs,
      budgetStopped: processedCount < targets.length,
      requestSource,
      // 시장온도는 발견점수 0점 종목도 포함해야 상승 후보 편향이 생기지 않는다.
      marketItems,
      count: sorted.length,
      items: sorted.slice(0, resultLimit)
    });
  } catch (error) {
    console.error("/api/discover 오류:", error);

    res.status(500).json({
      message: "자동발굴 실패",
      error: error.message
    });
  }
});

async function refreshKiwoomToken() {
  const url = `${process.env.KIWOOM_BASE_URL}/oauth2/token`;

  const result = await axios.post(
    url,
    {
      grant_type: "client_credentials",
      appkey: process.env.KIWOOM_APP_KEY,
      secretkey: process.env.KIWOOM_SECRET_KEY
    },
    {
      headers: {
        "Content-Type": "application/json;charset=UTF-8"
      }
    }
  );

  const token =
    result.data.token ||
    result.data.access_token ||
    result.data.accessToken;

  if (!token) {
    throw new Error("토큰 발급 실패: " + JSON.stringify(result.data));
  }

  fs.writeFileSync("token.txt", token, "utf8");

  console.log("키움 토큰 자동 갱신 완료");

  return token;
}

function isTokenError(data) {
  const msg = String(data?.return_msg || data?.message || "");
  const code = String(data?.return_code || "");

  return (
    code === "3" &&
    msg.includes("Token")
  ) || msg.includes("Token이 유효하지 않습니다");
}

function cleanNumber(value) {
  if (!value) return "";
  return String(value).replace(/[+-]/g, "");
}

app.get("/", (req, res) => {
  res.send("Kiwoom Auto Trader Server is running");
});


app.get("/api/status", (req, res) => {
  res.json({
    ok: true,
    server: "kiwoom-server",
    file: __filename,
    cwd: process.cwd(),
    time: new Date().toLocaleString("ko-KR")
  });
});


// ============================================================
// SY Quant MASTER 단일계좌 요약
// ============================================================
app.get("/api/portfolio-summary", (req, res) => {
  try {
    const state = loadPaperState();
    portfolioManager.ensureMasterState(state);

    // 기존 상태파일에 portfolioControl/masterAccount가 없으면
    // 최초 조회 시 안전하게 기본값을 한 번 저장한다.
    savePaperState(state);

    res.json({
      ok: true,
      ...portfolioManager.getPortfolioSummary(state)
    });
  } catch (err) {
    console.error("[/api/portfolio-summary 오류]", err);
    res.status(500).json({
      ok: false,
      message: err.message
    });
  }
});


// ============================================================
// SY Quant MASTER 전략 신규매수 제어
// - portfolioControl.status=PAUSED는 신규매수만 막는다.
// - 기존 보유종목의 손절/트레일링/시간청산 등 매도 위험관리는 계속 동작한다.
// ============================================================
app.post("/api/portfolio-strategy-status", express.json(), (req, res) => {
  try {
    const strategy = portfolioManager.normalizeStrategy(req.body?.strategy);
    const status = String(req.body?.status || "").trim().toUpperCase();

    if (!strategy) {
      return res.status(400).json({
        ok: false,
        message: "strategy는 OPEN / CORE / VOLUME / WAVE / FAST 중 하나여야 합니다."
      });
    }

    if (!["ACTIVE", "PAUSED"].includes(status)) {
      return res.status(400).json({
        ok: false,
        message: "status는 ACTIVE / PAUSED만 허용합니다."
      });
    }

    const result = portfolioManager.withMasterTransaction(state => {
      const changed = portfolioManager.setStrategyControl(
        state,
        strategy,
        { status }
      );

      if (!changed.ok) return changed;

      return {
        ok: true,
        message:
          status === "PAUSED"
            ? `${strategy} 신규매수 PAUSED / 기존 보유 매도관리는 계속`
            : `${strategy} 신규매수 ACTIVE`,
        strategy,
        config: changed.config,
        summary: portfolioManager.getPortfolioSummary(state)
      };
    });

    if (!result?.ok) {
      return res.status(400).json({
        ok: false,
        message: result?.reason || "전략 상태 변경 실패"
      });
    }

    return res.json(result);
  } catch (error) {
    console.error("[/api/portfolio-strategy-status 오류]", error);
    return res.status(500).json({
      ok: false,
      message: error.message
    });
  }
});

app.post("/api/portfolio-all-strategies-status", express.json(), (req, res) => {
  try {
    const status = String(req.body?.status || "").trim().toUpperCase();

    if (!["ACTIVE", "PAUSED"].includes(status)) {
      return res.status(400).json({
        ok: false,
        message: "status는 ACTIVE / PAUSED만 허용합니다."
      });
    }

    const result = portfolioManager.withMasterTransaction(state => {
      const changed = portfolioManager.setAllStrategyStatus(state, status);
      if (!changed.ok) return changed;

      return {
        ok: true,
        message:
          status === "PAUSED"
            ? "5개 전략 신규매수 전체 PAUSED / 기존 보유 매도관리는 계속"
            : "5개 전략 신규매수 전체 ACTIVE",
        status,
        strategies: changed.strategies,
        summary: portfolioManager.getPortfolioSummary(state)
      };
    });

    if (!result?.ok) {
      return res.status(400).json({
        ok: false,
        message: result?.reason || "전체 전략 상태 변경 실패"
      });
    }

    return res.json(result);
  } catch (error) {
    console.error("[/api/portfolio-all-strategies-status 오류]", error);
    return res.status(500).json({
      ok: false,
      message: error.message
    });
  }
});

app.get("/api/token/refresh", async (req, res) => {
  try {
    const token = await refreshKiwoomToken();

    res.json({
      ok: true,
      message: "토큰 갱신 완료",
      tokenLength: token.length,
      time: new Date().toLocaleString("ko-KR")
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: "토큰 갱신 실패",
      error: error.message
    });
  }
});

app.get("/api/search", (req, res) => {
  try {
    const keyword = String(req.query.keyword || "").trim();

    if (!keyword) {
      return res.json({ items: [] });
    }

    const normalizedKeyword = keyword.replace(/\s/g, "").toLowerCase();

    const matched = STOCK_MASTER
  .filter((item) => {

    const name = String(
      item.name || item.stk_nm || ""
    )
      .replace(/\s/g, "")
      .toLowerCase();

    const code = String(
      item.code || item.stk_cd || ""
    );

    return (
      name.includes(normalizedKeyword) ||
      code.includes(normalizedKeyword)
    );
  })
  .slice(0, 30)
  .map((item) => ({
    code: String(item.code || item.stk_cd || ""),
    name: String(item.name || item.stk_nm || "")
  }));

    return res.json({ items: matched });
  } catch (error) {
    console.error("/api/search 오류:", error);
    return res.status(500).json({
      message: "종목 검색 실패",
      error: error.message
    });
  }
});

app.post("/api/core-paper-buy", express.json(), (req, res) => {
  try {
    const {
      code,
      name,
      price,
      qty,
      strategyGroup,
      reason,
      openDiagnostic,
      openMaxHoldingCount,
      positionId,
      executionId,
      buyRequestedAtMs
    } = req.body || {};

    if (!code || !price || !qty) {
      return res.status(400).json({
        ok: false,
        message: "code, price, qty 필요"
      });
    }

    const normalizedCode = normalizeOpenStockCode(code);
    const normalizedStrategy = String(strategyGroup || "CORE").toUpperCase();
    const safeDiagnostic =
      openDiagnostic && typeof openDiagnostic === "object"
        ? openDiagnostic
        : {};

    if (!normalizedCode) {
      return res.status(400).json({
        ok: false,
        message: `종목코드 형식 오류 ${String(code || "")}`
      });
    }

    // 매수 원장 변경은 portfolio-manager의 단일 MASTER 트랜잭션에서만 수행한다.
    // 예전처럼 API 바깥에서 acquireMasterLock() 후 sharedSavePaperState()를 호출하면
    // 다른 전략의 짧은 원장 갱신과 충돌해 OPEN 실매수 요청이 잠금 시간초과로 실패할 수 있다.
    const masterBuyStartedAtMs = Date.now();
    const result = portfolioManager.withMasterTransaction(state => {
      portfolioManager.ensureMasterState(state);

      if (!Array.isArray(state.holdings)) state.holdings = [];
      if (!Array.isArray(state.tradeLogs)) state.tradeLogs = [];

      const today = new Date().toLocaleDateString("sv-SE", {
        timeZone: "Asia/Seoul"
      });
      const requestedAtMs = Number(buyRequestedAtMs || Date.now());
      const resolvedPositionId = String(
        positionId || `${today}_${normalizedCode}_${requestedAtMs}`
      );
      const resolvedExecutionId = String(
        executionId || `BUY_${resolvedPositionId}`
      );
      const buyTimeText = new Date(requestedAtMs).toLocaleString(
        "ko-KR",
        { timeZone: "Asia/Seoul" }
      );

      // OPEN 내부 HTTP 재시도는 같은 executionId/positionId를 사용한다.
      // 첫 요청이 저장까지 끝났지만 응답만 유실된 경우 두 번째 요청을
      // 중복매수 오류로 처리하지 않고 기존 체결을 성공으로 복구한다.
      if (executionId) {
        const existingExecutionLog = state.tradeLogs.find(log =>
          String(log.executionId || "") === resolvedExecutionId &&
          normalizeOpenStockCode(log.code) === normalizedCode
        );
        if (existingExecutionLog) {
          return {
            ok: true,
            duplicateRecovered: true,
            message: "이미 처리된 동일 매수요청 복구",
            holdingCount: state.holdings.length,
            totalCash: Number(state.totalCash || 0),
            openBuyCount: Number(state.openBuyCount || 0),
            openCompleted: state.openCompleted === true,
            positionId: resolvedPositionId,
            executionId: resolvedExecutionId
          };
        }
      }

      if (
        state.holdings.some(
          holding => normalizeOpenStockCode(holding.code) === normalizedCode
        )
      ) {
        return {
          ok: false,
          status: 409,
          message: `동일 종목 이미 보유중 ${name || normalizedCode}(${normalizedCode})`
        };
      }

      if (
        normalizedStrategy === "OPEN" &&
        state.tradeLogs.some(log =>
          String(log.date || "").slice(0, 10) === today &&
          log.type === "OPEN_BUY" &&
          normalizeOpenStockCode(log.code) === normalizedCode
        )
      ) {
        return {
          ok: false,
          status: 409,
          message: `오늘 이미 OPEN 매수한 종목 ${name || normalizedCode}(${normalizedCode})`
        };
      }

      const buyAmount = Number(price) * Number(qty);
      const availableCash = Number(state.totalCash || 0);

      if (buyAmount <= 0 || buyAmount > availableCash) {
        return {
          ok: false,
          status: 400,
          message:
            `매수금액 또는 현금 부족 / 주문 ${buyAmount.toLocaleString()}원 / ` +
            `현금 ${availableCash.toLocaleString()}원`
        };
      }

      const masterBuyCheck = portfolioManager.canBuy(state, {
        strategy: normalizedStrategy,
        code: normalizedCode,
        price: Number(price),
        requestedAmount: buyAmount
      });

      if (!masterBuyCheck.ok) {
        console.log(
          `[MASTER 매수차단] ${normalizedStrategy} / ` +
          `${name || normalizedCode}(${normalizedCode}) / ` +
          `${masterBuyCheck.reason}`
        );

        return {
          ok: false,
          status: 409,
          masterBlocked: true,
          message: masterBuyCheck.reason,
          portfolio: masterBuyCheck.availability || null
        };
      }

      state.holdings.push({
        code: normalizedCode,
        name: name || normalizedCode,
        strategyGroup: normalizedStrategy,
        strategy: normalizedStrategy,
        ownerStrategy: normalizedStrategy,
        buyPrice: Number(price),
        currentPrice: Number(price),
        highestPrice: Number(price),
        lowestPrice: Number(price),
        qty: Number(qty),
        buyAmount,
        positionId: resolvedPositionId,
        buyTime: requestedAtMs,
        buyTimeText,
        buyTimeMs: requestedAtMs,
        buyAt: new Date(requestedAtMs).toISOString(),
        date: today,
        ...safeDiagnostic,
        ...(normalizedStrategy === "OPEN"
          ? { openBuyDiagnostic: safeDiagnostic }
          : {})
      });

      state.totalCash = Number(state.totalCash || 0) - buyAmount;

      state.tradeLogs.push({
        type: `${normalizedStrategy}_BUY`,
        strategyGroup: normalizedStrategy,
        strategy: normalizedStrategy,
        ownerStrategy: normalizedStrategy,
        code: normalizedCode,
        name: name || normalizedCode,
        price: Number(price),
        buyPrice: Number(price),
        qty: Number(qty),
        buyAmount,
        positionId: resolvedPositionId,
        executionId: resolvedExecutionId,
        timestampMs: requestedAtMs,
        reason,
        date: today,
        time: buyTimeText,
        ...safeDiagnostic,
        ...(normalizedStrategy === "OPEN"
          ? { openBuyDiagnostic: safeDiagnostic }
          : {})
      });

      if (normalizedStrategy === "OPEN") {
        const openBuyCount = state.tradeLogs.filter(log =>
          String(log.date || "").slice(0, 10) === today &&
          log.type === "OPEN_BUY"
        ).length;
        const maxHoldingCount = Math.max(1, Number(openMaxHoldingCount || 1));

        state.openSkipped = false;
        state.openSkipReason = null;
        state.openBuyAt = buyTimeText;
        state.openBuyCode = normalizedCode;
        state.openBuyName = name || normalizedCode;
        if (!Array.isArray(state.openBuyCodes)) state.openBuyCodes = [];
        if (!Array.isArray(state.openBuyNames)) state.openBuyNames = [];
        if (!state.openBuyCodes.includes(normalizedCode)) {
          state.openBuyCodes.push(normalizedCode);
        }
        if (!state.openBuyNames.includes(state.openBuyName)) {
          state.openBuyNames.push(state.openBuyName);
        }
        state.openBuyCount = openBuyCount;
        state.openCompleted = openBuyCount >= maxHoldingCount;
        state.openCompletedAt = state.openCompleted ? state.openBuyAt : null;

        if (state.openDailyStats?.date === today) {
          if (
            !state.openDailyStats.boughtCodes ||
            typeof state.openDailyStats.boughtCodes !== "object"
          ) {
            state.openDailyStats.boughtCodes = {};
          }
          state.openDailyStats.boughtCodes[normalizedCode] = state.openBuyName;
        }
      }

      return {
        ok: true,
        message: "paper buy 완료",
        holdingCount: state.holdings.length,
        totalCash: state.totalCash,
        openBuyCount: Number(state.openBuyCount || 0),
        openCompleted: state.openCompleted === true,
        positionId: resolvedPositionId,
        executionId: resolvedExecutionId
      };
    }, {
      // 100ms급 짧은 충돌로 실매수 요청을 버리지 않도록 충분한 획득시간을 둔다.
      // 트랜잭션 자체는 동기 파일갱신만 수행하므로 실제 잠금 점유시간은 매우 짧다.
      timeoutMs: 3000,
      staleMs: 15000
    });

    const masterBuyElapsedMs = Date.now() - masterBuyStartedAtMs;
    if (masterBuyElapsedMs >= 250) {
      console.warn(
        `[MASTER 매수트랜잭션 지연] ${normalizedStrategy} / ` +
        `${name || normalizedCode}(${normalizedCode}) / ${masterBuyElapsedMs}ms`
      );
    }

    if (!result?.ok) {
      return res.status(Number(result?.status || 409)).json({
        ok: false,
        masterBlocked: result?.masterBlocked === true,
        message: result?.message || result?.reason || "매수 처리 실패",
        portfolio: result?.portfolio || null
      });
    }

    return res.json(result);
  } catch (err) {
    const message = err?.message || "알 수 없는 오류";
    const masterLockTimeout = /MASTER 계좌 잠금 시간초과/i.test(message);

    console.error("[/api/core-paper-buy 오류]", {
      message,
      code: err?.code || err?.cause?.code || null,
      cause: err?.cause?.message || null,
      masterLockTimeout,
      stack: err?.stack || null
    });

    if (masterLockTimeout) {
      return res.status(503).json({
        ok: false,
        retryable: true,
        code: "MASTER_LOCK_TIMEOUT",
        message
      });
    }

    return res.status(500).json({
      ok: false,
      retryable: false,
      message
    });
  }
});

function serverHoldingPositionToken(holding = {}) {
  const rawToken =
    holding.positionId || holding.buyTime || holding.buyTimeMs ||
    holding.buyAt || holding.buyTimeText || "legacy";
  return String(rawToken).replace(/[^0-9A-Za-z_-]/g, "_").slice(-100);
}

function serverCompletedFullSellKey(holding = {}, date = todayKstKey()) {
  const code = normalizeOpenStockCode(holding.code);
  return `${date}_${code}_${serverHoldingPositionToken(holding)}`;
}

app.post("/api/core-paper-sell", express.json(), (req, res) => {
  try {
    const {
      code,
      price,
      qty,
      sellType,
      reason,
      manualSell,
      manualRequestId,
      signalAt,
      signalAtMs,
      signalPrice,
      positionId,
      executionId,
      sellRequestedAtMs
    } = req.body || {};

    if (!code || !price || !qty) {
      return res.status(400).json({
        ok: false,
        message: "code, price, qty 필요"
      });
    }

    const state = loadPaperState();

    if (!Array.isArray(state.holdings)) state.holdings = [];
    if (!Array.isArray(state.tradeLogs)) state.tradeLogs = [];
    if (!Array.isArray(state.virtualResults)) state.virtualResults = [];
    if (!Array.isArray(state.completedOpenSellCodes)) state.completedOpenSellCodes = [];
    if (!Array.isArray(state.completedFullSellCodes)) state.completedFullSellCodes = [];

    const normalizedCode = normalizeOpenStockCode(code);
    const date = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
    const completedKey = `${date}_${normalizedCode}`;

    if (String(sellType || "").startsWith("OPEN_") && state.completedOpenSellCodes.includes(completedKey)) {
      // 완료기록이 있는데 오래된 OPEN 보유가 되살아난 경우 원장에서도 즉시 제거한다.
      const staleOpenHoldings = state.holdings.filter(h =>
        String(h.strategyGroup || "").toUpperCase() === "OPEN" &&
        normalizeOpenStockCode(h.code) === normalizedCode
      );
      if (staleOpenHoldings.length > 0) {
        for (const staleHolding of staleOpenHoldings) {
          const fullKey = serverCompletedFullSellKey(staleHolding, date);
          if (!state.completedFullSellCodes.includes(fullKey)) {
            state.completedFullSellCodes.push(fullKey);
          }
        }
        state.completedFullSellCodes = state.completedFullSellCodes.slice(-500);
        state.holdings = state.holdings.filter(h => !staleOpenHoldings.includes(h));
        savePaperState(state);
        console.warn(
          `[OPEN 중복매도 원장복구] ${normalizedCode} / stale 보유 ${staleOpenHoldings.length}건 제거`
        );
      }

      return res.json({
        ok: true,
        duplicateIgnored: true,
        message: `이미 전량 매도 완료 ${normalizedCode}`,
        profit: 0,
        profitRate: 0,
        totalCash: Number(state.totalCash || 0)
      });
    }

    const holding = state.holdings.find(h =>
      positionId && h.positionId
        ? String(h.positionId) === String(positionId)
        : normalizeOpenStockCode(h.code) === normalizedCode
    );

    if (!holding) {
      return res.status(404).json({
        ok: false,
        message: "보유종목 없음"
      });
    }

    const sellQty = Math.min(Number(qty), Number(holding.qty || 0));
    const buyPrice = Number(holding.buyPrice || 0);
    const sellPrice = Number(price);
    const profit = Math.floor((sellPrice - buyPrice) * sellQty);
    const profitRate = buyPrice > 0
      ? ((sellPrice - buyPrice) / buyPrice) * 100
      : 0;

    holding.qty -= sellQty;
    state.totalCash = Number(state.totalCash || 0) + sellPrice * sellQty;

    const requestedAtMs = Number(sellRequestedAtMs || Date.now());
    const resolvedPositionId = String(
      positionId || holding.positionId || ""
    ) || null;
    const resolvedExecutionId = String(
      executionId ||
      `SELL_${resolvedPositionId || completedKey}_${requestedAtMs}_${sellQty}`
    );
    const time = new Date(requestedAtMs).toLocaleString(
      "ko-KR",
      { timeZone: "Asia/Seoul" }
    );

    state.tradeLogs.push({
      type: sellType || `${holding.strategyGroup}_SELL`,
      strategyGroup: holding.strategyGroup,
      code: holding.code,
      name: holding.name,
      buyPrice,
      sellPrice,
      price: sellPrice,
      qty: sellQty,
      positionId: resolvedPositionId,
      executionId: resolvedExecutionId,
      timestampMs: requestedAtMs,
      buyTime: Number(holding.buyTime || holding.buyTimeMs || 0),
      profit,
      profitRate,
      reason,
      signalAt: signalAt || null,
      signalAtMs: Number(signalAtMs || 0),
      signalPrice: Number(signalPrice || sellPrice || 0),
      highestPrice: Number(holding.highestPrice || sellPrice || 0),
      lowestPrice: Number(holding.lowestPrice || sellPrice || 0),
      openBuyDiagnostic: holding.openBuyDiagnostic || null,
      manualSell: manualSell === true,
      manualRequestId: manualRequestId || null,
      date,
      time
    });

    state.virtualResults.push({
      code: holding.code,
      name: holding.name,
      strategyGroup: holding.strategyGroup,
      buyPrice,
      sellPrice,
      qty: sellQty,
      profit,
      profitRate,
      reason,
      sellType: sellType || `${holding.strategyGroup}_SELL`,
      positionId: resolvedPositionId,
      executionId: resolvedExecutionId,
      timestampMs: requestedAtMs,
      manualSell: manualSell === true,
      manualRequestId: manualRequestId || null,
      date,
      sellTime: new Date().toISOString()
    });

    if (holding.qty <= 0) {
      state.holdings = state.holdings.filter(h => h !== holding);

      const completedFullKey = serverCompletedFullSellKey(holding, date);
      if (!state.completedFullSellCodes.includes(completedFullKey)) {
        state.completedFullSellCodes.push(completedFullKey);
        state.completedFullSellCodes = state.completedFullSellCodes.slice(-500);
      }

      if (String(sellType || "").startsWith("OPEN_") && !state.completedOpenSellCodes.includes(completedKey)) {
        state.completedOpenSellCodes.push(completedKey);
        state.completedOpenSellCodes = state.completedOpenSellCodes.slice(-200);
      }
    }

    savePaperState(state);

    res.json({
      ok: true,
      message: "paper sell 완료",
      profit,
      profitRate,
      totalCash: state.totalCash
    });

  } catch (err) {
    res.status(500).json({
      ok: false,
      message: err.message
    });
  }
});

app.post("/api/manual-paper-sell", express.json(), async (req, res) => {
  const code = String(req.body?.code || "")
    .replace(/^A/, "")
    .trim()
    .padStart(6, "0");

  if (!code || code === "000000") {
    return res.status(400).json({
      ok: false,
      message: "매도할 종목코드가 없습니다."
    });
  }

  try {
    // server.js는 보유여부만 읽고 paper-state-core.json을 수정하지 않는다.
    const state = loadPaperState();
    const holding = (state.holdings || []).find(h =>
      String(h.code || "").replace(/^A/, "").padStart(6, "0") === code
    );

    if (!holding || Number(holding.qty || 0) <= 0) {
      return res.status(404).json({
        ok: false,
        message: "매도 가능한 보유종목이 없습니다."
      });
    }

    // 동일 종목의 살아 있는 요청만 차단하고, 오래된 고아 요청은 자동 삭제한다.
    const nowMs = Date.now();
    let activeRequest = false;

    for (const name of fs.readdirSync(MANUAL_SELL_REQUEST_DIR)) {
      if (!(name.endsWith(".json") || name.endsWith(".json.processing"))) continue;

      const requestFile = path.join(MANUAL_SELL_REQUEST_DIR, name);
      try {
        const stat = fs.statSync(requestFile);
        const ageMs = nowMs - stat.mtimeMs;

        if (ageMs > MANUAL_SELL_REQUEST_TTL_MS) {
          fs.unlinkSync(requestFile);
          console.log(`[수동매도 오래된 요청 정리] ${name} / ${Math.floor(ageMs / 1000)}초`);
          continue;
        }

        const request = readJsonFileSafe(requestFile, null, 1);
        if (String(request?.code || "").padStart(6, "0") === code) {
          activeRequest = true;
          break;
        }
      } catch (_) {}
    }

    if (activeRequest) {
      return res.status(409).json({
        ok: false,
        message: "해당 종목은 이미 수동 매도 요청이 진행 중입니다."
      });
    }

    const requestId =
      `MANUAL-${Date.now()}-${process.pid}-` +
      Math.random().toString(36).slice(2, 8);
    const requestPath = path.join(
      MANUAL_SELL_REQUEST_DIR,
      `${requestId}.json`
    );
    const resultPath = path.join(
      MANUAL_SELL_RESULT_DIR,
      `${requestId}.json`
    );

    writeJsonFileAtomic(requestPath, {
      requestId,
      code,
      requestedAt: new Date().toLocaleString("ko-KR", {
        timeZone: "Asia/Seoul"
      }),
      requestedAtMs: Date.now(),
      source: "DASHBOARD"
    });

    console.log(
      `[수동매도 접수] ${holding.name}(${code}) / ` +
      `${Number(holding.qty || 0).toLocaleString()}주 / 요청 ${requestId}`
    );

    // CORE 매도루프가 요청을 처리할 때까지 최대 45초 기다린다.
    const deadline = Date.now() + 45 * 1000;
    while (Date.now() < deadline) {
      if (fs.existsSync(resultPath)) {
        const result = readJsonFileSafe(resultPath, null);
        try { fs.unlinkSync(resultPath); } catch (_) {}

        const status = Number(result?.status || (result?.ok ? 200 : 500));
        return res.status(status).json(result || {
          ok: false,
          message: "수동 매도 결과를 읽지 못했습니다."
        });
      }

      await new Promise(resolve => setTimeout(resolve, 250));
    }

    return res.status(504).json({
      ok: false,
      pending: true,
      requestId,
      message:
        "수동 매도 요청은 접수됐지만 처리 결과 확인이 지연되고 있습니다. " +
        "중복 요청하지 말고 잠시 후 보유현황을 새로고침해 주세요."
    });
  } catch (err) {
    console.error("/api/manual-paper-sell 오류:", err);
    return res.status(500).json({
      ok: false,
      message: err.message || "수동 매도 요청 중 오류가 발생했습니다."
    });
  }
});

app.post("/api/token/reissue", (req, res) => {
  exec("cd /home/ubuntu/kiwoom-server && node token.js", (error, stdout, stderr) => {
    if (error) {
      return res.status(500).json({
        ok: false,
        message: "토큰 신규발급 실패",
        error: error.message,
        stderr
      });
    }

    res.json({
      ok: true,
      message: "토큰 신규발급 완료. 서버를 곧 재시작합니다.",
      stdout,
      stderr
    });

    setTimeout(() => {
      exec("pm2 restart kiwwm-server --update-env");
    }, 1000);
  });
});

app.post("/api/server-result-clear", (req, res) => {
  try {
    const state = loadPaperState();

    state.virtualResults = [];
    state.results = [];

    savePaperState(state, { force: true });

    res.json({
      ok: true,
      message: "완료결과를 삭제했습니다."
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error.message
    });
  }
});

app.get("/api/stocks", (req, res) => {
  try {
    const stocks = require("./stocks.json");

    res.json({
      count: stocks.length,
      items: stocks
    });
  } catch (error) {
    res.status(500).json({
      message: "stocks.json 조회 실패",
      error: error.message
    });
  }
});

async function fetchCurrentPriceFromKiwoom(code) {
  const token = getSavedToken();

  const url = `${process.env.KIWOOM_BASE_URL}/api/dostk/stkinfo`;

  const result = await runQueuedKiwoomPriceRequest(() =>
    axios.post(
      url,
      { stk_cd: code },
      {
        headers: {
          "Content-Type": "application/json;charset=UTF-8",
          authorization: `Bearer ${token}`,
          "api-id": "ka10001"
        },
        timeout: KIWOOM_PRICE_REQUEST_TIMEOUT_MS
      }
    ),
    { priority: 90, source: "holding-refresh" }
  );

  const data = result.data;

  return {
    code: data.stk_cd,
    name: data.stk_nm,
    currentPrice: Number(cleanNumber(data.cur_prc)),
    changeRate: data.flu_rt,
    volume: Number(cleanNumber(data.trde_qty)),
    open: Number(cleanNumber(data.open_pric)),
    high: Number(cleanNumber(data.high_pric)),
    low: Number(cleanNumber(data.low_pric)),
    raw: data
  };
}

async function refreshServerHoldingPrices() {
  

  if (!fs.existsSync(PAPER_STATE_FILE)) return;

  const paperState = loadPaperState();

  paperState.holdings = paperState.holdings || [];

  if (paperState.holdings.length === 0) return;

  for (const holding of paperState.holdings) {
    try {
      const priceData = await fetchCurrentPriceFromKiwoom(holding.code);

      const refreshedPrice = Number(
        priceData.currentPrice || holding.currentPrice || holding.buyPrice || 0
      );
      const previousHigh = Number(holding.highestPrice || holding.buyPrice || 0);
      const previousLow = Number(holding.lowestPrice || holding.buyPrice || 0);

      holding.currentPrice = refreshedPrice;
      holding.name = holding.name || priceData.name;
      holding.lastPriceQuoteAtMs = Date.now();

      if (refreshedPrice > previousHigh) {
        holding.highestPrice = refreshedPrice;
        holding.highestPriceAt = Date.now();
      } else {
        holding.highestPrice = Math.max(previousHigh, refreshedPrice);
      }

      holding.lowestPrice = previousLow > 0
        ? Math.min(previousLow, refreshedPrice)
        : refreshedPrice;

await new Promise((resolve) => setTimeout(resolve, 1200));

 } catch (error) {
      console.error(
        "서버 보유종목 현재가 갱신 실패:",
        holding.code,
        error.message
      );
    }
  }

  paperState.lastPriceRefreshAt = new Date().toLocaleString("ko-KR");

  savePaperState(paperState);
}

const priceCache = {};
let lastKiwoomPriceRequestAt = 0;
const kiwoomPriceRequestQueue = [];
let kiwoomPriceWorkerRunning = false;
let kiwoomPriceRequestSequence = 0;
// CORE/VOLUME이 같은 종목을 거의 동시에 재조회하면 하나의 키움 요청을 공유한다.
const tradingPriceInflightByCode = new Map();
// 저우선순위 MARKET/HOT 요청이 과도하게 밀릴 때는 큐에 계속 쌓지 않고
// 즉시 실패시켜 기존 캐시대체 로직이 처리하도록 한다.
const KIWOOM_LOW_PRIORITY_QUEUE_SOFT_LIMIT = 40;
// OPEN 일반 전종목 검색은 실매수 재확인보다 우선순위가 낮다.
// 큐가 이미 밀렸으면 새 ka10001 요청을 추가하지 않고 다음 스캔으로 넘긴다.
const KIWOOM_OPEN_DISCOVER_QUEUE_SOFT_LIMIT = 6;

/*
 * 기존 waitKiwoomPriceLimit은 동시에 들어온 여러 요청이 같은 시간만
 * 기다린 뒤 한꺼번에 출발할 수 있었다. 아래 우선순위 큐는 ka10001 요청을
 * 한 건씩 실행하면서 SELL > OPEN > WAVE > 일반분석 > HOT 순서를 보장한다.
 */
function makePriceQueueError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isQueuedPriceRequestCancelled(request) {
  try {
    return typeof request.shouldCancel === "function" && request.shouldCancel();
  } catch (_) {
    return false;
  }
}

function isQueuedPriceRequestExpired(request) {
  const maxQueueWaitMs = Number(request.maxQueueWaitMs || 0);
  if (maxQueueWaitMs <= 0) return false;
  return Date.now() - Number(request.queuedAtMs || Date.now()) > maxQueueWaitMs;
}

function pruneKiwoomPriceRequestQueue() {
  if (!kiwoomPriceRequestQueue.length) return;

  const kept = [];
  for (const request of kiwoomPriceRequestQueue) {
    if (isQueuedPriceRequestCancelled(request)) {
      request.reject(
        makePriceQueueError("클라이언트가 취소한 현재가 요청", "PRICE_QUEUE_CANCELLED")
      );
      continue;
    }
    if (isQueuedPriceRequestExpired(request)) {
      request.reject(
        makePriceQueueError("현재가 큐 대기시간 초과", "PRICE_QUEUE_EXPIRED")
      );
      continue;
    }
    kept.push(request);
  }

  kiwoomPriceRequestQueue.splice(
    0,
    kiwoomPriceRequestQueue.length,
    ...kept
  );
}

async function drainKiwoomPriceRequestQueue() {
  if (kiwoomPriceWorkerRunning) return;
  kiwoomPriceWorkerRunning = true;

  try {
    while (kiwoomPriceRequestQueue.length > 0) {
      // 만료·취소된 저우선순위 요청을 한 건씩 처리하지 않고 매 회차 일괄 정리한다.
      pruneKiwoomPriceRequestQueue();
      if (!kiwoomPriceRequestQueue.length) break;

      kiwoomPriceRequestQueue.sort((a, b) =>
        Number(b.priority || 0) - Number(a.priority || 0) ||
        Number(a.sequence || 0) - Number(b.sequence || 0)
      );
      const request = kiwoomPriceRequestQueue.shift();

      if (isQueuedPriceRequestCancelled(request)) {
        request.reject(makePriceQueueError("클라이언트가 취소한 현재가 요청", "PRICE_QUEUE_CANCELLED"));
        continue;
      }
      if (isQueuedPriceRequestExpired(request)) {
        request.reject(makePriceQueueError("현재가 큐 대기시간 초과", "PRICE_QUEUE_EXPIRED"));
        continue;
      }

      const minGapMs = 350;
      const now = Date.now();
      const waitMs = Math.max(0, minGapMs - (now - lastKiwoomPriceRequestAt));
      if (waitMs > 0) {
        await new Promise(resolve => setTimeout(resolve, waitMs));
      }

      if (isQueuedPriceRequestCancelled(request)) {
        request.reject(makePriceQueueError("클라이언트가 취소한 현재가 요청", "PRICE_QUEUE_CANCELLED"));
        continue;
      }
      if (isQueuedPriceRequestExpired(request)) {
        request.reject(makePriceQueueError("현재가 큐 대기시간 초과", "PRICE_QUEUE_EXPIRED"));
        continue;
      }

      lastKiwoomPriceRequestAt = Date.now();
      try {
        request.resolve(await request.task());
      } catch (err) {
        request.reject(err);
      }
    }
  } finally {
    kiwoomPriceWorkerRunning = false;
    if (kiwoomPriceRequestQueue.length > 0) {
      void drainKiwoomPriceRequestQueue();
    }
  }
}

function runQueuedKiwoomPriceRequest(requestTask, options = {}) {
  return new Promise((resolve, reject) => {
    kiwoomPriceRequestQueue.push({
      task: requestTask,
      resolve,
      reject,
      priority: Number(options.priority || 0),
      source: String(options.source || "default"),
      sequence: ++kiwoomPriceRequestSequence,
      queuedAtMs: Date.now(),
      maxQueueWaitMs: Number(options.maxQueueWaitMs || 0),
      shouldCancel: typeof options.shouldCancel === "function" ? options.shouldCancel : null
    });
    void drainKiwoomPriceRequestQueue();
  });
}

function getKiwoomPriceQueueDepth() {
  return kiwoomPriceRequestQueue.length + (kiwoomPriceWorkerRunning ? 1 : 0);
}

function runSharedTradingPriceRequest(code, taskFactory, shareGroup = "core-volume") {
  const normalizedCode = String(code || "").replace(/^A/i, "").padStart(6, "0");
  const key = `${String(shareGroup || "default")}_${normalizedCode}`;
  const existing = tradingPriceInflightByCode.get(key);
  if (existing) {
    return existing;
  }

  const promise = Promise.resolve().then(taskFactory);
  tradingPriceInflightByCode.set(key, promise);
  promise.then(
    () => {
      if (tradingPriceInflightByCode.get(key) === promise) {
        tradingPriceInflightByCode.delete(key);
      }
    },
    () => {
      if (tradingPriceInflightByCode.get(key) === promise) {
        tradingPriceInflightByCode.delete(key);
      }
    }
  );
  return promise;
}

function getKiwoomPricePriority(sourceValue) {
  const source = String(sourceValue || "core").toLowerCase();
  if (["sell", "manual-sell", "risk", "fast-sell"].includes(source)) return 100;
  if (source === "open") return 90;
  // 일반검색이 OPEN/FAST/WAVE/CORE/VOLUME의 실시간 재확인을 앞지르지 않게 한다.
  if (source === "open-discover") return 10;
  if (source === "fast") return 85;
  if (source === "wave") return 80;
  if (source === "core" || source === "volume") return 60;
  if (source === "market") return 20;
  if (source === "hot") return 0;
  return 40;
}

function getKiwoomPriceQueueMaxWaitMs(sourceValue) {
  const source = String(sourceValue || "core").toLowerCase();
  if (["sell", "manual-sell", "risk", "fast-sell"].includes(source)) return 4500;
  if (source === "open") return 4500;
  // 일반검색은 기다리며 큐를 점유하지 말고 빠르게 양보한다.
  if (source === "open-discover") return 750;
  if (source === "fast") return 4500;
  if (["wave", "core", "volume"].includes(source)) return 5000;
  if (["market", "hot"].includes(source)) return 3000;
  return 5000;
}

app.get("/api/price", async (req, res) => {
  try {
    const token = getSavedToken();
    const code = String(req.query.code || "").trim();
    const requestSource = String(req.query.source || "core").toLowerCase();
    const isSellPriceRequest = ["sell", "manual-sell", "risk", "fast-sell"].includes(requestSource);
    const priceRequestTimeoutMs =
      isSellPriceRequest
        ? SELL_KIWOOM_PRICE_TIMEOUT_MS
        : requestSource === "hot"
          ? HOT_KIWOOM_PRICE_TIMEOUT_MS
          : requestSource === "open"
            ? OPEN_KIWOOM_PRICE_TIMEOUT_MS
            : requestSource === "open-discover"
              ? 3500
            : requestSource === "fast"
              ? FAST_KIWOOM_PRICE_TIMEOUT_MS
              : requestSource === "market"
                ? MARKET_KIWOOM_PRICE_TIMEOUT_MS
                : ["wave", "core", "volume"].includes(requestSource)
                  ? TRADING_KIWOOM_PRICE_TIMEOUT_MS
                  : KIWOOM_PRICE_REQUEST_TIMEOUT_MS;
    const requestPriority = getKiwoomPricePriority(requestSource);
    const queueMaxWaitMs = getKiwoomPriceQueueMaxWaitMs(requestSource);
    const shouldCancelPriceRequest = () => req.aborted === true || res.destroyed === true;
    // FAST 매도는 3초 주기로 위험관리를 하므로 5초 캐시를 정상조회처럼
    // 계속 재사용하면 같은 가격을 연속으로 볼 수 있다.
    // 1.2초 이내의 매우 신선한 캐시만 즉시 사용하고, 그보다 오래된 캐시는
    // 아래 catch의 5초 비상대체 경로에서 실제 키움 조회 실패 때만 사용한다.
    const freshCacheMaxAgeMs = requestSource === "fast-sell"
      ? 1200
      : isSellPriceRequest
        ? 1500
        : requestSource === "fast"
          ? 2500
          : requestSource === "open-discover"
            ? 8000
          : 8000;


    if (!code) {
      return res.status(400).json({ message: "종목코드가 없습니다." });
    }

    const cached = priceCache[code];

if (cached && Date.now() - cached.cachedAt <= freshCacheMaxAgeMs) {
  const cacheAgeMs = Date.now() - Number(cached.cachedAt || 0);
  return res.json({
    ...cached.data,
    requestSource,
    isCached: true,
    cacheAgeMs,
    cachedAtMs: Number(cached.cachedAt || 0),
    quoteObservedAtMs: Number(cached.cachedAt || 0)
  });
}

    const url = `${process.env.KIWOOM_BASE_URL}/api/dostk/stkinfo`;
    const queueDepthBeforeRequest = getKiwoomPriceQueueDepth();

    if (
      requestSource === "open-discover" &&
      queueDepthBeforeRequest >= KIWOOM_OPEN_DISCOVER_QUEUE_SOFT_LIMIT
    ) {
      throw makePriceQueueError(
        `OPEN 일반검색 현재가 큐 양보 ${queueDepthBeforeRequest}건`,
        "PRICE_QUEUE_DISCOVER_YIELD"
      );
    }

    if (
      requestPriority <= 20 &&
      queueDepthBeforeRequest >= KIWOOM_LOW_PRIORITY_QUEUE_SOFT_LIMIT
    ) {
      throw makePriceQueueError(
        `저우선순위 현재가 큐 과부하 ${queueDepthBeforeRequest}건`,
        "PRICE_QUEUE_PRESSURE"
      );
    }

    const sharedRequestGroup = requestSource === "open"
      ? "open"
      : (["core", "volume"].includes(requestSource) ? "core-volume" : null);
    const isSharedTradingRequest = Boolean(sharedRequestGroup);

    const requestCurrentPrice = async () => {
      let activeToken = token;
      let result = await runQueuedKiwoomPriceRequest(() =>
        axios.post(
          url,
          { stk_cd: code },
          {
            headers: {
              "Content-Type": "application/json;charset=UTF-8",
              authorization: `Bearer ${activeToken}`,
              "api-id": "ka10001"
            },
            timeout: priceRequestTimeoutMs
          }
        ),
        {
          priority: requestPriority,
          source: requestSource,
          maxQueueWaitMs: queueMaxWaitMs,
          // CORE/VOLUME 공유요청은 첫 HTTP 클라이언트 종료로 공용 키움 요청을 취소하지 않는다.
          shouldCancel: isSharedTradingRequest ? null : shouldCancelPriceRequest
        }
      );

      let data = result.data;

      if (isTokenError(data)) {
        console.log("[/api/price] 토큰 만료 감지 → 자동 재발급 후 현재가 재조회", code);
        activeToken = await refreshKiwoomToken();
        result = await runQueuedKiwoomPriceRequest(() =>
          axios.post(
            url,
            { stk_cd: code },
            {
              headers: {
                "Content-Type": "application/json;charset=UTF-8",
                authorization: `Bearer ${activeToken}`,
                "api-id": "ka10001"
              },
              timeout: priceRequestTimeoutMs
            }
          ),
          {
            priority: requestPriority,
            source: requestSource,
            maxQueueWaitMs: queueMaxWaitMs,
            shouldCancel: isSharedTradingRequest ? null : shouldCancelPriceRequest
          }
        );
        data = result.data;
      }

      return data;
    };

    const data = isSharedTradingRequest
      ? await runSharedTradingPriceRequest(code, requestCurrentPrice, sharedRequestGroup)
      : await requestCurrentPrice();

    const quoteObservedAtMs = Date.now();
    const responseData = {
  code: data.stk_cd,
  name: data.stk_nm,
  currentPrice: Number(cleanNumber(data.cur_prc)),
  changeRate: data.flu_rt,
  volume: Number(cleanNumber(data.trde_qty)),
  open: Number(cleanNumber(data.open_pric)),
  high: Number(cleanNumber(data.high_pric)),
  low: Number(cleanNumber(data.low_pric)),
  raw: data,
  requestSource,
  quoteObservedAtMs
};

priceCache[code] = {
  data: responseData,
  cachedAt: quoteObservedAtMs
};

res.json(responseData);


  } catch (error) {
  if (req.aborted === true || res.destroyed === true) {
    return;
  }
  const code = String(req.query.code || "").trim();
  const requestSource = String(req.query.source || "core").toLowerCase();
  const stale = priceCache[code];
  const staleAgeMs = stale ? Date.now() - Number(stale.cachedAt || 0) : Infinity;
  const staleCacheMaxAgeMs = ["sell", "manual-sell", "risk", "fast-sell"].includes(requestSource)
    ? 5 * 1000
    : requestSource === "fast"
      ? 3 * 1000
    : requestSource === "wave"
      ? 15 * 1000
      : requestSource === "open"
        ? 12 * 1000
        : requestSource === "open-discover"
          ? 10 * 1000
      : requestSource === "core" || requestSource === "volume"
        ? 10 * 1000
      : 30 * 1000;

  /*
   * 키움 429·일시적 네트워크 실패 시 전략별 허용범위의 캐시를 반환한다.
   * SELL은 위험관리를 위해 5초, 일반 분석은 기존 30초까지만 허용한다.
   */
  if (stale && staleAgeMs <= staleCacheMaxAgeMs) {
    console.warn(
      `[/api/price 캐시대체] ${code} / ` +
      `${error.response?.status || error.message} / ` +
      `캐시 ${Math.round(staleAgeMs / 1000)}초`
    );

    return res.json({
      ...stale.data,
      requestSource,
      isCached: true,
      isStaleFallback: true,
      cacheAgeMs: staleAgeMs,
      cachedAtMs: Number(stale.cachedAt || 0),
      quoteObservedAtMs: Number(stale.cachedAt || 0)
    });
  }

  console.error("[/api/price 현재가 조회 실패]", {
    code,
    message: error.message,
    status: error.response?.status,
    data: error.response?.data,
    queueDepth: getKiwoomPriceQueueDepth()
  });

  res.status(500).json({
    message: "현재가 조회 실패",
    code,
    error: error.message,
    status: error.response?.status || null,
    detail: error.response?.data || null
  });
}
});

app.get("/price/:code", async (req, res) => {
  try {
    const token = getSavedToken();
    const code = req.params.code;

    const url = `${process.env.KIWOOM_BASE_URL}/api/dostk/stkinfo`;

    let result = await axios.post(
  url,
  { stk_cd: code },
  {
    headers: {
      "Content-Type": "application/json;charset=UTF-8",
      authorization: `Bearer ${token}`,
      "api-id": "ka10001"
    },
    timeout: KIWOOM_PRICE_REQUEST_TIMEOUT_MS
  }
);

let data = result.data;

if (isTokenError(data)) {
  console.log("토큰 만료 감지 → 자동 재발급 후 현재가 재조회");

  const newToken = await refreshKiwoomToken();

  result = await axios.post(
    url,
    { stk_cd: code },
    {
      headers: {
        "Content-Type": "application/json;charset=UTF-8",
        authorization: `Bearer ${newToken}`,
        "api-id": "ka10001"
      },
      timeout: KIWOOM_PRICE_REQUEST_TIMEOUT_MS
    }
  );

  data = result.data;
}
    res.json({
      code: data.stk_cd,
      name: data.stk_nm,
      currentPrice: Number(cleanNumber(data.cur_prc)),
      changeRate: data.flu_rt,
      volume: Number(cleanNumber(data.trde_qty)),
      open: Number(cleanNumber(data.open_pric)),
      high: Number(cleanNumber(data.high_pric)),
      low: Number(cleanNumber(data.low_pric)),
      raw: data
    });
  } catch (error) {
    res.status(500).json({
      message: "현재가 조회 실패",
      error: error.response?.data || error.message
    });
  }
});

app.get("/api/daily", async (req, res) => {
  try {
    const code = String(req.query.code || "").trim();
    const days = Number(req.query.days || 30);

    if (!code) {
      return res.status(400).json({
        error: "종목코드가 없습니다."
      });
    }

    const today = new Date();
    const baseDate =
      today.getFullYear().toString() +
      String(today.getMonth() + 1).padStart(2, "0") +
      String(today.getDate()).padStart(2, "0");

   let token = getSavedToken();

let response = await fetch(
  `${process.env.KIWOOM_BASE_URL}/api/dostk/chart`,
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json;charset=UTF-8",
      authorization: `Bearer ${token}`,
      "api-id": "ka10081"
    },
    body: JSON.stringify({
      stk_cd: code,
      base_dt: baseDate,
      upd_stkpc_tp: "1"
    })
  }
);

let data = await response.json();

if (isTokenError(data)) {
  console.log("토큰 만료 감지 → 자동 재발급 후 일봉 재조회");

  token = await refreshKiwoomToken();

  response = await fetch(
    `${process.env.KIWOOM_BASE_URL}/api/dostk/chart`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json;charset=UTF-8",
        authorization: `Bearer ${token}`,
        "api-id": "ka10081"
      },
      body: JSON.stringify({
        stk_cd: code,
        base_dt: baseDate,
        upd_stkpc_tp: "1"
      })
    }
  );

  data = await response.json();
}

if (!response.ok) {
  return res.status(response.status).json(data);
}
    const rawItems =
      data.stk_dt_pole_chart_qry ||
      data.output ||
      data.items ||
      [];

    const items = rawItems
      .slice(0, days)
      .map((item) => ({
        date: item.dt || item.date || item.stk_bsop_date,
        open: Number(String(item.open_pric || item.open || 0).replace(/[+-]/g, "")),
        high: Number(String(item.high_pric || item.high || 0).replace(/[+-]/g, "")),
        low: Number(String(item.low_pric || item.low || 0).replace(/[+-]/g, "")),
        close: Number(String(item.cur_prc || item.close_pric || item.close || 0).replace(/[+-]/g, "")),
        volume: Number(String(item.trde_qty || item.volume || 0).replace(/[+-]/g, ""))
      }))
      .filter((item) => item.close > 0)
      .reverse();

    res.json({
      code,
      days,
      count: items.length,
      items
    });
  } catch (error) {
    console.error("일봉 조회 오류:", error);

    res.status(500).json({
      error: "일봉 조회 실패",
      message: error.message
    });
  }
});

/*
 * WAVE 수급자료
 * 키움 ka10060 종목별투자자기관별차트를 이용해 최근 외국인/기관 순매수를 반환한다.
 * WAVE는 이 자료를 MONEY 20점 중 외국인·기관 수급 점수에 사용한다.
 */
app.get("/api/wave-investor-flow", async (req, res) => {
  try {
    const code = String(req.query.code || "").trim();
    const days = Math.max(1, Math.min(10, Number(req.query.days || 5)));

    if (!/^\d{6}$/.test(code)) {
      return res.status(400).json({
        ok: false,
        message: "6자리 종목코드가 필요합니다."
      });
    }

    const body = {
      dt: new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" }).replace(/-/g, ""),
      stk_cd: code,
      amt_qty_tp: "1", // 금액
      trde_tp: "0",    // 순매수
      unit_tp: "1"     // 단주(금액 조회에서는 응답 단위가 백만원)
    };

    const requestFlow = async (token) => axios.post(
      `${process.env.KIWOOM_BASE_URL}/api/dostk/chart`,
      body,
      {
        headers: {
          "Content-Type": "application/json;charset=UTF-8",
          authorization: `Bearer ${token}`,
          "api-id": "ka10060"
        },
        timeout: 12000
      }
    );

    let token = getSavedToken();
    let response = await requestFlow(token);
    let data = response.data || {};

    if (isTokenError(data)) {
      console.log("[/api/wave-investor-flow] 토큰 만료 → 재발급 후 재조회", code);
      token = await refreshKiwoomToken();
      response = await requestFlow(token);
      data = response.data || {};
    }

    if (Number(data.return_code || 0) !== 0 && data.return_msg) {
      throw new Error(data.return_msg);
    }

    const rawRows = Array.isArray(data.stk_invsr_orgn_chart)
      ? data.stk_invsr_orgn_chart
      : [];

    // 투자자 순매수는 음수 부호가 의미가 있으므로 기존 cleanNumber(부호 제거)를 사용하지 않는다.
    const signedNumber = (value) => {
      const number = Number(String(value ?? 0).replace(/,/g, "").replace(/^\+/, "").trim());
      return Number.isFinite(number) ? number : 0;
    };

    const rows = rawRows
      .slice(0, days)
      .map(item => ({
        date: String(item.dt || ""),
        currentPrice: Math.abs(signedNumber(item.cur_prc || 0)),
        previousDiff: signedNumber(item.pred_pre || 0),
        tradingValueMillion: Math.abs(signedNumber(item.acc_trde_prica || 0)),
        individualNetBuy: signedNumber(item.ind_invsr || 0),
        foreignNetBuy: signedNumber(item.frgnr_invsr || 0),
        institutionNetBuy: signedNumber(item.orgn || 0),
        financialInvestment: signedNumber(item.fnnc_invt || 0),
        insurance: signedNumber(item.insrnc || 0),
        investmentTrust: signedNumber(item.invtrt || 0),
        otherFinance: signedNumber(item.etc_fnnc || 0),
        bank: signedNumber(item.bank || 0),
        pensionEtc: signedNumber(item.penfnd_etc || 0),
        privateFund: signedNumber(item.samo_fund || 0),
        nation: signedNumber(item.natn || 0),
        otherCorp: signedNumber(item.etc_corp || 0),
        domesticForeign: signedNumber(item.natfor || 0)
      }))
      .filter(item => item.date)
      .sort((a, b) => a.date.localeCompare(b.date));

    return res.json({
      ok: true,
      code,
      days,
      count: rows.length,
      unit: "백만원",
      rows
    });
  } catch (error) {
    console.error("[/api/wave-investor-flow 오류]", {
      code: String(req.query.code || ""),
      message: error.message,
      status: error.response?.status,
      detail: error.response?.data || null
    });
    return res.status(500).json({
      ok: false,
      message: "WAVE 외국인/기관 수급 조회 실패",
      error: error.message,
      detail: error.response?.data || null
    });
  }
});

const {
  startServerAutoTrader,
  runServerAutoBuyOnce,
  checkServerAutoSellOnce,
  setServerAutoEnabled,
  loadState,
  saveState
} = require("./auto-trader-core");

sharedLoadPaperState = loadState;
sharedSavePaperState = saveState;

const {
  startOpenStrategy,
  runOpenBuyOnce,
  checkOpenSellOnce
} = require("./open-strategy");

const {
  startOpenMarketData,
  refreshOpenMarketData,
  loadOpenMarketData
} = require("./open-market-data");

const {
  startWaveStrategy,
  runWaveOnce,
  loadWaveState,
  getWaveSummary
} = require("./wave-strategy");

const {
  startFastStrategy,
  runFastOnce,
  loadFastState,
  getFastSummary,
  resetFastState
} = require("./fast-strategy");

app.get("/api/paper-state", (req, res) => {
  res.json(loadState());
});

app.get("/api/wave-state", (req, res) => {
  try {
    res.json({ ok: true, ...loadWaveState() });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message });
  }
});

app.get("/api/wave-summary", (req, res) => {
  try {
    res.json({ ok: true, ...getWaveSummary() });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message });
  }
});

app.post("/api/wave-run-once", async (req, res) => {
  try {
    const result = await runWaveOnce();
    res.json({
      ok: result.ok === true,
      reason: result.reason || null,
      summary: result.state?.summary || getWaveSummary()
    });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message });
  }
});

app.get("/api/fast-state", (req, res) => {
  try {
    res.json({ ok: true, ...loadFastState() });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message });
  }
});

app.get("/api/fast-summary", (req, res) => {
  try {
    res.json({ ok: true, ...getFastSummary() });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message });
  }
});

app.post("/api/fast-run-once", async (req, res) => {
  try {
    const result = await runFastOnce();
    res.json({
      ok: result.ok === true,
      reason: result.reason || null,
      summary: result.summary || getFastSummary(result.state)
    });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message });
  }
});

app.post("/api/fast-reset", (req, res) => {
  try {
    const state = resetFastState();
    res.json({ ok: true, summary: getFastSummary(state) });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message });
  }
});

app.post("/api/paper-state/reset", (req, res) => {
  try {
    const resetState = {
      holdings: [],
      tradeLogs: [],
      virtualResults: [],

      totalCash: 100000000,
      initialCapital: 100000000,

      openDate: null,
      openCompleted: false,
      openSkipped: false,
      openCompletedAt: null,
      openSkipReason: null,
      openCandidateHistory: {},

      coreCandidateHistory: {},
      volumeCandidateHistory: {},

      candidateDecisionHistory: {
        date: new Date().toLocaleDateString("sv-SE", {
          timeZone: "Asia/Seoul"
        }),
        updatedAt: null,
        rows: []
      },

      dailyTopRisers: {
        date: new Date().toLocaleDateString("sv-SE", {
          timeZone: "Asia/Seoul"
        }),
        updatedAt: null,
        rows: []
      },

      missedWinnerAnalysis: {
        date: new Date().toLocaleDateString("sv-SE", {
          timeZone: "Asia/Seoul"
        }),
        updatedAt: null,
        summary: {},
        rows: []
      },

      pendingBuyCodes: [],
      pendingSellCodes: [],

      dailyRiskDate: null,
      dailyStartDate: null,
      dailyStartAsset: 100000000,
      dailyStartHoldingProfit: 0,
      dailyStartCapturedAt: null,
      dailyLossLimit: 1000000,
      dailyBuyStopped: false,

      serverAutoEnabled: false,
      serverAutoChangedAt: new Date().toLocaleString(
        "ko-KR",
        { timeZone: "Asia/Seoul" }
      ),

      lastRunAt: null,
      lastBuyCheckAt: null,
      lastSellCheckAt: null,
      lastPriceRefreshAt: null
    };

    // 사용자가 명시적으로 초기화한 경우에만 병합 없이 완전 교체한다.
    savePaperState(resetState, { force: true });

    res.json({
      ok: true,
      message: "paper-state-core.json 초기화 완료",
      state: resetState
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      message: "paper-state-core.json 초기화 실패",
      error: err.message
    });
  }
});

app.get("/api/server-auto-status", (req, res) => {
  const state = loadState();

  res.json({
    ok: true,
    serverAutoEnabled: state.serverAutoEnabled !== false,
    serverAutoChangedAt: state.serverAutoChangedAt || null,
    lastRunAt: state.lastRunAt || null,
    lastSellCheckAt: state.lastSellCheckAt || null,
    openDate: state.openDate || null,
    openCompleted: state.openCompleted === true,
    openSkipped: state.openSkipped === true,
    openCompletedAt: state.openCompletedAt || null,
    openSkipReason: state.openSkipReason || null
  });
});

/*
 * 메인 대시보드 전용 통합성과
 * - OPEN / CORE / VOLUME / WAVE / FAST 모두 MASTER 1억원 단일계좌를 공유한다.
 * - 전략별 카드는 독립계좌가 아니라 MASTER 손익 기여액/기여율을 표시한다.
 * - 일별 흐름은 전략별 실현손익만 사용해 보유평가손익의 중복 반영을 막는다.
 */
function dashboardNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function dashboardTodayKey() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
}

function dashboardRecentDateKeys(days = 7) {
  const nowKst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const result = [];
  for (let offset = days - 1; offset >= 0; offset--) {
    const date = new Date(nowKst);
    date.setUTCDate(date.getUTCDate() - offset);
    result.push(date.toISOString().slice(0, 10));
  }
  return result;
}

function dashboardLogDate(log = {}) {
  return String(log.date || log.buyDate || log.sellDate || "").slice(0, 10);
}

function dashboardHoldingSnapshot(holdings = []) {
  const rows = Array.isArray(holdings) ? holdings : [];
  const buyAmount = rows.reduce(
    (sum, holding) => sum +
      dashboardNumber(holding.buyPrice) * dashboardNumber(holding.qty),
    0
  );
  const evalAmount = rows.reduce(
    (sum, holding) => sum +
      dashboardNumber(holding.currentPrice || holding.buyPrice) * dashboardNumber(holding.qty),
    0
  );
  return {
    holdingCount: rows.length,
    buyAmount,
    evalAmount,
    unrealizedProfit: evalAmount - buyAmount
  };
}

function dashboardRealizedHistory(sellLogs = [], dateKeys = []) {
  return dateKeys.map(date => ({
    date,
    profit: sellLogs
      .filter(log => dashboardLogDate(log) === date)
      .reduce((sum, log) => sum + dashboardNumber(log.profit), 0)
  }));
}

/*
 * 전략 카드 미니그래프용 누적손익 흐름.
 *
 * - 과거 날짜: 해당 날짜까지 확정된 누적 실현손익
 * - 최신 날짜: 누적 실현손익 + 현재 보유 평가손익
 *
 * 과거 시점의 미실현 평가손익 스냅샷은 원장에 저장돼 있지 않으므로
 * 존재하지 않는 값을 추정하지 않는다. 대신 최신 끝점은 반드시
 * 카드의 현재 netProfit과 일치하도록 한다.
 */
function dashboardProfitTrend(
  sellLogs = [],
  dateKeys = [],
  currentUnrealizedProfit = 0,
  currentNetProfit = null
) {
  const rows = Array.isArray(sellLogs) ? sellLogs : [];
  const dates = Array.isArray(dateKeys) ? dateKeys : [];
  const unrealized = dashboardNumber(currentUnrealizedProfit);

  return dates.map((date, index) => {
    const cumulativeRealizedProfit = rows
      .filter(log => {
        const logDate = dashboardLogDate(log);
        return logDate && logDate <= date;
      })
      .reduce((sum, log) => sum + dashboardNumber(log.profit), 0);

    const isLatest = index === dates.length - 1;
    const profit = isLatest
      ? (
          currentNetProfit === null
            ? cumulativeRealizedProfit + unrealized
            : dashboardNumber(currentNetProfit)
        )
      : cumulativeRealizedProfit;

    return {
      date,
      profit,
      cumulativeRealizedProfit,
      unrealizedProfit: isLatest ? unrealized : 0,
      includesCurrentUnrealized: isLatest
    };
  });
}

function dashboardAverageProfitRate(rows = []) {
  if (!rows.length) return 0;
  return rows.reduce(
    (sum, row) => sum + dashboardNumber(row.profitRate),
    0
  ) / rows.length;
}

function dashboardNormalizeHolding(holding = {}, strategyGroup = "CORE", accountType = "MAIN") {
  const strategy = String(strategyGroup || "CORE").toUpperCase();
  const buyPrice = dashboardNumber(holding.buyPrice);
  const currentPrice = dashboardNumber(holding.currentPrice || holding.buyPrice);
  const highestPrice = dashboardNumber(holding.highestPrice || currentPrice || buyPrice);
  const qty = dashboardNumber(holding.qty);
  const buyAmount = dashboardNumber(holding.buyAmount || buyPrice * qty);
  const evalAmount = currentPrice * qty;
  const profit = evalAmount - buyAmount;
  const profitRate = buyAmount > 0 ? (profit / buyAmount) * 100 : 0;
  const maxProfitRate = buyPrice > 0
    ? ((highestPrice - buyPrice) / buyPrice) * 100
    : dashboardNumber(holding.maxProfitRate);
  const drawdownFromHigh = highestPrice > 0
    ? ((currentPrice - highestPrice) / highestPrice) * 100
    : dashboardNumber(holding.drawdownFromHigh);

  let status = "HOLD";
  if (strategy === "WAVE") {
    status = holding.protectActive ? "PROTECT" : "HOLD";
  } else if (strategy === "FAST") {
    status = "FAST HOLD";
  } else if (holding.trailingActive) {
    status = "TRAILING";
  } else if (holding.targetTouched) {
    status = "PROTECT";
  }

  return {
    accountType,
    accountLabel: "MASTER 단일계좌",
    strategyGroup: strategy,
    code: reportNormalizeCode(holding.code),
    name: holding.name || holding.code || "-",
    buyPrice,
    currentPrice,
    highestPrice,
    qty,
    buyAmount,
    evalAmount,
    profit,
    profitRate,
    maxProfitRate,
    drawdownFromHigh,
    buyAt:
      holding.buyTimeText ||
      holding.buyAt ||
      holding.buyTime ||
      holding.buyDate ||
      holding.date ||
      null,
    buyAtMs: dashboardNumber(
      holding.buyAtMs || holding.buyTimeMs || holding.buyTime
    ),
    score: dashboardNumber(
      holding.fastScore ||
      holding.buyScore ||
      holding.holdingScore ||
      holding.watchScore ||
      holding.finalScore ||
      holding.finalBuyScore ||
      holding.candidateWatchScore
    ),
    status,
    manualSellAllowed: ["MAIN", "MASTER", "MASTER_SHARED"].includes(accountType),
    reason: holding.reason || holding.buyReason || null
  };
}

function dashboardNormalizeSell(log = {}, strategyGroup = "CORE", accountType = "MAIN") {
  const strategy = String(strategyGroup || reportStrategy(log) || "CORE").toUpperCase();
  return {
    accountType,
    accountLabel: "MASTER 단일계좌",
    strategyGroup: strategy,
    type: String(log.type || "SELL"),
    code: reportNormalizeCode(log.code),
    name: log.name || log.code || "-",
    price: dashboardNumber(log.sellPrice || log.price),
    qty: dashboardNumber(log.qty),
    profit: dashboardNumber(log.profit),
    profitRate: dashboardNumber(log.profitRate),
    maxProfitRate: dashboardNumber(log.maxProfitRate),
    reason: log.reason || log.sellReason || "매도조건 충족",
    date: dashboardLogDate(log),
    time: log.time || log.sellTime || null,
    timestampMs: reportTimestampMs(log)
  };
}

function dashboardCountReasons(...reasonGroups) {
  return reasonGroups.reduce(
    (sum, group) => sum + Object.values(group || {}).reduce(
      (inner, count) => inner + dashboardNumber(count),
      0
    ),
    0
  );
}

function dashboardCandidateRow(row = {}, fallbackStatus = "WATCH") {
  const snapshot = row.snapshot || {};
  const evaluation = row.evaluation || {};
  const analysis = row.lastAnalysis || {};
  return {
    code: reportNormalizeCode(row.code),
    name: row.name || row.code || "-",
    status: row.status || row.preSignalStatus || fallbackStatus,
    score: dashboardNumber(
      row.fastScore ||
      row.score ||
      row.watchScore ||
      row.finalScore ||
      row.finalBuyScore ||
      row.candidateWatchScore ||
      row.discoverScore ||
      analysis.totalScore
    ),
    currentPrice: dashboardNumber(
      row.currentPrice || row.lastPrice || snapshot.currentPrice || snapshot.price
    ),
    changeRate: dashboardNumber(
      row.changeRate || evaluation.changeRate || snapshot.changeRate
    ),
    reason:
      row.reason ||
      row.lastBuyBlockReason ||
      evaluation.reason ||
      analysis.buyReason ||
      null
  };
}

function dashboardMetric({
  id,
  label,
  icon,
  accountType,
  accountLabel,
  initialCapital,
  totalAsset = null,
  contributionBase,
  holdings,
  buyLogs,
  sellLogs,
  closedRows,
  recentDateKeys,
  status,
  statusDetail,
  detailHref,
  candidateCount = 0
}) {
  const holding = dashboardHoldingSnapshot(holdings);
  const realizedProfit = sellLogs.reduce(
    (sum, log) => sum + dashboardNumber(log.profit),
    0
  );
  const standaloneAccount = accountType === "INDEPENDENT";
  const calculatedTotalAsset = totalAsset === null
    ? null
    : dashboardNumber(totalAsset);
  const netProfit = standaloneAccount && calculatedTotalAsset !== null
    ? calculatedTotalAsset - dashboardNumber(initialCapital)
    : realizedProfit + holding.unrealizedProfit;
  const rateBase = standaloneAccount
    ? dashboardNumber(initialCapital)
    : dashboardNumber(contributionBase);
  const profitRate = rateBase > 0 ? (netProfit / rateBase) * 100 : 0;
  const today = recentDateKeys[recentDateKeys.length - 1] || dashboardTodayKey();
  const todayBuyLogs = buyLogs.filter(log => dashboardLogDate(log) === today);
  const todaySellLogs = sellLogs.filter(log => dashboardLogDate(log) === today);
  const wins = closedRows.filter(row => dashboardNumber(row.profit) > 0).length;
  const losses = closedRows.filter(row => dashboardNumber(row.profit) < 0).length;
  const neutral = Math.max(0, closedRows.length - wins - losses);

  return {
    id,
    label,
    icon,
    accountType,
    accountLabel,
    initialCapital: dashboardNumber(initialCapital),
    totalAsset: calculatedTotalAsset,
    realizedProfit,
    unrealizedProfit: holding.unrealizedProfit,
    netProfit,
    profitRate,
    rateLabel: standaloneAccount ? "계좌수익률" : "메인계좌 기여율",
    holdingCount: holding.holdingCount,
    holdingBuyAmount: holding.buyAmount,
    holdingEvalAmount: holding.evalAmount,
    totalBuyCount: buyLogs.length,
    totalSellCount: closedRows.length,
    sellFillCount: sellLogs.length,
    todayBuyCount: todayBuyLogs.length,
    todaySellCount: todaySellLogs.length,
    todayRealizedProfit: todaySellLogs.reduce(
      (sum, log) => sum + dashboardNumber(log.profit),
      0
    ),
    wins,
    losses,
    neutral,
    winRate: closedRows.length > 0 ? (wins / closedRows.length) * 100 : 0,
    avgProfitRate: dashboardAverageProfitRate(closedRows),
    status,
    statusDetail,
    candidateCount: dashboardNumber(candidateCount),
    detailHref,
    // 하단 표는 기존 의미 그대로 '일별 실현손익'을 유지한다.
    recent7Days: dashboardRealizedHistory(sellLogs, recentDateKeys),
    // 카드 그래프는 별도 누적손익 흐름을 사용한다.
    profitTrend: dashboardProfitTrend(
      sellLogs,
      recentDateKeys,
      holding.unrealizedProfit,
      netProfit
    )
  };
}

app.get("/api/strategy-dashboard-summary", (req, res) => {
  try {
    const mainState = loadState();
    const waveState = loadWaveState();
    const fastState = loadFastState();
    const waveSummary = waveState.summary || getWaveSummary();
    const fastSummary = getFastSummary(fastState);
    const recentDateKeys = dashboardRecentDateKeys(7);
    const today = recentDateKeys[recentDateKeys.length - 1];

    const mainLogs = Array.isArray(mainState.tradeLogs) ? mainState.tradeLogs : [];
    const mainHoldings = Array.isArray(mainState.holdings) ? mainState.holdings : [];
    const mainRawSellLogs = mainLogs.filter(isReportSellLog);
    const mainPositionSummary = buildReportPositionSummary(
      mainLogs,
      mainHoldings,
      mainRawSellLogs
    );
    const mainSellLogs = mainPositionSummary.resolvedSellLogs;
    const mainInitialCapital = dashboardNumber(mainState.initialCapital, 100000000);
    const mainHolding = dashboardHoldingSnapshot(mainHoldings);
    const mainTotalAsset = dashboardNumber(mainState.totalCash) + mainHolding.evalAmount;

    function makeMainStrategyMetric(group, label, icon, detailHref) {
      const upperGroup = String(group).toUpperCase();
      const holdings = mainHoldings.filter(
        holding => reportStrategy(holding) === upperGroup
      );
      const buyLogs = mainLogs.filter(
        log => REPORT_BUY_TYPES.has(log.type) && reportStrategy(log) === upperGroup
      );
      const sellLogs = mainSellLogs.filter(
        log => reportStrategy(log) === upperGroup
      );
      const closedRows = mainPositionSummary.closedPositions.filter(
        position => position.strategyGroup === upperGroup
      );
      const todayBuyCount = buyLogs.filter(log => dashboardLogDate(log) === today).length;

      let status = holdings.length > 0
        ? `${holdings.length}종목 보유 중`
        : todayBuyCount > 0
          ? "오늘 거래 완료"
          : "신규매수 대기";
      let statusDetail = "성과자료 정상";

      if (upperGroup === "OPEN") {
        if (mainState.openSkipped === true) {
          status = "오늘 미매수";
          statusDetail = mainState.openSkipReason || "OPEN 조건 미충족";
        } else if (mainState.openCompleted === true && holdings.length === 0) {
          status = mainState.openBuyCode ? "오늘 거래 완료" : "오늘 평가 완료";
          statusDetail = mainState.openBuyCode
            ? `${mainState.openBuyName || mainState.openBuyCode} 선정`
            : "매수 종목 없음";
        } else if (mainState.openCompleted !== true) {
          status = "후보 관찰 중";
          statusDetail = "OPEN 학습 화면에서 상세 확인";
        }
      }

      return dashboardMetric({
        id: upperGroup,
        label,
        icon,
        accountType: "SHARED",
        accountLabel: "메인 1억원 공유계좌",
        initialCapital: mainInitialCapital,
        contributionBase: mainInitialCapital,
        holdings,
        buyLogs,
        sellLogs,
        closedRows,
        recentDateKeys,
        status,
        statusDetail,
        detailHref,
        candidateCount: dashboardNumber(
          mainState.buyDecisionStats?.[upperGroup]?.checked
        )
      });
    }

    const waveStatus = dashboardNumber(waveSummary.holdingCount) > 0
      ? `${dashboardNumber(waveSummary.holdingCount)}종목 HOLD`
      : dashboardNumber(waveSummary.triggerCount) > 0
        ? `${dashboardNumber(waveSummary.triggerCount)}종목 TRIGGER`
        : dashboardNumber(waveSummary.readyCount) > 0
          ? `${dashboardNumber(waveSummary.readyCount)}종목 READY`
          : dashboardNumber(waveSummary.watchCount) > 0
            ? `${dashboardNumber(waveSummary.watchCount)}종목 WATCH`
            : "후보 대기";

    const fastStatus = dashboardNumber(fastSummary.holdingCount) > 0
      ? `${dashboardNumber(fastSummary.holdingCount)}종목 HOLD`
      : dashboardNumber(fastSummary.readyCount) > 0
        ? `${dashboardNumber(fastSummary.readyCount)}종목 READY`
        : fastSummary.lastRunReason || "후보 대기";

    function makeMasterSharedStrategyMetric(
      group,
      label,
      icon,
      detailHref,
      status,
      statusDetail,
      candidateCount = 0
    ) {
      const normalizedGroup = String(group || "").toUpperCase();

      const strategyHoldings = mainHoldings.filter(
        holding => reportStrategy(holding) === normalizedGroup
      );

      const strategyBuyLogs = mainLogs.filter(
        log =>
          REPORT_BUY_TYPES.has(String(log.type || "").toUpperCase()) &&
          reportStrategy(log) === normalizedGroup
      );

      const strategySellLogs = mainSellLogs.filter(
        log => reportStrategy(log) === normalizedGroup
      );

      return dashboardMetric({
        id: normalizedGroup,
        label,
        icon,
        accountType: "MASTER_SHARED",
        accountLabel: "MASTER 단일계좌",
        initialCapital: mainInitialCapital,
        totalAsset: mainTotalAsset,
        contributionBase: mainInitialCapital,
        holdings: strategyHoldings,
        buyLogs: strategyBuyLogs,
        sellLogs: strategySellLogs,
        closedRows: strategySellLogs,
        recentDateKeys,
        status,
        statusDetail,
        detailHref,
        candidateCount
      });
    }

    const strategies = [
      makeMainStrategyMetric("OPEN", "OPEN", "🚀", "open-learning.html"),
      makeMainStrategyMetric("CORE", "CORE", "🛡️", null),
      makeMainStrategyMetric("VOLUME", "VOLUME", "📊", null),

      makeMasterSharedStrategyMetric(
        "WAVE",
        "WAVE",
        "🌊",
        "wave.html",
        waveStatus,
        `WATCH ${dashboardNumber(waveSummary.watchCount)} · ` +
          `READY ${dashboardNumber(waveSummary.readyCount)} · ` +
          `TRIGGER ${dashboardNumber(waveSummary.triggerCount)}`,
        dashboardNumber(waveSummary.candidateCount)
      ),

      makeMasterSharedStrategyMetric(
        "FAST",
        "FAST",
        "⚡",
        "fast.html",
        fastStatus,
        `READY ${dashboardNumber(fastSummary.readyCount)} · ` +
          `후보 ${dashboardNumber(fastSummary.candidateCount)}`,
        dashboardNumber(fastSummary.candidateCount)
      )
    ].map(strategy => ({
      ...strategy,
      accountType: "MASTER_SHARED",
      accountLabel: "MASTER 단일계좌",
      rateLabel: "MASTER 기여율"
    }));

    const unifiedHoldings = mainHoldings
      .map(holding =>
        dashboardNormalizeHolding(
          holding,
          reportStrategy(holding),
          "MASTER"
        )
      )
      .sort((a, b) => {
      const strategyOrder = { OPEN: 1, CORE: 2, VOLUME: 3, WAVE: 4, FAST: 5 };
      return (
        dashboardNumber(strategyOrder[a.strategyGroup], 9) -
        dashboardNumber(strategyOrder[b.strategyGroup], 9)
      ) || dashboardNumber(b.profitRate) - dashboardNumber(a.profitRate);
    });

    const unifiedSells = mainSellLogs
      .map((log, index) => ({
        ...dashboardNormalizeSell(
          log,
          reportStrategy(log),
          "MASTER"
        ),
        sourceOrder: index
      }))
      .sort((a, b) => {
      const timestampDiff = dashboardNumber(b.timestampMs) - dashboardNumber(a.timestampMs);
      if (timestampDiff) return timestampDiff;
      const dateDiff = String(b.date || "").localeCompare(String(a.date || ""));
      if (dateDiff) return dateDiff;
      return dashboardNumber(b.sourceOrder) - dashboardNumber(a.sourceOrder);
    }).slice(0, 100);

    function makeMainCandidateOverview(group, label, icon) {
      const stats = mainState.buyDecisionStats?.[group] || {};
      const sourceRows = group === "CORE"
        ? mainState.coreCandidateWatchList
        : mainState.volumeCandidateWatchList;
      const topCandidates = (Array.isArray(sourceRows) ? sourceRows : [])
        .map(row => dashboardCandidateRow(row))
        .sort((a, b) => dashboardNumber(b.score) - dashboardNumber(a.score))
        .slice(0, 5);
      const checked = dashboardNumber(stats.checked);
      const passed = dashboardNumber(stats.passed);
      const bought = dashboardNumber(stats.bought);
      const rejected = dashboardCountReasons(
        stats.conditionRejected || stats.rejected,
        stats.operationalBlocked
      );
      return {
        id: group,
        label,
        icon,
        status: topCandidates.length > 0 ? "후보 평가 중" : "후보 대기",
        statusDetail: `검토 ${checked} · 통과 ${passed} · 매수 ${bought}`,
        checked,
        passed,
        bought,
        rejected,
        watch: topCandidates.length,
        ready: passed,
        trigger: 0,
        topCandidates,
        detailHref: null
      };
    }

    const openHistoryRows = Object.values(mainState.openCandidateHistory || {});
    const openCandidates = openHistoryRows
      .map(row => dashboardCandidateRow(row))
      .sort((a, b) => dashboardNumber(b.score) - dashboardNumber(a.score))
      .slice(0, 5);
    const openBought = mainLogs.filter(log =>
      log.type === "OPEN_BUY" && dashboardLogDate(log) === today
    ).length;
    const openCandidateOverview = {
      id: "OPEN",
      label: "OPEN",
      icon: "🚀",
      status: mainState.openSkipped
        ? "오늘 미매수"
        : mainState.openCompleted
          ? "오늘 평가 완료"
          : "후보 관찰 중",
      statusDetail:
        mainState.openSkipReason ||
        (mainState.openBuyCode
          ? `${mainState.openBuyName || mainState.openBuyCode} 선정`
          : "OPEN 학습에서 상세 확인"),
      checked: openHistoryRows.length,
      passed: openBought,
      bought: openBought,
      rejected: mainState.openSkipped ? 1 : 0,
      watch: mainState.openCompleted ? 0 : openCandidates.length,
      ready: 0,
      trigger: 0,
      topCandidates: openCandidates,
      detailHref: "open-learning.html"
    };

    const waveCandidateOverview = {
      id: "WAVE",
      label: "WAVE",
      icon: "🌊",
      status: waveStatus,
      statusDetail: `WATCH ${dashboardNumber(waveSummary.watchCount)} · READY ${dashboardNumber(waveSummary.readyCount)} · TRIGGER ${dashboardNumber(waveSummary.triggerCount)}`,
      checked: dashboardNumber(waveSummary.candidateCount),
      passed: dashboardNumber(waveSummary.readyCount) + dashboardNumber(waveSummary.triggerCount),
      bought: dashboardNumber(waveSummary.todayBuyCount),
      rejected: Array.isArray(waveState.excluded) ? waveState.excluded.length : 0,
      watch: dashboardNumber(waveSummary.watchCount),
      ready: dashboardNumber(waveSummary.readyCount),
      trigger: dashboardNumber(waveSummary.triggerCount),
      topCandidates: (Array.isArray(waveSummary.topCandidates) ? waveSummary.topCandidates : [])
        .map(row => dashboardCandidateRow(row))
        .slice(0, 5),
      detailHref: "wave.html"
    };

    const fastCandidateOverview = {
      id: "FAST",
      label: "FAST",
      icon: "⚡",
      status: fastStatus,
      statusDetail: `WATCH ${Math.max(0, dashboardNumber(fastSummary.candidateCount) - dashboardNumber(fastSummary.readyCount))} · READY ${dashboardNumber(fastSummary.readyCount)}`,
      checked: dashboardNumber(fastSummary.candidateCount),
      passed: dashboardNumber(fastSummary.readyCount),
      bought: dashboardNumber(fastSummary.todayBuyCount),
      rejected: 0,
      watch: Math.max(
        0,
        dashboardNumber(fastSummary.candidateCount) - dashboardNumber(fastSummary.readyCount)
      ),
      ready: dashboardNumber(fastSummary.readyCount),
      trigger: 0,
      topCandidates: (Array.isArray(fastSummary.candidates) ? fastSummary.candidates : [])
        .map(row => dashboardCandidateRow(row))
        .sort((a, b) => dashboardNumber(b.score) - dashboardNumber(a.score))
        .slice(0, 5),
      detailHref: "fast.html"
    };

    const candidateOverview = [
      openCandidateOverview,
      makeMainCandidateOverview("CORE", "CORE", "🛡️"),
      makeMainCandidateOverview("VOLUME", "VOLUME", "📊"),
      waveCandidateOverview,
      fastCandidateOverview
    ];

    const masterStrategyNetProfit = strategies.reduce(
      (sum, strategy) => sum + dashboardNumber(strategy.netProfit),
      0
    );

    const masterAccountNetProfit =
      mainTotalAsset - mainInitialCapital;

    const masterReconciliationDifference =
      masterAccountNetProfit - masterStrategyNetProfit;

    const masterReconciliation = {
      accountNetProfit: masterAccountNetProfit,
      strategyNetProfit: masterStrategyNetProfit,
      difference: masterReconciliationDifference,
      matched: Math.abs(masterReconciliationDifference) < 1,
      recognizedBuyCount: mainPositionSummary.buyRecords.length,
      recognizedSellFillCount: mainSellLogs.length,
      recognizedClosedPositionCount:
        mainPositionSummary.closedPositions.length
    };

    // 기존 프론트/외부 호출 호환용 키도 유지한다.
    const mainReconciliation = masterReconciliation;

    if (!masterReconciliation.matched) {
      console.warn(
        `[MASTER 전략성과 정합성 경고] 계좌 ` +
        `${Math.round(masterAccountNetProfit).toLocaleString()}원 / ` +
        `5전략 합계 ${Math.round(masterStrategyNetProfit).toLocaleString()}원 / ` +
        `차이 ${Math.round(masterReconciliationDifference).toLocaleString()}원`
      );
    }

    const combinedInitialCapital = mainInitialCapital;
    const combinedCurrentAsset = mainTotalAsset;
    const combinedProfit =
      combinedCurrentAsset - combinedInitialCapital;

    const combinedTodayRealizedProfit = strategies.reduce(
      (sum, strategy) => sum + dashboardNumber(strategy.todayRealizedProfit),
      0
    );

    res.json({
      ok: true,
      asOf: new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }),
      calculationNote: "OPEN·CORE·VOLUME·WAVE·FAST · MASTER 단일계좌 1억원",
      mainReconciliation,
      masterReconciliation,
      overall: {
        initialCapital: combinedInitialCapital,
        currentAsset: combinedCurrentAsset,
        netProfit: combinedProfit,
        profitRate: combinedInitialCapital > 0
          ? (combinedProfit / combinedInitialCapital) * 100
          : 0,
        todayRealizedProfit: combinedTodayRealizedProfit,
        holdingCount: mainHoldings.length
      },
      accounts: [
        {
          id: "MASTER",
          label: "5전략 MASTER",
          initialCapital: mainInitialCapital,
          currentAsset: mainTotalAsset,
          netProfit: mainTotalAsset - mainInitialCapital
        }
      ],
      strategies,
      recentDateKeys,
      details: {
        holdings: unifiedHoldings,
        candidateOverview,
        recentSells: unifiedSells
      }
    });
  } catch (error) {
    console.error("[/api/strategy-dashboard-summary 오류]", error);
    res.status(500).json({ ok: false, message: error.message });
  }
});

app.get("/api/performance-summary", (req, res) => {
  try {
    const state = loadState();

    const tradeLogs = Array.isArray(state.tradeLogs)
      ? state.tradeLogs
      : [];

    const rawSellLogs = tradeLogs.filter(isReportSellLog);
    const holdings = Array.isArray(state.holdings)
      ? state.holdings
      : [];
    const positionSummary = buildReportPositionSummary(
      tradeLogs,
      holdings,
      rawSellLogs
    );
    const sellLogs = positionSummary.resolvedSellLogs;
    const closedPositions = positionSummary.closedPositions;
    const winTrades = closedPositions.filter(
      position => Number(position.profit || 0) > 0
    );
    const loseTrades = closedPositions.filter(
      position => Number(position.profit || 0) < 0
    );
    const totalTrades = closedPositions.length;
    const sellFillCount = sellLogs.length;

    const totalProfit = sellLogs.reduce(
      (sum, log) => sum + Number(log.profit || 0),
      0
    );

    const today = new Date().toLocaleDateString("sv-SE", {
      timeZone: "Asia/Seoul"
    });

const todaySellLogs = sellLogs.filter((log) =>
  String(log.date || "").slice(0, 10) === today
);

const todayRealizedProfit = todaySellLogs.reduce(
  (sum, log) => sum + Number(log.profit || 0),
  0
);

    const avgProfitRate =
      totalTrades > 0
        ? closedPositions.reduce(
            (sum, position) => sum + Number(position.profitRate || 0),
            0
          ) /
          totalTrades
        : 0;

    const avgWinRate =
      winTrades.length > 0
        ? winTrades.reduce(
            (sum, position) => sum + Number(position.profitRate || 0),
            0
          ) /
          winTrades.length
        : 0;

    const avgLossRate =
      loseTrades.length > 0
        ? loseTrades.reduce(
            (sum, position) => sum + Number(position.profitRate || 0),
            0
          ) /
          loseTrades.length
        : 0;

    const winRate =
      totalTrades > 0 ? (winTrades.length / totalTrades) * 100 : 0;

    const holdingBuyAmount = holdings.reduce(
      (sum, h) => sum + Number(h.buyPrice || 0) * Number(h.qty || 0),
      0
    );

    const holdingEvalAmount = holdings.reduce(
      (sum, h) => sum + Number(h.currentPrice || h.buyPrice || 0) * Number(h.qty || 0),
      0
    );

    const holdingProfit = holdingEvalAmount - holdingBuyAmount;



const initialCapital = Number(state.initialCapital || 100000000);

// 현재자산은 현금 + 보유종목 평가금액으로 계산한다.
const currentAsset =
  Number(state.totalCash || 0) +
  holdingEvalAmount;

const totalAssetProfit =
  currentAsset - initialCapital;

const totalAssetProfitRate =
  initialCapital > 0
    ? (totalAssetProfit / initialCapital) * 100
    : 0;

const totalRealizedProfit = totalProfit;
const totalUnrealizedProfit = holdingProfit;
const totalCombinedProfit = totalRealizedProfit + totalUnrealizedProfit;

/*
 * 오늘 손익은 전일 보유종목의 누적 평가손익을 다시 더하지 않고,
 * 장 시작 시 저장된 자산(dailyStartAsset) 대비 현재자산 증감으로 계산한다.
 * auto-trader-core.js가 날짜가 바뀔 때 dailyRiskDate와
 * dailyStartAsset을 저장한 경우에만 적용한다.
 */
const todayStartDate = String(
  state.dailyStartDate || state.dailyRiskDate || ""
).slice(0, 10);

const hasTodayStartAsset =
  todayStartDate === today &&
  Number(state.dailyStartAsset || 0) > 0;

const dailyStartAsset = hasTodayStartAsset
  ? Number(state.dailyStartAsset)
  : currentAsset;

const todayProfit = currentAsset - dailyStartAsset;

const recent7Days = [];










const buyLogs = positionSummary.buyRecords.map(record => record.log);

const strategyMap = {};

function ensureStrategyStat(group, strategy) {
  const key = `${group} / ${strategy}`;

  if (!strategyMap[key]) {
    strategyMap[key] = {
      strategyGroup: group,
      strategyName: strategy,
      buyTrades: 0,
      trades: 0,
      sellFills: 0,
      partialOpenTrades: 0,
      wins: 0,
      losses: 0,
      totalProfit: 0,
      closedProfit: 0,
      totalProfitRate: 0,
      maxProfitRate: null,
      maxLossRate: null
    };
  }

  return strategyMap[key];
}

buyLogs.forEach((log) => {
  const group = log.strategyGroup || "CORE";
  const strategy =
    log.strategyName ||
    log.strategyPreset ||
    "기타";

  const stat = ensureStrategyStat(group, strategy);
  stat.buyTrades += 1;
});

positionSummary.positions.forEach(position => {
  const group = position.strategyGroup || "CORE";
  const strategy =
    position.strategyName ||
    position.strategyPreset ||
    "기타";
  const stat = ensureStrategyStat(group, strategy);
  const profit = Number(position.profit || 0);
  const profitRate = Number(position.profitRate || 0);

  stat.sellFills += Number(position.sellFillCount || 0);
  stat.totalProfit += profit;

  if (!position.isClosed) {
    if (position.isPartialOpen) stat.partialOpenTrades += 1;
    return;
  }

  stat.trades += 1;
  stat.closedProfit += profit;
  stat.totalProfitRate += profitRate;

  if (profit > 0) stat.wins += 1;
  if (profit < 0) stat.losses += 1;

  if (stat.maxProfitRate === null || profitRate > stat.maxProfitRate) {
    stat.maxProfitRate = profitRate;
  }

  if (stat.maxLossRate === null || profitRate < stat.maxLossRate) {
    stat.maxLossRate = profitRate;
  }
});

const strategyStats = Object.values(strategyMap).map((item) => ({
  ...item,
  winRate: item.trades > 0 ? (item.wins / item.trades) * 100 : 0,
  avgProfit: item.trades > 0 ? item.closedProfit / item.trades : 0,
  avgProfitRate: item.trades > 0 ? item.totalProfitRate / item.trades : 0,
  maxProfitRate: item.maxProfitRate ?? 0,
  maxLossRate: item.maxLossRate ?? 0
}));

const openStatsRows = strategyStats.filter(
  (item) => String(item.strategyGroup || "").toUpperCase() === "OPEN"
);

const openBuyCount = openStatsRows.reduce(
  (sum, item) => sum + Number(item.buyTrades || 0),
  0
);

const openSellCount = openStatsRows.reduce(
  (sum, item) => sum + Number(item.trades || 0),
  0
);

const openWinCount = openStatsRows.reduce(
  (sum, item) => sum + Number(item.wins || 0),
  0
);

const openLossCount = openStatsRows.reduce(
  (sum, item) => sum + Number(item.losses || 0),
  0
);

const openTotalProfit = openStatsRows.reduce(
  (sum, item) => sum + Number(item.totalProfit || 0),
  0
);

const openTotalProfitRate = openStatsRows.reduce(
  (sum, item) => sum + Number(item.totalProfitRate || 0),
  0
);

const openSummary = {
  buyCount: openBuyCount,
  sellCount: openSellCount,
  winCount: openWinCount,
  lossCount: openLossCount,
  winRate:
    openSellCount > 0
      ? (openWinCount / openSellCount) * 100
      : 0,
  totalProfit: openTotalProfit,
  avgProfit:
    openSellCount > 0
      ? openTotalProfit / openSellCount
      : 0,
  avgProfitRate:
    openSellCount > 0
      ? openTotalProfitRate / openSellCount
      : 0
};














for (let i = 6; i >= 0; i--) {
  const d = new Date();
  d.setDate(d.getDate() - i);
  const dateKey = d.toISOString().slice(0, 10);

  const daySellLogs = sellLogs.filter((log) =>
    String(log.date || "").includes(dateKey)
  );

  const realizedProfit = daySellLogs.reduce(
    (sum, log) => sum + Number(log.profit || 0),
    0
  );

  const dayPositionSummary = buildReportPositionSummary(
    tradeLogs,
    holdings,
    daySellLogs
  );
  const trades = dayPositionSummary.closedPositions.length;
  const sellFills = daySellLogs.length;

const isToday = dateKey === today;

const dayTotalProfit = isToday
  ? todayProfit
  : realizedProfit;

const dayBaseAsset = isToday && dailyStartAsset > 0
  ? dailyStartAsset
  : initialCapital;

const profitRate =
  dayBaseAsset > 0 ? (dayTotalProfit / dayBaseAsset) * 100 : 0;

recent7Days.push({
  date: dateKey,
  realizedProfit: dayTotalProfit,
  profitRate,
  trades,
  sellFills
});
}

const todayTotalProfitRate =
  dailyStartAsset > 0
    ? (todayProfit / dailyStartAsset) * 100
    : 0;

const latestMarketTemperature =
  state.marketTemperature ||
  [...tradeLogs]
    .reverse()
    .find((log) => log.marketTemperature)?.marketTemperature ||
  null;

const holdingDetails = holdings.map((h) => {
  const buyPrice = Number(h.buyPrice || 0);
  const currentPrice = Number(h.currentPrice || buyPrice || 0);
  const qty = Number(h.qty || 0);
  const highestPrice = Number(h.highestPrice || currentPrice || buyPrice || 0);
  const trailingStopRate = Number(h.trailingStopRate || 0);

  const profit = (currentPrice - buyPrice) * qty;
  const buyAmount = buyPrice * qty;
const evalAmount = currentPrice * qty;

const buyTimeMs = Number(h.buyTimeMs || h.buyTime || 0);
const holdingDays = buyTimeMs > 0
  ? Math.max(0, Math.floor((Date.now() - buyTimeMs) / (1000 * 60 * 60 * 24)))
  : 0;


  const profitRate =
    buyPrice > 0 ? ((currentPrice - buyPrice) / buyPrice) * 100 : 0;

  const highestProfitRate =
    buyPrice > 0 ? ((highestPrice - buyPrice) / buyPrice) * 100 : 0;

  const drawdownFromHigh =
    highestPrice > 0 ? ((currentPrice - highestPrice) / highestPrice) * 100 : 0;




return {
  code: h.code,
  name: h.name,
  buyPrice,
  currentPrice,
  qty,
  buyAmount,
  evalAmount,
  holdingDays,
  profit,
  profitRate,
  highestPrice,
  highestProfitRate,
  drawdownFromHigh,

  trailingActive: !!h.trailingActive,
  targetTouched: !!h.targetTouched,
  trailingStartPrice: Number(
  h.trailingStartPrice || 0
),
  trailingStopRate,
  stopLossPrice: Number(h.stopLossPrice || 0),

  strategyGroup: h.strategyGroup || "CORE",
  strategyName: h.strategyName || "",
  strategyPreset: h.strategyPreset || "",
  discoverScore: Number(h.discoverScore || 0),

  finalBuyScore: Number(
    h.finalBuyScore ??
    h.candidateWatchScore ??
    h.finalBuyScoreDetail?.total ??
    h.finalBuyScoreDetail?.score ??
    0
  ),
  finalBuyScoreDetail:
    h.finalBuyScoreDetail ||
    h.candidateWatchScoreDetail ||
    null,
  candidateWatchScoreDetail:
    h.candidateWatchScoreDetail ||
    h.finalBuyScoreDetail ||
    null,
  marketScore: Number(
    h.marketScore?.score ??
    h.marketScore ??
    h.marketTemperature?.score ??
    0
  ),
  marketTemperature: h.marketTemperature || null,
  sectorPowerScore: Number(
    h.sectorPowerScore ??
    h.sectorScore ??
    h.finalBuyScoreDetail?.sectorPowerScore ??
    0
  ),
  leaderStrengthScore: Number(
    h.leaderStrengthScore ??
    h.candidateStrengthScore ??
    h.finalBuyScoreDetail?.leaderStrengthScore ??
    0
  ),

  // 매수 당시 후보 진단정보
  candidateStrengthScore: Number(h.candidateStrengthScore || 0),
  candidateStrengthLabel: h.candidateStrengthLabel || "-",
  candidateWatchScore: Number(h.candidateWatchScore || 0),
  candidateBaseScore: Number(h.candidateBaseScore || 0),
  candidateTrendPenalty: Number(h.candidateTrendPenalty || 0),
  buyPriceDiffRate: Number(h.buyPriceDiffRate || 0),
  buyVolumeDiff: Number(h.buyVolumeDiff || 0),
  buyDayPositionDiff: Number(h.buyDayPositionDiff || 0),
  candidateFirstPrice: Number(h.candidateFirstPrice || 0),
  candidateFirstSeenAtText: h.candidateFirstSeenAtText || null,

  discoverScoreDetails: h.discoverScoreDetails || {},
  discoverReasons: h.discoverReasons || [],
  sectorTags: h.sectorTags || [],

  buyTime: h.buyTime || h.buyTimeMs || "",
  buyTimeText: h.buyTimeText || null,
  buyTimeMs: Number(h.buyTimeMs || h.buyTime || 0),
  date: h.date || "",

  // 보유종목 상세 차트와 현재 상태 표시용
  holdingScore: Number(h.holdingScore || 0),
  holdingScoreDiff: Number(h.holdingScoreDiff || 0),
  currentTradeVolumeRatio: Number(h.currentTradeVolumeRatio || 0),
  currentDayPositionRate: Number(h.currentDayPositionRate || 0),
  currentOpenPositionRate: Number(h.currentOpenPositionRate ?? h.buyOpenPositionRate ?? 0),
  currentChangeRate: Number(h.currentChangeRate || 0),
  buyTradeVolumeRatio: Number(h.buyTradeVolumeRatio || 0),
  buyDayPositionRate: Number(h.buyDayPositionRate || 0),
  buyOpenPositionRate: Number(h.buyOpenPositionRate || 0),
  holdingScoreHistory: Array.isArray(h.holdingScoreHistory)
    ? h.holdingScoreHistory.slice(-120)
    : []
};

});   

    res.json({
      ok: true,
      summary: {
        totalTrades,
        sellFillCount,
        partialOpenTrades: positionSummary.partialOpenPositions.length,
        winTrades: winTrades.length,
        loseTrades: loseTrades.length,
        neutralTrades:
          totalTrades - winTrades.length - loseTrades.length,
        winRate,
        totalProfit,
        avgProfitRate,
        avgWinRate,
        avgLossRate,
        holdingCount: holdings.length,
        holdingBuyAmount,
        holdingEvalAmount,
        holdingProfit,
        initialCapital,
        currentAsset,
        totalAssetProfit,
        totalAssetProfitRate,
        todayProfit,
        todayProfitRate: todayTotalProfitRate,
        todayRealizedProfit,
        dailyStartAsset,
        dailyStartAssetReady: hasTodayStartAsset,
        dailyStartDate: todayStartDate || null,
        dailyStartHoldingProfit: Number(
          state.dailyStartHoldingProfit || 0
        ),
        dailyStartCapturedAt:
          state.dailyStartCapturedAt || null,
        dailyRiskDate: state.dailyRiskDate || null,
        totalRealizedProfit,
        totalUnrealizedProfit,
        totalCombinedProfit,
        openSummary
      },
     holdings: holdingDetails,
     recent7Days,    
     strategyStats,
     recentSells: sellLogs.slice(-20).reverse(),

     marketTemperature: latestMarketTemperature,
    
     candidateAnalysis: {
  date:
    state.buyDecisionStats?.date ||
    null,

  CORE:
    state.buyDecisionStats?.CORE || {
      checked: 0,
      passed: 0,
      bought: 0,

      conditionRejected: {},
      operationalBlocked: {},
      sources: {}
    },

  VOLUME:
    state.buyDecisionStats?.VOLUME || {
      checked: 0,
      passed: 0,
      bought: 0,

      conditionRejected: {},
      operationalBlocked: {},
      sources: {}
    },

  coreTopCandidates:
    state.coreCandidateWatchList || [],

  volumeTopCandidates:
    state.volumeCandidateWatchList || [],

  // 조건은 통과했지만
  // 보유한도·쿨다운 등으로 못 산 후보
  operationalBlockedCandidates:
    state
      .operationalBlockedCandidateAnalysis
      ?.rows || [],

  operationalBlockedCandidateUpdatedAt:
    state
      .operationalBlockedCandidateAnalysis
      ?.updatedAt || null,

  updatedAt:
    state.lastCandidateWatchCheckAt ||
    state.lastBuyCheckAt ||
    null
}

    });
  } catch (err) {
    console.error("성과분석 API 오류:", err);
    res.status(500).json({
      ok: false,
      message: "성과분석 데이터를 불러오지 못했습니다."
    });
  }
});



function getKstDateKey() {
  return new Date().toLocaleDateString("sv-SE", {
    timeZone: "Asia/Seoul"
  });
}

function normalizeRisingStock(item = {}) {
  const code = String(
    item.code ||
    item.stk_cd ||
    item.stockCode ||
    ""
  )
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

  return {
    code,
    name: String(
      item.name ||
      item.stk_nm ||
      item.stockName ||
      code
    ),
    changeRate,
    closePrice: Math.abs(Number(
      item.closePrice ||
      item.currentPrice ||
      item.price ||
      item.raw?.cur_prc ||
      0
    )),
    highPrice: Math.abs(Number(
      item.highPrice ||
      item.high ||
      item.raw?.high_pric ||
      0
    )),
    volume: Math.abs(Number(
      item.volume ||
      item.tradeVolume ||
      item.raw?.trde_qty ||
      0
    )),
    tradeVolumeRatio: Number(
      item.tradeVolumeRatio ??
      item.volumeRatio ??
      0
    )
  };
}

function buildMissedWinnerAnalysis(
  state,
  risingItems = [],
  options = {}
) {
  const date = getKstDateKey();
  const minChangeRate = Number(
    options.minChangeRate ?? 3
  );
  const limit = Math.max(
    1,
    Math.min(200, Number(options.limit || 50))
  );

  const risers = risingItems
    .map(normalizeRisingStock)
    .filter(item =>
      item.code &&
      item.code !== "000000" &&
      Number.isFinite(item.changeRate) &&
      item.changeRate >= minChangeRate
    )
    .sort((a, b) => b.changeRate - a.changeRate)
    .slice(0, limit);

  const decisions =
    state.candidateDecisionHistory?.date === date &&
    Array.isArray(state.candidateDecisionHistory?.rows)
      ? state.candidateDecisionHistory.rows
      : [];

  const tradeLogs = Array.isArray(state.tradeLogs)
    ? state.tradeLogs
    : [];

  const todayBuyCodes = new Set(
    tradeLogs
      .filter(log =>
        String(log.date || "").slice(0, 10) === date &&
        ["OPEN_BUY", "CORE_BUY", "VOLUME_BUY"].includes(log.type)
      )
      .map(log => String(log.code || "").padStart(6, "0"))
  );

  const rows = risers.map(riser => {
    const stockDecisions = decisions.filter(row =>
      String(row.code || "").padStart(6, "0") === riser.code
    );

    const bought =
      todayBuyCodes.has(riser.code) ||
      stockDecisions.some(row => row.bought === true);

    if (stockDecisions.length === 0) {
      return {
        ...riser,
        discovered: false,
        bought,
        firstSeenAt: null,
        latestCheckedAt: null,
        bestWatchScore: 0,
        strategies: [],
        resultCategory: bought
          ? "매수 기록 있음"
          : "미발견",
        resultReason: bought
          ? "매수로그는 있으나 CORE/VOLUME 판단 이력 없음"
          : "CORE/VOLUME 후보 판단 이력에 종목이 없음"
      };
    }

    const firstDecision = [...stockDecisions]
      .map(row => row.first)
      .filter(Boolean)
      .sort((a, b) =>
        Number(a.checkedAtMs || 0) -
        Number(b.checkedAtMs || 0)
      )[0] || null;

    const latestDecision = [...stockDecisions]
      .map(row => row.latest)
      .filter(Boolean)
      .sort((a, b) =>
        Number(b.checkedAtMs || 0) -
        Number(a.checkedAtMs || 0)
      )[0] || null;

    const bestWatchScore = Math.max(
      0,
      ...stockDecisions.map(row =>
        Number(row.best?.watchScore || 0)
      )
    );

    const everPassed = stockDecisions.some(
      row => row.everPassed === true
    );

    let resultCategory = "기타";
    let resultReason =
      latestDecision?.rejectReason ||
      "최종 판단 사유 없음";

    if (bought) {
      resultCategory = "매수 완료";
      resultReason = "오늘 매수 기록 확인";
    } else if (everPassed) {
      resultCategory = "조건 통과 후 미매수";
      resultReason =
        latestDecision?.rejectReason ||
        "한 번 이상 조건을 통과했지만 매수 완료 기록이 없음";
    } else {
      resultCategory =
        latestDecision?.rejectCategory ||
        "기타";
    }

    return {
      ...riser,
      discovered: true,
      bought,
      firstSeenAt: firstDecision?.checkedAt || null,
      latestCheckedAt: latestDecision?.checkedAt || null,
      bestWatchScore,
      strategies: stockDecisions.map(row => ({
        strategyGroup: row.strategyGroup,
        sources: row.sources || [],
        checkCount: Number(row.checkCount || 0),
        everPassed: row.everPassed === true,
        bought: row.bought === true,
        first: row.first || null,
        best: row.best || null,
        latest: row.latest || null
      })),
      resultCategory,
      resultReason
    };
  });

  const categoryCounts = {};

  for (const row of rows) {
    categoryCounts[row.resultCategory] =
      Number(categoryCounts[row.resultCategory] || 0) + 1;
  }

  return {
    date,
    updatedAt: new Date().toLocaleString("ko-KR", {
      timeZone: "Asia/Seoul"
    }),
    minChangeRate,
    limit,
    summary: {
      risingCount: rows.length,
      discoveredCount: rows.filter(row => row.discovered).length,
      notDiscoveredCount: rows.filter(row => !row.discovered).length,
      boughtCount: rows.filter(row => row.bought).length,
      missedCount: rows.filter(row => !row.bought).length,
      categoryCounts
    },
    rows
  };
}

app.post("/api/missed-winners-analysis", (req, res) => {
  try {
    const state = loadState();
    const items = Array.isArray(req.body?.items)
      ? req.body.items
      : [];

    if (items.length === 0) {
      return res.status(400).json({
        ok: false,
        message: "상승 종목 목록 items가 필요합니다."
      });
    }

    const analysis = buildMissedWinnerAnalysis(
      state,
      items,
      {
        minChangeRate: req.body?.minChangeRate,
        limit: req.body?.limit
      }
    );

    state.dailyTopRisers = {
      date: analysis.date,
      updatedAt: analysis.updatedAt,
      rows: items.map(normalizeRisingStock)
    };

    state.missedWinnerAnalysis = analysis;
    savePaperState(state);

    res.json({
      ok: true,
      ...analysis
    });
  } catch (err) {
    console.error("상승 종목 미매수 분석 저장 오류:", err);
    res.status(500).json({
      ok: false,
      message: err.message
    });
  }
});

app.get("/api/missed-winners-analysis", (req, res) => {
  try {
    const state = loadState();
    const date = getKstDateKey();

    const savedRisers =
      state.dailyTopRisers?.date === date &&
      Array.isArray(state.dailyTopRisers?.rows)
        ? state.dailyTopRisers.rows
        : [];

    if (savedRisers.length === 0) {
      return res.json({
        ok: true,
        date,
        ready: false,
        message:
          "오늘 상승 종목 목록이 아직 저장되지 않았습니다. POST /api/missed-winners-analysis로 items를 보내세요.",
        summary: {
          risingCount: 0,
          discoveredCount: 0,
          notDiscoveredCount: 0,
          boughtCount: 0,
          missedCount: 0,
          categoryCounts: {}
        },
        rows: []
      });
    }

    const analysis = buildMissedWinnerAnalysis(
      state,
      savedRisers,
      {
        minChangeRate: req.query.minChangeRate,
        limit: req.query.limit
      }
    );

    state.missedWinnerAnalysis = analysis;
    savePaperState(state);

    res.json({
      ok: true,
      ready: true,
      ...analysis
    });
  } catch (err) {
    console.error("상승 종목 미매수 분석 조회 오류:", err);
    res.status(500).json({
      ok: false,
      message: err.message
    });
  }
});

app.get("/api/candidate-decision-history", (req, res) => {
  try {
    const state = loadState();
    const date = getKstDateKey();
    const code = String(req.query.code || "")
      .trim()
      .padStart(6, "0");

    let rows =
      state.candidateDecisionHistory?.date === date &&
      Array.isArray(state.candidateDecisionHistory?.rows)
        ? state.candidateDecisionHistory.rows
        : [];

    if (code && code !== "000000") {
      rows = rows.filter(row =>
        String(row.code || "").padStart(6, "0") === code
      );
    }

    res.json({
      ok: true,
      date,
      updatedAt:
        state.candidateDecisionHistory?.updatedAt || null,
      count: rows.length,
      rows
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      message: err.message
    });
  }
});

app.get("/api/open-market-status", (req, res) => {
  try {
    const data = loadOpenMarketData();

    res.json({
      ok: true,
      ...data
    });
  } catch (err) {
    console.error("OPEN 장전시장자료 조회 오류:", err);

    res.status(500).json({
      ok: false,
      message: "OPEN 장전시장자료를 불러오지 못했습니다.",
      error: err.message
    });
  }
});

app.post("/api/open-market-refresh", async (req, res) => {
  try {
    const data = await refreshOpenMarketData();

    res.json({
      ok: true,
      message: "OPEN 장전시장자료를 새로 생성했습니다.",
      data
    });
  } catch (err) {
    console.error("OPEN 장전시장자료 갱신 오류:", err);

    res.status(500).json({
      ok: false,
      message: "OPEN 장전시장자료 갱신에 실패했습니다.",
      error: err.message
    });
  }
});



function classifyOpenBuyQuality(selectedTrade = {}, result = {}) {
  const inputs = selectedTrade.selectionInputs || result.selectionInputs || {};
  const momentumScore = Number(inputs.momentumScore || result.buyQualitySnapshot?.momentumScore || 0);
  const pricePersistence = Number(inputs.pricePersistence || result.buyQualitySnapshot?.pricePersistence || 0);
  const volumePersistence = Number(inputs.volumePersistence || result.buyQualitySnapshot?.volumePersistence || 0);
  const highestProfitRate = Number(result.highestProfitRate || selectedTrade.highestProfitRate || 0);

  let grade = "자료 부족";
  let level = "WAIT";
  const reasons = [];

  if (!selectedTrade.code && !result.code) {
    return { grade: "미매수", level: "SKIP", reasons: ["실제 OPEN 매수 없음"] };
  }

  if (momentumScore >= 45 && pricePersistence >= 0.7 && volumePersistence >= 0.55) {
    grade = "양호";
    level = "GOOD";
  } else if (momentumScore >= 35 && pricePersistence >= 0.6 && volumePersistence >= 0.5) {
    grade = "보통";
    level = "NORMAL";
  } else {
    grade = "매수 품질 낮음";
    level = "BAD";
  }

  if (momentumScore < 35) reasons.push(`지속강도 ${momentumScore.toFixed(1)}점`);
  if (pricePersistence < 0.6) reasons.push(`가격 지속 ${(pricePersistence * 100).toFixed(0)}%`);
  if (volumePersistence < 0.5) reasons.push(`거래량 지속 ${(volumePersistence * 100).toFixed(0)}%`);
  if (highestProfitRate < 1) reasons.push(`보유 중 최고수익 ${highestProfitRate.toFixed(2)}%`);

  if (!reasons.length) reasons.push("상승 지속성과 거래량 흐름이 기준 이상");

  return {
    grade,
    level,
    momentumScore,
    pricePersistence,
    volumePersistence,
    highestProfitRate,
    reasons
  };
}

function classifyOpenSellQuality(selectedTrade = {}, result = {}) {
  if (!result || !result.sellType || result.sellType === "OPEN_SKIPPED") {
    return { grade: "평가 대기", level: "WAIT", reasons: ["실제 매도 결과 없음"] };
  }

  const holdingSeconds = Number(result.holdingSeconds || 0);
  const highestProfitRate = Number(result.highestProfitRate || 0);
  const profitRate = Number(result.profitRate || 0);
  const captureRate = Number(result.profitCaptureRate || 0);
  const reasons = [];
  let grade = "보통";
  let level = "NORMAL";

  if (holdingSeconds > 0 && holdingSeconds < 120 && !/STOP_LOSS/.test(String(result.sellType))) {
    grade = "조기매도";
    level = "BAD";
    reasons.push(`보유 ${holdingSeconds}초`);
  }

  if (highestProfitRate >= 1 && captureRate < 35) {
    grade = "수익 회수 낮음";
    level = "BAD";
    reasons.push(`최고수익의 ${captureRate.toFixed(0)}%만 확보`);
  }

  if (/STOP_LOSS/.test(String(result.sellType))) {
    grade = "손절";
    level = profitRate <= -1 ? "NORMAL" : "WAIT";
    reasons.push("손절 기준에 따른 청산");
  }

  if (profitRate > 0 && captureRate >= 50) {
    grade = "양호";
    level = "GOOD";
  }

  if (!reasons.length) {
    reasons.push(`최고 ${highestProfitRate.toFixed(2)}% / 매도 ${profitRate.toFixed(2)}%`);
  }

  return {
    grade,
    level,
    holdingSeconds,
    highestProfitRate,
    profitRate,
    captureRate,
    sellType: result.sellType || null,
    reasons
  };
}

function buildOpenCandidateGrowth(day = {}, selectedCode = "") {
  const observations = day.candidateObservations || {};
  return Object.values(observations)
    .map((item) => {
      const timeline = Array.isArray(item.timeline) ? item.timeline : [];
      const first = timeline[0] || {};
      const last = timeline[timeline.length - 1] || {};
      return {
        code: normalizeOpenStockCode(item.code),
        name: item.name || item.code || "",
        selected: normalizeOpenStockCode(item.code) === normalizeOpenStockCode(selectedCode),
        observationCount: Number(item.observationCount || timeline.length || 0),
        passCount: Number(item.passCount || 0),
        firstSeenAt: item.firstSeenAt || first.observedAt || null,
        lastSeenAt: item.lastSeenAt || last.observedAt || null,
        firstPrice: Number(first.price || 0),
        lastPrice: Number(item.lastPrice || last.price || 0),
        firstDiscoverScore: Number(first.discoverScore || 0),
        lastDiscoverScore: Number(item.lastDiscoverScore || last.discoverScore || 0),
        maxDiscoverScore: Number(item.maxDiscoverScore || 0),
        firstRankScore: Number(first.rankScore || 0),
        lastRankScore: Number(item.lastRankScore || last.rankScore || 0),
        maxRankScore: Number(item.maxRankScore || 0),
        lastMomentumScore: Number(item.lastMomentumScore || last.momentumScore || 0),
        maxMomentumScore: Number(item.maxMomentumScore || 0),
        momentumObservationCount: Number(
          item.lastObservationCount || last.observationCount || 0
        ),
        requiredDiscoverScore: Number(
          item.lastRequiredDiscoverScore || last.requiredDiscoverScore || 0
        ),
        pricePersistence: Number(item.lastPricePersistence || last.pricePersistence || 0),
        volumePersistence: Number(item.lastVolumePersistence || last.volumePersistence || 0),
        highestAfterSeenRate:
          Number(first.price || 0) > 0 && Number(item.highestPrice || 0) > 0
            ? ((Number(item.highestPrice) - Number(first.price)) / Number(first.price)) * 100
            : null,
        lastReason: item.lastReason || last.reason || "",
        passWithoutMarketCount: Number(item.passWithoutMarketCount || 0),
        everMarketOnlyBlocked: item.everMarketOnlyBlocked === true,
        finalMarketOnlyBlocked: item.finalMarketOnlyBlocked === true,
        finalDecisionWithoutMarket: item.finalDecisionWithoutMarket || "",
        lastWithoutMarketReason: item.lastWithoutMarketReason || "",
        lastWithoutMarketRejectCategory: item.lastWithoutMarketRejectCategory || "",
        lastWithoutMarketRejectStage: item.lastWithoutMarketRejectStage || "",
        rejectCategory:
          item.finalRejectCategory ||
          item.lastRejectCategory ||
          last.rejectCategory ||
          "",
        rejectStage:
          item.finalRejectStage ||
          item.lastRejectStage ||
          last.rejectStage ||
          "",
        rejectCategoryCounts:
          item.rejectCategoryCounts &&
          typeof item.rejectCategoryCounts === "object"
            ? item.rejectCategoryCounts
            : {},
        rejectStageCounts:
          item.rejectStageCounts &&
          typeof item.rejectStageCounts === "object"
            ? item.rejectStageCounts
            : {},
        firstSource: item.firstSource || first.source || null,
        lastSource: item.lastSource || last.source || null,
        everHotMatched: item.everHotMatched === true,
        everDirectHotCandidate: item.everDirectHotCandidate === true,
        everPriorityCandidate: item.everPriorityCandidate === true,
        passedDiscoverStage: item.passedDiscoverStage === true,
        passedVolumeStage: item.passedVolumeStage === true,
        passedMomentumStage: item.passedMomentumStage === true,
        finalDecision: item.finalDecision || "",
        hasDetailedTracking: Boolean(
          item.firstRejectStage ||
          item.lastRejectStage ||
          item.finalRejectStage ||
          item.firstSource ||
          item.lastSource ||
          timeline.some(row => Object.prototype.hasOwnProperty.call(row || {}, "rejectStage"))
        ),
        timeline: timeline.slice(-20)
      };
    })
    .sort((a, b) => {
      if (a.selected !== b.selected) return a.selected ? -1 : 1;
      if (b.maxMomentumScore !== a.maxMomentumScore) return b.maxMomentumScore - a.maxMomentumScore;
      return b.maxRankScore - a.maxRankScore;
    })
    .slice(0, 10);
}



function normalizeOpenStockCode(value) {
  const match = String(value || "").match(/\d{6}/);
  return match ? match[0] : "";
}


function isExcludedOpenAnalysisProduct(item = {}) {
  const name = String(
    item.name || item.stockName || item.korName || ""
  ).trim();

  const isFundOrDerivative =
    /(?:^|\s)(?:KODEX|TIGER|ACE|SOL|HANARO|KOSEF|KBSTAR|ARIRANG|RISE|PLUS|TIMEFOLIO|WOORI|1Q|FOCUS|마이티|히어로즈)(?:\s|$)/i.test(name) ||
    /ETF|ETN|인버스|레버리지|선물|선물지수|단일종목|2X|곱버스|TRF|채권혼합|액티브/i.test(name);

  if (isFundOrDerivative) return true;
  if (/스팩|SPAC/i.test(name)) return true;
  if (/우$|\d우B$|우B$|우선주/i.test(name)) return true;
  return false;
}

/* OPEN 실시간 실행상태 조회 */
app.get("/api/open-live-tracking", (req, res) => {
  try {
    const state = loadPaperState();
    const now = Date.now();
    const date = state.openDate || todayKstKey();
    let hot = { count: 0, updatedAt: null, updatedAtMs: 0, ageSeconds: null, items: [] };
    try {
      const hotFile = path.join(__dirname, "hot-candidates.json");
      if (fs.existsSync(hotFile)) {
        const raw = readJsonFileSafe(hotFile, {}) || {};
        hot = {
          count: Number(raw.count || raw.items?.length || raw.rows?.length || 0),
          updatedAt: raw.updatedAt || null,
          updatedAtMs: Number(raw.updatedAtMs || 0),
          ageSeconds: raw.updatedAtMs ? Math.max(0, (now - Number(raw.updatedAtMs)) / 1000) : null,
          retainedPrevious: raw.retainedPrevious === true,
          items: (Array.isArray(raw.items) ? raw.items : []).slice(0, 5).map(item => ({
            rank: Number(item.rank || 0), code: normalizeOpenStockCode(item.code),
            name: item.name || item.code || "", changeRate: Number(item.changeRate || 0),
            tradeVolumeRatio: Number(item.tradeVolumeRatio || 0),
            openMomentumScore: Number(item.openMomentumScore || 0)
          }))
        };
      }
    } catch (err) {
      hot.error = err.message;
    }

    try {
      const hotHistory = readJsonFileSafe(
        HOT_HISTORY_FILE,
        { date, detected: {} }
      ) || { date, detected: {} };
      hot.detectedTodayCount =
        hotHistory.date === date && hotHistory.detected && typeof hotHistory.detected === "object"
          ? Object.keys(hotHistory.detected).length
          : 0;
      const detectedRows =
        hotHistory.date === date && hotHistory.detected && typeof hotHistory.detected === "object"
          ? Object.values(hotHistory.detected)
          : [];
      hot.detectedOpenWindowCount = detectedRows.filter(record => {
        const text = String(record?.firstDetectedAt || "");
        const match = text.match(/(오전|오후|AM|PM)\s*(\d{1,2}):(\d{2})/i);
        if (!match) return false;
        let hour = Number(match[2]);
        const period = String(match[1]).toUpperCase();
        if ((period === "PM" || period === "오후") && hour < 12) hour += 12;
        if ((period === "AM" || period === "오전") && hour === 12) hour = 0;
        const hhmm = `${String(hour).padStart(2, "0")}:${match[3]}`;
        return hhmm >= "09:00" && hhmm <= "09:30";
      }).length;
    } catch (err) {
      hot.historyError = err.message;
      hot.detectedTodayCount = 0;
      hot.detectedOpenWindowCount = 0;
    }

    const tracking = state.openLiveTracking || {};
    const scan = state.openLastScanSummary || {};
    const top = tracking.topCandidate || scan.topCandidate || state.openTopCandidate || null;
    const dailySource = state.openDailyStats?.date === date ? state.openDailyStats : {};
    const daily = {
      scanCount: Number(dailySource.scanCount || 0),
      candidateCount: Object.keys(dailySource.candidateCodes || {}).length,
      evaluatedCount: Object.keys(dailySource.evaluatedCodes || {}).length,
      strictPassedCount: Object.keys(dailySource.strictPassedCodes || {}).length,
      fallbackPassedCount: Object.keys(dailySource.fallbackPassedCodes || {}).length,
      selectedCount: Object.keys(dailySource.selectedCodes || {}).length,
      boughtCount: Object.keys(dailySource.boughtCodes || {}).length,
      hotInputCount: Object.keys(dailySource.hotInputCodes || {}).length
    };
    res.json({
      ok: true,
      date,
      serverAutoEnabled: state.serverAutoEnabled !== false,
      openEnabled: state.openEnabled !== false,
      openCompleted: state.openCompleted === true,
      openSkipped: state.openSkipped === true,
      openCompletedAt: state.openCompletedAt || null,
      openSkipReason: state.openSkipReason || null,
      openBuyAt: state.openBuyAt || null,
      openBuyCode: normalizeOpenStockCode(state.openBuyCode || ""),
      openBuyName: state.openBuyName || null,
      tracking: { ...tracking, topCandidate: top },
      scan: {
        scanId: scan.scanId || null, checkedAt: scan.checkedAt || null,
        candidateCount: Number(scan.candidateCount || 0),
        evaluatedCount: Number(scan.evaluatedCount || 0),
        passedCount: Number(scan.passedCount || 0),
        strictPassedCount: Number(scan.strictPassedCount ?? scan.passedCount ?? 0),
        fallbackPassedCount: Number(scan.fallbackPassedCount || 0),
        potentialCount: Number(scan.potentialCount || 0),
        rejectCounts: scan.rejectCounts || {}
      },
      daily,
      hot,
      activities: (Array.isArray(state.openLiveActivities) ? state.openLiveActivities : []).slice(-10).reverse(),
      serverTime: new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }),
      serverTimeMs: now
    });
  } catch (err) {
    res.status(500).json({ ok: false, message: "OPEN 실시간 상태 조회 실패", error: err.message });
  }
});


/*
 * OPEN AI 분석자료 통합 다운로드
 * 장전자료, OPEN 학습이력, HOT 현재/누적이력, 가상계좌 상태를
 * 하나의 JSON 파일로 묶어 내려준다. 원본 운영 파일은 수정하지 않는다.
 */
app.get("/api/open-analysis-export", (req, res) => {
  try {
    const date = String(req.query.date || todayKstKey()).trim();
    const paperState = readJsonFileSafe(PAPER_STATE_FILE, {}) || {};
    const openHistory = readJsonFileSafe(
      OPEN_HISTORY_FILE,
      { version: 1, updatedAt: null, days: {} }
    ) || { version: 1, updatedAt: null, days: {} };
    const hotCurrent = readJsonFileSafe(
      HOT_CANDIDATES_FILE,
      { date, items: [], rows: [] }
    ) || { date, items: [], rows: [] };
    const hotHistory = readJsonFileSafe(
      HOT_HISTORY_FILE,
      { version: 1, date, detected: {} }
    ) || { version: 1, date, detected: {} };

    let openMarket = null;
    try {
      openMarket = loadOpenMarketData();
    } catch (err) {
      openMarket = { available: false, error: err.message };
    }

    const tradeLogs = (Array.isArray(paperState.tradeLogs) ? paperState.tradeLogs : [])
      .filter(item => String(item.date || "") === date);
    const virtualResults = (Array.isArray(paperState.virtualResults) ? paperState.virtualResults : [])
      .filter(item => String(item.date || "") === date);
    const holdings = (Array.isArray(paperState.holdings) ? paperState.holdings : [])
      .filter(item => String(item.date || item.buyDate || "") === date || String(item.strategyGroup || "") === "OPEN");

    const payload = {
      schemaVersion: 1,
      type: "SY_QUANT_OPEN_AI_ANALYSIS",
      date,
      generatedAt: new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }),
      purpose: "OPEN 미매수·급등주 미포착·후보 성장·매수매도 결과 통합 분석",
      summary: {
        openCompleted: paperState.openCompleted === true,
        openSkipped: paperState.openSkipped === true,
        openSkipReason: paperState.openSkipReason || null,
        openBuyCode: normalizeOpenStockCode(paperState.openBuyCode || ""),
        openBuyName: paperState.openBuyName || null,
        hotCurrentCount: Number(hotCurrent.count || hotCurrent.items?.length || 0),
        hotDetectedTodayCount:
          hotHistory.date === date && hotHistory.detected && typeof hotHistory.detected === "object"
            ? Object.keys(hotHistory.detected).length
            : 0,
        tradeLogCount: tradeLogs.length,
        virtualResultCount: virtualResults.length
      },
      openMarket,
      openLearningDay: openHistory.days?.[date] || null,
      hotCandidatesCurrent: hotCurrent,
      hotCandidatesHistory:
        hotHistory.date === date
          ? hotHistory
          : { ...hotHistory, requestedDate: date, dateMatched: false },
      paperStateSnapshot: {
        openDate: paperState.openDate || null,
        openCompleted: paperState.openCompleted === true,
        openSkipped: paperState.openSkipped === true,
        openCompletedAt: paperState.openCompletedAt || null,
        openSkipReason: paperState.openSkipReason || null,
        openBuyAt: paperState.openBuyAt || null,
        openBuyCode: normalizeOpenStockCode(paperState.openBuyCode || ""),
        openBuyName: paperState.openBuyName || null,
        openLiveTracking: paperState.openLiveTracking || null,
        openLastScanSummary: paperState.openLastScanSummary || null,
        openLiveActivities: Array.isArray(paperState.openLiveActivities)
          ? paperState.openLiveActivities.slice(-100)
          : [],
        tradeLogs,
        virtualResults,
        holdings
      },
      sourceFiles: {
        openLearningHistory: "open-learning-history.json",
        hotCandidatesCurrent: "hot-candidates.json",
        hotCandidatesHistory: "hot-candidates-history.json",
        paperState: "paper-state-core.json",
        openMarket: "open-market.json"
      }
    };

    const fileName = `today-open-analysis-${date}.json`;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    return res.send(JSON.stringify(payload, null, 2));
  } catch (err) {
    console.error("/api/open-analysis-export 오류:", err);
    return res.status(500).json({
      ok: false,
      message: "OPEN AI 분석자료 생성 실패",
      error: err.message
    });
  }
});

/*
 * 오늘 급등주와 OPEN 후보 비교 API
 * 키움 전일대비등락률상위(ka10027)와 open-learning-history.json을 대조한다.
 * 분석 화면 전용이며 실제 매수 조건에는 영향을 주지 않는다.
 */
app.get("/api/open-surge-analysis", async (req, res) => {
  try {
    const kstParts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Seoul",
      hourCycle: "h23",
      hour: "2-digit",
      minute: "2-digit"
    }).formatToParts(new Date());
    const kstHHMM = `${kstParts.find(part => part.type === "hour")?.value || "00"}:${kstParts.find(part => part.type === "minute")?.value || "00"}`;
    const autoMode = String(req.query.mode || "auto").toLowerCase() === "auto";
    let phase = "FINAL";
    let defaultMinRate = 8;
    if (kstHHMM < "09:00") { phase = "PREOPEN"; defaultMinRate = 1; }
    else if (kstHHMM <= "09:30") { phase = "OPEN_LIVE"; defaultMinRate = 0.5; }
    else if (kstHHMM < "15:30") { phase = "MARKET_LIVE"; defaultMinRate = 2; }
    const requestedMinRate = req.query.minRate === undefined ? defaultMinRate : Number(req.query.minRate);
    const minRate = Math.max(0.1, Math.min(29, Number.isFinite(requestedMinRate) ? requestedMinRate : defaultMinRate));
    const limit = Math.max(1, Math.min(50, Number(req.query.limit || 20)));
    const date = String(req.query.date || todayKstKey()).trim();
    const hotSnapshot = readJsonFileSafe(HOT_CANDIDATES_FILE, { items: [], earlyRows: [] }) || { items: [], earlyRows: [] };
    let rankingSource = "KIWOOM_CHANGE_RATE";
    let rankRows = [];

    if (phase === "OPEN_LIVE" && date === todayKstKey()) {
      /*
       * 09:00~09:30에는 분석화면 새로고침이 키움 순위 API를 추가 호출하지 않는다.
       * HOT 스캐너가 이미 저장한 현재·조기 후보를 이용해 실시간 참고표만 만든다.
       */
      const cachedRows = [
        ...(Array.isArray(hotApiCache.data?.items) ? hotApiCache.data.items : []),
        ...(Array.isArray(hotSnapshot.items) ? hotSnapshot.items : []),
        ...(Array.isArray(hotSnapshot.earlyRows) ? hotSnapshot.earlyRows : [])
      ];
      rankRows = Array.from(new Map(
        cachedRows
          .map(item => [normalizeOpenStockCode(item.code || item.stk_cd || ""), item])
          .filter(([code]) => Boolean(code))
      ).values());
      rankingSource = "HOT_LOCAL_CACHE";
    } else {
      const rankData = await requestKiwoomRank("ka10027", {
        mrkt_tp: "000",
        sort_tp: "1",
        trde_qty_cnd: "0000",
        stk_cnd: "4",
        crd_cnd: "0",
        updown_incls: "0",
        pric_cnd: "8",
        trde_prica_cnd: "0",
        stex_tp: "3"
      });
      rankRows = findFirstArrayByKeys(rankData, [
        "pred_pre_flu_rt_upper", "items", "output"
      ]);
    }

    const leaders = rankRows
      .map(row => normalizeHotRankRow(row, "CHANGE_RATE"))
      .filter(Boolean)
      .filter(item => !isExcludedOpenAnalysisProduct(item))
      .filter(item => Number(item.changeRate || 0) >= minRate)
      .sort((a, b) => Number(b.changeRate || 0) - Number(a.changeRate || 0))
      .slice(0, limit);

    const hotCodes = new Set((Array.isArray(hotSnapshot.items) ? hotSnapshot.items : [])
      .map(item => normalizeOpenStockCode(item.code || item.stk_cd || ""))
      .filter(Boolean));
    const hotHistory = readJsonFileSafe(
      HOT_HISTORY_FILE,
      { version: 1, date, detected: {} }
    ) || { version: 1, date, detected: {} };
    const hotDetected = hotHistory.date === date && hotHistory.detected && typeof hotHistory.detected === "object"
      ? hotHistory.detected
      : {};

    const history = readJsonFileSafe(
      OPEN_HISTORY_FILE,
      { version: 1, updatedAt: null, days: {} }
    ) || { version: 1, updatedAt: null, days: {} };
    const day = history.days?.[date] || {};
    const selectedCode = normalizeOpenStockCode(day.selectedTrade?.code || day.result?.code || "");
    const growth = buildOpenCandidateGrowth(day, selectedCode);
    const growthByCode = new Map(growth.map(item => [normalizeOpenStockCode(item.code), item]));
    /* 학습파일 기록이 늦거나 누락돼도 당일 실제 OPEN 누적평가를 발견으로 인정한다. */
    const paperState = loadPaperState();
    const dailyStats = paperState.openDate === date ? (paperState.openDailyStats || {}) : {};
    const dailyCandidateCodes = dailyStats.candidateCodes || {};
    const dailyEvaluatedCodes = dailyStats.evaluatedCodes || {};
    const runtimeHistory = paperState.openDate === date ? (paperState.openCandidateHistory || {}) : {};
    const runtimeCodes = new Set([
      ...Object.keys(dailyCandidateCodes),
      ...Object.keys(dailyEvaluatedCodes),
      ...Object.keys(runtimeHistory)
    ].map(normalizeOpenStockCode).filter(Boolean));
    for (const code of runtimeCodes) {
      if (growthByCode.has(code)) continue;
      const runtime = runtimeHistory[code] || {};
      growthByCode.set(code, {
        code,
        name: dailyEvaluatedCodes[code] || dailyCandidateCodes[code] || runtime.name || code,
        firstSeenAt: runtime.firstSeenAt || null,
        observationCount: Array.isArray(runtime.samples) ? runtime.samples.length : 1,
        momentumObservationCount: Array.isArray(runtime.samples) ? runtime.samples.length : 1,
        firstSource: runtime.itemSnapshot?.source || "OPEN_RUNTIME",
        lastSource: runtime.itemSnapshot?.source || "OPEN_RUNTIME",
        everHotMatched: runtime.itemSnapshot?.isDirectHotCandidate === true,
        everDirectHotCandidate: runtime.itemSnapshot?.isDirectHotCandidate === true,
        hasDetailedTracking: false,
        rejectStage: "RUNTIME_EVALUATED",
        lastReason: "OPEN 누적 평가 확인"
      });
    }

    function classifyDecision(candidate, bought) {
      if (bought) return "실제 매수";
      if (!candidate) return "후보 미발견";
      if (candidate.rejectCategory) return candidate.rejectCategory;
      const reason = String(candidate.lastReason || "");
      if (/거래량 부족/.test(reason)) return "거래량 부족";
      if (/발견점수 부족|추가확인/.test(reason)) return "발견점수 부족";
      if (/관찰 부족/.test(reason)) return "관찰 부족";
      if (/지속성 부족|지속강도/.test(reason)) return "지속강도 부족";
      if (/상승률 부적합/.test(reason)) return "상승률 부적합";
      return reason || "기타 조건 미충족";
    }

    function extractKstHHMM(value) {
      const text = String(value || "").trim();
      if (!text) return null;

      const korean = text.match(/(오전|오후|AM|PM)\s*(\d{1,2}):(\d{2})/i);
      if (korean) {
        const period = String(korean[1]).toUpperCase();
        let hour = Number(korean[2]);
        const minute = Number(korean[3]);
        const isPm = period === "오후" || period === "PM";
        const isAm = period === "오전" || period === "AM";
        if (isPm && hour < 12) hour += 12;
        if (isAm && hour === 12) hour = 0;
        return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
      }

      const plain = text.match(/(?:T|\s)(\d{2}):(\d{2})(?::\d{2})?/);
      return plain ? `${plain[1]}:${plain[2]}` : null;
    }

    function isWithinOpenWindow(value) {
      const hhmm = extractKstHHMM(value);
      return Boolean(hhmm && hhmm >= "09:00" && hhmm <= "09:30");
    }

    function isAfterOpenWindow(value) {
      const hhmm = extractKstHHMM(value);
      return Boolean(hhmm && hhmm > "09:30");
    }

    function classifyEffectiveDecision(candidate, bought) {
      const firstGateDecision = classifyDecision(candidate, bought);
      if (bought || !candidate) return firstGateDecision;

      if (
        candidate.finalMarketOnlyBlocked === true ||
        (
          candidate.everMarketOnlyBlocked === true &&
          Number(candidate.passWithoutMarketCount || 0) > 0
        ) ||
        candidate.finalDecisionWithoutMarket === "시장제외 매수가능"
      ) {
        return "시장만 차단";
      }

      if (
        firstGateDecision === "시장·섹터" &&
        candidate.lastWithoutMarketRejectCategory &&
        candidate.lastWithoutMarketRejectCategory !== "시장·섹터"
      ) {
        return candidate.lastWithoutMarketRejectCategory;
      }

      return firstGateDecision;
    }

    const rows = leaders.map((leader, index) => {
      const normalizedCode = normalizeOpenStockCode(leader.code);
      const candidate = growthByCode.get(normalizedCode) || null;
      const bought = normalizedCode === selectedCode;
      const hotRecord = hotDetected[normalizedCode] || null;
      const hotFirstDetectedAt = hotRecord?.firstDetectedAt || null;
      const hotDetectedWithinOpenWindow = isWithinOpenWindow(hotFirstDetectedAt);
      const openFoundWithinWindow = Boolean(candidate && isWithinOpenWindow(candidate.firstSeenAt));
      const hotDetectedAfterOpen = Boolean(hotRecord && isAfterOpenWindow(hotFirstDetectedAt));
      const openFoundAfterWindow = Boolean(candidate && isAfterOpenWindow(candidate.firstSeenAt));
      const firstGateDecision = classifyDecision(candidate, bought);
      const decision =
        !bought && openFoundAfterWindow
          ? "OPEN 종료 후 발견"
          : !bought && !candidate && hotDetectedAfterOpen
          ? "OPEN 종료 후 HOT 발견"
          : classifyEffectiveDecision(candidate, bought);
      const analysisCategory = bought
        ? "실제 매수"
        : !hotRecord
          ? "HOT 발굴 실패"
          : hotDetectedAfterOpen && !candidate
            ? "OPEN 종료 후 HOT 발견"
          : !candidate
            ? "HOT→OPEN 미유입"
            : decision;
      return {
        rank: index + 1,
        code: normalizedCode,
        rawCode: String(leader.code || ""),
        name: leader.name,
        currentPrice: Number(leader.currentPrice || 0),
        changeRate: Number(leader.changeRate || 0),
        volume: Number(leader.volume || 0),
        openFound: Boolean(candidate),
        discovered: Boolean(candidate),
        openDiscovered: Boolean(candidate),
        bought,
        firstSeenAt: candidate?.firstSeenAt || null,
        observationCount: Number(candidate?.observationCount || 0),
        momentumObservationCount: Number(candidate?.momentumObservationCount || 0),
        maxDiscoverScore: Number(candidate?.maxDiscoverScore || 0),
        lastDiscoverScore: Number(candidate?.lastDiscoverScore || 0),
        requiredDiscoverScore: Number(candidate?.requiredDiscoverScore || 0),
        maxRankScore: Number(candidate?.maxRankScore || 0),
        maxMomentumScore: Number(candidate?.maxMomentumScore || 0),
        rejectStage: candidate?.rejectStage || null,
        firstSource: candidate?.firstSource || null,
        lastSource: candidate?.lastSource || null,
        currentHotMatched: hotCodes.has(normalizedCode),
        hotDetectedToday: Boolean(hotRecord),
        hotDetected: Boolean(hotRecord),
        hotFirstDetectedAt,
        hotLastDetectedAt: hotRecord?.lastDetectedAt || null,
        hotDetectionCount: Number(hotRecord?.detectionCount || 0),
        hotBestRank: Number(hotRecord?.bestRank || 0),
        hotMaxChangeRate: Number(hotRecord?.maxChangeRate || 0),
        hotMaxMomentumScore: Number(hotRecord?.maxMomentumScore || 0),
        hotSources: Array.isArray(hotRecord?.sources) ? hotRecord.sources : [],
        hotDetectedWithinOpenWindow,
        hotDetectedAfterOpen,
        openFoundWithinWindow,
        openFoundAfterWindow,
        openOpportunity: hotDetectedWithinOpenWindow || openFoundWithinWindow,
        everHotMatched: candidate?.everHotMatched === true,
        everDirectHotCandidate: candidate?.everDirectHotCandidate === true,
        everPriorityCandidate: candidate?.everPriorityCandidate === true,
        passedDiscoverStage: candidate?.passedDiscoverStage === true,
        passedVolumeStage: candidate?.passedVolumeStage === true,
        passedMomentumStage: candidate?.passedMomentumStage === true,
        hasDetailedTracking: candidate?.hasDetailedTracking === true,
        lastReason: candidate?.lastReason || "",
        firstGateDecision,
        withoutMarketDecision: candidate?.finalDecisionWithoutMarket || candidate?.lastWithoutMarketRejectCategory || "",
        marketOnlyBlocked: candidate?.finalMarketOnlyBlocked === true || candidate?.everMarketOnlyBlocked === true,
        decision,
        category: analysisCategory,
        judgement: decision
      };
    });

    const reasonCount = {};
    for (const row of rows) {
      // OPEN 시간 안에 실제 포착 기회가 있었던 종목만 미포착 원인에 포함한다.
      if (!row.openOpportunity) continue;
      reasonCount[row.decision] = Number(reasonCount[row.decision] || 0) + 1;
    }
    const reasonStats = Object.entries(reasonCount)
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count);

    const foundCount = rows.filter(row => row.openFound).length;
    const notFoundCount = rows.length - foundCount;
    const boughtCount = rows.filter(row => row.bought).length;
    const topReason = reasonStats[0]?.reason || "자료 없음";
    const diagnosis = [];
    const openOpportunityRows = rows.filter(row => row.openOpportunity);
    const openWindowHotCount = rows.filter(row => row.hotDetectedWithinOpenWindow).length;
    const openWindowFoundCount = rows.filter(row => row.openFoundWithinWindow).length;
    const openWindowBoughtCount = rows.filter(row => row.openOpportunity && row.bought).length;
    const openWindowHotToOpenMissedCount = rows.filter(
      row => row.hotDetectedWithinOpenWindow && !row.openFoundWithinWindow
    ).length;
    const openWindowMarketOnlyBlockedCount = rows.filter(
      row => row.openFoundWithinWindow && row.marketOnlyBlocked && !row.bought
    ).length;
    const postOpenHotCount = rows.filter(
      row => row.hotDetectedAfterOpen
    ).length;
    if (!rows.length) {
      diagnosis.push(`현재 +${minRate.toFixed(0)}% 이상 급등주가 조회되지 않았습니다.`);
    } else {
      const hotDetectedCount = rows.filter(row => row.hotDetectedToday).length;
      diagnosis.push(`급등주 ${rows.length}개 중 당일 HOT은 ${hotDetectedCount}개, OPEN은 ${foundCount}개를 발견했습니다.`);
      diagnosis.push(
        `OPEN 매수시간(09:00~09:30) 안에 포착 가능한 급등주는 ${openOpportunityRows.length}개이며, ` +
        `HOT ${openWindowHotCount}개 → OPEN ${openWindowFoundCount}개 → 실제매수 ${openWindowBoughtCount}개입니다.`
      );
      if (openWindowHotToOpenMissedCount > 0) {
        diagnosis.push(`OPEN 시간 내 HOT 발견 후 OPEN으로 이어지지 않은 종목은 ${openWindowHotToOpenMissedCount}개입니다.`);
      }
      if (postOpenHotCount > 0) {
        diagnosis.push(`OPEN 종료 후 HOT에서 발견된 ${postOpenHotCount}개는 OPEN 매수 대상이 아니므로 미유입 실패에서 제외합니다.`);
      }
      diagnosis.push(`${notFoundCount}개는 하루 전체 기준 OPEN 후보에 없었으며, OPEN 시간 내 판단은 위 시간구간 통계를 사용해야 합니다.`);
      diagnosis.push(`가장 많은 미포착 원인은 '${topReason}'입니다.`);
      if (openWindowHotToOpenMissedCount > 0) {
        diagnosis.push("우선 개선 대상은 OPEN 시간 내 HOT→OPEN 전달과 후보 평가 지연입니다.");
      } else if (openWindowFoundCount > 0) {
        diagnosis.push("OPEN 시간 내 후보 발굴·HOT 전달은 작동했으므로 실제 통과조건과 시장차단 가상성과를 우선 검토해야 합니다.");
      } else {
        diagnosis.push("OPEN 시간 내 포착기회가 부족해 후보 발굴 범위를 계속 관찰해야 합니다.");
      }
      if (openWindowMarketOnlyBlockedCount > 0) {
        diagnosis.push(`시장조건 하나만으로 차단된 후보는 ${openWindowMarketOnlyBlockedCount}개이며, 다른 조건 탈락과 분리해 표시합니다.`);
      }
      const foundButMissed = rows.filter(
        row => row.openFoundWithinWindow && !row.bought
      );
      if (foundButMissed.length) {
        diagnosis.push(`매수시간 안에 발견 후 미매수된 급등주는 ${foundButMissed.slice(0, 3).map(row => row.name).join(", ")}입니다.`);
      }
    }

    return res.json({
      ok: true,
      date,
      phase,
      rankingSource,
      phaseLabel: phase === "OPEN_LIVE" ? "OPEN 실시간" : phase === "MARKET_LIVE" ? "장중 실시간" : phase === "PREOPEN" ? "장전 대기" : "장 종료 최종",
      isFinal: phase === "FINAL",
      autoMode,
      kstHHMM,
      updatedAt: new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }),
      thresholdRate: minRate,
      summary: {
        totalLeaders: rows.length,
        risingCount: rows.length,
        hotDetectedCount: rows.filter(row => row.hotDetectedToday).length,
        // 기존 이름은 화면 호환을 위해 유지하되 OPEN 시간 내 미유입만 반환한다.
        hotToOpenMissedCount: openWindowHotToOpenMissedCount,
        dailyHotToOpenUnmatchedCount: rows.filter(
          row => row.hotDetectedToday && !row.openFound
        ).length,
        foundCount,
        discoveredCount: foundCount,
        notFoundCount,
        boughtCount,
        categoryCounts: rows.reduce((acc, row) => {
          acc[row.category] = Number(acc[row.category] || 0) + 1;
          return acc;
        }, {}),
        openOpportunityCount: openOpportunityRows.length,
        openWindowHotCount,
        openWindowFoundCount,
        openWindowBoughtCount,
        openWindowHotToOpenMissedCount,
        openWindowMarketOnlyBlockedCount,
        postOpenHotCount
      },
      reasonStats,
      diagnosis,
      rows
    });
  } catch (err) {
    console.error("OPEN 급등주 비교 API 오류:", err);
    return res.status(500).json({
      ok: false,
      message: "OPEN 급등주 비교자료를 불러오지 못했습니다.",
      error: err.message,
      rows: []
    });
  }
});

app.get("/api/open-learning-summary", (req, res) => {
  try {
    const history = readJsonFileSafe(
      OPEN_HISTORY_FILE,
      { version: 1, updatedAt: null, days: {} }
    ) || { version: 1, updatedAt: null, days: {} };

    const dayEntries = Object.entries(history.days || {})
      .sort(([a], [b]) => b.localeCompare(a));

    const rows = [];
    const variantMap = {};
    const paperState = loadPaperState();

    for (const [date, day] of dayEntries) {
      const comparison = day?.openDelayComparison || null;
      const variants = Array.isArray(comparison?.variants)
        ? comparison.variants
        : [];

      const normalizedVariants = variants.map((variant) => {
        const profitRate = Number(
          variant.exitProfitRate ??
          variant.profitRate ??
          variant.lastProfitRate ??
          0
        );

        const completed =
          variant.active !== true &&
          (
            variant.exitAt ||
            variant.exitType ||
            comparison?.completedAt
          );

        const row = {
          key: variant.key || "",
          label: variant.label || variant.key || "-",
          delaySeconds: Number(variant.delaySeconds || 0),
          entryPrice: Number(variant.entryPrice || 0),
          exitPrice: Number(variant.exitPrice || 0),
          profitRate,
          highestProfitRate: Number(variant.highestProfitRate || 0),
          lowestProfitRate: Number(variant.lowestProfitRate || 0),
          holdingSeconds: Number(variant.holdingSeconds || 0),
          exitType: variant.exitType || null,
          exitReason: variant.exitReason || null,
          completed: Boolean(completed)
        };

        if (!variantMap[row.key]) {
          variantMap[row.key] = {
            key: row.key,
            label: row.label,
            delaySeconds: row.delaySeconds,
            trades: 0,
            completedTrades: 0,
            wins: 0,
            losses: 0,
            draws: 0,
            totalProfitRate: 0,
            bestProfitRate: null,
            worstProfitRate: null,
            totalHighestProfitRate: 0,
            totalLowestProfitRate: 0,
            totalHoldingSeconds: 0
          };
        }

        const stat = variantMap[row.key];
        stat.trades += 1;

        if (row.completed) {
          stat.completedTrades += 1;
          stat.totalProfitRate += profitRate;
          stat.totalHighestProfitRate += row.highestProfitRate;
          stat.totalLowestProfitRate += row.lowestProfitRate;
          stat.totalHoldingSeconds += row.holdingSeconds;

          if (profitRate > 0) stat.wins += 1;
          else if (profitRate < 0) stat.losses += 1;
          else stat.draws += 1;

          stat.bestProfitRate =
            stat.bestProfitRate === null
              ? profitRate
              : Math.max(stat.bestProfitRate, profitRate);

          stat.worstProfitRate =
            stat.worstProfitRate === null
              ? profitRate
              : Math.min(stat.worstProfitRate, profitRate);
        }

        return row;
      });

      const selectedTrade = day?.selectedTrade || null;
      const selectedCode = selectedTrade?.code || day?.result?.code || "";
      const paperBuyLog = (Array.isArray(paperState.tradeLogs) ? paperState.tradeLogs : [])
        .find(log =>
          String(log.date || "").slice(0, 10) === date &&
          log.type === "OPEN_BUY" &&
          (!selectedCode || normalizeOpenStockCode(log.code) === normalizeOpenStockCode(selectedCode))
        );
      const selectedInputs = selectedTrade?.selectionInputs || {};
      const resultInputs = day?.result?.selectionInputs || {};
      const paperInputs = paperBuyLog?.openBuyDiagnostic || paperBuyLog || {};
      const hasUsefulBuyInputs = inputs =>
        Number(inputs?.momentumScore || 0) > 0 ||
        Number(inputs?.observationCount || 0) > 0 ||
        Number(inputs?.rankScore || 0) > 0;
      const recoveredInputs = hasUsefulBuyInputs(selectedInputs)
        ? selectedInputs
        : (hasUsefulBuyInputs(resultInputs) ? resultInputs : paperInputs);
      const selectedForEvaluation = selectedTrade
        ? { ...selectedTrade, selectionInputs: recoveredInputs }
        : (paperBuyLog
            ? { code: paperBuyLog.code, name: paperBuyLog.name, selectionInputs: recoveredInputs }
            : {});
      const resultForEvaluation = day?.result
        ? { ...day.result, selectionInputs: recoveredInputs }
        : {};
      const buyEvaluation = classifyOpenBuyQuality(selectedForEvaluation, resultForEvaluation);
      const sellEvaluation = classifyOpenSellQuality(selectedTrade || {}, day?.result || {});
      const candidateGrowth = buildOpenCandidateGrowth(day || {}, selectedCode);

      rows.push({
        date,
        status: day?.status || null,
        code: comparison?.code || selectedTrade?.code || day?.result?.code || null,
        name: comparison?.name || day?.selectedTrade?.name || null,
        createdAt: comparison?.createdAt || null,
        completedAt: comparison?.completedAt || null,
        selectedTrade: selectedTrade
          ? {
              code: selectedTrade.code || null,
              name: selectedTrade.name || null,
              selectedAt: selectedTrade.selectedAt || null,
              buyPrice: Number(selectedTrade.buyPrice || 0),
              qty: Number(selectedTrade.qty || 0),
              selectionReason: selectedTrade.selectionReason || "",
              selectionInputs: recoveredInputs
            }
          : null,
        realTrade: day?.result
          ? {
              code: day.result.code || selectedTrade?.code || null,
              name: day.result.name || selectedTrade?.name || null,
              sellType: day.result.sellType || null,
              sellReason: day.result.sellReason || null,
              buyPrice: Number(day.result.buyPrice || selectedTrade?.buyPrice || 0),
              sellPrice: Number(day.result.sellPrice || 0),
              profit: Number(day.result.profit || 0),
              profitRate: Number(day.result.profitRate || 0),
              highestProfitRate: Number(day.result.highestProfitRate || 0),
              lowestProfitRate: Number(day.result.lowestProfitRate || 0),
              holdingSeconds: Number(day.result.holdingSeconds || 0),
              profitCaptureRate: Number(day.result.profitCaptureRate || 0),
              selectionInputs: day.result.selectionInputs || selectedTrade?.selectionInputs || {}
            }
          : null,
        buyEvaluation,
        sellEvaluation,
        candidateGrowth,
        variants: normalizedVariants
      });
    }

    const variants = Object.values(variantMap)
      .map((stat) => ({
        ...stat,
        winRate:
          stat.completedTrades > 0
            ? (stat.wins / stat.completedTrades) * 100
            : 0,
        avgProfitRate:
          stat.completedTrades > 0
            ? stat.totalProfitRate / stat.completedTrades
            : 0,
        avgHighestProfitRate:
          stat.completedTrades > 0
            ? stat.totalHighestProfitRate / stat.completedTrades
            : 0,
        avgLowestProfitRate:
          stat.completedTrades > 0
            ? stat.totalLowestProfitRate / stat.completedTrades
            : 0,
        avgHoldingSeconds:
          stat.completedTrades > 0
            ? stat.totalHoldingSeconds / stat.completedTrades
            : 0,
        bestProfitRate: stat.bestProfitRate ?? 0,
        worstProfitRate: stat.worstProfitRate ?? 0
      }))
      .sort((a, b) => a.delaySeconds - b.delaySeconds);

    const bestVariant = variants
      .filter((item) => item.completedTrades > 0)
      .sort((a, b) => {
        if (b.avgProfitRate !== a.avgProfitRate) {
          return b.avgProfitRate - a.avgProfitRate;
        }
        return b.winRate - a.winRate;
      })[0] || null;

    res.json({
      ok: true,
      updatedAt: history.updatedAt || null,
      dayCount: rows.length,
      completedDayCount: rows.filter(
        (row) => row.variants.some((variant) => variant.completed)
      ).length,
      bestVariant,
      variants,
      rows
    });
  } catch (err) {
    console.error("OPEN 학습결과 API 오류:", err);
    res.status(500).json({
      ok: false,
      message: "OPEN 학습결과를 불러오지 못했습니다.",
      error: err.message
    });
  }
});


/*
 * OPEN 미매수 TOP3 분석 API
 * 기존 open-learning-history.json의 가상추적 자료를 읽기만 한다.
 * OPEN 매수 판단과 CORE/VOLUME 로직에는 영향을 주지 않는다.
 */
app.get("/api/open-missed-top3", (req, res) => {
  try {
    const history = readJsonFileSafe(
      OPEN_HISTORY_FILE,
      { version: 1, updatedAt: null, days: {} }
    ) || { version: 1, updatedAt: null, days: {} };

    const requestedDate = String(req.query.date || "").trim();
    const availableDates = Object.keys(history.days || {})
      .sort((a, b) => b.localeCompare(a));
    const date = requestedDate || availableDates[0] || null;
    const day = date ? history.days?.[date] : null;

    if (!day) {
      return res.json({
        ok: true,
        date,
        status: "EMPTY",
        updatedAt: history.updatedAt || null,
        rows: []
      });
    }

    const selectedCode = String(day.selectedTrade?.code || "");
    const candidates = Array.isArray(day.virtualCandidates)
      ? day.virtualCandidates
      : [];

    const rows = candidates
      .filter((item) => {
        const code = String(item.code || "");
        return code &&
          item.selectedForRealTrade !== true &&
          code !== selectedCode;
      })
      .sort((a, b) => Number(a.rank || 999) - Number(b.rank || 999))
      .slice(0, 3)
      .map((item, index) => {
        const highestProfitRate = Number(item.highestProfitRate || 0);
        const lowestProfitRate = Number(item.lowestProfitRate || 0);
        const completed = item.active !== true && Boolean(item.exitType || item.exitAt);
        const closingProfitRate = completed
          ? Number(item.exitProfitRate ?? item.lastProfitRate ?? 0)
          : null;

        let resultLabel = "추적 중";
        if (completed) {
          if (highestProfitRate >= 3 || Number(closingProfitRate || 0) >= 2) {
            resultLabel = "아쉬운 미매수";
          } else if (Number(closingProfitRate || 0) <= 0) {
            resultLabel = "미매수 성공";
          } else {
            resultLabel = "중립";
          }
        }

        return {
          rank: index + 1,
          originalRank: Number(item.rank || index + 1),
          code: String(item.code || ""),
          name: item.name || item.code || "-",
          firstSeenAt: item.entryAt || null,
          firstPrice: Number(item.entryPrice || 0),
          discoverScore: Number(item.discoverScore || 0),
          finalScore: Number(item.rankScore || 0),
          rejectReason:
            item.rejectReason ||
            item.selectionReason ||
            "미매수 사유 미저장",
          highestPrice: Number(item.highestPrice || 0),
          lowestPrice: Number(item.lowestPrice || 0),
          lastPrice: Number(item.lastPrice || 0),
          highestProfitRate,
          lowestProfitRate,
          closingProfitRate,
          exitType: item.exitType || null,
          active: item.active === true,
          resultLabel
        };
      });

    return res.json({
      ok: true,
      date,
      status: rows.some((row) => row.active) ? "TRACKING" : "COMPLETED",
      updatedAt: history.updatedAt || null,
      trackingStartedAt: day.virtualTrackingStartedAt || null,
      trackingCompletedAt: day.virtualTrackingCompletedAt || null,
      rows
    });
  } catch (err) {
    console.error("OPEN 미매수 TOP3 API 오류:", err);
    return res.status(500).json({
      ok: false,
      message: "OPEN 미매수 TOP3를 불러오지 못했습니다.",
      error: err.message,
      rows: []
    });
  }
});

app.get("/api/daily-summary", (req, res) => {
  try {
    const state = loadState();
    const tradeLogs = Array.isArray(state.tradeLogs) ? state.tradeLogs : [];
    const holdings = Array.isArray(state.holdings) ? state.holdings : [];

   const sellTypes = [
  "SELL",
  "SELL_ALL",

  "OPEN_MANUAL_SELL",

  "CORE_MANUAL_SELL",

  "VOLUME_MANUAL_SELL",

  "OPEN_STOP_LOSS",
  "OPEN_TRAILING_SELL",
  "OPEN_STAGNATION_SELL",
  "OPEN_TIME_SELL",

  "CORE_STOP_LOSS",
  "CORE_FIRST_TAKE_PROFIT",
  "CORE_BREAK_EVEN_SELL",
  "CORE_TRAILING_STOP",
  "CORE_WEAK_TREND_SELL",
  "CORE_SWITCH_SELL",
  "CORE_END_SELL",

  "VOLUME_STOP_LOSS",
  "VOLUME_FIRST_TAKE_PROFIT",
  "VOLUME_BREAK_EVEN_SELL",
  "VOLUME_TRAILING_STOP",
  "VOLUME_WEAK_TREND_SELL",
  "VOLUME_SWITCH_SELL",
  "VOLUME_END_SELL"
];

   const buyTypes = [
  "OPEN_BUY",
  "CORE_BUY",
  "VOLUME_BUY"
];

    const dateMap = {};

    for (const log of tradeLogs) {
      const date = String(log.date || "").slice(0, 10);
      if (!date) continue;

     if (!dateMap[date]) {
  dateMap[date] = {
    date,

    buyCount: 0,
    sellCount: 0,

    winCount: 0,
    lossCount: 0,

    openProfit: 0,
    coreProfit: 0,
    volumeProfit: 0,

    realizedProfit: 0,

    marketTemperature: null,

    openWins: 0,
    openTrades: 0,

    coreWins: 0,
    coreTrades: 0,

    volumeWins: 0,
    volumeTrades: 0,

    bestTrade: null,
    worstTrade: null
  };
}

      const row = dateMap[date];

      if (buyTypes.includes(log.type)) {
        row.buyCount += 1;

        if (!row.marketTemperature && log.marketTemperature) {
          row.marketTemperature = log.marketTemperature;
        }
      }

     if (sellTypes.includes(log.type)) {
  const profit = Number(log.profit || 0);
  const group = log.strategyGroup || "CORE";

  row.sellCount += 1;
  row.realizedProfit += profit;

  if (profit > 0) row.winCount += 1;
  if (profit < 0) row.lossCount += 1;

  if (group === "OPEN") {
    row.openTrades += 1;
    row.openProfit += profit;

    if (profit > 0) {
      row.openWins += 1;
    }
  }

  if (group === "CORE") {
  row.coreTrades += 1;
  row.coreProfit += profit;

  if (profit > 0) {
    row.coreWins += 1;
  }
}

if (group === "VOLUME") {
  row.volumeTrades += 1;
  row.volumeProfit += profit;

  if (profit > 0) {
    row.volumeWins += 1;
  }
}

  if (!row.bestTrade || profit > row.bestTrade.profit) {
    row.bestTrade = {
      name: log.name,
      code: log.code,
      strategyGroup: group,
      profit,
      profitRate: Number(log.profitRate || 0)
    };
  }

  if (!row.worstTrade || profit < row.worstTrade.profit) {
    row.worstTrade = {
      name: log.name,
      code: log.code,
      strategyGroup: group,
      profit,
      profitRate: Number(log.profitRate || 0)
    };
  }
}
    }

    const today = new Date().toLocaleDateString("sv-SE", {
      timeZone: "Asia/Seoul"
    });

    const holdingProfit = holdings.reduce((sum, h) => {
      const buyPrice = Number(h.buyPrice || 0);
      const currentPrice = Number(h.currentPrice || buyPrice || 0);
      const qty = Number(h.qty || 0);
      return sum + (currentPrice - buyPrice) * qty;
    }, 0);

    if (dateMap[today]) {
      const holdingEvalAmount = holdings.reduce((sum, h) => {
        const currentPrice = Number(h.currentPrice || h.buyPrice || 0);
        const qty = Number(h.qty || 0);
        return sum + currentPrice * qty;
      }, 0);

      const currentAsset =
        Number(state.totalCash || 0) + holdingEvalAmount;

      const todayStartDate = String(
        state.dailyStartDate || state.dailyRiskDate || ""
      ).slice(0, 10);

      const hasTodayStartAsset =
        todayStartDate === today &&
        Number(state.dailyStartAsset || 0) > 0;

      const dailyStartAsset = hasTodayStartAsset
        ? Number(state.dailyStartAsset)
        : currentAsset;

      dateMap[today].holdingProfit = holdingProfit;
      dateMap[today].totalProfit = currentAsset - dailyStartAsset;
      dateMap[today].dailyStartAsset = dailyStartAsset;
      dateMap[today].dailyStartAssetReady = hasTodayStartAsset;
      dateMap[today].dailyStartDate = todayStartDate || null;
      dateMap[today].dailyStartHoldingProfit = Number(
        state.dailyStartHoldingProfit || 0
      );
    }

    const latestMarketTemperature =
  state.marketTemperature ||
  [...tradeLogs]
    .reverse()
    .find((log) => log.marketTemperature)?.marketTemperature ||
  null;

if (dateMap[today] && latestMarketTemperature) {
  dateMap[today].marketTemperature = latestMarketTemperature;
}

   const rows = Object.values(dateMap)
  .sort((a, b) => b.date.localeCompare(a.date))
  .map((row) => ({
    ...row,

    holdingProfit: Number(row.holdingProfit || 0),

    totalProfit:
      typeof row.totalProfit !== "undefined"
        ? row.totalProfit
        : row.realizedProfit,

    winRate:
      row.sellCount > 0
        ? (row.winCount / row.sellCount) * 100
        : 0,

    openWinRate:
      row.openTrades > 0
        ? (row.openWins / row.openTrades) * 100
        : 0,

  coreWinRate:
  row.coreTrades > 0
    ? (row.coreWins / row.coreTrades) * 100
    : 0,

volumeWinRate:
  row.volumeTrades > 0
    ? (row.volumeWins / row.volumeTrades) * 100
    : 0,

   

    bestTrade: row.bestTrade,
    worstTrade: row.worstTrade
  }));

    res.json({
      ok: true,
      rows
    });
  } catch (err) {
    console.error("일일 분석 API 오류:", err);
    res.status(500).json({
      ok: false,
      message: "일일 분석 데이터를 불러오지 못했습니다."
    });
  }
});

app.get("/api/server-auto-toggle", (req, res) => {
  const enabled =
    String(req.query.enabled || "").toLowerCase() === "true";

  const state = setServerAutoEnabled(enabled);

  res.json({
    ok: true,
    serverAutoEnabled: state.serverAutoEnabled,
    serverAutoChangedAt: state.serverAutoChangedAt
  });
});


app.get("/api/daily-code-changes", (req, res) => {
  try {
    const date = String(
      req.query.date || todayKstKey()
    ).trim();

    const data = loadDailyCodeChanges();
    const day = data.days[date] || {
      date,
      updatedAt: null,
      memo: ""
    };

    res.json({
      ok: true,
      ...day
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error.message
    });
  }
});

app.post("/api/daily-code-changes", (req, res) => {
  try {
    const date = String(
      req.body?.date || todayKstKey()
    ).trim();

    const memo = String(
      req.body?.memo || ""
    ).trim();

    const data = loadDailyCodeChanges();

    data.days[date] = {
      date,
      updatedAt: new Date().toLocaleString(
        "ko-KR",
        { timeZone: "Asia/Seoul" }
      ),
      memo
    };

    /*
     * 오래된 기록은 90일까지만 유지한다.
     */
    const dates = Object.keys(data.days)
      .sort()
      .reverse();

    for (const oldDate of dates.slice(90)) {
      delete data.days[oldDate];
    }

    saveDailyCodeChanges(data);

    res.json({
      ok: true,
      ...data.days[date]
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error.message
    });
  }
});

function buildSellReasonAnalysis(sellLogs = []) {
  const allTypeCounts = {};
  const lossTypeCounts = {};
  const lossDetails = {};

  for (const log of sellLogs) {
    const type = String(log?.type || "UNKNOWN_SELL");
    const profit = Number(log?.profit || 0);

    allTypeCounts[type] =
      Number(allTypeCounts[type] || 0) + 1;

    // 손실 원인은 실제 실현손익이 음수인 매도만 집계한다.
    if (profit >= 0) {
      continue;
    }

    lossTypeCounts[type] =
      Number(lossTypeCounts[type] || 0) + 1;

    if (!lossDetails[type]) {
      lossDetails[type] = {
        type,
        count: 0,
        totalLoss: 0,
        worstLoss: 0
      };
    }

    const detail = lossDetails[type];
    detail.count += 1;
    detail.totalLoss += profit;
    detail.worstLoss = Math.min(
      Number(detail.worstLoss || 0),
      profit
    );
  }

  const lossReasonRanking = Object.values(lossDetails)
    .map(detail => ({
      ...detail,
      averageLoss:
        detail.count > 0
          ? detail.totalLoss / detail.count
          : 0
    }))
    .sort((a, b) =>
      Number(b.count || 0) - Number(a.count || 0) ||
      Number(a.totalLoss || 0) - Number(b.totalLoss || 0) ||
      String(a.type || "").localeCompare(String(b.type || ""))
    );

  return {
    allTypeCounts,
    lossTypeCounts,
    lossReasonRanking,
    topLossReason: lossReasonRanking[0] || null
  };
}

app.get("/api/today-trade-analysis", (req, res) => {
  try {
    const state = loadState();

    function todayKstText() {
      const now = new Date();
      const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
      return kst.toISOString().slice(0, 10);
    }

    const today = todayKstText();

    /*
     * 오늘 OPEN 가상추적 결과를 오늘 거래 분석에 포함한다.
     * open-strategy.js가 저장한 open-learning-history.json의
     * virtualSummary.firstCandidate를 읽어 전달한다.
     */
    const openHistory = readJsonFileSafe(
      OPEN_HISTORY_FILE,
      { version: 1, updatedAt: null, days: {} }
    ) || { version: 1, updatedAt: null, days: {} };

    const openLearningDay = openHistory.days?.[today] || null;
    const openVirtualSummary = openLearningDay?.virtualSummary || null;
    const openFirstCandidate = openVirtualSummary?.firstCandidate || null;

    const openVirtualTop1 = openFirstCandidate
      ? {
          rank: Number(openFirstCandidate.rank || 1),
          code: String(openFirstCandidate.code || ""),
          name: String(
            openFirstCandidate.name ||
            openFirstCandidate.code ||
            ""
          ),
          entryPrice: Number(openFirstCandidate.entryPrice || 0),
          highestProfitRate: Number(
            openFirstCandidate.highestProfitRate || 0
          ),
          lowestProfitRate: Number(
            openFirstCandidate.lowestProfitRate || 0
          ),
          exitProfitRate: Number(
            openFirstCandidate.exitProfitRate || 0
          ),
          exitType: openFirstCandidate.exitType || null,
          completedAt:
            openLearningDay?.virtualTrackingCompletedAt || null
        }
      : null;

    const openCandidateReferenceStats = openVirtualSummary
      ? {
          sampleCount: Number(openVirtualSummary.sampleCount || 0),
          winCount: Number(openVirtualSummary.winCount || 0),
          lossCount: Number(openVirtualSummary.lossCount || 0),
          avgProfitRate: Number(openVirtualSummary.avgProfitRate || 0)
        }
      : null;

    const trades = Array.isArray(state.tradeLogs) ? state.tradeLogs : [];

    const todayLogs = trades.filter(log => {
      return String(log.date || "").trim() === today;
    });

   const buyTypes = [
  "OPEN_BUY",
  "CORE_BUY",
  "VOLUME_BUY"
];
  const sellTypes = [
  "SELL",
  "SELL_ALL",

  "OPEN_MANUAL_SELL",

  "CORE_MANUAL_SELL",

  "VOLUME_MANUAL_SELL",

  "OPEN_STOP_LOSS",
  "OPEN_TRAILING_SELL",
  "OPEN_STAGNATION_SELL",
  "OPEN_TIME_SELL",

  "CORE_STOP_LOSS",
  "CORE_FIRST_TAKE_PROFIT",
  "CORE_BREAK_EVEN_SELL",
  "CORE_TRAILING_STOP",
  "CORE_END_SELL",

  "VOLUME_STOP_LOSS",
  "VOLUME_FIRST_TAKE_PROFIT",
  "VOLUME_BREAK_EVEN_SELL",
  "VOLUME_TRAILING_STOP",
  "VOLUME_END_SELL"
];

    const buys = todayLogs
      .filter(log => buyTypes.includes(log.type))
      .map(log => ({
        ...log,
        marketScore: Number(log.marketScore?.score ?? log.marketScore ?? 0),
        candidateStrengthScore: Number(log.candidateStrengthScore || 0),
        candidateStrengthLabel: log.candidateStrengthLabel || "-",
        candidateWatchScore: Number(log.candidateWatchScore || 0),
        candidateBaseScore: Number(log.candidateBaseScore || 0),
        candidateTrendPenalty: Number(log.candidateTrendPenalty || 0),
        buyPriceDiffRate: Number(log.buyPriceDiffRate || 0),
        buyVolumeDiff: Number(log.buyVolumeDiff || 0),
        buyDayPositionDiff: Number(log.buyDayPositionDiff || 0),
        candidateFirstPrice: Number(log.candidateFirstPrice || 0),
        candidateFirstSeenAtText: log.candidateFirstSeenAtText || null,
        openMomentumScore: Number(log.momentumScore || log.openBuyDiagnostic?.momentumScore || 0),
        openMomentumReason: log.momentumReason || log.openBuyDiagnostic?.momentumReason || "",
        openHotMomentumScore: Number(log.hotMomentumScore || log.openBuyDiagnostic?.hotMomentumScore || 0),
        openHotMomentumBonus: Number(log.hotMomentumBonus || log.openBuyDiagnostic?.hotMomentumBonus || 0),
        openPriceRise30s: Number(log.hotPriceRise30s || log.openBuyDiagnostic?.hotPriceRise30s || 0),
        openVolumeGrowth30s: Number(log.hotVolumeGrowth30s || log.openBuyDiagnostic?.hotVolumeGrowth30s || 0),
        openPricePersistence: Number(log.hotPricePersistence || log.openBuyDiagnostic?.hotPricePersistence || 0),
        openVolumePersistence: Number(log.hotVolumePersistence || log.openBuyDiagnostic?.hotVolumePersistence || 0),
        openHighRefreshCount: Number(log.hotHighRefreshCount || log.openBuyDiagnostic?.hotHighRefreshCount || 0),
        openHotDurationSeconds: Number(log.hotDurationSeconds || log.openBuyDiagnostic?.hotDurationSeconds || 0),
        openConfirmPriceRiseRate: Number(log.confirmPriceRiseRate || log.openBuyDiagnostic?.confirmPriceRiseRate || 0),
        openRecentPriceDiffRate: Number(log.recentPriceDiffRate || log.openBuyDiagnostic?.recentPriceDiffRate || 0)
      }));

    const sells = todayLogs
      .filter(log => sellTypes.includes(log.type))
      .map(log => ({
        ...log,
        marketScore: Number(log.marketScore?.score ?? log.marketScore ?? 0),
        candidateStrengthScore: Number(log.candidateStrengthScore || 0),
        candidateStrengthLabel: log.candidateStrengthLabel || "-",
        candidateBaseScore: Number(log.candidateBaseScore || 0),
        candidateTrendPenalty: Number(log.candidateTrendPenalty || 0),
        buyPriceDiffRate: Number(log.buyPriceDiffRate || 0),
        buyVolumeDiff: Number(log.buyVolumeDiff || 0),
        buyDayPositionDiff: Number(log.buyDayPositionDiff || 0),
        sellSignalAt: log.sellSignalAt || null,
        sellSignalPrice: Number(log.sellSignalPrice || 0),
        sellOrderRequestedAt: log.sellOrderRequestedAt || null,
        sellExecutedAt: log.sellExecutedAt || null,
        sellSlippageRate: Number(log.sellSlippageRate || 0)
      }));

    const realizedProfit = sells.reduce(
      (sum, log) => sum + Number(log.profit || 0),
      0
    );

    const positionSummary = buildReportPositionSummary(
      trades,
      Array.isArray(state.holdings) ? state.holdings : [],
      sells
    );
    const closedPositions = positionSummary.closedPositions;
    const wins = closedPositions.filter(
      position => Number(position.profit || 0) > 0
    );
    const losses = closedPositions.filter(
      position => Number(position.profit || 0) < 0
    );
    const uniqueBuyCount = new Set(
      buys.map((log, index) => reportBuyIdentity(log, index))
    ).size;

    const sellReasonAnalysis =
      buildSellReasonAnalysis(sells);

    // 전체 매도사유 표는 기존 필드를 유지한다.
    const sellTypeCounts =
      sellReasonAnalysis.allTypeCounts;

    // 손실 원인 TOP은 수익 매도를 제외한 전용 집계를 사용한다.
    const lossSellTypeCounts =
      sellReasonAnalysis.lossTypeCounts;

    const lossReasonRanking =
      sellReasonAnalysis.lossReasonRanking;

    const topLossReason =
      sellReasonAnalysis.topLossReason;

    const byStrategy = {};

    function ensureTodayStrategy(strategy) {
      if (!byStrategy[strategy]) {
        byStrategy[strategy] = {
          buyCount: 0,
          trades: 0,
          sellFillCount: 0,
          partialOpenTrades: 0,
          wins: 0,
          losses: 0,
          profit: 0,
          winProfitSum: 0,
          lossProfitSum: 0,
          maxProfit: null,
          maxLoss: null
        };
      }

      return byStrategy[strategy];
    }

    const seenTodayBuys = new Set();
    buys.forEach((log, index) => {
      const identity = reportBuyIdentity(log, index);
      if (seenTodayBuys.has(identity)) return;
      seenTodayBuys.add(identity);
      ensureTodayStrategy(reportStrategy(log)).buyCount += 1;
    });

    positionSummary.positions.forEach(position => {
      const strategy = position.strategyGroup;
      const profit = Number(position.profit || 0);
      const s = ensureTodayStrategy(strategy);

      s.sellFillCount += Number(position.sellFillCount || 0);
      s.profit += profit;

      if (!position.isClosed) {
        if (position.isPartialOpen) s.partialOpenTrades += 1;
        return;
      }

      s.trades += 1;

      if (profit > 0) {
        s.wins += 1;
        s.winProfitSum += profit;
      }

      if (profit < 0) {
        s.losses += 1;
        s.lossProfitSum += profit;
      }

      if (s.maxProfit === null || profit > s.maxProfit) {
        s.maxProfit = profit;
      }

      if (s.maxLoss === null || profit < s.maxLoss) {
        s.maxLoss = profit;
      }
    });

    // 거래가 없었던 전략도 0건으로 내려 화면에서 실행 여부를 구분한다.
    ensureTodayStrategy("CORE");
    ensureTodayStrategy("VOLUME");

    Object.keys(byStrategy).forEach(key => {
      const s = byStrategy[key];

      s.winRate = s.trades > 0 ? (s.wins / s.trades) * 100 : 0;
      s.avgProfit = s.wins > 0 ? s.winProfitSum / s.wins : 0;
      s.avgLoss = s.losses > 0 ? s.lossProfitSum / s.losses : 0;
    });

    const currentSettings =
      getCurrentTradingSettings();

    const codeChangeImportResult =
      importCodeChangeLog();

    const automaticCodeChanges =
      getCodeChangesForDate(today);

    const dailyCodeChanges =
      loadDailyCodeChanges();

    const manualCodeChanges =
      dailyCodeChanges.days?.[today] || {
        date: today,
        updatedAt: null,
        memo: ""
      };

    const todayCodeChanges = {
      ...manualCodeChanges,
      automatic: automaticCodeChanges,
      automaticCount: automaticCodeChanges.length,
      importResult: codeChangeImportResult
    };

    res.json({
      ok: true,
      date: today,

      currentSettings,
      todayCodeChanges,

      summary: {
        buyCount: uniqueBuyCount,
        buyLogCount: buys.length,
        sellCount: closedPositions.length,
        sellFillCount: sells.length,
        partialOpenCount: positionSummary.partialOpenPositions.length,
        winCount: wins.length,
        lossCount: losses.length,
        neutralCount:
          closedPositions.length - wins.length - losses.length,
        winRate:
          closedPositions.length > 0
            ? (wins.length / closedPositions.length) * 100
            : 0,
        realizedProfit,
        topLossReason
      },
      byStrategy,
      sellTypeCounts,
      lossSellTypeCounts,
      lossReasonRanking,
      topLossReason,

      // OPEN이 미매수여도 실행 결과와 사유를 항상 전달한다.
      openStatus: {
        date: state.openDate || today,
        completed: state.openCompleted === true,
        skipped: state.openSkipped === true,
        completedAt: state.openCompletedAt || null,
        skipReason: state.openSkipReason || null,
        topCandidate: openVirtualTop1
      },

      // 오늘 분석에서 OPEN 1위 후보의 가상매매 결과를 사용한다.
      openVirtualTop1,
      openCandidateReferenceStats,
      openVirtualTracking: {
        startedAt:
          openLearningDay?.virtualTrackingStartedAt || null,
        completedAt:
          openLearningDay?.virtualTrackingCompletedAt || null,
        completed: Boolean(
          openLearningDay?.virtualTrackingCompletedAt
        ),
        firstCandidate: openVirtualTop1,
        referenceStats: openCandidateReferenceStats
      },

      buys,
      sells,
      sellPositions: positionSummary.positions.map(position => ({
        positionId: position.positionId,
        code: position.code,
        name: position.name,
        strategyGroup: position.strategyGroup,
        soldQty: position.soldQty,
        buyQty: position.buyQty,
        sellFillCount: position.sellFillCount,
        profit: position.profit,
        profitRate: position.profitRate,
        isClosed: position.isClosed,
        isPartialOpen: position.isPartialOpen
      }))
    });
  } catch (err) {
    console.error(err);
    res.json({
      ok: false,
      message: err.message
    });
  }
});

app.get("/api/server-auto-on", (req, res) => {
  const state = setServerAutoEnabled(true);

  res.json({
    ok: true,
    message: "서버 자동매매를 ON으로 변경했습니다.",
    serverAutoEnabled: state.serverAutoEnabled,
    serverAutoChangedAt: state.serverAutoChangedAt
  });
});

app.get("/api/server-auto-buy-once", async (req, res) => {
  try {
    await runServerAutoBuyOnce();

    res.json({
      ok: true,
      message: "서버 자동 모의매수를 1회 실행했습니다."
    });
  } catch (error) {
    console.error("서버 자동매수 1회 실행 오류:", error);

    res.status(500).json({
      ok: false,
      message: error.message
    });
  }
});





app.get("/api/open-buy-once", async (req, res) => {
  try {
    await runOpenBuyOnce();
    res.json({
      ok: true,
      message: "OPEN 자동 모의매수를 1회 실행했습니다."
    });
  } catch (error) {
    console.error("OPEN 자동매수 1회 실행 오류:", error);
    res.status(500).json({ ok: false, message: error.message });
  }
});

app.get("/api/open-sell-once", async (req, res) => {
  try {
    await checkOpenSellOnce();
    res.json({
      ok: true,
      message: "OPEN 자동매도를 1회 점검했습니다."
    });
  } catch (error) {
    console.error("OPEN 자동매도 1회 실행 오류:", error);
    res.status(500).json({ ok: false, message: error.message });
  }
});


app.get("/api/server-auto-sell-once", async (req, res) => {
  try {
    await checkServerAutoSellOnce();

    res.json({
      ok: true,
      message: "서버 자동매도를 1회 실행했습니다."
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error.message
    });
  }
});




app.post("/api/server-log-clear", (req, res) => {
  exec("pm2 flush", (error, stdout, stderr) => {
    if (error) {
      console.error("PM2 로그 삭제 실패:", error);
      return res.status(500).json({
        ok: false,
        message: "서버 로그 삭제 실패",
        error: error.message
      });
    }

    console.log("PM2 서버 로그 삭제 완료");

    res.json({
      ok: true,
      message: "서버 로그를 삭제했습니다.",
      stdout,
      stderr
    });
  });
});

app.post("/api/server-trade-log-clear", (req, res) => {
  try {
    const state = loadPaperState();

    state.tradeLogs = [];

    savePaperState(state, { force: true });

    res.json({
      ok: true,
      message: "서버 매매로그를 삭제했습니다."
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error.message
    });
  }
});

app.post("/api/paper-buy", express.json(), (req, res) => {
  try {
   const {
  code,
  name,
  buyPrice,
  qty,
  targetPrice,
  secondTargetPrice,
  stopLossPrice,
  trailingStopRate,
  strategy,
  strategyPreset,
  strategyName,
  protectMinutes,
  breakEvenAfterPartial
} = req.body || {};










    if (!code || !buyPrice || !qty) {
      return res.status(400).json({
        ok: false,
        message: "code, buyPrice, qty는 필수입니다."
      });
    }

  

    const state = loadPaperState();

    if (!state.holdings) {
      state.holdings = [];
    }

    const exists = state.holdings.some(
      (item) => String(item.code) === String(code)
    );

    if (exists) {
      return res.status(400).json({
        ok: false,
        message: "이미 서버 보유종목에 있습니다."
      });
    }

    state.holdings.push({
      code: String(code),
      name: name || String(code),
      buyPrice: Number(buyPrice),
      qty: Number(qty),
      currentPrice: Number(buyPrice),
      targetPrice: Number(targetPrice || 0),
      secondTargetPrice: Number(secondTargetPrice || 0),
      stopLossPrice: Number(stopLossPrice || 0),
      trailingStopRate: Number(trailingStopRate || 0),
      strategy: strategy || "auto",
strategyPreset: strategyPreset || strategy || "auto",
strategyName: strategyName || "자동전략",
status: "WAITING",
highestPrice: Number(buyPrice),

originalStopLossPrice: Number(stopLossPrice || 0),
protectMinutes: Number(protectMinutes || 3),
breakEvenAfterPartial: breakEvenAfterPartial !== false,
partialSold: false,

buyAt: new Date().toISOString(),
buyTimeMs: Date.now()


    });

    savePaperState(state);

    res.json({
      ok: true,
      message: "서버 모의매수 등록 완료",
      holdings: state.holdings
    });
  } catch (error) {
    console.error("서버 모의매수 등록 실패:", error);

    res.status(500).json({
      ok: false,
      message: error.message
    });
  }
});


app.post("/api/paper-sell", (req, res) => {
  try {
    const {
      code,
      qty,
      sellPrice,
      reason,
      actionType
    } = req.body || {};

    if (!code) {
      return res.status(400).json({
        ok: false,
        message: "종목코드가 없습니다."
      });
    }

    const sellQty = Number(qty || 0);
    const price = Number(sellPrice || 0);

    if (!sellQty || sellQty <= 0) {
      return res.status(400).json({
        ok: false,
        message: "매도 수량이 올바르지 않습니다."
      });
    }

    if (!price || price <= 0) {
      return res.status(400).json({
        ok: false,
        message: "매도 단가가 올바르지 않습니다."
      });
    }

   
    const state = loadPaperState();

    state.holdings = state.holdings || [];
    state.tradeLogs = state.tradeLogs || [];
    state.virtualResults =
      state.virtualResults || state.results || [];

    const holding = state.holdings.find(
      (item) => String(item.code) === String(code)
    );

    if (!holding) {
      return res.status(404).json({
        ok: false,
        message: "서버 보유종목에 없습니다."
      });
    }

    if (sellQty > Number(holding.qty || 0)) {
      return res.status(400).json({
        ok: false,
        message: "매도 수량이 보유수량보다 많습니다."
      });
    }

    const buyPrice = Number(holding.buyPrice || 0);
    const buyAmount = buyPrice * sellQty;
    const sellAmount = price * sellQty;
    const profit = sellAmount - buyAmount;
    const profitRate =
      buyAmount > 0 ? (profit / buyAmount) * 100 : 0;

    const now = new Date();

state.tradeLogs.push({
  type:
    actionType === "SELL"
      ? "SELL"
      : actionType || "SELL_ALL",
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
  strategyGroup: holding.strategyGroup || "CORE",
  date: now.toISOString().slice(0, 10),
  time: now.toLocaleString("ko-KR")
});

state.totalCash = Number(state.totalCash || 0) + sellAmount;

    state.virtualResults.push({
      code: holding.code,
      name: holding.name,
      buyPrice,
      sellPrice: price,
      qty: sellQty,
      buyAmount,
      sellAmount,
      profit,
      profitRate,
      reason: reason || "서버 매도",
      time: now.toLocaleString("ko-KR"),
      date: now.toISOString().slice(0, 10)
    });

    state.results = state.virtualResults;

holding.qty = Number(holding.qty || 0) - sellQty;

if (holding.qty <= 0) {
  state.holdings = state.holdings.filter(
    (item) => String(item.code) !== String(code)
  );
} else {
  holding.partialSold = true;

  if (holding.breakEvenAfterPartial !== false) {
    holding.stopLossPrice = Math.max(
      Number(holding.stopLossPrice || 0),
      Number(holding.buyPrice || 0)
    );
  }

  holding.status = "PARTIAL_SOLD";
}




    state.lastSellCheckAt =
      now.toLocaleString("ko-KR");

    savePaperState(state);

    res.json({
      ok: true,
      message: "서버 매도 처리 완료",
      holdings: state.holdings,
      tradeLogs: state.tradeLogs,
      virtualResults: state.virtualResults
    });
  } catch (error) {
    console.error("서버 매도 처리 실패:", error);

    res.status(500).json({
      ok: false,
      message: error.message || "서버 매도 처리 실패"
    });
  }
});


app.get("/api/paper-sell-all", async (req, res) => {
  try {
    const code = String(req.query.code || "").trim();

    if (!code) {
      return res.status(400).json({
        ok: false,
        message: "종목코드가 없습니다."
      });
    }

  

    const paperState = loadPaperState();

    paperState.holdings = paperState.holdings || [];
    paperState.tradeLogs = paperState.tradeLogs || [];
    paperState.virtualResults = paperState.virtualResults || [];

    const holding = paperState.holdings.find(
      (item) => item.code === code
    );

    if (!holding) {
      return res.status(404).json({
        ok: false,
        message: "서버 보유종목을 찾을 수 없습니다."
      });
    }

    const sellPrice = Number(holding.currentPrice || holding.buyPrice || 0);
    const qty = Number(holding.qty || 0);
    const buyPrice = Number(holding.buyPrice || 0);

    const buyAmount = buyPrice * qty;
    const sellAmount = sellPrice * qty;
    const profit = sellAmount - buyAmount;
    const profitRate = buyAmount > 0 ? (profit / buyAmount) * 100 : 0;

    paperState.holdings = paperState.holdings.filter(
      (item) => item.code !== code
    );

    paperState.tradeLogs.push({
  type: "SELL_ALL",
  code: holding.code,
  name: holding.name,
  price: sellPrice,
  qty,

  buyPrice,
  sellPrice,
  buyAmount,
  sellAmount,
  profit,
  profitRate,

  strategyGroup: holding.strategyGroup || "CORE",
  strategyPreset: holding.strategyPreset || "",
  strategyName: holding.strategyName || "",

  reason: "사용자 서버 수동매도",
  time: new Date().toLocaleString("ko-KR"),
  date: new Date().toISOString().slice(0, 10)
});

paperState.totalCash =
  Number(paperState.totalCash || 0) + sellAmount;

    paperState.virtualResults.push({
      code: holding.code,
      name: holding.name,
      buyPrice,
      sellPrice,
      qty,
      buyAmount,
      sellAmount,
      profit,
      profitRate,
      reason: "사용자 서버 수동매도",
      time: new Date().toLocaleString("ko-KR"),
      date: new Date().toISOString().slice(0, 10)
    });

    savePaperState(paperState);

    res.json({
      ok: true,
      message: "서버 수동매도 완료",
      code,
      profit,
      profitRate
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error.message
    });
  }
});

app.get("/api/refresh-holding-prices", async (req, res) => {
  try {
    await refreshServerHoldingPrices();

    res.json({
      ok: true,
      message: "서버 보유종목 현재가 갱신 완료"
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error.message
    });
  }
});


app.listen(PORT, () => {
  console.log(`서버 실행중: ${PORT}`);

  try {
    const importResult = importCodeChangeLog();

    if (importResult.fileFound) {
      console.log(
        `[코드 변경기록 확인] 추가 ${importResult.imported}건 / 중복 ${importResult.skipped}건`
      );
    }
  } catch (error) {
    console.error(
      "[코드 변경기록 자동반영 실패]",
      error.message
    );
  }

  // 08:40 장전시장자료 → 09:00 OPEN/WAVE → 이후 CORE/VOLUME도 함께 실행합니다.
  startOpenMarketData();
  startOpenStrategy();
  startServerAutoTrader();
  startWaveStrategy();
  startFastStrategy();
});
