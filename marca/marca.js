/* Marcial Distribuidora — utilidades de identidad visual compartidas.
   - mIco(nombre, clase): devuelve el <svg> de un ícono del sprite.
   - Menú lateral: <aside id="sidebar" class="m-sidebar" data-activo="clientes">
     seguido de <script src="marca/marca.js"></script> lo completa en el
     acto (sin parpadeo). Un solo lugar para editar el menú de todas las
     pantallas. */
/* Menú lateral en pantallas chicas y altura del cartel "PROTOTIPO" (antes copiados en cada página). */
(function () {
  function e(id) { return document.getElementById(id); }
  window.abrirSidebar = function () { e('sidebar').classList.add('abierta'); e('overlaySidebar').classList.add('open'); };
  window.cerrarSidebar = function () { e('sidebar').classList.remove('abierta'); e('overlaySidebar').classList.remove('open'); };
  window.medirBanner = function () { var b = e('protoBanner'); if (b) document.documentElement.style.setProperty('--banner-h', b.getBoundingClientRect().height + 'px'); };
})();

/* Con datos migrados de Dubix el prototipo trabaja SOLO con esos datos: los carteles dejan de decir "ficticios"
   y se oculta "Reiniciar datos" (volvería a sembrar clientes y productos de ejemplo). */
function conDatosReales() { try { return !!localStorage.getItem('dm_prototipo_migracion'); } catch (e) { return false; } }
window.conDatosReales = conDatosReales;
(function () {
  function ajustar() {
    if (!conDatosReales()) return;
    ['protoBanner', 'sandboxBanner'].forEach(function (id) {
      var b = document.getElementById(id); if (!b) return;
      var t = b.querySelector('span');
      if (t) t.innerHTML = '<svg class="ico" aria-hidden="true"><use href="marca/iconos.svg#i-flask-conical"/></svg> <b>PROTOTIPO</b><span class="m-solo-pc"> — trabaja con tus datos de Dubix, sin conexión al sistema real</span><span class="m-solo-cel"> · datos de Dubix</span>';
      b.querySelectorAll('button').forEach(function (x) { if (/reiniciar/i.test(x.textContent)) x.style.display = 'none'; });
    });
    document.querySelectorAll('.m-avatar').forEach(function (a) { if (/ficticia/i.test(a.title)) a.title = 'Sesión del prototipo'; });
    document.querySelectorAll('.quien b').forEach(function (q) { if (/^prueba$/i.test(q.textContent.trim())) q.textContent = 'Marcial'; });
    document.querySelectorAll('.quien small').forEach(function (q) { if (/prueba/i.test(q.textContent)) q.textContent = 'Prototipo'; });
    if (window.medirBanner) window.medirBanner();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ajustar); else ajustar();
})();

(function () {
  var SPRITE = 'marca/iconos.svg';
  function mIco(nombre, clase) {
    return '<svg class="ico' + (clase ? ' ' + clase : '') + '" aria-hidden="true" focusable="false"><use href="' + SPRITE + '#i-' + nombre + '"/></svg>';
  }
  window.mIco = mIco;

  var MENU = [
    { id: 'inicio', texto: 'Inicio', ico: 'house', href: 'inicio.html' },
    { id: 'pedidos', texto: 'Pedidos', ico: 'shopping-cart', href: 'index.html' },
    { secc: 'Ventas' },
    { id: 'comprobantes', texto: 'Comprobantes', ico: 'receipt-text', href: 'comprobantes.html' },
    { id: 'ordenes', texto: 'Órdenes de Venta', ico: 'clipboard-list', href: 'ordenes.html' },
    { id: 'presupuestos', texto: 'Presupuestos', ico: 'file-text', href: 'presupuestos.html' },
    { id: 'recibos', texto: 'Recibos', ico: 'hand-coins', href: 'recibos.html' },
    { id: 'clientes', texto: 'Clientes', ico: 'users', href: 'clientes.html' },
    { id: 'seguimiento', texto: 'Seguimiento', ico: 'activity', href: 'seguimiento.html' },
    { secc: 'Compras' },
    { id: 'compras', texto: 'Comprobantes', ico: 'receipt-text', href: 'compras.html' },
    { id: 'compras-ordenes', texto: 'Órdenes de Compra', ico: 'clipboard-list', href: 'compras.html?vista=ordenes' },
    { id: 'compras-pagos', texto: 'Órdenes de Pago', ico: 'banknote', href: 'compras.html?vista=pagos' },
    { id: 'proveedores', texto: 'Proveedores', ico: 'container', href: 'proveedores.html' },
    { secc: 'Tesorería' },
    { id: 'movimientos', texto: 'Movimientos', ico: 'banknote', href: 'movimientos.html' },
    { secc: 'Inventario' },
    { id: 'productos', texto: 'Productos', ico: 'package', href: 'productos.html' },
    { id: 'listas-precios', texto: 'Lista de Precios', ico: 'tag', href: 'listas-precios.html' },
    { secc: 'Datos' },
    { id: 'migracion', texto: 'Migrar desde Dubix', ico: 'upload', href: 'migracion.html' },
    { id: 'unificar-nombres', texto: 'Unificar nombres', ico: 'tag', href: 'unificar-nombres.html' },
    { secc: 'Análisis' },
    { id: 'reportes', texto: 'Reportes', ico: 'chart-column', href: 'reportes.html' }
  ];

  function marca() {
    return '<a class="m-marca" href="inicio.html" aria-label="Marcial Distribuidora, ir a Inicio">' +
      '<img src="marca/logo/logo-horizontal-blanco.svg" alt="" width="185" height="34"></a>';
  }
  window.mMarca = marca;

  var aside = document.currentScript && document.currentScript.previousElementSibling;
  if (!aside || aside.id !== 'sidebar') aside = document.getElementById('sidebar');
  if (!aside || aside.dataset.activo === undefined) return;
  var activo = aside.dataset.activo;
  var html = marca() + '<nav class="m-nav" aria-label="Secciones">';
  MENU.forEach(function (it) {
    if (it.secc) { html += '<div class="m-nav-secc">' + it.secc + '</div>'; return; }
    if (it.pronto) {
      html += '<span class="m-nav-link pronto" aria-disabled="true">' + mIco(it.ico) + it.texto + '<span class="m-nav-tag">Pronto</span></span>';
      return;
    }
    var es = it.id === activo;
    html += '<a class="m-nav-link' + (es ? ' activo' : '') + '" href="' + it.href + '"' + (es ? ' aria-current="page"' : '') + '>' + mIco(it.ico) + it.texto + '</a>';
  });
  html += '</nav><div class="m-sidebar-pie">' + mIco('flask-conical') + '<span>' + (conDatosReales() ? 'Prototipo<br>con tus datos de Dubix' : 'Entorno de pruebas<br>datos ficticios') + '</span></div>';
  aside.innerHTML = html;
})();

/* Diálogos accesibles para todos los paneles y ventanas modales de las páginas
   (role="dialog" o clases .ov / .panel-ov / .pnl-ov, que se abren con la clase "open"):
   les pone rol y nombre si les faltan, lleva el foco adentro al abrir, lo mantiene
   dentro con Tab / Shift+Tab y lo devuelve a donde estaba al cerrar. No cambia la
   lógica de cada página. */
(function () {
  var SEL = '[role="dialog"], .ov, .panel-ov, .pnl-ov';
  var FOCO = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';
  var pila = [], hist = [], n = 0;

  function visible(e) { return !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length); }
  function enfocables(el) { return Array.prototype.filter.call(el.querySelectorAll(FOCO), visible); }
  function abierto(el) { return el.classList.contains('open'); }

  document.addEventListener('focusin', function (e) { hist.push(e.target); if (hist.length > 8) hist.shift(); }, true);

  function alAbrir(el) {
    if (pila.some(function (p) { return p.el === el; })) return;
    if (!el.getAttribute('role')) el.setAttribute('role', 'dialog');
    if (!el.getAttribute('aria-modal')) el.setAttribute('aria-modal', 'true');
    if (!el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby')) {
      var t = el.querySelector('h1, h2, h3');
      if (t) { if (!t.id) t.id = 'mdlg-' + (++n); el.setAttribute('aria-labelledby', t.id); }
    }
    var previo = null;
    for (var i = hist.length - 1; i >= 0; i--) if (!el.contains(hist[i]) && document.contains(hist[i])) { previo = hist[i]; break; }
    pila.push({ el: el, previo: previo });
    if (!el.contains(document.activeElement)) {
      var f = enfocables(el)[0];
      if (!f) { el.setAttribute('tabindex', '-1'); f = el; }
      f.focus({ preventScroll: true });
    }
  }
  function alCerrar(el) {
    var k = pila.findIndex(function (p) { return p.el === el; });
    if (k === -1) return;
    var p = pila.splice(k, 1)[0];
    var a = document.activeElement;
    if ((a === document.body || !a || el.contains(a)) && p.previo && document.contains(p.previo) && visible(p.previo)) p.previo.focus({ preventScroll: true });
  }
  function revisar(el) { if (abierto(el)) alAbrir(el); else alCerrar(el); }

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Tab' || !pila.length) return;
    var top = null;
    for (var i = pila.length - 1; i >= 0; i--) if (abierto(pila[i].el)) { top = pila[i].el; break; }
    if (!top) return;
    var f = enfocables(top);
    if (!f.length) { e.preventDefault(); return; }
    var primero = f[0], ultimo = f[f.length - 1], a = document.activeElement;
    if (!top.contains(a)) { e.preventDefault(); primero.focus(); }
    else if (e.shiftKey && a === primero) { e.preventDefault(); ultimo.focus(); }
    else if (!e.shiftKey && a === ultimo) { e.preventDefault(); primero.focus(); }
  });

  function iniciar() {
    var mo = new MutationObserver(function (muts) { muts.forEach(function (m) { revisar(m.target); }); });
    Array.prototype.forEach.call(document.querySelectorAll(SEL), function (el) {
      mo.observe(el, { attributes: true, attributeFilter: ['class'] });
      if (abierto(el)) alAbrir(el);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
