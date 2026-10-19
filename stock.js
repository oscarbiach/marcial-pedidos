// Pestaña Stock (19/10/2026) — solo Oscar y Joaquín.
//
// · Recuento: se cuenta con el celular, producto por producto, sobre un único
//   recuento abierto que comparten los dos. Al cerrarlo queda como stock real.
//   Un recuento vale como stock al ARRANCAR el día de su fecha.
// · Stock: último recuento + lo que entró y salió desde ese día.
// · Movimientos: ingresos de mercadería, mermas/ajustes y la importación del
//   CSV "Productos Vendidos" de Dubix (que es lo que descuenta las ventas).
//
// Base: tablas stock_* en Supabase (ver supabase/migrations/20261019_stock.sql).
// El acceso lo decide la base (stock_es_admin); acá solo se esconde la pestaña.
(function () {
  'use strict';
  const USUARIOS = ['Oscar', 'Joaquin'];
  const E = {
    ok: null,               // null = no se sabe todavía
    vista: 'recuento',      // recuento | stock | movimientos
    prods: [],              // filas de stock_actual
    porId: new Map(),
    rec: null,              // recuento abierto
    items: new Map(),       // producto_id -> item del recuento abierto
    cerrados: [],
    imps: [],
    movs: [],
    q: '', filtro: 'pendientes', alcance: 'activos', marca: '',
    cargando: false, ts: 0,
    pendientes: new Map(),  // producto_id -> contado (sin guardar por falta de señal)
    lineas: [],             // ingreso en armado
  };
  const $ = id => document.getElementById(id);
  const hoy = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);   // fecha de Argentina
  const ayer = () => new Date(Date.now() - 27 * 3600e3).toISOString().slice(0, 10);
  const fmtF = f => f ? f.slice(8, 10) + '/' + f.slice(5, 7) : '';
  const num = v => (v === null || v === undefined || v === '') ? null : Number(v);
  function fmtN(v, u) {
    if (v === null || v === undefined) return '—';
    const n = Number(v), dec = u === 'kg' ? 2 : (Number.isInteger(n) ? 0 : 2);
    return n.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: dec });
  }
  const UNI = { u: 'u', kg: 'kg', caja: 'cj' };
  function leerNum(s) {
    s = String(s || '').trim().replace(/\s/g, '');
    if (!s) return null;
    if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '');   // 1.234,5
    s = s.replace(',', '.');
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }
  const ico = n => (window.mIco ? mIco(n) : '');
  const st = () => (typeof state !== 'undefined' ? state : null);
  function avisar(m) { if (typeof toast === 'function') toast(m); }
  function errTxt(e) { return (e && (e.message || e.details)) || String(e); }

  // ── Acceso ─────────────────────────────────────────────────────────
  async function aplicarAcceso() {
    const s = st(), who = s && s.who;
    if (!who || !USUARIOS.includes(who) || typeof sb === 'undefined') { pintarAcceso(false); return false; }
    try {
      const { data, error } = await sb.rpc('stock_es_admin');
      pintarAcceso(!error && data === true);
    } catch (e) { pintarAcceso(false); }
    return E.ok;
  }
  function pintarAcceso(ok) {
    E.ok = ok;
    document.body.classList.toggle('stock-visible', !!ok);
    if (!ok && typeof activeTab !== 'undefined' && activeTab === 'stock' && typeof setTab === 'function') setTab('pedidos');
  }

  // ── Datos ──────────────────────────────────────────────────────────
  async function cargar(silencioso) {
    if (E.cargando) return;
    E.cargando = true;
    if (!silencioso) pintarCargando();
    try {
      const [p, r, c, i, m] = await Promise.all([
        sb.from('stock_actual').select('*').order('marca').order('nombre').limit(3000),
        sb.from('stock_recuentos').select('*').eq('estado', 'abierto').maybeSingle(),
        sb.from('stock_recuentos').select('*').eq('estado', 'cerrado').order('fecha', { ascending: false }).limit(10),
        sb.from('stock_importaciones').select('*').order('creado_en', { ascending: false }).limit(15),
        sb.from('stock_movimientos').select('id,producto_id,tipo,cantidad,fecha,nota,autor,creado_en').is('importacion_id', null).order('creado_en', { ascending: false }).limit(40),
      ]);
      for (const x of [p, r, c, i, m]) if (x.error) throw x.error;
      E.prods = p.data || [];
      E.porId = new Map(E.prods.map(x => [x.id, x]));
      E.rec = r.data || null;
      E.cerrados = c.data || [];
      E.imps = i.data || [];
      E.movs = m.data || [];
      E.items = new Map();
      if (E.rec) {
        const it = await sb.from('stock_recuento_items').select('*').eq('recuento_id', E.rec.id).limit(3000);
        if (it.error) throw it.error;
        (it.data || []).forEach(x => E.items.set(x.producto_id, x));
      }
      E.ts = Date.now();
      E.error = null;
    } catch (e) {
      E.error = errTxt(e);
    }
    E.cargando = false;
    render();
  }

  // ── Pantalla ───────────────────────────────────────────────────────
  function raiz() { return $('st-raiz'); }
  function pintarCargando() { const r = raiz(); if (r && !E.prods.length) r.innerHTML = '<div class="st-vacio">Cargando stock…</div>'; }

  function render() {
    const r = raiz(); if (!r) return;
    const foco = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.pid;
    let h = '<div class="st-seg" role="tablist">' +
      ['recuento:Recuento', 'stock:Stock', 'movimientos:Movimientos'].map(x => {
        const [k, t] = x.split(':');
        return '<button role="tab" class="' + (E.vista === k ? 'on' : '') + '" onclick="StockUI.ver(\'' + k + '\')">' + t + '</button>';
      }).join('') + '</div>';
    if (E.error) h += '<div class="st-alerta st-alerta--error">' + ico('circle-alert') + '<span>No se pudo cargar: ' + esc(E.error) + '</span><button class="st-link" onclick="StockUI.cargar()">Reintentar</button></div>';
    if (E.pendientes.size) h += '<div class="st-alerta">' + ico('clock') + '<span>' + E.pendientes.size + ' conteo(s) sin guardar por falta de señal. Se reintenta solo.</span><button class="st-link" onclick="StockUI.reintentar()">Reintentar ya</button></div>';
    if (E.vista === 'recuento') h += vistaRecuento();
    else if (E.vista === 'stock') h += vistaStock();
    else h += vistaMovimientos();
    r.innerHTML = h;
    if (foco) { const el = r.querySelector('input[data-pid="' + foco + '"]'); if (el) el.focus(); }
  }

  function enAlcance(p) {
    if (!p.activo) return false;
    if (E.alcance === 'todos') return true;
    return (p.stock_dubix && Number(p.stock_dubix) !== 0) || p.stock !== null || Number(p.ventas) !== 0 || Number(p.ingresos) !== 0 || E.items.has(p.id);
  }
  function coincide(p) {
    if (E.marca && p.marca !== E.marca) return false;
    if (!E.q) return true;
    const t = (p.nombre + ' ' + (p.codigo || '') + ' ' + p.marca).toLowerCase();
    return E.q.toLowerCase().split(/\s+/).filter(Boolean).every(w => t.includes(w));
  }
  function marcas(lista) { return [...new Set(lista.map(p => p.marca))].sort((a, b) => a.localeCompare(b, 'es')); }
  function referencia(p) { return p.stock !== null ? num(p.stock) : num(p.stock_dubix); }

  function barraBusqueda(conFiltro) {
    const base = E.prods.filter(enAlcance);
    let h = '<div class="st-barra"><input class="search-input st-buscar" type="search" placeholder="Buscar producto o código" value="' + escAttr(E.q) + '" oninput="StockUI.buscar(this.value)">';
    h += '<select class="st-sel" onchange="StockUI.setMarca(this.value)"><option value="">Todas las marcas</option>' +
      marcas(base).map(m => '<option' + (m === E.marca ? ' selected' : '') + '>' + esc(m) + '</option>').join('') + '</select></div>';
    if (conFiltro) {
      h += '<div class="st-chips">' +
        [['pendientes', 'Por contar'], ['contados', 'Contados'], ['todos', 'Todos']].map(([k, t]) => '<button class="st-chip' + (E.filtro === k ? ' on' : '') + '" onclick="StockUI.setFiltro(\'' + k + '\')">' + t + '</button>').join('') +
        '<label class="st-check"><input type="checkbox"' + (E.alcance === 'todos' ? ' checked' : '') + ' onchange="StockUI.setAlcance(this.checked)"> Todo el catálogo (' + E.prods.filter(p => p.activo).length + ')</label></div>';
    }
    return h;
  }

  // ── Recuento ───────────────────────────────────────────────────────
  function vistaRecuento() {
    if (!E.rec) {
      let h = '<div class="st-card st-inicio"><div class="st-ico-grande">' + ico('clipboard-list') + '</div>' +
        '<h3>No hay recuento abierto</h3>' +
        '<p>Se cuenta <b>al terminar el día</b>, cuando ya no sale ni entra nada más. Lo que se venda o entre desde mañana se resta o suma solo.</p>' +
        '<div class="field"><label>Fecha del recuento</label><input type="date" id="st-rec-fecha" value="' + hoy() + '" max="' + hoy() + '"></div>' +
        '<button class="btn btn-primary" onclick="StockUI.abrirRecuento()">' + ico('play') + 'Empezar recuento</button></div>';
      h += historialRecuentos();
      return h;
    }
    const base = E.prods.filter(enAlcance);
    const contados = base.filter(p => E.items.has(p.id)).length;
    const pct = base.length ? Math.round(contados * 100 / base.length) : 0;
    let h = '<div class="st-card st-rec-cab"><div class="st-rec-tit"><b>Recuento del ' + fmtF(E.rec.fecha) + '</b><span>abierto por ' + esc(E.rec.autor) + '</span></div>' +
      '<div class="st-prog"><div style="width:' + pct + '%"></div></div>' +
      '<div class="st-rec-num">' + contados + ' de ' + base.length + ' contados' + (E.items.size > contados ? ' · ' + (E.items.size - contados) + ' fuera de la lista' : '') + '</div>' +
      '<div class="st-rec-acc"><button class="btn btn-primary" onclick="StockUI.confirmarCierre()">' + ico('package-check') + 'Cerrar recuento</button>' +
      '<button class="btn btn-outline" onclick="StockUI.cargar()">' + ico('refresh-cw') + 'Actualizar</button>' +
      '<button class="st-link st-link--peligro" onclick="StockUI.anularRecuento()">Anular</button></div></div>';
    h += barraBusqueda(true);
    let lista = base.filter(coincide);
    if (E.filtro === 'pendientes') lista = lista.filter(p => !E.items.has(p.id));
    if (E.filtro === 'contados') lista = E.prods.filter(p => E.items.has(p.id) && coincide(p));
    const btnNuevo = E.q.trim().length > 1 ? '<button class="btn btn-outline st-nuevo" onclick="StockUI.productoNuevo(\'conteo\')">' + ico('plus') + 'No está en la lista: agregar «' + esc(E.q.trim()) + '»</button>' : '';
    if (!lista.length) return h + '<div class="st-vacio">' + (E.q ? 'No encontré «' + esc(E.q) + '».' : (E.filtro === 'pendientes' ? '¡Listo! No queda nada por contar con este filtro.' : 'No hay productos con este filtro.')) + '</div>' + btnNuevo;
    const MAX = 250;
    let grupo = '';
    h += '<div class="st-lista">';
    lista.slice(0, MAX).forEach(p => {
      if (p.marca !== grupo) { grupo = p.marca; h += '<div class="st-grupo">' + esc(grupo) + '</div>'; }
      h += filaConteo(p);
    });
    h += '</div>';
    if (lista.length > MAX) h += '<div class="st-vacio">Se muestran ' + MAX + ' de ' + lista.length + '. Buscá o elegí una marca para ver el resto.</div>';
    return h + btnNuevo;
  }
  function filaConteo(p) {
    const it = E.items.get(p.id), pend = E.pendientes.has(p.id);
    const ref = referencia(p), refTxt = p.stock !== null ? 'App' : 'Dubix';
    const val = pend ? E.pendientes.get(p.id) : (it ? it.contado : null);
    let dif = '';
    if (val !== null && ref !== null) {
      const d = Number(val) - ref;
      if (Math.abs(d) > 0.0001) dif = '<span class="st-dif ' + (d < 0 ? 'neg' : 'pos') + '">' + (d > 0 ? '+' : '') + fmtN(d, p.unidad) + '</span>';
      else dif = '<span class="st-dif ok">' + ico('check') + '</span>';
    }
    const f = Number(p.por_caja) || 0, coma = v => String(Math.round(v * 1000) / 1000).replace('.', ',');
    const inp = (k, v, ph) => '<input class="st-num' + (f ? ' st-num--chico' : '') + '" inputmode="decimal" enterkeyhint="next" autocomplete="off" data-pid="' + p.id + '" data-k="' + k + '" value="' + v + '" placeholder="' + ph + '" onchange="StockUI.contar(this)" onkeydown="if(event.key===\'Enter\'){this.blur();StockUI.siguiente(this)}">';
    let campos;
    if (f) {
      const cj = val === null ? '' : Math.floor(Number(val) / f + 1e-9), su = val === null ? '' : coma(Number(val) - cj * f);
      campos = '<label class="st-par">' + inp('cj', cj, '0') + '<small>cajas</small></label><label class="st-par">' + inp('su', su, '0') + '<small>' + (p.unidad === 'kg' ? 'kg' : 'sueltos') + '</small></label>';
    } else {
      campos = '<label class="st-par">' + inp('n', val === null ? '' : coma(Number(val)), '—') + '<small>' + ({ u: 'unid.', kg: 'kg', caja: 'cajas' })[p.unidad] + '</small></label>';
    }
    return '<div class="st-fila' + (it ? ' contado' : '') + (pend ? ' pend' : '') + '">' +
      '<div class="st-fila-info"><div class="st-nom">' + esc(p.nombre) + '</div>' +
      '<div class="st-meta">' + (f ? '<b>Caja = ' + fmtN(f) + ' ' + (p.unidad === 'kg' ? 'kg' : 'u') + '</b> · ' : '') + refTxt + ': ' + fmtN(ref, p.unidad) + ' ' + UNI[p.unidad] +
      (val !== null && f ? ' · total ' + fmtN(val, p.unidad) : '') + (it ? ' · ' + esc(it.autor) : '') + '</div></div>' +
      '<div class="st-fila-in">' + dif + campos + '</div></div>';
  }

  async function abrirRecuento() {
    const f = ($('st-rec-fecha') || {}).value || hoy();
    const { error } = await sb.from('stock_recuentos').insert({ fecha: f, autor: st().who });
    if (error) { avisar(/duplicate|unique/i.test(error.message) ? 'Ya hay un recuento abierto' : 'Error: ' + errTxt(error)); }
    E.filtro = 'pendientes';
    await cargar();
  }

  async function contar(input) {
    const pid = input.dataset.pid, p = E.porId.get(pid); if (!p || !E.rec) return;
    let v = leerNum(input.value);
    const f = Number(p.por_caja) || 0;
    if (f) {
      const fila = input.closest('.st-fila');
      const cj = leerNum((fila.querySelector('[data-k="cj"]') || {}).value), su = leerNum((fila.querySelector('[data-k="su"]') || {}).value);
      if (Number.isNaN(cj) || Number.isNaN(su)) v = NaN;
      else v = (cj === null && su === null) ? null : (cj || 0) * f + (su || 0);
      if (input.dataset.k === 'cj' && cj !== null && su === null) { const s2 = fila.querySelector('[data-k="su"]'); if (s2) s2.value = '0'; }
    }
    if (Number.isNaN(v) || (v !== null && v < 0)) { avisar('Número inválido'); input.value = ''; return; }
    if (v === null) {                       // vació el campo: se borra el conteo
      if (E.items.has(pid)) {
        const { error } = await sb.from('stock_recuento_items').delete().eq('recuento_id', E.rec.id).eq('producto_id', pid);
        if (error) return avisar('No se pudo borrar: ' + errTxt(error));
        E.items.delete(pid);
      }
      E.pendientes.delete(pid);
      return refrescarFila(pid);
    }
    E.pendientes.set(pid, v);
    refrescarFila(pid);
    await guardar(pid, v);
  }
  async function guardar(pid, v) {
    const fila = { recuento_id: E.rec.id, producto_id: pid, contado: v, autor: st().who, contado_en: new Date().toISOString() };
    try {
      const { data, error } = await sb.from('stock_recuento_items').upsert(fila, { onConflict: 'recuento_id,producto_id' }).select().single();
      if (error) throw error;
      E.items.set(pid, data);
      E.pendientes.delete(pid);
    } catch (e) {
      if (/cerrado|policy|permission/i.test(errTxt(e))) { E.pendientes.delete(pid); avisar('El recuento ya no está abierto'); return cargar(); }
      programarReintento();
    }
    guardarPendientes();
    refrescarFila(pid);
  }
  let timerRe = null;
  function programarReintento() { if (!timerRe) timerRe = setTimeout(reintentar, 10000); }
  async function reintentar() {
    timerRe = null;
    if (!E.rec) return;
    for (const [pid, v] of [...E.pendientes]) await guardar(pid, v);
    if (E.pendientes.size) programarReintento(); else render();
  }
  function guardarPendientes() {
    try {
      if (E.rec && E.pendientes.size) localStorage.setItem('dm_stock_pend', JSON.stringify({ rec: E.rec.id, p: [...E.pendientes] }));
      else localStorage.removeItem('dm_stock_pend');
    } catch (e) { /* sin almacenamiento */ }
  }
  function restaurarPendientes() {
    try {
      const x = JSON.parse(localStorage.getItem('dm_stock_pend') || 'null');
      if (x && E.rec && x.rec === E.rec.id) x.p.forEach(([k, v]) => { if (!E.items.has(k)) E.pendientes.set(k, v); });
      if (E.pendientes.size) programarReintento();
    } catch (e) { /* nada */ }
  }
  function refrescarFila(pid) {
    const p = E.porId.get(pid), el = raiz() && raiz().querySelector('input[data-pid="' + pid + '"]');
    if (!p || !el) return;
    const fila = el.closest('.st-fila'), tmp = document.createElement('div');
    tmp.innerHTML = filaConteo(p);
    fila.replaceWith(tmp.firstChild);
    const cab = raiz().querySelector('.st-rec-num');
    if (cab) {
      const base = E.prods.filter(enAlcance), c = base.filter(x => E.items.has(x.id)).length;
      cab.textContent = c + ' de ' + base.length + ' contados';
      const bar = raiz().querySelector('.st-prog > div'); if (bar) bar.style.width = (base.length ? Math.round(c * 100 / base.length) : 0) + '%';
    }
  }
  function siguiente(input) {
    const todos = [...raiz().querySelectorAll('input.st-num')], i = todos.indexOf(input);
    if (i >= 0 && todos[i + 1]) todos[i + 1].focus();
  }
  async function cambiarUnidad(pid) {
    const p = E.porId.get(pid); if (!p) return;
    const sig = { u: 'kg', kg: 'caja', caja: 'u' }[p.unidad] || 'u';
    const { error } = await sb.from('stock_productos').update({ unidad: sig }).eq('id', pid);
    if (error) return avisar('Error: ' + errTxt(error));
    p.unidad = sig;
    refrescarFila(pid);
    avisar(p.nombre.slice(0, 30) + ' → se cuenta en ' + ({ u: 'unidades', kg: 'kilos', caja: 'cajas' })[sig]);
  }

  function confirmarCierre() {
    const items = [...E.items.values()];
    if (!items.length) return avisar('Todavía no se contó nada');
    let difs = 0, falt = 0;
    items.forEach(it => { const p = E.porId.get(it.producto_id), r = p && referencia(p); if (r !== null && Math.abs(Number(it.contado) - r) > 0.0001) difs++; });
    const base = E.prods.filter(enAlcance); falt = base.filter(p => !E.items.has(p.id)).length;
    modal('Cerrar recuento del ' + fmtF(E.rec.fecha),
      '<p>Se cierra con <b>' + items.length + '</b> productos contados' + (difs ? ', <b>' + difs + '</b> con diferencia' : '') + '.</p>' +
      (falt ? '<p class="st-nota">' + ico('triangle-alert') + ' Quedan ' + falt + ' productos de la lista sin contar: para esos se mantiene el stock anterior (o queda "sin contar").</p>' : '') +
      (E.pendientes.size ? '<p class="st-nota st-nota--error">Hay ' + E.pendientes.size + ' conteos sin guardar. Esperá a que se guarden.</p>' : '') +
      '<p>Después de cerrar no se puede editar. Vas a poder bajar el archivo con los ajustes para Dubix.</p>',
      [['Cancelar', 'btn-secondary', cerrarModal], ['Cerrar recuento', 'btn-primary', cerrarRecuento, !!E.pendientes.size]]);
  }
  async function cerrarRecuento() {
    const id = E.rec.id;
    const { error } = await sb.rpc('stock_cerrar_recuento', { p_id: id });
    if (error) return avisar(errTxt(error));
    cerrarModal();
    avisar('Recuento cerrado');
    await cargar();
    descargarAjuste(id);
  }
  function anularRecuento() {
    modal('Anular recuento', '<p>Se descarta el recuento del ' + fmtF(E.rec.fecha) + ' con ' + E.items.size + ' productos contados. No cambia el stock.</p>',
      [['Volver', 'btn-secondary', cerrarModal], ['Anular', 'btn-danger', async () => {
        const { error } = await sb.rpc('stock_anular_recuento', { p_id: E.rec.id });
        if (error) return avisar(errTxt(error));
        cerrarModal(); await cargar();
      }]]);
  }
  function historialRecuentos() {
    if (!E.cerrados.length) return '';
    return '<div class="st-card"><h4>Recuentos cerrados</h4>' + E.cerrados.map(r =>
      '<div class="st-hist"><span><b>' + fmtF(r.fecha) + '</b> · ' + esc(r.autor) + (r.cerrado_por && r.cerrado_por !== r.autor ? ' / ' + esc(r.cerrado_por) : '') + '</span>' +
      '<button class="st-link" onclick="StockUI.descargarAjuste(\'' + r.id + '\')">' + ico('download') + 'Ajuste para Dubix</button></div>').join('') + '</div>';
  }

  // Archivo con lo que hay que corregir en Dubix: contado vs lo que decía Dubix al cerrar.
  async function descargarAjuste(recId) {
    const { data, error } = await sb.from('stock_recuento_items').select('producto_id,contado,dubix,sistema').eq('recuento_id', recId).limit(3000);
    if (error) return avisar(errTxt(error));
    const r = E.cerrados.find(x => x.id === recId) || {};
    const coma = v => v === null || v === undefined ? '' : String(Math.round(Number(v) * 1000) / 1000).replace('.', ',');
    const filas = (data || []).map(it => ({ it, p: E.porId.get(it.producto_id) })).filter(x => x.p)
      .sort((a, b) => (a.p.marca + a.p.nombre).localeCompare(b.p.marca + b.p.nombre, 'es'));
    let csv = 'Código;Producto;Unidad;Stock Dubix;Contado;Ajuste a cargar en Dubix\n';
    filas.forEach(({ it, p }) => {
      const aj = it.dubix === null ? null : Number(it.contado) - Number(it.dubix);
      csv += [p.codigo || '', '"' + p.nombre.replace(/"/g, '""') + '"', p.unidad, coma(it.dubix), coma(it.contado), coma(aj)].join(';') + '\n';
    });
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'ajuste-stock-' + (r.fecha || hoy()) + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  // ── Stock ──────────────────────────────────────────────────────────
  function vistaStock() {
    const base = E.prods.filter(p => p.activo && (E.alcance === 'todos' || enAlcance(p)));
    const contados = base.filter(p => p.stock !== null);
    let h = '<div class="st-resumen"><div><b>' + contados.length + '</b><span>productos con stock real</span></div>' +
      '<div><b>' + (base.length - contados.length) + '</b><span>sin contar todavía</span></div>' +
      '<div><b>' + contados.filter(p => Number(p.stock) <= 0).length + '</b><span>en cero o negativo</span></div></div>';
    h += barraBusqueda(false);
    h += '<label class="st-check st-check--suelto"><input type="checkbox"' + (E.alcance === 'todos' ? ' checked' : '') + ' onchange="StockUI.setAlcance(this.checked)"> Mostrar todo el catálogo</label>';
    const lista = base.filter(coincide);
    if (!lista.length) return h + '<div class="st-vacio">No hay productos con este filtro.</div>';
    let grupo = '';
    h += '<div class="st-lista">';
    lista.slice(0, 300).forEach(p => {
      if (p.marca !== grupo) { grupo = p.marca; h += '<div class="st-grupo">' + esc(grupo) + '</div>'; }
      const s = num(p.stock);
      h += '<div class="st-fila st-fila--stock"><div class="st-fila-info"><div class="st-nom">' + esc(p.nombre) + '</div>' +
        '<div class="st-meta">' + (p.ultimo_recuento ? 'Contado ' + fmtF(p.ultimo_recuento) + ': ' + fmtN(p.contado_ultimo, p.unidad) + (Number(p.ventas) ? ' · vendido ' + fmtN(-p.ventas, p.unidad) : '') + (Number(p.ingresos) ? ' · entró ' + fmtN(p.ingresos, p.unidad) : '') + (Number(p.ajustes) ? ' · ajustes ' + fmtN(p.ajustes, p.unidad) : '') : 'Sin contar') +
        ' · Dubix: ' + fmtN(p.stock_dubix, p.unidad) + '</div></div>' +
        '<div class="st-stock' + (s === null ? ' nulo' : s <= 0 ? ' neg' : '') + '">' + (s === null ? '—' : fmtN(s, p.unidad)) + '<small>' + UNI[p.unidad] + '</small></div>' +
        '<button class="st-mas" title="Cargar movimiento" onclick="StockUI.nuevoMovimiento(\'' + p.id + '\')">' + ico('plus') + '</button></div>';
    });
    h += '</div>';
    if (lista.length > 300) h += '<div class="st-vacio">Se muestran 300 de ' + lista.length + '. Buscá para ver el resto.</div>';
    return h;
  }

  // ── Movimientos ────────────────────────────────────────────────────
  function vistaMovimientos() {
    let h = '<div class="st-acciones"><button class="btn btn-primary" onclick="StockUI.elegirFoto()">' + ico('image') + 'Ingreso con foto de factura</button>' +
      '<input type="file" id="st-foto" accept="image/*,application/pdf" multiple hidden onchange="StockUI.leerFoto(this)">' +
      '<button class="btn btn-outline" onclick="StockUI.nuevoMovimiento()">' + ico('package') + 'Ingreso a mano / merma</button>' +
      '<button class="btn btn-outline" onclick="StockUI.elegirCsv()">' + ico('upload') + 'Importar ventas de Dubix</button>' +
      '<input type="file" id="st-csv" accept=".csv,text/csv,text/plain" hidden onchange="StockUI.leerCsv(this)"></div>';
    const ult = E.imps.find(x => !x.anulada);
    h += '<p class="st-ayuda">Exportá de Dubix el reporte <b>Productos Vendidos</b> (CSV) del período y subilo acá. ' +
      '<b>En Dubix elegí desde el ' + fmtF(ult ? sumarDia(ult.hasta) : (E.cerrados[0] ? sumarDia(E.cerrados[0].fecha) : hoy())) + ' hasta hoy.</b></p>';
    h += '<div class="st-card"><h4>Ventas importadas</h4>' + (E.imps.length ? E.imps.map(x =>
      '<div class="st-hist' + (x.anulada ? ' anulada' : '') + '"><span><b>' + fmtF(x.desde) + (x.hasta !== x.desde ? ' al ' + fmtF(x.hasta) : '') + '</b> · ' + x.filas + ' productos' + (x.sin_match ? ' · ' + x.sin_match + ' sin match' : '') + ' · ' + esc(x.autor) + (x.anulada ? ' · ANULADA' : '') + '</span>' +
      (x.anulada ? '' : '<button class="st-link st-link--peligro" onclick="StockUI.anularImp(\'' + x.id + '\')">Anular</button>') + '</div>').join('') : '<p class="st-ayuda">Nada todavía.</p>') + '</div>';
    h += '<div class="st-card"><h4>Ingresos, mermas y ajustes</h4>' + (E.movs.length ? E.movs.map(m => {
      const p = E.porId.get(m.producto_id) || { nombre: '?', unidad: 'u' };
      return '<div class="st-hist"><span><b class="' + (m.cantidad < 0 ? 'neg' : 'pos') + '">' + (m.cantidad > 0 ? '+' : '') + fmtN(m.cantidad, p.unidad) + ' ' + UNI[p.unidad] + '</b> ' + esc(p.nombre) +
        '<small>' + ({ ingreso: 'Ingreso', merma: 'Merma', ajuste: 'Ajuste' })[m.tipo] + ' · ' + fmtF(m.fecha) + ' · ' + esc(m.autor) + (m.nota ? ' · ' + esc(m.nota) : '') + '</small></span>' +
        '<button class="st-link st-link--peligro" onclick="StockUI.borrarMov(' + m.id + ')">Borrar</button></div>';
    }).join('') : '<p class="st-ayuda">Nada todavía.</p>') + '</div>';
    return h;
  }
  function sumarDia(f) { const d = new Date(f + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); }

  // Ingreso de mercadería (varias líneas, como un remito), merma o ajuste.
  function nuevoMovimiento(pid) {
    E.lineas = pid ? [{ pid, cant: '' }] : [];
    E.sinProd = []; E.asignando = null; E.movFecha = null; E.movNota = null;
    E.movTipo = 'ingreso';
    pintarMovimiento();
  }
  function pintarMovimiento() {
    const tipos = [['ingreso', 'Ingreso'], ['merma', 'Merma'], ['ajuste', 'Ajuste ±']];
    let b = '<div class="st-chips">' + tipos.map(([k, t]) => '<button class="st-chip' + (E.movTipo === k ? ' on' : '') + '" onclick="StockUI.movTipo(\'' + k + '\')">' + t + '</button>').join('') + '</div>';
    b += '<p class="st-ayuda">' + ({ ingreso: 'Mercadería que entró al depósito (un remito de proveedor puede tener varias líneas).', merma: 'Lo que se tiró, se rompió o venció. Se resta.', ajuste: 'Corrección manual: positivo suma, negativo resta.' })[E.movTipo] + '</p>';
    if (E.sinProd && E.sinProd.length) {
      b += '<div class="st-nota st-nota--error">' + ico('circle-alert') + '<div><b>' + E.sinProd.length + ' renglón(es) de la factura sin producto.</b> Tocá «Buscar» y elegí cuál es, o «No va» si no es mercadería.' +
        E.sinProd.map((x, i) => '<div class="st-sinp' + (E.asignando === i ? ' on' : '') + '"><span>' + esc(x.texto) + (x.dudosa ? ' <em>(se lee mal)</em>' : '') + '</span>' +
          '<button class="st-link" onclick="StockUI.buscarPara(' + i + ')">Buscar</button><button class="st-link st-link--peligro" onclick="StockUI.ignorarLinea(' + i + ')">No va</button></div>').join('') + '</div></div>';
    }
    b += '<div class="st-lineas">' + E.lineas.map((l, i) => {
      const p = E.porId.get(l.pid);
      const f = p && Number(p.por_caja);
      return '<div class="st-linea"><span>' + esc(p ? p.nombre : '?') + (l.ref ? '<small>Factura: ' + esc(l.ref) + '</small>' : '') + '</span>' +
        (f ? '<label class="st-par"><input class="st-num st-num--chico" inputmode="decimal" placeholder="0" value="' + escAttr(l.cj || '') + '" oninput="StockUI.lineaCant(' + i + ',this.value,\'cj\')"><small>cajas</small></label>' : '') +
        '<label class="st-par"><input class="st-num' + (f ? ' st-num--chico' : '') + '" inputmode="decimal" placeholder="0" value="' + escAttr(l.cant) + '" oninput="StockUI.lineaCant(' + i + ',this.value)"><small>' + (p && p.unidad === 'kg' ? 'kg' : (f ? 'sueltos' : 'unid.')) + '</small></label>' +
        '<button class="st-x" onclick="StockUI.quitarLinea(' + i + ')">' + ico('x') + '</button></div>';
    }).join('') + '</div>';
    b += '<div class="st-ac"><input class="search-input" id="st-ac-q" placeholder="Agregar producto…" autocomplete="off" oninput="StockUI.sugerir(this.value)"><div id="st-ac-res" class="st-ac-res"></div></div>';
    b += '<div class="st-dos"><div class="field"><label>Fecha</label><input type="date" id="st-mov-fecha" value="' + hoy() + '" max="' + hoy() + '"></div>' +
      '<div class="field"><label>Nota (opcional)</label><input id="st-mov-nota" maxlength="300" placeholder="Ej: remito 0001-2345"></div></div>';
    modal({ ingreso: 'Cargar ingreso', merma: 'Cargar merma', ajuste: 'Cargar ajuste' }[E.movTipo], b,
      [['Cancelar', 'btn-secondary', cerrarModal], ['Guardar', 'btn-primary', guardarMovimiento]]);
  }
  function sugerir(q) {
    const res = $('st-ac-res'); if (!res) return;
    q = q.trim().toLowerCase();
    if (q.length < 2) { res.innerHTML = ''; return; }
    const w = q.split(/\s+/);
    const l = E.prods.filter(p => p.activo && w.every(x => (p.nombre + ' ' + (p.codigo || '')).toLowerCase().includes(x))).slice(0, 8);
    res.innerHTML = l.map(p => '<button onclick="StockUI.agregarLinea(\'' + p.id + '\')">' + esc(p.nombre) + '<small>' + esc(p.marca) + (p.codigo ? ' · ' + esc(p.codigo) : '') + '</small></button>').join('') +
      '<button class="st-ac-nuevo" onclick="StockUI.productoNuevo(\'ingreso\')">' + ico('plus') + ' Producto nuevo: «' + esc(q) + '»</button>';
  }
  function guardarCamposMov() { if ($('st-mov-fecha')) E.movFecha = $('st-mov-fecha').value; if ($('st-mov-nota')) E.movNota = $('st-mov-nota').value; }
  function restaurarCamposMov() { if (E.movFecha && $('st-mov-fecha')) $('st-mov-fecha').value = E.movFecha; if (E.movNota && $('st-mov-nota')) $('st-mov-nota').value = E.movNota; }
  async function guardarMovimiento() {
    const fecha = $('st-mov-fecha').value || hoy(), nota = $('st-mov-nota').value.trim() || null;
    const filas = [];
    for (const l of E.lineas) {
      const p = E.porId.get(l.pid), f = p && Number(p.por_caja);
      const su = leerNum(l.cant), cj = f ? leerNum(l.cj) : null;
      if (Number.isNaN(su) || Number.isNaN(cj)) return avisar('Revisá las cantidades');
      if (su === null && cj === null) continue;
      let v = (cj || 0) * (f || 0) + (su || 0);
      if (Number.isNaN(v) || v === 0) return avisar('Revisá las cantidades');
      if (E.movTipo === 'ingreso') v = Math.abs(v);
      if (E.movTipo === 'merma') v = -Math.abs(v);
      filas.push({ producto_id: l.pid, tipo: E.movTipo, cantidad: v, fecha, nota, autor: st().who });
    }
    if (!filas.length) return avisar('Agregá al menos un producto con cantidad');
    if (E.sinProd && E.sinProd.length) return avisar('Quedan renglones de la factura sin producto: buscalos o marcá «No va»');
    const { error } = await sb.from('stock_movimientos').insert(filas);
    if (error) return avisar('Error: ' + errTxt(error));
    const alias = E.lineas.filter(l => l.aliasKey).map(l => ({ texto_key: l.aliasKey, producto_id: l.pid, autor: st().who }));
    if (alias.length) await sb.from('stock_alias').upsert(alias, { onConflict: 'texto_key' });
    E.sinProd = []; E.asignando = null;
    cerrarModal();
    avisar(filas.length + ' movimiento(s) guardados');
    cargar(true);
  }
  async function borrarMov(id) {
    if (!confirm('¿Borrar este movimiento?')) return;
    const { error } = await sb.from('stock_movimientos').delete().eq('id', id);
    if (error) return avisar('Error: ' + errTxt(error));
    cargar(true);
  }

  // ── Importar CSV "Productos Vendidos" de Dubix ─────────────────────
  function elegirCsv() { const i = $('st-csv'); if (i) { i.value = ''; i.click(); } }
  function leerArchivo(f, enc) {
    return new Promise((ok, mal) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = mal; r.readAsText(f, enc); });
  }
  async function leerCsv(input) {
    const f = input.files && input.files[0]; if (!f) return;
    let txt = await leerArchivo(f, 'utf-8');
    if (txt.includes('�')) txt = await leerArchivo(f, 'windows-1252');
    const r = parsearVentas(txt);
    if (r.error) return modal('No se pudo leer el archivo', '<p>' + esc(r.error) + '</p>', [['Entendido', 'btn-primary', cerrarModal]]);
    E.imp = { archivo: f.name, ...r };
    pintarImport();
  }
  function separarLinea(l, sep) {
    const out = []; let cur = '', q = false;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (c === '"') { if (q && l[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (c === sep && !q) { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out.map(s => s.trim());
  }
  const sinTilde = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  function parsearVentas(txt) {
    const lineas = txt.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
    let sep = ';', h = -1, cols = null;
    for (let i = 0; i < Math.min(lineas.length, 15); i++) {
      for (const s of [';', ',', '\t']) {
        const c = separarLinea(lineas[i], s).map(sinTilde);
        if (c.some(x => x.includes('vendid')) && c.some(x => x === 'detalle' || x.includes('descrip') || x === 'producto')) { sep = s; h = i; cols = c; break; }
      }
      if (h >= 0) break;
    }
    if (h < 0) return { error: 'No encontré las columnas "Detalle" y "U. Vendidas". ¿Es el reporte "Productos Vendidos" de Dubix?' };
    const iCod = cols.findIndex(x => x.startsWith('codigo') || x === 'cod'), iDet = cols.findIndex(x => x === 'detalle' || x.includes('descrip') || x === 'producto'), iCant = cols.findIndex(x => x.includes('vendid'));
    const porCod = new Map(), porNom = new Map();
    E.prods.forEach(p => { if (p.codigo) porCod.set(p.codigo.trim().toLowerCase(), p); porNom.set(sinTilde(p.nombre), p); });
    const suma = new Map(), sin = [];
    let total = 0;
    for (let i = h + 1; i < lineas.length; i++) {
      const c = separarLinea(lineas[i], sep);
      const det = c[iDet] || '', cod = iCod >= 0 ? (c[iCod] || '') : '';
      const cant = leerNum(c[iCant]);
      if (!det && !cod) continue;
      if (/^total/i.test(det) || /^total/i.test(cod)) continue;
      if (cant === null || Number.isNaN(cant) || cant === 0) continue;
      const p = (cod && porCod.get(cod.trim().toLowerCase())) || porNom.get(sinTilde(det));
      if (p) { suma.set(p.id, (suma.get(p.id) || 0) + cant); total += cant; }
      else sin.push({ cod, det, cant });
    }
    if (!suma.size && !sin.length) return { error: 'El archivo no tiene filas con ventas.' };
    return { filas: [...suma].map(([producto_id, cantidad]) => ({ producto_id, cantidad })), sin, total };
  }
  function pintarImport() {
    const x = E.imp, ult = E.imps.find(i => !i.anulada);
    const desde = ult ? sumarDia(ult.hasta) : (E.cerrados[0] ? sumarDia(E.cerrados[0].fecha) : ayer());
    let b = '<p><b>' + esc(x.archivo) + '</b>: ' + x.filas.length + ' productos reconocidos (' + fmtN(x.total) + ' unidades/kg en total).</p>';
    if (x.sin.length) b += '<div class="st-nota">' + ico('triangle-alert') + '<div><b>' + x.sin.length + (x.sin.length === 1 ? ' fila no coincide' : ' filas no coinciden') + ' con el catálogo</b> y no se van a descontar:<ul>' +
      x.sin.slice(0, 12).map(s => '<li>' + esc(s.cod ? s.cod + ' · ' : '') + esc(s.det) + ' (' + fmtN(s.cant) + ')</li>').join('') + (x.sin.length > 12 ? '<li>… y ' + (x.sin.length - 12) + ' más</li>' : '') + '</ul>' +
      '<label class="st-check"><input type="checkbox" id="st-imp-crear" checked> Agregarlas al catálogo y descontarlas igual</label></div></div>';
    b += '<p class="st-ayuda">Tienen que ser <b>las mismas fechas que elegiste en Dubix</b>. Si no coinciden, cancelá y exportá de nuevo.</p>';
    b += '<div class="st-dos"><div class="field"><label>Desde</label><input type="date" id="st-imp-desde" value="' + desde + '" max="' + hoy() + '"></div>' +
      '<div class="field"><label>Hasta</label><input type="date" id="st-imp-hasta" value="' + hoy() + '" max="' + hoy() + '"></div></div>';
    modal('Importar ventas de Dubix', b, [['Cancelar', 'btn-secondary', cerrarModal], ['Descontar ventas', 'btn-primary', confirmarImport]]);
  }
  async function confirmarImport() {
    const x = E.imp, desde = $('st-imp-desde').value, hasta = $('st-imp-hasta').value;
    if (!desde || !hasta || hasta < desde) return avisar('Revisá las fechas');
    const filas = [...x.filas];
    let sinMatch = x.sin.length;
    const crear = $('st-imp-crear') && $('st-imp-crear').checked;
    if (crear && x.sin.length) {
      const nuevos = new Map();
      x.sin.forEach(s => { const k = (s.cod || '') + '|' + s.det; if (!nuevos.has(k)) nuevos.set(k, { codigo: s.cod || null, nombre: s.det || s.cod, marca: 'Otros', unidad: Number.isInteger(s.cant) ? 'u' : 'kg' }); });
      const { data, error } = await sb.from('stock_productos').insert([...nuevos.values()]).select('id,codigo,nombre');
      if (error) return avisar('No se pudieron crear los productos: ' + errTxt(error));
      const ids = new Map(data.map(d => [(d.codigo || '') + '|' + d.nombre, d.id]));
      const suma = new Map();
      x.sin.forEach(s => { const id = ids.get((s.cod || '') + '|' + (s.det || s.cod)); if (id) suma.set(id, (suma.get(id) || 0) + s.cant); });
      suma.forEach((cantidad, producto_id) => filas.push({ producto_id, cantidad }));
      sinMatch = 0;
    }
    const { error } = await sb.rpc('stock_importar_ventas', { p_archivo: x.archivo, p_desde: desde, p_hasta: hasta, p_filas: filas, p_sin_match: sinMatch });
    if (error) return avisar(errTxt(error));
    cerrarModal();
    avisar('Ventas descontadas: ' + filas.length + ' productos');
    E.imp = null;
    cargar(true);
  }
  async function anularImp(id) {
    if (!confirm('¿Anular esta importación? Las ventas dejan de descontarse.')) return;
    const { error } = await sb.rpc('stock_anular_importacion', { p_id: id });
    if (error) return avisar(errTxt(error));
    cargar(true);
  }

  // ── Ingreso con foto de factura / remito ───────────────────────────
  function elegirFoto() { const i = $('st-foto'); if (i) { i.value = ''; i.click(); } }
  function achicar(file) {
    return new Promise((ok, mal) => {
      if (file.type === 'application/pdf') {
        const r = new FileReader(); r.onload = () => ok({ tipo: 'application/pdf', datos: String(r.result).split(',')[1] }); r.onerror = mal; r.readAsDataURL(file); return;
      }
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        const max = 2000, k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        ok({ tipo: 'image/jpeg', datos: c.toDataURL('image/jpeg', 0.85).split(',')[1] });
      };
      img.onerror = () => { URL.revokeObjectURL(url); mal(new Error('No se pudo abrir la foto')); };
      img.src = url;
    });
  }
  const palabras = t => sinTilde(t).replace(/[^a-z0-9ñ ]/g, ' ').split(/\s+/).filter(w => w.length > 1);
  function parecido(a, b) {
    const A = new Set(palabras(a)), B = new Set(palabras(b)); if (!A.size || !B.size) return 0;
    let c = 0; A.forEach(w => { if (B.has(w)) c++; });
    return c / Math.min(A.size, B.size);
  }
  async function leerFoto(input) {
    const files = [...(input.files || [])].slice(0, 4); if (!files.length) return;
    modal('Leyendo la factura…', '<div class="st-vacio">' + ico('refresh-cw') + ' Esto tarda unos 20 segundos. No cierres la app.</div>', [['Cancelar', 'btn-secondary', cerrarModal]]);
    let res;
    try {
      const imagenes = await Promise.all(files.map(achicar));
      const { data, error } = await sb.functions.invoke('stock-factura', { body: { imagenes } });
      if (error) {
        let m = errTxt(error);
        try { const j = await error.context.json(); if (j && j.error) m = j.error; } catch (e) { /* nada */ }
        throw new Error(m);
      }
      res = data;
    } catch (e) {
      return modal('No se pudo leer', '<p>' + esc(errTxt(e)) + '</p><p class="st-ayuda">Podés cargar el ingreso a mano con «Ingreso a mano / merma».</p>', [['Entendido', 'btn-primary', cerrarModal]]);
    }
    const { data: al } = await sb.from('stock_alias').select('texto_key,producto_id').limit(5000);
    const alias = new Map((al || []).map(a => [a.texto_key, a.producto_id]));
    const activos = E.prods.filter(p => p.activo);
    E.lineas = []; E.sinProd = []; E.asignando = null; E.movTipo = 'ingreso';
    (res.lineas || []).forEach(l => {
      const texto = (l.codigo ? l.codigo + ' · ' : '') + l.descripcion;
      const key = sinTilde((l.codigo || '') + '|' + l.descripcion).replace(/\s+/g, ' ').trim();
      let p = alias.has(key) ? E.porId.get(alias.get(key)) : null;
      if (!p && l.codigo) p = activos.find(x => x.codigo && x.codigo.toLowerCase() === String(l.codigo).toLowerCase());
      if (!p) {
        let mejor = null, pts = 0;
        activos.forEach(x => { const s = parecido(l.descripcion, x.nombre); if (s > pts) { pts = s; mejor = x; } });
        if (pts >= 0.6 && !l.dudosa) p = mejor;
      }
      const ref = texto + ' — ' + fmtN(l.cantidad) + ' ' + ({ caja: 'cj', unidad: 'u', kg: 'kg' })[l.unidad] + (l.kilos ? ' (' + fmtN(l.kilos, 'kg') + ' kg)' : '');
      const linea = { texto, ref, cantidad: l.cantidad, unidad: l.unidad, kilos: l.kilos, dudosa: !!l.dudosa, aliasKey: key };
      if (p) E.lineas.push(armarLinea(linea, p)); else E.sinProd.push(linea);
    });
    const f = res.fecha && /^\d{4}-\d{2}-\d{2}$/.test(res.fecha) && res.fecha <= hoy() ? res.fecha : hoy();
    E.movFecha = f;
    E.movNota = ['Factura', res.numero, res.proveedor].filter(Boolean).join(' ').slice(0, 300);
    pintarMovimiento(); restaurarCamposMov();
  }
  // Pasa la cantidad de la factura a cajas / sueltos / kilos del producto.
  function armarLinea(x, p) {
    const f = Number(p.por_caja) || 0, coma = v => v === null || v === undefined ? '' : String(v).replace('.', ',');
    const l = { pid: p.id, cant: '', cj: '', ref: x.ref, aliasKey: x.aliasKey };
    if (p.unidad === 'kg' && x.kilos) l.cant = coma(x.kilos);
    else if (x.unidad === 'caja' && f) l.cj = coma(x.cantidad);
    else l.cant = coma(x.cantidad);
    return l;
  }
  function buscarPara(i) {
    guardarCamposMov(); E.asignando = i; pintarMovimiento(); restaurarCamposMov();
    const q = $('st-ac-q'), x = E.sinProd[i];
    if (q && x) { q.value = palabras(x.texto.replace(/^.*? · /, '')).slice(0, 3).join(' '); q.focus(); sugerir(q.value); }
  }
  function ignorarLinea(i) { guardarCamposMov(); E.sinProd.splice(i, 1); E.asignando = null; pintarMovimiento(); restaurarCamposMov(); }
  function agregarLinea(pid) {
    guardarCamposMov();
    const p = E.porId.get(pid);
    if (E.asignando !== null && E.asignando !== undefined && E.sinProd[E.asignando] && p) {
      E.lineas.push(armarLinea(E.sinProd[E.asignando], p));
      E.sinProd.splice(E.asignando, 1); E.asignando = null;
    } else if (!E.lineas.some(l => l.pid === pid)) E.lineas.push({ pid, cant: '' });
    pintarMovimiento(); restaurarCamposMov();
  }

  // ── Producto que no está en el catálogo ────────────────────────────
  // Regla: se carga con el nombre REAL del producto (no como si fuera otro).
  // Después hay que darlo de alta en Dubix con el mismo nombre.
  function productoNuevo(desde) {
    const q = desde === 'ingreso' ? (($('st-ac-q') || {}).value || '').trim() : E.q.trim();
    if (desde === 'ingreso') guardarCamposMov();
    E.nuevoDesde = desde;
    const ms = marcas(E.prods.filter(p => p.activo));
    const b = '<p class="st-ayuda">Ponele el nombre real, como figura en el envase. Después hay que crearlo en Dubix con el mismo nombre.</p>' +
      '<div class="field"><label>Nombre</label><input id="st-np-nom" value="' + escAttr(q) + '" maxlength="120"></div>' +
      '<div class="field"><label>Marca / proveedor</label><input id="st-np-marca" list="st-np-marcas" placeholder="Ej: Nahuel"><datalist id="st-np-marcas">' + ms.map(m => '<option value="' + escAttr(m) + '">').join('') + '</datalist></div>' +
      '<div class="st-dos"><div class="field"><label>Se cuenta en</label><select id="st-np-uni"><option value="u">Unidades</option><option value="kg">Kilos</option></select></div>' +
      '<div class="field"><label>Unidades por caja (si viene en caja)</label><input id="st-np-caja" inputmode="numeric" placeholder="Ej: 12"></div></div>' +
      (desde === 'conteo' && E.rec ? '<div class="field"><label>Cuánto hay (en unidades o kilos)</label><input id="st-np-cant" inputmode="decimal" placeholder="Ej: 8"></div>' : '');
    modal('Producto nuevo', b, [['Cancelar', 'btn-secondary', () => { cerrarModal(); if (desde === 'ingreso') pintarMovimiento(), restaurarCamposMov(); }], ['Agregar', 'btn-primary', guardarProductoNuevo]]);
  }
  async function guardarProductoNuevo() {
    const nombre = $('st-np-nom').value.trim(), marca = $('st-np-marca').value.trim() || 'Otros';
    const unidad = $('st-np-uni').value, caja = leerNum($('st-np-caja').value);
    if (nombre.length < 3) return avisar('Poné el nombre');
    if (Number.isNaN(caja) || (caja !== null && caja <= 1)) return avisar('Unidades por caja: poné un número mayor a 1 o dejalo vacío');
    const ya = E.prods.find(p => p.nombre.trim().toLowerCase() === nombre.toLowerCase());
    if (ya) return avisar('Ya existe: buscalo como «' + ya.nombre + '»');
    const { data, error } = await sb.from('stock_productos').insert({ nombre, marca, unidad, por_caja: caja }).select('id').single();
    if (error) return avisar('Error: ' + errTxt(error));
    const cant = $('st-np-cant') ? leerNum($('st-np-cant').value) : null;
    if (E.nuevoDesde === 'conteo' && E.rec && cant !== null && !Number.isNaN(cant) && cant >= 0)
      await sb.from('stock_recuento_items').insert({ recuento_id: E.rec.id, producto_id: data.id, contado: cant, autor: st().who });
    avisar('Agregado: ' + nombre);
    if (E.nuevoDesde === 'ingreso') {
      await cargar(true);
      agregarLinea(data.id);
    } else {
      cerrarModal(); E.filtro = 'contados'; await cargar(true);
    }
  }

  // ── Modal propio (no pisa los de la app) ───────────────────────────
  let acciones = [];
  function modal(titulo, cuerpo, botones) {
    let o = $('stModal');
    if (!o) {
      o = document.createElement('div'); o.className = 'overlay'; o.id = 'stModal';
      o.addEventListener('click', e => { if (e.target === o) cerrarModal(); });
      document.body.appendChild(o);
    }
    acciones = botones.map(b => b[2]);
    o.innerHTML = '<div class="modal st-modal"><div class="modal-handle"></div><h3>' + esc(titulo) + '</h3><div class="st-modal-cuerpo">' + cuerpo + '</div>' +
      '<div class="st-modal-pie">' + botones.map((b, i) => '<button class="btn ' + b[1] + '"' + (b[3] ? ' disabled' : '') + ' onclick="StockUI._acc(' + i + ',this)">' + esc(b[0]) + '</button>').join('') + '</div></div>';
    o.classList.add('open');
  }
  function cerrarModal() { const o = $('stModal'); if (o) o.classList.remove('open'); }
  async function _acc(i, btn) {
    if (btn.disabled) return;
    btn.disabled = true;
    try { await acciones[i](); } finally { if (document.body.contains(btn)) btn.disabled = false; }
  }

  // ── Entrada a la pestaña ───────────────────────────────────────────
  let timerAuto = null;
  async function abrir() {
    if (E.ok === null) await aplicarAcceso();
    if (!E.ok) return;
    await cargar(!!E.prods.length);
    restaurarPendientes();
    clearInterval(timerAuto);
    // Mientras se cuenta, cada 30 s trae lo que cargó el otro (sin pisar lo que se está escribiendo).
    timerAuto = setInterval(() => {
      if (typeof activeTab !== 'undefined' && activeTab !== 'stock') return clearInterval(timerAuto);
      if (document.hidden || (document.activeElement && document.activeElement.classList.contains('st-num')) || ($('stModal') && $('stModal').classList.contains('open'))) return;
      if (E.vista === 'recuento' && E.rec) cargar(true);
    }, 30000);
  }

  let tBuscar = null;
  window.StockUI = {
    aplicarAcceso, abrir, cargar: () => cargar(), render,
    ver(v) { E.vista = v; render(); window.scrollTo(0, 0); },
    buscar(q) { E.q = q; clearTimeout(tBuscar); tBuscar = setTimeout(() => { render(); const i = raiz().querySelector('.st-buscar'); if (i) { i.focus(); i.setSelectionRange(q.length, q.length); } }, 200); },
    setMarca(m) { E.marca = m; render(); },
    setFiltro(f) { E.filtro = f; render(); },
    setAlcance(t) { E.alcance = t ? 'todos' : 'activos'; render(); },
    abrirRecuento, contar, siguiente, cambiarUnidad, reintentar, confirmarCierre, anularRecuento, descargarAjuste,
    nuevoMovimiento, sugerir, borrarMov,
    movTipo(t) { guardarCamposMov(); E.movTipo = t; pintarMovimiento(); restaurarCamposMov(); },
    agregarLinea, elegirFoto, leerFoto, buscarPara, ignorarLinea,
    quitarLinea(i) { guardarCamposMov(); E.lineas.splice(i, 1); pintarMovimiento(); restaurarCamposMov(); },
    lineaCant(i, v, k) { if (E.lineas[i]) E.lineas[i][k === 'cj' ? 'cj' : 'cant'] = v; },
    elegirCsv, leerCsv, anularImp, _acc, productoNuevo,
    _parsearVentas: parsearVentas, _E: E,   // para pruebas
  };
})();
