require("dotenv").config();

const axios = require("axios");
const fs = require("fs");

function getSavedToken() {
  return fs.readFileSync("token.txt", "utf8").trim();
}

async function fetchMarketStocks(marketCode) {
  const token = getSavedToken();

  const url = `${process.env.KIWOOM_BASE_URL}/api/dostk/stkinfo`;

  const res = await axios.post(
    url,
    {
      mrkt_tp: marketCode
    },
    {
      headers: {
        "Content-Type": "application/json;charset=UTF-8",
        authorization: `Bearer ${token}`,
        "api-id": "ka10099"
      }
    }
  );

  return res.data.list || res.data.items || res.data.output || [];
}

async function main() {
  const result = [];
  const seen = new Set();

  const markets = [
    { code: "0", name: "KOSPI" },
    { code: "10", name: "KOSDAQ" }
  ];

  for (const market of markets) {
    console.log("조회 중:", market.name);

    const items = await fetchMarketStocks(market.code);

    for (const item of items) {
      const code = String(
        item.code || item.stk_cd || item.stock_code || ""
      ).replace(/\D/g, "").padStart(6, "0");

      const name = String(
        item.name || item.stk_nm || item.stock_name || ""
      ).trim();

      if (!/^\d{6}$/.test(code)) continue;
      if (!name) continue;
      if (seen.has(code)) continue;

      result.push({
        code,
        name,
        market: market.name
      });

      seen.add(code);
    }
  }

  fs.writeFileSync(
    "stocks.json",
    JSON.stringify(result, null, 2),
    "utf8"
  );

  console.log("완료:", result.length);
}

main().catch((error) => {
  console.error("실패:", error.response?.data || error.message);
});
