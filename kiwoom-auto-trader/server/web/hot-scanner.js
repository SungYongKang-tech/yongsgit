const fs = require("fs");
const path = require("path");

const API_BASE =
  "http://localhost:3000";

const HOT_CANDIDATES_FILE =
  path.join(
    __dirname,
    "hot-candidates.json"
  );

const settings = {
  enabled: true,

  startTime: "09:00",
  endTime: "13:30",

  scanLoopMs: 15 * 1000,

  maxCandidates: 30,

  minChangeRate: 1.0,
  maxChangeRate: 8.0,

  minTradeVolumeRatio: 100,
  minDayPositionRate: 40,

  requestTimeoutMs: 12000
};

function nowText() {
  return new Date().toLocaleString(
    "ko-KR",
    {
      timeZone: "Asia/Seoul"
    }
  );
}

function todayKey() {
  return new Date().toLocaleDateString(
    "sv-SE",
    {
      timeZone: "Asia/Seoul"
    }
  );
}

function getCurrentHHMM() {
  const parts =
    new Intl.DateTimeFormat(
      "en-GB",
      {
        timeZone: "Asia/Seoul",
        hourCycle: "h23",
        hour: "2-digit",
        minute: "2-digit"
      }
    ).formatToParts(new Date());

  const hour =
    parts.find(
      part => part.type === "hour"
    )?.value || "00";

  const minute =
    parts.find(
      part => part.type === "minute"
    )?.value || "00";

  return `${hour}:${minute}`;
}

function isKoreanWeekday() {
  const day =
    new Date().toLocaleDateString(
      "en-US",
      {
        timeZone: "Asia/Seoul",
        weekday: "short"
      }
    );

  return day !== "Sat" &&
    day !== "Sun";
}

function isOperatingTime() {
  const hhmm = getCurrentHHMM();

  return (
    isKoreanWeekday() &&
    hhmm >= settings.startTime &&
    hhmm <= settings.endTime
  );
}

function writeJsonFileAtomic(
  filePath,
  data
) {
  const tempPath =
    `${filePath}.${process.pid}.tmp`;

  fs.writeFileSync(
    tempPath,
    JSON.stringify(data, null, 2),
    "utf8"
  );

  fs.renameSync(
    tempPath,
    filePath
  );
}

async function fetchJson(url) {
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () => controller.abort(),
      settings.requestTimeoutMs
    );

  try {
    const response =
      await fetch(
        url,
        {
          signal: controller.signal
        }
      );

    const text =
      await response.text();

    let data = {};

    try {
      data =
        text
          ? JSON.parse(text)
          : {};
    } catch (_) {
      data = {
        rawText: text
      };
    }

    if (!response.ok) {
      throw new Error(
        data.message ||
        data.error ||
        `API 오류 ${response.status}`
      );
    }

    return data;
  } finally {
    clearTimeout(timer);
  }
}

function getDayPositionRate(
  item,
  currentPrice
) {
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

  if (
    !high ||
    !low ||
    high <= low ||
    !currentPrice
  ) {
    return 0;
  }

  return (
    (currentPrice - low) /
    (high - low)
  ) * 100;
}

function getChangeRate(item = {}) {
  const value =
    item.changeRate ??
    item.fluctuationRate ??
    item.riseRate ??
    item.rate ??
    item.raw?.flu_rt ??
    0;

  const number = Number(
    String(value)
      .replace(/[+,%]/g, "")
  );

  return Number.isFinite(number)
    ? number
    : 0;
}

function getTradeVolumeRatio(item = {}) {
  const rawValue =
    item.tradeVolumeRatio ??
    item.volumeRatio ??
    item.raw?.trde_pre ??
    item.trde_pre ??
    0;

  const number = Number(
    String(rawValue)
      .replace(/[+,%]/g, "")
  );

  return Number.isFinite(number)
    ? Math.max(0, number)
    : 0;
}

function calculateHotScore(item) {
  const changeRate =
    getChangeRate(item);

  const volumeRatio =
    getTradeVolumeRatio(item);

  const price =
    Math.abs(Number(
      item.currentPrice ||
      item.price ||
      item.curPrice ||
      item.raw?.cur_prc ||
      0
    ));

  const dayPosition =
    getDayPositionRate(
      item,
      price
    );

  /*
   * 상승률 최대 40점
   * 거래량 최대 35점
   * 당일위치 최대 25점
   */
  const changeScore =
    Math.min(
      40,
      Math.max(0, changeRate) * 8
    );

  const volumeScore =
    Math.min(
      35,
      Math.max(
        0,
        volumeRatio - 100
      ) / 5
    );

  const positionScore =
    Math.min(
      25,
      Math.max(0, dayPosition) * 0.25
    );

  return (
    changeScore +
    volumeScore +
    positionScore
  );
}

function normalizeCandidate(item) {
  const rawCode =
    String(item.code || "")
      .trim();

  if (!rawCode) {
    return null;
  }

  const currentPrice =
    Math.abs(Number(
      item.currentPrice ||
      item.price ||
      item.curPrice ||
      item.raw?.cur_prc ||
      0
    ));

  const changeRate =
    getChangeRate(item);

  const tradeVolumeRatio =
    getTradeVolumeRatio(item);

  const dayPosition =
    getDayPositionRate(
      item,
      currentPrice
    );

  const hotScore =
    calculateHotScore({
      ...item,
      currentPrice,
      price: currentPrice,
      changeRate,
      tradeVolumeRatio
    });

  const discoverScore =
    Number(
      item.discoverScore ||
      Math.max(
        7,
        Math.round(
          hotScore / 10
        )
      )
    );

  return {
    ...item,

    code:
      rawCode.padStart(6, "0"),

    name:
      item.name ||
      item.stockName ||
      item.korName ||
      rawCode,

    currentPrice,
    price: currentPrice,

    changeRate,
    tradeVolumeRatio,
    dayPosition,
    discoverScore,

    hotScore:
      Number(
        hotScore.toFixed(1)
      ),

    candidateSource: "HOT",

    hotDetectedAt: nowText(),
    hotDetectedAtMs: Date.now()
  };
}

async function scanHotCandidates() {
  if (
    !settings.enabled ||
    !isOperatingTime()
  ) {
    return;
  }

  const data =
    await fetchJson(
      `${API_BASE}/api/hot-candidates` +
      `?limit=${settings.maxCandidates}`
    );

  const rawItems =
    Array.isArray(data.items)
      ? data.items
      : [];

  const rows =
    rawItems
      .map(normalizeCandidate)
      .filter(Boolean)
      .filter(item =>
        item.code &&
        item.code !== "000000" &&
        item.currentPrice > 0
      )
      .filter(item =>
        item.changeRate >=
          settings.minChangeRate &&
        item.changeRate <=
          settings.maxChangeRate
      )
      .filter(item =>
        item.tradeVolumeRatio >=
          settings.minTradeVolumeRatio
      )
      .filter(item =>
        item.dayPosition >=
          settings.minDayPositionRate
      )
      .sort(
        (a, b) =>
          Number(b.hotScore || 0) -
          Number(a.hotScore || 0)
      )
      .slice(
        0,
        settings.maxCandidates
      );

  const output = {
    date: todayKey(),

    updatedAt: nowText(),
    updatedAtMs: Date.now(),

    source:
      data.source ||
      "HOT_CANDIDATES_API",

    count: rows.length,

    rows
  };

  writeJsonFileAtomic(
    HOT_CANDIDATES_FILE,
    output
  );

  console.log(
    `[HOT SCANNER] ${rows.length}개 저장 / ` +
    (
      rows.slice(0, 5)
        .map(item =>
          `${item.name}` +
          `(${item.changeRate.toFixed(2)}%)`
        )
        .join(", ") ||
      "후보 없음"
    )
  );
}

let running = false;
let scannerTimer = null;

async function runOnce() {
  if (running) {
    return;
  }

  running = true;

  try {
    await scanHotCandidates();
  } catch (err) {
    console.error(
      "[HOT SCANNER 오류]",
      err.message
    );
  } finally {
    running = false;
  }
}

function startHotScanner() {
  if (scannerTimer) {
    console.log(
      "[HOT SCANNER] 이미 실행 중"
    );
    return;
  }

  console.log(
    "[HOT SCANNER] 시작 / " +
    `${settings.startTime}~` +
    `${settings.endTime} / ` +
    `${settings.scanLoopMs / 1000}초 주기`
  );

  runOnce();

  scannerTimer = setInterval(
    runOnce,
    settings.scanLoopMs
  );
}

module.exports = {
  startHotScanner,
  runHotScannerOnce: runOnce
};
