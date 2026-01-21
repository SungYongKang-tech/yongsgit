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

    const decode = (s) =>
      (s || "")
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");

    const itemBlocks = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)]
      .slice(0, 60)
      .map((m) => m[1]);

    const pick = (block, tag) => {
      const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
      return m ? decode(m[1].trim()) : "";
    };

    const pickSource = (block) => {
      const m = block.match(/<source[^>]*>([\s\S]*?)<\/source>/);
      return m ? decode(m[1].trim()) : "";
    };

    // 제목 정규화: "제목 - 언론사" 꼬리 제거, 괄호/특수문자 정리
    const normalizeTitle = (t) => {
      let s = (t || "").trim();

      // " - 언론사" 꼬리 제거(흔한 패턴)
      s = s.replace(/\s*-\s*[^-]{2,25}$/u, "").trim();

      // 대괄호/소괄호 안의 짧은 꼬리 제거(예: [속보], (종합), (영상) 등)
      s = s.replace(/\[[^\]]{1,10}\]\s*/g, "").trim();
      s = s.replace(/\((속보|종합|단독|영상|포토|인터뷰|기획|현장|칼럼|사설|분석)\)/g, "").trim();

      // 불필요 기호 정리
      s = s.replace(/[“”"']/g, "");
      s = s.replace(/[·•]/g, " ");
      s = s.replace(/\s+/g, " ").trim();

      return s;
    };

    // 토큰화(비슷한 제목도 묶기용)
    const tokenize = (s) =>
      normalizeTitle(s)
        .toLowerCase()
        .replace(/[^0-9a-z가-힣\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 2 && !["기자", "뉴스", "단독", "속보", "종합"].includes(w));

    const jaccard = (aTokens, bTokens) => {
      const A = new Set(aTokens);
      const B = new Set(bTokens);
      let inter = 0;
      for (const x of A) if (B.has(x)) inter++;
      const union = A.size + B.size - inter;
      return union === 0 ? 0 : inter / union;
    };

    const cleanLink = (link) => (link || "").split("&utm_")[0];

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

    // 2) 그룹핑(중복 제거 + 유사 제목 묶기)
    // 기준:
    // - normalizedTitle가 같으면 무조건 같은 그룹
    // - 아니면 토큰 유사도(Jaccard) >= 0.78면 같은 그룹로 묶기
    const groups = [];
    const normIndex = new Map(); // normalizedTitle -> groupIndex

    for (const it of items) {
      const norm = normalizeTitle(it.title);
      const toks = tokenize(it.title);

      // 2-1) 정확 매칭
      if (normIndex.has(norm)) {
        const gi = normIndex.get(norm);
        groups[gi].articles.push(it);
        continue;
      }

      // 2-2) 유사도 매칭
      let bestIdx = -1;
      let bestScore = 0;

      for (let i = 0; i < groups.length; i++) {
        const g = groups[i];
        const score = jaccard(toks, g._tokens);
        if (score > bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      }

      if (bestScore >= 0.65 && bestIdx >= 0) {
        groups[bestIdx].articles.push(it);
        // 이 norm도 같은 그룹로 인덱싱(다음부터 빨리 매칭)
        normIndex.set(norm, bestIdx);
      } else {
        const gid = `g_${hash(norm)}`;
        groups.push({
          id: gid,
          title: norm || it.title,
          _tokens: toks,
          articles: [it],
        });
        normIndex.set(norm, groups.length - 1);
      }
    }

    // 3) 그룹 내부 정리: 같은 링크 중복 제거 + 최신순 정렬(대략)
    for (const g of groups) {
      const seen = new Set();
      g.articles = g.articles
        .filter((a) => {
          if (seen.has(a.link)) return false;
          seen.add(a.link);
          return true;
        })
        .sort((a, b) => {
          // pubDate 문자열은 포맷이 제각각일 수 있어 Date로 파싱 시도
          const da = Date.parse(a.pubDate || "") || 0;
          const db = Date.parse(b.pubDate || "") || 0;
          return db - da;
        });

      // 대표 날짜/대표 출처(첫 기사 기준)
      g.pubDate = g.articles[0]?.pubDate || "";
      g.sources = [...new Set(g.articles.map((a) => a.source).filter(Boolean))];

      // 내부 키 제거(응답 payload는 깔끔하게)
      delete g._tokens;
    }

    // 4) 그룹 정렬(최신 그룹이 위로)
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
        keyword: "한국남동발전",
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

// 간단 해시(그룹 id용)
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < (str || "").length; i++) {
    h ^= (str.charCodeAt(i) & 0xff);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}
