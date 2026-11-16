/* Cola de preparación compartida. La base confirma cada movimiento; nunca despacha. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const etapas = { pendiente: 'Sin enviar', por_preparar: 'Por preparar', preparando: 'Preparando', listo: 'Listos' };
  const siguiente = { pendiente: 'por_preparar', por_preparar: 'preparando', preparando: 'listo' };
  const anterior = { por_preparar: 'pendiente', preparando: 'por_preparar', listo: 'preparando' };
  const accion = { pendiente: 'Enviar a preparar', por_preparar: 'Empezar', preparando: 'Marcar listo' };
  const S = { filas: new Map(), pedidos: [], canal: null, timer: null, debounce: null, loading: false,
    again: false, ready: false, live: false, error: '', busy: new Set(), legacy: false, drag: null, dirty: false, usuario: '', generation: 0 };
  const mateo = () => state.who === 'Mateo';
  const envia = () => ['Oscar','Thiago','Joaquin'].includes(state.who);
  const opera = () => envia() || mateo();
  const etapa = id => S.filas.get(id)?.etapa || 'pendiente';
  const elegible = p => p.estado === 'Pendiente' && !p.retiro && !p.enCola && !p.errorCola && !p.eliminado_en;
  const permiso = (de, a) => opera() && (siguiente[de] === a || anterior[de] === a) &&
    (envia() || (de !== 'pendiente' && a !== 'pendiente'));
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function acceso() {
    document.body.classList.toggle('usuario-mateo', mateo());
    if (S.usuario !== state.who) {
      detener(); S.usuario = state.who; S.legacy = false; S.ready = false;
      S.filas.clear(); S.pedidos = []; S.busy.clear(); S.error = '';
      if (window.Preparacion) Preparacion.cerrar(false);
      if (mateo()) { activeTab = 'reparto'; repSel = []; }
    }
  }
  function detener() {
    S.generation++;
    if (S.canal) sb.removeChannel(S.canal);
    S.canal = null; S.live = false;
    clearInterval(S.timer); clearTimeout(S.debounce);
  }
  function programar() {
    clearTimeout(S.debounce);
    S.debounce = setTimeout(() => cargar(), 120);
  }
  function iniciar() {
    if (!state.pin || S.canal) return;
    S.canal = sb.channel('reparto-vivo-' + Date.now());
    ['prep_cola','pedidos','pedido_items','prep_items','prep_pedidos','prep_productos'].forEach(table => {
      S.canal.on('postgres_changes', { event: '*', schema: 'public', table }, () => {
        programar();
        if (window.Preparacion) Preparacion.refrescar();
      });
    });
    S.canal.subscribe(status => {
      S.live = status === 'SUBSCRIBED';
      if (S.live) programar();
      pintar();
    });
    // Recuperación ante cortes/eventos perdidos; no es la vía principal de actualización.
    S.timer = setInterval(() => { if (!document.hidden && activeTab === 'reparto') cargar(); }, 15000);
    cargar();
  }
  async function cargar() {
    if (!state.pin || document.hidden) return;
    if (S.loading) { S.again = true; return; }
    S.loading = true;
    const generation = S.generation;
    try {
      // Paginar evita el límite de 1000 de PostgREST. La cola se consulta solo para pedidos vigentes.
      const pedidos = [];
      for (let desde = 0; ; desde += 500) {
        const {data,error} = await sb.from('pedidos').select('id,fecha,quien,cliente,fecha_entrega,direccion,notas,estado,fecha_despacho,retiro,remito_hecho,eliminado_en,pedido_items(id,producto,cantidad,fetear,sin_cuero,en_unidades,medida,orden,cantidad_entregada,motivo_faltante,detalle_faltante)').eq('estado','Pendiente').is('eliminado_en',null).or('retiro.eq.false,retiro.is.null').order('id').range(desde,desde+499);
        if (error) throw error;
        pedidos.push(...(data || []));
        if (!data || data.length < 500) break;
      }
      const ids = pedidos.map(p => p.id), consultas = [];
      for (let i=0;i<ids.length;i+=75) consultas.push(sb.from('prep_cola').select('*').in('pedido_id',ids.slice(i,i+75)));
      // Aun sin pedidos verificamos la disponibilidad del esquema.
      if (!consultas.length) consultas.push(sb.from('prep_cola').select('*').limit(0));
      const colas = await Promise.all(consultas);
      for (const result of colas) if (result.error) throw result.error;
      if (generation !== S.generation) return;
      S.filas = new Map(colas.flatMap(r => r.data || []).map(r => [r.pedido_id,r]));
      S.pedidos = pedidos.map(mapPedido_).filter(elegible);
      S.ready = true; S.error = '';
    } catch (e) {
      if (generation === S.generation) S.error = 'No se pudo sincronizar. Revisá la conexión y reintentá.';
    } finally {
      S.loading = false;
      pintar();
      if (S.again) { S.again = false; programar(); }
    }
  }
  function montar() {
    acceso();
    const panel = $('tab-reparto');
    if (!panel) return;
    let root = $('rv-raiz');
    if (!root) {
      root = document.createElement('section'); root.id = 'rv-raiz'; root.className = 'rv';
      panel.prepend(root);
      root.addEventListener('click', clic);
      root.addEventListener('pointerdown', down);
      root.addEventListener('pointermove', move);
      root.addEventListener('pointerup', up);
      root.addEventListener('pointercancel', cancel);
      root.addEventListener('lostpointercapture', cancel);
    }
    document.body.classList.toggle('reparto-vivo', activeTab === 'reparto' && !S.legacy);
    $('repClasico').hidden = mateo() || !S.legacy;
    root.hidden = S.legacy && !mateo();
    if (activeTab === 'reparto') { iniciar(); pintar(); }
  }
  function tarjeta(p) {
    const e = etapa(p.id), fila = S.filas.get(p.id), busy = S.busy.has(p.id), next = siguiente[e];
    const fecha = p.fechaEntrega ? fmtDate(p.fechaEntrega) : 'Sin fecha';
    return `<article class="rv-card" data-id="${esc(p.id)}" data-etapa="${e}" aria-label="${esc(p.cliente)} · ${etapas[e]}" aria-busy="${busy}">
      <div class="rv-card-top"><span>${esc(fecha)}</span><span>${esc(p.quien || '')}</span></div>
      <h3>${esc(p.cliente)}</h3>
      <p class="rv-dir">${esc(p.direccion || 'Sin dirección')}</p>
      <ul>${p.items.slice(0,3).map(it => `<li><b>${esc(repCantidad(it))}</b> ${esc(it.prod)} <em>${esc(repTagsTexto(it))}</em></li>`).join('')}</ul>
      ${p.items.length > 3 ? `<span class="rv-more">+ ${p.items.length-3} productos · Abrí el detalle</span>` : ''}
      ${p.notas ? `<p class="rv-note">${esc(p.notas)}</p>` : ''}
      ${fila ? `<p class="rv-author">${e === 'por_preparar' ? 'Enviado' : 'Actualizado'} por ${esc(fila.actualizado_por)}</p>` : ''}
      <div class="rv-actions"><button data-rv="detalle" data-id="${esc(p.id)}">Ver pedido</button>
      ${next && permiso(e,next) ? `<button class="rv-primary" data-rv="mover" data-id="${esc(p.id)}" data-to="${next}" ${busy || !S.ready || S.error ? 'disabled' : ''}>${busy ? 'Guardando…' : accion[e] + ' →'}</button>` : ''}</div>
      ${anterior[e] && permiso(e,anterior[e]) ? `<button class="rv-back" data-rv="mover" data-id="${esc(p.id)}" data-to="${anterior[e]}" ${busy || S.error ? 'disabled' : ''}>← ${e === 'por_preparar' ? 'Quitar de la cola' : e === 'listo' ? 'Volver a preparar' : 'Volver a la cola'}</button>` : ''}
    </article>`;
  }
  function pintar() {
    const r = $('rv-raiz'); if (!r || r.hidden || activeTab !== 'reparto') return;
    if (S.drag) { S.dirty = true; return; }
    const old = new Map([...r.querySelectorAll('.rv-card')].map(el => [el.dataset.id, el.getBoundingClientRect()]));
    const foco = document.activeElement?.closest('[data-rv]');
    const focusKey = foco && { id: foco.dataset.id, action: foco.dataset.rv, to: foco.dataset.to };
    const scrolls = [...r.querySelectorAll('.rv-list')].map(el => [el.dataset.col,el.scrollTop]);
    const cols = mateo() ? ['por_preparar','preparando','listo'] : ['pendiente','por_preparar','preparando','listo'];
    const total = S.pedidos.filter(p => etapa(p.id) !== 'pendiente').length;
    const listos = S.pedidos.filter(p => etapa(p.id) === 'listo').length;
    const html = `<header class="rv-header"><div><span class="rv-eyebrow">DEPÓSITO · REPARTO</span>
      <h2>${mateo() ? 'Tu mesa de preparación' : 'Preparación en vivo'}</h2>
      <p>${mateo() ? 'Los pedidos del equipo llegan acá. Empezá por el primero.' : 'Deslizá a la derecha para enviar o avanzar un pedido.'}</p></div>
      <div class="rv-status"><span class="rv-connection ${S.live && !S.error ? 'online' : ''}" role="status">${!navigator.onLine ? 'Sin conexión' : S.error ? 'Sin sincronizar' : S.live ? 'En vivo' : 'Reconectando…'}</span>
      <button data-rv="refresh" aria-label="Actualizar preparación">↻ Actualizar</button>${!mateo() ? '<button data-rv="hojas">Hojas de reparto</button>' : ''}</div></header>
      <div class="rv-summary"><b>${listos} de ${total} listos</b><div class="rv-progress" role="progressbar" aria-label="Pedidos listos" aria-valuemin="0" aria-valuemax="${total || 1}" aria-valuenow="${listos}"><i style="width:${total ? listos/total*100 : 0}%"></i></div><span>Listo = preparado; aún no despachado</span></div>
      ${S.error ? `<div class="rv-error" role="alert">${esc(S.error)} <button data-rv="refresh">Reintentar</button></div>` : ''}
      <div class="rv-board ${mateo() ? 'rv-mateo' : ''}">${cols.map(e => {
        const pedidos = S.pedidos.filter(p => etapa(p.id) === e).sort((a,b) => {
          if(e === 'pendiente') return (a.fechaEntrega || '9999').localeCompare(b.fechaEntrega || '9999');
          return String(S.filas.get(a.id)?.enviado_en || '').localeCompare(String(S.filas.get(b.id)?.enviado_en || '')) || a.id.localeCompare(b.id);
        });
        return `<section class="rv-column rv-${e}" aria-label="${etapas[e]}"><h3><span class="rv-dot"></span>${etapas[e]}<b>${pedidos.length}</b></h3><div class="rv-list" data-col="${e}">${pedidos.map(tarjeta).join('') || `<div class="rv-empty"><span>${e === 'listo' ? '✓' : '◇'}</span><b>${!S.ready ? 'Cargando pedidos…' : e === 'por_preparar' ? 'Todo al día' : 'Sin pedidos'}</b><p>${e === 'por_preparar' ? 'Cuando el equipo envíe un pedido, aparece acá.' : e === 'listo' ? 'Los pedidos preparados se reúnen acá.' : 'Cada pedido avanza con un deslizamiento o un toque.'}</p></div>`}</div></section>`;
      }).join('')}</div><p class="rv-hint">Deslizá una tarjeta hacia la derecha para avanzar. También podés usar sus botones.</p>`;
    if (r._html === html) return;
    r._html = html;
    r.innerHTML = html;
    scrolls.forEach(([col,top]) => { const el = r.querySelector(`[data-col="${col}"]`); if (el) el.scrollTop = top; });
    if (focusKey) [...r.querySelectorAll('[data-rv]')].find(el => el.dataset.id === focusKey.id && el.dataset.rv === focusKey.action && el.dataset.to === focusKey.to)?.focus({preventScroll:true});
    if (!reduced()) r.querySelectorAll('.rv-card').forEach(el => {
      const prev = old.get(el.dataset.id), now = el.getBoundingClientRect();
      if (prev) {
        const x = prev.left-now.left, y = prev.top-now.top;
        if (x || y) el.animate([{transform:`translate(${x}px,${y}px)`,opacity:.75},{transform:'none',opacity:1}],{duration:380,easing:'cubic-bezier(.16,1,.3,1)'});
      } else el.animate([{opacity:0,transform:'translateY(14px)'},{opacity:1,transform:'none'}],{duration:300,easing:'ease-out'});
    });
  }
  async function mover(id, to) {
    const de = etapa(id), fila = S.filas.get(id);
    const generation = S.generation;
    if (!permiso(de,to) || S.busy.has(id) || !S.ready || S.error) return;
    if (!navigator.onLine) { toast('Sin conexión. El pedido no se movió.'); return; }
    S.busy.add(id); pintar();
    try {
      const {data,error} = await sb.rpc('prep_mover',{p_id:id,p_etapa:to,p_version:fila?.version || 0,p_quien:state.who});
      if (error) throw error;
      if (generation !== S.generation) return;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) throw new Error('No llegó la confirmación. Actualizá antes de reintentar.');
      S.filas.set(id,row);
      toast(to === 'por_preparar' && de === 'pendiente' ? 'Enviado a la cola de Mateo' : 'Pedido en ' + etapas[to].toLowerCase());
    } catch (e) { toast(e.message || 'No se pudo mover el pedido.'); }
    finally { if (generation === S.generation) { S.busy.delete(id); pintar(); cargar(); } }
  }
  function clic(e) {
    if (Date.now() < (S.noClickUntil || 0)) { e.preventDefault(); return; }
    const b = e.target.closest('[data-rv]'); if (!b || b.disabled) return;
    if (b.dataset.rv === 'mover') mover(b.dataset.id,b.dataset.to);
    if (b.dataset.rv === 'refresh') cargar();
    if (b.dataset.rv === 'hojas') { S.legacy = true; montar(); renderReparto(); }
    if (b.dataset.rv === 'detalle') {
      const p = S.pedidos.find(x => x.id === b.dataset.id);
      if (p) Preparacion.abrirPedido(p);
    }
  }
  function down(e) {
    const card = e.target.closest('.rv-card');
    if (!card || e.target.closest('button,input,a') || e.button !== 0 || !e.isPrimary || S.busy.has(card.dataset.id)) return;
    const de = etapa(card.dataset.id);
    if (!permiso(de,siguiente[de])) return;
    S.drag = {card,id:card.dataset.id,version:S.filas.get(card.dataset.id)?.version || 0,pointer:e.pointerId,x:e.clientX,y:e.clientY,dx:0,locked:false};
  }
  function move(e) {
    const d = S.drag; if (!d || e.pointerId !== d.pointer) return;
    const dx = e.clientX-d.x, dy = e.clientY-d.y;
    if (!d.locked && Math.abs(dy)>10 && Math.abs(dy)>Math.abs(dx)) { cancel(); return; }
    if (!d.locked && dx>10 && dx>Math.abs(dy)*1.3) {
      d.locked = true; d.card.setPointerCapture(e.pointerId); d.card.classList.add('rv-dragging');
    }
    if (!d.locked) return;
    d.dx = Math.min(Math.max(0,dx),160);
    d.card.style.transform = `translateX(${d.dx}px) rotate(${d.dx/100}deg)`;
    d.card.classList.toggle('rv-armed', d.dx >= 85);
  }
  function up(e) {
    const d = S.drag; if (!d || e.pointerId !== d.pointer) return;
    const commit = d.locked && d.dx >= 85;
    S.noClickUntil = d.locked ? Date.now()+350 : 0;
    cancel();
    if (commit) {
      if (d.version !== (S.filas.get(d.id)?.version || 0)) { toast('El pedido cambió mientras lo movías. Revisá su estado.'); return; }
      mover(d.id,siguiente[etapa(d.id)]);
    }
  }
  function cancel() {
    const d = S.drag; S.drag = null;
    if (d) { d.card.style.transform = ''; d.card.classList.remove('rv-dragging','rv-armed'); }
    if (S.dirty) { S.dirty = false; pintar(); }
  }
  function volver() { S.legacy = false; montar(); renderReparto(); }
  window.addEventListener('online', () => { if (S.canal) cargar(); });
  window.addEventListener('offline', pintar);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.canal) cargar(); });
  window.RepartoVivo = { montar, acceso, volver, refrescar: programar, activo: () => !S.legacy || mateo(), detener };
})();
