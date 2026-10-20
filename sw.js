// Offline support for Baby Day.
// Strategy: NETWORK-FIRST for every app file (always the latest version when online),
// falling back to the saved copy only when offline or the network is very slow.
// Bump VERSION whenever app files change.
const VERSION = 'v1.4.0';
const CACHE = 'baby-day-' + VERSION;
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'store.js', 'model.js',
  'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  // cache: 'reload' bypasses the browser's HTTP cache so we never save a stale copy.
  // Each file is saved independently, so one missing file can't break installation.
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all(SHELL.map(u =>
        fetch(u, { cache: 'reload' }).then(r => (r.ok ? c.put(u, r) : null)).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  const upgraded = (async () => {
    const old = (await caches.keys()).filter(k => k !== CACHE);
    await Promise.all(old.map(k => caches.delete(k)));
    await self.clients.claim();
    return old.length > 0;
  })();
  e.waitUntil(upgraded);
  // Upgrading from an older version: reload open pages so nobody stays stuck on stale files.
  // Deliberately NOT inside waitUntil: the reload's request needs this worker to finish
  // activating first, so waiting on it here would deadlock.
  upgraded.then(isUpgrade => {
    if (!isUpgrade) return;
    self.clients.matchAll({ type: 'window' }).then(cs => cs.forEach(c => c.navigate(c.url).catch(() => {})));
  });
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return; // never touch GitHub API calls
  e.respondWith(networkFirst(req, req.mode === 'navigate' ? 4000 : 6000));
});

async function networkFirst(req, timeoutMs) {
  const cache = await caches.open(CACHE);
  // 'no-cache' = always check with the server (cheap if unchanged), never trust a stale HTTP-cache copy
  const net = fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }).then(res => {
    if (res.ok) cache.put(req.url.split('?')[0], res.clone());
    return res;
  });
  net.catch(() => {});
  let timer;
  const slow = new Promise(r => { timer = setTimeout(r, timeoutMs, null); });
  try {
    const res = await Promise.race([net, slow]);
    clearTimeout(timer);
    if (res) return res;
  } catch { /* offline */ }
  const hit = (await cache.match(req.url.split('?')[0])) ||
    (req.mode === 'navigate' ? (await cache.match(new URL('./', self.location).href)) || (await cache.match('index.html')) : null);
  return hit || net;
}
