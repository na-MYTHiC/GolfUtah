// GolfUtah service worker.
//
// Deliberately NOT cache-first for the app shell. An earlier version was,
// with a hardcoded cache name that never changed — which meant a browser
// that had loaded the site once kept running that build's JavaScript
// forever, no matter how many times the app was fixed and redeployed.
// Silently serving a stale build is the worst possible failure for an app
// whose whole job is showing current information.
//
// So: network first for the things that can go stale, falling back to
// cache only when the network is unavailable. That costs a round trip on
// launch and buys never being wrong on purpose. The cache exists for the
// case that actually matters on a phone — no signal at the course.
//
// Content-hashed assets are the exception, and are served cache-first:
// see immutable() below. A file whose name changes whenever its bytes do
// cannot be stale, so re-fetching it is pure latency.

// Stamped with the app version at build time by scripts/stamp-sw.ts.
//
// This has to change on every deploy, and it is the whole reason updates
// reach a running app. A browser decides there is a new worker by
// byte-comparing this file; when it is identical there is no new worker,
// no controllerchange, and no reload — so an installed PWA that is
// resumed rather than cold-started keeps running the build it was opened
// with, however many times it checks. Hand-bumping this was the bug:
// most deploys never touched it.
//
// The literal below is the development fallback. Anything served to a
// phone has been through the build and carries a real version.
const VERSION = 'golfutah-__APP_VERSION__';
const CACHE = `${VERSION}-runtime`;

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

// Defensive: if a worker ever does end up waiting, the page can release it
// rather than the app being stuck on an old build with no way to move on.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'golfutah-skip-waiting') self.skipWaiting();
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

  event.respondWith(immutable(url) ? cacheFirst(request) : networkFirst(request));
});

/**
 * Whether this URL can never change without its name changing.
 *
 * Everything Next emits under `_next/static/` carries a content hash in
 * its filename — chunks, CSS, fonts. A new build produces new filenames,
 * so a cached copy of one of these cannot be stale. There is nothing to
 * re-validate and no way to be wrong.
 *
 * Matched by substring rather than prefix because Pages serves the site
 * from /GolfUtah/, so the path is /GolfUtah/_next/static/... — and
 * locally it's /_next/static/...
 *
 * Deliberately NOT the document, sw.js, or anything under /data/: those
 * keep their own names across deploys, so a cached copy of any of them
 * can be last week's. They stay network-first.
 */
function immutable(url) {
  return url.pathname.includes('/_next/static/');
}

/**
 * Serve from cache without touching the network, and only fetch on a
 * miss.
 *
 * This is what the note below about content hashes always claimed was
 * happening, and wasn't: every launch still went to the network for all
 * of it. networkFirst's `fetch` doesn't become free just because the
 * response will match — a cold radio at a course still has to complete
 * eight requests before the app renders. Now a repeat launch spends
 * zero.
 */
async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  const fresh = await fetch(request);
  if (fresh.ok) cache.put(request, fresh.clone());
  return fresh;
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const fresh = await fetch(freshen(request));
    if (fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw new Error('offline and not cached');
  }
}

// "Network first" was quietly not reaching the network.
//
// A plain fetch() goes through the browser's own HTTP cache, and GitHub
// Pages serves the HTML with max-age=600 — so for ten minutes after a
// deploy this worker's "fresh" copy could be the same bytes it was trying
// to replace, and a page held open longer than that never re-fetched at
// all. The document is the one file that decides which build runs, so it
// asks past the HTTP cache.
//
// Only the document. The other thing networkFirst still handles is
// /data/*.json, which must reach the network but is already asked with
// `cache: "no-store"` and a cache-busting query by its caller — see
// loadDay() in lib/static-data.ts.
//
// Content-hashed assets never get here at all; they go to cacheFirst.
//
// A Request cannot be reconstructed with mode 'navigate', hence going by
// url rather than `new Request(request, ...)`.
function freshen(request) {
  if (request.mode !== 'navigate') return request;
  return new Request(request.url, {
    cache: 'reload',
    credentials: 'same-origin',
    headers: request.headers,
    redirect: 'follow',
  });
}
