exports.handler = async function (event) {
  exports.handler = async function (event) {
  // 브라우저가 사전 확인 요청을 보낼 때 대비
  if (event.httpMethod === "OPTIONS") {
    return json(200, {
      ok: true,
      points: []
    });
  }

  if (event.httpMethod !== "GET" && event.httpMethod !== "POST") {
    return json(405, {
      error: "Method Not Allowed",
      method: event.httpMethod,
      points: []
    });
  }

  const key = process.env.KAKAO_REST_API_KEY;

  if (!key) {
    return json(500, { error: "KAKAO_REST_API_KEY 없음", points: [] });
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

  const attempts = [
    {
      name: "자전거도로 우선",
      url: buildBikeUrl(from, to, "BIKE_ROAD")
    },
    {
      name: "자전거 최단/겸용도로",
      url: buildBikeUrl(from, to, "DISTANCE")
    },
    {
      name: "자동차 겸용도로",
      url: buildCarUrl(from, to)
    }
  ];

  for (const attempt of attempts) {
    try {
      const res = await fetch(attempt.url, {
        headers: {
          Authorization: `KakaoAK ${key}`,
          service: "ride-map",
          accept: "application/json",
          "Content-Type": "application/json"
        }
      });

      const data = await res.json();

      if (!res.ok) {
        console.log(attempt.name, res.status, data);
        continue;
      }

      const points = extractPoints(data);

      if (points.length >= 2) {
        return json(200, {
          source: attempt.name,
          points
        });
      }
    } catch (e) {
      console.log(attempt.name, e.message);
    }
  }

  return json(200, {
  source: "fallback",
  fallback: true,
  error: "카카오 길찾기 실패",
  points: []
});

function buildBikeUrl(from, to, priority) {
  const params = new URLSearchParams({
    origin: `${from.lng},${from.lat}`,
    destination: `${to.lng},${to.lat}`,
    waypoints: "",
    radius: "5000",
    priority,
    summary: "false"
  });

  return `https://apis-navi.kakaomobility.com/affiliate/bicycle/v1/directions?${params.toString()}`;
}

function buildCarUrl(from, to) {
  const params = new URLSearchParams({
    origin: `${from.lng},${from.lat}`,
    destination: `${to.lng},${to.lat}`,
    priority: "RECOMMEND",
    summary: "false"
  });

  return `https://apis-navi.kakaomobility.com/affiliate/v1/directions?${params.toString()}`;
}

function extractPoints(data) {
  const points = [];

  const routes = Array.isArray(data.routes) ? data.routes : [];

  routes.forEach(route => {
    const sections = Array.isArray(route.sections) ? route.sections : [];

    sections.forEach(section => {
      const roads = Array.isArray(section.roads) ? section.roads : [];

      roads.forEach(road => {
        const vertexes = Array.isArray(road.vertexes) ? road.vertexes : [];

        for (let i = 0; i < vertexes.length - 1; i += 2) {
          const lng = Number(vertexes[i]);
          const lat = Number(vertexes[i + 1]);

          if (Number.isFinite(lat) && Number.isFinite(lng)) {
            points.push({ lat, lng });
          }
        }
      });
    });
  });

  return removeDuplicatePoints(points);
}

function removeDuplicatePoints(points) {
  const result = [];

  points.forEach(p => {
    const last = result[result.length - 1];

    if (
      last &&
      Math.abs(last.lat - p.lat) < 0.000001 &&
      Math.abs(last.lng - p.lng) < 0.000001
    ) {
      return;
    }

    result.push(p);
  });

  return result;
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