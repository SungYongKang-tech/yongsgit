exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method Not Allowed" })
    };
  }

  try {
    const { origin, destination } = JSON.parse(event.body || "{}");

    if (
      !origin || !destination ||
      typeof origin.lat !== "number" || typeof origin.lng !== "number" ||
      typeof destination.lat !== "number" || typeof destination.lng !== "number"
    ) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "origin, destination 좌표가 올바르지 않습니다." })
      };
    }

    const REST_API_KEY = process.env.KAKAO_REST_API_KEY;
    if (!REST_API_KEY) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "KAKAO_REST_API_KEY 환경변수가 설정되지 않았습니다." })
      };
    }

    // 카카오모빌리티 자동차 길찾기
    // origin, destination은 "경도,위도" 문자열로 전달
    const params = new URLSearchParams({
      origin: `${origin.lng},${origin.lat}`,
      destination: `${destination.lng},${destination.lat}`,
      priority: "DISTANCE",
      avoid: "motorway,toll"
    });

    const resp = await fetch(`https://apis-navi.kakaomobility.com/v1/directions?${params.toString()}`, {
      method: "GET",
      headers: {
        Authorization: `KakaoAK ${REST_API_KEY}`,
        "Content-Type": "application/json"
      }
    });

    const json = await resp.json();

    if (!resp.ok) {
      return {
        statusCode: resp.status,
        body: JSON.stringify(json)
      };
    }

    // 응답에서 도로 좌표 추출
    const routes = json?.routes || [];
    if (!routes.length) {
      return {
        statusCode: 200,
        body: JSON.stringify({ path: [], summary: null })
      };
    }

    const route = routes[0];
    const sections = route.sections || [];
    const path = [];

    for (const section of sections) {
      const roads = section.roads || [];
      for (const road of roads) {
        const verts = road.vertexes || [];
        for (let i = 0; i < verts.length; i += 2) {
          const lng = Number(verts[i]);
          const lat = Number(verts[i + 1]);

          if (Number.isFinite(lat) && Number.isFinite(lng)) {
            path.push({ lat, lng });
          }
        }
      }
    }

    const summary = {
      distance: route.summary?.distance ?? null,
      duration: route.summary?.duration ?? null
    };

    return {
      statusCode: 200,
      body: JSON.stringify({ path, summary })
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: err.message || "internal server error"
      })
    };
  }
};