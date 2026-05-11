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

async function loadWatchList() {
  watchList.innerHTML = `<div class="loading">관심종목 조회 중...</div>`;

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

watchList.innerHTML =
  sortedData.map(renderWatchItem).join("");

    document.querySelectorAll(".watch-item").forEach((el) => {
  el.addEventListener("click", () => {
    stockCodeInput.value = el.dataset.code;
    searchStock();
    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });
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

function startAutoRefresh() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
  }

  isAutoRefresh = true;
  autoRefreshBtn.textContent = "자동ON";
  autoRefreshBtn.classList.add("active");

  loadWatchList();
renderHoldings();

autoRefreshTimer = setInterval(() => {
  loadWatchList();
  renderHoldings();
}, 5000);
}

function stopAutoRefresh() {
  isAutoRefresh = false;
  autoRefreshBtn.textContent = "자동OFF";
  autoRefreshBtn.classList.remove("active");

  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
}

loadWatchBtn.addEventListener("click", () => {
  loadWatchList();
  renderHoldings();
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
const addHoldBtn = document.getElementById("addHoldBtn");
const holdList = document.getElementById("holdList");

const HOLD_STORAGE_KEY = "kiwoom_holdings";

let holdings = JSON.parse(localStorage.getItem(HOLD_STORAGE_KEY)) || [];

function saveHoldings() {
  localStorage.setItem(HOLD_STORAGE_KEY, JSON.stringify(holdings));
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
  `;
}

async function renderHoldings() {
  if (holdings.length === 0) {
    holdList.innerHTML = `<div class="empty">보유종목을 추가하세요.</div>`;
    holdSummary.innerHTML = `
      <div>
        <span>총 매수금액</span>
        <strong>0원</strong>
      </div>
      <div>
        <span>총 평가금액</span>
        <strong>0원</strong>
      </div>
      <div>
        <span>총 손익</span>
        <strong>0원</strong>
      </div>
      <div>
        <span>총 수익률</span>
        <strong>0.00%</strong>
      </div>
    `;
    return;
  }

  holdList.innerHTML = `<div class="loading">보유종목 계산 중...</div>`;

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

     const masterStock = STOCK_MASTER.find(
  (stock) => stock.code === item.code
);

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
      renderHoldRankBox(calculatedHoldings);
    }

    let totalBuyAmount = 0;
    let totalEvalAmount = 0;
    const totalEvalForWeight = calculatedHoldings.reduce((sum, item) => {
     return sum + item.evalAmount;
     }, 0);

    const rendered = calculatedHoldings.map((item) => {
      totalBuyAmount += item.buyAmount;
      totalEvalAmount += item.evalAmount;

      const profitClass = item.profit >= 0 ? "up" : "down";
      const weightRate =
      totalEvalForWeight > 0 ? (item.evalAmount / totalEvalForWeight) * 100 : 0;


      return `
        <div class="hold-item">
          <div class="hold-top">
            <div>
              <div class="hold-name">${item.name}</div>
              <div class="hold-code">${item.code}</div>
            </div>
            <div>
              <div class="hold-profit ${profitClass}">
                ${item.profit >= 0 ? "+" : ""}${formatNumber(item.profit)}원
              </div>
              <div class="${profitClass}" style="text-align:right;font-weight:800;">
                ${item.profitRate >= 0 ? "+" : ""}${item.profitRate.toFixed(2)}%
              </div>
            </div>
          </div>

          <div class="hold-row">
            <span>매수가 ${formatNumber(item.buyPrice)}</span>
            <span>현재가 ${formatNumber(item.currentPrice)}</span>
          </div>

          <div class="hold-row">
            <span>수량 ${formatNumber(item.qty)}주</span>
            <span>평가금액 ${formatNumber(item.evalAmount)}원</span>
          </div>
          
          <div class="hold-row">
            <span>보유비중</span>
            <strong>${weightRate.toFixed(1)}%</strong>
          </div>

          <div class="hold-action-row">
  <button class="hold-edit" data-hold-code="${item.code}">
    수정
  </button>
  <button class="hold-remove" data-hold-code="${item.code}">
    삭제
  </button>
</div>
        </div>
      `;
    });

    const totalProfit = totalEvalAmount - totalBuyAmount;
    const totalRate =
      totalBuyAmount > 0 ? (totalProfit / totalBuyAmount) * 100 : 0;

    const totalClass = totalProfit >= 0 ? "up" : "down";

    holdSummary.innerHTML = `
      <div>
        <span>총 매수금액</span>
        <strong>${formatNumber(totalBuyAmount)}원</strong>
      </div>
      <div>
        <span>총 평가금액</span>
        <strong>${formatNumber(totalEvalAmount)}원</strong>
      </div>
      <div>
        <span>총 손익</span>
        <strong class="${totalClass}">
          ${totalProfit >= 0 ? "+" : ""}${formatNumber(totalProfit)}원
        </strong>
      </div>
      <div>
        <span>총 수익률</span>
        <strong class="${totalClass}">
          ${totalRate >= 0 ? "+" : ""}${totalRate.toFixed(2)}%
        </strong>
      </div>
    `;

    holdList.innerHTML = rendered.join("");

    document.querySelectorAll(".hold-remove").forEach((btn) => {
      btn.addEventListener("click", () => {
        const code = btn.dataset.holdCode;
        holdings = holdings.filter((item) => item.code !== code);
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

    holdCodeInput.focus();
  });
});

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
    qty
  });

  saveHoldings();

  holdCodeInput.value = "";
  buyPriceInput.value = "";
  holdQtyInput.value = "";

  renderHoldings();
}

addHoldBtn.addEventListener("click", addHolding);

holdQtyInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    addHolding();
  }
});

renderHoldings();

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