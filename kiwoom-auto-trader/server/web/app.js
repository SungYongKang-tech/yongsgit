const API_BASE = "http://localhost:3000";

const stockCodeInput = document.getElementById("stockCode");
const searchBtn = document.getElementById("searchBtn");
const resultCard = document.getElementById("resultCard");
const suggestList = document.getElementById("suggestList");

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

let watchCodes = JSON.parse(localStorage.getItem(WATCH_STORAGE_KEY)) || [
  "005930",
  "000660",
  "005380",
  "035420",
  "035720"
];

let previousPrices = {};

function saveWatchCodes() {
  localStorage.setItem(WATCH_STORAGE_KEY, JSON.stringify(watchCodes));
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

    watchList.innerHTML = data.map(renderWatchItem).join("");

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

  autoRefreshTimer = setInterval(() => {
    loadWatchList();
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

loadWatchBtn.addEventListener("click", loadWatchList);

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