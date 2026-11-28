const CACHE_VERSION = '__BUILD_VERSION__';
const CACHE_REV = '2026-11-28-v4';
const CACHE_NAME = `sonora-ios-shell-${CACHE_VERSION}-${CACHE_REV}`;

const SHELL_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './src/security.js',
  './src/storage.js',
  './src/api.js',
  './src/recommendations.js',
  './src/offline.js',
  './src/modals.js',
  './src/player.js',
  './src/youtube-oauth.js',
  './src/app.js',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('sonora-ios-shell-') && key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
      .then(async () => {
        const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of clients) {
          client.postMessage({ type: 'SONORA_SW_UPDATED', version: CACHE_VERSION });
        }
      })
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    // Never cache external audio streams, lyrics, or API calls in shell cache
    return;
  }

  // Static icon PNGs can safely use cache-first with background refresh
  if (url.pathname.includes('/icons/')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const net = fetch(request)
          .then((resp) => {
            if (resp && resp.ok) {
              const copy = resp.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
            }
            return resp;
          })
          .catch(() => cached);
        return cached || net;
      })
    );
    return;
  }

  // App shell (HTML, JS, CSS, manifest): network-first so updates take effect immediately,
  // falling back to cache when offline.
  event.respondWith(
    fetch(request, { cache: 'no-cache' })
      .then((networkResp) => {
        if (networkResp && networkResp.ok) {
          const copy = networkResp.clone();
          const targetKey = request.mode === 'navigate' ? './index.html' : request;
          caches.open(CACHE_NAME).then((cache) => cache.put(targetKey, copy));
        }
        return networkResp;
      })
      .catch(() =>
        caches.match(request).then((cached) => cached || (request.mode === 'navigate' ? caches.match('./index.html') : undefined))
      )
  );
});
