exports.handler = async (event) => {
  // ✅ q 파라미터 받기 (없으면 기본값: 발전5개사 OR ... )
  const q =
    (event?.queryStringParameters?.q || "").trim() ||
    "발전5개사 OR 남동발전 OR 남부발전 OR 중부발전 OR 서부발전 OR 동서발전";

  // ✅ Google 뉴스 RSS URL 동적 생성
  const RSS_URL =
    "https://news.google.com/rss/search?q=" +
    encodeURIComponent(q) +
    "&hl=ko&gl=KR&ceid=KR:ko";

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

    const decode = (s) =>
      (s || "")
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");

    const itemBlocks = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)]
      .slice(0, 80)
      .map((m) => m[1]);

    const pick = (block, tag) => {
      const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
      return m ? decode(m[1].trim()) : "";
    };

    const pickSource = (block) => {
      const m = block.match(/<source[^>]*>([\s\S]*?)<\/source>/);
      return m ? decode(m[1].trim()) : "";
    };

    const cleanLink = (link) => (link || "").split("&utm_")[0];

    // 제목 정규화: 꼬리( - 언론사 ), 속보/종합 등 제거, 기호 정리
    const normalizeTitle = (t) => {
      let s = (t || "").trim();
      s = s.replace(/\s*-\s*[^-]{2,40}$/u, "").trim(); // - 언론사
      s = s.replace(/\[[^\]]{1,12}\]\s*/g, "").trim(); // [속보]
      s = s
        .replace(
          /\((속보|종합|단독|영상|포토|인터뷰|기획|현장|칼럼|사설|분석)\)/g,
          ""
        )
        .trim();

      s = s.replace(/[“”"']/g, "");
      s = s.replace(/[·•]/g, " ");
      s = s.replace(/[’]/g, "");
      s = s.replace(/\s+/g, " ").trim();
      return s;
    };

    // 토큰화: 한글/영문/숫자만 남기고 분리
    const tokenize = (s) =>
      normalizeTitle(s)
        .toLowerCase()
        .replace(/[^0-9a-z가-힣\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 2)
        .filter((w) => !["기자", "뉴스", "속보", "종합", "단독", "관련"].includes(w));

    // Set 기반 Jaccard
    const jaccard = (aTokens, bTokens) => {
      const A = new Set(aTokens);
      const B = new Set(bTokens);
      let inter = 0;
      for (const x of A) if (B.has(x)) inter++;
      const union = A.size + B.size - inter;
      return union === 0 ? 0 : inter / union;
    };

    // 공통 토큰 개수
    const overlapCount = (aTokens, bTokens) => {
      const A = new Set(aTokens);
      const B = new Set(bTokens);
      let inter = 0;
      for (const x of A) if (B.has(x)) inter++;
      return inter;
    };

    // 한국어에 강한 문자 기반 유사도(Dice coefficient over bigrams)
    const bigrams = (s) => {
      const t = normalizeTitle(s).toLowerCase().replace(/\s+/g, " ").trim();
      const arr = [];
      for (let i = 0; i < t.length - 1; i++) {
        const bg = t.slice(i, i + 2);
        if (bg.trim().length === 0) continue;
        arr.push(bg);
      }
      return arr;
    };

    const dice = (a, b) => {
      const A = bigrams(a);
      const B = bigrams(b);
      if (!A.length || !B.length) return 0;

      const m = new Map();
      for (const x of A) m.set(x, (m.get(x) || 0) + 1);

      let inter = 0;
      for (const x of B) {
        const c = m.get(x) || 0;
        if (c > 0) {
          inter++;
          m.set(x, c - 1);
        }
      }
      return (2 * inter) / (A.length + B.length);
    };

    // 1) RSS 아이템 파싱
    const items = itemBlocks
      .map((b) => {
        const title = pick(b, "title");
        const link = cleanLink(pick(b, "link"));
        const pubDate = pick(b, "pubDate");
        const source = pickSource(b);
        return { title, link, pubDate, source };
      })
      .filter((x) => x.title && x.link);

    // 2) 그룹핑
    const groups = [];
    const normIndex = new Map();

    for (const it of items) {
      const norm = normalizeTitle(it.title);
      const toks = tokenize(it.title);

      if (normIndex.has(norm)) {
        groups[normIndex.get(norm)].articles.push(it);
        continue;
      }

      let bestIdx = -1;
      let bestScore = 0;

      for (let i = 0; i < groups.length; i++) {
        const g = groups[i];

        const ov = overlapCount(toks, g._tokens);
        if (ov < 1) continue;

        const jac = jaccard(toks, g._tokens);
        const di = dice(norm, g._normTitle);

        const score = Math.max(jac, di);

        if (score > bestScore && (jac >= 0.40 || di >= 0.50)) {
          bestScore = score;
          bestIdx = i;
        }
      }

      if (bestIdx >= 0) {
        groups[bestIdx].articles.push(it);
        normIndex.set(norm, bestIdx);
      } else {
        const gid = `g_${hash(norm)}`;
        groups.push({
          id: gid,
          title: norm || it.title,
          _normTitle: norm || it.title,
          _tokens: toks,
          articles: [it],
        });
        normIndex.set(norm, groups.length - 1);
      }
    }

    // 3) 그룹 내부 정리
    for (const g of groups) {
      const seen = new Set();
      g.articles = g.articles
        .filter((a) => {
          if (seen.has(a.link)) return false;
          seen.add(a.link);
          return true;
        })
        .sort((a, b) => {
          const da = Date.parse(a.pubDate || "") || 0;
          const db = Date.parse(b.pubDate || "") || 0;
          return db - da;
        });

      g.pubDate = g.articles[0]?.pubDate || "";
      g.sources = [...new Set(g.articles.map((a) => a.source).filter(Boolean))];

      delete g._tokens;
      delete g._normTitle;
    }

    // 4) 그룹 정렬
    groups.sort((a, b) => {
      const da = Date.parse(a.pubDate || "") || 0;
      const db = Date.parse(b.pubDate || "") || 0;
      return db - da;
    });

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
      body: JSON.stringify({
        keyword: q,                 // ✅ 여기만 q로 변경
        fetchedAt: new Date().toISOString(),
        groups,
        rawCount: items.length,
        groupCount: groups.length,
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

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < (str || "").length; i++) {
    h ^= str.charCodeAt(i) & 0xff;
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}
