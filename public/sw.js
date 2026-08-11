// GolfUtah service worker — app shell cache so the app opens instantly
// from the home screen, plus offline tolerance.
//
// Strategy:
//   - Shell assets (HTML/CSS/JS/icons): cache first, refreshed in the
//     background. The app is static, so a one-version-stale shell is
//     harmless and startup costs no round trip.
//   - Tee time JSON: network first, falling back to cache. Availability
//     is the one thing that must never be served stale when the network
//     is there — but a cached copy still beats a blank screen on a phone
//     with no signal at the course.
//   - Everything else (Open-Meteo, course sites): straight to network.

const VERSION = 'golfutah-v1';
const SHELL_CACHE = `${VERSION}-shell`;
const DATA_CACHE = `${VERSION}-data`;

self.addEventListener('install', (event) => {
  // Nothing pre-cached: Next.js emits hashed asset names, so the shell is
  // populated on first visit instead of guessed at here.
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

  if (url.pathname.includes('/data/')) {
    event.respondWith(networkFirst(request, DATA_CACHE));
    return;
  }

  event.respondWith(cacheFirst(request, SHELL_CACHE));
});

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
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

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const update = fetch(request)
    .then((fresh) => {
      if (fresh.ok) cache.put(request, fresh.clone());
      return fresh;
    })
    .catch(() => undefined);

  return cached ?? (await update) ?? Response.error();
}
