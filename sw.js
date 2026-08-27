// Service worker de la app de pedidos.
//
// Guarda en el celular el "esqueleto" de la app (el HTML y los iconos)
// para que abra al instante y siga abriendo sin señal. Los datos NO se
// cachean acá: los pedidos viajan por POST a Apps Script y esas llamadas
// pasan de largo, así nadie ve una lista vieja creyendo que es la de hoy.
//
// Al cambiar el HTML hay que subirle el número a CACHE: eso borra el
// cache viejo y obliga a bajar todo de nuevo.
const CACHE = 'dm-pedidos-v17';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-192-any.png',
  './icons/icon-512-any.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;

  // La API va por POST y a otro dominio: no se toca ni se cachea nunca.
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  // El HTML se pide primero a la red, para que una versión nueva llegue
  // sola apenas hay señal; si no hay, sale del cache.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Iconos y manifest: del cache, y si no están, a la red.
  e.respondWith(caches.match(req).then(hit => hit || fetch(req)));
});
