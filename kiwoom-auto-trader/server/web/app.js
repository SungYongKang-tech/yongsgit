const API_BASE = "http://localhost:3000";

const stockCodeInput = document.getElementById("stockCode");
const searchBtn = document.getElementById("searchBtn");
const resultCard = document.getElementById("resultCard");

function formatNumber(value) {
  if (value === null || value === undefined || value === "") return "-";
  return Number(value).toLocaleString("ko-KR");
}

function getRateClass(rateText) {
  if (!rateText) return "";
  if (String(rateText).startsWith("-")) return "down";
  return "up";
}

async function searchStock() {
  const code = stockCodeInput.value.trim();

  if (!code) {
    resultCard.innerHTML = `<div class="error">종목코드를 입력하세요.</div>`;
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

const watchCodes = [
  "005930", // 삼성전자
  "000660", // SK하이닉스
  "005380", // 현대차
  "035420", // NAVER
  "035720"  // 카카오
];

function renderWatchItem(item) {
  const rateClass = getRateClass(item.changeRate);

  return `
    <div class="watch-item" data-code="${item.code}">
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

  } catch (error) {
    watchList.innerHTML = `
      <div class="error">
        관심종목 조회 실패<br />
        ${error.message}
      </div>
    `;
  }
}

loadWatchBtn.addEventListener("click", loadWatchList);

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