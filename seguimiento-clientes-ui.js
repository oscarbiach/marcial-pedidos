/* Pestaña "Clientes" de la app de Pedidos: seguimiento por ritmo de compra (motor: seguimiento-clientes.js). Prioridad: PC.
   Tres vistas: "Para hoy" (los bloques, con un resumen arriba que lleva a cada uno), "Clientes" (toda la cartera, con buscador) y "En pausa".
   En PC la pantalla tiene dos columnas: la lista a la izquierda y la ficha del cliente elegido a la derecha (no se abre entre las filas).
   En pantallas angostas la ficha ocupa el lugar de la lista, con "Volver a la lista" (se conservan la búsqueda y la posición).
   La ficha trae dos gráficos que contestan una pregunta cada uno (¿cuánto pasó respecto de su ritmo? y ¿qué días suele pedir?) y una tira
   corta con el plazo entre el día que pidió y el día que se le entregó; la línea de tiempo, el indicador de atraso y el detalle del
   cálculo quedan detrás de "Ver historial y cálculo". Todo gráfico lleva sus valores escritos. El color en las letras es selectivo.
   "Para hoy" no tiene bloque "No tocar": quienes están al día se ven en "Clientes" con su estado ("Dentro de su ciclo").
   IDEA-10/11/12 (propuesta de ChatGPT, 13/10/2026): quien figura en CONFIG.editores puede mover un cliente a "Atender" o "Recuperación", pausar su
   seguimiento (con fecha de revisión que NO lo reactiva sola) y resolver los avisos "Dejó de llevar" (producto retirado, con reemplazo, o excepción de
   ese cliente). Se arrastra desde el asa de la fila (PC) o con "Mover a…" (teclado y celular). Nada de eso cambia pedidos, fechas ni cálculos: son
   decisiones aparte, guardadas por seguimiento-datos.js. Mientras la base no tenga las tablas (hace falta aprobación), no se ofrece ninguna acción.
   Usa, de index.html: state, setTab, esc, mIco, toast y google.script.run.
   El historial largo (más de 7 días) se pide aparte con historialAntiguo() y se guarda acá, sin tocar state.pedidos, para no interferir con el buscador
   de Pedidos. Elegir un cliente NO es un contacto: no se registra nada. */
(function () {
  'use strict';
  const S = window.SegClientes, F = S.fechas;
  const VIEJO_MS = 10 * 60 * 1000;   // el historial se vuelve a pedir si tiene más de 10 minutos
  const DATOS_VIEJOS_MS = 60 * 1000; // las decisiones y reglas se vuelven a leer si tienen más de 1 minuto (otra persona pudo cambiar algo)
  const PLAZO = { datos: 20000 };    // una lectura de decisiones que no responde en 20 s se da por fallida (igual que el historial)
  const E = {
    q: '', vista: 'hoy', filtroPausa: 'todas', sel: null, fichaAbierta: false, scrollLista: 0, ritmo: new Set(), historial: null, cargando: false, error: false, ts: 0, calc: null, huella: '',
    datos: { estado: 'pendiente', decisiones: [], reglas: [], ts: 0, ultimoOk: 0, cargando: false, error: false, mensaje: '' },
    dlg: null, aviso: null, deshacer: null, arr: null, ocupado: false, renderPendiente: false, cerrados: new Set(),
  };
  const $ = id => document.getElementById(id);
  // state y activeTab son `let` de index.html: no cuelgan de window, se leen directo (con typeof por si todavía no existen).
  const estadoApp = () => (typeof state !== 'undefined' ? state : null);
  const pestana = () => (typeof activeTab !== 'undefined' ? activeTab : '');
  const hoy = () => { const st = estadoApp(); return (st && st.today) || F.ymd(new Date()); };
  // esc() de index.html no escapa las comillas: para texto dentro de un atributo ("...") se usa este.
  const at = t => esc(t).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  // Dos columnas desde 1024 px de ancho (el CSS hace lo mismo con la misma medida); más angosto, la ficha reemplaza a la lista.
  const ancho = () => !!(window.matchMedia && window.matchMedia('(min-width: 1024px)').matches);

  // título, subtítulo, ícono y tono de color de cada bloque. El color acompaña al nombre y al ícono; nunca es la única señal.
  const TITULOS = {
    atender: ['Atender', 'Los marcaron para escribirles hoy, aunque el cálculo no los destaque.', 'message-circle', 'marca'],
    alta: ['Prioridad alta', 'Ya pasó mucho más de lo que suelen tardar, o hoy es su día de pedir.', 'triangle-alert', 'error'],
    semana: ['Les tocaba esta semana', 'Su ciclo ya venció y no pidieron desde el lunes.', 'calendar-clock', 'aviso'],
    recuperacion: ['Recuperación', 'Compraban y cortaron hace más de 35 días.', 'rotate-ccw', 'info'],
    unica: ['Compra única', 'Pidieron una sola vez: para convertir.', 'user-plus', 'neutro'],
  };
  // "Para hoy" muestra solo estos bloques (más "Atender" cuando alguien marcó a un cliente). Los clientes al día (el bloque "notocar" del motor) y los
  // que están en pausa no tienen sección: en "Clientes" llevan su estado y los pausados están en la vista "En pausa".
  const BLOQUES_HOY = ['alta', 'semana', 'recuperacion', 'unica'];
  const ESTADOS_AL_DIA = { ciclo: ['Dentro de su ciclo', 'circle-check', 'ok'], semana: ['Pidió esta semana', 'circle-check', 'ok'], inactivo: ['Inactivo', 'clock', 'neutro'] };
  const ESTADOS_MANUAL = { atender: ['Atender', 'message-circle', 'marca'], recuperacion: ['Recuperación', 'rotate-ccw', 'info'], pausa: ['En pausa', 'pause', 'neutro'] };
  const ABREV = { 1: 'lun', 2: 'mar', 3: 'mié', 4: 'jue', 5: 'vie', 6: 'sáb', 0: 'dom' };
  const SEMANA = [1, 2, 3, 4, 5, 6, 0];   // la semana va de lunes a domingo
  const ALTO_COLUMNAS = 88;                // alto (px) de la barra más alta del gráfico de días
  // Destinos a los que se puede mover un cliente (IDEA-10/11). «Automático» vuelve al cálculo de siempre.
  const DESTINOS = {
    atender: ['Atender', 'Para escribirle hoy aunque el cálculo no lo marque.', 'message-circle', 'marca'],
    recuperacion: ['Recuperación', 'Una relación a recuperar.', 'rotate-ccw', 'info'],
    pausa: ['En pausa', 'Sale de las listas de contacto hasta que se retome.', 'pause', 'neutro'],
    automatico: ['Automático', 'Que lo ubique el cálculo de siempre.', 'refresh-cw', 'ok'],
  };
  const MOTIVOS_EXCEPCION = ['Ya no lo usa', 'Lo compra en otro lado', 'Pedido ocasional', 'Otro'];

  // ── Datos ──
  function mezclar() {
    const vistos = new Set(), todos = [];
    ((estadoApp() && estadoApp().pedidos) || []).concat(E.historial || []).forEach(p => { if (p && !vistos.has(p.id)) { vistos.add(p.id); todos.push(p); } });
    return todos;
  }
  function recalcular() {
    const todos = mezclar();
    const huella = todos.length + '|' + hoy() + '|' + E.datos.ts + '|' + E.datos.estado + '|' + todos.reduce((h, p) => h + String(p.id).length + String(p.estado).length + String(p.fechaDespacho || '').length + String(p.notas || '').length, 0);
    if (E.calc && E.huella === huella) return E.calc;
    E.huella = huella; E.calc = S.calcular(todos, hoy(), datosOk() ? { decisiones: E.datos.decisiones, reglas: E.datos.reglas } : undefined);
    return E.calc;
  }
  function pedirHistorial() {
    if (E.cargando) return;
    E.cargando = true; E.error = false; render();
    const antes = E.ts;
    // Una conexión que se corta a mitad de camino puede dejar la consulta sin resolver nunca: se la da por fallida a los 20 s.
    const vence = setTimeout(() => { if (E.cargando && E.ts === antes) { E.cargando = false; E.error = true; render(); } }, 20000);
    // El historial llega entero o no llega (la consulta falla si se corta una página): nunca se calcula con una parte.
    google.script.run
      .withSuccessHandler(extra => { clearTimeout(vence); E.historial = Array.isArray(extra) ? extra : []; E.ts = Date.now(); E.cargando = false; E.error = false; E.huella = ''; render(); avisar(); })
      .withFailureHandler(() => { clearTimeout(vence); E.cargando = false; E.error = true; render(); avisar(); })
      .historialAntiguo();
  }
  // Quién ve la pestaña: solo los de CONFIG.usuarios. Es solo de interfaz (la base deja leer los pedidos a cualquier sesión con PIN válido).
  function puedeVer(who) { return (S.CONFIG.usuarios || []).some(u => S.norm(u) === S.norm(who)); }
  function aplicarAcceso() {
    const st = estadoApp(), ok = !!st && puedeVer(st.who);
    document.body.classList.toggle('seg-visible', ok);
    if (!ok && pestana() === 'clientes' && typeof setTab === 'function') setTab('pedidos');
    return ok;
  }
  function abrir() {
    if (!$('sc-raiz') || !aplicarAcceso()) return;
    E.q = ''; E.vista = 'hoy'; E.filtroPausa = 'todas'; E.sel = null; E.fichaAbierta = false; E.aviso = null;   // al entrar siempre se ve la lista del día, no una búsqueda ni una ficha vieja
    // Salvo que se llegue desde WhatsApp con «Ver ficha completa»: entonces se abre la ficha de ese cliente.
    if (E.abrirCon) { E.vista = 'clientes'; E.sel = E.abrirCon; E.fichaAbierta = true; E.abrirCon = null; }
    if (!E.historial || Date.now() - E.ts > VIEJO_MS) pedirHistorial(); else render();
    cargarDatos();
    if (window.WhatsAppUI && WhatsAppUI.cargarVinculos) WhatsAppUI.cargarVinculos();   // para «Le escribimos …»
  }
  // Cuando llegan los datos de WhatsApp se agrega o quita la pastilla en cada fila, sin redibujar la pestaña (no corta un arrastre ni mueve el foco).
  document.addEventListener('wa:vinculos', () => {
    if (pestana() !== 'clientes' || !E.calc) return;
    document.querySelectorAll('#sc-raiz .sc-fila[data-k]').forEach(f => {
      const c = E.calc.clientes.find(x => x.clave === f.dataset.k); if (!c) return;
      const nuevo = contactadoPill(c, c.bloque), viejo = f.querySelector('.sc-pill--wa');
      if (viejo) { if (nuevo) viejo.outerHTML = nuevo; else viejo.remove(); } else if (nuevo) f.querySelector('.sc-fila-1').insertAdjacentHTML('beforeend', nuevo);
    });
  });

  // ── Decisiones y reglas (IDEA-10/11/12) ──
  let almacen = null;
  function almacenActual() {
    if (almacen) return almacen;
    const D = window.SegDatos; if (!D) return null;
    const quien = () => { const st = estadoApp(); return st && st.who; };
    if (typeof sandboxActivo === 'function' && sandboxActivo()) almacen = D.almacenLocal({ storage: window.localStorage, clave: 'dm_sandbox_seg', quien, hoy });
    else if (typeof sb !== 'undefined') almacen = D.almacenBase({ sb, hoy });
    return almacen;
  }
  const datosOk = () => E.datos.estado === 'ok';
  const puedeEditar = () => { const st = estadoApp(); return datosOk() && !!st && (S.CONFIG.editores || []).some(u => S.norm(u) === S.norm(st.who)); };
  // Lee las decisiones y reglas guardadas. Si falla pero ya había una lectura buena, se sigue con ella avisando que puede estar desactualizada;
  // si nunca hubo una buena, no se muestra una agenda que podría incluir a clientes pausados (ver cuerpo).
  async function cargarDatos(silencioso) {
    const al = almacenActual();
    if (!al) { E.datos = Object.assign({}, E.datos, { estado: 'noInstalado' }); E.huella = ''; render(); return; }
    if (E.datos.cargando) return;
    E.datos.cargando = true; if (!silencioso) render();
    let r, vence;
    try {
      r = await Promise.race([al.cargar(), new Promise(res => { vence = setTimeout(() => res({ estado: 'error', decisiones: [], reglas: [], mensaje: 'tardó demasiado en responder' }), PLAZO.datos); })]);
    } catch (e) { r = { estado: 'error', decisiones: [], reglas: [], mensaje: String((e && e.message) || e) }; }
    clearTimeout(vence);
    const previo = E.datos;
    if (r.estado === 'ok') E.datos = { estado: 'ok', decisiones: r.decisiones, reglas: r.reglas, ts: Date.now(), ultimoOk: Date.now(), cargando: false, error: false, mensaje: '' };
    else if (r.estado === 'error' && previo.ultimoOk) E.datos = Object.assign({}, previo, { cargando: false, error: true, mensaje: r.mensaje || '' });
    else E.datos = { estado: r.estado, decisiones: [], reglas: [], ts: Date.now(), ultimoOk: 0, cargando: false, error: false, mensaje: r.mensaje || '' };
    E.huella = '';
    if (E.vista === 'pausa' && !datosOk()) E.vista = 'hoy';
    render(); avisar();
  }

  // ── Para WhatsApp (whatsapp-inbox.js) ──
  // Al lado de cada chat se muestra el mismo cálculo que en esta pestaña: estado, avisos y últimos pedidos del cliente vinculado.
  // Cuando llega el historial o las decisiones se avisa con un evento, para que WhatsApp se redibuje sin consultar nada por su cuenta.
  const avisar = () => document.dispatchEvent(new CustomEvent('seg:actualizado'));
  function asegurar() {
    if (!E.cargando && (!E.historial ? !E.error : Date.now() - E.ts > VIEJO_MS)) pedirHistorial();
    if (E.datos.estado === 'pendiente' && !E.datos.cargando) cargarDatos(true);
  }
  function buscarCliente(nombre) {
    const calc = recalcular(), k = S.norm(nombre);
    let c = calc.clientes.find(x => x.clave === k);
    if (!c) {   // un nombre corto unificado con «<nombre> - <negocio>» (CONFIG.unificar): se lo busca por sus pedidos
      const p = mezclar().find(x => S.norm(x.cliente) === k);
      if (p) c = calc.clientes.find(x => x.pedidoIds.includes(String(p.id)));
    }
    return c || null;
  }
  // { estado: 'cargando' | 'error' | 'sinpedidos' | 'ok', c, insignia: [texto, ícono, tono], pedidos (los últimos, del más nuevo al más viejo) }
  function contexto(nombre, opciones) {
    if (!nombre) return { estado: 'sinpedidos' };
    if (!(opciones && opciones.sinCargar)) asegurar();
    if (!E.historial) return { estado: E.error ? 'error' : 'cargando' };
    const c = buscarCliente(nombre);
    if (!c) return { estado: 'sinpedidos' };
    const r = { estado: 'ok', c, insignia: estado(c), alDia: c.bloque === 'notocar', pausaRevisar: !!(c.manual && c.manual.revisar) };
    if (opciones && opciones.pedidos) {
      const ids = new Set(c.pedidoIds);
      r.pedidos = mezclar().filter(p => ids.has(String(p.id))).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))).slice(0, opciones.pedidos);
    }
    return r;
  }
  function verCliente(nombre) {
    const c = E.historial && buscarCliente(nombre);
    E.abrirCon = c ? c.clave : null;
    if (typeof setTab === 'function') setTab('clientes');
  }

  // «Atender» y «Recuperación» vuelven solos a automático cuando el cliente pide de nuevo (decisión del usuario, 13/10). El motor ya lo muestra así;
  // acá se deja cerrada la decisión en el guardado (así un pedido que se cancele después no la revive) y se avisa qué clientes volvieron.
  async function cerrarAutomaticos(lista) {
    const al = almacenActual(), pend = lista.filter(x => !E.cerrados.has(x.id));
    if (!al || !pend.length || !puedeEditar() || E.ocupado) return;
    pend.forEach(x => E.cerrados.add(x.id));
    const hechos = [];
    for (const x of pend) {
      let r; try { r = await al.cerrarDecision({ clave: x.clave, nombre: x.nombre, espera: x.id, cierre: 'pedido_nuevo' }); } catch (e) { r = { ok: false }; }
      if (r.ok && !r.yaEstaba) hechos.push(x); else if (!r.ok && !r.conflicto) E.cerrados.delete(x.id);   // si falló por otra cosa se reintenta en el próximo refresco
    }
    if (!hechos.length) return;
    const dest = x => (x.tipo === 'atender' ? 'Atender' : 'Recuperación');
    E.aviso = { tono: 'info', html: hechos.length === 1
      ? `<b>${esc(hechos[0].nombre)}</b> pidió de nuevo (${esc(corta(hechos[0].fecha))}): volvió solo a automático (estaba en ${esc(dest(hechos[0]))}).`
      : `<b>${hechos.length} clientes</b> pidieron de nuevo y volvieron solos a automático: ${esc(hechos.map(x => `${x.nombre} (${dest(x)})`).join(', '))}.` };
    await cargarDatos(true);
  }

  // ── Textos ──
  const ico = (n, c) => (window.mIco ? mIco(n, c) : '');
  const fechaTitulo = () => { const d = F.aFecha(hoy()); const dia = S.DIAS[d.getDay()]; return `${dia[0].toUpperCase() + dia.slice(1)} ${d.getDate()} de ${['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'][d.getMonth()]}`; };
  const hora = ms => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const numTxt = v => String(Math.round(v * 10) / 10).replace('.', ',');
  const diasN = n => `${numTxt(n)} ${n === 1 ? 'día' : 'días'}`;
  const pedidosN = n => `${n} ${n === 1 ? 'pedido' : 'pedidos'}`;
  const corta = s => F.fmtCorta(s);
  // Por qué todavía no se conoce el ritmo propio del cliente (el número que se muestra en ese caso es una referencia de la cartera)
  function avisoRitmo(c) {
    if (c.refTipo === 'propio') return '';
    if (c.refTipo === 'poca') return `Pocos datos (${c.n} pedidos): todavía no conocemos bien su frecuencia`;
    if (c.refTipo === 'unico') return 'Un solo pedido: todavía no conocemos su frecuencia';
    if (c.refTipo === 'mismoDia') return `Sus ${c.n} pedidos son de un mismo día: todavía no conocemos su frecuencia`;
    return 'Sin pedidos recientes suficientes: todavía no conocemos su frecuencia';
  }
  const direccionDe = c => { const cli = ((estadoApp() && estadoApp().clientes) || []).find(x => String(x.n).toLowerCase() === c.nombre.toLowerCase()); return cli && cli.d ? cli.d : ''; };
  // estado que se ve en la insignia: [texto, ícono, tono]. Una decisión manual manda sobre el estado calculado.
  function estado(c) {
    const m = c.manual;
    if (m) return m.tipo === 'pausa' && m.revisar ? ['Revisar pausa', 'clock', 'aviso'] : ESTADOS_MANUAL[m.tipo];
    return c.bloque === 'notocar' ? ESTADOS_AL_DIA[c.motivo] : [TITULOS[c.bloque][0], TITULOS[c.bloque][2], TITULOS[c.bloque][3]];
  }
  const tono = c => estado(c)[2];
  const pill = c => { const [t, i, tn] = estado(c); return `<span class="sc-pill sc-t-${tn}">${ico(i, 'ico-sm')}${esc(t)}</span>`; };
  const tagManual = c => (c.manual && c.manual.tipo !== 'pausa' ? '<span class="sc-tag">Manual</span>' : '');

  // ── Fila de la lista ──
  // Nombre; dos datos alineados (desde el último pedido / frecuencia); y una última línea solo si ayuda. Los días sin pedir llevan el color
  // del estado (rojo, ámbar, azul, verde); el resto del texto va en tinta. El indicador de atraso no está acá: está en "Ver historial y cálculo".
  function metricas(c) {
    return `<span class="sc-met"><span class="sc-met-k">Desde el último</span> <b class="sc-met-ult">${esc(c.dias === 0 ? 'hoy' : diasN(c.dias))}</b></span>`
      + `<span class="sc-met"><span class="sc-met-k">${c.intervaloPropio ? 'Frecuencia' : 'Referencia de cartera'}</span> <b>${esc(diasN(c.intervalo))}</b></span>`;
  }
  function subFila(c, bloque) {
    const t = [], m = c.manual;
    if (m && m.tipo === 'pausa') t.push(esc(m.revisar ? `Revisión vencida (${corta(m.revision)})` : m.revision ? `Se revisa el ${corta(m.revision)}` : 'Sin fecha de revisión'));
    if (m && m.tipo === 'pausa' && m.nuevosPedidos) t.push('<span class="sc-ok">Nuevo pedido durante la pausa</span>');
    if (bloque === 'recuperacion' && c.lleva.length) t.push(esc('Llevaba: ' + c.lleva.slice(0, 3).join(', ')));
    else if (c.dejoDe.length) t.push(`<span class="sc-warn"><b>Dejó de llevar:</b> ${esc(c.dejoDe.map(d => d.nombre).join(', '))}</span>`);
    const av = avisoRitmo(c); if (av) t.push(`<span class="sc-warn">${esc(av)}</span>`);
    return t.length ? `<span class="sc-sub">${t.join(' · ')}</span>` : '';
  }
  // «Le escribimos …»: en los bloques de Para hoy, si se le mandó un WhatsApp después de su último pedido (aunque todavía no haya pedido).
  // Lo da whatsapp-inbox.js con una lectura liviana de los contactos vinculados; sin acceso a WhatsApp no aparece.
  const PARA_CONTACTAR = new Set(['atender', 'alta', 'semana', 'recuperacion', 'unica']);
  function contactadoPill(c, bloque) {
    const w = window.WhatsAppUI; if (!w || !w.contactado || !PARA_CONTACTAR.has(bloque || c.bloque)) return '';
    const f = w.contactado(c.nombre, c.ultimo); if (!f) return '';
    const d = new Date(f), k = F.ymd(d), dias = F.diffDias(hoy(), k);
    const cuando = dias <= 0 ? 'hoy' : dias === 1 ? 'ayer' : dias < 6 ? 'el ' + ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'][d.getDay()] : 'el ' + corta(k);
    return `<span class="sc-pill sc-t-info sc-pill--wa" title="Último WhatsApp que le mandamos, después de su último pedido">${ico('message-circle', 'ico-sm')}Le escribimos ${esc(cuando)}</span>`;
  }
  const asa = c => `<button type="button" class="sc-asa" data-sc="mover" data-k="${at(c.clave)}" aria-haspopup="dialog" aria-label="${at(`Mover a ${c.nombre}…`)}" title="Arrastralo a un destino, o tocá para elegir">${ico('grip-vertical')}</button>`;
  function fila(c, bloque, conEstado) {
    const edit = puedeEditar();
    return `<li class="sc-it${edit ? ' sc-it--edit' : ''}" data-k="${at(c.clave)}"><button type="button" class="sc-fila sc-t-${tono(c)}" data-sc="fila" data-k="${at(c.clave)}"${E.sel === c.clave ? ' aria-current="true"' : ''}>
        <span class="sc-fila-1"><span class="sc-nom">${esc(c.nombre)}</span>${tagManual(c)}${conEstado ? pill(c) : ''}${contactadoPill(c, bloque)}</span>
        <span class="sc-mets">${metricas(c)}</span>${subFila(c, bloque)}</button>${edit ? asa(c) : ''}</li>`;
  }

  // ── Ficha ──
  // ¿Cuánto pasó respecto de su ritmo? Dos barras horizontales, mismo origen (cero) y misma escala. Solo con ritmo propio.
  function comparacion(c) {
    if (c.refTipo === 'propio' || c.refTipo === 'poca') {
      const max = Math.max(c.intervalo, c.dias, 1), w = v => (v / max * 100).toFixed(1);
      const fila = (k, v, cls) => `<div class="sc-bh"><div class="sc-bh-t"><span class="sc-bh-k">${k}</span><span class="sc-bh-v${cls === 'sc-bh-b--act' ? ' sc-bh-v--act' : ''}"><b>${esc(numTxt(v))}</b> ${v === 1 ? 'día' : 'días'}</span></div><div class="sc-bh-pista"><i class="sc-bh-b ${cls}" style="width:${w(v)}%"></i></div></div>`;
      const desc = `Frecuencia habitual: ${diasN(c.intervalo)}. Desde el último pedido: ${diasN(c.dias)}. Misma escala, desde cero.`;
      return `<div class="sc-comp" role="img" aria-label="${at(desc)}">${fila('Frecuencia habitual', c.intervalo, 'sc-bh-b--ref')}${fila('Desde el último pedido', c.dias, 'sc-bh-b--act')}
        <div class="sc-bh-eje" aria-hidden="true"><span>0</span><span>${esc(numTxt(max))}</span></div></div>`
        + (c.refTipo === 'poca' ? nota('aviso', 'circle-alert', `<b>Pocos datos:</b> solo ${pedidosN(c.n)}. Todavía no conocemos bien su frecuencia; haber pasado su ritmo no confirma que haya dejado de comprar.`) : '');
    }
    // Sin ritmo propio no se dibuja una comparación que parezca personalizada: el número va solo y rotulado.
    return `<div class="sc-solo"><span class="sc-bh-k">Desde el último pedido</span><span class="sc-bh-v sc-bh-v--act"><b>${esc(numTxt(c.dias))}</b> ${c.dias === 1 ? 'día' : 'días'}</span></div>`
      + nota('aviso', 'circle-alert', `<b>Todavía sin ritmo propio.</b> ${esc(avisoRitmo(c))}. Referencia de cartera: cada ${esc(diasN(c.intervalo))}.`);
  }
  const nota = (tonoN, icono, html) => `<div class="sc-nota sc-t-${tonoN}">${ico(icono, 'ico-sm')}<p>${html}</p></div>`;

  // ¿Qué días suele pedir? Siete columnas de lunes a domingo, desde cero: pedidos cargados ese día en la ventana del motor.
  // El día habitual calculado lleva relleno de marca, ✓ y texto. Un cero es "cero pedidos registrados", nunca "no pide".
  function diasChart(c) {
    const min = S.UMBRALES.diaHabitualMin;
    if (!c.pedidosVentana) return '<p class="sc-vacio">Sin pedidos en los últimos 6 meses: no hay días para mostrar.</p>';
    const alcanza = c.pedidosVentana >= min, max = Math.max(1, ...SEMANA.map(d => c.porDia[d]));
    const cols = SEMANA.map(d => {
      const n = c.porDia[d], hab = c.diasHab.includes(d), h = n ? Math.max(3, Math.round(n / max * ALTO_COLUMNAS)) : 0;
      return `<li class="sc-c${hab ? ' sc-c--hab' : ''}" title="${at(`${S.DIAS[d]}: ${pedidosN(n)}${hab ? ' · día habitual calculado' : ''}`)}"><span class="sc-c-plot"><span class="sc-c-n">${n}</span><i class="sc-c-bar" style="height:${h}px"></i></span><span class="sc-c-d">${ABREV[d]}</span><span class="sc-c-m">${hab ? ico('check', 'ico-sm') : ''}</span></li>`;
    }).join('');
    const desc = `Pedidos por día de carga, de lunes a domingo: ${SEMANA.map(d => `${S.DIAS[d]} ${c.porDia[d]}`).join(', ')}.`;
    let pie;
    if (!alcanza) pie = nota('aviso', 'circle-alert', `<b>Pocos datos:</b> todavía sin día habitual (hacen falta ${min} pedidos de los últimos 6 meses y tiene ${c.pedidosVentana}).`);
    else if (c.diasHab.length) pie = `<p class="sc-leyenda"><b>Día habitual (calculado):</b> ${esc(S.textoDias(c.diasHab))}. Se mide por el día en que carga el pedido.</p>`;
    else pie = '<p class="sc-leyenda">Pide en distintos días: ninguno concentra el 30 % de sus pedidos.</p>';
    return `<div class="sc-dias"><ul class="sc-cols" role="img" aria-label="${at(desc)}">${cols}</ul><p class="sc-leyenda sc-leyenda--n">${esc(pedidosN(c.pedidosVentana))} analizados, últimos 6 meses.</p>${pie}</div>`;
  }

  // Pedido → entrega: el día de la semana en que pidió y el día en que se le entregó, de los últimos pedidos ya despachados.
  // Si siempre pide el lunes y se le entrega el martes, lo necesita para el día siguiente. Poco texto: una insignia y una tira de pares.
  const PLAZOS = {
    mismoDia: () => ['Lo necesita en el día', 'clock', 'aviso'],
    diaSiguiente: () => ['Lo necesita para el día siguiente', 'clock', 'aviso'],
    anticipado: pz => [`Pide con ${pz.mediana} días de anticipación`, 'calendar-days', 'info'],
    variable: () => ['Plazo variable', 'sliders-horizontal', 'neutro'],
  };
  function plazoSec(c) {
    const pz = c.plazo; if (!pz || !pz.n) return '';
    const dow = d => F.diaSemana(d);
    // los pares iguales se juntan ("lun → jue +3 ×8"): lo que importa es el patrón, no repetir ocho veces lo mismo
    const grupos = new Map();
    pz.ultimos.forEach(o => { const k = `${dow(o.carga)}>${dow(o.entrega)}>${o.dias}`; const g = grupos.get(k) || { o, n: 0 }; g.n++; grupos.set(k, g); });
    const orden = [...grupos.values()].sort((x, y) => y.n - x.n);
    const chips = orden.map(({ o, n }) => `<li class="sc-chip" title="${at(`${n} de ${pz.ultimos.length}: pidió ${S.DIAS[dow(o.carga)]}, entregado ${S.DIAS[dow(o.entrega)]}`)}"><span>${ABREV[dow(o.carga)]}</span>${ico('arrow-right', 'ico-sm')}<b class="sc-chip-e sc-chip-e--${o.dias <= 1 ? 'pronto' : 'antes'}">${ABREV[dow(o.entrega)]}</b>${o.dias >= 2 ? `<small>+${o.dias}</small>` : ''}${n > 1 ? `<small class="sc-chip-n">×${n}</small>` : ''}</li>`).join('');
    const resumenTxt = orden.map(({ o, n }) => `pidió ${S.DIAS[dow(o.carga)]} y se entregó ${S.DIAS[dow(o.entrega)]}: ${n} ${n === 1 ? 'vez' : 'veces'}`).join('; ');
    const tipo = PLAZOS[pz.tipo];
    const pill = tipo ? (([t, i, tn]) => `<span class="sc-pill sc-t-${tn}">${ico(i, 'ico-sm')}${esc(t)}</span>`)(tipo(pz)) : '';
    return `<section class="sc-f-sec"><h4>Pedido → entrega</h4>${pill}
      <ul class="sc-chips" role="img" aria-label="${at(`Día que pidió y día que se le entregó, últimos ${pz.ultimos.length} pedidos: ${resumenTxt}.`)}">${chips}</ul>
      <p class="sc-leyenda">${pz.tipo === 'pocos' ? `Pocos pedidos entregados (${pz.n}) para decir un plazo. ` : ''}Día en que pidió → día en que se le entregó (últimos ${pz.ultimos.length}).</p></section>`;
  }

  // Línea de tiempo con las últimas fechas de pedido. Se dibuja a escala (la distancia es proporcional a los días) y siempre trae la lista escrita.
  function lineaTiempo(c) {
    const fr = c.fechasRecientes, h = hoy();
    const items = fr.map((f, i) => `<li>${esc(F.fechaLarga(f.fecha))}${f.despacho ? '' : ' <span class="sc-carga">(carga)</span>'}${i ? ` · a los ${diasN(F.diffDias(f.fecha, fr[i - 1].fecha))}` : ''}</li>`).join('');
    const lista = `<ol class="sc-fechas">${items}<li class="sc-hoy">Hoy · ${c.dias === 0 ? 'pidió hoy' : `pasaron ${diasN(c.dias)} desde el último`}</li></ol>`;
    if (fr.length < 3) return `<p class="sc-vacio">Todavía hay muy pocas fechas de pedido (${c.nFechas}) para dibujar su ritmo.</p>${lista}`;
    const total = Math.max(1, F.diffDias(h, fr[0].fecha));
    const pos = d => Math.min(100, Math.max(0, F.diffDias(d, fr[0].fecha) / total * 100)).toFixed(1);
    const puntos = fr.map(f => `<i class="sc-punto" style="left:${pos(f.fecha)}%"></i>`).join('');
    const desc = `Línea de tiempo: ${fr.length} pedidos entre el ${F.fmtCorta(fr[0].fecha)} y el ${F.fmtCorta(fr[fr.length - 1].fecha)}; hoy es ${F.fmtCorta(h)}.`;
    return `<div class="sc-linea" role="img" aria-label="${at(desc)}"><span class="sc-eje"></span><span class="sc-eje sc-eje--espera" style="left:${pos(c.ultimo)}%"></span>${puntos}<i class="sc-punto sc-punto--hoy" style="left:100%"></i></div>
      <div class="sc-ejes"><span>${esc(F.fmtCorta(fr[0].fecha))}</span><span>hoy</span></div>${lista}`;
  }
  function historial(c) {
    const calculo = c.intervaloPropio
      ? `Frecuencia: la mediana de ${c.nIntervalos} ${c.nIntervalos === 1 ? 'intervalo' : 'intervalos'} entre fechas de pedido distintas (últimos 6 meses).`
      : `Sin ritmo propio: se usa de referencia la mediana de la cartera (${numTxt(c.intervalo)} días).`;
    const nf = c.fechasRecientes.length, ind = c.auto.razon;
    return `<details class="sc-hist" data-k="${at(c.clave)}"${E.ritmo.has(c.clave) ? ' open' : ''}><summary>${ico('history', 'ico-sm')}Ver historial y cálculo${ico('chevron-down', 'ico-sm sc-chev')}</summary>
      <div class="sc-hist-cuerpo">
        <p class="sc-tit-mini">${nf === 1 ? 'Único pedido' : `Últimos ${nf} pedidos`} · fecha de despacho (o de carga si todavía no se despachó)</p>
        ${lineaTiempo(c)}
        <p class="sc-leyenda">${esc(calculo)} ${esc(pedidosN(c.n))} en total.</p>
        <p class="sc-leyenda"><b>Indicador${c.manual ? ' del cálculo' : ''}:</b> ${esc(ind[0].toUpperCase() + ind.slice(1))}.</p>
      </div></details>`;
  }

  // Productos: lo que suele llevar y los avisos «Dejó de llevar» (ya sin los productos retirados o reemplazados ni las excepciones de este cliente).
  function productos(c) {
    const lista = (items, icono) => `<ul class="sc-prods">${items.map(t => `<li>${ico(icono, 'ico-sm')}<span>${esc(t)}</span></li>`).join('')}</ul>`;
    const edit = puedeEditar();
    const avisos = c.dejoDeTodos.length
      ? `<div class="sc-nota sc-t-aviso">${ico('triangle-alert', 'ico-sm')}<div class="sc-avisos"><p><b>Dejó de llevar:</b></p><ul>${c.dejoDeTodos.map(d => `<li><span>${esc(`${d.nombre} (lo llevó ${d.veces} veces; la última, hace ${d.hace} días)`)}</span>${edit ? `<button type="button" class="sc-link" data-sc="resolver" data-k="${at(c.clave)}" data-p="${at(d.clave)}">Resolver aviso</button>` : ''}</li>`).join('')}</ul></div></div>`
      : '';
    return `<section class="sc-f-sec"><h4>Productos</h4>
      ${c.lleva.length ? `<p class="sc-lbl">Suele llevar</p>${lista(c.lleva, 'package')}` : '<p class="sc-vacio">Todavía sin productos registrados.</p>'}
      ${avisos}${cambiosProductos(c)}</section>`;
  }
  // Lo que ya se explicó: producto retirado, otro producto parecido, excepción. Es contexto y se puede deshacer.
  // «Hay otro producto parecido» NO dice que sean lo mismo: se anota si el cliente ya pasó al otro y, si todavía no lo compró, se deja una nota visible para ofrecérselo.
  function cambiosProductos(c) {
    const cs = c.cambiosProductos; if (!cs.length) return '';
    const edit = puedeEditar();
    const deshacer = x => (edit && x.regla ? `<button type="button" class="sc-link" data-sc="reactivar" data-k="${at(c.clave)}" data-r="${at(x.regla)}" data-t="${at(x.tipo)}">Reactivar aviso</button>` : '');
    const llevaba = x => `${x.veces === 1 ? 'una vez' : `${x.veces} veces`}; la última, hace ${x.hace} días`;
    const alternativas = cs.filter(x => x.tipo === 'alternativa'), resto = cs.filter(x => x.tipo !== 'alternativa');
    const nota = alternativas.length
      ? `<div class="sc-nota sc-t-info">${ico('package', 'ico-sm')}<div class="sc-avisos"><ul>${alternativas.map(x => `<li><span><b>Compraba ${esc(x.de)}</b> <span class="sc-muted">(${esc(llevaba(x))})</span> y todavía no compró <b>${esc(x.a)}</b>. Se le puede ofrecer. <span class="sc-muted">Disponibilidad sin confirmar.</span></span>${deshacer(x)}</li>`).join('')}</ul></div></div>`
      : '';
    const linea = x => {
      if (x.tipo === 'cambio') return `<li><span><b>Ya pasó de ${esc(x.de)} a ${esc(x.a)}</b> <span class="sc-muted">(lo compró desde el ${esc(corta(x.fecha))}; del anterior llevaba ${esc(llevaba(x))})</span></span>${deshacer(x)}</li>`;
      if (x.tipo === 'retirado') return `<li><span><b>${esc(x.de)}:</b> ya no se vende <span class="sc-muted">(aviso resuelto para todos los clientes)</span></span>${deshacer(x)}</li>`;
      return `<li><span><b>${esc(x.de)}:</b> no aplica a este cliente${x.motivo ? ` <span class="sc-muted">(${esc(x.motivo)})</span>` : ''}${x.revisar ? ' <span class="sc-warn">· revisión vencida</span>' : ''}</span>${deshacer(x)}</li>`;
    };
    const detalle = resto.length ? `<details class="sc-cambios"${E.cambiosAbierto ? ' open' : ''}><summary>${ico('tag', 'ico-sm')}Cambios de productos (${resto.length})${ico('chevron-down', 'ico-sm sc-chev')}</summary><ul class="sc-cambios-l">${resto.map(linea).join('')}</ul></details>` : '';
    return nota + detalle;
  }

  // Estado del seguimiento de este cliente y las acciones para cambiarlo (solo con permiso de editar y con la base lista).
  function panelSeguimiento(c) {
    if (!datosOk()) return '';
    const m = c.manual, edit = puedeEditar(), k = at(c.clave);
    const mover = edit ? `<button type="button" class="sc-btn" data-sc="mover" data-k="${k}">${ico('sliders-horizontal', 'ico-sm')}${m ? 'Cambiar destino…' : 'Mover o pausar…'}</button>` : '';
    if (!m) return mover ? `<div class="sc-seg-acc">${mover}</div>` : '';
    const [t, i, tn] = estado(c);
    const lineas = [];
    if (m.motivoTxt) lineas.push(`<span class="sc-muted">Motivo:</span> ${esc(m.motivoTxt)}`);
    if (m.nota) lineas.push(`<span class="sc-muted">Nota:</span> ${esc(m.nota)}`);
    lineas.push(`<span class="sc-muted">Desde el ${esc(corta(m.desde))}${m.autor ? ` · lo marcó ${esc(m.autor)}` : ''}</span>`);
    if (m.tipo === 'pausa') lineas.push(m.revisar ? `<b>Venció la fecha de revisión (${esc(corta(m.revision))}):</b> decidí si se retoma o se extiende.` : m.revision ? `Se revisa el ${esc(corta(m.revision))}. La fecha es para revisar, no lo reactiva sola.` : 'Sin fecha: sigue en pausa hasta que se retome.');
    lineas.push(`<span class="sc-muted">Sin esto, el cálculo lo ubicaría en: ${esc(c.auto.bloque === 'notocar' ? ESTADOS_AL_DIA[c.auto.motivo][0] : TITULOS[c.auto.bloque][0])}.</span>`);
    // Atender y Recuperación vuelven solos a automático si pide de nuevo (no llegan acá); la pausa no se levanta sola.
    const aviso = m.tipo === 'pausa' && m.nuevosPedidos
      ? nota('info', 'circle-alert', `<b>Nuevo pedido durante la pausa</b> (el último, el ${esc(corta(m.ultimoNuevo))}). La pausa sigue hasta que la retomes.`)
      : '';
    const acciones = !edit ? '' : m.tipo === 'pausa'
      ? `<button type="button" class="sc-btn sc-btn--prim" data-sc="cerrar-decision" data-k="${k}" data-c="retomado">${ico('rotate-ccw', 'ico-sm')}Retomar seguimiento</button><button type="button" class="sc-btn" data-sc="destino" data-k="${k}" data-t="pausa">${ico('calendar-days', 'ico-sm')}Extender pausa…</button>${mover}`
      : `<button type="button" class="sc-btn" data-sc="cerrar-decision" data-k="${k}" data-c="automatico">${ico('refresh-cw', 'ico-sm')}Volver a automático</button>${mover}`;
    return `<section class="sc-manual sc-t-${tn}" aria-label="Seguimiento manual"><div class="sc-manual-cab"><span class="sc-manual-t">${ico(i, 'ico-sm')}Seguimiento manual: ${esc(t.toLowerCase())}</span></div>
      <ul class="sc-manual-l">${lineas.map(l => `<li>${l}</li>`).join('')}</ul>${aviso}${acciones ? `<div class="sc-btns">${acciones}</div>` : ''}</section>`;
  }

  function ficha(c) {
    const dir = direccionDe(c);
    return `<div class="sc-f sc-t-${tono(c)}">
      <button type="button" class="sc-volver" data-sc="volver">${ico('arrow-left', 'ico-sm')}Volver a la lista</button>
      <div class="sc-f-cab"><h3 class="sc-f-nom">${esc(c.nombre)}</h3>${pill(c)}</div>
      <p class="sc-f-dir">${ico('map-pin', 'ico-sm')}<span>${dir ? esc(dir) : 'Dirección sin completar'}</span></p>
      <p class="sc-f-ult">${ico('calendar', 'ico-sm')}<span>Último pedido: <b>${esc(F.fechaLarga(c.ultimo))}</b> <span class="sc-muted">(${c.ultimoDespacho ? 'fecha de despacho' : 'fecha de carga: todavía no se despachó'})</span></span></p>
      ${panelSeguimiento(c)}
      <button type="button" class="sc-wa-link" data-wa-client="${esc(c.nombre)}">WhatsApp e historial de contacto</button>
      <section class="sc-f-sec sc-f-sec--1"><h4>¿Cuánto pasó respecto de su ritmo?</h4>${comparacion(c)}</section>
      <section class="sc-f-sec"><h4>¿Qué días suele pedir?</h4>${diasChart(c)}</section>
      ${plazoSec(c)}
      ${productos(c)}
      ${c.observacion ? `<section class="sc-f-sec"><h4>Observación</h4><p class="sc-obs">${esc(c.observacion.texto)} <span class="sc-muted">(${esc(F.fmtCorta(c.observacion.fecha))})</span></p></section>` : ''}
      ${historial(c)}
    </div>`;
  }
  function fichaVacia(aviso) {
    return `<div class="sc-f-vacio">${ico('users')}<p><b>${esc(aviso || 'Elegí un cliente para ver su seguimiento.')}</b></p><p class="sc-muted">Elegir un cliente no registra ningún contacto.</p></div>`;
  }
  // Si el cliente elegido ya no figura (se actualizó la lista), se dice y se limpia el detalle viejo.
  function contenidoFicha(calc) {
    if (E.sel) {
      const c = calc.clientes.find(x => x.clave === E.sel);
      if (c) return ficha(c);
      E.sel = null; E.fichaAbierta = false;
      return fichaVacia('El cliente que tenías abierto ya no figura en el seguimiento: la lista se actualizó.');
    }
    return fichaVacia();
  }

  // ── Bloques de "Para hoy" ──
  function bloque(clave, items, opciones) {
    const [titulo, sub, icono, tn] = TITULOS[clave];
    const o = opciones || {};
    const cab = `<span class="sc-ib sc-t-${tn}">${ico(icono)}</span><span class="sc-tit sc-t-${tn}">${esc(titulo)}</span><span class="sc-cant sc-t-${tn}">${items.length}</span>`;
    const cuerpo = items.length ? `<ol class="sc-ol">${items.map(c => fila(c, clave, false)).join('')}</ol>` : '<p class="sc-nadie">Nadie por ahora.</p>';
    const copiar = o.copiar && items.length ? `<button type="button" class="sc-link" data-sc="copiar" data-b="${clave}">${ico('copy', 'ico-sm')}Copiar lista</button>` : '';
    if (o.plegado) {
      return `<details class="sc-bloque sc-bloque--${clave}"${E['abierto_' + clave] ? ' open' : ''} data-b="${clave}"><summary><span class="sc-bh1">${cab}</span><span class="sc-subt">${esc(sub)}</span></summary>${o.antes || ''}${cuerpo}${copiar ? `<div class="sc-pie">${copiar}</div>` : ''}</details>`;
    }
    return `<section class="sc-bloque sc-bloque--${clave}" data-b="${clave}"><div class="sc-bhead"><h3 class="sc-bh1" tabindex="-1">${cab}</h3>${copiar}</div><p class="sc-subt">${esc(sub)}</p>${cuerpo}</section>`;
  }
  const bloquesHoy = calc => (calc.bloques.atender.length ? ['atender'] : []).concat(BLOQUES_HOY);
  // Franja de resumen: nombre y cantidad de cada bloque; al tocar lleva al bloque (y lo abre si está plegado). No cambia nada del cálculo.
  function resumen(calc) {
    return `<nav class="sc-resumen" aria-label="Resumen por bloque">${bloquesHoy(calc).map(b => {
      const [t, , i, tn] = TITULOS[b];
      return `<button type="button" class="sc-res sc-t-${tn}" data-sc="ir" data-b="${b}">${ico(i, 'ico-sm')}<span class="sc-res-t">${esc(t)}</span><span class="sc-res-n">${calc.bloques[b].length}</span></button>`;
    }).join('')}</nav>`;
  }

  // ── Pantalla ──
  function vistas(calc) {
    const b = (v, txt, extra) => `<button type="button" class="sc-vista" data-sc="vista" data-v="${v}" aria-pressed="${E.vista === v}">${txt}${extra || ''}</button>`;
    const conPausa = datosOk();
    return `<div class="sc-vistas${conPausa ? ' sc-vistas--3' : ''}" role="group" aria-label="Vista">${b('hoy', 'Para hoy')}${b('clientes', 'Clientes', ` <span class="sc-cant">${calc.clientes.length}</span>`)}${conPausa ? b('pausa', 'En pausa', ` <span class="sc-cant${calc.pausa.revisar ? ' sc-t-aviso' : ''}">${calc.pausa.total}</span>`) : ''}</div>`;
  }
  // Avisos de la pantalla (guardado, conflicto, datos viejos): se ven arriba y se pueden cerrar.
  function avisos() {
    const t = [];
    if (E.datos.error) t.push(`<p class="sc-aviso sc-aviso--error" role="alert">No se pudieron actualizar las pausas y movimientos. Lo que ves es de las ${esc(hora(E.datos.ultimoOk))} y puede estar desactualizado. <button type="button" class="sc-link" data-sc="reintentar-datos">Reintentar</button></p>`);
    if (E.aviso) t.push(`<div class="sc-banner sc-t-${E.aviso.tono || 'aviso'}" role="alert">${ico(E.aviso.tono === 'error' ? 'circle-alert' : 'info', 'ico-sm')}<p>${E.aviso.html}</p><button type="button" class="sc-x" data-sc="cerrar-aviso" aria-label="Cerrar aviso">${ico('x', 'ico-sm')}</button></div>`);
    return t.join('');
  }
  // Sin poder leer las decisiones guardadas no se muestra la agenda del día: podría incluir a clientes que están en pausa.
  const bloqueado = () => E.datos.estado === 'error' || E.datos.estado === 'sinPermiso';
  function estadoDatos() {
    const sinPermiso = E.datos.estado === 'sinPermiso';
    return `<div class="sc-estado" role="alert"><b>${sinPermiso ? 'Tu usuario todavía no tiene permiso para el seguimiento.' : 'No se pudieron cargar las pausas y los movimientos.'}</b><p>${sinPermiso ? 'Avisale a quien administra la app. Mientras tanto no se muestra la lista de hoy.' : 'Sin eso, la lista de hoy podría incluir a clientes que están en pausa. Revisá la conexión y probá de nuevo.'}${E.datos.mensaje ? ` <span class="sc-muted">(${esc(E.datos.mensaje)})</span>` : ''}</p><button type="button" class="sc-accion" data-sc="reintentar-datos">Reintentar</button></div>`;
  }
  function render() {
    const raiz = $('sc-raiz'); if (!raiz) return;
    if (E.arr && E.arr.activo) { E.renderPendiente = true; return; }   // no se redibuja a mitad de un arrastre
    if ((E.cargando && !E.historial) || (E.datos.estado === 'pendiente' && almacenActual())) { raiz.className = 'sc'; raiz.innerHTML = esqueleto(); return; }
    if (E.error && !E.historial) {
      // Sin el historial completo no se muestra ninguna clasificación: con una parte de los pedidos saldría un ritmo falso.
      raiz.className = 'sc';
      raiz.innerHTML = `<div class="sc-estado" role="alert"><b>No se pudo traer el historial de pedidos.</b><p>Sin el historial no se puede ver cada cuánto pide cada cliente. Revisá la conexión y probá de nuevo.</p><button type="button" class="sc-accion" data-sc="reintentar">Reintentar</button></div>`;
      return;
    }
    const calc = recalcular();
    if (!calc.clientes.length) { raiz.className = 'sc'; raiz.innerHTML = `<div class="sc-estado"><b>Todavía no hay pedidos para analizar.</b><p>Cuando se carguen pedidos, acá aparece a quién escribirle cada mañana.</p></div>`; return; }
    if (E.vista === 'pausa' && !datosOk()) E.vista = 'hoy';
    const aviso = E.cargando ? '<p class="sc-aviso">Actualizando historial…</p>'
      : E.error ? `<p class="sc-aviso sc-aviso--error" role="alert">No se pudo actualizar el historial. Lo que ves es de las ${esc(hora(E.ts))} y puede estar desactualizado. <button type="button" class="sc-link" data-sc="reintentar">Reintentar</button></p>` : '';
    const enHoy = E.vista === 'hoy', conResumen = enHoy && !bloqueado();
    const lateral = contenidoFicha(calc);   // antes que la lista: si el elegido ya no figura, la lista no lo marca
    raiz.className = 'sc' + (E.fichaAbierta ? ' sc--ficha' : '');
    raiz.innerHTML = `<div class="sc-cab"><div class="sc-cab-t"><h2>Seguimiento</h2><p class="sc-fecha">${esc(fechaTitulo())}</p></div>${vistas(calc)}</div>${aviso}${avisos()}${conResumen ? resumen(calc) : ''}
      <div class="sc-area${E.fichaAbierta ? ' sc-area--ficha' : ''}" id="sc-area">
        <div class="sc-col sc-col--lista">${E.vista === 'clientes' ? `<label class="sc-buscar">${ico('search', 'ico-sm')}<input type="search" id="sc-q" placeholder="Buscar un cliente" aria-label="Buscar un cliente" autocomplete="off" value="${at(E.q)}"></label>` : ''}<div id="sc-cuerpo">${cuerpo(calc)}</div></div>
        <aside class="sc-col sc-col--ficha" id="sc-ficha" aria-label="Ficha del cliente">${lateral}</aside>
      </div>`;
    restaurarFoco();
    if (calc.cierresPendientes.length && !E.dlg && !(E.arr && E.arr.activo)) setTimeout(() => cerrarAutomaticos(calc.cierresPendientes), 0);
  }

  function resultados(calc) {
    const q = S.norm(E.q);
    return calc.clientes.filter(c => !q || S.norm(c.nombre).includes(q)).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }
  // «En pausa»: salen de «Para hoy» y de «Copiar lista»; sus pedidos se siguen cargando y despachando con normalidad.
  function vistaPausa(calc) {
    const todos = calc.bloques.pausa, rev = todos.filter(c => c.manual.revisar), lista = E.filtroPausa === 'revisar' ? rev : todos;
    const f = (v, txt, n) => `<button type="button" class="sc-filtro" data-sc="filtro-pausa" data-f="${v}" aria-pressed="${E.filtroPausa === v}">${txt} <span class="sc-cant">${n}</span></button>`;
    return `<section class="sc-bloque sc-bloque--pausa"><div class="sc-bhead"><h3 class="sc-bh1"><span class="sc-ib sc-t-neutro">${ico('pause')}</span><span class="sc-tit">En pausa</span><span class="sc-cant">${todos.length}</span></h3></div>
      <p class="sc-subt">No aparecen en «Para hoy». Se les siguen cargando y despachando los pedidos con normalidad. Pausar no es una baja ni impide venderles.</p>
      <div class="sc-filtros" role="group" aria-label="Filtro">${f('todas', 'Todas', todos.length)}${f('revisar', 'Para revisar', rev.length)}</div>
      ${lista.length ? `<ol class="sc-ol">${lista.map(c => fila(c, 'pausa', true)).join('')}</ol>` : `<p class="sc-nadie">${todos.length ? 'Ninguna pausa tiene la revisión vencida.' : 'Nadie en pausa.'}</p>`}</section>`;
  }
  function cuerpo(calc) {
    if (E.vista === 'pausa' && datosOk()) return vistaPausa(calc);
    if (E.vista === 'clientes') {
      const q = S.norm(E.q), res = resultados(calc);
      return res.length
        ? `<section class="sc-bloque sc-bloque--todos"><div class="sc-bhead"><h3 class="sc-bh1"><span class="sc-tit">${q ? 'Resultados' : 'Cartera'}</span><span class="sc-cant">${res.length}</span></h3></div>${q ? '' : '<p class="sc-subt">Por orden alfabético, con el estado de cada uno (también los que están dentro de su ciclo y los que están en pausa). Elegí un cliente para ver su ficha.</p>'}<ol class="sc-ol">${res.map(c => fila(c, c.bloque, true)).join('')}</ol></section>`
        : '<p class="sc-nadie">Ningún cliente coincide.</p>';
    }
    if (bloqueado()) return estadoDatos();
    const B = calc.bloques;
    return (B.atender.length ? bloque('atender', B.atender, { copiar: true }) : '') + bloque('alta', B.alta, { copiar: true }) + bloque('semana', B.semana, { copiar: true }) + bloque('recuperacion', B.recuperacion, { copiar: true })
      + bloque('unica', B.unica, { plegado: true, copiar: true });
  }

  // Al escribir en el buscador solo se cambia la lista: el campo y el teclado no se tocan. Si el elegido deja de estar entre los resultados,
  // la ficha se limpia (no queda un cliente oculto presentado como si fuera un resultado).
  function renderBusqueda() {
    const c = $('sc-cuerpo'); if (!c || !E.calc) return render();
    const calc = recalcular(); c.innerHTML = cuerpo(calc);
    if (E.sel && !resultados(calc).some(x => x.clave === E.sel)) { E.sel = null; E.fichaAbierta = false; $('sc-ficha').innerHTML = fichaVacia(); $('sc-area').classList.remove('sc-area--ficha'); $('sc-raiz').classList.remove('sc--ficha'); }
  }
  function esqueleto() {
    return `<div class="sc" aria-busy="true"><div class="sc-cab"><div class="sc-cab-t"><h2>Seguimiento</h2><p class="sc-fecha">Cargando el historial de pedidos…</p></div></div>${'<div class="sc-esq"><i></i><i></i></div>'.repeat(6)}</div>`;
  }

  // ── Acciones ──
  // Elegir una fila reemplaza la ficha; no abre nada entre las filas ni mueve la lista. En pantallas angostas la ficha ocupa el lugar de la lista.
  function seleccionar(k, boton) {
    const c = E.calc && E.calc.clientes.find(x => x.clave === k); if (!c) return;
    E.scrollLista = window.scrollY; E.sel = k; E.fichaAbierta = true;
    document.querySelectorAll('#sc-raiz .sc-fila[aria-current]').forEach(x => x.removeAttribute('aria-current'));
    if (boton) boton.setAttribute('aria-current', 'true');
    const f = $('sc-ficha'); f.innerHTML = ficha(c); f.scrollTop = 0;
    $('sc-area').classList.add('sc-area--ficha'); $('sc-raiz').classList.add('sc--ficha');
    if (!ancho()) { window.scrollTo(0, 0); const v = f.querySelector('.sc-volver'); if (v) v.focus({ preventScroll: true }); }
  }
  function volver() {
    E.fichaAbierta = false; $('sc-area').classList.remove('sc-area--ficha'); $('sc-raiz').classList.remove('sc--ficha');
    window.scrollTo(0, E.scrollLista);
    const b = E.sel && document.querySelector(`#sc-raiz .sc-fila[data-k="${CSS.escape(E.sel)}"]`); if (b) b.focus({ preventScroll: true });
  }
  function irA(clave) {
    const el = document.querySelector(`#sc-cuerpo [data-b="${clave}"]`); if (!el) return;
    if (el.tagName === 'DETAILS') { el.open = true; E['abierto_' + clave] = true; }
    el.scrollIntoView({ block: 'start' });
    const h = el.querySelector('.sc-bh1[tabindex]'); if (h) h.focus({ preventScroll: true });
  }
  function textoBloque(clave) {
    const items = E.calc.bloques[clave];
    return `${TITULOS[clave][0]} (${fechaTitulo()})\n` + items.map((c, i) => S.lineaTexto(c, i)).join('\n');
  }
  function copiar(clave) {
    const txt = textoBloque(clave);
    const listo = () => { if (typeof toast === 'function') toast('Lista copiada'); };
    if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(txt).then(listo, () => copiarViejo(txt, listo)); } else copiarViejo(txt, listo);
  }
  function copiarViejo(txt, listo) {
    const t = document.createElement('textarea'); t.value = txt; t.setAttribute('readonly', ''); t.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
    document.body.appendChild(t); t.select(); try { document.execCommand('copy'); listo(); } catch (e) { /* sin permiso: no se copia */ } t.remove();
  }

  // ═══ Mover, pausar y resolver avisos (IDEA-10/11/12) ═══
  const clienteDe = k => (E.calc && E.calc.clientes.find(x => x.clave === k)) || null;
  const destinoActual = c => (c.manual ? c.manual.tipo : 'automatico');
  // Al cerrar un diálogo o redibujar, el foco vuelve a donde estaba la persona (el asa o la fila del cliente), no al principio de la página.
  function restaurarFoco() {
    const f = E.foco; if (!f) return;
    const d = $('sc-dlg'); if (d && d.open) return;   // con un diálogo abierto el foco es del diálogo; se restaura al cerrarlo
    E.foco = null;
    const el = document.querySelector(`#sc-raiz ${f.asa ? '.sc-asa' : '.sc-fila'}[data-k="${CSS.escape(f.k)}"]`) || document.querySelector(`#sc-raiz .sc-fila[data-k="${CSS.escape(f.k)}"]`);
    if (el) el.focus({ preventScroll: true });
  }
  function dialogo() {
    let d = $('sc-dlg');
    if (!d) {
      d = document.createElement('dialog'); d.id = 'sc-dlg'; d.className = 'sc-dlg'; d.setAttribute('aria-labelledby', 'sc-dlg-t');
      d.addEventListener('close', () => { E.dlg = null; if (E.renderPendiente) { E.renderPendiente = false; render(); } restaurarFoco(); });
      document.body.appendChild(d);
    }
    return d;
  }
  function abrirDlg(html, foco) {
    cerrarToast();
    const d = dialogo(); d.innerHTML = html;
    if (!d.open) { if (d.showModal) d.showModal(); else d.setAttribute('open', ''); }
    const el = foco ? d.querySelector(foco) : null; if (el) el.focus();
  }
  function cerrarDlg() { const d = $('sc-dlg'); if (d && d.open) d.close(); }
  const errorDlg = txt => { const e = document.querySelector('#sc-dlg .sc-dlg-err'); if (e) { e.textContent = txt; e.hidden = !txt; } };
  const ocupar = (si) => { E.ocupado = si; document.querySelectorAll('#sc-dlg button, #sc-dlg input, #sc-dlg textarea, #sc-dlg select').forEach(x => { x.disabled = si; }); };

  // Paso 1: elegir el destino (también es lo que se abre al tocar el asa, en teclado y en celular)
  function abrirMenu(k, asaFoco) {
    const c = clienteDe(k); if (!c || !puedeEditar()) return;
    E.foco = { k, asa: !!asaFoco };
    E.dlg = { k, espera: c.manual ? c.manual.id : null, paso: 'menu' };
    const actual = destinoActual(c);
    const op = t => {
      if (t === actual && t !== 'pausa') return '';
      const [nom, desc, icono, tn] = DESTINOS[t];
      const etiqueta = t === 'pausa' && actual === 'pausa' ? 'Extender o cambiar la pausa' : t === 'pausa' ? 'Pausar seguimiento' : t === 'automatico' ? 'Volver a automático' : t === 'recuperacion' ? 'Pasar a Recuperación' : 'Pasar a Atender';
      return `<li><button type="button" class="sc-op sc-t-${tn}" data-d="destino" data-t="${t}"><span class="sc-ib sc-t-${tn}">${ico(icono)}</span><span class="sc-op-t"><b>${esc(etiqueta)}</b><span>${esc(desc)}</span></span></button></li>`;
    };
    abrirDlg(`<div class="sc-dlg-c"><h3 id="sc-dlg-t">${esc(c.nombre)}</h3>
      <p class="sc-dlg-s">Elegí dónde trabajarlo. <b>No cambia sus pedidos ni sus números.</b> Hoy: ${esc(estado(c)[0])}.</p>
      <ul class="sc-ops">${['atender', 'recuperacion', 'pausa', 'automatico'].filter(t => t !== 'automatico' || c.manual).map(op).join('')}</ul>
      <div class="sc-dlg-pie"><button type="button" class="sc-btn" data-d="cerrar">Cancelar</button></div></div>`, '.sc-op');
  }
  // Paso 2: motivo y, en la pausa, hasta cuándo se revisa. «Automático» no pide nada.
  function elegirDestino(k, t, desdeArrastre) {
    const c = clienteDe(k); if (!c || !puedeEditar()) return;
    if (t === 'automatico') return cerrarDecision(k, 'automatico');
    if (!E.dlg || E.dlg.k !== k) { E.foco = { k, asa: true }; E.dlg = { k, espera: c.manual ? c.manual.id : null }; }
    E.dlg.paso = 'form'; E.dlg.tipo = t;
    const m = c.manual, [nom, , icono, tn] = DESTINOS[t];
    const titulo = t === 'pausa' ? (m && m.tipo === 'pausa' ? 'Extender la pausa' : 'Pausar seguimiento') : `Pasar a ${nom}`;
    const motivoPrevio = m ? m.motivo : '', notaPrevia = m ? m.nota : '';
    const chips = Object.entries(S.MOTIVOS).map(([v, txt]) => `<label class="sc-chipsel"><input type="radio" name="motivo" value="${v}"${v === motivoPrevio ? ' checked' : ''}><span>${esc(txt)}</span></label>`).join('');
    const base = m && m.tipo === 'pausa' && m.revision && m.revision > hoy() ? m.revision : hoy();
    const fechaSug = F.sumarDias(base, 7), sinFecha = !!(m && m.tipo === 'pausa' && !m.revision);
    const pausa = t === 'pausa' ? `<fieldset class="sc-fs"><legend>¿Cuándo se revisa?</legend>
        <label class="sc-radio"><input type="radio" name="rev" value="fecha"${sinFecha ? '' : ' checked'}><span>En una fecha</span></label>
        <input type="date" name="fecha" class="sc-fecha-in" value="${at(fechaSug)}" min="${at(F.sumarDias(hoy(), 1))}" aria-label="Fecha de revisión">
        <label class="sc-radio"><input type="radio" name="rev" value="nunca"${sinFecha ? ' checked' : ''}><span>Cuando lo retomemos</span></label>
        <p class="sc-dlg-n">La fecha es para <b>revisar</b>: ese día aparece en «En pausa» para decidir. No lo reactiva solo ni es un compromiso del cliente.</p></fieldset>` : '';
    abrirDlg(`<form class="sc-dlg-c" data-d="form" novalidate><h3 id="sc-dlg-t">${esc(titulo)}</h3>
      <p class="sc-dlg-s"><b>${esc(c.nombre)}</b> · ${esc(DESTINOS[t][1])} No cambia sus pedidos ni sus números.</p>
      <fieldset class="sc-fs"><legend>Motivo${t === 'atender' ? ' <span class="sc-muted">(opcional)</span>' : ''}</legend><div class="sc-chipsels">${chips}</div></fieldset>
      <label class="sc-campo"><span>Nota <span class="sc-muted">(opcional, no hace falta escribir un párrafo)</span></span><textarea name="nota" rows="2" maxlength="500">${esc(notaPrevia)}</textarea></label>
      ${pausa}<p class="sc-dlg-err" role="alert" hidden></p>
      <div class="sc-dlg-pie"><button type="button" class="sc-btn" data-d="${desdeArrastre ? 'cerrar' : 'atras'}">${desdeArrastre ? 'Cancelar' : 'Atrás'}</button><button type="submit" class="sc-accion">${esc(t === 'pausa' ? 'Pausar' : 'Guardar')}</button></div></form>`, 'input[name="motivo"]:checked, input[name="motivo"]');
  }
  async function guardarDecision(form) {
    const k = E.dlg && E.dlg.k, t = E.dlg && E.dlg.tipo, c = clienteDe(k); if (!c || E.ocupado) return;
    const motivo = (form.querySelector('input[name="motivo"]:checked') || {}).value || (t === 'atender' ? 'otro' : '');
    if (!motivo) return errorDlg('Elegí un motivo: alcanza con tocar uno.');
    const nota = form.querySelector('[name="nota"]').value.trim();
    let revision = '';
    if (t === 'pausa' && (form.querySelector('input[name="rev"]:checked') || {}).value === 'fecha') {
      revision = form.querySelector('[name="fecha"]').value;
      if (!revision || revision <= hoy()) return errorDlg('Elegí una fecha de revisión posterior a hoy, o «Cuando lo retomemos».');
    }
    errorDlg(''); ocupar(true);
    const previo = c.manual, al = almacenActual();
    const r = await al.decidir({ clave: c.clave, nombre: c.nombre, tipo: t, motivo, nota, revision, conocidos: c.pedidoIds, espera: E.dlg.espera });
    ocupar(false);
    if (r.ok) { ocupar(true); await recargar(); ocupar(false); cerrarDlg(); avisoAccion(`${c.nombre}: ${t === 'pausa' ? 'quedó en pausa' : 'pasó a ' + DESTINOS[t][0]}.`, { k: c.clave, nombre: c.nombre, nuevoId: r.id, previo }); }
    else if (r.conflicto) await conflicto(c, r);
    else errorDlg(`No se pudo guardar${r.error ? ' (' + r.error + ')' : ''}. ${c.nombre} sigue donde estaba. Probá de nuevo.`);
  }
  async function cerrarDecision(k, cierre) {
    const c = clienteDe(k); if (!c || !puedeEditar() || E.ocupado) return;
    if (!c.manual) return;
    E.foco = E.foco || { k, asa: false };
    E.ocupado = true;
    const previo = c.manual, espera = E.dlg && E.dlg.k === k && E.dlg.espera ? E.dlg.espera : previo.id;
    const r = await almacenActual().cerrarDecision({ clave: c.clave, nombre: c.nombre, espera, cierre });
    E.ocupado = false;
    if (r.ok) { await recargar(); cerrarDlg(); avisoAccion(`${c.nombre}: ${cierre === 'retomado' ? 'se retomó el seguimiento' : 'volvió a automático'}.`, { k: c.clave, nombre: c.nombre, nuevoId: null, previo }); }
    else if (r.conflicto) await conflicto(c, r);
    else { cerrarDlg(); E.aviso = { tono: 'error', html: esc(`No se pudo guardar${r.error ? ' (' + r.error + ')' : ''}. ${c.nombre} sigue donde estaba.`) }; render(); }
  }
  // Otra persona cambió al cliente antes: no se pisa su decisión. Se vuelve a leer y se avisa quién fue.
  async function conflicto(c, r) {
    ocupar(true); await recargar(); ocupar(false); cerrarDlg();
    const a = r.actual, que = a ? `${a.autor ? esc(a.autor) : 'Otra persona'} ya lo cambió a «${esc(DESTINOS[a.tipo] ? DESTINOS[a.tipo][0] : a.tipo)}»` : 'Otra persona ya cambió su estado';
    E.aviso = { tono: 'aviso', html: `<b>${esc(c.nombre)}:</b> ${que}. Se actualizó la pantalla; revisalo y, si hace falta, volvé a intentarlo.` }; render();
  }
  async function recargar() { await cargarDatos(true); }

  // Aviso con «Deshacer» (vuelve a la decisión anterior; el historial queda). Se cierra solo.
  let temporizador = null;
  function avisoAccion(texto, deshacer) {
    E.deshacer = deshacer;
    let t = $('sc-toast');
    if (!t) { t = document.createElement('div'); t.id = 'sc-toast'; t.className = 'sc-toast'; t.setAttribute('role', 'status'); t.setAttribute('aria-live', 'polite'); document.body.appendChild(t); }
    t.innerHTML = `<span>${esc(texto)}</span><button type="button" class="sc-link sc-link--claro" data-sc="deshacer">${ico('undo-2', 'ico-sm')}Deshacer</button><button type="button" class="sc-x sc-x--claro" data-sc="cerrar-toast" aria-label="Cerrar">${ico('x', 'ico-sm')}</button>`;
    t.hidden = false; clearTimeout(temporizador); temporizador = setTimeout(cerrarToast, 12000);
  }
  function cerrarToast() { const t = $('sc-toast'); if (t) t.hidden = true; E.deshacer = null; clearTimeout(temporizador); }
  async function deshacer() {
    const d = E.deshacer; if (!d || E.ocupado) return; cerrarToast();
    const al = almacenActual(), c = clienteDe(d.k); E.ocupado = true; let r;
    if (d.regla) {   // se acaba de crear una regla de producto: se deshace sin pedir confirmación (se hizo hace segundos)
      r = await al.cerrarRegla(d.regla); E.ocupado = false;
      if (r.ok) { await recargar(); E.aviso = { tono: 'ok', html: 'El aviso se volvió a calcular con el historial.' }; render(); }
      else { E.aviso = { tono: 'error', html: esc(`No se pudo deshacer${r.error ? ' (' + r.error + ')' : ''}.`) }; render(); }
      return;
    }
    if (!d.previo) r = await al.cerrarDecision({ clave: d.k, nombre: d.nombre, espera: d.nuevoId, cierre: 'deshecha' });
    else {
      const p = d.previo;
      r = await al.decidir({ clave: d.k, nombre: d.nombre, tipo: p.tipo, motivo: p.motivo || 'otro', nota: p.nota, revision: p.revision, conocidos: p.conocidos, espera: d.nuevoId });
    }
    E.ocupado = false;
    if (r.ok) { await recargar(); E.aviso = { tono: 'ok', html: esc(`${d.nombre}: volvió a como estaba.`) }; render(); }
    else if (r.conflicto) await conflicto(c || { nombre: d.nombre }, r);
    else { E.aviso = { tono: 'error', html: esc(`No se pudo deshacer${r.error ? ' (' + r.error + ')' : ''}.`) }; render(); }
  }

  // ── Avisos «Dejó de llevar»: producto retirado, con reemplazo, o excepción de este cliente ──
  const claveProd = nombre => S.norm(S.nombreProducto(nombre));
  function abrirAviso(k, claveProducto) {
    const c = clienteDe(k); if (!c || !puedeEditar()) return;
    const q = c.dejoDeTodos.find(x => x.clave === claveProducto); if (!q) return;
    E.foco = { k, asa: false }; E.dlg = { k, paso: 'aviso', producto: claveProducto };
    const afectados = S.alcanceAviso(E.calc, claveProducto);
    const cat = ((estadoApp() && estadoApp().products) || []), delCatalogo = cat.find(p => claveProd(p.n) === claveProducto);
    const baja = delCatalogo && delCatalogo.act === false ? `<p class="sc-dlg-n">${ico('info', 'ico-sm')}El catálogo lo tiene dado de baja. Eso solo no dice si tiene reemplazo ni desde cuándo.</p>` : '';
    const lista = afectados.slice(0, 8).map(a => esc(a.nombre)).join(', ') + (afectados.length > 8 ? ` y ${afectados.length - 8} más` : '');
    const opciones = cat.filter(p => p.act !== false && claveProd(p.n) !== claveProducto).map(p => `<option value="${at(p.n)}"></option>`).join('');
    const chips = MOTIVOS_EXCEPCION.map(m => `<label class="sc-chipsel"><input type="radio" name="motivo" value="${at(m)}"><span>${esc(m)}</span></label>`).join('');
    abrirDlg(`<form class="sc-dlg-c" data-d="form-aviso" novalidate><h3 id="sc-dlg-t">Resolver aviso: ${esc(q.nombre)}</h3>
      <p class="sc-dlg-s"><b>${esc(c.nombre)}</b> lo llevó ${q.veces} veces; la última, hace ${q.hace} días. Resolver el aviso no borra ninguna compra: la historia queda igual.</p>${baja}
      <div class="sc-radios" role="radiogroup" aria-label="Qué pasó con el producto">
        <label class="sc-radio sc-radio--g"><input type="radio" name="regla" value="retirado"><span><b>Ya no lo vendemos</b><small>Para todos los clientes. Solo saca el aviso del seguimiento: no cambia el catálogo ni impide vender lo que quede.</small></span></label>
        <label class="sc-radio sc-radio--g"><input type="radio" name="regla" value="reemplazo"><span><b>Hay otro producto parecido</b><small>Para todos los clientes. Sirve para ver quién ya pasó al otro y a quién ofrecérselo. No dice que sean lo mismo: quien dejó de comprar sigue sin figurar como que «cambió».</small></span></label>
        <label class="sc-radio sc-radio--g"><input type="radio" name="regla" value="excepcion"><span><b>No aplica a este cliente</b><small>Solo para ${esc(c.nombre)}. Los demás clientes siguen igual.</small></span></label></div>
      <div class="sc-sub-campos" data-para="reemplazo" hidden><label class="sc-campo"><span>¿Cuál es el otro producto?</span><input type="text" name="sustituto" list="sc-dl-prods" autocomplete="off" placeholder="Escribí y elegí de la lista"></label><datalist id="sc-dl-prods">${opciones}</datalist>
        <p class="sc-dlg-n">Se avisa que la disponibilidad del otro producto está sin confirmar. No se unen marcas ni presentaciones por parecidas ni se suman sus cantidades.</p></div>
      <div class="sc-sub-campos" data-para="excepcion" hidden><fieldset class="sc-fs"><legend>Motivo <span class="sc-muted">(opcional)</span></legend><div class="sc-chipsels">${chips}</div></fieldset>
        <label class="sc-campo"><span>Nota <span class="sc-muted">(opcional)</span></span><textarea name="nota" rows="2" maxlength="500"></textarea></label>
        <label class="sc-campo"><span>Revisar el <span class="sc-muted">(opcional)</span></span><input type="date" name="revision" class="sc-fecha-in" min="${at(F.sumarDias(hoy(), 1))}"></label>
        <p class="sc-dlg-n">Si vuelve a comprarlo, la excepción se cierra sola y un abandono posterior se vuelve a detectar.</p></div>
      <div class="sc-alcance" data-para="retirado reemplazo" hidden>${ico('users', 'ico-sm')}<p><b>Afecta a todos los clientes.</b> Hoy ${afectados.length === 1 ? 'lo tiene 1 cliente con este aviso' : `lo tienen ${afectados.length} clientes con este aviso`}: ${lista}.</p></div>
      <p class="sc-dlg-err" role="alert" hidden></p>
      <div class="sc-dlg-pie"><button type="button" class="sc-btn" data-d="cerrar">Cancelar</button><button type="submit" class="sc-accion" data-d-aplicar>Aplicar</button></div></form>`, 'input[name="regla"]');
  }
  function sincronizarAviso(form) {
    const v = (form.querySelector('input[name="regla"]:checked') || {}).value || '';
    form.querySelectorAll('[data-para]').forEach(x => { x.hidden = !x.dataset.para.split(' ').includes(v); });
    const b = form.querySelector('[data-d-aplicar]'); if (b) b.textContent = v === 'excepcion' ? 'Guardar excepción' : v ? 'Aplicar a todos los clientes' : 'Aplicar';
  }
  async function guardarAviso(form) {
    const k = E.dlg && E.dlg.k, cp = E.dlg && E.dlg.producto, c = clienteDe(k); if (!c || E.ocupado) return;
    const q = c.dejoDeTodos.find(x => x.clave === cp), tipo = (form.querySelector('input[name="regla"]:checked') || {}).value;
    if (!q) return errorDlg('Este aviso ya no figura: la pantalla se actualizó.');
    if (!tipo) return errorDlg('Elegí qué pasó con el producto.');
    const p = { tipo, producto: q.nombre, productoNombre: q.nombre };
    if (tipo === 'reemplazo') {
      const txt = form.querySelector('[name="sustituto"]').value.trim();
      const prod = ((estadoApp() && estadoApp().products) || []).find(x => x.act !== false && S.norm(x.n) === S.norm(txt));
      if (!prod) return errorDlg('Elegí el otro producto de la lista del catálogo.');
      if (claveProd(prod.n) === cp) return errorDlg('El otro producto tiene que ser distinto.');
      p.sustituto = prod.n; p.sustitutoNombre = prod.n;
    }
    if (tipo === 'excepcion') {
      p.clave = c.clave; p.nombre = c.nombre; p.motivo = (form.querySelector('input[name="motivo"]:checked') || {}).value || '';
      p.nota = form.querySelector('[name="nota"]').value.trim(); p.revision = form.querySelector('[name="revision"]').value || '';
      if (p.revision && p.revision <= hoy()) return errorDlg('La fecha de revisión tiene que ser posterior a hoy.');
    }
    errorDlg(''); ocupar(true);
    const r = await almacenActual().crearRegla(p);
    ocupar(false);
    if (r.ok) { ocupar(true); await recargar(); ocupar(false); cerrarDlg(); avisoRegla(tipo === 'retirado' ? `${q.nombre}: ya no se vende (aviso resuelto para todos).` : tipo === 'reemplazo' ? `${q.nombre}: se ofrece ${p.sustituto} (aviso resuelto para todos).` : `${q.nombre}: no aplica a ${c.nombre}.`, r.id); }
    else errorDlg(`No se pudo guardar${r.error ? ': ' + r.error : ''}.`);
  }
  // Las reglas se deshacen desde el aviso (reactiva el aviso, que se vuelve a calcular con el historial) o desde «Cambios de productos».
  const avisoRegla = (texto, reglaId) => avisoAccion(texto, { regla: reglaId });
  function abrirReactivar(k, reglaId, tipo) {
    const c = clienteDe(k); if (!c || !puedeEditar()) return;
    const global = tipo === 'retirado' || tipo === 'cambio' || tipo === 'alternativa';
    E.foco = { k, asa: false }; E.dlg = { k, paso: 'reactivar', regla: reglaId };
    abrirDlg(`<div class="sc-dlg-c" data-d="reactivar"><h3 id="sc-dlg-t">Reactivar el aviso</h3>
      <p class="sc-dlg-s">${global ? '<b>Afecta a todos los clientes:</b> el aviso «Dejó de llevar» de este producto vuelve a calcularse para cada uno con su historial.' : `El aviso «Dejó de llevar» de este producto vuelve a calcularse para <b>${esc(c.nombre)}</b> con su historial.`} No se borra ni se cambia ninguna compra.</p>
      <p class="sc-dlg-err" role="alert" hidden></p>
      <div class="sc-dlg-pie"><button type="button" class="sc-btn" data-d="cerrar">Cancelar</button><button type="button" class="sc-accion" data-d="reactivar-ok">${global ? 'Reactivar para todos' : 'Reactivar aviso'}</button></div></div>`, '[data-d="reactivar-ok"]');
  }
  async function reactivar() {
    const id = E.dlg && E.dlg.regla; if (!id || E.ocupado) return;
    errorDlg(''); ocupar(true);
    const r = await almacenActual().cerrarRegla(id);
    ocupar(false);
    if (r.ok) { ocupar(true); await recargar(); ocupar(false); cerrarDlg(); E.aviso = { tono: 'ok', html: 'El aviso se volvió a calcular con el historial.' }; render(); }
    else errorDlg(`No se pudo reactivar${r.error ? ': ' + r.error : ''}.`);
  }

  // ── Arrastrar (PC): desde el asa de la fila hasta un destino. Es lo mismo que «Mover a…», pero con el mouse. ──
  function iniciarArrastre(ev, asaEl) {
    if (!puedeEditar() || E.ocupado || ev.button !== 0 || ev.pointerType === 'touch') return;
    const c = clienteDe(asaEl.dataset.k); if (!c) return;
    E.arr = { k: c.clave, nombre: c.nombre, actual: destinoActual(c), sx: ev.clientX, sy: ev.clientY, x: ev.clientX, y: ev.clientY, activo: false, id: ev.pointerId, asa: asaEl, objetivo: '', raf: 0 };
    try { asaEl.setPointerCapture(ev.pointerId); } catch (e) { /* sin captura: igual funciona dentro de la ventana */ }
  }
  function empezarArrastre(a) {
    a.activo = true; cerrarToast();
    document.body.classList.add('sc-arrastrando');
    const li = a.asa.closest('li'); if (li) li.classList.add('sc-it--arr');
    const g = document.createElement('div'); g.className = 'sc-ghost'; g.textContent = a.nombre; document.body.appendChild(g); a.ghost = g;
    const destinos = ['atender', 'recuperacion', 'pausa', 'automatico'].filter(t => t !== a.actual && (t !== 'automatico' || a.actual !== 'automatico'));
    const t = document.createElement('div'); t.className = 'sc-destinos'; t.id = 'sc-destinos'; t.setAttribute('aria-hidden', 'true');
    t.innerHTML = `<p>Soltá a <b>${esc(a.nombre)}</b> en un destino · Esc para cancelar</p><div class="sc-dest-fila">${destinos.map(d => `<div class="sc-dest sc-t-${DESTINOS[d][3]}" data-dest="${d}">${ico(DESTINOS[d][2])}<span>${esc(d === 'automatico' ? 'Volver a automático' : DESTINOS[d][0])}</span></div>`).join('')}</div>`;
    document.body.appendChild(t); a.tray = t;
    const vuelta = () => { if (E.arr !== a) return; const zona = 80, dy = a.y < zona ? -Math.ceil((zona - a.y) / 5) : (a.y > window.innerHeight - zona - t.offsetHeight && !a.objetivo ? Math.ceil((a.y - (window.innerHeight - zona - t.offsetHeight)) / 5) : 0); if (dy) window.scrollBy(0, dy); a.raf = requestAnimationFrame(vuelta); };
    a.raf = requestAnimationFrame(vuelta);
  }
  function moverArrastre(ev) {
    const a = E.arr; if (!a || ev.pointerId !== a.id) return;
    if (!a.activo) { if (Math.hypot(ev.clientX - a.sx, ev.clientY - a.sy) < 6) return; empezarArrastre(a); }
    a.x = ev.clientX; a.y = ev.clientY;
    a.ghost.style.transform = `translate(${a.x + 14}px, ${a.y + 14}px)`;
    const el = document.elementFromPoint(a.x, a.y), dest = el && el.closest ? el.closest('.sc-dest') : null;
    a.objetivo = dest ? dest.dataset.dest : '';
    a.tray.querySelectorAll('.sc-dest').forEach(d => d.classList.toggle('sc-dest--sobre', d === dest));
  }
  function limpiarArrastre() {
    const a = E.arr; if (!a) return;
    cancelAnimationFrame(a.raf);
    if (a.ghost) a.ghost.remove(); if (a.tray) a.tray.remove();
    document.body.classList.remove('sc-arrastrando');
    const li = a.asa && a.asa.closest('li'); if (li) li.classList.remove('sc-it--arr');
    try { a.asa.releasePointerCapture(a.id); } catch (e) { /* ya no la tenía */ }
    E.arr = null;
    if (E.renderPendiente && !$('sc-dlg')?.open) { E.renderPendiente = false; render(); }
  }
  function soltarArrastre(ev) {
    const a = E.arr; if (!a || ev.pointerId !== a.id) return;
    const fue = a.activo, destino = a.objetivo, k = a.k;
    limpiarArrastre();
    if (!fue) return;   // fue un clic: lo resuelve el evento click (abre «Mover a…»)
    E.sinClick = true; setTimeout(() => { E.sinClick = false; }, 60);
    if (destino) { const c = clienteDe(k); E.foco = { k, asa: true }; E.dlg = { k, espera: c && c.manual ? c.manual.id : null }; elegirDestino(k, destino, true); }
  }
  const cancelarArrastre = () => { if (E.arr) limpiarArrastre(); };

  document.addEventListener('pointerdown', ev => { const a = ev.target.closest && ev.target.closest('#sc-raiz .sc-asa'); if (a) iniciarArrastre(ev, a); });
  document.addEventListener('pointermove', moverArrastre);
  document.addEventListener('pointerup', soltarArrastre);
  document.addEventListener('pointercancel', cancelarArrastre);
  window.addEventListener('blur', cancelarArrastre);

  document.addEventListener('click', ev => {
    const d = ev.target.closest && ev.target.closest('#sc-dlg [data-d]');
    if (d) {
      const a = d.dataset.d;
      if (a === 'cerrar') cerrarDlg();
      else if (a === 'destino') elegirDestino(E.dlg && E.dlg.k, d.dataset.t, false);
      else if (a === 'atras') { const k = E.dlg && E.dlg.k; if (k) abrirMenu(k, E.foco && E.foco.asa); }
      else if (a === 'reactivar-ok') reactivar();
      return;
    }
    const t = ev.target.closest && ev.target.closest('#sc-toast [data-sc]');
    if (t) { if (t.dataset.sc === 'deshacer') deshacer(); else cerrarToast(); return; }
    const b = ev.target.closest && ev.target.closest('#sc-raiz [data-sc]');
    if (!b) return;
    const a = b.dataset.sc;
    if (a === 'fila') seleccionar(b.dataset.k, b);
    else if (a === 'volver') volver();
    else if (a === 'ir') irA(b.dataset.b);
    else if (a === 'vista') { if (E.vista !== b.dataset.v) { E.vista = b.dataset.v; E.q = ''; E.fichaAbierta = false; render(); window.scrollTo(0, 0); } }
    else if (a === 'filtro-pausa') { E.filtroPausa = b.dataset.f; const c = $('sc-cuerpo'); if (c) c.innerHTML = cuerpo(recalcular()); }
    else if (a === 'copiar') copiar(b.dataset.b);
    else if (a === 'reintentar') pedirHistorial();
    else if (a === 'reintentar-datos') cargarDatos();
    else if (a === 'cerrar-aviso') { E.aviso = null; render(); }
    else if (a === 'mover') { if (!E.sinClick) abrirMenu(b.dataset.k, b.classList.contains('sc-asa')); }
    else if (a === 'destino') { E.foco = { k: b.dataset.k, asa: false }; const c = clienteDe(b.dataset.k); E.dlg = { k: b.dataset.k, espera: c && c.manual ? c.manual.id : null }; elegirDestino(b.dataset.k, b.dataset.t, true); }
    else if (a === 'cerrar-decision') { E.foco = { k: b.dataset.k, asa: false }; cerrarDecision(b.dataset.k, b.dataset.c); }
    else if (a === 'resolver') abrirAviso(b.dataset.k, b.dataset.p);
    else if (a === 'reactivar') abrirReactivar(b.dataset.k, b.dataset.r, b.dataset.t);
  });
  document.addEventListener('submit', ev => {
    const f = ev.target; if (!f || !f.matches) return;
    if (f.matches('#sc-dlg form[data-d="form"]')) { ev.preventDefault(); guardarDecision(f); }
    else if (f.matches('#sc-dlg form[data-d="form-aviso"]')) { ev.preventDefault(); guardarAviso(f); }
  });
  document.addEventListener('change', ev => {
    const f = ev.target.closest && ev.target.closest('#sc-dlg form[data-d="form-aviso"]'); if (f && ev.target.name === 'regla') sincronizarAviso(f);
    const g = ev.target.closest && ev.target.closest('#sc-dlg form[data-d="form"]');
    if (g && ev.target.name === 'fecha') { const r = g.querySelector('input[name="rev"][value="fecha"]'); if (r) r.checked = true; }
  });
  // Teclado: flechas arriba/abajo pasan de una fila a la otra (sin elegirla: elegir es Enter o Espacio); Escape cancela un arrastre o vuelve a la lista en pantallas angostas.
  document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape' && E.arr) { ev.preventDefault(); cancelarArrastre(); return; }
    const raiz = $('sc-raiz'); if (!raiz || !raiz.contains(ev.target)) return;
    if (ev.key === 'Escape' && E.fichaAbierta && !ancho()) { ev.preventDefault(); volver(); return; }
    if ((ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') || !ev.target.classList || !ev.target.classList.contains('sc-fila')) return;
    const filas = [...raiz.querySelectorAll('.sc-fila')].filter(x => x.offsetParent !== null), i = filas.indexOf(ev.target), j = i + (ev.key === 'ArrowDown' ? 1 : -1);
    if (filas[j]) { ev.preventDefault(); filas[j].focus(); }
  });
  // Recuerda qué bloques plegados (Compra única, No tocar) y qué "Ver historial y cálculo" están abiertos, aunque la pantalla se vuelva a dibujar
  document.addEventListener('toggle', ev => {
    const d = ev.target; if (!d || !d.matches) return;
    if (d.matches('#sc-raiz details.sc-bloque')) E['abierto_' + d.dataset.b] = d.open;
    else if (d.matches('#sc-raiz details.sc-hist')) { if (d.open) E.ritmo.add(d.dataset.k); else E.ritmo.delete(d.dataset.k); }
    else if (d.matches('#sc-raiz details.sc-cambios')) E.cambiosAbierto = d.open;
  }, true);
  document.addEventListener('input', ev => { if (ev.target && ev.target.id === 'sc-q') { E.q = ev.target.value; renderBusqueda(); } });

  window.SegUI = {
    abrir, render, aplicarAcceso, puedeVer, pedirHistorial, cargarDatos, contexto, verCliente, asegurar,
    alRefrescar() {
      if (pestana() !== 'clientes') return;
      render();
      if (Date.now() - E.datos.ts > DATOS_VIEJOS_MS && !E.datos.cargando && E.datos.estado !== 'pendiente' && !E.dlg && !E.arr) cargarDatos(true);
    },
    _estado: E, _plazo: PLAZO,
  };
})();
