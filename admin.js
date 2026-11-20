/* Panel de administración (solo Oscar y Joaquín): Productos (gestion.js), Clientes (padrón) e Historial de pedidos.
   El botón del header solo se muestra a quien corresponde; el permiso real lo valida la base (admin_* con stock_es_admin()).
   Escrituras: cada intento de guardado genera UN op_id (uuid) que se reutiliza en los reintentos hasta que sale bien (la base lo reconoce y no repite el cambio).
   Los borradores de las fichas se guardan por registro en localStorage mientras el panel está abierto. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const admin = () => !!(window.GestionUI && GestionUI.admin());
  const nuevoId = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));
  const fmt = d => (typeof fmtDate === 'function' ? fmtDate(d) : String(d || ''));
  const fmtTs = ts => { try { return new Date(ts).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (_) { return String(ts || ''); } };
  const hoy = () => (typeof hoyArg === 'function' ? hoyArg() : new Date().toISOString().slice(0, 10));
  const dia = s => String(s || '').slice(0, 10);
  const diaAntes = s => { const d = new Date(dia(s) + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };
  const key = v => String(v || '').trim().toLowerCase();

  const E = {
    abierto: false, sec: 'productos', origen: null, confirmar: null, fu: null,
    cli: { q: '', bajas: false, lista: [], cargando: false, error: '', tok: 0, F: null, timer: null, montado: false, cargada: false },
    his: { q: '', desde: '', hasta: '', estado: 'todos', filas: [], siguiente: null, hayMas: false, cargando: false, error: '', tok: 0, F: null, timer: null, montado: false, cargada: false }
  };

  async function rpc(name, args) { const r = await RepartoRed.pedir(sb.rpc(name, args)); if (r.error) throw r.error; return r.data; }
  function msg(e) {
    const m = String((e && e.message) || '');
    if (e && e.code === '42501') return 'No tenés acceso a esta sección.';
    if (/fetch|network|load failed|conexi/i.test(m)) return 'Sin conexión. Tus cambios siguen acá: reintentá cuando vuelva la señal.';
    return m || 'No se pudo completar. Reintentá.';
  }
  const conflicto = e => /Otro cambio se guardó antes/.test(String((e && e.message) || ''));

  // ── Borradores por registro (solo mientras el panel está abierto) ──
  const dk = (t, id) => 'adm_borr_' + t + '_' + id;
  const guardarBorr = (t, F) => { try { localStorage.setItem(dk(t, F.id), JSON.stringify(F.borr)); } catch (_) { /* sin espacio: queda en memoria */ } };
  const leerBorr = (t, id) => { try { return JSON.parse(localStorage.getItem(dk(t, id)) || 'null'); } catch (_) { return null; } };
  const borrarBorr = (t, id) => { try { localStorage.removeItem(dk(t, id)); } catch (_) { /* nada */ } };
  const limpiarBorr = () => { try { Object.keys(localStorage).filter(k => k.startsWith('adm_borr_')).forEach(k => localStorage.removeItem(k)); } catch (_) { /* nada */ } };

  // ── Abrir, cerrar y pestañas ──
  function abrir(sec) {
    if (!admin()) return;
    const ov = $('adminPanel'); if (!ov) return;
    if (!E.abierto) { E.origen = document.activeElement; E.abierto = true; ov.classList.add('open'); }
    irA(sec || E.sec, true);
  }
  function cerrar() { const ov = $('adminPanel'); if (ov) ov.classList.remove('open'); }
  // Cualquier cierre (X, Escape, fondo —lo hace el código general de los .overlay—, cambio de usuario) pasa por acá.
  function alCerrar() {
    if (!E.abierto) return;
    E.abierto = false; limpiarBorr(); cancelarConfirmacion(); if (E.fu) cerrarFusion();
    ['cli', 'his'].forEach(k => { E[k].F = null; E[k].tok++; E[k].cargada = false; E[k].cargando = false; clearTimeout(E[k].timer); const s = $(k === 'cli' ? 'adm-clientes' : 'adm-historial'); if (s) { s.innerHTML = ''; } E[k].montado = false; });
    const o = E.origen; E.origen = null;
    const el = o && o.isConnected && o !== document.body ? o : $('adminBtn');
    if (el && el.focus) el.focus({ preventScroll: true });
  }
  function reiniciar() { if (E.abierto) cerrar(); }
  (function vigilar() {
    const ov = $('adminPanel'); if (!ov || !window.MutationObserver) return;
    new MutationObserver(() => { if (!ov.classList.contains('open')) alCerrar(); }).observe(ov, { attributes: true, attributeFilter: ['class'] });
  })();

  function irA(sec, foco) {
    E.sec = sec;
    ['productos', 'clientes', 'historial'].forEach(s => {
      const t = $('adm-tab-' + s), p = $('adm-' + s), on = s === sec;
      t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; p.hidden = !on;
    });
    if (sec === 'productos' && window.GestionUI) GestionUI.abrir('productos');
    if (sec === 'clientes') { montarClientes(); if (!E.cli.cargada) cargarClientes(); }
    if (sec === 'historial') { montarHistorial(); if (!E.his.cargada) buscarHistorial(false); }
    if (foco) { const t = $('adm-tab-' + sec); if (t) t.focus({ preventScroll: true }); }
  }

  // ── Confirmación dentro del panel (renombre y baja; restaurar no pregunta) ──
  function confirmar({ titulo, html, boton, peligro }) {
    cancelarConfirmacion();
    return new Promise(res => {
      let d = $('adm-confirm');
      if (!d) { d = document.createElement('div'); d.id = 'adm-confirm'; d.className = 'adm-confirm'; d.setAttribute('role', 'alertdialog'); d.setAttribute('aria-modal', 'true'); d.setAttribute('aria-labelledby', 'adm-confirm-t'); $('admin-modal').appendChild(d); }
      d.innerHTML = `<div><h3 id="adm-confirm-t">${esc(titulo)}</h3>${html}<div class="adm-acciones"><button type="button" class="adm-btn" data-adm="c-no">Cancelar</button><button type="button" class="adm-btn ${peligro ? 'peligro' : 'primario'}" data-adm="c-ok">${esc(boton)}</button></div></div>`;
      d.hidden = false; E.confirmar = res; d.querySelector('[data-adm="c-no"]').focus();
    });
  }
  function cerrarConfirmacion(ok) { const d = $('adm-confirm'), r = E.confirmar; E.confirmar = null; if (d) d.hidden = true; if (r) r(ok); }
  function cancelarConfirmacion() { if (E.confirmar) cerrarConfirmacion(false); }

  // ═══════════════ CLIENTES ═══════════════
  function montarClientes() {
    const r = $('adm-clientes'); if (E.cli.montado && r.firstChild) return; E.cli.montado = true;
    r.innerHTML = `<div class="adm-dos" id="adm-cli-dos">
      <div class="adm-col adm-lista-col">
        <div class="adm-barra">
          <div class="adm-fila-barra"><input id="adm-cli-q" type="search" placeholder="Buscar cliente…" aria-label="Buscar cliente" autocomplete="off" value="${esc(E.cli.q)}"><button type="button" class="adm-btn primario" data-adm="cli-nuevo">+ Nuevo cliente</button></div>
          <label><input type="checkbox" id="adm-cli-bajas" ${E.cli.bajas ? 'checked' : ''}> Ver dados de baja</label>
        </div>
        <div class="adm-estado" id="adm-cli-info" role="status" aria-live="polite"></div>
        <div class="adm-lista" id="adm-cli-lista"></div>
      </div>
      <div class="adm-col adm-ficha-col" id="adm-cli-ficha"></div></div>`;
    pintarListaClientes(); pintarFichaCliente();
  }
  async function cargarClientes() {
    const C = E.cli, tok = ++C.tok; C.cargando = true; C.error = ''; pintarListaClientes();
    try {
      const r = await rpc('admin_clientes_listar', { p_q: C.q, p_bajas: C.bajas });
      if (tok !== C.tok) return;
      C.lista = Array.isArray(r) ? r : []; C.cargada = true;
    } catch (e) { if (tok === C.tok) C.error = msg(e); }
    finally { if (tok === C.tok) { C.cargando = false; pintarListaClientes(); } }
  }
  function pintarListaClientes() {
    const C = E.cli, l = $('adm-cli-lista'), i = $('adm-cli-info'); if (!l) return;
    i.classList.toggle('error', !!C.error);
    i.innerHTML = C.error ? `${esc(C.error)} <button type="button" class="adm-btn chico" data-adm="cli-recargar">Reintentar</button>` : C.cargando ? 'Buscando…' : `${C.lista.length} ${C.lista.length === 1 ? 'cliente' : 'clientes'}`;
    l.innerHTML = C.lista.map(c => `<button type="button" class="adm-fila" data-adm="cli-abrir" data-id="${esc(c.id)}" ${C.F && C.F.id === c.id ? 'aria-current="true"' : ''}>
      <b>${esc(c.nombre)} ${c.fusionado_en ? `<span class="adm-chip baja">Fusionado con ${esc(c.fusionado_con || 'otro')}</span>` : c.eliminado_en ? '<span class="adm-chip baja">De baja</span>' : ''}</b>
      <span>${esc(c.direccion || 'Sin dirección')}</span>
      <span>${c.pedidos} ${c.pedidos === 1 ? 'pedido' : 'pedidos'}${c.ultimo_pedido ? ' · Último ' + esc(fmt(c.ultimo_pedido)) : ''}</span></button>`).join('')
      || (C.cargando ? '' : '<p class="adm-vacio">No hay clientes con ese criterio.</p>');
  }
  function abrirCliente(id) {
    const row = E.cli.lista.find(c => c.id === id); if (!row) return;
    const F = { id, nuevo: false, orig: { ...row }, borr: { nombre: row.nombre, direccion: row.direccion || '', observaciones: row.observaciones || '' }, op: null, opBaja: null, guardando: false, error: '', conflicto: false, cambios: null, recuperado: false };
    aplicarBorrador('clientes', F); E.cli.F = F; pintarListaClientes(); pintarFichaCliente(true);
    cargarCambios('clientes', id).then(c => { if (E.cli.F === F) { F.cambios = c; pintarHistorialCliente(); } }).catch(() => { if (E.cli.F === F) { F.cambios = []; pintarHistorialCliente(); } });
  }
  function nuevoCliente() {
    const F = { id: nuevoId(), nuevo: true, orig: { nombre: '', direccion: '', observaciones: '' }, borr: { nombre: '', direccion: '', observaciones: '' }, op: null, guardando: false, error: '', conflicto: false, cambios: [] };
    E.cli.F = F; pintarListaClientes(); pintarFichaCliente(true);
  }
  function aplicarBorrador(t, F) {
    const b = leerBorr(t, F.id); if (!b) return;
    const orig = t === 'clientes' ? { nombre: F.orig.nombre, direccion: F.orig.direccion || '', observaciones: F.orig.observaciones || '' } : F.borr;
    if (JSON.stringify(b) !== JSON.stringify(orig)) { F.borr = { ...F.borr, ...b }; F.recuperado = true; }
  }
  const cambiosCli = F => {
    const d = {}, n = F.borr.nombre.trim(), dir = F.borr.direccion.trim(), obs = (F.borr.observaciones || '').trim();
    if (F.nuevo) { d.nombre = n; d.direccion = dir; if (obs) d.observaciones = obs; return d; }
    if (n !== F.orig.nombre) d.nombre = n; if (dir !== (F.orig.direccion || '')) d.direccion = dir; if (obs !== (F.orig.observaciones || '')) d.observaciones = obs; return d;
  };

  function pintarFichaCliente(foco) {
    const C = E.cli, cont = $('adm-cli-ficha'), dos = $('adm-cli-dos'); if (!cont) return;
    const F = C.F;
    dos.classList.toggle('ver-ficha', !!F);
    if (!F) { cont.innerHTML = '<p class="adm-vacio">Elegí un cliente de la lista o creá uno nuevo.</p>'; return; }
    const o = F.orig, fus = !!o.fusionado_en, dis = F.guardando || fus ? 'disabled' : '';
    cont.innerHTML = `<form class="adm-ficha" id="adm-cli-form" novalidate>
      <button type="button" class="adm-btn chico adm-volver" data-adm="cli-volver">← Volver a la lista</button>
      <h3 id="adm-ficha-h" tabindex="-1">${F.nuevo ? 'Nuevo cliente' : esc(o.nombre)}</h3>
      <div class="adm-sub">${F.nuevo ? '' : `${o.fusionado_en ? `<span class="adm-chip baja">Fusionado con ${esc(o.fusionado_con || 'otro cliente')}</span>` : o.eliminado_en ? '<span class="adm-chip baja">De baja</span>' : ''}<span>${o.pedidos ?? 0} pedidos${o.ultimo_pedido ? ' · último ' + esc(fmt(o.ultimo_pedido)) : ''}</span>`}</div>
      ${F.recuperado ? '<p class="adm-nota">Recuperamos los cambios que no se habían guardado.</p>' : ''}
      <div class="adm-grid">
        <label class="adm-campo ancho">Nombre<input name="nombre" data-f="nombre" maxlength="200" autocomplete="off" value="${esc(F.borr.nombre)}" ${dis} required></label>
        <label class="adm-campo ancho">Dirección<input name="direccion" data-f="direccion" maxlength="300" autocomplete="off" value="${esc(F.borr.direccion)}" ${dis}></label>
        <label class="adm-campo ancho">Observación (opcional)<textarea name="observaciones" data-f="observaciones" rows="2" maxlength="1000" ${dis}>${esc(F.borr.observaciones || '')}</textarea><small>Se ve también en la ficha del seguimiento comercial.</small></label>
        ${F.nuevo ? '' : `<div class="adm-campo ancho">Teléfono de WhatsApp vinculado<div class="adm-valor">${(o.telefonos || []).length ? esc(o.telefonos.join(' · ')) : 'Sin teléfono vinculado'}</div><small>Solo lectura: se vincula desde WhatsApp.</small></div>`}
      </div>
      <div class="adm-aviso" id="adm-cli-aviso" hidden></div>
      <div class="adm-msg" id="adm-cli-msg" role="alert">${esc(F.error)}</div>
      <div class="adm-acciones">
        <button type="submit" class="adm-btn primario" id="adm-cli-guardar" ${dis}>${F.guardando ? 'Guardando…' : F.error && !F.conflicto ? 'Reintentar' : F.nuevo ? 'Crear cliente' : 'Guardar cambios'}</button>
        ${F.conflicto ? '<button type="button" class="adm-btn" data-adm="cli-recargar-ficha">Recargar cliente</button>' : ''}
        ${F.nuevo ? '<button type="button" class="adm-btn" data-adm="cli-volver">Cancelar</button>' : fus ? '<span class="adm-nota">Cliente fusionado: ya no se puede editar ni restaurar.</span>' : o.eliminado_en
          ? `<button type="button" class="adm-btn" data-adm="cli-restaurar" ${dis}>Restaurar cliente</button>`
          : `<button type="button" class="adm-btn peligro" data-adm="cli-baja" ${dis}>Dar de baja</button>`}
        ${F.nuevo || fus ? '' : `<button type="button" class="adm-btn" data-adm="cli-fusionar" ${dis}>Fusionar con otro cliente…</button>`}
      </div>
      ${F.nuevo ? '' : '<div class="adm-bloque"><h4>Historial de cambios</h4><ul class="adm-hist" id="adm-cli-hist"></ul></div>'}</form>`;
    pintarHistorialCliente(); avisoCliente();
    if (foco) { const h = $('adm-ficha-h'); if (h) h.focus({ preventScroll: true }); }
  }
  function avisoCliente() {
    const F = E.cli.F, a = $('adm-cli-aviso'); if (!F || !a) return;
    const d = cambiosCli(F), ren = !F.nuevo && d.nombre !== undefined;
    a.hidden = !ren; if (ren) a.textContent = 'Al guardar se cambiará el nombre en sus pedidos y en lo que esté a su nombre (te mostramos cuántos antes de confirmar).';
  }
  function pintarHistorialCliente() { const u = $('adm-cli-hist'), F = E.cli.F; if (u && F) u.innerHTML = listaCambios(F.cambios); }
  function msgCli(t, ok) { const m = $('adm-cli-msg'); if (m) { m.textContent = t || ''; m.classList.toggle('ok', !!ok); } }

  function bloquearCli(F, on) {
    F.guardando = on;
    const f = $('adm-cli-form'); if (!f || E.cli.F !== F) return;
    f.querySelectorAll('input,button[data-adm="cli-baja"],button[data-adm="cli-restaurar"],#adm-cli-guardar').forEach(x => { x.disabled = on; });
    const b = $('adm-cli-guardar'); if (b) b.textContent = on ? 'Guardando…' : F.error && !F.conflicto ? 'Reintentar' : F.nuevo ? 'Crear cliente' : 'Guardar cambios';
  }
  async function guardarCliente() {
    const F = E.cli.F; if (!F || F.guardando) return;
    const d = cambiosCli(F);
    if (!d.nombre && (F.nuevo || d.nombre !== undefined)) { F.error = 'Escribí el nombre del cliente.'; msgCli(F.error); return; }
    if (!F.nuevo && !Object.keys(d).length) { F.error = ''; msgCli('No hay cambios para guardar.', true); return; }
    F.error = ''; F.conflicto = false; msgCli('');
    if (!F.nuevo && d.nombre !== undefined) {
      bloquearCli(F, true);
      let imp;
      try { imp = await rpc('admin_cliente_impacto', { p_id: F.id }); } catch (e) { F.error = msg(e); msgCli(F.error); bloquearCli(F, false); return; }
      bloquearCli(F, false);
      if (E.cli.F !== F) return;
      const ok = await confirmar({ titulo: 'Cambiar el nombre del cliente', boton: 'Cambiar nombre', html: `<p>«${esc(F.orig.nombre)}» pasará a llamarse «${esc(d.nombre)}». Se van a actualizar:</p><ul>${resumenImpacto(imp)}</ul><p>El historial de seguimiento y las hojas de reparto ya armadas conservan el nombre de entonces.</p>` });
      if (!ok || E.cli.F !== F) { const i = document.querySelector('#adm-cli-form [name="nombre"]'); if (i) i.focus(); return; }
    }
    await enviarCliente(F, d);
  }
  const NOMBRES_IMPACTO = { pedidos: ['pedido', 'pedidos'], pedidos_fijos: ['pedido fijo', 'pedidos fijos'], app_notas: ['nota', 'notas'], pedidos_a_cargar: ['pedido por cargar', 'pedidos por cargar'], whatsapp_contacts: ['contacto de WhatsApp', 'contactos de WhatsApp'], whatsapp_client_review: ['revisión de vínculo', 'revisiones de vínculo'] };
  function resumenImpacto(imp) {
    const l = Object.keys(NOMBRES_IMPACTO).filter(k => imp && imp[k] > 0).map(k => `<li>${imp[k]} ${NOMBRES_IMPACTO[k][imp[k] === 1 ? 0 : 1]}</li>`);
    return l.join('') || '<li>Ningún registro asociado</li>';
  }
  async function enviarCliente(F, datos) {
    const h = JSON.stringify([F.orig.version || null, datos]);
    if (!F.op || F.op.h !== h) F.op = { id: nuevoId(), h };      // un op por intento: se reutiliza al reintentar el mismo cambio
    const antesNombre = F.orig.nombre;
    bloquearCli(F, true);
    try {
      const r = await rpc('admin_cliente_guardar', { p_op: F.op.id, p_id: F.id, p_version: F.nuevo ? null : F.orig.version, p_datos: datos });
      F.guardando = false; F.op = null; F.error = ''; F.conflicto = false; borrarBorr('clientes', F.id);
      aplicarResultadoCliente(F, r, antesNombre);
      if (E.cli.F === F) { F.recuperado = false; pintarFichaCliente(); msgCli('Guardado.', true); }
      toast('Cliente guardado');
    } catch (e) {
      F.guardando = false; F.error = msg(e); F.conflicto = conflicto(e);
      if (E.cli.F === F) pintarFichaCliente();
    }
  }
  function aplicarResultadoCliente(F, r, antesNombre) {
    const prev = E.cli.lista.find(c => c.id === F.id) || {};
    const fila = { ...prev, ...F.orig, id: r.id, nombre: r.nombre, direccion: r.direccion, observaciones: r.observaciones, eliminado_en: r.eliminado_en, fusionado_en: r.fusionado_en, version: r.version };
    F.nuevo = false; F.orig = fila; F.borr = { nombre: r.nombre, direccion: r.direccion || '', observaciones: r.observaciones || '' };
    if (prev.id) E.cli.lista = E.cli.lista.map(c => c.id === r.id ? fila : c); else if (!E.cli.q || key(r.nombre).includes(key(E.cli.q))) { fila.pedidos = 0; fila.telefonos = []; E.cli.lista = [fila].concat(E.cli.lista); F.orig = fila; }
    if (E.cli.lista.length) E.cli.lista.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));
    pintarListaClientes();
    cargarCambios('clientes', F.id).then(c => { F.cambios = c; if (E.cli.F === F) pintarHistorialCliente(); }).catch(() => {});
    clienteEnApp(antesNombre, r);
  }
  async function bajaCliente(baja) {
    const F = E.cli.F; if (!F || F.guardando || F.nuevo) return;
    if (baja) {
      const ok = await confirmar({ titulo: 'Dar de baja al cliente', boton: 'Dar de baja', peligro: true, html: `<p>«${esc(F.orig.nombre)}» dejará de ofrecerse al cargar pedidos y de aparecer en Clientes (seguimiento), salvo que vuelva a pedir.</p><p>No se borra nada: sus pedidos se conservan y lo podés restaurar cuando quieras.</p>` });
      if (!ok || E.cli.F !== F) return;
    }
    if (!F.opBaja || F.opBaja.b !== baja) F.opBaja = { id: nuevoId(), b: baja };
    F.error = ''; F.conflicto = false; msgCli(''); bloquearCli(F, true);
    const antes = F.orig.nombre;
    try {
      const r = await rpc('admin_cliente_baja', { p_op: F.opBaja.id, p_id: F.id, p_baja: baja });
      F.guardando = false; F.opBaja = null; aplicarResultadoCliente(F, r, antes);
      if (E.cli.F === F) { pintarFichaCliente(); msgCli(baja ? 'Cliente dado de baja.' : 'Cliente restaurado.', true); }
      toast(baja ? 'Cliente dado de baja' : 'Cliente restaurado');
    } catch (e) { F.guardando = false; F.error = msg(e); if (E.cli.F === F) pintarFichaCliente(); }
  }
  // Las demás pantallas se ponen al día sin F5: autocompletado de Cargar, copias de pedidos y seguimiento.
  function clienteEnApp(antes, r, quieto) {
    try {
      const ord = (a, b) => a.n.localeCompare(b.n, 'es', { sensitivity: 'base' });
      const sinEste = l => (l || []).filter(c => key(c.n) !== key(antes) && key(c.n) !== key(r.nombre));
      state.clientes = sinEste(state.clientes); state.clientesBaja = sinEste(state.clientesBaja);
      if (r.eliminado_en) state.clientesBaja.push({ n: r.nombre, baja: dia(r.eliminado_en) }); else state.clientes.push({ n: r.nombre, d: r.direccion || '', obs: r.observaciones || '' });
      state.clientes.sort(ord);
      if (key(antes) !== key(r.nombre) || antes !== r.nombre) {
        const lotes = [state.pedidos, state.papelera, window.SegUI && SegUI._estado && SegUI._estado.historial];
        lotes.forEach(l => (l || []).forEach(p => { if (key(p.cliente) === key(antes)) p.cliente = r.nombre; }));
      }
      if (window.SegUI && SegUI.invalidar) SegUI.invalidar();
      if (typeof renderPedidos === 'function') renderPedidos();
    } catch (_) { /* la recarga de abajo los trae igual */ }
    if (!quieto) refrescarApp();
  }
  function refrescarApp() { try { if (typeof loadData === 'function' && state.pin) loadData(true); } catch (_) { /* siguiente refresco automático */ } }


  // ── Fusión de clientes duplicados: el destino conserva su nombre; el otro queda de baja «Fusionado con …». Sin deshacer desde la app. ──
  const NOM_FUSION = { pedidos: ['pedido', 'pedidos'], pedidos_fijos: ['pedido fijo', 'pedidos fijos'], app_notas: ['nota', 'notas'], pedidos_a_cargar: ['pedido por cargar', 'pedidos por cargar'], whatsapp_contacts: ['contacto de WhatsApp', 'contactos de WhatsApp'], whatsapp_client_review: ['revisión de vínculo de WhatsApp', 'revisiones de vínculo de WhatsApp'] };
  const TIPOS_DEC = { atender: 'Atender', recuperacion: 'Recuperación', pausa: 'Sin seguimiento' };
  function abrirFusion() {
    const F = E.cli.F; if (!F || F.nuevo || F.guardando) return;
    if (Object.keys(cambiosCli(F)).length) { F.error = 'Guardá o descartá los cambios de la ficha antes de fusionar.'; msgCli(F.error); return; }
    E.fu = { F, q: '', lista: [], otro: null, quien: 'actual', impacto: null, cargando: false, error: '', guardando: false, op: null, entiendo: false, tok: 0, tokI: 0, timer: null, origen: document.activeElement };
    let d = $('adm-fusion');
    if (!d) { d = document.createElement('div'); d.id = 'adm-fusion'; d.className = 'adm-confirm'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); d.setAttribute('aria-labelledby', 'adm-fu-t'); $('admin-modal').appendChild(d); }
    pintarFusion(); d.hidden = false; buscarOtro();
    const i = $('adm-fu-q'); if (i) i.focus();
  }
  function cerrarFusion() {
    const f = E.fu; if (!f) return; clearTimeout(f.timer); f.tok++; f.tokI++; E.fu = null;
    const d = $('adm-fusion'); if (d) { d.hidden = true; d.innerHTML = ''; }
    const o = f.origen; if (o && o.isConnected) o.focus({ preventScroll: true });
  }
  async function buscarOtro() {
    const f = E.fu; if (!f) return; const tok = ++f.tok;
    try {
      const r = await rpc('admin_clientes_listar', { p_q: f.q, p_bajas: false });
      if (!E.fu || tok !== f.tok) return;
      f.lista = (Array.isArray(r) ? r : []).filter(c => c.id !== f.F.id && !c.eliminado_en && !c.fusionado_en).slice(0, 30); f.error = '';
    } catch (e) { if (E.fu === f && tok === f.tok) f.error = msg(e); }
    if (E.fu === f && tok === f.tok) pintarListaFusion();
  }
  const sentido = f => { const a = f.F.orig, b = f.otro; return f.quien === 'actual' ? { origen: b, destino: a } : { origen: a, destino: b }; };
  function elegirOtro(id) { const f = E.fu; if (!f || f.guardando) return; f.otro = f.lista.find(c => c.id === id) || null; f.entiendo = false; f.op = null; pintarFusion(); cargarImpacto(); }
  async function cargarImpacto() {
    const f = E.fu; if (!f || !f.otro) return; const tok = ++f.tokI, { origen, destino } = sentido(f);
    f.impacto = null; f.error = ''; f.entiendo = false; pintarFusion();
    try { const r = await rpc('admin_cliente_fusion_impacto', { p_origen: origen.id, p_destino: destino.id }); if (E.fu === f && tok === f.tokI) { f.impacto = r; } }
    catch (e) { if (E.fu === f && tok === f.tokI) f.error = msg(e); }
    if (E.fu === f && tok === f.tokI) pintarFusion();
  }
  function textoImpacto(im, origen, destino) {
    const l = Object.keys(NOM_FUSION).filter(k => im[k] > 0).map(k => `<li>${im[k]} ${NOM_FUSION[k][im[k] === 1 ? 0 : 1]}</li>`);
    if (im.agenda === 'pasa_al_destino') l.push('<li>Su día del calendario de seguimiento pasa al cliente que queda</li>');
    if (im.agenda === 'se_descarta_la_del_origen') l.push('<li>Se descarta su día del calendario (queda el del otro)</li>');
    if (im.decisiones > 0) l.push(`<li>${im.decisiones} ${im.decisiones === 1 ? 'decisión' : 'decisiones'} de seguimiento (historial)</li>`);
    if (im.excepciones > 0) l.push(`<li>${im.excepciones} ${im.excepciones === 1 ? 'excepción' : 'excepciones'} de producto${im.excepciones_reemplazadas ? ` (${im.excepciones_reemplazadas} repetida${im.excepciones_reemplazadas === 1 ? '' : 's'}: queda la del cliente que se conserva)` : ''}</li>`);
    const dec = im.decision_reemplazada ? `<p class="adm-aviso">Los dos tienen una decisión de seguimiento vigente: se conserva la de «${esc(destino.nombre)}» (${esc(TIPOS_DEC[im.decision_destino] || im.decision_destino)}) y se cierra la de «${esc(origen.nombre)}» (${esc(TIPOS_DEC[im.decision_origen] || im.decision_origen)}).</p>` : '';
    return `<p>Se pasan a «${esc(destino.nombre)}»:</p><ul>${l.join('') || '<li>Ningún registro asociado</li>'}</ul>${dec}`;
  }
  function pintarFusion() {
    const f = E.fu, d = $('adm-fusion'); if (!f || !d) return;
    const act = f.F.orig, otro = f.otro, par = otro ? sentido(f) : null;
    const prev = $('adm-fu-q'), q = prev ? prev.value : f.q, fid = document.activeElement && d.contains(document.activeElement) ? document.activeElement.id : '';
    d.innerHTML = `<div style="width:min(580px,100%);max-height:100%;overflow:auto"><h3 id="adm-fu-t">Fusionar con otro cliente</h3>
      <p>Para juntar duplicados: sus pedidos y datos pasan a un solo cliente. El otro queda de baja como «Fusionado» y no se borra nada.</p>
      <label class="adm-campo">Buscar el otro cliente<input id="adm-fu-q" type="search" autocomplete="off" value="${esc(q)}" placeholder="Nombre o dirección" ${f.guardando ? 'disabled' : ''}></label>
      <div class="adm-lista" id="adm-fu-lista" style="max-height:170px;margin:6px 0"></div>
      ${otro ? `<fieldset style="border:0;padding:0;margin:8px 0"><legend class="adm-nota" style="font-weight:700">¿Con qué nombre queda?</legend>
        <label class="adm-campo check"><input type="radio" id="adm-fu-r-actual" name="fu-quien" value="actual" ${f.quien === 'actual' ? 'checked' : ''} ${f.guardando ? 'disabled' : ''}> ${esc(act.nombre)}</label>
        <label class="adm-campo check"><input type="radio" id="adm-fu-r-otro" name="fu-quien" value="otro" ${f.quien === 'otro' ? 'checked' : ''} ${f.guardando ? 'disabled' : ''}> ${esc(otro.nombre)}</label></fieldset>
        <div id="adm-fu-impacto">${f.impacto ? textoImpacto(f.impacto, par.origen, par.destino) : f.error ? '' : '<p class="adm-nota">Calculando…</p>'}</div>
        <label class="adm-campo check"><input type="checkbox" id="adm-fu-entiendo" ${f.entiendo ? 'checked' : ''} ${f.guardando || !f.impacto ? 'disabled' : ''}> Entiendo que no se puede deshacer desde la app</label>` : ''}
      <div class="adm-msg" id="adm-fu-msg" role="alert">${esc(f.error)}</div>
      <div class="adm-acciones"><button type="button" class="adm-btn" data-adm="fu-cerrar" ${f.guardando ? 'disabled' : ''}>Cancelar</button>
        <button type="button" class="adm-btn peligro" data-adm="fu-ok" id="adm-fu-ok" ${!f.impacto || !f.entiendo || f.guardando ? 'disabled' : ''}>${f.guardando ? 'Fusionando…' : f.error && f.impacto && f.entiendo ? 'Reintentar' : 'Fusionar'}</button></div></div>`;
    pintarListaFusion();
    const n = fid && $(fid); if (n && !n.disabled) n.focus();
  }
  function pintarListaFusion() {
    const f = E.fu, l = $('adm-fu-lista'); if (!f || !l) return;
    l.innerHTML = f.lista.map(c => `<button type="button" class="adm-fila" data-adm="fu-elegir" data-id="${esc(c.id)}" ${f.otro && f.otro.id === c.id ? 'aria-current="true"' : ''} ${f.guardando ? 'disabled' : ''}><b>${esc(c.nombre)}</b><span>${esc(c.direccion || 'Sin dirección')} · ${c.pedidos} ${c.pedidos === 1 ? 'pedido' : 'pedidos'}</span></button>`).join('') || '<p class="adm-vacio">No hay clientes con ese criterio.</p>';
  }
  async function ejecutarFusion() {
    const f = E.fu; if (!f || f.guardando || !f.otro || !f.impacto || !f.entiendo) return;
    const { origen, destino } = sentido(f), h = JSON.stringify([origen.id, destino.id, origen.version, destino.version]);
    if (!f.op || f.op.h !== h) f.op = { id: nuevoId(), h };       // un op por intento: el reintento reutiliza el mismo
    f.guardando = true; f.error = ''; pintarFusion();
    try {
      const r = await rpc('admin_cliente_fusionar', { p_op: f.op.id, p_origen: origen.id, p_destino: destino.id, p_version_origen: origen.version, p_version_destino: destino.version });
      f.guardando = false; f.op = null;
      terminarFusion(r, origen);
    } catch (e) { f.guardando = false; f.error = msg(e); if (E.fu === f) pintarFusion(); }
  }
  function terminarFusion(r, origen) {
    cerrarFusion(); borrarBorr('clientes', origen.id);
    try {
      [state.pedidos, state.papelera, window.SegUI && SegUI._estado && SegUI._estado.historial].forEach(l => (l || []).forEach(p => { if (key(p.cliente) === key(origen.nombre)) p.cliente = r.destino.nombre; }));
    } catch (_) { /* la recarga los trae igual */ }
    clienteEnApp(origen.nombre, r.origen, true); clienteEnApp(r.destino.nombre, r.destino, true);
    refrescarApp(); toast('Clientes fusionados');
    E.cli.F = null;
    cargarClientes().then(() => { if (E.abierto && E.cli.lista.some(c => c.id === r.destino.id)) { abrirCliente(r.destino.id); const m = $('adm-cli-msg'); if (m) { m.textContent = 'Fusión hecha: «' + origen.nombre + '» quedó dentro de este cliente.'; m.classList.add('ok'); } } });
  }

  // ═══════════════ HISTORIAL DE PEDIDOS ═══════════════
  const ESTADOS = [['todos', 'Todos'], ['Pendiente', 'Pendiente'], ['Despachado', 'Despachado'], ['Cancelado', 'Cancelado'], ['Eliminado', 'Eliminado']];
  function montarHistorial() {
    const r = $('adm-historial'); if (E.his.montado && r.firstChild) return; E.his.montado = true;
    const H = E.his;
    r.innerHTML = `<div class="adm-dos" id="adm-his-dos">
      <div class="adm-col adm-lista-col">
        <div class="adm-barra">
          <div class="adm-fila-barra"><input id="adm-his-q" type="search" placeholder="Buscar por cliente…" aria-label="Buscar pedidos por cliente" autocomplete="off" value="${esc(H.q)}"></div>
          <div class="adm-fila-barra"><label>Desde <input id="adm-his-desde" type="date" value="${esc(H.desde)}"></label><label>Hasta <input id="adm-his-hasta" type="date" value="${esc(H.hasta)}"></label></div>
          <div class="adm-fila-barra"><label>Estado <select id="adm-his-est">${ESTADOS.map(([v, t]) => `<option value="${v}" ${H.estado === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label></div>
        </div>
        <div class="adm-estado" id="adm-his-info" role="status" aria-live="polite"></div>
        <div class="adm-lista" id="adm-his-lista"></div>
      </div>
      <div class="adm-col adm-ficha-col" id="adm-his-ficha"></div></div>`;
    pintarListaHistorial(); pintarFichaPedido();
  }
  async function buscarHistorial(mas) {
    const H = E.his; if (mas && (H.cargando || !H.hayMas)) return;
    const tok = ++H.tok; H.cargando = true; H.error = '';
    if (!mas) { H.filas = []; H.siguiente = null; H.hayMas = false; }
    pintarListaHistorial();
    try {
      const r = await rpc('admin_pedidos_buscar', { p_q: H.q, p_desde: H.desde || null, p_hasta: H.hasta || null, p_estado: H.estado, p_cursor: mas ? H.siguiente : null, p_limite: 30 });
      if (tok !== H.tok) return;
      H.filas = H.filas.concat((r && r.filas) || []); H.siguiente = (r && r.siguiente) || null; H.hayMas = !!(r && r.hay_mas); H.cargada = true;
    } catch (e) { if (tok === H.tok) H.error = msg(e); }
    finally { if (tok === H.tok) { H.cargando = false; pintarListaHistorial(); } }
  }
  function pintarListaHistorial() {
    const H = E.his, l = $('adm-his-lista'), i = $('adm-his-info'); if (!l) return;
    i.classList.toggle('error', !!H.error);
    i.innerHTML = H.error ? `${esc(H.error)} <button type="button" class="adm-btn chico" data-adm="his-recargar">Reintentar</button>` : H.cargando && !H.filas.length ? 'Buscando…' : `${H.filas.length}${H.hayMas ? '+' : ''} ${H.filas.length === 1 ? 'pedido' : 'pedidos'}`;
    l.innerHTML = H.filas.map(p => {
      const est = p.eliminado_en ? 'Eliminado' : p.estado;
      return `<button type="button" class="adm-fila" data-adm="his-abrir" data-id="${esc(p.id)}" ${H.F && H.F.id === p.id ? 'aria-current="true"' : ''}>
        <b>${esc(p.cliente)}</b>
        <span>Pidió el ${esc(fmt(p.fecha_pedido || p.fecha))}${p.fecha_pedido && p.fecha_pedido !== p.fecha ? ' (corregida)' : ''} · Cargado el ${esc(fmt(p.fecha))} · <span class="adm-chip ${esc(est)}">${esc(est)}</span></span>
        <span>${p.renglones} ${p.renglones === 1 ? 'producto' : 'productos'}${p.resumen ? ': ' + esc(p.resumen) + (p.renglones > 3 ? '…' : '') : ''}</span></button>`;
    }).join('') + (H.hayMas ? `<button type="button" class="adm-btn adm-mas" data-adm="his-mas" ${H.cargando ? 'disabled' : ''}>${H.cargando ? 'Cargando…' : 'Cargar más'}</button>` : '')
      || (H.cargando ? '' : '<p class="adm-vacio">No hay pedidos con esos filtros.</p>');
  }

  async function abrirPedido(id) {
    const H = E.his, F = { id, cargando: true, dat: null, orig: null, borr: null, op: null, guardando: false, error: '', conflicto: false, cambios: null, recuperado: false };
    H.F = F; pintarListaHistorial(); pintarFichaPedido(true);
    try {
      const r = await rpc('admin_pedido_leer', { p_id: id });
      if (H.F !== F) return;
      cargarDatosPedido(F, r); F.cargando = false; aplicarBorrador('pedidos', F);
    } catch (e) { if (H.F !== F) return; F.cargando = false; F.error = msg(e); F.sinDatos = true; }
    pintarFichaPedido(true);
    if (!F.sinDatos) cargarCambios('pedidos', id).then(c => { F.cambios = c; if (H.F === F) pintarHistorialPedido(); }).catch(() => { F.cambios = []; if (H.F === F) pintarHistorialPedido(); });
  }
  function cargarDatosPedido(F, r) {
    F.dat = r; F.orig = r.pedido;
    F.borr = { fecha_pedido: dia(r.pedido.fecha_pedido || r.pedido.fecha), cliente: r.pedido.cliente || '', direccion: r.pedido.direccion || '', notas: r.pedido.notas || '', fecha_entrega: dia(r.pedido.fecha_entrega), retiro: !!r.pedido.retiro };
  }
  const editable = F => !!F.orig && F.orig.estado === 'Pendiente' && !F.orig.eliminado_en;
  const fechaEditable = F => !!F.orig && !F.orig.eliminado_en;
  function cambiosPed(F) {
    const o = F.orig, b = F.borr, d = {};
    const nfp = (!b.fecha_pedido || b.fecha_pedido === dia(o.fecha)) ? null : b.fecha_pedido;
    if (fechaEditable(F) && nfp !== (dia(o.fecha_pedido) || null)) d.fecha_pedido = nfp;
    if (editable(F)) {
      if (b.cliente.trim() !== (o.cliente || '')) d.cliente = b.cliente.trim();
      if (b.direccion !== (o.direccion || '')) d.direccion = b.direccion;
      if (b.notas !== (o.notas || '')) d.notas = b.notas;
      if (b.fecha_entrega !== dia(o.fecha_entrega)) d.fecha_entrega = b.fecha_entrega || null;
      if (b.retiro !== !!o.retiro) d.retiro = b.retiro;
    }
    return d;
  }
  const dispara = d => ['cliente', 'direccion', 'notas', 'fecha_entrega', 'retiro'].some(k => k in d);

  function pintarFichaPedido(foco) {
    const H = E.his, cont = $('adm-his-ficha'), dos = $('adm-his-dos'); if (!cont) return;
    const F = H.F; dos.classList.toggle('ver-ficha', !!F);
    if (!F) { cont.innerHTML = '<p class="adm-vacio">Elegí un pedido de la lista para ver y corregir su fecha.</p>'; return; }
    const volver = '<button type="button" class="adm-btn chico adm-volver" data-adm="his-volver">← Volver a la lista</button>';
    if (F.cargando) { cont.innerHTML = `<div class="adm-ficha">${volver}<h3 id="adm-ficha-h" tabindex="-1">Cargando pedido…</h3></div>`; if (foco) $('adm-ficha-h').focus({ preventScroll: true }); return; }
    if (F.sinDatos) { cont.innerHTML = `<div class="adm-ficha">${volver}<h3 id="adm-ficha-h" tabindex="-1">No se pudo abrir el pedido</h3><div class="adm-msg" role="alert">${esc(F.error)}</div><div class="adm-acciones"><button type="button" class="adm-btn primario" data-adm="his-reabrir" data-id="${esc(F.id)}">Reintentar</button></div></div>`; if (foco) $('adm-ficha-h').focus({ preventScroll: true }); return; }
    const o = F.orig, b = F.borr, ed = editable(F), fe = fechaEditable(F), dis = F.guardando ? 'disabled' : '', est = o.eliminado_en ? 'Eliminado' : o.estado;
    const max = [hoy(), dia(o.fecha)].sort()[0];
    const nota = o.eliminado_en ? 'Pedido eliminado: no se puede modificar.' : !ed ? `Pedido ${o.estado.toLowerCase()}: solo se puede corregir la fecha del pedido.` : '';
    cont.innerHTML = `<form class="adm-ficha" id="adm-ped-form" novalidate>
      ${volver}
      <h3 id="adm-ficha-h" tabindex="-1">${esc(o.cliente)}</h3>
      <div class="adm-sub"><span class="adm-chip ${esc(est)}">${esc(est)}</span><span>Pedido ${esc(o.id)}</span></div>
      ${nota ? `<p class="adm-nota">${esc(nota)}</p>` : ''}${F.recuperado ? '<p class="adm-nota">Recuperamos los cambios que no se habían guardado.</p>' : ''}
      <div class="adm-grid">
        <div class="adm-campo ancho"><label for="adm-fp">Fecha real del pedido</label>
          <div style="display:flex;gap:8px;flex-wrap:wrap"><input id="adm-fp" type="date" name="fecha_pedido" data-f="fecha_pedido" max="${esc(max)}" value="${esc(b.fecha_pedido)}" style="flex:1 1 150px" ${fe ? dis : 'disabled'}>
          <button type="button" class="adm-btn chico" data-adm="ayer" ${fe ? dis : 'disabled'}>Fue el día anterior</button></div>
          <small>El día en que el cliente lo pidió (por defecto, el día de carga). Corrige la frecuencia y el último pedido del seguimiento.</small></div>
        <div class="adm-campo ancho"><span>Registro</span><div class="adm-valor" style="min-height:0;padding:6px 10px">Cargado el ${esc(fmt(o.fecha))} · registrado en la app ${esc(fmtTs(o.creado_en))}</div>
          <small>En pedidos importados, la hora de registro en la app puede no coincidir con el día en que se cargó.</small></div>
        <label class="adm-campo">Entrega programada<input type="date" name="fecha_entrega" data-f="fecha_entrega" value="${esc(b.fecha_entrega)}" ${ed ? dis : 'disabled'}></label>
        <div class="adm-campo"><span>Despacho</span><div class="adm-valor">${o.fecha_despacho ? esc(fmt(o.fecha_despacho)) : 'Sin despachar'}</div></div>
        <label class="adm-campo ancho">Cliente<input name="cliente" data-f="cliente" list="adm-clientes-dl" maxlength="200" autocomplete="off" value="${esc(b.cliente)}" ${ed ? dis : 'disabled'}></label>
        <datalist id="adm-clientes-dl">${(state.clientes || []).slice(0, 800).map(c => `<option value="${esc(c.n)}">`).join('')}</datalist>
        <label class="adm-campo ancho">Dirección<input name="direccion" data-f="direccion" maxlength="300" autocomplete="off" value="${esc(b.direccion)}" ${ed ? dis : 'disabled'}></label>
        <label class="adm-campo ancho">Observación<textarea name="notas" data-f="notas" rows="2" ${ed ? dis : 'disabled'}>${esc(b.notas)}</textarea></label>
        <label class="adm-campo check"><input type="checkbox" name="retiro" data-f="retiro" ${b.retiro ? 'checked' : ''} ${ed ? dis : 'disabled'}> Retira el cliente</label>
      </div>
      <div class="adm-aviso" id="adm-ped-aviso" hidden></div>
      <div class="adm-msg" id="adm-ped-msg" role="alert">${esc(F.error)}</div>
      <div class="adm-acciones">
        <button type="submit" class="adm-btn primario" id="adm-ped-guardar" ${fe ? dis : 'disabled'}>${F.guardando ? 'Guardando…' : F.error && !F.conflicto ? 'Reintentar' : 'Guardar cambios'}</button>
        ${F.conflicto ? '<button type="button" class="adm-btn" data-adm="ped-recargar">Recargar pedido</button>' : ''}
      </div>
      <div class="adm-bloque"><h4>Productos (${(F.dat.items || []).length})</h4>
        <ul class="adm-items">${(F.dat.items || []).map(i => `<li><span>${esc(i.producto)}${i.fetear ? ' · feteado' : ''}${i.sin_cuero ? ' · sin cuero' : ''}</span><b>${esc(i.cantidad)}${i.medida ? ' ' + esc(i.medida) : ''}</b></li>`).join('') || '<li>Sin productos</li>'}</ul>
        <p class="adm-nota" style="margin-top:6px">Para cambiar productos usá <button type="button" class="adm-btn chico" data-adm="ir-pedidos">Pedidos</button>.</p></div>
      <div class="adm-bloque"><h4>Historial de cambios</h4><ul class="adm-hist" id="adm-ped-hist"></ul></div></form>`;
    pintarHistorialPedido(); avisoPedido();
    if (foco) { const h = $('adm-ficha-h'); if (h) h.focus({ preventScroll: true }); }
  }
  function avisoPedido() {
    const F = E.his.F, a = $('adm-ped-aviso'); if (!F || !a || !F.orig) return;
    const d = cambiosPed(F), arm = F.dat.armado || {}, pierde = dispara(d) && (arm.remito_hecho || arm.controlado);
    a.hidden = !pierde;
    if (pierde) a.textContent = 'Al guardar se desmarcan ' + [arm.remito_hecho && 'el remito hecho', arm.controlado && 'el control del armado'].filter(Boolean).join(' y ') + ' de este pedido: habrá que volver a hacerlos.';
  }
  function pintarHistorialPedido() { const u = $('adm-ped-hist'), F = E.his.F; if (u && F) u.innerHTML = listaCambios(F.cambios); }
  function msgPed(t, ok) { const m = $('adm-ped-msg'); if (m) { m.textContent = t || ''; m.classList.toggle('ok', !!ok); } }

  async function guardarPedido() {
    const F = E.his.F; if (!F || F.guardando || !F.orig) return;
    const d = cambiosPed(F);
    if (!Object.keys(d).length) { F.error = ''; msgPed('No hay cambios para guardar.', true); return; }
    if ('cliente' in d && !d.cliente) { msgPed('Escribí el cliente.'); return; }
    if (d.fecha_pedido && d.fecha_pedido > dia(F.orig.fecha)) { msgPed('La fecha del pedido no puede ser posterior al día de carga (' + fmt(F.orig.fecha) + ').'); return; }
    if (d.fecha_pedido && d.fecha_pedido > hoy()) { msgPed('La fecha del pedido no puede ser futura.'); return; }
    const h = JSON.stringify([F.orig.version, d]);
    if (!F.op || F.op.h !== h) F.op = { id: nuevoId(), h };      // un op por intento: se reutiliza al reintentar lo mismo
    F.error = ''; F.conflicto = false; msgPed(''); bloquearPed(F, true);
    try {
      const r = await rpc('admin_pedido_guardar', { p_op: F.op.id, p_id: F.id, p_version: F.orig.version, p_datos: d });
      F.guardando = false; F.op = null; F.error = ''; F.conflicto = false; borrarBorr('pedidos', F.id); F.recuperado = false;
      cargarDatosPedido(F, r);
      filaPedido(r.pedido); pedidoEnApp(r);
      if (E.his.F === F) { pintarFichaPedido(); msgPed('Guardado.', true); }
      toast('Pedido guardado');
      cargarCambios('pedidos', F.id).then(c => { F.cambios = c; if (E.his.F === F) pintarHistorialPedido(); }).catch(() => {});
    } catch (e) { F.guardando = false; F.error = msg(e); F.conflicto = conflicto(e); if (E.his.F === F) pintarFichaPedido(); }
  }
  function bloquearPed(F, on) {
    F.guardando = on;
    const f = $('adm-ped-form'); if (!f || E.his.F !== F) return;
    f.querySelectorAll('input,textarea,button[data-adm="ayer"],#adm-ped-guardar').forEach(x => { x.disabled = on; });
    const b = $('adm-ped-guardar'); if (b) b.textContent = on ? 'Guardando…' : 'Guardar cambios';
  }
  function filaPedido(p) {
    E.his.filas = E.his.filas.map(f => f.id === p.id ? { ...f, cliente: p.cliente, fecha_pedido: p.fecha_pedido, fecha_entrega: p.fecha_entrega, retiro: p.retiro } : f);
    pintarListaHistorial();
  }
  // Pone al día lo que ya está en pantalla (Pedidos, seguimiento) sin recargar la página.
  function pedidoEnApp(r) {
    try {
      const p = r.pedido, lotes = [state.pedidos, state.papelera, window.SegUI && SegUI._estado && SegUI._estado.historial];
      lotes.forEach(l => (l || []).forEach(x => {
        if (x.id !== p.id) return;
        x.fechaPedido = p.fecha_pedido || ''; x.cliente = p.cliente; x.direccion = p.direccion || ''; x.notas = p.notas || ''; x.fechaEntrega = p.fecha_entrega || ''; x.retiro = !!p.retiro; x.remitoHecho = !!(r.armado && r.armado.remito_hecho);
      }));
      if (window.SegUI && SegUI.invalidar) SegUI.invalidar();
      if (typeof renderPedidos === 'function') renderPedidos();
    } catch (_) { /* la recarga de abajo los trae igual */ }
    refrescarApp();
  }

  // ── Historial de cambios (ficha) ──
  const CAMPOS = { observaciones: 'Observación', fecha_pedido: 'Fecha del pedido', cliente: 'Cliente', direccion: 'Dirección', notas: 'Observación', fecha_entrega: 'Entrega', retiro: 'Retiro', nombre: 'Nombre' };
  const valor = (k, v) => v === null || v === undefined || v === '' ? '—' : typeof v === 'boolean' ? (v ? 'Sí' : 'No') : /^\d{4}-\d\d-\d\d/.test(String(v)) && /fecha/.test(k) ? fmt(dia(v)) : String(v);
  async function cargarCambios(tabla, id) { const r = await rpc('admin_cambios_leer', { p_tabla: tabla, p_registro: String(id) }); return Array.isArray(r) ? r : []; }
  function listaCambios(c) {
    if (c === null || c === undefined) return '<li>Cargando…</li>';
    if (!c.length) return '<li>Todavía sin cambios hechos desde Administración.</li>';
    return c.map(x => {
      let t;
      if (x.accion === 'fusionar') { const a = x.despues || {}; t = a.destino ? `Fusionado con «${a.destino}»` : `Fusionó «${(x.antes || {}).origen}» en este cliente`; const n = a.actualizados && a.actualizados.pedidos; if (n !== undefined) t += ` · ${n} ${n === 1 ? 'pedido movido' : 'pedidos movidos'}`; }
      else if (x.accion === 'baja') t = 'Dado de baja'; else if (x.accion === 'restaurar') t = 'Restaurado'; else if (x.accion === 'crear') t = 'Creado';
      else {
        t = Object.keys(x.despues || {}).filter(k => k !== 'actualizados').map(k => `${CAMPOS[k] || k}: ${esc(valor(k, (x.antes || {})[k]))} → ${esc(valor(k, x.despues[k]))}`).join(' · ');
        const a = x.despues && x.despues.actualizados; if (a) t += ' · Actualizó ' + Object.keys(a).filter(k => a[k] > 0).map(k => `${a[k]} ${NOMBRES_IMPACTO[k] ? NOMBRES_IMPACTO[k][a[k] === 1 ? 0 : 1] : k}`).join(', ');
      }
      return `<li><b>${esc(fmtTs(x.en))} · ${esc(x.autor)}</b><br>${['baja', 'restaurar', 'crear', 'fusionar'].includes(x.accion) ? esc(t) : t}</li>`;
    }).join('');
  }

  // ═══════════════ Eventos ═══════════════
  document.addEventListener('click', e => { if (e.target.closest('#adminBtn')) abrir(E.sec); });
  const panel = $('adminPanel');
  if (panel) {
    panel.addEventListener('click', e => {
      const b = e.target.closest('[data-adm]'); if (!b || b.disabled) return;
      const a = b.dataset.adm;
      if (a === 'cerrar') cerrar();
      else if (a === 'pestana') irA(b.dataset.s, false);
      else if (a === 'c-ok') cerrarConfirmacion(true);
      else if (a === 'c-no') cerrarConfirmacion(false);
      else if (a === 'cli-nuevo') nuevoCliente();
      else if (a === 'cli-abrir') abrirCliente(b.dataset.id);
      else if (a === 'cli-volver') { E.cli.F = null; pintarListaClientes(); pintarFichaCliente(); const s = document.querySelector('#adm-cli-lista .adm-fila,#adm-cli-q'); if (s) s.focus({ preventScroll: true }); }
      else if (a === 'cli-recargar') cargarClientes();
      else if (a === 'cli-recargar-ficha') { const F = E.cli.F; if (F) { borrarBorr('clientes', F.id); const id = F.id; cargarClientes().then(() => { if (E.cli.lista.some(c => c.id === id)) abrirCliente(id); }); } }
      else if (a === 'cli-baja') bajaCliente(true);
      else if (a === 'cli-fusionar') abrirFusion();
      else if (a === 'fu-cerrar') cerrarFusion();
      else if (a === 'fu-elegir') elegirOtro(b.dataset.id);
      else if (a === 'fu-ok') ejecutarFusion();
      else if (a === 'cli-restaurar') bajaCliente(false);
      else if (a === 'his-abrir' || a === 'his-reabrir') abrirPedido(b.dataset.id);
      else if (a === 'his-volver') { const id = E.his.F && E.his.F.id; E.his.F = null; pintarListaHistorial(); pintarFichaPedido(); const s = (id && document.querySelector(`#adm-his-lista [data-id="${CSS.escape(id)}"]`)) || $('adm-his-q'); if (s) s.focus({ preventScroll: true }); }
      else if (a === 'his-mas') buscarHistorial(true);
      else if (a === 'his-recargar') buscarHistorial(false);
      else if (a === 'ped-recargar') { const F = E.his.F; if (F) { borrarBorr('pedidos', F.id); abrirPedido(F.id); } }
      else if (a === 'ayer') { const F = E.his.F; if (F && F.orig) { F.borr.fecha_pedido = diaAntes(F.orig.fecha); guardarBorr('pedidos', F); const i = $('adm-fp'); if (i) i.value = F.borr.fecha_pedido; avisoPedido(); if (i) i.focus(); } }
      else if (a === 'ir-pedidos') { cerrar(); if (typeof goTab === 'function') goTab('pedidos'); }
    });
    panel.addEventListener('submit', e => {
      e.preventDefault();
      if (e.target.id === 'adm-cli-form') guardarCliente();
      if (e.target.id === 'adm-ped-form') guardarPedido();
    });
    panel.addEventListener('input', e => {
      const t = e.target;
      if (t.id === 'adm-fu-q' && E.fu) { E.fu.q = t.value; clearTimeout(E.fu.timer); E.fu.timer = setTimeout(buscarOtro, 250); return; }
      if (t.id === 'adm-cli-q') { E.cli.q = t.value; clearTimeout(E.cli.timer); E.cli.timer = setTimeout(cargarClientes, 250); return; }
      if (t.id === 'adm-his-q') { E.his.q = t.value; clearTimeout(E.his.timer); E.his.timer = setTimeout(() => buscarHistorial(false), 300); return; }
      if (!t.dataset.f) return;
      const v = t.type === 'checkbox' ? t.checked : t.value;
      if (t.closest('#adm-cli-form') && E.cli.F) { E.cli.F.borr[t.dataset.f] = v; guardarBorr('clientes', E.cli.F); avisoCliente(); }
      if (t.closest('#adm-ped-form') && E.his.F) { E.his.F.borr[t.dataset.f] = v; guardarBorr('pedidos', E.his.F); avisoPedido(); }
    });
    panel.addEventListener('change', e => {
      const t = e.target;
      if (t.id === 'adm-fu-quien') return;
      if (t.name === 'fu-quien' && E.fu) { E.fu.quien = t.value; cargarImpacto(); }
      else if (t.id === 'adm-fu-entiendo' && E.fu) { E.fu.entiendo = t.checked; pintarFusion(); }
      else if (t.id === 'adm-cli-bajas') { E.cli.bajas = t.checked; cargarClientes(); }
      else if (t.id === 'adm-his-desde') { E.his.desde = t.value; buscarHistorial(false); }
      else if (t.id === 'adm-his-hasta') { E.his.hasta = t.value; buscarHistorial(false); }
      else if (t.id === 'adm-his-est') { E.his.estado = t.value; buscarHistorial(false); }
      else if (t.dataset.f && t.type === 'date' && t.closest('#adm-ped-form') && E.his.F) { E.his.F.borr[t.dataset.f] = t.value; guardarBorr('pedidos', E.his.F); avisoPedido(); }
    });
    panel.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.stopPropagation(); if (E.fu) cerrarFusion(); else if (E.confirmar) cerrarConfirmacion(false); else cerrar(); return; }
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const t = e.target.closest('[role="tab"]'); if (!t) return;
        const l = [...panel.querySelectorAll('.adm-tabs [role="tab"]')], i = l.indexOf(t), n = l[(i + (e.key === 'ArrowRight' ? 1 : l.length - 1)) % l.length];
        e.preventDefault(); irA(n.dataset.s, true); return;
      }
      if (e.key !== 'Tab') return;
      const raiz = E.fu ? $('adm-fusion') : E.confirmar ? $('adm-confirm') : $('admin-modal');
      const els = [...raiz.querySelectorAll('button,input,select,textarea,[href],[tabindex]:not([tabindex="-1"])')].filter(x => !x.disabled && x.offsetParent !== null && !x.closest('[hidden]'));
      if (!els.length) return;
      const a = document.activeElement, i = els.indexOf(a);
      if (e.shiftKey && (i <= 0)) { e.preventDefault(); els[els.length - 1].focus(); }
      else if (!e.shiftKey && (i === els.length - 1 || i < 0)) { e.preventDefault(); els[0].focus(); }
    });
  }

  window.AdminUI = { abrir, cerrar, reiniciar, abierto: sec => E.abierto && (!sec || E.sec === sec), _estado: E };
})();
