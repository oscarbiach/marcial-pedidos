/* WhatsApp → «Oportunidades» (pedido del usuario, 16/10/2026).
   Para un producto (o varios), arma dos listas:
     1) quiénes ya lo compraron: qué productos exactos, cuánto, en cuántos pedidos y cuándo fue la última vez;
     2) quiénes preguntaron, recibieron cotización o se lo ofrecimos por WhatsApp y todavía no lo compraron.
   Cada producto se define con palabras a incluir y frases a excluir (sin importar mayúsculas ni tildes). Las frases
   excluidas se quitan del texto antes de buscar: así «Salame al vacío» no cuenta como Vacío, pero «pulpas, picada,
   vacío» sí. Solo lee: no cambia ningún dato. No usa IA: la zona sale de la característica del número, y el equipo y los
   proveedores se ocultan por nombre (se puede apagar). */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const ico = (n, c) => (window.mIco ? mIco(n, c || 'ico-sm') : '');
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const lista = s => String(s || '').split(',').map(norm).filter(Boolean);
  const fecha = d => d ? new Date(String(d).slice(0, 10) + 'T12:00:00').toLocaleDateString('es-AR') : '-';
  const tel = n => n ? '+' + String(n).replace(/^\+/, '') : '-';

  const PRESETS = [
    { id: 'vacio', nombre: 'Vacío', incluir: 'vacio',
      excluir: 'al vacio, envasado al vacio, envasados al vacio, envasada al vacio, envasadas al vacio, salame de campo vacio' },
    { id: 'picada', nombre: 'Carne picada / Blend La Morena', incluir: 'picada, blend, carne hamburguesa, hamburguesa la morena, la morena',
      excluir: 'picada clasica, picada grande clasica, picada mundialista, picada comun y picada economica, asado - la morena, magron la morena, vacio la morena' },
  ];
  // Equipo y proveedores (se ocultan por nombre de agenda) y mensajes internos (hojas de reparto, listas de entregas).
  const NO_CLIENTE = /vendedor|proveedor|comercial|\(carnes\)/i;
  const INTERNO = /hoja de reparto|=== entregas ===|=== total a cargar/i;
  const S = { busy: false, gen: 0, ultimo: null };

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
  function esEquipo(c) {
    const n = String((c && c.display_name) || '').trim();
    if (NO_CLIENTE.test(n)) return true;
    const vend = typeof VENDEDORES !== 'undefined' ? VENDEDORES : [];
    return vend.some(v => norm(n) === norm(v) || norm(n).startsWith(norm(v) + ' '));
  }

  async function buscar() {
    if (S.busy) return;
    const grupos = leerGrupos();
    if (!grupos.length) { aviso('Elegí al menos un producto o escribí palabras para buscar.', true); return; }
    const prefijos = lista($('op-zona').value).map(p => p.replace(/\D/g, '')).filter(Boolean);
    const dias = Number($('op-periodo').value) || 0;
    const desde = dias ? new Date(Date.now() - dias * 86400000).toISOString().slice(0, 10) : '';
    const ocultar = $('op-ocultar').checked;
    const gen = ++S.gen;
    S.busy = true; $('op-buscar').disabled = true; aviso('Buscando en pedidos y chats…');
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
      compradores.forEach(c => { c.tels = []; c.msg = null; });
      contactos.forEach(x => { const c = x.linked_client_name && nombreComprador.get(norm(x.linked_client_name)); if (c && x.phone_number && !c.tels.includes(x.phone_number)) c.tels.push(x.phone_number); });
      const interesados = [];
      let ocultos = 0, fuera = 0;
      porContacto.forEach(c => {
        const x = ck.get(c.key) || {};
        const comprador = x.linked_client_name && nombreComprador.get(norm(x.linked_client_name));
        if (comprador) { const m = c.entrada || c.salida; if (m && (!comprador.msg || m.occurred_at > comprador.msg.occurred_at)) comprador.msg = m; return; }
        if (ocultar && esEquipo(x)) { ocultos++; return; }
        if (!enZona(x.phone_number, prefijos)) { fuera++; return; }
        Object.assign(c, { contacto: x });
        interesados.push(c);
      });
      compradores.sort((a, b) => b.ultima.localeCompare(a.ultima));
      interesados.sort((a, b) => String(b.ultimo).localeCompare(String(a.ultimo)));
      S.ultimo = { grupos, compradores, interesados };
      dibujar(grupos, compradores, interesados);
      aviso(`${compradores.length} ${compradores.length === 1 ? 'cliente compró' : 'clientes compraron'} · ${interesados.length} ${interesados.length === 1 ? 'interesado' : 'interesados'} sin compra` +
        (ocultos ? ` · ${ocultos} del equipo o proveedores ocultos` : '') + (fuera ? ` · ${fuera} fuera de la zona` : '') + '.');
    } catch (e) {
      aviso('No se pudo buscar: ' + (e.message || e), true);
    } finally { S.busy = false; const b = $('op-buscar'); if (b) b.disabled = false; }
  }

  function queCompro(c, grupos) {
    if (grupos.length > 1 && grupos.every(g => c.grupos.has(g.nombre))) return 'Ambos' + (grupos.length > 2 ? ' / todos' : '');
    return 'Solo ' + [...c.grupos].join(' + ');
  }
  function estado(c) {
    const x = c.contacto || {};
    if (c.entrada && !(x.last_outbound_at && x.last_outbound_at > c.entrada.occurred_at)) return ['Preguntó: no hay respuesta nuestra', 'error'];
    if (c.entrada) return ['Respondido o cotizado: seguir', 'aviso'];
    return ['Le ofrecimos: esperar respuesta', 'gris'];
  }
  const extracto = m => m ? String(m.content).replace(/\s+/g, ' ').slice(0, 180) : '';

  function dibujar(grupos, compradores, interesados) {
    const t1 = compradores.map(c => `<tr>
      <td><b>${esc(c.cliente)}</b></td>
      <td>${c.tels.length ? c.tels.map(t => esc(tel(t))).join('<br>') : '-'}<br><span class="op-sub">${esc(c.direccion || '-')}</span></td>
      <td>${esc(queCompro(c, grupos))}</td>
      <td>${[...c.prods].sort((a, b) => b[1].cant - a[1].cant).map(([n, p]) => esc(n) + ' ×' + esc(String(Math.round(p.cant * 100) / 100).replace('.', ','))).join('; ')}</td>
      <td>${c.pedidos.size} · ${esc(fecha(c.ultima))}</td>
      <td>${c.msg ? `<span class="op-sub">${esc(fecha(c.msg.occurred_at))}:</span> «${esc(extracto(c.msg))}»` : '-'}</td></tr>`).join('');
    const t2 = interesados.map(c => {
      const x = c.contacto || {}, [txt, tono] = estado(c), m = c.entrada || c.salida;
      const nombre = x.linked_client_name || x.display_name || 'Sin nombre';
      return `<tr>
      <td><b>${esc(nombre)}</b><br><span class="op-sub">${esc(tel(x.phone_number))}</span></td>
      <td>${esc(fecha(c.ultimo))}</td>
      <td>${esc([...c.grupos].join(' + '))}</td>
      <td>${m ? `${c.entrada ? '' : '<span class="op-sub">Nosotros:</span> '}«${esc(extracto(m))}»` : '-'}</td>
      <td><span class="wa-pill wa-t-${tono}">${esc(txt)}</span></td>
      <td><button type="button" class="wa-btn op-chat" data-op-chat="${esc(c.key)}" data-op-tel="${esc(x.phone_number || '')}">${ico('message-circle')}Abrir chat</button></td></tr>`;
    }).join('');
    $('op-resultado').innerHTML = `
      <div class="op-tabla-cab"><h4>Clientes que ya compraron <span class="op-n">${compradores.length}</span></h4>
        <button type="button" class="wa-btn" data-op-copiar="1">${ico('copy')}Copiar</button></div>
      ${compradores.length ? `<div class="op-scroll"><table class="op-tabla"><thead><tr><th>Cliente</th><th>Teléfono · Dirección</th><th>Qué compró</th><th>Productos y cantidades</th><th>Pedidos · Última</th><th>Último mensaje del tema</th></tr></thead><tbody>${t1}</tbody></table></div>`
        : '<p class="wa-empty">Nadie compró estos productos en el período elegido.</p>'}
      <div class="op-tabla-cab"><h4>Interesados sin compra <span class="op-n">${interesados.length}</span></h4>
        <button type="button" class="wa-btn" data-op-copiar="2">${ico('copy')}Copiar</button></div>
      ${interesados.length ? `<div class="op-scroll"><table class="op-tabla"><thead><tr><th>Contacto</th><th>Último contacto</th><th>Producto</th><th>Mensaje</th><th>Estado</th><th></th></tr></thead><tbody>${t2}</tbody></table></div>`
        : '<p class="wa-empty">No hay consultas ni cotizaciones sin compra en el período elegido.</p>'}
      <p class="op-nota">Solo lee los datos: no cambia nada. Los chats guardados en la app empiezan el 28/09/2026. Para afinar la búsqueda, cambiá las palabras a incluir o excluir.</p>`;
  }

  // Texto para pegar en WhatsApp o en una planilla (columnas separadas por tabulación).
  function textoTabla(n) {
    const r = S.ultimo; if (!r) return '';
    if (n === '1') return ['Cliente\tTeléfono\tDirección\tQué compró\tProductos\tPedidos\tÚltima compra']
      .concat(r.compradores.map(c => [c.cliente, c.tels.map(tel).join(' / ') || '-', c.direccion || '-', queCompro(c, r.grupos),
        [...c.prods].map(([nn, p]) => nn + ' x' + Math.round(p.cant * 100) / 100).join('; '), c.pedidos.size, fecha(c.ultima)].join('\t'))).join('\n');
    return ['Contacto\tTeléfono\tÚltimo contacto\tProducto\tMensaje\tEstado']
      .concat(r.interesados.map(c => { const x = c.contacto || {}; return [x.linked_client_name || x.display_name || 'Sin nombre', tel(x.phone_number), fecha(c.ultimo),
        [...c.grupos].join(' + '), extracto(c.entrada || c.salida), estado(c)[0]].join('\t'); })).join('\n');
  }
  async function copiar(n) {
    const t = textoTabla(n);
    try { await navigator.clipboard.writeText(t); aviso('Copiado: pegalo en WhatsApp o en una planilla.'); }
    catch (e) { const a = document.createElement('textarea'); a.value = t; document.body.appendChild(a); a.select(); document.execCommand('copy'); a.remove(); aviso('Copiado.'); }
  }

  function leerGrupos() {
    const gs = PRESETS.filter(p => $('op-p-' + p.id).checked).map(p => ({ nombre: p.nombre, incluir: lista($('op-in-' + p.id).value), excluir: lista($('op-ex-' + p.id).value) }));
    const otro = lista($('op-in-otro').value);
    if (otro.length) gs.push({ nombre: $('op-in-otro').value.split(',')[0].trim() || 'Otro', incluir: otro, excluir: lista($('op-ex-otro').value) });
    return gs.filter(g => g.incluir.length);
  }
  function aviso(t, error) { const p = $('op-aviso'); if (p) { p.textContent = t || ''; p.classList.toggle('wa-error', !!error); } }

  function abrir() {
    const panel = $('wa-oport-panel'); if (!panel) return;
    if (!panel.dataset.listo) {
      panel.dataset.listo = '1';
      panel.innerHTML = `<div class="wa-review-top"><h3>${ico('search')} Oportunidades</h3><button type="button" id="op-cerrar">Volver a conversaciones</button></div>
        <p class="wa-help">Quién compró un producto y quién preguntó o recibió cotización por WhatsApp sin comprarlo todavía.</p>
        <div class="op-grupos">
          ${PRESETS.map(p => `<fieldset class="op-grupo"><legend><label><input type="checkbox" id="op-p-${p.id}" checked> ${esc(p.nombre)}</label></legend>
            <label>Incluir<input id="op-in-${p.id}" value="${esc(p.incluir)}"></label>
            <label>Excluir<input id="op-ex-${p.id}" value="${esc(p.excluir)}"></label></fieldset>`).join('')}
          <fieldset class="op-grupo"><legend>Otro producto (opcional)</legend>
            <label>Incluir<input id="op-in-otro" placeholder="Ej.: muzzarella, muzza"></label>
            <label>Excluir<input id="op-ex-otro" placeholder="Frases a no contar"></label></fieldset>
        </div>
        <div class="op-filtros">
          <label>Zona (características)<input id="op-zona" value="342, 3404, 3496, 3497" title="Vacío = todas las zonas. Los que ya compraron se cuentan siempre."></label>
          <label>Período<select id="op-periodo"><option value="0">Todo el historial</option><option value="90">Últimos 90 días</option><option value="30">Últimos 30 días</option></select></label>
          <label class="op-check"><input type="checkbox" id="op-ocultar" checked> Ocultar equipo, proveedores y hojas de reparto</label>
          <button type="button" class="wa-btn wa-btn--prim" id="op-buscar">${ico('search')}Buscar</button>
        </div>
        <p id="op-aviso" class="op-aviso" role="status" aria-live="polite"></p>
        <div id="op-resultado"></div>`;
      $('op-cerrar').onclick = cerrar;
      $('op-buscar').onclick = () => buscar();
      panel.addEventListener('click', e => {
        const b = e.target.closest('[data-op-copiar]'); if (b) { copiar(b.dataset.opCopiar); return; }
        const ch = e.target.closest('[data-op-chat]');
        if (ch && window.WhatsAppUI && WhatsAppUI.abrirContacto) { cerrar(); WhatsAppUI.abrirContacto(ch.dataset.opChat, ch.dataset.opTel); }
      });
    }
    panel.hidden = false; $('wa-layout').hidden = true;
    const r = $('wa-review-panel'); if (r) r.hidden = true;
  }
  function cerrar() { S.gen++; const p = $('wa-oport-panel'); if (p) p.hidden = true; $('wa-layout').hidden = false; }

  window.WhatsAppOportunidades = { abrir, cerrar, buscar, _gruposDe: gruposDe, PRESETS };
})();
