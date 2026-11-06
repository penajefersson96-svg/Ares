/* ARES - sw.js (service worker)
   Estrategia: red primero y copia guardada de respaldo.
   El chat (/chat) y la API (/api/) nunca se guardan. */

const CACHE = 'ares-v1';

const SHELL = [
  './',
  'index.html',
  'manifest.json',
  'css/styles.css',
  'js/app.js',
  'js/ui.js',
  'js/api.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
    .open(CACHE)
    .then((cache) => Promise.all(SHELL.map((url) => cache.add(url).catch(() => {}))))
    .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
    .keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/chat' || url.pathname.startsWith('/api/')) return;
  
  event.respondWith(
    fetch(req)
    .then((res) => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(req, copy));
      }
      return res;
    })
    .catch(() =>
      caches.match(req).then((cached) => cached || caches.match('index.html'))
    )
  );
});