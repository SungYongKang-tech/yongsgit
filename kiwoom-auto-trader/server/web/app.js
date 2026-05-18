const API_BASE = "https://sytrader.duckdns.org";

const stockCodeInput = document.getElementById("stockCode");
const searchBtn = document.getElementById("searchBtn");
const resultCard = document.getElementById("resultCard");
const suggestList = document.getElementById("suggestList");
const addStockSuggestList = document.getElementById("addStockSuggestList");
const holdSuggestList = document.getElementById("holdSuggestList");
const backtestSuggestList = document.getElementById("backtestSuggestList");
const resumeAutoTradeBtn =
  document.getElementById("resumeAutoTradeBtn");
const selectedStockCodes = {};
const dailyMaxLossInput =
  document.getElementById("dailyMaxLossInput");

  const maxConsecutiveLossInput =
  document.getElementById("maxConsecutiveLossInput");

const saveMaxConsecutiveLossBtn =
  document.getElementById("saveMaxConsecutiveLossBtn");

const saveDailyMaxLossBtn =
  document.getElementById("saveDailyMaxLossBtn");
const alertRateInput = document.getElementById("alertRateInput");
const saveAlertRateBtn = document.getElementById("saveAlertRateBtn");
const alertBox = document.getElementById("alertBox");
const entryRateInput = document.getElementById("entryRateInput");
const saveEntryRateBtn = document.getElementById("saveEntryRateBtn");
const entryBox = document.getElementById("entryBox");
const strongStockBox =
  document.getElementById("strongStockBox");
const autoDiscoverBtn =
  document.getElementById("autoDiscoverBtn");

const autoDiscoverAutoBtn =
  document.getElementById("autoDiscoverAutoBtn");

let autoDiscoverTimer = null;
const AUTO_DISCOVER_AUTO_KEY =
  "kiwoom_auto_discover_auto";

let isAutoDiscoverAuto =
  localStorage.getItem(AUTO_DISCOVER_AUTO_KEY) === "true";

const DISCOVER_SETTING_KEY = "kiwoom_discover_settings";

const discoverLimitInput =
  document.getElementById("discoverLimitInput");

const discoverMinScoreInput =
  document.getElementById("discoverMinScoreInput");

  const discoverSettings =
  JSON.parse(localStorage.getItem(DISCOVER_SETTING_KEY)) || {
    limit: 300,
    minScore: 5
  };

if (discoverLimitInput) {
  discoverLimitInput.value = discoverSettings.limit;
}

if (discoverMinScoreInput) {
  discoverMinScoreInput.value = discoverSettings.minScore;
}

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

  const defaultBuyAmountInput =
  document.getElementById("defaultBuyAmountInput");

const saveDefaultBuyAmountBtn =
  document.getElementById("saveDefaultBuyAmountBtn");

  const maxHoldingCountInput =
  document.getElementById("maxHoldingCountInput");

const saveVolumeThresholdBtn =
  document.getElementById("saveVolumeThresholdBtn");

const apiStatusBar =
  document.getElementById("apiStatusBar");

const apiWarningBanner =
  document.getElementById("apiWarningBanner");

const tradeToast = document.getElementById("tradeToast");
let lastTradeAlertKey = null;

const filterOverHeatInput =
  document.getElementById("filterOverHeat");

const filter3DayUpInput =
  document.getElementById("filter3DayUp");

const filterLowVolumeInput =
  document.getElementById("filterLowVolume");

const filterWeakCandleInput =
  document.getElementById("filterWeakCandle");

const BACKTEST_HISTORY_KEY = "kiwoom_backtest_history";

const MORNING_AUTO_RUN_KEY =
  "kiwoom_morning_auto_run_date";

let isMorningAutoFlowRunning = false;

let backtestHistory =
  JSON.parse(localStorage.getItem(BACKTEST_HISTORY_KEY)) || [];

function saveBacktestHistory() {
  localStorage.setItem(
    BACKTEST_HISTORY_KEY,
    JSON.stringify(backtestHistory)
  );
}

function getBacktestHistoryHtml(limit = 5) {
  if (!backtestHistory || backtestHistory.length === 0) {
    return `
      <div class="backtest-detail-box">
        <div class="backtest-detail-title">최근 백테스트 기록</div>
        <div class="empty">저장된 백테스트 기록이 없습니다.</div>
      </div>
    `;
  }

  return `
    <div class="backtest-detail-box">
      <div class="backtest-detail-title">최근 백테스트 기록</div>

      ${backtestHistory.slice(0, limit).map((item) => `
        <div class="virtual-result-item">
          <div class="virtual-result-top">
            <div class="virtual-result-name">
              ${cleanStockName(item.name)} (${item.code})
            </div>
            <div class="virtual-result-badge ${item.finalProfitRate >= 0 ? "" : "loss"}">
              ${item.finalProfitRate >= 0 ? "수익" : "손실"}
            </div>
          </div>

          <div class="virtual-result-detail">
            <div>
              기간 ${item.days}일 /
              신호 ${item.tradeCount}회 /
              승률 ${Number(item.winRate || 0).toFixed(1)}%
            </div>

            <div>
              수익률
              <strong class="${item.finalProfitRate >= 0 ? "up" : "down"}">
                ${item.finalProfitRate >= 0 ? "+" : ""}${Number(item.finalProfitRate || 0).toFixed(2)}%
              </strong>
              · 손익
              <strong class="${item.finalProfit >= 0 ? "up" : "down"}">
                ${item.finalProfit >= 0 ? "+" : ""}${formatNumber(Math.round(item.finalProfit || 0))}원
              </strong>
            </div>

            <div>
              전략: ${(item.strategies || []).join(", ") || "-"}
              / 필터: ${(item.filters || []).join(", ") || "-"}
            </div>

            <div>${item.savedAt}</div>
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

function getBacktestSummaryHtml() {
  if (!backtestHistory || backtestHistory.length === 0) {
    return "";
  }

  const totalCount = backtestHistory.length;

  const avgProfitRate =
    backtestHistory.reduce(
      (sum, item) => sum + Number(item.finalProfitRate || 0),
      0
    ) / totalCount;

  const winCount = backtestHistory.filter(
    (item) => Number(item.finalProfitRate || 0) > 0
  ).length;

  const winRate = (winCount / totalCount) * 100;

  const best = backtestHistory
    .slice()
    .sort(
      (a, b) =>
        Number(b.finalProfitRate || 0) -
        Number(a.finalProfitRate || 0)
    )[0];

  return `
    <div class="backtest-detail-box">
      <div class="backtest-detail-title">백테스트 누적 요약</div>

      <div class="trade-stat-grid">
        <div>
          <span>저장 기록</span>
          <strong>${formatNumber(totalCount)}회</strong>
        </div>

        <div>
          <span>평균 수익률</span>
          <strong class="${avgProfitRate >= 0 ? "up" : "down"}">
            ${avgProfitRate >= 0 ? "+" : ""}${avgProfitRate.toFixed(2)}%
          </strong>
        </div>

        <div>
          <span>수익 비율</span>
          <strong>${winRate.toFixed(1)}%</strong>
        </div>

        <div>
          <span>최고 결과</span>
          <strong class="${Number(best.finalProfitRate || 0) >= 0 ? "up" : "down"}">
            ${best.name} ${Number(best.finalProfitRate || 0).toFixed(2)}%
          </strong>
        </div>
      </div>
    </div>
  `;
}

function getStrategySummaryHtml() {
  if (!backtestHistory || backtestHistory.length === 0) {
    return "";
  }

  const strategyMap = {};

  backtestHistory.forEach((item) => {
    const strategies =
      item.strategies && item.strategies.length > 0
        ? item.strategies
        : ["기본"];

    strategies.forEach((strategy) => {
      if (!strategyMap[strategy]) {
        strategyMap[strategy] = {
          name: strategy,
          count: 0,
          totalProfitRate: 0,
          winCount: 0,
          bestRate: -999
        };
      }

      const rate = Number(item.finalProfitRate || 0);

      strategyMap[strategy].count += 1;
      strategyMap[strategy].totalProfitRate += rate;

      if (rate > 0) {
        strategyMap[strategy].winCount += 1;
      }

      if (rate > strategyMap[strategy].bestRate) {
        strategyMap[strategy].bestRate = rate;
      }
    });
  });

  const rows = Object.values(strategyMap)
    .map((item) => {
      const avgRate = item.totalProfitRate / item.count;
      const winRate = (item.winCount / item.count) * 100;

      return {
        ...item,
        avgRate,
        winRate
      };
    })
    .sort((a, b) => b.avgRate - a.avgRate);

  return `
    <div class="backtest-detail-box">
      <div class="backtest-detail-title">전략별 백테스트 성적</div>

      ${rows.map((item) => `
        <div class="virtual-result-item">
          <div class="virtual-result-top">
            <div class="virtual-result-name">${cleanStockName(item.name)}</div>
            <div class="virtual-result-badge ${item.avgRate >= 0 ? "" : "loss"}">
              ${item.avgRate >= 0 ? "우수" : "주의"}
            </div>
          </div>

          <div class="virtual-result-detail">
            <div>
              실행 ${formatNumber(item.count)}회 /
              승률 ${item.winRate.toFixed(1)}%
            </div>

            <div>
              평균 수익률
              <strong class="${item.avgRate >= 0 ? "up" : "down"}">
                ${item.avgRate >= 0 ? "+" : ""}${item.avgRate.toFixed(2)}%
              </strong>
              · 최고
              <strong class="${item.bestRate >= 0 ? "up" : "down"}">
                ${item.bestRate >= 0 ? "+" : ""}${item.bestRate.toFixed(2)}%
              </strong>
            </div>
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

function getStockSummaryHtml() {
  if (!backtestHistory || backtestHistory.length === 0) {
    return "";
  }

  const stockMap = {};

  backtestHistory.forEach((item) => {
    const key = item.code;

    if (!stockMap[key]) {
      stockMap[key] = {
        code: item.code,
        name: item.name,
        count: 0,
        totalProfitRate: 0,
        winCount: 0,
        bestRate: -999,
        worstRate: 999
      };
    }

    const rate = Number(item.finalProfitRate || 0);

    stockMap[key].count += 1;
    stockMap[key].totalProfitRate += rate;

    if (rate > 0) {
      stockMap[key].winCount += 1;
    }

    stockMap[key].bestRate = Math.max(
      stockMap[key].bestRate,
      rate
    );

    stockMap[key].worstRate = Math.min(
      stockMap[key].worstRate,
      rate
    );
  });

  const rows = Object.values(stockMap)
    .map((item) => ({
      ...item,
      avgRate: item.totalProfitRate / item.count,
      winRate: (item.winCount / item.count) * 100
    }))
    .sort((a, b) => b.avgRate - a.avgRate)
    .slice(0, 10);

  return `
    <div class="backtest-detail-box">
      <div class="backtest-detail-title">
        종목별 백테스트 성적
      </div>

      ${rows.map((item) => {

        const recommended =
          getRecommendedStrategyForCode(item.code);

        const backtestStatus =
         getBacktestStatusText(item.code);

       return `
          <div class="virtual-result-item">

            <div class="virtual-result-top">
              <div class="virtual-result-name">
                ${cleanStockName(item.name)} (${item.code})
              </div>

              <div class="virtual-result-badge ${item.avgRate >= 0 ? "" : "loss"}">
                ${item.avgRate >= 0 ? "양호" : "주의"}
              </div>
            </div>

            <div class="virtual-result-detail">

              <div>
                실행 ${formatNumber(item.count)}회 /
                승률 ${item.winRate.toFixed(1)}%
              </div>

              <div>
                추천전략:
                <strong>
                  ${recommended ? recommended.name : "-"}
                </strong>

                ${
                  recommended
                    ? `(평균 ${recommended.avgRate.toFixed(2)}%)`
                    : ""
                }
              </div>

              <div>
                평균
                <strong class="${item.avgRate >= 0 ? "up" : "down"}">
                  ${item.avgRate >= 0 ? "+" : ""}
                  ${item.avgRate.toFixed(2)}%
                </strong>

                · 최고 ${item.bestRate.toFixed(2)}%
                · 최저 ${item.worstRate.toFixed(2)}%
              </div>

            </div>

          </div>
        `;
      }).join("")}
    </div>
  `;
}

function getRecommendedStrategyForCode(code) {
  const rows = backtestHistory.filter(
  (item) => item.code === code
);

const passedRows = rows.filter(isBacktestPassed);

if (passedRows.length === 0) {
  return null;
}

  const strategyMap = {};

  passedRows.forEach((item) => {
    const strategies =
      item.strategies && item.strategies.length > 0
        ? item.strategies
        : ["기본"];

    strategies.forEach((strategy) => {
      if (!strategyMap[strategy]) {
        strategyMap[strategy] = {
          count: 0,
          totalProfitRate: 0
        };
      }

      strategyMap[strategy].count += 1;
      strategyMap[strategy].totalProfitRate +=
        Number(item.finalProfitRate || 0);
    });
  });

  const result = Object.entries(strategyMap)
    .map(([name, info]) => ({
      name,
      avgRate:
        info.totalProfitRate / info.count,
      count: info.count
    }))
    .sort((a, b) => b.avgRate - a.avgRate);

  return result[0] || null;
}

function clearBacktestHistory() {
  const ok = confirm(
    "저장된 백테스트 기록을 모두 삭제할까요?\n\n" +
    "누적 요약, 전략별 성적, 종목별 성적도 함께 초기화됩니다."
  );

  if (!ok) return;

  backtestHistory = [];
  saveBacktestHistory();

  if (backtestResult) {
    backtestResult.innerHTML = `
      <div class="backtest-detail-box">
        <div class="backtest-detail-title">백테스트 기록</div>
        <div class="empty">백테스트 기록이 초기화되었습니다.</div>
      </div>

      ${getBacktestSummaryHtml()}
      ${getStrategySummaryHtml()}
      ${getStockSummaryHtml()}
      ${getBacktestHistoryHtml()}
    `;
  }

  alert("백테스트 기록이 삭제되었습니다.");
}

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

let lastBestStrategyKey = null;

let latestStrongItems = [];

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

const MAX_CONSECUTIVE_LOSS_KEY =
  "kiwoom_max_consecutive_loss";

let maxConsecutiveLoss =
  Number(localStorage.getItem(MAX_CONSECUTIVE_LOSS_KEY)) || 2;

if (maxConsecutiveLossInput) {
  maxConsecutiveLossInput.value = maxConsecutiveLoss;
}

if (saveMaxConsecutiveLossBtn) {
  saveMaxConsecutiveLossBtn.addEventListener("click", () => {
    const value = Number(maxConsecutiveLossInput.value);

    if (isNaN(value) || value <= 0) {
      alert("연속 손절 제한 횟수를 입력하세요.");
      return;
    }

    maxConsecutiveLoss = value;

    localStorage.setItem(
      MAX_CONSECUTIVE_LOSS_KEY,
      String(maxConsecutiveLoss)
    );

    alert("연속 손절 제한이 저장되었습니다.");
  });
}
const DAILY_MAX_LOSS_KEY =
  "kiwoom_daily_max_loss";

let dailyMaxLoss =
  Number(localStorage.getItem(DAILY_MAX_LOSS_KEY)) || 30000;

if (dailyMaxLossInput) {
  dailyMaxLossInput.value = formatNumber(dailyMaxLoss);
}

if (saveDailyMaxLossBtn) {
  saveDailyMaxLossBtn.addEventListener("click", () => {
    const value =
  Number(dailyMaxLossInput.value.replace(/,/g, ""));

    if (isNaN(value) || value <= 0) {
      alert("하루 최대 손실금을 입력하세요.");
      return;
    }

    dailyMaxLoss = value;
    dailyMaxLossInput.value =
  formatNumber(dailyMaxLoss);

    localStorage.setItem(
      DAILY_MAX_LOSS_KEY,
      String(dailyMaxLoss)
    );

    alert("하루 최대 손실 제한이 저장되었습니다.");
  });
}

const DEFAULT_BUY_AMOUNT_KEY =
  "kiwoom_total_virtual_cash";

const MAX_HOLDING_COUNT_KEY =
  "kiwoom_max_holding_count";

let defaultBuyAmount =
  Number(localStorage.getItem(DEFAULT_BUY_AMOUNT_KEY)) || 10000000;

let maxHoldingCount =
  Number(localStorage.getItem(MAX_HOLDING_COUNT_KEY)) || 5;

if (defaultBuyAmountInput) {
  defaultBuyAmountInput.value = formatNumber(defaultBuyAmount);
}

setupCommaInput(defaultBuyAmountInput);
setupCommaInput(volumeThresholdInput);
setupCommaInput(dailyMaxLossInput);

if (maxHoldingCountInput) {
  maxHoldingCountInput.value = maxHoldingCount;
}

function getPerBuyAmount() {
  const totalCash =
    getInputNumber(defaultBuyAmountInput, defaultBuyAmount || 10000000);

  const count =
    getInputNumber(maxHoldingCountInput, maxHoldingCount || 5);

  return Math.floor(totalCash / count);
}

function getTotalHoldingBuyAmount() {
  return holdings.reduce((sum, item) => {
    return sum + Number(item.buyPrice || 0) * Number(item.qty || 0);
  }, 0);
}

function getAvailableVirtualCash() {
  const totalCash =
    getInputNumber(defaultBuyAmountInput, defaultBuyAmount || 10000000);

  return Math.max(0, totalCash - getTotalHoldingBuyAmount());
}

if (saveDefaultBuyAmountBtn) {
  saveDefaultBuyAmountBtn.addEventListener("click", () => {
    const totalCash =
      getInputNumber(defaultBuyAmountInput, 0);

    const count =
      getInputNumber(maxHoldingCountInput, 0);

    if (isNaN(totalCash) || totalCash <= 0) {
      alert("전체 모의투자금을 입력하세요.");
      return;
    }

    if (isNaN(count) || count <= 0) {
      alert("최대 보유종목 수를 입력하세요.");
      return;
    }

    defaultBuyAmount = totalCash;
    maxHoldingCount = count;

    localStorage.setItem(
      DEFAULT_BUY_AMOUNT_KEY,
      String(defaultBuyAmount)
    );

    localStorage.setItem(
      MAX_HOLDING_COUNT_KEY,
      String(maxHoldingCount)
    );

    defaultBuyAmountInput.value =
      formatNumber(defaultBuyAmount);

    maxHoldingCountInput.value =
      maxHoldingCount;

    alert(
      "투자설정이 저장되었습니다.\n\n" +
      `전체 모의투자금: ${formatNumber(defaultBuyAmount)}원\n` +
      `최대 보유종목: ${maxHoldingCount}개\n` +
      `종목당 기준금액: ${formatNumber(getPerBuyAmount())}원`
    );
  });
}
const VOLUME_THRESHOLD_KEY =
  "kiwoom_volume_threshold";

  let volumeThreshold =
  Number(localStorage.getItem(VOLUME_THRESHOLD_KEY)) || 1000000;

if (volumeThresholdInput) {
  volumeThresholdInput.value = formatNumber(volumeThreshold);
}

if (saveVolumeThresholdBtn) {
  saveVolumeThresholdBtn.addEventListener("click", () => {
    const value =
      Number(volumeThresholdInput.value.replace(/,/g, ""));

    if (isNaN(value) || value <= 0) {
      alert("거래량 기준을 입력하세요.");
      return;
    }

    volumeThreshold = value;

    volumeThresholdInput.value =
      formatNumber(volumeThreshold);

    localStorage.setItem(
      VOLUME_THRESHOLD_KEY,
      String(volumeThreshold)
    );

    loadWatchList();
  });
}

function getInputNumber(input, fallback = 0) {
  if (!input) return fallback;

  const value = String(input.value || "")
    .replace(/,/g, "")
    .trim();

  return Number(value) || fallback;
}

function cleanStockName(name) {
  return String(name || "")
    .replace(/ðŸ”¥/g, "")
    .replace(/🔥/g, "")
    .trim();
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

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/\s/g, "");
}

function searchStockMaster(keyword) {
  const value = normalizeText(keyword);

  if (!value) return [];

  return STOCK_MASTER
    .filter((item) => {
      const name = normalizeText(item.name);
      const code = normalizeText(item.code);

      return (
        name.includes(value) ||
        code.includes(value)
      );
    })
    .slice(0, 20);
}

async function searchStockFromServer(keyword) {
  const value = keyword.trim();

  if (!value) return [];

  try {
    const res = await fetch(
  `${API_BASE}/api/search?keyword=${encodeURIComponent(value)}`
);

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.message || "종목 검색 실패");
    }

    return data.items || [];
  } catch (error) {
    console.warn("서버 종목검색 실패:", error);
    return [];
  }
}

async function renderStockSuggestions(inputEl, listEl, key, onSelect) {
  if (!inputEl || !listEl) return;

  const value = inputEl.value.trim();

selectedStockCodes[key] = "";

if (!value) {
    listEl.innerHTML = "";
    selectedStockCodes[key] = "";
    return;
  }

  let matched = searchStockMaster(value);

if (matched.length === 0) {
  matched = await searchStockFromServer(value);
}

if (matched.length === 0) {
  listEl.innerHTML = `
    <div class="suggest-item">
      <span class="suggest-name">검색 결과 없음</span>
    </div>
  `;
  return;
}

  listEl.innerHTML = matched.map((item) => `
    <div class="suggest-item" data-code="${item.code}" data-name="${cleanStockName(item.name)}">
      <span class="suggest-name">${cleanStockName(item.name)}</span>
      <span class="suggest-code">${item.code}</span>
    </div>
  `).join("");

  listEl.querySelectorAll(".suggest-item[data-code]").forEach((el) => {
    el.addEventListener("click", () => {
      const code = el.dataset.code;
      const name = el.dataset.name;

      inputEl.value = name;
      selectedStockCodes[key] = code;
      listEl.innerHTML = "";

      if (typeof onSelect === "function") {
        onSelect({ code, name });
      }
    });
  });
}

function getSelectedStockCode(inputEl, key) {
  const value = inputEl.value.trim();

  if (/^\d{6}$/.test(value)) {
    return value;
  }

  const savedCode = selectedStockCodes[key];

  if (savedCode) return savedCode;

  const stock = findStockByInput(value);

  return stock?.code || "";
}

async function searchStock() {
  const inputValue = stockCodeInput.value.trim();
const code = getSelectedStockCode(stockCodeInput, "search");

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

const tradeStatBox =
  document.getElementById("tradeStatBox");

const riskStatusBox =
  document.getElementById("riskStatusBox");

const virtualResultBox =
  document.getElementById("virtualResultBox");

  const backtestCodeInput =
  document.getElementById("backtestCode");

const backtestPeriodSelect =
  document.getElementById("backtestPeriod");

const backtestTargetRateInput =
  document.getElementById("backtestTargetRate");

const backtestStopRateInput =
  document.getElementById("backtestStopRate");

  const backtestTrailingRateInput =
  document.getElementById("backtestTrailingRate");

const backtestInitialCashInput =
  document.getElementById("backtestInitialCash");

  const strategyUpCandleInput =
  document.getElementById("strategyUpCandle");

const strategyVolumeUpInput =
  document.getElementById("strategyVolumeUp");

const strategyCloseBreakInput =
  document.getElementById("strategyCloseBreak");

const strategyHighBreakInput =
  document.getElementById("strategyHighBreak");

const runBacktestBtn =
  document.getElementById("runBacktestBtn");

const compareBacktestBtn =
  document.getElementById("compareBacktestBtn");

  const applyBestStrategyBtn =
  document.getElementById("applyBestStrategyBtn");

const backtestResult =
  document.getElementById("backtestResult");



let watchCodes = JSON.parse(localStorage.getItem(WATCH_STORAGE_KEY)) || [
  "005930",
  "000660",
  "005380",
  "035420",
  "035720"
];

const ALERT_RATE_KEY = "kiwoom_alert_rate";
const TEST_MODE_KEY = "kiwoom_test_mode";
const AUTO_REFRESH_KEY = "kiwoom_auto_refresh";
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

function getCurrentDiscoverSettings() {
  return {
    limit: Number(discoverLimitInput?.value) || 300,
    minScore: Number(discoverMinScoreInput?.value) || 5
  };
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
        <strong>${cleanStockName(item.name)}</strong>
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
        <strong>${cleanStockName(item.name)}</strong>
        <span class="up">${item.changeRate}</span>
      </div>
    `).join("")}
  `;
}

function renderStrongStockBox(items, title = "🔥 오늘 강한 종목") {
  if (!strongStockBox) return;

  const strongItems = items
    .map((item) => {
      const rate = parseFloat(item.changeRate);
      const volume = Number(item.volume || 0);
      const high = Number(item.high || 0);
      const low = Number(item.low || 0);
      const currentPrice = Number(item.currentPrice || 0);

      let score = 0;
      const reasons = [];

      const candleRange = high - low;
      const closePosition =
        candleRange > 0
          ? ((currentPrice - low) / candleRange) * 100
          : 0;

      const volumePower =
        volumeThreshold > 0
          ? volume / volumeThreshold
          : 0;

      if (!isNaN(rate)) {
        if (rate >= 7) {
          score += 3;
          reasons.push(`강한 상승률 ${item.changeRate}`);
        } else if (rate >= entryRate) {
          score += 2;
          reasons.push(`상승률 ${item.changeRate}`);
        } else if (rate >= 1.5) {
          score += 1;
          reasons.push(`소폭 상승 ${item.changeRate}`);
        }
      }

      if (volumePower >= 3) {
        score += 3;
        reasons.push(`거래량 ${volumePower.toFixed(1)}배`);
      } else if (volumePower >= 1.5) {
        score += 2;
        reasons.push(`거래량 ${volumePower.toFixed(1)}배`);
      } else if (volume >= volumeThreshold) {
        score += 1;
        reasons.push("거래량 기준 통과");
      }

      if (high > 0 && currentPrice >= high * 0.98) {
        score += 2;
        reasons.push("고가 근접");
      } else if (high > 0 && currentPrice >= high * 0.95) {
        score += 1;
        reasons.push("고가권 유지");
      }

      if (closePosition >= 80) {
        score += 2;
        reasons.push("종가 상단");
      } else if (closePosition >= 60) {
        score += 1;
        reasons.push("종가 중상단");
      }

      if (low > 0) {
        const recoveryRate =
          ((currentPrice - low) / low) * 100;

        if (recoveryRate >= 5) {
          score += 2;
          reasons.push("저가대비 강한 회복");
        } else if (recoveryRate >= 3) {
          score += 1;
          reasons.push("저가대비 회복");
        }
      }

      if (!isNaN(rate) && rate >= 12) {
        score -= 2;
        reasons.push("급등 과열 주의");
      }

      if (high > 0 && candleRange > 0) {
        const upperTailRate =
          ((high - currentPrice) / candleRange) * 100;

        if (upperTailRate >= 45) {
          score -= 2;
          reasons.push("윗꼬리 큼");
        } else if (upperTailRate >= 30) {
          score -= 1;
          reasons.push("윗꼬리 주의");
        }
      }

      let candidateGrade = "관찰";

      if (score >= 10) {
        candidateGrade = "최우선";
      } else if (score >= 8) {
        candidateGrade = "강력";
      } else if (score >= 5) {
        candidateGrade = "관심";
      } else if (score >= 3) {
        candidateGrade = "관찰";
      } else {
        candidateGrade = "제외";
      }

      let recommendType = "관망";

      if (!isNaN(rate) && rate >= 5 && volume >= volumeThreshold) {
        recommendType = "단타형";
      }

      if (
        !isNaN(rate) &&
        rate >= entryRate &&
        high > 0 &&
        currentPrice >= high * 0.98
      ) {
        recommendType = "추세형";
      }

      const historyRows = backtestHistory.filter(
  (row) => row.code === item.code
);

if (historyRows.length >= 2) {
  const avgHistoryRate =
    historyRows.reduce(
      (sum, row) =>
        sum + Number(row.finalProfitRate || 0),
      0
    ) / historyRows.length;

  if (avgHistoryRate >= 8) {
    score += 3;
    reasons.push("백테스트 강력우수");
  } else if (avgHistoryRate >= 4) {
    score += 2;
    reasons.push("백테스트 우수");
  } else if (avgHistoryRate >= 1) {
    score += 1;
    reasons.push("백테스트 양호");
  } else if (avgHistoryRate <= -3) {
    score -= 2;
    reasons.push("백테스트 부진");
  }
}
let historyGrade = "신규";

if (historyRows.length >= 2) {
  const avgHistoryRate =
    historyRows.reduce(
      (sum, row) =>
        sum + Number(row.finalProfitRate || 0),
      0
    ) / historyRows.length;

  if (avgHistoryRate >= 8) {
    historyGrade = "검증우수";
  } else if (avgHistoryRate >= 4) {
    historyGrade = "검증양호";
  } else if (avgHistoryRate >= 1) {
    historyGrade = "검증보통";
  } else if (avgHistoryRate <= -3) {
    historyGrade = "검증부진";
  }
}

      const riskReasons = reasons.filter((reason) =>
        reason.includes("과열") ||
        reason.includes("윗꼬리") ||
        reason.includes("주의")
      );

      return {
  ...item,
  strongScore: Math.max(0, item.discoverScore || score),
  volumePower,
  strongReasons: item.discoverReasons || reasons,
  riskReasons,
  recommendType,
  candidateGrade,
  historyGrade
};
    })
//    .filter((item) => {
//  const currentSettings = getCurrentDiscoverSettings();
//  return item.strongScore >= currentSettings.minScore;
//})
    .sort((a, b) => {
      if (b.strongScore !== a.strongScore) {
        return b.strongScore - a.strongScore;
      }

      const aRate = parseFloat(a.changeRate);
      const bRate = parseFloat(b.changeRate);

      if (!isNaN(bRate) && !isNaN(aRate) && bRate !== aRate) {
        return bRate - aRate;
      }

      return Number(b.volume || 0) - Number(a.volume || 0);
    })
    .slice(0, 15);

  latestStrongItems = strongItems;

  if (strongItems.length === 0) {
    strongStockBox.innerHTML =
      `<div class="empty">오늘 강한 종목이 없습니다.</div>`;
    return;
  }

  strongStockBox.innerHTML = `
    <div class="entry-title">${title}</div>

    ${strongItems.map((item, index) => {
      const recommended =
        getRecommendedStrategyForCode(item.code);

      const backtestStatus =
  getBacktestStatusText(item.code);

      const strategyText =
        recommended
          ? `${recommended.name} 추천`
          : item.recommendType;

      const strategyPreset =
  strategyText.includes("추세")
    ? "trend"
    : strategyText.includes("단타")
    ? "short"
    : "safe";

      const rankBadge =
        index === 0
          ? "TOP1"
          : index === 1
          ? "TOP2"
          : index === 2
          ? "TOP3"
          : item.candidateGrade;

      return `
        <div class="entry-item">
          <strong>${index + 1}위 · ${cleanStockName(item.name)}</strong>

          <div style="text-align:right;">
            <span class="${getRateClass(item.changeRate)}">
              ${item.changeRate}
            </span>

            <div style="font-size:11px;color:#6b7280;margin-top:3px;">
              <span class="entry-badge">${strategyText}</span>
              <span class="entry-badge">${rankBadge}</span>
              <span class="entry-badge">${item.historyGrade}</span>

              <span class="entry-badge ${backtestStatus.className}">
  ${backtestStatus.text}
</span>

              ${
                item.riskReasons && item.riskReasons.length > 0
                  ? `<span class="entry-badge danger">위험주의</span>`
                  : ""
              }

              <div>
                점수 ${item.strongScore}점 ·
                ${
                  item.volumePower
                    ? `거래량 ${item.volumePower.toFixed(1)}배 · `
                    : ""
                }
                ${item.strongReasons.join(" · ")}
              </div>

              <div style="margin-top:6px;">
                <button
                  class="apply-stock-strategy-btn"
                  data-strategy="${strategyPreset}"
                >
                  추천 전략 적용
                </button>

                <button
                  class="run-stock-backtest-btn"
                  data-code="${item.code}"
                  data-name="${cleanStockName(item.name)}"
                  data-strategy="${strategyPreset}"
                >
                  바로 백테스트
                </button>

                <button
                  class="add-strong-watch-btn"
                  data-code="${item.code}"
                >
                  관심추가
                </button>

                <button
                  class="prepare-buy-btn"
data-code="${item.code}"
data-name="${cleanStockName(item.name)}"
data-price="${item.currentPrice}"
data-strategy="${strategyPreset}"
                >
                  가상매수 준비
                </button>
              </div>
            </div>
          </div>
        </div>
      `;
    }).join("")}
  `;

  setTimeout(() => {
    document
      .querySelectorAll(".apply-stock-strategy-btn")
      .forEach((btn) => {
        btn.onclick = () => {
          const preset = btn.dataset.strategy;

          applyBacktestPreset(preset);

          document
            .querySelectorAll(".preset-btn")
            .forEach((item) => {
              item.classList.toggle(
                "active",
                item.dataset.preset === preset
              );
            });

          alert("추천 전략이 적용되었습니다.");
        };
      });

    document
      .querySelectorAll(".run-stock-backtest-btn")
      .forEach((btn) => {
        btn.onclick = async () => {
          const preset = btn.dataset.strategy;
          const code = btn.dataset.code;
          const name = btn.dataset.name;

          backtestCodeInput.value = name;
          selectedStockCodes.backtest = code;

          applyBacktestPreset(preset);

          document
            .querySelectorAll(".preset-btn")
            .forEach((item) => {
              item.classList.toggle(
                "active",
                item.dataset.preset === preset
              );
            });

          await runBacktest();

          backtestResult.scrollIntoView({
            behavior: "smooth"
          });
        };
      });

    document
      .querySelectorAll(".add-strong-watch-btn")
      .forEach((btn) => {
        btn.onclick = () => {
          const code = btn.dataset.code;

          if (watchCodes.includes(code)) {
            alert("이미 관심종목에 있습니다.");
            return;
          }

          watchCodes.push(code);
          saveWatchCodes();
          loadWatchList();

          alert("관심종목에 추가되었습니다.");
        };
      });

    document
      .querySelectorAll(".prepare-buy-btn")
      .forEach((btn) => {
        btn.onclick = () => {
          const code = btn.dataset.code;
          const name = btn.dataset.name;
          const price = Number(btn.dataset.price || 0);
          const latestBacktest = backtestHistory
  .filter((row) => row.code === code)
  .slice()
  .sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt))[0];

if (!isBacktestPassed(latestBacktest)) {
  alert(
    "백테스트 통과 기록이 없어 가상매수 준비를 중단합니다.\n\n" +
    "먼저 바로 백테스트를 실행하고, 통과한 종목만 모의투자하세요."
  );
  return;
}

if (isAlreadyHolding(code)) {
  alert("이미 보유 중인 종목입니다. 중복 매수는 막았습니다.");
  return;
}
if (getAvailableBuySlots() <= 0) {
  alert(
    "최대 보유종목 수에 도달했습니다.\n\n" +
    "기존 보유종목이 매도된 후 신규 가상매수를 진행하세요."
  );
  return;
}

          const strategyPreset =
  btn.dataset.strategy || "safe";
  const strategyName =
  strategyPreset === "trend"
    ? "추세형"
    : strategyPreset === "short"
    ? "단타형"
    : "안정형";

          holdCodeInput.value = name;
          selectedStockCodes.hold = code;

          buyPriceInput.value = price;

         let targetRate = 1.04;
let secondTargetRate = 1.06;
let stopLossRate = 0.97;
let trailingRate = 3;

if (strategyPreset === "trend") {
  targetRate = 1.07;
  secondTargetRate = 1.12;
  stopLossRate = 0.96;
  trailingRate = 4;
} else if (strategyPreset === "short") {
  targetRate = 1.03;
  secondTargetRate = 1.05;
  stopLossRate = 0.98;
  trailingRate = 2;
}

targetPriceInput.value =
  Math.round(price * targetRate);

secondTargetPriceInput.value =
  Math.round(price * secondTargetRate);

trailingStopRateInput.value = trailingRate;

stopLossPriceInput.value =
  Math.round(price * stopLossRate);

          const perBuyAmount = getPerBuyAmount();

let recommendAmount = perBuyAmount;

if (strategyPreset === "trend") {
  recommendAmount =
    Math.round(perBuyAmount * 1.2);
} else if (strategyPreset === "short") {
  recommendAmount =
    Math.round(perBuyAmount * 0.7);
}
const qty =
  price > 0
    ? Math.floor(recommendAmount / price)
    : 0;

          holdQtyInput.value = qty;

          const buyAmount = price * qty;

          const availableCash = getAvailableVirtualCash();

if (buyAmount > availableCash) {
  alert(
    "남은 모의투자금이 부족합니다.\n\n" +
    `남은 현금: ${formatNumber(availableCash)}원\n` +
    `필요 금액: ${formatNumber(buyAmount)}원`
  );
  return;
}

          const shouldAddHold = confirm(
            `[매수후보 확인]\n\n` +
            `종목: ${name}\n` +
            `적용전략: ${strategyName}\n` +
            `매수가: ${formatNumber(price)}원\n` +
            `수량: ${formatNumber(qty)}주\n` +
           `전체 모의투자금: ${formatNumber(defaultBuyAmount)}원\n` +
`종목당 기준금액: ${formatNumber(perBuyAmount)}원\n` +
`추천투자금: ${formatNumber(recommendAmount)}원\n` +
`실제투자금: ${formatNumber(buyAmount)}원\n` +
`남은 모의현금: ${formatNumber(availableCash)}원\n\n` +
            `목표가: ${formatNumber(Math.round(price * targetRate))}원\n` +
`2차목표가: ${formatNumber(Math.round(price * secondTargetRate))}원\n` +
`손절가: ${formatNumber(Math.round(price * stopLossRate))}원\n` +
`트레일링: ${trailingRate}%\n\n` +
            `보유목록에 추가할까요?`
          );

          if (shouldAddHold) {
            addHoldBtn.click();
          } else {
            alert("매수 후보 입력칸에만 반영되었습니다.");
          }
        };
      });
  }, 0);
}



function renderWatchItem(item) {
  const rateClass = getRateClass(item.changeRate);
  const rateValue = parseFloat(item.changeRate);
  const isEntryCandidate =
  !isNaN(rateValue) && rateValue >= entryRate;
  const isVolumeHot =
  Number(item.volume) >= volumeThreshold;
  const isStrongStock =
  isEntryCandidate || isVolumeHot;

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
    <div class="watch-item ${flashClass} ${item.isFallback ? "fallback-card" : ""} ${isStrongStock ? "strong-watch-item" : ""}" data-code="${item.code}">
      <div class="watch-item-top">
        <div>
          <div class="watch-name">
  ${cleanStockName(item.name)}
  ${item.isFallback ? `<span class="fallback-badge">저장가</span>` : ""}
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
selectedStockCodes.search = el.dataset.code;
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
   // renderStrongStockBox(data);

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
let isAutoRefresh =
  localStorage.getItem(AUTO_REFRESH_KEY) === "true";
let isRefreshing = false;
let isAutoDiscovering = false;

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
  localStorage.setItem(
  AUTO_REFRESH_KEY,
  "true"
);
  autoRefreshBtn.textContent = "자동ON";
  autoRefreshBtn.classList.add("active");

async function runRefreshLoop() {
  if (!isAutoRefresh) return;

  await refreshWithoutJump();

  await runMorningAutoFlow();
  await runClosingProfitSell();

  autoRefreshTimer = setTimeout(() => {
    runRefreshLoop();
  }, getRefreshInterval());
}

  updateApiStatus(
  `자동갱신 시작 · ${getRefreshInterval() / 1000}초 주기`
);
  runRefreshLoop();
}

function setupCommaInput(inputEl) {
  if (!inputEl) return;

  inputEl.addEventListener("input", () => {
    const value = inputEl.value.replace(/,/g, "").replace(/[^\d]/g, "");

    if (!value) {
      inputEl.value = "";
      return;
    }

    inputEl.value = Number(value).toLocaleString("ko-KR");
  });
}

function stopAutoRefresh() {
  isAutoRefresh = false;
  localStorage.setItem(
  AUTO_REFRESH_KEY,
  "false"
);
  autoRefreshBtn.textContent = "자동OFF";
  autoRefreshBtn.classList.remove("active");

  if (autoRefreshTimer) {
    clearTimeout(autoRefreshTimer);
    autoRefreshTimer = null;
  }
}

function updateAutoDiscoverAutoUi() {
  if (autoDiscoverAutoBtn) {
    autoDiscoverAutoBtn.textContent =
      isAutoDiscoverAuto ? "자동ON" : "자동OFF";

    autoDiscoverAutoBtn.classList.toggle(
      "active",
      isAutoDiscoverAuto
    );
  }

  const autoDiscoverState =
    document.getElementById("autoDiscoverState");

  if (autoDiscoverState) {
    autoDiscoverState.textContent =
      isAutoDiscoverAuto ? "ON" : "OFF";

    autoDiscoverState.classList.toggle(
      "on",
      isAutoDiscoverAuto
    );

    autoDiscoverState.classList.toggle(
      "off",
      !isAutoDiscoverAuto
    );
  }
}

async function startAutoDiscoverAuto() {
  if (autoDiscoverTimer) {
    clearTimeout(autoDiscoverTimer);
  }

  isAutoDiscoverAuto = true;

localStorage.setItem(
  AUTO_DISCOVER_AUTO_KEY,
  "true"
);

updateAutoDiscoverAutoUi();

  async function loop() {
    if (!isAutoDiscoverAuto) return;

    try {
      await runAutoDiscover();
    } catch (error) {
      console.error("자동발굴 실패:", error);
    }

    autoDiscoverTimer = setTimeout(() => {
      loop();
    }, 60000);
  }

  loop();
}

function stopAutoDiscoverAuto() {
  isAutoDiscoverAuto = false;

localStorage.setItem(
  AUTO_DISCOVER_AUTO_KEY,
  "false"
);

  if (autoDiscoverTimer) {
    clearTimeout(autoDiscoverTimer);
    autoDiscoverTimer = null;
  }

  updateAutoDiscoverAutoUi();
  if (isAutoDiscoverAuto) {
  startAutoDiscoverAuto();
}
}

function stopAllAutoTradeByRisk(reason) {
  stopAutoRefresh();

  holdings = holdings.map((item) => ({
    ...item,
    autoTrade: false
  }));

  saveHoldings();
  renderHoldings();

  alert(reason);
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

if (isAutoRefresh) {
  startAutoRefresh();
}

if (autoDiscoverAutoBtn) {
  autoDiscoverAutoBtn.addEventListener("click", () => {
    if (isAutoDiscoverAuto) {
      stopAutoDiscoverAuto();
    } else {
      startAutoDiscoverAuto();
    }
  });
}

updateAutoDiscoverAutoUi();

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

if (resumeAutoTradeBtn) {
  resumeAutoTradeBtn.addEventListener("click", resumeAllAutoTrade);
}

const runAllBacktestBtn =
  document.getElementById("runAllBacktestBtn");

if (runAllBacktestBtn) {
  runAllBacktestBtn.addEventListener(
    "click",
    runAllDiscoveredBacktests
  );
}

document
  .querySelectorAll(".discover-preset-btn")
  .forEach((btn) => {
    btn.addEventListener("click", () => {
      discoverLimitInput.value = btn.dataset.limit;
      discoverMinScoreInput.value = btn.dataset.score;

      saveDiscoverSettings();

      alert(`${btn.textContent.trim()} 자동발굴 설정이 적용되었습니다.`);
    });
  });

function addWatchCode() {
const code = getSelectedStockCode(addStockCodeInput, "watch");

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

const VIRTUAL_RESULT_KEY = "kiwoom_virtual_results";

let virtualResults =
  JSON.parse(localStorage.getItem(VIRTUAL_RESULT_KEY)) || [];

function saveVirtualResults() {
  localStorage.setItem(
    VIRTUAL_RESULT_KEY,
    JSON.stringify(virtualResults)
  );
}

function renderVirtualResults() {
  if (!virtualResultBox) return;

  const todayResults = virtualResults;

  if (todayResults.length === 0) {
    virtualResultBox.innerHTML =
      `<div class="empty">오늘 완료된 모의투자 결과가 없습니다.</div>`;
    return;
  }

  const totalBuy = todayResults.reduce((sum, item) => sum + item.buyAmount, 0);
  const totalSell = todayResults.reduce((sum, item) => sum + item.sellAmount, 0);
  const totalProfit = todayResults.reduce((sum, item) => sum + item.profit, 0);
  const totalRate = totalBuy > 0 ? (totalProfit / totalBuy) * 100 : 0;
  const groupedResults = {};

todayResults.forEach((item) => {
  if (!groupedResults[item.code]) {
    groupedResults[item.code] = {
      name: item.name,
      buyAmount: 0,
      sellAmount: 0,
      profit: 0,
      qty: 0
    };
  }

  groupedResults[item.code].buyAmount += item.buyAmount;
  groupedResults[item.code].sellAmount += item.sellAmount;
  groupedResults[item.code].profit += item.profit;
  groupedResults[item.code].qty += item.qty;
});

const groupedHtml = Object.values(groupedResults)
  .map((item) => {
    const rate =
      item.buyAmount > 0 ? (item.profit / item.buyAmount) * 100 : 0;

    return `
      <div class="virtual-result-item">
        <div class="virtual-result-top">
          <div class="virtual-result-name">${cleanStockName(item.name)} 누적</div>
          <div class="virtual-result-badge ${item.profit >= 0 ? "" : "loss"}">
            ${item.profit >= 0 ? "수익" : "손실"}
          </div>
        </div>

        <div class="virtual-result-detail">
          <div>
            총수량 ${formatNumber(item.qty)}주 /
            총매수 ${formatNumber(Math.round(item.buyAmount))}원 →
            총매도 ${formatNumber(Math.round(item.sellAmount))}원
          </div>

          <div>
            누적손익
            <strong class="${item.profit >= 0 ? "up" : "down"}">
              ${item.profit >= 0 ? "+" : ""}${formatNumber(Math.round(item.profit))}원
              (${item.profit >= 0 ? "+" : ""}${rate.toFixed(2)}%)
            </strong>
          </div>
        </div>
      </div>
    `;
  })
  .join("");
  virtualResultBox.innerHTML = `
    <div class="trade-stat-title">누적 모의투자 결과</div>

    <div class="virtual-result-summary">
      <div>
        <span>총 매수</span>
        <strong>${formatNumber(Math.round(totalBuy))}원</strong>
      </div>

      <div>
        <span>총 매도</span>
        <strong>${formatNumber(Math.round(totalSell))}원</strong>
      </div>

      <div>
        <span>실현손익</span>
        <strong class="${totalProfit >= 0 ? "up" : "down"}">
          ${totalProfit >= 0 ? "+" : ""}${formatNumber(Math.round(totalProfit))}원
        </strong>
      </div>

      <div>
        <span>수익률</span>
        <strong class="${totalRate >= 0 ? "up" : "down"}">
          ${totalRate >= 0 ? "+" : ""}${totalRate.toFixed(2)}%
        </strong>
      </div>
    </div>
    <div class="trade-stat-title">종목별 누적 결과</div>
${groupedHtml}
    <div class="trade-stat-title">개별 매도 내역</div>
    ${todayResults.slice().reverse().map((item) => {
      const isProfit = item.profit >= 0;

      return `
        <div class="virtual-result-item">
          <div class="virtual-result-top">
            <div class="virtual-result-name">${cleanStockName(item.name)}</div>
            <div class="virtual-result-badge ${isProfit ? "" : "loss"}">
              ${isProfit ? "수익" : "손실"}
            </div>
          </div>

          <div class="virtual-result-detail">
            <div>
              ${item.resultText} · 
              매수 ${formatNumber(Math.round(item.buyPrice))}원 →
              매도 ${formatNumber(Math.round(item.sellPrice))}원
            </div>

            <div>
              수량 ${formatNumber(item.qty)}주 /
              실현손익 
              <strong class="${isProfit ? "up" : "down"}">
                ${isProfit ? "+" : ""}${formatNumber(Math.round(item.profit))}원
              </strong>
            </div>

            <div>
              수익률 
              <strong class="${isProfit ? "up" : "down"}">
                ${isProfit ? "+" : ""}${item.profitRate.toFixed(2)}%
              </strong>
              · ${item.time}
            </div>
          </div>
        </div>
      `;
    }).join("")}
  `;
}

const STRATEGY_STATE_KEY = "kiwoom_strategy_states";

let strategyStates =
  JSON.parse(localStorage.getItem(STRATEGY_STATE_KEY)) || {};

function saveStrategyStates() {
  localStorage.setItem(STRATEGY_STATE_KEY, JSON.stringify(strategyStates));
}

let holdings = JSON.parse(localStorage.getItem(HOLD_STORAGE_KEY)) || [];

function getCurrentHoldingCount() {
  return holdings.length;
}

function getAvailableBuySlots() {
  const count =
    getInputNumber(maxHoldingCountInput, maxHoldingCount || 5);

  return Math.max(0, count - holdings.length);
}

function isAlreadyHolding(code) {
  return holdings.some((item) => item.code === code);
}

stockCodeInput.addEventListener("input", () => {
  renderStockSuggestions(
    stockCodeInput,
    suggestList,
    "search",
    () => {}
  );
});

addStockCodeInput.addEventListener("input", () => {
  renderStockSuggestions(
    addStockCodeInput,
    addStockSuggestList,
    "watch",
    () => {}
  );
});

holdCodeInput.addEventListener("input", () => {
  renderStockSuggestions(
    holdCodeInput,
    holdSuggestList,
    "hold",
    () => {}
  );
});

backtestCodeInput.addEventListener("input", () => {
  renderStockSuggestions(
    backtestCodeInput,
    backtestSuggestList,
    "backtest",
    () => {}
  );
});

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

  renderTradeStats();
renderRiskStatus();
renderVirtualResults();
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
    renderTradeStats();
renderRiskStatus();
renderVirtualResults();
}

function renderTradeStats() {
  if (!tradeStatBox) return;

  const todayKey = new Date().toISOString().slice(0, 10);
  const todayLogs = tradeLogs.filter((log) => log.date === todayKey);

  const sellLogs = todayLogs.filter((log) =>
    log.type === "SELL" ||
    log.type === "SELL_ALL" ||
    log.type === "SELL_TRAILING" ||
    log.type === "STOP_LOSS"
  );

  const profitLogs = sellLogs.filter((log) => log.type !== "STOP_LOSS");
  const lossLogs = sellLogs.filter((log) => log.type === "STOP_LOSS");

  const winRate =
    sellLogs.length > 0
      ? (profitLogs.length / sellLogs.length) * 100
      : 0;

  tradeStatBox.innerHTML = `
    <div class="trade-stat-title">자동매매 통계</div>

    <div class="trade-stat-grid">
      <div>
        <span>오늘 매매</span>
        <strong>${formatNumber(sellLogs.length)}회</strong>
      </div>

      <div>
        <span>수익 신호</span>
        <strong class="up">${formatNumber(profitLogs.length)}회</strong>
      </div>

      <div>
        <span>손실 신호</span>
        <strong class="down">${formatNumber(lossLogs.length)}회</strong>
      </div>

      <div>
        <span>승률</span>
        <strong>${winRate.toFixed(1)}%</strong>
      </div>
    </div>
  `;
}

function renderRiskStatus() {
  if (!riskStatusBox) return;

  const profit = getTodayRealizedProfit();
  const lossCount = getConsecutiveLossCount();

  const isLossLimit = profit <= -dailyMaxLoss;
  const isConsecutiveLimit = lossCount >= maxConsecutiveLoss;

  const statusText =
    isLossLimit || isConsecutiveLimit ? "자동매매 중지 필요" : "정상";

  const statusClass =
    isLossLimit || isConsecutiveLimit ? "down" : "up";

  riskStatusBox.innerHTML = `
    <div class="trade-stat-title">리스크 상태</div>

    <div class="trade-stat-grid">
      <div>
        <span>오늘 실현손익</span>
        <strong class="${profit >= 0 ? "up" : "down"}">
          ${profit >= 0 ? "+" : ""}${formatNumber(Math.round(profit))}원
        </strong>
      </div>

      <div>
        <span>손실 제한</span>
        <strong>${formatNumber(dailyMaxLoss)}원</strong>
      </div>

      <div>
        <span>연속 손절</span>
        <strong>${lossCount} / ${maxConsecutiveLoss}회</strong>
      </div>

      <div>
        <span>상태</span>
        <strong class="${statusClass}">${statusText}</strong>
      </div>
    </div>
  `;
}

function getTodayTradeCount() {
  const todayKey = new Date().toISOString().slice(0, 10);

  return tradeLogs.filter((log) => {
    return log.date === todayKey;
  }).length;
}

function getConsecutiveLossCount() {
  const todayKey = new Date().toISOString().slice(0, 10);

  const todayResults = virtualResults
    .filter((item) => item.date === todayKey)
    .slice()
    .reverse();

  let count = 0;

  for (const item of todayResults) {
    if (item.profit < 0) {
      count++;
    } else {
      break;
    }
  }

  return count;
}

function getTodayRealizedProfit() {
  const todayKey = new Date().toISOString().slice(0, 10);

  return virtualResults
    .filter((item) => item.date === todayKey)
    .reduce((sum, item) => sum + item.profit, 0);
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

  //if (day === 0 || day === 6) {
  //  return false;
  //}

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
  if (status === "BUY") return "매수완료";
  if (status === "WAITING") return "감시중";
  if (status === "PARTIAL_SOLD") return "1차매도완료";
  if (status === "SOLD") return "매도완료";
  if (status === "SELL_ALL") return "2차매도완료";
  if (status === "SELL_SIGNAL") return "매도신호";
  if (status === "STOP_SIGNAL") return "손절신호";
  if (status === "STOP_LOSS") return "손절완료";
  if (status === "SELL_TRAILING") return "트레일링매도";
  return "감시중";
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

function clampPercent(value) {
  return Math.max(0, Math.min(100, value));
}

function getTradeProgressHtml(item) {
  const rows = [];

  if (item.targetPrice) {
    const percent = clampPercent((item.currentPrice / item.targetPrice) * 100);
    const gap = item.targetPrice - item.currentPrice;

    rows.push(`
      <div class="trade-progress-row">
        <div class="trade-progress-top">
          <span>목표가까지</span>
          <strong>${gap <= 0 ? "도달" : `+${formatNumber(gap)}원`}</strong>
        </div>
        <div class="trade-progress-bar">
          <div class="trade-progress-fill up" style="width:${percent}%"></div>
        </div>
      </div>
    `);
  }

  if (item.secondTargetPrice) {
    const percent = clampPercent((item.currentPrice / item.secondTargetPrice) * 100);
    const gap = item.secondTargetPrice - item.currentPrice;

    rows.push(`
      <div class="trade-progress-row">
        <div class="trade-progress-top">
          <span>2차 목표가까지</span>
          <strong>${gap <= 0 ? "도달" : `+${formatNumber(gap)}원`}</strong>
        </div>
        <div class="trade-progress-bar">
          <div class="trade-progress-fill up" style="width:${percent}%"></div>
        </div>
      </div>
    `);
  }

  if (item.stopLossPrice) {
    const range = item.currentPrice - item.stopLossPrice;
    const percent = clampPercent((range / item.currentPrice) * 100);

    rows.push(`
      <div class="trade-progress-row">
        <div class="trade-progress-top">
          <span>손절가까지</span>
          <strong>${range <= 0 ? "이탈" : `-${formatNumber(range)}원`}</strong>
        </div>
        <div class="trade-progress-bar">
          <div class="trade-progress-fill down" style="width:${percent}%"></div>
        </div>
      </div>
    `);
  }

  if (item.trailingStopRate && item.highestPrice) {
    const trailingSellPrice =
      Math.floor(item.highestPrice * (1 - item.trailingStopRate / 100));

    const gap = item.currentPrice - trailingSellPrice;
    const percent = clampPercent((gap / item.currentPrice) * 100);

    rows.push(`
      <div class="trade-progress-row">
        <div class="trade-progress-top">
          <span>트레일링 발동까지</span>
          <strong>${gap <= 0 ? "발동" : `${formatNumber(gap)}원`}</strong>
        </div>
        <div class="trade-progress-bar">
          <div class="trade-progress-fill trailing" style="width:${percent}%"></div>
        </div>
      </div>
    `);
  }

  if (rows.length === 0) return "";

  return `
    <div class="trade-progress-box">
      <div class="trade-progress-title">자동매매 진행률</div>
      ${rows.join("")}
    </div>
  `;
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

  if (item.isFallback) {
  return {
    action: "NONE",
    reason: "저장가 사용 중 · 자동매매 보류"
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



if (getTodayRealizedProfit() <= -dailyMaxLoss) {
  console.warn("하루 최대 손실 제한 도달");

  stopAllAutoTradeByRisk(
    "하루 최대 손실 제한에 도달하여 모든 자동매매를 중지했습니다."
  );

  return;
}

if (getConsecutiveLossCount() >= maxConsecutiveLoss) {
  console.warn("연속 손절 제한 도달");

  stopAllAutoTradeByRisk(
    "연속 손절 제한에 도달하여 모든 자동매매를 중지했습니다."
  );

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

notifyTradeSignal(item, strategyResult);

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
  let soldResult = null;

  holdings = holdings.map((item) => {
    if (item.code !== code) return item;

    const sellPrice =
      item.currentPrice ||
      strategyStates[code]?.lastSignalPrice ||
      item.buyPrice;

    const resultText =
      actionType === "SELL"
        ? "1차매도"
        : actionType === "SELL_ALL"
        ? "2차매도"
        : actionType === "SELL_TRAILING"
        ? "트레일링매도"
        : actionType === "STOP_LOSS"
        ? "손절매도"
        : "매도";

    if (actionType === "SELL") {
      soldQty = Math.ceil(item.qty * PARTIAL_SELL_RATE);
      remainQty = item.qty - soldQty;
    }

    if (
      actionType === "STOP_LOSS" ||
      actionType === "SELL_ALL" ||
      actionType === "SELL_TRAILING"
    ) {
      soldQty = item.qty;
      remainQty = 0;
    }

    if (soldQty > 0) {
      const buyAmount = item.buyPrice * soldQty;
      const sellAmount = sellPrice * soldQty;
      const profit = sellAmount - buyAmount;
      const profitRate = buyAmount > 0 ? (profit / buyAmount) * 100 : 0;

      soldResult = {
        code: item.code,
        name: item.name,
        resultText,
        buyPrice: item.buyPrice,
        sellPrice,
        qty: soldQty,
        buyAmount,
        sellAmount,
        profit,
        profitRate,
        date: new Date().toISOString().slice(0, 10),
        time: new Date().toLocaleString("ko-KR")
      };
    }

    return {
      ...item,
      qty: remainQty,
      autoTrade: remainQty > 0 ? item.autoTrade : false
    };
  });

  if (soldResult) {
    virtualResults.push(soldResult);
    saveVirtualResults();
  }

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
  renderVirtualResults();
}

function executeManualSell(code) {
  const item = holdings.find((stock) => stock.code === code);

  if (!item) return;

  const currentPrice =
    Number(item.currentPrice || item.buyPrice || 0);

  const reason = prompt(
    "매도 사유를 선택하세요.\n\n1: 수익실현\n2: 손절\n3: 일반매도",
    item.profit >= 0 ? "1" : "2"
  );

  if (reason === null) return;

  const resultText =
    reason === "1"
      ? "수동 수익실현"
      : reason === "2"
      ? "수동 손절"
      : "수동 매도";

  const qty = Number(
    prompt(
      `매도 수량을 입력하세요.\n\n현재 보유수량: ${formatNumber(item.qty)}주`,
      item.qty
    )
  );

  if (!qty || qty <= 0 || qty > item.qty) {
    alert("매도 수량이 올바르지 않습니다.");
    return;
  }

  const sellPrice = Number(
    prompt("매도 단가를 입력하세요.", currentPrice)
  );

  if (!sellPrice || sellPrice <= 0) {
    alert("매도 단가가 올바르지 않습니다.");
    return;
  }

  const buyAmount = item.buyPrice * qty;
  const sellAmount = sellPrice * qty;
  const profit = sellAmount - buyAmount;
  const profitRate =
    buyAmount > 0 ? (profit / buyAmount) * 100 : 0;

  const ok = confirm(
    `[${resultText} 확인]\n\n` +
    `종목: ${cleanStockName(item.name)}\n` +
    `매수가: ${formatNumber(item.buyPrice)}원\n` +
    `매도가: ${formatNumber(sellPrice)}원\n` +
    `수량: ${formatNumber(qty)}주\n` +
    `실현손익: ${profit >= 0 ? "+" : ""}${formatNumber(Math.round(profit))}원\n` +
    `수익률: ${profitRate >= 0 ? "+" : ""}${profitRate.toFixed(2)}%\n\n` +
    `매도 처리할까요?`
  );

  if (!ok) return;

  virtualResults.push({
    code: item.code,
    name: item.name,
    resultText,
    buyPrice: item.buyPrice,
    sellPrice,
    qty,
    buyAmount,
    sellAmount,
    profit,
    profitRate,
    date: new Date().toISOString().slice(0, 10),
    time: new Date().toLocaleString("ko-KR")
  });

  saveVirtualResults();

  const remainQty = item.qty - qty;

  holdings = holdings
    .map((stock) => {
      if (stock.code !== code) return stock;

      return {
        ...stock,
        qty: remainQty,
        autoTrade: remainQty > 0 ? stock.autoTrade : false
      };
    })
    .filter((stock) => stock.qty > 0);

  strategyStates[code] = {
    ...(strategyStates[code] || {}),
    status: remainQty > 0 ? "MANUAL_PARTIAL_SOLD" : "MANUAL_SOLD",
    lastAction: resultText,
    lastSignalTime: new Date().toLocaleString("ko-KR"),
    lastSignalPrice: sellPrice,
    lastSoldQty: qty,
    remainQty
  };

  saveStrategyStates();
  saveHoldings();

  renderHoldings();
  renderVirtualResults();

  alert(`${resultText} 처리되었습니다.`);
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

function getTradeAlertText(action) {
  if (action === "SELL") return "목표가 도달";
  if (action === "SELL_ALL") return "2차 목표가 도달";
  if (action === "SELL_TRAILING") return "트레일링 발동";
  if (action === "STOP_LOSS") return "손절 발생";
  return "자동매매 신호";
}

function playTradeAlertSound() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const audioCtx = new AudioContext();

    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.type = "sine";
    oscillator.frequency.value = 880;

    gainNode.gain.setValueAtTime(0.18, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(
      0.001,
      audioCtx.currentTime + 0.35
    );

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    oscillator.start();
    oscillator.stop(audioCtx.currentTime + 0.35);
  } catch (error) {
    console.warn("알림음 재생 실패:", error);
  }
}

function vibrateTradeAlert() {
  if (navigator.vibrate) {
    navigator.vibrate([200, 100, 200]);
  }
}

function showTradeToast({ title, message, type }) {
  if (!tradeToast) return;

  tradeToast.className = `trade-toast ${type === "down" ? "down" : "up"}`;
  tradeToast.innerHTML = `
    <strong>${title}</strong>
    <span>${message}</span>
  `;

  tradeToast.style.display = "block";

  clearTimeout(showTradeToast.timer);
  showTradeToast.timer = setTimeout(() => {
    tradeToast.style.display = "none";
  }, 5000);
}

function showBrowserNotification(title, message) {
  if (!("Notification" in window)) return;

  if (Notification.permission === "granted") {
    new Notification(title, {
      body: message
    });
    return;
  }

  if (Notification.permission !== "denied") {
    Notification.requestPermission().then((permission) => {
      if (permission === "granted") {
        new Notification(title, {
          body: message
        });
      }
    });
  }
}

function notifyTradeSignal(item, strategyResult) {
  const alertKey =
    `${item.code}_${strategyResult.action}_${strategyResult.reason}`;

  if (lastTradeAlertKey === alertKey) return;
  lastTradeAlertKey = alertKey;

  const title = getTradeAlertText(strategyResult.action);
  const message =
    `${cleanStockName(item.name)} ${formatNumber(item.currentPrice)}원 · ${strategyResult.reason}`;

  const type =
    strategyResult.action === "STOP_LOSS" ? "down" : "up";

  showTradeToast({
    title,
    message,
    type
  });

  playTradeAlertSound();
  vibrateTradeAlert();
  showBrowserNotification(title, message);
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

  if (lastPriceData[code]) {
    updateApiStatus(
      `API 요청 제한 · 마지막 정상가 사용 (${lastPriceData[code].savedAt})`,
      true
    );

    return {
  ...lastPriceData[code],
  isFallback: true
};
  }

updateApiStatus(
  "API 요청 제한 발생 · 자동갱신 OFF",
  true
);

  throw new Error(
    "요청이 너무 많아 자동갱신을 중지했습니다. 1~3분 후 다시 조회하세요."
  );
}

if (lastPriceData[code]) {
  updateApiStatus(
    `API 실패 · 마지막 정상가 사용 (${lastPriceData[code].savedAt})`,
    true
  );

  return {
  ...lastPriceData[code],
  isFallback: true
};
}

throw new Error(
  data.message ||
  data.return_msg ||
  data.error ||
  `현재가 조회 실패 (${res.status})`
);
}

const currentPrice = Number(data.currentPrice || 0);

const result = {
  code: data.code,
  name: data.name,
  isFallback: false,
    currentPrice,
    price: currentPrice,
    change: Number(String(data.pred_pre || "0").replace(/[+-]/g, "")),
    changeRate: data.changeRate || "0",
    volume: Number(data.volume || 0),
    open: Number(data.open || 0),
    high: Number(data.high || 0),
    low: Number(data.low || 0),
    raw: data
  };

  if (apiWarningBanner) {
  apiWarningBanner.style.display = "none";
}

  PRICE_CACHE[code] = {
    time: now,
    data: result
  };

  saveLastPriceData(code, result);

  return result;
}

function getCurrentHoldingCount() {
  return holdings.length;
}

function getAvailableBuySlots() {
  const count =
    Number(maxHoldingCountInput?.value) || maxHoldingCount || 5;

  return Math.max(0, count - holdings.length);
}

function isAlreadyHolding(code) {
  return holdings.some((item) => item.code === code);
}

async function getVolumePower(code) {
  try {
    const response = await fetch(
      `${API_BASE}/api/daily?code=${code}&days=20`
    );

    const data = await response.json();

    const items = data.items || [];

    if (items.length < 5) {
      return {
        avgVolume: 0,
        volumePower: 0
      };
    }

    const today = items[items.length - 1];

    const prevItems = items.slice(0, -1);

    const avgVolume =
      prevItems.reduce((sum, item) => {
        return sum + Number(item.volume || 0);
      }, 0) / prevItems.length;

    const todayVolume = Number(today.volume || 0);

    const volumePower =
      avgVolume > 0
        ? todayVolume / avgVolume
        : 0;

    return {
      avgVolume,
      todayVolume,
      volumePower
    };
  } catch (error) {
    console.warn("거래량 분석 실패:", code);

    return {
      avgVolume: 0,
      todayVolume: 0,
      volumePower: 0
    };
  }
}

async function fetchDailyPrices(code, days) {
  const res = await fetch(
    `${API_BASE}/api/daily?code=${code}&days=${days}`
  );

  const data = await res.json();

  if (!res.ok) {
    throw new Error(
      data.message ||
      data.error ||
      "일봉 데이터 조회 실패"
    );
  }

  return data.items || data;
}

function applyBacktestPreset(type) {
  if (type === "trend") {
    // 추세형: 강한 상승은 살리고, 위험 신호만 제외
    backtestTargetRateInput.value = 0;
    backtestStopRateInput.value = 3;
    backtestTrailingRateInput.value = 7;

    strategyUpCandleInput.checked = true;
    strategyVolumeUpInput.checked = true;
    strategyCloseBreakInput.checked = true;
    strategyHighBreakInput.checked = true;

    filterOverHeatInput.checked = false;
    filter3DayUpInput.checked = false;
    filterLowVolumeInput.checked = true;
    filterWeakCandleInput.checked = true;
  }

  if (type === "short") {
    // 단타형: 급등 추격 방지, 빠른 익절/손절
    backtestTargetRateInput.value = 5;
    backtestStopRateInput.value = 2;
    backtestTrailingRateInput.value = 3;

    strategyUpCandleInput.checked = true;
    strategyVolumeUpInput.checked = true;
    strategyCloseBreakInput.checked = true;
    strategyHighBreakInput.checked = false;

    filterOverHeatInput.checked = true;
    filter3DayUpInput.checked = true;
    filterLowVolumeInput.checked = true;
    filterWeakCandleInput.checked = true;
  }

  if (type === "safe") {
    // 안정형: 너무 과열은 피하되 추세는 일부 허용
    backtestTargetRateInput.value = 4;
    backtestStopRateInput.value = 2;
    backtestTrailingRateInput.value = 5;

    strategyUpCandleInput.checked = true;
    strategyVolumeUpInput.checked = false;
    strategyCloseBreakInput.checked = true;
    strategyHighBreakInput.checked = true;

    filterOverHeatInput.checked = false;
    filter3DayUpInput.checked = true;
    filterLowVolumeInput.checked = true;
    filterWeakCandleInput.checked = true;
  }
}

document.querySelectorAll(".preset-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".preset-btn").forEach((item) => {
      item.classList.remove("active");
    });

    btn.classList.add("active");

    applyBacktestPreset(btn.dataset.preset);
  });
});

async function runBacktest() {
  if (!backtestResult) return;

 const code = getSelectedStockCode(backtestCodeInput, "backtest");
const stock = STOCK_MASTER.find((item) => item.code === code);
const name = stock?.name || backtestCodeInput.value.trim();

  if (!code) {
    alert("백테스트할 종목명 또는 코드를 입력하세요.");
    return;
  }

  const days = Number(backtestPeriodSelect.value);
  const targetRate = Number(backtestTargetRateInput.value);
  const stopRate = Number(backtestStopRateInput.value);
  const trailingRate =
  Number(backtestTrailingRateInput?.value) || 3;
  const activeStrategies = [];
const activeFilters = [];

if (strategyUpCandleInput?.checked) activeStrategies.push("상승양봉");
if (strategyVolumeUpInput?.checked) activeStrategies.push("거래량증가");
if (strategyCloseBreakInput?.checked) activeStrategies.push("전일종가돌파");
if (strategyHighBreakInput?.checked) activeStrategies.push("전일고가돌파");

if (filterOverHeatInput?.checked) activeFilters.push("급등 제외");
if (filter3DayUpInput?.checked) activeFilters.push("3일 연속상승 제외");
if (filterLowVolumeInput?.checked) activeFilters.push("거래량 급감 제외");
if (filterWeakCandleInput?.checked) activeFilters.push("약한 캔들 제외");

  const initialCash =
  Number(backtestInitialCashInput?.value) || 10000000;

let cash = initialCash;

  backtestResult.innerHTML =
    `<div class="loading">백테스트 실행 중...</div>`;

  try {
    const prices = await fetchDailyPrices(code, days);

    if (!prices || prices.length < 2) {
      backtestResult.innerHTML =
        `<div class="error">일봉 데이터가 부족합니다.</div>`;
      return;
    }

    let tradeCount = 0;
    let targetCount = 0;
    let stopCount = 0;
    let totalProfit = 0;
    let tradeDetails = [];

    for (let i = 1; i < prices.length - 1; i++) {
  const prev = prices[i - 1];
  const today = prices[i];
  const next = prices[i + 1];

  const prevClose = Number(prev.close);
  const prevHigh = Number(prev.high);
  const prevVolume = Number(prev.volume);

  const todayOpen = Number(today.open);
  const todayClose = Number(today.close);
  const todayHigh = Number(today.high);
  const todayVolume = Number(today.volume);

  const useUpCandle = strategyUpCandleInput?.checked;
  const useVolumeUp = strategyVolumeUpInput?.checked;
  const useCloseBreak = strategyCloseBreakInput?.checked;
  const useHighBreak = strategyHighBreakInput?.checked;

  const strategyResults = [];

  if (useUpCandle) {
    strategyResults.push(todayClose > todayOpen);
  }

  if (useVolumeUp) {
    strategyResults.push(todayVolume > prevVolume);
  }

  if (useCloseBreak) {
    strategyResults.push(todayClose > prevClose);
  }

  if (useHighBreak) {
    strategyResults.push(todayHigh > prevHigh);
  }

  const filterResults = [];

const todayChangeRate =
  ((todayClose - prevClose) / prevClose) * 100;

const yesterdayClose =
  i >= 2 ? Number(prices[i - 2].close) : prevClose;

const threeDayUp =
  todayClose > prevClose &&
  prevClose > yesterdayClose;

const volumeWeak =
  todayVolume < prevVolume * 0.5;

const upperTail =
  todayHigh - todayClose;

const candleBody =
  Math.abs(todayClose - todayOpen);

const weakCandle =
  upperTail > candleBody * 2 &&
  todayClose < todayOpen;

if (filterOverHeatInput?.checked) {
  filterResults.push(todayChangeRate < 7);
}

if (filter3DayUpInput?.checked) {
  filterResults.push(!threeDayUp);
}

if (filterLowVolumeInput?.checked) {
  filterResults.push(!volumeWeak);
}

if (filterWeakCandleInput?.checked) {
  filterResults.push(!weakCandle);
}

  const strategyPass =
  strategyResults.length > 0 &&
  strategyResults.every(Boolean);

const filterPass =
  filterResults.every(Boolean);

const isBuySignal =
  strategyPass && filterPass;

  if (!isBuySignal) continue;

  const buyPrice = todayClose;
  const highPrice = Number(next.high);
  const lowPrice = Number(next.low);

      const targetPrice =
        buyPrice * (1 + targetRate / 100);

      const stopPrice =
        buyPrice * (1 - stopRate / 100);

      const qty = Math.floor(cash / buyPrice);

if (qty <= 0) continue;

const buyAmount = qty * buyPrice;
const remainCash = cash - buyAmount;

let sellPrice = null;
let profit = 0;

const targetHit = highPrice >= targetPrice;
const stopHit = lowPrice <= stopPrice;

let resultType = null;

let sellDate =
  next.date || next.dt || next.tradingDate || "";

if (stopHit) {
  sellPrice = stopPrice;
  resultType = "손절";
} else if (targetHit) {
  let highestPrice = highPrice;
  let trailingSellPrice =
    highestPrice * (1 - trailingRate / 100);

  sellPrice = null;

  for (let j = i + 1; j < prices.length; j++) {
    const futureHigh = Number(prices[j].high);
    const futureLow = Number(prices[j].low);
    const futureClose = Number(prices[j].close);

    if (futureHigh > highestPrice) {
      highestPrice = futureHigh;
      trailingSellPrice =
        highestPrice * (1 - trailingRate / 100);
    }

    if (futureLow <= trailingSellPrice) {
  sellPrice = trailingSellPrice;
  resultType = "트레일링";

  sellDate =
    prices[j].date ||
    prices[j].dt ||
    prices[j].tradingDate ||
    "";

  i = j - 1;
  break;
}

    if (j === prices.length - 1) {
  sellPrice = futureClose;
  resultType = "기간종료";

  sellDate =
    prices[j].date ||
    prices[j].dt ||
    prices[j].tradingDate ||
    "";

  i = j - 1;
  break;
}
  }
}

if (!sellPrice) continue;

const sellAmount = sellPrice * qty;

profit = sellAmount - buyAmount;

cash = remainCash + sellAmount;

tradeCount++;

if (resultType === "손절") {
  stopCount++;
} else {
  targetCount++;
}

totalProfit += profit;

tradeDetails.push({
  type: resultType,
  buyDate: today.date || today.dt || today.tradingDate || "",
  sellDate,
  buyPrice,
  sellPrice,
  qty,
  profit,
  profitRate: (profit / buyAmount) * 100,
  cash
});
    }

    const winRate =
      tradeCount > 0
        ? (targetCount / tradeCount) * 100
        : 0;

const finalProfit = cash - initialCash;
const finalProfitRate =
  initialCash > 0 ? (finalProfit / initialCash) * 100 : 0;

  const averageProfitRate =
  tradeCount > 0
    ? tradeDetails.reduce((sum, item) => sum + item.profitRate, 0) / tradeCount
    : 0;

    const bestTrade =
  tradeDetails.length > 0
    ? tradeDetails.reduce((best, item) =>
        item.profitRate > best.profitRate ? item : best
      )
    : null;

const worstTrade =
  tradeDetails.length > 0
    ? tradeDetails.reduce((worst, item) =>
        item.profitRate < worst.profitRate ? item : worst
      )
    : null;

const tradeDetailHtml = tradeDetails
  .map((trade, index) => `
    <div class="backtest-detail-item">
      <strong>${index + 1}. ${trade.type}</strong>
      <div>
  매수일 ${trade.buyDate || "-"} / 매도일 ${trade.sellDate || "-"}
</div>
      <div>
        매수 ${formatNumber(Math.round(trade.buyPrice))}원 →
        매도 ${formatNumber(Math.round(trade.sellPrice))}원
      </div>
      <div>
        수량 ${formatNumber(trade.qty)}주 /
        손익 ${trade.profit >= 0 ? "+" : ""}${formatNumber(Math.round(trade.profit))}원
      </div>
      <div>
        수익률 ${trade.profitRate >= 0 ? "+" : ""}${trade.profitRate.toFixed(2)}% /
        잔고 ${formatNumber(Math.round(trade.cash))}원
      </div>
    </div>
  `)
  .join("");

  const backtestRecord = {
  id: `${code}_${Date.now()}`,
  code,
  name,
  days,
  targetRate,
  stopRate,
  trailingRate,
  strategies: activeStrategies,
  filters: activeFilters,
  initialCash,
  finalCash: cash,
  finalProfit,
  finalProfitRate,
  tradeCount,
  targetCount,
  stopCount,
  winRate,
  averageProfitRate,
  bestTradeRate: bestTrade ? bestTrade.profitRate : null,
  worstTradeRate: worstTrade ? worstTrade.profitRate : null,
  savedAt: new Date().toLocaleString("ko-KR")
};

backtestHistory = backtestHistory.filter((item) => {
  return !(
    item.code === backtestRecord.code &&
    item.days === backtestRecord.days &&
    item.targetRate === backtestRecord.targetRate &&
    item.stopRate === backtestRecord.stopRate &&
    item.trailingRate === backtestRecord.trailingRate &&
    JSON.stringify(item.strategies || []) === JSON.stringify(backtestRecord.strategies || []) &&
    JSON.stringify(item.filters || []) === JSON.stringify(backtestRecord.filters || [])
  );
});

backtestHistory.unshift(backtestRecord);

backtestHistory = backtestHistory.slice(0, 50);

saveBacktestHistory();

backtestResult.innerHTML = `
  <div class="backtest-summary-note">
  <strong>백테스트 조건</strong>
  <div>종목: ${name} (${code})</div>
  <div>기간: 최근 ${days}일</div>
    <div>매수조건: ${activeStrategies.join(" + ") || "없음"}</div>
    <div>제외필터: ${activeFilters.join(" + ") || "없음"}</div>
    <div>
      목표수익률 ${targetRate}% / 트레일링 ${trailingRate}% / 손절률 ${stopRate}%
    </div>
  </div>

  <div class="backtest-result-grid">
    <div>
      <span>초기자금</span>
      <strong>${formatNumber(initialCash)}원</strong>
    </div>

    <div>
      <span>최종자산</span>
      <strong class="${cash >= initialCash ? "up" : "down"}">
        ${formatNumber(Math.round(cash))}원
      </strong>
    </div>

    <div>
  <span>총손익</span>
  <strong class="${finalProfit >= 0 ? "up" : "down"}">
    ${finalProfit >= 0 ? "+" : ""}${formatNumber(Math.round(finalProfit))}원
  </strong>
</div>

    <div>
  <span>총수익률</span>
  <strong class="${finalProfitRate >= 0 ? "up" : "down"}">
    ${finalProfitRate >= 0 ? "+" : ""}${finalProfitRate.toFixed(2)}%
  </strong>
</div>

    <div>
      <span>총 신호</span>
      <strong>${tradeCount}회</strong>
    </div>

    <div>
      <span>목표 도달</span>
      <strong class="up">${targetCount}회</strong>
    </div>

    <div>
      <span>손절 발생</span>
      <strong class="down">${stopCount}회</strong>
    </div>

    <div>
      <span>승률</span>
      <strong>${winRate.toFixed(1)}%</strong>
    </div>
  <div>
  <span>평균 수익률</span>
  <strong class="${averageProfitRate >= 0 ? "up" : "down"}">
    ${averageProfitRate >= 0 ? "+" : ""}${averageProfitRate.toFixed(2)}%
  </strong>
</div>

<div>
  <span>최고 수익</span>
  <strong class="up">
    ${bestTrade ? "+" + bestTrade.profitRate.toFixed(2) + "%" : "-"}
  </strong>
</div>

<div>
  <span>최대 손실</span>
  <strong class="down">
    ${worstTrade ? worstTrade.profitRate.toFixed(2) + "%" : "-"}
  </strong>
</div>
</div>

    <div class="backtest-detail-box">
    <div class="backtest-detail-title">거래 상세내역</div>
    ${tradeDetailHtml || `<div class="empty">거래 내역이 없습니다.</div>`}
  </div>

${getBacktestSummaryHtml()}
${getStrategySummaryHtml()}
${getStockSummaryHtml()}
${getBacktestHistoryHtml()}

<div style="margin-top:12px;">
  <button id="clearBacktestHistoryBtn" class="danger-btn">
    백테스트 기록 전체 삭제
  </button>
</div>
`;

const clearBacktestHistoryBtn =
  document.getElementById("clearBacktestHistoryBtn");

if (clearBacktestHistoryBtn) {
  clearBacktestHistoryBtn.addEventListener(
    "click",
    clearBacktestHistory
  );
}

  } catch (error) {
    backtestResult.innerHTML =
      `<div class="error">${error.message}</div>`;
  }
}

async function runAllDiscoveredBacktests() {
  if (!latestStrongItems || latestStrongItems.length === 0) {
    alert("자동발굴 종목이 없습니다.");
    return;
  }

  const availableSlots = getAvailableBuySlots();

  const targetItems = latestStrongItems
    .filter((item) => !isAlreadyHolding(item.code))
    .slice(0, Math.max(1, availableSlots));

  if (targetItems.length === 0) {
    alert(
      "자동 백테스트할 후보가 없습니다.\n\n" +
      "보유종목 수가 한도에 도달했거나 자동발굴 후보가 없습니다."
    );
    return;
  }

  const originalCode = backtestCodeInput.value;
  const originalSelectedCode = selectedStockCodes.backtest;

  let completed = 0;

  for (const item of targetItems) {
    const recommended =
      getRecommendedStrategyForCode(item.code);

    const strategyText =
      recommended
        ? recommended.name
        : item.recommendType;

    const preset =
      strategyText.includes("추세")
        ? "trend"
        : strategyText.includes("단타")
        ? "short"
        : "safe";

    updateApiStatus(
      `전체 자동 백테스트 진행중 · ${completed + 1}/${targetItems.length} · ${cleanStockName(item.name)}`
    );

    backtestCodeInput.value = item.name;
    selectedStockCodes.backtest = item.code;

    applyBacktestPreset(preset);

    document
      .querySelectorAll(".preset-btn")
      .forEach((btn) => {
        btn.classList.toggle(
          "active",
          btn.dataset.preset === preset
        );
      });

    try {
      await runBacktest();
      completed += 1;
    } catch (error) {
      console.error("자동 백테스트 실패", item.code, error);
    }

    await new Promise((resolve) =>
      setTimeout(resolve, 1200)
    );
  }

  backtestCodeInput.value = originalCode;
  selectedStockCodes.backtest = originalSelectedCode;

let autoBuyCount = 0;

for (const item of targetItems) {
  if (getAvailableBuySlots() <= 0) break;

  const ok = autoAddVirtualHolding(item);

  if (ok) {
    autoBuyCount += 1;
  }
}

updateApiStatus(
  `전체 자동 백테스트 완료 · ${completed}개 / 자동 모의매수 ${autoBuyCount}개`
);

alert(
  `전체 자동 백테스트 완료 (${completed}개)\n\n` +
  `자동 모의매수 등록: ${autoBuyCount}개`
);
}

async function autoBacktestAndBuyDiscoveredItems() {
  if (!latestStrongItems || latestStrongItems.length === 0) {
    alert("자동발굴 후보가 없습니다.");
    return;
  }

  const maxCount = getAvailableBuySlots();
  if (maxCount <= 0) {
    alert("최대 보유종목 수에 도달했습니다.");
    return;
  }

  const targets = latestStrongItems.slice(0, maxCount);

  for (const item of targets) {
    if (isAlreadyHolding(item.code)) continue;

    if (!watchCodes.includes(item.code)) {
      watchCodes.push(item.code);
      saveWatchCodes();
    }

    const preset =
      item.recommendType === "추세형"
        ? "trend"
        : item.recommendType === "단타형"
        ? "short"
        : "safe";

    applyBacktestPreset(preset);

    backtestCodeInput.value = item.name;
    selectedStockCodes.backtest = item.code;

    await runBacktest();

    const latestBacktest = getLatestBacktestForCode(item.code);

    if (!isBacktestPassed(latestBacktest)) {
      console.log("백테스트 미통과:", item.name, latestBacktest);
      continue;
    }

    prepareAndAddVirtualBuy(item, preset);
  }

  saveWatchCodes();
  await loadWatchList(true);
  await renderHoldings(true);
  renderTradeLogs();
}

function prepareAndAddVirtualBuy(item, strategyPreset = "safe") {
  const price = Number(item.currentPrice || item.price || 0);

  if (!price || price <= 0) {
    console.warn("가상매수 실패: 현재가 없음", item);
    return;
  }

  if (isAlreadyHolding(item.code)) return;
  if (getAvailableBuySlots() <= 0) return;

  holdCodeInput.value = item.name;
  selectedStockCodes.hold = item.code;

  buyPriceInput.value = price;

  let targetRate = 1.04;
  let secondTargetRate = 1.06;
  let stopLossRate = 0.97;
  let trailingRate = 3;

  if (strategyPreset === "trend") {
    targetRate = 1.07;
    secondTargetRate = 1.12;
    stopLossRate = 0.96;
    trailingRate = 4;
  } else if (strategyPreset === "short") {
    targetRate = 1.03;
    secondTargetRate = 1.05;
    stopLossRate = 0.98;
    trailingRate = 2;
  }

  targetPriceInput.value = Math.round(price * targetRate);
  secondTargetPriceInput.value = Math.round(price * secondTargetRate);
  stopLossPriceInput.value = Math.round(price * stopLossRate);
  trailingStopRateInput.value = trailingRate;

  const perBuyAmount = getPerBuyAmount();

  const qty = Math.floor(perBuyAmount / price);
  if (qty <= 0) return;

  holdQtyInput.value = qty;

  holdCodeInput.dataset.strategyPreset = strategyPreset;

  addHoldBtn.click();
}

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

function canRunMorningAutoFlow() {
  const now = new Date();
  const day = now.getDay();

  if (day === 0 || day === 6) return false;

  const hour = now.getHours();
  const minute = now.getMinutes();

  if (hour < 9) return false;
  if (hour === 9 && minute < 5) return false;
  if (hour > 15) return false;

  if (!isAutoRefresh) return false;
  if (isMorningAutoFlowRunning) return false;

  if (getAvailableBuySlots() <= 0) {
    return false;
  }

  const lastRunTime =
    Number(localStorage.getItem(MORNING_AUTO_RUN_KEY) || 0);

  const oneHour = 60 * 60 * 1000;

  if (lastRunTime && now.getTime() - lastRunTime < oneHour) {
    return false;
  }

  return true;
}

async function runMorningAutoFlow() {
  if (!canRunMorningAutoFlow()) return;

  isMorningAutoFlowRunning = true;

  try {
    updateApiStatus(
      "장시작 자동흐름 실행중 · 자동발굴 시작"
    );

    await runAutoDiscover();

    updateApiStatus(
      "장시작 자동흐름 실행중 · 자동 백테스트 시작"
    );

   await autoBacktestAndBuyDiscoveredItems();

    localStorage.setItem(
  MORNING_AUTO_RUN_KEY,
  String(Date.now())
);

    updateApiStatus(
      "장시작 자동흐름 완료 · 자동발굴/백테스트/모의매수 완료"
    );
  } catch (error) {
    console.error("장시작 자동흐름 실패:", error);

    updateApiStatus(
      `장시작 자동흐름 실패 · ${error.message}`,
      true
    );
  } finally {
    isMorningAutoFlowRunning = false;
  }
}

async function runBacktestCompare() {
  if (!backtestResult) return;

  const code =
    getSelectedStockCode(backtestCodeInput, "backtest");

  const stock =
    STOCK_MASTER.find((item) => item.code === code);

  const name =
    stock?.name || backtestCodeInput.value.trim();

  if (!code) {
    alert("백테스트할 종목명 또는 코드를 입력하세요.");
    return;
  }

  const presets = [
    { key: "trend", name: "추세형" },
    { key: "short", name: "단타형" },
    { key: "safe", name: "안정형" }
  ];

  const results = [];

  for (const preset of presets) {
    applyBacktestPreset(preset.key);

    await runBacktest();

    const resultGrid = backtestResult.querySelector(".backtest-result-grid");
    const summaryItems = resultGrid
     ? Array.from(resultGrid.querySelectorAll("div")).map((box) => ({
      label: box.querySelector("span")?.textContent.trim(),
      value: box.querySelector("strong")?.textContent.trim()
      }))
      : [];
    const profitRate =
      summaryItems.find((item) => item.label === "총수익률")?.value || "-";
    const winRate =
      summaryItems.find((item) => item.label === "승률")?.value || "-";
    const tradeCount =
      summaryItems.find((item) => item.label === "총 신호")?.value || "-";
    results.push({
  key: preset.key,
  name: preset.name,
  profitRate,
  winRate,
  tradeCount,
  html: backtestResult.innerHTML
});
       }

       const bestStrategy = results
  .filter((item) => item.profitRate !== "-")
  .sort((a, b) =>
    parseFloat(b.profitRate.replace("%", "")) -
    parseFloat(a.profitRate.replace("%", ""))
  )[0];
  lastBestStrategyKey = bestStrategy?.key || null;

backtestResult.innerHTML = `
  <div class="backtest-summary-note">
  <strong>전략 비교 결과</strong>
  <div>종목: ${name} (${code})</div>
  <div>
    추천 전략:
    <strong class="up">
      ${bestStrategy ? bestStrategy.name : "판단 불가"}
    </strong>
  </div>
</div>

  <div class="backtest-compare-summary">
    <div class="backtest-compare-summary-title">
      전략별 결과 요약
    </div>

${results.map((item) => `
  <div class="backtest-compare-summary-row">
    <strong>${cleanStockName(item.name)}</strong>
    <span>수익률 ${item.profitRate}</span>
    <span>승률 ${item.winRate}</span>
    <span>신호 ${item.tradeCount}</span>
  </div>
`).join("")}
  </div>

  ${results.map((item) => `
    <div class="backtest-compare-box">
      <div class="backtest-compare-title">
        ${cleanStockName(item.name)}
      </div>

      ${item.html}
    </div>
  `).join("")}
`;
}

const CLOSING_PROFIT_SELL_KEY = "kiwoom_closing_profit_sell_time";

async function runClosingProfitSell() {
  const now = new Date();
  const todayKey = getTodayKey();

  const hour = now.getHours();
  const minute = now.getMinutes();

  // 15:10 이후, 15:30 전까지만 실행
  if (hour !== 15 || minute < 10 || minute > 30) return;

  // 하루 1번만 실행
  if (localStorage.getItem(CLOSING_PROFIT_SELL_KEY) === todayKey) return;

  if (!holdings || holdings.length === 0) return;

  let sellCount = 0;

  for (const item of holdings) {
    const currentPrice = Number(item.currentPrice || 0);
    const buyPrice = Number(item.buyPrice || 0);

    if (!currentPrice || !buyPrice) continue;

    const profitRate =
      ((currentPrice - buyPrice) / buyPrice) * 100;

    // 수익이 1% 미만이면 유지
    if (profitRate < 1) continue;

    if (item.strategyPreset === "short") {
      executeVirtualSell(item.code, "SELL_ALL");
      addTradeLog({
        type: "SELL_ALL",
        code: item.code,
        name: item.name,
        price: currentPrice,
        reason: "장 종료 전 단타형 수익 종목 전량 정리"
      });
      sellCount++;
    } else if (item.strategyPreset === "trend") {
      executeVirtualSell(item.code, "SELL");
      addTradeLog({
        type: "SELL",
        code: item.code,
        name: item.name,
        price: currentPrice,
        reason: "장 종료 전 추세형 수익 종목 50% 익절"
      });
      sellCount++;
    }
  }

  if (sellCount > 0) {
    localStorage.setItem(CLOSING_PROFIT_SELL_KEY, todayKey);
    saveHoldings();
    renderHoldings();
    renderTradeLogs();
    updateApiStatus(`장 종료 전 수익 종목 정리 완료 · ${sellCount}건`);
  }
}

function applyBestStrategy() {
  if (!lastBestStrategyKey) {
    alert("먼저 전략 비교를 실행하세요.");
    return;
  }

  applyBacktestPreset(lastBestStrategyKey);

  document.querySelectorAll(".preset-btn").forEach((btn) => {
    btn.classList.toggle(
      "active",
      btn.dataset.preset === lastBestStrategyKey
    );
  });

  alert("추천 전략이 적용되었습니다.");
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

  const progressAreaEl = card.querySelector(".hold-progress-area");

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

  document.querySelectorAll(".hold-manual-sell").forEach((btn) => {
  btn.addEventListener("click", () => {
    const code = btn.dataset.holdCode;
    executeManualSell(code);
  });
});


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
  status: "BUY",
  statusText: "매수완료",
  lastAction: "BUY",
  lastSignalTime: new Date().toLocaleString("ko-KR"),
  lastSignalPrice: buyPrice,
  lastSoldQty: 0,
  remainQty: qty,
  strategyPreset,
  strategyName
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
        <div class="hold-item ${isTargetHit ? "target-hit" : ""} ${isStopLossHit ? "stop-loss-hit" : ""} ${item.isFallback ? "fallback-card" : ""}" data-code="${item.code}">
          <div class="hold-top">
            <div>
              <div class="hold-name">
  ${cleanStockName(item.name)}
  ${item.isFallback ? `<span class="fallback-badge">저장가</span>` : ""}
</div>
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
            <span>
  현재가
  <strong class="hold-current-price">${formatNumber(item.currentPrice)}</strong>
  ${item.isFallback ? `<em class="fallback-text">저장가</em>` : ""}
</span>
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
    ${item.isFallback ? "저장가 · 매매보류" : strategyStatusText}
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

         <div class="hold-progress-area">
  ${getTradeProgressHtml(item)}
</div>
         <div class="hold-action-row">
  <button class="hold-auto ${item.autoTrade ? "active" : ""}" data-hold-code="${item.code}">
    ${item.autoTrade ? "자동ON" : "자동OFF"}
  </button>

  <button class="hold-manual-sell" data-hold-code="${item.code}">
    수동매도
  </button>

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
    const totalRate = totalBuyAmount > 0 ? (totalProfit / totalBuyAmount) * 100 : 0;
    const totalClass = totalProfit >= 0 ? "up" : "down";

    const totalVirtualCash =
  Number(defaultBuyAmountInput?.value) || defaultBuyAmount || 10000000;

const usedBuyAmount = getTotalHoldingBuyAmount();

const availableCash = getAvailableVirtualCash();

holdSummary.innerHTML = `
  <div>
    <span>전체 모의투자금</span>
    <strong>${formatNumber(totalVirtualCash)}원</strong>
  </div>

  <div>
    <span>사용 매수금액</span>
    <strong>${formatNumber(usedBuyAmount)}원</strong>
  </div>

  <div>
    <span>남은 모의현금</span>
    <strong>${formatNumber(availableCash)}원</strong>
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
  const name = stock?.name || holdCodeInput.value.trim();
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

  if (isAlreadyHolding(code)) {
    alert("이미 보유 중인 종목입니다.");
    return;
  }

  if (getAvailableBuySlots() <= 0) {
    alert(
      "최대 보유종목 수에 도달했습니다.\n\n" +
      "기존 보유종목이 매도된 후 신규 가상매수를 진행하세요."
    );
    return;
  }

  const buyAmount = buyPrice * qty;
  const availableCash = getAvailableVirtualCash();

  if (buyAmount > availableCash) {
    alert(
      "남은 모의투자금이 부족합니다.\n\n" +
      `남은 현금: ${formatNumber(availableCash)}원\n` +
      `필요 금액: ${formatNumber(buyAmount)}원`
    );
    return;
  }

  const strategyPreset =
  holdCodeInput.dataset.strategyPreset || "safe";

const strategyName =
  strategyPreset === "trend"
    ? "추세형"
    : strategyPreset === "short"
    ? "단타형"
    : "안정형";

const newHolding = {
  code,
  name,
  buyPrice,
  qty,
  targetPrice,
  secondTargetPrice,
  trailingStopRate,
  highestPrice: 0,
  stopLossPrice,
  autoTrade: true,
  strategyPreset,
  strategyName
};

  holdings.push(newHolding);

 strategyStates[code] = {
  status: "BUY",
  lastAction: "BUY",
  lastSignalTime: new Date().toLocaleString("ko-KR"),
  lastSignalPrice: buyPrice,
  lastSoldQty: 0,
  remainQty: qty,
  strategyPreset,
  strategyName
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
  renderTradeLogs();
}

function autoAddVirtualHolding(item) {
  if (!item || !item.code) return false;

  if (isAlreadyHolding(item.code)) return false;
  if (getAvailableBuySlots() <= 0) return false;

  const latestBacktest = getLatestBacktestForCode(item.code);

  if (!isBacktestPassed(latestBacktest)) {
    return false;
  }

  const price = Number(item.currentPrice || 0);
  const currentPrice = price;
  if (price <= 0) return false;

  const recommended = getRecommendedStrategyForCode(item.code);

  const strategyText = recommended
    ? recommended.name
    : item.recommendType;

  const strategyPreset =
    strategyText.includes("추세")
      ? "trend"
      : strategyText.includes("단타")
      ? "short"
      : "safe";

  let targetRate = 1.04;
  let secondTargetRate = 1.06;
  let stopLossRate = 0.97;
  let trailingRate = 3;

  if (strategyPreset === "trend") {
    targetRate = 1.07;
    secondTargetRate = 1.12;
    stopLossRate = 0.96;
    trailingRate = 4;
  } else if (strategyPreset === "short") {
    targetRate = 1.03;
    secondTargetRate = 1.05;
    stopLossRate = 0.98;
    trailingRate = 2;
  }

  const perBuyAmount = getPerBuyAmount();

  let recommendAmount = perBuyAmount;

  if (strategyPreset === "trend") {
    recommendAmount = Math.round(perBuyAmount * 1.2);
  } else if (strategyPreset === "short") {
    recommendAmount = Math.round(perBuyAmount * 0.7);
  }

  const qty = Math.floor(recommendAmount / price);
  if (qty <= 0) return false;

  const buyAmount = price * qty;
  const availableCash = getAvailableVirtualCash();

  if (buyAmount > availableCash) return false;

  const newHolding = {
    code: item.code,
    name: item.name,
    buyPrice: price,
    qty,
    targetPrice: Math.round(price * targetRate),
    secondTargetPrice: Math.round(price * secondTargetRate),
    trailingStopRate: trailingRate,
    highestPrice: 0,
    stopLossPrice: Math.round(price * stopLossRate),
    autoTrade: true
  };

  holdings.push(newHolding);

 strategyStates[item.code] = {
  status: "BUY",
  lastAction: "BUY",
  lastSignalTime: new Date().toLocaleString("ko-KR"),
  lastSignalPrice: price,
  lastSoldQty: 0,
  remainQty: qty,
  strategyPreset,
  strategyName
};

  addTradeLog({
    type: "BUY",
    code: newHolding.code,
    name: newHolding.name,
    price: newHolding.buyPrice,
    reason: `자동 모의매수 등록 · ${strategyText}`,
    sellQty: 0,
    remainQty: newHolding.qty
  });

  saveStrategyStates();
  saveHoldings();
  renderHoldings();
  renderTradeLogs();

  return true;
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
  status: "BUY",
  lastAction: "BUY",
  lastSignalTime: new Date().toLocaleString("ko-KR"),
  lastSignalPrice: price,
  lastSoldQty: 0,
  remainQty: qty,
  strategyPreset,
  strategyName
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
      "매매 로그와 오늘 모의투자 결과를 모두 삭제할까요?\n\n보유종목은 유지됩니다."
    );

    if (!ok) return;

    tradeLogs = [];
    virtualResults = [];

    saveTradeLogs();
    saveVirtualResults();

    renderTradeLogs();
    renderVirtualResults();

    alert("모의투자 결과가 초기화되었습니다.");
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

if (runBacktestBtn) {
  runBacktestBtn.addEventListener("click", runBacktest);
}

if (compareBacktestBtn) {
  compareBacktestBtn.addEventListener("click", runBacktestCompare);
}

if (applyBestStrategyBtn) {
  applyBestStrategyBtn.addEventListener("click", applyBestStrategy);
}

if (autoDiscoverBtn) {
  autoDiscoverBtn.addEventListener("click", runAutoDiscover);
}

function resumeAllAutoTrade() {
  if (holdings.length === 0) {
    alert("보유종목이 없습니다.");
    return;
  }

  const ok = confirm(
    "모든 보유종목의 자동매매를 다시 켤까요?"
  );

  if (!ok) return;

  holdings = holdings.map((item) => ({
    ...item,
    autoTrade: true
  }));

  saveHoldings();
  renderHoldings();

  alert("모든 보유종목의 자동매매를 다시 켰습니다.");
}

async function fetchAllStocksForDiscover() {
  try {
    const res = await fetch(`${API_BASE}/api/stocks`);

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.message || "전체 종목 조회 실패");
    }

    return data.items || [];
  } catch (error) {
    console.warn("전체 종목 조회 실패:", error);
    return STOCK_MASTER;
  }
}

async function runInBatches(items, batchSize, worker, onProgress) {
  const results = [];
  let doneCount = 0;

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);

    const batchResults = await Promise.all(
      batch.map(worker)
    );

    results.push(...batchResults);

    doneCount += batch.length;

    if (typeof onProgress === "function") {
      onProgress(doneCount, items.length);
    }

    await new Promise((resolve) => setTimeout(resolve, 800));
  }

  return results;
}
function isOverheatedStock(item) {
  const rate = parseFloat(item.changeRate);
  const open = Number(item.open || 0);
  const high = Number(item.high || 0);
  const low = Number(item.low || 0);
  const price = Number(item.currentPrice || 0);

  if (isNaN(rate) || price <= 0) return true;

  // 당일 너무 많이 오른 종목은 추격매수 위험
  if (rate >= 12) {
    return true;
  }

  // 저가 대비 너무 많이 튄 종목 제외
  if (low > 0) {
    const fromLowRate = ((price - low) / low) * 100;

    if (fromLowRate >= 15) {
      return true;
    }
  }

  // 장중 변동폭이 너무 큰 종목 제외
  if (low > 0 && high > 0) {
    const rangeRate = ((high - low) / low) * 100;

    if (rangeRate >= 18) {
      return true;
    }
  }

  // 시가 대비 너무 멀어진 종목 제외
  if (open > 0) {
    const fromOpenRate = ((price - open) / open) * 100;

    if (fromOpenRate >= 10) {
      return true;
    }
  }

  return false;
}

function getDiscoverScore(item) {
  const rate = parseFloat(item.changeRate);
  const volume = Number(item.volume || 0);
  const price = Number(item.currentPrice || 0);
  const currentPrice = price; // 이 줄 추가


  const open = Number(item.open || 0);
  const high = Number(item.high || 0);
  const low = Number(item.low || 0);

 let score = 0;
const reasons = [];

const candleRange = high - low;
const closePosition =
  candleRange > 0
    ? ((currentPrice - low) / candleRange) * 100
    : 0;

const dayRate = parseFloat(item.changeRate);
const volumePower =
  volumeThreshold > 0
    ? volume / volumeThreshold
    : 0;

// 1. 상승률 점수
if (!isNaN(dayRate)) {
  if (dayRate >= 7) {
    score += 3;
    reasons.push(`강한 상승률 ${item.changeRate}`);
  } else if (dayRate >= entryRate) {
    score += 2;
    reasons.push(`상승률 ${item.changeRate}`);
  } else if (dayRate >= 1.5) {
    score += 1;
    reasons.push(`소폭 상승 ${item.changeRate}`);
  }
}

// 2. 거래량 점수
if (volumePower >= 3) {
  score += 3;
  reasons.push(`거래량 ${volumePower.toFixed(1)}배`);
} else if (volumePower >= 1.5) {
  score += 2;
  reasons.push(`거래량 ${volumePower.toFixed(1)}배`);
} else if (volume >= volumeThreshold) {
  score += 1;
  reasons.push("거래량 기준 통과");
}

// 3. 고가 근접 점수
if (high > 0 && currentPrice >= high * 0.98) {
  score += 2;
  reasons.push("고가 근접");
} else if (high > 0 && currentPrice >= high * 0.95) {
  score += 1;
  reasons.push("고가권 유지");
}

// 4. 종가 위치 점수
if (closePosition >= 80) {
  score += 2;
  reasons.push("종가 상단 마감");
} else if (closePosition >= 60) {
  score += 1;
  reasons.push("종가 중상단");
}

// 5. 저가 대비 회복 점수
if (low > 0) {
  const recoveryRate =
    ((currentPrice - low) / low) * 100;

  if (recoveryRate >= 5) {
    score += 2;
    reasons.push("저가대비 강한 회복");
  } else if (recoveryRate >= 3) {
    score += 1;
    reasons.push("저가대비 회복");
  }
}

// 6. 과열 감점
if (!isNaN(dayRate) && dayRate >= 12) {
  score -= 2;
  reasons.push("급등 과열 주의");
}

// 7. 윗꼬리 감점
if (high > 0 && candleRange > 0) {
  const upperTailRate =
    ((high - currentPrice) / candleRange) * 100;

  if (upperTailRate >= 45) {
    score -= 2;
    reasons.push("윗꼬리 큼");
  } else if (upperTailRate >= 30) {
    score -= 1;
    reasons.push("윗꼬리 주의");
  }
}

  return {
    score,
    reasons
  };
}

async function runAutoDiscover() {
  if (!strongStockBox) return;

   saveDiscoverSettings();

  if (isAutoDiscovering) {
    alert("이미 자동발굴이 진행 중입니다.");
    return;
  }

  isAutoDiscovering = true;

  if (autoDiscoverBtn) {
    autoDiscoverBtn.disabled = true;
    autoDiscoverBtn.textContent = "발굴중";
  }

  strongStockBox.innerHTML =
    `<div class="loading">자동발굴 중입니다.</div>`;

  try {
    const allStocks = await fetchAllStocksForDiscover();

   const targetStocks = allStocks
  .filter((item) => item.code)
  .filter((item) => {
    const name = String(item.name || "");

    if (name.includes("스팩")) return false;
    if (name.includes("ETF")) return false;
    if (name.includes("ETN")) return false;
    if (name.includes("KODEX")) return false;
    if (name.includes("TIGER")) return false;
    if (name.includes("ACE")) return false;
    if (name.includes("SOL")) return false;

    if (name.endsWith("우")) return false;
    if (name.includes("우B")) return false;
    if (name.includes("우선주")) return false;

    return true;
  })
  .filter((item) => item.market === "KOSPI" || item.market === "KOSDAQ")
  .slice(0, Number(discoverLimitInput?.value || 1200));

    const results = (await runInBatches(
      targetStocks,
      5,    async (stock) => {
        try {
          const item = await fetchStockPrice(stock.code);
          console.log("가격조회 성공:", stock.code, stock.name, item);

          const volumeInfo = await getVolumePower(stock.code);

item.volumePower = volumeInfo.volumePower;
item.avgVolume = volumeInfo.avgVolume;

          const rate = parseFloat(item.changeRate);
          const volume = Number(item.volume || 0);
          const price = Number(item.currentPrice || 0);

          if (isOverheatedStock(item)) {
  return null;
}

const discover = getDiscoverScore(item);
console.log("점수계산:", stock.code, stock.name, discover);
const minScore = Number(discoverMinScoreInput?.value || 5);

console.log(
  "발굴점검:",
  stock.code,
  stock.name,
  "현재가", price,
  "등락률", item.changeRate,
  "거래량", item.volume,
  "점수", discover.score,
  "사유", discover.reasons
);

if (price > 0 && discover.score >= minScore) {
  return {
    ...item,
    discoverScore: discover.score,
    discoverReasons: discover.reasons
  };
}

return null;



        } catch (error) {
  console.warn(
    "자동발굴 종목 조회 실패:",
    stock.code,
    stock.name,
    error.message
  );
  return null;
}
      },


      (done, total) => {
  strongStockBox.innerHTML = `
    <div class="loading">
      전체시장 1차 스캔 중. ${done}/${total}개 확인
      <br />
      <small>
        API 과부하 방지를 위해 순차 확인 중입니다.
      </small>
    </div>
  `;
}


    ))
      .filter(Boolean)
.filter((item) => !isAlreadyHolding(item.code))
.sort((a, b) => {
  return b.discoverScore - a.discoverScore;
});

console.log("자동발굴 조건통과 results:", results);
console.log("자동발굴 조건통과 개수:", results.length);

    if (results.length === 0) {
      strongStockBox.innerHTML =
        `<div class="empty">자동발굴 조건에 맞는 종목이 없습니다.</div>`;
      return;
    }

   const availableSlots = getAvailableBuySlots();

if (availableSlots <= 0) {
  strongStockBox.innerHTML = `
    <div class="empty">
      최대 보유종목 수에 도달했습니다.<br />
      기존 보유종목이 매도된 후 신규 후보를 선정하세요.
    </div>
  `;
  return;
}

renderStrongStockBox(
  results.slice(0, 15),
  `🤖 자동발굴 후보 · 조건통과 ${results.length}개`
);

const summaryEl = document.createElement("div");
summaryEl.className = "discover-summary";
summaryEl.innerHTML = `
  전체 ${targetStocks.length}개 스캔 /
  조건통과 ${results.length}개 /
  표시 ${Math.min(results.length, 15)}개
`;

strongStockBox.prepend(summaryEl);

    } catch (error) {
    strongStockBox.innerHTML =
      `<div class="error">자동발굴 실패<br />${error.message}</div>`;
  } finally {
    isAutoDiscovering = false;

    if (autoDiscoverBtn) {
      autoDiscoverBtn.disabled = false;
      autoDiscoverBtn.textContent = "자동발굴";
    }
  }
}


function isBacktestPassed(record) {
  if (!record) return false;

  const finalProfitRate = Number(record.finalProfitRate || 0);
  const tradeCount = Number(record.tradeCount || 0);

  if (tradeCount < 1) return false;
  if (finalProfitRate < -3) return false;

  return true;
}

function getLatestBacktestForCode(code) {
  return backtestHistory
    .filter((row) => row.code === code)
    .slice()
    .sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt))[0];
}

function getBacktestStatusText(code) {
  const latest = getLatestBacktestForCode(code);

  if (!latest) {
    return {
      text: "백테스트 미검증",
      className: "neutral"
    };
  }

  if (isBacktestPassed(latest)) {
    return {
      text: "백테스트 통과",
      className: "pass"
    };
  }

  return {
    text: "백테스트 실패",
    className: "fail"
  };
}

function saveDiscoverSettings() {
  const settings = {
    limit: Number(discoverLimitInput?.value || 300),
    minScore: Number(discoverMinScoreInput?.value || 5)
  };

  localStorage.setItem(
    DISCOVER_SETTING_KEY,
    JSON.stringify(settings)
  );
}

function formatNumberInput(input) {
  input.addEventListener("input", () => {
    const value = input.value.replace(/,/g, "").replace(/\D/g, "");

    if (!value) {
      input.value = "";
      return;
    }

    input.value = Number(value).toLocaleString();
  });
}

formatNumberInput(volumeThresholdInput);
formatNumberInput(defaultBuyAmountInput);
formatNumberInput(dailyMaxLossInput);

