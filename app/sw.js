/**
 * Service worker for the phone app.
 *
 * Two jobs, and it is careful about the difference between them.
 *
 *   1. Make the app open instantly. The page, its icons and its fonts are
 *      cached, so tapping the icon paints immediately instead of waiting on a
 *      round trip to the kitchen — which, from a phone on a mobile network
 *      somewhere else, is a real wait.
 *
 *   2. Make it useful when it can't reach home. The last calendar, grocery
 *      list and chore board it saw are kept, and served if the network fails.
 *
 * What it deliberately does NOT do is queue up changes made while offline.
 * Adding an event on a plane and having it appear an hour later sounds good
 * until two people edit the same thing from two phones with no connection and
 * something has to decide who wins. That's a real feature with real conflict
 * rules, not a cache trick, and pretending otherwise would lose somebody's
 * dentist appointment. Writes need a connection; when there isn't one, the
 * page says so plainly.
 */

// __BUILD__ is substituted by the server. A new build means a new cache name,
// which means yesterday's HTML can't survive an update.
const BUILD = '__BUILD__';
const SHELL_CACHE = `baja-shell-${BUILD}`;
const DATA_CACHE = `baja-data-${BUILD}`;

const SHELL = [
  '/mobile',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon-180.png',
];

/** GETs worth remembering — the ones that make the app readable when offline. */
const CACHEABLE_API = [
  '/api/settings',
  '/api/events',
  '/api/events/expanded',
  '/api/grocery',
  '/api/chores',
  '/api/photos',
  '/api/version',
  // Cached for the same reason the grocery list is: standing in a shop with no
  // signal, "what are we making and what does it need" is exactly the question
  // the phone is being asked.
  '/api/bake',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // addAll is all-or-nothing; one 404 would leave the app with no cache at
      // all. Individually, so a missing icon costs only that icon.
      .then((cache) => Promise.all(SHELL.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((n) => (n.startsWith('baja-shell-') || n.startsWith('baja-data-')) && !n.endsWith(BUILD))
            .map((n) => caches.delete(n)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function isCacheableApi(url) {
  return CACHEABLE_API.some((p) => url.pathname === p || url.pathname.startsWith(`${p}?`));
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // writes go straight to the network

  const url = new URL(request.url);

  // Fonts and other cross-origin assets: cache once, then serve from there.
  // These responses are opaque, which is fine — we only ever hand them back
  // to the browser, never read them.
  if (url.origin !== self.location.origin) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request)
            .then((res) => {
              const copy = res.clone();
              caches.open(SHELL_CACHE).then((c) => c.put(request, copy).catch(() => {}));
              return res;
            })
            .catch(() => hit),
      ),
    );
    return;
  }

  // The page itself: try the network so an update is picked up, fall back to
  // the cached copy. Without this an update would need the app deleted and
  // re-added.
  if (request.mode === 'navigate' || url.pathname === '/mobile' || url.pathname === '/') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put('/mobile', copy).catch(() => {}));
          return res;
        })
        .catch(() => caches.match('/mobile').then((hit) => hit || offlineFallback())),
    );
    return;
  }

  // Data: network first, because a stale grocery list shown as current is
  // worse than a slow one. The cache is the safety net, and the page is told
  // when it's looking at the net rather than the real thing.
  if (isCacheableApi(url)) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(DATA_CACHE).then((c) => c.put(request, copy).catch(() => {}));
          }
          return res;
        })
        .catch(() =>
          caches.match(request).then((hit) => {
            if (!hit) throw new Error('offline and nothing cached');
            // Marked so the page can say "this is what it last saw" instead of
            // quietly presenting old data as current.
            const headers = new Headers(hit.headers);
            headers.set('X-Baja-From-Cache', '1');
            return hit.blob().then((body) => new Response(body, { status: 200, headers }));
          }),
        ),
    );
    return;
  }

  // Photos and icons: cache first. They don't change under you.
  if (url.pathname.startsWith('/icons/') || url.pathname.startsWith('/photos/') || url.pathname === '/manifest.webmanifest') {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(SHELL_CACHE).then((c) => c.put(request, copy).catch(() => {}));
            }
            return res;
          }),
      ),
    );
  }
});

function offlineFallback() {
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
     <title>Baja Blast</title>
     <style>body{margin:0;background:#000;color:#fff;font-family:-apple-system,system-ui,sans-serif;
     display:grid;place-items:center;height:100vh;text-align:center;padding:24px}
     h1{font-size:22px;margin:0 0 10px}p{color:#7a7a7a;font-size:15px;line-height:1.5;max-width:22em}</style>
     <div><h1>Can't reach home</h1>
     <p>The kitchen isn't answering, and this phone hasn't loaded the app yet so there's nothing saved to show.
     Open it once on your home Wi-Fi and it'll work from anywhere after that.</p></div>`,
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}
