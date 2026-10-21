const CACHE = 'stlcityroute-%%VERSION%%';

// Drop BH (2026-08-12): precache the app shell AND the self-hosted Leaflet
// build. Previously only './' was precached and Leaflet came from cdnjs, which
// was in the PASSTHROUGH list below — meaning the service worker deliberately
// never cached it. Offline, that request fell through to the network, failed,
// and got handed the 503 JSON stub, which is not executable JavaScript. `L`
// ended up undefined and the map was dead on any cold start where the
// browser's own HTTP cache had been evicted (routine on a storage-pressured
// phone). Serving Leaflet from our own origin and precaching it here closes
// that hole: the map now works offline on a cold start, which is the entire
// point of the offline story.
//
// Drop CL (2026-10-21): the self-hosted fonts (./fonts/*.woff2) are
// precached too — they replaced the render-blocking Google Fonts stylesheet.
//
// If any asset 404s (e.g. it wasn't copied into the repo alongside
// index.html), the install still succeeds — each add() is caught
// individually so one missing asset can't abort the whole precache.
const INSTALL_ASSETS = [
  './', './leaflet.min.js', './leaflet.min.css',
  './fonts/syne-latin-400-normal.woff2', './fonts/syne-latin-600-normal.woff2',
  './fonts/syne-latin-700-normal.woff2', './fonts/syne-latin-800-normal.woff2',
  './fonts/space-mono-latin-400-normal.woff2', './fonts/space-mono-latin-700-normal.woff2'
];

// Drop CL: NO self.skipWaiting() here any more. Skipping waiting at install
// meant every update activated immediately, and the page reloads on
// controllerchange — so a deploy could reload the app in the middle of a
// photo session or while notes were being typed. A new version now waits
// until the page decides it's a safe moment and posts SKIP_WAITING (see
// _applySwUpdateWhenSafe in index.html).
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c =>
      // Drop BY: cache:'reload' bypasses the browser HTTP cache. GitHub
      // Pages serves index.html with max-age=600, so for ~10 min after a
      // deploy a plain add('./') could precache the OLD page under the NEW
      // cache name — the update "installed" but the app never changed.
      Promise.all(INSTALL_ASSETS.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => {})))
    )
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Hosts that must always go straight to the network: live API calls, map
// tiles, OAuth. Caching these would serve stale data or break auth.
//
// cdnjs.cloudflare.com was REMOVED from this list in Drop BH. Leaflet is now
// same-origin, and the remaining cdnjs use (jsPDF, loaded lazily only when a
// PDF is generated) is better served by the cache-first handler below: PDF
// export then keeps working offline instead of failing at the CDN fetch.
//
// Drop CL additions: project-osrm.org (routing — every optimize used to add
// a permanent cache entry, since the URL carries the live GPS origin),
// api.maptiler.com / tiles.stadiamaps.com (report tiles — unbounded growth),
// accounts.google.com (Google sign-in script must stay current).
const PASSTHROUGH = [
  'script.google.com',
  'googleapis.com',
  'maps.googleapis.com',
  'accounts.google.com',
  'openstreetmap.org',
  'project-osrm.org',
  'nominatim',
  'ipapi.co',
  'qrserver.com',
  'stlouis-mo.gov',
  'maps.arcgis.com',
  'maps6.stlouis-mo.gov',
  'api.maptiler.com',
  'tiles.stadiamaps.com',
  'esm.sh',
  'cdn.jsdelivr.net'
];

self.addEventListener('fetch', e => {
  const u = e.request.url;
  // Drop CL: only GETs are cacheable. POSTs (Gemini, Drive uploads) used to
  // fall into the cache-first branch, where cache.put() rejects for non-GET.
  if (e.request.method !== 'GET' || PASSTHROUGH.some(h => u.includes(h))) {
    e.respondWith(
      fetch(e.request).catch(() =>
        new Response('{"error":"offline"}', {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }
  // Drop BY: page loads are network-first (fresh copy, bypassing the HTTP
  // cache) with a 4s cutoff, falling back to the cached shell when offline
  // or on a dead connection. Previously they were stale-while-revalidate,
  // so the first open after every deploy ran the previous version.
  if (e.request.mode === 'navigate') {
    e.respondWith((async () => {
      const cached = await caches.match(e.request) || await caches.match('./');
      try {
        const net = fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin' });
        const r = await (cached
          ? Promise.race([net, new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), 4000))])
          : net);
        if (r && r.status === 200) {
          const clone = r.clone();
          caches.open(CACHE).then(c => c.put('./', clone));
        }
        return r;
      } catch (_) {
        return cached || new Response('Offline', { status: 503 });
      }
    })());
    return;
  }
  e.respondWith(
    caches.match(e.request).then(cached => {
      const network = fetch(e.request).then(r => {
        if (r && r.status === 200) {
          const clone = r.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone)).catch(() => {});
        }
        return r;
      // Drop CL: offline with nothing cached used to resolve to undefined,
      // which makes respondWith() throw. Return a proper network error.
      }).catch(() => cached || Response.error());
      return cached || network;
    })
  );
});

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});
