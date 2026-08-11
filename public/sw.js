// GolfUtah service worker.
//
// Deliberately NOT cache-first for the app shell. An earlier version was,
// with a hardcoded cache name that never changed — which meant a browser
// that had loaded the site once kept running that build's JavaScript
// forever, no matter how many times the app was fixed and redeployed.
// Silently serving a stale build is the worst possible failure for an app
// whose whole job is showing current information.
//
// So: network first for everything, falling back to cache only when the
// network is unavailable. That costs a round trip on launch and buys
// never being wrong on purpose. The cache exists for the case that
// actually matters on a phone — no signal at the course.

const VERSION = 'golfutah-v2';
const CACHE = `${VERSION}-runtime`;

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // weather, course sites

  event.respondWith(networkFirst(request));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const fresh = await fetch(request);
    if (fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw new Error('offline and not cached');
  }
}
