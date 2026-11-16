/* Preparación de pedidos en el depósito (pedido de Oscar, 13/11/2026).
   Sigue el cartel pegado en el depósito, sobre una hoja de reparto guardada (la «tanda»):
     1 Juntar   — el total de cada producto de la tanda, separado en FRÍO y SECO. Se tilda lo juntado y se marca lo que falta.
     2 Separar  — cliente por cliente: se tilda cada renglón; lo que se pesa lleva el peso y una FOTO
                  (la app le escribe encima cliente, producto y peso, para que quien hace el remito controle que es lo correcto).
     3 Remitos  — quien hace los remitos ve, por cliente, cantidades, pesos y fotos; marca «Remito hecho» y «Controlado».
     4 Cargar   — el repartidor tilda cada cliente que sube a la camioneta. Con todo cargado, «Salió la camioneta»
                  abre el checklist de despacho de siempre con los faltantes ya cargados (despacha y arma las reposiciones).
   Pensado para usarse en un iPad apaisado (botones grandes). Datos: prep_productos, prep_items, prep_pedidos y el bucket
   «preparacion» (supabase/migrations/20261113_preparacion.sql). No modifica pedidos hasta el despacho.
   RepartoVivo avisa cambios en tiempo real; el temporizador recupera eventos perdidos. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const quien = () => (typeof state !== 'undefined' && state.who) || '—';
  const num = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : null; };
  const fmtKg = n => (Math.round(n * 1000) / 1000).toLocaleString('es-AR', { maximumFractionDigits: 3 });
  const fecha = f => (typeof fmtDate === 'function' ? fmtDate(f) : f);
  const cant = it => (typeof repCantidad === 'function' ? repCantidad(it) : it.qty + 'u');
  const tags = it => (typeof repTagsTexto === 'function' ? repTagsTexto(it) : '');
  const aviso = m => (typeof toast === 'function' ? toast(m) : alert(m));

  const S = {
    hoja: null, pedidos: [], items: new Map(), peds: new Map(), prods: new Map(),
    paso: 'juntar', abierto: false, timer: null, fotos: new Map(), cargando: false, error: '',
    pedidoId: null, revision: 0, pendiente: false, guardando: new Set()
  };

  // ── Datos ──────────────────────────────────────────────────────────
  async function cargar() {
    if (!S.hoja || !S.abierto) return;
    if (S.cargando || S.guardando.size || esEditando()) { S.pendiente = true; return; }
    S.cargando = true;
    S.pendiente = false;
    const revision = S.revision;
    try {
      const { data: hp, error: e1 } = S.pedidoId ? {data:[{pedido_id:S.pedidoId}]} : await sb.from('hoja_reparto_pedidos').select('pedido_id,orden').eq('hoja_id', S.hoja.id).order('orden');
      if (e1) throw e1;
      const ids = (hp || []).map(x => x.pedido_id);
      // Los pedidos salen del estado de la app; si alguno no está (ya despachado y viejo), se pide aparte.
      const enEstado = new Map((state.pedidos || []).map(p => [p.id, p]));
      const faltan = ids;
      if (faltan.length && typeof mapPedido_ === 'function') {
        const { data, error } = await sb.from('pedidos')
          .select('id,fecha,quien,cliente,fecha_entrega,direccion,notas,estado,fecha_despacho,retiro,remito_hecho,pedido_items(id,producto,cantidad,fetear,sin_cuero,en_unidades,medida,orden,cantidad_entregada,motivo_faltante,detalle_faltante)')
          .is('eliminado_en', null)
          .in('id', faltan);
        if (error) throw error;
        ids.forEach(id => enEstado.delete(id));
        (data || []).forEach(r => enEstado.set(r.id, mapPedido_(r)));
      }
      const pedidos = ids.map(id => enEstado.get(id)).filter(Boolean);
      const itemIds = pedidos.flatMap(p => p.items.map(it => it.id)).filter(x => x != null);
      const [pi, pp, pr] = await Promise.all([
        itemIds.length ? sb.from('prep_items').select('*').in('item_id', itemIds) : { data: [] },
        ids.length ? sb.from('prep_pedidos').select('*').in('pedido_id', ids) : { data: [] },
        sb.from('prep_productos').select('nombre,frio,se_pesa')
      ]);
      for (const r of [pi, pp, pr]) if (r.error) throw r.error;
      if (revision !== S.revision || !S.abierto) return;
      if (S.guardando.size || esEditando()) { S.pendiente = true; return; }
      S.pedidos = pedidos;
      S.items = new Map((pi.data || []).map(x => [x.item_id, x]));
      S.peds = new Map((pp.data || []).map(x => [x.pedido_id, x]));
      if (pr.data) S.prods = new Map(pr.data.map(x => [x.nombre, x]));
      S.error = '';
      await firmarFotos();
    } catch (e) {
      S.error = 'No se pudo actualizar (' + (e.message || e) + '). Se reintenta solo.';
    } finally {
      S.cargando = false;
      if (S.pendiente && S.abierto && !esEditando() && !S.guardando.size) setTimeout(cargar, 0);
    }
    pintar();
  }
  const prodDe = n => S.prods.get(n) || { nombre: n, frio: true, se_pesa: false };
  const pi = it => S.items.get(it.id) || { item_id: it.id, juntado: false, separado: false, falta: false, enviado: null, peso: null, foto: null };
  const pp = p => S.peds.get(p.id) || { pedido_id: p.id, controlado: false, cargado: false };

  async function guardarItem(itemId, cambios) {
    if (S.guardando.has(itemId)) return false;
    S.revision++;
    S.guardando.add(itemId);
    const prev = S.items.get(itemId) || { item_id: itemId, juntado: false, separado: false, falta: false };
    const fila = { ...prev, ...cambios, item_id: itemId, quien: quien(), actualizado_en: new Date().toISOString() };
    S.items.set(itemId, fila); pintar();
    try {
      // Solo las columnas modificadas: no sobrescribir pesos/fotos guardados desde otra pantalla.
      const { error } = await sb.from('prep_items').upsert({item_id:itemId,...cambios,quien:quien(),actualizado_en:fila.actualizado_en});
      if (error) throw error;
      return true;
    } catch (e) { aviso('No se guardó: ' + e.message); S.items.set(itemId, prev); return false; }
    finally { S.guardando.delete(itemId); pintar(); cargar(); }
  }
  async function guardarPedido(pid, cambios) {
    const prev = S.peds.get(pid) || { pedido_id: pid, controlado: false, cargado: false };
    const fila = { ...prev, ...cambios, pedido_id: pid };
    S.peds.set(pid, fila); pintar();
    const { error } = await sb.from('prep_pedidos').upsert({pedido_id:pid,...cambios});
    if (error) { aviso('No se guardó: ' + error.message); S.peds.set(pid, prev); pintar(); }
  }

  // ── Juntar: el total de la tanda por producto ─────────────────────
  function grupos() {
    const g = new Map();
    S.pedidos.forEach(p => p.items.forEach(it => {
      const k = [it.prod, it.unidades || '', it.fetear ? 'F' : '', it.sinCuero ? 'S' : ''].join('|');
      if (!g.has(k)) g.set(k, { k, prod: it.prod, base: it, qty: 0, items: [], clientes: [] });
      const x = g.get(k); x.qty += Number(it.qty) || 0; x.items.push(it); x.clientes.push({ cli: p.cliente, it });
    }));
    return [...g.values()].sort((a, b) => a.prod.localeCompare(b.prod, 'es'));
  }
  function vistaJuntar() {
    const gs = grupos();
    const fila = x => {
      const tot = { ...x.base, qty: Math.round(x.qty * 1000) / 1000 };
      const todos = x.items.every(it => pi(it).juntado), falta = x.items.some(it => pi(it).falta);
      const pr = prodDe(x.prod);
      return `<div class="pp-fila${todos ? ' ok' : ''}${falta ? ' falta' : ''}">
        <button class="pp-tilde" data-a="juntar" data-k="${esc(x.k)}" aria-label="Juntado">${todos ? '✓' : ''}</button>
        <div class="pp-info" data-a="juntar" data-k="${esc(x.k)}">
          <div class="pp-cant">${esc(cant(tot))}</div>
          <div class="pp-prod">${esc(x.prod)}<span class="pp-tags">${esc(tags(x.base))}</span></div>
          ${x.clientes.length > 1 ? `<div class="pp-sub">${x.clientes.map(c => esc(c.cli) + ': ' + esc(cant(c.it))).join(' + ')}</div>` : `<div class="pp-sub">${esc(x.clientes[0].cli)}</div>`}
        </div>
        <button class="pp-chip ${pr.frio ? 'frio' : 'seco'}" data-a="tipo" data-p="${esc(x.prod)}" title="Cambiar frío/seco">${pr.frio ? 'Frío' : 'Seco'}</button>
        <button class="pp-falta${falta ? ' on' : ''}" data-a="faltaG" data-k="${esc(x.k)}">${falta ? 'Falta ✕' : 'Falta'}</button>
      </div>`;
    };
    const frio = gs.filter(x => prodDe(x.prod).frio), seco = gs.filter(x => !prodDe(x.prod).frio);
    const sec = (t, l) => l.length ? `<h3 class="pp-h">${t} <small>${l.filter(x => x.items.every(it => pi(it).juntado)).length}/${l.length}</small></h3>${l.map(fila).join('')}` : '';
    return `<p class="pp-ayuda">Juntá todo en la zona de preparación. Tocá cada producto cuando lo tengas. Si no alcanza, tocá <b>Falta</b>.</p>` +
      sec('❄️ Frío', frio) + sec('📦 Seco', seco);
  }

  // ── Separar y pesar: cliente por cliente ───────────────────────────
  function itemListo(it) {
    const x = pi(it);
    if (!x.separado) return false;
    if (x.falta && (x.enviado == null || Number(x.enviado) < 0 || Number(x.enviado) > Number(it.qty))) return false;
    if (x.falta && Number(x.enviado) === 0) return true;
    if (prodDe(it.prod).se_pesa) return num(x.peso) > 0 && !!x.foto;
    return true;
  }
  const pedidoSeparado = p => p.items.every(itemListo);
  function vistaSeparar() {
    return `<p class="pp-ayuda">Un cliente por vez: armá su canasto, tildá cada renglón y lo que se pesa llevá peso y foto.</p>` +
      S.pedidos.map((p, i) => {
        const ok = pedidoSeparado(p);
        return `<div class="pp-card${ok ? ' ok' : ''}">
          <div class="pp-card-h"><span class="pp-n">${i + 1}</span><b>${esc(p.cliente)}</b>${ok ? '<span class="pp-sello">✓ Listo</span>' : ''}</div>
          ${p.notas ? `<div class="pp-obs">⚠️ ${esc(p.notas)}</div>` : ''}
          ${p.items.map(it => filaItem(p, it)).join('')}
        </div>`;
      }).join('');
  }
  function filaItem(p, it) {
    const x = pi(it), pesa = prodDe(it.prod).se_pesa;
    const foto = x.foto && S.fotos.get(x.foto);
    return `<div class="pp-fila${itemListo(it) ? ' ok' : ''}${x.falta ? ' falta' : ''}">
      <button class="pp-tilde" data-a="separar" data-i="${it.id}" aria-label="Separado">${x.separado ? '✓' : ''}</button>
      <div class="pp-info" data-a="separar" data-i="${it.id}">
        <div class="pp-cant">${esc(cant(it))}</div>
        <div class="pp-prod">${esc(it.prod)}<span class="pp-tags">${esc(tags(it))}</span></div>
        ${x.falta ? `<div class="pp-sub pp-rojo">Falta · se manda: ${x.enviado == null ? '¿cuánto?' : esc(String(x.enviado))}</div>` : ''}
      </div>
      ${pesa ? `<label class="pp-peso"><input inputmode="decimal" placeholder="kg" value="${x.peso == null ? '' : esc(String(x.peso).replace('.', ','))}" data-a="peso" data-i="${it.id}"><span>kg</span></label>
        <button class="pp-foto${x.foto ? ' on' : ''}" data-a="foto" data-i="${it.id}" data-p="${esc(p.id)}">${foto ? `<img src="${esc(foto)}" alt="">` : '📷'}</button>` : ''}
      <button class="pp-falta${x.falta ? ' on' : ''}" data-a="falta" data-i="${it.id}">${x.falta ? 'Falta ✕' : 'Falta'}</button>
    </div>`;
  }

  // ── Remitos y control (PC de quien hace los remitos) ───────────────
  function vistaRemitos() {
    return `<p class="pp-ayuda">Con las fotos y los pesos, hacé el remito de cada cliente en Dubix. Después compará lo preparado con el remito y tocá <b>Controlado</b>.</p>` +
      S.pedidos.map((p, i) => {
        const e = pp(p), sep = pedidoSeparado(p);
        return `<div class="pp-card${e.controlado ? ' ok' : ''}">
          <div class="pp-card-h"><span class="pp-n">${i + 1}</span><b>${esc(p.cliente)}</b>
            ${sep ? '' : '<span class="pp-pend">Todavía se está separando</span>'}</div>
          ${p.notas ? `<div class="pp-obs">⚠️ ${esc(p.notas)}</div>` : ''}
          <table class="pp-tabla"><tbody>${p.items.map(it => {
            const x = pi(it), f = x.foto && S.fotos.get(x.foto);
            return `<tr class="${x.falta ? 'falta' : ''}"><td>${esc(cant(it))}</td><td>${esc(it.prod)}<span class="pp-tags">${esc(tags(it))}</span>${x.falta ? `<div class="pp-rojo">Falta · se manda ${x.enviado == null ? '?' : esc(String(x.enviado))}</div>` : ''}</td>
              <td class="pp-kg">${num(x.peso) ? fmtKg(num(x.peso)) + ' kg' : ''}</td>
              <td>${f ? `<button class="pp-mini-foto" data-a="ver" data-u="${esc(f)}"><img src="${esc(f)}" alt=""></button>` : (prodDe(it.prod).se_pesa ? '<span class="pp-pend">sin foto</span>' : '')}</td></tr>`;
          }).join('')}</tbody></table>
          <div class="pp-acc">
            <button class="pp-btn${p.remitoHecho ? ' on' : ''}" data-a="remito" data-p="${esc(p.id)}">${p.remitoHecho ? '✓ Remito hecho' : 'Remito hecho'}</button>
            <button class="pp-btn${e.controlado ? ' on' : ''}" data-a="control" data-p="${esc(p.id)}">${e.controlado ? '✓ Controlado' : 'Controlado'}</button>
          </div>
        </div>`;
      }).join('');
  }

  // ── Cargar en la camioneta ─────────────────────────────────────────
  function vistaCargar() {
    const pend = S.pedidos.filter(p => p.estado === 'Pendiente');
    const todos = pend.length && pend.every(p => pp(p).cargado);
    return `<p class="pp-ayuda">Tocá cada cliente cuando su canasto esté arriba de la camioneta.</p>` +
      S.pedidos.map((p, i) => {
        const e = pp(p), sep = pedidoSeparado(p), salio = p.estado !== 'Pendiente';
        const chip = (ok, t) => `<span class="pp-chip2${ok ? ' ok' : ''}">${ok ? '✓' : '·'} ${t}</span>`;
        return `<button class="pp-carga${e.cargado || salio ? ' ok' : ''}" data-a="cargar" data-p="${esc(p.id)}"${salio ? ' disabled' : ''}>
          <span class="pp-n">${i + 1}</span>
          <span class="pp-carga-t"><b>${esc(p.cliente)}</b>
            <span>${chip(sep, 'Separado')}${chip(p.remitoHecho, 'Remito')}${chip(e.controlado, 'Controlado')}</span>
            <small>${p.items.length} renglón${p.items.length !== 1 ? 'es' : ''}${p.notas ? ' · ⚠️ ' + esc(p.notas) : ''}</small></span>
          <span class="pp-carga-ok">${salio ? 'Salió' : e.cargado ? '✓ Cargado' : 'Cargar'}</span>
        </button>`;
      }).join('') +
      `<div class="pp-salida"><button class="pp-btn pp-grande"${pend.length ? '' : ' disabled'} data-a="salio">🚚 Salió la camioneta${todos ? '' : ' (faltan cargar)'}</button></div>`;
  }

  // ── Pantalla ───────────────────────────────────────────────────────
  function contar() {
    return {
      juntar: (g => [g.filter(x => x.items.every(it => pi(it).juntado)).length, g.length])(grupos()),
      separar: [S.pedidos.filter(pedidoSeparado).length, S.pedidos.length],
      remitos: [S.pedidos.filter(p => pp(p).controlado).length, S.pedidos.length],
      cargar: [S.pedidos.filter(p => pp(p).cargado || p.estado !== 'Pendiente').length, S.pedidos.length]
    };
  }
  function pintar() {
    const r = $('pp-raiz'); if (!r || !S.abierto) return;
    if (esEditando() || S.interacting) { S.pendiente = true; return; }
    const c = contar(), pasos = [['juntar', 'Productos'], ['separar', 'Preparar'], ['remitos', 'Remito'], ['cargar', 'Camioneta']];
    const foco = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.a === 'peso' ? document.activeElement.dataset.i : null;
    const scroll = $('pp-cuerpo') ? $('pp-cuerpo').scrollTop : 0;
    r.innerHTML = `<div class="pp-top">
        <div class="pp-tit"><b>${S.pedidoId ? esc(S.pedidos[0]?.cliente || 'Pedido') : 'Preparación'}</b><span>${S.pedidoId ? 'Prepará, registrá los faltantes y volvé al tablero' : 'Hoja del ' + esc(fecha(S.hoja.fecha))}</span></div>
        <button class="pp-x" data-a="refrescar" title="Actualizar">⟳</button>
        <button class="pp-x" data-a="cerrar" title="Cerrar">✕</button>
      </div>
      <nav class="pp-pasos">${pasos.map(([k, t]) => `<button class="${S.paso === k ? 'on' : ''}${c[k][0] === c[k][1] && c[k][1] ? ' listo' : ''}" data-a="paso" data-k="${k}">${t}<small>${c[k][0]}/${c[k][1]}</small></button>`).join('')}</nav>
      ${S.error ? `<div class="pp-error">${esc(S.error)}</div>` : ''}
      <div class="pp-cuerpo" id="pp-cuerpo">${!S.pedidos.length ? '<p class="pp-ayuda">Esta hoja no tiene pedidos.</p>' :
        S.paso === 'juntar' ? vistaJuntar() : S.paso === 'separar' ? vistaSeparar() : S.paso === 'remitos' ? vistaRemitos() : vistaCargar()}</div>
      <input type="file" id="pp-camara" accept="image/*" capture="environment" hidden>`;
    $('pp-cuerpo').scrollTop = scroll;
    if (foco) { const el = r.querySelector(`[data-a="peso"][data-i="${foco}"]`); if (el) { el.focus(); const v = el.value; el.value = ''; el.value = v; } }
  }

  function abrir(hojaId, pedido) {
    const h = pedido ? {id:'pedido-' + pedido.id,fecha:pedido.fechaEntrega} : (state.hojas || []).find(x => x.id === hojaId) || (state.hojas || [])[0];
    if (!h) return aviso('Primero armá y guardá la hoja de reparto.');
    S.revision++; S.pedidoId = pedido?.id || null;
    S.hoja = h; S.abierto = true; S.paso = pedido ? 'separar' : 'juntar'; S.pedidos = pedido ? [pedido] : []; S.items = new Map(); S.peds = new Map();
    let r = $('pp-raiz');
    if (!r) {
      r = document.createElement('div'); r.id = 'pp-raiz'; r.className = 'pp'; document.body.appendChild(r);
      r.addEventListener('click', clic); r.addEventListener('change', cambio);
      r.addEventListener('pointerdown', () => { S.interacting = true; });
      const soltar = () => setTimeout(() => { S.interacting = false; if (S.pendiente) { pintar(); cargar(); } }, 0);
      document.addEventListener('pointerup', soltar); document.addEventListener('pointercancel', soltar);
    }
    r.classList.toggle('pp-pedido', !!pedido);
    r.setAttribute('role','dialog'); r.setAttribute('aria-modal','true'); r.setAttribute('aria-label','Detalle de preparación');
    r.hidden = false; document.body.classList.add('pp-abierto');
    pintar(); cargar();
    r.querySelector('[data-a="cerrar"]')?.focus();
    clearInterval(S.timer); S.timer = setInterval(() => { if (!document.hidden && !esEditando()) cargar(); }, 20000);
  }
  const esEditando = () => document.activeElement && document.activeElement.dataset && document.activeElement.dataset.a === 'peso';
  function cerrar(refrescar = true) {
    S.revision++;
    S.abierto = false; clearInterval(S.timer);
    const r = $('pp-raiz'); if (r) r.hidden = true;
    document.body.classList.remove('pp-abierto');
    if (refrescar && typeof reload === 'function') reload();
    if (refrescar && window.RepartoVivo) RepartoVivo.refrescar();
  }

  // ── Acciones ───────────────────────────────────────────────────────
  const itemPorId = id => { for (const p of S.pedidos) for (const it of p.items) if (String(it.id) === String(id)) return { p, it }; return {}; };
  async function clic(e) {
    const b = e.target.closest('[data-a]'); if (!b) return;
    const a = b.dataset.a;
    if (a === 'peso') return;
    if (a === 'cerrar') return cerrar();
    if (a === 'refrescar') return cargar();
    if (a === 'paso') { S.paso = b.dataset.k; pintar(); $('pp-cuerpo').scrollTop = 0; return; }
    if (a === 'juntar') {
      const g = grupos().find(x => x.k === b.dataset.k); if (!g) return;
      const nuevo = !g.items.every(it => pi(it).juntado);
      for (const it of g.items) guardarItem(it.id, { juntado: nuevo });
      return;
    }
    if (a === 'faltaG') {
      const g = grupos().find(x => x.k === b.dataset.k); if (!g) return;
      const nuevo = !g.items.some(it => pi(it).falta);
      for (const it of g.items) guardarItem(it.id, nuevo ? { falta: true } : { falta: false, enviado: null });
      if (nuevo) aviso('Marcado como falta. En «Separar» poné cuánto se manda a cada cliente.');
      return;
    }
    if (a === 'tipo') {
      const pr = prodDe(b.dataset.p), fila = { nombre: pr.nombre, frio: !pr.frio, se_pesa: !!pr.se_pesa, actualizado_en: new Date().toISOString() };
      S.prods.set(pr.nombre, fila); pintar();
      const { error } = await sb.from('prep_productos').upsert(fila);
      if (error) aviso('No se guardó: ' + error.message);
      return;
    }
    if (a === 'separar') { const x = pi({ id: Number(b.dataset.i) }); return guardarItem(Number(b.dataset.i), { separado: !x.separado }); }
    if (a === 'falta') {
      const id = Number(b.dataset.i), x = pi({ id });
      if (x.falta) return guardarItem(id, { falta: false, enviado: null });
      const { it } = itemPorId(id);
      const v = prompt(`¿Cuánto se manda de «${it ? it.prod : ''}»? (pedido: ${it ? cant(it) : ''}). Poné 0 si no va nada.`, '0');
      if (v === null) return;
      const n = num(v); if (n === null || n < 0 || (it && n > Number(it.qty))) return aviso('Poné una cantidad entre 0 y lo pedido');
      return guardarItem(id, { falta: true, enviado: n, separado: true });
    }
    if (a === 'foto') { S.fotoPara = { itemId: Number(b.dataset.i), pedidoId: b.dataset.p }; const inp = $('pp-camara'); inp.value = ''; inp.click(); return; }
    if (a === 'ver') return verFoto(b.dataset.u);
    if (a === 'remito') {
      const p = S.pedidos.find(x => x.id === b.dataset.p); if (!p) return;
      const v = !p.remitoHecho; p.remitoHecho = v; pintar();
      const { error } = await sb.from('pedidos').update({ remito_hecho: v }).eq('id', p.id);
      if (error) { p.remitoHecho = !v; pintar(); aviso('No se guardó: ' + error.message); }
      return;
    }
    if (a === 'control') {
      const p = S.pedidos.find(x => x.id === b.dataset.p), e2 = pp(p);
      if (!e2.controlado && !p.remitoHecho && !confirm('Todavía no está marcado el remito. ¿Lo marcás como controlado igual?')) return;
      return guardarPedido(p.id, e2.controlado ? { controlado: false, controlado_por: null, controlado_en: null } : { controlado: true, controlado_por: quien(), controlado_en: new Date().toISOString() });
    }
    if (a === 'cargar') {
      const p = S.pedidos.find(x => x.id === b.dataset.p), e2 = pp(p);
      if (!e2.cargado && !pedidoSeparado(p) && !confirm(`«${p.cliente}» todavía no está separado completo. ¿Lo cargás igual?`)) return;
      return guardarPedido(p.id, e2.cargado ? { cargado: false, cargado_por: null, cargado_en: null } : { cargado: true, cargado_por: quien(), cargado_en: new Date().toISOString() });
    }
    if (a === 'salio') return salio();
  }
  function cambio(e) {
    const t = e.target;
    if (t.id === 'pp-camara') return subirFoto(t.files && t.files[0]);
    if (t.dataset.a === 'peso') {
      const n = t.value.trim() === '' ? null : num(t.value);
      if (t.value.trim() !== '' && (n === null || n <= 0)) { aviso('Peso inválido'); return; }
      const id = Number(t.dataset.i), x = pi({ id });
      guardarItem(id, { peso: n, separado: x.separado || (n > 0 && !!x.foto) });
    }
  }

  // Al confirmar la salida se usa el checklist de despacho de la app, con los faltantes ya puestos.
  function salio() {
    const pend = S.pedidos.filter(p => p.estado === 'Pendiente');
    const sinCargar = pend.filter(p => !pp(p).cargado);
    if (sinCargar.length && !confirm(`Faltan cargar ${sinCargar.length}: ${sinCargar.map(p => p.cliente).join(', ')}.\n¿Despachás solo los cargados?`)) return;
    const ids = pend.filter(p => pp(p).cargado).map(p => p.id);
    if (!ids.length) return aviso('No hay pedidos cargados.');
    const resp = {};
    pend.forEach(p => p.items.forEach(it => {
      const x = pi(it);
      if (x.falta && x.enviado != null) {
        const no = Math.max(0, Math.round((Number(it.qty) - Number(x.enviado)) * 1000) / 1000);
        if (no > 0) (resp[p.id] = resp[p.id] || {})[it.id] = { completo: false, cantidadNoEntregada: no };
      }
    }));
    if (typeof abrirChecklistDespacho !== 'function') return aviso('No se encontró el despacho de la app.');
    cerrar();
    abrirChecklistDespacho(ids, resp);
  }

  // ── Fotos ──────────────────────────────────────────────────────────
  async function subirFoto(file) {
    const d = S.fotoPara; S.fotoPara = null;
    if (!file || !d) return;
    const { p, it } = itemPorId(d.itemId); if (!it) return;
    const x = pi(it);
    let peso = num(x.peso);
    if (!(peso > 0)) {
      const v = prompt(`Peso de «${it.prod}» para ${p.cliente} (kg):`, '');
      if (v === null) return;
      peso = num(v); if (!(peso > 0)) return aviso('Peso inválido');
    }
    aviso('Subiendo foto…');
    try {
      const blob = await conTexto(file, [p.cliente, it.prod, fmtKg(peso) + ' kg']);
      const ruta = `${S.hoja.id}/${it.id}-${Date.now()}.jpg`;
      const { error } = await sb.storage.from('preparacion').upload(ruta, blob, { contentType: 'image/jpeg', upsert: true });
      if (error) throw error;
      S.fotos.set(ruta, URL.createObjectURL(blob));
      if (await guardarItem(it.id, { peso, foto: ruta, separado: true })) aviso('✓ Foto guardada');
    } catch (e) { aviso('No se pudo subir la foto: ' + (e.message || e)); }
  }
  // La foto lleva escrito cliente, producto y peso (como pide el cartel), achicada para que suba rápido.
  async function conTexto(file, lineas) {
    const img = await new Promise((ok, mal) => {
      const i = new Image(), url = URL.createObjectURL(file);
      i.onload = () => { URL.revokeObjectURL(url); ok(i); };
      i.onerror = () => { URL.revokeObjectURL(url); mal(new Error('La imagen no se pudo abrir. Elegí otra foto.')); };
      i.src = url;
    });
    const max = 1400, k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0, w, h);
    const fs = Math.round(Math.max(22, w / 26)), alto = fs * 1.35 * lineas.length + fs * 0.8;
    g.fillStyle = 'rgba(0,0,0,.62)'; g.fillRect(0, h - alto, w, alto);
    g.fillStyle = '#fff'; g.textBaseline = 'top';
    lineas.forEach((t, i) => { g.font = (i === 2 ? 'bold ' : i === 0 ? 'bold ' : '') + fs + 'px system-ui, sans-serif'; g.fillText(t, fs * 0.6, h - alto + fs * 0.4 + i * fs * 1.35, w - fs * 1.2); });
    return new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.82));
  }
  async function firmarFotos() {
    const faltan = [...S.items.values()].map(x => x.foto).filter(f => f && !S.fotos.has(f));
    if (!faltan.length) return;
    const { data, error } = await sb.storage.from('preparacion').createSignedUrls(faltan, 6 * 3600);
    if (!error) (data || []).forEach(d => { if (d.signedUrl) S.fotos.set(d.path, d.signedUrl); });
  }
  function verFoto(u) {
    const v = document.createElement('div'); v.className = 'pp-visor';
    v.innerHTML = `<img src="${esc(u)}" alt=""><button>✕</button>`;
    v.addEventListener('click', () => v.remove());
    document.body.appendChild(v);
  }

  document.addEventListener('focusout', () => { if (S.abierto && S.pendiente) setTimeout(cargar, 0); });
  document.addEventListener('keydown', e => {
    if (!S.abierto) return;
    if (e.key === 'Escape') cerrar();
    if (e.key === 'Tab') {
      const els = [...$('pp-raiz').querySelectorAll('button:not(:disabled), input:not([hidden])')];
      const first = els[0], last = els[els.length-1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }
  });
  window.Preparacion = {
    abrir, abrirPedido: p => window.ArmadoPedido ? ArmadoPedido.abrir(p) : abrir(null,p),
    abrirOperaciones: p => { abrir(null,p); S.paso = 'remitos'; pintar(); },
    fotoConTexto: conTexto,
    cerrar: (refrescar = true) => { cerrar(refrescar); if (window.ArmadoPedido) ArmadoPedido.cerrar(!refrescar); },
    refrescar: () => { cargar(); if (window.ArmadoPedido) ArmadoPedido.refrescar(); }, _S: S
  };
})();
