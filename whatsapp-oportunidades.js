/* WhatsApp → «Oportunidades» (pedido del usuario, 16/10/2026).
   Para cualquier producto que se escriba (o varios, para compararlos), arma las listas:
     1) quiénes ya lo compraron: qué productos exactos, cuánto, en cuántos pedidos y cuándo fue la última vez;
     2) quiénes preguntaron, recibieron cotización o se lo ofrecimos por WhatsApp y todavía no lo compraron.
   Cada producto se define con palabras a incluir y frases a excluir (sin importar mayúsculas ni tildes). Las frases
   excluidas se quitan del texto antes de buscar: así «Salame al vacío» no cuenta como Vacío, pero «pulpas, picada,
   vacío» sí. Solo lee: no cambia ningún dato. No usa IA: la zona sale de la característica del número.
   No oculta a nadie por nombre (pedido del usuario); solo descarta las hojas de reparto. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const ico = (n, c) => (window.mIco ? mIco(n, c || 'ico-sm') : '');
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const lista = s => String(s || '').split(',').map(norm).filter(Boolean);
  const fecha = d => d ? new Date(String(d).slice(0, 10) + 'T12:00:00').toLocaleDateString('es-AR') : '-';
  const tel = n => n ? '+' + String(n).replace(/^\+/, '') : '-';

  // Frases que se descartan solas al agregar ciertos productos (se pueden cambiar en «Ajustar búsqueda»).
  const NO_CONTAR = {
    vacio: 'al vacio, envasado al vacio, envasados al vacio, envasada al vacio, envasadas al vacio, salame de campo vacio',
    picada: 'picada clasica, picada grande clasica, picada mundialista, picada comun y picada economica',
  };
  const CLAVE = 'dm_op_productos';
  // Mensajes internos (hojas de reparto, listas de entregas): no son interés de nadie. A las personas no se las oculta (pedido del usuario).
  const INTERNO = /hoja de reparto|=== entregas ===|=== total a cargar/i;
  const S = { busy: false, gen: 0, ultimo: null, prods: [] };

  // ── Datos: Supabase de verdad o el modo prueba (sin red) ──
  const prueba = () => window.WhatsAppPrueba && window.WhatsAppPrueba.todo;
  // Patrón amplio para el servidor: la palabra más larga de cada frase, con las vocales comodín (acepta tildes).
  const patrones = grupos => [...new Set(grupos.flatMap(g => g.incluir.map(f => f.split(' ').sort((a, b) => b.length - a.length)[0])))]
    .filter(p => p.length >= 3).map(p => p.replace(/[aeiou]/g, '_').replace(/[,()"*\\]/g, ''));
  async function paginado(armar, tope = 6000) {
    const filas = [];
    for (let desde = 0; desde < tope; desde += 1000) {
      const { data, error } = await armar().range(desde, desde + 999);
      if (error) throw error;
      filas.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    return filas;
  }
  async function traerItems(grupos) {
    if (prueba()) {
      const d = typeof sandboxLeerDatos === 'function' ? sandboxLeerDatos() : { pedidos: [] };
      return d.pedidos.flatMap(p => (p.pedido_items || []).map(i => ({ producto: i.producto, cantidad: i.cantidad,
        pedidos: { id: p.id, cliente: p.cliente, fecha: p.fecha, estado: p.estado, eliminado_en: p.eliminado_en, direccion: p.direccion } })));
    }
    const or = patrones(grupos).map(p => `producto.ilike.*${p}*`).join(',');
    if (!or) return [];
    return paginado(() => sb.from('pedido_items').select('producto,cantidad,pedidos!inner(id,cliente,fecha,estado,eliminado_en,direccion)').or(or).order('id'));
  }
  async function traerMensajes(grupos) {
    if (prueba()) return window.WhatsAppPrueba.todo().mensajes;
    const or = patrones(grupos).map(p => `content.ilike.*${p}*`).join(',');
    if (!or) return [];
    return paginado(() => sb.from('whatsapp_messages').select('contact_key,direction,occurred_at,content').or(or).order('occurred_at', { ascending: false }));
  }
  async function traerContactos(keys, clientes) {
    if (prueba()) return window.WhatsAppPrueba.todo().contactos;
    const campos = 'contact_key,display_name,phone_number,linked_client_name,last_inbound_at,last_outbound_at';
    const out = [];
    for (let i = 0; i < keys.length; i += 150) {
      const { data, error } = await sb.from('whatsapp_contacts').select(campos).in('contact_key', keys.slice(i, i + 150));
      if (error) throw error; out.push(...(data || []));
    }
    for (let i = 0; i < clientes.length; i += 150) {
      const { data, error } = await sb.from('whatsapp_contacts').select(campos).in('linked_client_name', clientes.slice(i, i + 150));
      if (error) throw error; out.push(...(data || []));
    }
    return out;
  }

  // ── Coincidencias ──
  // Devuelve los grupos que nombra un texto (después de quitar las frases excluidas de cada grupo).
  function gruposDe(texto, grupos) {
    const t0 = ' ' + norm(texto) + ' ';
    return grupos.filter(g => {
      let t = t0;
      g.excluir.forEach(x => { t = t.split(x).join(' '); });
      return g.incluir.some(f => t.includes(f));
    });
  }
  const enZona = (phone, prefijos) => !prefijos.length || !phone || prefijos.some(p => String(phone).replace(/^\+/, '').startsWith('549' + p));

  async function buscar() {
    const grupos = leerGrupos();
    if (!grupos.length) { S.gen++; S.busy = false; S.ultimo = null; $('op-resultado').removeAttribute('aria-busy'); $('op-resultado').innerHTML = '<p class="op-vacio">Escribí un producto arriba (por ejemplo: vacío, muzzarella, salame) y tocá «Agregar». Podés sumar varios para compararlos.</p>'; aviso(''); return; }
    const prefijos = $('op-zona-modo').value === 'sf' ? lista($('op-zona').value).map(p => p.replace(/\D/g, '')).filter(Boolean) : [];
    const dias = Number($('op-periodo').value) || 0;
    const desde = dias ? new Date(Date.now() - dias * 86400000).toISOString().slice(0, 10) : '';
    const gen = ++S.gen;
    S.busy = true; $('op-resultado').setAttribute('aria-busy', 'true'); aviso('Buscando en pedidos y chats…');
    try {
      const [items, msgs] = await Promise.all([traerItems(grupos), traerMensajes(grupos)]);
      if (gen !== S.gen) return;
      // 1) Compras
      const porCliente = new Map();
      items.forEach(it => {
        const p = it.pedidos || {};
        if (p.eliminado_en || p.estado === 'Cancelado' || !p.cliente) return;
        if (desde && String(p.fecha).slice(0, 10) < desde) return;
        const gs = gruposDe(it.producto, grupos); if (!gs.length) return;
        const k = norm(p.cliente);
        const c = porCliente.get(k) || { cliente: p.cliente, direccion: '', grupos: new Set(), prods: new Map(), pedidos: new Set(), ultima: '' };
        gs.forEach(g => c.grupos.add(g.nombre));
        const pr = c.prods.get(it.producto) || { cant: 0, ped: new Set() };
        pr.cant += Number(it.cantidad) || 0; pr.ped.add(p.id); c.prods.set(it.producto, pr);
        c.pedidos.add(p.id);
        if (String(p.fecha) > c.ultima) { c.ultima = String(p.fecha).slice(0, 10); if (p.direccion) c.direccion = p.direccion; }
        if (!c.direccion && p.direccion) c.direccion = p.direccion;
        porCliente.set(k, c);
      });
      // 2) Mensajes que nombran el producto (sin los internos)
      const porContacto = new Map();
      msgs.forEach(m => {
        if (!m.content || INTERNO.test(m.content)) return;
        if (desde && String(m.occurred_at).slice(0, 10) < desde) return;
        const gs = gruposDe(m.content, grupos); if (!gs.length) return;
        const c = porContacto.get(m.contact_key) || { key: m.contact_key, grupos: new Set(), ultimo: '', entrada: null, salida: null };
        gs.forEach(g => c.grupos.add(g.nombre));
        if (m.occurred_at > c.ultimo) c.ultimo = m.occurred_at;
        const lado = m.direction === 'inbound' ? 'entrada' : 'salida';
        if (!c[lado] || m.occurred_at > c[lado].occurred_at) c[lado] = m;
        porContacto.set(m.contact_key, c);
      });
      const contactos = await traerContactos([...porContacto.keys()], [...porCliente.values()].map(c => c.cliente));
      if (gen !== S.gen) return;
      const ck = new Map(contactos.map(c => [c.contact_key, c]));
      // Teléfonos y mensajes de los compradores (por cliente vinculado)
      const compradores = [...porCliente.values()];
      const nombreComprador = new Map(compradores.map(c => [norm(c.cliente), c]));
      compradores.forEach(c => { c.tels = []; c.key = ''; c.msg = null; });
      contactos.forEach(x => {
        const c = x.linked_client_name && nombreComprador.get(norm(x.linked_client_name));
        if (c && x.phone_number && !c.tels.includes(x.phone_number)) { c.tels.push(x.phone_number); if (!c.key) c.key = x.contact_key; }
      });
      const interesados = [];
      let fuera = 0;
      porContacto.forEach(c => {
        const x = ck.get(c.key) || {};
        const comprador = x.linked_client_name && nombreComprador.get(norm(x.linked_client_name));
        if (comprador) { const m = c.entrada || c.salida; if (m && (!comprador.msg || m.occurred_at > comprador.msg.occurred_at)) comprador.msg = m; return; }
        if (!enZona(x.phone_number, prefijos)) { fuera++; return; }
        c.contacto = x; c.estado = estado(c);
        interesados.push(c);
      });
      compradores.sort((a, b) => b.ultima.localeCompare(a.ultima));
      interesados.sort((a, b) => String(b.ultimo).localeCompare(String(a.ultimo)));
      const listas = {
        responder: interesados.filter(c => c.estado.id === 'responder'),
        seguir: interesados.filter(c => c.estado.id !== 'responder'),
        compraron: compradores,
      };
      if (!S.tab || !listas[S.tab].length) S.tab = TABS.find(t => listas[t.id].length)?.id || 'responder';
      S.ultimo = { grupos, listas };
      dibujar();
      aviso(fuera ? `No se muestran ${fuera} ${fuera === 1 ? 'contacto' : 'contactos'} de fuera de la zona.` : '');
    } catch (e) {
      if (gen === S.gen) aviso('No se pudo buscar: ' + (e.message || e), true);
    } finally { if (gen === S.gen) { S.busy = false; $('op-resultado')?.removeAttribute('aria-busy'); } }
  }

  // Interesados: «responder» si lo último sobre el tema fue una consulta suya y después no le escribimos.
  function estado(c) {
    const x = c.contacto || {};
    if (c.entrada && !(x.last_outbound_at && x.last_outbound_at > c.entrada.occurred_at)) return { id: 'responder', txt: 'Sin respuesta nuestra' };
    if (c.entrada) return { id: 'respondido', txt: 'Le respondimos' };
    return { id: 'ofrecido', txt: 'Le ofrecimos' };
  }
  const TABS = [
    { id: 'responder', nombre: 'Sin respuesta nuestra', tono: 'error', desc: 'Preguntaron por el producto y todavía no les contestamos.' },
    { id: 'seguir', nombre: 'Para seguir', tono: '', desc: 'Ya les respondimos o les ofrecimos, pero no compraron.' },
    { id: 'compraron', nombre: 'Ya compraron', tono: 'ok', desc: 'Clientes con pedidos de este producto (sin contar cancelados).' },
  ];
  const extracto = m => m ? String(m.content).replace(/\s+/g, ' ').slice(0, 160) : '';
  const cant = n => String(Math.round(n * 100) / 100).replace('.', ',');
  const pills = (set, grupos) => [...set].map(n => `<span class="wa-pill wa-t-${grupos.findIndex(g => g.nombre === n) % 2 ? 'info' : 'marca'}">${esc(n)}</span>`).join(' ');
  const botonChat = (key, telefono) => key ? `<button type="button" class="wa-btn op-chat" data-op-chat="${esc(key)}" data-op-tel="${esc(telefono || '')}">${ico('message-circle')}Abrir chat</button>` : '';

  function dibujar() {
    const r = S.ultimo; if (!r) return;
    const { grupos, listas } = r, tab = TABS.find(t => t.id === S.tab);
    const filas = listas[S.tab];
    let cuerpo;
    if (!filas.length) cuerpo = `<p class="wa-empty">${S.tab === 'compraron' ? 'Nadie compró estos productos en el período elegido.' : 'No hay nadie en esta lista.'}</p>`;
    else if (S.tab === 'compraron') cuerpo = `<table class="op-tabla"><thead><tr><th>Cliente</th><th>Compró</th><th>Detalle</th><th>Última compra</th><th><span class="op-sr">Acción</span></th></tr></thead><tbody>${filas.map(c => `<tr>
      <td><b>${esc(c.cliente)}</b><span class="op-sub">${c.tels.length ? c.tels.map(t => esc(tel(t))).join(' · ') : 'Sin WhatsApp vinculado'}</span></td>
      <td>${pills(c.grupos, grupos)}</td>
      <td>${[...c.prods].sort((a, b) => b[1].cant - a[1].cant).map(([n, p]) => `<span class="op-prod">${esc(n)} <b>×${esc(cant(p.cant))}</b></span>`).join('')}</td>
      <td>${esc(fecha(c.ultima))}<span class="op-sub">${c.pedidos.size} ${c.pedidos.size === 1 ? 'pedido' : 'pedidos'}</span></td>
      <td class="op-acc">${botonChat(c.key, c.tels[0])}</td></tr>`).join('')}</tbody></table>`;
    else cuerpo = `<table class="op-tabla"><thead><tr><th>Contacto</th><th>Producto</th><th>Último mensaje sobre el tema</th><th><span class="op-sr">Acción</span></th></tr></thead><tbody>${filas.map(c => {
      const x = c.contacto || {}, m = c.entrada || c.salida;
      return `<tr>
      <td><b>${esc(x.linked_client_name || x.display_name || 'Sin nombre')}</b><span class="op-sub">${esc(tel(x.phone_number))}</span></td>
      <td>${pills(c.grupos, grupos)}</td>
      <td><span class="op-sub op-cuando">${esc(fecha(c.ultimo))}${S.tab === 'seguir' ? ' · ' + esc(c.estado.txt) : ''}</span>${m ? `${c.entrada ? '' : '<b>Nosotros:</b> '}«${esc(extracto(m))}»` : '-'}</td>
      <td class="op-acc">${botonChat(c.key, x.phone_number)}</td></tr>`; }).join('')}</tbody></table>`;
    $('op-resultado').innerHTML = `
      <div class="op-tabs" role="tablist" aria-label="Listas">
        ${TABS.map(t => `<button type="button" role="tab" class="wa-chip${t.tono ? ' wa-chip--' + t.tono : ''}" data-op-tab="${t.id}" aria-selected="${t.id === S.tab}" aria-pressed="${t.id === S.tab}">${esc(t.nombre)} <span class="wa-chip-n">${listas[t.id].length}</span></button>`).join('')}
        ${filas.length ? `<button type="button" class="wa-btn op-copiar" data-op-copiar="${S.tab}">${ico('copy')}Copiar lista</button>` : ''}
      </div>
      <p class="op-desc">${esc(tab.desc)}</p>
      <div class="op-scroll" role="tabpanel">${cuerpo}</div>`;
  }

  // Texto para pegar en WhatsApp o en una planilla (columnas separadas por tabulación).
  function textoTabla(id) {
    const r = S.ultimo; if (!r) return '';
    if (id === 'compraron') return ['Cliente\tTeléfono\tDirección\tCompró\tProductos\tPedidos\tÚltima compra']
      .concat(r.listas.compraron.map(c => [c.cliente, c.tels.map(tel).join(' / ') || '-', c.direccion || '-', [...c.grupos].join(' + '),
        [...c.prods].map(([nn, p]) => nn + ' x' + cant(p.cant)).join('; '), c.pedidos.size, fecha(c.ultima)].join('\t'))).join('\n');
    return ['Contacto\tTeléfono\tÚltimo contacto\tProducto\tMensaje\tEstado']
      .concat((r.listas[id] || []).map(c => { const x = c.contacto || {}; return [x.linked_client_name || x.display_name || 'Sin nombre', tel(x.phone_number), fecha(c.ultimo),
        [...c.grupos].join(' + '), extracto(c.entrada || c.salida), c.estado.txt].join('\t'); })).join('\n');
  }
  async function copiar(id) {
    const t = textoTabla(id);
    try { await navigator.clipboard.writeText(t); aviso('Lista copiada: pegala en WhatsApp o en una planilla.'); }
    catch (e) { const a = document.createElement('textarea'); a.value = t; document.body.appendChild(a); a.select(); document.execCommand('copy'); a.remove(); aviso('Lista copiada.'); }
  }

  function leerGrupos() {
    return S.prods.map(p => ({ nombre: p.nombre, incluir: lista(p.incluir), excluir: lista(p.excluir) })).filter(g => g.incluir.length);
  }
  function guardarProds() { try { localStorage.setItem(CLAVE, JSON.stringify(S.prods)); } catch (e) { /* sin almacenamiento: solo en memoria */ } }
  function agregarProducto() {
    const inp = $('op-producto'), txt = inp.value.trim(); if (!txt) { inp.focus(); return; }
    const n0 = txt.split(',')[0].trim(), nombre = n0.charAt(0).toUpperCase() + n0.slice(1), k = norm(nombre);
    if (!S.prods.some(p => norm(p.nombre) === k)) S.prods.push({ nombre, incluir: txt, excluir: NO_CONTAR[k.split(' ')[0]] || '' });
    inp.value = ''; productosCambiaron();
  }
  function productosCambiaron() {
    guardarProds();
    $('op-chips').innerHTML = S.prods.map((p, i) => `<span class="op-tag">${esc(p.nombre)}<button type="button" data-op-quitar="${i}" aria-label="Quitar ${esc(p.nombre)}">×</button></span>`).join('');
    $('op-ajustes-prods').innerHTML = S.prods.map((p, i) => `<fieldset class="op-grupo"><legend>${esc(p.nombre)}</legend>
      <label>Buscar (variantes separadas por coma)<input data-op-campo="incluir" data-i="${i}" value="${esc(p.incluir)}"></label>
      <label>No contar<input data-op-campo="excluir" data-i="${i}" value="${esc(p.excluir)}" placeholder="Ej.: salame al vacío"></label></fieldset>`).join('');
    buscar();
  }
  function aviso(t, error) { const p = $('op-aviso'); if (p) { p.textContent = t || ''; p.classList.toggle('wa-error', !!error); } }

  function abrir() {
    const panel = $('wa-oport-panel'); if (!panel) return;
    if (!panel.dataset.listo) {
      panel.dataset.listo = '1';
      panel.innerHTML = `<div class="wa-review-top"><h3>${ico('search')} Oportunidades</h3><button type="button" id="op-cerrar">Volver a conversaciones</button></div>
        <p class="wa-help">Quién compró un producto y quién lo consultó por WhatsApp sin comprarlo.</p>
        <div class="op-barra">
          <div class="op-campo"><label class="op-et" for="op-producto">Producto</label>
            <div class="op-prods">
              <input id="op-producto" class="op-otro" placeholder="Escribí un producto…" autocomplete="off" enterkeyhint="search">
              <button type="button" class="wa-btn wa-btn--prim" id="op-agregar">${ico('search')}Agregar</button>
              <div id="op-chips" class="op-chips" aria-live="polite"></div>
            </div></div>
          <label class="op-campo"><span class="op-et">Zona</span><select id="op-zona-modo"><option value="sf">Santa Fe y alrededores</option><option value="">Todas</option></select></label>
          <label class="op-campo"><span class="op-et">Período</span><select id="op-periodo"><option value="0">Todo</option><option value="90">Últimos 90 días</option><option value="30">Últimos 30 días</option></select></label>
        </div>
        <details class="op-ajustes"><summary>Ajustar búsqueda</summary>
          <p class="op-sub">Sin importar tildes ni mayúsculas. «Buscar» acepta variantes (muzza, muzzarella); «No contar» descarta frases (salame al vacío).</p>
          <div class="op-grupos"><div id="op-ajustes-prods" class="op-grupos-in"></div>
            <fieldset class="op-grupo"><legend>Zona</legend>
              <label>Características de «Santa Fe y alrededores»<input id="op-zona" value="342, 3496"></label>
              <span class="op-sub">342: Santa Fe, Santo Tomé y Recreo · 3496: Esperanza.</span></fieldset>
          </div>
          <p class="op-sub">Los que ya compraron se muestran siempre, sin importar la zona. Los chats guardados empiezan el 28/09/2026. Solo lee: no cambia ningún dato.</p>
        </details>
        <p id="op-aviso" class="op-aviso" role="status" aria-live="polite"></p>
        <div id="op-resultado"></div>`;
      $('op-cerrar').onclick = cerrar;
      panel.addEventListener('click', e => {
        if (e.target.closest('#op-agregar')) { agregarProducto(); return; }
        const q = e.target.closest('[data-op-quitar]'); if (q) { S.prods.splice(Number(q.dataset.opQuitar), 1); productosCambiaron(); $('op-producto').focus(); return; }
        const t = e.target.closest('[data-op-tab]'); if (t) { S.tab = t.dataset.opTab; dibujar(); panel.querySelector(`[data-op-tab="${S.tab}"]`)?.focus(); return; }
        const b = e.target.closest('[data-op-copiar]'); if (b) { copiar(b.dataset.opCopiar); return; }
        const ch = e.target.closest('[data-op-chat]');
        if (ch && window.WhatsAppUI && WhatsAppUI.abrirContacto) { cerrar(); WhatsAppUI.abrirContacto(ch.dataset.opChat, ch.dataset.opTel); }
      });
      // Cualquier cambio de filtro vuelve a buscar (los textos, al salir del campo o con Enter).
      panel.addEventListener('change', e => {
        const c = e.target.closest('[data-op-campo]');
        if (c) { const pr = S.prods[Number(c.dataset.i)]; if (pr) { pr[c.dataset.opCampo] = c.value; guardarProds(); } buscar(); return; }
        if (e.target.id !== 'op-producto' && e.target.closest('.op-barra, .op-ajustes')) buscar();
      });
      $('op-producto').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); agregarProducto(); } });
      try { S.prods = (JSON.parse(localStorage.getItem(CLAVE)) || []).filter(p => p && p.nombre); } catch (e) { S.prods = []; }
      productosCambiaron();
    }
    panel.hidden = false; $('wa-layout').hidden = true;
    const r = $('wa-review-panel'); if (r) r.hidden = true;
    if (!S.ultimo && !S.busy && S.prods.length) buscar();
    if (!S.prods.length) $('op-producto').focus();
  }
  function cerrar() { S.gen++; S.busy = false; const p = $('wa-oport-panel'); if (p) p.hidden = true; $('wa-layout').hidden = false; }

  window.WhatsAppOportunidades = { abrir, cerrar, buscar, _gruposDe: gruposDe, NO_CONTAR };
})();
