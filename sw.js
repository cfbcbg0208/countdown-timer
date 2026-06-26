// 서비스 워커: 앱 셸을 캐시해 오프라인 동작 + 설치 가능하게 한다.
// 전략: 네트워크 우선(최신 우선) → 실패 시 캐시 → 그래도 없으면 index.html.
// (개발 중 최신 파일을 우선 받도록 네트워크 우선. 오프라인이면 캐시로 폴백.)
const CACHE = 'countdown-v13';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './src/app.js',
  './src/time.js',
  './src/store.js',
  './src/settings.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-16.png',
  './icons/icon-32.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  e.respondWith(
    fetch(request)
      .then((res) => {
        if (new URL(request.url).origin === self.location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(request).then((c) => c || caches.match('./index.html'))),
  );
});
