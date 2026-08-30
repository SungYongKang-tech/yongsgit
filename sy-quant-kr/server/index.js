const express = require("express");
const cors = require("cors");
const axios = require("axios");
const fs = require("fs");
require("dotenv").config();

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

function cleanNumber(value) {
  if (!value) return "0";
  return String(value).replace(/[+-]/g, "");
}

async function issueAccessToken() {
  const response = await axios.post(
    "https://api.kiwoom.com/oauth2/token",
    {
      grant_type: "client_credentials",
      appkey: process.env.APP_KEY,
      secretkey: process.env.APP_SECRET,
    },
    {
      headers: {
        "Content-Type": "application/json;charset=UTF-8",
      },
    }
  );

  const token = response.data.token;
  fs.writeFileSync("token.txt", token);

  return token;
}

function getSavedToken() {
  try {
    return fs.readFileSync("token.txt", "utf8").trim();
  } catch {
    return null;
  }
}

async function getAccessToken() {
  let token = getSavedToken();

  if (!token) {
    token = await issueAccessToken();
  }

  return token;
}

app.get("/", (req, res) => {
  res.send("키움 서버 정상 동작중!");
});

app.get("/api/token", async (req, res) => {
  try {
    const token = await issueAccessToken();

    res.json({
      message: "토큰 발급 성공",
      token,
    });
  } catch (error) {
    res.status(500).json({
      message: "토큰 발급 실패",
      error: error.response?.data || error.message,
    });
  }
});

app.get("/api/price", async (req, res) => {
  try {
    const accessToken = await getAccessToken();
    const code = req.query.code || "005930";

    const response = await axios.post(
      "https://api.kiwoom.com/api/dostk/stkinfo",
      {
        stk_cd: code,
      },
      {
        headers: {
          "Content-Type": "application/json;charset=UTF-8",
          authorization: `Bearer ${accessToken}`,
          "cont-yn": "N",
          "next-key": "",
          "api-id": "ka10001",
        },
      }
    );

    res.json(response.data);
  } catch (error) {
    res.status(500).json({
      message: "현재가 조회 실패",
      error: error.response?.data || error.message,
    });
  }
});

app.get("/api/daily", async (req, res) => {
  try {
    const accessToken = await getAccessToken();

    const code = String(req.query.code || "").trim();
    const days = Number(req.query.days || 30);

    if (!code) {
      return res.status(400).json({
        message: "종목코드가 필요합니다.",
      });
    }

    const today = new Date();
    const baseDate =
      today.getFullYear().toString() +
      String(today.getMonth() + 1).padStart(2, "0") +
      String(today.getDate()).padStart(2, "0");

    const response = await axios.post(
      "https://api.kiwoom.com/api/dostk/chart",
      {
        stk_cd: code,
        base_dt: baseDate,
        upd_stkpc_tp: "1",
      },
      {
        headers: {
          "Content-Type": "application/json;charset=UTF-8",
          authorization: `Bearer ${accessToken}`,
          "cont-yn": "N",
          "next-key": "",
          "api-id": "ka10081",
        },
      }
    );

    const data = response.data;

    const rawItems =
      data.stk_dt_pole_chart_qry ||
      data.output ||
      data.items ||
      [];

    const items = rawItems
      .slice(0, days)
      .map((item) => ({
        date: item.dt || item.date || item.stk_bsop_date,
        open: Number(cleanNumber(item.open_pric || item.open)),
        high: Number(cleanNumber(item.high_pric || item.high)),
        low: Number(cleanNumber(item.low_pric || item.low)),
        close: Number(cleanNumber(item.cur_prc || item.close_pric || item.close)),
        volume: Number(cleanNumber(item.trde_qty || item.volume)),
      }))
      .filter((item) => item.close > 0)
      .reverse();

    res.json({
      code,
      days,
      count: items.length,
      items,
      raw: data,
    });
  } catch (error) {
    res.status(500).json({
      message: "일봉 조회 실패",
      error: error.response?.data || error.message,
    });
  }
});

app.get("/api/stocks", (req, res) => {
  try {
    const raw = fs.readFileSync("stocks.json", "utf8");

    const stocks = JSON.parse(raw);

    res.json({
      success: true,
      count: stocks.length,
      items: stocks,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "전체 종목 목록 조회 실패",
      error: error.message,
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`서버 실행중 : ${PORT}`);
});
