const API_BASE = "http://localhost:3000";

const stockCodeInput = document.getElementById("stockCode");
const searchBtn = document.getElementById("searchBtn");
const resultCard = document.getElementById("resultCard");
const suggestList = document.getElementById("suggestList");

const alertRateInput = document.getElementById("alertRateInput");
const saveAlertRateBtn = document.getElementById("saveAlertRateBtn");
const alertBox = document.getElementById("alertBox");


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
    const res = await fetch(`${API_BASE}/price/${code}`);
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.message || "조회 실패");
    }

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

let alertRate = Number(localStorage.getItem(ALERT_RATE_KEY)) || 5;
alertRateInput.value = alertRate;

let currentSortType = "default";
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

function renderWatchItem(item) {
  const rateClass = getRateClass(item.changeRate);

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
          <div class="watch-name">${item.name}</div>
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
    const res = await fetch(`${API_BASE}/prices`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        codes: watchCodes
      })
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.message || "관심종목 조회 실패");
    }

    let sortedData = [...data];
    renderAlertBox(data);

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
    await loadWatchList(true);
    await renderHoldings(true);
    renderTradeLogs();
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
    await loadWatchList();
    await renderHoldings();
    renderTradeLogs();
  } finally {
    isRefreshing = false;
  }
}

async function startAutoRefresh() {
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
const addHoldBtn = document.getElementById("addHoldBtn");
const holdList = document.getElementById("holdList");
const emergencyStopBtn = document.getElementById("emergencyStopBtn");

const tradeLogList = document.getElementById("tradeLogList");

const TRADE_LOG_KEY = "kiwoom_virtual_trade_logs";
let tradeLogs = JSON.parse(localStorage.getItem(TRADE_LOG_KEY)) || [];

const DAILY_TRADE_LIMIT = 20;
const DAILY_TRADE_LIMIT_PER_CODE = 3;
const TRADE_COOLDOWN_MINUTES = 3;

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
    tradeLogList.innerHTML = `<div class="empty">아직 발생한 매매 신호가 없습니다.</div>`;
    return;
  }

  tradeLogList.innerHTML = tradeLogs
    .slice()
    .reverse()
    .map((log) => `
      <div class="trade-log-item">
        <strong class="${log.type === "SELL" ? "up" : "down"}">
          ${
  log.type === "SELL"
    ? "가상매도"
    : log.type === "STOP_LOSS"
    ? "가상손절"
    : "가상매수"
}
        </strong>
        ${log.name} / ${formatNumber(log.price)}원

        <div class="trade-log-time">
          ${log.reason} · ${log.time}
        </div>
      </div>
    `)
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

  const marketOpen = 9 * 60;       // 09:00
  const marketClose = 15 * 60 + 30; // 15:30

  return currentMinutes >= marketOpen && currentMinutes <= marketClose;
}

function getRefreshInterval() {
  if (isMarketOpenNow()) {
    return 5000; // 장중: 5초
  }

  return 30000; // 장외/휴장: 30초
}

function getStrategyState(code) {
  if (!strategyStates[code]) {
    strategyStates[code] = {
      status: "WAITING",
      lastAction: "NONE",
      lastSignalTime: null
    };
  }

  return strategyStates[code];
}

function getStrategyStatusText(status) {
  if (status === "WAITING") return "대기중";
  if (status === "SOLD") return "매도완료";
  if (status === "SELL_SIGNAL") return "매도신호";
  if (status === "STOP_SIGNAL") return "손절신호";
  return "대기중";
}

function evaluateStrategy(item) {
  const state = getStrategyState(item.code);
  const isTargetHit =
    item.targetPrice &&
    item.currentPrice >= item.targetPrice;

  const isStopLossHit =
    item.stopLossPrice &&
    item.currentPrice <= item.stopLossPrice;

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

  if (isTargetHit) {
    return {
      action: "SELL",
      reason: `자동매매ON · 목표가 ${formatNumber(item.targetPrice)}원 도달`
    };
  }

  if (isStopLossHit) {
    return {
      action: "STOP_LOSS",
      reason: `자동매매ON · 손절가 ${formatNumber(item.stopLossPrice)}원 이탈`
    };
  }

  return {
    action: "HOLD",
    reason: "조건 미충족"
  };
}

function processStrategyResult(item, strategyResult) {
  if (strategyResult.action !== "SELL" && strategyResult.action !== "STOP_LOSS") {
    return;
  }

  if (!isMarketOpenNow()) {
    console.warn("장 운영시간이 아니므로 매매 실행을 하지 않습니다.");
    return;
  }

  addTradeLog({
    type: strategyResult.action,
    code: item.code,
    name: item.name,
    price: item.currentPrice,
    reason: strategyResult.reason
  });

  executeVirtualSell(item.code, strategyResult.action);
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

if (!isMarketOpenNow()) {
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
    date: todayKey,
    time: new Date().toLocaleString("ko-KR")
  });

  saveTradeLogs();
  renderTradeLogs();
}

function executeVirtualSell(code, actionType = "SELL") {
  holdings = holdings.map((item) => {
    if (item.code === code) {
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
  status: "SOLD",
  lastAction: actionType,
  lastSignalTime: new Date().toLocaleString("ko-KR")
};

  saveStrategyStates();
}


async function fetchStockPrice(code) {
  const res = await fetch(`${API_BASE}/price/${code}`);
  const data = await res.json();

console.log("보유종목 현재가 응답:", code, data);
  
if (!res.ok) {
    throw new Error(data.message || "현재가 조회 실패");
  }

  return data;
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

  if (!profitEl || !rateEl || !currentPriceEl || !evalAmountEl) {
    return false;
  }

  
  const profitClass = item.profit >= 0 ? "up" : "down";

 const state = getStrategyState(item.code);
const strategyStatusText = getStrategyStatusText(state.status);

  profitEl.className = `hold-profit hold-profit-value ${profitClass}`;
  profitEl.textContent =
    `${item.profit >= 0 ? "+" : ""}${formatNumber(item.profit)}원`;

  rateEl.className = `hold-profit-rate ${profitClass}`;
  rateEl.style.textAlign = "right";
  rateEl.style.fontWeight = "800";
  rateEl.textContent =
    `${item.profitRate >= 0 ? "+" : ""}${item.profitRate.toFixed(2)}%`;

  currentPriceEl.textContent = formatNumber(item.currentPrice);
  evalAmountEl.textContent = `${formatNumber(item.evalAmount)}원`;

  return true;
}

function bindHoldItemEvents() {
  document.querySelectorAll(".hold-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      const code = btn.dataset.holdCode;
      holdings = holdings.filter((item) => item.code !== code);
      saveHoldings();
      renderHoldings();
    });
  });

  document.querySelectorAll(".hold-auto").forEach((btn) => {
    btn.addEventListener("click", () => {
      const code = btn.dataset.holdCode;

      holdings = holdings.map((item) => {
        if (item.code === code) {
          return {
            ...item,
            autoTrade: !item.autoTrade
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

      const strategyResult = evaluateStrategy(item);
      processStrategyResult(item, strategyResult);

      const state = getStrategyState(item.code);
      const strategyStatusText = getStrategyStatusText(state.status);

      const weightRate =
        totalEvalForWeight > 0 ? (item.evalAmount / totalEvalForWeight) * 100 : 0;

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
            <span>매수가 ${formatNumber(item.buyPrice)}</span>
            <span>현재가 <strong class="hold-current-price">${formatNumber(item.currentPrice)}</strong></span>
          </div>

          <div class="hold-row">
            <span>수량 ${formatNumber(item.qty)}주</span>
            <span>평가금액 <strong class="hold-eval-amount">${formatNumber(item.evalAmount)}원</strong></span>
          </div>

          <div class="hold-row">
            <span>보유비중</span>
            <strong>${weightRate.toFixed(1)}%</strong>
          </div>

          ${item.targetPrice ? `
            <div class="hold-row">
              <span>목표가 ${formatNumber(item.targetPrice)}원</span>
              <strong class="${item.currentPrice >= item.targetPrice ? "up" : ""}">
                ${item.currentPrice >= item.targetPrice ? "목표도달" : "대기중"}
              </strong>
            </div>
          ` : ""}

          ${item.stopLossPrice ? `
            <div class="hold-row">
              <span>손절가 ${formatNumber(item.stopLossPrice)}원</span>
              <strong class="${item.currentPrice <= item.stopLossPrice ? "down" : ""}">
                ${item.currentPrice <= item.stopLossPrice ? "손절신호" : "대기중"}
              </strong>
            </div>
          ` : ""}

          <div class="hold-row">
            <span>자동매매</span>
            <strong class="${item.autoTrade ? "up" : ""}">
              ${item.autoTrade ? "ON" : "OFF"}
            </strong>
          </div>

          <div class="hold-row">
            <span>전략상태</span>
            <strong class="${state.status === "SOLD" ? "down" : "up"}">
              ${strategyStatusText}
            </strong>
          </div>

          ${state.lastSignalTime ? `
            <div class="hold-row">
              <span>최근신호</span>
              <strong>${state.lastSignalTime}</strong>
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

    const hasHoldCards = document.querySelectorAll(".hold-item").length > 0;

    if (silent && hasHoldCards && currentHoldSortType === "default") {
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
  stopLossPrice,
  autoTrade: false
});

strategyStates[code] = {
  status: "WAITING",
  lastAction: "NONE",
  lastSignalTime: null
};

saveStrategyStates();

saveHoldings();

  holdCodeInput.value = "";
  buyPriceInput.value = "";
  holdQtyInput.value = "";
  targetPriceInput.value = "";
  stopLossPriceInput.value = "";

  renderHoldings();
}

addHoldBtn.addEventListener("click", addHolding);

holdQtyInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    addHolding();
  }
});

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

    holdings = holdings.map((item) => ({
      ...item,
      autoTrade: false
    }));

    saveHoldings();
    renderHoldings();

    alert("전체 종목 자동매매가 중지되었습니다.");
  });
}