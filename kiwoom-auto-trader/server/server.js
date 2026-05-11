require("dotenv").config();

const express = require("express");
const cors = require("cors");
const axios = require("axios");
const fs = require("fs");

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

function getSavedToken() {
  return fs.readFileSync("token.txt", "utf8").trim();
}

function cleanNumber(value) {
  if (!value) return "";
  return String(value).replace("+", "").replace("-", "");
}

app.get("/", (req, res) => {
  res.send("Kiwoom Auto Trader Server is running");
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
          "api-id": "ka10001",
        },
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
      raw: data,
    });
  } catch (error) {
    res.status(500).json({
      message: "현재가 조회 실패",
      error: error.response?.data || error.message,
    });
  }
});

app.listen(PORT, () => {
  console.log(`서버 실행 중: http://localhost:${PORT}`);
});