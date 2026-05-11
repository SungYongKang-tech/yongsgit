require("dotenv").config();
const axios = require("axios");
const fs = require("fs");

async function getPrice(stockCode) {
  try {
    const token = fs.readFileSync("token.txt", "utf8").trim();

    const url = `${process.env.KIWOOM_BASE_URL}/api/dostk/stkinfo`;

    const res = await axios.post(
      url,
      {
        stk_cd: stockCode
      },
      {
        headers: {
          "Content-Type": "application/json;charset=UTF-8",
          "authorization": `Bearer ${token}`,
          "api-id": "ka10001"
        }
      }
    );

    console.log("현재가 조회 성공");
    console.log(JSON.stringify(res.data, null, 2));

  } catch (error) {
    console.log("현재가 조회 실패");

    if (error.response) {
      console.log(error.response.status);
      console.log(error.response.data);
    } else {
      console.log(error.message);
    }
  }
}

getPrice("005930");