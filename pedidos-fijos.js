/* Pedidos fijos semanales (pedido del usuario, 11/11/2026).
   Un cliente que lleva lo mismo todas las semanas, sin día fijo: se arma una vez (casilla «Repetir todas las semanas» en Cargar)
   y la base crea sola un pedido Pendiente por semana (lunes a domingo, hora de Argentina) con generar_fijos_semana().
   Acá: (1) al abrir la app y como mucho una vez por hora se pide esa generación y, si creó pedidos, se refrescan;
   (2) en Pedidos, una sección plegable «Fijos semanales» para pausar, reanudar o quitar cada uno.
   El registro del fijo lo hace sbSavePedido (index.html) por la misma cola de reintentos del pedido: el id 'fij_…' se genera una sola vez.
   Si la tabla o la función no existen todavía (SQL 20 sin aplicar) la app sigue igual y la casilla y la sección quedan ocultas.
   Datos: tabla pedidos_fijos (supabase/20-pedidos-fijos-semanales.sql); en modo prueba, los datos de prueba (sandboxAccion). */
(function () {
  'use strict';
  const CADA_HORA = 60 * 60 * 1000;
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const S = { lista: [], cargado: false, listo: false, noHay: false, generando: false, ultGen: 0, ocupados: new Set(), aviso: '', refrescando: false };
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
    d.innerHTML = `<summary><span id="fijos-tit">📌 Fijos semanales (0)</span></summary>
      <div class="fijos-cuerpo">
        <p class="fijos-ayuda">Para cambiar los productos, quitalo y cargá un pedido nuevo con la casilla marcada.</p>
        <div id="fijos-lista"></div>
        <p id="fijos-aviso" class="fijos-ayuda" role="status" aria-live="polite"></p>
      </div>`;
    d.addEventListener('click', e => {
      const b = e.target.closest('[data-fijo]'); if (!b) return;
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
  window.PedidosFijos = { refrescar, generar, _estado: S };
})();
