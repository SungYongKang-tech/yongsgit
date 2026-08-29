const fs = require("fs");
const path = require("path");

// MASTER 원장과 CORE/VOLUME 병합저장이 같은 잠금을 공유해
// OPEN/WAVE/FAST의 자금 변경과 paper-state-core.json 저장 충돌을 방지한다.
const portfolioManager = require("./portfolio-manager");

const STATE_FILE = path.join(__dirname, "paper-state-core.json");
const AUTO_TRADER_LOCK_FILE = path.join(__dirname, ".auto-trader-core.lock");
const MANUAL_SELL_REQUEST_DIR = path.join(__dirname, "manual-sell-requests");
const MANUAL_SELL_RESULT_DIR = path.join(__dirname, "manual-sell-results");
const MANUAL_SELL_REQUEST_TTL_MS = 90 * 1000;

// 전량매도 성공 직후 다른 루프가 오래된 상태를 다시 저장하더라도
// 같은 보유포지션을 재매도하지 않도록 프로세스 메모리에도 완료키를 유지한다.
// 종목이 아니라 포지션 기준이므로 손절 후 적법한 당일 재진입 매도는 허용된다.
const completedFullSellKeys = new Set();

// loadState()에서 읽은 원본 스냅샷을 직렬화 대상에서 제외해 보관한다.
// 저장 직전에 디스크 최신본과 3방향 비교하여 오래된 전체 상태가
// 신규 보유종목·거래로그·현금을 덮어쓰는 것을 방지한다.
const STATE_META = Symbol("stateMeta");


for (const dir of [MANUAL_SELL_REQUEST_DIR, MANUAL_SELL_RESULT_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
const HOT_CANDIDATES_FILE = path.join(__dirname, "hot-candidates.json");
const HOT_HISTORY_FILE = path.join(__dirname, "hot-candidates-history.json");
const OPEN_MARKET_FILE = path.join(__dirname, "open-market.json");
const API_BASE = "http://localhost:3000";

// 느린 전종목 순환검색 중 다른 루프가 오래된 상태를 저장해도
// 장중 시장표본이 한 배치로 되돌아가지 않도록 프로세스 메모리에도 합집합을 유지한다.
const marketTemperatureSampleMemory = {
  date: null,
  rows: new Map()
};

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

function cloneStateValue(value) {
  if (typeof value === "undefined") {
    return undefined;
  }

  return JSON.parse(JSON.stringify(value));
}

function stateValuesEqual(left, right) {
  if (Object.is(left, right)) {
    return true;
  }

  if (
    left === null ||
    right === null ||
    typeof left !== "object" ||
    typeof right !== "object"
  ) {
    return false;
  }

  const leftIsArray = Array.isArray(left);
  const rightIsArray = Array.isArray(right);

  if (leftIsArray !== rightIsArray) {
    return false;
  }

  if (leftIsArray) {
    if (left.length !== right.length) {
      return false;
    }

    for (let index = 0; index < left.length; index++) {
      if (!stateValuesEqual(left[index], right[index])) {
        return false;
      }
    }

    return true;
  }

  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);

  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  for (const key of leftKeys) {
    if (
      !Object.prototype.hasOwnProperty.call(right, key) ||
      !stateValuesEqual(left[key], right[key])
    ) {
      return false;
    }
  }

  return true;
}

function isPlainStateObject(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function attachStateMeta(state, snapshot = state) {
  if (!state || typeof state !== "object") {
    return state;
  }

  Object.defineProperty(state, STATE_META, {
    value: {
      snapshot: cloneStateValue(snapshot),
      loadedAtMs: Date.now()
    },
    enumerable: false,
    configurable: true,
    writable: true
  });

  return state;
}

function mergeThreeWayStateValue(base, local, latest, path = "") {
  if (stateValuesEqual(local, base)) {
    return cloneStateValue(latest);
  }

  if (stateValuesEqual(latest, base)) {
    return cloneStateValue(local);
  }

  if (
    isPlainStateObject(base) ||
    isPlainStateObject(local) ||
    isPlainStateObject(latest)
  ) {
    const baseObject = isPlainStateObject(base) ? base : {};
    const localObject = isPlainStateObject(local) ? local : {};
    const latestObject = isPlainStateObject(latest) ? latest : {};
    const merged = {};
    const keys = new Set([
      ...Object.keys(baseObject),
      ...Object.keys(localObject),
      ...Object.keys(latestObject)
    ]);

    for (const key of keys) {
      const childPath = path ? `${path}.${key}` : key;
      const value = mergeThreeWayStateValue(
        baseObject[key],
        localObject[key],
        latestObject[key],
        childPath
      );

      if (typeof value !== "undefined") {
        merged[key] = value;
      }
    }

    return merged;
  }

  // 둘 다 같은 필드를 바꾼 경우 디스크 최신 현금을 우선한다.
  // 주문 API나 다른 전략이 더 늦게 반영한 잔액을 되돌리지 않기 위함이다.
  if (path === "totalCash") {
    return cloneStateValue(latest);
  }

  // 나머지는 이 작업이 명시적으로 만든 변경을 유지한다.
  return cloneStateValue(local);
}

function mergeStateSetArray(baseRows, localRows, latestRows) {
  const baseSet = new Set(Array.isArray(baseRows) ? baseRows.map(String) : []);
  const localSet = new Set(Array.isArray(localRows) ? localRows.map(String) : []);
  const latestSet = new Set(Array.isArray(latestRows) ? latestRows.map(String) : []);
  const merged = new Set(baseSet);

  // 디스크 최신 변경을 먼저 반영한 뒤 현재 작업 변경을 적용한다.
  for (const value of baseSet) {
    if (!latestSet.has(value)) merged.delete(value);
  }
  for (const value of latestSet) merged.add(value);

  for (const value of baseSet) {
    if (!localSet.has(value)) merged.delete(value);
  }
  for (const value of localSet) merged.add(value);

  return Array.from(merged);
}

function getStateTradeLogKey(log = {}) {
  if (log.executionId) {
    return `EXECUTION|${String(log.executionId)}`;
  }

  return [
    log.date || "",
    log.type || "",
    normalizeTradeCode(log.code),
    log.positionId || "",
    Number(log.timestampMs || 0),
    Number(log.buyTime || log.buyTimeMs || 0),
    Number(log.qty || 0),
    Number(log.sellPrice || log.buyPrice || log.price || 0),
    Number(log.profit || 0)
  ].join("|");
}

function mergeAppendOnlyStateRows(latestRows, localRows, makeKey) {
  const merged = [];
  const seen = new Set();

  for (const row of [
    ...(Array.isArray(latestRows) ? latestRows : []),
    ...(Array.isArray(localRows) ? localRows : [])
  ]) {
    const key = makeKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(cloneStateValue(row));
  }

  return merged;
}

function getStateHoldingKey(holding = {}) {
  return (
    holding.positionId ||
    `${String(holding.strategyGroup || "-").toUpperCase()}_` +
    `${normalizeTradeCode(holding.code)}_` +
    `${getHoldingPositionToken(holding)}`
  );
}

function isCompletedStateHolding(holding, completedKeys) {
  const normalizedCode = normalizeTradeCode(holding?.code);
  const positionToken = getHoldingPositionToken(holding);

  return completedKeys.some(key => {
    const text = String(key || "");
    return (
      text.includes(`_${normalizedCode}_`) &&
      text.endsWith(`_${positionToken}`)
    );
  });
}

function mergeStateHoldings(
  baseRows,
  localRows,
  latestRows,
  completedKeys
) {
  const makeMap = rows => new Map(
    (Array.isArray(rows) ? rows : []).map(row => [
      getStateHoldingKey(row),
      row
    ])
  );

  const baseMap = makeMap(baseRows);
  const localMap = makeMap(localRows);
  const latestMap = makeMap(latestRows);
  const keys = new Set([
    ...baseMap.keys(),
    ...localMap.keys(),
    ...latestMap.keys()
  ]);
  const merged = [];

  for (const key of keys) {
    const base = baseMap.get(key);
    const local = localMap.get(key);
    const latest = latestMap.get(key);
    let holding = null;

    if (!base) {
      // 서로 다른 작업이 새로 만든 포지션은 모두 보존한다.
      if (local && latest) {
        holding = mergeThreeWayStateValue({}, local, latest, `holdings.${key}`);
      } else {
        holding = cloneStateValue(local || latest);
      }
    } else if (!latest) {
      // 디스크 최신본에서 제거된 기존 포지션을 다시 살리지 않는다.
      holding = null;
    } else if (!local) {
      // 현재 작업의 전량매도만 완료키가 있을 때 제거한다.
      holding = isCompletedStateHolding(base, completedKeys)
        ? null
        : cloneStateValue(latest);
    } else {
      holding = mergeThreeWayStateValue(
        base,
        local,
        latest,
        `holdings.${key}`
      );
    }

    if (
      holding &&
      !isCompletedStateHolding(holding, completedKeys)
    ) {
      merged.push(holding);
    }
  }

  return merged;
}

function mergeMarketTemperatureSamples(base, local, latest) {
  const merged = mergeThreeWayStateValue(
    base,
    local,
    latest,
    "marketTemperatureSamples"
  ) || {};
  const rowMap = new Map();

  for (const row of [
    ...(Array.isArray(latest?.rows) ? latest.rows : []),
    ...(Array.isArray(local?.rows) ? local.rows : [])
  ]) {
    const code = normalizeTradeCode(row?.code);
    if (!/^\d{6}$/.test(code)) continue;
    const previous = rowMap.get(code);
    if (
      !previous ||
      Number(row?.observedAtMs || 0) >=
        Number(previous?.observedAtMs || 0)
    ) {
      rowMap.set(code, cloneStateValue({ ...row, code }));
    }
  }

  merged.rows = Array.from(rowMap.values())
    .sort((a, b) => Number(b.observedAtMs || 0) - Number(a.observedAtMs || 0))
    .slice(0, Number(settings.marketTemperatureSampleMaxCount || 1000));

  return merged;
}

function mergeConcurrentState(base, local, latest) {
  const merged = mergeThreeWayStateValue(base, local, latest) || {};

  merged.completedFullSellCodes = Array.from(new Set([
    ...(Array.isArray(latest?.completedFullSellCodes)
      ? latest.completedFullSellCodes.map(String)
      : []),
    ...(Array.isArray(local?.completedFullSellCodes)
      ? local.completedFullSellCodes.map(String)
      : [])
  ]));

  merged.tradeLogs = mergeAppendOnlyStateRows(
    latest?.tradeLogs,
    local?.tradeLogs,
    getStateTradeLogKey
  );

  merged.virtualResults = mergeAppendOnlyStateRows(
    latest?.virtualResults,
    local?.virtualResults,
    row => [
      row?.date || "",
      row?.type || "",
      normalizeTradeCode(row?.code),
      Number(row?.timestampMs || row?.timeMs || 0),
      Number(row?.price || 0)
    ].join("|")
  );

  merged.pendingBuyCodes = mergeStateSetArray(
    base?.pendingBuyCodes,
    local?.pendingBuyCodes,
    latest?.pendingBuyCodes
  );
  merged.pendingSellCodes = mergeStateSetArray(
    base?.pendingSellCodes,
    local?.pendingSellCodes,
    latest?.pendingSellCodes
  );

  merged.holdings = mergeStateHoldings(
    base?.holdings,
    local?.holdings,
    latest?.holdings,
    merged.completedFullSellCodes
  );

  merged.marketTemperatureSamples = mergeMarketTemperatureSamples(
    base?.marketTemperatureSamples,
    local?.marketTemperatureSamples,
    latest?.marketTemperatureSamples
  );

  return merged;
}

function replaceStateContents(target, source) {
  for (const key of Object.keys(target || {})) {
    if (!Object.prototype.hasOwnProperty.call(source || {}, key)) {
      delete target[key];
    }
  }

  Object.assign(target, source || {});
  return target;
}

let autoTraderLockOwned = false;
let autoTraderLockCleanupRegistered = false;

function isProcessAlive(pid) {
  const normalizedPid = Number(pid || 0);

  if (!Number.isInteger(normalizedPid) || normalizedPid <= 0) {
    return false;
  }

  try {
    process.kill(normalizedPid, 0);
    return true;
  } catch (err) {
    return err?.code === "EPERM";
  }
}

function releaseAutoTraderLock() {
  if (!autoTraderLockOwned) {
    return;
  }

  try {
    const currentLock = readJsonFileSafe(
      AUTO_TRADER_LOCK_FILE,
      null,
      1
    );

    if (Number(currentLock?.pid || 0) === process.pid) {
      fs.unlinkSync(AUTO_TRADER_LOCK_FILE);
    }
  } catch (_) {
    // 종료 중 잠금파일이 이미 정리됐거나 읽을 수 없으면 그대로 종료한다.
  } finally {
    autoTraderLockOwned = false;
  }
}

function acquireAutoTraderLock() {
  if (autoTraderLockOwned) {
    return true;
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(AUTO_TRADER_LOCK_FILE, "wx");
      try {
        fs.writeFileSync(
          fd,
          JSON.stringify({
            pid: process.pid,
            startedAtMs: Date.now(),
            startedAt: new Date().toISOString(),
            stateFile: STATE_FILE
          }, null, 2),
          "utf8"
        );
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }

      autoTraderLockOwned = true;

      if (!autoTraderLockCleanupRegistered) {
        process.once("exit", releaseAutoTraderLock);
        autoTraderLockCleanupRegistered = true;
      }

      console.log(
        `[START LOCK] CORE/VOLUME 단일 실행 확보 / PID ${process.pid}`
      );
      return true;
    } catch (err) {
      if (err?.code !== "EEXIST") {
        console.error(
          `[START LOCK 오류] ${err?.message || err}`
        );
        return false;
      }

      let existingLock = null;
      try {
        existingLock = readJsonFileSafe(
          AUTO_TRADER_LOCK_FILE,
          null,
          5
        );
      } catch (_) {
        existingLock = null;
      }

      const existingPid = Number(existingLock?.pid || 0);

      if (!existingPid) {
        try {
          const lockAgeMs = Date.now() - fs.statSync(AUTO_TRADER_LOCK_FILE).mtimeMs;
          if (lockAgeMs >= 0 && lockAgeMs < 10000) {
            console.log(
              "[START LOCK 차단] 다른 프로세스가 단일 실행 잠금을 생성 중입니다."
            );
            return false;
          }
        } catch (_) {
          // 다음 재시도에서 잠금 생성 또는 정리 여부를 다시 확인한다.
        }
      }

      if (existingPid === process.pid) {
        autoTraderLockOwned = true;
        return true;
      }

      if (isProcessAlive(existingPid)) {
        console.log(
          `[START LOCK 차단] CORE/VOLUME 자동매매가 다른 프로세스에서 ` +
          `실행 중 / PID ${existingPid}`
        );
        return false;
      }

      try {
        fs.unlinkSync(AUTO_TRADER_LOCK_FILE);
        console.log(
          `[START LOCK 정리] 종료된 PID ${existingPid || "UNKNOWN"}의 ` +
          `잠금 제거`
        );
      } catch (unlinkError) {
        console.error(
          `[START LOCK 정리실패] ${unlinkError?.message || unlinkError}`
        );
        return false;
      }
    }
  }

  return false;
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

    const finalRows =
      Array.isArray(data.rows)
        ? data.rows
        : [];
    const earlyRows = Array.isArray(data.earlyRows) ? data.earlyRows : [];
    const rowMap = new Map();
    for (const item of earlyRows) {
      const code = String(item.code || "").padStart(6, "0");
      if (/^\d{6}$/.test(code)) rowMap.set(code, { ...item, candidateSource: "HOT_EARLY" });
    }
    for (const item of finalRows) {
      const code = String(item.code || "").padStart(6, "0");
      if (/^\d{6}$/.test(code)) rowMap.set(code, { ...item, candidateSource: "HOT" });
    }
    const rows = Array.from(rowMap.values());

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

        const detectedAtMs = Number(item.hotDetectedAtMs || 0);
        const rowAgeMs = detectedAtMs > 0
          ? Date.now() - detectedAtMs
          : 0;

        return (
          code &&
          price > 0 &&
          (
            !detectedAtMs ||
            (rowAgeMs >= 0 && rowAgeMs <= settings.hotCandidateRowMaxAgeMs)
          )
        );
      })
      .filter(item =>
        !isExcludedStock(item)
      )
      .filter(item => {
        const required = item.candidateSource === "HOT_EARLY"
          ? Number(settings.hotEarlyCandidateMinDiscoverScore || 6)
          : Number(settings.hotCandidateMinDiscoverScore || 7);
        return Number(item.discoverScore || 0) >= required;
      })
      .sort(
        (a, b) =>
          (
            Number(b.openMomentumScore || 0) +
            Number(b.sectorPowerScore || 0)
          ) -
          (
            Number(a.openMomentumScore || 0) +
            Number(a.sectorPowerScore || 0)
          ) ||
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

        candidateSource: item.candidateSource === "HOT_EARLY" ? "HOT_EARLY" : "HOT"
      }));
  } catch (err) {
    console.error(
      "[HOT 후보 읽기 오류]",
      err.message
    );

    return [];
  }
}

function loadRecentHotHistoryCandidates() {
  if (!settings.hotScannerEnabled || !fs.existsSync(HOT_HISTORY_FILE)) {
    return [];
  }

  try {
    const history = readJsonFileSafe(
      HOT_HISTORY_FILE,
      { date: todayKey(), detected: {} }
    );

    if (!history || history.date !== todayKey()) {
      return [];
    }

    const now = Date.now();
    const detected = history.detected && typeof history.detected === "object"
      ? Object.values(history.detected)
      : [];

    return detected
      .filter(row => {
        const lastDetectedAtMs = Number(row.lastDetectedAtMs || 0);
        return (
          lastDetectedAtMs > 0 &&
          now - lastDetectedAtMs >= 0 &&
          now - lastDetectedAtMs <= Number(settings.hotHistoryActiveWindowMs || 0)
        );
      })
      .map(row => {
        const latest = row.latestSnapshot || {};
        const first = row.firstSnapshot || {};
        const code = String(row.code || latest.code || "").padStart(6, "0");

        return {
          ...latest,
          code,
          name: latest.name || row.name || code,
          currentPrice: Number(latest.currentPrice || latest.price || 0),
          price: Number(latest.currentPrice || latest.price || 0),
          discoverScore: Number(
            latest.discoverScore ?? row.latestDiscoverScore ?? 0
          ),
          candidateSource: "HOT_HISTORY",
          hotFirstDetectedAtMs: Number(row.firstDetectedAtMs || 0),
          hotLastDetectedAtMs: Number(row.lastDetectedAtMs || 0),
          firstChangeRate: Number(
            row.firstChangeRate ?? first.changeRate ?? latest.changeRate ?? 0
          ),
          firstHotPrice: Number(
            row.firstPrice ?? first.currentPrice ?? first.price ?? 0
          ),
          hotDetectionCount: Number(row.detectionCount || 0),
          maxHotScore: Number(row.maxHotScore || latest.hotScore || 0),
          maxMomentumScore: Number(
            row.maxMomentumScore || latest.openMomentumScore || 0
          )
        };
      })
      .filter(item =>
        /^\d{6}$/.test(item.code) &&
        Number(item.currentPrice || 0) > 0 &&
        !isExcludedStock(item)
      )
      .sort((a, b) =>
        Number(b.hotLastDetectedAtMs || 0) - Number(a.hotLastDetectedAtMs || 0) ||
        Number(b.maxMomentumScore || 0) - Number(a.maxMomentumScore || 0) ||
        Number(b.maxHotScore || 0) - Number(a.maxHotScore || 0)
      )
      .slice(0, Number(settings.hotHistoryCandidateMaxCount || 60));
  } catch (err) {
    console.error("[HOT 누적후보 읽기 오류]", err.message);
    return [];
  }
}

function mergeHotObservationCandidates(
  currentHotCandidates = [],
  historyCandidates = []
) {
  const map = new Map();

  for (const item of historyCandidates) {
    const code = String(item.code || "").padStart(6, "0");
    if (!/^\d{6}$/.test(code)) continue;
    map.set(code, { ...item, code });
  }

  for (const item of currentHotCandidates) {
    const code = String(item.code || "").padStart(6, "0");
    if (!/^\d{6}$/.test(code)) continue;

    const history = map.get(code) || {};
    map.set(code, {
      ...history,
      ...item,
      code,
      candidateSource:
        item.candidateSource === "HOT_EARLY"
          ? "HOT_EARLY"
          : "HOT",
      hotFirstDetectedAtMs: Number(
        history.hotFirstDetectedAtMs || item.hotFirstDetectedAtMs || item.hotDetectedAtMs || 0
      ),
      hotLastDetectedAtMs: Number(
        item.hotDetectedAtMs || history.hotLastDetectedAtMs || 0
      ),
      firstChangeRate: Number(
        history.firstChangeRate ?? item.firstChangeRate ?? item.changeRate ?? 0
      ),
      firstHotPrice: Number(
        history.firstHotPrice ?? item.firstHotPrice ?? item.currentPrice ?? item.price ?? 0
      ),
      raw: {
        ...(history.raw || {}),
        ...(item.raw || {})
      }
    });
  }

  return Array.from(map.values());
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
      ["HOT", "HOT_EARLY"].includes(a.candidateSource)
        ? 1
        : 0;

    const bHot =
      ["HOT", "HOT_EARLY"].includes(b.candidateSource)
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
      (
        Number(b.openMomentumScore || 0) +
        Number(b.sectorPowerScore || 0)
      ) -
      (
        Number(a.openMomentumScore || 0) +
        Number(a.sectorPowerScore || 0)
      ) ||
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
// 종목당 투자비율 (당일 최초자산 기준)
buyAssetRatio: 0.10,

  // 손실방어: 동시 보유와 하루 진입횟수를 별도로 제한한다.
  coreMaxHoldingCount: 5,
  coreMaxDailyBuyCount: 5,
  coreMaxChangeRate: 8.0,
  coreMinTradeVolumeRatio: 85,
  coreMinDayPositionRate: 60,
  coreMaxDayPositionRate: 92,

  // CORE 진입 품질 방어: 30초 확인에서 가격이 하락 중이거나 후보강도가 약하면 차단
  coreConfirmMinPriceRiseRate: 0.0,
  coreMinCandidateStrengthScore: 55,
  coreTrendObservationMinCount: 3,
  // 실제 BUY·후보재평가 시작 간격이 약 60초까지 늘어나도 3회 표본을 유지한다.
  coreTrendObservationWindowMs: 180 * 1000,
  coreTrendMinElapsedMs: 60 * 1000,
  coreTrendMinPricePersistence: 0.50,
  coreTrendMaxDayPositionDrop: 7,
  coreTrendMinVolumeRetentionRate: 0.75,

  // CORE 안정형 후보 보호: 상승률과 거래량이 동시에 과열된 종목은 VOLUME 성격으로 보고 차단
  coreOverheatBlockEnabled: true,
  coreOverheatMinVolumeRatio: 400,
  coreOverheatMinChangeRate: 5.5,

  volumeEnabled: true,
  volumeStartTime: "09:10",
volumeEndTime: "13:30",

// OPEN 우선운영: OPEN 매수 완료 전에는 최대 09:25까지
// CORE/VOLUME 후보 분석은 계속하고 실제 신규주문과 스위칭만 보류
openPriorityBuyBlockEnabled: true,
openPriorityBuyBlockEndTime: "09:25",
  volumeMaxHoldingCount: 5,
  volumeMaxDailyBuyCount: 5,
  volumeMinChangeRate: 0.8,
  volumeMaxChangeRate: 8.0,
  volumeMinTradeVolumeRatio: 100,
  volumeMinDayPositionRate: 65,
  volumeMaxDayPositionRate: 95,

  // 모든 VOLUME 매수에 후보강도 하한을 적용한다.
  volumeMinCandidateStrengthScore: 60,

  // VOLUME 5.5% 이상 추격구간은 후보강도 70점 이상만 허용
  volumeLateChaseBlockEnabled: true,
  volumeLateChaseMinChangeRate: 5.5,
  volumeLateChaseMinCandidateStrengthScore: 70,
  volumeLateChaseMinDayPositionRate: 80,

  // 저유동성 종목 매수 차단
  // 거래량비율이 높아도 실제 누적 거래량·거래대금이 작으면 체결 공백과 슬리피지가 커질 수 있다.
  liquidityFilterEnabled: true,
  coreMinAbsoluteVolume: 50000,
  volumeMinAbsoluteVolume: 100000,
  coreMinTradeAmount: 100000000,
  volumeMinTradeAmount: 100000000,

  // 고가·중고가 종목 보완 통과 기준
  // 기본 거래량에는 못 미쳐도 거래대금이 충분한 고가주는 더 적은 주식수로도 유동성을 인정한다.
  coreAltMinAbsoluteVolume: 5000,
  coreAltMinTradeAmount: 200000000,
  volumeAltMinAbsoluteVolume: 20000,
  volumeAltMinTradeAmount: 500000000,

  stopLossRate: -1.5,
  firstTakeProfitRate: 4.0,
  firstTakeProfitSellRatio: 0.3,
  trailingStartRate: 3.0,
  trailingStopRate: 1.0,

  coreStopLossRate: -1.2,
coreFirstTakeProfitRate: 4.0,
coreTrailingStartRate: 3.0,
coreTrailingStopRate: 1.0,

volumeStopLossRate: -1.0,
volumeFirstTakeProfitRate: 3.0,
volumeTrailingStartRate: 2.5,
volumeTrailingStopRate: 0.8,

// VOLUME 초반 과열 매수 차단
// 거래량과 상승률은 높은데 고가권을 유지하지 못하면 매수하지 않는다.
volumeOverheatBlockEnabled: true,
volumeOverheatMinVolumeRatio: 300,
volumeOverheatMinChangeRate: 5.0,
volumeOverheatMinDayPositionRate: 60,

// 거래량이 비정상적으로 폭증한 종목은 상승률·위치와 관계없이 추격매수 차단
volumeExtremeOverheatBlockEnabled: true,
volumeExtremeOverheatMinVolumeRatio: 1000,

// VOLUME 30초 강화확인: 단순 횡보가 아니라 실제 가격 상승 지속을 요구
volumeConfirmMinPriceRiseRate: 0.10,
volumeConfirmMaxPriceRiseRate: 1.20,
volumeConfirmMaxDayPositionDrop: 5,
volumeEarlyMomentumEnabled: true,
volumeEarlyMomentumMinObservationCount: 3,
volumeEarlyMomentumMinElapsedMs: 30 * 1000,
volumeEarlyMomentumMinPricePersistence: 0.67,

// HOT의 최근 60초 가격표본까지 가져와 급락 뒤 한 틱 반등을 신규 상승으로 오인하지 않는다.
volumeRecentHighGuardEnabled: true,
volumeRecentHighWindowMs: 90 * 1000,
volumeRecentHighMinSampleCount: 3,
volumeRecentHighMaxEntryDrawdownRate: -1.25,

// VOLUME 후반구간: 급등 직후 추격하지 않고 눌림 후 재상승할 때만 진입
volumePullbackEntryEnabled: true,
volumePullbackMinRate: -0.25,
volumePullbackMaxRate: -1.50,
volumeReboundMinRate: 0.15,

// VOLUME 진입신호 유효시간
// EARLY_MOMENTUM/REBOUND가 한 번 통과한 직후 paperBuy()가 현재가를 재조회하면서
// 같은 판단함수를 다시 호출해도 신호가 즉시 사라지지 않게 한다.
// 단, 확인가격 아래로 밀리거나 최근 2개 가격변화 중 -0.30% 이하 급락이 있으면 즉시 무효화한다.
volumeEntryConfirmHoldMs: 45 * 1000,
volumeEntryConfirmMinPriceHoldRate: 0.0,
volumeEntryConfirmMaxStepDropRate: -0.30,
volumeEntryConfirmRecentTransitionCount: 2,

volumePullbackMaxWaitMs: 180 * 1000,
volumePullbackMinVolumeRetentionRate: 0.70,
volumePullbackMaxDayPositionDrop: 10,

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

  // 동일 종목의 연속 중복진입만 제한한다. 다른 종목 매수는 막지 않는다.
  coreBuyCooldownMinutes: 10,
  volumeBuyCooldownMinutes: 10,

  // 손실매도 직후 동일 종목 재진입만 제한한다.
  // 전체 연속손실 방어는 maxDailyLossExitCount가 담당한다.
  lossExitBuyCooldownMinutes: 15,
  maxDailyLossExitCount: 4,

  // 손절 후 같은 종목이 실제로 다시 강해졌을 때 하루 1회만 재진입한다.
  // 전일 보유종목 손절은 횟수 제한에서 제외하고 일일 금액손실에는 계속 반영한다.
  sameDayReentryEnabled: true,
  sameDayReentryMaxCount: 1,
  sameDayReentryCooldownMinutes: 20,
  sameDayReentryMinStrengthImprovement: 5,
  sameDayReentryMinRecoveryFromSellRate: 0.30,

  minHoldMinutes: 3,

candidateConfirmWaitMs: 30 * 1000,
candidateHistoryMaxAgeMs: 30 * 60 * 1000,

// 후보 강화 목록
candidateWatchMaxCount: 15,
candidateWatchMaxAgeMs: 30 * 60 * 1000,

candidateWatchLoopMs: 30 * 1000,
candidateWatchPriceDelayMs: 350,
// 후보재평가가 BUY 전체검색을 장시간 밀지 않도록 1회 실시간 재조회 종목수를 제한한다.
// 같은 종목이 CORE/VOLUME 양쪽에 있으면 종목 1개로 계산하고 시세도 1회만 조회한다.
candidateWatchEvalMaxCodeCount: 10,
// 느린 API가 이어져도 후보재평가 한 회차가 BUY 주기를 장시간 점유하지 않게 한다.
candidateWatchMaxRunMs: 20 * 1000,

// 매수 직전 현재가는 최근 10초 이내 값만 허용한다.
// API 장애 때 반환된 오래된 캐시로 신규매수하는 것을 방지한다.
buyQuoteMaxAgeMs: 10 * 1000,

// HOT Scanner 후보
hotScannerEnabled: true,

// HOT 파일이 이 시간보다 오래됐으면 사용하지 않음
hotCandidateFileMaxAgeMs: 90 * 1000,

// 빈 순위 결과에서 유지된 오래된 행을 새 관찰값으로 오인하지 않도록 행 자체의 탐지시각도 확인
hotCandidateRowMaxAgeMs: 90 * 1000,

// CORE/VOLUME에 넘길 HOT 후보 최대 수
hotCandidateMaxCount: 30,

// HOT 후보 최소 발견점수
hotCandidateMinDiscoverScore: 7,
hotEarlyCandidateMinDiscoverScore: 6,

// HOT 누적이력 중 최근 활성후보를 후보강화 목록에 연결한다.
hotHistoryActiveWindowMs: 5 * 60 * 1000,
hotHistoryCandidateMaxCount: 60,

// OPEN 우선시간에도 HOT 후보 관찰과 전체검색은 계속하고 주문만 보류한다.
openPriorityHotObservationEnabled: true,
openPriorityObservationMinIntervalMs: 10 * 1000,

// 상승초기에 발견된 주도주는 상한 초과 즉시 폐기하지 않고 눌림·재상승을 관찰한다.
leaderWatchEnabled: true,
leaderWatchFirstMaxChangeRate: 5.5,
leaderWatchCurrentMaxChangeRate: 12.0,
leaderWatchMinDiscoverScore: 7,
leaderWatchMinVolumeRatio: 140,
leaderWatchMinDayPositionRate: 70,
leaderWatchMinHotScore: 70,
// 09:25 OPEN 인계 전 발견된 주도주가 인계 직후 만료되지 않도록 20분 유지한다.
// 실제 진입은 기존처럼 눌림·재상승(REBOUND) 확인을 반드시 통과해야 한다.
leaderWatchMaxAgeMs: 20 * 60 * 1000,
leaderWatchMinBuyStrengthScore: 75,

// 시장온도는 임의의 한 배치가 아니라 최근 순환검색 누적표본으로 계산한다.
marketTemperatureMinSampleCount: 120,
// 120개 완성 전에도 40개 이상 확보되면 장전점수 상한의 보수적 시장판단으로 선별매수 허용
marketTemperatureEarlyTradeMinSampleCount: 40,
marketTemperatureSegmentMinSampleCount: 30,
marketTemperatureSampleMaxCount: 1000,
// 실제 BUY 순환이 20분 이상 지연될 수 있으므로 15분 만료로 표본이 리셋되지 않게 한다.
marketTemperatureSampleMaxAgeMs: 45 * 60 * 1000,
marketTemperatureAccumulatingBuyBlocked: true,
marketTemperatureAccumulatingFallbackScore: 30,
// 한 번 완성된 120개 시장표본은 순환 재수집 중 최대 30분까지 사용한다.
marketTemperatureLastReadyMaxAgeMs: 30 * 60 * 1000,

// 10초 매도루프가 방금 끝난 경우 매수·후보재평가 직전 중복 매도점검을 생략한다.
sellPriorityFreshMs: 8 * 1000,


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

// 전략별 본전방어: CORE는 기존 유지, VOLUME은 단기 추세 실패를 더 일찍 보호
coreBreakEvenStartRate: 2.0,
coreBreakEvenProtectRate: 0.4,
// CORE는 점수·당일위치가 살아 있으면 단순 수익률 되돌림만으로 본전청산하지 않는다.
coreBreakEvenWeakMaxHoldingScore: 80,
coreBreakEvenWeakMaxDayPositionRate: 60,
coreBreakEvenWeakMinScoreDrop: -10,
volumeBreakEvenStartRate: 1.5,
volumeBreakEvenProtectRate: 0.1,

  dailyLossLimitRate: 0.01,

  endSellTime: "15:10",
endSellOnlyPositive: true,

coreEndSellOnlyPositive: true,
volumeEndSellOnlyPositive: false,

// 보유종목 자동 스위칭
switchEnabled: false,

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
cautionVolumeVolumeAdd: 10,
cautionDiscoverScoreAdd: 1,

// CORE 거래량 기준 허용오차. 시장조정 기준보다 최대 3%p 부족해도 통과
coreVolumeRatioTolerance: 0,

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
 * - 09:25 이전
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

  // OPEN이 실제 매수로 완료됐거나 미매수 종료가 확정되면
  // 09:25를 기다리지 않고 CORE/VOLUME 주문을 허용한다.
  return !(
    state.openCompleted === true ||
    state.openSkipped === true
  );
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
    return attachStateMeta({
      holdings: [],
      tradeLogs: [],
      virtualResults: [],

      pendingBuyCodes: [],
      pendingSellCodes: [],
      completedFullSellCodes: [],

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
    });
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

  if (!Array.isArray(state.completedFullSellCodes)) {
    state.completedFullSellCodes = [];
  }

  for (const key of state.completedFullSellCodes) {
    completedFullSellKeys.add(String(key || ""));
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

  return attachStateMeta(state);
}

function saveState(state) {
  // 모든 CORE/VOLUME 상태 저장도 MASTER 공용 잠금을 사용한다.
  // server.js의 주문 API는 withMasterTransaction()으로만 원장을 변경하므로
  // 같은 잠금을 중첩 획득하지 않고 전략 간 덮어쓰기를 방지한다.
  portfolioManager.acquireMasterLock({ timeoutMs: 3000, staleMs: 15000 });

  try {
    const meta = state?.[STATE_META] || null;
    const base = meta?.snapshot || null;
    let stateToSave = state;

    if (
      base &&
      fs.existsSync(STATE_FILE)
    ) {
      const latest = readJsonFileSafe(STATE_FILE, null);

      if (
        latest &&
        !stateValuesEqual(base, latest)
      ) {
        stateToSave = mergeConcurrentState(
          base,
          state,
          latest
        );

        console.log(
          `[STATE 병합저장] 디스크 최신 변경 보존 / ` +
          `보유 ${Number(latest.holdings?.length || 0)}→` +
          `${Number(stateToSave.holdings?.length || 0)}개 / ` +
          `거래로그 ${Number(latest.tradeLogs?.length || 0)}→` +
          `${Number(stateToSave.tradeLogs?.length || 0)}건 / ` +
          `writer ${process.pid}`
        );
      }
    }

    replaceStateContents(state, stateToSave);
    writeJsonFileAtomic(STATE_FILE, state);
    attachStateMeta(state);

    return state;
  } finally {
    portfolioManager.releaseMasterLock();
  }
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

async function fetchPrice(code, source = "core") {
  const data = await fetchJson(
    `${API_BASE}/api/price?code=${encodeURIComponent(code)}` +
    `&source=${encodeURIComponent(source)}`
  );

  return Math.abs(Number(
    data.currentPrice ||
    data.price ||
    data.curPrice ||
    data.raw?.cur_prc ||
    0
  ));
}

async function fetchCandidateRealtime(code, fallback = {}, source = "core") {
  const data = await fetchJson(
    `${API_BASE}/api/price?code=${encodeURIComponent(code)}` +
    `&source=${encodeURIComponent(source)}`
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

  const quoteObservedAtMs = Number(
    data.quoteObservedAtMs ||
    data.cachedAtMs ||
    0
  );
  const quoteAgeMs = quoteObservedAtMs > 0
    ? Math.max(0, Date.now() - quoteObservedAtMs)
    : Number(data.cacheAgeMs || 0);
  const normalizedSource = String(source || "core").toLowerCase();
  const isBuyQuote = normalizedSource === "core" || normalizedSource === "volume";

  if (
    isBuyQuote &&
    quoteAgeMs > Number(settings.buyQuoteMaxAgeMs || 10000)
  ) {
    throw new Error(
      `매수시세 오래됨 ${Math.round(quoteAgeMs / 1000)}초 / ` +
      `허용 ${Math.round(Number(settings.buyQuoteMaxAgeMs || 10000) / 1000)}초`
    );
  }

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
    requestSource: normalizedSource,
    quoteObservedAtMs,
    quoteAgeMs,
    isCached: data.isCached === true,
    isStaleFallback: data.isStaleFallback === true,

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
    /KODEX|TIGER|ACE|SOL|HANARO|KOSEF|KBSTAR|ARIRANG|ETF|ETN|레버리지|인버스|스팩|SPAC/i.test(name) ||
    /^(?:RISE|PLUS|TIMEFOLIO|KINDEX|KOACT)(?:\s|$)/i.test(name)
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

function classifyMarketTemperatureScore(scoreValue) {
  const score = Number(scoreValue || 0);

  if (score >= 70) return { level: "HOT", label: "강세" };
  if (score >= 50) return { level: "NORMAL", label: "보통" };
  if (score >= 35) return { level: "CAUTION", label: "주의" };
  return { level: "COLD", label: "약세" };
}

function normalizeMarketSegment(item = {}) {
  const raw = String(
    item.marketSegment ??
    item.market ??
    item.marketType ??
    item.marketName ??
    item.exchange ??
    item.raw?.market ??
    ""
  ).trim().toUpperCase();

  if (raw.includes("KOSDAQ") || raw.includes("코스닥")) return "KOSDAQ";
  if (raw.includes("KOSPI") || raw.includes("유가증권") || raw.includes("코스피")) {
    return "KOSPI";
  }

  return "ALL";
}

function getPremarketFallbackScore() {
  if (!fs.existsSync(OPEN_MARKET_FILE)) return null;

  try {
    const data = readJsonFileSafe(OPEN_MARKET_FILE, null);
    const date = String(
      data?.date ??
      data?.checkedDate ??
      data?.tradingDate ??
      ""
    ).slice(0, 10);

    if (!date || date !== todayKey()) return null;

    const score = [
      data?.marketScore?.score,
      data?.marketScore,
      data?.market?.score,
      data?.marketCondition?.score,
      data?.score,
      data?.totalScore,
      data?.summary?.score,
      data?.summary?.marketScore
    ]
      .filter(value => value !== null && value !== undefined && value !== "")
      .map(value => Number(value))
      .find(value => Number.isFinite(value));

    if (!Number.isFinite(score)) return null;

    return {
      score: Math.max(0, Math.min(100, score)),
      type: String(
        data?.marketType ??
        data?.type ??
        data?.level ??
        "PREMARKET"
      )
    };
  } catch (err) {
    console.log(`[시장온도 장전자료 제외] ${err.message}`);
    return null;
  }
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

  const { level, label } = classifyMarketTemperatureScore(score);

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

function calculateStableMarketTemperature(
  state,
  latestRows = []
) {
  const now = Date.now();
  const date = todayKey();
  const maxAgeMs = Number(settings.marketTemperatureSampleMaxAgeMs || 0);
  const maxCount = Number(settings.marketTemperatureSampleMaxCount || 1000);
  const minCount = Number(settings.marketTemperatureMinSampleCount || 120);

  if (
    !state.marketTemperatureSamples ||
    state.marketTemperatureSamples.date !== date ||
    !Array.isArray(state.marketTemperatureSamples.rows)
  ) {
    state.marketTemperatureSamples = {
      date,
      updatedAt: null,
      updatedAtMs: 0,
      rows: []
    };
  }

  if (marketTemperatureSampleMemory.date !== date) {
    marketTemperatureSampleMemory.date = date;
    marketTemperatureSampleMemory.rows = new Map();
  }

  const sampleMap = marketTemperatureSampleMemory.rows;

  for (const row of state.marketTemperatureSamples.rows) {
    const observedAtMs = Number(row.observedAtMs || 0);
    const code = String(row.code || "").padStart(6, "0");

    if (
      /^\d{6}$/.test(code) &&
      observedAtMs > 0 &&
      now - observedAtMs >= 0 &&
      (!maxAgeMs || now - observedAtMs <= maxAgeMs)
    ) {
      const previous = sampleMap.get(code);
      if (
        !previous ||
        observedAtMs >= Number(previous.observedAtMs || 0)
      ) {
        sampleMap.set(code, { ...row, code });
      }
    }
  }

  for (const item of latestRows) {
    const code = String(item.code || item.stockCode || item.stk_cd || "")
      .replace(/^A/i, "")
      .padStart(6, "0");
    const changeRate = Number(
      item.changeRate ??
      item.fluctuationRate ??
      item.riseRate ??
      item.rate ??
      item.raw?.flu_rt
    );

    if (!/^\d{6}$/.test(code) || !Number.isFinite(changeRate)) {
      continue;
    }

    sampleMap.set(code, {
      code,
      changeRate,
      tradeVolumeRatio: getTradeVolumeRatio(item),
      marketSegment: normalizeMarketSegment(item),
      observedAtMs: now
    });
  }

  const sampleRows = Array.from(sampleMap.values())
    .filter(row => {
      const observedAtMs = Number(row.observedAtMs || 0);
      return (
        observedAtMs > 0 &&
        now - observedAtMs >= 0 &&
        (!maxAgeMs || now - observedAtMs <= maxAgeMs)
      );
    })
    .sort((a, b) => Number(b.observedAtMs || 0) - Number(a.observedAtMs || 0))
    .slice(0, maxCount);

  marketTemperatureSampleMemory.rows = new Map(
    sampleRows.map(row => [row.code, row])
  );

  state.marketTemperatureSamples = {
    date,
    updatedAt: nowText(),
    updatedAtMs: now,
    rows: sampleRows
  };

  const byMarket = {};
  const segmentMinCount = Number(
    settings.marketTemperatureSegmentMinSampleCount || 30
  );

  for (const segment of ["KOSPI", "KOSDAQ"]) {
    const segmentRows = sampleRows.filter(
      row => normalizeMarketSegment(row) === segment
    );

    if (segmentRows.length < 10) continue;

    byMarket[segment] = {
      ...calculateMarketTemperature(segmentRows),
      marketSegment: segment,
      sampleCount: segmentRows.length,
      sampleMode: segmentRows.length >= segmentMinCount
        ? "SEGMENT_ACCUMULATED"
        : "SEGMENT_ACCUMULATING",
      readyForTrading: segmentRows.length >= segmentMinCount,
      buyBlockedUntilReady: segmentRows.length < segmentMinCount
    };
  }

  if (sampleRows.length < minCount) {
    const lastReadyState = state.lastReadyMarketTemperature || null;
    const lastReadyTemperature = lastReadyState?.temperature || null;
    const lastReadyAtMs = Number(lastReadyState?.updatedAtMs || 0);
    const lastReadyAgeMs = lastReadyAtMs > 0
      ? now - lastReadyAtMs
      : Number.MAX_SAFE_INTEGER;
    const lastReadyMaxAgeMs = Number(
      settings.marketTemperatureLastReadyMaxAgeMs || 0
    );
    const canUseLastReady =
      lastReadyState?.date === date &&
      lastReadyTemperature?.readyForTrading === true &&
      lastReadyAgeMs >= 0 &&
      (!lastReadyMaxAgeMs || lastReadyAgeMs <= lastReadyMaxAgeMs);

    if (canUseLastReady) {
      return {
        ...lastReadyTemperature,
        total: sampleRows.length,
        sampleCount: sampleRows.length,
        sampleMode: "REFRESHING_LAST_READY",
        readyForTrading: true,
        buyBlockedUntilReady: false,
        checkedAt: nowText(),
        checkedDate: date,
        byMarket: lastReadyTemperature.byMarket || byMarket,
        lastReadySampleCount: Number(
          lastReadyTemperature.sampleCount || minCount
        ),
        lastReadyAgeMs,
        reason:
          `시장 누적표본 갱신 ${sampleRows.length}/${minCount}개 / ` +
          `최근 완성값 ${Math.round(lastReadyAgeMs / 60000)}분 전 사용 / ` +
          `신규매수 판단 유지`
      };
    }

    const partial = calculateMarketTemperature(sampleRows);
    const premarket = getPremarketFallbackScore();
    const fallbackScore = premarket
      ? premarket.score
      : Number(settings.marketTemperatureAccumulatingFallbackScore || 30);
    // 표본이 적을 때 상승 후보 중심의 순환배치가 강세로 과대평가되지 않게
    // 장전점수 또는 보수 기본값을 상한으로 사용한다.
    const guardedScore = Math.min(
      Number(partial.score || 50),
      fallbackScore
    );
    const guardedLevel = classifyMarketTemperatureScore(guardedScore);
    const earlyTradeMinCount = Math.max(
      10,
      Math.min(
        minCount,
        Number(settings.marketTemperatureEarlyTradeMinSampleCount || 40)
      )
    );
    const earlyTradingReady = sampleRows.length >= earlyTradeMinCount;

    return {
      ...partial,
      ...guardedLevel,
      score: Number(guardedScore.toFixed(1)),
      total: sampleRows.length,
      sampleCount: sampleRows.length,
      sampleMode: earlyTradingReady
        ? "EARLY_ACCUMULATING"
        : (premarket ? "PREMARKET_FALLBACK" : "ACCUMULATING"),
      readyForTrading: earlyTradingReady,
      buyBlockedUntilReady:
        !earlyTradingReady &&
        settings.marketTemperatureAccumulatingBuyBlocked === true,
      byMarket,
      reason:
        `시장 누적표본 준비 ${sampleRows.length}/${minCount}개 / ` +
        `${premarket ? `장전 ${premarket.type} ${fallbackScore.toFixed(1)}점` : `보수기준 ${fallbackScore.toFixed(1)}점`} / ` +
        (earlyTradingReady
          ? `초기표본 ${earlyTradeMinCount}개 확보 · 보수 선별매수 허용`
          : `초기표본 ${earlyTradeMinCount}개까지 신규매수 대기`)
    };
  }

  const calculated = calculateMarketTemperature(sampleRows);
  const readyTemperature = {
    ...calculated,
    sampleCount: sampleRows.length,
    sampleMode: "ACCUMULATED",
    readyForTrading: true,
    buyBlockedUntilReady: false,
    byMarket,
    reason: `${calculated.reason} / 최근 누적 ${sampleRows.length}개`
  };

  state.lastReadyMarketTemperature = {
    date,
    updatedAt: nowText(),
    updatedAtMs: now,
    temperature: readyTemperature
  };

  return readyTemperature;
}

function getMarketAdjustedBuySettings(
  state,
  strategyGroup,
  item = {}
) {
  const overallMarket = state.marketTemperature || {};
  const marketSegment = normalizeMarketSegment(item);
  const segmentMarket = overallMarket.readyForTrading === true && marketSegment !== "ALL"
    ? overallMarket.byMarket?.[marketSegment]
    : null;
  const market = segmentMarket?.readyForTrading === true
    ? segmentMarket
    : overallMarket;

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
    marketSegment:
      market.marketSegment || marketSegment,

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

  if (market.buyBlockedUntilReady === true) {
    result.buyBlocked = true;
    result.reason =
      `시장표본 준비중 ${Number(market.sampleCount || 0)}/` +
      `${Number(settings.marketTemperatureMinSampleCount || 120)}개 / ` +
      `${market.label || "약세"} ${score.toFixed(1)}점 / 신규매수 대기`;
    return result;
  }

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

  // 섹터 동반강세는 후보 관찰순위에만 최대 5점 반영한다.
  // 발견점수·거래량·가격지속 같은 매수 필수조건은 그대로 유지된다.
  const sectorPart = Math.max(
    0,
    Math.min(
      5,
      Number(item.sectorPowerScore || item.sectorScore || 0)
    )
  );

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
    changeRatePart +
    sectorPart;

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
    sectorPart,

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

function evaluateLeaderWatchCandidate(item, price) {
  if (!settings.leaderWatchEnabled) {
    return { pass: false, reason: "LEADER_WATCH OFF" };
  }

  const source = String(item.candidateSource || "");
  const changeRate = Number(
    item.changeRate ?? item.fluctuationRate ?? item.riseRate ?? item.rate ?? 0
  );
  const firstChangeRate = Number(
    item.firstChangeRate ?? changeRate
  );
  const volumeRatio = getTradeVolumeRatio(item);
  const dayPosition = getDayPositionRate(item, price);
  const openPosition = getOpenPositionRate(item, price);
  const discoverScore = Number(item.discoverScore || 0);
  const hotScore = Math.max(
    Number(item.hotScore || 0),
    Number(item.maxHotScore || 0)
  );
  const firstDetectedAtMs = Number(
    item.hotFirstDetectedAtMs || item.hotDetectedAtMs || 0
  );
  const ageMs = firstDetectedAtMs > 0
    ? Date.now() - firstDetectedAtMs
    : Number.MAX_SAFE_INTEGER;

  const checks = {
    hotSource: source === "HOT" || source === "HOT_HISTORY" || firstDetectedAtMs > 0,
    age: ageMs >= 0 && ageMs <= Number(settings.leaderWatchMaxAgeMs || 0),
    firstChange:
      firstChangeRate >= Number(settings.volumeMinChangeRate || 0) &&
      firstChangeRate <= Number(settings.leaderWatchFirstMaxChangeRate || 0),
    currentChange:
      changeRate >= Number(settings.volumeMinChangeRate || 0) &&
      changeRate <= Number(settings.leaderWatchCurrentMaxChangeRate || 0),
    discoverScore: discoverScore >= Number(settings.leaderWatchMinDiscoverScore || 0),
    volume: volumeRatio >= Number(settings.leaderWatchMinVolumeRatio || 0),
    dayPosition: dayPosition >= Number(settings.leaderWatchMinDayPositionRate || 0),
    openPosition: openPosition >= 0,
    hotScore: hotScore >= Number(settings.leaderWatchMinHotScore || 0)
  };

  const failed = Object.entries(checks).find(([, pass]) => !pass)?.[0] || null;

  return {
    pass: !failed,
    failed,
    firstChangeRate,
    changeRate,
    volumeRatio,
    dayPosition,
    discoverScore,
    hotScore,
    ageMs,
    reason: failed
      ? `LEADER_WATCH 대기 ${failed}`
      : (
          `LEADER_WATCH 등록 / 최초 ${firstChangeRate.toFixed(2)}% / ` +
          `현재 ${changeRate.toFixed(2)}% / HOT ${hotScore.toFixed(1)}점`
        )
  };
}

function evaluateLeaderWatchCandidateFromState(state, item, price) {
  const code = String(item.code || "").padStart(6, "0");
  const watch = (state.volumeCandidateWatchList || []).find(row =>
    String(row.code || "").padStart(6, "0") === code
  ) || null;
  const snapshot = watch?.itemSnapshot || {};

  const merged = {
    ...snapshot,
    ...(watch || {}),
    ...item,
    code,
    firstChangeRate: Number(
      watch?.firstChangeRate ?? snapshot.firstChangeRate ?? item.firstChangeRate ?? item.changeRate ?? 0
    ),
    hotFirstDetectedAtMs: Number(
      watch?.hotFirstDetectedAtMs || snapshot.hotFirstDetectedAtMs || item.hotFirstDetectedAtMs || 0
    ),
    candidateSource:
      watch?.candidateSource || snapshot.candidateSource || item.candidateSource || "DISCOVER",
    hotScore: Math.max(
      Number(item.hotScore || 0),
      Number(snapshot.hotScore || 0),
      Number(watch?.itemSnapshot?.hotScore || 0)
    ),
    maxHotScore: Math.max(
      Number(item.maxHotScore || 0),
      Number(snapshot.maxHotScore || 0),
      Number(watch?.itemSnapshot?.maxHotScore || 0)
    )
  };

  const result = evaluateLeaderWatchCandidate(merged, price);
  return {
    ...result,
    watch,
    item: merged
  };
}

function collectHotCandidatesIntoWatchLists(
  state,
  { observeCurrent = true, logPrefix = "HOT 관찰" } = {}
) {
  const currentHotCandidates = loadHotCandidates();
  const historyCandidates = loadRecentHotHistoryCandidates();
  const candidates = mergeHotObservationCandidates(
    currentHotCandidates,
    historyCandidates
  );
  const currentCodes = new Set(
    currentHotCandidates.map(item => String(item.code || "").padStart(6, "0"))
  );

  let coreAdded = 0;
  let volumeAdded = 0;
  let leaderAdded = 0;
  let observed = 0;

  for (const sourceItem of candidates) {
    const code = String(sourceItem.code || "").padStart(6, "0");
    const price = Math.abs(Number(
      sourceItem.currentPrice || sourceItem.price || sourceItem.raw?.cur_prc || 0
    ));

    if (
      !/^\d{6}$/.test(code) ||
      !price ||
      isAlreadyHolding(state, code) ||
      wasBoughtToday(state, code)
    ) {
      continue;
    }

    const item = { ...sourceItem, code };
    const isCurrent = currentCodes.has(code);
    const coreBasic = isBasicCoreCandidate(item, price);
    const volumeBasic = isBasicVolumeCandidate(item, price);
    const leader = evaluateLeaderWatchCandidate(item, price);

    if (coreBasic) {
      updateCandidateWatchList(state, item, price, "CORE");
      coreAdded++;

      if (observeCurrent && isCurrent) {
        isCoreCandidateGettingStronger(state, item, price);
        observed++;
      }
    }

    if (volumeBasic || leader.pass) {
      const volumeItem = leader.pass
        ? { ...item, isLeaderWatch: true }
        : item;

      updateCandidateWatchList(state, volumeItem, price, "VOLUME");
      volumeAdded++;
      if (leader.pass) leaderAdded++;

      if (observeCurrent && isCurrent) {
        isVolumeCandidateGettingStronger(state, volumeItem, price);
        observed++;
      }
    }
  }

  console.log(
    `[${logPrefix}] 현재 HOT ${currentHotCandidates.length}개 / ` +
    `최근누적 ${historyCandidates.length}개 / 병합 ${candidates.length}개 / ` +
    `CORE ${coreAdded}개 / VOLUME ${volumeAdded}개 / ` +
    `LEADER ${leaderAdded}개 / 실시간관찰 ${observed}회`
  );

  return {
    currentHotCandidates,
    historyCandidates,
    candidates,
    coreAdded,
    volumeAdded,
    leaderAdded,
    observed
  };
}

function collectOpenPriorityHotObservations(state) {
  if (
    !settings.openPriorityHotObservationEnabled ||
    state.serverAutoEnabled === false
  ) {
    return false;
  }

  const now = Date.now();
  const lastAt = Number(state.lastOpenPriorityHotObservationAtMs || 0);
  const minIntervalMs = Number(settings.openPriorityObservationMinIntervalMs || 0);

  if (lastAt > 0 && now - lastAt < minIntervalMs) {
    return false;
  }

  collectHotCandidatesIntoWatchLists(state, {
    observeCurrent: true,
    logPrefix: "OPEN 우선중 HOT 관찰"
  });

  state.lastOpenPriorityHotObservationAtMs = now;
  state.lastOpenPriorityHotObservationAt = nowText();
  saveState(state);
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

  const observedFirstChangeRate = Number(
    item.firstChangeRate ?? changeRate
  );

  const hotFirstDetectedAtMs = Number(
    item.hotFirstDetectedAtMs || item.hotDetectedAtMs || 0
  );

  const sectorPowerScore = Number(
    item.sectorPowerScore || item.sectorScore || 0
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
    firstChangeRate: observedFirstChangeRate,
    hotFirstDetectedAtMs,
    hotLastDetectedAtMs: Number(item.hotLastDetectedAtMs || item.hotDetectedAtMs || 0),
    candidateSource: item.candidateSource || "DISCOVER",
    isLeaderWatch: item.isLeaderWatch === true,
    marketSegment: normalizeMarketSegment(item),
    hotScore: Number(item.hotScore || 0),
    maxHotScore: Number(item.maxHotScore || item.hotScore || 0),
    openMomentumScore: Number(item.openMomentumScore || 0),
    maxMomentumScore: Number(item.maxMomentumScore || item.openMomentumScore || 0),
    openMomentumSamples: Array.isArray(item.openMomentumSamples)
      ? item.openMomentumSamples.slice(-15)
      : [],
    sector: item.sector || item.sectorName || item.industry || null,
    sectorKey: item.sectorKey || null,
    sectorPeerCount: Number(item.sectorPeerCount || 0),
    sectorPowerScore,

    candidateStrengthScore:
      item.candidateStrengthScore ??
      item.leaderStrengthScore ??
      watchScoreDetail.candidateStrengthScore ??
      watchScoreDetail.leaderStrengthScore ??
      null,
    leaderStrengthScore:
      item.leaderStrengthScore ??
      item.candidateStrengthScore ??
      watchScoreDetail.leaderStrengthScore ??
      watchScoreDetail.candidateStrengthScore ??
      null,

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
    existing.hotFirstDetectedAtMs = Number(
      existing.hotFirstDetectedAtMs || hotFirstDetectedAtMs || 0
    );
    existing.hotLastDetectedAtMs = Number(
      item.hotLastDetectedAtMs || item.hotDetectedAtMs || existing.hotLastDetectedAtMs || 0
    );
    existing.candidateSource = item.candidateSource || existing.candidateSource || "DISCOVER";
    existing.isLeaderWatch = existing.isLeaderWatch === true || item.isLeaderWatch === true;
    existing.sector = itemSnapshot.sector || existing.sector || null;
    existing.sectorKey = itemSnapshot.sectorKey || existing.sectorKey || null;
    existing.sectorPeerCount = Number(itemSnapshot.sectorPeerCount || existing.sectorPeerCount || 0);
    existing.sectorPowerScore = Math.max(
      Number(existing.sectorPowerScore || 0),
      Number(itemSnapshot.sectorPowerScore || 0)
    );
    existing.candidateStrengthScore = itemSnapshot.candidateStrengthScore;
    existing.leaderStrengthScore = itemSnapshot.leaderStrengthScore;
    existing.watchScore = watchScore;
    existing.watchScoreDetail =
  watchScoreDetail;

    existing.rawTradeVolumeRatio =
      rawTradeVolumeRatio;

    existing.itemSnapshot = itemSnapshot;
  } else {
    const firstSeenAt = item.isLeaderWatch === true && hotFirstDetectedAtMs > 0
      ? hotFirstDetectedAtMs
      : now;

    state[listKey].push({
      code,
      name,
      strategyGroup,

      firstSeenAt,
      firstSeenAtText: new Date(firstSeenAt).toLocaleString(
        "ko-KR",
        { timeZone: "Asia/Seoul" }
      ),

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

      firstChangeRate: observedFirstChangeRate,
      changeRate,

      hotFirstDetectedAtMs,
      hotLastDetectedAtMs: Number(item.hotLastDetectedAtMs || item.hotDetectedAtMs || 0),
      candidateSource: item.candidateSource || "DISCOVER",
      isLeaderWatch: item.isLeaderWatch === true,
      sector: itemSnapshot.sector,
      sectorKey: itemSnapshot.sectorKey,
      sectorPeerCount: itemSnapshot.sectorPeerCount,
      sectorPowerScore: itemSnapshot.sectorPowerScore,

      candidateStrengthScore: itemSnapshot.candidateStrengthScore,
      leaderStrengthScore: itemSnapshot.leaderStrengthScore,

      watchScore,
      watchScoreDetail,

      rawTradeVolumeRatio,

      itemSnapshot
    });
  }

  state[listKey] = state[listKey]
    .filter(candidate => {
      const maxAgeMs = candidate.isLeaderWatch === true
        ? Number(settings.leaderWatchMaxAgeMs || settings.candidateWatchMaxAgeMs)
        : Number(settings.candidateWatchMaxAgeMs || 0);
      const startedAtMs = Number(
        candidate.firstSeenAt || candidate.lastSeenAt || 0
      );
      return startedAtMs > 0 && now - startedAtMs <= maxAgeMs;
    })
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
    ).toFixed(1)} / ` +

    `섹터 ${Number(
      detail.sectorPart || 0
    ).toFixed(1)} / ` +

    `경로 ${candidate.isLeaderWatch === true ? "LEADER_WATCH" : (candidate.candidateSource || "DISCOVER")}`
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

  if (text.includes("발견점수 부족")) {
    return "발견점수 부족";
  }

  if (text.includes("하루 매수한도")) {
    return "하루 매수한도";
  }

  if (
    text.includes("손실매도") &&
    text.includes("신규매수 중단")
  ) {
    return "손실매도 한도";
  }

  if (text.includes("손실매도 후 대기")) {
    return "손실매도 후 대기";
  }

  if (text.includes("저유동성 차단")) {
    return "절대 유동성 부족";
  }

  if (
    text.includes("초과열") ||
    text.includes("동시과열") ||
    text.includes("안전확인 대기")
  ) {
    return "과열·추격 관찰대기";
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

  if (text.includes("CORE 안정추세 관찰")) {
    return "CORE 추세관찰 대기";
  }

  if (
    text.includes("VOLUME 상승초기 관찰") ||
    text.includes("VOLUME 상승초기 지속관찰")
  ) {
    return "VOLUME 추세관찰 대기";
  }

  if (
    text.includes("VOLUME 눌림후 재상승 대기") ||
    text.includes("VOLUME 눌림대기")
  ) {
    return "VOLUME 눌림·재상승 대기";
  }

  if (
    text.includes("강화 확인 대기") ||
    text.includes("후보 강화 미충족")
  ) {
    return "후보 강화 대기";
  }

  if (text.includes("후보강도 부족")) {
    return "후보강도 부족";
  }

  if (text.includes("후반추격 차단")) {
    return "후반추격 차단";
  }

  if (text.includes("전략 OFF") || /(?:CORE|VOLUME) OFF/.test(text)) {
    return "전략 OFF";
  }

  if (text.includes("시장조건 차단")) {
    return "시장조건 차단";
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
    "하루 매수한도",
    "손실매도 한도",
    "손실매도 후 대기",
    "시장조건 차단",
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

  for (const listKey of [
    "coreCandidateWatchList",
    "volumeCandidateWatchList"
  ]) {
    if (!Array.isArray(state[listKey])) {
      state[listKey] = [];
      continue;
    }

    state[listKey] = state[listKey]
      .filter(candidate => {
        const maxAgeMs = candidate.isLeaderWatch === true
          ? Number(settings.leaderWatchMaxAgeMs || settings.candidateWatchMaxAgeMs)
          : Number(settings.candidateWatchMaxAgeMs || 0);
        const startedAtMs = Number(
          candidate.firstSeenAt || candidate.lastSeenAt || 0
        );
        return startedAtMs > 0 && now - startedAtMs <= maxAgeMs;
      })
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

    firstChangeRate: Number(
      candidate.firstChangeRate ??
      snapshot.firstChangeRate ??
      realtimeItem.changeRate ??
      candidate.changeRate ??
      0
    ),

    hotFirstDetectedAtMs: Number(
      candidate.hotFirstDetectedAtMs || snapshot.hotFirstDetectedAtMs || 0
    ),

    hotLastDetectedAtMs: Number(
      realtimeItem.hotDetectedAtMs ||
      candidate.hotLastDetectedAtMs ||
      snapshot.hotLastDetectedAtMs ||
      0
    ),

    candidateSource: candidate.candidateSource || snapshot.candidateSource || "WATCH",
    isLeaderWatch: candidate.isLeaderWatch === true || snapshot.isLeaderWatch === true,
    sector: realtimeItem.sector || candidate.sector || snapshot.sector || null,
    sectorKey: realtimeItem.sectorKey || candidate.sectorKey || snapshot.sectorKey || null,
    sectorPeerCount: Number(
      realtimeItem.sectorPeerCount ?? candidate.sectorPeerCount ?? snapshot.sectorPeerCount ?? 0
    ),
    sectorPowerScore: Number(
      realtimeItem.sectorPowerScore ?? candidate.sectorPowerScore ?? snapshot.sectorPowerScore ?? 0
    ),

    candidateStrengthScore:
      realtimeItem.candidateStrengthScore ??
      realtimeItem.leaderStrengthScore ??
      candidate.candidateStrengthScore ??
      candidate.leaderStrengthScore ??
      snapshot.candidateStrengthScore,

    leaderStrengthScore:
      realtimeItem.leaderStrengthScore ??
      realtimeItem.candidateStrengthScore ??
      candidate.leaderStrengthScore ??
      candidate.candidateStrengthScore ??
      snapshot.leaderStrengthScore,

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
  state.lastBuyAtMsByStrategy = {};
  state.lastLossExitAtMs = null;
  state.lastLossExitStrategy = null;
  state.lastLossExitCode = null;

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
  state.lastReadyMarketTemperature = null;

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
  state.completedFullSellCodes = [];

  const todaySellKeyPrefix = `${today}_`;
  for (const key of completedFullSellKeys) {
    if (!String(key).startsWith(todaySellKeyPrefix)) {
      completedFullSellKeys.delete(key);
    }
  }

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

function normalizeTradeCode(code) {
  return String(code || "")
    .replace(/^A/, "")
    .trim()
    .padStart(6, "0");
}

function getHoldingPositionToken(holding = {}) {
  const rawToken =
    holding.positionId ||
    holding.buyTime ||
    holding.buyTimeMs ||
    holding.buyAt ||
    holding.buyTimeText ||
    "legacy";

  return String(rawToken)
    .replace(/[^0-9A-Za-z_-]/g, "_")
    .slice(-100);
}

function getTradeLogTimestampMs(log = {}) {
  const values = [
    log.timestampMs,
    log.createdAtMs,
    log.sellAnalysis?.sellTime,
    log.buyTime,
    log.buyTimeMs
  ];

  for (const value of values) {
    const number = Number(value || 0);
    if (Number.isFinite(number) && number > 0) {
      return number;
    }
  }

  return 0;
}

function getTodayCodeBuyEntries(state, code) {
  const normalizedCode = normalizeTradeCode(code);

  return (state.tradeLogs || [])
    .map((log, index) => ({ log, index }))
    .filter(({ log }) =>
      log.date === todayKey() &&
      normalizeTradeCode(log.code) === normalizedCode &&
      ["OPEN_BUY", "CORE_BUY", "VOLUME_BUY"].includes(String(log.type || ""))
    );
}

function getSameDayReentryStatus(state, code) {
  const buyEntries = getTodayCodeBuyEntries(state, code);

  if (!buyEntries.length) {
    return {
      hasTodayBuy: false,
      isReentry: false,
      allowed: true,
      reason: "오늘 최초 진입"
    };
  }

  if (!settings.sameDayReentryEnabled) {
    return {
      hasTodayBuy: true,
      isReentry: true,
      allowed: false,
      reason: "오늘 이미 매수 / 재진입 OFF"
    };
  }

  const maxEntryCount = 1 + Math.max(
    0,
    Number(settings.sameDayReentryMaxCount || 0)
  );

  if (buyEntries.length >= maxEntryCount) {
    return {
      hasTodayBuy: true,
      isReentry: true,
      allowed: false,
      buyCount: buyEntries.length,
      reason:
        `동일종목 당일 진입한도 ${buyEntries.length}/${maxEntryCount}회 도달`
    };
  }

  const latestBuyEntry = buyEntries[buyEntries.length - 1];
  const normalizedCode = normalizeTradeCode(code);

  const lossSellEntries = (state.tradeLogs || [])
    .map((log, index) => ({ log, index }))
    .filter(({ log, index }) =>
      index > latestBuyEntry.index &&
      log.date === todayKey() &&
      normalizeTradeCode(log.code) === normalizedCode &&
      !String(log.type || "").endsWith("_BUY") &&
      Number(log.profitRate || 0) < 0
    );

  if (!lossSellEntries.length) {
    return {
      hasTodayBuy: true,
      isReentry: true,
      allowed: false,
      reason: "오늘 매수 후 손실청산 확인 없음"
    };
  }

  const latestLossSellEntry = lossSellEntries[lossSellEntries.length - 1];
  const lossSellAtMs = getTradeLogTimestampMs(latestLossSellEntry.log);
  const cooldownMinutes = Number(
    settings.sameDayReentryCooldownMinutes || 0
  );
  const elapsedMinutes = lossSellAtMs > 0
    ? (Date.now() - lossSellAtMs) / 60000
    : -1;

  if (lossSellAtMs <= 0 || elapsedMinutes < cooldownMinutes) {
    return {
      hasTodayBuy: true,
      isReentry: true,
      allowed: false,
      latestBuy: latestBuyEntry.log,
      latestLossSell: latestLossSellEntry.log,
      elapsedMinutes,
      reason:
        lossSellAtMs <= 0
          ? "재진입 대기시간 계산용 매도시각 없음"
          : `동일종목 재진입 대기 ${elapsedMinutes.toFixed(1)}분 / 기준 ${cooldownMinutes}분`
    };
  }

  return {
    hasTodayBuy: true,
    isReentry: true,
    allowed: true,
    latestBuy: latestBuyEntry.log,
    latestLossSell: latestLossSellEntry.log,
    elapsedMinutes,
    reason: `동일종목 재진입 대기 통과 ${elapsedMinutes.toFixed(1)}분`
  };
}

function wasBoughtToday(state, code) {
  const status = getSameDayReentryStatus(state, code);
  return status.hasTodayBuy && !status.allowed;
}

function getTodayStrategyBuyCount(state, strategyGroup) {
  return (state.tradeLogs || []).filter(log =>
    log.date === todayKey() &&
    log.type === `${strategyGroup}_BUY`
  ).length;
}

function getTodayLossExitCount(state) {
  const logs = state.tradeLogs || [];
  const countedBuyPositions = new Set();

  logs.forEach((log, sellIndex) => {
    const strategyGroup = String(
      log.strategyGroup || String(log.type || "").split("_")[0] || ""
    ).toUpperCase();

    if (
      log.date !== todayKey() ||
      !["CORE", "VOLUME"].includes(strategyGroup) ||
      String(log.type || "").endsWith("_BUY") ||
      Number(log.profitRate || 0) >= 0
    ) {
      return;
    }

    const normalizedCode = normalizeTradeCode(log.code);
    let matchedBuyIndex = -1;

    for (let index = sellIndex - 1; index >= 0; index--) {
      const buyLog = logs[index] || {};
      if (
        buyLog.date === todayKey() &&
        normalizeTradeCode(buyLog.code) === normalizedCode &&
        String(buyLog.type || "") === `${strategyGroup}_BUY`
      ) {
        matchedBuyIndex = index;
        break;
      }
    }

    // 전일 보유종목 또는 매수이력이 없는 종목의 오늘 손절은
    // 금액 손실에는 포함하되 당일 신규진입 실패 횟수에서는 제외한다.
    if (matchedBuyIndex >= 0) {
      const positionId = String(
        logs[matchedBuyIndex]?.positionId || matchedBuyIndex
      );
      countedBuyPositions.add(positionId);
    }
  });

  return countedBuyPositions.size;
}

function checkSameDayReentryCandidate(
  state,
  item,
  price,
  strategyGroup
) {
  const status = getSameDayReentryStatus(state, item.code);

  if (!status.hasTodayBuy) {
    return {
      pass: true,
      isReentry: false,
      reason: status.reason
    };
  }

  if (!status.allowed) {
    return {
      pass: false,
      isReentry: true,
      reason: status.reason
    };
  }

  const strength = resolveCandidateStrength(
    state,
    item,
    strategyGroup
  );
  const previousStrength = Number(
    status.latestBuy?.candidateStrengthScore || 0
  );
  const baseStrength = strategyGroup === "CORE"
    ? Number(settings.coreMinCandidateStrengthScore || 0)
    : Number(settings.volumeMinCandidateStrengthScore || 0);
  const requiredStrength = Math.max(
    baseStrength,
    previousStrength + Number(
      settings.sameDayReentryMinStrengthImprovement || 0
    )
  );
  const sellPrice = Number(
    status.latestLossSell?.sellPrice ||
    status.latestLossSell?.price ||
    0
  );
  const recoveryRate = sellPrice > 0
    ? ((Number(price || 0) - sellPrice) / sellPrice) * 100
    : 0;
  const minRecoveryRate = Number(
    settings.sameDayReentryMinRecoveryFromSellRate || 0
  );

  if (Number(strength.score || 0) < requiredStrength) {
    return {
      pass: false,
      isReentry: true,
      previousStrength,
      currentStrength: Number(strength.score || 0),
      requiredStrength,
      recoveryRate,
      reason:
        `재진입 후보강도 부족 ${Number(strength.score || 0).toFixed(1)}점 / ` +
        `이전 ${previousStrength.toFixed(1)}점 / 필요 ${requiredStrength.toFixed(1)}점`
    };
  }

  if (sellPrice <= 0 || recoveryRate < minRecoveryRate) {
    return {
      pass: false,
      isReentry: true,
      previousStrength,
      currentStrength: Number(strength.score || 0),
      requiredStrength,
      recoveryRate,
      reason:
        sellPrice <= 0
          ? "재진입 기준 매도가 없음"
          : `재진입 가격회복 부족 ${recoveryRate.toFixed(2)}% / 기준 +${minRecoveryRate.toFixed(2)}%`
    };
  }

  return {
    pass: true,
    isReentry: true,
    previousStrength,
    currentStrength: Number(strength.score || 0),
    requiredStrength,
    recoveryRate,
    elapsedMinutes: status.elapsedMinutes,
    reason:
      `재진입 확인 / 손절후 ${status.elapsedMinutes.toFixed(1)}분 / ` +
      `후보강도 ${previousStrength.toFixed(1)}→${Number(strength.score || 0).toFixed(1)}점 / ` +
      `매도가대비 +${recoveryRate.toFixed(2)}%`
  };
}

function checkStrategyDailyBuyLimit(state, strategyGroup) {
  const limit = strategyGroup === "CORE"
    ? Number(settings.coreMaxDailyBuyCount || 0)
    : Number(settings.volumeMaxDailyBuyCount || 0);
  const count = getTodayStrategyBuyCount(state, strategyGroup);

  if (limit > 0 && count >= limit) {
    return {
      blocked: true,
      reason: `${strategyGroup} 하루 매수한도 ${count}/${limit}건 도달`
    };
  }

  const lossLimit = Number(settings.maxDailyLossExitCount || 0);
  const lossCount = getTodayLossExitCount(state);
  if (lossLimit > 0 && lossCount >= lossLimit) {
    return {
      blocked: true,
      reason: `오늘 손실매도 ${lossCount}/${lossLimit}건 도달 / 신규매수 중단`
    };
  }

  return {
    blocked: false,
    reason: `${strategyGroup} 하루 매수 ${count}/${limit}건 / 손실매도 ${lossCount}/${lossLimit}건`
  };
}

function checkLossExitBuyCooldown(state, code) {
  const cooldownMinutes = Number(settings.lossExitBuyCooldownMinutes || 0);
  const lastLossExitAtMs = Number(state.lastLossExitAtMs || 0);
  const lastLossExitCode = normalizeTradeCode(state.lastLossExitCode || "");
  const targetCode = normalizeTradeCode(code || "");

  if (!cooldownMinutes || !lastLossExitAtMs) {
    return { blocked: false, reason: "최근 손실매도 없음" };
  }

  // 2026-08-18: 손실 1건이 다른 우수 후보까지 15분간 막지 않도록
  // 손실 직후 쿨다운은 동일 종목에만 적용한다.
  // 전체 연속손실 방어는 maxDailyLossExitCount가 별도로 담당한다.
  if (!targetCode || !lastLossExitCode || targetCode !== lastLossExitCode) {
    return {
      blocked: false,
      reason: `다른 종목 손실쿨다운 미적용 / 최근손실 ${lastLossExitCode || "-"}`
    };
  }

  const diffMinutes = (Date.now() - lastLossExitAtMs) / 60000;
  if (diffMinutes < cooldownMinutes) {
    return {
      blocked: true,
      reason: `동일종목 손실매도 후 대기 ${diffMinutes.toFixed(1)}분 / 기준 ${cooldownMinutes}분`
    };
  }

  return {
    blocked: false,
    reason: `동일종목 손실매도 후 대기 통과 ${diffMinutes.toFixed(1)}분`
  };
}


function getLastBuyTimeByStrategyCode(state, strategyGroup, code) {
  const targetCode = normalizeTradeCode(code || "");
  if (!targetCode) return 0;

  const logs = (state.tradeLogs || [])
    .filter(log =>
      log.date === todayKey() &&
      log.type === `${strategyGroup}_BUY` &&
      normalizeTradeCode(log.code) === targetCode
    )
    .sort((a, b) => {
      const at = Number(a.timestampMs || a.createdAtMs || a.buyTime || 0);
      const bt = Number(b.timestampMs || b.createdAtMs || b.buyTime || 0);
      return bt - at;
    });

  if (!logs.length) return 0;

  const last = logs[0];
  return Number(last.timestampMs || last.createdAtMs || last.buyTime || 0);
}

function isStrategyBuyCooldown(state, strategyGroup, code) {
  const cooldownMinutes = strategyGroup === "CORE"
    ? settings.coreBuyCooldownMinutes
    : settings.volumeBuyCooldownMinutes;

  // 2026-08-18: 전략 전체 10분 잠금 대신 동일 종목에만 쿨다운 적용.
  // 서로 다른 강한 후보는 최대보유/일일매수 한도 안에서 계속 진입할 수 있다.
  const lastBuyTime = getLastBuyTimeByStrategyCode(
    state,
    strategyGroup,
    code
  );

  if (!lastBuyTime) return {
    blocked: false,
    reason: "동일종목 최근 매수 없음"
  };

  const diffMinutes = (Date.now() - lastBuyTime) / 60000;

  if (diffMinutes < cooldownMinutes) {
    return {
      blocked: true,
      reason: `${strategyGroup} 동일종목 매수쿨다운 ${diffMinutes.toFixed(1)}분 / 기준 ${cooldownMinutes}분`
    };
  }

  return {
    blocked: false,
    reason: `${strategyGroup} 동일종목 쿨다운 통과 ${diffMinutes.toFixed(1)}분`
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

  const marketSourceItems = Array.isArray(data.marketItems)
    ? data.marketItems
    : (Array.isArray(data.items) ? data.items : []);
  const candidateSourceItems = Array.isArray(data.items)
    ? data.items
    : marketSourceItems;

  /*
   * 시장점수용 데이터
   *
   * 발견점수 조건을 적용하지 않는다.
   * ETF·ETN·우선주 등 제외종목만 제거한다.
   */
  const marketRows =
    marketSourceItems.filter(item =>
      !isExcludedStock(item)
    );

  /*
   * 실제 매수 후보
   *
   * 기존처럼 발견점수 기준을 적용한다.
   */
  const candidates =
    candidateSourceItems
      .filter(item => !isExcludedStock(item))
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
    `[DISCOVER] 원본 ${marketSourceItems.length}개 / ` +
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

function isCoreOrVolumeBuyWindow(hhmm = getCurrentHHMM()) {
  const coreBuyTime =
    settings.coreEnabled &&
    hhmm >= settings.coreStartTime &&
    hhmm <= settings.coreEndTime;

  const volumeBuyTime =
    settings.volumeEnabled &&
    hhmm >= settings.volumeStartTime &&
    hhmm <= settings.volumeEndTime;

  return coreBuyTime || volumeBuyTime;
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
    return { pass: false, reason: "종목코드 없음" };
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

  let history = state.coreCandidateHistory[code];
  if (!history || !Array.isArray(history.samples)) {
    const legacySample = history?.time ? history : null;
    history = {
      firstSeenAtMs: Number(legacySample?.time || now),
      samples: legacySample ? [legacySample] : []
    };
  }

  history.samples.push(current);
  history.time = now;
  history.lastSeenAtMs = now;
  history.samples = history.samples
    .filter(sample =>
      now - Number(sample.time || 0) <=
      Number(settings.coreTrendObservationWindowMs || 180000)
    )
    .slice(-8);

  /*
   * 오래된 최초 발견시각을 계속 사용하면 최근 표본은 2회뿐인데도
   * "1011초/60초"처럼 관찰시간이 부풀려진다. CORE 강화판단은
   * 현재 관찰창 안의 가장 오래된 유효 표본부터 다시 계산한다.
   */
  history.firstSeenAtMs = Number(
    history.samples[0]?.time || now
  );
  state.coreCandidateHistory[code] = history;

  const samples = history.samples;
  const minCount = Number(settings.coreTrendObservationMinCount || 3);
  const elapsedMs = now - Number(history.firstSeenAtMs || now);
  if (
    samples.length < minCount ||
    elapsedMs < Number(settings.coreTrendMinElapsedMs || 60000)
  ) {
    return {
      pass: false,
      observationCount: samples.length,
      reason:
        `CORE 안정추세 관찰 ${samples.length}/${minCount}회 / ` +
        `${Math.floor(elapsedMs / 1000)}초/${Math.floor(Number(settings.coreTrendMinElapsedMs || 60000) / 1000)}초`
    };
  }

  const recent = samples.slice(-6);
  const first = recent[0];
  const last = recent[recent.length - 1];
  const previous = recent[recent.length - 2] || first;
  let priceHoldCount = 0;
  for (let i = 1; i < recent.length; i++) {
    if (Number(recent[i].price || 0) >= Number(recent[i - 1].price || 0)) {
      priceHoldCount++;
    }
  }

  const steps = Math.max(1, recent.length - 1);
  const pricePersistence = priceHoldCount / steps;
  const priceDiffRate = Number(first.price || 0) > 0
    ? ((Number(last.price || 0) - Number(first.price || 0)) / Number(first.price)) * 100
    : 0;
  const recentPriceDiffRate = Number(previous.price || 0) > 0
    ? ((Number(last.price || 0) - Number(previous.price || 0)) / Number(previous.price)) * 100
    : 0;
  const scoreDiff = Number(last.score || 0) - Number(first.score || 0);
  const dayPositionDrop = Number(last.dayPosition || 0) - Number(first.dayPosition || 0);
  const volumeRetentionRate = Number(first.volumeRatio || 0) > 0
    ? Number(last.volumeRatio || 0) / Number(first.volumeRatio)
    : 1;

  if (scoreDiff < -1) {
    return { pass: false, reason: `CORE 점수 약화 ${first.score}→${last.score}` };
  }
  if (priceDiffRate < Number(settings.coreConfirmMinPriceRiseRate || 0)) {
    return {
      pass: false,
      priceDiffRate,
      reason: `CORE 관찰가격 하락 ${priceDiffRate.toFixed(2)}%`
    };
  }
  if (recentPriceDiffRate < -0.10) {
    return {
      pass: false,
      priceDiffRate,
      reason: `CORE 매수직전 가격 약화 ${recentPriceDiffRate.toFixed(2)}%`
    };
  }
  if (pricePersistence < Number(settings.coreTrendMinPricePersistence || 0.5)) {
    return {
      pass: false,
      priceDiffRate,
      reason: `CORE 가격지속 부족 ${(pricePersistence * 100).toFixed(0)}%`
    };
  }
  if (dayPositionDrop < -Math.abs(Number(settings.coreTrendMaxDayPositionDrop || 7))) {
    return {
      pass: false,
      priceDiffRate,
      reason: `CORE 당일위치 약화 ${dayPositionDrop.toFixed(1)}%p`
    };
  }
  if (volumeRetentionRate < Number(settings.coreTrendMinVolumeRetentionRate || 0.75)) {
    return {
      pass: false,
      priceDiffRate,
      reason: `CORE 거래량 유지 부족 ${(volumeRetentionRate * 100).toFixed(0)}%`
    };
  }

  return {
    pass: true,
    priceDiffRate,
    recentPriceDiffRate,
    pricePersistence,
    volumeRetentionRate,
    dayPositionDrop,
    scoreDiff,
    observationCount: recent.length,
    reason:
      `CORE 안정추세 통과 / 관찰 ${recent.length}회 / ` +
      `가격 ${priceDiffRate >= 0 ? "+" : ""}${priceDiffRate.toFixed(2)}% / ` +
      `직전 ${recentPriceDiffRate >= 0 ? "+" : ""}${recentPriceDiffRate.toFixed(2)}% / ` +
      `가격지속 ${(pricePersistence * 100).toFixed(0)}% / ` +
      `거래량유지 ${(volumeRetentionRate * 100).toFixed(0)}%`
  };
}

function getVolumeMomentumSeedSamples(item = {}, current = {}) {
  const now = Number(current.time || Date.now());
  const windowMs = Number(settings.volumeRecentHighWindowMs || 90000);
  const external = Array.isArray(item.openMomentumSamples)
    ? item.openMomentumSamples
    : [];
  const normalized = external
    .map(sample => ({
      time: Number(sample.time || sample.observedAtMs || 0),
      score: Number(item.discoverScore || 0),
      changeRate: Number(item.changeRate || 0),
      volumeRatio: Number(sample.volumeRatio || sample.tradeVolumeRatio || 0),
      dayPosition: Number(sample.dayPosition || 0),
      price: Number(sample.price || sample.currentPrice || 0)
    }))
    .filter(sample =>
      sample.time > 0 &&
      sample.price > 0 &&
      now - sample.time >= 0 &&
      now - sample.time <= windowMs
    );

  normalized.push(current);

  const deduped = new Map();
  for (const sample of normalized) {
    deduped.set(`${sample.time}_${sample.price}`, sample);
  }

  return Array.from(deduped.values())
    .sort((a, b) => Number(a.time || 0) - Number(b.time || 0))
    .slice(-15);
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
    changeRate: Number(
      item.changeRate ??
      item.fluctuationRate ??
      item.riseRate ??
      item.rate ??
      0
    ),
    volumeRatio: getTradeVolumeRatio(item),
    dayPosition: getDayPositionRate(item, price),
    price: Number(price || 0)
  };

  let history = state.volumeCandidateHistory[code];
  if (!history || !history.phase) {
    const seedSamples = getVolumeMomentumSeedSamples(item, current);
    const firstSeed = seedSamples[0] || current;
    history = {
      phase: "SURGE",
      time: now,
      lastSeenAtMs: now,
      firstSeenAtMs: Number(firstSeed.time || now),
      phaseStartedAtMs: now,
      phaseStartedAtText: nowText(),
      firstPrice: Number(firstSeed.price || current.price),
      firstVolumeRatio: Number(firstSeed.volumeRatio || current.volumeRatio),
      firstDayPosition: Number(firstSeed.dayPosition || current.dayPosition),
      peakPrice: Math.max(...seedSamples.map(sample => Number(sample.price || 0))),
      pullbackLowPrice: null,
      previous: current,
      samples: seedSamples
    };
    state.volumeCandidateHistory[code] = history;
  }

  // 단계별 제한시간을 분리한다.
  // 기존 코드는 최초 급등 관찰부터 3분을 계산해 눌림이 늦게 시작되면
  // 정상 눌림 확인 직후에도 즉시 RESET되는 문제가 있었다.
  if (
    history.phase === "PULLBACK" &&
    !Number(history.pullbackStartedAtMs || 0)
  ) {
    // 배포 전 저장된 PULLBACK 상태는 배포 시점부터 새 제한시간을 부여한다.
    history.pullbackStartedAtMs = now;
    history.pullbackStartedAtText = nowText();
    history.phaseStartedAtMs = now;
    history.phaseStartedAtText = nowText();
  }

  history.samples = Array.isArray(history.samples) ? history.samples : [];
  const lastStoredSample = history.samples[history.samples.length - 1];
  if (
    !lastStoredSample ||
    Number(lastStoredSample.time || 0) !== now ||
    Number(lastStoredSample.price || 0) !== current.price
  ) {
    history.samples.push(current);
  }
  history.samples = history.samples.slice(-15);
  history.time = now;
  history.lastSeenAtMs = now;
  const previous = history.previous || history.samples[history.samples.length - 2] || current;
  history.peakPrice = Math.max(Number(history.peakPrice || current.price), current.price);

  const pullbackRate = Number(history.peakPrice || 0) > 0
    ? ((current.price - Number(history.peakPrice)) / Number(history.peakPrice)) * 100
    : 0;
  const recentPriceChangeRate = Number(previous.price || 0) > 0
    ? ((current.price - Number(previous.price)) / Number(previous.price)) * 100
    : 0;
  const volumeRetentionRate = Number(history.firstVolumeRatio || 0) > 0
    ? current.volumeRatio / Number(history.firstVolumeRatio)
    : 1;
  const dayPositionDiff = current.dayPosition - Number(history.firstDayPosition || 0);
  history.previous = current;

  const firstSample = history.samples[0] || current;
  const observationCount = history.samples.length;
  const observationElapsedMs = now - Number(
    firstSample.time || history.firstSeenAtMs || now
  );
  const earlyPriceRiseRate = Number(firstSample.price || 0) > 0
    ? ((current.price - Number(firstSample.price)) / Number(firstSample.price)) * 100
    : 0;
  const priceRiseTransitions = history.samples
    .slice(1)
    .filter((sample, index) =>
      Number(sample.price || 0) >=
      Number(history.samples[index]?.price || 0)
    ).length;
  const pricePersistence = observationCount > 1
    ? priceRiseTransitions / (observationCount - 1)
    : 0;

  const recentHighWindowMs = Number(
    settings.volumeRecentHighWindowMs || 90000
  );
  const recentHighSamples = history.samples.filter(sample =>
    now - Number(sample.time || 0) >= 0 &&
    now - Number(sample.time || 0) <= recentHighWindowMs
  );
  const recentHighPrice = recentHighSamples.length
    ? Math.max(...recentHighSamples.map(sample => Number(sample.price || 0)))
    : current.price;
  const recentHighDrawdownRate = recentHighPrice > 0
    ? ((current.price - recentHighPrice) / recentHighPrice) * 100
    : 0;

  const maxPhaseWaitMs = Number(
    settings.volumePullbackMaxWaitMs || 180000
  );

  const getCurrentPhaseAgeMs = () => {
    const startedAtMs = history.phase === "PULLBACK"
      ? Number(history.pullbackStartedAtMs || history.phaseStartedAtMs || now)
      : Number(history.phaseStartedAtMs || history.firstSeenAtMs || now);

    return Math.max(0, now - startedAtMs);
  };

  const resetVolumeObservation = expiredPhase => {
    state.volumeCandidateHistory[code] = {
      phase: "SURGE",
      time: now,
      lastSeenAtMs: now,
      firstSeenAtMs: now,
      phaseStartedAtMs: now,
      phaseStartedAtText: nowText(),
      firstPrice: current.price,
      firstVolumeRatio: current.volumeRatio,
      firstDayPosition: current.dayPosition,
      peakPrice: current.price,
      pullbackLowPrice: null,
      previous: current,
      samples: [current],
      resetFromPhase: expiredPhase,
      resetAtMs: now,
      resetAtText: nowText()
    };

    return state.volumeCandidateHistory[code];
  };

  // BROKEN은 현재가 판단을 다시 할 수 없는 상태이므로 기존처럼 제한시간 후 초기화한다.
  // SURGE/PULLBACK은 아래에서 "현재 가격으로 진입 가능한가"를 먼저 검사한 뒤 시간초과를 적용한다.
  if (
    history.phase === "BROKEN" &&
    getCurrentPhaseAgeMs() > maxPhaseWaitMs
  ) {
    const phaseAgeMs = getCurrentPhaseAgeMs();
    resetVolumeObservation("BROKEN");
    return {
      pass: false,
      phase: "RESET",
      phaseAgeMs,
      reason:
        `VOLUME BROKEN 단계 ${Math.round(phaseAgeMs / 1000)}초 초과 / 기준 재설정`
    };
  }

  if (
    settings.volumeRecentHighGuardEnabled === true &&
    recentHighSamples.length >= Number(settings.volumeRecentHighMinSampleCount || 3) &&
    recentHighDrawdownRate <= Number(settings.volumeRecentHighMaxEntryDrawdownRate || -1.25)
  ) {
    history.phase = "BROKEN";
    history.phaseStartedAtMs = now;
    history.phaseStartedAtText = nowText();
    history.recentHighPrice = recentHighPrice;
    history.recentHighDrawdownRate = recentHighDrawdownRate;
    state.volumeCandidateHistory[code] = history;
    return {
      pass: false,
      phase: history.phase,
      recentHighPrice,
      recentHighDrawdownRate,
      observationCount: recentHighSamples.length,
      reason:
        `VOLUME 최근고점 미회복 / 고점 ${recentHighPrice.toLocaleString()}원 / ` +
        `현재 ${current.price.toLocaleString()}원 / ` +
        `${recentHighDrawdownRate.toFixed(2)}% / ` +
        `허용 ${Number(settings.volumeRecentHighMaxEntryDrawdownRate || -1.25).toFixed(2)}%`
    };
  }
  /*
   * 직전 통과신호 유지
   *
   * judgeVolumeBuy() 1차 통과 직후 paperBuy()가 새 현재가로 재검증할 때
   * EARLY_MOMENTUM/REBOUND를 일회성 신호로 소모하지 않는다.
   * 45초 안에서 확인가격 이상을 지키고 최근 2개 가격변화에 급락이 없을 때만
   * 동일 확인신호를 재사용한다. 가격이 약해지면 즉시 SURGE/PULLBACK으로 되돌린다.
   */
  const confirmedPhase = ["EARLY_MOMENTUM", "REBOUND"].includes(history.phase)
    ? history.phase
    : null;

  if (confirmedPhase) {
    const confirmedAtMs = Number(
      confirmedPhase === "REBOUND"
        ? history.reboundConfirmedAtMs
        : history.earlyConfirmedAtMs
    );
    const confirmedPrice = Number(
      confirmedPhase === "REBOUND"
        ? history.reboundConfirmedPrice
        : history.earlyConfirmedPrice
    );
    const confirmationAgeMs = confirmedAtMs > 0
      ? now - confirmedAtMs
      : Number.MAX_SAFE_INTEGER;
    const holdMs = Number(settings.volumeEntryConfirmHoldMs || 45000);
    const minHoldRate = Number(
      settings.volumeEntryConfirmMinPriceHoldRate || 0
    );
    const minHoldPrice = confirmedPrice > 0
      ? confirmedPrice * (1 + minHoldRate / 100)
      : 0;
    const transitionCount = Math.max(
      1,
      Number(settings.volumeEntryConfirmRecentTransitionCount || 2)
    );
    const confirmedSamples = history.samples.filter(sample =>
      Number(sample.time || 0) >= confirmedAtMs
    );
    const recentForHold = confirmedSamples.slice(-(transitionCount + 1));
    const stepRates = [];

    for (let index = 1; index < recentForHold.length; index++) {
      const before = Number(recentForHold[index - 1]?.price || 0);
      const after = Number(recentForHold[index]?.price || 0);
      if (before > 0 && after > 0) {
        stepRates.push(((after - before) / before) * 100);
      }
    }

    const worstStepRate = stepRates.length
      ? Math.min(...stepRates)
      : 0;
    const maxStepDropRate = Number(
      settings.volumeEntryConfirmMaxStepDropRate || -0.30
    );
    const agePass =
      confirmationAgeMs >= 0 &&
      confirmationAgeMs <= holdMs;
    const priceHoldPass =
      confirmedPrice > 0 &&
      current.price >= minHoldPrice;
    const stepHoldPass =
      worstStepRate > maxStepDropRate;

    if (agePass && priceHoldPass && stepHoldPass) {
      history.recentPriceChangeRate = recentPriceChangeRate;
      history.volumeRetentionRate = volumeRetentionRate;
      history.dayPositionDiff = dayPositionDiff;
      history.confirmationReusedAtMs = now;
      history.confirmationReusedAtText = nowText();
      state.volumeCandidateHistory[code] = history;

      return {
        pass: true,
        phase: confirmedPhase,
        confirmationReused: true,
        confirmationAgeMs,
        confirmedPrice,
        currentPrice: current.price,
        recentPriceChangeRate,
        worstStepRate,
        volumeRetentionRate,
        dayPositionDiff,
        pullbackRate: Number(history.pullbackRate || pullbackRate || 0),
        reboundRate: Number(history.reboundRate || 0),
        earlyPriceRiseRate: Number(history.earlyPriceRiseRate || earlyPriceRiseRate || 0),
        pricePersistence: Number(history.pricePersistence || pricePersistence || 0),
        observationCount: Number(history.observationCount || observationCount || 0),
        reason:
          `VOLUME ${confirmedPhase} 확인유지 / ` +
          `확인가 ${confirmedPrice.toLocaleString()}원→현재 ${current.price.toLocaleString()}원 / ` +
          `경과 ${(confirmationAgeMs / 1000).toFixed(1)}초 / ` +
          `최근최대하락 ${worstStepRate.toFixed(2)}%`
      };
    }

    // 확인신호가 깨졌으면 같은 신호를 재사용하지 않고 다시 관찰한다.
    // REBOUND는 눌림 저점부터 새 재상승을 확인하고, EARLY_MOMENTUM은 SURGE부터 다시 확인한다.
    if (confirmedPhase === "REBOUND") {
      history.phase = "PULLBACK";
      history.phaseStartedAtMs = now;
      history.phaseStartedAtText = nowText();
      history.pullbackStartedAtMs = now;
      history.pullbackStartedAtText = nowText();
      history.pullbackLowPrice = Math.min(
        Number(history.pullbackLowPrice || current.price),
        current.price
      );
    } else {
      history.phase = "SURGE";
      history.phaseStartedAtMs = now;
      history.phaseStartedAtText = nowText();
    }

    history.confirmationInvalidatedAtMs = now;
    history.confirmationInvalidatedAtText = nowText();
    history.confirmationInvalidatedReason = !agePass
      ? `유효시간 ${Math.round(confirmationAgeMs / 1000)}초 초과`
      : !priceHoldPass
        ? `확인가 이탈 ${confirmedPrice.toLocaleString()}→${current.price.toLocaleString()}원`
        : `최근 급락 ${worstStepRate.toFixed(2)}%`;

    state.volumeCandidateHistory[code] = history;

    return {
      pass: false,
      phase: history.phase,
      confirmationInvalidated: true,
      confirmationAgeMs,
      confirmedPrice,
      currentPrice: current.price,
      worstStepRate,
      reason:
        `VOLUME ${confirmedPhase} 확인 무효 / ` +
        `${history.confirmationInvalidatedReason} / 재관찰`
    };
  }

  const earlyMomentumMaxChangeRate = Number(
    settings.volumeLateChaseMinChangeRate || 5.5
  );
  const earlyMomentumOverheatDetected =
    settings.volumeOverheatBlockEnabled &&
    current.volumeRatio >= Number(settings.volumeOverheatMinVolumeRatio || 0) &&
    current.changeRate >= Number(settings.volumeOverheatMinChangeRate || 0) &&
    current.dayPosition >= Number(settings.volumeOverheatMinDayPositionRate || 0);
  const isEarlyMomentumZone =
    current.changeRate < earlyMomentumMaxChangeRate &&
    !earlyMomentumOverheatDetected;

  /*
   * 상승 초기 선행진입
   *
   * 기존에는 상승률이 낮은 구간에서도 무조건 눌림을 기다려
   * 천천히 계속 오르는 우량 후보를 매수하지 못했다. 5.5% 미만에서는
   * 30초·3회 이상 가격지속과 거래량유지를 확인하면 추격이 아닌
   * EARLY_MOMENTUM 진입을 허용한다. 5.5% 이상은 기존처럼 눌림·재상승이 필수다.
   */
  const earlyMomentumChecks = {
    enabled: settings.volumeEarlyMomentumEnabled === true,
    zone: isEarlyMomentumZone,
    phase: ["SURGE", "EARLY_MOMENTUM"].includes(history.phase),
    observationCount: observationCount >= Number(
      settings.volumeEarlyMomentumMinObservationCount || 3
    ),
    elapsed: observationElapsedMs >= Number(
      settings.volumeEarlyMomentumMinElapsedMs || 30000
    ),
    minPriceRise: earlyPriceRiseRate >= Number(
      settings.volumeConfirmMinPriceRiseRate || 0.10
    ),
    maxPriceRise: earlyPriceRiseRate <= Number(
      settings.volumeConfirmMaxPriceRiseRate || 1.20
    ),
    recentRise: recentPriceChangeRate > 0,
    persistence: pricePersistence >= Number(
      settings.volumeEarlyMomentumMinPricePersistence || 0.67
    ),
    dayPosition: dayPositionDiff >= -Math.abs(Number(
      settings.volumeConfirmMaxDayPositionDrop || 5
    )),
    volumeRetention: volumeRetentionRate >= Number(
      settings.volumePullbackMinVolumeRetentionRate || 0.70
    )
  };
  const earlyMomentumReady = Object.values(
    earlyMomentumChecks
  ).every(Boolean);
  const earlyMomentumWaitReason = Object.entries(
    earlyMomentumChecks
  ).find(([, passed]) => !passed)?.[0] || "checking";
  const earlyMomentumWaitLabel = ({
    enabled: "기능OFF",
    zone: "초기구간·과열여부",
    phase: "관찰단계",
    observationCount: "관찰횟수",
    elapsed: "관찰시간",
    minPriceRise: "최소가격상승",
    maxPriceRise: "단기추격상한",
    recentRise: "직전가격상승",
    persistence: "가격지속",
    dayPosition: "당일위치유지",
    volumeRetention: "거래량유지",
    checking: "확인중"
  })[earlyMomentumWaitReason] || earlyMomentumWaitReason;

  if (earlyMomentumReady) {
    history.phase = "EARLY_MOMENTUM";
    history.phaseStartedAtMs = now;
    history.phaseStartedAtText = nowText();
    history.earlyPriceRiseRate = earlyPriceRiseRate;
    history.recentPriceChangeRate = recentPriceChangeRate;
    history.pricePersistence = pricePersistence;
    history.volumeRetentionRate = volumeRetentionRate;
    history.dayPositionDiff = dayPositionDiff;
    history.observationCount = observationCount;
    history.earlyConfirmedAtMs = now;
    history.earlyConfirmedAtText = nowText();
    history.earlyConfirmedPrice = current.price;
    state.volumeCandidateHistory[code] = history;

    return {
      pass: true,
      phase: history.phase,
      earlyPriceRiseRate,
      recentPriceChangeRate,
      pricePersistence,
      volumeRetentionRate,
      dayPositionDiff,
      observationCount,
      reason:
        `VOLUME 상승초기 지속확인 / 관찰 ${observationCount}회 / ` +
        `가격 +${earlyPriceRiseRate.toFixed(2)}% / ` +
        `지속 ${(pricePersistence * 100).toFixed(0)}% / ` +
        `거래량유지 ${(volumeRetentionRate * 100).toFixed(0)}%`
    };
  }

  if (history.phase === "EARLY_MOMENTUM" && !isEarlyMomentumZone) {
    history.phase = "SURGE";
    history.phaseStartedAtMs = now;
    history.phaseStartedAtText = nowText();
  }

  if (
    pullbackRate < Number(settings.volumePullbackMaxRate || -1.5)
  ) {
    history.phase = "BROKEN";
    history.phaseStartedAtMs = now;
    history.phaseStartedAtText = nowText();
    state.volumeCandidateHistory[code] = history;
    return {
      pass: false,
      phase: history.phase,
      reason: `VOLUME 눌림 과다 ${pullbackRate.toFixed(2)}%`
    };
  }

  if (
    ["SURGE", "EARLY_MOMENTUM"].includes(history.phase) &&
    pullbackRate <= Number(settings.volumePullbackMinRate || -0.25)
  ) {
    history.phase = "PULLBACK";
    history.phaseStartedAtMs = now;
    history.phaseStartedAtText = nowText();
    history.pullbackStartedAtMs = now;
    history.pullbackStartedAtText = nowText();
    history.pullbackLowPrice = current.price;
    state.volumeCandidateHistory[code] = history;
    return {
      pass: false,
      phase: history.phase,
      reason: `VOLUME 정상눌림 확인 ${pullbackRate.toFixed(2)}% / 재상승 대기`
    };
  }

  if (history.phase === "PULLBACK") {
    history.pullbackLowPrice = Math.min(
      Number(history.pullbackLowPrice || current.price),
      current.price
    );

    // 재상승률은 직전 한 틱이 아니라 실제 눌림 저점부터 회복한 폭으로 계산한다.
    // 기존 계산은 작은 한 틱 반등만으로 통과해 하락 중인 추격진입을 허용할 수 있었다.
    const reboundBasePrice = Number(history.pullbackLowPrice || 0);
    const reboundRate = reboundBasePrice > 0
      ? ((current.price - reboundBasePrice) / reboundBasePrice) * 100
      : 0;

    if (
      volumeRetentionRate <
      Number(settings.volumePullbackMinVolumeRetentionRate || 0.70)
    ) {
      state.volumeCandidateHistory[code] = history;
      return {
        pass: false,
        phase: history.phase,
        reason: `VOLUME 눌림 거래량 유지 부족 ${(volumeRetentionRate * 100).toFixed(0)}%`
      };
    }

    if (
      dayPositionDiff <
      -Math.abs(Number(settings.volumePullbackMaxDayPositionDrop || 10))
    ) {
      state.volumeCandidateHistory[code] = history;
      return {
        pass: false,
        phase: history.phase,
        reason: `VOLUME 눌림 당일위치 약화 ${dayPositionDiff.toFixed(1)}%p`
      };
    }

    if (
      reboundRate >= Number(settings.volumeReboundMinRate || 0.15) &&
      recentPriceChangeRate > 0
    ) {
      history.phase = "REBOUND";
      history.phaseStartedAtMs = now;
      history.phaseStartedAtText = nowText();
      history.pullbackRate = pullbackRate;
      history.reboundRate = reboundRate;
      history.recentPriceChangeRate = recentPriceChangeRate;
      history.volumeRetentionRate = volumeRetentionRate;
      history.dayPositionDiff = dayPositionDiff;
      history.reboundConfirmedAtMs = now;
      history.reboundConfirmedAtText = nowText();
      history.reboundConfirmedPrice = current.price;
      state.volumeCandidateHistory[code] = history;
      return {
        pass: true,
        phase: history.phase,
        pullbackRate,
        reboundRate,
        recentPriceChangeRate,
        volumeRetentionRate,
        dayPositionDiff,
        reason:
          `VOLUME 눌림후 재상승 / 눌림 ${pullbackRate.toFixed(2)}% / ` +
          `저점회복 +${reboundRate.toFixed(2)}% / ` +
          `직전 +${recentPriceChangeRate.toFixed(2)}% / ` +
          `거래량유지 ${(volumeRetentionRate * 100).toFixed(0)}%`
      };
    }
  }

  /*
   * 단계 시간초과는 현재 가격의 진입/전환 판단을 모두 마친 뒤 적용한다.
   * 예: PULLBACK 511초째에 +0.67% 재상승이 나왔다면 예전처럼 RESET부터 하지 않고
   * 위 REBOUND 판정을 먼저 수행한다.
   */
  const phaseAgeMs = getCurrentPhaseAgeMs();

  if (
    ["SURGE", "PULLBACK"].includes(history.phase) &&
    phaseAgeMs > maxPhaseWaitMs
  ) {
    const expiredPhase = String(history.phase || "SURGE");
    resetVolumeObservation(expiredPhase);
    return {
      pass: false,
      phase: "RESET",
      phaseAgeMs,
      reason:
        `VOLUME ${expiredPhase} 단계 ` +
        `${Math.round(phaseAgeMs / 1000)}초 초과 / 현재 진입신호 없음 / 기준 재설정`
    };
  }

  state.volumeCandidateHistory[code] = history;
  return {
    pass: false,
    phase: history.phase,
    pullbackRate,
    reboundRate: Number(history.reboundRate || 0),
    recentPriceChangeRate,
    earlyPriceRiseRate,
    pricePersistence,
    volumeRetentionRate,
    dayPositionDiff,
    observationCount,
    observationElapsedMs,
    currentChangeRate: current.changeRate,
    reason:
      history.phase === "PULLBACK"
        ? `VOLUME 눌림후 재상승 대기 / 직전 ${recentPriceChangeRate >= 0 ? "+" : ""}${recentPriceChangeRate.toFixed(2)}%`
        : history.phase === "BROKEN"
          ? `VOLUME 추세이탈 / 고점대비 ${pullbackRate.toFixed(2)}%`
          : `VOLUME 상승초기 지속관찰 / 가격 ${earlyPriceRiseRate >= 0 ? "+" : ""}${earlyPriceRiseRate.toFixed(2)}% / ` +
            `지속 ${(pricePersistence * 100).toFixed(0)}% / 대기 ${earlyMomentumWaitLabel}`
  };
}

function cleanupCandidateHistory(state) {
  const now = Date.now();
  const maxAge = settings.candidateHistoryMaxAgeMs;

  for (const key of Object.keys(state.coreCandidateHistory || {})) {
    const row = state.coreCandidateHistory[key] || {};
    const lastSeenAtMs = Number(row.lastSeenAtMs || row.time || row.firstSeenAtMs || 0);
    if (now - lastSeenAtMs > maxAge) {
      delete state.coreCandidateHistory[key];
    }
  }

  for (const key of Object.keys(state.volumeCandidateHistory || {})) {
    const row = state.volumeCandidateHistory[key] || {};
    const lastSeenAtMs = Number(row.lastSeenAtMs || row.time || row.firstSeenAtMs || 0);
    if (now - lastSeenAtMs > maxAge) {
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
      "CORE",
      item
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

  const coreDailyLimit = checkStrategyDailyBuyLimit(state, "CORE");
  if (coreDailyLimit.blocked) {
    return { pass: false, reason: coreDailyLimit.reason };
  }

  const coreLossCooldown = checkLossExitBuyCooldown(state, item.code);
  if (coreLossCooldown.blocked) {
    return { pass: false, reason: coreLossCooldown.reason };
  }

  const cooldown =
    isStrategyBuyCooldown(
      state,
      "CORE",
      item.code
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
   * 발견점수와 상승률을 통과한 후보는 거래량·유동성·당일위치가
   * 아직 경계 밖이어도 관찰목록과 추세표본을 먼저 갱신한다.
   * 최종 매수에서는 아래 기존 조건을 모두 다시 검사한다.
   */
  updateCandidateWatchList(state, item, price, "CORE");
  const coreTrendObservation =
    isCoreCandidateGettingStronger(state, item, price);

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
   * CORE 안정형 과열 차단
   * 상승률과 거래량이 동시에 높으면 안정형 CORE보다 급등형 성격이 강하므로 제외한다.
   */
  if (
    settings.coreOverheatBlockEnabled &&
    volumeRatio >= Number(settings.coreOverheatMinVolumeRatio || 0) &&
    changeRate >= Number(settings.coreOverheatMinChangeRate || 0)
  ) {
    return {
      pass: false,
      reason:
        `CORE 동시과열 차단 / ` +
        `상승률 ${changeRate.toFixed(2)}% / ` +
        `거래량 ${volumeRatio.toFixed(1)}% / ` +
        `기준 ${Number(settings.coreOverheatMinChangeRate || 0).toFixed(2)}%+` +
        `${Number(settings.coreOverheatMinVolumeRatio || 0).toFixed(1)}%`
    };
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
  const rankCheck = coreTrendObservation;

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

  const coreConfirmPriceRiseRate = Number(rankCheck?.priceDiffRate || 0);
  if (
    coreConfirmPriceRiseRate <
    Number(settings.coreConfirmMinPriceRiseRate || 0)
  ) {
    return {
      pass: false,
      reason:
        `CORE 30초 가격상승 미충족 ${coreConfirmPriceRiseRate.toFixed(2)}% / ` +
        `최소 ${Number(settings.coreConfirmMinPriceRiseRate || 0).toFixed(2)}%`
    };
  }

  const coreCandidateStrength = resolveCandidateStrength(
    state,
    item,
    "CORE"
  );
  if (
    Number(coreCandidateStrength.score || 0) <
    Number(settings.coreMinCandidateStrengthScore || 0)
  ) {
    return {
      pass: false,
      reason:
        `CORE 후보강도 부족 ${Number(coreCandidateStrength.score || 0).toFixed(1)}점 / ` +
        `기준 ${Number(settings.coreMinCandidateStrengthScore || 0).toFixed(1)}점 / ` +
        `출처 ${coreCandidateStrength.source}`
    };
  }

  const coreReentryCheck = checkSameDayReentryCandidate(
    state,
    item,
    price,
    "CORE"
  );

  if (!coreReentryCheck.pass) {
    return {
      pass: false,
      reason: `CORE ${coreReentryCheck.reason}`
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
      "VOLUME",
      item
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

  const volumeDailyLimit = checkStrategyDailyBuyLimit(state, "VOLUME");
  if (volumeDailyLimit.blocked) {
    return { pass: false, reason: volumeDailyLimit.reason };
  }

  const volumeLossCooldown = checkLossExitBuyCooldown(state, item.code);
  if (volumeLossCooldown.blocked) {
    return { pass: false, reason: volumeLossCooldown.reason };
  }

  const cooldown =
    isStrategyBuyCooldown(
      state,
      "VOLUME",
      item.code
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

  const leaderWatch = evaluateLeaderWatchCandidateFromState(
    state,
    item,
    price
  );

  const leaderContinuationZone =
    changeRate > Number(settings.volumeMaxChangeRate || 0) &&
    leaderWatch.pass &&
    changeRate <= Number(settings.leaderWatchCurrentMaxChangeRate || 0);

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
    (
      changeRate > settings.volumeMaxChangeRate &&
      !leaderContinuationZone
    )
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
   * VOLUME도 발견점수·상승률 통과 시점부터 관찰한다.
   * 거래량과 위치가 기준을 넘는 순간 이미 누적된 실제 추세표본으로
   * 판단하되, 최종 거래량·유동성·위치·과열 조건은 그대로 유지한다.
   */
  updateCandidateWatchList(state, item, price, "VOLUME");
  const volumeTrendObservation =
    isVolumeCandidateGettingStronger(state, item, price);

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
 * VOLUME 과열 차단
 * 1) 거래량 1000% 이상은 조건과 관계없이 초과열 차단
 * 2) 거래량 300% 이상 + 상승률 5% 이상 + 당일위치 60% 이상이면 추격매수 차단
 */
if (
  settings.volumeExtremeOverheatBlockEnabled &&
  volumeRatio >= Number(settings.volumeExtremeOverheatMinVolumeRatio || 0)
) {
  return {
    pass: false,
    reason:
      `VOLUME 초과열 거래량 차단 / ` +
      `거래량 ${volumeRatio.toFixed(1)}% / ` +
      `기준 ${Number(settings.volumeExtremeOverheatMinVolumeRatio || 0).toFixed(1)}%`
  };
}

const volumeOverheatDetected =
  settings.volumeOverheatBlockEnabled &&
  volumeRatio >= Number(settings.volumeOverheatMinVolumeRatio || 0) &&
  changeRate >= Number(settings.volumeOverheatMinChangeRate || 0) &&
  dayPosition >= Number(settings.volumeOverheatMinDayPositionRate || 0);

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
  const rankCheck = volumeTrendObservation;

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

  if (
    leaderContinuationZone &&
    rankCheck?.phase !== "REBOUND"
  ) {
    return {
      pass: false,
      reason:
        `LEADER_WATCH 상한초과 안전확인 / 최초 ` +
        `${leaderWatch.firstChangeRate.toFixed(2)}% / 현재 ${changeRate.toFixed(2)}% / ` +
        `즉시추격 금지·눌림후 REBOUND 필요`
    };
  }

  if (
    volumeOverheatDetected &&
    rankCheck?.phase !== "REBOUND"
  ) {
    return {
      pass: false,
      reason:
        `VOLUME 동시과열 안전확인 대기 / ` +
        `상승률 ${changeRate.toFixed(2)}% / ` +
        `거래량 ${volumeRatio.toFixed(1)}% / ` +
        `당일위치 ${dayPosition.toFixed(1)}% / ` +
        `즉시추격 금지·눌림후 REBOUND 필요`
    };
  }

  const volumeCandidateStrength = resolveCandidateStrength(
    state,
    item,
    "VOLUME"
  );

  if (
    Number(volumeCandidateStrength.score || 0) <
    Number(settings.volumeMinCandidateStrengthScore || 0)
  ) {
    return {
      pass: false,
      reason:
        `VOLUME 후보강도 부족 ${Number(volumeCandidateStrength.score || 0).toFixed(1)}점 / ` +
        `기준 ${Number(settings.volumeMinCandidateStrengthScore || 0).toFixed(1)}점 / ` +
        `출처 ${volumeCandidateStrength.source}`
    };
  }


  if (
    leaderContinuationZone &&
    Number(volumeCandidateStrength.score || 0) <
      Number(settings.leaderWatchMinBuyStrengthScore || 0)
  ) {
    return {
      pass: false,
      reason:
        `LEADER_WATCH 후보강도 부족 ` +
        `${Number(volumeCandidateStrength.score || 0).toFixed(1)}점 / ` +
        `기준 ${Number(settings.leaderWatchMinBuyStrengthScore || 0).toFixed(1)}점`
    };
  }

  const volumeReentryCheck = checkSameDayReentryCandidate(
    state,
    item,
    price,
    "VOLUME"
  );

  if (!volumeReentryCheck.pass) {
    return {
      pass: false,
      reason: `VOLUME ${volumeReentryCheck.reason}`
    };
  }

  if (
    settings.volumeLateChaseBlockEnabled &&
    changeRate >= Number(settings.volumeLateChaseMinChangeRate || 0) &&
    (
      Number(volumeCandidateStrength.score || 0) <
        Number(settings.volumeLateChaseMinCandidateStrengthScore || 0) ||
      dayPosition < Number(settings.volumeLateChaseMinDayPositionRate || 0)
    )
  ) {
    return {
      pass: false,
      reason:
        `VOLUME 후반추격 차단 / 상승 ${changeRate.toFixed(2)}% / ` +
        `후보강도 ${Number(volumeCandidateStrength.score || 0).toFixed(1)}점 / ` +
        `당일위치 ${dayPosition.toFixed(1)}% / ` +
        `기준 상승 ${Number(settings.volumeLateChaseMinChangeRate || 0).toFixed(2)}% 이상은 ` +
        `강도 ${Number(settings.volumeLateChaseMinCandidateStrengthScore || 0).toFixed(1)}점·` +
        `위치 ${Number(settings.volumeLateChaseMinDayPositionRate || 0).toFixed(1)}% 필요`
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
 * 명시적인 후보강도 값이 없을 때 매수 심사와
 * 장 종료 후 품질 분석에 공통으로 사용하는 보완 진단값이다.
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

/*
 * 매수 심사와 체결기록이 동일한 후보강도를 사용하도록 단일 해석 경로를 둔다.
 * 기존에는 심사는 watchScoreDetail 진단값만 보고, 체결기록은 item의 명시값을
 * 우선 사용하여 29점 후보가 50점으로 심사를 통과하는 불일치가 있었다.
 */
function resolveCandidateStrength(
  state,
  item = {},
  strategyGroup = "CORE"
) {
  const watchList = strategyGroup === "CORE"
    ? state.coreCandidateWatchList || []
    : state.volumeCandidateWatchList || [];

  const normalizedCode = String(item.code || "").padStart(6, "0");
  const watchItem = watchList.find(row =>
    String(row.code || "").padStart(6, "0") === normalizedCode
  ) || null;

  const scoreDetail =
    item.watchScoreDetail ??
    watchItem?.watchScoreDetail ??
    {};

  const diagnostic = calculateCandidateStrengthDiagnostic(scoreDetail);
  const explicitCandidates = [
    item.candidateStrengthScore,
    item.leaderStrengthScore,
    scoreDetail.candidateStrengthScore,
    scoreDetail.leaderStrengthScore,
    watchItem?.candidateStrengthScore,
    watchItem?.leaderStrengthScore,
    watchItem?.itemSnapshot?.candidateStrengthScore,
    watchItem?.itemSnapshot?.leaderStrengthScore
  ];

  const explicit = explicitCandidates.find(value =>
    value !== undefined &&
    value !== null &&
    value !== "" &&
    Number.isFinite(Number(value)) &&
    Number(value) > 0
  );

  const score = explicit !== undefined
    ? Number(explicit)
    : Number(diagnostic.score || 0);

  return {
    score: Math.max(0, Math.min(100, score)),
    source: explicit !== undefined ? "EXPLICIT" : "DIAGNOSTIC",
    diagnostic,
    scoreDetail,
    watchItem
  };
}


async function paperBuy(
  state,
  item,
  price,
  strategyGroup,
  reason
) {
  // 통과 판단 직후에도 현재가를 다시 받아 오래된 HOT·순환검색 가격으로
  // 주문하지 않도록 한다. 새 가격에서 조건이 깨지면 주문 API를 호출하지 않는다.
  try {
    const realtimeItem = await fetchCandidateRealtime(
      item.code,
      item,
      String(strategyGroup || "CORE").toLowerCase()
    );
    const realtimePrice = Math.abs(Number(
      realtimeItem.currentPrice || realtimeItem.price || 0
    ));

    if (!realtimePrice) {
      console.log(
        `[${strategyGroup} 매수제외] ${item.name || item.code} / ` +
        `주문 직전 현재가 없음`
      );
      return false;
    }

    const refreshedItem = {
      ...item,
      ...realtimeItem,
      raw: {
        ...(item.raw || {}),
        ...(realtimeItem.raw || {})
      }
    };
    const refreshedJudge = strategyGroup === "CORE"
      ? judgeCoreBuy(state, refreshedItem, realtimePrice)
      : judgeVolumeBuy(state, refreshedItem, realtimePrice);

    if (!refreshedJudge.pass) {
      console.log(
        `[${strategyGroup} 매수제외] ${item.name || item.code} / ` +
        `주문 직전 재검증 탈락 / ${refreshedJudge.reason}`
      );
      return false;
    }

    item = refreshedItem;
    price = realtimePrice;
  } catch (err) {
    console.log(
      `[${strategyGroup} 매수제외] ${item.name || item.code} / ` +
      `주문 직전 시세확인 실패 / ${err.message}`
    );
    return false;
  }

  // 심사와 주문 사이에 다른 루프가 매수했을 수 있으므로 주문 직전 재확인한다.
  const dailyLimit = checkStrategyDailyBuyLimit(state, strategyGroup);
  if (dailyLimit.blocked) {
    console.log(`[${strategyGroup} 매수제외] ${dailyLimit.reason}`);
    return false;
  }

  const lossCooldown = checkLossExitBuyCooldown(state, item.code);
  if (lossCooldown.blocked) {
    console.log(`[${strategyGroup} 매수제외] ${lossCooldown.reason}`);
    return false;
  }

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

    // 당일 최초자산의 설정 비율
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

    const requestedBuyChangeRate = Number(
      item.changeRate ??
      item.fluctuationRate ??
      item.riseRate ??
      item.rate ??
      watchScoreDetail?.changeRate ??
      watchItem?.itemSnapshot?.changeRate ??
      0
    );

    const volumeEntryConfirmation = strategyGroup === "VOLUME"
      ? state.volumeCandidateHistory?.[item.code] || null
      : null;

    // 심사함수 밖에서 paperBuy가 호출되는 경로가 생겨도 후반 추격매수는
    // 눌림·재상승 확인 없이는 주문 API까지 도달하지 못하게 마지막으로 방어한다.
    if (
      strategyGroup === "VOLUME" &&
      settings.volumeLateChaseBlockEnabled &&
      requestedBuyChangeRate >= Number(settings.volumeLateChaseMinChangeRate || 0)
    ) {
      const confirmedAtMs = Number(
        volumeEntryConfirmation?.reboundConfirmedAtMs || 0
      );
      const confirmationAgeMs = confirmedAtMs > 0
        ? Date.now() - confirmedAtMs
        : Number.MAX_SAFE_INTEGER;
      const confirmationMaxAgeMs = Number(
        settings.volumePullbackMaxWaitMs || 180000
      );

      if (
        volumeEntryConfirmation?.phase !== "REBOUND" ||
        confirmationAgeMs < 0 ||
        confirmationAgeMs > confirmationMaxAgeMs
      ) {
        console.log(
          `[VOLUME 매수제외] ${name} / 후반추격 눌림·재상승 확인 없음 / ` +
          `상승 ${requestedBuyChangeRate.toFixed(2)}% / ` +
          `단계 ${volumeEntryConfirmation?.phase || "NONE"}`
        );
        return false;
      }
    }

    if (strategyGroup === "VOLUME" && volumeEntryConfirmation) {
      const volumeEntryDetail =
        volumeEntryConfirmation.phase === "EARLY_MOMENTUM"
          ? (
              `상승초기 +${Number(volumeEntryConfirmation.earlyPriceRiseRate || 0).toFixed(2)}% / ` +
              `가격지속 ${(Number(volumeEntryConfirmation.pricePersistence || 0) * 100).toFixed(0)}% / ` +
              `관찰 ${Number(volumeEntryConfirmation.observationCount || 0)}회`
            )
          : (
              `눌림 ${Number(volumeEntryConfirmation.pullbackRate || 0).toFixed(2)}% / ` +
              `저점회복 +${Number(volumeEntryConfirmation.reboundRate || 0).toFixed(2)}% / ` +
              `직전 +${Number(volumeEntryConfirmation.recentPriceChangeRate || 0).toFixed(2)}%`
            );

      console.log(
        `[VOLUME 진입확인] ${name} / ` +
        `단계 ${volumeEntryConfirmation.phase || "-"} / ` +
        volumeEntryDetail
      );
    }

    const reentryCheck = checkSameDayReentryCandidate(
      state,
      item,
      price,
      strategyGroup
    );

    if (!reentryCheck.pass) {
      console.log(
        `[${strategyGroup} 매수제외] ${name} / ${reentryCheck.reason}`
      );
      return false;
    }

    if (reentryCheck.isReentry) {
      console.log(
        `[${strategyGroup} 재진입확인] ${name} / ${reentryCheck.reason}`
      );
    }

    const buyRequestedAtMs = Date.now();
    const positionId =
      `${todayKey()}_${normalizeTradeCode(item.code)}_${buyRequestedAtMs}`;
    const executionId = `BUY_${positionId}`;

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
        reason,
        positionId,
        executionId,
        buyRequestedAtMs
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

    const buyChangeRate = requestedBuyChangeRate;

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

    const resolvedCandidateStrength = resolveCandidateStrength(
      state,
      item,
      strategyGroup
    );
    const candidateStrengthDiagnostic = resolvedCandidateStrength.diagnostic;
    const candidateStrengthScore = Number(resolvedCandidateStrength.score || 0);

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
      buyOpenPositionRate,

      volumeEntryPhase:
        volumeEntryConfirmation?.phase || null,
      volumeEntryPullbackRate: Number(
        volumeEntryConfirmation?.pullbackRate || 0
      ),
      volumeEntryReboundRate: Number(
        volumeEntryConfirmation?.reboundRate || 0
      ),
      volumeEntryRecentPriceChangeRate: Number(
        volumeEntryConfirmation?.recentPriceChangeRate || 0
      ),
      volumeEntryVolumeRetentionRate: Number(
        volumeEntryConfirmation?.volumeRetentionRate || 0
      ),
      volumeEntryConfirmedAt:
        volumeEntryConfirmation?.reboundConfirmedAtText ||
        volumeEntryConfirmation?.earlyConfirmedAtText ||
        null,
      volumeEntryEarlyPriceRiseRate: Number(
        volumeEntryConfirmation?.earlyPriceRiseRate || 0
      ),
      volumeEntryPricePersistence: Number(
        volumeEntryConfirmation?.pricePersistence || 0
      ),
      volumeEntryObservationCount: Number(
        volumeEntryConfirmation?.observationCount || 0
      ),

      positionId,
      isSameDayReentry: reentryCheck.isReentry === true,
      reentryPreviousStrength: Number(
        reentryCheck.previousStrength || 0
      ),
      reentryCurrentStrength: Number(
        reentryCheck.currentStrength || 0
      ),
      reentryRecoveryRate: Number(
        reentryCheck.recoveryRate || 0
      )
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
      buyTime: buyRequestedAtMs,
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
      timestampMs: buyRequestedAtMs,
      executionId,
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

    if (!state.lastBuyAtMsByStrategy) {
      state.lastBuyAtMsByStrategy = {};
    }
    state.lastBuyAtMsByStrategy[strategyGroup] = Date.now();

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

  if (!Array.isArray(state.completedFullSellCodes)) {
    state.completedFullSellCodes = [];
  }

  const normalizedSellCode = String(holding.code || "")
    .replace(/^A/, "")
    .padStart(6, "0");
  const completedFullSellKey =
    `${todayKey()}_${normalizedSellCode}_${getHoldingPositionToken(holding)}`;

  if (
    completedFullSellKeys.has(completedFullSellKey) ||
    state.completedFullSellCodes.includes(completedFullSellKey)
  ) {
    console.log(
      `[${sellType} 제외] ${holding.name} / 당일 전량매도 완료 종목`
    );
    return false;
  }

  const qty = Math.min(
    Number(sellQty || 0),
    Number(holding.qty || 0)
  );

  if (qty <= 0) {
    return false;
  }

  const isFullExitRequest = qty >= Number(holding.qty || 0);

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
    const sellSignalAt =
      sellSignalDetail?.signalAt ||
      nowText();

    const sellSignalPrice = Number(
      sellSignalDetail?.signalPrice ??
      sellPrice ??
      0
    );

    const sellOrderRequestedAt = nowText();
    const sellRequestedAtMs = Date.now();
    const executionId = [
      "SELL",
      holding.positionId || completedFullSellKey,
      sellRequestedAtMs,
      qty,
      sellType
    ].join("_");

    const result = await postJson(
      `${API_BASE}/api/core-paper-sell`,
      {
        code: holding.code,
        price: sellPrice,
        qty,
        sellType,
        reason,
        positionId: holding.positionId || null,
        executionId,
        sellRequestedAtMs,
        signalAt: sellSignalAt,
        signalAtMs: Number(sellSignalDetail?.signalAtMs || 0),
        signalPrice: sellSignalPrice,
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

    // 서버가 전량매도를 승인한 즉시 완료키를 먼저 저장한다.
    // 이후 분석로그 처리나 다른 루프의 오래된 상태 저장이 겹쳐도 재주문을 막는다.
    if (isFullExitRequest) {
      completedFullSellKeys.add(completedFullSellKey);
      if (!state.completedFullSellCodes.includes(completedFullSellKey)) {
        state.completedFullSellCodes.push(completedFullSellKey);
      }
      saveState(state);
    }

    // 실제 1차 익절 매도가 성공한 뒤에만 완료 상태를 저장한다.
    if (String(sellType || "").includes("_FIRST_TAKE_PROFIT")) {
      holding.firstTakeProfitDone = true;
    }

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
      timestampMs: sellRequestedAtMs,
      executionId,
      type: sellType,

      code: holding.code,
      name: holding.name,
      strategyGroup:
        holding.strategyGroup,
      positionId:
        holding.positionId || null,
      buyTime: Number(
        holding.buyTime || holding.buyTimeMs || 0
      ),

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

    if (isLossExit) {
      state.lastLossExitAtMs = Date.now();
      state.lastLossExitStrategy = holding.strategyGroup;
      state.lastLossExitCode = holding.code;

      // 손절 전 관찰이력을 재진입 신호로 재사용하지 않는다.
      // 쿨다운 뒤 현재 가격으로 새 관찰을 시작해야만 재진입할 수 있다.
      if (state.coreCandidateHistory) {
        delete state.coreCandidateHistory[holding.code];
      }
      if (state.volumeCandidateHistory) {
        delete state.volumeCandidateHistory[holding.code];
      }
      removeCandidateFromWatchLists(
        state,
        holding.code
      );
    }

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

      const sellPrice = await fetchPrice(code, "sell");
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

  const breakEvenStartRate = isCore
    ? settings.coreBreakEvenStartRate
    : settings.volumeBreakEvenStartRate;

  const breakEvenProtectRate = isCore
    ? settings.coreBreakEvenProtectRate
    : settings.volumeBreakEvenProtectRate;

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
  // CORE는 최고수익만 되돌렸다는 이유로 강한 보유추세를 즉시 버리지 않는다.
  // 점수 하락·낮은 당일위치·낮은 절대 보유점수 중 하나가 확인될 때만 보호청산한다.
  const coreBreakEvenTrendWeak = !isCore || (
    holdingScoreDiff <= Number(settings.coreBreakEvenWeakMinScoreDrop || -10) ||
    currentDayPosition <= Number(settings.coreBreakEvenWeakMaxDayPositionRate || 60) ||
    holdingScore <= Number(settings.coreBreakEvenWeakMaxHoldingScore || 80)
  );

  if (
    highestProfitRate >=
      breakEvenStartRate &&
    profitRate <=
      breakEvenProtectRate &&
    coreBreakEvenTrendWeak
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
        (isCore
          ? `보유점수 ${holdingScore.toFixed(1)} / 점수변화 ${holdingScoreDiff.toFixed(1)} / ` +
            `당일위치 ${currentDayPosition.toFixed(1)}% / `
          : "") +
        `시작기준 ${breakEvenStartRate.toFixed(2)}% / ` +
        `방어기준 ${breakEvenProtectRate.toFixed(2)}%`
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
    collectOpenPriorityHotObservations(state);
    console.log(
      `[후보재평가 관찰전용] ${getOpenPriorityBlockReason(state)} / ` +
      `실시간재조회·점수계산은 계속하고 주문만 보류`
    );
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

  // 같은 종목·같은 전략 중복 제거 후 점수순으로 정렬한다.
  const dedupedTargets = Array.from(
    new Map(
      watchTargets.map(candidate => [
        `${candidate.recheckStrategy}_${candidate.code}`,
        candidate
      ])
    ).values()
  ).sort((a, b) =>
    Number(b.watchScore || 0) - Number(a.watchScore || 0) ||
    Number(b.lastSeenAt || 0) - Number(a.lastSeenAt || 0)
  );

  // CORE/VOLUME 양쪽에 같은 종목이 있으면 두 전략 판단은 모두 유지하되,
  // 1회 재평가에서 실시간으로 조회할 고유 종목 수만 제한한다.
  const maxCodeCount = Math.max(
    1,
    Number(settings.candidateWatchEvalMaxCodeCount || 10)
  );
  const selectedCodes = new Set();
  const uniqueTargets = [];

  for (const candidate of dedupedTargets) {
    const code = String(candidate.code || "").padStart(6, "0");
    if (!selectedCodes.has(code)) {
      if (selectedCodes.size >= maxCodeCount) continue;
      selectedCodes.add(code);
    }
    uniqueTargets.push(candidate);
  }

  if (!uniqueTargets.length) {
    return;
  }

  console.log(
    `[후보재평가] 시작 / 전략대상 ${uniqueTargets.length}개 / ` +
    `실시간종목 ${selectedCodes.size}/${maxCodeCount}개`
  );

  // 같은 종목이 CORE와 VOLUME에 동시에 있으면 /api/price를 한 번만 호출한다.
  const realtimeByCode = new Map();
  const watchStartedAtMs = Date.now();
  const watchMaxRunMs = Math.max(
    5000,
    Number(settings.candidateWatchMaxRunMs || 20000)
  );

  for (const candidate of uniqueTargets) {
    if (
      realtimeByCode.size > 0 &&
      Date.now() - watchStartedAtMs >= watchMaxRunMs
    ) {
      console.log(
        `[후보재평가] 시간상한 도달 / ` +
        `${((Date.now() - watchStartedAtMs) / 1000).toFixed(1)}초 / ` +
        `나머지는 다음 회차로 이월`
      );
      break;
    }

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
    const realtimeCode = String(candidate.code || "").padStart(6, "0");
    const fetchedThisTurn = !realtimeByCode.has(realtimeCode);

    try {
      if (realtimeByCode.has(realtimeCode)) {
        const sharedRealtime = realtimeByCode.get(realtimeCode);
        realtimeItem = {
          ...sharedRealtime,
          // 공유한 것은 실시간 시세이고 후보 고유 발견점수는 전략별 저장값을 유지한다.
          discoverScore: Number(
            candidate.discoverScore ??
            candidate.itemSnapshot?.discoverScore ??
            sharedRealtime.discoverScore ??
            0
          )
        };
      } else {
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
          },
          String(strategyGroup || "CORE").toLowerCase()
        );
        realtimeByCode.set(realtimeCode, realtimeItem);
      }
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
      `상승률 ${Number(latestWatchScoreDetail.changeRatePart || 0).toFixed(1)} / ` +
      `섹터 ${Number(latestWatchScoreDetail.sectorPart || 0).toFixed(1)} / ` +
      `경로 ${candidate.isLeaderWatch === true ? "LEADER_WATCH" : (candidate.candidateSource || "WATCH")}`
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

      if (fetchedThisTurn) {
        await sleep(settings.candidateWatchPriceDelayMs);
      }
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
      if (fetchedThisTurn) {
        await sleep(settings.candidateWatchPriceDelayMs);
      }
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

    if (fetchedThisTurn) {
      await sleep(settings.candidateWatchPriceDelayMs);
    }
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
    collectOpenPriorityHotObservations(state);
    console.log(
      `[BUY 관찰전용] ${getOpenPriorityBlockReason(state)} / ` +
      `전체검색·시장표본·점수계산은 계속하고 주문만 보류`
    );
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
 * 현재 HOT에는 없지만 최근 5분 안에 탐지된 후보도 후보강화 목록에 유지한다.
 * 누적 스냅샷으로 바로 주문하지 않고 후보재평가에서 실시간 가격을 다시 조회한다.
 */
collectHotCandidatesIntoWatchLists(state, {
  observeCurrent: false,
  logPrefix: "HOT 누적연결"
});

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
  calculateStableMarketTemperature(
    state,
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
  `대상 ${marketTemperature.total}개 / ` +
  `표본 ${marketTemperature.sampleMode || "DIRECT"} ` +
  `${Number(marketTemperature.sampleCount ?? marketTemperature.total ?? 0)}/` +
  `${Number(settings.marketTemperatureMinSampleCount || 120)}개 / ` +
  `${marketTemperature.reason || "-"}`
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

if (candidateSource === "HOT" || candidateSource === "HOT_EARLY") {
  console.log(
    `[${candidateSource === "HOT_EARLY" ? "HOT-EARLY 조기평가" : "HOT 즉시평가"}] ${name}(${item.code}) / ` +
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
      },
      "sell"
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

  console.log(
    `[설정확인] 종목당 최초자산 ${Number(settings.buyAssetRatio || 0) * 100}% / ` +
    `CORE ${settings.coreStartTime}~${settings.coreEndTime}·보유/일일 ` +
    `${settings.coreMaxHoldingCount}/${settings.coreMaxDailyBuyCount}종목 / ` +
    `VOLUME ${settings.volumeStartTime}~${settings.volumeEndTime}·보유/일일 ` +
    `${settings.volumeMaxHoldingCount}/${settings.volumeMaxDailyBuyCount}종목`
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
  let sellPendingSinceMs = 0;
  let buyPending = false;
  let buyPendingSinceMs = 0;
  let buyPendingScheduled = false;
  let candidateWatchPending = false;
  let candidateWatchPendingSinceMs = 0;
  let candidateWatchPendingScheduled = false;
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

  function reserveBuyCheck(reason) {
    const wasAlreadyPending = buyPending;
    buyPending = true;
    if (!buyPendingSinceMs) {
      buyPendingSinceMs = Date.now();
    }

    if (!wasAlreadyPending) {
      console.log(
        `[BUY LOOP] 다른 작업 진행중 / 종료 직후 점검 예약 / ${reason}`
      );
    }
  }

  function schedulePendingBuyIfReady() {
    if (
      !buyPending ||
      buyPendingScheduled ||
      isTraderBusy()
    ) {
      return;
    }

    buyPendingScheduled = true;

    setImmediate(async () => {
      buyPendingScheduled = false;

      if (!buyPending || isTraderBusy()) {
        return;
      }

      const pendingWaitMs = buyPendingSinceMs > 0
        ? Math.max(0, Date.now() - buyPendingSinceMs)
        : 0;

      buyPending = false;
      buyPendingSinceMs = 0;

      console.log(
        `[BUY LOOP] 예약점검 실행 / 대기 ${(pendingWaitMs / 1000).toFixed(1)}초`
      );

      await runBuySafely();
    });
  }

  function reserveCandidateWatch(reason) {
    const wasAlreadyPending = candidateWatchPending;
    candidateWatchPending = true;

    if (!candidateWatchPendingSinceMs) {
      candidateWatchPendingSinceMs = Date.now();
    }

    if (!wasAlreadyPending) {
      console.log(
        `[후보재평가 LOOP] 다른 작업 진행중 / ` +
        `종료 직후 재평가 예약 / ${reason}`
      );
    }
  }

  function schedulePendingCandidateWatchIfReady() {
    if (
      !candidateWatchPending ||
      candidateWatchPendingScheduled ||
      sellPending ||
      buyPending ||
      buyPendingScheduled ||
      isTraderBusy()
    ) {
      return;
    }

    candidateWatchPendingScheduled = true;

    setImmediate(async () => {
      candidateWatchPendingScheduled = false;

      if (
        !candidateWatchPending ||
        sellPending ||
        buyPending ||
        buyPendingScheduled ||
        isTraderBusy()
      ) {
        return;
      }

      const pendingWaitMs = candidateWatchPendingSinceMs > 0
        ? Math.max(0, Date.now() - candidateWatchPendingSinceMs)
        : 0;

      candidateWatchPending = false;
      candidateWatchPendingSinceMs = 0;

      console.log(
        `[후보재평가 LOOP] 예약점검 실행 / ` +
        `대기 ${(pendingWaitMs / 1000).toFixed(1)}초`
      );

      await runCandidateWatchSafely();
    });
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

    const sellCheckAgeMs = Date.now() - Number(lastSellPriorityCheckAt || 0);
    if (
      lastSellPriorityCheckAt > 0 &&
      sellCheckAgeMs >= 0 &&
      sellCheckAgeMs <= Number(settings.sellPriorityFreshMs || 0)
    ) {
      return;
    }

    console.log(
      `[${taskName}] 시작 전 매도 우선 점검`
    );

    await runSellSafely();
  }

  async function runBuySafely() {
    // 매수시간 밖에서는 매도 우선점검을 중복 호출하지 않는다.
    // 보유종목 매도점검은 별도의 10초 SELL LOOP가 계속 담당한다.
    if (!isKoreanWeekday() || !isCoreOrVolumeBuyWindow()) {
      return;
    }

    if (isTraderBusy()) {
      reserveBuyCheck("공통 busy");
      return;
    }

    await ensureSellPriorityBeforeLongTask("BUY");

    if (isTraderBusy()) {
      reserveBuyCheck("매도 우선 점검");
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

      schedulePendingBuyIfReady();
      schedulePendingCandidateWatchIfReady();
    }
  }

  async function runCandidateWatchSafely() {
    // 후보재평가도 실제 매수시간에만 수행한다.
    if (!isKoreanWeekday() || !isCoreOrVolumeBuyWindow()) {
      return;
    }

    if (isTraderBusy()) {
      reserveCandidateWatch("공통 busy");
      return;
    }

    // BUY가 이미 밀려 있으면 후보재평가보다 전종목 검색을 먼저 회복한다.
    if (buyPending || buyPendingScheduled) {
      reserveCandidateWatch("BUY 우선");
      schedulePendingBuyIfReady();
      return;
    }

    await ensureSellPriorityBeforeLongTask("후보재평가");

    if (isTraderBusy()) {
      reserveCandidateWatch("매도 우선 점검");
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

      schedulePendingBuyIfReady();
      schedulePendingCandidateWatchIfReady();
    }
  }

  async function runSellSafely() {
    /*
     * 매도 점검은 BUY/후보 재평가와 독립 실행한다.
     * saveState의 3-way 병합과 포지션 완료키가 동시 저장·중복매도를 보호하므로,
     * 긴 전체검색 때문에 손절 신호가 수십 초 밀리는 위험을 더 우선해서 제거한다.
     * 단, SELL끼리는 반드시 직렬화한다.
     */
    if (sellRunning) {
      const wasAlreadyPending = sellPending;
      sellPending = true;
      if (!sellPendingSinceMs) {
        sellPendingSinceMs = Date.now();
      }
      if (!wasAlreadyPending) {
        console.log(
          "[SELL LOOP] 직전 매도점검 진행중 / 종료 직후 재점검 예약"
        );
      }
      return;
    }

    const pendingWaitMs = sellPendingSinceMs > 0
      ? Math.max(0, Date.now() - sellPendingSinceMs)
      : 0;

    sellPending = false;
    sellPendingSinceMs = 0;
    sellRunning = true;
    lastSellPriorityCheckAt = Date.now();

    if (pendingWaitMs > 0) {
      console.log(
        `[SELL LOOP] 예약점검 실행 / 대기 ${(pendingWaitMs / 1000).toFixed(1)}초`
      );
    }

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
      schedulePendingBuyIfReady();
      schedulePendingCandidateWatchIfReady();
    }
  }

  /*
   * 장 초반 30초, 중반 45초, 이후 60초처럼
   * 현재 시간대에 맞춰 다음 매수 점검 주기를 다시 계산한다.
   */
  function scheduleNextBuyLoop(delayOverrideMs = null) {
    const delay = Math.max(
      1000,
      Number(
        delayOverrideMs ??
        getDynamicBuyLoopMs() ??
        settings.buyLoopMs
      )
    );

    buyTimer = setTimeout(async () => {
      const cycleStartedAtMs = Date.now();
      try {
        await runBuySafely();
      } finally {
        // 설정 주기는 "작업 종료 후 대기시간"이 아니라 시작-시작 간격으로 맞춘다.
        // DISCOVER가 10~20초 걸려도 그 시간만큼 다음 대기에서 차감해 전종목 순환을 유지한다.
        const nextIntervalMs = Math.max(
          1000,
          Number(getDynamicBuyLoopMs() || settings.buyLoopMs)
        );
        const elapsedMs = Math.max(0, Date.now() - cycleStartedAtMs);
        scheduleNextBuyLoop(
          Math.max(1000, nextIntervalMs - elapsedMs)
        );
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

  if (!acquireAutoTraderLock()) {
    console.log(
      "[START] CORE/VOLUME 자동매매 중복시작을 차단했습니다."
    );
    return;
  }

  started = true;

  start().catch(err => {
    started = false;
    releaseAutoTraderLock();
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
  saveState,

  __test: {
    calculateStableMarketTemperature,
    getMarketAdjustedBuySettings,
    getSellSignal,
    isVolumeCandidateGettingStronger,
    normalizeMarketSegment
  }
};
