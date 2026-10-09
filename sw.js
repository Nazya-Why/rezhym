// Офлайн-режим: показуємо з кешу одразу, а в фоні тягнемо свіжу версію.
// Після змін у коді збільш номер версії, щоб телефони підхопили оновлення.
const CACHE = 'rezhym-v2';
const ASSETS = [
  './', 'index.html', 'css/style.css',
  'js/app.js', 'js/store.js', 'js/sync.js', 'js/util.js', 'js/icons.js', 'js/config.js',
  'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async cache => {
    const hit = await cache.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request)
      .then(res => { if (res.ok) cache.put(e.request, res.clone()); return res; })
      .catch(() => hit);
    return hit || net;
  }));
});
