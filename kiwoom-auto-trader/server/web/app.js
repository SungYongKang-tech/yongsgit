const API_BASE = "https://sytrader.duckdns.org";

const stockCodeInput = document.getElementById("stockCode");
const searchBtn = document.getElementById("searchBtn");
const resultCard = document.getElementById("resultCard");
const suggestList = document.getElementById("suggestList");

const alertRateInput = document.getElementById("alertRateInput");
const saveAlertRateBtn = document.getElementById("saveAlertRateBtn");
const alertBox = document.getElementById("alertBox");
const entryRateInput = document.getElementById("entryRateInput");
const saveEntryRateBtn = document.getElementById("saveEntryRateBtn");
const entryBox = document.getElementById("entryBox");

const testModeBanner = document.getElementById("testModeBanner");

const tradeStartTimeInput =
  document.getElementById("tradeStartTime");

const tradeEndTimeInput =
  document.getElementById("tradeEndTime");

const saveTradeTimeBtn =
  document.getElementById("saveTradeTimeBtn");

const TRADE_TIME_KEY = "kiwoom_trade_time";

const volumeThresholdInput =
  document.getElementById("volumeThresholdInput");

const saveVolumeThresholdBtn =
  document.getElementById("saveVolumeThresholdBtn");

const apiStatusBar =
  document.getElementById("apiStatusBar");

const apiWarningBanner =
  document.getElementById("apiWarningBanner");

const STOCK_MASTER = [
  { code: "005930", name: "삼성전자" },
  { code: "000660", name: "SK하이닉스" },
  { code: "005380", name: "현대차" },
  { code: "035420", name: "NAVER" },
  { code: "035720", name: "카카오" },
  { code: "051910", name: "LG화학" },
  { code: "006400", name: "삼성SDI" },
  { code: "005490", name: "POSCO홀딩스" },
  { code: "068270", name: "셀트리온" },
  { code: "105560", name: "KB금융" },
  { code: "055550", name: "신한지주" },
  { code: "012330", name: "현대모비스" },
  { code: "028260", name: "삼성물산" },
  { code: "066570", name: "LG전자" },
  { code: "096770", name: "SK이노베이션" },
  { code: "003670", name: "포스코퓨처엠" },
  { code: "247540", name: "에코프로비엠" },
  { code: "086520", name: "에코프로" }
];

let tradeTimeSetting =
  JSON.parse(localStorage.getItem(TRADE_TIME_KEY)) || {
    start: "09:00",
    end: "15:30"
  };

if (tradeStartTimeInput) {
  tradeStartTimeInput.value =
    tradeTimeSetting.start;
}

if (tradeEndTimeInput) {
  tradeEndTimeInput.value =
    tradeTimeSetting.end;
}

  if (saveTradeTimeBtn) {
  saveTradeTimeBtn.addEventListener("click", () => {
    tradeTimeSetting = {
      start: tradeStartTimeInput.value,
      end: tradeEndTimeInput.value
    };

    localStorage.setItem(
      TRADE_TIME_KEY,
      JSON.stringify(tradeTimeSetting)
    );

    alert("자동매매 가능 시간이 저장되었습니다.");
  });
}

const VOLUME_THRESHOLD_KEY =
  "kiwoom_volume_threshold";

  let volumeThreshold =
  Number(localStorage.getItem(VOLUME_THRESHOLD_KEY)) || 1000000;

if (volumeThresholdInput) {
  volumeThresholdInput.value = volumeThreshold;
}

if (saveVolumeThresholdBtn) {
  saveVolumeThresholdBtn.addEventListener("click", () => {

    const value =
      Number(volumeThresholdInput.value);

    if (isNaN(value) || value <= 0) {
      alert("거래량 기준을 입력하세요.");
      return;
    }

    volumeThreshold = value;

    localStorage.setItem(
      VOLUME_THRESHOLD_KEY,
      String(volumeThreshold)
    );

    loadWatchList();
  });
}

function formatNumber(value) {
  if (value === null || value === undefined || value === "") return "-";
  return Number(value).toLocaleString("ko-KR");
}

function flashValue(el, type) {
  if (!el) return;

  el.classList.remove("value-flash-up", "value-flash-down");

  void el.offsetWidth;

  el.classList.add(type === "up" ? "value-flash-up" : "value-flash-down");

  setTimeout(() => {
    el.classList.remove("value-flash-up", "value-flash-down");
  }, 700);
}

function getRateClass(rateText) {
  if (!rateText) return "";
  if (String(rateText).startsWith("-")) return "down";
  return "up";
}

function findStockByInput(input) {
  const keyword = input.trim();

  if (!keyword) return null;

  if (/^\d{6}$/.test(keyword)) {
    return {
      code: keyword,
      name: ""
    };
  }

  return STOCK_MASTER.find((item) =>
    item.name.includes(keyword) ||
    item.code.includes(keyword)
  );
}

function renderSuggestions(keyword) {
  const value = keyword.trim();

  if (!value) {
    suggestList.innerHTML = "";
    return;
  }

  const matched = STOCK_MASTER
    .filter((item) =>
      item.name.includes(value) ||
      item.code.includes(value)
    )
    .slice(0, 6);

  if (matched.length === 0) {
    suggestList.innerHTML = "";
    return;
  }

  suggestList.innerHTML = matched.map((item) => `
    <div class="suggest-item" data-code="${item.code}">
      <span class="suggest-name">${item.name}</span>
      <span class="suggest-code">${item.code}</span>
    </div>
  `).join("");

  document.querySelectorAll(".suggest-item").forEach((el) => {
  el.addEventListener("click", () => {

    const selected = STOCK_MASTER.find(
      (item) => item.code === el.dataset.code
    );

    stockCodeInput.value =
      selected?.name || el.dataset.code;

    suggestList.innerHTML = "";
    searchStock();
  });
});
}

async function searchStock() {
  const inputValue = stockCodeInput.value.trim();
const stock = findStockByInput(inputValue);
const code = stock?.code;

if (!code) {
  resultCard.innerHTML = `<div class="error">종목명 또는 종목코드를 입력하세요.</div>`;
  return;
}

  resultCard.innerHTML = `<div class="loading">조회 중...</div>`;

  try {
    const data = await fetchStockPrice(code);

const rateClass = getRateClass(data.changeRate);

    resultCard.innerHTML = `
      <div class="stock-name">${data.name}</div>
      <div class="stock-code">${data.code}</div>

      <div class="price ${rateClass}">
        ${formatNumber(data.currentPrice)}원
      </div>

      <div class="rate ${rateClass}">
        ${data.changeRate}
      </div>

      <div class="info-grid">
        <div class="info-box">
          <div class="info-label">시가</div>
          <div class="info-value">${formatNumber(data.open)}</div>
        </div>
        <div class="info-box">
          <div class="info-label">고가</div>
          <div class="info-value">${formatNumber(data.high)}</div>
        </div>
        <div class="info-box">
          <div class="info-label">저가</div>
          <div class="info-value">${formatNumber(data.low)}</div>
        </div>
        <div class="info-box">
          <div class="info-label">거래량</div>
          <div class="info-value">${formatNumber(data.volume)}</div>
        </div>
      </div>
    `;
  } catch (error) {
    resultCard.innerHTML = `
      <div class="error">
        조회 실패<br />
        ${error.message}
      </div>
    `;
  }
}

searchBtn.addEventListener("click", searchStock);

stockCodeInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    searchStock();
  }
});

const loadWatchBtn = document.getElementById("loadWatchBtn");
const watchList = document.getElementById("watchList");

const addStockCodeInput = document.getElementById("addStockCode");
const addStockBtn = document.getElementById("addStockBtn");

const WATCH_STORAGE_KEY = "kiwoom_watch_codes";

const holdSummary = document.getElementById("holdSummary");
const holdRankBox = document.getElementById("holdRankBox");

let watchCodes = JSON.parse(localStorage.getItem(WATCH_STORAGE_KEY)) || [
  "005930",
  "000660",
  "005380",
  "035420",
  "035720"
];

const ALERT_RATE_KEY = "kiwoom_alert_rate";
const TEST_MODE_KEY = "kiwoom_test_mode";
const ENTRY_RATE_KEY = "kiwoom_entry_rate";

let alertRate = Number(localStorage.getItem(ALERT_RATE_KEY)) || 5;
if (alertRateInput) {
  alertRateInput.value = alertRate;
}

let entryRate = Number(localStorage.getItem(ENTRY_RATE_KEY)) || 3;

if (entryRateInput) {
  entryRateInput.value = entryRate;
}

let currentSortType = "default";
let isTestMode =
  localStorage.getItem(TEST_MODE_KEY) === "true";
let currentHoldSortType = "default";

let previousPrices = {};
let previousHoldPrices = {};

function saveWatchCodes() {
  localStorage.setItem(WATCH_STORAGE_KEY, JSON.stringify(watchCodes));
}

function renderAlertBox(items) {
  const alertItems = items.filter((item) => {
    const rate = parseFloat(item.changeRate);
    return !isNaN(rate) && rate >= alertRate;
  });

  if (alertItems.length === 0) {
    alertBox.innerHTML = `<div class="empty">알림 조건에 맞는 종목이 없습니다.</div>`;
    return;
  }

  alertBox.innerHTML = `
    <div class="alert-title">🚨 상승률 ${alertRate}% 이상 종목</div>
    ${alertItems.map((item) => `
      <div class="alert-item">
        <strong>${item.name}</strong>
        <span class="up">${item.changeRate}</span>
      </div>
    `).join("")}
  `;
}

function renderEntryBox(items) {
  if (!entryBox) return;

  const entryItems = items.filter((item) => {
    const rate = parseFloat(item.changeRate);
    return !isNaN(rate) && rate >= entryRate;
  });

  if (entryItems.length === 0) {
    entryBox.innerHTML = `<div class="empty">진입후보 종목이 없습니다.</div>`;
    return;
  }

  entryBox.innerHTML = `
    <div class="entry-title">🚀 진입후보 ${entryRate}% 이상</div>
    ${entryItems.map((item) => `
      <div class="entry-item">
        <strong>${item.name}</strong>
        <span class="up">${item.changeRate}</span>
      </div>
    `).join("")}
  `;
}

function renderWatchItem(item) {
  const rateClass = getRateClass(item.changeRate);
  const rateValue = parseFloat(item.changeRate);
  const isEntryCandidate =
  !isNaN(rateValue) && rateValue >= entryRate;
  const isVolumeHot =
  Number(item.volume) >= volumeThreshold;

  const prevPrice = previousPrices[item.code];
  let flashClass = "";

  if (prevPrice !== undefined) {
    if (item.currentPrice > prevPrice) {
      flashClass = "flash-up";
    } else if (item.currentPrice < prevPrice) {
      flashClass = "flash-down";
    }
  }

  previousPrices[item.code] = item.currentPrice;

  return `
    <div class="watch-item ${flashClass}" data-code="${item.code}">
      <div class="watch-item-top">
        <div>
          <div class="watch-name">
  ${item.name}
  ${isEntryCandidate ? `<span class="entry-badge">진입후보</span>` : ""}
  ${isVolumeHot ? `<span class="volume-badge">거래량급증</span>` : ""}
  </div>
<div class="watch-code">${item.code}</div>
        </div>
        <div>
          <div class="watch-price ${rateClass}">
            ${formatNumber(item.currentPrice)}원
          </div>
          <div class="rate ${rateClass}" style="text-align:right;font-size:15px;">
            ${item.changeRate}
          </div>
        </div>
      </div>

      <div class="watch-bottom">
        <span>고가 ${formatNumber(item.high)}</span>
        <span>거래량 ${formatNumber(item.volume)}</span>
      </div>

      <button class="watch-remove" data-remove-code="${item.code}">
        관심종목 삭제
      </button>
    </div>
  `;
}

function bindWatchItemEvents() {
  document.querySelectorAll(".watch-item").forEach((el) => {
    el.addEventListener("click", () => {
      stockCodeInput.value = el.dataset.code;
      searchStock();
    });
  });

  document.querySelectorAll(".watch-remove").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();

      const code = btn.dataset.removeCode;
      watchCodes = watchCodes.filter((item) => item !== code);
      saveWatchCodes();
      loadWatchList();
    });
  });
}

function updateWatchItemOnly(item) {
  const card = document.querySelector(`.watch-item[data-code="${item.code}"]`);

  if (!card) return false;

  const priceEl = card.querySelector(".watch-price");
  const rateEl = card.querySelector(".rate");
  const bottomEls = card.querySelectorAll(".watch-bottom span");

  if (!priceEl || !rateEl) {
    return false;
  }

  const rateClass = getRateClass(item.changeRate);
  const prevPrice = previousPrices[item.code];

  

  if (prevPrice !== undefined) {
  if (item.currentPrice > prevPrice) {
    flashValue(priceEl, "up");
  } else if (item.currentPrice < prevPrice) {
    flashValue(priceEl, "down");
  }
}

  previousPrices[item.code] = item.currentPrice;

  priceEl.className = `watch-price ${rateClass}`;
  priceEl.textContent = `${formatNumber(item.currentPrice)}원`;

  rateEl.className = `rate ${rateClass}`;
  rateEl.style.textAlign = "right";
  rateEl.style.fontSize = "15px";
  rateEl.textContent = item.changeRate;

  if (bottomEls[0]) {
    bottomEls[0].textContent = `고가 ${formatNumber(item.high)}`;
  }

  if (bottomEls[1]) {
    bottomEls[1].textContent = `거래량 ${formatNumber(item.volume)}`;
  }

 
  return true;
}

async function loadWatchList(silent = false) {
  if (!silent) {
    watchList.innerHTML = `<div class="loading">관심종목 조회 중...</div>`;
  }
  try {
    const data = await Promise.all(
  watchCodes.map((code) => fetchStockPrice(code))
);

    let sortedData = [...data];
    renderAlertBox(data);
    renderEntryBox(data);

if (currentSortType === "rate") {
  sortedData.sort((a, b) =>
    parseFloat(b.changeRate) - parseFloat(a.changeRate)
  );
}

if (currentSortType === "volume") {
  sortedData.sort((a, b) => b.volume - a.volume);
}

if (currentSortType === "price") {
  sortedData.sort((a, b) => b.currentPrice - a.currentPrice);
}

const hasCards = document.querySelectorAll(".watch-item").length > 0;

if (silent && hasCards && currentSortType === "default") {
  let updateSuccess = true;

  sortedData.forEach((item) => {
    const ok = updateWatchItemOnly(item);

    if (!ok) {
      updateSuccess = false;
    }
  });

  if (!updateSuccess) {
    watchList.innerHTML = sortedData.map(renderWatchItem).join("");
    bindWatchItemEvents();
  }
} else {
  watchList.innerHTML = sortedData.map(renderWatchItem).join("");
  bindWatchItemEvents();
}

  } catch (error) {
    watchList.innerHTML = `
      <div class="error">
        관심종목 조회 실패<br />
        ${error.message}
      </div>
    `;
  }
}


const autoRefreshBtn = document.getElementById("autoRefreshBtn");
const testModeBtn = document.getElementById("testModeBtn");

let autoRefreshTimer = null;
let isAutoRefresh = false;
let isRefreshing = false;

async function refreshWithoutJump() {
  if (isRefreshing) {
    console.log("이전 갱신이 아직 끝나지 않아 이번 갱신은 건너뜁니다.");
    return;
  }

  isRefreshing = true;

  try {
    const holdCodes = holdings.map((item) => item.code);

    const uniqueCodes = [
      ...new Set([...watchCodes, ...holdCodes])
    ];

    const refreshStartTime = performance.now();
    updateApiStatus(
      `자동조회중 · ${uniqueCodes.length}개 종목`
    );

    await Promise.all(
      uniqueCodes.map((code) => fetchStockPrice(code))
    );

    await loadWatchList(true);
    await renderHoldings(true);
    renderTradeLogs();

    const elapsed =
  Math.round(performance.now() - refreshStartTime);

updateApiStatus(
  `자동조회 정상 · ${elapsed}ms`
);

  } catch (error) {
    updateApiStatus(
      `자동조회 실패 · ${error.message}`,
      true
    );

  } finally {
    isRefreshing = false;
  }
}

async function manualRefresh() {
  if (isRefreshing) {
    console.log("자동갱신 중이라 수동 조회를 건너뜁니다.");
    return;
  }

  isRefreshing = true;

  try {
    const holdCodes = holdings.map((item) => item.code);

    const uniqueCodes = [
      ...new Set([...watchCodes, ...holdCodes])
    ];

    const refreshStartTime = performance.now();

    updateApiStatus(
      `수동조회중 · ${uniqueCodes.length}개 종목`
    );

    await Promise.all(
      uniqueCodes.map((code) => fetchStockPrice(code))
    );

    await loadWatchList();
    await renderHoldings();
    renderTradeLogs();

    const elapsed =
  Math.round(performance.now() - refreshStartTime);

updateApiStatus(
  `수동조회 정상 · ${elapsed}ms`
);

  } catch (error) {
    updateApiStatus(
      `조회 실패 · ${error.message}`,
      true
    );

  } finally {
    isRefreshing = false;
  }
}

async function startAutoRefresh() {
  if (apiWarningBanner) {
  apiWarningBanner.style.display = "none";
}

  if (autoRefreshTimer) {
    clearTimeout(autoRefreshTimer);
  }

  isAutoRefresh = true;
  autoRefreshBtn.textContent = "자동ON";
  autoRefreshBtn.classList.add("active");

  async function runRefreshLoop() {
    if (!isAutoRefresh) return;

    await refreshWithoutJump();

    autoRefreshTimer = setTimeout(() => {
      runRefreshLoop();
    }, getRefreshInterval());
  }
  updateApiStatus("자동갱신 시작");
  runRefreshLoop();
}

function stopAutoRefresh() {
  isAutoRefresh = false;
  autoRefreshBtn.textContent = "자동OFF";
  autoRefreshBtn.classList.remove("active");

  if (autoRefreshTimer) {
    clearTimeout(autoRefreshTimer);
    autoRefreshTimer = null;
  }
}
function updateTestModeUI() {

    if (testModeBanner) {
  testModeBanner.style.display = isTestMode ? "block" : "none";
}

  if (!testModeBtn) return;

  testModeBtn.textContent =
    isTestMode ? "테스트ON" : "테스트OFF";

  testModeBtn.classList.toggle("active", isTestMode);
}

loadWatchBtn.addEventListener("click", () => {
  manualRefresh();
});

autoRefreshBtn.addEventListener("click", () => {
  if (isAutoRefresh) {
    stopAutoRefresh();
  } else {
    startAutoRefresh();
  }
});

if (testModeBtn) {
  testModeBtn.addEventListener("click", () => {
    isTestMode = !isTestMode;

    localStorage.setItem(
      TEST_MODE_KEY,
      String(isTestMode)
    );

    updateTestModeUI();

    alert(
      isTestMode
        ? "테스트모드 ON (장외 자동매매 허용)"
        : "테스트모드 OFF"
    );
  });
}

function addWatchCode() {
  const inputValue = addStockCodeInput.value.trim();
const stock = findStockByInput(inputValue);
const code = stock?.code;

if (!code) {
  alert("종목명 또는 종목코드를 입력하세요.");
  return;
}

  if (watchCodes.includes(code)) {
    alert("이미 등록된 종목입니다.");
    return;
  }

  watchCodes.push(code);
  saveWatchCodes();

  addStockCodeInput.value = "";
  loadWatchList();
}

addStockBtn.addEventListener("click", addWatchCode);

addStockCodeInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    addWatchCode();
  }
});

stockCodeInput.addEventListener("input", () => {
  renderSuggestions(stockCodeInput.value);
});

const holdCodeInput = document.getElementById("holdCode");
const buyPriceInput = document.getElementById("buyPrice");
const holdQtyInput = document.getElementById("holdQty");
const targetPriceInput = document.getElementById("targetPrice");
const stopLossPriceInput = document.getElementById("stopLossPrice");
const secondTargetPriceInput = document.getElementById("secondTargetPrice");
const trailingStopRateInput =
  document.getElementById("trailingStopRate");
const addHoldBtn = document.getElementById("addHoldBtn");
const holdList = document.getElementById("holdList");
const emergencyStopBtn = document.getElementById("emergencyStopBtn");
const resetHoldingsBtn = document.getElementById("resetHoldingsBtn");


const tradeLogList = document.getElementById("tradeLogList");
const clearTradeLogBtn = document.getElementById("clearTradeLogBtn");

const TRADE_LOG_KEY = "kiwoom_virtual_trade_logs";
let tradeLogs = JSON.parse(localStorage.getItem(TRADE_LOG_KEY)) || [];

const DAILY_TRADE_LIMIT = 20;
const DAILY_TRADE_LIMIT_PER_CODE = 3;
const TRADE_COOLDOWN_MINUTES = 3;
const PARTIAL_SELL_RATE = 0.5; // 50% 분할매도

const HOLD_STORAGE_KEY = "kiwoom_holdings";

const STRATEGY_STATE_KEY = "kiwoom_strategy_states";

let strategyStates =
  JSON.parse(localStorage.getItem(STRATEGY_STATE_KEY)) || {};

function saveStrategyStates() {
  localStorage.setItem(STRATEGY_STATE_KEY, JSON.stringify(strategyStates));
}

let holdings = JSON.parse(localStorage.getItem(HOLD_STORAGE_KEY)) || [];

function saveHoldings() {
  localStorage.setItem(HOLD_STORAGE_KEY, JSON.stringify(holdings));
}

function saveTradeLogs() {
  localStorage.setItem(TRADE_LOG_KEY, JSON.stringify(tradeLogs));
}

function renderTradeLogs() {
  if (!tradeLogList) return;

  if (tradeLogs.length === 0) {
    tradeLogList.innerHTML =
      `<div class="empty">아직 발생한 매매 신호가 없습니다.</div>`;
    return;
  }

  tradeLogList.innerHTML = tradeLogs
    .slice()
    .reverse()
    .map((log) => {
      const typeText =
        log.type === "SELL"
          ? "1차매도"
          : log.type === "SELL_ALL"
          ? "2차매도"
          : log.type === "SELL_TRAILING"
          ? "트레일링매도"
          : log.type === "STOP_LOSS"
          ? "손절매도"
          : "가상매수";

      const typeClass =
        log.type === "STOP_LOSS" ? "down" : "up";

      return `
        <div class="trade-log-item">
          <div class="trade-log-main">
            <strong class="${typeClass}">[${typeText}] ${log.name}</strong>
            <span>${formatNumber(log.price)}원</span>
          </div>

          <div class="trade-log-detail">
            ${log.sellQty ? `매도 ${formatNumber(log.sellQty)}주` : ""}
            ${log.remainQty ? ` / 잔여 ${formatNumber(log.remainQty)}주` : ""}
          </div>

          <div class="trade-log-reason">
            사유: ${log.reason}
          </div>

          <div class="trade-log-time">
            시간: ${log.time}
          </div>
        </div>
      `;
    })
    .join("");
}

function getTodayTradeCount() {
  const todayKey = new Date().toISOString().slice(0, 10);

  return tradeLogs.filter((log) => {
    return log.date === todayKey;
  }).length;
}

function getTodayTradeCountForCode(code) {
  const todayKey = new Date().toISOString().slice(0, 10);

  return tradeLogs.filter((log) => {
    return log.date === todayKey && log.code === code;
  }).length;
}

function isInCooldown(code) {
  const latestLog = tradeLogs
    .filter((log) => log.code === code)
    .sort((a, b) => new Date(b.time) - new Date(a.time))[0];

  if (!latestLog) return false;

  const lastTime = new Date(latestLog.time).getTime();
  const nowTime = Date.now();

  const diffMinutes = (nowTime - lastTime) / 1000 / 60;

  return diffMinutes < TRADE_COOLDOWN_MINUTES;
}

function isMarketOpenNow() {
  const now = new Date();
  const day = now.getDay(); // 0 일요일, 6 토요일

  if (day === 0 || day === 6) {
    return false;
  }

  const hour = now.getHours();
  const minute = now.getMinutes();
  const currentMinutes = hour * 60 + minute;

 const [startHour, startMinute] =
  tradeTimeSetting.start.split(":").map(Number);

const [endHour, endMinute] =
  tradeTimeSetting.end.split(":").map(Number);

const marketOpen =
  startHour * 60 + startMinute;

const marketClose =
  endHour * 60 + endMinute;

  return currentMinutes >= marketOpen && currentMinutes <= marketClose;
}

function getRefreshInterval() {
  if (isMarketOpenNow()) {
    return 15000; // 장중: 15초
  }

  return 60000; // 장외/휴장: 60초
}

function getStrategyState(code) {
  if (!strategyStates[code]) {
    strategyStates[code] = {
  status: "WAITING",
  lastAction: "NONE",
  lastSignalTime: null,
  lastSignalPrice: null,
  lastSoldQty: 0,
  remainQty: 0
};
  }

  return strategyStates[code];
}

function getStrategyStatusText(status) {
  if (status === "WAITING") return "대기중";
  if (status === "PARTIAL_SOLD") return "1차매도완료";
  if (status === "SOLD") return "매도완료";
  if (status === "SELL_ALL") return "2차매도완료";
  if (status === "SELL_SIGNAL") return "매도신호";
  if (status === "STOP_SIGNAL") return "손절신호";
  return "대기중";
}

function checkTargetSell(item) {
  const state = getStrategyState(item.code);

  if (state.status === "PARTIAL_SOLD") {
    return null;
  }

  if (
    item.targetPrice &&
    item.currentPrice >= item.targetPrice
  ) {
    return {
      action: "SELL",
      reason: `자동매매ON · 목표가 ${formatNumber(item.targetPrice)}원 도달`
    };
  }

  return null;
}

function checkSecondTargetSell(item) {
  const state = getStrategyState(item.code);

  if (
    state.status === "PARTIAL_SOLD" &&
    item.secondTargetPrice &&
    item.currentPrice >= item.secondTargetPrice
  ) {
    return {
     action: "SELL_ALL",
      reason: `자동매매ON · 2차 목표가 ${formatNumber(item.secondTargetPrice)}원 도달`
    };
  }

  return null;
}

function updateHighestPrice(item) {
  if (!item.trailingStopRate) return;

  const currentHighest = Number(item.highestPrice || 0);

  if (!currentHighest || item.currentPrice > currentHighest) {
    holdings = holdings.map((hold) => {
      if (hold.code !== item.code) return hold;

      return {
        ...hold,
        highestPrice: item.currentPrice
      };
    });

    item.highestPrice = item.currentPrice;
    saveHoldings();
  }
}

function checkTrailingStop(item) {
  if (
    !item.trailingStopRate ||
    !item.highestPrice
  ) {
    return null;
  }

  const dropRate =
    ((item.highestPrice - item.currentPrice)
      / item.highestPrice) * 100;

  if (dropRate >= item.trailingStopRate) {
    return {
      action: "SELL_TRAILING",
      reason:
        `트레일링스탑 ${item.trailingStopRate}% 발동`
    };
  }

  return null;
}

function checkStopLoss(item) {
  if (
    item.stopLossPrice &&
    item.currentPrice <= item.stopLossPrice
  ) {
    return {
      action: "STOP_LOSS",
      reason: `자동매매ON · 손절가 ${formatNumber(item.stopLossPrice)}원 이탈`
    };
  }

  return null;
}

// 전략 실행 순서가 우선순위입니다.
// 위에 있는 전략이 먼저 실행됩니다.
const STRATEGIES = [
  checkStopLoss,
  checkTrailingStop,
  checkSecondTargetSell,
  checkTargetSell
];

function evaluateStrategy(item) {
  const state = getStrategyState(item.code);

  if (state.status === "SOLD") {
    return {
      action: "NONE",
      reason: "이미 매도 완료"
    };
  }

  
  if (!item.autoTrade) {
    return {
      action: "NONE",
      reason: "자동매매 OFF"
    };
  }

  for (const strategy of STRATEGIES) {
    const result = strategy(item);

    if (result) {
      return result;
    }
  }

  return {
    action: "HOLD",
    reason: "조건 미충족"
  };
}

function updateStrategySignalState(code, action, price) {
  if (action === "SELL") {
    strategyStates[code] = {
      status: "SELL_SIGNAL",
      lastAction: "SELL",
      lastSignalTime: new Date().toLocaleString("ko-KR"),
      lastSignalPrice: price
    };
  }

  if (action === "SELL_ALL") {
  strategyStates[code] = {
    status: "SELL_SIGNAL",
    lastAction: "SELL_ALL",
    lastSignalTime: new Date().toLocaleString("ko-KR"),
    lastSignalPrice: price
  };
}

if (action === "SELL_TRAILING") {
  strategyStates[code] = {
    status: "SELL_SIGNAL",
    lastAction: "SELL_TRAILING",
    lastSignalTime: new Date().toLocaleString("ko-KR"),
    lastSignalPrice: price
  };
}

  if (action === "STOP_LOSS") {
    strategyStates[code] = {
      status: "STOP_SIGNAL",
      lastAction: "STOP_LOSS",
      lastSignalTime: new Date().toLocaleString("ko-KR"),
      lastSignalPrice: price
    };
  }

  saveStrategyStates();
}

function processStrategyResult(item, strategyResult) {
 if (
  strategyResult.action !== "SELL" &&
  strategyResult.action !== "SELL_ALL" &&
  strategyResult.action !== "SELL_TRAILING" &&
  strategyResult.action !== "STOP_LOSS"
) {
  return;
}

if (!isMarketOpenNow() && !isTestMode) {
  console.warn("장 운영시간이 아니므로 매매 실행을 하지 않습니다.");
  return;
}

if (getTodayTradeCountForCode(item.code) >= DAILY_TRADE_LIMIT_PER_CODE) {
  console.warn("종목별 거래 제한");
  return;
}

if (isInCooldown(item.code)) {
  console.warn("쿨타임 중");
  return;
}

if (getTodayTradeCount() >= DAILY_TRADE_LIMIT) {
  console.warn("1일 거래 제한");
  return;
}

if (
  isAlreadyLoggedToday({
    type: strategyResult.action,
    code: item.code,
    reason: strategyResult.reason
  })
) {
  console.warn("이미 오늘 기록된 신호입니다.");
  return;
}

  updateStrategySignalState(
  item.code,
  strategyResult.action,
  item.currentPrice
);



  executeVirtualSell(item.code, strategyResult.action);

addTradeLog({
  type: strategyResult.action,
  code: item.code,
  name: item.name,
  price: item.currentPrice,
  reason: strategyResult.reason
});
}

function isAlreadyLoggedToday({ type, code, reason }) {
  const todayKey = new Date().toISOString().slice(0, 10);

  return tradeLogs.some((log) => {
    return (
      log.date === todayKey &&
      log.type === type &&
      log.code === code &&
      log.reason === reason
    );
  });
}

function addTradeLog({ type, code, name, price, reason }) {
  const todayKey = new Date().toISOString().slice(0, 10);

  const alreadyLogged = tradeLogs.some((log) => {
    return (
      log.date === todayKey &&
      log.type === type &&
      log.code === code &&
      log.reason === reason
    );
  });

if (alreadyLogged) return;

if (!isMarketOpenNow() && !isTestMode) {
  console.warn("장 운영시간이 아니므로 거래 신호를 기록하지 않습니다.");
  return;
}

if (getTodayTradeCountForCode(code) >= DAILY_TRADE_LIMIT_PER_CODE) {
  console.warn("종목별 1일 거래 제한 도달:", code);
  return;
}

if (isInCooldown(code)) {
  console.warn("쿨타임 중인 종목입니다:", code);
  return;
}

if (getTodayTradeCount() >= DAILY_TRADE_LIMIT) {
  console.warn("1일 거래 제한 도달");
  return;
}
 tradeLogs.push({
  type,
  code,
  name,
  price,
  reason,
  sellQty: strategyStates[code]?.lastSoldQty || 0,
  remainQty: strategyStates[code]?.remainQty || 0,
  date: todayKey,
  time: new Date().toLocaleString("ko-KR")
});

  saveTradeLogs();
  renderTradeLogs();
}

function executeVirtualSell(code, actionType = "SELL") {
  let soldQty = 0;
  let remainQty = 0;

  holdings = holdings.map((item) => {
    if (item.code !== code) return item;

    if (actionType === "SELL") {
      soldQty = Math.ceil(item.qty * PARTIAL_SELL_RATE);
      remainQty = item.qty - soldQty;

      return {
        ...item,
        qty: remainQty,
        autoTrade: remainQty > 0 ? item.autoTrade : false
      };
    }

    // 손절은 전량매도
    if (
  actionType === "STOP_LOSS" ||
  actionType === "SELL_ALL" ||
  actionType === "SELL_TRAILING"
) {
      soldQty = item.qty;
      remainQty = 0;

      return {
        ...item,
        qty: 0,
        autoTrade: false
      };
    }

    return item;
  });

  holdings = holdings.filter((item) => item.qty > 0);

  saveHoldings();

 strategyStates[code] = {
  status: remainQty > 0 ? "PARTIAL_SOLD" : "SOLD",
  lastAction: actionType,
  lastSignalTime: new Date().toLocaleString("ko-KR"),
  lastSignalPrice: strategyStates[code]?.lastSignalPrice || null,
  lastSoldQty: soldQty,
  remainQty: remainQty
};

  saveStrategyStates();
}

const PRICE_CACHE = {};
const PRICE_CACHE_TTL = 14500; // 14.5초 캐시

const LAST_PRICE_KEY = "kiwoom_last_price_data";

let lastPriceData =
  JSON.parse(localStorage.getItem(LAST_PRICE_KEY)) || {};

function updateApiStatus(text, isError = false) {
  if (!apiStatusBar) return;

  apiStatusBar.textContent = text;

  apiStatusBar.style.background =
    isError ? "#fee2e2" : "#eff6ff";

  apiStatusBar.style.color =
    isError ? "#b91c1c" : "#1d4ed8";
}

function saveLastPriceData(code, data) {
  lastPriceData[code] = {
    ...data,
    savedAt: new Date().toLocaleString("ko-KR")
  };

  localStorage.setItem(
    LAST_PRICE_KEY,
    JSON.stringify(lastPriceData)
  );
}


async function fetchStockPrice(code) {
  const now = Date.now();
  const cached = PRICE_CACHE[code];

  if (cached && now - cached.time < PRICE_CACHE_TTL) {
    return cached.data;
  }

  const res = await fetch(`${API_BASE}/api/price?code=${code}`);
  const data = await res.json();

  if (!res.ok) {
  console.error("현재가 조회 API 오류:", data);

  if (res.status === 429) {
  stopAutoRefresh();

  if (apiWarningBanner) {
    apiWarningBanner.style.display = "block";
  }

  updateApiStatus(
    "API 요청 제한 발생",
    true
  );

  if (lastPriceData[code]) {
  return lastPriceData[code];
}

  throw new Error(
    "요청이 너무 많아 자동갱신을 중지했습니다. 1~3분 후 다시 조회하세요."
  );
}

  throw new Error(
    data.message ||
    data.return_msg ||
    data.error ||
    `현재가 조회 실패 (${res.status})`
  );
}

  const currentPrice = Number(
    String(data.cur_prc || "0").replace(/[+-]/g, "")
  );

  const result = {
    code: data.stk_cd,
    name: data.stk_nm,
    currentPrice,
    price: currentPrice,
    change: Number(String(data.pred_pre || "0").replace(/[+-]/g, "")),
    changeRate: data.flu_rt || "0",
    volume: Number(data.trde_qty || 0),
    open: Number(String(data.open_pric || "0").replace(/[+-]/g, "")),
    high: Number(String(data.high_pric || "0").replace(/[+-]/g, "")),
    low: Number(String(data.low_pric || "0").replace(/[+-]/g, "")),
    raw: data
  };

  PRICE_CACHE[code] = {
    time: now,
    data: result
  };

  saveLastPriceData(code, result);

  return result;
}

function renderHoldRankBox(items) {
  if (!holdRankBox) return;

  if (items.length === 0) {
    holdRankBox.innerHTML = `<div class="empty">보유종목 수익/손실 요약이 없습니다.</div>`;
    return;
  }

  const topProfit = [...items].sort((a, b) => b.profit - a.profit)[0];
  const topLoss = [...items].sort((a, b) => a.profit - b.profit)[0];

  const targetReachedItems = items.filter((item) => {
  return item.targetPrice && item.currentPrice >= item.targetPrice;
});

  holdRankBox.innerHTML = `
  <div class="hold-rank-title">수익/손실 요약</div>

  <div class="hold-rank-row">
    <span>수익 TOP</span>
    <strong class="${topProfit.profit >= 0 ? "up" : "down"}">
      ${topProfit.name} ${topProfit.profit >= 0 ? "+" : ""}${formatNumber(topProfit.profit)}원
    </strong>
  </div>

  <div class="hold-rank-row">
    <span>손실 TOP</span>
    <strong class="${topLoss.profit >= 0 ? "up" : "down"}">
      ${topLoss.name} ${topLoss.profit >= 0 ? "+" : ""}${formatNumber(topLoss.profit)}원
    </strong>
  </div>

  ${targetReachedItems.length > 0 ? `
    <div class="hold-rank-row">
      <span>목표도달</span>
      <strong class="up">
        ${targetReachedItems.map((item) => item.name).join(", ")}
      </strong>
    </div>
  ` : ""}
`;
}

function updateHoldingItemOnly(item) {
  const card = document.querySelector(`.hold-item[data-code="${item.code}"]`);

  if (!card) return false;

  const profitEl = card.querySelector(".hold-profit-value");
  const rateEl = card.querySelector(".hold-profit-rate");
  const currentPriceEl = card.querySelector(".hold-current-price");
  const evalAmountEl = card.querySelector(".hold-eval-amount");
  const buyAmountEl = card.querySelector(".hold-buy-amount");
  const buyPriceEl = card.querySelector(".hold-buy-price");
  const qtyEl = card.querySelector(".hold-qty");
  const weightRateEl = card.querySelector(".hold-weight-rate");
  const strategyStatusEl = card.querySelector(".hold-strategy-status");
  const autoStatusEl = card.querySelector(".hold-auto-status");
  const autoBtnEl = card.querySelector(".hold-auto");

  const lastSignalTimeEl = card.querySelector(".hold-last-signal-time");
  const lastSignalRowEl = card.querySelector(".hold-last-signal-row");
  const lastSignalPriceEl = card.querySelector(".hold-last-signal-price");
  const lastSignalPriceRowEl = card.querySelector(".hold-last-signal-price-row");

  const partialSellRowEl = card.querySelector(".hold-partial-sell-row");
  const partialSellValueEl = card.querySelector(".hold-partial-sell-value");

  const lastActionRowEl = card.querySelector(".hold-last-action-row");
  const lastActionValueEl = card.querySelector(".hold-last-action-value");

  const targetStatusEl = card.querySelector(".hold-target-status");
  const secondTargetStatusEl = card.querySelector(".hold-second-target-status");
  const highestPriceEl = card.querySelector(".hold-highest-price");
  const stopLossStatusEl = card.querySelector(".hold-stoploss-status");

  if (!profitEl || !rateEl || !currentPriceEl || !evalAmountEl) {
    return false;
  }

  const state = getStrategyState(item.code);
  const strategyStatusText = getStrategyStatusText(state.status);

  const profitClass = item.profit >= 0 ? "up" : "down";

  const targetGap = item.targetPrice
    ? item.targetPrice - item.currentPrice
    : 0;

  const secondTargetGap = item.secondTargetPrice
    ? item.secondTargetPrice - item.currentPrice
    : 0;

  const stopLossGap = item.stopLossPrice
    ? item.currentPrice - item.stopLossPrice
    : 0;

  const trailingSellPrice =
    item.trailingStopRate && item.highestPrice
      ? Math.floor(item.highestPrice * (1 - item.trailingStopRate / 100))
      : 0;

      const trailingGap =
  trailingSellPrice
    ? item.currentPrice - trailingSellPrice
    : 0;

  const isTargetHit =
    item.targetPrice &&
    item.currentPrice >= item.targetPrice;

  const isStopLossHit =
    item.stopLossPrice &&
    item.currentPrice <= item.stopLossPrice;

  card.classList.toggle("target-hit", Boolean(isTargetHit));
  card.classList.toggle("stop-loss-hit", Boolean(isStopLossHit));

  profitEl.className = `hold-profit hold-profit-value ${profitClass}`;
  profitEl.textContent =
    `${item.profit >= 0 ? "+" : ""}${formatNumber(item.profit)}원`;

  rateEl.className = `hold-profit-rate ${profitClass}`;
  rateEl.style.textAlign = "right";
  rateEl.style.fontWeight = "800";
  rateEl.textContent =
    `${item.profitRate >= 0 ? "+" : ""}${item.profitRate.toFixed(2)}%`;

  currentPriceEl.textContent = formatNumber(item.currentPrice);

  if (buyPriceEl) {
    buyPriceEl.textContent = formatNumber(item.buyPrice);
  }

  evalAmountEl.textContent = `${formatNumber(item.evalAmount)}원`;

  if (buyAmountEl) {
    buyAmountEl.textContent = `${formatNumber(item.buyAmount)}원`;
  }

  if (qtyEl) {
    qtyEl.textContent = `${formatNumber(item.qty)}주`;
  }

  if (weightRateEl && item.weightRate !== undefined) {
    weightRateEl.textContent = `${item.weightRate.toFixed(1)}%`;
  }

  if (autoStatusEl) {
    autoStatusEl.className = `hold-auto-status ${item.autoTrade ? "up" : ""}`;
    autoStatusEl.textContent = item.autoTrade
      ? "ON · 감시중"
      : "OFF · 조건확인";
  }

  if (autoBtnEl) {
    autoBtnEl.classList.toggle("active", Boolean(item.autoTrade));
    autoBtnEl.textContent = item.autoTrade ? "자동ON" : "자동OFF";
  }

  if (targetStatusEl && item.targetPrice) {
    const hit = item.currentPrice >= item.targetPrice;

    targetStatusEl.className = `hold-target-status ${hit ? "up" : ""}`;
    targetStatusEl.textContent = hit
      ? "목표도달"
      : `+${formatNumber(targetGap)}원 남음`;
  }

  if (secondTargetStatusEl && item.secondTargetPrice) {
    const hit = item.currentPrice >= item.secondTargetPrice;

    secondTargetStatusEl.className =
      `hold-second-target-status ${hit ? "up" : ""}`;

    secondTargetStatusEl.textContent = hit
      ? "2차도달"
      : `+${formatNumber(secondTargetGap)}원 남음`;
  }

  if (highestPriceEl) {
    highestPriceEl.textContent = item.highestPrice
      ? `최고 ${formatNumber(item.highestPrice)}원 / 발동 ${formatNumber(trailingSellPrice)}원 / ${formatNumber(trailingGap)}원 여유`
      : "자동ON 후 최고가 추적";
  }

  if (stopLossStatusEl && item.stopLossPrice) {
    const hit = item.currentPrice <= item.stopLossPrice;

    stopLossStatusEl.className = `hold-stoploss-status ${hit ? "down" : ""}`;
    stopLossStatusEl.textContent = hit
      ? "손절신호"
      : `${formatNumber(stopLossGap)}원 여유`;
  }

  if (strategyStatusEl) {
    strategyStatusEl.className =
      `hold-strategy-status ${state.status === "SOLD" ? "down" : "up"}`;

    strategyStatusEl.textContent = strategyStatusText;
  }

  const lastActionText =
    state.lastAction === "SELL"
      ? "1차매도"
      : state.lastAction === "SELL_ALL"
      ? "2차매도"
      : state.lastAction === "SELL_TRAILING"
      ? "트레일링매도"
      : state.lastAction === "STOP_LOSS"
      ? "손절매도"
      : state.lastAction;

  if (lastActionValueEl && state.lastAction && state.lastAction !== "NONE") {
    lastActionValueEl.className =
      `hold-last-action-value ${state.lastAction === "STOP_LOSS" ? "down" : "up"}`;

    lastActionValueEl.textContent = lastActionText;

  } else if (!lastActionRowEl && state.lastAction && state.lastAction !== "NONE") {
    const strategyRow =
      card.querySelector(".hold-strategy-status")?.closest(".hold-row");

    if (strategyRow) {
      strategyRow.insertAdjacentHTML("afterend", `
        <div class="hold-row hold-last-action-row">
          <span>최근액션</span>
          <strong class="hold-last-action-value ${state.lastAction === "STOP_LOSS" ? "down" : "up"}">
            ${lastActionText}
          </strong>
        </div>
      `);
    }
  }

  if (lastSignalTimeEl && state.lastSignalTime) {
    lastSignalTimeEl.textContent = state.lastSignalTime;

  } else if (!lastSignalRowEl && state.lastSignalTime) {
    const actionRow =
      card.querySelector(".hold-last-action-row") ||
      card.querySelector(".hold-strategy-status")?.closest(".hold-row");

    if (actionRow) {
      actionRow.insertAdjacentHTML("afterend", `
        <div class="hold-row hold-last-signal-row">
          <span>최근신호</span>
          <strong class="hold-last-signal-time">${state.lastSignalTime}</strong>
        </div>
      `);
    }
  }

  if (lastSignalPriceEl && state.lastSignalPrice) {
    lastSignalPriceEl.textContent =
      `${formatNumber(state.lastSignalPrice)}원`;

  } else if (!lastSignalPriceRowEl && state.lastSignalPrice) {
    const signalRow = card.querySelector(".hold-last-signal-row");

    if (signalRow) {
      signalRow.insertAdjacentHTML("afterend", `
        <div class="hold-row hold-last-signal-price-row">
          <span>신호가격</span>
          <strong class="hold-last-signal-price">
            ${formatNumber(state.lastSignalPrice)}원
          </strong>
        </div>
      `);
    }
  }

  if (partialSellValueEl && state.lastSoldQty) {
    partialSellValueEl.textContent =
      `${formatNumber(state.lastSoldQty)}주 매도 / 잔여 ${formatNumber(state.remainQty || 0)}주`;
  }

  if (!partialSellRowEl && state.lastSoldQty) {
    const baseRow =
      card.querySelector(".hold-last-signal-price-row") ||
      card.querySelector(".hold-last-signal-row") ||
      card.querySelector(".hold-last-action-row") ||
      card.querySelector(".hold-strategy-status")?.closest(".hold-row");

    if (baseRow) {
      baseRow.insertAdjacentHTML("afterend", `
        <div class="hold-row hold-partial-sell-row">
          <span>분할매도</span>
          <strong class="hold-partial-sell-value">
            ${formatNumber(state.lastSoldQty)}주 매도 / 잔여 ${formatNumber(state.remainQty || 0)}주
          </strong>
        </div>
      `);
    }
  }

  return true;
}

function bindHoldItemEvents() {
  document.querySelectorAll(".hold-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      const code = btn.dataset.holdCode;
      holdings = holdings.filter((item) => item.code !== code);
      delete strategyStates[code];
      saveStrategyStates();
      
      saveHoldings();
      renderHoldings();
    });
  });

  document.querySelectorAll(".hold-auto").forEach((btn) => {
    btn.addEventListener("click", () => {
      const code = btn.dataset.holdCode;

      holdings = holdings.map((item) => {
        if (item.code === code) {
  const nextAutoTrade = !item.autoTrade;

  if (nextAutoTrade) {
  if (
    !item.targetPrice &&
    !item.secondTargetPrice &&
    !item.stopLossPrice &&
    !item.trailingStopRate
  ) {
    alert(
      "자동매매 조건이 없습니다.\n\n목표가, 2차 목표가, 손절가, 트레일링스탑 중 하나 이상을 입력하세요."
    );

    return item;
  }

  const ok = confirm(
    `${item.code} 자동매매를 켤까요?\n\n` +
    `조건 도달 시 가상매도가 실행됩니다.\n\n` +
    `${item.targetPrice ? `목표가: ${formatNumber(item.targetPrice)}원\n` : ""}` +
    `${item.secondTargetPrice ? `2차 목표가: ${formatNumber(item.secondTargetPrice)}원\n` : ""}` +
    `${item.stopLossPrice ? `손절가: ${formatNumber(item.stopLossPrice)}원\n` : ""}` +
    `${item.trailingStopRate ? `트레일링스탑: ${item.trailingStopRate}%\n` : ""}`
  );

  if (!ok) {
    return item;
  }
}

  strategyStates[code] = {
  status: "WAITING",
  lastAction: "NONE",
  lastSignalTime: null,
  lastSignalPrice: null,
  lastSoldQty: 0,
  remainQty: 0
};

  saveStrategyStates();

  return {
    ...item,
    autoTrade: nextAutoTrade
  };
}
        return item;
      });

      saveHoldings();
      renderHoldings();
    });
  });

  document.querySelectorAll(".hold-edit").forEach((btn) => {
    btn.addEventListener("click", () => {
      const code = btn.dataset.holdCode;
      const item = holdings.find((stock) => stock.code === code);

      if (!item) return;

      holdCodeInput.value = item.code;
      buyPriceInput.value = item.buyPrice;
      holdQtyInput.value = item.qty;
      targetPriceInput.value = item.targetPrice || "";
secondTargetPriceInput.value = item.secondTargetPrice || "";
trailingStopRateInput.value =
  item.trailingStopRate || "";
stopLossPriceInput.value = item.stopLossPrice || "";

      holdCodeInput.focus();
    });
  });
}

async function renderHoldings(silent = false) {
  if (holdings.length === 0) {
    holdList.innerHTML = `<div class="empty">보유종목을 추가하세요.</div>`;
    holdSummary.innerHTML = `
      <div><span>총 매수금액</span><strong>0원</strong></div>
      <div><span>총 평가금액</span><strong>0원</strong></div>
      <div><span>총 손익</span><strong>0원</strong></div>
      <div><span>총 수익률</span><strong>0.00%</strong></div>
    `;
    return;
  }

  if (!silent) {
    holdList.innerHTML = `<div class="loading">보유종목 계산 중...</div>`;
  }

  try {
    const calculatedHoldings = [];

    for (const item of holdings) {
      const data = await fetchStockPrice(item.code);

      const currentPrice = Number(
        data.currentPrice ||
        data.price ||
        data.curPrice ||
        data.stck_prpr ||
        data.output?.stck_prpr ||
        0
      );

      const buyAmount = item.buyPrice * item.qty;
      const evalAmount = currentPrice * item.qty;
      const profit = evalAmount - buyAmount;
      const profitRate = buyAmount > 0 ? (profit / buyAmount) * 100 : 0;

      const masterStock = STOCK_MASTER.find((stock) => stock.code === item.code);

      calculatedHoldings.push({
        ...item,
        name: data.name || masterStock?.name || item.code,
        currentPrice,
        buyAmount,
        evalAmount,
        profit,
        profitRate
      });
    }

    if (currentHoldSortType === "profit") {
      calculatedHoldings.sort((a, b) => b.profit - a.profit);
    }

    if (currentHoldSortType === "rate") {
      calculatedHoldings.sort((a, b) => b.profitRate - a.profitRate);
    }

    if (currentHoldSortType === "eval") {
      calculatedHoldings.sort((a, b) => b.evalAmount - a.evalAmount);
    }

    renderHoldRankBox(calculatedHoldings);

    let totalBuyAmount = 0;
    let totalEvalAmount = 0;

    const totalEvalForWeight = calculatedHoldings.reduce((sum, item) => {
      return sum + item.evalAmount;
    }, 0);
    
    let needFullRender = false;
    const rendered = calculatedHoldings.map((item) => {
      totalBuyAmount += item.buyAmount;
      totalEvalAmount += item.evalAmount;

      const profitClass = item.profit >= 0 ? "up" : "down";

      const isTargetHit =
        item.targetPrice &&
        item.currentPrice >= item.targetPrice;

    const isStopLossHit =
  item.stopLossPrice &&
  item.currentPrice <= item.stopLossPrice;
     updateHighestPrice(item);
      const strategyResult = evaluateStrategy(item);

if (
  strategyResult.action === "SELL" ||
  strategyResult.action === "SELL_ALL" ||
  strategyResult.action === "SELL_TRAILING" ||
  strategyResult.action === "STOP_LOSS"
) {
  needFullRender = true;
}

processStrategyResult(item, strategyResult);

      const state = getStrategyState(item.code);
      const strategyStatusText = getStrategyStatusText(state.status);

      const targetGap = item.targetPrice
  ? item.targetPrice - item.currentPrice
  : 0;

const secondTargetGap = item.secondTargetPrice
  ? item.secondTargetPrice - item.currentPrice
  : 0;

const stopLossGap = item.stopLossPrice
  ? item.currentPrice - item.stopLossPrice
  : 0;

const trailingSellPrice =
  item.trailingStopRate && item.highestPrice
    ? Math.floor(item.highestPrice * (1 - item.trailingStopRate / 100))
    : 0;

    const trailingGap =
  trailingSellPrice
    ? item.currentPrice - trailingSellPrice
    : 0;

      const weightRate =
        totalEvalForWeight > 0 ? (item.evalAmount / totalEvalForWeight) * 100 : 0;
       item.weightRate = weightRate;
      return `
        <div class="hold-item ${isTargetHit ? "target-hit" : ""} ${isStopLossHit ? "stop-loss-hit" : ""}" data-code="${item.code}">
          <div class="hold-top">
            <div>
              <div class="hold-name">${item.name}</div>
              <div class="hold-code">${item.code}</div>
            </div>
            <div>
              <div class="hold-profit hold-profit-value ${profitClass}">
                ${item.profit >= 0 ? "+" : ""}${formatNumber(item.profit)}원
              </div>
              <div class="hold-profit-rate ${profitClass}" style="text-align:right;font-weight:800;">
                ${item.profitRate >= 0 ? "+" : ""}${item.profitRate.toFixed(2)}%
              </div>
            </div>
          </div>

          <div class="hold-row">
           
            <span>매수가 <strong class="hold-buy-price">${formatNumber(item.buyPrice)}</strong></span>
            <span>현재가 <strong class="hold-current-price">${formatNumber(item.currentPrice)}</strong></span>
          </div>

          <div class="hold-row">
            <span>수량 <strong class="hold-qty">${formatNumber(item.qty)}주</strong></span>
            <span>평가금액 <strong class="hold-eval-amount">${formatNumber(item.evalAmount)}원</strong></span>
          </div>

          <div class="hold-row">
  <span>매수금액</span>
  <strong class="hold-buy-amount">${formatNumber(item.buyAmount)}원</strong>
</div>


          <div class="hold-row">
            <span>보유비중</span>
            <strong class="hold-weight-rate">${weightRate.toFixed(1)}%</strong>
          </div>

<div class="hold-strategy-panel">
  <div class="hold-strategy-title">자동매매 상태판</div>

  ${item.targetPrice ? `
  <div class="hold-row">
    <span>1차 목표 ${formatNumber(item.targetPrice)}원</span>
    <strong class="hold-target-status ${item.currentPrice >= item.targetPrice ? "up" : ""}">
      ${
        item.currentPrice >= item.targetPrice
          ? "목표도달"
          : `+${formatNumber(targetGap)}원 남음`
      }
    </strong>
  </div>
` : ""}

${item.secondTargetPrice ? `
  <div class="hold-row">
    <span>2차 목표 ${formatNumber(item.secondTargetPrice)}원</span>
    <strong class="hold-second-target-status ${item.currentPrice >= item.secondTargetPrice ? "up" : ""}">
      ${
        item.currentPrice >= item.secondTargetPrice
          ? "2차도달"
          : `+${formatNumber(secondTargetGap)}원 남음`
      }
    </strong>
  </div>
` : ""}

${item.trailingStopRate ? `
  <div class="hold-row">
    <span>트레일링 ${item.trailingStopRate}%</span>
    <strong class="hold-highest-price">
      ${
        item.highestPrice
          ? `최고 ${formatNumber(item.highestPrice)}원 / 발동 ${formatNumber(trailingSellPrice)}원 / ${formatNumber(item.currentPrice - trailingSellPrice)}원 여유`
          : "자동ON 후 최고가 추적"
      }
    </strong>
  </div>
` : ""}

${item.stopLossPrice ? `
  <div class="hold-row">
    <span>손절 ${formatNumber(item.stopLossPrice)}원</span>
    <strong class="hold-stoploss-status ${item.currentPrice <= item.stopLossPrice ? "down" : ""}">
      ${
        item.currentPrice <= item.stopLossPrice
          ? "손절신호"
          : `${formatNumber(stopLossGap)}원 여유`
      }
    </strong>
  </div>
` : ""}

  <div class="hold-row">
    <span>자동매매</span>
    <strong class="hold-auto-status ${item.autoTrade ? "up" : ""}">
      ${item.autoTrade ? "ON · 감시중" : "OFF · 조건확인"}
    </strong>
  </div>

  <div class="hold-row">
    <span>전략상태</span>
    <strong class="hold-strategy-status ${state.status === "SOLD" ? "down" : "up"}">
      ${strategyStatusText}
    </strong>
  </div>
</div>

          ${state.lastAction && state.lastAction !== "NONE" ? `
  <div class="hold-row hold-last-action-row">
    <span>최근액션</span>
    <strong class="hold-last-action-value ${state.lastAction === "STOP_LOSS" ? "down" : "up"}">
      ${
        state.lastAction === "SELL"
          ? "1차매도"
          : state.lastAction === "SELL_ALL"
          ? "2차매도"
          : state.lastAction === "SELL_TRAILING"
          ? "트레일링매도"
          : state.lastAction === "STOP_LOSS"
          ? "손절매도"
          : state.lastAction
      }
    </strong>
  </div>
` : ""}

          ${state.lastSignalTime ? `
  <div class="hold-row hold-last-signal-row">
    <span>최근신호</span>
    <strong class="hold-last-signal-time">${state.lastSignalTime}</strong>
  </div>
` : ""}

${state.lastSignalPrice ? `
  <div class="hold-row hold-last-signal-price-row">
    <span>신호가격</span>
    <strong class="hold-last-signal-price">${formatNumber(state.lastSignalPrice)}원</strong>
  </div>
` : ""}

${state.lastSoldQty ? `
  <div class="hold-row hold-partial-sell-row">
    <span>분할매도</span>
    <strong class="hold-partial-sell-value">
  ${formatNumber(state.lastSoldQty)}주 매도 / 잔여 ${formatNumber(state.remainQty || 0)}주
</strong>
  </div>
` : ""}

          <div class="hold-action-row">
            <button class="hold-auto ${item.autoTrade ? "active" : ""}" data-hold-code="${item.code}">
              ${item.autoTrade ? "자동ON" : "자동OFF"}
            </button>
            <button class="hold-edit" data-hold-code="${item.code}">수정</button>
            <button class="hold-remove" data-hold-code="${item.code}">삭제</button>
          </div>
        </div>
      `;
    });

    const totalProfit = totalEvalAmount - totalBuyAmount;
    const totalRate = totalBuyAmount > 0 ? (totalProfit / totalBuyAmount) * 100 : 0;
    const totalClass = totalProfit >= 0 ? "up" : "down";

    holdSummary.innerHTML = `
      <div><span>총 매수금액</span><strong>${formatNumber(totalBuyAmount)}원</strong></div>
      <div><span>총 평가금액</span><strong>${formatNumber(totalEvalAmount)}원</strong></div>
      <div>
        <span>총 손익</span>
        <strong class="${totalClass}">${totalProfit >= 0 ? "+" : ""}${formatNumber(totalProfit)}원</strong>
      </div>
      <div>
        <span>총 수익률</span>
        <strong class="${totalClass}">${totalRate >= 0 ? "+" : ""}${totalRate.toFixed(2)}%</strong>
      </div>
    `;

    if (needFullRender) {
  await renderHoldings(false);
  return;
}

    const hasHoldCards = document.querySelectorAll(".hold-item").length > 0;

    if (silent && hasHoldCards && currentHoldSortType === "default" && !needFullRender) {
      let updateSuccess = true;

      calculatedHoldings.forEach((item) => {
        const ok = updateHoldingItemOnly(item);
        if (!ok) updateSuccess = false;
      });

      if (!updateSuccess) {
        holdList.innerHTML = rendered.join("");
        bindHoldItemEvents();
      }
    } else {
      holdList.innerHTML = rendered.join("");
      bindHoldItemEvents();
    }

  } catch (error) {
    holdList.innerHTML = `
      <div class="error">
        보유종목 계산 실패<br />
        ${error.message}
      </div>
    `;
  }
}

function addHolding() {
  const targetPrice = Number(targetPriceInput.value) || 0;
  const stopLossPrice = Number(stopLossPriceInput.value) || 0;
  const stock = findStockByInput(holdCodeInput.value.trim());
  const code = stock?.code;
  const buyPrice = Number(buyPriceInput.value);
  const qty = Number(holdQtyInput.value);
  const secondTargetPrice = Number(secondTargetPriceInput.value) || 0;
  const trailingStopRate =
  Number(trailingStopRateInput.value) || 0;


  if (!code) {
    alert("종목명 또는 종목코드를 입력하세요.");
    return;
  }

  if (!buyPrice || buyPrice <= 0) {
    alert("매수가를 입력하세요.");
    return;
  }

  if (!qty || qty <= 0) {
    alert("수량을 입력하세요.");
    return;
  }

  holdings = holdings.filter((item) => item.code !== code);

 holdings.push({
  code,
  buyPrice,
  qty,
  targetPrice,
  secondTargetPrice,
  trailingStopRate,
  highestPrice: 0,
  stopLossPrice,
  autoTrade: false
});

strategyStates[code] = {
  status: "WAITING",
  lastAction: "NONE",
  lastSignalTime: null,
  lastSignalPrice: null,
  lastSoldQty: 0,
  remainQty: 0
};

saveStrategyStates();

saveHoldings();

holdCodeInput.value = "";
buyPriceInput.value = "";
holdQtyInput.value = "";
targetPriceInput.value = "";
stopLossPriceInput.value = "";
secondTargetPriceInput.value = "";
trailingStopRateInput.value = "";

  renderHoldings();
}

addHoldBtn.addEventListener("click", addHolding);

holdQtyInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    addHolding();
  }
});

updateTestModeUI();
updateApiStatus("API 대기중");

loadWatchList();
renderHoldings();
renderTradeLogs();


const sortButtons = document.querySelectorAll(".sort-btn");

sortButtons.forEach((btn) => {
  btn.addEventListener("click", () => {

    sortButtons.forEach((item) => {
      item.classList.remove("active");
    });

    btn.classList.add("active");

    currentSortType = btn.dataset.sort;

    loadWatchList();
  });
});

saveAlertRateBtn.addEventListener("click", () => {
  const value = Number(alertRateInput.value);

  if (isNaN(value) || value <= 0) {
    alert("알림 기준 상승률을 입력하세요.");
    return;
  }

  alertRate = value;
  localStorage.setItem(ALERT_RATE_KEY, String(alertRate));

  loadWatchList();
});

if (saveEntryRateBtn) {
  saveEntryRateBtn.addEventListener("click", () => {
    const value = Number(entryRateInput.value);

    if (isNaN(value) || value <= 0) {
      alert("진입후보 기준 상승률을 입력하세요.");
      return;
    }

    entryRate = value;
    localStorage.setItem(ENTRY_RATE_KEY, String(entryRate));

    loadWatchList();
  });
}

const holdSortButtons = document.querySelectorAll(".hold-sort-btn");

holdSortButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    holdSortButtons.forEach((item) => {
      item.classList.remove("active");
    });

    btn.classList.add("active");

    currentHoldSortType = btn.dataset.holdSort;

    renderHoldings();
  });
});

if (emergencyStopBtn) {
  emergencyStopBtn.addEventListener("click", () => {
    const ok = confirm("자동매매를 전부 중지할까요?");

    if (!ok) return;

    holdings = holdings.map((item) => {
 strategyStates[item.code] = {
  status: "WAITING",
  lastAction: "NONE",
  lastSignalTime: null,
  lastSignalPrice: null,
  lastSoldQty: 0,
  remainQty: 0
};

  return {
    ...item,
    autoTrade: false
  };
});

saveStrategyStates();
saveHoldings();
renderHoldings();

    alert("전체 종목 자동매매가 중지되었습니다.");
  });
}

if (clearTradeLogBtn) {
  clearTradeLogBtn.addEventListener("click", () => {
    const ok = confirm(
      "매매 신호 로그를 모두 삭제할까요?\n\n보유종목은 삭제되지 않습니다."
    );

    if (!ok) return;

    tradeLogs = [];
    saveTradeLogs();
    renderTradeLogs();

    alert("매매 신호 로그가 삭제되었습니다.");
  });
}

if (resetHoldingsBtn) {
  resetHoldingsBtn.addEventListener("click", () => {
    const ok = confirm(
      "보유종목과 전략상태를 모두 초기화할까요?\n\n매매 로그는 삭제되지 않습니다."
    );

    if (!ok) return;

    holdings = [];
    strategyStates = {};

    saveHoldings();
    saveStrategyStates();
    renderHoldings();

    alert("보유종목과 전략상태가 초기화되었습니다.");
  });
}