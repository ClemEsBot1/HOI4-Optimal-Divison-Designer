/*
 * Offline support for the installed app. Pages are fetched from the network first (so a new deploy shows up at
 * once) and fall back to the cached copy offline; built assets carry a content hash in their name, so they are
 * served from the cache once fetched; game images and fonts are served from the cache and refreshed behind it.
 * Bump VERSION to drop every old cache.
 */
const VERSION = 'dd-v1';
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

const put = async (req, res) => {
  if (res && (res.ok || res.type === 'opaque')) { const c = await caches.open(VERSION); await c.put(req, res.clone()); }
  return res;
};

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const fonts = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (!sameOrigin && !fonts) return;

  if (req.mode === 'navigate') {
    // network first; offline, the cached app shell (the app reads its state from the URL)
    e.respondWith(fetch(req).then((res) => put('/', res)).catch(async () => (await caches.match(req)) || caches.match('/')));
    return;
  }
  if (sameOrigin && url.pathname.startsWith('/assets/')) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => put(req, res))));
    return;
  }
  // everything else: cached copy now, fresh copy for next time
  e.respondWith(caches.match(req).then((hit) => {
    const net = fetch(req).then((res) => put(req, res)).catch(() => hit);
    return hit || net;
  }));
});
