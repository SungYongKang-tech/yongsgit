exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method Not Allowed" })
    };
  }

  try {
    const { origin, destination } = JSON.parse(event.body || "{}");

    const REST_API_KEY = process.env.KAKAO_REST_API_KEY;

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

    const routes = json?.routes || [];
    const path = [];

    for (const section of routes[0]?.sections || []) {
      for (const road of section.roads || []) {
        const verts = road.vertexes || [];
        for (let i = 0; i < verts.length; i += 2) {
          path.push({
            lng: verts[i],
            lat: verts[i + 1]
          });
        }
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ path })
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};