const fs = require("fs");
const path = require("path");

const API_BASE = process.env.SY_QUANT_API_BASE || "http://127.0.0.1:3000";
const STATE_FILE = path.join(__dirname, "paper-state-wave.json");
const HOT_HISTORY_FILE = path.join(__dirname, "hot-candidates-history.json");
const OPEN_MARKET_FILE = path.join(__dirname, "open-market.json");

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
  evaluationBatchSize: 4,
  evaluationDelayMs: 350,

  // 후보 유입: HOT 누적이력 + OPEN 장전 우선종목
  maxWatchCount: 40,
  hotIngestMaxCount: 25,
  marketPriorityIngestMaxCount: 10,
  hotMinScore: 65,
  hotMinChangeRate: 2.0,
  hotMaxChangeRate: 25.0,
  hotMinDetectionCount: 2,
  watchMaxTradingDays: 12,

  // 점수: WHY 30 + MONEY 20 + SECTOR 15 + TREND 10 + PULLBACK 15 + REBOUND 10
  whyMinScore: 12,
  foundationMinScore: 35, // WHY + MONEY + SECTOR
  totalBuyMinScore: 65,
  minWatchTradingDaysBeforeBuy: 1,
  pullbackMinScoreForReady: 7,
  reboundMinScoreForBuy: 6,
  currentDayMaxChangeRateForBuy: 7.0,

  // 모의매수: WAVE 전용 독립 가상계좌, 종목당 최초자산 10%
  positionRatio: 0.10,
  maxHoldingCount: 5,
  maxDailyBuyCount: 2,

  // 매도: 작은 흔들림은 허용하고 파동 종료를 잡는다.
  stopLossRate: -5.0,
  structureStopBufferRate: -1.5,
  protectStartProfitRate: 5.0,
  protectFloorProfitRate: 0.5,
  trailingStartProfitRate: 8.0,
  trailingStopRate: 4.0,
  strongTrailingStartProfitRate: 15.0,
  strongTrailingStopRate: 3.0,
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

function createInitialState() {
  return {
    version: 1,
    strategy: "WAVE",
    createdAt: nowText(),
    updatedAt: nowText(),
    initialCapital: SETTINGS.initialCapital,
    totalCash: SETTINGS.initialCapital,
    watchlist: [],
    holdings: [],
    tradeLogs: [],
    dailyStats: {},
    evaluationCursor: 0,
    lastRunAt: null,
    lastRunAtMs: 0,
    lastRunSummary: null
  };
}

function loadState() {
  if (!fs.existsSync(STATE_FILE)) {
    const state = createInitialState();
    writeJsonAtomic(STATE_FILE, state);
    return state;
  }

  try {
    const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    if (!Array.isArray(state.watchlist)) state.watchlist = [];
    if (!Array.isArray(state.holdings)) state.holdings = [];
    if (!Array.isArray(state.tradeLogs)) state.tradeLogs = [];
    if (!state.dailyStats || typeof state.dailyStats !== "object") state.dailyStats = {};
    if (!Number.isFinite(Number(state.totalCash))) state.totalCash = SETTINGS.initialCapital;
    if (!Number.isFinite(Number(state.initialCapital))) state.initialCapital = SETTINGS.initialCapital;
    if (!Number.isFinite(Number(state.evaluationCursor))) state.evaluationCursor = 0;
    return state;
  } catch (err) {
    console.error("[WAVE 상태파일 읽기 오류]", err.message);
    return createInitialState();
  }
}

function saveState(state) {
  state.updatedAt = nowText();
  state.updatedAtMs = Date.now();
  writeJsonAtomic(STATE_FILE, state);
}

function ensureDailyStats(state) {
  const date = todayKey();
  if (!state.dailyStats[date]) {
    state.dailyStats[date] = {
      date,
      discovered: 0,
      evaluated: 0,
      ready: 0,
      bought: 0,
      sold: 0,
      realizedProfit: 0
    };
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
  const value = String(text || "").toLowerCase();
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
    hotVolumeRatio: toNumber(snapshot.maxTradeVolumeRatio || snapshot.tradeVolumeRatio || 0),
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
  existing.hotVolumeRatio = Math.max(toNumber(existing.hotVolumeRatio), toNumber(incoming.hotVolumeRatio));
  existing.hotMomentumScore = Math.max(toNumber(existing.hotMomentumScore), toNumber(incoming.hotMomentumScore));
  existing.sectorPeerCount = Math.max(toNumber(existing.sectorPeerCount), toNumber(incoming.sectorPeerCount));
  existing.sectorPowerScore = Math.max(toNumber(existing.sectorPowerScore), toNumber(incoming.sectorPowerScore));
  existing.priorityScore = Math.max(toNumber(existing.priorityScore), toNumber(incoming.priorityScore));
  existing.priorityReason = incoming.priorityReason || existing.priorityReason || null;
  existing.representativeNews = incoming.representativeNews || existing.representativeNews || null;
  existing.sector = incoming.sector || existing.sector || null;
  existing.sectorKey = incoming.sectorKey || existing.sectorKey || null;
  if (!existing.discoveryPrice && incoming.discoveryPrice) existing.discoveryPrice = incoming.discoveryPrice;
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

async function getPrice(code) {
  return fetchJson(`${API_BASE}/api/price?code=${encodeURIComponent(code)}&source=wave`, 12000);
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

function scoreWhy(candidate, newsItems = []) {
  const strongPositive = /대규모|공급계약|수주|계약 체결|흑자전환|사상 최대|최대 실적|영업이익.*증가|매출.*증가|실적 개선|승인|허가|신규 수주|증설|생산능력 확대|대형 고객|납품|독점|특허|신규 사업|투자 확대/i;
  const normalPositive = /호재|성장|회복|개선|확대|협력|투자|개발|진출|상용화|수혜|강세|전망 상향|목표가 상향/i;
  const severeNegative = /횡령|배임|거래정지|상장폐지|감사의견|부도|회생절차|유상증자|전환사채|CB 발행|리콜|영업정지/i;
  const normalNegative = /적자|실적 부진|감소|악재|규제|급락|우려|하향|축소|중단/i;

  const titles = [
    ...(candidate.representativeNews ? [{ title: candidate.representativeNews, source: "PRIORITY" }] : []),
    ...newsItems.map(item => ({ ...item, source: "GOOGLE" }))
  ];

  let score = 0;
  let strongCount = 0;
  let positiveCount = 0;
  let severeNegativeCount = 0;
  let negativeCount = 0;

  for (const item of titles) {
    const title = String(item.title || "");
    if (strongPositive.test(title)) {
      // 대형 수주·실적전환 같은 핵심 재료는 기사 1건만으로도 A급 후보가 되게 한다.
      score += strongCount === 0 ? 18 : 3;
      strongCount++;
    } else if (normalPositive.test(title)) {
      score += positiveCount === 0 ? 7 : 2;
      positiveCount++;
    }
    if (severeNegative.test(title)) {
      score -= 15;
      severeNegativeCount++;
    } else if (normalNegative.test(title)) {
      score -= 4;
      negativeCount++;
    }
  }

  if (toNumber(candidate.priorityScore) >= 20) score += 4;
  else if (toNumber(candidate.priorityScore) >= 10) score += 2;

  // HOT만으로는 재료 점수를 높게 만들지 않는다. 뉴스/재료가 없으면 최대 5점 수준이다.
  if (!titles.length && (candidate.sources || []).includes("HOT")) score = Math.max(score, 3);

  score = clamp(score, 0, 30);
  const grade = score >= 25 ? "S" : score >= 18 ? "A" : score >= 8 ? "B" : "C";

  return {
    score,
    grade,
    strongCount,
    positiveCount,
    severeNegativeCount,
    negativeCount,
    newsCount: titles.length,
    headlines: titles.slice(0, 5).map(item => item.title)
  };
}

function scoreMoney(candidate, flowData = {}, dailyItems = []) {
  const rows = Array.isArray(flowData.rows) ? flowData.rows.slice(-5) : [];
  const foreignSum = rows.reduce((sum, row) => sum + toNumber(row.foreignNetBuy), 0);
  const institutionSum = rows.reduce((sum, row) => sum + toNumber(row.institutionNetBuy), 0);
  const foreignPositiveDays = rows.filter(row => toNumber(row.foreignNetBuy) > 0).length;
  const institutionPositiveDays = rows.filter(row => toNumber(row.institutionNetBuy) > 0).length;
  const latestTradeValue = rows.length ? toNumber(rows[rows.length - 1].tradingValueMillion) : 0;

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
    flowAvailable: rows.length > 0
  };
}

function scoreSector(candidate, marketData = {}) {
  const key = candidate.sectorKey || inferSectorKey(candidate.sector || "");
  const sectorBias = key ? toNumber(marketData.sectorBias?.[key]) : 0;
  const newsBias = key ? toNumber(marketData.sectorNewsScores?.[key]) : 0;

  let marketScore = 0;
  if (sectorBias >= 10) marketScore = 8;
  else if (sectorBias >= 5) marketScore = 6;
  else if (sectorBias >= 0) marketScore = 4;
  else if (sectorBias > -5) marketScore = 2;

  let newsScore = 0;
  if (newsBias >= 4) newsScore = 4;
  else if (newsBias >= 1) newsScore = 3;
  else if (newsBias >= 0) newsScore = 2;

  let breadthScore = 0;
  const sectorPower = toNumber(candidate.sectorPowerScore);
  const peerCount = toNumber(candidate.sectorPeerCount);
  if (sectorPower >= 4 || peerCount >= 5) breadthScore = 3;
  else if (sectorPower >= 2 || peerCount >= 3) breadthScore = 2;
  else if (toNumber(candidate.hotScore) >= 85 && toNumber(candidate.hotMomentumScore) >= 50) breadthScore = 1;

  return {
    score: clamp(marketScore + newsScore + breadthScore, 0, 15),
    sectorKey: key,
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

  // 현재일 거래량은 장중이면 미완성일 수 있어 직전 완료봉 중심으로 비교한다.
  const completed = dailyItems.length >= 2 ? dailyItems.slice(0, -1) : dailyItems;
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

function scoreRebound(priceData = {}, dailyItems = []) {
  const current = toNumber(priceData.currentPrice);
  const high = toNumber(priceData.high);
  const low = toNumber(priceData.low);
  const volume = toNumber(priceData.volume);
  const changeRate = toNumber(priceData.changeRate);
  const previous = dailyItems.length >= 2 ? dailyItems[dailyItems.length - 2] : dailyItems[dailyItems.length - 1];
  const prevClose = toNumber(previous?.close);
  const prevHigh = toNumber(previous?.high);
  const prevVolume = toNumber(previous?.volume);

  let score = 0;
  if (changeRate >= 1.0) score += 3;
  else if (changeRate > 0) score += 1;
  if (prevHigh > 0 && current > prevHigh) score += 4;

  const dayPosition = high > low && current > 0 ? ((current - low) / (high - low)) * 100 : 0;
  if (dayPosition >= 70) score += 2;
  else if (dayPosition >= 55) score += 1;

  if (prevVolume > 0 && volume >= prevVolume * 0.60) score += 1;

  return {
    score: clamp(score, 0, 10),
    changeRate,
    dayPosition,
    current,
    prevClose,
    prevHigh,
    volume,
    prevVolume
  };
}

function tradingDaysSince(dailyItems = [], dateText = todayKey()) {
  const target = String(dateText || "").replace(/-/g, "");
  const dates = dailyItems
    .map(item => String(item.date || "").replace(/-/g, ""))
    .filter(Boolean);
  return Math.max(0, dates.filter(date => date >= target).length - 1);
}

async function analyzeCandidate(candidate, priceData, dailyData, flowData, newsItems, marketData) {
  const dailyItems = Array.isArray(dailyData?.items) ? dailyData.items : [];
  const currentPrice = toNumber(priceData.currentPrice);
  const why = scoreWhy(candidate, newsItems);
  const money = scoreMoney(candidate, flowData, dailyItems);
  const sector = scoreSector(candidate, marketData);
  const trend = scoreTrend(dailyItems, currentPrice);
  const pullback = scorePullback(candidate, dailyItems, currentPrice, trend);
  const rebound = scoreRebound(priceData, dailyItems);

  const foundationScore = why.score + money.score + sector.score;
  const totalScore = foundationScore + trend.score + pullback.score + rebound.score;
  const ageTradingDays = tradingDaysSince(dailyItems, candidate.discoveredDate);

  const buyEligible =
    why.score >= SETTINGS.whyMinScore &&
    foundationScore >= SETTINGS.foundationMinScore &&
    totalScore >= SETTINGS.totalBuyMinScore &&
    pullback.score >= SETTINGS.pullbackMinScoreForReady &&
    rebound.score >= SETTINGS.reboundMinScoreForBuy &&
    rebound.changeRate <= SETTINGS.currentDayMaxChangeRateForBuy &&
    pullback.pullbackRate >= -9.5 &&
    ageTradingDays >= SETTINGS.minWatchTradingDaysBeforeBuy;

  return {
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
    buyEligible,
    buyReason: buyEligible
      ? `WAVE 매수조건 충족 / WHY ${why.score} MONEY ${money.score} SECTOR ${sector.score} / ` +
        `TREND ${trend.score} PULLBACK ${pullback.score} REBOUND ${rebound.score} / 총 ${totalScore}`
      : null
  };
}

function getTodayBuyCount(state) {
  const date = todayKey();
  return state.tradeLogs.filter(log => log.date === date && log.type === "WAVE_BUY").length;
}

function isBuyTime() {
  const hhmm = getCurrentHHMM();
  return isKoreanWeekday() && hhmm >= SETTINGS.buyStartTime && hhmm <= SETTINGS.buyEndTime;
}

function isSellCheckTime() {
  const hhmm = getCurrentHHMM();
  return isKoreanWeekday() && hhmm >= SETTINGS.sellCheckStartTime && hhmm <= SETTINGS.sellCheckEndTime;
}

function paperBuy(state, candidate, analysis) {
  const price = toNumber(analysis.currentPrice);
  if (!price) return false;
  if (state.holdings.some(item => item.code === candidate.code)) return false;
  if (state.holdings.length >= SETTINGS.maxHoldingCount) return false;
  if (getTodayBuyCount(state) >= SETTINGS.maxDailyBuyCount) return false;

  const targetAmount = toNumber(state.initialCapital) * SETTINGS.positionRatio;
  const buyAmount = Math.min(targetAmount, toNumber(state.totalCash));
  const qty = Math.floor(buyAmount / price);
  if (qty <= 0) return false;

  const amount = qty * price;
  const holding = {
    code: candidate.code,
    name: candidate.name,
    strategyGroup: "WAVE",
    buyPrice: price,
    currentPrice: price,
    highestPrice: price,
    lowestPrice: price,
    qty,
    buyAmount: amount,
    buyDate: todayKey(),
    buyTime: nowText(),
    buyTimeMs: Date.now(),
    pullbackLowPrice: toNumber(analysis.pullback.pullbackLowPrice),
    peakBeforeBuy: toNumber(analysis.pullback.peakPrice),
    buyScore: toNumber(analysis.totalScore),
    buyFoundationScore: toNumber(analysis.foundationScore),
    buyAnalysis: analysis
  };

  state.holdings.push(holding);
  state.totalCash -= amount;
  state.tradeLogs.push({
    type: "WAVE_BUY",
    strategyGroup: "WAVE",
    date: todayKey(),
    time: nowText(),
    code: candidate.code,
    name: candidate.name,
    price,
    qty,
    amount,
    score: analysis.totalScore,
    foundationScore: analysis.foundationScore,
    whyScore: analysis.why.score,
    moneyScore: analysis.money.score,
    sectorScore: analysis.sector.score,
    trendScore: analysis.trend.score,
    pullbackScore: analysis.pullback.score,
    reboundScore: analysis.rebound.score,
    reason: analysis.buyReason
  });

  candidate.status = "HOLD";
  candidate.boughtAt = nowText();
  candidate.boughtDate = todayKey();
  candidate.buyPrice = price;
  candidate.buyScore = analysis.totalScore;
  candidate.pullbackLowPrice = toNumber(analysis.pullback.pullbackLowPrice);
  ensureDailyStats(state).bought += 1;

  console.log(
    `[WAVE 모의매수] ${candidate.name} / ${price.toLocaleString()}원 / ${qty}주 / ` +
    `총점 ${analysis.totalScore} / WHY ${analysis.why.score} MONEY ${analysis.money.score} ` +
    `SECTOR ${analysis.sector.score} PULLBACK ${analysis.pullback.score} REBOUND ${analysis.rebound.score}`
  );
  return true;
}

function paperSell(state, holding, price, type, reason) {
  const sellPrice = toNumber(price);
  if (!sellPrice || !holding) return false;
  const qty = toNumber(holding.qty);
  const buyPrice = toNumber(holding.buyPrice);
  const amount = sellPrice * qty;
  const profit = (sellPrice - buyPrice) * qty;
  const profitRate = buyPrice > 0 ? ((sellPrice - buyPrice) / buyPrice) * 100 : 0;

  state.totalCash += amount;
  state.holdings = state.holdings.filter(item => item !== holding);
  state.tradeLogs.push({
    type,
    strategyGroup: "WAVE",
    date: todayKey(),
    time: nowText(),
    code: holding.code,
    name: holding.name,
    price: sellPrice,
    qty,
    amount,
    buyPrice,
    profit,
    profitRate,
    maxProfitRate: buyPrice > 0 ? ((toNumber(holding.highestPrice) - buyPrice) / buyPrice) * 100 : 0,
    maxLossRate: buyPrice > 0 ? ((toNumber(holding.lowestPrice) - buyPrice) / buyPrice) * 100 : 0,
    reason
  });

  const candidate = state.watchlist.find(item => item.code === holding.code);
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

  console.log(`[WAVE 모의매도] ${holding.name} / ${type} / ${profitRate.toFixed(2)}% / ${reason}`);
  return true;
}

async function checkHoldingSell(state, holding) {
  let priceData;
  let dailyData;
  try {
    [priceData, dailyData] = await Promise.all([getPrice(holding.code), getDaily(holding.code)]);
  } catch (err) {
    console.log(`[WAVE 보유조회 실패] ${holding.name} / ${err.message}`);
    return false;
  }

  const price = toNumber(priceData.currentPrice);
  if (!price) return false;

  holding.currentPrice = price;
  holding.highestPrice = Math.max(toNumber(holding.highestPrice || price), price);
  holding.lowestPrice = Math.min(toNumber(holding.lowestPrice || price), price);

  const buyPrice = toNumber(holding.buyPrice);
  const profitRate = ((price - buyPrice) / buyPrice) * 100;
  const maxProfitRate = ((toNumber(holding.highestPrice) - buyPrice) / buyPrice) * 100;
  const drawdownFromHigh = ((price - toNumber(holding.highestPrice)) / toNumber(holding.highestPrice)) * 100;
  const dailyItems = Array.isArray(dailyData.items) ? dailyData.items : [];
  const trend = scoreTrend(dailyItems, price);
  const holdingDays = tradingDaysSince(dailyItems, holding.buyDate);

  holding.lastCheckedAt = nowText();
  holding.profitRate = profitRate;
  holding.maxProfitRate = maxProfitRate;
  holding.drawdownFromHigh = drawdownFromHigh;
  holding.holdingTradingDays = holdingDays;
  holding.trendScore = trend.score;

  if (profitRate <= SETTINGS.stopLossRate) {
    return paperSell(state, holding, price, "WAVE_STOP_LOSS",
      `초기 손절 ${profitRate.toFixed(2)}% / 기준 ${SETTINGS.stopLossRate.toFixed(2)}%`);
  }

  const structuralStop = toNumber(holding.pullbackLowPrice) > 0
    ? toNumber(holding.pullbackLowPrice) * (1 + SETTINGS.structureStopBufferRate / 100)
    : 0;
  if (structuralStop > 0 && price <= structuralStop && profitRate < 0) {
    return paperSell(state, holding, price, "WAVE_STRUCTURE_STOP",
      `눌림 저점 이탈 / 기준 ${Math.round(structuralStop).toLocaleString()}원 / 현재 ${price.toLocaleString()}원`);
  }

  if (
    maxProfitRate >= SETTINGS.strongTrailingStartProfitRate &&
    drawdownFromHigh <= -Math.abs(SETTINGS.strongTrailingStopRate)
  ) {
    return paperSell(state, holding, price, "WAVE_STRONG_TRAILING_SELL",
      `강한 수익보호 / 최고 ${maxProfitRate.toFixed(2)}% / 고점대비 ${drawdownFromHigh.toFixed(2)}%`);
  }

  if (
    maxProfitRate >= SETTINGS.trailingStartProfitRate &&
    drawdownFromHigh <= -Math.abs(SETTINGS.trailingStopRate)
  ) {
    return paperSell(state, holding, price, "WAVE_TRAILING_SELL",
      `수익 트레일링 / 최고 ${maxProfitRate.toFixed(2)}% / 고점대비 ${drawdownFromHigh.toFixed(2)}%`);
  }

  if (
    maxProfitRate >= SETTINGS.protectStartProfitRate &&
    profitRate <= SETTINGS.protectFloorProfitRate
  ) {
    return paperSell(state, holding, price, "WAVE_PROTECT_SELL",
      `수익 후 본전보호 / 최고 ${maxProfitRate.toFixed(2)}% / 현재 ${profitRate.toFixed(2)}%`);
  }

  if (maxProfitRate >= SETTINGS.trailingStartProfitRate) {
    const candidate = state.watchlist.find(item => item.code === holding.code);
    if (candidate && candidate.status === "HOLD") candidate.status = "PROTECT";
  }

  if (holdingDays >= SETTINGS.hardMaxHoldingTradingDays) {
    return paperSell(state, holding, price, "WAVE_MAX_TIME_SELL",
      `최대 보유 ${holdingDays}거래일 / 현재 ${profitRate.toFixed(2)}%`);
  }

  if (holdingDays >= SETTINGS.maxHoldingTradingDays) {
    if (profitRate < 2.0 || trend.score < 4) {
      return paperSell(state, holding, price, "WAVE_TIME_TREND_SELL",
        `보유 ${holdingDays}거래일 / 수익 ${profitRate.toFixed(2)}% / 추세 ${trend.score}점`);
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
  const closed = state.watchlist
    .filter(item => ["SOLD", "DROPPED"].includes(item.status))
    .sort((a, b) => toNumber(b.soldAtMs || b.lastEvaluatedAtMs) - toNumber(a.soldAtMs || a.lastEvaluatedAtMs))
    .slice(0, 80);

  active.sort((a, b) => {
    const aScore = toNumber(a.lastAnalysis?.totalScore) + toNumber(a.hotScore) * 0.1 + toNumber(a.priorityScore) * 0.1;
    const bScore = toNumber(b.lastAnalysis?.totalScore) + toNumber(b.hotScore) * 0.1 + toNumber(b.priorityScore) * 0.1;
    return bScore - aScore;
  });

  state.watchlist = [...active.slice(0, SETTINGS.maxWatchCount), ...closed];
}

async function evaluateWatchCandidates(state) {
  const candidates = state.watchlist
    .filter(item => ["DISCOVERED", "WATCH", "READY"].includes(item.status))
    .sort((a, b) => toNumber(a.lastEvaluatedAtMs) - toNumber(b.lastEvaluatedAtMs));

  if (!candidates.length) return { evaluated: 0, ready: 0, bought: 0 };

  const batch = candidates.slice(0, SETTINGS.evaluationBatchSize);
  const marketData = loadJson(OPEN_MARKET_FILE, {});
  let evaluated = 0;
  let ready = 0;
  let bought = 0;

  for (const candidate of batch) {
    try {
      const [priceData, dailyData, flowData, newsItems] = await Promise.all([
        getPrice(candidate.code),
        getDaily(candidate.code),
        getInvestorFlow(candidate.code),
        fetchStockNews(candidate.name)
      ]);

      const analysis = await analyzeCandidate(candidate, priceData, dailyData, flowData, newsItems, marketData);
      candidate.lastPrice = analysis.currentPrice;
      candidate.peakPrice = Math.max(toNumber(candidate.peakPrice), toNumber(analysis.pullback.peakPrice), analysis.currentPrice);
      candidate.pullbackLowPrice = Math.min(
        ...[toNumber(candidate.pullbackLowPrice), toNumber(analysis.pullback.pullbackLowPrice), analysis.currentPrice]
          .filter(value => value > 0)
      );
      candidate.lastAnalysis = analysis;
      candidate.lastEvaluatedAt = analysis.checkedAt;
      candidate.lastEvaluatedAtMs = analysis.checkedAtMs;
      candidate.status = candidate.status === "DISCOVERED" ? "WATCH" : candidate.status;

      const foundationReady =
        analysis.why.score >= SETTINGS.whyMinScore &&
        analysis.foundationScore >= SETTINGS.foundationMinScore &&
        analysis.pullback.score >= SETTINGS.pullbackMinScoreForReady;

      if (foundationReady && candidate.status !== "READY") {
        candidate.status = "READY";
        candidate.readyAt = nowText();
        console.log(
          `[WAVE READY] ${candidate.name} / 총 ${analysis.totalScore} / ` +
          `WHY ${analysis.why.score} MONEY ${analysis.money.score} SECTOR ${analysis.sector.score} / ` +
          `눌림 ${analysis.pullback.pullbackRate.toFixed(2)}%`
        );
      }

      if (candidate.status === "READY") ready++;

      if (analysis.buyEligible && isBuyTime()) {
        if (paperBuy(state, candidate, analysis)) bought++;
      }

      evaluated++;
      ensureDailyStats(state).evaluated += 1;
      if (candidate.status === "READY") ensureDailyStats(state).ready += 1;
    } catch (err) {
      candidate.lastError = err.message;
      candidate.lastErrorAt = nowText();
      console.log(`[WAVE 후보평가 실패] ${candidate.name}(${candidate.code}) / ${err.message}`);
    }

    await sleep(SETTINGS.evaluationDelayMs);
  }

  return { evaluated, ready, bought };
}

async function checkAllHoldings(state) {
  if (!isSellCheckTime()) return 0;
  let sold = 0;
  for (const holding of [...state.holdings]) {
    if (await checkHoldingSell(state, holding)) sold++;
    await sleep(SETTINGS.evaluationDelayMs);
  }
  return sold;
}

function makeSummary(state) {
  const activeWatch = state.watchlist.filter(item => ["DISCOVERED", "WATCH", "READY"].includes(item.status));
  const ready = activeWatch.filter(item => item.status === "READY");
  const realizedProfit = state.tradeLogs
    .filter(log => String(log.type || "").startsWith("WAVE_") && String(log.type || "") !== "WAVE_BUY" && Number.isFinite(Number(log.profit)))
    .reduce((sum, log) => sum + Number(log.profit || 0), 0);

  const invested = state.holdings.reduce((sum, item) => sum + toNumber(item.currentPrice || item.buyPrice) * toNumber(item.qty), 0);
  const unrealized = state.holdings.reduce((sum, item) => sum + (toNumber(item.currentPrice) - toNumber(item.buyPrice)) * toNumber(item.qty), 0);

  return {
    updatedAt: nowText(),
    totalCash: toNumber(state.totalCash),
    invested,
    equity: toNumber(state.totalCash) + invested,
    realizedProfit,
    unrealizedProfit: unrealized,
    watchCount: activeWatch.length,
    readyCount: ready.length,
    holdingCount: state.holdings.length,
    todayBuyCount: getTodayBuyCount(state),
    topCandidates: activeWatch
      .slice()
      .sort((a, b) => toNumber(b.lastAnalysis?.totalScore) - toNumber(a.lastAnalysis?.totalScore))
      .slice(0, 10)
      .map(item => ({
        code: item.code,
        name: item.name,
        status: item.status,
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

let running = false;
let timer = null;
let alignmentTimer = null;
let started = false;

async function runWaveOnce() {
  if (running) return { ok: false, reason: "WAVE 실행 중" };
  running = true;

  const state = loadState();
  try {
    if (!SETTINGS.enabled) return { ok: false, reason: "WAVE OFF" };

    const hotAdded = ingestHotCandidates(state);
    const priorityAdded = ingestMarketPriorityCandidates(state);

    let sold = 0;
    let evaluation = { evaluated: 0, ready: 0, bought: 0 };

    if (isKoreanWeekday()) {
      sold = await checkAllHoldings(state);
      const hhmm = getCurrentHHMM();
      if (hhmm >= SETTINGS.evaluationStartTime && hhmm <= SETTINGS.evaluationEndTime) {
        evaluation = await evaluateWatchCandidates(state);
      }
    }

    dropExpiredOrBrokenCandidates(state);
    trimWatchlist(state);

    state.lastRunAt = nowText();
    state.lastRunAtMs = Date.now();
    state.lastRunSummary = {
      hotAdded,
      priorityAdded,
      ...evaluation,
      sold,
      hhmm: getCurrentHHMM()
    };
    state.summary = makeSummary(state);
    saveState(state);

    console.log(
      `[WAVE] 후보+${hotAdded + priorityAdded} / 평가 ${evaluation.evaluated} / ` +
      `READY ${state.summary.readyCount} / 보유 ${state.summary.holdingCount} / ` +
      `오늘매수 ${state.summary.todayBuyCount} / 매도 ${sold}`
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
    `[WAVE] 시작 / 매수 ${SETTINGS.buyStartTime}~${SETTINGS.buyEndTime} / ` +
    `5분 주기 / WHY+MONEY+SECTOR ${SETTINGS.foundationMinScore}점 이상 / 총 ${SETTINGS.totalBuyMinScore}점 이상`
  );

  // 서버 시작 시 후보는 즉시 적재하되 장외시간에는 실제 모의매수하지 않는다.
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
}

function getWaveSummary() {
  const state = loadState();
  return state.summary || makeSummary(state);
}

module.exports = {
  SETTINGS,
  STATE_FILE,
  startWaveStrategy,
  runWaveOnce,
  loadWaveState: loadState,
  getWaveSummary,
  // 순수 점수함수는 가상검증/테스트용으로 내보낸다.
  scoreWhy,
  scoreMoney,
  scoreSector,
  scoreTrend,
  scorePullback,
  scoreRebound,
  analyzeCandidate
};
