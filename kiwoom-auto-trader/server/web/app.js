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