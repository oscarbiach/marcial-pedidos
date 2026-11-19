/* Pestaña "Clientes" de la app de Pedidos: CALENDARIO de 2 semanas (lunes de esta semana a domingo de la que viene) con el día en que hay que escribirle
   a cada cliente. Los atrasados (2 días o más de su día, o en recuperación) van directo a hoy, primero, con la insignia «Atrasado» (motor: seguimiento-clientes.js, función agenda()). Prioridad: PC; también anda en celular.
   · PC: «Esta semana» y «La semana que viene» (7 columnas, lunes a domingo) y, al pie, la bandeja «Sin seguimiento». Se agarra una
     tarjeta y se suelta en otro día (o en la bandeja); la ficha del cliente abre a la derecha. Celular: una lista por día; la ficha ocupa toda la pantalla.
   · El día lo calcula el motor (último pedido + su frecuencia, ajustado a su día habitual). Lo que la persona hace se guarda aparte (seguimiento-datos.js,
     tabla seg_agenda): moverlo de día («Mover a…», o arrastrando) y «Le escribí». «Sin seguimiento» es la decisión 'pausa' de siempre (con confirmación) y
     «Retomar» la cierra. Nada de eso cambia pedidos, fechas ni cálculos. Las acciones se ven de inmediato, avisan y tienen «Deshacer»; si el guardado falla
     vuelven atrás con un mensaje. Mientras una tarjeta se guarda no se la puede volver a mover.
   · Mientras la base no tenga las tablas (hace falta aprobación) el calendario muestra los días calculados y no ofrece mover, marcar ni pausar.
   La ficha (ficha()) conserva los gráficos, el historial y los avisos «Dejó de llevar»: dos gráficos que contestan una pregunta cada uno (¿cuánto pasó
   respecto de su ritmo? y ¿qué días suele pedir?), una tira con el plazo pedido → entrega, y detrás de "Ver historial y cálculo" la línea de tiempo y el
   detalle del cálculo. Todo gráfico lleva sus valores escritos. El color en las letras es selectivo.
   Usa, de index.html: state, setTab, esc, mIco, toast y google.script.run.
   El historial largo (más de 7 días) se pide aparte con historialAntiguo() y se guarda acá, sin tocar state.pedidos, para no interferir con el buscador
   de Pedidos. Elegir un cliente NO es un contacto: no se registra nada. */
(function () {
  'use strict';
  const S = window.SegClientes, F = S.fechas;
  const VIEJO_MS = 10 * 60 * 1000;   // el historial se vuelve a pedir si tiene más de 10 minutos
  const DATOS_VIEJOS_MS = 60 * 1000; // las decisiones y la agenda se vuelven a leer si tienen más de 1 minuto (otra persona pudo cambiar algo)
  const PLAZO = { datos: 20000 };    // una lectura de decisiones que no responde en 20 s se da por fallida (igual que el historial)
  const E = {
    q: '', sel: null, fichaAbierta: false, scrollLista: 0, ritmo: new Set(), historial: null, cargando: false, error: false, ts: 0, calc: null, huella: '', ag: null,
    datos: { estado: 'pendiente', decisiones: [], reglas: [], agenda: [], agendaOk: false, agendaMensaje: '', ts: 0, ultimoOk: 0, cargando: false, error: false, mensaje: '' },
    agendaMapa: new Map(),   // clave del cliente → { fecha, ciclo, escrito } (lo guardado, más lo que se acaba de cambiar y se está guardando)
    sobre: { pausar: new Map(), cerrar: new Set() },   // decisiones que se ven aplicadas antes de que la base conteste (pausar / retomar)
    ver: 0,                  // sube con cada cambio de lo que se ve antes de que la base conteste (para recalcular)
    guardando: new Set(),    // clientes con un guardado en curso: no se los puede volver a mover
    abiertos: new Map(),     // celular: qué días están desplegados (la clave es el día)
    pausaAbierta: false,
    dlg: null, aviso: null, deshacer: null, arr: null, ocupado: false, renderPendiente: false, cerrados: new Set(),
  };
  const $ = id => document.getElementById(id);
  // state y activeTab son `let` de index.html: no cuelgan de window, se leen directo (con typeof por si todavía no existen).
  const estadoApp = () => (typeof state !== 'undefined' ? state : null);
  const pestana = () => (typeof activeTab !== 'undefined' ? activeTab : '');
  const hoy = () => { const st = estadoApp(); return (st && st.today) || F.ymd(new Date()); };
  // esc() de index.html no escapa las comillas: para texto dentro de un atributo ("...") se usa este.
  const at = t => esc(t).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  // Dos columnas desde 1024 px de ancho (el CSS hace lo mismo con la misma medida): calendario de 7 columnas + ficha al costado. Más angosto: lista por día
  // y la ficha ocupa el lugar de la lista.
  const ancho = () => !!(window.matchMedia && window.matchMedia('(min-width: 1024px)').matches);
  const dormir = ms => new Promise(r => setTimeout(r, ms));

  // título, subtítulo, ícono y tono de color de cada bloque del motor. Se usan en la ficha y en la insignia que ve WhatsApp; el color nunca es la única señal.
  const TITULOS = {
    atender: ['Atender', 'Los marcaron para escribirles hoy, aunque el cálculo no los destaque.', 'message-circle', 'marca'],
    alta: ['Prioridad alta', 'Ya pasó mucho más de lo que suelen tardar, o hoy es su día de pedir.', 'triangle-alert', 'error'],
    semana: ['Les tocaba esta semana', 'Su ciclo ya venció y no pidieron desde el lunes.', 'calendar-clock', 'aviso'],
    recuperacion: ['Recuperación', 'Compraban y cortaron hace más de 35 días.', 'rotate-ccw', 'info'],
    unica: ['Compra única', 'Pidieron una sola vez: para convertir.', 'user-plus', 'neutro'],
  };
  const ESTADOS_AL_DIA = { ciclo: ['Dentro de su ciclo', 'circle-check', 'ok'], semana: ['Pidió esta semana', 'circle-check', 'ok'], inactivo: ['Inactivo', 'clock', 'neutro'] };
  const ESTADOS_MANUAL = { atender: ['Atender', 'message-circle', 'marca'], recuperacion: ['Recuperación', 'rotate-ccw', 'info'], pausa: ['Sin seguimiento', 'pause', 'neutro'] };
  const ABREV = { 1: 'lun', 2: 'mar', 3: 'mié', 4: 'jue', 5: 'vie', 6: 'sáb', 0: 'dom' };
  const SEMANA = [1, 2, 3, 4, 5, 6, 0];   // la semana va de lunes a domingo
  const ALTO_COLUMNAS = 88;                // alto (px) de la barra más alta del gráfico de días
  const MOTIVOS_EXCEPCION = ['Ya no lo usa', 'Lo compra en otro lado', 'Pedido ocasional', 'Otro'];
  // nombres de los destinos de una decisión (para contar quién cambió qué)
  const DESTINOS = { atender: 'Atender', recuperacion: 'Recuperación', pausa: 'Sin seguimiento' };

  // ── Datos ──
  function mezclar() {
    const vistos = new Set(), todos = [];
    ((estadoApp() && estadoApp().pedidos) || []).concat(E.historial || []).forEach(p => { if (p && !vistos.has(p.id)) { vistos.add(p.id); todos.push(p); } });
    return todos;
  }
  // Decisiones que se ven: las guardadas, más lo que se acaba de pausar o retomar y todavía no confirmó la base.
  function decisionesVista() {
    const l = E.datos.decisiones.filter(x => !E.sobre.cerrar.has(x.id) && !E.sobre.pausar.has(x.clave));
    E.sobre.pausar.forEach(x => l.push(x));
    return l;
  }
  function recalcular() {
    const todos = mezclar();
    const huella = todos.length + '|' + hoy() + '|' + E.datos.ts + '|' + E.datos.estado + '|' + E.ver + '|' + todos.reduce((h, p) => h + String(p.id).length + String(p.estado).length + String(p.fechaDespacho || '').length + String(p.notas || '').length, 0);
    if (E.calc && E.huella === huella) return E.calc;
    E.huella = huella; E.calc = S.calcular(todos, hoy(), datosOk() ? { decisiones: decisionesVista(), reglas: E.datos.reglas } : undefined);
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
  // Quién ve Clientes también en el celular táctil: solo los de CONFIG.celular (Oscar y Joaquin). Solo de interfaz.
  function puedeCelular(who) { return puedeVer(who) && (S.CONFIG.celular || []).some(u => S.norm(u) === S.norm(who)); }
  function aplicarAcceso() {
    const st = estadoApp(), ok = !!st && puedeVer(st.who);
    document.body.classList.toggle('seg-visible', ok);
    document.body.classList.toggle('seg-celular', ok && puedeCelular(st.who));   // muestra el ícono en la barra de abajo del celular
    if (!ok && pestana() === 'clientes' && typeof setTab === 'function') setTab('pedidos');
    return ok;
  }
  function abrir() {
    if (!$('sc-raiz') || !aplicarAcceso()) return;
    E.q = ''; E.sel = null; E.fichaAbierta = false; E.aviso = null;   // al entrar siempre se ve el calendario, no una búsqueda ni una ficha vieja
    // Salvo que se llegue desde WhatsApp con «Ver ficha completa»: entonces se abre la ficha de ese cliente.
    if (E.abrirCon) { E.sel = E.abrirCon; E.fichaAbierta = true; E.abrirCon = null; }
    if (!E.historial || Date.now() - E.ts > VIEJO_MS) pedirHistorial(); else render();
    cargarDatos();
    if (window.WhatsAppUI && WhatsAppUI.cargarVinculos) WhatsAppUI.cargarVinculos();   // para «Le escribimos …»
  }
  // Cuando llegan los datos de WhatsApp se agrega o quita la pastilla de la ficha («Le escribimos …»), sin redibujar la pestaña (no corta un arrastre ni mueve el foco).
  document.addEventListener('wa:vinculos', () => {
    if (pestana() !== 'clientes' || !E.calc) return;
    const slot = document.querySelector('#sc-ficha .sc-wa-slot'), c = E.sel && E.calc.clientes.find(x => x.clave === E.sel);
    if (slot && c) slot.innerHTML = contactadoPill(c);
  });

  // ── Decisiones, reglas y agenda ──
  let almacen = null;
  function almacenActual() {
    if (almacen) return almacen;
    const D = window.SegDatos; if (!D) return null;
    const quien = () => { const st = estadoApp(); return st && st.who; };
    if (typeof sandboxActivo === 'function' && sandboxActivo()) {
      // modo prueba: algunos clientes ya movidos o con «Le escribí» para que el calendario se vea con vida (solo mientras no se haya guardado nada)
      const semilla = () => { try { const d = JSON.parse(localStorage.getItem('dm_sandbox_datos')); return window.SegDemo && SegDemo.agendaInicial ? SegDemo.agendaInicial(hoy(), (d && d.pedidos) || []) : {}; } catch (e) { return {}; } };
      almacen = D.almacenLocal({ storage: window.localStorage, clave: 'dm_sandbox_seg', quien, hoy, semilla });
    } else if (typeof sb !== 'undefined') almacen = D.almacenBase({ sb, hoy });
    return almacen;
  }
  const datosOk = () => E.datos.estado === 'ok';
  const esEditor = () => { const st = estadoApp(); return !!st && (S.CONFIG.editores || []).some(u => S.norm(u) === S.norm(st.who)); };
  const puedeEditar = () => datosOk() && esEditor();                  // pausar, retomar y resolver avisos
  const puedeAgendar = () => puedeEditar() && E.datos.agendaOk;       // mover de día y «Le escribí» (necesitan la tabla seg_agenda)
  // Lee las decisiones, reglas y agenda guardadas. Si falla pero ya había una lectura buena, se sigue con ella avisando que puede estar desactualizada;
  // si nunca hubo una buena, no se muestra un calendario que podría incluir a clientes pausados (ver cuerpo).
  async function cargarDatos(silencioso) {
    const al = almacenActual();
    if (!al) { E.datos = Object.assign({}, E.datos, { estado: 'noInstalado' }); E.huella = ''; render(); return; }
    if (E.datos.cargando || E.guardando.size) return;   // con un guardado en curso no se pisa lo que se ve (se vuelve a leer en el próximo refresco)
    E.datos.cargando = true; if (!silencioso) render();
    let r, vence;
    try {
      r = await Promise.race([al.cargar(), new Promise(res => { vence = setTimeout(() => res({ estado: 'error', decisiones: [], reglas: [], mensaje: 'tardó demasiado en responder' }), PLAZO.datos); })]);
    } catch (e) { r = { estado: 'error', decisiones: [], reglas: [], mensaje: String((e && e.message) || e) }; }
    clearTimeout(vence);
    const previo = E.datos;
    if (r.estado === 'ok') {
      E.datos = { estado: 'ok', decisiones: r.decisiones, reglas: r.reglas, agenda: r.agenda || [], agendaOk: !!r.agendaOk, agendaMensaje: r.agendaMensaje || '', ts: Date.now(), ultimoOk: Date.now(), cargando: false, error: false, mensaje: '' };
      E.agendaMapa = new Map((r.agenda || []).map(x => [x.clave, { fecha: x.fecha || null, ciclo: x.ciclo || null, escrito: x.escrito || null }]));
    } else if (r.estado === 'error' && previo.ultimoOk) E.datos = Object.assign({}, previo, { cargando: false, error: true, mensaje: r.mensaje || '' });
    else { E.datos = { estado: r.estado, decisiones: [], reglas: [], agenda: [], agendaOk: false, agendaMensaje: '', ts: Date.now(), ultimoOk: 0, cargando: false, error: false, mensaje: r.mensaje || '' }; E.agendaMapa = new Map(); }
    E.huella = '';
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

  const MESES_L = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const mayus = t => t[0].toUpperCase() + t.slice(1);
  const diaTxt = f => `${ABREV[F.diaSemana(f)]} ${F.fmtCorta(f)}`;
  const diaLargo = f => (f === hoy() ? 'hoy' : f === F.sumarDias(hoy(), 1) ? 'mañana' : F.fechaLarga(f));
  // Último WhatsApp que se le mandó después de su último pedido (lo da whatsapp-inbox.js con una lectura liviana; sin acceso a WhatsApp no aparece).
  function contactadoPill(c) {
    const w = window.WhatsAppUI; if (!w || !w.contactado || (c.manual && c.manual.tipo === 'pausa')) return '';
    const f = w.contactado(c.nombre, c.ultimo); if (!f) return '';
    const d = new Date(f), k = F.ymd(d), dias = F.diffDias(hoy(), k);
    const cuando = dias <= 0 ? 'hoy' : dias === 1 ? 'ayer' : dias < 6 ? 'el ' + ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'][d.getDay()] : 'el ' + corta(k);
    return `<span class="sc-pill sc-t-info sc-pill--wa" title="Último WhatsApp que le mandamos, después de su último pedido">${ico('message-circle', 'ico-sm')}Le escribimos ${esc(cuando)}</span>`;
  }

  // ── Tarjeta del calendario ──
  // Simple: el nombre y las insignias (Atrasado, Recuperación, Dejó de llevar (n), Movido, Pidió, Le escribí). El detalle (último pedido, frecuencia, día habitual)
  // va en el tooltip y en el nombre accesible, y completo en la ficha.
  function insignias(t) {
    const c = t.c, b = [], p = (tono, icono, txt) => `<span class="sc-pill sc-t-${tono}">${icono ? ico(icono, 'ico-sm') : ''}${esc(txt)}</span>`;
    if (t.estado === 'pidio') b.push(p('ok', 'circle-check', 'Pidió'));
    else if (t.estado === 'escribi') b.push(p('marca', 'check', 'Le escribí'));
    if (t.atrasado && t.estado === 'pendiente') b.push(p('error', 'clock', 'Atrasado'));
    if (t.recuperacion) b.push(p('info', 'rotate-ccw', 'Recuperación'));
    if (c.manual && c.manual.tipo === 'atender') b.push(p('marca', 'message-circle', 'Atender'));
    if (c.dejoDeTodos.length) b.push(p('aviso', 'triangle-alert', `Dejó de llevar (${c.dejoDeTodos.length})`));
    if (t.estado !== 'pidio' && t.movido) b.push(p('neutro', 'calendar-days', 'Movido'));
    return b.join('');
  }
  // El detalle que ya no se ve en la tarjeta, en una frase (tooltip y nombre accesible)
  function detalleTarjeta(t) {
    const c = t.c, cada = Math.max(1, Math.round(c.intervalo)), d = [c.nombre];
    if (t.estado === 'pidio') d.push('Pidió esta semana');
    else if (t.estado === 'escribi') d.push('Le escribiste');
    if (t.atrasado && t.estado === 'pendiente') d.push(`Atrasado: su día era el ${F.fechaLarga(t.calculado)}`);
    if (t.recuperacion) d.push('Recuperación');
    if (c.dejoDeTodos.length) d.push(`Dejó de llevar ${c.dejoDeTodos.length === 1 ? 'un producto' : c.dejoDeTodos.length + ' productos'}`);
    if (t.estado !== 'pidio' && t.movido) d.push(`Movido a mano (su día calculado es el ${F.fechaLarga(t.calculado)})`);
    d.push(`Último pedido ${c.dias === 0 ? 'hoy' : 'hace ' + diasN(c.dias)}, cada ~${cada} ${cada === 1 ? 'día' : 'días'}`);
    if (c.diasHab.length) d.push('Día habitual: ' + c.diasHab.map(x => ABREV[x]).join(', '));
    if (c.poco) d.push('Pocos pedidos');
    return d.join('. ') + '.';
  }
  function tarjeta(t) {
    const c = t.c, ocup = E.guardando.has(t.clave), arr = puedeEditar() && !ocup && t.estado !== 'pidio' && ancho(), det = detalleTarjeta(t);
    return `<li class="sc-it"><button type="button" class="sc-card sc-card--${t.estado}${t.atrasado && t.estado === 'pendiente' ? ' sc-card--atr' : ''}${t.movido ? ' sc-card--mov' : ''}${ocup ? ' sc-card--guardando' : ''}" data-sc="fila" data-k="${at(t.clave)}" data-est="${t.estado}" title="${at(det)}" aria-label="${at(det)}"${arr ? ' data-arr="1"' : ''}${E.sel === t.clave ? ' aria-current="true"' : ''}${ocup ? ' aria-busy="true"' : ''}>
      <span class="sc-nom">${esc(c.nombre)}</span>
      <span class="sc-card-b" aria-hidden="true">${insignias(t)}</span></button></li>`;
  }
  const lista = (ts, cls) => `<ul class="${cls}">${ts.map(tarjeta).join('')}</ul>`;
  const copiarBtn = (b, n) => (n ? `<button type="button" class="sc-link" data-sc="copiar" data-b="${b}">${ico('copy', 'ico-sm')}Copiar lista</button>` : '');

  // ── Calendario en PC: Esta semana y La semana que viene ──
  function columnaDia(d) {
    const n = d.tarjetas.length, f = F.aFecha(d.fecha), vacioDom = d.dow === 0 && !n;
    const zona = !d.pasado && puedeAgendar() ? ` data-zona="dia" data-fecha="${d.fecha}"` : ` data-fecha="${d.fecha}"`;
    const pend = d.tarjetas.filter(t => t.estado === 'pendiente').length;
    return `<section class="sc-dia${d.hoy ? ' sc-dia--hoy' : ''}${d.pasado ? ' sc-dia--pasado' : ''}${vacioDom ? ' sc-dia--vacio' : ''}"${zona} data-dia="${d.dow}" aria-label="${at(`${mayus(S.DIAS[d.dow])} ${f.getDate()} de ${MESES_L[f.getMonth()]}${d.hoy ? ' (hoy)' : ''}: ${n === 1 ? '1 tarjeta' : n + ' tarjetas'}`)}">
      <h4 class="sc-dia-h"><span class="sc-dia-n"><span class="sc-dia-d">${ABREV[d.dow]}</span> <b>${f.getDate()}</b></span>${d.hoy ? '<span class="sc-dia-hoy">Hoy</span>' : ''}<span class="sc-cant">${n}</span></h4>
      ${n ? lista(d.tarjetas, 'sc-dia-l') : '<p class="sc-dia-nadie" aria-hidden="true">—</p>'}${d.hoy ? copiarBtn('hoy', pend) : ''}</section>`;
  }
  function semanaPC(ag, i) {
    const dias = ag.dias.slice(i * 7, i * 7 + 7), dom = dias[6], angosto = !dom.tarjetas.length;
    return `<section class="sc-sem" data-sem="${i}"><h3 class="sc-sem-t">${i ? 'La semana que viene' : 'Esta semana'} <span class="sc-muted">${esc(F.fmtCorta(dias[0].fecha))} al ${esc(F.fmtCorta(dom.fecha))}</span></h3>
      <div class="sc-sem-g${angosto ? ' sc-sem-g--dom' : ''}">${dias.map(columnaDia).join('')}</div></section>`;
  }
  // ── Calendario en celular: una lista por día (hoy abierto primero, luego el resto) ──
  function calendarioCel(ag) {
    const det = (clave, cab, n, cuerpo, porDefecto, cls) => `<details class="sc-dcel ${cls || ''}" data-dkey="${clave}"${(E.abiertos.has(clave) ? E.abiertos.get(clave) : porDefecto) ? ' open' : ''}><summary><span class="sc-dcel-t">${cab}</span><span class="sc-cant">${n}</span>${ico('chevron-down', 'ico-sm sc-chev')}</summary>${cuerpo}</details>`;
    const cuerpoDe = (ts, extra) => (ts.length ? lista(ts, 'sc-dia-l') : '<p class="sc-nadie">Nadie.</p>') + (extra || '');
    let h = '';
    ag.dias.filter(d => !d.pasado || d.tarjetas.length).forEach(d => {
      const f = F.aFecha(d.fecha), nombre = d.hoy ? `Hoy · ${ABREV[d.dow]} ${f.getDate()}` : `${mayus(S.DIAS[d.dow])} ${f.getDate()}`;
      h += det(d.fecha, `${esc(nombre)}${d.pasado ? ' <span class="sc-muted">(ya pasó)</span>' : ''}`, d.tarjetas.length, cuerpoDe(d.tarjetas, d.hoy ? copiarBtn('hoy', d.tarjetas.filter(t => t.estado === 'pendiente').length) : ''), d.hoy, `sc-dcel--dia${d.hoy ? ' sc-dcel--hoy' : ''}`);
    });
    return `<div class="sc-cel">${h}</div>`;
  }
  // Bandeja «Sin seguimiento»: plegable; soltar una tarjeta ahí la deja sin seguimiento (con confirmación). «Retomar» la vuelve al calendario.
  function bandeja(ag) {
    if (!datosOk()) return '';
    const l = ag.pausados, ed = puedeEditar();
    const items = l.map(c => `<li><button type="button" class="sc-pau-n" data-sc="fila" data-k="${at(c.clave)}">${esc(c.nombre)}</button><span class="sc-muted">${c.manual && c.manual.desde ? 'desde el ' + esc(corta(c.manual.desde)) : ''}${c.manual && c.manual.revisar ? ' · revisar' : ''}</span>${ed ? `<button type="button" class="sc-link" data-sc="retomar" data-k="${at(c.clave)}" aria-label="${at('Retomar a ' + c.nombre)}">${ico('play', 'ico-sm')}Retomar</button>` : ''}</li>`).join('');
    return `<section class="sc-pau" id="sc-pau"${ed ? ' data-zona="pausa"' : ''}><h3 class="sc-pau-h"><button type="button" class="sc-pau-t" data-sc="pau-toggle" aria-expanded="${E.pausaAbierta}" aria-controls="sc-pau-c">${ico('pause')}<span>Sin seguimiento</span><span class="sc-cant">${l.length}</span>${ico('chevron-down', 'ico-sm sc-chev')}</button></h3>
      <div class="sc-pau-c" id="sc-pau-c"${E.pausaAbierta ? '' : ' hidden'}>${l.length ? `<ul class="sc-pau-l">${items}</ul>` : '<p class="sc-nadie">Nadie.</p>'}<p class="sc-pau-n2">No les marcamos día para escribirles. Sus pedidos se siguen cargando y despachando con normalidad.${ed ? ' Para sacar a alguien del calendario, soltá su tarjeta acá o usá «Sin seguimiento» en su ficha.' : ''}</p></div></section>`;
  }
  function cuerpo(calc, ag) {
    if (bloqueado()) return estadoDatos();
    const mas = ag.masAdelante ? `<p class="sc-mas">Más adelante: <b>${ag.masAdelante}</b> ${ag.masAdelante === 1 ? 'cliente' : 'clientes'} con su día después del domingo de la semana que viene. Se los encuentra con el buscador.</p>` : '';
    return (ancho() ? semanaPC(ag, 0) + semanaPC(ag, 1) : calendarioCel(ag)) + mas + bandeja(ag);
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

  // Dónde está este cliente en el calendario, en una frase.
  function lineaAgenda(c) {
    const ag = E.ag; if (!ag) return '';
    if (c.manual && c.manual.tipo === 'pausa') return `<b>Sin seguimiento</b>: no figura en el calendario${c.manual.desde ? ' desde el ' + esc(corta(c.manual.desde)) : ''}.`;
    const t = ag.porCliente.get(c.clave), p = ag.pidieron.get(c.clave), partes = [];
    if (p) partes.push(`<b>Pidió</b> ${esc(diaLargo(p))}.`);
    if (!t) { if (!p) partes.push('No figura en el calendario: hace más de 150 días que no pide.'); return partes.join(' '); }
    if (t.estado === 'escribi') partes.push(`<b>Le escribiste</b> ${esc(diaLargo(t.escrito))}.`);
    partes.push(t.atrasado && t.estado === 'pendiente' ? `Está <b>atrasado</b>: su día era el ${esc(F.fechaLarga(t.calculado))}. Le toca escribirle <b>hoy</b>.`
      : `Le toca escribirle <b>${esc(diaLargo(t.dia))}</b>${t.fuera ? ' (después de la semana que viene)' : ''}.`);
    if (t.movido) partes.push(`Lo movieron a mano; su día calculado es el ${esc(F.fechaLarga(t.calculado))}.`);
    return partes.join(' ');
  }
  // Acciones de arriba de la ficha: «Le escribí» (alterna), «Mover a…» y «Sin seguimiento» / «Retomar». Solo con permiso de editar y con la base lista.
  function accionesFicha(c) {
    const k = at(c.clave), pausado = !!(c.manual && c.manual.tipo === 'pausa'), t = E.ag && E.ag.porCliente.get(c.clave), dis = E.guardando.has(c.clave) ? ' disabled' : '';
    const b = [];
    if (puedeAgendar() && t && !pausado) {
      b.push(`<button type="button" class="sc-btn" data-sc="escribi" data-k="${k}" aria-pressed="${t.estado === 'escribi'}"${dis}>${ico('check', 'ico-sm')}Le escribí</button>`);
      b.push(`<button type="button" class="sc-btn" data-sc="mover" data-k="${k}" aria-haspopup="dialog"${dis}>${ico('calendar-days', 'ico-sm')}Mover a…</button>`);
    }
    if (puedeEditar()) b.push(pausado ? `<button type="button" class="sc-btn sc-btn--prim" data-sc="retomar" data-k="${k}"${dis}>${ico('play', 'ico-sm')}Retomar</button>` : `<button type="button" class="sc-btn" data-sc="sinseg" data-k="${k}" aria-haspopup="dialog"${dis}>${ico('pause', 'ico-sm')}Sin seguimiento</button>`);
    return `<section class="sc-acc" aria-label="Seguimiento de este cliente"><p class="sc-acc-l">${lineaAgenda(c)}</p>${b.length ? `<div class="sc-btns">${b.join('')}</div>` : ''}</section>`;
  }
  // Decisión manual vigente (Atender, Recuperación o sin seguimiento): el detalle de quién y cuándo. Las acciones están arriba (accionesFicha).
  function panelSeguimiento(c) {
    const m = c.manual; if (!m || !datosOk()) return '';
    const [t, i, tn] = estado(c), k = at(c.clave), edit = puedeEditar();
    const lineas = [];
    if (m.motivoTxt && !(m.tipo === 'pausa' && m.motivo === 'otro')) lineas.push(`<span class="sc-muted">Motivo:</span> ${esc(m.motivoTxt)}`);
    if (m.nota) lineas.push(`<span class="sc-muted">Nota:</span> ${esc(m.nota)}`);
    lineas.push(`<span class="sc-muted">Desde el ${esc(corta(m.desde))}${m.autor ? ` · lo marcó ${esc(m.autor)}` : ''}</span>`);
    if (m.tipo === 'pausa' && m.revision) lineas.push(m.revisar ? `<b>Venció la fecha de revisión (${esc(corta(m.revision))}):</b> decidí si se retoma.` : `Se revisa el ${esc(corta(m.revision))}. La fecha es para revisar, no lo reactiva sola.`);
    lineas.push(`<span class="sc-muted">Sin esto, el cálculo lo ubicaría en: ${esc(c.auto.bloque === 'notocar' ? ESTADOS_AL_DIA[c.auto.motivo][0] : TITULOS[c.auto.bloque][0])}.</span>`);
    // Atender y Recuperación vuelven solos a automático si pide de nuevo (no llegan acá); la pausa no se levanta sola.
    const aviso = m.tipo === 'pausa' && m.nuevosPedidos ? nota('info', 'circle-alert', `<b>Nuevo pedido durante el tiempo sin seguimiento</b> (el último, el ${esc(corta(m.ultimoNuevo))}). Sigue sin seguimiento hasta que lo retomes.`) : '';
    const acciones = edit && m.tipo !== 'pausa' ? `<div class="sc-btns"><button type="button" class="sc-btn" data-sc="cerrar-decision" data-k="${k}" data-c="automatico">${ico('refresh-cw', 'ico-sm')}Volver a automático</button></div>` : '';
    return `<section class="sc-manual sc-t-${tn}" aria-label="Seguimiento manual"><div class="sc-manual-cab"><span class="sc-manual-t">${ico(i, 'ico-sm')}${m.tipo === 'pausa' ? 'Sin seguimiento' : 'Seguimiento manual: ' + esc(t.toLowerCase())}</span></div>
      <ul class="sc-manual-l">${lineas.map(l => `<li>${l}</li>`).join('')}</ul>${aviso}${acciones}</section>`;
  }

  function ficha(c) {
    const dir = direccionDe(c);
    return `<div class="sc-f sc-t-${tono(c)}">
      <button type="button" class="sc-volver" data-sc="volver">${ico('arrow-left', 'ico-sm')}Volver</button>
      <div class="sc-f-cab"><h3 class="sc-f-nom">${esc(c.nombre)}</h3>${pill(c)}<span class="sc-wa-slot">${contactadoPill(c)}</span></div>
      ${accionesFicha(c)}
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
    return `<div class="sc-f-vacio">${ico('users')}<p><b>${esc(aviso || 'Elegí un cliente para ver su seguimiento.')}</b></p><p class="sc-muted">Tocá una tarjeta del calendario o buscalo por nombre. Elegir un cliente no registra ningún contacto.</p></div>`;
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

  // ── Pantalla ──
  // Avisos de la pantalla (guardado, conflicto, datos viejos): se ven arriba y se pueden cerrar.
  function avisos() {
    const t = [];
    if (E.datos.error) t.push(`<p class="sc-aviso sc-aviso--error" role="alert">No se pudieron actualizar las pausas y movimientos. Lo que ves es de las ${esc(hora(E.datos.ultimoOk))} y puede estar desactualizado. <button type="button" class="sc-link" data-sc="reintentar-datos">Reintentar</button></p>`);
    else if (esEditor() && (E.datos.estado === 'ok' || E.datos.estado === 'noInstalado') && !E.datos.agendaOk) t.push(`<p class="sc-aviso sc-aviso--agenda">El calendario muestra los días calculados. Todavía no se puede mover a los clientes de día ni marcar «Le escribí»${E.datos.agendaMensaje ? ` <span class="sc-muted">(${esc(E.datos.agendaMensaje)})</span>` : ''}.</p>`);
    if (E.aviso) t.push(`<div class="sc-banner sc-t-${E.aviso.tono || 'aviso'}" role="alert">${ico(E.aviso.tono === 'error' ? 'circle-alert' : 'info', 'ico-sm')}<p>${E.aviso.html}</p><button type="button" class="sc-x" data-sc="cerrar-aviso" aria-label="Cerrar aviso">${ico('x', 'ico-sm')}</button></div>`);
    return t.join('');
  }
  // Sin poder leer las decisiones guardadas no se muestra el calendario: podría incluir a clientes que están sin seguimiento.
  const bloqueado = () => E.datos.estado === 'error' || E.datos.estado === 'sinPermiso';
  function estadoDatos() {
    const sinPermiso = E.datos.estado === 'sinPermiso';
    return `<div class="sc-estado" role="alert"><b>${sinPermiso ? 'Tu usuario todavía no tiene permiso para el seguimiento.' : 'No se pudieron cargar las pausas y los movimientos.'}</b><p>${sinPermiso ? 'Avisale a quien administra la app. Mientras tanto no se muestra el calendario.' : 'Sin eso, el calendario podría incluir a clientes que están sin seguimiento. Revisá la conexión y probá de nuevo.'}${E.datos.mensaje ? ` <span class="sc-muted">(${esc(E.datos.mensaje)})</span>` : ''}</p><button type="button" class="sc-accion" data-sc="reintentar-datos">Reintentar</button></div>`;
  }
  const leyenda = () => `<p class="sc-ley">Cada tarjeta es un cliente, en el día en que hay que escribirle. <span class="sc-pill sc-t-ok">${ico('circle-check', 'ico-sm')}Pidió</span> <span class="sc-pill sc-t-marca">${ico('check', 'ico-sm')}Le escribí</span>${puedeAgendar() ? (ancho() ? ' Agarrá una tarjeta y soltala en otro día, o abrila y usá «Mover a…».' : ' Abrí una tarjeta y usá «Mover a…» para cambiarla de día.') : ''}</p>`;
  const buscador = () => `<div class="sc-bus"><label class="sc-buscar">${ico('search', 'ico-sm')}<input type="search" id="sc-q" placeholder="Buscar un cliente" aria-label="Buscar un cliente" aria-controls="sc-bus-l" autocomplete="off" value="${at(E.q)}"></label><div id="sc-bus-l" class="sc-bus-l" aria-live="polite">${resultadosBusqueda()}</div></div>`;
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
    if (!calc.clientes.length) { raiz.className = 'sc'; raiz.innerHTML = `<div class="sc-estado"><b>Todavía no hay pedidos para analizar.</b><p>Cuando se carguen pedidos, acá aparece a quién escribirle cada día.</p></div>`; return; }
    E.ag = S.agenda(calc, { hoy: hoy(), agenda: E.agendaMapa, pedidos: mezclar() });
    const aviso = E.cargando ? '<p class="sc-aviso">Actualizando historial…</p>'
      : E.error ? `<p class="sc-aviso sc-aviso--error" role="alert">No se pudo actualizar el historial. Lo que ves es de las ${esc(hora(E.ts))} y puede estar desactualizado. <button type="button" class="sc-link" data-sc="reintentar">Reintentar</button></p>` : '';
    const lateral = contenidoFicha(calc);   // antes que el calendario: si el elegido ya no figura, no se lo marca
    const foco = document.activeElement && document.activeElement.id === 'sc-q' ? { a: document.activeElement.selectionStart, b: document.activeElement.selectionEnd } : null;
    raiz.className = 'sc' + (E.fichaAbierta ? ' sc--ficha' : '');
    raiz.innerHTML = `<div class="sc-cab"><div class="sc-cab-t"><h2>Clientes</h2><p class="sc-fecha">${esc(fechaTitulo())}</p></div>${buscador()}</div>${leyenda()}${aviso}${avisos()}
      <div class="sc-area${E.fichaAbierta ? ' sc-area--ficha' : ''}" id="sc-area">
        <div class="sc-col sc-col--lista"><div id="sc-cuerpo">${cuerpo(calc, E.ag)}</div></div>
        <aside class="sc-col sc-col--ficha" id="sc-ficha" aria-label="Ficha del cliente">${lateral}</aside>
      </div>`;
    if (foco) { const q = $('sc-q'); if (q) { q.focus({ preventScroll: true }); try { q.setSelectionRange(foco.a, foco.b); } catch (e) { /* tipo search sin selección */ } } }
    restaurarFoco();
    if (calc.cierresPendientes.length && !E.dlg && !(E.arr && E.arr.activo)) setTimeout(() => cerrarAutomaticos(calc.cierresPendientes), 0);
  }

  // ── Buscador: abre la ficha de un cliente aunque no esté en el calendario (sin seguimiento, inactivo o con el día más adelante) ──
  function resultadosBusqueda() {
    const q = S.norm(E.q); if (!q || !E.calc) return '';
    const res = E.calc.clientes.filter(c => S.norm(c.nombre).includes(q)).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    if (!res.length) return '<p class="sc-bus-nada">Ningún cliente coincide.</p>';
    const dondeEsta = c => {
      if (c.manual && c.manual.tipo === 'pausa') return 'Sin seguimiento';
      const t = E.ag && E.ag.porCliente.get(c.clave);
      return !t ? (c.bloque === 'notocar' && c.motivo === 'inactivo' ? 'Inactivo' : 'Pidió esta semana') : t.atrasado ? 'Atrasado' : t.fuera ? 'Más adelante' : diaTxt(t.dia);
    };
    return `<ul class="sc-bus-ul" aria-label="Resultados">${res.slice(0, 8).map(c => `<li><button type="button" class="sc-bus-it" data-sc="fila" data-k="${at(c.clave)}"><span class="sc-nom">${esc(c.nombre)}</span><span class="sc-muted">${esc(dondeEsta(c))}</span></button></li>`).join('')}</ul>${res.length > 8 ? `<p class="sc-bus-nada">y ${res.length - 8} más: escribí un poco más del nombre.</p>` : ''}`;
  }
  // Al escribir en el buscador solo se cambian los resultados: el campo y el teclado no se tocan.
  function renderBusqueda() { const l = $('sc-bus-l'); if (!l || !E.calc) return render(); l.innerHTML = resultadosBusqueda(); }
  function esqueleto() {
    return `<div class="sc" aria-busy="true"><div class="sc-cab"><div class="sc-cab-t"><h2>Clientes</h2><p class="sc-fecha">Cargando el historial de pedidos…</p></div></div>${'<div class="sc-esq"><i></i><i></i></div>'.repeat(6)}</div>`;
  }

  // ── Acciones ──
  // Elegir una tarjeta reemplaza la ficha; no mueve el calendario. En pantallas angostas la ficha ocupa el lugar de la lista.
  function seleccionar(k, boton) {
    const c = E.calc && E.calc.clientes.find(x => x.clave === k); if (!c) return;
    E.scrollLista = window.scrollY; E.sel = k; E.fichaAbierta = true;
    if (E.q) { E.q = ''; const q = $('sc-q'); if (q) q.value = ''; renderBusqueda(); }
    document.querySelectorAll('#sc-raiz [aria-current]').forEach(x => x.removeAttribute('aria-current'));
    document.querySelectorAll(`#sc-raiz .sc-card[data-k="${CSS.escape(k)}"]`).forEach(x => x.setAttribute('aria-current', 'true'));
    const f = $('sc-ficha'); f.innerHTML = ficha(c); f.scrollTop = 0;
    $('sc-area').classList.add('sc-area--ficha'); $('sc-raiz').classList.add('sc--ficha');
    if (!ancho()) { window.scrollTo(0, 0); const v = f.querySelector('.sc-volver'); if (v) v.focus({ preventScroll: true }); }
  }
  function volver() {
    E.fichaAbierta = false; $('sc-area').classList.remove('sc-area--ficha'); $('sc-raiz').classList.remove('sc--ficha');
    window.scrollTo(0, E.scrollLista);
    const b = E.sel && document.querySelector(`#sc-raiz .sc-card[data-k="${CSS.escape(E.sel)}"]`); if (b) b.focus({ preventScroll: true });
  }
  function textoLista() {
    const items = (E.ag.dias.find(d => d.hoy) || { tarjetas: [] }).tarjetas.filter(t => t.estado === 'pendiente');
    return `Para escribir hoy (${fechaTitulo()})\n` + items.map((t, i) => S.lineaTexto(t.c, i) + (t.atrasado ? ' [atrasado]' : '')).join('\n');
  }
  function copiar(clave) {
    const txt = textoLista();
    const listo = () => { if (typeof toast === 'function') toast('Lista copiada'); };
    if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(txt).then(listo, () => copiarViejo(txt, listo)); } else copiarViejo(txt, listo);
  }
  function copiarViejo(txt, listo) {
    const t = document.createElement('textarea'); t.value = txt; t.setAttribute('readonly', ''); t.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
    document.body.appendChild(t); t.select(); try { document.execCommand('copy'); listo(); } catch (e) { /* sin permiso: no se copia */ } t.remove();
  }

  // ═══ Mover de día, «Le escribí», sin seguimiento y resolver avisos ═══
  const clienteDe = k => (E.calc && E.calc.clientes.find(x => x.clave === k)) || null;
  // Al cerrar un diálogo o redibujar, el foco vuelve a donde estaba la persona (el botón de la ficha o la tarjeta del cliente), no al principio de la página.
  function restaurarFoco() {
    const f = E.foco; if (!f) return;
    const d = $('sc-dlg'); if (d && d.open) return;   // con un diálogo abierto el foco es del diálogo; se restaura al cerrarlo
    const btn = f.acc && document.querySelector(`#sc-ficha [data-sc="${f.acc}"][data-k="${CSS.escape(f.k)}"]`);
    if (btn && btn.disabled) return;   // se está guardando: el botón se habilita al terminar y recién ahí recibe el foco
    E.foco = null;
    const el = btn || document.querySelector(`#sc-raiz .sc-card[data-k="${CSS.escape(f.k)}"]`);
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

  // Un cambio de agenda (mover o «Le escribí») se ve enseguida; si la base no lo guarda, vuelve atrás con un mensaje. Mientras se guarda, el cliente queda
  // bloqueado (no se puede volver a mover: sin dobles envíos). Las llamadas son idempotentes (repetirlas deja lo mismo). `deshacer` = { tipo, previa } deja el
  // aviso con «Deshacer».
  async function agendaCambio(c, nueva, llamada, texto, deshacer) {
    const k = c.clave;
    if (E.guardando.has(k) || !puedeAgendar()) return false;
    const previa = E.agendaMapa.get(k) || null;
    E.guardando.add(k); E.agendaMapa.set(k, nueva); E.ver++; E.huella = ''; render();
    let r; try { r = await llamada(); } catch (e) { r = { ok: false, error: String((e && e.message) || e) }; }
    E.guardando.delete(k);
    if (r && r.ok) { E.ver++; E.huella = ''; render(); E.foco = null; if (deshacer) avisoAccion(texto, { agenda: { k, nombre: c.nombre, tipo: deshacer.tipo, previa } }); else toastCorto(texto); return true; }
    if (previa) E.agendaMapa.set(k, previa); else E.agendaMapa.delete(k);
    E.ver++; E.huella = '';
    E.aviso = { tono: 'error', html: esc(`No se pudo guardar${r && r.error ? ' (' + r.error + ')' : ''}. ${c.nombre} sigue donde estaba.`) }; render();
    return false;
  }
  const toastCorto = txt => { E.aviso = { tono: 'ok', html: esc(txt) }; render(); };
  const filaDe = k => E.agendaMapa.get(k) || { fecha: null, ciclo: null, escrito: null };
  // Mueve a un día de la ventana (fecha) o lo vuelve a su día calculado (fecha null, o la misma fecha que el cálculo).
  function moverA(k, fecha) {
    const c = clienteDe(k), t = E.ag && E.ag.porCliente.get(k); if (!c || !t || !puedeAgendar() || E.guardando.has(k)) return false;
    const vuelve = fecha === null || fecha === t.calculado;
    if (vuelve ? !t.movido : (t.dia === fecha || !(fecha >= hoy() && fecha <= E.ag.hasta))) return false;
    const f = vuelve ? null : fecha, nueva = { fecha: f, ciclo: c.ultimo, escrito: filaDe(k).escrito };
    const texto = vuelve ? `${c.nombre}: vuelve a su día (${F.fechaLarga(t.calculado)}).` : `${c.nombre}: ahora le toca ${diaLargo(fecha)}.`;
    return agendaCambio(c, nueva, () => almacenActual().agendar({ clave: k, fecha: f, ciclo: c.ultimo }), texto, { tipo: 'mover' });
  }
  function marcarEscribi(k) {
    const c = clienteDe(k), t = E.ag && E.ag.porCliente.get(k); if (!c || !t || !puedeAgendar() || E.guardando.has(k)) return false;
    const f = t.estado === 'escribi' ? null : hoy(), fila = filaDe(k);
    E.foco = { k, acc: 'escribi' };
    return agendaCambio(c, { fecha: fila.fecha, ciclo: fila.ciclo, escrito: f }, () => almacenActual().escribi({ clave: k, fecha: f }),
      f ? `Le escribiste a ${c.nombre}.` : `${c.nombre}: se desmarcó «Le escribí».`, { tipo: 'escribi' });
  }
  async function deshacerAgenda(d) {
    const c = clienteDe(d.k); if (!c || !puedeAgendar() || E.guardando.has(d.k)) return;
    const ahora = filaDe(d.k), p = d.previa || { fecha: null, ciclo: null, escrito: null }, al = almacenActual();
    if (d.tipo === 'mover') await agendaCambio(c, { fecha: p.fecha, ciclo: p.ciclo, escrito: ahora.escrito }, () => al.agendar({ clave: d.k, fecha: p.fecha, ciclo: p.ciclo || c.ultimo }), `${c.nombre}: volvió a como estaba.`);
    else await agendaCambio(c, { fecha: ahora.fecha, ciclo: ahora.ciclo, escrito: p.escrito }, () => al.escribi({ clave: d.k, fecha: p.escrito }), `${c.nombre}: volvió a como estaba.`);
  }

  // «Mover a…»: los días de la ventana desde hoy (los que ya pasaron no se ofrecen) y, si lo movieron, «Volver a su día».
  function abrirMover(k) {
    const c = clienteDe(k), t = E.ag && E.ag.porCliente.get(k); if (!c || !t || !puedeAgendar() || E.guardando.has(k)) return;
    E.foco = E.foco || { k, acc: 'mover' }; E.dlg = { k, paso: 'mover' };
    const dias = E.ag.dias.filter(d => !d.pasado);
    const op = d => {
      const f = F.aFecha(d.fecha), aca = t.dia === d.fecha, suyo = d.fecha === t.calculado;
      return `<li><button type="button" class="sc-dop${aca ? ' sc-dop--aca' : ''}" data-d="dia" data-f="${d.fecha}"${aca ? ' disabled aria-current="true"' : ''}><span class="sc-dop-d">${d.hoy ? 'Hoy' : ABREV[d.dow]}</span><b>${f.getDate()}</b><span class="sc-dop-m">${esc(F.fmtCorta(d.fecha).split(' ')[1])}</span>${aca ? '<span class="sc-dop-n">Está acá</span>' : suyo ? '<span class="sc-dop-n">Su día</span>' : ''}</button></li>`;
    };
    const sem = i => { const l = dias.filter(d => d.semana === i); return l.length ? `<h4 class="sc-dop-h">${i ? 'La semana que viene' : 'Esta semana'}</h4><ul class="sc-dops">${l.map(op).join('')}</ul>` : ''; };
    const vuelve = t.movido ? `<button type="button" class="sc-btn" data-d="volver-dia">${ico('rotate-ccw', 'ico-sm')}Volver a su día (${esc(F.fechaLarga(t.calculado))})</button>` : '';
    abrirDlg(`<div class="sc-dlg-c"><h3 id="sc-dlg-t">Mover a ${esc(c.nombre)}</h3>
      <p class="sc-dlg-s">Elegí el día en que hay que escribirle. <b>No cambia sus pedidos ni sus números.</b> Ahora le toca ${esc(diaLargo(t.dia))}${t.atrasado ? ' (atrasado)' : ''}.</p>${vuelve}${sem(0)}${sem(1)}
      <div class="sc-dlg-pie"><button type="button" class="sc-btn" data-d="cerrar">Cancelar</button></div></div>`, '.sc-dop:not([disabled])');
  }
  // «Sin seguimiento»: pide confirmación (sale del calendario hasta que se lo retome).
  function confirmarPausa(k) {
    const c = clienteDe(k); if (!c || !puedeEditar() || E.guardando.has(k) || (c.manual && c.manual.tipo === 'pausa')) return;
    E.foco = E.foco || { k, acc: 'sinseg' }; E.dlg = { k, paso: 'pausa' };
    abrirDlg(`<div class="sc-dlg-c"><h3 id="sc-dlg-t">¿Dejar a ${esc(c.nombre)} sin seguimiento?</h3>
      <p class="sc-dlg-s">Sale del calendario y no se le marca día para escribirle hasta que lo retomes (en la bandeja «Sin seguimiento» o en su ficha). <b>Sus pedidos se siguen cargando y despachando con normalidad.</b></p>
      <div class="sc-dlg-pie"><button type="button" class="sc-btn" data-d="cerrar">Cancelar</button><button type="button" class="sc-accion" data-d="pausar-ok">${ico('pause', 'ico-sm')}Sin seguimiento</button></div></div>`, '[data-d="cerrar"]');
  }
  async function pausar(k) {
    const c = clienteDe(k); if (!c || !puedeEditar() || E.guardando.has(k)) return;
    const previo = c.manual, st = estadoApp();
    E.guardando.add(k); cerrarDlg();
    E.sobre.pausar.set(k, { id: 'tmp-' + k, clave: k, nombre: c.nombre, tipo: 'pausa', motivo: 'otro', nota: '', revision: '', desde: hoy(), pedidosConocidos: c.pedidoIds, autor: (st && st.who) || '', creado: new Date().toISOString(), version: 1, vigente: true });
    E.ver++; E.huella = ''; render();
    let r; try { r = await almacenActual().decidir({ clave: k, nombre: c.nombre, tipo: 'pausa', motivo: 'otro', nota: '', revision: '', conocidos: c.pedidoIds, espera: previo ? previo.id : null }); } catch (e) { r = { ok: false, error: String((e && e.message) || e) }; }
    E.guardando.delete(k);
    if (r.ok) { await recargar(); E.sobre.pausar.delete(k); E.ver++; E.huella = ''; render(); avisoAccion(`${c.nombre}: quedó sin seguimiento.`, { k, nombre: c.nombre, nuevoId: r.id, previo }); return; }
    E.sobre.pausar.delete(k); E.ver++; E.huella = '';
    if (r.conflicto) { await conflicto(c, r); return; }
    E.aviso = { tono: 'error', html: esc(`No se pudo guardar${r.error ? ' (' + r.error + ')' : ''}. ${c.nombre} sigue donde estaba.`) }; render();
  }
  // «Retomar» (cierra la pausa) y «Volver a automático» (cierra Atender o Recuperación).
  async function cerrarDecision(k, cierre) {
    const c = clienteDe(k); if (!c || !puedeEditar() || E.guardando.has(k) || !c.manual) return;
    const previo = c.manual;
    E.guardando.add(k); E.sobre.cerrar.add(previo.id); E.ver++; E.huella = ''; render();
    let r; try { r = await almacenActual().cerrarDecision({ clave: c.clave, nombre: c.nombre, espera: previo.id, cierre }); } catch (e) { r = { ok: false, error: String((e && e.message) || e) }; }
    E.guardando.delete(k);
    if (r.ok) { await recargar(); E.sobre.cerrar.delete(previo.id); E.ver++; E.huella = ''; render(); avisoAccion(`${c.nombre}: ${cierre === 'retomado' ? 'se retomó el seguimiento' : 'volvió a automático'}.`, { k, nombre: c.nombre, nuevoId: null, previo }); return; }
    E.sobre.cerrar.delete(previo.id); E.ver++; E.huella = '';
    if (r.conflicto) { await conflicto(c, r); return; }
    E.aviso = { tono: 'error', html: esc(`No se pudo guardar${r.error ? ' (' + r.error + ')' : ''}. ${c.nombre} sigue donde estaba.`) }; render();
  }
  // Otra persona cambió al cliente antes: no se pisa su decisión. Se vuelve a leer y se avisa quién fue.
  async function conflicto(c, r) {
    cerrarDlg(); await recargar();
    const a = r.actual, que = a ? `${a.autor ? esc(a.autor) : 'Otra persona'} ya lo cambió a «${esc(DESTINOS[a.tipo] || a.tipo)}»` : 'Otra persona ya cambió su estado';
    E.aviso = { tono: 'aviso', html: `<b>${esc(c.nombre)}:</b> ${que}. Se actualizó la pantalla; revisalo y, si hace falta, volvé a intentarlo.` }; render();
  }
  // Si justo hay una lectura en curso se espera a que termine y se vuelve a leer (lo que se acaba de guardar tiene que verse).
  async function recargar() { for (let i = 0; i < 100 && E.datos.cargando; i++) await dormir(50); await cargarDatos(true); }

  // Aviso con «Deshacer» (vuelve a como estaba; el historial queda). Se cierra solo.
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
    if (d.agenda) return deshacerAgenda(d.agenda);
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

  // ── Arrastrar (PC): se agarra una tarjeta y se suelta en otro día (mover) o en la bandeja «Sin seguimiento» (pausar, con confirmación). Con teclado y en
  //    celular se usa «Mover a…» de la ficha. El estilo es el de Pedidos (copia flotante que sigue al cursor, hueco en el lugar de origen). ──
  function iniciarArrastre(ev, el) {
    if (!puedeEditar() || E.ocupado || ev.button !== 0 || ev.pointerType === 'touch' || !ancho() || E.guardando.has(el.dataset.k)) return;
    E.arr = { k: el.dataset.k, el, sx: ev.clientX, sy: ev.clientY, x: ev.clientX, y: ev.clientY, activo: false, id: ev.pointerId, zona: null, raf: 0 };
    try { el.setPointerCapture(ev.pointerId); } catch (e) { /* sin captura: igual funciona dentro de la ventana */ }
  }
  // ¿Se puede soltar acá? Un día de hoy en adelante (si hay agenda) o la bandeja (si hay decisiones).
  const zonaValida = z => !!z && (z.dataset.zona === 'pausa' ? puedeEditar() : z.dataset.zona === 'dia' && puedeAgendar() && z.dataset.fecha >= hoy());
  function empezarArrastre(a) {
    a.activo = true; cerrarToast();
    document.body.classList.add('sc-arrastrando'); $('sc-raiz').classList.add('sc--arr');
    a.el.classList.add('sc-card--arr');
    const r = a.el.getBoundingClientRect(); a.dx = a.sx - r.left; a.dy = a.sy - r.top;
    const pos = document.createElement('div'); pos.className = 'sc-ghost-pos';
    const clon = a.el.cloneNode(true); clon.classList.remove('sc-card--arr'); clon.classList.add('sc-ghost-card'); clon.removeAttribute('data-sc'); clon.removeAttribute('aria-current'); clon.style.width = r.width + 'px';
    pos.appendChild(clon); document.body.appendChild(pos); a.ghost = pos;
    // la bandeja del pie puede quedar lejos: mientras se arrastra hay también una zona flotante
    if (datosOk() && puedeEditar()) {
      const t = document.createElement('div'); t.className = 'sc-solta-pausa'; t.setAttribute('data-zona', 'pausa'); t.setAttribute('aria-hidden', 'true');
      t.innerHTML = `${ico('pause')}<span>Soltá acá para dejarlo sin seguimiento</span><small>Esc para cancelar</small>`; document.body.appendChild(t); a.tray = t;
    }
    const vuelta = () => { if (E.arr !== a) return; const zona = 90, dy = a.y < zona ? -Math.ceil((zona - a.y) / 5) : (a.y > window.innerHeight - zona ? Math.ceil((a.y - (window.innerHeight - zona)) / 5) : 0); if (dy) window.scrollBy(0, dy); a.raf = requestAnimationFrame(vuelta); };
    a.raf = requestAnimationFrame(vuelta);
    posicionar(a);
  }
  function posicionar(a) {
    a.ghost.style.transform = `translate(${a.x - a.dx}px, ${a.y - a.dy}px)`;
    const el = document.elementFromPoint(a.x, a.y), z = el && el.closest ? el.closest('[data-zona]') : null, nueva = zonaValida(z) ? z : null;
    if (nueva !== a.zona) { if (a.zona) a.zona.classList.remove('sc-zona--sobre'); if (nueva) nueva.classList.add('sc-zona--sobre'); a.zona = nueva; }
  }
  function moverArrastre(ev) {
    const a = E.arr; if (!a || ev.pointerId !== a.id) return;
    if (!a.activo) { if (Math.hypot(ev.clientX - a.sx, ev.clientY - a.sy) < 6) return; empezarArrastre(a); }
    a.x = ev.clientX; a.y = ev.clientY; posicionar(a);
  }
  function limpiarArrastre() {
    const a = E.arr; if (!a) return;
    cancelAnimationFrame(a.raf);
    if (a.ghost) a.ghost.remove(); if (a.tray) a.tray.remove();
    document.body.classList.remove('sc-arrastrando'); const r = $('sc-raiz'); if (r) r.classList.remove('sc--arr');
    document.querySelectorAll('.sc-zona--sobre').forEach(x => x.classList.remove('sc-zona--sobre'));
    a.el.classList.remove('sc-card--arr');
    try { a.el.releasePointerCapture(a.id); } catch (e) { /* ya no la tenía */ }
    E.arr = null;
    if (E.renderPendiente && !$('sc-dlg')?.open) { E.renderPendiente = false; render(); }
  }
  function soltarArrastre(ev) {
    const a = E.arr; if (!a || ev.pointerId !== a.id) return;
    const fue = a.activo, k = a.k, z = a.zona, zona = z && z.dataset.zona, fecha = z && z.dataset.fecha;
    limpiarArrastre();
    if (!fue) return;   // fue un clic: lo resuelve el evento click (abre la ficha)
    E.sinClick = true; setTimeout(() => { E.sinClick = false; }, 60);
    if (zona === 'dia') moverA(k, fecha);
    else if (zona === 'pausa') { E.foco = { k }; confirmarPausa(k); }
  }
  const cancelarArrastre = () => { if (E.arr) limpiarArrastre(); };

  document.addEventListener('pointerdown', ev => { const a = ev.target.closest && ev.target.closest('#sc-raiz .sc-card[data-arr]'); if (a) iniciarArrastre(ev, a); });
  document.addEventListener('pointermove', moverArrastre);
  document.addEventListener('pointerup', soltarArrastre);
  document.addEventListener('pointercancel', cancelarArrastre);
  window.addEventListener('blur', cancelarArrastre);
  // Al pasar de PC a celular (o al revés) el calendario cambia de forma
  if (window.matchMedia) { const mq = window.matchMedia('(min-width: 1024px)'), alCambiar = () => { if (pestana() === 'clientes' && E.calc) render(); }; if (mq.addEventListener) mq.addEventListener('change', alCambiar); else if (mq.addListener) mq.addListener(alCambiar); }

  document.addEventListener('click', ev => {
    const d = ev.target.closest && ev.target.closest('#sc-dlg [data-d]');
    if (d) {
      const a = d.dataset.d, k = E.dlg && E.dlg.k;
      if (a === 'cerrar') cerrarDlg();
      else if (a === 'dia') { cerrarDlg(); moverA(k, d.dataset.f); }
      else if (a === 'volver-dia') { cerrarDlg(); moverA(k, null); }
      else if (a === 'pausar-ok') pausar(k);
      else if (a === 'reactivar-ok') reactivar();
      return;
    }
    const t = ev.target.closest && ev.target.closest('#sc-toast [data-sc]');
    if (t) { if (t.dataset.sc === 'deshacer') deshacer(); else cerrarToast(); return; }
    const b = ev.target.closest && ev.target.closest('#sc-raiz [data-sc]');
    if (!b) return;
    const a = b.dataset.sc, k = b.dataset.k;
    if (a === 'fila') { if (!E.sinClick) seleccionar(k, b); }
    else if (a === 'volver') volver();
    else if (a === 'copiar') copiar();
    else if (a === 'reintentar') pedirHistorial();
    else if (a === 'reintentar-datos') cargarDatos();
    else if (a === 'cerrar-aviso') { E.aviso = null; render(); }
    else if (a === 'pau-toggle') { E.pausaAbierta = !E.pausaAbierta; const c = $('sc-pau-c'); if (c) c.hidden = !E.pausaAbierta; b.setAttribute('aria-expanded', String(E.pausaAbierta)); }
    else if (a === 'escribi') marcarEscribi(k);
    else if (a === 'mover') { E.foco = { k, acc: 'mover' }; abrirMover(k); }
    else if (a === 'sinseg') { E.foco = { k, acc: 'sinseg' }; confirmarPausa(k); }
    else if (a === 'retomar') { E.foco = { k, acc: 'retomar' }; cerrarDecision(k, 'retomado'); }
    else if (a === 'cerrar-decision') { E.foco = { k }; cerrarDecision(k, b.dataset.c); }
    else if (a === 'resolver') abrirAviso(k, b.dataset.p);
    else if (a === 'reactivar') abrirReactivar(k, b.dataset.r, b.dataset.t);
  });
  document.addEventListener('submit', ev => {
    const f = ev.target; if (!f || !f.matches) return;
    if (f.matches('#sc-dlg form[data-d="form-aviso"]')) { ev.preventDefault(); guardarAviso(f); }
  });
  document.addEventListener('change', ev => {
    const f = ev.target.closest && ev.target.closest('#sc-dlg form[data-d="form-aviso"]'); if (f && ev.target.name === 'regla') sincronizarAviso(f);
  });
  // Teclado: flechas arriba/abajo pasan de una tarjeta a otra (sin abrirla: abrir es Enter o Espacio); Escape cancela un arrastre, vacía el buscador o vuelve
  // al calendario en pantallas angostas. Enter en el buscador abre el primer resultado.
  document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape' && E.arr) { ev.preventDefault(); cancelarArrastre(); return; }
    const raiz = $('sc-raiz'); if (!raiz || !raiz.contains(ev.target)) return;
    if (ev.target.id === 'sc-q') {
      if (ev.key === 'Enter') { const p = raiz.querySelector('.sc-bus-it'); if (p) { ev.preventDefault(); seleccionar(p.dataset.k, null); } }
      else if (ev.key === 'ArrowDown') { const p = raiz.querySelector('.sc-bus-it'); if (p) { ev.preventDefault(); p.focus(); } }
      else if (ev.key === 'Escape' && E.q) { ev.preventDefault(); E.q = ''; ev.target.value = ''; renderBusqueda(); }
      return;
    }
    if (ev.key === 'Escape' && E.fichaAbierta && !ancho()) { ev.preventDefault(); volver(); return; }
    const cl = ev.target.classList; if (!cl) return;
    const sel = cl.contains('sc-bus-it') ? '.sc-bus-it' : cl.contains('sc-card') ? '.sc-card' : '';
    if (!sel || (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp')) return;
    const filas = [...raiz.querySelectorAll(sel)].filter(x => x.offsetParent !== null), i = filas.indexOf(ev.target), j = i + (ev.key === 'ArrowDown' ? 1 : -1);
    if (filas[j]) { ev.preventDefault(); filas[j].focus(); } else if (sel === '.sc-bus-it' && j < 0) { ev.preventDefault(); $('sc-q').focus(); }
  });
  // Recuerda qué días (celular) y qué "Ver historial y cálculo" están abiertos, aunque la pantalla se vuelva a dibujar
  document.addEventListener('toggle', ev => {
    const d = ev.target; if (!d || !d.matches) return;
    if (d.matches('#sc-raiz details.sc-dcel')) E.abiertos.set(d.dataset.dkey, d.open);
    else if (d.matches('#sc-raiz details.sc-hist')) { if (d.open) E.ritmo.add(d.dataset.k); else E.ritmo.delete(d.dataset.k); }
    else if (d.matches('#sc-raiz details.sc-cambios')) E.cambiosAbierto = d.open;
  }, true);
  document.addEventListener('input', ev => { if (ev.target && ev.target.id === 'sc-q') { E.q = ev.target.value; renderBusqueda(); } });

  window.SegUI = {
    abrir, render, aplicarAcceso, puedeVer, puedeCelular, pedirHistorial, cargarDatos, contexto, verCliente, asegurar,
    alRefrescar() {
      if (pestana() !== 'clientes') return;
      render();
      if (Date.now() - E.datos.ts > DATOS_VIEJOS_MS && !E.datos.cargando && E.datos.estado !== 'pendiente' && !E.dlg && !E.arr && !E.guardando.size) cargarDatos(true);
    },
    _estado: E, _plazo: PLAZO,
  };
})();
