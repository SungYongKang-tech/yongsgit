exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return json(200, { ok: true, points: [] });
  }

  if (event.httpMethod !== "GET" && event.httpMethod !== "POST") {
    return json(405, {
      error: "Method Not Allowed",
      method: event.httpMethod,
      points: []
    });
  }

  const q = event.queryStringParameters || {};

  const from = {
    lat: Number(q.fromLat),
    lng: Number(q.fromLng)
  };

  const to = {
    lat: Number(q.toLat),
    lng: Number(q.toLng)
  };

  if (!validPoint(from) || !validPoint(to)) {
    return json(400, { error: "좌표 오류", points: [] });
  }

  try {
    const points = await requestOsrmRoute(from, to);

    if (points.length >= 3) {
      return json(200, {
        source: "OSRM 도로 경로",
        points
      });
    }

    return json(200, {
      source: "fallback",
      fallback: true,
      error: "OSRM 경로 좌표 부족",
      points: []
    });
  } catch (e) {
    return json(200, {
      source: "fallback",
      fallback: true,
      error: "OSRM 길찾기 실패",
      detail: e.message,
      points: []
    });
  }
};

async function requestOsrmRoute(from, to) {
  const url =
    "https://router.project-osrm.org/route/v1/driving/" +
    `${from.lng},${from.lat};${to.lng},${to.lat}` +
    "?overview=full&geometries=geojson";

  const res = await fetch(url);
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.message || "OSRM 응답 실패");
  }

  const coords = data.routes?.[0]?.geometry?.coordinates;

  if (!Array.isArray(coords)) {
    throw new Error("OSRM 경로 없음");
  }

  return coords
    .map(([lng, lat]) => ({ lat, lng }))
    .filter(validPoint);
}

function validPoint(p) {
  return (
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    p.lat >= -90 &&
    p.lat <= 90 &&
    p.lng >= -180 &&
    p.lng <= 180
  );
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    },
    body: JSON.stringify(body)
  };
}