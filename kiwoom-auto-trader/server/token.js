require("dotenv").config();
const axios = require("axios");
const fs = require("fs");

async function getToken() {

  try {

    const url =
      `${process.env.KIWOOM_BASE_URL}/oauth2/token`;

    const res = await axios.post(url, {
      grant_type: "client_credentials",
      appkey: process.env.KIWOOM_APP_KEY,
      secretkey: process.env.KIWOOM_SECRET_KEY
    });

    console.log("토큰 발급 성공");

    const token = res.data.token;

    fs.writeFileSync(
      "token.txt",
      token
    );

    console.log("token.txt 저장 완료");

  } catch (error) {

    console.log("토큰 발급 실패");

    if(error.response){
      console.log(error.response.data);
    }else{
      console.log(error.message);
    }

  }
}

getToken();