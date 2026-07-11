require("dotenv").config();

const express = require("express");
const cors = require("cors");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

const stocksPath = path.join(__dirname, "stocks.json");

let STOCK_MASTER = [];

try {
  STOCK_MASTER = JSON.parse(fs.readFileSync(stocksPath, "utf-8"));
  console.log("종목 목록 로드 완료:", STOCK_MASTER.length);
} catch (error) {
  console.error("stocks.json 로드 실패:", error.message);
}

const PAPER_STATE_FILE = path.join(
  __dirname,
  "paper-state-core.json"
);

function loadPaperState() {
  if (!fs.existsSync(PAPER_STATE_FILE)) {
    return {
      holdings: [],
      tradeLogs: [],
      virtualResults: [],
      totalCash: 100000000,
      initialCapital: 100000000,
      serverAutoEnabled: true
    };
  }

  const state = JSON.parse(
    fs.readFileSync(PAPER_STATE_FILE, "utf8")
  );

  if (!Array.isArray(state.holdings)) state.holdings = [];
  if (!Array.isArray(state.tradeLogs)) state.tradeLogs = [];
  if (!Array.isArray(state.virtualResults)) {
    state.virtualResults = [];
  }

  if (typeof state.totalCash === "undefined") {
    state.totalCash = 100000000;
  }

  return state;
}

function savePaperState(state) {
  fs.writeFileSync(
    PAPER_STATE_FILE,
    JSON.stringify(state, null, 2)
  );
}

function getSavedToken() {
  return fs.readFileSync("token.txt", "utf8").trim();
}

function getBacktestPresetSetting(preset) {
  if (preset === "trend") {
    return {
      name: "추세형",
      targetRate: 5,
      stopRate: -3,
      trailingRate: 3
    };
  }

  if (preset === "short") {
    return {
      name: "단타형",
      targetRate: 2.5,
      stopRate: -1.5,
      trailingRate: 1.5
    };
  }

  if (preset === "safe") {
    return {
      name: "안정형",
      targetRate: 3,
      stopRate: -2,
      trailingRate: 2
    };
  }

  return {
    name: "기본형",
    targetRate: 4,
    stopRate: -2.5,
    trailingRate: 2
  };
}

function runSimpleBacktest(items, presetSetting) {
  if (!items || items.length < 2) {
    return {
      passed: false,
      finalProfitRate: 0,
      winRate: 0,
      tradeCount: 0,
      message: "일봉 데이터 부족"
    };
  }

  let tradeCount = 0;
  let winCount = 0;
  let totalProfitRate = 0;

  for (let i = 1; i < items.length; i++) {
    const prev = items[i - 1];
    const cur = items[i];

    const prevClose = Number(prev.close || 0);
    const close = Number(cur.close || 0);
    const high = Number(cur.high || 0);
    const low = Number(cur.low || 0);

    if (!prevClose || !close || !high || !low) continue;

    const dayRate = ((close - prevClose) / prevClose) * 100;

    if (dayRate <= 0) continue;

    tradeCount++;

    const highRate = ((high - prevClose) / prevClose) * 100;
    const lowRate = ((low - prevClose) / prevClose) * 100;

    let resultRate = dayRate;

    if (highRate >= presetSetting.targetRate) {
      resultRate = presetSetting.targetRate;
    }

    if (lowRate <= presetSetting.stopRate) {
      resultRate = presetSetting.stopRate;
    }

    totalProfitRate += resultRate;

    if (resultRate > 0) {
      winCount++;
    }
  }

  const winRate =
    tradeCount > 0 ? (winCount / tradeCount) * 100 : 0;

  return {
    passed:
      tradeCount >= 2 &&
      totalProfitRate > 0 &&
      winRate >= 40,
    finalProfitRate: totalProfitRate,
    profitRate: totalProfitRate,
    winRate,
    tradeCount
  };
}

app.get("/api/backtest", async (req, res) => {
  try {
    const code = String(req.query.code || "").trim();
    const preset = String(req.query.preset || "trend").trim();
    const days = Number(req.query.days || 30);

    if (!code) {
      return res.status(400).json({
        message: "종목코드가 없습니다."
      });
    }

    const dailyRes = await fetch(
      `http://localhost:${PORT}/api/daily?code=${code}&days=${days}`
    );

    const dailyData = await dailyRes.json();

    if (!dailyRes.ok) {
      return res.status(500).json({
        message: "일봉 조회 실패",
        error: dailyData
      });
    }

    const presetSetting = getBacktestPresetSetting(preset);
    const result = runSimpleBacktest(
      dailyData.items || [],
      presetSetting
    );

    res.json({
      code,
      preset,
      presetName: presetSetting.name,
      days,
      ...result
    });
  } catch (error) {
    console.error("/api/backtest 오류:", error);

    res.status(500).json({
      message: "백테스트 실패",
      error: error.message
    });
  }
});




function calculateDiscoverScore(item) {
  const rate = parseFloat(item.changeRate);
  const volume = Number(item.volume || 0);
  const high = Number(item.high || 0);
  const low = Number(item.low || 0);
  const open = Number(item.open || item.openPrice || 0);
  const currentPrice = Number(item.currentPrice || item.price || 0);

  let score = 0;
  const reasons = [];

  const scoreDetails = {
  rate: 0,
  volume: 0,
  openStrength: 0,
  dayPosition: 0
};

  // 상승률: 기존보다 넓게 허용
  if (!isNaN(rate)) {
    if (rate >= 0.3 && rate <= 5) {
      score += 4;
      scoreDetails.rate += 4;
      reasons.push(`빠른상승 ${rate.toFixed(2)}%`);
    } else if (rate > 5 && rate <= 9) {
      score += 2;
      reasons.push(`강한상승 ${rate.toFixed(2)}%`);
    } else if (rate > 9 && rate <= 15) {
      score += 1;
      reasons.push(`과열전 관찰 ${rate.toFixed(2)}%`);
    } else if (rate < -2.5) {
      score -= 2;
      reasons.push(`하락폭 큼 ${rate.toFixed(2)}%`);
    }
  }

  // 거래량: 10만 이상도 적극 반영
  if (volume >= 1000000) {
    score += 4;
    scoreDetails.volume += 4;
    reasons.push("거래량 100만 이상");
  } else if (volume >= 500000) {
    score += 3;
    scoreDetails.volume += 3;
    reasons.push("거래량 50만 이상");
  } else if (volume >= 100000) {
    score += 2;
    scoreDetails.volume += 2;
    reasons.push("거래량 10만 이상");
  } else if (volume >= 50000) {
    score += 1;
    scoreDetails.volume += 1;
    reasons.push("거래량 5만 이상");
  }

  // 시가 대비 상승이면 가점
  if (open > 0 && currentPrice > open) {
    score += 2;
    scoreDetails.openStrength += 2;
    reasons.push("시가 대비 상승");
  }

  // 당일 위치: 고점 추격을 완전히 막지 않고 감점만
  if (high > 0 && low > 0 && currentPrice > 0) {
    const range = high - low;

    if (range > 0) {
      const closePosition = ((currentPrice - low) / range) * 100;

      if (closePosition >= 40 && closePosition <= 85) {
        score += 2;
        scoreDetails.dayPosition += 2;
        reasons.push("당일 중상단");
      } else if (closePosition > 85 && closePosition <= 96) {
        score += 1;
        scoreDetails.dayPosition += 1;
        reasons.push("고가권 강세");
      } else if (closePosition > 96) {
        score -= 1;
         scoreDetails.dayPosition -= 1;
        reasons.push("고점 추격주의");
      }
    }
  }

  return {
    discoverScore: score,
    discoverReasons: reasons,
    discoverScoreDetails: scoreDetails
  };
}



const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));







app.get("/api/discover", async (req, res) => {
  try {
    const scanLimit = Number(req.query.scanLimit || 150);
    const resultLimit = Number(req.query.limit || 150);
    const offset = Number(req.query.offset || 0);

    const nextOffset =
      offset + scanLimit >= STOCK_MASTER.length
        ? 0
        : offset + scanLimit;

    const targets = STOCK_MASTER.slice(offset, offset + scanLimit);

    console.log(
      `[DISCOVER] offset=${offset} scan=${scanLimit} next=${nextOffset} total=${STOCK_MASTER.length}`
    );

    const items = [];

    for (const stock of targets) {
      try {
        await sleep(350);

        const priceRes = await fetch(
          `http://localhost:${PORT}/api/price?code=${stock.code}`
        );

        const priceData = await priceRes.json();

        if (!priceRes.ok) continue;

        const scoreInfo = calculateDiscoverScore(priceData);

        items.push({
          ...priceData,
          ...scoreInfo
        });
      } catch (err) {
        console.warn("발굴 개별 종목 실패:", stock.code, err.message);
      }
    }

    const sorted = items
      .filter((item) => Number(item.discoverScore || 0) > 0)
      .sort(
        (a, b) =>
          Number(b.discoverScore || 0) -
          Number(a.discoverScore || 0)
      );

    res.json({
      offset,
      nextOffset,
      totalStocks: STOCK_MASTER.length,
      scanCount: targets.length,
      count: sorted.length,
      items: sorted.slice(0, resultLimit)
    });
  } catch (error) {
    console.error("/api/discover 오류:", error);

    res.status(500).json({
      message: "자동발굴 실패",
      error: error.message
    });
  }
});

async function refreshKiwoomToken() {
  const url = `${process.env.KIWOOM_BASE_URL}/oauth2/token`;

  const result = await axios.post(
    url,
    {
      grant_type: "client_credentials",
      appkey: process.env.KIWOOM_APP_KEY,
      secretkey: process.env.KIWOOM_SECRET_KEY
    },
    {
      headers: {
        "Content-Type": "application/json;charset=UTF-8"
      }
    }
  );

  const token =
    result.data.token ||
    result.data.access_token ||
    result.data.accessToken;

  if (!token) {
    throw new Error("토큰 발급 실패: " + JSON.stringify(result.data));
  }

  fs.writeFileSync("token.txt", token, "utf8");

  console.log("키움 토큰 자동 갱신 완료");

  return token;
}

function isTokenError(data) {
  const msg = String(data?.return_msg || data?.message || "");
  const code = String(data?.return_code || "");

  return (
    code === "3" &&
    msg.includes("Token")
  ) || msg.includes("Token이 유효하지 않습니다");
}

function cleanNumber(value) {
  if (!value) return "";
  return String(value).replace(/[+-]/g, "");
}

app.get("/", (req, res) => {
  res.send("Kiwoom Auto Trader Server is running");
});


app.get("/api/status", (req, res) => {
  res.json({
    ok: true,
    server: "kiwoom-server",
    file: __filename,
    cwd: process.cwd(),
    time: new Date().toLocaleString("ko-KR")
  });
});

app.get("/api/token/refresh", async (req, res) => {
  try {
    const token = await refreshKiwoomToken();

    res.json({
      ok: true,
      message: "토큰 갱신 완료",
      tokenLength: token.length,
      time: new Date().toLocaleString("ko-KR")
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: "토큰 갱신 실패",
      error: error.message
    });
  }
});

app.get("/api/search", (req, res) => {
  try {
    const keyword = String(req.query.keyword || "").trim();

    if (!keyword) {
      return res.json({ items: [] });
    }

    const normalizedKeyword = keyword.replace(/\s/g, "").toLowerCase();

    const matched = STOCK_MASTER
  .filter((item) => {

    const name = String(
      item.name || item.stk_nm || ""
    )
      .replace(/\s/g, "")
      .toLowerCase();

    const code = String(
      item.code || item.stk_cd || ""
    );

    return (
      name.includes(normalizedKeyword) ||
      code.includes(normalizedKeyword)
    );
  })
  .slice(0, 30)
  .map((item) => ({
    code: String(item.code || item.stk_cd || ""),
    name: String(item.name || item.stk_nm || "")
  }));

    return res.json({ items: matched });
  } catch (error) {
    console.error("/api/search 오류:", error);
    return res.status(500).json({
      message: "종목 검색 실패",
      error: error.message
    });
  }
});

app.post("/api/core-paper-buy", express.json(), (req, res) => {
  try {
    const {
      code,
      name,
      price,
      qty,
      strategyGroup,
      reason
    } = req.body || {};

    if (!code || !price || !qty) {
      return res.status(400).json({
        ok: false,
        message: "code, price, qty 필요"
      });
    }

    const state = loadPaperState();

    if (!Array.isArray(state.holdings)) state.holdings = [];
    if (!Array.isArray(state.tradeLogs)) state.tradeLogs = [];

    const buyAmount = Number(price) * Number(qty);

    state.holdings.push({
      code,
      name: name || code,
      strategyGroup: strategyGroup || "CORE",
      buyPrice: Number(price),
      currentPrice: Number(price),
      highestPrice: Number(price),
      lowestPrice: Number(price),
      qty: Number(qty),
      buyAmount,
      buyTime: new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }),
      buyTimeMs: Date.now(),
      buyAt: new Date().toISOString(),
      date: new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" })
    });

    state.totalCash = Number(state.totalCash || 0) - buyAmount;

    state.tradeLogs.push({
      type: `${strategyGroup || "CORE"}_BUY`,
      strategyGroup: strategyGroup || "CORE",
      code,
      name: name || code,
      price: Number(price),
      buyPrice: Number(price),
      qty: Number(qty),
      buyAmount,
      reason,
      date: new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" }),
      time: new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })
    });

    savePaperState(state);

    res.json({
      ok: true,
      message: "paper buy 완료",
      holdingCount: state.holdings.length,
      totalCash: state.totalCash
    });

  } catch (err) {
    res.status(500).json({
      ok: false,
      message: err.message
    });
  }
});

app.post("/api/core-paper-sell", express.json(), (req, res) => {
  try {
    const {
      code,
      price,
      qty,
      sellType,
      reason
    } = req.body || {};

    if (!code || !price || !qty) {
      return res.status(400).json({
        ok: false,
        message: "code, price, qty 필요"
      });
    }

    const state = loadPaperState();

    if (!Array.isArray(state.holdings)) state.holdings = [];
    if (!Array.isArray(state.tradeLogs)) state.tradeLogs = [];
    if (!Array.isArray(state.virtualResults)) state.virtualResults = [];

    const holding = state.holdings.find(h => h.code === code);

    if (!holding) {
      return res.status(404).json({
        ok: false,
        message: "보유종목 없음"
      });
    }

    const sellQty = Math.min(Number(qty), Number(holding.qty || 0));
    const buyPrice = Number(holding.buyPrice || 0);
    const sellPrice = Number(price);
    const profit = Math.floor((sellPrice - buyPrice) * sellQty);
    const profitRate = buyPrice > 0
      ? ((sellPrice - buyPrice) / buyPrice) * 100
      : 0;

    holding.qty -= sellQty;
    state.totalCash = Number(state.totalCash || 0) + sellPrice * sellQty;

    const date = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
    const time = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });

    state.tradeLogs.push({
      type: sellType || `${holding.strategyGroup}_SELL`,
      strategyGroup: holding.strategyGroup,
      code: holding.code,
      name: holding.name,
      buyPrice,
      sellPrice,
      price: sellPrice,
      qty: sellQty,
      profit,
      profitRate,
      reason,
      date,
      time
    });

    state.virtualResults.push({
      code: holding.code,
      name: holding.name,
      strategyGroup: holding.strategyGroup,
      buyPrice,
      sellPrice,
      qty: sellQty,
      profit,
      profitRate,
      reason,
      date,
      sellTime: new Date().toISOString()
    });

    if (holding.qty <= 0) {
      state.holdings = state.holdings.filter(h => h !== holding);
    }

    savePaperState(state);

    res.json({
      ok: true,
      message: "paper sell 완료",
      profit,
      profitRate,
      totalCash: state.totalCash
    });

  } catch (err) {
    res.status(500).json({
      ok: false,
      message: err.message
    });
  }
});

app.post("/api/token/reissue", (req, res) => {
  exec("cd /home/ubuntu/kiwoom-server && node token.js", (error, stdout, stderr) => {
    if (error) {
      return res.status(500).json({
        ok: false,
        message: "토큰 신규발급 실패",
        error: error.message,
        stderr
      });
    }

    res.json({
      ok: true,
      message: "토큰 신규발급 완료. 서버를 곧 재시작합니다.",
      stdout,
      stderr
    });

    setTimeout(() => {
      exec("pm2 restart kiwwm-server --update-env");
    }, 1000);
  });
});

app.post("/api/server-result-clear", (req, res) => {
  try {
    
    const state = JSON.parse(fs.readFileSync(PAPER_STATE_FILE, "utf8"));

    state.virtualResults = [];
    state.results = [];

    fs.writeFileSync(
      PAPER_STATE_FILE,
      JSON.stringify(state, null, 2)
    );

    res.json({
      ok: true,
      message: "완료결과를 삭제했습니다."
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error.message
    });
  }
});

app.get("/api/stocks", (req, res) => {
  try {
    const stocks = require("./stocks.json");

    res.json({
      count: stocks.length,
      items: stocks
    });
  } catch (error) {
    res.status(500).json({
      message: "stocks.json 조회 실패",
      error: error.message
    });
  }
});

async function fetchCurrentPriceFromKiwoom(code) {
  const token = getSavedToken();

  const url = `${process.env.KIWOOM_BASE_URL}/api/dostk/stkinfo`;

  const result = await axios.post(
    url,
    { stk_cd: code },
    {
      headers: {
        "Content-Type": "application/json;charset=UTF-8",
        authorization: `Bearer ${token}`,
        "api-id": "ka10001"
      }
    }
  );

  const data = result.data;

  return {
    code: data.stk_cd,
    name: data.stk_nm,
    currentPrice: Number(cleanNumber(data.cur_prc)),
    changeRate: data.flu_rt,
    volume: Number(cleanNumber(data.trde_qty)),
    open: Number(cleanNumber(data.open_pric)),
    high: Number(cleanNumber(data.high_pric)),
    low: Number(cleanNumber(data.low_pric)),
    raw: data
  };
}

async function refreshServerHoldingPrices() {
  

  if (!fs.existsSync(PAPER_STATE_FILE)) return;

  const paperState = JSON.parse(
    fs.readFileSync(PAPER_STATE_FILE, "utf8")
  );

  paperState.holdings = paperState.holdings || [];

  if (paperState.holdings.length === 0) return;

  for (const holding of paperState.holdings) {
    try {
      const priceData = await fetchCurrentPriceFromKiwoom(holding.code);

      holding.currentPrice = Number(priceData.currentPrice || holding.currentPrice || holding.buyPrice || 0);
      holding.name = holding.name || priceData.name;
      holding.highestPrice = Math.max(
        Number(holding.highestPrice || 0),
        Number(holding.currentPrice || 0)
      );

await new Promise((resolve) => setTimeout(resolve, 1200));

 } catch (error) {
      console.error(
        "서버 보유종목 현재가 갱신 실패:",
        holding.code,
        error.message
      );
    }
  }

  paperState.lastPriceRefreshAt = new Date().toLocaleString("ko-KR");

  fs.writeFileSync(
    PAPER_STATE_FILE,
    JSON.stringify(paperState, null, 2)
  );
}

const priceCache = {};
let lastKiwoomPriceRequestAt = 0;

async function waitKiwoomPriceLimit() {
  const minGapMs = 350;
  const now = Date.now();
  const waitMs = Math.max(0, minGapMs - (now - lastKiwoomPriceRequestAt));

  if (waitMs > 0) {
    await new Promise(resolve => setTimeout(resolve, waitMs));
  }

  lastKiwoomPriceRequestAt = Date.now();
}

app.get("/api/price", async (req, res) => {
  try {
    const token = getSavedToken();
    const code = String(req.query.code || "").trim();

    if (!code) {
      return res.status(400).json({ message: "종목코드가 없습니다." });
    }

    const cached = priceCache[code];

if (cached && Date.now() - cached.cachedAt <= 5000) {
  return res.json({
    ...cached.data,
    isCached: true
  });
}

    const url = `${process.env.KIWOOM_BASE_URL}/api/dostk/stkinfo`;

    await waitKiwoomPriceLimit();

    let result = await axios.post(
  url,
  { stk_cd: code },
  {
    headers: {
      "Content-Type": "application/json;charset=UTF-8",
      authorization: `Bearer ${token}`,
      "api-id": "ka10001"
    }
  }
);

let data = result.data;

if (isTokenError(data)) {
  console.log("[/api/price] 토큰 만료 감지 → 자동 재발급 후 현재가 재조회", code);

  const newToken = await refreshKiwoomToken();

  result = await axios.post(
    url,
    { stk_cd: code },
    {
      headers: {
        "Content-Type": "application/json;charset=UTF-8",
        authorization: `Bearer ${newToken}`,
        "api-id": "ka10001"
      }
    }
  );

  data = result.data;
}

    const responseData = {
  code: data.stk_cd,
  name: data.stk_nm,
  currentPrice: Number(cleanNumber(data.cur_prc)),
  changeRate: data.flu_rt,
  volume: Number(cleanNumber(data.trde_qty)),
  open: Number(cleanNumber(data.open_pric)),
  high: Number(cleanNumber(data.high_pric)),
  low: Number(cleanNumber(data.low_pric)),
  raw: data
};

priceCache[code] = {
  data: responseData,
  cachedAt: Date.now()
};

res.json(responseData);


  } catch (error) {
  console.error("[/api/price 현재가 조회 실패]", {
    code: req.query.code,
    message: error.message,
    status: error.response?.status,
    data: error.response?.data
  });

  res.status(500).json({
    message: "현재가 조회 실패",
    code: req.query.code,
    error: error.message,
    status: error.response?.status || null,
    detail: error.response?.data || null
  });
}
});

app.get("/price/:code", async (req, res) => {
  try {
    const token = getSavedToken();
    const code = req.params.code;

    const url = `${process.env.KIWOOM_BASE_URL}/api/dostk/stkinfo`;

    let result = await axios.post(
  url,
  { stk_cd: code },
  {
    headers: {
      "Content-Type": "application/json;charset=UTF-8",
      authorization: `Bearer ${token}`,
      "api-id": "ka10001"
    }
  }
);

let data = result.data;

if (isTokenError(data)) {
  console.log("토큰 만료 감지 → 자동 재발급 후 현재가 재조회");

  const newToken = await refreshKiwoomToken();

  result = await axios.post(
    url,
    { stk_cd: code },
    {
      headers: {
        "Content-Type": "application/json;charset=UTF-8",
        authorization: `Bearer ${newToken}`,
        "api-id": "ka10001"
      }
    }
  );

  data = result.data;
}
    res.json({
      code: data.stk_cd,
      name: data.stk_nm,
      currentPrice: Number(cleanNumber(data.cur_prc)),
      changeRate: data.flu_rt,
      volume: Number(cleanNumber(data.trde_qty)),
      open: Number(cleanNumber(data.open_pric)),
      high: Number(cleanNumber(data.high_pric)),
      low: Number(cleanNumber(data.low_pric)),
      raw: data
    });
  } catch (error) {
    res.status(500).json({
      message: "현재가 조회 실패",
      error: error.response?.data || error.message
    });
  }
});

app.get("/api/daily", async (req, res) => {
  try {
    const code = String(req.query.code || "").trim();
    const days = Number(req.query.days || 30);

    if (!code) {
      return res.status(400).json({
        error: "종목코드가 없습니다."
      });
    }

    const today = new Date();
    const baseDate =
      today.getFullYear().toString() +
      String(today.getMonth() + 1).padStart(2, "0") +
      String(today.getDate()).padStart(2, "0");

   let token = getSavedToken();

let response = await fetch(
  `${process.env.KIWOOM_BASE_URL}/api/dostk/chart`,
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json;charset=UTF-8",
      authorization: `Bearer ${token}`,
      "api-id": "ka10081"
    },
    body: JSON.stringify({
      stk_cd: code,
      base_dt: baseDate,
      upd_stkpc_tp: "1"
    })
  }
);

let data = await response.json();

if (isTokenError(data)) {
  console.log("토큰 만료 감지 → 자동 재발급 후 일봉 재조회");

  token = await refreshKiwoomToken();

  response = await fetch(
    `${process.env.KIWOOM_BASE_URL}/api/dostk/chart`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json;charset=UTF-8",
        authorization: `Bearer ${token}`,
        "api-id": "ka10081"
      },
      body: JSON.stringify({
        stk_cd: code,
        base_dt: baseDate,
        upd_stkpc_tp: "1"
      })
    }
  );

  data = await response.json();
}

if (!response.ok) {
  return res.status(response.status).json(data);
}
    const rawItems =
      data.stk_dt_pole_chart_qry ||
      data.output ||
      data.items ||
      [];

    const items = rawItems
      .slice(0, days)
      .map((item) => ({
        date: item.dt || item.date || item.stk_bsop_date,
        open: Number(String(item.open_pric || item.open || 0).replace(/[+-]/g, "")),
        high: Number(String(item.high_pric || item.high || 0).replace(/[+-]/g, "")),
        low: Number(String(item.low_pric || item.low || 0).replace(/[+-]/g, "")),
        close: Number(String(item.cur_prc || item.close_pric || item.close || 0).replace(/[+-]/g, "")),
        volume: Number(String(item.trde_qty || item.volume || 0).replace(/[+-]/g, ""))
      }))
      .filter((item) => item.close > 0)
      .reverse();

    res.json({
      code,
      days,
      count: items.length,
      items
    });
  } catch (error) {
    console.error("일봉 조회 오류:", error);

    res.status(500).json({
      error: "일봉 조회 실패",
      message: error.message
    });
  }
});

const {
  startServerAutoTrader,
  runServerAutoBuyOnce,
  checkServerAutoSellOnce,
  setServerAutoEnabled,
  loadState
} = require("./auto-trader-core");

const {
  startOpenStrategy,
  runOpenBuyOnce,
  checkOpenSellOnce
} = require("./open-strategy");

app.get("/api/paper-state", (req, res) => {
  res.json(loadState());
});

app.post("/api/paper-state/reset", (req, res) => {
  try {
    const resetState = {
      holdings: [],
      tradeLogs: [],
      virtualResults: [],

      totalCash: 100000000,
      initialCapital: 100000000,

      openDate: null,
      openCompleted: false,
      openSkipped: false,
      openCompletedAt: null,
      openSkipReason: null,
      openCandidateHistory: {},

      coreCandidateHistory: {},
      volumeCandidateHistory: {},

      pendingBuyCodes: [],
      pendingSellCodes: [],

      dailyRiskDate: null,
      dailyStartAsset: 100000000,
      dailyLossLimit: 1000000,
      dailyBuyStopped: false,

      serverAutoEnabled: false,
      serverAutoChangedAt: new Date().toLocaleString(
        "ko-KR",
        { timeZone: "Asia/Seoul" }
      ),

      lastRunAt: null,
      lastBuyCheckAt: null,
      lastSellCheckAt: null,
      lastPriceRefreshAt: null
    };

    fs.writeFileSync(
      PAPER_STATE_FILE,
      JSON.stringify(resetState, null, 2)
    );

    res.json({
      ok: true,
      message: "paper-state-core.json 초기화 완료",
      state: resetState
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      message: "paper-state-core.json 초기화 실패",
      error: err.message
    });
  }
});

app.get("/api/server-auto-status", (req, res) => {
  const state = loadState();

  res.json({
    ok: true,
    serverAutoEnabled: state.serverAutoEnabled !== false,
    serverAutoChangedAt: state.serverAutoChangedAt || null,
    lastRunAt: state.lastRunAt || null,
    lastSellCheckAt: state.lastSellCheckAt || null,
    openDate: state.openDate || null,
    openCompleted: state.openCompleted === true,
    openSkipped: state.openSkipped === true,
    openCompletedAt: state.openCompletedAt || null,
    openSkipReason: state.openSkipReason || null
  });
});

app.get("/api/performance-summary", (req, res) => {
  try {
    const state = loadState();

    const tradeLogs = Array.isArray(state.tradeLogs)
      ? state.tradeLogs
      : [];

  const sellLogs = tradeLogs.filter((log) =>
  [
    "SELL",
    "SELL_ALL",

    "OPEN_STOP_LOSS",
    "OPEN_TRAILING_SELL",
    "OPEN_STAGNATION_SELL",
    "OPEN_TIME_SELL",

    "CORE_STOP_LOSS",
    "CORE_FIRST_TAKE_PROFIT",
    "CORE_BREAK_EVEN_SELL",
    "CORE_TRAILING_STOP",
    "CORE_END_SELL",

    "VOLUME_STOP_LOSS",
    "VOLUME_FIRST_TAKE_PROFIT",
    "VOLUME_BREAK_EVEN_SELL",
    "VOLUME_TRAILING_STOP",
    "VOLUME_END_SELL"
  ].includes(log.type)
);

    const totalTrades = sellLogs.length;
    const winTrades = sellLogs.filter((log) => Number(log.profit || 0) > 0);
    const loseTrades = sellLogs.filter((log) => Number(log.profit || 0) < 0);

    const totalProfit = sellLogs.reduce(
      (sum, log) => sum + Number(log.profit || 0),
      0
    );

    const today = new Date().toISOString().slice(0, 10);

const todaySellLogs = sellLogs.filter((log) =>
  String(log.date || "").includes(today)
);

const todayRealizedProfit = todaySellLogs.reduce(
  (sum, log) => sum + Number(log.profit || 0),
  0
);

    const avgProfitRate =
      totalTrades > 0
        ? sellLogs.reduce((sum, log) => sum + Number(log.profitRate || 0), 0) /
          totalTrades
        : 0;

    const avgWinRate =
      winTrades.length > 0
        ? winTrades.reduce((sum, log) => sum + Number(log.profitRate || 0), 0) /
          winTrades.length
        : 0;

    const avgLossRate =
      loseTrades.length > 0
        ? loseTrades.reduce((sum, log) => sum + Number(log.profitRate || 0), 0) /
          loseTrades.length
        : 0;

    const winRate =
      totalTrades > 0 ? (winTrades.length / totalTrades) * 100 : 0;

    const holdings = Array.isArray(state.holdings)
      ? state.holdings
      : [];

    const holdingBuyAmount = holdings.reduce(
      (sum, h) => sum + Number(h.buyPrice || 0) * Number(h.qty || 0),
      0
    );

    const holdingEvalAmount = holdings.reduce(
      (sum, h) => sum + Number(h.currentPrice || h.buyPrice || 0) * Number(h.qty || 0),
      0
    );

    const holdingProfit = holdingEvalAmount - holdingBuyAmount;



const initialCapital = Number(state.initialCapital || 100000000);

const currentAsset =
  initialCapital +
  totalProfit +
  holdingProfit;

const totalAssetProfit =
  currentAsset - initialCapital;

const totalAssetProfitRate =
  initialCapital > 0
    ? (totalAssetProfit / initialCapital) * 100
    : 0;

const totalRealizedProfit = totalProfit;
const totalUnrealizedProfit = holdingProfit;
const totalCombinedProfit = totalRealizedProfit + totalUnrealizedProfit;

const todayProfit = todayRealizedProfit + holdingProfit;

const recent7Days = [];










const strategyMap = {};

sellLogs.forEach((log) => {
  const group = log.strategyGroup || "CORE";

const strategy =
  log.strategyName ||
  log.strategyPreset ||
  "기타";

const key = `${group} / ${strategy}`;

  if (!strategyMap[key]) {
    strategyMap[key] = {
  strategyGroup: group,
  strategyName: strategy,
      trades: 0,
      wins: 0,
      losses: 0,
      totalProfit: 0,
      totalProfitRate: 0,
      maxProfitRate: null,
      maxLossRate: null
    };
  }

  const profit = Number(log.profit || 0);
  const profitRate = Number(log.profitRate || 0);

  strategyMap[key].trades += 1;
  strategyMap[key].totalProfit += profit;
  strategyMap[key].totalProfitRate += profitRate;

  if (profit > 0) strategyMap[key].wins += 1;
  if (profit < 0) strategyMap[key].losses += 1;

  if (
    strategyMap[key].maxProfitRate === null ||
    profitRate > strategyMap[key].maxProfitRate
  ) {
    strategyMap[key].maxProfitRate = profitRate;
  }

  if (
    strategyMap[key].maxLossRate === null ||
    profitRate < strategyMap[key].maxLossRate
  ) {
    strategyMap[key].maxLossRate = profitRate;
  }
});

const strategyStats = Object.values(strategyMap).map((item) => ({
  ...item,
  winRate: item.trades > 0 ? (item.wins / item.trades) * 100 : 0,
  avgProfit: item.trades > 0 ? item.totalProfit / item.trades : 0,
  avgProfitRate: item.trades > 0 ? item.totalProfitRate / item.trades : 0,
  maxProfitRate: item.maxProfitRate ?? 0,
  maxLossRate: item.maxLossRate ?? 0
}));














for (let i = 6; i >= 0; i--) {
  const d = new Date();
  d.setDate(d.getDate() - i);
  const dateKey = d.toISOString().slice(0, 10);

  const daySellLogs = sellLogs.filter((log) =>
    String(log.date || "").includes(dateKey)
  );

  const realizedProfit = daySellLogs.reduce(
    (sum, log) => sum + Number(log.profit || 0),
    0
  );

  const trades = daySellLogs.length;

const isToday = dateKey === today;

const dayTotalProfit = isToday
  ? realizedProfit + holdingProfit
  : realizedProfit;

const profitRate =
  initialCapital > 0 ? (dayTotalProfit / initialCapital) * 100 : 0;

recent7Days.push({
  date: dateKey,
  realizedProfit: dayTotalProfit,
  profitRate,
  trades
});
}

const todayTotalProfitRate =
  initialCapital > 0
    ? (todayProfit / initialCapital) * 100
    : 0;

const latestMarketTemperature =
  state.marketTemperature ||
  [...tradeLogs]
    .reverse()
    .find((log) => log.marketTemperature)?.marketTemperature ||
  null;

const holdingDetails = holdings.map((h) => {
  const buyPrice = Number(h.buyPrice || 0);
  const currentPrice = Number(h.currentPrice || buyPrice || 0);
  const qty = Number(h.qty || 0);
  const highestPrice = Number(h.highestPrice || currentPrice || buyPrice || 0);
  const trailingStopRate = Number(h.trailingStopRate || 0);

  const profit = (currentPrice - buyPrice) * qty;
  const buyAmount = buyPrice * qty;
const evalAmount = currentPrice * qty;

const buyTimeMs = Number(h.buyTimeMs || 0);
const holdingDays = buyTimeMs > 0
  ? Math.max(0, Math.floor((Date.now() - buyTimeMs) / (1000 * 60 * 60 * 24)))
  : 0;


  const profitRate =
    buyPrice > 0 ? ((currentPrice - buyPrice) / buyPrice) * 100 : 0;

  const highestProfitRate =
    buyPrice > 0 ? ((highestPrice - buyPrice) / buyPrice) * 100 : 0;

  const drawdownFromHigh =
    highestPrice > 0 ? ((currentPrice - highestPrice) / highestPrice) * 100 : 0;




return {
  code: h.code,
  name: h.name,
  buyPrice,
  currentPrice,
  qty,
  buyAmount,
  evalAmount,
  holdingDays,
  profit,
  profitRate,
  highestPrice,
  highestProfitRate,
  drawdownFromHigh,

  trailingActive: !!h.trailingActive,
  targetTouched: !!h.targetTouched,
  trailingStartPrice: Number(
  h.trailingStartPrice || 0
),
  trailingStopRate,
  stopLossPrice: Number(h.stopLossPrice || 0),

  strategyGroup: h.strategyGroup || "CORE",
  strategyName: h.strategyName || "",
  strategyPreset: h.strategyPreset || "",
  discoverScore: Number(h.discoverScore || 0),

  finalBuyScore: Number(h.finalBuyScore || h.finalBuyScoreDetail?.score || 0),
  finalBuyScoreDetail: h.finalBuyScoreDetail || null,
  marketScore: h.marketScore || null,
  sectorPowerScore: Number(h.sectorPowerScore || h.finalBuyScoreDetail?.sectorPowerScore || 0),
  
  discoverScoreDetails: h.discoverScoreDetails || {},
  discoverReasons: h.discoverReasons || [],
  sectorTags: h.sectorTags || [],

  buyTime: h.buyTime || "",
  date: h.date || ""
};

});   

    res.json({
      ok: true,
      summary: {
        totalTrades,
        winTrades: winTrades.length,
        loseTrades: loseTrades.length,
        winRate,
        totalProfit,
        avgProfitRate,
        avgWinRate,
        avgLossRate,
        holdingCount: holdings.length,
        holdingBuyAmount,
        holdingEvalAmount,
        holdingProfit,
        initialCapital,
        currentAsset,
        totalAssetProfit,
        totalAssetProfitRate,
        todayProfit,
        todayProfitRate: todayTotalProfitRate,        
        totalRealizedProfit,
        totalUnrealizedProfit,
        totalCombinedProfit
      },
     holdings: holdingDetails,
     recent7Days,    
     strategyStats,
     recentSells: sellLogs.slice(-20).reverse(),

     marketTemperature: latestMarketTemperature
    });
  } catch (err) {
    console.error("성과분석 API 오류:", err);
    res.status(500).json({
      ok: false,
      message: "성과분석 데이터를 불러오지 못했습니다."
    });
  }
});

app.get("/api/daily-summary", (req, res) => {
  try {
    const state = loadState();
    const tradeLogs = Array.isArray(state.tradeLogs) ? state.tradeLogs : [];
    const holdings = Array.isArray(state.holdings) ? state.holdings : [];

   const sellTypes = [
  "SELL",
  "SELL_ALL",

  "CORE_STOP_LOSS",
  "CORE_FIRST_TAKE_PROFIT",
  "CORE_BREAK_EVEN_SELL",
  "CORE_TRAILING_STOP",
  "CORE_END_SELL",

  "VOLUME_STOP_LOSS",
  "VOLUME_FIRST_TAKE_PROFIT",
  "VOLUME_BREAK_EVEN_SELL",
  "VOLUME_TRAILING_STOP",
  "VOLUME_END_SELL"
];

   const buyTypes = [
  "OPEN_BUY",
  "CORE_BUY",
  "VOLUME_BUY"
];

    const dateMap = {};

    for (const log of tradeLogs) {
      const date = String(log.date || "").slice(0, 10);
      if (!date) continue;

     if (!dateMap[date]) {
  dateMap[date] = {
    date,

    buyCount: 0,
    sellCount: 0,

    winCount: 0,
    lossCount: 0,

    coreProfit: 0,
volumeProfit: 0,

    realizedProfit: 0,

    marketTemperature: null,

   coreWins: 0,
coreTrades: 0,

volumeWins: 0,
volumeTrades: 0,

    bestTrade: null,
    worstTrade: null
  };
}

      const row = dateMap[date];

      if (buyTypes.includes(log.type)) {
        row.buyCount += 1;

        if (!row.marketTemperature && log.marketTemperature) {
          row.marketTemperature = log.marketTemperature;
        }
      }

     if (sellTypes.includes(log.type)) {
  const profit = Number(log.profit || 0);
  const group = log.strategyGroup || "CORE";

  row.sellCount += 1;
  row.realizedProfit += profit;

  if (profit > 0) row.winCount += 1;
  if (profit < 0) row.lossCount += 1;

  if (group === "CORE") {
  row.coreTrades += 1;
  row.coreProfit += profit;

  if (profit > 0) {
    row.coreWins += 1;
  }
}

if (group === "VOLUME") {
  row.volumeTrades += 1;
  row.volumeProfit += profit;

  if (profit > 0) {
    row.volumeWins += 1;
  }
}

  if (!row.bestTrade || profit > row.bestTrade.profit) {
    row.bestTrade = {
      name: log.name,
      code: log.code,
      strategyGroup: group,
      profit,
      profitRate: Number(log.profitRate || 0)
    };
  }

  if (!row.worstTrade || profit < row.worstTrade.profit) {
    row.worstTrade = {
      name: log.name,
      code: log.code,
      strategyGroup: group,
      profit,
      profitRate: Number(log.profitRate || 0)
    };
  }
}
    }

    const today = new Date().toISOString().slice(0, 10);

    const holdingProfit = holdings.reduce((sum, h) => {
      const buyPrice = Number(h.buyPrice || 0);
      const currentPrice = Number(h.currentPrice || buyPrice || 0);
      const qty = Number(h.qty || 0);
      return sum + (currentPrice - buyPrice) * qty;
    }, 0);

    if (dateMap[today]) {
      dateMap[today].holdingProfit = holdingProfit;
      dateMap[today].totalProfit =
        Number(dateMap[today].realizedProfit || 0) + holdingProfit;
    }

    const latestMarketTemperature =
  state.marketTemperature ||
  [...tradeLogs]
    .reverse()
    .find((log) => log.marketTemperature)?.marketTemperature ||
  null;

if (dateMap[today] && latestMarketTemperature) {
  dateMap[today].marketTemperature = latestMarketTemperature;
}

   const rows = Object.values(dateMap)
  .sort((a, b) => b.date.localeCompare(a.date))
  .map((row) => ({
    ...row,

    holdingProfit: Number(row.holdingProfit || 0),

    totalProfit:
      typeof row.totalProfit !== "undefined"
        ? row.totalProfit
        : row.realizedProfit,

    winRate:
      row.sellCount > 0
        ? (row.winCount / row.sellCount) * 100
        : 0,

  coreWinRate:
  row.coreTrades > 0
    ? (row.coreWins / row.coreTrades) * 100
    : 0,

volumeWinRate:
  row.volumeTrades > 0
    ? (row.volumeWins / row.volumeTrades) * 100
    : 0,

   

    bestTrade: row.bestTrade,
    worstTrade: row.worstTrade
  }));

    res.json({
      ok: true,
      rows
    });
  } catch (err) {
    console.error("일일 분석 API 오류:", err);
    res.status(500).json({
      ok: false,
      message: "일일 분석 데이터를 불러오지 못했습니다."
    });
  }
});

app.get("/api/server-auto-toggle", (req, res) => {
  const enabled =
    String(req.query.enabled || "").toLowerCase() === "true";

  const state = setServerAutoEnabled(enabled);

  res.json({
    ok: true,
    serverAutoEnabled: state.serverAutoEnabled,
    serverAutoChangedAt: state.serverAutoChangedAt
  });
});

app.get("/api/today-trade-analysis", (req, res) => {
  try {
    const state = loadState();

    function todayKstText() {
      const now = new Date();
      const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
      return kst.toISOString().slice(0, 10);
    }

    const today = todayKstText();

    const trades = Array.isArray(state.tradeLogs) ? state.tradeLogs : [];

    const todayLogs = trades.filter(log => {
      return String(log.date || "").trim() === today;
    });

   const buyTypes = [
  "OPEN_BUY",
  "CORE_BUY",
  "VOLUME_BUY"
];
  const sellTypes = [
  "SELL",
  "SELL_ALL",

  "CORE_STOP_LOSS",
  "CORE_FIRST_TAKE_PROFIT",
  "CORE_BREAK_EVEN_SELL",
  "CORE_TRAILING_STOP",
  "CORE_END_SELL",

  "VOLUME_STOP_LOSS",
  "VOLUME_FIRST_TAKE_PROFIT",
  "VOLUME_BREAK_EVEN_SELL",
  "VOLUME_TRAILING_STOP",
  "VOLUME_END_SELL"
];

    const buys = todayLogs.filter(log => buyTypes.includes(log.type));
    const sells = todayLogs.filter(log => sellTypes.includes(log.type));

    const realizedProfit = sells.reduce(
      (sum, log) => sum + Number(log.profit || 0),
      0
    );

    const wins = sells.filter(log => Number(log.profit || 0) > 0);
    const losses = sells.filter(log => Number(log.profit || 0) < 0);

    const sellTypeCounts = {};
    sells.forEach(log => {
      sellTypeCounts[log.type] = (sellTypeCounts[log.type] || 0) + 1;
    });

   function getStrategy(log) {
  if (log.strategyGroup) {
    return log.strategyGroup;
  }

  if (log.group) {
    return log.group;
  }

  const type = String(log.type || "");

  if (type.startsWith("OPEN")) {
    return "OPEN";
  }

  if (type.startsWith("VOLUME")) {
    return "VOLUME";
  }

  return "CORE";
}

    const byStrategy = {};

    sells.forEach(log => {
      const strategy = getStrategy(log);
      const profit = Number(log.profit || 0);

      if (!byStrategy[strategy]) {
        byStrategy[strategy] = {
          trades: 0,
          wins: 0,
          losses: 0,
          profit: 0,
          winProfitSum: 0,
          lossProfitSum: 0,
          maxProfit: null,
          maxLoss: null
        };
      }

      const s = byStrategy[strategy];

      s.trades += 1;
      s.profit += profit;

      if (profit > 0) {
        s.wins += 1;
        s.winProfitSum += profit;
      }

      if (profit < 0) {
        s.losses += 1;
        s.lossProfitSum += profit;
      }

      if (s.maxProfit === null || profit > s.maxProfit) {
        s.maxProfit = profit;
      }

      if (s.maxLoss === null || profit < s.maxLoss) {
        s.maxLoss = profit;
      }
    });

    Object.keys(byStrategy).forEach(key => {
      const s = byStrategy[key];

      s.winRate = s.trades > 0 ? (s.wins / s.trades) * 100 : 0;
      s.avgProfit = s.wins > 0 ? s.winProfitSum / s.wins : 0;
      s.avgLoss = s.losses > 0 ? s.lossProfitSum / s.losses : 0;
    });

    res.json({
      ok: true,
      date: today,
      summary: {
        buyCount: buys.length,
        sellCount: sells.length,
        winCount: wins.length,
        lossCount: losses.length,
        winRate: sells.length > 0 ? (wins.length / sells.length) * 100 : 0,
        realizedProfit
      },
      byStrategy,
      sellTypeCounts,
      buys,
      sells
    });
  } catch (err) {
    console.error(err);
    res.json({
      ok: false,
      message: err.message
    });
  }
});

app.get("/api/server-auto-on", (req, res) => {
  const state = setServerAutoEnabled(true);

  res.json({
    ok: true,
    message: "서버 자동매매를 ON으로 변경했습니다.",
    serverAutoEnabled: state.serverAutoEnabled,
    serverAutoChangedAt: state.serverAutoChangedAt
  });
});

app.get("/api/server-auto-buy-once", async (req, res) => {
  try {
    await runServerAutoBuyOnce();

    res.json({
      ok: true,
      message: "서버 자동 모의매수를 1회 실행했습니다."
    });
  } catch (error) {
    console.error("서버 자동매수 1회 실행 오류:", error);

    res.status(500).json({
      ok: false,
      message: error.message
    });
  }
});





app.get("/api/open-buy-once", async (req, res) => {
  try {
    await runOpenBuyOnce();
    res.json({
      ok: true,
      message: "OPEN 자동 모의매수를 1회 실행했습니다."
    });
  } catch (error) {
    console.error("OPEN 자동매수 1회 실행 오류:", error);
    res.status(500).json({ ok: false, message: error.message });
  }
});

app.get("/api/open-sell-once", async (req, res) => {
  try {
    await checkOpenSellOnce();
    res.json({
      ok: true,
      message: "OPEN 자동매도를 1회 점검했습니다."
    });
  } catch (error) {
    console.error("OPEN 자동매도 1회 실행 오류:", error);
    res.status(500).json({ ok: false, message: error.message });
  }
});


app.get("/api/server-auto-sell-once", async (req, res) => {
  try {
    await checkServerAutoSellOnce();

    res.json({
      ok: true,
      message: "서버 자동매도를 1회 실행했습니다."
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error.message
    });
  }
});




app.post("/api/server-log-clear", (req, res) => {
  exec("pm2 flush", (error, stdout, stderr) => {
    if (error) {
      console.error("PM2 로그 삭제 실패:", error);
      return res.status(500).json({
        ok: false,
        message: "서버 로그 삭제 실패",
        error: error.message
      });
    }

    console.log("PM2 서버 로그 삭제 완료");

    res.json({
      ok: true,
      message: "서버 로그를 삭제했습니다.",
      stdout,
      stderr
    });
  });
});

app.post("/api/server-trade-log-clear", (req, res) => {
  try {
 
    const state = JSON.parse(fs.readFileSync(PAPER_STATE_FILE, "utf8"));

    state.tradeLogs = [];

    fs.writeFileSync(
      PAPER_STATE_FILE,
      JSON.stringify(state, null, 2)
    );

    res.json({
      ok: true,
      message: "서버 매매로그를 삭제했습니다."
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error.message
    });
  }
});

app.post("/api/paper-buy", express.json(), (req, res) => {
  try {
   const {
  code,
  name,
  buyPrice,
  qty,
  targetPrice,
  secondTargetPrice,
  stopLossPrice,
  trailingStopRate,
  strategy,
  strategyPreset,
  strategyName,
  protectMinutes,
  breakEvenAfterPartial
} = req.body || {};










    if (!code || !buyPrice || !qty) {
      return res.status(400).json({
        ok: false,
        message: "code, buyPrice, qty는 필수입니다."
      });
    }

  

    let state = {
      holdings: [],
      tradeLogs: [],
      results: []
    };

    if (fs.existsSync(PAPER_STATE_FILE)) {
      state = JSON.parse(
        fs.readFileSync(PAPER_STATE_FILE, "utf8")
      );
    }

    if (!state.holdings) {
      state.holdings = [];
    }

    const exists = state.holdings.some(
      (item) => String(item.code) === String(code)
    );

    if (exists) {
      return res.status(400).json({
        ok: false,
        message: "이미 서버 보유종목에 있습니다."
      });
    }

    state.holdings.push({
      code: String(code),
      name: name || String(code),
      buyPrice: Number(buyPrice),
      qty: Number(qty),
      currentPrice: Number(buyPrice),
      targetPrice: Number(targetPrice || 0),
      secondTargetPrice: Number(secondTargetPrice || 0),
      stopLossPrice: Number(stopLossPrice || 0),
      trailingStopRate: Number(trailingStopRate || 0),
      strategy: strategy || "auto",
strategyPreset: strategyPreset || strategy || "auto",
strategyName: strategyName || "자동전략",
status: "WAITING",
highestPrice: Number(buyPrice),

originalStopLossPrice: Number(stopLossPrice || 0),
protectMinutes: Number(protectMinutes || 3),
breakEvenAfterPartial: breakEvenAfterPartial !== false,
partialSold: false,

buyAt: new Date().toISOString(),
buyTimeMs: Date.now()


    });

    fs.writeFileSync(
      PAPER_STATE_FILE,
      JSON.stringify(state, null, 2)
    );

    res.json({
      ok: true,
      message: "서버 모의매수 등록 완료",
      holdings: state.holdings
    });
  } catch (error) {
    console.error("서버 모의매수 등록 실패:", error);

    res.status(500).json({
      ok: false,
      message: error.message
    });
  }
});


app.post("/api/paper-sell", (req, res) => {
  try {
    const {
      code,
      qty,
      sellPrice,
      reason,
      actionType
    } = req.body || {};

    if (!code) {
      return res.status(400).json({
        ok: false,
        message: "종목코드가 없습니다."
      });
    }

    const sellQty = Number(qty || 0);
    const price = Number(sellPrice || 0);

    if (!sellQty || sellQty <= 0) {
      return res.status(400).json({
        ok: false,
        message: "매도 수량이 올바르지 않습니다."
      });
    }

    if (!price || price <= 0) {
      return res.status(400).json({
        ok: false,
        message: "매도 단가가 올바르지 않습니다."
      });
    }

   
    let state = {
      holdings: [],
      tradeLogs: [],
      virtualResults: []
    };

    if (fs.existsSync(PAPER_STATE_FILE)) {
      state = JSON.parse(
        fs.readFileSync(PAPER_STATE_FILE, "utf8")
      );
    }

    state.holdings = state.holdings || [];
    state.tradeLogs = state.tradeLogs || [];
    state.virtualResults =
      state.virtualResults || state.results || [];

    const holding = state.holdings.find(
      (item) => String(item.code) === String(code)
    );

    if (!holding) {
      return res.status(404).json({
        ok: false,
        message: "서버 보유종목에 없습니다."
      });
    }

    if (sellQty > Number(holding.qty || 0)) {
      return res.status(400).json({
        ok: false,
        message: "매도 수량이 보유수량보다 많습니다."
      });
    }

    const buyPrice = Number(holding.buyPrice || 0);
    const buyAmount = buyPrice * sellQty;
    const sellAmount = price * sellQty;
    const profit = sellAmount - buyAmount;
    const profitRate =
      buyAmount > 0 ? (profit / buyAmount) * 100 : 0;

    const now = new Date();

state.tradeLogs.push({
  type:
    actionType === "SELL"
      ? "SELL"
      : actionType || "SELL_ALL",
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
  reason: reason || "서버 매도",
  strategyPreset: holding.strategyPreset,
  strategyName: holding.strategyName,
  strategyGroup: holding.strategyGroup || "CORE",
  date: now.toISOString().slice(0, 10),
  time: now.toLocaleString("ko-KR")
});

state.totalCash = Number(state.totalCash || 0) + sellAmount;

    state.virtualResults.push({
      code: holding.code,
      name: holding.name,
      buyPrice,
      sellPrice: price,
      qty: sellQty,
      buyAmount,
      sellAmount,
      profit,
      profitRate,
      reason: reason || "서버 매도",
      time: now.toLocaleString("ko-KR"),
      date: now.toISOString().slice(0, 10)
    });

    state.results = state.virtualResults;

holding.qty = Number(holding.qty || 0) - sellQty;

if (holding.qty <= 0) {
  state.holdings = state.holdings.filter(
    (item) => String(item.code) !== String(code)
  );
} else {
  holding.partialSold = true;

  if (holding.breakEvenAfterPartial !== false) {
    holding.stopLossPrice = Math.max(
      Number(holding.stopLossPrice || 0),
      Number(holding.buyPrice || 0)
    );
  }

  holding.status = "PARTIAL_SOLD";
}




    state.lastSellCheckAt =
      now.toLocaleString("ko-KR");

    fs.writeFileSync(
      PAPER_STATE_FILE,
      JSON.stringify(state, null, 2)
    );

    res.json({
      ok: true,
      message: "서버 매도 처리 완료",
      holdings: state.holdings,
      tradeLogs: state.tradeLogs,
      virtualResults: state.virtualResults
    });
  } catch (error) {
    console.error("서버 매도 처리 실패:", error);

    res.status(500).json({
      ok: false,
      message: error.message || "서버 매도 처리 실패"
    });
  }
});


app.get("/api/paper-sell-all", async (req, res) => {
  try {
    const code = String(req.query.code || "").trim();

    if (!code) {
      return res.status(400).json({
        ok: false,
        message: "종목코드가 없습니다."
      });
    }

  

    const paperState = JSON.parse(
      fs.readFileSync(PAPER_STATE_FILE, "utf8")
    );

    paperState.holdings = paperState.holdings || [];
    paperState.tradeLogs = paperState.tradeLogs || [];
    paperState.virtualResults = paperState.virtualResults || [];

    const holding = paperState.holdings.find(
      (item) => item.code === code
    );

    if (!holding) {
      return res.status(404).json({
        ok: false,
        message: "서버 보유종목을 찾을 수 없습니다."
      });
    }

    const sellPrice = Number(holding.currentPrice || holding.buyPrice || 0);
    const qty = Number(holding.qty || 0);
    const buyPrice = Number(holding.buyPrice || 0);

    const buyAmount = buyPrice * qty;
    const sellAmount = sellPrice * qty;
    const profit = sellAmount - buyAmount;
    const profitRate = buyAmount > 0 ? (profit / buyAmount) * 100 : 0;

    paperState.holdings = paperState.holdings.filter(
      (item) => item.code !== code
    );

    paperState.tradeLogs.push({
  type: "SELL_ALL",
  code: holding.code,
  name: holding.name,
  price: sellPrice,
  qty,

  buyPrice,
  sellPrice,
  buyAmount,
  sellAmount,
  profit,
  profitRate,

  strategyGroup: holding.strategyGroup || "CORE",
  strategyPreset: holding.strategyPreset || "",
  strategyName: holding.strategyName || "",

  reason: "사용자 서버 수동매도",
  time: new Date().toLocaleString("ko-KR"),
  date: new Date().toISOString().slice(0, 10)
});

paperState.totalCash =
  Number(paperState.totalCash || 0) + sellAmount;

    paperState.virtualResults.push({
      code: holding.code,
      name: holding.name,
      buyPrice,
      sellPrice,
      qty,
      buyAmount,
      sellAmount,
      profit,
      profitRate,
      reason: "사용자 서버 수동매도",
      time: new Date().toLocaleString("ko-KR"),
      date: new Date().toISOString().slice(0, 10)
    });

    fs.writeFileSync(
      PAPER_STATE_FILE,
      JSON.stringify(paperState, null, 2)
    );

    res.json({
      ok: true,
      message: "서버 수동매도 완료",
      code,
      profit,
      profitRate
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error.message
    });
  }
});

app.get("/api/refresh-holding-prices", async (req, res) => {
  try {
    await refreshServerHoldingPrices();

    res.json({
      ok: true,
      message: "서버 보유종목 현재가 갱신 완료"
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error.message
    });
  }
});


app.listen(PORT, () => {
  console.log(`서버 실행중: ${PORT}`);

  // OPEN은 09:00~09:30 독립 실행하고, 완료 후 CORE/VOLUME이 진행됩니다.
  startOpenStrategy();
  startServerAutoTrader();
});