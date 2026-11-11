/* Pedidos fijos semanales (pedido del usuario, 11/11/2026).
   Un cliente que lleva lo mismo todas las semanas, sin día fijo: se arma una vez y la base crea sola un pedido Pendiente
   por semana (lunes a domingo, hora de Argentina) con generar_fijos_semana().
   Acá: (1) al abrir la app y como mucho una vez por hora se pide esa generación y, si creó pedidos, se refrescan;
   (2) en Pedidos, una sección plegable «Fijos semanales» con «Nuevo fijo», Editar, Pausar/Reanudar y Quitar;
   (3) la ventana «Pedido fijo semanal» (#fijoModal en index.html) para dar de alta o editar: reusa las filas de producto de la app
   (agregarProducto / .item-row) y, al dar de alta, genera el id 'fij_…' UNA sola vez al abrirla: reintentar el guardado usa el mismo id.
   Si la tabla o la función no existen todavía (SQL 20 sin aplicar) la app sigue igual y la sección queda oculta.
   Datos: tabla pedidos_fijos (supabase/20-pedidos-fijos-semanales.sql); en modo prueba, los datos de prueba (sandboxAccion). */
(function () {
  'use strict';
  const CADA_HORA = 60 * 60 * 1000;
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const S = { lista: [], cargado: false, listo: false, noHay: false, generando: false, ultGen: 0, ocupados: new Set(), aviso: '', refrescando: false, modal: null, guardando: false, disparador: null };
  const prueba = () => typeof sandboxActivo === 'function' && sandboxActivo();
  const conSesion = () => prueba() || (typeof state !== 'undefined' && state.pin === 'ok');
  const quien = () => (typeof state !== 'undefined' && state.who) || '—';
  const sinTabla = e => !!(e && e.sinFijos);

  // La tabla o la función no están: se ocultan casilla y sección, sin avisos.
  function apagar() {
    S.noHay = true; S.lista = [];
    document.body.classList.remove('fijos-ok');
  }
  function encender() { if (!S.noHay) document.body.classList.add('fijos-ok'); }

  // ── Generar los pedidos de la semana ──
  async function generar() {
    if (S.noHay || S.generando || !conSesion()) return;
    S.generando = true;
    try {
      const r = await sbAccion('generarFijos', []);
      S.ultGen = Date.now();
      encender();
      if (r && r.creados > 0 && typeof reload === 'function') reload();
      await refrescar();
    } catch (e) {
      if (sinTabla(e)) apagar();
      else refrescar();   // sin señal u otro error pasajero: se reintenta en el próximo minuto
    } finally { S.generando = false; }
  }

  // ── Sección «Fijos semanales» ──
  function resumen(items) {
    return (items || []).map(x => {
      const it = { prod: x.producto, qty: Number(x.cantidad) || 1, fetear: !!x.fetear, sinCuero: !!x.sin_cuero };
      if (x.medida) it.unidades = x.medida; else if (x.en_unidades) it.unidades = true;
      return (typeof itemLabelCorto === 'function' ? itemLabelCorto(it) : it.qty) + ' ' + it.prod;
    }).join(' · ');
  }
  function lunes() { return lunesDe(hoyArg()); }
  function armar() {
    const d = $('fijos'); if (!d || S.listo) return;
    d.innerHTML = `<summary><span id="fijos-tit">📌 Fijos semanales (0)</span><button type="button" class="fijo-btn fijo-nuevo" data-fijo="nuevo" title="Cargar un pedido fijo semanal">📌 Nuevo fijo</button></summary>
      <div class="fijos-cuerpo">
        <div id="fijos-lista"></div>
        <p id="fijos-aviso" class="fijos-ayuda" role="status" aria-live="polite"></p>
      </div>`;
    d.addEventListener('click', e => {
      const b = e.target.closest('[data-fijo]'); if (!b) return;
      if (b.dataset.fijo === 'nuevo') { e.preventDefault(); abrirAlta(b); return; }   // dentro del <summary>: no plegar ni desplegar
      if (b.dataset.fijo === 'editar') { abrirEditar(b.dataset.id, b); return; }
      accion(b.dataset.fijo, b.dataset.id);
    });
    S.listo = true;
  }
  function dibujar() {
    armar();
    if (!S.listo) return;
    $('fijos-tit').textContent = '📌 Fijos semanales (' + S.lista.length + ')';
    $('fijos-aviso').textContent = S.aviso;
    const L = $('fijos-lista'), lun = lunes();
    if (!S.lista.length) { L.innerHTML = '<p class="fijos-vacio">' + (S.cargado ? 'Todavía no hay pedidos fijos.' : 'Buscando…') + '</p>'; return; }
    L.innerHTML = S.lista.map(f => {
      const oc = S.ocupados.has(f.id) ? ' disabled' : '', d = `data-id="${esc(f.id)}"`;
      const est = f.activo === false ? 'Pausado' : (f.ultima_semana === lun ? 'Pedido de esta semana creado' : 'Se crea esta semana');
      return `<article class="fijo-it${f.activo === false ? ' fijo-pausado' : ''}" ${d}>
        <div class="fijo-cli">${esc(f.cliente)}</div>
        <div class="fijo-res">${esc(resumen(f.items))}</div>
        <div class="fijo-est">${est}</div>
        ${f.ultimo_error ? `<div class="fijo-err">${esc(f.ultimo_error)}</div>` : ''}
        <div class="fijo-acc">
          <button type="button" class="fijo-btn" data-fijo="editar" ${d}${oc}>Editar</button>
          <button type="button" class="fijo-btn" data-fijo="${f.activo === false ? 'reanudar' : 'pausar'}" ${d}${oc}>${f.activo === false ? 'Reanudar' : 'Pausar'}</button>
          <button type="button" class="fijo-btn fijo-quitar" data-fijo="quitar" ${d}${oc}>Quitar</button>
        </div></article>`;
    }).join('');
  }

  async function refrescar() {
    if (S.noHay || S.refrescando || !conSesion()) return;
    S.refrescando = true;
    try {
      S.lista = await sbAccion('fijosListar', []);
      S.cargado = true; S.aviso = '';
      encender();
    } catch (e) {
      if (sinTabla(e)) apagar();
    } finally { S.refrescando = false; dibujar(); }
  }

  async function accion(que, id) {
    if (S.ocupados.has(id)) return;
    const f = S.lista.find(x => x.id === id); if (!f) return;
    let patch;
    if (que === 'pausar') patch = { activo: false, actualizado_en: new Date().toISOString() };
    else if (que === 'reanudar') patch = { activo: true, actualizado_en: new Date().toISOString() };
    else if (que === 'quitar') {
      if (!confirm('¿Quitar el pedido fijo de ' + f.cliente + '? Los pedidos que ya se crearon no se tocan.')) return;
      patch = { eliminado_en: new Date().toISOString(), eliminado_por: quien(), actualizado_en: new Date().toISOString() };
    } else return;
    S.ocupados.add(id); S.aviso = ''; dibujar();
    try {
      await sbAccion('fijoCambiar', [id, patch]);
      S.lista = await sbAccion('fijosListar', []);
    } catch (e) {
      S.aviso = 'No se pudo cambiar. Probá de nuevo.';
    } finally { S.ocupados.delete(id); dibujar(); }
  }

  // ── Ventana «Pedido fijo semanal» (alta y edición) ──
  const nuevoId = () => 'fij_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8).replace(/[^a-z0-9]/g, 'x');
  const abierto = () => $('fijoModal').classList.contains('open');
  function error(msg) { $('fijoError').textContent = msg || ''; }
  function abrirVentana(titulo, disp) {
    S.disparador = disp || null; S.guardando = false;
    $('fijoModalTit').textContent = titulo;
    $('fijoGuardarBtn').disabled = false;
    error('');
    $('fijoModal').classList.add('open');
    // En celular no se abre el teclado solo: los productos entran por el selector.
    if (!esMobile()) setTimeout(() => { if (abierto()) $('f_cliente').focus(); }, 60);
  }
  function abrirAlta(disp) {
    S.modal = { id: nuevoId(), editar: false };   // el id se genera acá, una vez: reintentar usa el mismo
    $('f_cliente').value = ''; $('f_direccion').value = ''; $('f_direccion').dataset.auto = '';
    $('f_notas').value = ''; $('f_retiro').checked = false; $('f_primer_esta').checked = true;
    $('f_primer').hidden = false;
    $('fijoItemRows').innerHTML = '';
    if (!esMobile()) addItemRow('fijo');
    abrirVentana('📌 Pedido fijo semanal', disp);
  }
  function abrirEditar(id, disp) {
    const f = S.lista.find(x => x.id === id); if (!f) return;
    S.modal = { id, editar: true };
    $('f_cliente').value = f.cliente || ''; $('f_direccion').value = f.direccion || ''; $('f_direccion').dataset.auto = '';
    $('f_notas').value = f.notas || ''; $('f_retiro').checked = !!f.retiro;
    $('f_primer').hidden = true;
    const cont = $('fijoItemRows'); cont.innerHTML = '';
    (f.items || []).forEach(x => addItemRowWith('fijo', {
      prod: x.producto, qty: Number(x.cantidad) || 1, fetear: !!x.fetear, sinCuero: !!x.sin_cuero,
      unidades: x.medida || (x.en_unidades ? true : undefined)
    }));
    if (!cont.children.length && !esMobile()) addItemRow('fijo');
    abrirVentana('📌 Editar pedido fijo', disp);
  }
  function cerrar() {
    if (S.guardando) return;
    closeModal('fijoModal');
    if (S.disparador && document.contains(S.disparador)) S.disparador.focus();
  }
  async function guardar() {
    if (S.guardando || !S.modal) return;
    const cliente = $('f_cliente').value.trim();
    if (!cliente) { error('Escribí el nombre del cliente.'); $('f_cliente').focus(); return; }
    const filas = [...$('fijoItemRows').querySelectorAll('.item-row')];
    const cargados = filas.filter(r => r.querySelector('.ac-input').value.trim());
    if (!cargados.length) { error('Agregá al menos un producto.'); return; }
    if (cargados.some(r => !(parseFloat(r.querySelector('.qty-input').value) > 0))) { error('Poné una cantidad mayor a cero en cada producto.'); return; }
    const items = itemsFijoBase_(getItemRows('fijo'));
    const direccion = $('f_direccion').value.trim(), notas = $('f_notas').value.trim(), retiro = $('f_retiro').checked;
    const { id, editar } = S.modal;
    const esta = !editar && $('f_primer_esta').checked;
    error(''); S.guardando = true; $('fijoGuardarBtn').disabled = true;
    try {
      if (editar) {
        const r = await sbAccion('fijoCambiar', [id, { cliente, direccion, notas, retiro, items, actualizado_en: new Date().toISOString() }]);
        if (r && r.ok === false) throw new Error('no se pudo');
      } else {
        await sbAccion('fijoCrear', [{ id, cliente, direccion, notas, retiro, items, ultima_semana: esta ? null : lunes(), creado_por: quien() }]);
      }
    } catch (e) {
      S.guardando = false; $('fijoGuardarBtn').disabled = false;
      error(sinTabla(e) ? 'Los pedidos fijos todavía no están disponibles.' : 'No se pudo guardar. Probá de nuevo (no se va a duplicar).');
      return;
    }
    S.guardando = false; $('fijoGuardarBtn').disabled = false;
    S.modal = null; cerrar();
    let aviso = editar ? '✓ Fijo actualizado' : (esta ? '✓ Fijo guardado' : '✓ Fijo guardado: arranca la semana que viene');
    if (esta) {
      try {
        const r = await sbAccion('generarFijos', []);
        S.ultGen = Date.now();
        if (r && r.creados > 0 && typeof reload === 'function') reload();
      } catch (e) { aviso = 'Fijo guardado. El pedido de esta semana se crea en un rato.'; }
    }
    toast(aviso);
    try { S.lista = await sbAccion('fijosListar', []); S.cargado = true; } catch (e) {}
    dibujar();
  }
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !$('fijoModal') || !abierto()) return;
    const pk = $('picker'); if (pk && pk.classList.contains('open')) return;   // el selector de producto se cierra primero
    e.preventDefault(); cerrar();
  });

  function iniciar() {
    armar();
    // Hasta que haya sesión y la primera carga de pedidos no se puede: se prueba seguido al principio.
    let intentos = 0;
    const arranque = setInterval(() => {
      intentos++;
      const listoApp = typeof ultimoRefresh !== 'undefined' && ultimoRefresh > 0;
      if (conSesion() && listoApp) { clearInterval(arranque); S.arrancado = true; generar(); }
      else if (intentos > 180) clearInterval(arranque);
    }, 1000);
    // Mientras la app queda abierta: como mucho una vez por hora (si el intento anterior falló, se reintenta en el minuto siguiente).
    const toca = () => S.arrancado && document.visibilityState === 'visible' && Date.now() - S.ultGen >= CADA_HORA;
    setInterval(() => { if (toca()) generar(); }, 60000);
    document.addEventListener('visibilitychange', () => { if (toca()) generar(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
  window.PedidosFijos = { refrescar, generar, cerrar, guardar, abrirAlta, abrirEditar, _estado: S };
})();
