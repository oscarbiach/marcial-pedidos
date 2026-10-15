/* WhatsApp → Cargar Pedido (pedido del usuario, 15/10/2026).
   · «Cargar pedido» desde un chat abre una ventana flotante en el medio de la pantalla, con el fondo oscurecido, con EL MISMO formulario
     de Cargar Pedido: se lo traslada adentro de la ventana y al cerrar vuelve a su pestaña. Así se guarda por el mismo camino
     (submitCargarPedido → encolarPedido, con su id único por pedido y sin duplicados en los reintentos). El cliente viene puesto y los
     productos que nombró en el chat se ofrecen como botones para sumarlos (cantidad 1, editable).
   · Lo anotado «para el próximo pedido» desde WhatsApp (por ejemplo, un reclamo) aparece en el formulario al elegir ese cliente, también en
     la pestaña Cargar Pedido, con un botón para pasarlo a la observación. Deja de aparecer cuando un pedido cargado lo incluye. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const ico = (n, c) => (window.mIco ? mIco(n, c || 'ico-sm') : '');
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const form = () => document.querySelector('#wa-carga-form .form-card') || document.querySelector('#tab-cargar .form-card');
  let abierta = false, clienteAntes = '';

  function crear() {
    if ($('wa-carga')) return $('wa-carga');
    const o = document.createElement('div');
    o.className = 'overlay wa-carga-ov'; o.id = 'wa-carga';
    o.innerHTML = `<div class="modal wa-carga-modal" role="dialog" aria-modal="true" aria-labelledby="wa-carga-t">
      <div class="modal-header"><h2 id="wa-carga-t">${ico('shopping-cart', 'ico')} <span>Nuevo pedido</span></h2>
        <button type="button" class="close-btn" id="wa-carga-x" aria-label="Cerrar sin guardar">${ico('x', 'ico')}</button></div>
      <div class="modal-body"><div id="wa-carga-chat"></div><div id="wa-carga-form"></div></div></div>`;
    document.body.appendChild(o);
    $('wa-carga-x').addEventListener('click', () => cerrar());
    // Se cierra tocando el fondo solo si el toque empezó y terminó afuera (arrastrar para seleccionar texto no la cierra).
    let desdeFondo = false;
    o.addEventListener('mousedown', e => { desdeFondo = e.target === o; });
    o.addEventListener('click', e => { if (e.target === o && desdeFondo) cerrar(); });
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape' || !abierta) return;
      if (document.querySelector('.overlay.open:not(#wa-carga)')) return;   // primero se cierra lo que esté encima (selector de productos)
      cerrar();
    });
    $('wa-carga-chat').addEventListener('click', e => {
      const b = e.target.closest('[data-prod]'); if (!b || b.disabled) return;
      sumarProducto(b.dataset.prod); b.disabled = true; b.classList.add('hecho'); b.querySelector('.ico').outerHTML = ico('check');
    });
    // Guardar: corre el submitCargarPedido de siempre (onclick del botón). Si se guardó, el formulario queda vacío y se cierra la ventana.
    const btn = $('cargarSubmitBtn');
    btn.addEventListener('click', () => { clienteAntes = abierta ? $('n_cliente').value.trim() : ''; }, true);
    btn.addEventListener('click', () => {
      if (!abierta || !clienteAntes || $('n_cliente').value.trim()) return;
      abierta = false; devolver(); o.classList.remove('open');
      setTimeout(() => window.WhatsAppUI && WhatsAppUI.refresh(), 300);
    });
    return o;
  }
  const filas = () => [...document.querySelectorAll('#cargarItemRows > *')];
  const conProducto = () => filas().filter(r => (r.querySelector('.ac-input') || {}).value);
  function hayAMedias() { return !!($('n_cliente').value.trim() || conProducto().length || $('n_notas').value.trim()); }
  function sumarProducto(prod) {
    filas().filter(r => !(r.querySelector('.ac-input') || {}).value).forEach(r => r.remove());   // la fila vacía del inicio
    if (typeof addItemRowWith === 'function') addItemRowWith('cargar', { prod, qty: 1 });
    const ultima = filas().pop(), q = ultima && ultima.querySelector('.qty-input');
    if (q && q.offsetParent) { q.focus(); q.select(); }
  }
  function devolver() {
    const f = document.querySelector('#wa-carga-form .form-card'); if (!f) return;
    const tab = $('tab-cargar'); tab.insertBefore(f, tab.firstChild);
  }

  function abrir({ cliente, productos }) {
    const o = crear(), f = form(); if (!f || !cliente) return;
    if (hayAMedias() && !confirm('En «Cargar Pedido» hay un pedido a medio cargar. ¿Descartarlo y empezar uno para ' + cliente + '?')) return;
    if (typeof resetCargarForm === 'function') resetCargarForm();
    $('wa-carga-form').appendChild(f);
    // Mismo autocompletado que al elegir un cliente de la lista: dirección guardada (editable) e historial.
    const inp = $('n_cliente'); inp.value = cliente;
    const c = ((typeof state !== 'undefined' && state.clientes) || []).find(x => String(x.n).toLowerCase() === cliente.toLowerCase());
    const dir = $('n_direccion'); if (c && c.d && dir) { dir.value = c.d; dir.dataset.auto = '1'; }
    if (typeof actualizarHistCliente === 'function') actualizarHistCliente();
    $('wa-carga-t').querySelector('span').textContent = 'Nuevo pedido · ' + cliente;
    $('wa-carga-chat').innerHTML = productos && productos.length
      ? `<div class="wa-carga-sug"><p>${ico('message-circle')}<b>Nombró en el chat</b> <span>· tocá para sumarlo al pedido</span></p>
         <div class="wa-carga-chips">${productos.map(p => `<button type="button" class="wa-carga-chip" data-prod="${esc(p.prod)}" title="${esc('«' + p.frase + '»')}">${ico('plus')}${esc(p.prod)}</button>`).join('')}</div></div>`
      : '';
    o.classList.add('open'); abierta = true;
    const primero = o.querySelector('.wa-carga-chip') || o.querySelector('#cargarItemRows .ac-input') || o.querySelector('.add-item-btn');
    if (primero) primero.focus();
  }
  function cerrar() {
    if (!abierta) return;
    if (conProducto().length && !confirm('¿Cerrar sin guardar el pedido?')) return;
    abierta = false;
    if (typeof resetCargarForm === 'function') resetCargarForm();
    devolver(); $('wa-carga').classList.remove('open');
  }

  // ── Lo anotado para el próximo pedido (lo llama actualizarHistCliente de index.html al cambiar el cliente) ──
  function alCambiarCliente(nombre) {
    const f = form(); if (!f) return;
    if (nombre && window.WhatsAppUI) WhatsAppUI.cargarVinculos();   // como mucho una lectura por minuto
    let box = $('wa-recordatorio');
    const recs = nombre && window.WhatsAppUI && WhatsAppUI.recordatoriosDe ? WhatsAppUI.recordatoriosDe(nombre) : [];
    if (!recs.length) { if (box) box.hidden = true; return; }
    if (!box) {
      box = document.createElement('div'); box.id = 'wa-recordatorio'; box.className = 'wa-recordatorio';
      f.insertBefore(box, $('cargarSubmitBtn'));
      box.addEventListener('click', e => {
        const b = e.target.closest('[data-obs]'); if (!b) return;
        const notas = $('n_notas'), obs = b.dataset.obs;
        if (!notas.value.includes(obs)) notas.value = (notas.value.trim() ? notas.value.trim() + '\n' : '') + obs;
        if (typeof setExtrasOpen === 'function') setExtrasOpen('n', true);
        b.disabled = true; b.innerHTML = ico('check') + 'En la observación';
      });
    }
    const notas = ($('n_notas') || {}).value || '';
    box.hidden = false;
    box.innerHTML = `<p class="wa-rec-t">${ico('pin')}<b>Anotado desde WhatsApp para este pedido</b></p>` + recs.map(r => {
      const ya = notas.includes(r.obs);
      return `<div class="wa-rec"><span>${esc(r.obs)}</span><button type="button" class="wa-rec-btn" data-obs="${esc(r.obs)}"${ya ? ' disabled' : ''}>${ya ? ico('check') + 'En la observación' : ico('plus') + 'Agregar a la observación'}</button></div>`;
    }).join('');
  }
  document.addEventListener('wa:vinculos', () => { const i = $('n_cliente'); if (i) alCambiarCliente(i.value.trim()); });
  // Al entrar a Cargar Pedido se actualiza lo anotado (como mucho una vez por minuto): puede venir de otro dispositivo.
  document.addEventListener('click', e => { if (e.target.closest('[data-tab="cargar"]') && window.WhatsAppUI) WhatsAppUI.cargarVinculos(); });

  window.WhatsAppCarga = { abrir, cerrar, alCambiarCliente, abierta: () => abierta };
})();
