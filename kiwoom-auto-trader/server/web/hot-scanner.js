const fs = require("fs");
const path = require("path");

const API_BASE = "http://localhost:3000";
const HOT_CANDIDATES_FILE = path.join(__dirname, "hot-candidates.json");
const HOT_HISTORY_FILE = path.join(__dirname, "hot-candidates-history.json");

const settings = {
  enabled: true,
  startTime: "09:00",
  earlyEndTime: "09:20",
  endTime: "13:30",
  earlyScanLoopMs: 5 * 1000,
  normalScanLoopMs: 15 * 1000,
  maxCandidates: 40,
  minChangeRate: 0.5,
  maxChangeRate: 25.0,
  minTradeVolumeRatio: 75,
  minDayPositionRate: 30,
  requestTimeoutMs: 25 * 1000,
  emptyResultKeepMs: 90 * 1000,

  // OPEN 전용: 최근 60초 표본으로 상승 지속성을 계산한다.
  openMomentumWindowMs: 60 * 1000,
  openMomentumMinSamples: 3
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

function isKoreanWeekday() {
  const day = new Date().toLocaleDateString("en-US", {
    timeZone: "Asia/Seoul",
    weekday: "short"
  });
  return day !== "Sat" && day !== "Sun";
}

function isOperatingTime() {
  const hhmm = getCurrentHHMM();
  return isKoreanWeekday() && hhmm >= settings.startTime && hhmm <= settings.endTime;
}


function getHotMinVolumeRatio(hhmm = getCurrentHHMM()) {
  if (hhmm < "09:05") return 75;
  if (hhmm < "09:10") return 85;
  if (hhmm < "09:20") return 95;
  return 110;
}

function getNextScanDelayMs() {
  const hhmm = getCurrentHHMM();

  return hhmm <= settings.earlyEndTime
    ? settings.earlyScanLoopMs
    : settings.normalScanLoopMs;
}

function writeJsonFileAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tempPath = path.join(dir, `.${base}.${process.pid}.${Date.now()}.tmp`);

  try {
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(tempPath, filePath);
  } finally {
    if (fs.existsSync(tempPath)) {
      try { fs.unlinkSync(tempPath); } catch (_) {}
    }
  }
}

function readPreviousHotCandidates() {
  if (!fs.existsSync(HOT_CANDIDATES_FILE)) return null;

  try {
    const parsed = JSON.parse(fs.readFileSync(HOT_CANDIDATES_FILE, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (err) {
    console.error("[HOT SCANNER 기존 후보 읽기 오류]", err.message);
    return null;
  }
}


function readHotHistory() {
  const fallback = { version: 1, date: todayKey(), updatedAt: null, detected: {} };
  if (!fs.existsSync(HOT_HISTORY_FILE)) return fallback;

  try {
    const parsed = JSON.parse(fs.readFileSync(HOT_HISTORY_FILE, "utf8"));
    if (!parsed || typeof parsed !== "object" || parsed.date !== todayKey()) {
      return fallback;
    }
    if (!parsed.detected || typeof parsed.detected !== "object") parsed.detected = {};
    return parsed;
  } catch (err) {
    console.error("[HOT SCANNER 누적이력 읽기 오류]", err.message);
    return fallback;
  }
}

function updateHotHistory(rows = []) {
  const history = readHotHistory();
  const now = nowText();
  const nowMs = Date.now();

  for (const item of rows) {
    const code = String(item.code || "");
    if (!/^\d{6}$/.test(code)) continue;

    const previous = history.detected[code] || {};
    const sources = Array.from(new Set([
      ...(Array.isArray(previous.sources) ? previous.sources : []),
      ...(Array.isArray(item.sources) ? item.sources : []),
      item.candidateSource || "HOT"
    ].filter(Boolean)));

    history.detected[code] = {
      code,
      name: item.name || previous.name || code,
      firstDetectedAt: previous.firstDetectedAt || now,
      firstDetectedAtMs: Number(previous.firstDetectedAtMs || nowMs),
      lastDetectedAt: now,
      lastDetectedAtMs: nowMs,
      detectionCount: Number(previous.detectionCount || 0) + 1,
      maxChangeRate: Math.max(Number(previous.maxChangeRate || -999), Number(item.changeRate || 0)),
      maxTradeVolumeRatio: Math.max(Number(previous.maxTradeVolumeRatio || 0), Number(item.tradeVolumeRatio || 0)),
      maxDayPosition: Math.max(Number(previous.maxDayPosition || 0), Number(item.dayPosition || 0)),
      maxHotScore: Math.max(Number(previous.maxHotScore || 0), Number(item.hotScore || 0)),
      maxMomentumScore: Math.max(Number(previous.maxMomentumScore || 0), Number(item.openMomentumScore || 0)),
      latestRank: Number(item.rank || 0),
      bestRank: previous.bestRank
        ? Math.min(Number(previous.bestRank), Number(item.rank || previous.bestRank))
        : Number(item.rank || 0),
      sources
    };
  }

  history.version = 1;
  history.date = todayKey();
  history.updatedAt = now;
  history.updatedAtMs = nowMs;
  history.count = Object.keys(history.detected).length;
  writeJsonFileAtomic(HOT_HISTORY_FILE, history);
}

function toNumber(value) {
  const number = Number(
    String(value ?? 0)
      .replace(/[+,%]/g, "")
      .replace(/,/g, "")
      .trim()
  );
  return Number.isFinite(number) ? number : 0;
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), settings.requestTimeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    let data = {};

    try {
      data = text ? JSON.parse(text) : {};
    } catch (_) {
      data = { rawText: text };
    }

    if (!response.ok) {
      throw new Error(data.message || data.error || `API 오류 ${response.status}`);
    }

    return data;
  } finally {
    clearTimeout(timer);
  }
}

function getDayPositionRate(item, currentPrice) {
  const high = Math.abs(toNumber(
    item.high || item.highPrice || item.raw?.high_pric || 0
  ));
  const low = Math.abs(toNumber(
    item.low || item.lowPrice || item.raw?.low_pric || 0
  ));

  if (!high || !low || high <= low || !currentPrice) return 0;
  return ((currentPrice - low) / (high - low)) * 100;
}

function getChangeRate(item = {}) {
  return toNumber(
    item.changeRate ??
    item.fluctuationRate ??
    item.riseRate ??
    item.rate ??
    item.flu_rt ??
    item.raw?.flu_rt ??
    0
  );
}

function getTradeVolumeRatio(item = {}) {
  const raw = item.raw || {};
  const trdePre = raw.trde_pre ?? item.trde_pre ?? null;

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

  return Number.isFinite(ratio) ? Math.max(0, ratio) : 0;
}

function isExcludedStock(item = {}) {
  const name = String(
    item.name ||
    item.stockName ||
    item.korName ||
    item.stk_nm ||
    ""
  ).trim();

  if (/KODEX|TIGER|ACE|SOL|HANARO|KOSEF|KBSTAR|ARIRANG|ETF|ETN|레버리지|인버스|스팩|SPAC/i.test(name)) {
    return true;
  }

  if (/우$|\d우B$|우B$|우선주/i.test(name)) {
    return true;
  }

  return false;
}

function calculateHotScore(item) {
  const changeRate = getChangeRate(item);
  const volumeRatio = getTradeVolumeRatio(item);
  const price = Math.abs(toNumber(
    item.currentPrice || item.price || item.curPrice ||
    item.cur_prc || item.raw?.cur_prc || 0
  ));
  const dayPosition = getDayPositionRate(item, price);

  const changeScore = Math.min(40, Math.max(0, changeRate) * 8);
  const volumeScore = Math.min(35, Math.max(0, volumeRatio - 100) / 5);
  const positionScore = Math.min(25, Math.max(0, dayPosition) * 0.25);
  return changeScore + volumeScore + positionScore;
}

function normalizeCandidate(item = {}) {
  const rawCode = String(
    item.code || item.stk_cd || item.stockCode || ""
  )
    .replace(/^A/i, "")
    .replace(/_[A-Z]+$/i, "")
    .replace(/[^0-9]/g, "")
    .trim();

  if (!/^\d{6}$/.test(rawCode)) return null;

  const currentPrice = Math.abs(toNumber(
    item.currentPrice ||
    item.price ||
    item.curPrice ||
    item.cur_prc ||
    item.raw?.cur_prc ||
    0
  ));

  const changeRate = getChangeRate(item);
  const tradeVolumeRatio = getTradeVolumeRatio(item);
  const dayPosition = getDayPositionRate(item, currentPrice);

  const hotScore = calculateHotScore({
    ...item,
    currentPrice,
    price: currentPrice,
    changeRate,
    tradeVolumeRatio
  });

  const discoverScore = Number(
    item.discoverScore ??
    Math.max(5, Math.round(hotScore / 10))
  );

  return {
    ...item,
    code: rawCode,
    name:
      item.name ||
      item.stockName ||
      item.korName ||
      item.stk_nm ||
      rawCode,
    currentPrice,
    price: currentPrice,
    changeRate,
    tradeVolumeRatio,
    dayPosition,
    discoverScore,
    hotScore: Number(hotScore.toFixed(1)),
    candidateSource: "HOT",
    hotDetectedAt: nowText(),
    hotDetectedAtMs: Date.now()
  };
}


function calculateOpenMomentum(candidate, previous = null) {
  const now = Date.now();
  const windowMs = Number(settings.openMomentumWindowMs || 60000);
  const previousSamples = Array.isArray(previous?.openMomentumSamples)
    ? previous.openMomentumSamples
    : [];

  const currentSample = {
    time: now,
    price: Number(candidate.currentPrice || 0),
    volumeRatio: Number(candidate.tradeVolumeRatio || 0),
    dayPosition: Number(candidate.dayPosition || 0),
    hotScore: Number(candidate.hotScore || 0)
  };

  const samples = [...previousSamples, currentSample]
    .filter(row => now - Number(row.time || 0) <= windowMs)
    .slice(-15);

  const first = samples[0] || currentSample;
  const last = samples[samples.length - 1] || currentSample;
  let priceUpCount = 0;
  let volumeUpCount = 0;
  let highRefreshCount = 0;
  let runningHigh = Number(first.price || 0);

  for (let i = 1; i < samples.length; i++) {
    if (Number(samples[i].price || 0) >= Number(samples[i - 1].price || 0)) priceUpCount++;
    if (Number(samples[i].volumeRatio || 0) >= Number(samples[i - 1].volumeRatio || 0)) volumeUpCount++;
    if (Number(samples[i].price || 0) > runningHigh) {
      runningHigh = Number(samples[i].price || 0);
      highRefreshCount++;
    }
  }

  const stepCount = Math.max(1, samples.length - 1);
  const priceRise30s = Number(first.price || 0) > 0
    ? ((Number(last.price || 0) - Number(first.price || 0)) / Number(first.price || 0)) * 100
    : 0;
  const volumeGrowth30s = Number(first.volumeRatio || 0) > 0
    ? ((Number(last.volumeRatio || 0) - Number(first.volumeRatio || 0)) / Number(first.volumeRatio || 0)) * 100
    : 0;
  const pricePersistence = priceUpCount / stepCount;
  const volumePersistence = volumeUpCount / stepCount;
  const hotDurationSeconds = previous?.hotFirstDetectedAtMs
    ? Math.max(0, (now - Number(previous.hotFirstDetectedAtMs)) / 1000)
    : 0;

  let openMomentumScore = 0;
  openMomentumScore += Math.max(-15, Math.min(30, priceRise30s * 25));
  openMomentumScore += Math.max(-10, Math.min(20, volumeGrowth30s * 0.12));
  openMomentumScore += pricePersistence * 20;
  openMomentumScore += volumePersistence * 15;
  openMomentumScore += Math.min(12, highRefreshCount * 3);
  openMomentumScore += Math.min(8, hotDurationSeconds / 10);
  openMomentumScore = Math.max(0, Math.min(100, openMomentumScore));

  return {
    openMomentumSamples: samples,
    openMomentumScore: Number(openMomentumScore.toFixed(1)),
    priceRise30s: Number(priceRise30s.toFixed(3)),
    volumeGrowth30s: Number(volumeGrowth30s.toFixed(1)),
    pricePersistence: Number((pricePersistence * 100).toFixed(1)),
    volumePersistence: Number((volumePersistence * 100).toFixed(1)),
    highRefreshCount,
    hotFirstDetectedAtMs: Number(previous?.hotFirstDetectedAtMs || now),
    hotDurationSeconds: Number(hotDurationSeconds.toFixed(1)),
    momentumSampleCount: samples.length
  };
}

async function scanHotCandidates() {
  if (!settings.enabled || !isOperatingTime()) return;

  const data = await fetchJson(
    `${API_BASE}/api/hot-candidates?limit=${settings.maxCandidates}`
  );

  const rawItems = Array.isArray(data.items)
    ? data.items
    : Array.isArray(data.rows)
      ? data.rows
      : Array.isArray(data.candidates)
        ? data.candidates
        : [];

  const previous = readPreviousHotCandidates();
  const previousItems = Array.isArray(previous?.items) ? previous.items : [];
  const previousByCode = Object.fromEntries(
    previousItems.map(item => [String(item.code || ""), item])
  );

  const rows = rawItems
    .map(normalizeCandidate)
    .filter(Boolean)
    .map(item => ({
      ...item,
      ...calculateOpenMomentum(item, previousByCode[item.code])
    }))
    .filter(item => !isExcludedStock(item))
    .filter(item => item.code && item.code !== "000000" && item.currentPrice > 0)
    .filter(item =>
      item.changeRate >= settings.minChangeRate &&
      item.changeRate <= settings.maxChangeRate
    )
    .filter(item => item.tradeVolumeRatio >= getHotMinVolumeRatio())
    .filter(item => item.dayPosition >= settings.minDayPositionRate)
    .sort((a, b) =>
      Number(b.openMomentumScore || 0) - Number(a.openMomentumScore || 0) ||
      Number(b.hotScore || 0) - Number(a.hotScore || 0)
    )
    .slice(0, settings.maxCandidates)
    .map((item, index) => ({
      ...item,
      rank: index + 1
    }));

  let finalRows = rows;
  let retainedPrevious = false;
  let previousAgeMs = 0;

  if (rows.length === 0) {
    const previous = readPreviousHotCandidates();
    previousAgeMs = Date.now() - Number(previous?.updatedAtMs || 0);

    const previousItems = Array.isArray(previous?.items)
      ? previous.items
      : Array.isArray(previous?.rows)
        ? previous.rows
        : [];

    if (
      previous?.date === todayKey() &&
      previousAgeMs >= 0 &&
      previousAgeMs <= settings.emptyResultKeepMs &&
      previousItems.length > 0
    ) {
      finalRows = previousItems
        .slice(0, settings.maxCandidates)
        .map((item, index) => ({
          ...item,
          rank: index + 1
        }));

      retainedPrevious = true;
    }
  }

  const output = {
    date: todayKey(),
    updatedAt: nowText(),
    updatedAtMs: Date.now(),
    source: data.source || "KIWOOM_RANK_HOT_CANDIDATES",
    appliedMinVolumeRatio: getHotMinVolumeRatio(),
    count: finalRows.length,
    retainedPrevious,
    retainedAgeMs: retainedPrevious ? previousAgeMs : 0,
    items: finalRows,
    rows: finalRows
  };

  writeJsonFileAtomic(HOT_CANDIDATES_FILE, output);
  updateHotHistory(finalRows);

  if (retainedPrevious) {
    console.log(
      `[HOT SCANNER] 원본 ${rawItems.length}개 / 신규 저장 0개 / ` +
      `기존 후보 ${finalRows.length}개 유지 / ` +
      `경과 ${(previousAgeMs / 1000).toFixed(1)}초`
    );
    return;
  }

  console.log(
    `[HOT SCANNER] 원본 ${rawItems.length}개 / 저장 ${finalRows.length}개 / ` +
    (finalRows.slice(0, 5)
      .map(item =>
        `${item.name}(${Number(item.changeRate || 0).toFixed(2)}%/` +
        `거래량 ${Number(item.tradeVolumeRatio || 0).toFixed(1)}%/` +
        `위치 ${Number(item.dayPosition || 0).toFixed(1)}%/` +
        `HOT ${Number(item.hotScore || 0).toFixed(1)}/` +
        `지속 ${Number(item.openMomentumScore || 0).toFixed(1)})`
      )
      .join(", ") || "후보 없음")
  );
}

let running = false;
let scannerTimer = null;
let scannerStarted = false;

async function runOnce() {
  if (running) return;
  running = true;

  try {
    await scanHotCandidates();
  } catch (err) {
    console.error(
      "[HOT SCANNER 오류]",
      err.name === "AbortError" ? "API 응답 시간초과" : err.message
    );
  } finally {
    running = false;
  }
}

async function scannerLoop() {
  if (!scannerStarted) return;

  await runOnce();

  if (!scannerStarted) return;

  scannerTimer = setTimeout(
    scannerLoop,
    getNextScanDelayMs()
  );
}

function startHotScanner() {
  if (scannerStarted) {
    console.log("[HOT SCANNER] 이미 실행 중");
    return;
  }

  scannerStarted = true;

  console.log(
    `[HOT SCANNER] 시작 / ${settings.startTime}~${settings.endTime} / ` +
    `장초반 ${settings.earlyScanLoopMs / 1000}초, 이후 ` +
    `${settings.normalScanLoopMs / 1000}초 주기 / ` +
    `빈 결과 기존 후보 ${settings.emptyResultKeepMs / 1000}초 유지`
  );

  scannerLoop();
}

module.exports = {
  startHotScanner,
  runHotScannerOnce: runOnce
};
