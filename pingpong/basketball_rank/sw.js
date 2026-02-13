const CACHE_NAME = "basketball-rank-v1";
const ASSETS = [
  "/pingpong/basketball_rank/",
  "/pingpong/basketball_rank/index.html",
  "/pingpong/basketball_rank/manifest.webmanifest",
  "/pingpong/basketball_rank/icons/icon-192.png",
  "/pingpong/basketball_rank/icons/icon-512.png"
  // 실제로 쓰는 파일이 있으면 추가: style.css, app.js 등
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : null)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
});