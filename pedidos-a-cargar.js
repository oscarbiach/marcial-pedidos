/* Pestaña Cargar → «Pedidos para cargar» (pedido del usuario, 19/10/2026).
   Reemplaza al grupo de WhatsApp «Ventas» para los pedidos que hay que pasar a la app (la API oficial no lee grupos):
   el vendedor lo escribe tal cual desde el celular y en la PC aparece a la izquierda del formulario. «Cargar» completa el cliente y,
   al guardar el pedido, queda marcado como cargado solo (lo que antes era el 👍). También «Listo» (ya estaba cargado) y «Descartar».
   Idempotente: el id del envío ('pac_…') se genera una vez por pedido y se reusa en cada reintento; el botón queda
   deshabilitado mientras se manda. Datos: tabla pedidos_a_cargar (supabase/16-pedidos-a-cargar.sql); en modo prueba,
   localStorage 'dm_sandbox_pac'. */
(function () {
  'use strict';
  const CLAVE_PRUEBA = 'dm_sandbox_pac', CLAVE_COLA = 'dm_pac_cola', CADA = 45000;
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ico = (n, c) => (window.mIco ? mIco(n, c || 'ico-sm') : '');
  const S = { lista: [], listo: false, cargado: false, error: '', abierto: false, activo: null, envioId: null, enviando: false, ocupados: new Set(), canal: null, tRealtime: 0 };
  const prueba = () => typeof sandboxActivo === 'function' && sandboxActivo();
  const conSesion = () => prueba() || (typeof state !== 'undefined' && state.pin === 'ok');
  const quien = () => (typeof state !== 'undefined' && state.who) || '—';
  const nuevoId = () => 'pac_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  // ── Datos ──
  function leerPrueba() {
    try { const d = JSON.parse(localStorage.getItem(CLAVE_PRUEBA)); if (Array.isArray(d)) return d; } catch (e) { /* sin datos */ }
    const ahora = Date.now();
    const ini = [
      { id: 'pac_demo00001', autor: 'Thiago', cliente: 'Bar Demo Plaza', texto: '2 cajas cremoso\n3 kg jamón cocido\n1 panceta feteada sin cuero', estado: 'pendiente', creado_en: new Date(ahora - 40 * 60000).toISOString() },
      { id: 'pac_demo00002', autor: 'Mateo', cliente: '', texto: 'Kiosco del centro: 6 cajas papas swift y 2 mayonesa 3kg. Entregar mañana a la mañana', estado: 'pendiente', creado_en: new Date(ahora - 12 * 60000).toISOString() },
    ];
    guardarPrueba(ini); return ini;
  }
  function guardarPrueba(l) { try { localStorage.setItem(CLAVE_PRUEBA, JSON.stringify(l)); } catch (e) { /* sin espacio */ } }
  async function leer() {
    if (prueba()) return leerPrueba().filter(x => x.estado === 'pendiente').sort((a, b) => a.creado_en.localeCompare(b.creado_en));
    const { data, error } = await sb.from('pedidos_a_cargar').select('id,autor,cliente,texto,estado,creado_en')
      .eq('estado', 'pendiente').order('creado_en', { ascending: true }).limit(200);
    if (error) throw error;
    return data || [];
  }
  async function crear(f) {
    if (prueba()) { const l = leerPrueba(); if (!l.some(x => x.id === f.id)) l.push(Object.assign({ estado: 'pendiente', creado_en: new Date().toISOString() }, f)); guardarPrueba(l); return; }
    const { error } = await sb.from('pedidos_a_cargar').upsert(f, { onConflict: 'id', ignoreDuplicates: true });
    if (error) throw error;
  }
  // Solo pasa de «pendiente» a otro estado: repetirlo no cambia nada (idempotente).
  async function resolver(id, estado, pedidoId) {
    const cambio = { estado, resuelto_por: quien(), resuelto_en: new Date().toISOString(), pedido_id: pedidoId || null };
    if (prueba()) { const l = leerPrueba(), x = l.find(y => y.id === id); if (x && x.estado === 'pendiente') Object.assign(x, cambio); guardarPrueba(l); return; }
    const { error } = await sb.from('pedidos_a_cargar').update(cambio).eq('id', id).eq('estado', 'pendiente');
    if (error) throw error;
  }
  // Las marcas que no se pudieron mandar (sin señal) quedan en una cola y se reintentan en la próxima actualización.
  const cola = () => { try { return JSON.parse(localStorage.getItem(CLAVE_COLA)) || []; } catch (e) { return []; } };
  const guardarCola = c => { try { localStorage.setItem(CLAVE_COLA, JSON.stringify(c)); } catch (e) { /* sin espacio */ } };
  async function vaciarCola() {
    const c = cola(); if (!c.length) return;
    const quedan = [];
    for (const m of c) { try { await resolver(m.id, m.estado, m.pedidoId); } catch (e) { quedan.push(m); } }
    guardarCola(quedan);
  }

  // ── Pantalla ──
  // PC: la lista va al costado izquierdo del formulario (solo para ver y cargar). Celular: solo el formulario para mandar.
  const enPC = () => window.matchMedia('(min-width:768px)').matches;
  function montar() {
    const tab = $('tab-cargar'), form = tab && tab.querySelector('.form-card');
    if (!form || $('pac')) return;
    const lado = document.createElement('aside');
    lado.id = 'pac'; lado.className = 'pac pc-only'; lado.setAttribute('aria-label', 'Pedidos para cargar');
    lado.innerHTML = `<div class="pac-cab">${ico('clipboard-list')}<span class="pac-tit">Para cargar</span><span class="pac-n" id="pac-n">…</span></div>
      <div id="pac-lista" class="pac-lista"></div>
      <p id="pac-aviso" class="pac-aviso" role="status" aria-live="polite"></p>`;
    const mandar = document.createElement('details');
    mandar.id = 'pac-nuevo'; mandar.className = 'pac-nuevo mobile-only';
    mandar.innerHTML = `<summary>${ico('message-circle')}Mandar un pedido para cargar</summary>
      <form id="pac-form" class="pac-form" novalidate>
        <label><span>Cliente <i>(opcional)</i></span><input id="pac-cliente" maxlength="120" autocomplete="off" placeholder="Nombre del cliente"></label>
        <label>Pedido<textarea id="pac-texto" rows="4" maxlength="2000" placeholder="Escribilo como en el grupo: 2 cajas cremoso, 3 kg jamón…"></textarea></label>
        <button type="submit" id="pac-enviar" class="btn btn-primary">Mandar para cargar</button>
        <p id="pac-aviso-envio" class="pac-aviso" role="status" aria-live="polite"></p>
      </form>`;
    form.parentNode.insertBefore(lado, form);
    form.parentNode.insertBefore(mandar, form);
    $('pac-form').onsubmit = e => { e.preventDefault(); enviar(); };
    // Si se cambia lo escrito, es otro pedido: el próximo envío lleva otro id.
    ['pac-cliente', 'pac-texto'].forEach(id => $(id).addEventListener('input', () => { if (!S.enviando) S.envioId = null; }));
    lado.addEventListener('click', e => {
      const b = e.target.closest('[data-pac]'); if (!b) return;
      const id = b.dataset.id, a = b.dataset.pac;
      if (a === 'cargar') usar(id);
      else if (a === 'listo') marcar(id, 'cargado', b);
      else if (a === 'descartar') { if (confirm('¿Descartar este pedido? No se va a cargar.')) marcar(id, 'descartado', b); }
      else if (a === 'cancelar-activo') { S.activo = null; dibujar(); }
    });
    // Al pasar a pantalla de PC (ventana más ancha) la lista se actualiza.
    window.matchMedia('(min-width:768px)').addEventListener('change', e => { if (e.matches) refrescar(); });
    S.listo = true; dibujar();
  }
  function hace(iso) {
    const d = new Date(iso), min = Math.round((Date.now() - d) / 60000);
    if (min < 1) return 'recién';
    if (min < 60) return 'hace ' + min + ' min';
    if (min < 12 * 60) return 'hace ' + Math.round(min / 60) + ' h';
    return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  function dibujar() {
    if (!S.listo) return;
    const n = S.lista.length;
    $('pac-n').textContent = S.cargado ? n : '…';
    $('pac-n').classList.toggle('pac-n--hay', n > 0);
    if (S.activo && S.cargado && !S.lista.some(x => x.id === S.activo)) S.activo = null;
    const lista = $('pac-lista');
    if (S.error && !n) { lista.innerHTML = `<p class="pac-vacio pac-error">${esc(S.error)}</p>`; return; }
    if (!S.cargado) { lista.innerHTML = '<p class="pac-vacio">Buscando pedidos…</p>'; return; }
    if (!n) { lista.innerHTML = '<p class="pac-vacio">No hay pedidos pendientes.</p>'; return; }
    lista.innerHTML = (S.error ? `<p class="pac-vacio pac-error">${esc(S.error)}</p>` : '') + S.lista.map(x => {
      const ocupado = S.ocupados.has(x.id) ? ' disabled' : '', es = x.id === S.activo, d = `data-id="${esc(x.id)}"`;
      return `<article class="pac-it${es ? ' pac-it--activo' : ''}" ${d}>
        <div class="pac-meta"><b>${esc(x.autor)}</b> · ${esc(hace(x.creado_en))}${/^pac_tg/.test(x.id) ? ' · <span class="pac-tg">Telegram</span>' : ''}</div>
        ${x.cliente ? `<div class="pac-cli">${esc(x.cliente)}</div>` : ''}
        <div class="pac-txt">${esc(x.texto)}</div>
        ${es ? `<p class="pac-en-carga">En carga: al guardar el pedido se marca solo. <button type="button" class="pac-link" data-pac="cancelar-activo">Cancelar</button></p>` : ''}
        <div class="pac-acc">
          ${es ? '' : `<button type="button" class="pac-btn pac-btn--prim" data-pac="cargar" ${d}${ocupado}>Cargar</button>`}
          <button type="button" class="pac-btn" data-pac="listo" ${d}${ocupado} title="Ya está cargado">${ico('check')}Listo</button>
          <button type="button" class="pac-link" data-pac="descartar" ${d}${ocupado}>Descartar</button>
        </div></article>`;
    }).join('');
  }
  function aviso(t, error, id) { const p = $(id || 'pac-aviso'); if (p) { p.textContent = t || ''; p.classList.toggle('pac-error', !!error); } }

  async function refrescar() {
    if (!S.listo || !enPC() || !conSesion() || S.refrescando) return;   // en el celular la lista no se muestra
    S.refrescando = true;
    try {
      await vaciarCola();
      const pend = new Set(cola().map(m => m.id));
      S.lista = (await leer()).filter(x => !pend.has(x.id));
      S.cargado = true; S.error = '';
      escuchar();
    } catch (e) {
      S.error = 'No se pudo actualizar la lista' + (S.cargado ? '; se muestra la última.' : '. Revisá la conexión.');
    } finally { S.refrescando = false; dibujar(); }
  }
  // Realtime: si la tabla está en la publicación, un pedido nuevo aparece solo; si no, alcanza con la actualización periódica.
  function escuchar() {
    if (S.canal || prueba() || typeof sb === 'undefined' || !sb.channel) return;
    try {
      S.canal = sb.channel('pac-cambios').on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos_a_cargar' }, () => {
        clearTimeout(S.tRealtime); S.tRealtime = setTimeout(refrescar, 700);
      }).subscribe();
    } catch (e) { S.canal = null; }
  }

  async function enviar() {
    if (S.enviando) return;
    const texto = $('pac-texto').value.trim(), cliente = $('pac-cliente').value.trim();
    if (!texto) { aviso('Escribí el pedido.', true, 'pac-aviso-envio'); $('pac-texto').focus(); return; }
    if (!S.envioId) S.envioId = nuevoId();   // una vez por pedido: el reintento reusa el mismo
    S.enviando = true; $('pac-enviar').disabled = true; $('pac-enviar').textContent = 'Mandando…'; aviso('', false, 'pac-aviso-envio');
    try {
      await crear({ id: S.envioId, autor: quien(), cliente: cliente || null, texto });
      $('pac-texto').value = ''; $('pac-cliente').value = ''; S.envioId = null;
      aviso('Listo: quedó para cargar.', false, 'pac-aviso-envio');
      if (typeof toast === 'function') toast('✓ Pedido mandado para cargar');
      await refrescar();
    } catch (e) {
      aviso('No se pudo mandar. Probá de nuevo: no se va a duplicar.', true, 'pac-aviso-envio');
    } finally { S.enviando = false; $('pac-enviar').disabled = false; $('pac-enviar').textContent = 'Mandar para cargar'; }
  }
  async function marcar(id, estado, boton) {
    if (S.ocupados.has(id)) return;
    S.ocupados.add(id); dibujar();
    try {
      await resolver(id, estado, null);
      S.lista = S.lista.filter(x => x.id !== id); if (S.activo === id) S.activo = null;
      aviso(estado === 'cargado' ? 'Marcado como cargado.' : 'Descartado.');
    } catch (e) { aviso('No se pudo marcar. Probá de nuevo.', true); }
    finally { S.ocupados.delete(id); dibujar(); }
  }
  // «Cargar este»: completa el cliente y deja el pedido «en carga»; al guardar el pedido se marca solo.
  function usar(id) {
    const x = S.lista.find(y => y.id === id); if (!x) return;
    S.activo = id; dibujar();   // la tarjeta queda resaltada al costado mientras se carga
    const inp = $('n_cliente');
    if (inp && x.cliente && !inp.value.trim()) inp.value = x.cliente;
    if (inp) inp.focus();
  }
  // Lo llama submitCargarPedido después de encolar el pedido (con el id 'ped_…' que generó).
  function alGuardar(pedidoId) {
    const id = S.activo; if (!id) return;
    // Un pedido guardado desde otra pantalla (p. ej. el formulario abierto desde WhatsApp) no es este.
    if (typeof activeTab !== 'undefined' && activeTab !== 'cargar') { S.activo = null; dibujar(); return; }
    S.activo = null;
    S.lista = S.lista.filter(x => x.id !== id); dibujar();
    resolver(id, 'cargado', pedidoId).then(() => aviso('El pedido quedó marcado como cargado.'), () => {
      const c = cola(); if (!c.some(m => m.id === id)) c.push({ id, estado: 'cargado', pedidoId }); guardarCola(c);
    });
  }
  function alMostrar() { montar(); refrescar(); }
  // Al irse de Cargar se suelta el «Cargar este»: el próximo pedido guardado puede ser otro.
  function alSalir() { if (S.activo) { S.activo = null; dibujar(); } }

  function iniciar() {
    montar();
    // Hasta que haya sesión (PIN) no se puede leer: se prueba seguido al principio y después cada 45 s.
    let intentos = 0;
    const arranque = setInterval(() => { intentos++; if (conSesion()) { clearInterval(arranque); refrescar(); } else if (intentos > 120) clearInterval(arranque); }, 1000);
    setInterval(() => { if (document.visibilityState === 'visible') refrescar(); }, CADA);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refrescar(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
  window.PedidosACargar = { alGuardar, alMostrar, alSalir, refrescar, _estado: S };
})();
