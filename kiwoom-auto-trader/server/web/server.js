require("dotenv").config();

const express = require("express");
const cors = require("cors");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

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

const PAPER_STATE_FILE = path.join(
  __dirname,
  "paper-state-core.json"
);

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

  const multiplication = raw.match(
    /^([\d.]+)\s*\*\s*([\d.]+)$/
  );

  if (multiplication) {
    return (
      Number(multiplication[1]) *
      Number(multiplication[2])
    );
  }

  return raw;
}

function getCurrentTradingSettings() {
  const keys = [
    "buyAssetRatio",
    "coreStartTime",
    "coreEndTime",
    "coreMaxHoldingCount",
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
    "coreFirstTakeProfitRate",
    "coreTrailingStartRate",
    "coreTrailingStopRate",
    "volumeStartTime",
    "volumeEndTime",
    "volumeMaxHoldingCount",
    "volumeMinChangeRate",
    "volumeMaxChangeRate",
    "volumeMinTradeVolumeRatio",
    "volumeMinDayPositionRate",
    "volumeMaxDayPositionRate",
    "volumeLateChaseBlockEnabled",
    "volumeLateChaseMinChangeRate",
    "volumeLateChaseMinCandidateStrengthScore",
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
    "sellLoopMs",
    "minHoldMinutes",
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

function savePaperState(state) {
  writeJsonFileAtomic(PAPER_STATE_FILE, state);
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
const HOT_API_CACHE_MS = 60 * 1000;
const HOT_DETAIL_ENRICH_LIMIT = 8;
const HOT_DETAIL_ENRICH_DELAY_MS = 400;
let hotApiCache = {
  cachedAt: 0,
  data: null
};
let hotApiRunningPromise = null;

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

async function enrichHotCandidate(item) {
  try {
    const priceRes = await fetch(
      `http://localhost:${PORT}/api/price?code=${encodeURIComponent(item.code)}`
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
    console.warn(`[HOT API 상세조회 실패] ${item.code} / ${err.message}`);
    return item;
  }
}

async function buildHotCandidates(limit) {
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

  const merged = mergeHotRankRows(groups)
    .filter(item => item.currentPrice > 0)
    .filter(item => item.changeRate > 0)
    .sort((a, b) => {
      const sourceDiff = (b.sources?.length || 0) - (a.sources?.length || 0);
      if (sourceDiff !== 0) return sourceDiff;
      const rateDiff = Number(b.changeRate || 0) - Number(a.changeRate || 0);
      if (rateDiff !== 0) return rateDiff;
      return Number(b.volume || 0) - Number(a.volume || 0);
    })
    .slice(0, Math.min(40, safeLimit + 10));

  const enriched = [];
  for (let index = 0; index < merged.length; index++) {
    const item = merged[index];

    if (index < HOT_DETAIL_ENRICH_LIMIT) {
      enriched.push(await enrichHotCandidate(item));

      if (index < HOT_DETAIL_ENRICH_LIMIT - 1) {
        await sleep(HOT_DETAIL_ENRICH_DELAY_MS);
      }
    } else {
      // 순위 API 원본값을 그대로 사용해 현재가 상세조회 호출량을 제한한다.
      enriched.push(item);
    }
  }

  const items = enriched
    .filter(item => item.currentPrice > 0)
    .sort((a, b) => {
      const sourceDiff = (b.sources?.length || 0) - (a.sources?.length || 0);
      if (sourceDiff !== 0) return sourceDiff;
      const volumeDiff = Number(b.tradeVolumeRatio || 0) - Number(a.tradeVolumeRatio || 0);
      if (volumeDiff !== 0) return volumeDiff;
      return Number(b.changeRate || 0) - Number(a.changeRate || 0);
    })
    .slice(0, safeLimit);

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

    if (hotApiCache.data && cacheAge <= HOT_API_CACHE_MS) {
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
    const offset = Number(req.query.offset || 0);

    const nextOffset =
      offset + scanLimit >= STOCK_MASTER.length
        ? 0
        : offset + scanLimit;

    const targets = STOCK_MASTER.slice(offset, offset + scanLimit);

    console.log(
      `[DISCOVER] offset=${offset} scan=${scanLimit} next=${nextOffset} total=${STOCK_MASTER.length} / 전종목 순환 배치`
    );

    const items = [];

    for (const stock of targets) {
      try {
        await sleep(300);

        const priceRes = await fetch(
          `http://localhost:${PORT}/api/price?code=${stock.code}`
        );

        const priceData = await priceRes.json();

        if (!priceRes.ok) continue;

        const scoreInfo = calculateDiscoverScore(priceData);

        items.push({
          ...priceData,
          ...scoreInfo
        });
      } catch (err) {
        console.warn("발굴 개별 종목 실패:", stock.code, err.message);
      }
    }

    const sorted = items
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
      scanCount: targets.length,
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
      reason
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

    const buyAmount = Number(price) * Number(qty);

    state.holdings.push({
      code,
      name: name || code,
      strategyGroup: strategyGroup || "CORE",
      buyPrice: Number(price),
      currentPrice: Number(price),
      highestPrice: Number(price),
      lowestPrice: Number(price),
      qty: Number(qty),
      buyAmount,
      buyTime: new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }),
      buyTimeMs: Date.now(),
      buyAt: new Date().toISOString(),
      date: new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" })
    });

    state.totalCash = Number(state.totalCash || 0) - buyAmount;

    state.tradeLogs.push({
      type: `${strategyGroup || "CORE"}_BUY`,
      strategyGroup: strategyGroup || "CORE",
      code,
      name: name || code,
      price: Number(price),
      buyPrice: Number(price),
      qty: Number(qty),
      buyAmount,
      reason,
      date: new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" }),
      time: new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })
    });

    savePaperState(state);

    res.json({
      ok: true,
      message: "paper buy 완료",
      holdingCount: state.holdings.length,
      totalCash: state.totalCash
    });

  } catch (err) {
    res.status(500).json({
      ok: false,
      message: err.message
    });
  }
});

app.post("/api/core-paper-sell", express.json(), (req, res) => {
  try {
    const {
      code,
      price,
      qty,
      sellType,
      reason,
      manualSell,
      manualRequestId
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

    const holding = state.holdings.find(h => h.code === code);

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

    const date = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
    const time = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });

    state.tradeLogs.push({
      type: sellType || `${holding.strategyGroup}_SELL`,
      strategyGroup: holding.strategyGroup,
      code: holding.code,
      name: holding.name,
      buyPrice,
      sellPrice,
      price: sellPrice,
      qty: sellQty,
      profit,
      profitRate,
      reason,
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
      manualSell: manualSell === true,
      manualRequestId: manualRequestId || null,
      date,
      sellTime: new Date().toISOString()
    });

    if (holding.qty <= 0) {
      state.holdings = state.holdings.filter(h => h !== holding);
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
    
    const state = JSON.parse(fs.readFileSync(PAPER_STATE_FILE, "utf8"));

    state.virtualResults = [];
    state.results = [];

    savePaperState(state);

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

  const result = await axios.post(
    url,
    { stk_cd: code },
    {
      headers: {
        "Content-Type": "application/json;charset=UTF-8",
        authorization: `Bearer ${token}`,
        "api-id": "ka10001"
      }
    }
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

  const paperState = JSON.parse(
    fs.readFileSync(PAPER_STATE_FILE, "utf8")
  );

  paperState.holdings = paperState.holdings || [];

  if (paperState.holdings.length === 0) return;

  for (const holding of paperState.holdings) {
    try {
      const priceData = await fetchCurrentPriceFromKiwoom(holding.code);

      holding.currentPrice = Number(priceData.currentPrice || holding.currentPrice || holding.buyPrice || 0);
      holding.name = holding.name || priceData.name;
      holding.highestPrice = Math.max(
        Number(holding.highestPrice || 0),
        Number(holding.currentPrice || 0)
      );

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

async function waitKiwoomPriceLimit() {
  const minGapMs = 350;
  const now = Date.now();
  const waitMs = Math.max(0, minGapMs - (now - lastKiwoomPriceRequestAt));

  if (waitMs > 0) {
    await new Promise(resolve => setTimeout(resolve, waitMs));
  }

  lastKiwoomPriceRequestAt = Date.now();
}

app.get("/api/price", async (req, res) => {
  try {
    const token = getSavedToken();
    const code = String(req.query.code || "").trim();

    if (!code) {
      return res.status(400).json({ message: "종목코드가 없습니다." });
    }

    const cached = priceCache[code];

if (cached && Date.now() - cached.cachedAt <= 8000) {
  return res.json({
    ...cached.data,
    isCached: true
  });
}

    const url = `${process.env.KIWOOM_BASE_URL}/api/dostk/stkinfo`;

    await waitKiwoomPriceLimit();

    let result = await axios.post(
  url,
  { stk_cd: code },
  {
    headers: {
      "Content-Type": "application/json;charset=UTF-8",
      authorization: `Bearer ${token}`,
      "api-id": "ka10001"
    }
  }
);

let data = result.data;

if (isTokenError(data)) {
  console.log("[/api/price] 토큰 만료 감지 → 자동 재발급 후 현재가 재조회", code);

  const newToken = await refreshKiwoomToken();

  result = await axios.post(
    url,
    { stk_cd: code },
    {
      headers: {
        "Content-Type": "application/json;charset=UTF-8",
        authorization: `Bearer ${newToken}`,
        "api-id": "ka10001"
      }
    }
  );

  data = result.data;
}

    const responseData = {
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

priceCache[code] = {
  data: responseData,
  cachedAt: Date.now()
};

res.json(responseData);


  } catch (error) {
  const code = String(req.query.code || "").trim();
  const stale = priceCache[code];
  const staleAgeMs = stale ? Date.now() - Number(stale.cachedAt || 0) : Infinity;

  /*
   * 키움 429·일시적 네트워크 실패 시 최근 30초 이내 캐시가 있으면
   * 오류 대신 캐시값을 반환해 OPEN/HOT 판단 전체가 중단되지 않게 한다.
   */
  if (stale && staleAgeMs <= 30 * 1000) {
    console.warn(
      `[/api/price 캐시대체] ${code} / ` +
      `${error.response?.status || error.message} / ` +
      `캐시 ${Math.round(staleAgeMs / 1000)}초`
    );

    return res.json({
      ...stale.data,
      isCached: true,
      isStaleFallback: true,
      cacheAgeMs: staleAgeMs
    });
  }

  console.error("[/api/price 현재가 조회 실패]", {
    code,
    message: error.message,
    status: error.response?.status,
    data: error.response?.data
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
    }
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
      }
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

const {
  startServerAutoTrader,
  runServerAutoBuyOnce,
  checkServerAutoSellOnce,
  setServerAutoEnabled,
  loadState
} = require("./auto-trader-core");

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

app.get("/api/paper-state", (req, res) => {
  res.json(loadState());
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

    savePaperState(resetState);

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

app.get("/api/performance-summary", (req, res) => {
  try {
    const state = loadState();

    const tradeLogs = Array.isArray(state.tradeLogs)
      ? state.tradeLogs
      : [];

  const sellLogs = tradeLogs.filter((log) =>
  [
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
  ].includes(log.type)
);

    const totalTrades = sellLogs.length;
    const winTrades = sellLogs.filter((log) => Number(log.profit || 0) > 0);
    const loseTrades = sellLogs.filter((log) => Number(log.profit || 0) < 0);

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
        ? sellLogs.reduce((sum, log) => sum + Number(log.profitRate || 0), 0) /
          totalTrades
        : 0;

    const avgWinRate =
      winTrades.length > 0
        ? winTrades.reduce((sum, log) => sum + Number(log.profitRate || 0), 0) /
          winTrades.length
        : 0;

    const avgLossRate =
      loseTrades.length > 0
        ? loseTrades.reduce((sum, log) => sum + Number(log.profitRate || 0), 0) /
          loseTrades.length
        : 0;

    const winRate =
      totalTrades > 0 ? (winTrades.length / totalTrades) * 100 : 0;

    const holdings = Array.isArray(state.holdings)
      ? state.holdings
      : [];

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










const buyLogs = tradeLogs.filter((log) =>
  ["OPEN_BUY", "CORE_BUY", "VOLUME_BUY"].includes(log.type)
);

const strategyMap = {};

function ensureStrategyStat(group, strategy) {
  const key = `${group} / ${strategy}`;

  if (!strategyMap[key]) {
    strategyMap[key] = {
      strategyGroup: group,
      strategyName: strategy,
      buyTrades: 0,
      trades: 0,
      wins: 0,
      losses: 0,
      totalProfit: 0,
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

sellLogs.forEach((log) => {
  const group = log.strategyGroup || "CORE";

const strategy =
  log.strategyName ||
  log.strategyPreset ||
  "기타";

const stat = ensureStrategyStat(group, strategy);

  const profit = Number(log.profit || 0);
  const profitRate = Number(log.profitRate || 0);

  stat.trades += 1;
  stat.totalProfit += profit;
  stat.totalProfitRate += profitRate;

  if (profit > 0) stat.wins += 1;
  if (profit < 0) stat.losses += 1;

  if (
    stat.maxProfitRate === null ||
    profitRate > stat.maxProfitRate
  ) {
    stat.maxProfitRate = profitRate;
  }

  if (
    stat.maxLossRate === null ||
    profitRate < stat.maxLossRate
  ) {
    stat.maxLossRate = profitRate;
  }
});

const strategyStats = Object.values(strategyMap).map((item) => ({
  ...item,
  winRate: item.trades > 0 ? (item.wins / item.trades) * 100 : 0,
  avgProfit: item.trades > 0 ? item.totalProfit / item.trades : 0,
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

  const trades = daySellLogs.length;

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
  trades
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
        winTrades: winTrades.length,
        loseTrades: loseTrades.length,
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
        pricePersistence: Number(item.lastPricePersistence || last.pricePersistence || 0),
        volumePersistence: Number(item.lastVolumePersistence || last.volumePersistence || 0),
        highestAfterSeenRate:
          Number(first.price || 0) > 0 && Number(item.highestPrice || 0) > 0
            ? ((Number(item.highestPrice) - Number(first.price)) / Number(first.price)) * 100
            : null,
        lastReason: item.lastReason || last.reason || "",
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

    const tracking = state.openLiveTracking || {};
    const scan = state.openLastScanSummary || {};
    const top = tracking.topCandidate || scan.topCandidate || state.openTopCandidate || null;
    res.json({
      ok: true,
      date: state.openDate || todayKstKey(),
      serverAutoEnabled: state.serverAutoEnabled !== false,
      openEnabled: state.openEnabled !== false,
      openCompleted: state.openCompleted === true,
      openSkipped: state.openSkipped === true,
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
        potentialCount: Number(scan.potentialCount || 0),
        rejectCounts: scan.rejectCounts || {}
      },
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

    const rankRows = findFirstArrayByKeys(rankData, [
      "pred_pre_flu_rt_upper", "items", "output"
    ]);

    const leaders = rankRows
      .map(row => normalizeHotRankRow(row, "CHANGE_RATE"))
      .filter(Boolean)
      .filter(item => !isExcludedOpenAnalysisProduct(item))
      .filter(item => Number(item.changeRate || 0) >= minRate)
      .sort((a, b) => Number(b.changeRate || 0) - Number(a.changeRate || 0))
      .slice(0, limit);

    const hotSnapshot = readJsonFileSafe(HOT_CANDIDATES_FILE, { items: [] }) || { items: [] };
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

    const rows = leaders.map((leader, index) => {
      const normalizedCode = normalizeOpenStockCode(leader.code);
      const candidate = growthByCode.get(normalizedCode) || null;
      const bought = normalizedCode === selectedCode;
      const hotRecord = hotDetected[normalizedCode] || null;
      const hotFirstDetectedAt = hotRecord?.firstDetectedAt || null;
      const hotDetectedWithinOpenWindow = isWithinOpenWindow(hotFirstDetectedAt);
      const openFoundWithinWindow = Boolean(candidate && isWithinOpenWindow(candidate.firstSeenAt));
      return {
        rank: index + 1,
        code: normalizedCode,
        rawCode: String(leader.code || ""),
        name: leader.name,
        currentPrice: Number(leader.currentPrice || 0),
        changeRate: Number(leader.changeRate || 0),
        volume: Number(leader.volume || 0),
        openFound: Boolean(candidate),
        bought,
        firstSeenAt: candidate?.firstSeenAt || null,
        observationCount: Number(candidate?.observationCount || 0),
        maxDiscoverScore: Number(candidate?.maxDiscoverScore || 0),
        maxRankScore: Number(candidate?.maxRankScore || 0),
        maxMomentumScore: Number(candidate?.maxMomentumScore || 0),
        rejectStage: candidate?.rejectStage || null,
        firstSource: candidate?.firstSource || null,
        lastSource: candidate?.lastSource || null,
        currentHotMatched: hotCodes.has(normalizedCode),
        hotDetectedToday: Boolean(hotRecord),
        hotFirstDetectedAt,
        hotLastDetectedAt: hotRecord?.lastDetectedAt || null,
        hotDetectionCount: Number(hotRecord?.detectionCount || 0),
        hotBestRank: Number(hotRecord?.bestRank || 0),
        hotMaxChangeRate: Number(hotRecord?.maxChangeRate || 0),
        hotMaxMomentumScore: Number(hotRecord?.maxMomentumScore || 0),
        hotSources: Array.isArray(hotRecord?.sources) ? hotRecord.sources : [],
        hotDetectedWithinOpenWindow,
        openFoundWithinWindow,
        openOpportunity: hotDetectedWithinOpenWindow || openFoundWithinWindow,
        everHotMatched: candidate?.everHotMatched === true,
        everDirectHotCandidate: candidate?.everDirectHotCandidate === true,
        everPriorityCandidate: candidate?.everPriorityCandidate === true,
        passedDiscoverStage: candidate?.passedDiscoverStage === true,
        passedVolumeStage: candidate?.passedVolumeStage === true,
        passedMomentumStage: candidate?.passedMomentumStage === true,
        hasDetailedTracking: candidate?.hasDetailedTracking === true,
        lastReason: candidate?.lastReason || "",
        decision: classifyDecision(candidate, bought)
      };
    });

    const reasonCount = {};
    for (const row of rows) {
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
    if (!rows.length) {
      diagnosis.push(`현재 +${minRate.toFixed(0)}% 이상 급등주가 조회되지 않았습니다.`);
    } else {
      const hotDetectedCount = rows.filter(row => row.hotDetectedToday).length;
      const hotToOpenMissedCount = rows.filter(row => row.hotDetectedToday && !row.openFound).length;
      diagnosis.push(`급등주 ${rows.length}개 중 당일 HOT은 ${hotDetectedCount}개, OPEN은 ${foundCount}개를 발견했습니다.`);
      diagnosis.push(
        `OPEN 매수시간(09:00~09:30) 안에 포착 가능한 급등주는 ${openOpportunityRows.length}개이며, ` +
        `HOT ${openWindowHotCount}개 → OPEN ${openWindowFoundCount}개 → 실제매수 ${openWindowBoughtCount}개입니다.`
      );
      if (openWindowHotToOpenMissedCount > 0) {
        diagnosis.push(`OPEN 시간 내 HOT 발견 후 OPEN으로 이어지지 않은 종목은 ${openWindowHotToOpenMissedCount}개입니다.`);
      }
      if (hotToOpenMissedCount > 0) diagnosis.push(`HOT에는 들어왔지만 OPEN 후보로 이어지지 않은 종목은 ${hotToOpenMissedCount}개입니다.`);
      diagnosis.push(`${notFoundCount}개는 OPEN 후보에 올리지 못했습니다.`);
      diagnosis.push(`가장 많은 미포착 원인은 '${topReason}'입니다.`);
      if (notFoundCount > foundCount) diagnosis.push("우선 개선 대상은 매수조건보다 후보 발굴 범위와 HOT 순위 유입입니다.");
      else diagnosis.push("후보 발굴은 작동했으므로 거래량·점수·지속강도 탈락 기준을 우선 검토해야 합니다.");
      const foundButMissed = rows.filter(row => row.openFound && !row.bought);
      if (foundButMissed.length) {
        diagnosis.push(`발견 후 놓친 급등주는 ${foundButMissed.slice(0, 3).map(row => row.name).join(", ")}입니다.`);
      }
    }

    return res.json({
      ok: true,
      date,
      phase,
      phaseLabel: phase === "OPEN_LIVE" ? "OPEN 실시간" : phase === "MARKET_LIVE" ? "장중 실시간" : phase === "PREOPEN" ? "장전 대기" : "장 종료 최종",
      isFinal: phase === "FINAL",
      autoMode,
      kstHHMM,
      updatedAt: new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }),
      thresholdRate: minRate,
      summary: {
        totalLeaders: rows.length,
        hotDetectedCount: rows.filter(row => row.hotDetectedToday).length,
        hotToOpenMissedCount: rows.filter(row => row.hotDetectedToday && !row.openFound).length,
        foundCount,
        notFoundCount,
        boughtCount,
        openOpportunityCount: openOpportunityRows.length,
        openWindowHotCount,
        openWindowFoundCount,
        openWindowBoughtCount,
        openWindowHotToOpenMissedCount
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
      const buyEvaluation = classifyOpenBuyQuality(selectedTrade || {}, day?.result || {});
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
              selectionInputs: selectedTrade.selectionInputs || {}
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
  "CORE_END_SELL",

  "VOLUME_STOP_LOSS",
  "VOLUME_FIRST_TAKE_PROFIT",
  "VOLUME_BREAK_EVEN_SELL",
  "VOLUME_TRAILING_STOP",
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

    const wins = sells.filter(log => Number(log.profit || 0) > 0);
    const losses = sells.filter(log => Number(log.profit || 0) < 0);

    const sellTypeCounts = {};
    sells.forEach(log => {
      sellTypeCounts[log.type] = (sellTypeCounts[log.type] || 0) + 1;
    });

   function getStrategy(log) {
  if (log.strategyGroup) {
    return log.strategyGroup;
  }

  if (log.group) {
    return log.group;
  }

  const type = String(log.type || "");

  if (type.startsWith("OPEN")) {
    return "OPEN";
  }

  if (type.startsWith("VOLUME")) {
    return "VOLUME";
  }

  return "CORE";
}

    const byStrategy = {};

    sells.forEach(log => {
      const strategy = getStrategy(log);
      const profit = Number(log.profit || 0);

      if (!byStrategy[strategy]) {
        byStrategy[strategy] = {
          trades: 0,
          wins: 0,
          losses: 0,
          profit: 0,
          winProfitSum: 0,
          lossProfitSum: 0,
          maxProfit: null,
          maxLoss: null
        };
      }

      const s = byStrategy[strategy];

      s.trades += 1;
      s.profit += profit;

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
        buyCount: buys.length,
        sellCount: sells.length,
        winCount: wins.length,
        lossCount: losses.length,
        winRate: sells.length > 0 ? (wins.length / sells.length) * 100 : 0,
        realizedProfit
      },
      byStrategy,
      sellTypeCounts,

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
      sells
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
 
    const state = JSON.parse(fs.readFileSync(PAPER_STATE_FILE, "utf8"));

    state.tradeLogs = [];

    savePaperState(state);

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

  

    let state = {
      holdings: [],
      tradeLogs: [],
      results: []
    };

    if (fs.existsSync(PAPER_STATE_FILE)) {
      state = JSON.parse(
        fs.readFileSync(PAPER_STATE_FILE, "utf8")
      );
    }

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

   
    let state = {
      holdings: [],
      tradeLogs: [],
      virtualResults: []
    };

    if (fs.existsSync(PAPER_STATE_FILE)) {
      state = JSON.parse(
        fs.readFileSync(PAPER_STATE_FILE, "utf8")
      );
    }

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

  

    const paperState = JSON.parse(
      fs.readFileSync(PAPER_STATE_FILE, "utf8")
    );

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

  // 08:40 장전시장자료 → 09:00 OPEN → 이후 CORE/VOLUME 순서로 실행합니다.
  startOpenMarketData();
  startOpenStrategy();
  startServerAutoTrader();
});
