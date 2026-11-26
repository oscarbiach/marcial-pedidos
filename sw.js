// Service worker de la app de pedidos.
//
// Guarda en el celular el "esqueleto" de la app (el HTML y los iconos)
// para que abra al instante y siga abriendo sin señal. Los datos NO se
// cachean acá: los pedidos viajan a Supabase (POST, y GET a otro dominio)
// y esas llamadas pasan de largo, así nadie ve una lista vieja creyendo
// que es la de hoy.
//
// Al cambiar el HTML hay que subirle el número a CACHE: eso borra el
// cache viejo y obliga a bajar todo de nuevo.
const CACHE = 'dm-pedidos-v161';

const SHELL = [
  './',
  './index.html',
  './vendor/supabase-2.45.4.min.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-192-any.png',
  './icons/icon-512-any.png',
  './icons/apple-touch-icon.png',
  './marca/tokens.css',
  './marca/marcial.css',
  './marca/pedidos.css',
  './marca/marca.js',
  './marca/iconos.svg',
  './marca/fuentes/manrope-latin-var.woff2',
  './marca/logo/logo-horizontal.svg',
  './marca/logo/logo-blanco.svg',
  './seguimiento-clientes.js?v=153',
  './seguimiento-datos.js',
  './seguimiento-contexto.js?v=155',
  './guia-seguimiento.html',
  './seguimiento-clientes-ui.js?v=155',
  './seguimiento-clientes.css?v=155',
  './whatsapp-inbox.js',
  './whatsapp-client-review.js',
  './whatsapp-agenda.js',
  './whatsapp-inbox.css',
  './whatsapp-temas.js',
  './whatsapp-carga.js',
  './whatsapp-fotos.js',
  './whatsapp-oportunidades.js',
  './whatsapp-precios.js',
  './stock.js',
  './stock.css',
  './bitacora.js?v=147',
  './bitacora.css?v=147',
  './stock-pantalla.js?v=152',
  './stock-pantalla.css?v=152',
  './preparacion.js?v=117',
  './preparacion.css',
  './reparto-vivo.js?v=144',
  './turnos.js?v=156',
  './turnos.css?v=157',
  './reparto-vivo.css?v=144',
  './reparto-red.js?v=117',
  './gestion.js?v=159',
  './gestion.css?v=159',
  './admin.js?v=149',
  './auditoria.js?v=149',
  './auditoria.css?v=149',
  './admin.css?v=130',
  './reparto-fotos.js?v=117',
  './reparto-fotos.css?v=117',
  './armado-pedido.js?v=144',
  './peso-fuentes.js?v=117',
  './balanza.js?v=117',
  './armado-pedido.css?v=144',
  './reparto-control.js?v=134',
  './reparto-control.css?v=117',
  './cargar-pedido.css?v=161',
  './cargar-pedido.js?v=161',
  './pedidos-fijos.js'
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
