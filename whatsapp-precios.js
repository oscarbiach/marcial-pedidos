/* WhatsApp → pestaña «Precios» al lado del chat (pedido del usuario, 16/10/2026).
   Lee la planilla «Precios Publicos» (la misma de la que sale el PDF que se manda a los clientes), publicada en la web como
   CSV: así está siempre al día sin cargar nada a mano. Formato de la hoja: una fila de marca/rubro con los títulos de las
   columnas de precio (KILO, UNIDAD, CAJA o PACK) y debajo un producto por fila (nombre en la columna A, «$12,100» o «-»).
   Solo lee. La última lista que se pudo leer queda guardada en este navegador para usarla sin señal.
   «Pasar al chat» escribe el precio en la respuesta del chat abierto; no envía nada. */
(function () {
  'use strict';
  // Enlace «Publicar en la web» (CSV) de la planilla «Precios Publicos». Vacío = todavía no se publicó.
  const URL_CSV = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vThGdsJrx-_3bcXPMHJELbIgY7zBB9fksN1d1W09bWzbxpxUM1-8l1Y-tgflTs1d6njrAuBn3AD821S/pub?gid=0&single=true&output=csv';
  const CLAVE = 'dm_wa_precios', VIEJA = 30 * 60000, TOPE = 80;
  const $ = id => document.getElementById(id);
  const ico = (n, c) => (window.mIco ? mIco(n, c || 'ico-sm') : '');
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const S = { lista: null, cuando: 0, cargando: null, error: '', q: '', cat: '', listo: false };
  const prueba = () => !!(window.WhatsAppPrueba && window.WhatsAppPrueba.preciosCsv);
  const ETQ = { KILO: ['kg', 'el kg'], UNIDAD: ['unidad', 'la unidad'], CAJA: ['caja', 'la caja'], PACK: ['pack', 'el pack'] };

  // ── CSV → [{cat, nombre, precios:[{col, valor}]}] ──
  function filasCsv(t) {
    const out = []; let fila = [], celda = '', q = false;
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (q) { if (c === '"') { if (t[i + 1] === '"') { celda += '"'; i++; } else q = false; } else celda += c; }
      else if (c === '"') q = true;
      else if (c === ',') { fila.push(celda); celda = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; fila.push(celda); out.push(fila); fila = []; celda = ''; }
      else celda += c;
    }
    if (celda || fila.length) { fila.push(celda); out.push(fila); }
    return out;
  }
  const precio = v => { const d = String(v || '').replace(/[^\d.,]/g, '').replace(/,/g, ''); const n = parseFloat(d); return d && n > 0 ? n : null; };
  function leer(csv) {
    const lista = []; let cat = '', cols = null, base = null;
    filasCsv(csv).forEach(f => {
      const nombre = String(f[0] || '').replace(/\s+/g, ' ').trim(); if (!nombre) return;
      const titulos = f.map((c, i) => [String(c).trim().toUpperCase(), i]).filter(([c]) => ETQ[c]);
      if (titulos.length) {
        // Si a una fila de títulos le falta alguno (p. ej. «KILO» en Bosio), esa columna conserva el título de la primera fila completa.
        const m = new Map(titulos.map(([c, i]) => [i, c]));
        if (!base) base = new Map(m);
        base.forEach((c, i) => { if (!m.has(i)) m.set(i, c); });
        cat = nombre; cols = [...m].sort((x, y) => x[0] - y[0]).map(([i, col]) => ({ col, i })); return;
      }
      if (!cols) return;
      const precios = cols.map(({ col, i }) => ({ col, valor: precio(f[i]) })).filter(p => p.valor);
      if (precios.length) lista.push({ cat, nombre, precios, k: norm(nombre + ' ' + cat) });
    });
    return lista;
  }
  const pesos = n => '$' + Math.round(n).toLocaleString('es-AR');

  // ── Carga: la planilla publicada (o la de prueba), con la última guardada como respaldo ──
  function guardada() { try { const g = JSON.parse(localStorage.getItem(CLAVE)); if (g && Array.isArray(g.lista)) return g; } catch (e) { /* sin almacenamiento */ } return null; }
  async function cargar(forzar) {
    if (S.cargando) return S.cargando;
    if (!forzar && S.lista && Date.now() - S.cuando < VIEJA) return;
    S.cargando = (async () => {
      S.error = ''; dibujar();
      try {
        let csv;
        if (prueba()) csv = await window.WhatsAppPrueba.preciosCsv();
        else if (!URL_CSV) throw new Error('sin-enlace');
        else { const r = await fetch(URL_CSV, { cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status); csv = await r.text(); }
        const lista = leer(csv);
        if (!lista.length) throw new Error('La planilla no tiene productos con precio en el formato esperado.');
        S.lista = lista; S.cuando = Date.now();
        if (!prueba()) try { localStorage.setItem(CLAVE, JSON.stringify({ lista, cuando: S.cuando })); } catch (e) { /* sin espacio */ }
      } catch (e) {
        S.error = e.message === 'sin-enlace' ? 'sin-enlace' : 'No se pudo leer la lista' + (S.lista ? '; se muestra la última guardada' : '') + '.';
      } finally { S.cargando = null; dibujar(); }
    })();
    return S.cargando;
  }

  // ── Pantalla ──
  function armar() {
    const box = $('wa-precios'); if (!box || S.listo) return;
    S.listo = true;
    box.innerHTML = `<button type="button" class="wa-volver-chat wa-sin-ficha" data-wa="chat">${ico('arrow-left')}Volver al chat</button>
      <div class="pr-buscar"><label class="wa-buscar">${ico('search')}<input id="pr-q" type="search" autocomplete="off" placeholder="Buscar producto o marca" aria-label="Buscar producto o marca en la lista de precios"></label>
        <div class="pr-meta"><span id="pr-cuando" role="status" aria-live="polite"></span><button type="button" id="pr-actualizar">${ico('refresh-cw')}Actualizar</button></div></div>
      <div id="pr-lista"></div>`;
    $('pr-q').addEventListener('input', e => { S.q = e.target.value; S.cat = ''; dibujarLista(); });
    $('pr-actualizar').onclick = () => cargar(true);
    box.addEventListener('click', e => {
      const c = e.target.closest('[data-pr-cat]'); if (c) { S.cat = S.cat === c.dataset.prCat ? '' : c.dataset.prCat; dibujarLista(); return; }
      const b = e.target.closest('[data-pr-pasar]'); if (b) pasar(Number(b.dataset.prPasar), b);
    });
  }
  function dibujar() {
    if (!S.listo) return;
    const cuando = $('pr-cuando');
    if (cuando) cuando.textContent = S.cargando ? 'Leyendo la lista…' : S.cuando ? 'Lista leída a las ' + new Date(S.cuando).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false }) + (new Date(S.cuando).toDateString() === new Date().toDateString() ? '' : ' del ' + new Date(S.cuando).toLocaleDateString('es-AR')) : '';
    dibujarLista();
  }
  function dibujarLista() {
    const box = $('pr-lista'); if (!box) return;
    if (S.error === 'sin-enlace') { box.innerHTML = '<p class="pr-aviso">Falta conectar la planilla «Precios Publicos». Cuando esté publicada en la web, la lista aparece acá sola.</p>'; return; }
    const aviso = S.error ? `<p class="pr-aviso wa-error">${esc(S.error)}</p>` : '';
    if (!S.lista) { box.innerHTML = aviso || '<p class="pr-aviso">Leyendo la lista de precios…</p>'; return; }
    const pal = norm(S.q).split(' ').filter(Boolean);
    let res = S.lista.map((p, i) => [p, i]);
    if (S.cat) res = res.filter(([p]) => p.cat === S.cat);
    if (pal.length) res = res.filter(([p]) => pal.every(w => p.k.includes(w)));
    if (!pal.length && !S.cat) {
      const cats = [...new Set(S.lista.map(p => p.cat))];
      box.innerHTML = aviso + `<p class="pr-aviso">Escribí un producto o marca, o elegí un rubro:</p>
        <div class="pr-cats">${cats.map(c => `<button type="button" class="wa-chip" data-pr-cat="${esc(c)}">${esc(c)}</button>`).join('')}</div>`;
      return;
    }
    if (!res.length) { box.innerHTML = aviso + `<p class="pr-aviso">No hay productos con «${esc(S.q)}» en la lista. Para lo que no figura, hay que consultar disponibilidad.</p>`; return; }
    let cat = null;
    const html = res.slice(0, TOPE).map(([p, i]) => {
      const cab = p.cat !== cat ? `<p class="pr-cat">${esc(p.cat)}</p>` : ''; cat = p.cat;
      return cab + `<div class="pr-item"><span class="pr-n">${esc(p.nombre)}</span>
        <span class="pr-vals">${p.precios.map(x => `<span><b>${pesos(x.valor)}</b> ${esc(ETQ[x.col][0])}</span>`).join('')}</span>
        <button type="button" class="wa-btn pr-pasar" data-pr-pasar="${i}" title="Escribir este precio en la respuesta">${ico('message-circle')}Pasar al chat</button></div>`;
    }).join('');
    box.innerHTML = aviso + (S.cat ? `<div class="pr-cats"><button type="button" class="wa-chip" data-pr-cat="${esc(S.cat)}" aria-pressed="true">${esc(S.cat)} ×</button></div>` : '') + html +
      (res.length > TOPE ? `<p class="pr-mas">Hay ${res.length - TOPE} productos más: escribí algo más específico.</p>` : '');
  }
  const texto = p => p.nombre + ': ' + p.precios.map(x => pesos(x.valor) + ' ' + ETQ[x.col][1]).join(' / ');
  async function pasar(i, boton) {
    const p = S.lista && S.lista[i]; if (!p) return;
    const t = texto(p), d = $('wa-draft');
    if (d && !d.disabled) {
      d.value = d.value.trim() ? d.value.replace(/\s+$/, '') + '\n' + t : t;
      d.dispatchEvent(new Event('input', { bubbles: true }));
      if (window.matchMedia('(max-width:1279.98px)').matches) document.querySelector('#wa-lado .wa-volver-chat:not([hidden])')?.click();
      d.focus(); d.setSelectionRange(d.value.length, d.value.length);
      avisar(boton, 'Listo en la respuesta');
      return;
    }
    try { await navigator.clipboard.writeText(t); avisar(boton, 'Copiado'); }
    catch (e) { avisar(boton, 'No se pudo copiar'); }
  }
  function avisar(b, t) { const old = b.innerHTML; b.textContent = t; b.disabled = true; setTimeout(() => { b.innerHTML = old; b.disabled = false; }, 1400); }

  function mostrar() {
    if (!S.lista) { const g = guardada(); if (g && !prueba()) { S.lista = g.lista; S.cuando = g.cuando; } }
    armar(); dibujar(); cargar(false);
  }
  window.WhatsAppPrecios = { mostrar, actualizar: () => cargar(true), _leer: leer, _texto: texto };
})();
