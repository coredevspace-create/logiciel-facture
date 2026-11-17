/*
 * Ardoise — service worker : permet d'utiliser le logiciel sans réseau.
 * Stratégie « réseau d'abord » : la dernière version est toujours utilisée quand
 * Internet est disponible ; sinon, la copie enregistrée prend le relais.
 * Les données ne passent jamais par ici : elles restent dans le navigateur.
 */
const CACHE = 'ardoise-v1';
const ASSETS = [
  'app.html', 'manifest.webmanifest', 'css/style.css',
  'js/vendor/pdf-lib.min.js', 'js/vendor/fontkit.umd.min.js', 'js/vendor/assets.js',
  'js/config.js', 'js/licence-config.js', 'js/facturx.js', 'js/drive.js', 'js/insights.js', 'js/livraisons.js', 'js/app.js',
  'images/logo.svg', 'images/logo-192.png', 'images/logo-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // Google, Drive… : jamais interceptés
  const path = url.pathname.replace(/^.*\//, '');
  if (path === 'admin.html' || path === 'sw.js') return;
  const isApp = ASSETS.some((a) => url.pathname.endsWith('/' + a)) || req.mode === 'navigate' && /app\.html$/.test(url.pathname);
  if (!isApp) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('app.html'))),
  );
});
