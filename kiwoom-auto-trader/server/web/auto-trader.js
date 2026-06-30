const fs = require("fs");
const path = require("path");

const STATE_FILE = path.join(__dirname, "paper-state.json");

const API_BASE = "http://localhost:3000";


const settings = {
  buyStartTime: "09:25",
  buyEndTime: "14:30",
  safeMinScore: 10,
  trendMinScore: 10,
  blockStoppedToday: true,

  totalCash: 100000000,

  coreRatio: 0.6,
turboRatio: 0.2,
leaderRatio: 0.2,
  earlyMaxHoldingCount: 3,
  earlyMaxDailyBuyCount: 4,

  maxHoldingCount: 6,
  coreMaxHoldingCount: 6,
  turboMaxHoldingCount: 2,

  perBuyAmount: 10000000,
  minBuyAmount: 3000000,

  dailyLossLimitRate: 0.01,
  maxConsecutiveLoss: 3,

  discoverLimit: 300,
  minScore: 9,
  buyCooldownMinutes: 10,

  tradeStart: "09:05",
  tradeEnd: "15:20",
  testMode: false,

  targetProfitRate: 999,
  trailingStartRate: 3,
  stopLossRate: -1.8,
  trailingStopRate: 2.5,

  firstTakeProfitRate: 3.0,
  firstTakeProfitSellRatio: 0.5,
  firstTakeProfitMinRemainQty: 1,

  breakEvenTriggerRate: 2.5,
  breakEvenSellRate: 0.8,

  endProfitSellTime: "15:10",
  endProfitSellOnlyPositive: true,

  turboEnabled: true,
turboStartTime: "09:05",
turboEndTime: "10:40",
turboForceSellTime: "10:50",

turboMinScore: 10,
turboWatchMinDayRiseRate: 1.0,


turboBuyMinDayRiseRate: 0.5,   // 당일 상승률은 보조조건
turboBuyMaxDayRiseRate: 7.0,   // 너무 오른 종목만 제외

turboMinVolume: 300000,
turboMinOpenPositionRate: 2.0, // 시가 대비 +2% 이상
turboMinDayPositionRate: 60,

turboMaxDayPositionRate: 75,
turboMinTradeVolumeRatio: 80,

coreMaxChangeRate: 3.5,
coreMinTradeVolumeRatio: -20,
coreMinDayPositionRate: 45,
coreMaxDayPositionRate: 75,

turboStopLossRate: -2.0,
turboTakeProfitRate: 3.0,
turboTakeProfitSellRatio: 0.5,
turboTrailingStartRate: 2.0,
turboTrailingStopRate: 0.7,

turboMaxDailyBuyCount: 3,
turboMaxConsecutiveLoss: 3,
turboMinOneMinuteRiseRate: 0.25,

earlyEnabled: false,
earlyStartTime: "09:05",
earlyEndTime: "10:30",

earlyMinScore: 6,
earlyMinChangeRate: 0.3,
earlyMaxChangeRate: 2.0,
earlyMinTradeVolumeRatio: 150,
earlyMinDayPositionRate: 60,

earlyStopLossRate: -1.0,
earlyTakeProfitRate: 3.0,
earlyTakeProfitSellRatio: 0.5,
earlyTrailingStartRate: 2.0,
earlyTrailingStopRate: 0.7,

leaderEnabled: true,
leaderStartTime: "10:40",
leaderEndTime: "13:40",

leaderMaxHoldingCount: 2,
leaderMaxDailyBuyCount: 2,

leaderStopLossRate: -3.0,
leaderTakeProfitRate: 15.0,
leaderTrailingStartRate: 10.0,
leaderTrailingStopRate: 4.0,

leaderMinHoldDays: 2,
leaderMaxHoldDays: 10,


leaderCoreEnabled: true,

leaderCoreMinScore: 10,
leaderCoreMinChangeRate: 1.5,
leaderCoreMaxChangeRate: 7.0,

leaderCoreMinVolume: 300000,
leaderCoreMinTradeValue: 2000000000, // 20억

leaderMinTradeVolumeRatio: -50,   // 거래량비율 최소 +80%
leaderMinDayPositionRate: 60,    // 당일 위치 최소 60%
leaderMaxDayPositionRate: 85,    // 85% 초과는 추격매수 금지
leaderMinOpenPositionRate: 1.0,  // 시가 대비 +1% 이상

leaderStrengthMinScore: 75,      // 수급강도 최소점수

leaderCoreMaxHoldingCount: 6,

candidateRankEnabled: false,
candidateRankMinHistoryCount: 2,
candidateRankMinScoreUp: 1,
candidateRankMaxAgeMinutes: 40,

sectorFilterEnabled: true,
sectorMinScore: 2,

sectorFlowEnabled: true,
sectorFlowTopCount: 2,
sectorFlowMinCandidateCount: 2,
sectorFlowMinAvgScore: 2.5,

turboRecheckEnabled: true,
turboRecheckDelayMinutes: 3,
turboRecheckMaxAgeMinutes: 15,

marketScoreEnabled: true,
turboMinMarketScore: 55,
coreMinMarketScore: 45,
leaderMinMarketScore: 60,

turboMinFinalBuyScore: 75,
coreMinFinalBuyScore: 65,
leaderMinFinalBuyScore: 80,

leaderRankBuyEnabled: true,
leaderRankMinScoreHot: 65,
leaderRankMinScoreNormal: 75,
leaderRankMaxBuyPerRun: 2,

};



let isRunning = false;
let isSellRunning = false;

function isBetweenTime(start, end) {
  const now = new Date();
  const hhmm =
    String(now.getHours()).padStart(2, "0") +
    ":" +
    String(now.getMinutes()).padStart(2, "0");

  return hhmm >= start && hhmm <= end;
}


function loadState() {
  if (!fs.existsSync(STATE_FILE)) {
    return {
      holdings: [],
      tradeLogs: [],
      virtualResults: [],
      lastRunAt: null,
      lastSellCheckAt: null,
      serverAutoEnabled: true,

      totalCash: Math.floor(settings.totalCash * settings.coreRatio),
      turboCash: Math.floor(settings.totalCash * settings.turboRatio),
      leaderCash: Math.floor(settings.totalCash * settings.leaderRatio),

      budgetInitialized: true,
      turboSnapshots: {}
    };
  }

  const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));

  if (state.serverAutoEnabled === undefined) {
    state.serverAutoEnabled = true;
  }

  if (!Array.isArray(state.holdings)) {
    state.holdings = [];
  }

  if (!Array.isArray(state.tradeLogs)) {
    state.tradeLogs = [];
  }

  if (!Array.isArray(state.virtualResults)) {
    state.virtualResults = [];
  }

  if (!state.turboSnapshots) {
    state.turboSnapshots = {};
  }

  // 기존 paper-state.json에 leaderCash가 없는 경우 20/60/20으로 재분배
  if (!state.budgetInitialized || typeof state.leaderCash === "undefined") {
    const holdingsValue = (state.holdings || []).reduce((sum, holding) => {
      return sum +
        Number(holding.currentPrice || holding.buyPrice || 0) *
        Number(holding.qty || 0);
    }, 0);

    const existingTotalAsset =
      Number(state.totalCash || 0) +
      Number(state.turboCash || 0) +
      Number(state.leaderCash || 0) +
      holdingsValue;

    const baseAsset =
      existingTotalAsset > 0
        ? existingTotalAsset
        : settings.totalCash;

    state.totalCash = Math.floor(baseAsset * settings.coreRatio);
    state.turboCash = Math.floor(baseAsset * settings.turboRatio);
    state.leaderCash =
      baseAsset - state.totalCash - state.turboCash;

    state.budgetInitialized = true;
    state.budgetRebalancedAt = nowText();
    state.budgetRebalanceReason = "20/60/20 자금 구조 초기화";
  }

  if (typeof state.totalCash === "undefined") {
    state.totalCash = Math.floor(settings.totalCash * settings.coreRatio);
  }

  if (typeof state.turboCash === "undefined") {
    state.turboCash = Math.floor(settings.totalCash * settings.turboRatio);
  }

  if (typeof state.leaderCash === "undefined") {
    state.leaderCash = Math.floor(settings.totalCash * settings.leaderRatio);
  }

  return state;
}

function getBudgetInfo(state) {
  const holdingsValue = (state.holdings || []).reduce((sum, holding) => {
    return sum +
      Number(holding.currentPrice || holding.buyPrice || 0) *
      Number(holding.qty || 0);
  }, 0);

  const totalAsset =
    Number(state.totalCash || 0) +
    Number(state.turboCash || 0) +
    Number(state.leaderCash || 0) +
    holdingsValue;

  const coreBudget =
    Math.floor(totalAsset * settings.coreRatio);

  const turboBudget =
    Math.floor(totalAsset * settings.turboRatio);

  const leaderBudget =
    Math.floor(totalAsset * settings.leaderRatio);

  const corePerBuyAmount =
    Math.floor(coreBudget / settings.coreMaxHoldingCount);

  const turboPerBuyAmount =
    Math.floor(turboBudget / settings.turboMaxHoldingCount);

  const leaderPerBuyAmount =
    Math.floor(leaderBudget / settings.leaderMaxHoldingCount);

  return {
    totalAsset,

    coreBudget,
    turboBudget,
    leaderBudget,

    corePerBuyAmount,
    turboPerBuyAmount,
    leaderPerBuyAmount,
  };
}

function isLeaderCoreCandidate(item, marketTemperature, marketScore = null) {
  const score = Number(item.discoverScore || 0);

  const changeRate = Number(
    item.changeRate ||
    item.fluctuationRate ||
    item.riseRate ||
    item.rate ||
    item.raw?.flu_rt ||
    0
  );

  const volume = Number(item.volume || item.raw?.trde_qty || 0);
  const currentPrice = Number(item.currentPrice || item.price || 0);

  if (score < settings.leaderCoreMinScore) return false;

  if (
    changeRate < settings.leaderCoreMinChangeRate ||
    changeRate > 12.0
  ) {
    return false;
  }

  if (volume < settings.leaderCoreMinVolume) return false;

  const rank = calculateLeaderRankScore(item, currentPrice, marketScore);

  const isHotMarket =
    marketTemperature && marketTemperature.level === "HOT";

  const minRankScore = isHotMarket
    ? settings.leaderRankMinScoreHot
    : settings.leaderRankMinScoreNormal;

  if (rank.score < minRankScore) {
    console.log(
      `[LEADER 랭킹제외] ${item.name || item.code} / Rank ${rank.score} / 기준 ${minRankScore} / ${rank.detail}`
    );
    return false;
  }

  console.log(
    `[LEADER 랭킹통과] ${item.name || item.code} / Rank ${rank.score} / ${rank.detail}`
  );

  return true;
}


function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function nowText() {
  return new Date().toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul"
  });
}



function getLeaderStrengthScore(item, currentPriceInput = null) {
  const currentPrice = Number(
    currentPriceInput ||
    item.currentPrice ||
    item.price ||
    0
  );

  const changeRate = Number(
    item.changeRate ||
    item.fluctuationRate ||
    item.riseRate ||
    item.rate ||
    item.raw?.flu_rt ||
    0
  );

  const volume = Number(
    item.volume ||
    item.raw?.trde_qty ||
    0
  );

  const tradeVolumeRatio = getTradeVolumeRatio(item);
  const dayPositionRate = getDayPositionRate(item, currentPrice);

  const openPrice = Math.abs(Number(
    item.open ||
    item.openPrice ||
    item.raw?.open_pric ||
    0
  ));

  const openPositionRate =
    openPrice > 0 && currentPrice > 0
      ? ((currentPrice - openPrice) / openPrice) * 100
      : 0;

  const tradeValue = currentPrice * volume;

  let score = 0;

  // 1. 기본 발견 점수
  score += Math.min(25, Number(item.discoverScore || 0) * 2);

  // 2. 상승률: 너무 낮아도 약하고, 너무 높으면 추격
  if (changeRate >= 2.0 && changeRate <= 5.5) {
    score += 20;
  } else if (changeRate >= 1.5 && changeRate <= 7.0) {
    score += 10;
  }

  // 3. 거래량비율: 오늘 제일 중요한 조건
  if (tradeVolumeRatio >= 200) {
    score += 25;
  } else if (tradeVolumeRatio >= 120) {
    score += 20;
  } else if (tradeVolumeRatio >= 80) {
    score += 12;
  } else if (tradeVolumeRatio < 0) {
    score -= 30;
  }

  // 4. 당일위치: 고점 부근이지만 과열은 아닌 구간
  if (dayPositionRate >= 65 && dayPositionRate <= 85) {
    score += 20;
  } else if (dayPositionRate >= 55 && dayPositionRate <= 90) {
    score += 10;
  } else {
    score -= 15;
  }

  // 5. 시가 위 안착
  if (openPositionRate >= 2.0) {
    score += 15;
  } else if (openPositionRate >= 1.0) {
    score += 8;
  } else if (openPositionRate < 0) {
    score -= 20;
  }

  // 6. 거래대금
  if (tradeValue >= 10000000000) {
    score += 15; // 100억 이상
  } else if (tradeValue >= settings.leaderCoreMinTradeValue) {
    score += 8;
  }

  return Math.round(score);
}

function calculateLeaderRankScore(item, currentPrice, marketScore = null) {
  const changeRate = Number(
    item.changeRate ||
    item.fluctuationRate ||
    item.riseRate ||
    item.rate ||
    item.raw?.flu_rt ||
    0
  );

  const tradeVolumeRatio = getTradeVolumeRatio(item);
  const dayPositionRate = getDayPositionRate(item, currentPrice);

  const openPrice = Math.abs(Number(
    item.open ||
    item.openPrice ||
    item.raw?.open_pric ||
    0
  ));

  const openPositionRate =
    openPrice > 0 && currentPrice > 0
      ? ((currentPrice - openPrice) / openPrice) * 100
      : 0;

  const sectorBonus = Number(item.leadingSectorBonus || 0);
  const leaderStrengthScore = getLeaderStrengthScore(item, currentPrice);

  let score = 0;
  const details = [];

  // 시장 점수
  const marketValue = Number(marketScore?.score || 0);
  if (marketValue >= 95) {
    score += 15;
    details.push("시장HOT+15");
  } else if (marketValue >= 80) {
    score += 10;
    details.push("시장GOOD+10");
  }

  // 발견 점수
  const discoverScore = Number(item.discoverScore || 0);
  score += Math.min(20, discoverScore * 2);
  details.push(`발견${discoverScore}`);

  // 주도섹터
  if (sectorBonus > 0) {
    score += 10;
    details.push(`주도섹터+10`);
  }

  // 상승률
  if (changeRate >= 1.5 && changeRate <= 7.0) {
    score += 15;
    details.push(`상승률적정+15`);
  } else if (changeRate > 7.0 && changeRate <= 12.0) {
    score += 6;
    details.push(`상승률과열주의+6`);
  }

  // 거래량비율: 탈락 아님, 점수화
  if (tradeVolumeRatio >= 80) {
    score += 15;
    details.push(`거래량강함+15`);
  } else if (tradeVolumeRatio >= -30) {
    score += 10;
    details.push(`거래량보통+10`);
  } else if (tradeVolumeRatio >= -70) {
    score += 5;
    details.push(`거래량약함+5`);
  } else {
    score -= 5;
    details.push(`거래량매우약함-5`);
  }

  // 당일위치
  if (dayPositionRate >= 45 && dayPositionRate <= 90) {
    score += 15;
    details.push(`당일위치양호+15`);
  } else if (dayPositionRate > 90 && dayPositionRate <= 98) {
    score += 5;
    details.push(`고점근접+5`);
  } else {
    score -= 5;
    details.push(`당일위치불리-5`);
  }

  // 시가대비
  if (openPositionRate >= 2.0) {
    score += 12;
    details.push(`시가위강함+12`);
  } else if (openPositionRate >= 0.3) {
    score += 6;
    details.push(`시가위유지+6`);
  } else {
    score -= 10;
    details.push(`시가아래-10`);
  }

  // 수급강도
  if (leaderStrengthScore >= 75) {
    score += 15;
    details.push(`수급강함+15`);
  } else if (leaderStrengthScore >= 50) {
    score += 8;
    details.push(`수급보통+8`);
  } else {
    score -= 5;
    details.push(`수급약함-5`);
  }

  item.leaderRankScore = Math.round(score);
  item.leaderRankScoreDetail = details.join(" / ");
  item.leaderStrengthScore = leaderStrengthScore;

  return {
    score: Math.round(score),
    detail: details.join(" / ")
  };
}

function todayKey() {
  return new Date().toLocaleDateString("sv-SE", {
    timeZone: "Asia/Seoul"
  });
}

function isTodayMarketTemperature(temp) {
  if (!temp) return false;

  if (temp.checkedDate) {
    return temp.checkedDate === todayKey();
  }

  const checkedText = String(temp.checkedAt || "");
  const todayKo = new Date().toLocaleDateString("ko-KR", {
    timeZone: "Asia/Seoul"
  });

  return checkedText.includes(todayKo);
}

function normalizeMarketTemperature(temp, reason = "시장온도 미갱신") {
  if (isTodayMarketTemperature(temp)) {
    return temp;
  }

  return {
    level: "NORMAL",
    label: "보통",
    advanceRatio: 0,
    upCount: 0,
    total: 0,
    reason,
    checkedAt: nowText(),
    stale: true
  };
}


function getCurrentTotalAsset(state) {
  const holdingsValue = (state.holdings || []).reduce((sum, holding) => {
    return sum + Number(holding.currentPrice || holding.buyPrice || 0) * Number(holding.qty || 0);
  }, 0);

  return Number(state.totalCash || 0) +
  Number(state.turboCash || 0) +
  Number(state.leaderCash || 0) +
  holdingsValue;
}

function initDailyLossLimitIfNeeded(state) {
  const today = todayKey();

  if (state.dailyLossDate !== today) {
  state.dailyLossDate = today;
  state.dailyBuyStopped = false;

  state.turboBuyStopped = false;
  state.turboBuyStoppedAt = null;
  state.turboBuyStoppedReason = null;

 

  state.dailyStartAsset = getCurrentTotalAsset(state);
    state.dailyLossLimit = Math.floor(
      state.dailyStartAsset * settings.dailyLossLimitRate
    );

    console.log(
      `[일일 손실한도 초기화] 시작총자산 ${state.dailyStartAsset.toLocaleString()}원 / 한도 ${state.dailyLossLimit.toLocaleString()}원`
    );
  }
}

function getTodayRealizedProfit(state) {
  const today = todayKey();

  return (state.tradeLogs || [])
    .filter((log) =>
      log.date === today &&
      typeof log.profit !== "undefined"
    )
    .reduce((sum, log) => sum + Number(log.profit || 0), 0);
}

function isDailyLossLimitReached(state) {
  initDailyLossLimitIfNeeded(state);

  const todayProfit = getTodayRealizedProfit(state);
  const limit = Number(state.dailyLossLimit || 0);

  if (limit <= 0) return false;

  return todayProfit <= -Math.abs(limit);
}

function getConsecutiveLossCount(state) {
  const results = [
    ...(state.virtualResults || []),
    ...(state.results || [])
  ];

  const sorted = results
    .filter((item) => item.sellTime)
    .sort((a, b) => new Date(b.sellTime) - new Date(a.sellTime));

  let count = 0;

  for (const item of sorted) {
    const profit = Number(item.profit || 0);

    if (profit < 0) {
      count++;
    } else {
      break;
    }
  }

  return count;
}

function isConsecutiveLossLimitReached(state) {
  return getConsecutiveLossCount(state) >= settings.maxConsecutiveLoss;
}

function isBuyCooldownActive(state) {
  if (!state.lastRunAt) return false;

  const lastRunTime = new Date(state.lastRunAt).getTime();

  if (!lastRunTime || Number.isNaN(lastRunTime)) return false;

  const elapsedMinutes = (Date.now() - lastRunTime) / 1000 / 60;

  return elapsedMinutes < settings.buyCooldownMinutes;
}


function isTradeTime() {
  if (settings.testMode) return true;

  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const current = `${hh}:${mm}`;

  return current >= settings.tradeStart && current <= settings.tradeEnd;
}

function isAfterEndProfitSellTime() {
  const now = new Date();

  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const current = `${hh}:${mm}`;

  return current >= settings.endProfitSellTime;
}

function isExcludedStock(item = {}) {
  const name = String(item.name || item.stockName || item.korName || "").trim();
  const code = String(item.code || "").trim();

  if (
    /KODEX|TIGER|ACE|SOL|HANARO|KOSEF|KBSTAR|ARIRANG|ETF|ETN|레버리지|인버스|스팩|SPAC/i.test(name)
  ) {
    return true;
  }

  // 우선주 간단 제외
  if (name.endsWith("우")) return true;

  return false;
}

function getSectorTags(item = {}) {
  const name = String(item.name || item.stockName || item.korName || "");

  const sectors = [];

  if (/조선|오션|중공업|해양|엔진/i.test(name)) {
    sectors.push("조선");
  }

  if (/방산|항공|우주|한화에어로|현대로템|LIG|풍산/i.test(name)) {
    sectors.push("방산");
  }

  if (/원전|전력|한전|두산에너빌리티|한전기술|일진파워/i.test(name)) {
    sectors.push("원전");
  }

  if (/반도체|하이닉스|삼성전자|DB하이텍|원익|테스|ISC|리노공업/i.test(name)) {
    sectors.push("반도체");
  }

  if (/2차전지|배터리|에코프로|포스코퓨처|엘앤에프|천보|엔켐/i.test(name)) {
    sectors.push("2차전지");
  }

  if (/AI|로봇|데이터|클라우드|솔트룩스|마음AI|로보/i.test(name)) {
    sectors.push("AI/로봇");
  }

  return sectors;
}

function getSectorPowerScore(item = {}) {
  const sectors = getSectorTags(item);

  if (sectors.length === 0) {
    return {
      score: 0,
      sectors: [],
      reason: "섹터 태그 없음"
    };
  }

  const changeRate = Number(
    item.changeRate ||
    item.fluctuationRate ||
    item.riseRate ||
    item.rate ||
    item.raw?.flu_rt ||
    0
  );

  const tradeVolumeRatio = getTradeVolumeRatio(item);

  let score = 0;

  if (changeRate >= 1.5) score += 1;
  if (changeRate >= 3.0) score += 1;

  if (tradeVolumeRatio >= 80) score += 1;
  if (tradeVolumeRatio >= 150) score += 1;

  if (sectors.length >= 1) score += 1;

  return {
    score,
    sectors,
    reason:
      `${sectors.join(", ")} / ` +
      `상승률 ${changeRate.toFixed(2)}% / ` +
      `거래량비율 ${tradeVolumeRatio.toFixed(1)}% / ` +
      `섹터점수 ${score}`
  };
}

function isStrongSectorCandidate(item = {}) {
  if (!settings.sectorFilterEnabled) {
    return {
      pass: true,
      reason: "섹터필터 OFF"
    };
  }

  const sectorPower = getSectorPowerScore(item);

  if (sectorPower.score < settings.sectorMinScore) {
    return {
      pass: false,
      reason: sectorPower.reason
    };
  }

  item.sectorTags = sectorPower.sectors;
  item.sectorPowerScore = sectorPower.score;

  return {
    pass: true,
    reason: sectorPower.reason
  };
}

function getLeadingSectorScores(candidates = []) {
  const sectorMap = {};

  for (const item of candidates) {
    const sectors = getSectorTags(item);
    if (sectors.length === 0) continue;

    const changeRate = Number(
      item.changeRate ||
      item.fluctuationRate ||
      item.riseRate ||
      item.rate ||
      item.raw?.flu_rt ||
      0
    );

    const volumeRatio = getTradeVolumeRatio(item);
    const score = Number(item.discoverScore || 0);

    for (const sector of sectors) {
      if (!sectorMap[sector]) {
        sectorMap[sector] = {
          sector,
          count: 0,
          totalChangeRate: 0,
          totalVolumeRatio: 0,
          totalScore: 0
        };
      }

      sectorMap[sector].count += 1;
      sectorMap[sector].totalChangeRate += changeRate;
      sectorMap[sector].totalVolumeRatio += volumeRatio;
      sectorMap[sector].totalScore += score;
    }
  }

  return Object.values(sectorMap)
    .map(row => {
      const avgChangeRate = row.totalChangeRate / row.count;
      const avgVolumeRatio = row.totalVolumeRatio / row.count;
      const avgScore = row.totalScore / row.count;

      const sectorPowerScore =
        row.count * 5 +
        avgChangeRate * 5 +
        avgVolumeRatio * 0.05 +
        avgScore * 2;

      return {
        ...row,
        avgChangeRate,
        avgVolumeRatio,
        avgScore,
        sectorPowerScore: Math.round(sectorPowerScore)
      };
    })
    .filter(row => row.count >= settings.sectorFlowMinCandidateCount)
    .sort((a, b) => b.sectorPowerScore - a.sectorPowerScore);
}

async function calculateMarketLeadingSectors() {
  const data = await fetchJson(
    `${API_BASE}/api/discover?scanLimit=4050&limit=4050`
  );

  const items = data.items || [];

  const scored = getLeadingSectorScores(
    items.filter(item => !isExcludedStock(item))
  );

  const leadingSectors = scored
    .slice(0, settings.sectorFlowTopCount)
    .map(row => row.sector);

  console.log(
    "[시장전체 주도섹터]",
    scored.slice(0, settings.sectorFlowTopCount).map(row =>
      `${row.sector} 점수 ${row.sectorPowerScore} / 종목 ${row.count}개 / 평균상승 ${row.avgChangeRate.toFixed(2)}% / 거래량 ${row.avgVolumeRatio.toFixed(1)}%`
    ).join(" | ")
  );

  return leadingSectors;
}


function applyLeadingSectorBonus(candidates = []) {
  const leadingSectors = getLeadingSectorScores(candidates)
    .slice(0, settings.sectorFlowTopCount);

  const leadingSectorNames = leadingSectors.map(row => row.sector);

  console.log(
    "[주도섹터]",
    leadingSectors.map(row =>
      `${row.sector} 점수 ${row.sectorPowerScore} / 종목 ${row.count}개 / 평균상승 ${row.avgChangeRate.toFixed(2)}% / 거래량 ${row.avgVolumeRatio.toFixed(1)}%`
    ).join(" | ")
  );

  return candidates.map(item => {
    const sectors = getSectorTags(item);
    const matched = sectors.filter(sector =>
      leadingSectorNames.includes(sector)
    );

    let bonus = 0;

    if (matched.length > 0) {
      const bestSector = leadingSectors.find(row =>
        matched.includes(row.sector)
      );

      bonus = Math.min(15, Math.floor(bestSector.sectorPowerScore / 10));
    }

    return {
      ...item,
      sectorTags: sectors,
      leadingSectorMatched: matched,
      leadingSectorBonus: bonus,
      originalDiscoverScore: Number(item.discoverScore || 0),
      discoverScore:
        Number(item.discoverScore || 0) + bonus
    };
  });
}

function analyzeSectorMoneyFlow(candidates = []) {
  const map = {};

  for (const item of candidates) {
    const power = getSectorPowerScore(item);

    for (const sector of power.sectors) {
      if (!map[sector]) {
        map[sector] = {
          sector,
          count: 0,
          totalScore: 0,
          totalChangeRate: 0,
          totalVolumeRatio: 0
        };
      }

      const changeRate = Number(
        item.changeRate ||
        item.fluctuationRate ||
        item.riseRate ||
        item.rate ||
        item.raw?.flu_rt ||
        0
      );

      const volumeRatio = getTradeVolumeRatio(item);

      map[sector].count += 1;
      map[sector].totalScore += power.score;
      map[sector].totalChangeRate += changeRate;
      map[sector].totalVolumeRatio += volumeRatio;
    }
  }

  return Object.values(map)
    .map((row) => ({
      ...row,
      avgScore: row.totalScore / row.count,
      avgChangeRate: row.totalChangeRate / row.count,
      avgVolumeRatio: row.totalVolumeRatio / row.count
    }))
    .filter((row) =>
      row.count >= settings.sectorFlowMinCandidateCount &&
      row.avgScore >= settings.sectorFlowMinAvgScore
    )
    .sort((a, b) =>
      b.avgScore - a.avgScore ||
      b.avgVolumeRatio - a.avgVolumeRatio ||
      b.avgChangeRate - a.avgChangeRate
    );
}

function getLeadingSectors(candidates = []) {
  if (!settings.sectorFlowEnabled) return [];

  const leading = getLeadingSectorScores(candidates)
    .slice(0, settings.sectorFlowTopCount)
    .filter(row =>
      row.count >= settings.sectorFlowMinCandidateCount &&
      row.sectorPowerScore >= 30
    );

  return leading.map(row => row.sector);
}

function isInLeadingSector(item, leadingSectors = []) {
  if (!settings.sectorFlowEnabled) {
    return {
      pass: true,
      reason: "섹터 자금쏠림 OFF",
      bonus: 0
    };
  }

  if (!leadingSectors || leadingSectors.length === 0) {
    return {
      pass: true,
      reason: "주도섹터 없음 → 필터 미적용",
      bonus: 0
    };
  }

  const tags = getSectorTags(item);
  const matched = tags.filter((tag) => leadingSectors.includes(tag));

  if (matched.length === 0) {
    return {
      pass: false,
      reason: `주도섹터 아님 / 종목섹터=${tags.join(",") || "없음"} / 주도섹터=${leadingSectors.join(",")}`,
      bonus: 0
    };
  }

  item.leadingSectorMatched = matched;

  return {
    pass: true,
    reason: `주도섹터 통과 / ${matched.join(",")}`,
    bonus: 8
  };
}

function isAlreadyHolding(state, code) {
  return state.holdings.some((item) => item.code === code);
}

function getCoreHoldingCount(state) {
  return (state.holdings || []).filter(
    (item) =>
      item.strategyGroup !== "TURBO" &&
item.strategyGroup !== "LEADER" &&
item.strategyGroup !== "EARLY"
  ).length;
}




function isRecentlySold(state, code) {
  const today = todayKey();

  const results = [
    ...(state.virtualResults || []),
    ...(state.results || [])
  ];

  const todaySold = results.some((item) => {
    return (
      item.code === code &&
      item.sellTime &&
      item.date === today
    );
  });

  return todaySold;
}



function getTimeBasedMaxHolding() {
  const now = new Date();
  const hhmm =
    String(now.getHours()).padStart(2, "0") +
    ":" +
    String(now.getMinutes()).padStart(2, "0");

  if (hhmm < "09:20") return 0;
if (hhmm < "09:25") return 1;
if (hhmm < "09:40") return 3;
if (hhmm < "10:00") return 5;
  if (hhmm < "13:00") return 7;

  return settings.maxHoldingCount;
}


function getAvailableSlots(state) {
  const timeMaxHolding = getTimeBasedMaxHolding();

  return Math.max(0, timeMaxHolding - getCoreHoldingCount(state));
}

async function fetchJson(url) {
  const res = await fetch(url);
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.message || "API 오류");
  }

  return data;
}

async function fetchPrice(code) {
  return await fetchJson(`${API_BASE}/api/price?code=${code}`);
}

async function discoverCandidates() {
  const marketLeadingSectors = await calculateMarketLeadingSectors();

  const data = await fetchJson(
    `${API_BASE}/api/discover?scanLimit=1000&limit=${settings.discoverLimit}`
  );

  const items = data.items || [];

  const filtered = items
    .filter((item) => !isExcludedStock(item))
    .filter((item) =>
      Number(item.discoverScore || 0) >= Math.min(
        settings.minScore,
        settings.earlyMinScore
      )
    );

  return filtered
    .map(item => {
      const sectorTags = getSectorTags(item);
      const matched = sectorTags.filter(sector =>
        marketLeadingSectors.includes(sector)
      );

      const bonus =
        matched.length > 0
          ? 8
          : 0;

      return {
        ...item,
        sectorTags,
        leadingSectorMatched: matched,
        leadingSectorBonus: bonus,
        originalDiscoverScore: Number(item.discoverScore || 0),
        discoverScore: Number(item.discoverScore || 0) + bonus
      };
    })
    .sort((a, b) =>
      Number(b.discoverScore || 0) -
      Number(a.discoverScore || 0)
    );
}

async function runBacktestWithPreset(code, preset) {
  const data = await fetchJson(
    `${API_BASE}/api/backtest?code=${code}&preset=${preset}`
  );

  return data;
}

async function findBestStrategy(code) {
  const presets = [
    { key: "trend", name: "추세형" },
    { key: "short", name: "단타형" },
    { key: "safe", name: "안정형" }
  ];

  const results = [];

  for (const preset of presets) {
    try {
      const result = await runBacktestWithPreset(code, preset.key);

      results.push({
        ...preset,
        profitRate: Number(result.finalProfitRate || result.profitRate || 0),
        winRate: Number(result.winRate || 0),
        tradeCount: Number(result.tradeCount || 0),
        passed: result.passed !== false
      });
    } catch (err) {
      console.warn("백테스트 실패:", code, preset.name, err.message);
    }
  }

  const valid = results.filter(item =>
  item.passed &&
  item.tradeCount >= 2 &&
  item.profitRate > 0
);

// 1순위 : 단타형
const short = valid.find(item =>
  item.key === "short" &&
  item.winRate >= 50
);

if (short) {
  return short;
}

// 2순위 : 추세형
const trend = valid.find(item =>
  item.key === "trend" &&
  item.winRate >= 40
);

if (trend) {
  return trend;
}

// 안정형은 당분간 제외
return null;
}

function wasStoppedToday(state, code) {
  const today = todayKey();

  const logs = [
    ...(state.virtualResults || []),
    ...(state.tradeLogs || [])
  ];

  const stopLossTypes = [
    "STOP_LOSS",
    "TURBO_STOP_LOSS",
    "EARLY_STOP_LOSS",
    "LEADER_STOP_LOSS"
  ];

  return logs.some((item) =>
    item.code === code &&
    item.date === today &&
    (
      stopLossTypes.includes(item.type) ||
      stopLossTypes.includes(item.actionType)
    )
  );
}

function isStrategyBlocked(state, strategyPreset) {
  const recent = (state.virtualResults || [])
    .filter((item) =>
      item.strategyPreset === strategyPreset &&
      item.date &&
      typeof item.profitRate !== "undefined"
    )
    .slice(-10);

  if (recent.length < 5) return false;

  const totalRate = recent.reduce(
    (sum, item) => sum + Number(item.profitRate || 0),
    0
  );

  return totalRate < -3;
}

function wasBoughtToday(state, code) {
  return (state.tradeLogs || []).some((item) =>
    item.type === "BUY" &&
    item.code === code &&
    item.date === todayKey()
  );
}

function wasAnyBoughtToday(state, code) {
  return (state.tradeLogs || []).some((log) =>
    log.code === code &&
    log.date === todayKey() &&
    [
      "BUY",
      "TURBO_BUY",
      "LEADER_BUY",
      "EARLY_BUY"
    ].includes(log.type)
  );
}

function getSafeStockName(item, priceData = {}) {
  const code = String(item.code || priceData.code || "").trim();

  const candidates = [
    priceData.name,
    item.name,
    item.stockName,
    item.korName
  ];

  for (const name of candidates) {
    const cleanName = String(name || "").trim();

    if (
      cleanName &&
      cleanName !== code &&
      !/^\d{6}$/.test(cleanName)
    ) {
      return cleanName;
    }
  }

  return code;
}

function judgeCoreBuy(state, item, currentPrice, strategy, marketScore = null) {
  if (!isTradeTime()) {
    return { pass: false, reason: "거래 가능 시간이 아님" };
  }

  if (isExcludedStock(item)) {
    return { pass: false, reason: "제외종목" };
  }

  if (wasStoppedToday(state, item.code)) {
    return { pass: false, reason: "오늘 손절 또는 손실 이력 있음" };
  }

  if (isAlreadyHolding(state, item.code)) {
    return { pass: false, reason: "이미 보유중" };
  }

  const price = Number(currentPrice || item.currentPrice || item.price || 0);
  if (!price || price <= 0) {
    return { pass: false, reason: "현재가 오류" };
  }

  if (
    settings.marketScoreEnabled &&
    marketScore &&
    Number(marketScore.score || 0) < settings.coreMinMarketScore
  ) {
    return {
      pass: false,
      reason: `CORE 시장점수 부족 ${marketScore.score} / 기준 ${settings.coreMinMarketScore}`
    };
  }

  const finalScore = calculateFinalBuyScore(item, price, marketScore);

  if (finalScore.score < settings.coreMinFinalBuyScore) {
    return {
      pass: false,
      reason: finalScore.reason
    };
  }

  const coreChangeRate = Number(
    item.changeRate ||
    item.fluctuationRate ||
    item.riseRate ||
    item.rate ||
    0
  );

  const coreTradeVolumeRatio = getTradeVolumeRatio(item);
  const coreDayPositionRate = getDayPositionRate(item, price);

  if (coreChangeRate > settings.coreMaxChangeRate) {
    return {
      pass: false,
      reason: `상승률 과다 ${coreChangeRate.toFixed(2)}%`
    };
  }

  if (coreTradeVolumeRatio < settings.coreMinTradeVolumeRatio) {
    return {
      pass: false,
      reason: `거래량비율 약함 ${coreTradeVolumeRatio.toFixed(1)}%`
    };
  }

  if (
    coreDayPositionRate < settings.coreMinDayPositionRate ||
    coreDayPositionRate > settings.coreMaxDayPositionRate
  ) {
    return {
      pass: false,
      reason: `당일위치 부적합 ${coreDayPositionRate.toFixed(1)}%`
    };
  }

  return {
    pass: true,
    finalScore,
    reason: `CORE 판단 통과 / ${finalScore.reason}`
  };
}

function paperBuy(state, item, strategy, buyAmountLimit = settings.perBuyAmount) {
  if (!isTradeTime()) {
    console.log("[모의매수 차단] 거래 가능 시간이 아닙니다.", item?.name);
    return false;
  }

  if (isExcludedStock(item)) {
    console.log("[CORE 매수제외] 제외종목", item.name || item.stockName || item.korName || item.code);
    return false;
  }

  if (wasStoppedToday(state, item.code)) {
    console.log("[CORE 매수제외] 오늘 손절 또는 손실 이력 있음", item.name || item.code);
    return false;
  }

  if (state.holdings.some((h) => h.code === item.code)) {
    console.log("[모의매수 제외] 이미 보유중", item.name);
    return false;
  }

  const price = Number(item.currentPrice || item.price || 0);
  if (!price || price <= 0) return false;

  const coreChangeRate = Number(
    item.changeRate ||
    item.fluctuationRate ||
    item.riseRate ||
    item.rate ||
    0
  );

  const coreTradeVolumeRatio = getTradeVolumeRatio(item);
  const coreDayPositionRate = getDayPositionRate(item, price);

  if (coreChangeRate > settings.coreMaxChangeRate) {
    console.log("[CORE 매수제외] 상승률 과다", item.name, coreChangeRate.toFixed(2));
    return false;
  }

  if (coreTradeVolumeRatio < settings.coreMinTradeVolumeRatio) {
    console.log("[CORE 매수제외] 거래량비율 약함", item.name, coreTradeVolumeRatio.toFixed(1));
    return false;
  }

  if (
    coreDayPositionRate < settings.coreMinDayPositionRate ||
    coreDayPositionRate > settings.coreMaxDayPositionRate
  ) {
    console.log("[CORE 매수제외] 당일위치 부적합", item.name, coreDayPositionRate.toFixed(1));
    return false;
  }

  const availableCash = Number(state.totalCash || settings.totalCash || 0);

  const dynamicMaxHolding = Math.min(
    settings.maxHoldingCount,
    getTimeBasedMaxHolding(),
    Math.max(1, Math.floor(availableCash / settings.minBuyAmount))
  );

  const remainSlots = Math.max(
    1,
    dynamicMaxHolding - getCoreHoldingCount(state)
  );

  const budget = getBudgetInfo(state);

  const safeBuyAmountLimit = Number(
    buyAmountLimit ||
    budget.corePerBuyAmount ||
    settings.minBuyAmount ||
    10000000
  );

  const buyAmount = Math.min(
    safeBuyAmountLimit,
    Math.floor(availableCash / remainSlots)
  );

  const qty = Math.floor(buyAmount / price);

  if (!Number.isFinite(buyAmount) || buyAmount <= 0 || !Number.isFinite(qty) || qty <= 0) {
    console.log("[모의매수 차단] 수량 계산 오류", {
      name: item.name,
      code: item.code,
      price,
      buyAmount,
      buyAmountLimit,
      safeBuyAmountLimit,
      availableCash,
      remainSlots
    });
    return false;
  }

  const finalBuyScore = Number(item.finalBuyScore || 0);
  const finalBuyScoreDetail = item.finalBuyScoreDetail || null;

  const holding = {
    code: item.code,
    name: item.name && item.name !== item.code
      ? item.name
      : (item.stockName || item.korName || item.code),

    buyPrice: price,
    qty,
    buyAmount: price * qty,
    plannedBuyAmount: buyAmount,
    currentPrice: price,
    highestPrice: price,
    autoTrade: true,
    lowestPrice: price,
    maxProfitRate: 0,
    maxLossRate: 0,

    strategyGroup: "CORE",
    strategyPreset: strategy.key,
    strategyName: settings.leaderCoreEnabled
      ? `Leader Core-${strategy.name}`
      : strategy.name,

    discoverScore: Number(item.discoverScore || 0),
    finalBuyScore,
    finalBuyScoreDetail,

    changeRate: coreChangeRate,
    tradeVolumeRatio: coreTradeVolumeRatio,
    dayPositionRate: coreDayPositionRate,

    discoverReasons: Array.isArray(item.discoverReasons)
      ? item.discoverReasons
      : [],
    discoverScoreDetails: item.discoverScoreDetails || {},

    protectMinutes: 5,
    buyTime: nowText(),
    buyTimeMs: Date.now(),
    buyAt: new Date().toISOString(),
    date: todayKey()
  };

  state.holdings.push(holding);
  state.totalCash = availableCash - price * qty;

  state.tradeLogs.push({
    type: "BUY",
    strategyGroup: "CORE",

    code: item.code,
    name: holding.name,

    price,
    buyPrice: price,
    qty,

    buyAmount: price * qty,
    plannedBuyAmount: buyAmount,

    changeRate: coreChangeRate,
    volume: Number(item.volume || 0),
    tradeVolumeRatio: coreTradeVolumeRatio,
    dayPositionRate: coreDayPositionRate,

    marketTemperature: state.marketTemperature || null,
    marketScore: state.marketScore || null,

    finalBuyScore,
    finalBuyScoreDetail,

    remainCashAfterBuy: state.totalCash,
    dynamicMaxHolding,
    remainSlotsAfterBuy: Math.max(
      0,
      dynamicMaxHolding - getCoreHoldingCount(state)
    ),

    discoverScore: Number(item.discoverScore || 0),
    strategyPreset: strategy.key,
    strategyName: settings.leaderCoreEnabled
      ? `Leader Core-${strategy.name}`
      : strategy.name,

    reason: settings.leaderCoreEnabled
      ? `Leader Core 대장주 조건 통과 / 최고전략 ${strategy.name} / 백테스트 수익률 ${strategy.profitRate.toFixed(2)}%`
      : `서버 자동 모의매수 / 최고전략 ${strategy.name} / 백테스트 수익률 ${strategy.profitRate.toFixed(2)}%`,

    date: todayKey(),
    time: nowText()
  });

  return true;
}

function getTurboHoldingCount(state) {
  return (state.holdings || []).filter(
    (item) => item.strategyGroup === "TURBO"
  ).length;
}

function getEarlyHoldingCount(state) {
  return (state.holdings || []).filter(
    (item) => item.strategyGroup === "EARLY"
  ).length;
}

function getTodayEarlyBuyCount(state) {
  return (state.tradeLogs || []).filter((log) =>
    log.date === todayKey() &&
    log.type === "EARLY_BUY"
  ).length;
}

function wasEarlyBoughtToday(state, code) {
  return (state.tradeLogs || []).some((log) =>
    log.code === code &&
    log.date === todayKey() &&
    log.type === "EARLY_BUY"
  );
}

function wasTurboBoughtToday(state, code) {
  return (state.tradeLogs || []).some((log) =>
    log.code === code &&
    log.date === todayKey() &&
    log.type === "TURBO_BUY"
  );
}

function getTodayTurboBuyCount(state) {
  return (state.tradeLogs || []).filter((log) =>
    log.date === todayKey() &&
    log.type === "TURBO_BUY"
  ).length;
}

function getTurboConsecutiveLossCount(state) {
  const turboSells = (state.tradeLogs || [])
    .filter((log) =>
      log.strategyGroup === "TURBO" &&
      log.date === todayKey() &&
      [
        "TURBO_STOP_LOSS",
        "TURBO_TAKE_PROFIT",
        "TURBO_TRAILING_STOP",
        "TURBO_TIME_EXIT",
        "TURBO_FIRST_TAKE_PROFIT"
      ].includes(log.type)
    )
    .reverse();

  let count = 0;

  for (const log of turboSells) {
    if (Number(log.profit || 0) < 0) {
      count++;
    } else {
      break;
    }
  }

  return count;
}

function isViLikeItem(item) {
  const rawText = JSON.stringify(item.raw || item || "");
  return rawText.includes("VI");
}

function getTradeVolumeRatio(item) {
  const raw = item.raw || {};

  const value = String(
    raw.trde_pre ||
    item.trde_pre ||
    item.tradeVolumeRatio ||
    ""
  ).replace(/[+,]/g, "");

  return Number(value || 0);
}

function getDayPositionRate(item, currentPrice) {
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

  if (!high || !low || high <= low || !currentPrice) return 0;

  return ((currentPrice - low) / (high - low)) * 100;
}

function updateCandidateRankHistory(state, item, currentPrice) {
  if (!state.candidateRanks) {
    state.candidateRanks = {};
  }

  const code = String(item.code || "");
  if (!code) return null;

  const now = Date.now();

  const score = Number(item.discoverScore || 0);
  const changeRate = Number(
    item.changeRate ||
    item.fluctuationRate ||
    item.riseRate ||
    item.rate ||
    0
  );

  const tradeVolumeRatio = getTradeVolumeRatio(item);
  const dayPositionRate = getDayPositionRate(item, currentPrice);

  if (!state.candidateRanks[code]) {
    state.candidateRanks[code] = [];
  }

  state.candidateRanks[code].push({
    time: now,
    score,
    changeRate,
    tradeVolumeRatio,
    dayPositionRate,
    price: Number(currentPrice || item.currentPrice || item.price || 0)
  });

  const maxAgeMs = settings.candidateRankMaxAgeMinutes * 60 * 1000;

  state.candidateRanks[code] = state.candidateRanks[code].filter(
    (row) => now - Number(row.time || 0) <= maxAgeMs
  );

  return state.candidateRanks[code];
}

function isCandidateGettingStronger(state, item, currentPrice) {
  if (!settings.candidateRankEnabled) return true;

  const history = updateCandidateRankHistory(state, item, currentPrice);

  if (!history || history.length < settings.candidateRankMinHistoryCount) {
    return {
      pass: false,
      reason: "후보 이력 부족"
    };
  }

  const first = history[0];
  const last = history[history.length - 1];

  const scoreUp = Number(last.score || 0) - Number(first.score || 0);
  const volumeUp =
    Number(last.tradeVolumeRatio || 0) >= Number(first.tradeVolumeRatio || 0);
  const priceUp =
    Number(last.price || 0) >= Number(first.price || 0);

  if (scoreUp < settings.candidateRankMinScoreUp) {
    return {
      pass: false,
      reason: `후보 점수 상승 부족 ${scoreUp.toFixed(1)}`
    };
  }

  if (!volumeUp) {
    return {
      pass: false,
      reason: "거래량비율 약화"
    };
  }

  if (!priceUp) {
    return {
      pass: false,
      reason: "가격 흐름 약화"
    };
  }

  return {
    pass: true,
    reason: `후보 강화 통과 · 점수상승 ${scoreUp.toFixed(1)}`
  };
}

function isEarlyLeaderCandidate(item, currentPrice) {
  const changeRate = Number(
    item.changeRate ||
    item.fluctuationRate ||
    item.riseRate ||
    item.rate ||
    item.raw?.flu_rt ||
    0
  );

  const openPrice = Math.abs(Number(
    item.open ||
    item.openPrice ||
    item.raw?.open_pric ||
    0
  ));

  const score = Number(item.discoverScore || 0);
  const volumeRatio = getTradeVolumeRatio(item);
  const positionRate = getDayPositionRate(item, currentPrice);

  if (score < settings.earlyMinScore) {
    return { pass: false, reason: `점수 부족 ${score}` };
  }

  if (
    changeRate < settings.earlyMinChangeRate ||
    changeRate > settings.earlyMaxChangeRate
  ) {
    return {
      pass: false,
      reason: `초기 상승 구간 아님 ${changeRate.toFixed(2)}%`
    };
  }

  if (volumeRatio < settings.earlyMinTradeVolumeRatio) {
    return {
      pass: false,
      reason: `거래량 증가 부족 ${volumeRatio.toFixed(1)}%`
    };
  }

  if (openPrice > 0 && currentPrice <= openPrice) {
    return { pass: false, reason: "시가 위 안착 실패" };
  }

  if (positionRate < settings.earlyMinDayPositionRate) {
    return {
      pass: false,
      reason: `당일 위치 약함 ${positionRate.toFixed(1)}%`
    };
  }

  return {
    pass: true,
    changeRate,
    volumeRatio,
    positionRate,
    reason: `EARLY 초기 수급 포착 · 상승 ${changeRate.toFixed(2)}% / 거래량 ${volumeRatio.toFixed(1)}% / 위치 ${positionRate.toFixed(1)}%`
  };
}

function checkTurboLeaderCandidate(item, currentPrice) {
  const dayRiseRate = Number(
    item.changeRate ||
    item.fluctuationRate ||
    item.riseRate ||
    item.rate ||
    0
  );

  const openPrice = Math.abs(Number(item.open || item.openPrice || item.raw?.open_pric || 0));
  const volume = Number(item.volume || item.raw?.trde_qty || 0);

  const tradeVolumeRatio = getTradeVolumeRatio(item);
  const dayPositionRate = getDayPositionRate(item, currentPrice);

  const openPositionRate =
    openPrice > 0 && currentPrice > 0
      ? ((currentPrice - openPrice) / openPrice) * 100
      : 0;

  // 1. 시가 대비 힘이 핵심
  if (openPositionRate < settings.turboMinOpenPositionRate) {
    return {
      pass: false,
      reason: `시가대비 힘 부족 ${openPositionRate.toFixed(2)}%`
    };
  }

  // 2. 거래량비율이 핵심
  if (tradeVolumeRatio < settings.turboMinTradeVolumeRatio) {
    return {
      pass: false,
      reason: `거래량비율 부족 ${tradeVolumeRatio.toFixed(1)}%`
    };
  }

  // 3. 기본 거래량
  if (volume < settings.turboMinVolume) {
    return {
      pass: false,
      reason: `거래량 부족 ${volume.toLocaleString()}`
    };
  }

  // 4. 당일 상승률은 보조조건
  if (dayRiseRate < settings.turboBuyMinDayRiseRate) {
    return {
      pass: false,
      reason: `당일 상승률 부족 ${dayRiseRate.toFixed(2)}%`
    };
  }

  if (dayRiseRate > settings.turboBuyMaxDayRiseRate) {
    return {
      pass: false,
      reason: `당일 상승률 과열 ${dayRiseRate.toFixed(2)}%`
    };
  }

  // 5. 당일 위치: 너무 낮으면 힘 없음, 너무 높으면 추격
  if (
    dayPositionRate > 0 &&
    dayPositionRate < settings.turboMinDayPositionRate
  ) {
    return {
      pass: false,
      reason: `당일 위치 약함 ${dayPositionRate.toFixed(1)}%`
    };
  }

  if (
    dayPositionRate > 0 &&
    dayPositionRate > settings.turboMaxDayPositionRate
  ) {
    return {
      pass: false,
      reason: `당일 위치 과열 ${dayPositionRate.toFixed(1)}%`
    };
  }

  return {
    pass: true,
    dayRiseRate,
    openPositionRate,
    tradeVolumeRatio,
    dayPositionRate,
    reason:
      `TURBO 시가돌파 조건 통과 · ` +
      `시가대비 ${openPositionRate.toFixed(2)}% / ` +
      `상승률 ${dayRiseRate.toFixed(2)}% / ` +
      `거래량비율 ${tradeVolumeRatio.toFixed(1)}% / ` +
      `당일위치 ${dayPositionRate.toFixed(1)}%`
  };
}
function paperEarlyBuy(state, item, currentPrice) {
  if (!settings.earlyEnabled) return false;

  if (isExcludedStock(item)) {
    console.log("[EARLY 매수제외] 제외종목", item.name || item.stockName || item.korName || item.code);
    return false;
  }

  if (getTodayEarlyBuyCount(state) >= settings.earlyMaxDailyBuyCount) {
    console.log("[EARLY 매수제외] 하루 최대 진입 횟수 도달");
    return false;
  }

  if (getEarlyHoldingCount(state) >= settings.earlyMaxHoldingCount) {
    console.log("[EARLY 매수제외] 최대 보유종목 도달");
    return false;
  }

  if (isAlreadyHolding(state, item.code)) {
    console.log("[EARLY 매수제외] 이미 보유중", item.name);
    return false;
  }

  if (wasEarlyBoughtToday(state, item.code)) {
    console.log("[EARLY 매수제외] 오늘 이미 EARLY 매수", item.name);
    return false;
  }

  if (wasStoppedToday(state, item.code)) {
    console.log("[EARLY 매수제외] 오늘 손절 또는 손실 이력 있음", item.name);
    return false;
  }

  const price = Number(currentPrice || item.currentPrice || item.price || 0);
  if (!price || price <= 0) return false;

  const availableCash = Number(state.turboCash || 0);

  const buyAmount = Math.min(
    Math.floor(availableCash / Math.max(1, settings.earlyMaxHoldingCount - getEarlyHoldingCount(state))),
    availableCash
  );

  const qty = Math.floor(buyAmount / price);

  if (qty <= 0) {
    console.log("[EARLY 매수제외] 공격자금 부족");
    return false;
  }

  const holding = {
    code: item.code,
    name: item.name || item.stockName || item.korName || item.code,
    buyPrice: price,
    qty,
    buyAmount: price * qty,
    plannedBuyAmount: buyAmount,
    currentPrice: price,
    highestPrice: price,
    lowestPrice: price,
    maxProfitRate: 0,
    maxLossRate: 0,
    autoTrade: true,

    strategyGroup: "EARLY",
    strategyPreset: "early",
    strategyName: "초기수급형",

    discoverScore: Number(item.discoverScore || 0),
    changeRate: Number(item.changeRate || item.raw?.flu_rt || 0),
    tradeVolumeRatio: getTradeVolumeRatio(item),

    buyTime: nowText(),
    buyTimeMs: Date.now(),
    buyAt: new Date().toISOString(),
    date: todayKey()
  };

  state.holdings.push(holding);
  state.turboCash = availableCash - price * qty;

  state.tradeLogs.push({
    type: "EARLY_BUY",
    strategyGroup: "EARLY",

    code: holding.code,
    name: holding.name,

    price,
    buyPrice: price,
    qty,

    buyAmount: price * qty,
    plannedBuyAmount: buyAmount,

    changeRate: holding.changeRate,
    tradeVolumeRatio: holding.tradeVolumeRatio,
    volume: Number(item.volume || item.raw?.trde_qty || 0),

    marketTemperature: state.marketTemperature || null,
    remainAttackCashAfterBuy: state.turboCash,

    discoverScore: Number(item.discoverScore || 0),
    reason: "EARLY 초기 수급 포착 자동 모의매수",

    date: todayKey(),
    time: nowText()
  });

  console.log(
    `[EARLY 매수] ${holding.name} ${holding.code} / ${price}원 / ${qty}주 / 거래량 ${holding.tradeVolumeRatio.toFixed(1)}%`
  );

  return true;
}

function getTurboPendingKey(item) {
  return String(item.code || "");
}

function registerTurboRecheckCandidate(state, item, currentPrice, reason = "") {
  if (!state.turboRecheckCandidates) {
    state.turboRecheckCandidates = {};
  }

  const code = getTurboPendingKey(item);
  if (!code) return;

  if (state.turboRecheckCandidates[code]) {
    return;
  }

  state.turboRecheckCandidates[code] = {
    code,
    name: item.name || item.stockName || item.korName || code,
    firstPrice: Number(currentPrice || 0),
    firstScore: Number(item.discoverScore || 0),
    firstTradeVolumeRatio: getTradeVolumeRatio(item),
    firstDayPositionRate: getDayPositionRate(item, currentPrice),
    firstAt: Date.now(),
    firstAtText: nowText(),
    reason
  };

  console.log(
    `[TURBO 재확인 등록] ${item.name || code} / ${reason}`
  );
}

function checkTurboRecheckCandidate(state, item, currentPrice) {
  if (!settings.turboRecheckEnabled) {
    return { pass: true, reason: "재확인 OFF" };
  }

  if (!state.turboRecheckCandidates) {
    state.turboRecheckCandidates = {};
  }

  const code = getTurboPendingKey(item);
  const saved = state.turboRecheckCandidates[code];

  if (!saved) {
    registerTurboRecheckCandidate(
      state,
      item,
      currentPrice,
      "첫 조건 통과 → 재확인 대기"
    );

    return {
      pass: false,
      waiting: true,
      reason: "첫 조건 통과, 재확인 대기"
    };
  }

  const elapsedMinutes =
    (Date.now() - Number(saved.firstAt || 0)) / 1000 / 60;

  if (elapsedMinutes < settings.turboRecheckDelayMinutes) {
    return {
      pass: false,
      waiting: true,
      reason: `재확인 대기중 ${elapsedMinutes.toFixed(1)}분`
    };
  }

  if (elapsedMinutes > settings.turboRecheckMaxAgeMinutes) {
    delete state.turboRecheckCandidates[code];

    return {
      pass: false,
      reason: "재확인 후보 만료"
    };
  }

  const nowScore = Number(item.discoverScore || 0);
  const nowTradeVolumeRatio = getTradeVolumeRatio(item);
  const nowPrice = Number(currentPrice || item.currentPrice || item.price || 0);

  const priceOk = nowPrice >= Number(saved.firstPrice || 0) * 0.995;
  const scoreOk = nowScore >= Number(saved.firstScore || 0);
  const volumeOk =
    nowTradeVolumeRatio >= Number(saved.firstTradeVolumeRatio || 0);

  if (!priceOk) {
    delete state.turboRecheckCandidates[code];
    return {
      pass: false,
      reason: "재확인 실패 · 가격 약화"
    };
  }

  if (!scoreOk) {
    delete state.turboRecheckCandidates[code];
    return {
      pass: false,
      reason: "재확인 실패 · 점수 약화"
    };
  }

  if (!volumeOk) {
    delete state.turboRecheckCandidates[code];
    return {
      pass: false,
      reason: "재확인 실패 · 거래량비율 약화"
    };
  }

  delete state.turboRecheckCandidates[code];

  return {
    pass: true,
    reason:
      `재확인 통과 · ${elapsedMinutes.toFixed(1)}분 경과 / ` +
      `점수 ${saved.firstScore}→${nowScore} / ` +
      `거래량 ${Number(saved.firstTradeVolumeRatio || 0).toFixed(1)}→${nowTradeVolumeRatio.toFixed(1)}%`
  };
}

function judgeTurboBuy(state, item, currentPrice) {
  if (!settings.turboEnabled) {
    return { pass: false, reason: "TURBO 비활성화" };
  }

  if (isExcludedStock(item)) {
    return { pass: false, reason: "제외종목" };
  }

  if (wasStoppedToday(state, item.code)) {
    return { pass: false, reason: "오늘 손절 또는 손실 이력 있음" };
  }

  
  if (getTodayTurboBuyCount(state) >= settings.turboMaxDailyBuyCount) {
    return { pass: false, reason: "하루 최대 진입 횟수 도달" };
  }

  if (getTurboConsecutiveLossCount(state) >= settings.turboMaxConsecutiveLoss) {
    return { pass: false, reason: "연속 손절 제한 도달" };
  }

  if (getTurboHoldingCount(state) >= settings.turboMaxHoldingCount) {
    return { pass: false, reason: "최대 보유종목 도달" };
  }

  if (isAlreadyHolding(state, item.code)) {
    return { pass: false, reason: "이미 보유중" };
  }

  if (wasTurboBoughtToday(state, item.code)) {
    return { pass: false, reason: "오늘 이미 TURBO 매수" };
  }

  const price = Number(currentPrice || item.currentPrice || item.price || 0);
  if (!price || price <= 0) {
    return { pass: false, reason: "현재가 오류" };
  }

  const rankCheck = isCandidateGettingStronger(state, item, price);
  if (!rankCheck.pass) {
    return {
      pass: false,
      reason: `후보 강화 미충족 / ${rankCheck.reason}`
    };
  }

  const recheck = checkTurboRecheckCandidate(state, item, price);
  if (!recheck.pass) {
    return {
      pass: false,
      reason: recheck.reason
    };
  }

return {
  pass: true,
  reason:
    `TURBO 판단 통과 / ` +
    `주도섹터=${item.leadingSectorMatched?.join(",") || "아님"} / ` +
    `섹터보너스=${item.leadingSectorBonus || 0} / ` +
    `${rankCheck.reason} / ${recheck.reason}`
};
}

function paperTurboBuy(state, item, currentPrice) {
 
  const price = Number(currentPrice || item.currentPrice || item.price || 0);
  if (!price || price <= 0) return false;

  
  const buyChangeRate = Number(
  item.changeRate ||
  item.fluctuationRate ||
  item.riseRate ||
  item.rate ||
  0
);

const buyTradeVolumeRatio = getTradeVolumeRatio(item);
const buyDayPositionRate = getDayPositionRate(item, price);

  const budget = getBudgetInfo(state);
  const availableCash = Number(state.turboCash || 0);
  const buyAmount = Math.min(budget.turboPerBuyAmount, availableCash);
  const qty = Math.floor(buyAmount / price);

  if (qty <= 0) {
    console.log("[TURBO 매수제외] Turbo 현금 부족");
    return false;
  }

  const holding = {
  code: item.code,
  name: item.name || item.stockName || item.korName || item.code,

  buyPrice: price,
  qty,
  buyAmount: price * qty,
  plannedBuyAmount: buyAmount,
  currentPrice: price,
  highestPrice: price,
  autoTrade: true,
  lowestPrice: price,
  maxProfitRate: 0,
  maxLossRate: 0,

  strategyGroup: "TURBO",
  strategyPreset: "turbo",
  strategyName: "터보형",

  // 주도섹터 정보
  sectorTags: item.sectorTags || [],
  leadingSectorMatched: item.leadingSectorMatched || [],
  leadingSectorBonus: Number(item.leadingSectorBonus || 0),
  originalDiscoverScore: Number(
    item.originalDiscoverScore || item.discoverScore || 0
  ),

  discoverScore: Number(item.discoverScore || 0),
  finalBuyScore: Number(item.finalBuyScore || 0),
  finalBuyScoreDetail: item.finalBuyScoreDetail || null,

  changeRate: buyChangeRate,
  tradeVolumeRatio: buyTradeVolumeRatio,
  dayPositionRate: buyDayPositionRate,

  buyChangeRate,
  buyTradeVolumeRatio,
  buyDayPositionRate,

  discoverReasons: Array.isArray(item.discoverReasons)
    ? item.discoverReasons
    : [],

  buyTime: nowText(),
  buyTimeMs: Date.now(),
  buyAt: new Date().toISOString(),
  date: todayKey()
};

  state.holdings.push(holding);
  state.turboCash = availableCash - price * qty;

  state.tradeLogs.push({
    type: "TURBO_BUY",
    strategyGroup: "TURBO",
    sectorTags: item.sectorTags || [],
leadingSectorMatched: item.leadingSectorMatched || [],
leadingSectorBonus: Number(item.leadingSectorBonus || 0),

originalDiscoverScore: Number(
  item.originalDiscoverScore || item.discoverScore || 0
),

discoverScore: Number(item.discoverScore || 0),

    code: item.code,
    name: holding.name,

    price,
    buyPrice: price,
    qty,

    buyAmount: price * qty,
    plannedBuyAmount: buyAmount,

    changeRate: buyChangeRate,

    buyChangeRate,
    volume: Number(item.volume || 0),
    tradeVolumeRatio: buyTradeVolumeRatio,
    dayPositionRate: buyDayPositionRate,
    buyTradeVolumeRatio,
    buyDayPositionRate,
    
    finalBuyScore: Number(item.finalBuyScore || 0),
    finalBuyScoreDetail: item.finalBuyScoreDetail || null,
    marketScore: state.marketScore || null,

    marketTemperature: state.marketTemperature || null,

    remainTurboCashAfterBuy: state.turboCash,

    discoverScore: Number(item.discoverScore || 0),

    reason: "Turbo 조건 충족 자동 모의매수",

    date: todayKey(),
    time: nowText()
  });

  console.log(
    `[TURBO 매수] ${holding.name} ${holding.code} / ${price}원 / ${qty}주`
  );

  return true;
}

function getLeaderHoldingCount(state) {
  return (state.holdings || []).filter(
    (item) => item.strategyGroup === "LEADER"
  ).length;
}

function getTodayLeaderBuyCount(state) {
  return (state.tradeLogs || []).filter((log) =>
    log.date === todayKey() &&
    log.type === "LEADER_BUY"
  ).length;
}

function wasLeaderBoughtToday(state, code) {
  return (state.tradeLogs || []).some((log) =>
    log.code === code &&
    log.date === todayKey() &&
    log.type === "LEADER_BUY"
  );
}

function judgeLeaderBuy(state, item, currentPrice, marketScore = null) {
  if (!settings.leaderEnabled) {
    return { pass: false, reason: "LEADER 비활성화" };
  }

  if (isExcludedStock(item)) {
    return { pass: false, reason: "제외종목" };
  }

  if (getLeaderHoldingCount(state) >= settings.leaderMaxHoldingCount) {
    return { pass: false, reason: "최대 보유종목 도달" };
  }

  if (getTodayLeaderBuyCount(state) >= settings.leaderMaxDailyBuyCount) {
    return { pass: false, reason: "하루 최대 진입 횟수 도달" };
  }

  if (isAlreadyHolding(state, item.code)) {
    return { pass: false, reason: "이미 보유중" };
  }

  if (wasLeaderBoughtToday(state, item.code)) {
    return { pass: false, reason: "오늘 이미 LEADER 매수" };
  }

  if (wasStoppedToday(state, item.code)) {
    return { pass: false, reason: "오늘 손절 또는 손실 이력 있음" };
  }

  const price = Number(currentPrice || item.currentPrice || item.price || 0);
  if (!price || price <= 0) {
    return { pass: false, reason: "현재가 오류" };
  }

  if (
    settings.marketScoreEnabled &&
    marketScore &&
    Number(marketScore.score || 0) < settings.leaderMinMarketScore
  ) {
    return {
      pass: false,
      reason: `LEADER 시장점수 부족 ${marketScore.score} / 기준 ${settings.leaderMinMarketScore}`
    };
  }

 const finalScore = calculateFinalBuyScore(item, price, marketScore);

const marketValue = Number(marketScore?.score || 0);

let dynamicLeaderMinFinalBuyScore = settings.leaderMinFinalBuyScore;
let dynamicLeaderStrengthMinScore = settings.leaderStrengthMinScore;

if (marketValue >= 90) {
  // HOT장: 빠르게 진입
  dynamicLeaderMinFinalBuyScore = 65;
  dynamicLeaderStrengthMinScore = 50;
} else if (marketValue >= 60) {
  // NORMAL장: 기존 유지
  dynamicLeaderMinFinalBuyScore = settings.leaderMinFinalBuyScore;
  dynamicLeaderStrengthMinScore = settings.leaderStrengthMinScore;
} else {
  // CAUTION/DANGER장: 더 엄격
  dynamicLeaderMinFinalBuyScore = 90;
  dynamicLeaderStrengthMinScore = 85;
}

if (finalScore.score < dynamicLeaderMinFinalBuyScore) {
  return {
    pass: false,
    finalScore,
    reason:
      `LEADER 최종점수 부족 ${finalScore.score} / 기준 ${dynamicLeaderMinFinalBuyScore} / ` +
      finalScore.reason
  };
}

const leaderStrengthScore = Number(
  item.leaderStrengthScore || getLeaderStrengthScore(item, price)
);

if (leaderStrengthScore < dynamicLeaderStrengthMinScore) {
  return {
    pass: false,
    finalScore,
    reason:
      `수급강도 부족 ${leaderStrengthScore} / 기준 ${dynamicLeaderStrengthMinScore}`
  };
}
  item.leaderStrengthScore = leaderStrengthScore;

  return {
    pass: true,
    finalScore,
    leaderStrengthScore,
    reason:
      `LEADER 판단 통과 / ` +
      `${finalScore.reason} / ` +
      `수급강도 ${leaderStrengthScore}`
  };
}

function paperLeaderBuy(state, item, currentPrice) {
  if (!settings.leaderEnabled) return false;

  if (isExcludedStock(item)) {
    console.log("[LEADER 매수제외] 제외종목", item.name || item.code);
    return false;
  }

  if (getLeaderHoldingCount(state) >= settings.leaderMaxHoldingCount) {
    console.log("[LEADER 매수제외] 최대 보유종목 도달");
    return false;
  }

  if (getTodayLeaderBuyCount(state) >= settings.leaderMaxDailyBuyCount) {
    console.log("[LEADER 매수제외] 하루 최대 진입 횟수 도달");
    return false;
  }

  if (isAlreadyHolding(state, item.code)) {
    console.log("[LEADER 매수제외] 이미 보유중", item.name);
    return false;
  }

  if (wasLeaderBoughtToday(state, item.code)) {
    console.log("[LEADER 매수제외] 오늘 이미 LEADER 매수", item.name);
    return false;
  }

  if (wasStoppedToday(state, item.code)) {
    console.log("[LEADER 매수제외] 오늘 손절 또는 손실 이력 있음", item.name || item.code);
    return false;
  }

  const price = Number(currentPrice || item.currentPrice || item.price || 0);
  if (!price || price <= 0) return false;

  const availableCash = Number(state.leaderCash || 0);

  const remainSlots = Math.max(
    1,
    settings.leaderMaxHoldingCount - getLeaderHoldingCount(state)
  );

  const budget = getBudgetInfo(state);

  const buyAmount = Math.min(
    budget.leaderPerBuyAmount,
    Math.floor(availableCash / remainSlots),
    availableCash
  );

  const qty = Math.floor(buyAmount / price);

  if (!Number.isFinite(buyAmount) || buyAmount <= 0 || !Number.isFinite(qty) || qty <= 0) {
    console.log("[LEADER 매수제외] 현금 또는 수량 부족", {
      name: item.name,
      code: item.code,
      price,
      buyAmount,
      availableCash,
      remainSlots,
      leaderPerBuyAmount: budget.leaderPerBuyAmount
    });
    return false;
  }

  const leaderStrengthScore = Number(item.leaderStrengthScore || 0);

  const holding = {
    code: item.code,
    name: item.name || item.stockName || item.korName || item.code,
    buyPrice: price,
    qty,
    buyAmount: price * qty,
    plannedBuyAmount: buyAmount,
    currentPrice: price,
    highestPrice: price,
    lowestPrice: price,
    maxProfitRate: 0,
    maxLossRate: 0,
    autoTrade: true,

    strategyGroup: "LEADER",
    strategyPreset: "leader",
    strategyName: "리더형",

    leaderStrengthScore,
    discoverScore: Number(item.discoverScore || 0),

    finalBuyScore: Number(item.finalBuyScore || 0),
    finalBuyScoreDetail: item.finalBuyScoreDetail || null,
    marketScore: state.marketScore || null,

    changeRate: Number(
      item.changeRate ||
      item.fluctuationRate ||
      item.riseRate ||
      item.rate ||
      0
    ),
    tradeVolumeRatio: getTradeVolumeRatio(item),
    dayPositionRate: getDayPositionRate(item, price),

    buyTime: nowText(),
    buyTimeMs: Date.now(),
    buyAt: new Date().toISOString(),
    date: todayKey()
  };

  state.holdings.push(holding);
  state.leaderCash = availableCash - price * qty;

  state.tradeLogs.push({
    type: "LEADER_BUY",
    strategyGroup: "LEADER",

    code: holding.code,
    name: holding.name,

    price,
    buyPrice: price,
    qty,

    buyAmount: price * qty,
    plannedBuyAmount: buyAmount,

    changeRate: holding.changeRate,
    tradeVolumeRatio: holding.tradeVolumeRatio,
    dayPositionRate: holding.dayPositionRate,
    volume: Number(item.volume || item.raw?.trde_qty || 0),

    marketTemperature: state.marketTemperature || null,
    remainLeaderCashAfterBuy: state.leaderCash,

    finalBuyScore: Number(item.finalBuyScore || 0),
    finalBuyScoreDetail: item.finalBuyScoreDetail || null,
    marketScore: state.marketScore || null,

    discoverScore: Number(item.discoverScore || 0),
    leaderStrengthScore,

    reason:
      `LEADER 주도주 스윙 자동 모의매수 / ` +
      `수급강도 ${leaderStrengthScore}`,

    date: todayKey(),
    time: nowText()
  });

  console.log(
    `[LEADER 매수] ${holding.name} ${holding.code} / ${price}원 / ${qty}주 / 예정 ${buyAmount.toLocaleString()}원 / 수급강도 ${leaderStrengthScore}`
  );

  return true;
}


function paperSell(state, holding, sellPrice, reason, actionType = "SELL", sellQtyInput = null) {
  if (!holding) return false;

  if (!state.sellKeys) {
    state.sellKeys = {};
  }

  const isPartialSell =
  actionType === "FIRST_TAKE_PROFIT" ||
  actionType === "TURBO_FIRST_TAKE_PROFIT" ||
  actionType === "EARLY_FIRST_TAKE_PROFIT";

  const sellKey = `${todayKey()}_${holding.code}_${actionType}`;

  if (!isPartialSell && state.sellKeys[sellKey]) {
    console.log(`[중복매도 차단] ${holding.name} ${holding.code} ${actionType}`);
    return false;
  }

  if (!isPartialSell) {
    state.sellKeys[sellKey] = nowText();
  }

  if (holding.sold || holding.selling) {
    return false;
  }

  const holdingQty = Number(holding.qty || 0);
  const price = Number(sellPrice || 0);
  const sellQty = sellQtyInput ? Number(sellQtyInput) : holdingQty;

  if (holdingQty <= 0 || price <= 0 || sellQty <= 0 || sellQty > holdingQty) {
    return false;
  }

  holding.selling = true;

  const buyPrice = Number(holding.buyPrice || 0);
  const buyAmount = buyPrice * sellQty;
  const sellAmount = price * sellQty;
  const profit = sellAmount - buyAmount;
  const profitRate = buyAmount > 0 ? (profit / buyAmount) * 100 : 0;

  state.tradeLogs.push({
    type: actionType,
    code: holding.code,
    name: holding.name,
    price,
    qty: sellQty,
    buyPrice,
    sellPrice: price,
    buyAmount,
    sellAmount,
    profit,
    profitRate,
    buyChangeRate: Number(holding.changeRate || 0),
    buyTradeVolumeRatio: Number(holding.tradeVolumeRatio || 0),
    buyDayPositionRate: Number(holding.dayPositionRate || 0),
    
    highestPrice: Number(holding.highestPrice || buyPrice || 0),
    lowestPrice: Number(holding.lowestPrice || buyPrice || 0),
    maxProfitRate: Number(holding.maxProfitRate || 0),
    maxLossRate: Number(holding.maxLossRate || 0),
    holdingMinutes: holding.buyTimeMs
    ? Math.round((Date.now() - Number(holding.buyTimeMs)) / 1000 / 60)
    : 0,
    buyTimeText: holding.buyTime || holding.buyTimeText || "",
    sellTimeText: nowText(),
    reason: reason || "서버 매도",
    strategyPreset: holding.strategyPreset,
    strategyName: holding.strategyName,
    strategyGroup: holding.strategyGroup || "CORE",
    sectorTags: holding.sectorTags || [],
    sectorPowerScore: Number(holding.sectorPowerScore || 0),

    finalBuyScore: Number(holding.finalBuyScore || 0),
    finalBuyScoreDetail: holding.finalBuyScoreDetail || null,
    marketScore: holding.marketScore || null,

    leaderStrengthScore: Number(holding.leaderStrengthScore || 0),

    date: todayKey(),
    time: nowText()
  });

if (holding.strategyGroup === "TURBO") {
  state.turboCash =
    Number(state.turboCash || 0) + sellAmount;

} else if (holding.strategyGroup === "LEADER") {
  state.leaderCash =
    Number(state.leaderCash || 0) + sellAmount;

} else {
  state.totalCash =
    Number(state.totalCash || 0) + sellAmount;
}

  if (sellQty < holdingQty) {
    holding.qty = holdingQty - sellQty;
    holding.selling = false;
    holding.sold = false;
    holding.firstTakeProfitDone = true;
    holding.firstTakeProfitPrice = price;
    holding.firstTakeProfitAt = new Date().toISOString();

    console.log(
      `[1차 수익실현] ${holding.name} ${sellQty}주 매도 / 잔여 ${holding.qty}주 / 수익률 ${profitRate.toFixed(2)}%`
    );

    return true;
  }

  holding.sold = true;
  holding.selling = false;

  state.holdings = state.holdings.filter((item) => item.code !== holding.code);

rebalanceCashIfNoHoldings(
  state,
  `전량매도 후 자동 60:20:20 재배분 · ${actionType}`
);


if (
  actionType === "TURBO_STOP_LOSS" &&
  getTurboConsecutiveLossCount(state) >= 2
) {
  state.turboBuyStopped = true;
  state.turboBuyStoppedAt = nowText();
  state.turboBuyStoppedReason =
    "Turbo 연속손절 2회 이상 → Turbo 신규매수만 중단";

  console.log(
    "[TURBO 매수중단] Turbo 연속손절 2회 이상 → Turbo만 중단, Core는 계속"
  );
}

initDailyLossLimitIfNeeded(state);

const todayProfitAfterSell = getTodayRealizedProfit(state);
const dailyLossLimit = Math.abs(Number(state.dailyLossLimit || 0));

if (
  dailyLossLimit > 0 &&
  todayProfitAfterSell <= -dailyLossLimit
) {
  state.dailyBuyStopped = true;
  state.dailyBuyStoppedAt = nowText();
  state.dailyBuyStoppedReason =
    `일일 손실한도 도달: ${todayProfitAfterSell.toLocaleString()}원 / 한도 ${dailyLossLimit.toLocaleString()}원`;

  console.log(
    `[일일 손실한도 도달] 오늘 실현손익 ${todayProfitAfterSell.toLocaleString()}원 ` +
    `/ 손실한도 ${dailyLossLimit.toLocaleString()}원 → 신규매수 중단`
  );
}

console.log(
  `[매도완료] ${holding.name} ${sellQty}주 / ${price}원 / 수익률 ${profitRate.toFixed(2)}% / ${actionType}`
);

return true;
}










async function checkServerAutoSellOnce() {
  if (isSellRunning) {
    console.log("[SELL] 다른 매도 로직 실행중이라 건너뜀");
    return;
  }

  isSellRunning = true;

  try {
    if (!isTradeTime()) {
      return;
    }

    const state = loadState();


  if (!state.serverAutoEnabled) {
    console.log("서버 자동매매 OFF 상태입니다.");
    return;
  }

  if (!state.holdings || state.holdings.length === 0) {
    return;
  }

  const remainHoldings = [];

  for (const holding of state.holdings) {
    try {
      const priceData = await fetchPrice(holding.code);
      const currentPrice = Number(priceData.currentPrice || 0);

      if (!currentPrice || currentPrice <= 0) {
        remainHoldings.push(holding);
        continue;
      }

      holding.currentPrice = currentPrice;

holding.highestPrice = Math.max(
  Number(holding.highestPrice || holding.buyPrice || currentPrice || 0),
  currentPrice
);

holding.lowestPrice = Math.min(
  Number(holding.lowestPrice || holding.buyPrice || currentPrice || 0),
  currentPrice
);

const buyPrice = Number(holding.buyPrice || 0);

const profitRate =
  buyPrice > 0
    ? ((currentPrice - buyPrice) / buyPrice) * 100
    : 0;

const currentMaxProfitRate =
  buyPrice > 0
    ? ((Number(holding.highestPrice || currentPrice) - buyPrice) / buyPrice) * 100
    : 0;

const currentMaxLossRate =
  buyPrice > 0
    ? ((Number(holding.lowestPrice || currentPrice) - buyPrice) / buyPrice) * 100
    : 0;

holding.maxProfitRate = Math.max(
  Number(holding.maxProfitRate || 0),
  currentMaxProfitRate
);

holding.maxLossRate = Math.min(
  Number(holding.maxLossRate || 0),
  currentMaxLossRate
);



const abnormalPrice =
  buyPrice > 0 &&
  (
    currentPrice >= buyPrice * 1.5 ||
    currentPrice <= buyPrice * 0.5
  );

if (abnormalPrice) {
  console.warn(
    `[가격이상 감지] ${holding.name}(${holding.code}) ` +
    `매수가 ${buyPrice} / 현재가 ${currentPrice} / 수익률 ${profitRate.toFixed(2)}%`
  );

  remainHoldings.push(holding);
  continue;
}

      const trailingDropRate =
        Number(holding.highestPrice || 0) > 0
          ? ((currentPrice - Number(holding.highestPrice)) /
              Number(holding.highestPrice)) *
            100
          : 0;

      const buyTimeMs =
        Number(holding.buyTimeMs || 0) ||
        (holding.buyAt ? new Date(holding.buyAt).getTime() : 0);


const protectMinutes =
  Number(holding.protectMinutes || 5);

      const protectUntil =
        buyTimeMs + protectMinutes * 60 * 1000;

      const isProtected =
        buyTimeMs > 0 && Date.now() < protectUntil;

      const isCrash = profitRate <= -2.5;

      if (isProtected) {
        console.log(
          `[보호시간] ${holding.name} ${protectMinutes}분 보호중 · 수익률 ${profitRate.toFixed(2)}%`
        );
      }








const maxProfitRate =
  buyPrice > 0
    ? ((Number(holding.highestPrice || currentPrice) - buyPrice) / buyPrice) * 100
    : 0;

    if (holding.strategyGroup === "EARLY") {
  if (
    maxProfitRate >= settings.earlyTrailingStartRate &&
    !holding.earlyTrailingActive
  ) {
    holding.earlyTrailingActive = true;
    holding.earlyTrailingStartPrice = currentPrice;

    console.log(
      `[EARLY 트레일링 시작] ${holding.name} / 최고수익 ${maxProfitRate.toFixed(2)}%`
    );
  }

  if (profitRate <= settings.earlyStopLossRate) {
    paperSell(
      state,
      holding,
      currentPrice,
      `EARLY 손절 ${profitRate.toFixed(2)}%`,
      "EARLY_STOP_LOSS"
    );
    continue;
  }

  if (
    !holding.earlyFirstTakeProfitDone &&
    profitRate >= settings.earlyTakeProfitRate &&
    Number(holding.qty || 0) >= 2
  ) {
    const sellQty = Math.floor(
      Number(holding.qty || 0) * settings.earlyTakeProfitSellRatio
    );

    if (sellQty >= 1) {
      paperSell(
        state,
        holding,
        currentPrice,
        `EARLY 1차 익절 ${profitRate.toFixed(2)}% · ${sellQty}주 매도`,
        "EARLY_FIRST_TAKE_PROFIT",
        sellQty
      );

      holding.earlyFirstTakeProfitDone = true;
      holding.earlyTrailingActive = true;
      remainHoldings.push(holding);
      continue;
    }
  }

  if (
    holding.earlyTrailingActive &&
    trailingDropRate <= -settings.earlyTrailingStopRate &&
    profitRate > 0
  ) {
    paperSell(
      state,
      holding,
      currentPrice,
      `EARLY 트레일링 매도 · 최고가 대비 ${settings.earlyTrailingStopRate}% 하락`,
      "EARLY_TRAILING_STOP"
    );
    continue;
  }

  remainHoldings.push(holding);
  continue;
}

    if (holding.strategyGroup === "TURBO") {
  if (
    maxProfitRate >= settings.turboTrailingStartRate &&
    !holding.turboTrailingActive
  ) {
    holding.turboTrailingActive = true;
    holding.turboTrailingStartPrice = currentPrice;

    console.log(
      `[TURBO 트레일링 시작] ${holding.name} / 최고수익 ${maxProfitRate.toFixed(2)}%`
    );
  }

  if (profitRate <= settings.turboStopLossRate) {
    paperSell(
      state,
      holding,
      currentPrice,
      `Turbo 손절 ${profitRate.toFixed(2)}%`,
      "TURBO_STOP_LOSS"
    );
    continue;
  }

  if (
  !holding.turboFirstTakeProfitDone &&
  profitRate >= settings.turboTakeProfitRate &&
  Number(holding.qty || 0) >= 2
) {
  const sellQty = Math.floor(
    Number(holding.qty || 0) * settings.turboTakeProfitSellRatio
  );

  if (sellQty >= 1) {
    paperSell(
      state,
      holding,
      currentPrice,
      `Turbo 1차 익절 ${profitRate.toFixed(2)}% · ${sellQty}주 매도`,
      "TURBO_FIRST_TAKE_PROFIT",
      sellQty
    );

    holding.turboFirstTakeProfitDone = true;
    holding.turboTrailingActive = true;
    remainHoldings.push(holding);
    continue;
  }
}

  if (
    holding.turboTrailingActive &&
    trailingDropRate <= -settings.turboTrailingStopRate &&
    profitRate > 0
  ) {
    paperSell(
      state,
      holding,
      currentPrice,
      `Turbo 트레일링 매도 · 최고가 대비 ${settings.turboTrailingStopRate}% 하락`,
      "TURBO_TRAILING_STOP"
    );
    continue;
  }

  if (isBetweenTime(settings.turboForceSellTime, "15:20")) {
    paperSell(
      state,
      holding,
      currentPrice,
      `Turbo 시간청산 ${settings.turboForceSellTime}`,
      "TURBO_TIME_EXIT"
    );
    continue;
  }

  remainHoldings.push(holding);
  continue;
}

if (holding.strategyGroup === "LEADER") {
  const holdDays = Math.floor(
    (Date.now() - Number(holding.buyTimeMs || 0)) / 1000 / 60 / 60 / 24
  );

  if (profitRate <= settings.leaderStopLossRate) {
    paperSell(
      state,
      holding,
      currentPrice,
      `LEADER 손절 ${profitRate.toFixed(2)}%`,
      "LEADER_STOP_LOSS"
    );
    continue;
  }

  if (holdDays < settings.leaderMinHoldDays) {
    remainHoldings.push(holding);
    continue;
  }

  if (profitRate >= settings.leaderTakeProfitRate) {
    paperSell(
      state,
      holding,
      currentPrice,
      `LEADER 목표수익 ${profitRate.toFixed(2)}%`,
      "LEADER_TAKE_PROFIT"
    );
    continue;
  }

  if (
    maxProfitRate >= settings.leaderTrailingStartRate &&
    trailingDropRate <= -settings.leaderTrailingStopRate &&
    profitRate > 0
  ) {
    paperSell(
      state,
      holding,
      currentPrice,
      `LEADER 트레일링 매도 · 최고가 대비 ${settings.leaderTrailingStopRate}% 하락`,
      "LEADER_TRAILING_STOP"
    );
    continue;
  }

  if (holdDays >= settings.leaderMaxHoldDays && profitRate > 0) {
    paperSell(
      state,
      holding,
      currentPrice,
      `LEADER 최대보유 ${settings.leaderMaxHoldDays}일 수익 정리`,
      "LEADER_TIME_EXIT"
    );
    continue;
  }

  remainHoldings.push(holding);
  continue;
}

if (maxProfitRate >= settings.breakEvenTriggerRate) {
  holding.breakEvenActivated = true;
}

if (
  holding.breakEvenActivated &&
  profitRate <= settings.breakEvenSellRate &&
  profitRate >= 0 &&
  !isProtected
) {
  paperSell(
    state,
    holding,
    currentPrice,
    `본절보호 매도 · 최고수익 ${maxProfitRate.toFixed(2)}% 후 ${profitRate.toFixed(2)}%까지 하락`,
    "BREAK_EVEN_PROTECT"
  );
  continue;
}

const holdingQty = Number(holding.qty || 0);

if (
  !holding.firstTakeProfitDone &&
  profitRate >= settings.firstTakeProfitRate &&
  holdingQty >= 2 &&
  !isProtected
) {
  const sellQty = Math.floor(holdingQty * settings.firstTakeProfitSellRatio);

  if (sellQty >= 1 && holdingQty - sellQty >= settings.firstTakeProfitMinRemainQty) {
    const firstSold = paperSell(
      state,
      holding,
      currentPrice,
      `1차 수익실현 ${profitRate.toFixed(2)}% · ${sellQty}주 매도`,
      "FIRST_TAKE_PROFIT",
      sellQty
    );

    if (firstSold) {
      holding.trailingActive = true;
      holding.targetTouched = true;
      holding.trailingStartPrice = currentPrice;
      remainHoldings.push(holding);
      continue;
    }
  }
}

if (
  isTradeTime() &&
  isAfterEndProfitSellTime() &&
  settings.endProfitSellOnlyPositive &&
  profitRate > 0
) {
  paperSell(
    state,
    holding,
    currentPrice,
    `장종료 전 수익 정리 ${profitRate.toFixed(2)}%`,
    "END_PROFIT_SELL"
  );
  continue;
}

if (
  isTradeTime() &&
  isAfterEndProfitSellTime() &&
  profitRate < 0 &&
  maxProfitRate < 2
) {
  paperSell(
    state,
    holding,
    currentPrice,
    `장종료 전 손실종목 정리 · 현재 ${profitRate.toFixed(2)}% / 최고 ${maxProfitRate.toFixed(2)}%`,
    "END_WEAK_SELL"
  );
  continue;
}



      if (
        profitRate >= settings.trailingStartRate && 
        !holding.trailingActive
      ) {
        holding.trailingActive = true;
        holding.targetTouched = true;
        holding.trailingStartPrice = currentPrice;

        console.log(
          `[트레일링 시작] ${holding.name} ` +
          `수익률 ${profitRate.toFixed(2)}% / ` +
          `현재가 ${currentPrice} / ` +
          `최고가 ${holding.highestPrice}`
        );
      }



if (profitRate >= 28) {
  paperSell(
    state,
    holding,
    currentPrice,
    "상한가 근처 수익실현",
    "TAKE_PROFIT"
  );
  continue;
}

const isRunnerCandidate =
  Number(holding.discoverScore || 0) >= 10;

const activeStopLossRate =
  isRunnerCandidate ? -2.5 : settings.stopLossRate;

if (
  profitRate <= activeStopLossRate &&
  (!isProtected || isCrash)
) {
  paperSell(
    state,
    holding,
    currentPrice,
    isCrash
      ? `급락 손절 ${profitRate.toFixed(2)}%`
      : `손절 ${activeStopLossRate}% 도달`,




        "STOP_LOSS"
        );
        continue;
      }

if (
  holding.trailingActive &&
  profitRate <= 0.3 &&
  !isProtected
) {
  paperSell(
    state,
    holding,
    currentPrice,
    "트레일링 본전 보호",
    "TRAILING_STOP"
  );
  continue;
}

// 고수익 구간 정체 매도
if (profitRate >= 5) {
  if (!holding.highProfitReachedAt) {
    holding.highProfitReachedAt = Date.now();
    holding.highProfitBaseRate = maxProfitRate;
    holding.highProfitBasePrice = currentPrice;
  }

  // 최고수익률을 0.5%p 이상 새로 갱신하면 정체 타이머 리셋
  if (maxProfitRate >= Number(holding.highProfitBaseRate || 0) + 0.5) {
    holding.highProfitReachedAt = Date.now();
    holding.highProfitBaseRate = maxProfitRate;
    holding.highProfitBasePrice = currentPrice;
  }

  const stagnantMinutes =
    (Date.now() - Number(holding.highProfitReachedAt || 0)) / 1000 / 60;

  const baseRate = Number(holding.highProfitBaseRate || maxProfitRate || 0);

  const stillHighProfit =
    baseRate > 0 && profitRate >= baseRate * 0.9;

  const noStrongNewHigh =
    maxProfitRate < baseRate + 0.5;

  if (
    stagnantMinutes >= 15 &&
    stillHighProfit &&
    noStrongNewHigh &&
    !isProtected
  ) {
    paperSell(
      state,
      holding,
      currentPrice,
      `고수익 정체 매도 · 최고수익 ${baseRate.toFixed(2)}% 부근 ${stagnantMinutes.toFixed(0)}분 정체 / 현재 ${profitRate.toFixed(2)}%`,
      "HIGH_PROFIT_STAGNANT_SELL"
    );
    continue;
  }
}

let dynamicTrailingRate = settings.trailingStopRate;

if (maxProfitRate >= 8) {
  dynamicTrailingRate = 2.5;
} else if (maxProfitRate >= 5) {
  dynamicTrailingRate = 1.8;
} else if (maxProfitRate >= 3) {
  dynamicTrailingRate = 1.2;
}






if (
  holding.trailingActive &&
  holding.highestPrice > holding.buyPrice &&
  profitRate > 0.5 &&
  trailingDropRate <= -dynamicTrailingRate &&
  !isProtected
) {
  paperSell(
    state,
    holding,
    currentPrice,
    `트레일링 매도 · 최고가 대비 ${dynamicTrailingRate}% 하락`,
    "TRAILING_STOP"
  );
  continue;
}
      remainHoldings.push(holding);
    } catch (error) {
      console.warn(
        "자동매도 감시 실패:",
        holding.code,
        error.message
      );
      remainHoldings.push(holding);
    }
  }

     state.holdings = remainHoldings;
    state.lastSellCheckAt = nowText();

    saveState(state);
  } finally {
    isSellRunning = false;
  }
}

function isPullbackReboundCandidate(item) {
  const currentPrice = Number(item.currentPrice || item.price || 0);
  const openPrice = Number(item.open || item.openPrice || 0);
  const highPrice = Number(item.high || item.highPrice || 0);
  const lowPrice = Number(item.low || item.lowPrice || 0);

  if (!currentPrice || !openPrice || !highPrice || !lowPrice) {
    return {
      pass: false,
      reason: "시가/고가/저가/현재가 부족"
    };
  }

  const firstRiseRate =
    ((highPrice - openPrice) / openPrice) * 100;

  const pullbackRate =
    ((highPrice - currentPrice) / highPrice) * 100;

  const reboundFromLowRate =
    ((currentPrice - lowPrice) / lowPrice) * 100;

  const openPositionRate =
    ((currentPrice - openPrice) / openPrice) * 100;

  const pass =
    firstRiseRate >= 2.5 &&
    firstRiseRate <= 12 &&
    pullbackRate >= 1.0 &&
    pullbackRate <= 3.0 &&
    reboundFromLowRate >= 1.0 &&
    currentPrice > openPrice;

  return {
    pass,
    firstRiseRate,
    pullbackRate,
    reboundFromLowRate,
    openPositionRate,
    reason: pass
      ? "눌림목 재상승 조건 통과"
      : `눌림목 미충족 · 1차상승 ${firstRiseRate.toFixed(2)}% / 고점대비 ${pullbackRate.toFixed(2)}% / 저점반등 ${reboundFromLowRate.toFixed(2)}% / 시가대비 ${openPositionRate.toFixed(2)}%`
  };
}

function calculateMarketTemperature(candidates = []) {
  const list = Array.isArray(candidates) ? candidates : [];

  const valid = list
    .map((item) => {
      const rate = Number(
        item.changeRate ??
        item.changeRatePercent ??
        item.fluctuationRate ??
        item.riseRate ??
        item.rate ??
        item.raw?.flu_rt ??
        0
      );

      return { ...item, rate };
    })
    .filter((item) => Number.isFinite(item.rate));

  const total = valid.length;

  if (total === 0) {
    return {
      level: "NORMAL",
      label: "보통",
      advanceRatio: 0,
      avgChangeRate: 0,
      strongRatio: 0,
      dangerRatio: 0,
      upCount: 0,
      strongCount: 0,
      dangerCount: 0,
      total: 0,
      reason: "시장온도 계산 데이터 없음",
      checkedAt: nowText()
    };
  }

  const upCount = valid.filter((item) => item.rate > 0).length;
  const strongCount = valid.filter((item) => item.rate >= 2.0).length;
  const dangerCount = valid.filter((item) => item.rate <= -2.0).length;

  const advanceRatio = (upCount / total) * 100;
  const strongRatio = (strongCount / total) * 100;
  const dangerRatio = (dangerCount / total) * 100;
  const avgChangeRate =
    valid.reduce((sum, item) => sum + item.rate, 0) / total;

  const reason =
    `상승 ${advanceRatio.toFixed(1)}% / ` +
    `평균 ${avgChangeRate.toFixed(2)}% / ` +
    `강한종목 ${strongRatio.toFixed(1)}% / ` +
    `약세 ${dangerRatio.toFixed(1)}%`;

  if (
    advanceRatio >= 75 &&
    avgChangeRate >= 1.2 &&
    strongRatio >= 20 &&
    dangerRatio <= 15
  ) {
    return {
      level: "HOT",
      label: "매우 좋음",
      advanceRatio: Number(advanceRatio.toFixed(1)),
      avgChangeRate: Number(avgChangeRate.toFixed(2)),
      strongRatio: Number(strongRatio.toFixed(1)),
      dangerRatio: Number(dangerRatio.toFixed(1)),
      upCount,
      strongCount,
      dangerCount,
      total,
      reason,
      checkedAt: nowText()
    };
  }

  if (
    advanceRatio >= 60 &&
    avgChangeRate >= 0.5 &&
    strongRatio >= 10 &&
    dangerRatio <= 25
  ) {
    return {
      level: "NORMAL",
      label: "보통",
      advanceRatio: Number(advanceRatio.toFixed(1)),
      avgChangeRate: Number(avgChangeRate.toFixed(2)),
      strongRatio: Number(strongRatio.toFixed(1)),
      dangerRatio: Number(dangerRatio.toFixed(1)),
      upCount,
      strongCount,
      dangerCount,
      total,
      reason,
      checkedAt: nowText()
    };
  }

  if (
    advanceRatio < 45 ||
    avgChangeRate < 0 ||
    dangerRatio >= 30
  ) {
    return {
      level: "DANGER",
      label: "위험",
      advanceRatio: Number(advanceRatio.toFixed(1)),
      avgChangeRate: Number(avgChangeRate.toFixed(2)),
      strongRatio: Number(strongRatio.toFixed(1)),
      dangerRatio: Number(dangerRatio.toFixed(1)),
      upCount,
      strongCount,
      dangerCount,
      total,
      reason,
      checkedAt: nowText()
    };
  }

  return {
    level: "CAUTION",
    label: "주의",
    advanceRatio: Number(advanceRatio.toFixed(1)),
    avgChangeRate: Number(avgChangeRate.toFixed(2)),
    strongRatio: Number(strongRatio.toFixed(1)),
    dangerRatio: Number(dangerRatio.toFixed(1)),
    upCount,
    strongCount,
    dangerCount,
    total,
    reason,
    checkedAt: nowText()
  };
}

function calculateMarketScore(candidates = [], leadingSectors = []) {
  const temp = calculateMarketTemperature(candidates);

  let score = 0;

  const advanceRatio = Number(temp.advanceRatio || 0);
  const avgChangeRate = Number(temp.avgChangeRate || 0);
  const strongRatio = Number(temp.strongRatio || 0);
  const dangerRatio = Number(temp.dangerRatio || 0);

  // 상승종목비율
  if (advanceRatio >= 75) score += 25;
  else if (advanceRatio >= 60) score += 18;
  else if (advanceRatio >= 45) score += 10;
  else score += 0;

  // 평균등락률
  if (avgChangeRate >= 1.2) score += 25;
  else if (avgChangeRate >= 0.5) score += 18;
  else if (avgChangeRate >= 0) score += 10;
  else score -= 10;

  // 강한 종목 비율
  if (strongRatio >= 20) score += 20;
  else if (strongRatio >= 10) score += 12;
  else if (strongRatio >= 5) score += 6;

  // 위험 종목 비율
  if (dangerRatio <= 10) score += 15;
  else if (dangerRatio <= 20) score += 8;
  else if (dangerRatio >= 30) score -= 15;

  // 주도섹터 존재 여부
  if (leadingSectors.length >= 3) score += 15;
  else if (leadingSectors.length >= 2) score += 10;
  else if (leadingSectors.length >= 1) score += 5;

  score = Math.max(0, Math.min(100, Math.round(score)));

  let level = "NORMAL";
  if (score >= 75) level = "HOT";
  else if (score >= 55) level = "NORMAL";
  else if (score >= 40) level = "CAUTION";
  else level = "DANGER";

  return {
    score,
    level,
    marketTemperature: temp,
    leadingSectors,
    reason:
      `MarketScore ${score} / ` +
      `상승 ${advanceRatio.toFixed(1)}% / ` +
      `평균 ${avgChangeRate.toFixed(2)}% / ` +
      `강한종목 ${strongRatio.toFixed(1)}% / ` +
      `약세 ${dangerRatio.toFixed(1)}% / ` +
      `주도섹터 ${leadingSectors.join(", ") || "없음"}`
  };
}

function makeBuyDiagnosis(strategy, item, detail = {}) {
  const parts = [];

  parts.push(`${strategy}`);
  parts.push(item.name || item.stockName || item.korName || item.code);
  parts.push(item.code || "");

  if (typeof detail.finalBuyScore !== "undefined") {
    parts.push(`Final ${detail.finalBuyScore}`);
  }

  if (detail.marketScore) {
    parts.push(`Market ${detail.marketScore.score}`);
  }

  if (item.sectorTags && item.sectorTags.length > 0) {
    parts.push(`Sector ${item.sectorTags.join(",")}`);
  }

  if (typeof item.sectorPowerScore !== "undefined") {
    parts.push(`SectorScore ${item.sectorPowerScore}`);
  }

  if (typeof item.leaderStrengthScore !== "undefined") {
    parts.push(`LeaderStrength ${item.leaderStrengthScore}`);
  }

  if (detail.reason) {
    parts.push(detail.reason);
  }

  return parts.filter(Boolean).join(" / ");
}

function logBuyPass(strategy, item, detail = {}) {
  console.log(`[${strategy} 매수통과] ${makeBuyDiagnosis(strategy, item, detail)}`);
}

function logBuyReject(strategy, item, reason, detail = {}) {
  console.log(
    `[${strategy} 매수제외] ${makeBuyDiagnosis(strategy, item, {
      ...detail,
      reason
    })}`
  );
}

function calculateFinalBuyScore(item = {}, currentPrice = 0, marketScore = null) {
  const discoverScore = Number(item.discoverScore || 0);
  const sectorPowerScore = Number(item.sectorPowerScore || getSectorPowerScore(item).score || 0);

  const changeRate = Number(
    item.changeRate ||
    item.fluctuationRate ||
    item.riseRate ||
    item.rate ||
    item.raw?.flu_rt ||
    0
  );

  const tradeVolumeRatio = getTradeVolumeRatio(item);
  const dayPositionRate = getDayPositionRate(item, currentPrice);

  const openPrice = Math.abs(Number(
    item.open ||
    item.openPrice ||
    item.raw?.open_pric ||
    0
  ));

  const openPositionRate =
    openPrice > 0 && currentPrice > 0
      ? ((currentPrice - openPrice) / openPrice) * 100
      : 0;

  let score = 0;

  score += Math.min(30, discoverScore * 2);

  if (openPositionRate >= 3) score += 15;
  else if (openPositionRate >= 2) score += 12;
  else if (openPositionRate >= 1) score += 6;

  if (tradeVolumeRatio >= 200) score += 20;
  else if (tradeVolumeRatio >= 120) score += 15;
  else if (tradeVolumeRatio >= 80) score += 10;

  if (dayPositionRate >= 60 && dayPositionRate <= 75) score += 15;
  else if (dayPositionRate >= 50 && dayPositionRate <= 85) score += 8;

  if (sectorPowerScore >= 4) score += 10;
  else if (sectorPowerScore >= 2) score += 6;

  if (marketScore && Number(marketScore.score || 0) >= 75) score += 10;
  else if (marketScore && Number(marketScore.score || 0) >= 55) score += 6;
  else if (marketScore && Number(marketScore.score || 0) < 40) score -= 10;

  if (changeRate > 7) score -= 10;

  score = Math.max(0, Math.min(100, Math.round(score)));

  return {
    score,
    discoverScore,
    openPositionRate,
    tradeVolumeRatio,
    dayPositionRate,
    sectorPowerScore,
    marketScore: marketScore ? Number(marketScore.score || 0) : 0,
    reason:
      `FinalScore ${score} / ` +
      `발견 ${discoverScore} / ` +
      `시가대비 ${openPositionRate.toFixed(2)}% / ` +
      `거래량 ${tradeVolumeRatio.toFixed(1)}% / ` +
      `당일위치 ${dayPositionRate.toFixed(1)}% / ` +
      `섹터 ${sectorPowerScore} / ` +
      `시장 ${marketScore ? marketScore.score : 0}`
  };
}

function isAttackBuyBlockedByMarket(marketTemperature) {
  if (!marketTemperature) return true;

  if (
    marketTemperature.level === "DANGER" ||
    marketTemperature.level === "COLD" ||
    marketTemperature.level === "CAUTION"
  ) {
    return true;
  }

  if (
    Number(marketTemperature.avgChangeRate || 0) < 1.0 ||
    Number(marketTemperature.strongRatio || 0) < 15
  ) {
    return true;
  }

  return false;
}

async function runServerAutoBuyOnce() {
  if (!isBetweenTime(settings.buyStartTime, settings.buyEndTime)) {
  console.log(
    `신규매수 시간 아님: ${settings.buyStartTime}~${settings.buyEndTime}`
  );
  return {
    ok: false,
    message: "신규매수 가능 시간이 아닙니다.",
  };
}

  if (isRunning) return;

  if (!isTradeTime()) {
    console.log("[자동매수 차단] 거래 가능 시간이 아닙니다.");
    return;
  }

  isRunning = true;

  try {

    if (!isTradeTime()) {
      console.log("거래 가능 시간이 아닙니다.");
      return;
    }

const state = loadState();


if (!state.serverAutoEnabled) {
  console.log("서버 자동매매 OFF 상태입니다. 자동매수를 실행하지 않습니다.");
  return;
}

state.lastBuyCheckAt = nowText();
saveState(state);


initDailyLossLimitIfNeeded(state);
saveState(state);

if (isDailyLossLimitReached(state)) {
  state.dailyBuyStopped = true;
  saveState(state);

  const todayProfit = getTodayRealizedProfit(state);

  console.log(
    `[일일 손실 제한] 오늘 실현손익 ${todayProfit.toLocaleString()}원 / 손실한도 ${Number(state.dailyLossLimit || 0).toLocaleString()}원 도달. 신규매수를 중단합니다.`
  );

  return {
    ok: false,
    message: "일일 손실한도 도달로 신규매수 중단"
  };
}

if (state.dailyBuyStopped) {
  console.log("[일일 손실 제한] 오늘 신규매수 중단 상태입니다.");
  return {
    ok: false,
    message: "일일 손실한도 도달로 신규매수 중단 상태"
  };
}

    if (isConsecutiveLossLimitReached(state)) {
      console.log(
        `[연속 손실 제한] 최근 손실 거래가 ${settings.maxConsecutiveLoss}회 연속 발생했습니다. 자동매수를 중단합니다.`
      );
      return;
    }

    if (isBuyCooldownActive(state)) {
      console.log(
        `[자동매수 대기] 최근 자동매수 실행 후 ${settings.buyCooldownMinutes}분이 지나지 않았습니다.`
      );
      return;
    }

    const slots = getAvailableSlots(state);

    if (slots <= 0) {
      console.log("보유 가능 종목 수 초과");
      return;
    }

   if (getTurboConsecutiveLossCount(state) >= 2) {
  console.log(
    "[TURBO 매수중단] Turbo 연속손절 2회 이상 발생 → 오늘 Turbo 신규매수만 중단"
  );

  state.turboBuyStopped = true;
  saveState(state);
}


    let candidates = await discoverCandidates();

    let marketTemperature = calculateMarketTemperature(candidates);
marketTemperature = normalizeMarketTemperature(
  marketTemperature,
  "시장온도 계산값이 오늘 데이터가 아니어서 NORMAL 처리"
);

    if (marketTemperature.total < 20) {
  marketTemperature.level = "NORMAL";
  marketTemperature.label = "보통";
  marketTemperature.reason =
    `${marketTemperature.reason} / 표본 ${marketTemperature.total}개로 부족하여 NORMAL 처리`;
}

state.marketTemperature = {
  ...marketTemperature,
  checkedAt: marketTemperature.checkedAt || nowText(),
  checkedDate: todayKey()
};

console.log(
  `[시장온도] ${marketTemperature.label} / ` +
  `${marketTemperature.reason} / ` +
  `대상 ${marketTemperature.total}개`
);

if (marketTemperature.level === "DANGER") {
  saveState(state);

  return {
    ok: false,
    message: "시장온도 위험으로 신규매수 중단",
    marketTemperature
  };
}

const budget = getBudgetInfo(state);

const buyRules = {
  minScore: Number(settings.minScore || 10),
  perBuyAmount: Number(budget.corePerBuyAmount || 10000000),
  maxHoldingCount: Math.min(
    Number(settings.coreMaxHoldingCount || 6),
    getTimeBasedMaxHolding()
  )
};

if (marketTemperature.level === "CAUTION") {
  buyRules.minScore = Math.max(buyRules.minScore, 10);
  buyRules.perBuyAmount = Math.floor(buyRules.perBuyAmount * 0.5);
  buyRules.maxHoldingCount = Math.min(buyRules.maxHoldingCount, 5);

  const beforeCount = candidates.length;

  candidates = candidates.filter((item) => {
    return Number(item.discoverScore || 0) >= buyRules.minScore;
  });

  console.log(
    `[시장온도 주의] 매수조건 강화: ` +
    `minScore=${buyRules.minScore}, ` +
    `perBuyAmount=${buyRules.perBuyAmount}, ` +
    `maxHoldingCount=${buyRules.maxHoldingCount} / ` +
    `후보 ${beforeCount}개 → ${candidates.length}개`
  );
}

if (marketTemperature.level === "HOT") {
  buyRules.minScore = Math.min(buyRules.minScore, 8);
  buyRules.maxHoldingCount = Math.max(buyRules.maxHoldingCount, 6);

  const beforeCount = candidates.length;

  candidates = candidates.filter((item) => {
    return Number(item.discoverScore || 0) >= buyRules.minScore;
  });

  console.log(
    `[시장온도 HOT] 매수조건 완화: ` +
    `minScore=${buyRules.minScore}, ` +
    `maxHoldingCount=${buyRules.maxHoldingCount} / ` +
    `후보 ${beforeCount}개 → ${candidates.length}개`
  );
}

if (settings.leaderCoreEnabled) {
  const beforeLeaderCoreCount = candidates.length;

  const isLeaderCoreTime = isBetweenTime("09:20", "10:30");

  const leaderCandidates = candidates.filter((item) =>
    isLeaderCoreCandidate(item, marketTemperature)
  );

  if (isLeaderCoreTime) {
    candidates = leaderCandidates;

    buyRules.minScore = Math.max(
      buyRules.minScore,
      settings.leaderCoreMinScore
    );

    buyRules.maxHoldingCount = Math.min(
      buyRules.maxHoldingCount,
      settings.leaderCoreMaxHoldingCount
    );

    buyRules.perBuyAmount =
  budget.corePerBuyAmount;

    state.currentCoreMode = "LEADER_CORE_ONLY";

    console.log(
      `[LEADER CORE 전용시간] 09:20~10:30 / ` +
      `minScore=${buyRules.minScore}, ` +
      `perBuyAmount=${buyRules.perBuyAmount}, ` +
      `maxHoldingCount=${buyRules.maxHoldingCount} / ` +
      `후보 ${beforeLeaderCoreCount}개 → ${candidates.length}개`
    );
  } else if (leaderCandidates.length > 0) {
    candidates = leaderCandidates;

    buyRules.minScore = Math.max(
      buyRules.minScore,
      settings.leaderCoreMinScore
    );

    buyRules.maxHoldingCount = Math.min(
      buyRules.maxHoldingCount,
      settings.leaderCoreMaxHoldingCount
    );

    buyRules.perBuyAmount = budget.corePerBuyAmount;

    state.currentCoreMode = "LEADER_CORE";

    console.log(
      `[LEADER CORE 우선] 10:30 이후에도 대장주 후보 존재 / ` +
      `후보 ${beforeLeaderCoreCount}개 → ${candidates.length}개`
    );
  } else {
    buyRules.minScore = Math.max(buyRules.minScore, 10);

    state.currentCoreMode = "CORE_BACKUP";

    console.log(
      `[CORE 백업모드] 10:30 이후 Leader Core 후보 없음 / ` +
      `일반 Core 점수 ${buyRules.minScore} 이상으로 진행 / ` +
      `후보 ${beforeLeaderCoreCount}개 유지`
    );
  }
}


    if (!candidates || candidates.length === 0) {
      console.log("자동매수 후보가 없습니다.");
      return;
    }

    for (const item of candidates.slice(0, 30)) {
  if (getCoreHoldingCount(state) >= buyRules.maxHoldingCount) {
    console.log(`[시장온도 기준] Core 최대 보유 ${buyRules.maxHoldingCount}개 도달`);
    break;
  }


if (isAlreadyHolding(state, item.code)) {
  console.log(
    `[매수제외] ${item.name} ${item.code} / 이미 보유중`
  );
  continue;
}



      if (isRecentlySold(state, item.code)) {
        

console.log(
  `[매수제외] ${item.name} ${item.code} / 당일 재매수 금지`
);

        continue;
      }

      let priceData = null;
      let currentPrice = 0;

      try {
        priceData = await fetchPrice(item.code);

        currentPrice = Number(
          priceData.currentPrice ||
          priceData.price ||
          item.currentPrice ||
          item.price ||
          0
        );
      } catch (err) {
  console.log(
    `[현재가 조회 실패 - 건너뜀] ${item.name} ${item.code} / ${err.message}`
  );
  continue;
}

      if (!currentPrice || currentPrice <= 0) {
        console.log(`[매수제외] ${item.name} ${item.code} / 현재가 없음`);
        continue;
      }

const isMorningEntry = isBetweenTime("09:20", "09:40");

if (!isMorningEntry) {
  const pullbackCheck = isPullbackReboundCandidate({
    ...item,
    currentPrice
  });

  if (!pullbackCheck.pass) {
    console.log(
      `[매수제외] ${item.name} ${item.code} / ${pullbackCheck.reason}`
    );
    continue;
  }

  console.log(
    `[눌림목 통과] ${item.name} ${item.code} / ` +
    `1차상승 ${pullbackCheck.firstRiseRate.toFixed(2)}% / ` +
    `고점대비 ${pullbackCheck.pullbackRate.toFixed(2)}% / ` +
    `저점반등 ${pullbackCheck.reboundFromLowRate.toFixed(2)}%`
  );
} else {
  console.log(
    `[장초반 매수모드] ${item.name} ${item.code} / 눌림목 조건 생략`
  );
}


      let bestStrategy = null;

      try {
        bestStrategy = await findBestStrategy(item.code);
      } catch (err) {
        console.warn(`[백테스트 실패] ${item.name} ${item.code} / ${err.message}`);
      }

if (!bestStrategy || Number(bestStrategy.profitRate || 0) < 6) {
  console.log(
    `[매수제외] ${item.name} ${item.code} / 백테스트 수익률 부족 ${
      bestStrategy
        ? Number(bestStrategy.profitRate || 0).toFixed(2)
        : "없음"
    }%`
  );
  continue;
}

if (isStrategyBlocked(state, bestStrategy.key || bestStrategy.strategyPreset)) {
  console.log(
    `[매수제외] ${item.name} ${item.code} / 전략 성과 부진 ${bestStrategy.name || bestStrategy.strategyName || bestStrategy.key}`
  );
  continue;
}

if (Number(bestStrategy.tradeCount || 0) < 2) {
  console.log(
    `[매수제외] ${item.name} ${item.code} / 백테스트 거래횟수 부족 ${bestStrategy.tradeCount}회`
  );
  continue;
}

const strategyPreset = bestStrategy.key;
const discoverScore = Number(item.discoverScore || 0);

if (strategyPreset === "safe" && discoverScore < settings.safeMinScore) {
  console.log(
    `[매수제외] ${item.name} ${item.code} / 안정형 점수 부족 ${discoverScore}`
  );
  continue;
}

if (strategyPreset === "trend" && discoverScore < settings.trendMinScore) {
  console.log(
    `[매수제외] ${item.name} ${item.code} / 추세형 점수 부족 ${discoverScore}`
  );
  continue;
}



if (settings.blockStoppedToday && wasStoppedToday(state, item.code)) {
  console.log(
    `[매수제외] ${item.name} ${item.code} / 오늘 손절 또는 손실 이력 있음`
  );
  continue;
}

if (wasBoughtToday(state, item.code)) {
  console.log(
    `[매수제외] ${item.name} ${item.code} / 오늘 이미 매수한 종목`
  );
  continue;
}

const changeRate = Number(
  item.changeRate ||
  item.fluctuationRate ||
  item.riseRate ||
  item.rate ||
  0
);

if (changeRate < 1.0) {
  console.log(
    `[매수제외] ${item.name} ${item.code} / 상승률 약함 ${changeRate.toFixed(2)}%`
  );
  continue;
}


const maxAllowedChangeRate =
  bestStrategy.key === "trend" &&
  Number(item.discoverScore || 0) >= 10
    ? 7
    : 5;

if (changeRate >= maxAllowedChangeRate) {
  console.log(
    `[매수제외] ${item.name} ${item.code} / 당일 급등 ${changeRate.toFixed(2)}% / 허용 ${maxAllowedChangeRate}%`
  );
  continue;
}

const coreItemForBuy = {
  ...item,
  currentPrice,
  price: currentPrice,
  name:
    priceData.name && priceData.name !== item.code
      ? priceData.name
      : item.name
};


const coreJudge = judgeCoreBuy(
  state,
  coreItemForBuy,
  currentPrice,
  bestStrategy,
  state.marketScore
);

if (!coreJudge.pass) {
  logBuyReject("CORE", coreItemForBuy, coreJudge.reason, {
  finalBuyScore: coreJudge.finalScore?.score,
  marketScore: state.marketScore
});
  continue;
}

coreItemForBuy.finalBuyScore = coreJudge.finalScore.score;
coreItemForBuy.finalBuyScoreDetail = coreJudge.finalScore;

const bought = paperBuy(
  state,
  coreItemForBuy,
  bestStrategy,
  buyRules.perBuyAmount
);


      if (bought) {
        console.log(
          `[모의매수] ${item.name} ${item.code} / ${bestStrategy.name} / 점수 ${item.discoverScore}`
        );
      }
    }

    state.lastRunAt = nowText();
    saveState(state);
  } catch (err) {
    console.error("서버 자동 모의매수 오류:", err.message);
  } finally {
    isRunning = false;
  }
}

async function runEarlyAutoBuyOnce() {
  if (isRunning) {
    console.log("[EARLY] 다른 매수 로직 실행중이라 건너뜀");
    return;
  }

  isRunning = true;

  try {
  if (!settings.earlyEnabled) return;

  if (!isBetweenTime(settings.earlyStartTime, settings.earlyEndTime)) {
    return;
  }

  const state = loadState();

  if (!state.serverAutoEnabled) {
    console.log("[EARLY] 서버 자동매매 OFF");
    return;
  }

  let candidates = [];

  try {
    candidates = await discoverCandidates();
    const marketTemperature = calculateMarketTemperature(candidates);
state.marketTemperature = {
  ...marketTemperature,
  checkedAt: marketTemperature.checkedAt || nowText(),
  checkedDate: todayKey()
};

if (isAttackBuyBlockedByMarket(marketTemperature)) {
  console.log(
    `[EARLY 매수보류] 장초 시장 약함 / ${marketTemperature.level} / ${marketTemperature.reason}`
  );
  saveState(state);
  return;
}

  } catch (err) {
    console.warn("[EARLY] 후보 발굴 실패:", err.message);
    saveState(state);
    return;
  }

  for (const item of candidates.slice(0, 15)) {
    if (getEarlyHoldingCount(state) >= settings.earlyMaxHoldingCount) break;
    if (getTodayEarlyBuyCount(state) >= settings.earlyMaxDailyBuyCount) break;

    if (isAlreadyHolding(state, item.code)) continue;
    if (wasEarlyBoughtToday(state, item.code)) continue;
    if (wasStoppedToday(state, item.code)) continue;

    let priceData = null;

    try {
      priceData = await fetchPrice(item.code);
    } catch (err) {
      console.log("[EARLY] 현재가 조회 실패", item.code, err.message);
      continue;
    }

    const currentPrice = Number(priceData.currentPrice || item.currentPrice || 0);
    if (!currentPrice || currentPrice <= 0) continue;

    const mergedItem = {
      ...item,
      ...priceData,
      raw: {
        ...(item.raw || {}),
        ...(priceData.raw || {})
      }
    };

    const earlyCheck = isEarlyLeaderCandidate(mergedItem, currentPrice);

    if (!earlyCheck.pass) continue;

    console.log(
      `[EARLY 후보] ${priceData.name || item.name} ${item.code} / ${earlyCheck.reason}`
    );

    paperEarlyBuy(
      state,
      {
        ...mergedItem,
        name: priceData.name || item.name,
        currentPrice,
        tradeVolumeRatio: earlyCheck.volumeRatio
      },
      currentPrice
    );
  }

  state.lastEarlyCheckAt = nowText();
    saveState(state);
  } finally {
    isRunning = false;
  }
}

async function runTurboAutoBuyOnce() {
  if (isRunning) {
    console.log("[TURBO] 다른 매수 로직 실행중이라 건너뜀");
    return;
  }

  isRunning = true;

  try {
    if (!settings.turboEnabled) return;

    if (!isBetweenTime(settings.turboStartTime, settings.turboEndTime)) {
      return;
    }

    const state = loadState();

    if (state.turboBuyStopped) {
      console.log("[TURBO] 오늘 Turbo 매수중단 상태");
      return;
    }

    if (!state.serverAutoEnabled) {
      console.log("[TURBO] 서버 자동매매 OFF");
      return;
    }

    let candidates = [];

    try {
      candidates = await discoverCandidates();
      
    } catch (err) {
      console.warn("[TURBO] 후보 발굴 실패:", err.message);
      saveState(state);
      return;
    }

    const leadingSectors = getLeadingSectors(candidates);
    const marketScore = calculateMarketScore(candidates, leadingSectors);
state.marketScore = marketScore;
state.marketTemperature = marketScore.marketTemperature;

console.log(`[시장점수] ${marketScore.reason}`);

if (
  settings.marketScoreEnabled &&
  marketScore.score < settings.turboMinMarketScore
) {
  console.log(
    `[TURBO 중단] 시장점수 부족 ${marketScore.score} / 기준 ${settings.turboMinMarketScore}`
  );

  state.lastTurboCheckAt = nowText();
  saveState(state);
  return;
}

console.log(
  `[섹터 자금쏠림] 주도섹터: ${
    leadingSectors.length > 0 ? leadingSectors.join(", ") : "없음"
  }`
);

    for (const item of candidates.slice(0, 20)) {
      if (getTurboHoldingCount(state) >= settings.turboMaxHoldingCount) break;
      if (getTodayTurboBuyCount(state) >= settings.turboMaxDailyBuyCount) break;

      if (isAlreadyHolding(state, item.code)) continue;
      if (wasTurboBoughtToday(state, item.code)) continue;
      if (wasStoppedToday(state, item.code)) continue;

      if (Number(item.discoverScore || 0) < settings.turboMinScore) {
        continue;
      }

      const sectorFlowCheck = isInLeadingSector(item, leadingSectors);

if (sectorFlowCheck.pass) {
  item.leadingSectorMatched = item.leadingSectorMatched || [];
item.leadingSectorBonus = Number(sectorFlowCheck.bonus || 0);

  console.log(
    `[TURBO 주도섹터 우대] ${item.name || item.code} / ${sectorFlowCheck.reason} / 보너스 ${item.leadingSectorBonus}`
  );
} else {
  item.leadingSectorMatched = item.leadingSectorMatched || [];
  item.leadingSectorBonus = Number(item.leadingSectorBonus || 0);

  console.log(
    `[TURBO 비주도섹터] ${item.name || item.code} / ${sectorFlowCheck.reason} / 보너스 0`
  );
}

      let priceData = null;

      try {
        priceData = await fetchPrice(item.code);
      } catch (err) {
        console.log("[TURBO] 현재가 조회 실패", item.code, err.message);
        continue;
      }

      const currentPrice = Number(priceData.currentPrice || item.currentPrice || 0);
      if (!currentPrice || currentPrice <= 0) continue;

      const mergedItem = {
        ...item,
        ...priceData,
        raw: {
          ...(item.raw || {}),
          ...(priceData.raw || {})
        }
      };

      const turboCheck = checkTurboLeaderCandidate(mergedItem, currentPrice);

if (!turboCheck.pass) {
  continue;
}
const finalScore = calculateFinalBuyScore(
  mergedItem,
  currentPrice,
  state.marketScore
);

mergedItem.finalBuyScore = finalScore.score;
mergedItem.finalBuyScoreDetail = finalScore;

if (finalScore.score < settings.turboMinFinalBuyScore) {
  logBuyReject("TURBO", mergedItem, finalScore.reason, {
  finalBuyScore: finalScore.score,
  marketScore: state.marketScore
});
  continue;
}

const judge = judgeTurboBuy(state, mergedItem, currentPrice);

if (!judge.pass) {
  logBuyReject("TURBO", mergedItem, judge.reason, {
  finalBuyScore: mergedItem.finalBuyScore,
  marketScore: state.marketScore
});
  continue;
}

logBuyPass("TURBO", mergedItem, {
  finalBuyScore: mergedItem.finalBuyScore,
  marketScore: state.marketScore,
  reason: `${turboCheck.reason} / ${judge.reason}`
});

paperTurboBuy(
  state,
  {
    ...mergedItem,
    name: priceData.name || item.name,
    currentPrice
  },
  currentPrice
);

}
    state.lastTurboCheckAt = nowText();
    saveState(state);
  } finally {
    isRunning = false;
  }
}

async function runLeaderAutoBuyOnce() {
  if (!settings.leaderEnabled) return;

  if (!isBetweenTime(settings.leaderStartTime, settings.leaderEndTime)) {
    return;
  }

  const state = loadState();

  if (!state.serverAutoEnabled) {
    console.log("[LEADER] 서버 자동매매 OFF");
    return;
  }

  if (state.dailyBuyStopped) {
    console.log("[LEADER] 일일 손실한도 도달로 신규매수 중단");
    return;
  }

  let candidates = [];

  try {
    candidates = await discoverCandidates();
  } catch (err) {
    console.warn("[LEADER] 후보 발굴 실패:", err.message);
    saveState(state);
    return;
  }

  const marketTemperature = normalizeMarketTemperature(
    calculateMarketTemperature(candidates),
    "LEADER 시장온도 계산"
  );

  state.marketTemperature = marketTemperature;

  const leadingSectors = getLeadingSectors(candidates);
const marketScore = calculateMarketScore(candidates, leadingSectors);

state.marketScore = marketScore;

console.log(`[LEADER 시장점수] ${marketScore.reason}`);

    const leaderCandidates = candidates
    .filter((item) => isLeaderCoreCandidate(item, marketTemperature, marketScore))    .sort((a, b) =>
      Number(b.leaderStrengthScore || 0) - Number(a.leaderStrengthScore || 0)
    );

  if (leaderCandidates.length === 0) {
    console.log("[LEADER] 후보 없음");
    state.lastLeaderCheckAt = nowText();
    saveState(state);
    return;
  }

  for (const item of leaderCandidates.slice(0, 20)) {
    if (getLeaderHoldingCount(state) >= settings.leaderMaxHoldingCount) break;
    if (getTodayLeaderBuyCount(state) >= settings.leaderMaxDailyBuyCount) break;
    if (isAlreadyHolding(state, item.code)) continue;
    if (wasLeaderBoughtToday(state, item.code)) continue;

    let priceData = null;

    try {
      priceData = await fetchPrice(item.code);
    } catch (err) {
      console.log("[LEADER] 현재가 조회 실패", item.code, err.message);
      continue;
    }

    const currentPrice = Number(priceData.currentPrice || item.currentPrice || item.price || 0);
    if (!currentPrice || currentPrice <= 0) continue;

    const mergedItem = {
      ...item,
      ...priceData,
      name: priceData.name || item.name || item.stockName || item.korName || item.code,
      currentPrice
    };

    if (!isLeaderCoreCandidate(mergedItem, marketTemperature, state.marketScore)) {
  continue;
}

    const leaderJudge = judgeLeaderBuy(
  state,
  mergedItem,
  currentPrice,
  state.marketScore
);

if (!leaderJudge.pass) {
  logBuyReject("LEADER", mergedItem, leaderJudge.reason, {
  finalBuyScore: leaderJudge.finalScore?.score,
  marketScore: state.marketScore
});
  continue;
}

mergedItem.finalBuyScore = leaderJudge.finalScore.score;
mergedItem.finalBuyScoreDetail = leaderJudge.finalScore;
mergedItem.leaderStrengthScore = leaderJudge.leaderStrengthScore;

logBuyPass("LEADER", mergedItem, {
  finalBuyScore: mergedItem.finalBuyScore,
  marketScore: state.marketScore,
  reason: leaderJudge.reason
});

    paperLeaderBuy(state, mergedItem, currentPrice);
  }

  

  state.lastLeaderCheckAt = nowText();
  saveState(state);
}

function startServerAutoTrader() {
  console.log("서버 자동 모의매매 시작");

  // 매수 로직 통합 실행부
  setInterval(async () => {
    // 1) 오전 TURBO 시간에는 TURBO만 우선 실행
    if (isBetweenTime(settings.turboStartTime, settings.turboEndTime)) {
      await runTurboAutoBuyOnce();
      return;
    }

    // 2) TURBO 시간이 끝난 뒤 LEADER 실행
    if (isBetweenTime(settings.leaderStartTime, settings.leaderEndTime)) {
      await runLeaderAutoBuyOnce();
    }

    // 3) CORE는 10분 단위로만 실행
    const now = new Date();
    const minute = now.getMinutes();

    if (minute % 10 === 0) {
      await runServerAutoBuyOnce();
    }

    // 4) EARLY는 현재 earlyEnabled false라 사실상 실행 안 됨
    if (
      settings.earlyEnabled &&
      isBetweenTime(settings.earlyStartTime, settings.earlyEndTime)
    ) {
      await runEarlyAutoBuyOnce();
    }
  }, 60 * 1000);

  // 매도는 그대로 30초마다
  setInterval(() => {
    checkServerAutoSellOnce();
  }, 30 * 1000);
}


async function runClosingProfitSell() {
  const state = loadState();

  if (!state.serverAutoEnabled) {
    console.log("서버 자동매매 OFF 상태입니다. 장마감 수익매도 중단");
    return { ok: false, message: "서버 자동매매 OFF 상태" };
  }

  const holdings = Array.isArray(state.holdings) ? [...state.holdings] : [];
  const sold = [];

  for (const holding of holdings) {
    const currentPrice = Number(holding.currentPrice || 0);
    const buyPrice = Number(holding.buyPrice || 0);
    const qty = Number(holding.qty || 0);

    if (buyPrice <= 0 || currentPrice <= 0 || qty <= 0) continue;

    const profitRate = ((currentPrice - buyPrice) / buyPrice) * 100;

    if (profitRate > 0) {
      const success = paperSell(
        state,
        holding,
        currentPrice,
        "장마감 수익종목 정리매도",
        "SELL_CLOSING_PROFIT"
      );

      if (success) {
        sold.push({
          code: holding.code,
          name: holding.name,
          price: currentPrice,
          qty,
          profitRate
        });
      }
    }
  }

  rebalanceCashIfNoHoldings(
  state,
  "장마감 수익매도 후 자동 6:4 재배분"
);

saveState(state);

console.log(`[장마감 수익매도] ${sold.length}개 종목 매도`);
return {
    ok: true,
    soldCount: sold.length,
    sold
  };
}

module.exports = {
  startServerAutoTrader,
  setServerAutoEnabled,
  runServerAutoBuyOnce,
  runTurboAutoBuyOnce,
  runEarlyAutoBuyOnce,
  checkServerAutoSellOnce,
  runClosingProfitSell,
  runLeaderAutoBuyOnce,
  loadState
};


function setServerAutoEnabled(enabled) {
  const state = loadState();

  state.serverAutoEnabled = !!enabled;
  state.serverAutoChangedAt = nowText();

  saveState(state);

  return state;
}
