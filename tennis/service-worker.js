self.addEventListener("install", (e) => {
  console.log("Service Worker installed");
});

self.addEventListener("fetch", (e) => {
  // 기본 패스 (오프라인 캐싱 추가 가능)
});