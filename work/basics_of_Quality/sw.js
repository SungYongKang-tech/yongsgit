// 앱 기본 화면과 아이콘만 캐시. PDF 파일은 캐시하지 않아 항상 최신 파일을 받습니다.
const CACHE = 'quality-pwa-shell-v1';
const ASSETS = ['./', './index.html', './quality_preview.png', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/favicon.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))));
  self.clients.claim();
});
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.toLowerCase().endsWith('.pdf') || url.pathname.includes('/pdf/')) return;
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('./index.html')));
    return;
  }
  event.respondWith(caches.match(req).then(cached => cached || fetch(req)));
});
