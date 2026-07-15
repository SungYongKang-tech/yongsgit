const fs = require("fs");
const path = require("path");
const axios = require("axios");

const MARKET_FILE = path.join(__dirname, "open-market.json");

const SETTINGS = {
  refreshHour: 8,
  refreshMinute: 40,
  retryMinutes: 10,
  maxAgeHours: 18,
  requestTimeoutMs: 10000,

  newsEnabled: true,
  newsMaxItemsPerQuery: 8,
  priorityStockCount: 30
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

// 장전 해외시장·뉴스 흐름을 국내 OPEN 우선감시 종목으로 연결하는 기본 유니버스
// 필요하면 이 목록만 수정해 관심 종목을 쉽게 교체할 수 있습니다.
const PRIORITY_UNIVERSE = {
  semiconductor: [
    { code: "000660", name: "SK하이닉스", keywords: ["SK하이닉스", "HBM", "메모리"] },
    { code: "005930", name: "삼성전자", keywords: ["삼성전자", "반도체", "파운드리"] },
    { code: "042700", name: "한미반도체", keywords: ["한미반도체", "HBM", "후공정"] },
    { code: "039030", name: "이오테크닉스", keywords: ["이오테크닉스", "반도체 장비"] },
    { code: "095340", name: "ISC", keywords: ["ISC", "테스트소켓"] },
    { code: "403870", name: "HPSP", keywords: ["HPSP", "반도체 장비"] }
  ],
  ai: [
    { code: "035420", name: "NAVER", keywords: ["네이버", "NAVER", "AI"] },
    { code: "035720", name: "카카오", keywords: ["카카오", "AI", "플랫폼"] },
    { code: "277810", name: "레인보우로보틱스", keywords: ["레인보우로보틱스", "로봇"] },
    { code: "108490", name: "로보티즈", keywords: ["로보티즈", "로봇"] },
    { code: "030200", name: "KT", keywords: ["KT", "AI", "데이터센터"] }
  ],
  growth: [
    { code: "006400", name: "삼성SDI", keywords: ["삼성SDI", "2차전지"] },
    { code: "373220", name: "LG에너지솔루션", keywords: ["LG에너지솔루션", "배터리"] },
    { code: "247540", name: "에코프로비엠", keywords: ["에코프로비엠", "양극재"] },
    { code: "086520", name: "에코프로", keywords: ["에코프로", "2차전지"] },
    { code: "207940", name: "삼성바이오로직스", keywords: ["삼성바이오로직스", "바이오"] }
  ],
  energy: [
    { code: "034020", name: "두산에너빌리티", keywords: ["두산에너빌리티", "원전"] },
    { code: "010950", name: "S-Oil", keywords: ["S-Oil", "정유", "유가"] },
    { code: "096770", name: "SK이노베이션", keywords: ["SK이노베이션", "정유", "에너지"] },
    { code: "009830", name: "한화솔루션", keywords: ["한화솔루션", "태양광"] },
    { code: "267260", name: "HD현대일렉트릭", keywords: ["HD현대일렉트릭", "전력기기"] }
  ],
  defensive: [
    { code: "105560", name: "KB금융", keywords: ["KB금융", "은행"] },
    { code: "055550", name: "신한지주", keywords: ["신한지주", "은행"] },
    { code: "017670", name: "SK텔레콤", keywords: ["SK텔레콤", "통신"] },
    { code: "030200", name: "KT", keywords: ["KT", "통신"] },
    { code: "032830", name: "삼성생명", keywords: ["삼성생명", "보험"] }
  ]
};

const NEWS_QUERIES = {
  semiconductor: "반도체 HBM 메모리 국내 증시",
  ai: "인공지능 AI 로봇 데이터센터 국내 증시",
  growth: "2차전지 바이오 성장주 국내 증시",
  energy: "원전 정유 유가 전력기기 국내 증시",
  defensive: "은행 보험 통신 방어주 국내 증시"
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

async function fetchGoogleNewsRss(query) {
  const url = "https://news.google.com/rss/search";
  const response = await axios.get(url, {
    timeout: SETTINGS.requestTimeoutMs,
    params: {
      q: `${query} when:1d`,
      hl: "ko",
      gl: "KR",
      ceid: "KR:ko"
    },
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "application/rss+xml,text/xml"
    },
    responseType: "text"
  });

  const xml = String(response.data || "");
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)]
    .slice(0, SETTINGS.newsMaxItemsPerQuery)
    .map(match => {
      const block = match[1];
      const title = decodeXmlText(block.match(/<title>([\s\S]*?)<\/title>/)?.[1] || "");
      const link = decodeXmlText(block.match(/<link>([\s\S]*?)<\/link>/)?.[1] || "");
      const pubDate = decodeXmlText(block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] || "");
      return { title, link, pubDate };
    })
    .filter(item => item.title);

  return items;
}

function calculateNewsAssessment(newsBySector = {}) {
  const positiveWords = /상승|강세|호재|수주|증가|확대|돌파|최대|회복|개선|급등|랠리|투자|협력|계약/i;
  const negativeWords = /하락|약세|악재|감소|축소|우려|급락|부진|중단|적자|규제|리콜|충격/i;
  const sectorNewsScores = {};
  const flatNews = [];

  for (const [sector, rows] of Object.entries(newsBySector)) {
    let score = 0;
    for (const row of rows || []) {
      const title = String(row.title || "");
      if (positiveWords.test(title)) score += 1.5;
      if (negativeWords.test(title)) score -= 1.5;
      flatNews.push({ sector, ...row });
    }
    sectorNewsScores[sector] = round(Math.max(-8, Math.min(8, score)), 1);
  }

  return {
    sectorNewsScores,
    newsScore: round(
      Object.values(sectorNewsScores).reduce((sum, value) => sum + Number(value || 0), 0),
      1
    ),
    news: flatNews
  };
}

function buildPriorityStocks(sectorBias = {}, sectorNewsScores = {}, news = []) {
  const titleText = (news || []).map(item => item.title || "").join(" ").toLowerCase();
  const rows = [];

  for (const [sector, stocks] of Object.entries(PRIORITY_UNIVERSE)) {
    const bias = Number(sectorBias[sector] || 0);
    const newsBias = Number(sectorNewsScores[sector] || 0);

    for (const stock of stocks) {
      const mentionCount = (stock.keywords || []).reduce((count, keyword) => {
        return count + (titleText.includes(String(keyword).toLowerCase()) ? 1 : 0);
      }, 0);

      const priorityScore = bias + newsBias * 2 + mentionCount * 5;
      rows.push({
        code: stock.code,
        name: stock.name,
        sector,
        priorityScore: round(priorityScore, 1),
        marketBias: round(bias, 1),
        newsBias: round(newsBias, 1),
        newsMentionCount: mentionCount,
        reason:
          `${sector} 시장편향 ${bias >= 0 ? "+" : ""}${round(bias, 1)} / ` +
          `뉴스 ${newsBias >= 0 ? "+" : ""}${round(newsBias, 1)} / ` +
          `직접언급 ${mentionCount}건`
      });
    }
  }

  return rows
    .filter(row => row.priorityScore > 0)
    .sort((a, b) => b.priorityScore - a.priorityScore)
    .slice(0, SETTINGS.priorityStockCount)
    .map((row, index) => ({ rank: index + 1, ...row }));
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

  const newsBySector = {};
  if (SETTINGS.newsEnabled) {
    await Promise.all(
      Object.entries(NEWS_QUERIES).map(async ([sector, query]) => {
        try {
          newsBySector[sector] = await fetchGoogleNewsRss(query);
        } catch (error) {
          newsBySector[sector] = [];
          errors.push(`news-${sector}: ${error.message}`);
        }
      })
    );
  }

  const newsAssessment = calculateNewsAssessment(newsBySector);
  const adjustedSectorBias = { ...assessment.sectorBias };
  for (const [sector, score] of Object.entries(newsAssessment.sectorNewsScores)) {
    adjustedSectorBias[sector] = round(
      Math.max(-20, Math.min(20, Number(adjustedSectorBias[sector] || 0) + Number(score || 0))),
      1
    );
  }

  const priorityStocks = buildPriorityStocks(
    adjustedSectorBias,
    newsAssessment.sectorNewsScores,
    newsAssessment.news
  );

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
    sectorBias: adjustedSectorBias,
    indicators,
    news: newsAssessment.news,
    newsScore: newsAssessment.newsScore,
    sectorNewsScores: newsAssessment.sectorNewsScores,
    priorityStocks,
    errors
  };

  saveOpenMarketData(data);

  console.log(
    `[OPEN 시장자료] 완료 / ${data.status} / 성공 ${successCount}/${data.totalCount} / ` +
    `시장점수 ${data.marketScore} / 유형 ${data.marketType} / ` +
    `우선종목 ${data.priorityStocks.length}개 / 뉴스 ${data.news.length}건`
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
