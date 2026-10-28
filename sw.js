// App files live in a versioned cache that is replaced on every update.
// Emulator files and fonts from CDNs live in their own cache that updates never clear, so Genesis / N64 / arcade
// keep working offline once each system has been opened online.
const CACHE = 'pocket-byte-v93';
const CDN_CACHE = 'pocket-byte-cdn';
const CORE = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png', './mame2003.json', './arcade-names.json', './arcade-buttons.json'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== CDN_CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
const cdnFirst = req => caches.open(CDN_CACHE).then(c => c.match(req, { ignoreVary: true }).then(hit => hit || fetch(req).then(res => {
  if (res.ok || res.type === 'opaque') c.put(req, res.clone());
  return res;
})));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin === location.origin) {
    // 'no-cache' revalidates with GitHub every time instead of trusting the 10-minute browser cache
    e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })
      .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html'))));
  } else if (url.hostname === 'raw.githubusercontent.com' && url.pathname.startsWith('/libretro-thumbnails/')) {
    // box art: keep the ones that exist, so the library shows its covers offline too
    e.respondWith(caches.open(CDN_CACHE).then(c => c.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      if (res.ok) c.put(e.request, res.clone());
      return res;
    }))));
  } else if (/fonts\.(googleapis|gstatic)\.com$|^cdn\.emulatorjs\.org$/.test(url.hostname)) {
    // version.json is only an update check; answer it offline so it never blocks anything
    if (/\/version\.json$/.test(url.pathname)) { e.respondWith(fetch(e.request).catch(() => new Response('{}', { headers: { 'content-type': 'application/json' } }))); return; }
    e.respondWith(cdnFirst(e.request));
  }
});
