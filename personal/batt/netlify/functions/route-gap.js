exports.handler = async function (event) {
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*"
    },
    body: JSON.stringify({
      ok: true,
      message: "route-gap 함수 연결 성공",
      method: event.httpMethod,
      query: event.queryStringParameters || {}
    })
  };
};