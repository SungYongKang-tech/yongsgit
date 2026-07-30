const fs = require("fs");
const path = require("path");

const API_BASE = "http://localhost:3000";
const HOT_CANDIDATES_FILE = path.join(__dirname, "hot-candidates.json");

const settings = {
  enabled: true,
  startTime: "09:00",
  endTime: "09:20",
  scanLoopMs: 5 * 1000,
  maxCandidates: 30,
  minChangeRate: 1.0,
  maxChangeRate: 12.0,
  minTradeVolumeRatio: 100,
  minDayPositionRate: 40,
  requestTimeoutMs: 25 * 1000,
  emptyResultKeepMs: 30 * 1000
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

  const rows = rawItems
    .map(normalizeCandidate)
    .filter(Boolean)
    .filter(item => !isExcludedStock(item))
    .filter(item => item.code && item.code !== "000000" && item.currentPrice > 0)
    .filter(item =>
      item.changeRate >= settings.minChangeRate &&
      item.changeRate <= settings.maxChangeRate
    )
    .filter(item => item.tradeVolumeRatio >= settings.minTradeVolumeRatio)
    .filter(item => item.dayPosition >= settings.minDayPositionRate)
    .sort((a, b) => Number(b.hotScore || 0) - Number(a.hotScore || 0))
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
    count: finalRows.length,
    retainedPrevious,
    retainedAgeMs: retainedPrevious ? previousAgeMs : 0,
    items: finalRows,
    rows: finalRows
  };

  writeJsonFileAtomic(HOT_CANDIDATES_FILE, output);

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
        `HOT ${Number(item.hotScore || 0).toFixed(1)})`
      )
      .join(", ") || "후보 없음")
  );
}

let running = false;
let scannerTimer = null;

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

function startHotScanner() {
  if (scannerTimer) {
    console.log("[HOT SCANNER] 이미 실행 중");
    return;
  }

  console.log(
    `[HOT SCANNER] 시작 / ${settings.startTime}~${settings.endTime} / ` +
    `${settings.scanLoopMs / 1000}초 주기 / ` +
    `빈 결과 기존 후보 ${settings.emptyResultKeepMs / 1000}초 유지`
  );

  runOnce();
  scannerTimer = setInterval(runOnce, settings.scanLoopMs);
}

module.exports = {
  startHotScanner,
  runHotScannerOnce: runOnce
};
