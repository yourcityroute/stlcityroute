const CACHE = 'stlcityroute-%%VERSION%%';

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(c => c.add('./').catch(() => {}))
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

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
  'cdnjs.cloudflare.com',
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
