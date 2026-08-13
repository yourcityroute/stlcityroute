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
// If either Leaflet file 404s (e.g. it wasn't copied into the repo root
// alongside index.html), the install still succeeds — index.html carries a
// cdnjs fallback for exactly that case. Each add() is caught individually so
// one missing asset can't abort the whole precache.
const INSTALL_ASSETS = ['./', './leaflet.min.js', './leaflet.min.css'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(c =>
      Promise.all(INSTALL_ASSETS.map(u => c.add(u).catch(() => {})))
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
const PASSTHROUGH = [
  'script.google.com',
  'googleapis.com',
  'maps.googleapis.com',
  'openstreetmap.org',
  'nominatim',
  'ipapi.co',
  'qrserver.com',
  'stlouis-mo.gov',
  'maps.arcgis.com',
  'maps6.stlouis-mo.gov',
  'esm.sh',
  'cdn.jsdelivr.net'
];

self.addEventListener('fetch', e => {
  const u = e.request.url;
  if (PASSTHROUGH.some(h => u.includes(h))) {
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
  e.respondWith(
    caches.match(e.request).then(cached => {
      const network = fetch(e.request).then(r => {
        if (r && r.status === 200) {
          const clone = r.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return r;
      }).catch(() => cached);
      return cached || network;
    })
  );
});

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});
