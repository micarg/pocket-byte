// App files live in a versioned cache that is replaced on every update.
// Emulator files and fonts from CDNs live in their own cache that updates never clear, so Genesis / N64 / arcade
// keep working offline once each system has been opened online.
const CACHE = 'pocket-byte-v162';
const CDN_CACHE = 'pocket-byte-cdn';
const CORE = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png', './mame2003.json', './arcade-names.json', './arcade-buttons.json'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== CDN_CACHE && k !== COI_CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
const cdnFirst = req => caches.open(CDN_CACHE).then(c => c.match(req, { ignoreVary: true }).then(hit => hit || fetch(req).then(res => {
  if (res.ok || res.type === 'opaque') c.put(req, res.clone());
  return res;
})));
// PSP games (PPSSPP) need threads, and a page only gets those when it is cross-origin isolated. GitHub Pages can't
// send the headers for that, so the worker adds them to the app opened at ./?coi=1, and serves that page's files
// from other sites in a form the isolated page accepts (fetched with CORS, marked as shareable).
const COI = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' };
const withHeaders = (r, extra) => {
  const h = new Headers(r.headers);
  for (const k in extra) h.set(k, extra[k]);
  return new Response(r.body, { status: r.status, statusText: r.statusText, headers: h });
};
const COI_CACHE = 'pocket-byte-cdn-cors';
const coiFetch = req => {
  const cors = new Request(req.url, { mode: 'cors', credentials: 'omit' });
  return caches.open(COI_CACHE).then(c => c.match(cors.url).then(hit => hit || fetch(cors).then(res => {
    if (res.ok && /cdn\.emulatorjs\.org|fonts\.(googleapis|gstatic)\.com|raw\.githubusercontent\.com/.test(req.url) && !/version\.json$/.test(req.url)) c.put(cors.url, res.clone());
    return res;
  }))).then(res => withHeaders(res, { 'Cross-Origin-Resource-Policy': 'cross-origin' }));
};
const isCoiPage = e => {
  if (e.request.mode === 'navigate') return Promise.resolve(/[?&]coi=1/.test(e.request.url));
  if (!e.clientId) return Promise.resolve(false);
  return self.clients.get(e.clientId).then(c => {
    if (!c) return false;
    if (/[?&]coi=1/.test(c.url)) return true;
    // the emulator's own workers (blob: URLs) belong to the isolated page when one is open
    if (c.type !== 'window') return self.clients.matchAll({ type: 'window' }).then(ws => ws.some(w => /[?&]coi=1/.test(w.url)));
    return false;
  }).catch(() => false);
};
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (/[?&]coi=1/.test(url.search) && e.request.mode === 'navigate' && url.origin === location.origin) {
    e.respondWith(fetch('./index.html', { cache: 'no-cache' }).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put('./index.html', copy)); return r; })
      .catch(() => caches.match('./index.html')).then(r => withHeaders(r, COI)));
    return;
  }
  if (url.origin !== location.origin && e.clientId) {
    // other sites' files for an isolated page; everything else goes on below as before
    e.respondWith(isCoiPage(e).then(coi => coi ? coiFetch(e.request).catch(() => fetch(e.request)) : (plain(e, url) || fetch(e.request))));
    return;
  }
  const r = plain(e, url);
  if (r) e.respondWith(r);
});
// the app's own files, covers and CDN files as before; returns undefined for anything the network should handle
function plain(e, url) {
  if (url.origin === location.origin) {
    // 'no-cache' revalidates with GitHub every time instead of trusting the 10-minute browser cache
    return fetch(e.request, { cache: 'no-cache' }).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })
      .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')));
  } else if (url.hostname === 'raw.githubusercontent.com' && url.pathname.startsWith('/libretro-thumbnails/')) {
    // box art: keep the ones that exist, so the library shows its covers offline too
    return caches.open(CDN_CACHE).then(c => c.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      if (res.ok) c.put(e.request, res.clone());
      return res;
    })));
  } else if (/fonts\.(googleapis|gstatic)\.com$|^cdn\.emulatorjs\.org$/.test(url.hostname)) {
    // version.json is only an update check; answer it offline so it never blocks anything
    if (/\/version\.json$/.test(url.pathname)) return fetch(e.request).catch(() => new Response('{}', { headers: { 'content-type': 'application/json' } }));
    return cdnFirst(e.request);
  }
  return undefined;
}
