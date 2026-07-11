const fs = require("fs");
const path = require("path");
const axios = require("axios");

const MARKET_FILE = path.join(__dirname, "open-market.json");

const SETTINGS = {
  refreshHour: 8,
  refreshMinute: 40,
  retryMinutes: 10,
  maxAgeHours: 18,
  requestTimeoutMs: 10000
};

const SYMBOLS = {
  nasdaq: { symbol: "^IXIC", name: "NASDAQ Composite" },
  sp500: { symbol: "^GSPC", name: "S&P 500" },
  dow: { symbol: "^DJI", name: "Dow Jones" },
  sox: { symbol: "^SOX", name: "Philadelphia Semiconductor" },
  vix: { symbol: "^VIX", name: "VIX" },
  usdkrw: { symbol: "KRW=X", name: "USD/KRW" },
  us10y: { symbol: "^TNX", name: "US 10Y Yield" },
  wti: { symbol: "CL=F", name: "WTI Crude Oil" }
};

function nowText() {
  return new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
}

function todayKey() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
}

function getKstParts() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    weekday: "short"
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(new Date()).map(part => [part.type, part.value])
  );

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: parts.weekday
  };
}

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(safeNumber(value) * factor) / factor;
}

function loadOpenMarketData() {
  if (!fs.existsSync(MARKET_FILE)) {
    return {
      date: null,
      updatedAt: null,
      status: "EMPTY",
      marketScore: 50,
      indicators: {},
      sectorBias: {},
      errors: []
    };
  }

  try {
    return JSON.parse(fs.readFileSync(MARKET_FILE, "utf8"));
  } catch (error) {
    return {
      date: null,
      updatedAt: null,
      status: "BROKEN",
      marketScore: 50,
      indicators: {},
      sectorBias: {},
      errors: [error.message]
    };
  }
}

function saveOpenMarketData(data) {
  const tempFile = `${MARKET_FILE}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(data, null, 2));
  fs.renameSync(tempFile, MARKET_FILE);
}

async function fetchYahooDaily(symbol) {
  const encoded = encodeURIComponent(symbol);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}`;

  const response = await axios.get(url, {
    timeout: SETTINGS.requestTimeoutMs,
    params: {
      range: "5d",
      interval: "1d",
      includePrePost: "false",
      events: "div,splits"
    },
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "application/json"
    }
  });

  const result = response.data?.chart?.result?.[0];
  if (!result) {
    throw new Error(response.data?.chart?.error?.description || "시세 결과 없음");
  }

  const meta = result.meta || {};
  const closes = (result.indicators?.quote?.[0]?.close || [])
    .map(value => safeNumber(value, NaN))
    .filter(Number.isFinite);

  let current = safeNumber(meta.regularMarketPrice, NaN);
  let previous = safeNumber(meta.chartPreviousClose ?? meta.previousClose, NaN);

  if (!Number.isFinite(current) && closes.length) {
    current = closes[closes.length - 1];
  }

  if (!Number.isFinite(previous) && closes.length >= 2) {
    previous = closes[closes.length - 2];
  }

  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) {
    throw new Error("현재값 또는 전일값 부족");
  }

  const changeRate = ((current - previous) / previous) * 100;

  return {
    symbol,
    current: round(current, 4),
    previous: round(previous, 4),
    changeRate: round(changeRate, 3),
    marketTime: meta.regularMarketTime || null,
    currency: meta.currency || null,
    exchange: meta.exchangeName || null
  };
}

function addScore(score, condition, points) {
  return condition ? score + points : score;
}

function calculateMarketAssessment(indicators) {
  const nasdaq = safeNumber(indicators.nasdaq?.changeRate);
  const sp500 = safeNumber(indicators.sp500?.changeRate);
  const dow = safeNumber(indicators.dow?.changeRate);
  const sox = safeNumber(indicators.sox?.changeRate);
  const vix = safeNumber(indicators.vix?.changeRate);
  const usdkrw = safeNumber(indicators.usdkrw?.changeRate);
  const us10y = safeNumber(indicators.us10y?.changeRate);
  const wti = safeNumber(indicators.wti?.changeRate);

  let score = 50;

  score = addScore(score, nasdaq >= 1.5, 14);
  score = addScore(score, nasdaq >= 0.5 && nasdaq < 1.5, 8);
  score = addScore(score, nasdaq <= -1.5, -14);
  score = addScore(score, nasdaq < -0.5 && nasdaq > -1.5, -8);

  score = addScore(score, sox >= 2, 14);
  score = addScore(score, sox >= 0.7 && sox < 2, 8);
  score = addScore(score, sox <= -2, -14);
  score = addScore(score, sox < -0.7 && sox > -2, -8);

  score = addScore(score, sp500 >= 0.5, 5);
  score = addScore(score, sp500 <= -0.5, -5);
  score = addScore(score, dow >= 0.5, 3);
  score = addScore(score, dow <= -0.5, -3);

  score = addScore(score, vix <= -3, 6);
  score = addScore(score, vix >= 5, -8);
  score = addScore(score, usdkrw >= 0.8, -5);
  score = addScore(score, usdkrw <= -0.5, 3);
  score = addScore(score, us10y >= 1.5, -4);
  score = addScore(score, us10y <= -1.5, 3);

  score = Math.max(0, Math.min(100, score));

  const sectorBias = {
    semiconductor: round(Math.max(-20, Math.min(20, sox * 6 + nasdaq * 2)), 1),
    ai: round(Math.max(-20, Math.min(20, nasdaq * 4 + sox * 3)), 1),
    growth: round(Math.max(-15, Math.min(15, nasdaq * 4 - us10y * 1.5)), 1),
    energy: round(Math.max(-15, Math.min(15, wti * 4)), 1),
    defensive: round(Math.max(-10, Math.min(10, -nasdaq * 2 + vix * 0.8)), 1)
  };

  let marketType = "NORMAL";
  if (score >= 75) marketType = "STRONG";
  else if (score <= 35) marketType = "WEAK";

  const reasons = [];
  if (nasdaq >= 0.5) reasons.push(`나스닥 강세 ${nasdaq.toFixed(2)}%`);
  if (nasdaq <= -0.5) reasons.push(`나스닥 약세 ${nasdaq.toFixed(2)}%`);
  if (sox >= 0.7) reasons.push(`SOX 강세 ${sox.toFixed(2)}%`);
  if (sox <= -0.7) reasons.push(`SOX 약세 ${sox.toFixed(2)}%`);
  if (vix >= 5) reasons.push(`VIX 급등 ${vix.toFixed(2)}%`);
  if (usdkrw >= 0.8) reasons.push(`원달러 상승 ${usdkrw.toFixed(2)}%`);
  if (!reasons.length) reasons.push("해외시장 중립");

  return {
    marketScore: score,
    marketType,
    sectorBias,
    reasons
  };
}

async function refreshOpenMarketData() {
  console.log("[OPEN 시장자료] 해외시장 수집 시작");

  const indicators = {};
  const errors = [];

  await Promise.all(
    Object.entries(SYMBOLS).map(async ([key, info]) => {
      try {
        indicators[key] = {
          name: info.name,
          ...(await fetchYahooDaily(info.symbol)),
          ok: true
        };
      } catch (error) {
        indicators[key] = {
          name: info.name,
          symbol: info.symbol,
          ok: false,
          error: error.message
        };
        errors.push(`${key}: ${error.message}`);
      }
    })
  );

  const assessment = calculateMarketAssessment(indicators);
  const successCount = Object.values(indicators).filter(item => item.ok).length;

  const data = {
    date: todayKey(),
    updatedAt: nowText(),
    updatedAtMs: Date.now(),
    status: successCount === Object.keys(SYMBOLS).length
      ? "OK"
      : successCount >= 4
        ? "PARTIAL"
        : "FAILED",
    provider: "Yahoo Finance chart",
    successCount,
    totalCount: Object.keys(SYMBOLS).length,
    ...assessment,
    indicators,
    news: [],
    newsScore: 0,
    errors
  };

  saveOpenMarketData(data);

  console.log(
    `[OPEN 시장자료] 완료 / ${data.status} / 성공 ${successCount}/${data.totalCount} / ` +
    `시장점수 ${data.marketScore} / 유형 ${data.marketType}`
  );

  if (errors.length) {
    console.log(`[OPEN 시장자료] 일부 실패 / ${errors.join(" | ")}`);
  }

  return data;
}

function isOpenMarketDataFresh(data = loadOpenMarketData()) {
  const updatedAtMs = safeNumber(data.updatedAtMs);
  if (!updatedAtMs) return false;
  return Date.now() - updatedAtMs <= SETTINGS.maxAgeHours * 60 * 60 * 1000;
}

let started = false;
let timer = null;
let lastRunKey = null;

function shouldRefreshNow() {
  const kst = getKstParts();
  const isWeekday = !["Sat", "Sun"].includes(kst.weekday);
  if (!isWeekday) return false;

  const minuteOfDay = kst.hour * 60 + kst.minute;
  const target = SETTINGS.refreshHour * 60 + SETTINGS.refreshMinute;

  return minuteOfDay >= target && minuteOfDay <= target + 50;
}

function startOpenMarketData() {
  if (started) {
    console.log("[OPEN 시장자료] 이미 실행 중");
    return;
  }

  started = true;
  console.log("SY Quant OPEN 장전시장자료 모듈 시작");

  const tick = async () => {
    if (!shouldRefreshNow()) return;

    const runKey = `${todayKey()}_${Math.floor(new Date().getTime() / (SETTINGS.retryMinutes * 60000))}`;
    const current = loadOpenMarketData();

    if (current.date === todayKey() && current.status === "OK") return;
    if (lastRunKey === runKey) return;

    lastRunKey = runKey;

    try {
      await refreshOpenMarketData();
    } catch (error) {
      console.error("[OPEN 시장자료 오류]", error.message);
    }
  };

  tick().catch(error => console.error("[OPEN 시장자료 시작 오류]", error.message));
  timer = setInterval(tick, 60 * 1000);
}

function stopOpenMarketData() {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
}

if (require.main === module) {
  refreshOpenMarketData()
    .then(data => {
      console.log(JSON.stringify(data, null, 2));
      process.exit(0);
    })
    .catch(error => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = {
  MARKET_FILE,
  loadOpenMarketData,
  saveOpenMarketData,
  refreshOpenMarketData,
  isOpenMarketDataFresh,
  startOpenMarketData,
  stopOpenMarketData
};
