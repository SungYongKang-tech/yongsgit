require("dotenv").config();

const express = require("express");
const cors = require("cors");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

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

function getSavedToken() {
  return fs.readFileSync("token.txt", "utf8").trim();
}

function cleanNumber(value) {
  if (!value) return "";
  return String(value).replace(/[+-]/g, "");
}

app.get("/", (req, res) => {
  res.send("Kiwoom Auto Trader Server is running");
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
        const name = String(item.name || "")
          .replace(/\s/g, "")
          .toLowerCase();

        const code = String(item.code || "");

        return (
          name.includes(normalizedKeyword) ||
          code.includes(normalizedKeyword)
        );
      })
      .slice(0, 30);

    return res.json({ items: matched });
  } catch (error) {
    console.error("/api/search 오류:", error);
    return res.status(500).json({
      message: "종목 검색 실패",
      error: error.message
    });
  }
});

app.get("/api/price", async (req, res) => {
  try {
    const token = getSavedToken();
    const code = String(req.query.code || "").trim();

    if (!code) {
      return res.status(400).json({ message: "종목코드가 없습니다." });
    }

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

app.get("/price/:code", async (req, res) => {
  try {
    const token = getSavedToken();
    const code = req.params.code;

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

    const token = getSavedToken();

    const response = await fetch(
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

    const data = await response.json();

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

app.listen(PORT, () => {
  console.log(`서버 실행 중: http://localhost:${PORT}`);
});

const {
  startServerAutoTrader,
  runServerAutoBuyOnce,
  loadState
} = require("./auto-trader");

startServerAutoTrader();

app.get("/api/paper-state", (req, res) => {
  res.json(loadState());
});

app.get("/api/server-auto-buy-once", async (req, res) => {
  await runServerAutoBuyOnce();
  res.json({
    ok: true,
    message: "서버 자동 모의매수를 1회 실행했습니다."
  });
});