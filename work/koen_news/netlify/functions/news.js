// netlify/functions/news.js
exports.handler = async () => {
  const RSS_URL =
    "https://news.google.com/rss/search?q=%ED%95%9C%EA%B5%AD%EB%82%A8%EB%8F%99%EB%B0%9C%EC%A0%84&hl=ko&gl=KR&ceid=KR:ko";

  try {
    const res = await fetch(RSS_URL, {
      headers: { "User-Agent": "Mozilla/5.0 (Netlify Function)" },
    });

    if (!res.ok) {
      return {
        statusCode: 502,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ error: "RSS fetch failed", status: res.status }),
      };
    }

    const xml = await res.text();

    // item 블록 추출
    const itemBlocks = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)]
      .slice(0, 40)
      .map((m) => m[1]);

    const decode = (s) =>
      (s || "")
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");

    const pick = (block, tag) => {
      const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
      return m ? decode(m[1].trim()) : "";
    };

    const items = itemBlocks
      .map((b) => {
        const title = pick(b, "title");
        const link = pick(b, "link");
        const pubDate = pick(b, "pubDate");
        const source = (() => {
          const m = b.match(/<source[^>]*>([\s\S]*?)<\/source>/);
          return m ? decode(m[1].trim()) : "";
        })();

        // Google News RSS link에 tracking이 붙는 경우가 있어 기본 정리(가벼운 수준)
        const cleanLink = link.split("&utm_")[0];

        return { title, link: cleanLink, pubDate, source };
      })
      .filter((x) => x.title && x.link);

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
      body: JSON.stringify({
        keyword: "한국남동발전",
        fetchedAt: new Date().toISOString(),
        items,
      }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ error: "Server error", message: String(e) }),
    };
  }
};
