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
        body: JSON.stringify({ error: "KAKAO_REST_API_KEY 환경변수가 없습니다." })
      };
    }

    const params = new URLSearchParams({
      origin: `${origin.lng},${origin.lat}`,
      destination: `${destination.lng},${destination.lat}`,
      priority: "DISTANCE",
      avoid: "motorway,toll"
    });

    const url = `https://apis-navi.kakaomobility.com/v1/directions?${params.toString()}`;
    console.log("Kakao route request =", url);

    const resp = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `KakaoAK ${REST_API_KEY}`,
        "Content-Type": "application/json"
      }
    });

    const json = await resp.json();
    console.log("Kakao route response =", JSON.stringify(json));

    if (!resp.ok) {
      return {
        statusCode: resp.status,
        body: JSON.stringify({
          error: "Kakao API error",
          kakao: json
        })
      };
    }

    const routes = json?.routes || [];
    if (!routes.length) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          path: [],
          debug: {
            reason: "routes 없음",
            kakao: json
          }
        })
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

    return {
      statusCode: 200,
      body: JSON.stringify({
        path,
        summary: route.summary || null,
        debug: {
          routeCount: routes.length,
          sectionCount: sections.length,
          pathCount: path.length
        }
      })
    };
  } catch (err) {
    console.error("route function error =", err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: err.message || "internal server error"
      })
    };
  }
};