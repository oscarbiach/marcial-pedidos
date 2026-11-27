/* Pestaña "Clientes" de la app de Pedidos: CALENDARIO de 2 semanas (lunes de esta semana a domingo de la que viene) con el día en que hay que escribirle
   a cada cliente. Los atrasados (2 días o más de su día, o en recuperación) van directo a hoy, primero, con la insignia «Atrasado» (motor: seguimiento-clientes.js, función agenda()). Prioridad: PC; también anda en celular.
   · PC: «Esta semana» y «La semana que viene» (6 columnas, lunes a sábado). Se agarra una
     tarjeta y se suelta en otro día. Cuando un día tiene muchas tarjetas, su lista se desplaza por dentro (la columna no se estira).
     Los que ya pidieron o a los que ya se les escribió quedan al final de cada día, discretos, bajo «Hechos». Celular: una lista por día.
   · La ficha del cliente es una ventana emergente (#scModal, el mismo sistema .overlay/.modal que los demás modales de la app): se cierra con la X, Escape o
     tocando el fondo, y el foco vuelve a la tarjeta. El calendario no cambia de forma al abrirla. «Mover a…» y la confirmación van encima de la ficha.
   · El día lo calcula el motor (último pedido + su frecuencia). Lo que la persona hace se guarda aparte (seguimiento-datos.js,
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
  const PLAZO = { datos: 20000, escritura: 20000 };    // una lectura de decisiones que no responde en 20 s se da por fallida (igual que el historial)
  // Filtro de arriba del calendario: todos, solo habituales («Hablarles») o solo seguimiento (única compra y dejó de comprar). Se recuerda en este navegador.
  const FILTROS = ['todos', 'habitual', 'seguimiento', 'atrasados'], FILTRO_KEY = 'dm_seg_filtro';
  const leerFiltro = () => { try { const v = window.localStorage.getItem(FILTRO_KEY); return FILTROS.includes(v) ? v : 'todos'; } catch (e) { return 'todos'; } };
  const guardarFiltro = v => { try { window.localStorage.setItem(FILTRO_KEY, v); } catch (e) { /* sin almacenamiento: vale solo por esta sesión */ } };
  const V2_VACIO = { instalado: false, yo: null, etiquetas: [], usuarios: [], clientes: [] };
  const E = {
    filtro: leerFiltro(),
    q: '', sel: null, fichaAbierta: false, origen: null, ritmo: new Set(), historial: null, cargando: false, error: false, ts: 0, calc: null, huella: '', ag: null,
    datos: { estado: 'pendiente', decisiones: [], reglas: [], agenda: [], agendaOk: false, agendaMensaje: '', v2: V2_VACIO, ts: 0, ultimoOk: 0, cargando: false, error: false, mensaje: '' },
    vista: 'hoy', filtroEt: '', cq: '', cf: { tipo: '', senal: '', etiqueta: '', vendedor: '', seguimiento: '' }, cLimite: 100, semana: 0, pq: '',   // Seguimiento v2: vista actual, filtro por etiqueta y filtros de la lista de clientes
    alertasTodas: new Set(), contactos: new Map(), ops: new Map(), guardandoMeta: new Set(),
    agendaMapa: new Map(),   // clave del cliente → { fecha, ciclo, escrito } (lo guardado, más lo que se acaba de cambiar y se está guardando)
    sobre: { pausar: new Map(), cerrar: new Set(), meta: new Map() },   // `meta`: vendedor / etiquetas / último contacto recién cambiados (clave del cliente → parcial)   // decisiones que se ven aplicadas antes de que la base conteste (pausar / retomar)
    ver: 0,                  // sube con cada cambio de lo que se ve antes de que la base conteste (para recalcular)
    guardando: new Set(),    // clientes con un guardado en curso: no se los puede volver a mover
    abiertos: new Map(),     // celular: qué días están desplegados (la clave es el día)
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
    const aliases = new Map((E.datos.aliases || []).map(a=>[S.norm(a.alias),a.nombre]));
    return sinBajas(todos.map(p=>aliases.has(S.norm(p.cliente))?{...p,cliente:aliases.get(S.norm(p.cliente))}:p));
  }
  // Clientes dados de baja (Administración): no figuran en el calendario ni en «Todos los clientes», salvo que tengan un pedido posterior a la baja.
  function sinBajas(lista) {
    const bajas = (estadoApp() && estadoApp().clientesBaja) || [];
    if (!bajas.length) return lista;
    const baja = new Map(bajas.map(b => [S.norm(b.n), b.baja])), vuelven = new Set();
    lista.forEach(p => { const k = S.norm(p.cliente), b = baja.get(k); if (b && String(p.fechaPedido || p.fecha).slice(0, 10) > b) vuelven.add(k); });
    return lista.filter(p => { const k = S.norm(p.cliente); return !baja.has(k) || vuelven.has(k); });
  }
  // Decisiones que se ven: las guardadas, más lo que se acaba de pausar o retomar y todavía no confirmó la base.
  function decisionesVista() {
    const l = E.datos.decisiones.filter(x => !E.sobre.cerrar.has(x.id) && !E.sobre.pausar.has(x.clave));
    E.sobre.pausar.forEach(x => l.push(x));
    return l;
  }
  function recalcular() {
    const todos = mezclar();
    const huella = hoy() + '|' + E.datos.ts + '|' + E.datos.estado + '|' + E.ver + '|' + JSON.stringify(todos.map(p=>[p.id,p.cliente,p.estado,p.fecha,p.fechaPedido,p.fechaDespacho,p.fechaEntrega,p.notas,p.items,p.eliminado_en])) + '|' + JSON.stringify((estadoApp() && estadoApp().clientesBaja) || []);
    if (E.calc && E.huella === huella) return E.calc;
    E.huella = huella; E.calc = S.calcular(todos, hoy(), datosOk() ? { decisiones: decisionesVista(), reglas: E.datos.reglas, usuario: usuarioMotor(), meta: metaMapa() } : undefined);
    return E.calc;
  }
  // Seguimiento v2: quién es (seg_yo, no state.who), qué clientes ve y con qué etiquetas/vendedor. Sin la migración (v2.instalado false) todo queda como antes.
  const v2 = () => E.datos.v2 || V2_VACIO;
  const v2Activo = () => datosOk() && v2().instalado && !!v2().yo;
  const sinAsignar = () => datosOk() && v2().instalado && !v2().yo;
  const esGestor = () => v2Activo() && !!v2().yo.gestor;         // administrador o ve_todo: asigna vendedor y etiquetas
  const veTodo = () => v2Activo() && !!v2().yo.ve_todo;          // ve la columna y el filtro de vendedor
  const usuarioMotor = () => (v2Activo() ? { nombre: v2().yo.nombre, ve_todo: !!v2().yo.ve_todo, ve_sin_vendedor: !!v2().yo.ve_sin_vendedor } : sinAsignar() ? { nombre: '', ve_todo: false } : undefined);   // sin clientes asignados no se ve ninguno (ni en el buscador)
  function metaMapa() {
    if (!v2Activo()) return undefined;
    const et = new Map(v2().etiquetas.map(e => [e.id, e])), m = new Map();
    v2().clientes.forEach(x => m.set(x.clave, { vendedor: x.vendedor, etiquetas: (x.etiquetas || []).map(id => et.get(id)).filter(Boolean), contacto: x.contacto || null }));
    E.sobre.meta.forEach((x, k) => m.set(k, Object.assign({ vendedor: null, etiquetas: [], contacto: null }, m.get(k) || {}, x)));
    return m;
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
    E.q = ''; E.sel = null; E.fichaAbierta = false; E.aviso = null; E.vista = 'hoy'; E.filtroEt = ''; E.semana = 0; E.pq = '';   // al entrar siempre se ve el panel de Hoy, no una búsqueda ni una ficha vieja
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
  // Con la migración v2 el permiso lo dice la base (seg_yo); sin ella, la lista de nombres de siempre (solo de interfaz).
  const esEditor = () => { if (v2().instalado) return !!v2().yo; const st = estadoApp(); return !!st && (S.CONFIG.editores || []).some(u => S.norm(u) === S.norm(st.who)); };
  const puedeEditar = () => datosOk() && esEditor();                  // pausar, retomar y resolver avisos
  const puedeAgendar = () => puedeEditar() && E.datos.agendaOk;       // mover de día y «Le escribí» (necesitan la tabla seg_agenda)
  // Lee las decisiones, reglas y agenda guardadas. Si falla pero ya había una lectura buena, se sigue con ella avisando que puede estar desactualizada;
  // si nunca hubo una buena, no se muestra un calendario que podría incluir a clientes pausados (ver cuerpo).
  async function cargarDatos(silencioso) {
    const al = almacenActual();
    if (!al) { E.datos = Object.assign({}, E.datos, { estado: 'noInstalado' }); E.huella = ''; render(); return; }
    if (E.datos.cargando || E.guardando.size || E.guardandoMeta.size) return;   // con un guardado en curso no se pisa lo que se ve (se vuelve a leer en el próximo refresco)
    E.datos.cargando = true; if (!silencioso) render();
    let r, vence;
    try {
      r = await Promise.race([al.cargar(), new Promise(res => { vence = setTimeout(() => res({ estado: 'error', decisiones: [], reglas: [], mensaje: 'tardó demasiado en responder' }), PLAZO.datos); })]);
    } catch (e) { r = { estado: 'error', decisiones: [], reglas: [], mensaje: String((e && e.message) || e) }; }
    clearTimeout(vence);
    const previo = E.datos;
    if (r.estado === 'ok') {
      E.datos = { estado: 'ok', decisiones: r.decisiones, reglas: r.reglas, agenda: r.agenda || [], agendaOk: !!r.agendaOk, agendaMensaje: r.agendaMensaje || '', v2: r.v2 || V2_VACIO, aliases: r.aliases || [], ts: Date.now(), ultimoOk: Date.now(), cargando: false, error: false, mensaje: '' };
      E.agendaMapa = new Map((r.agenda || []).map(x => [x.clave, { fecha: x.fecha || null, ciclo: x.ciclo || null, escrito: x.escrito || null }]));
    } else if (r.estado === 'error' && previo.ultimoOk) E.datos = Object.assign({}, previo, { cargando: false, error: true, mensaje: r.mensaje || '' });
    else { E.datos = { estado: r.estado, decisiones: [], reglas: [], agenda: [], agendaOk: false, agendaMensaje: '', v2: V2_VACIO, ts: Date.now(), ultimoOk: 0, cargando: false, error: false, mensaje: r.mensaje || '' }; E.agendaMapa = new Map(); }
    E.huella = ''; E.sobre.meta.clear();   // lo guardado ya llegó: las marcas provisorias sobran
    render(); avisar();
    if (E.fichaAbierta && E.sel) cargarContactos(E.sel);
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
  const diaCorto = f => `${ABREV[F.diaSemana(f)]} ${F.aFecha(f).getDate()}`;
  const diaLargo = f => (f === hoy() ? 'hoy' : f === F.sumarDias(hoy(), 1) ? 'mañana' : F.fechaLarga(f));
  // Último WhatsApp que se le mandó después de su último pedido (lo da whatsapp-inbox.js con una lectura liviana; sin acceso a WhatsApp no aparece).
  function contactadoPill(c) {
    const w = window.WhatsAppUI; if (!w || !w.contactado || (c.manual && c.manual.tipo === 'pausa')) return '';
    const f = w.contactado(c.nombre, c.ultimo); if (!f) return '';
    const d = new Date(f), k = F.ymd(d), dias = F.diffDias(hoy(), k);
    const cuando = dias <= 0 ? 'hoy' : dias === 1 ? 'ayer' : dias < 6 ? 'el ' + ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'][d.getDay()] : 'el ' + corta(k);
    return `<span class="sc-pill sc-t-info sc-pill--wa" title="Último WhatsApp que le mandamos, después de su último pedido">${ico('message-circle', 'ico-sm')}Le escribimos ${esc(cuando)}</span>`;
  }

  // ── Tarjeta ──
  // Qué es cada tipo de cliente, en una frase (ficha y detalle de la tarjeta)
  const TIPO_FRASE = { habitual: 'Compra siempre: le toca escribirle', unica: 'Una sola compra: seguimiento para que vuelva', recupero: 'Dejó de comprar: seguimiento para recuperarlo' };
  // El detalle que ya no se ve en la tarjeta, en una frase (tooltip y nombre accesible)
  function detalleTarjeta(t) {
    const c = t.c, cada = Math.max(1, Math.round(c.intervalo)), d = [c.nombre];
    d.push(motivoAgenda(t));
    d.push(TIPO_FRASE[t.tipo]);
    if (c.dejoDeTodos.length) d.push(`Dejó de llevar ${c.dejoDeTodos.length === 1 ? 'un producto' : c.dejoDeTodos.length + ' productos'}`);
    if (t.estado !== 'pidio' && t.movido) d.push(`Movido a mano (su día calculado es el ${F.fechaLarga(t.calculado)})`);
    if (t.recurrente) d.push('Aparece cada semana este día por su etiqueta, aunque ya se le haya hablado');
    if ((c.etiquetas || []).length) d.push('Etiquetas: ' + c.etiquetas.map(e => e.nombre).join(', '));
    d.push(`Último pedido ${c.dias === 0 ? 'hoy' : 'hace ' + diasN(c.dias)}, cada ~${cada} ${cada === 1 ? 'día' : 'días'}`);
    if (c.diasHab.length) d.push('Día habitual: ' + c.diasHab.map(x => ABREV[x]).join(', '));
    return d.join('. ') + '.';
  }
  // Etiquetas de grupo: chips muy discretos (en la tarjeta del calendario, hasta `max` y un «+N»; en listas y ficha, todas). El nombre accesible ya las nombra (detalleTarjeta).
  function chipsEt(c, max) {
    const l = c.etiquetas || []; if (!l.length) return '';
    const ver = max ? l.slice(0, max) : l, mas = l.length - ver.length;
    return `<span class="sc-ets${max ? ' sc-ets--mini' : ''}"${max ? ' aria-hidden="true"' : ''}>${ver.map(e => `<span class="sc-et">${esc(e.nombre)}</span>`).join('')}${mas > 0 ? `<span class="sc-et">+${mas}</span>` : ''}</span>`;
  }
  const pasaTipo = t => E.filtro === 'todos' || (E.filtro === 'atrasados' ? !!(t.atrasado && t.estado === 'pendiente') : (E.filtro === 'habitual') === (t.tipo === 'habitual'));
  const pasaEt = c => !E.filtroEt || (c.etiquetas || []).some(e => e.id === E.filtroEt);
  const pasa = t => pasaTipo(t) && pasaEt(t.c);
  const filtrar = ts => ts.filter(pasa);

  // ═══ Seguimiento v3: Panel principal / Agenda semanal / Clientes (estructura y proporciones de la referencia marcial_seguimiento) ═══
  const hoyEf = () => (F.diaSemana(hoy()) === 0 ? F.sumarDias(hoy(), 1) : hoy());   // un domingo no hay columna: lo de hoy se ve el lunes
  const VISTAS = [['hoy', 'Panel principal', 'layout-dashboard'], ['agenda', 'Agenda semanal', 'calendar-days'], ['clientes', 'Clientes', 'users']];
  const RES = {
    tiene_stock: ['Tiene stock', 'package', 'Ya tiene: elegí cuándo volver a escribirle'],
    no_interesa: ['No le interesa por ahora', 'clock', 'Elegí cuándo volver a intentarlo'],
    no_contesto: ['No contestó', 'phone', 'Vuelve a pendiente enseguida'],
    otro: ['Otro', 'pencil', 'Anotá qué pasó y, si quedó una fecha, elegila'],
  };
  const quienSoy = () => { const st = estadoApp(); return (v2Activo() && v2().yo.nombre) || (st && st.who) || ''; };
  const sp = (cls, txt) => `<span class="sv-pill ${cls}">${esc(txt)}</span>`;
  const TIPO_PILL = { habitual: ['green', 'Habitual'], unica: ['amber', 'Única compra'], recupero: ['red', 'Dejó de comprar'] };
  const pillTipo = tipo => sp(TIPO_PILL[tipo][0], TIPO_PILL[tipo][1]);
  // Acción sugerida, prioridad y «señal» de cada cliente (los textos de la referencia: «Consultar reposición», «Alta», «Sin compras»…)
  const accionDe = t => (t.reescribir && t.estado === 'pendiente' ? 'Volver a escribir' : t.tipo === 'recupero' ? 'Recuperar' : t.tipo === 'unica' ? 'Segunda compra' : 'Le toca escribirle');
  const prioDe = t => (t.estado === 'escribi' ? ['En espera', 'low', 'gray'] : t.reescribir || t.atrasado || t.tipo === 'recupero' ? ['Alta', 'high', 'red'] : t.tipo === 'unica' ? ['Media', 'mid', 'amber'] : ['Normal', 'low', 'gray']);
  const prioHtml = t => { const [txt, dot] = prioDe(t); return `<span class="sv-pr"><i class="sv-dot ${dot}"></i>${txt}</span>`; };
  const desdeTxt = c => (c.dias === 0 ? 'pidió hoy' : `${c.dias} ${c.dias === 1 ? 'día' : 'días'} desde el último pedido`);
  // Un mismo motivo en Hoy, calendario y ficha. No cambia fechas ni registra contactos.
  function motivoAgenda(t) {
    const c = t.c, ritmo = `${c.intervaloPropio ? '' : 'aprox. '}cada ${Math.max(1, Math.round(c.intervalo))} días`;
    if (t.estado === 'pidio') return 'Ya hizo un pedido esta semana';
    if (t.estado === 'escribi') return `Le escribiste ${t.escrito === hoy() ? 'hoy' : 'el ' + diaCorto(t.escrito)} · retomar ${diaCorto(t.vuelveEl)} si no pide`;
    const contacto = t.contacto || c.contacto;
    if (t.movido) {
      const resultado = contacto && contacto.volver_el === t.dia ? ({tiene_stock:'Tenía stock',no_interesa:'No le interesaba por ahora',otro:'Contacto registrado'})[contacto.resultado] : '';
      return `${resultado ? resultado + ' · ' : ''}Contacto programado para ${t.dia === hoyEf() ? 'hoy' : diaCorto(t.dia)}`;
    }
    if (t.noContesto) return 'No contestó · volver a intentar';
    if (t.reescribir) return 'Pasó la espera sin un pedido nuevo · volver a escribir';
    if (t.recurrente) return 'Contacto semanal fijado por etiqueta';
    if (c.manual && c.manual.tipo !== 'pausa') return `Seguimiento manual${c.manual.motivoTxt ? ' · ' + c.manual.motivoTxt : ''}`;
    if (c.n === 1) return `Una sola compra · hace ${c.dias} días`;
    return `${c.dias} días sin pedir · suele pedir ${ritmo}`;
  }
  const SENALES = { reescribir: 'Volver a escribir', dejo: 'Dejó de comprar', unica: 'Una compra', productos: 'Dejó de llevar', menos: 'Pidió menos variedad', ninguna: 'Sin alertas' };
  function senal(c, t) {
    if (t && t.reescribir && t.estado === 'pendiente') return ['amber', 'Volver a escribir', 'reescribir'];
    if (c.n === 1) return ['amber', 'Una compra', 'unica'];
    if (S.tipoDe(c) === 'recupero') return ['red', `Sin pedir ${c.dias} d`, 'dejo'];
    if (c.dejoDeTodos.length) return ['amber', 'Dejó de llevar', 'productos'];
    if (c.compraMenos) return ['amber', 'Pidió menos variedad', 'menos'];
    return ['gray', 'Sin alertas', 'ninguna'];
  }
  const ESTADOS = { pendiente: ['blue', 'Pendiente'], atrasado: ['red', 'Atrasado'], esperando: ['amber', 'Esperando'], pidio: ['green', 'Pidió'], pausa: ['gray', 'Sin seguimiento'], inactivo: ['gray', 'Inactivo'] };
  const estadoPill = k => sp(ESTADOS[k][0], ESTADOS[k][1]);
  function estadoClave(c, ag) {
    if (c.manual && c.manual.tipo === 'pausa') return 'pausa';
    if (c.bloque === 'notocar' && c.motivo === 'inactivo') return 'inactivo';
    if (ag.pidieron.has(c.clave)) return 'pidio';
    const t = ag.porCliente.get(c.clave);
    return !t ? 'pidio' : t.estado === 'escribi' ? 'esperando' : t.atrasado ? 'atrasado' : 'pendiente';
  }
  function proximoTxt(c, ag) {
    const e = estadoClave(c, ag), t = ag.porCliente.get(c.clave);
    if (e === 'pausa') return 'Sin seguimiento';
    if (e === 'inactivo') return 'No figura (inactivo)';
    if (!t) return 'Pidió esta semana';
    if (t.estado === 'escribi') return `Vuelve ${diaCorto(t.vuelveEl)}`;
    if (t.fuera) return diaTxt(t.dia);
    return t.dia === hoyEf() ? 'Hoy' : diaTxt(t.dia);
  }
  const dirCorta = c => { const d = direccionDe(c); return d ? (d.length > 38 ? d.slice(0, 37) + '…' : d) : ''; };
  const nombreCelda = c => `<button type="button" class="sv-linkname" data-sc="fila" data-k="${at(c.clave)}"${E.sel === c.clave ? ' aria-current="true"' : ''}>${esc(c.nombre)}</button>${dirCorta(c) ? `<div class="sv-sub sv-dir">${ico('map-pin', 'ico-sm')}${esc(dirCorta(c))}</div>` : ''}`;

  // Navegación secundaria (chips) + buscador de clientes a la derecha
  const navSecundaria = () => `<div class="sv-nav"><div class="sv-nav-c" role="group" aria-label="Secciones">${VISTAS.map(([v, t, i]) => `<button type="button" class="sv-chip" data-sc="vista" data-v="${v}" aria-pressed="${E.vista === v}">${ico(i, 'ico-sm')}${t}</button>`).join('')}</div>${buscador()}<a class="sc-guia" href="guia-seguimiento.html" target="_blank" rel="noopener">ⓘ Guía rápida</a></div>`;
  const cabecera = (icono, titulo, sub, derecha) => `<div class="sv-head"><div><h1>${icono ? ico(icono) : ''}${esc(titulo)}</h1><p>${sub}</p></div>${derecha || ''}</div>`;
  const etiquetasEnUso = calc => { const m = new Map(); calc.clientes.forEach(c => (c.etiquetas || []).forEach(e => m.set(e.id, e))); return [...m.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')); };
  // «Filtrar:» Todos · Hablarles · Seguimiento · Atrasados · una por etiqueta
  function filtros(calc, etiqueta) {
    const b = (v, txt) => `<button type="button" class="sv-chip" data-sc="filtro" data-f="${v}" aria-pressed="${E.filtro === v}">${txt}</button>`;
    return `<div class="sv-toolbar" role="group" aria-label="Qué clientes mostrar"><span class="sv-muted">${etiqueta}</span>${b('todos', 'Todos')}${b('habitual', 'Hablarles')}${b('seguimiento', 'Seguimiento')}${b('atrasados', 'Atrasados')}${etiquetasEnUso(calc).map(e => `<button type="button" class="sv-chip" data-sc="filtro-et" data-e="${at(e.id)}" aria-pressed="${E.filtroEt === e.id}">${ico('tag', 'ico-sm')}${esc(e.nombre)}</button>`).join('')}</div>`;
  }
  const kpi = (tono, icono, titulo, n) => `<li class="sv-card sv-kpi"><span class="sv-ico ${tono}">${icono.length > 2 ? ico(icono) : icono}</span><div><div class="sv-muted">${titulo}</div><div class="sv-number">${n}</div></div></li>`;
  const estadoSinClientes = () => `<div class="sc-estado" role="status"><b>No tenés clientes asignados todavía.</b><p>Cuando te asignen clientes, vas a ver acá a quién escribirle cada día. Si esperabas verlos, avisale a quien administra la app.</p></div>`;

  // Alertas (filas con cuadrado de color, nombre, detalle, pill de señal y chevron: abre la ficha)
  const ALERTA_UI = { reescribir: ['amber', '!'], esperando: ['blue', 'clock'], dejo: ['red', '!'], unica: ['amber', '!'], productos: ['amber', 'trending-down'], menos: ['amber', 'trending-down'] };
  const ALERTA_TXT = { reescribir: 'Volver a escribir', esperando: 'Esperando', dejo: 'Dejó de comprar', unica: 'Una compra', productos: 'Dejó de llevar', menos: 'Pidió menos variedad' };
  function filasAlertas(calc, ag, max) {
    const al = S.alertas(calc, ag, { hoy: hoy() }), todas = E.alertasTodas.has('all'), ver = todas ? al : al.slice(0, max);
    if (!al.length) return { n: 0, html: `<p class="sv-vacio">${ico('circle-check')}Sin alertas por ahora. Todo lo que se mide está en orden.</p>` };
    const fila = a => { const [tono, ic] = ALERTA_UI[a.tipo];
      return `<li><button type="button" class="sv-alert" data-sc="fila" data-k="${at(a.clave)}" aria-label="${at(`${a.nombre}: ${a.detalle}. Abrir ficha`)}"><span class="sv-aic ${tono}">${ic.length > 2 ? ico(ic) : ic}</span><span class="sv-alert-t"><span class="sv-name">${esc(a.nombre)}</span><span class="sv-sub">${esc(a.detalle)}</span></span>${sp(tono, ALERTA_TXT[a.tipo])}<span class="sv-arrow">${ico('chevron-right')}</span></button></li>`; };
    return { n: al.length, html: `<ul class="sv-list">${ver.map(fila).join('')}</ul>${al.length > max ? `<button type="button" class="sv-btn small sv-mas" data-sc="alertas-mas" data-t="all" aria-expanded="${todas}">${todas ? 'Ver menos' : `Ver las ${al.length - max} restantes`}</button>` : ''}` };
  }

  // ── Panel principal ──
  function filaTarea(t) {
    const c = t.c, k = at(c.clave), esp = t.estado === 'escribi', ocup = E.guardando.has(c.clave), nv = veTodo() ? '' : ' sv-task--nv';
    const chk = puedeAgendar() ? `<input type="checkbox" class="sv-chk" data-sc="escribi" data-k="${k}"${esp ? ' checked' : ''}${ocup ? ' disabled aria-busy="true"' : ''} aria-label="${at((esp ? 'Desmarcar «Le escribí»: ' : 'Marcar «Le escribí»: ') + c.nombre)}">` : '<span></span>';
    const pills = pillTipo(t.tipo) + (esp ? sp('amber', 'Esperando') : '') + (t.atrasado && !esp ? sp('red', 'Atrasado') : '') + (t.reescribir && !esp ? sp('amber', 'Volver a escribir') : '') + (t.recurrente ? sp('gray', 'Cada semana') : '') + (c.etiquetas || []).slice(0, 2).map(e => sp('tag', e.nombre)).join('');
    const sub = motivoAgenda(t);
    const btn = esp && puedeAgendar() ? `<button type="button" class="sv-btn small" data-sc="resultado" data-k="${k}" aria-haspopup="dialog"${ocup ? ' disabled' : ''}>Anotar respuesta</button>` : `<button type="button" class="sv-btn small" data-sc="fila" data-k="${k}" aria-label="${at('Ver ' + c.nombre)}">Ver ficha</button>`;
    return `<li class="sv-task${nv}" data-k="${k}">${chk}<div class="sv-task-n"><div><span class="sv-name">${esc(c.nombre)}</span> ${pills}</div><div class="sv-sub">${esc(sub)}</div></div>${prioHtml(t)}${veTodo() ? `<span class="sv-resp">${ico('user', 'ico-sm')}${esc(c.vendedor || 'Atención general')}</span>` : ''}${btn}</li>`;
  }
  // Los clientes con contacto esta semana, pendientes primero (una fila por cliente)
  function filasContactar(calc, ag) {
    const orden = t => (t.estado === 'pendiente' ? (t.atrasado ? 0 : 1) : t.estado === 'escribi' ? 2 : 3), m = new Map();
    ag.dias.filter(d => d.semana === 0).forEach(d => d.tarjetas.forEach(t => { if (!pasa(t)) return; const p = m.get(t.clave); if (!p || orden(t) < orden(p)) m.set(t.clave, t); }));
    const q = S.norm(E.pq);
    return [...m.values()].filter(t => !q || S.norm(t.nombre).includes(q)).sort((a, b) => orden(a) - orden(b) || a.dia.localeCompare(b.dia) || a.nombre.localeCompare(b.nombre, 'es'));
  }
  function tablaContactar(calc, ag) {
    const l = filasContactar(calc, ag), vt = veTodo(), ver = l.slice(0, 15);
    if (!l.length) return `<p class="sv-vacio">${ico('search')}No hay clientes con contacto esta semana${E.pq ? ' que coincidan' : ''}.</p>`;
    const fila = t => { const c = t.c, [sc, st] = senal(c, t), ek = t.estado === 'pidio' ? 'pidio' : t.estado === 'escribi' ? 'esperando' : t.atrasado ? 'atrasado' : 'pendiente';
      return `<tr><td>${nombreCelda(c)}</td><td>${pillTipo(t.tipo)}</td><td>Hace ${esc(diasN(c.dias))}</td><td>${sp(sc, st)}</td>${vt ? `<td>${esc(c.vendedor || 'Atención general')}</td>` : ''}<td>${esc(proximoTxt(c, ag))}</td><td>${estadoPill(ek)}</td><td><button type="button" class="sv-btn small" data-sc="fila" data-k="${at(c.clave)}" aria-label="${at('Gestionar ' + c.nombre)}">Gestionar</button></td></tr>`; };
    return `<div class="sv-tablewrap"><table class="sv-table"><thead><tr><th>Cliente</th><th>Segmento</th><th>Último pedido</th><th>Señal</th>${vt ? '<th>Responsable</th>' : ''}<th>Próximo contacto</th><th>Estado</th><th><span class="sc-sr">Acciones</span></th></tr></thead><tbody>${ver.map(fila).join('')}</tbody></table></div>${l.length > ver.length ? `<p class="sv-sub sv-pie">Se muestran ${ver.length} de ${l.length}. Los demás están en «Ver todos».</p>` : ''}`;
  }
  function refrescarPanelTabla() { const r = $('sv-contactar'); if (r && E.calc && E.ag) r.innerHTML = tablaContactar(E.calc, E.ag); }
  function vistaPanel(calc, ag) {
    const dia = ag.dias.find(d => d.fecha === hoyEf()) || { tarjetas: [] };
    const pend = dia.tarjetas.filter(t => t.estado === 'pendiente'), espM = new Map();
    ag.dias.forEach(d => d.tarjetas.forEach(t => { if (t.estado === 'escribi' && !t.recurrente && !espM.has(t.clave)) espM.set(t.clave, t); }));
    const esp = [...espM.values()].sort((a, b) => String(a.escrito).localeCompare(String(b.escrito)) || a.nombre.localeCompare(b.nombre, 'es'));
    const hechos = new Set(); dia.tarjetas.forEach(t => { if (t.estado === 'pidio' && !t.recurrente) hechos.add(t.clave); }); ag.dias.forEach(d => d.tarjetas.forEach(t => { if (t.escrito === hoy() && !t.recurrente) hechos.add(t.clave); }));
    const dejaron = calc.clientes.filter(c => { const t = ag.porCliente.get(c.clave); return t && t.tipo === 'recupero'; }).length;
    const tareas = pend.concat(esp).filter(pasa), al = filasAlertas(calc, ag, 6);
    const porHablar = tareas.filter(t => t.estado === 'pendiente').sort((a,b) => Number(b.reescribir || b.atrasado || b.tipo === 'recupero') - Number(a.reescribir || a.atrasado || a.tipo === 'recupero') || a.nombre.localeCompare(b.nombre,'es'));
    const esperando = tareas.filter(t => t.estado === 'escribi');
    const grupo = (lista,titulo,clase) => lista.length ? `<li class="sv-agenda-grupo ${clase}"><h3>${titulo}</h3><span>${lista.length}</span></li>${lista.map(filaTarea).join('')}` : '';
    return `${cabecera('', 'Seguimiento comercial', 'Todo lo importante del día, sin perder clientes ni contactos.')}
      ${filtros(calc, 'Filtrar:')}
      <ul class="sv-kpis" aria-label="Resumen de hoy">${kpi('red', 'clock', 'Atrasados', pend.filter(t => t.atrasado).length)}${kpi('amber', 'trending-down', 'Dejaron de comprar', dejaron)}${kpi('blue', 'message-circle', 'Esperando respuesta', esp.length)}${kpi('green', 'check', 'Contactados / pidieron hoy', hechos.size)}</ul>
      <div class="sv-two">
        <section class="sv-card sv-sec" aria-labelledby="sv-hoy-t"><div class="sv-ch"><h2 id="sv-hoy-t">${ico('calendar-days')}Agenda de hoy</h2><span class="sv-actions">${pend.length ? `<button type="button" class="sv-linkbtn" data-sc="copiar" data-b="hoy">${ico('copy', 'ico-sm')}Copiar lista</button>` : ''}<span class="sv-count">${tareas.length} ${tareas.length === 1 ? 'tarea' : 'tareas'}</span></span></div>
          ${tareas.length ? `<ul class="sv-list sv-list--tareas">${grupo(porHablar,'Para hablar hoy','sv-agenda-hablar')}${grupo(esperando,'Ya contactados · en espera','sv-agenda-espera')}</ul>` : `<p class="sv-vacio">${ico('circle-check')}${pend.length ? 'Ningún pendiente coincide con el filtro.' : 'No hay nadie para escribirle hoy. Buen momento para repasar la agenda semanal.'}</p>`}</section>
        <section class="sv-card sv-sec" aria-labelledby="sv-al-t"><div class="sv-ch"><h2 id="sv-al-t">${ico('triangle-alert')}Alertas comerciales</h2><span class="sv-count">${al.n} ${al.n === 1 ? 'alerta' : 'alertas'}</span></div>${al.html}</section>
      </div>
      <section class="sv-card sv-sec" aria-labelledby="sv-cc-t"><div class="sv-ch"><h2 id="sv-cc-t">${ico('users')}Clientes a contactar</h2><div class="sv-tools"><label class="sv-search">${ico('search', 'ico-sm')}<input type="search" id="sv-pq" class="sv-field" placeholder="Buscar cliente…" aria-label="Buscar entre los clientes a contactar" autocomplete="off" value="${at(E.pq)}"></label><button type="button" class="sv-btn small" data-sc="vista" data-v="clientes">Ver todos</button></div></div>
        <div id="sv-contactar">${tablaContactar(calc, ag)}</div></section>`;
  }

  // ── Agenda semanal: 6 tarjetas por día (3 × 2), resumen y próximas tareas ──
  const rangoSemana = dias => { const a = F.aFecha(dias[0].fecha), b = F.aFecha(dias[dias.length - 1].fecha), m = i => MESES_L[i];
    return a.getMonth() === b.getMonth() ? `${a.getDate()} al ${b.getDate()} de ${m(b.getMonth())} ${b.getFullYear()}` : `${a.getDate()} de ${m(a.getMonth())} al ${b.getDate()} de ${m(b.getMonth())} ${b.getFullYear()}`; };
  function tareaDia(t) {
    const c = t.c, ocup = E.guardando.has(t.clave), arr = puedeEditar() && !ocup && t.estado !== 'pidio' && !t.recurrente && ancho(), det = detalleTarjeta(t);
    const ek = t.estado === 'pidio' ? ['green', 'Pidió'] : t.estado === 'escribi' ? ['amber', 'Esperando'] : t.reescribir ? ['red', 'Volver a escribir'] : t.atrasado ? ['red', 'Atrasado'] : ['blue', 'Pendiente'];
    const sub = motivoAgenda(t);
    return `<li class="sc-it"><button type="button" class="daytask${t.estado === 'pidio' ? ' daytask--hecha' : ''}${t.recurrente ? ' daytask--rec' : ''}${E.guardando.has(t.clave) ? ' daytask--guardando' : ''}" data-sc="fila" data-k="${at(t.clave)}" data-est="${t.estado}" data-tipo="${t.tipo}" title="${at(det)}" aria-label="${at(det)}"${t.recurrente ? ' data-rec="1"' : ''}${arr ? ' data-arr="1"' : ''}${E.sel === t.clave ? ' aria-current="true"' : ''}${ocup ? ' aria-busy="true"' : ''}>
      <span class="dt-main"><span class="dt-top"><span class="sv-name">${esc(c.nombre)}</span>${pillTipo(t.tipo)}${t.recurrente ? sp('gray', 'Cada semana') : ''}</span><span class="sv-sub">${esc(sub)}</span><span class="sv-sub dt-pr">${prioHtml(t)}${veTodo() ? ` · ${esc(c.vendedor || 'Atención general')}` : ''}${(c.etiquetas || []).length ? ` · ${esc(c.etiquetas.map(e => e.nombre).join(', '))}` : ''}</span></span>${sp(ek[0], ek[1])}</button></li>`;
  }
  function diaTarjeta(d) {
    const ts = filtrar(d.tarjetas), n = ts.length, f = F.aFecha(d.fecha), zona = !d.pasado && puedeAgendar() ? ` data-zona="dia" data-fecha="${d.fecha}"` : ` data-fecha="${d.fecha}"`;
    return `<section class="sv-card sv-day${d.hoy ? ' sv-day--hoy' : ''}${d.pasado ? ' sv-day--pasado' : ''}"${zona} data-dia="${d.dow}" aria-label="${at(`${mayus(S.DIAS[d.dow])} ${f.getDate()}${d.hoy ? ' (hoy)' : ''}: ${n === 1 ? '1 tarea' : n + ' tareas'}`)}">
      <div class="sv-dh"><b>${ico('calendar-days', 'ico-sm')}${esc(mayus(S.DIAS[d.dow]))} ${f.getDate()}${d.hoy ? ' <span class="sv-hoy">Hoy</span>' : ''}</b><span class="sv-count">${n} ${n === 1 ? 'tarea' : 'tareas'}</span></div>
      ${n ? `<ul class="sc-dia-l sv-dl">${ts.map(tareaDia).join('')}</ul>` : '<p class="sv-vacio sv-vacio--dia">Sin tareas</p>'}</section>`;
  }
  function cuerpoAgenda(ag) {
    const dias = ag.dias.filter(d => d.semana === E.semana), todos = dias.flatMap(d => d.tarjetas).filter(pasa);
    const linea = (txt, n) => `<div class="sv-line"><span>${txt}</span><b>${n}</b></div>`;
    const prox = ag.dias.filter(d => !d.pasado).flatMap(d => d.tarjetas).filter(t => t.estado === 'pendiente' && !t.recurrente && pasa(t)).slice(0, 5);
    return `<div class="sv-calendar" id="sv-cal">${dias.map(diaTarjeta).join('')}</div>
      <aside class="sv-aside" aria-label="Resumen y próximas tareas">
        <section class="sv-card sv-sec"><div class="sv-ch"><h2>Resumen de la semana</h2></div>${linea('Atrasados', todos.filter(t => t.estado === 'pendiente' && t.atrasado).length)}${linea('Esperando', todos.filter(t => t.estado === 'escribi' && !t.recurrente).length)}${linea('Pidieron', todos.filter(t => t.estado === 'pidio' && !t.recurrente).length)}${linea('Volver a escribir', todos.filter(t => t.estado === 'pendiente' && t.reescribir).length)}</section>
        <section class="sv-card sv-sec"><div class="sv-ch"><h2>${ico('clock')}Próximas tareas</h2></div>${prox.length ? prox.map(t => { const [txt, , cls] = prioDe(t); return `<button type="button" class="sv-up" data-sc="fila" data-k="${at(t.clave)}"><span><span class="sv-name">${esc(t.nombre)}</span><span class="sv-sub">${esc(accionDe(t))} · ${esc(t.dia === hoyEf() ? 'hoy' : diaCorto(t.dia))}</span></span>${sp(cls, txt)}</button>`; }).join('') : '<p class="sv-vacio">Sin tareas pendientes.</p>'}</section>
      </aside>`;
  }
  function vistaAgenda(calc, ag) {
    const dias = ag.dias.filter(d => d.semana === E.semana);
    const sel = `<div class="sv-sem" role="group" aria-label="Semana">${[['0', 'Esta semana'], ['1', 'Semana que viene']].map(([s, t]) => `<button type="button" class="sv-chip" data-sc="semana" data-s="${s}" aria-pressed="${String(E.semana) === s}">${t}</button>`).join('')}</div>`;
    const mas = ag.masAdelante ? `<p class="sv-sub sv-pie">Más adelante: ${ag.masAdelante} ${ag.masAdelante === 1 ? 'cliente' : 'clientes'} con su día después del sábado de la semana que viene (se los encuentra en Clientes).</p>` : '';
    return `${cabecera('calendar-days', 'Agenda semanal', `Seguimientos de lunes a sábado · ${esc(rangoSemana(dias))}`, sel)}${filtros(calc, 'Filtrar por:')}<div class="sv-cal-l" id="sv-cal-l">${cuerpoAgenda(ag)}</div>${mas}`;
  }
  // Arrastrando una tarjeta sobre «Semana que viene» (o «Esta semana») se cambia de semana sin soltarla
  function repintarGrilla() {
    const w = $('sv-cal-l'); if (!w || !E.ag) return;
    w.innerHTML = cuerpoAgenda(E.ag);
    document.querySelectorAll('#sc-raiz [data-sc="semana"]').forEach(b => b.setAttribute('aria-pressed', String(String(E.semana) === b.dataset.s)));
    const sub = document.querySelector('#sc-raiz .sv-head p'); if (sub) sub.innerHTML = `Seguimientos de lunes a sábado · ${esc(rangoSemana(E.ag.dias.filter(d => d.semana === E.semana)))}`;
    marcarMas();
  }
  // Cuando la lista de un día tiene más tareas de las que entran, se difumina el borde de abajo (hay más para ver al desplazar).
  function marcarMas() { document.querySelectorAll('#sc-raiz .sc-dia-l').forEach(l => l.classList.toggle('sc-dia-l--mas', l.scrollHeight - l.scrollTop - l.clientHeight > 4)); }
  document.addEventListener('scroll', ev => { const l = ev.target; if (l && l.classList && l.classList.contains('sc-dia-l')) l.classList.toggle('sc-dia-l--mas', l.scrollHeight - l.scrollTop - l.clientHeight > 4); }, true);
  window.addEventListener('resize', () => marcarMas());

  // ── Clientes ──
  function filtrarClientes(calc, ag) {
    const f = E.cf, q = S.norm(E.cq);
    return calc.clientes.filter(c => {
      if (q && !S.norm(c.nombre).includes(q) && !S.norm(direccionDe(c)).includes(q)) return false;
      if (f.seguimiento === 'pausa' && estadoClave(c, ag) !== 'pausa') return false;
      if (f.seguimiento === 'activo' && ['pausa','inactivo'].includes(estadoClave(c, ag))) return false;
      if (f.tipo && S.tipoDe(c) !== f.tipo) return false;
      if (f.senal && senal(c, ag.porCliente.get(c.clave))[2] !== f.senal) return false;
      if (f.etiqueta && !(c.etiquetas || []).some(e => e.id === f.etiqueta)) return false;
      if (f.vendedor && veTodo()) { if (f.vendedor === '__ninguno' ? !!c.vendedor : S.norm(c.vendedor || '') !== S.norm(f.vendedor)) return false; }
      return true;
    }).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }
  function tablaClientes(calc, ag) {
    const l = filtrarClientes(calc, ag), ver = l.slice(0, E.cLimite), vt = veTodo();
    if (!l.length) return `<p class="sv-vacio">${ico('search')}Ningún cliente coincide con los filtros.</p>`;
    const fila = c => { const t = ag.porCliente.get(c.clave), [sc, st] = senal(c, t), tp = S.tipoDe(c);
      return `<tr class="${c.manual && c.manual.tipo === 'pausa' ? 'sv-tr--pausa' : ''}"><td>${nombreCelda(c)}</td><td>${pillTipo(tp)}</td><td>${c.dias === 0 ? 'Hoy' : 'Hace ' + esc(diasN(c.dias))}</td><td>${sp(sc, st)}</td>${vt ? `<td>${esc(c.vendedor || 'Atención general')}</td>` : ''}<td>${estadoPill(estadoClave(c, ag))}</td></tr>`; };
    return `<div class="sv-tablewrap"><table class="sv-table"><thead><tr><th>Cliente</th><th>Tipo</th><th>Último pedido</th><th>Señal</th>${vt ? '<th>Responsable</th>' : ''}<th>Estado</th></tr></thead><tbody>${ver.map(fila).join('')}</tbody></table></div>
      ${l.length > ver.length ? `<div class="sv-pie"><button type="button" class="sv-btn small" data-sc="clientes-mas">Mostrar más (${l.length - ver.length} restantes)</button></div>` : ''}`;
  }
  const resumenClientes = (calc, ag) => { const n = filtrarClientes(calc, ag).length; return `${n} ${n === 1 ? 'cliente' : 'clientes'}`; };
  function vistaClientes(calc, ag) {
    const f = E.cf, ets = v2Activo() ? v2().etiquetas : [], vt = veTodo();
    const enSeg = calc.clientes.filter(c => !['pausa', 'inactivo'].includes(estadoClave(c, ag)));
    const sel = (campo, etiqueta, opciones) => `<label class="sv-sel"><span class="sv-muted">${etiqueta}</span><select class="sv-field" data-cf="${campo}">${opciones.map(([v, t]) => `<option value="${at(v)}"${f[campo] === v ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`;
    const vendedores = [...new Set(calc.clientes.map(c => c.vendedor).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es')), al = filasAlertas(calc, ag, 8);
    return `${cabecera('users', 'Clientes', 'Seguimiento comercial, recompra y alertas por negocio.', esGestor() ? `<button type="button" class="sv-btn primary" data-sc="etiquetas" aria-haspopup="dialog">${ico('tag', 'ico-sm')}Etiquetas</button>` : '')}
      <ul class="sv-kpis" aria-label="Resumen de clientes">${kpi('blue', 'users', 'Total clientes', calc.clientes.length)}${kpi('green', 'check', 'En seguimiento', enSeg.length)}${kpi('red', '!', 'Dejaron de comprar', enSeg.filter(c => S.tipoDe(c) === 'recupero').length)}${kpi('blue', 'plus', 'Única compra', calc.clientes.filter(c => c.n === 1).length)}</ul>
      <section class="sv-card sv-sec sv-filtros" aria-label="Filtros"><div class="sv-tools"><label class="sv-search sv-search--cli">${ico('search', 'ico-sm')}<input type="search" id="sc-cq" class="sv-field" placeholder="Buscar cliente…" aria-label="Buscar en la lista de clientes" autocomplete="off" value="${at(E.cq)}"></label>
        ${sel('tipo', 'Tipo', [['', 'Todos'], ['habitual', 'Habitual'], ['unica', 'Única compra'], ['recupero', 'Dejó de comprar']])}
        ${sel('seguimiento', 'Seguimiento', [['', 'Todos'], ['activo', 'En seguimiento'], ['pausa', 'Sin seguimiento']])}
        ${sel('senal', 'Señal', [['', 'Todas'], ...Object.entries(SENALES)])}
        ${ets.length ? sel('etiqueta', 'Etiqueta', [['', 'Todas'], ...ets.map(e => [e.id, e.nombre])]) : ''}
        ${vt ? sel('vendedor', 'Vendedor', [['', 'Todos'], ['__ninguno', 'Atención general'], ...vendedores.map(v => [v, v])]) : ''}
        <button type="button" class="sv-btn small" data-sc="limpiar-filtros">Limpiar filtros</button></div></section>
      <div class="sv-two sv-two--cli">
        <section class="sv-card sv-sec" aria-labelledby="sv-cli-t"><div class="sv-ch"><h2 id="sv-cli-t">Listado de clientes</h2><span class="sv-count" id="sv-cli-n" aria-live="polite">${esc(resumenClientes(calc, ag))}</span></div><div id="sv-cli-res">${tablaClientes(calc, ag)}</div></section>
        <section class="sv-card sv-sec" aria-labelledby="sv-alc-t"><div class="sv-ch"><h2 id="sv-alc-t">${ico('triangle-alert')}Alertas destacadas</h2></div>${al.html}</section>
      </div>`;
  }
  // Al escribir o elegir un filtro solo se redibuja la lista: el campo y el teclado no se tocan.
  function refrescarClientes() {
    const r = $('sv-cli-res'); if (!r || !E.calc || !E.ag) return render();
    r.innerHTML = tablaClientes(E.calc, E.ag); const n = $('sv-cli-n'); if (n) n.textContent = resumenClientes(E.calc, E.ag);
  }

  function cuerpo(calc, ag) {
    if (bloqueado()) return estadoDatos();
    if (sinAsignar() || (v2Activo() && !calc.clientes.length && calc.ocultos > 0)) return estadoSinClientes();
    return E.vista === 'clientes' ? vistaClientes(calc, ag) : E.vista === 'agenda' ? vistaAgenda(calc, ag) : vistaPanel(calc, ag);
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
    const items = fr.map((f, i) => `<li>${esc(F.fechaLarga(f.fecha))}${i ? ` · a los ${diasN(F.diffDias(f.fecha, fr[i - 1].fecha))}` : ''}</li>`).join('');
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
        <p class="sc-tit-mini">${nf === 1 ? 'Único pedido' : `Últimos ${nf} pedidos`} · fecha del pedido</p>
        ${lineaTiempo(c)}
        <p class="sc-leyenda">${esc(calculo)} ${esc(pedidosN(c.n))} en total.</p>
        <p class="sc-leyenda"><b>Indicador${c.manual ? ' del cálculo' : ''}:</b> ${esc(ind[0].toUpperCase() + ind.slice(1))}.</p>
      </div></details>`;
  }

  // «Dejó de llevar»: sección destacada de la ficha (arriba, antes de los gráficos). Una fila por producto con cuántas veces lo compró y cuándo fue la última,
  // y «Resolver aviso» (producto retirado, con reemplazo o excepción de este cliente) para quien puede editar. Sin productos, no aparece.
  function dejoSec(c) {
    if (!c.dejoDeTodos.length) return '';
    const edit = puedeEditar();
    const filas = c.dejoDeTodos.map(d => `<li class="sc-dejo-f"><div class="sc-dejo-d"><b class="sc-dejo-n">${esc(d.nombre)}</b><span>lo llevó ${d.veces} ${d.veces === 1 ? 'vez' : 'veces'} · última: ${esc(corta(d.ultima))} <span class="sc-dejo-h">(hace ${d.hace} ${d.hace === 1 ? 'día' : 'días'})</span></span></div>${edit ? `<button type="button" class="sc-btn sc-btn--chico" data-sc="resolver" data-k="${at(c.clave)}" data-p="${at(d.clave)}">Resolver aviso</button>` : ''}</li>`).join('');
    return `<section class="sc-dejo sc-t-aviso" aria-labelledby="sc-dejo-t"><h4 id="sc-dejo-t" class="sc-dejo-t">${ico('triangle-alert')}Dejó de llevar <span class="sc-dejo-c">${c.dejoDeTodos.length}</span></h4><ul class="sc-dejo-l">${filas}</ul></section>`;
  }
  // Productos: lo que suele llevar y los avisos «Dejó de llevar» (ya sin los productos retirados o reemplazados ni las excepciones de este cliente).
  function productos(c) {
    const lista = (items, icono) => `<ul class="sc-prods">${items.map(t => `<li>${ico(icono, 'ico-sm')}<span>${esc(t)}</span></li>`).join('')}</ul>`;
    return `<section class="sc-f-sec"><h4>Productos</h4>
      ${c.lleva.length ? `<p class="sc-lbl">Suele llevar</p>${lista(c.lleva, 'package')}` : '<p class="sc-vacio">Todavía sin productos registrados.</p>'}
      ${cambiosProductos(c)}</section>`;
  }
  function contextoComercial(c) {
    const d = SegContexto.analizar({cliente:c,clientes:E.calc.clientes,pedidos:mezclar(),catalogo:estadoApp().products||[],contactos:(E.contactos.get(c.clave)||{}).lista||[],hoy:hoy(),reglas:E.datos.reglas||[]});
    const items = p => (p.items||[]).map(i=>`<li><b>${typeof itemLabelCorto==='function'?itemLabelCorto(i):esc(i.qty)}</b> ${esc(i.prod)}</li>`).join('');
    const ct=d.ultimoContacto, r=ct&&(RES[ct.resultado]||['Contacto']);
    return `<section class="sc-f-sec sc-contexto"><h4>Antes de hablarle</h4>
      ${d.pendientes.length?`<div class="sc-pendiente-repo"><b>Primero revisar · ${d.pendientes.length} reposición${d.pendientes.length===1?'':'es'} pendiente${d.pendientes.length===1?'':'s'}</b>${d.pendientes.map(p=>`<ul>${items(p)}</ul><span>${p.fechaEntrega?'Prevista: '+esc(F.fechaLarga(p.fechaEntrega)):'Sin fecha de entrega'}</span>`).join('')}</div>`:''}
      <div class="sc-contexto-grid"><div><h5>Último pedido${d.ultimo?' · '+esc(corta(d.ultimo.fechaPedido||d.ultimo.fecha)):''}</h5>${d.ultimo?`<ul>${items(d.ultimo)}</ul>${d.ultimo.notas?`<p>${esc(d.ultimo.notas)}</p>`:''}`:'Sin pedido registrado'}</div>
      <div><h5>Último contacto</h5>${ct?`<b>${esc(r[0])}</b>${ct.nota?`<p>${esc(ct.nota)}</p>`:''}${ct.volver_el?`<p>Volver: ${esc(F.fechaLarga(ct.volver_el))}</p>`:''}`:'Sin resultado registrado'}</div></div>
      <details class="sc-hist sc-resumen-eventos"><summary>Movimientos recientes</summary><ol class="sc-eventos">${d.eventos.map(e=>`<li><div><b>${esc(e.tipo)}</b> · ${esc(corta(e.fecha))}<p>${esc(e.texto)}</p></div></li>`).join('')}</ol></details></section>
      <section class="sc-f-sec sc-oportunidades"><h4>Qué puede volver a pedir</h4><div class="sc-familias">${d.matriz.map(f=>`<div class="sc-familia"><b>${esc(f.nombre)}</b><span class="${f.estado==='Dejó de pedir'?'sc-warn':''}">${esc(f.estado)}</span></div>`).join('')||'<p>Faltan productos del catálogo para comparar.</p>'}</div>
      ${d.pendientes.length?'<p>Revisá los faltantes antes de ofrecer algo nuevo.</p>':d.sugerencias.length?`<div class="sc-sugerencias">${d.sugerencias.map(s=>`<p><b>Consultar por ${esc(s.nombre)}</b><br>${s.clientes} clientes con familias de compra en común también lo pidieron. Sin compras registradas de esta familia para este cliente.</p>`).join('')}</div>`:'<p class="sc-muted">Todavía no hay suficiente evidencia para sugerir otra familia.</p>'}
      <details class="sc-criterio"><summary>Cómo se interpreta</summary><p>Familias orientativas según el nombre de productos del catálogo. Habitual: un producto pedido en al menos dos fechas. Dejó de pedir: todos los productos de esa familia tienen un aviso vigente. Las sugerencias usan compras de los últimos 180 días de clientes visibles para vos; no confirman interés ni stock.</p>${d.sinClasificar?`<p>${d.sinClasificar} producto${d.sinClasificar===1?'':'s'} sin catálogo o sin clasificación útil. No se usa${d.sinClasificar===1?'':'n'} para sugerencias.</p>`:''}</details></section>`;
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
    partes.push(`<b>${esc(motivoAgenda(t))}</b>.`);
    if (t.estado !== 'escribi' && !t.movido) partes.push(`Próximo contacto: <b>${esc(diaLargo(t.dia))}</b>.`);
    return partes.join(' ');
  }
  // De qué tipo es el cliente (se le habla o se le hace seguimiento), con su etiqueta y una frase
  function tipoFicha(c) {
    const t = S.tipoDe(c);
    const et = t === 'unica' ? ['unica', 'user-plus', 'Única compra'] : t === 'recupero' ? ['dejo', 'trending-down', 'Dejó de comprar'] : ['neutro', 'circle-check', 'Habitual'];
    return `<p class="sc-acc-tipo"><span class="sc-pill sc-t-${et[0]}">${ico(et[1], 'ico-sm')}${et[2]}</span> <span>${esc(TIPO_FRASE[t])}</span></p>`;
  }
  // Acciones de arriba de la ficha: «Le escribí» (alterna), «Mover a…» y «Sin seguimiento» / «Retomar». Solo con permiso de editar y con la base lista.
  function accionesFicha(c) {
    const k = at(c.clave), pausado = !!(c.manual && c.manual.tipo === 'pausa'), t = E.ag && E.ag.porCliente.get(c.clave), dis = E.guardando.has(c.clave) ? ' disabled' : '';
    const b = [];
    if (puedeAgendar() && t && !pausado) {
      b.push(`<button type="button" class="sc-btn" data-sc="escribi" data-k="${k}" aria-pressed="${t.estado === 'escribi'}"${dis}>${ico('check', 'ico-sm')}Le escribí</button>`);
      if (t.estado === 'escribi') b.push(`<button type="button" class="sc-btn sc-btn--prim" data-sc="resultado" data-k="${k}" aria-haspopup="dialog"${dis}>${ico('list', 'ico-sm')}Resultado</button>`);
      b.push(`<button type="button" class="sc-btn" data-sc="mover" data-k="${k}" aria-haspopup="dialog"${dis}>${ico('calendar-days', 'ico-sm')}Mover a…</button>`);
    }
    if (puedeEditar()) b.push(pausado ? `<button type="button" class="sc-btn sc-btn--prim" data-sc="retomar" data-k="${k}"${dis}>${ico('play', 'ico-sm')}Volver a seguimiento</button>` : `<button type="button" class="sc-btn" data-sc="sinseg" data-k="${k}" aria-haspopup="dialog"${dis}>${ico('pause', 'ico-sm')}Sacar de seguimiento</button>`);
    const tipo = pausado ? '' : tipoFicha(c);
    return `<section class="sc-acc" aria-label="Seguimiento de este cliente">${tipo}<p class="sc-acc-l">${lineaAgenda(c)}</p>${b.length ? `<div class="sc-btns">${b.join('')}</div>` : ''}</section>`;
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

  const observacionDe = c => { const cli = ((estadoApp() && estadoApp().clientes) || []).find(x => String(x.n).toLowerCase() === c.nombre.toLowerCase()); return cli && cli.obs ? cli.obs : ''; };
  // Encabezado con datos en línea (.facts de la referencia) y cuatro mini-estadísticas
  function factsFicha(c, dir) {
    const f = (k, v) => `<div class="sv-fact"><span class="sv-muted">${k}</span><b>${v}</b></div>`, t = E.ag && E.ag.porCliente.get(c.clave);
    return `<div class="sv-facts">${f('Dirección', dir ? esc(dir) : 'Sin completar')}${f('Último pedido', esc(F.fechaLarga(c.ultimo)))}${f('Último despacho', c.ultimaEntrega ? esc(F.fechaLarga(c.ultimaEntrega)) : 'Sin fecha registrada')}${(v2Activo() && (veTodo() || esGestor())) ? f('Vendedor', esc(c.vendedor || 'Atención general')) : ''}${(c.etiquetas || []).length ? `<div class="sv-fact"><span class="sv-muted">Etiquetas</span>${chipsEt(c)}</div>` : ''}</div>`;
  }
  function minisFicha(c) {
    const t = E.ag && E.ag.porCliente.get(c.clave), [sc, st] = senal(c, t), cada = Math.max(1, Math.round(c.intervalo));
    const m = (k, v, cls) => `<div class="sv-mini ${cls || ''}"><span class="sv-muted">${k}</span><strong>${v}</strong></div>`;
    return `<div class="sv-minis">${m('Último pedido', c.dias === 0 ? 'Hoy' : 'Hace ' + esc(diasN(c.dias)))}${m('Frecuencia', `${c.intervaloPropio ? '' : '~'}cada ${esc(diasN(cada))}`, 'green')}${m('Señal', esc(st), sc === 'red' ? 'red' : sc === 'amber' ? 'amber' : '')}${m('Próximo contacto', E.ag ? esc(proximoTxt(c, E.ag)) : '—')}</div>`;
  }
  function ficha(c) {
    const dir = direccionDe(c), obs = observacionDe(c);
    return `<div class="modal-handle"></div>
      <div class="modal-header"><h3 class="sc-f-nom" id="sc-f-nom">${esc(c.nombre)}</h3><button type="button" class="close-btn" data-sc="cerrar-ficha" aria-label="Cerrar">${ico('x')}</button></div>
      <div class="sc-f sc-t-${tono(c)}">
      ${E.aviso ? bannerAviso() : ''}
      <div class="sc-f-cab">${pill(c)}<span class="sc-wa-slot">${contactadoPill(c)}</span></div>
      ${factsFicha(c, dir)}
      ${minisFicha(c)}
      ${obs ? `<p class="sc-f-obs sc-muted">${ico('info', 'ico-sm')}<span>${esc(obs)}</span></p>` : ''}
      ${accionesFicha(c)}
      ${contextoComercial(c)}
      ${metaFicha(c)}
      ${dejoSec(c)}
      ${panelSeguimiento(c)}
      <button type="button" class="sc-wa-link" data-wa-client="${esc(c.nombre)}">WhatsApp e historial de contacto</button>
      <section class="sc-f-sec sc-f-sec--1"><h4>¿Cuánto pasó respecto de su ritmo?</h4>${comparacion(c)}</section>
      <section class="sc-f-sec"><h4>¿Qué días suele pedir?</h4>${diasChart(c)}</section>
      ${plazoSec(c)}
      ${productos(c)}
      ${historialContactos(c)}
      ${c.observacion ? `<section class="sc-f-sec"><h4>Observación</h4><p class="sc-obs">${esc(c.observacion.texto)} <span class="sc-muted">(${esc(F.fmtCorta(c.observacion.fecha))})</span></p></section>` : ''}
      ${historial(c)}
    </div>`;
  }
  // ── La ficha como ventana emergente (#scModal, en index.html) ──
  // Se dibuja dentro de #sc-ficha (el recuadro .modal). Al volver a dibujarla (cada refresco o acción) se conservan el desplazamiento y el foco.
  // Recuerda qué desplegables de la ficha (historial y cálculo, cambios de productos) están abiertos, para que sigan así al volver a dibujarla o abrirla de nuevo.
  function recordarAbiertos() {
    const f = $('sc-ficha'); if (!f) return;
    const h = f.querySelector('details.sc-hist'); if (h) { if (h.open) E.ritmo.add(h.dataset.k); else E.ritmo.delete(h.dataset.k); }
    const cm = f.querySelector('details.sc-cambios'); if (cm) E.cambiosAbierto = cm.open;
  }
  function pintarFicha(calc) {
    const ov = $('scModal'), f = $('sc-ficha'); if (!ov || !f) return;
    if (!E.fichaAbierta || !E.sel) { if (ov.classList.contains('open')) { E.fichaAbierta = false; ov.classList.remove('open'); } return; }
    const c = calc.clientes.find(x => x.clave === E.sel);
    if (!c) {   // el cliente elegido ya no figura (se actualizó la lista): se cierra y se dice
      E.sel = null; E.fichaAbierta = false; E.origen = null; ov.classList.remove('open'); f.innerHTML = '';
      E.aviso = { tono: 'aviso', html: 'El cliente que tenías abierto ya no figura en el seguimiento: la lista se actualizó.' }; return;
    }
    recordarAbiertos();
    const nueva = !ov.classList.contains('open'), top = f.scrollTop, act = document.activeElement;
    const dentro = !nueva && act && f.contains(act) ? { s: act.dataset.sc, k: act.dataset.k } : null;
    f.innerHTML = ficha(c);
    ov.classList.add('open');
    if (nueva) { f.scrollTop = 0; const x = f.querySelector('.close-btn'); if (x) x.focus({ preventScroll: true }); }
    else {
      f.scrollTop = top;
      const el = dentro && dentro.s && f.querySelector(`[data-sc="${dentro.s}"]${dentro.k ? `[data-k="${CSS.escape(dentro.k)}"]` : ''}:not([disabled])`);
      if (el) el.focus({ preventScroll: true });
    }
  }
  // La ventana «Todos los clientes» pasó a ser la vista «Clientes» (lista completa con filtros, «Sacar de seguimiento» y «Volver»).
  const cerrarVentanas = () => { cerrarFicha(); };

  function cerrarFicha() { const ov = $('scModal'); if (ov) ov.classList.remove('open'); }
  // Cierre desde cualquier lado (X, Escape, tocar el fondo —que lo hace el código general de los .overlay—): el foco vuelve a la tarjeta de donde se abrió.
  function alCerrarFicha() {
    if (!E.fichaAbierta) return;
    recordarAbiertos();
    const o = E.origen; E.fichaAbierta = false; E.sel = null; E.origen = null;
    E.foco = null;   // un foco pendiente de la ventana (p. ej. de un diálogo que se cerró justo antes) ya no tiene a dónde volver
    if (E.aviso) render();   // el aviso que se veía dentro de la ventana pasa a verse arriba del calendario
    document.querySelectorAll('#sc-raiz [aria-current]').forEach(x => x.removeAttribute('aria-current'));
    const f = $('sc-ficha'); if (f) f.innerHTML = '';
    let el = null;
    if (o && o.tipo === 'card') el = document.querySelector(`#sc-raiz .daytask[data-k="${CSS.escape(o.k)}"][data-est="${o.est}"]`) || document.querySelector(`#sc-raiz .daytask[data-k="${CSS.escape(o.k)}"]`);
    else if (o && o.tipo === 'vista') el = document.querySelector(`#sc-raiz [data-sc="fila"][data-k="${CSS.escape(o.k)}"]`);
    if (!el) el = $('sc-q');
    if (el) el.focus({ preventScroll: true });
  }
  (function vigilarFicha() {
    const ov = $('scModal'); if (!ov || !window.MutationObserver) return;
    new MutationObserver(() => { if (!ov.classList.contains('open')) alCerrarFicha(); }).observe(ov, { attributes: true, attributeFilter: ['class'] });
  })();

  // ── Pantalla ──
  const bannerAviso = () => `<div class="sc-banner sc-t-${E.aviso.tono || 'aviso'}" role="alert">${ico(E.aviso.tono === 'error' ? 'circle-alert' : 'info', 'ico-sm')}<p>${E.aviso.html}</p><button type="button" class="sc-x" data-sc="cerrar-aviso" aria-label="Cerrar aviso">${ico('x', 'ico-sm')}</button></div>`;
  // Avisos de la pantalla (guardado, conflicto, datos viejos): se ven arriba y se pueden cerrar.
  function avisos() {
    const t = [];
    if (E.datos.error) t.push(`<p class="sc-aviso sc-aviso--error" role="alert">No se pudieron actualizar las pausas y movimientos. Lo que ves es de las ${esc(hora(E.datos.ultimoOk))} y puede estar desactualizado. <button type="button" class="sc-link" data-sc="reintentar-datos">Reintentar</button></p>`);
    else if (esEditor() && (E.datos.estado === 'ok' || E.datos.estado === 'noInstalado') && !E.datos.agendaOk) t.push(`<p class="sc-aviso sc-aviso--agenda">El calendario muestra los días calculados. Todavía no se puede mover a los clientes de día ni marcar «Le escribí»${E.datos.agendaMensaje ? ` <span class="sc-muted">(${esc(E.datos.agendaMensaje)})</span>` : ''}.</p>`);
    if (E.aviso && !E.fichaAbierta) t.push(bannerAviso());   // con una ventana abierta el aviso se ve dentro de ella (la tapa)
    return t.join('');
  }
  // Sin poder leer las decisiones guardadas no se muestra el calendario: podría incluir a clientes que están sin seguimiento.
  const bloqueado = () => E.datos.estado === 'error' || E.datos.estado === 'sinPermiso';
  function estadoDatos() {
    const sinPermiso = E.datos.estado === 'sinPermiso';
    return `<div class="sc-estado" role="alert"><b>${sinPermiso ? 'Tu usuario todavía no tiene permiso para el seguimiento.' : 'No se pudieron cargar las pausas y los movimientos.'}</b><p>${sinPermiso ? 'Avisale a quien administra la app. Mientras tanto no se muestra el calendario.' : 'Sin eso, el calendario podría incluir a clientes que están sin seguimiento. Revisá la conexión y probá de nuevo.'}${E.datos.mensaje ? ` <span class="sc-muted">(${esc(E.datos.mensaje)})</span>` : ''}</p><button type="button" class="sc-accion" data-sc="reintentar-datos">Reintentar</button></div>`;
  }
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
    if (E.filtroEt && !(v2Activo() && v2().etiquetas.some(e => e.id === E.filtroEt))) E.filtroEt = '';
    if (!calc.clientes.length && !calc.ocultos && !sinAsignar()) { raiz.className = 'sc'; raiz.innerHTML = `<div class="sc-estado"><b>Todavía no hay pedidos para analizar.</b><p>Cuando se carguen pedidos, acá aparece a quién escribirle cada día.</p></div>`; return; }
    E.ag = S.agenda(calc, { hoy: hoy(), agenda: E.agendaMapa, pedidos: mezclar() });
    const aviso = E.cargando ? '<p class="sc-aviso">Actualizando historial…</p>'
      : E.error ? `<p class="sc-aviso sc-aviso--error" role="alert">No se pudo actualizar el historial. Lo que ves es de las ${esc(hora(E.ts))} y puede estar desactualizado. <button type="button" class="sc-link" data-sc="reintentar">Reintentar</button></p>` : '';
    pintarFicha(calc);   // antes de armar los avisos: si el cliente abierto ya no figura, se cierra y se avisa
    const foco = document.activeElement && document.activeElement.id === 'sc-q' ? { a: document.activeElement.selectionStart, b: document.activeElement.selectionEnd } : null;
    raiz.className = 'sc';
    const sinVista = bloqueado() || sinAsignar();
    raiz.innerHTML = `${sinVista ? '' : navSecundaria()}${aviso}${avisos()}
      <div id="sc-cuerpo">${cuerpo(calc, E.ag)}</div>`;
    marcarMas();
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
    return `<div class="sc" aria-busy="true"><div class="sv-head"><div><h1>Seguimiento comercial</h1><p>Cargando el historial de pedidos…</p></div></div>${'<div class="sc-esq"><i></i><i></i></div>'.repeat(6)}</div>`;
  }

  // ── Acciones ──
  // Elegir una tarjeta (o un resultado del buscador, o alguien de «Todos los clientes») abre su ficha en la ventana emergente; el calendario no se mueve.
  function seleccionar(k, boton) {
    const c = E.calc && E.calc.clientes.find(x => x.clave === k); if (!c) return;
    E.sel = k; E.fichaAbierta = true;
    E.origen = !boton ? { tipo: 'bus', k } : boton.classList.contains('daytask') ? { tipo: 'card', k, est: boton.dataset.est } : boton.classList.contains('sc-bus-it') ? { tipo: 'bus', k } : { tipo: 'vista', k };
    if (E.q) { E.q = ''; const q = $('sc-q'); if (q) q.value = ''; renderBusqueda(); }
    document.querySelectorAll('#sc-raiz [aria-current]').forEach(x => x.removeAttribute('aria-current'));
    document.querySelectorAll(`#sc-raiz .daytask[data-k="${CSS.escape(k)}"]`).forEach(x => x.setAttribute('aria-current', 'true'));
    pintarFicha(E.calc);
    cargarContactos(k);
  }
  function textoLista() {
    const items = (E.ag.dias.find(d => d.hoy) || { tarjetas: [] }).tarjetas.filter(t => t.estado === 'pendiente');
    const hab = items.filter(t => t.tipo === 'habitual'), seg = items.filter(t => t.tipo !== 'habitual');
    const bloque = (tit, l, f) => (l.length ? `${tit}\n` + l.map((t, i) => f(t, i)).join('\n') : '');
    return [`Para escribir hoy (${fechaTitulo()})`,
      bloque('Hablarles:', hab, (t, i) => S.lineaTexto(t.c, i) + (t.atrasado ? ' [atrasado]' : '') + (t.reescribir ? ' [volver a escribir]' : '')),
      bloque('Seguimiento:', seg, (t, i) => S.lineaTexto(t.c, i) + (t.tipo === 'unica' ? ' (única compra)' : ' (dejó de comprar)'))].filter(Boolean).join('\n');
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
    if (f.tl) {   // la acción se hizo desde la lista de Clientes: el foco vuelve al botón de esa fila (que puede haber cambiado de «Sacar» a «Volver»)
      const kk = CSS.escape(f.k), el = document.querySelector(`#sc-raiz [data-sc="sacar"][data-k="${kk}"]:not([disabled]), #sc-raiz [data-sc="volver-seg"][data-k="${kk}"]:not([disabled])`) || document.querySelector(`#sc-raiz [data-sc="fila"][data-k="${kk}"]`);
      E.foco = null; if (el) el.focus({ preventScroll: true });
      return;
    }
    if (f.etq) { E.foco = null; const b = document.querySelector('#sc-raiz [data-sc="etiquetas"]'); if (b) b.focus({ preventScroll: true }); return; }
    if (f.acc && !E.fichaAbierta && f.acc !== 'resultado' && f.acc !== 'escribi') { E.foco = null; return; }   // el botón era de la ficha y la ficha ya se cerró
    const btn = f.acc && document.querySelector(`#sc-ficha [data-sc="${f.acc}"][data-k="${CSS.escape(f.k)}"]`);
    if (btn && btn.disabled) return;   // se está guardando: el botón se habilita al terminar y recién ahí recibe el foco
    E.foco = null;
    const kk = CSS.escape(f.k), el = btn || document.querySelector(`#sc-raiz [data-sc="${f.acc || 'escribi'}"][data-k="${kk}"]:not([disabled]), #sc-raiz [data-sc="resultado"][data-k="${kk}"]:not([disabled])`) || document.querySelector(`#sc-raiz .daytask[data-k="${kk}"], #sc-raiz [data-sc="fila"][data-k="${kk}"]`);
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
  // Una escritura que no responde en PLAZO.escritura se da por fallida (la pantalla vuelve atrás); como la operación lleva su propio id, reintentarla es seguro.
  const conPlazo = (promesa, ms) => { let t; return Promise.race([Promise.resolve(promesa), new Promise(res => { t = setTimeout(() => res({ ok: false, error: 'tardó demasiado en responder: probá de nuevo', timeout: true }), ms || PLAZO.escritura); })]).finally(() => clearTimeout(t)); };
  // Id de una operación: se genera UNA vez y se reutiliza en los reintentos mientras sea la misma solicitud (misma `huella`); una solicitud distinta lleva un id nuevo.
  const idNuevo = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));
  function opId(clave, huella) { const o = E.ops.get(clave); if (o && o.huella === huella) return o.id; const n = { id: idNuevo(), huella }; E.ops.set(clave, n); return n.id; }
  async function agendaCambio(c, nueva, llamada, texto, deshacer) {
    const k = c.clave;
    if (E.guardando.has(k) || !puedeAgendar()) return false;
    const previa = E.agendaMapa.get(k) || null;
    E.guardando.add(k); E.agendaMapa.set(k, nueva); E.ver++; E.huella = ''; render();
    let r; try { r = await conPlazo(llamada()); } catch (e) { r = { ok: false, error: String((e && e.message) || e) }; }
    E.guardando.delete(k);
    if (r && r.ok) { E.ver++; E.huella = ''; render(); E.foco = null; if (deshacer) avisoAccion(texto, { agenda: { k, nombre: c.nombre, tipo: deshacer.tipo, previa } }); else toastCorto(texto); return true; }
    if (previa) E.agendaMapa.set(k, previa); else E.agendaMapa.delete(k);
    E.ver++; E.huella = '';
    E.aviso = { tono: 'error', html: esc(`No se pudo guardar${r && r.error ? ' (' + r.error + ')' : ''}. ${c.nombre} sigue donde estaba.`) }; render();
    return false;
  }
  const toastCorto = txt => { E.aviso = { tono: 'ok', html: esc(txt) }; render(); };
  const filaDe = k => E.agendaMapa.get(k) || { fecha: null, ciclo: null, escrito: null };
  // Mueve a un día de la ventana (fecha) o lo vuelve a su día calculado (fecha null, solo mediante «Volver a su día»).
  function moverA(k, fecha) {
    const c = clienteDe(k), t = E.ag && E.ag.porCliente.get(k); if (!c || !t || !puedeAgendar() || E.guardando.has(k)) return false;
    const vuelve = fecha === null;
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
      <p class="sc-dlg-s">Sale del calendario y no se le marca día para escribirle hasta que lo retomes (en «Todos los clientes» o en su ficha). <b>Sus pedidos se siguen cargando y despachando con normalidad.</b></p>
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

  // ═══ Seguimiento v2: resultado de contacto, etiquetas, vendedor e historial ═══
  const sinDom = f => (F.diaSemana(f) === 0 ? F.sumarDias(f, 1) : f);
  // Atajos de día para volver a escribir según el resultado.
  function atajosDia(c, res) {
    const h = hoy(), l = [];
    if (res === 'tiene_stock') {
      l.push(['En 2 días hábiles', F.habilMas(h, 2)]);
      const prox = (c.diasHab || []).map(d => { let f = F.sumarDias(h, 1); for (let i = 0; i < 7 && F.diaSemana(f) !== d; i++) f = F.sumarDias(f, 1); return f; }).sort()[0];
      if (prox) l.push([`El próximo ${S.DIAS[F.diaSemana(prox)]}`, prox]);
    } else if (res === 'no_interesa') {
      l.push(['En su ciclo', S.diaCalculado({ ultimo: h, intervalo: c.intervalo, etiquetas: c.etiquetas })]);
      l.push(['En 2 semanas', sinDom(F.sumarDias(h, 14))]);
    }
    return l.filter(([, f], i, a) => a.findIndex(x => x[1] === f) === i);
  }
  function pasoResultado() {
    const d = E.dlg, c = clienteDe(d.k), t = E.ag && E.ag.porCliente.get(d.k); if (!c || !t) return cerrarDlg();
    const nota = (txt, req) => `<label class="sc-campo"><span>Nota <span class="sc-muted">${req ? '' : '(opcional)'}</span></span><textarea name="nota" rows="2" maxlength="500" placeholder="Qué dijo, qué quedó pendiente…">${esc(d.nota || '')}</textarea></label>`;
    const errDlg = '<p class="sc-dlg-err" role="alert" hidden></p>', cancelar = '<button type="button" class="sc-btn" data-d="cerrar">Cancelar</button>', atras = '<button type="button" class="sc-btn" data-d="res-menu">Volver</button>';
    const fecha = `<label class="sc-campo"><span>Otra fecha</span><span class="sc-campo-fila"><input type="date" name="fecha" class="sc-fecha-in sc-fecha-in--s" min="${at(F.sumarDias(hoy(), 1))}" max="${at(F.sumarDias(hoy(), 120))}"><button type="button" class="sc-btn" data-d="res-fecha">Elegir esta fecha</button></span></label>`;
    if (d.sub === 'dia') {
      const ops = atajosDia(c, d.res).map(([txt, f]) => `<li><button type="button" class="sc-op" data-d="res-dia" data-f="${f}">${ico('calendar-days')}<span class="sc-op-t"><b>${esc(txt)}</b><span>${esc(F.fechaLarga(f))}</span></span></button></li>`).join('');
      abrirDlg(`<div class="sc-dlg-c"><h3 id="sc-dlg-t">${esc(RES[d.res][0])}: ¿cuándo le escribimos?</h3><p class="sc-dlg-s"><b>${esc(c.nombre)}</b> vuelve a la agenda el día que elijas. Los domingos pasan al lunes.</p>
        ${nota()}<ul class="sc-ops">${ops}</ul>${fecha}${errDlg}<div class="sc-dlg-pie">${atras}${cancelar}</div></div>`, '.sc-op');
    } else if (d.sub === 'otro') {
      abrirDlg(`<div class="sc-dlg-c"><h3 id="sc-dlg-t">Otro resultado</h3><p class="sc-dlg-s">Anotá qué pasó con <b>${esc(c.nombre)}</b>. Si quedó una fecha para volver, elegila (si no, sigue esperando).</p>
        ${nota(true)}${fecha.replace('Elegir esta fecha', 'Guardar con esta fecha')}${errDlg}<div class="sc-dlg-pie">${atras}<button type="button" class="sc-accion" data-d="res-otro">Guardar nota</button></div></div>`, 'textarea');
    } else {
      const cuando = t.escrito ? (t.escrito === hoy() ? 'hoy' : 'el ' + diaCorto(t.escrito)) : '';
      abrirDlg(`<div class="sc-dlg-c"><h3 id="sc-dlg-t">Resultado: ${esc(c.nombre)}</h3><p class="sc-dlg-s">${cuando ? `Le escribiste ${esc(cuando)}. ` : ''}¿Qué pasó? <b>No cambia sus pedidos ni sus números.</b></p>
        <ul class="sc-ops">${['tiene_stock', 'no_interesa', 'no_contesto', 'otro'].map(r => `<li><button type="button" class="sc-op" data-d="res-op" data-r="${r}">${ico(RES[r][1])}<span class="sc-op-t"><b>${esc(RES[r][0])}</b><span>${esc(RES[r][2])}</span></span></button></li>`).join('')}</ul>
        ${errDlg}<div class="sc-dlg-pie">${cancelar}</div></div>`, '.sc-op');
    }
  }
  function abrirResultado(k) {
    const c = clienteDe(k), t = E.ag && E.ag.porCliente.get(k); if (!c || !t || t.estado !== 'escribi' || !puedeAgendar() || E.guardando.has(k)) return;
    E.foco = E.foco || { k, acc: 'resultado' }; E.dlg = { k, paso: 'resultado', sub: 'menu', res: '', nota: '' };
    pasoResultado();
  }
  const notaDlg = () => { const n = document.querySelector('#sc-dlg [name="nota"]'); return n ? n.value.trim() : ''; };
  function resultadoOp(r) {
    const d = E.dlg; if (!d) return;
    d.nota = notaDlg() || d.nota;
    if (r === 'no_contesto') { cerrarDlg(); registrarResultado(d.k, r, null, d.nota); return; }
    d.res = r; d.sub = r === 'otro' ? 'otro' : 'dia'; pasoResultado();
  }
  function resultadoFecha(f, conNota) {
    const d = E.dlg; if (!d) return;
    const nota = notaDlg();
    if (!f) return errorDlg('Elegí una fecha.');
    if (f <= hoy() || f > F.sumarDias(hoy(), 120)) return errorDlg('La fecha tiene que ser desde mañana y dentro de los próximos 4 meses.');
    if (d.res === 'otro' && !nota) return errorDlg('Anotá qué pasó.');
    cerrarDlg(); registrarResultado(d.k, d.res, sinDom(f), nota);
  }
  function resultadoOtro() {
    const d = E.dlg; if (!d) return;
    const nota = notaDlg(); if (!nota) return errorDlg('Anotá qué pasó.');
    cerrarDlg(); registrarResultado(d.k, 'otro', null, nota);
  }
  // Se ve enseguida (sale de «Esperando» y, con día, aparece ese día); si la base no lo guarda, vuelve atrás con un mensaje. La operación lleva un id que se reutiliza en los reintentos.
  async function registrarResultado(k, resultado, volver, nota) {
    const c = clienteDe(k), t = E.ag && E.ag.porCliente.get(k); if (!c || !t || !puedeAgendar() || E.guardando.has(k)) return;
    const id = opId('contacto:' + k, [resultado, volver || '', nota || ''].join('|')), fila = filaDe(k);
    const nueva = resultado === 'no_contesto' ? { fecha: fila.fecha, ciclo: fila.ciclo, escrito: null } : volver ? { fecha: volver, ciclo: c.ultimo, escrito: null } : fila;
    const previoMeta = E.sobre.meta.get(k);
    E.sobre.meta.set(k, Object.assign({}, previoMeta || {}, { contacto: { resultado, volver_el: volver || null, nota: nota || null, autor: quienSoy(), creado_en: new Date().toISOString() } }));
    const texto = `${c.nombre}: ${RES[resultado][0].toLowerCase()}${volver ? `; le escribimos ${diaLargo(volver)}` : resultado === 'no_contesto' ? '; vuelve a pendiente' : ''}.`;
    const ok = await agendaCambio(c, nueva, () => almacenActual().contactoRegistrar({ id, clave: k, resultado, volver_el: volver, nota, ciclo: c.ultimo }), texto, null);
    if (ok) { E.ops.delete('contacto:' + k); await recargar(); cargarContactos(k, true); E.ver++; E.huella = ''; render(); }
    else { if (previoMeta) E.sobre.meta.set(k, previoMeta); else E.sobre.meta.delete(k); E.ver++; E.huella = ''; render(); }
  }

  // Historial de contactos de la ficha (últimos 30, desde seg_contactos)
  async function cargarContactos(k, forzar) {
    if (!v2Activo()) return;
    const previo = E.contactos.get(k);
    if (!forzar && previo && previo.estado === 'ok' && Date.now() - previo.ts < 30000) return;
    E.contactos.set(k, { estado: previo && previo.estado === 'ok' ? 'ok' : 'cargando', lista: previo ? previo.lista : [], ts: previo ? previo.ts : 0 });
    let r; try { r = await conPlazo(almacenActual().contactosLeer(k)); } catch (e) { r = { ok: false, error: String((e && e.message) || e) }; }
    E.contactos.set(k, r && r.ok ? { estado: 'ok', lista: r.lista, ts: Date.now() } : { estado: 'error', lista: [], mensaje: (r && r.error) || '', ts: 0 });
    if (E.fichaAbierta && E.sel === k && E.calc) pintarFicha(E.calc);
  }
  function historialContactos(c) {
    if (!v2Activo()) return '';
    const e = E.contactos.get(c.clave) || { estado: 'cargando', lista: [] };
    let cuerpoC;
    if (e.estado === 'error') cuerpoC = `<p class="sc-vacio">No se pudo leer el historial${e.mensaje ? ` <span class="sc-muted">(${esc(e.mensaje)})</span>` : ''}. <button type="button" class="sc-link" data-sc="contactos-reintentar" data-k="${at(c.clave)}">Reintentar</button></p>`;
    else if (e.estado === 'cargando' && !e.lista.length) cuerpoC = '<p class="sc-vacio">Cargando…</p>';
    else if (!e.lista.length) cuerpoC = '<p class="sc-vacio">Todavía no hay resultados registrados.</p>';
    else cuerpoC = `<ol class="sc-ctos">${e.lista.map(x => { const d = new Date(x.creado_en), r = RES[x.resultado] || [x.resultado, 'info'];
      return `<li><span class="sc-cto-i">${ico(r[1], 'ico-sm')}</span><div><b>${esc(r[0])}</b>${x.volver_el ? ` <span class="sc-muted">· volver el ${esc(diaTxt(x.volver_el))}</span>` : ''}${x.nota ? `<p class="sc-cto-n">${esc(x.nota)}</p>` : ''}<span class="sc-muted sc-cto-m">${esc(corta(F.ymd(d)))} ${esc(hora(d.getTime()))} · ${esc(x.autor || '')}</span></div></li>`; }).join('')}</ol>`;
    return `<section class="sc-f-sec"><h4>Historial de contactos</h4>${cuerpoC}</section>`;
  }
  // Vendedor y etiquetas de la ficha: quien puede asignar (administrador o ve_todo) las edita; el resto las ve (etiquetas) sin editar.
  function metaFicha(c) {
    if (!v2Activo()) return '';
    const k = at(c.clave), ocup = E.guardandoMeta.has(c.clave) ? ' disabled aria-busy="true"' : '', act = new Set((c.etiquetas || []).map(e => e.id)), todas = v2().etiquetas;
    if (!esGestor()) return (c.etiquetas || []).length ? `<section class="sc-f-sec sc-f-sec--meta"><h4>Etiquetas</h4>${chipsEt(c)}</section>` : '';
    const sel = `<label class="sc-campo sc-campo--h"><span>Vendedor</span><select data-sc="vendedor-sel" data-k="${k}"${ocup}><option value="">Atención general (sin vendedor)</option>${v2().usuarios.map(u => `<option value="${at(u.nombre)}"${S.norm(u.nombre) === S.norm(c.vendedor || '') ? ' selected' : ''}>${esc(u.nombre)}</option>`).join('')}</select></label>`;
    const chips = todas.length ? `<div class="sc-chipsel-l" role="group" aria-label="Etiquetas del cliente">${todas.map(e => `<button type="button" class="sc-etb" data-sc="et-toggle" data-k="${k}" data-e="${at(e.id)}" aria-pressed="${act.has(e.id)}"${ocup}>${ico(act.has(e.id) ? 'check' : 'plus', 'ico-sm')}${esc(e.nombre)}${e.dia_semana ? `<small>${esc(ABREV[e.dia_semana])}</small>` : ''}</button>`).join('')}</div>` : '<p class="sc-vacio">Todavía no hay etiquetas. Se crean desde la vista Clientes, en «Etiquetas».</p>';
    return `<section class="sc-f-sec sc-f-sec--meta" aria-label="Vendedor y etiquetas">${sel}<h4 class="sc-h-et">Etiquetas</h4>${chips}</section>`;
  }
  async function cambiarEtiqueta(k, eid) {
    const c = clienteDe(k); if (!c || !esGestor() || E.guardandoMeta.has(k)) return;
    const act = new Set((c.etiquetas || []).map(e => e.id)); if (act.has(eid)) act.delete(eid); else act.add(eid);
    const ids = [...act], objs = ids.map(id => v2().etiquetas.find(e => e.id === id)).filter(Boolean), previo = E.sobre.meta.get(k);
    E.guardandoMeta.add(k); E.sobre.meta.set(k, Object.assign({}, previo || {}, { etiquetas: objs })); E.foco = { k, acc: 'et-toggle' }; E.ver++; E.huella = ''; render();
    let r; try { r = await conPlazo(almacenActual().clienteEtiquetas({ clave: k, etiquetas: ids })); } catch (e) { r = { ok: false, error: String((e && e.message) || e) }; }
    E.guardandoMeta.delete(k);
    if (r && r.ok) { await recargar(); E.ver++; E.huella = ''; render(); return; }
    if (previo) E.sobre.meta.set(k, previo); else E.sobre.meta.delete(k);
    E.ver++; E.huella = ''; E.aviso = { tono: 'error', html: esc(`No se pudieron guardar las etiquetas${r && r.error ? ' (' + r.error + ')' : ''}. ${c.nombre} sigue como estaba.`) }; render();
  }
  async function cambiarVendedor(k, nombre) {
    const c = clienteDe(k); if (!c || !esGestor() || E.guardandoMeta.has(k)) return;
    const v = nombre || null; if ((c.vendedor || null) === v) return;
    const previo = E.sobre.meta.get(k);
    E.guardandoMeta.add(k); E.sobre.meta.set(k, Object.assign({}, previo || {}, { vendedor: v })); E.foco = { k, acc: 'vendedor-sel' }; E.ver++; E.huella = ''; render();
    let r; try { r = await conPlazo(almacenActual().clienteVendedor({ clave: k, vendedor: v })); } catch (e) { r = { ok: false, error: String((e && e.message) || e) }; }
    E.guardandoMeta.delete(k);
    if (r && r.ok) { await recargar(); E.ver++; E.huella = ''; E.aviso = { tono: 'ok', html: esc(`${c.nombre}: ${v ? 'ahora es de ' + v : 'quedó en atención general'}.`) }; render(); return; }
    if (previo) E.sobre.meta.set(k, previo); else E.sobre.meta.delete(k);
    E.ver++; E.huella = ''; E.aviso = { tono: 'error', html: esc(`No se pudo cambiar el vendedor${r && r.error ? ' (' + r.error + ')' : ''}. ${c.nombre} sigue como estaba.`) }; render();
  }

  // Gestión de etiquetas (administrador o ve_todo): crear, editar (nombre, día fijo, «aparecer aunque ya se les habló») y borrar.
  const DIAS_FIJOS = [[1, 'Lunes'], [2, 'Martes'], [3, 'Miércoles'], [4, 'Jueves'], [5, 'Viernes'], [6, 'Sábado']];
  const usoEtiqueta = id => v2().clientes.filter(x => (x.etiquetas || []).includes(id)).length;
  function pasoEtiquetas() {
    const d = E.dlg; if (!d) return;
    const err = '<p class="sc-dlg-err" role="alert" hidden></p>';
    if (d.modo === 'form') {
      const f = d.form;
      abrirDlg(`<form class="sc-dlg-c" data-d="form-etiqueta" novalidate><h3 id="sc-dlg-t">${d.nueva ? 'Nueva etiqueta' : 'Editar etiqueta'}</h3>
        <label class="sc-campo"><span>Nombre</span><input type="text" name="nombre" maxlength="60" autocomplete="off" value="${at(f.nombre)}" placeholder="Por ejemplo: Santo Tomé"></label>
        <label class="sc-campo"><span>Día fijo de la semana <span class="sc-muted">(opcional)</span></span><select name="dia"><option value="">Sin día fijo</option>${DIAS_FIJOS.map(([n, t]) => `<option value="${n}"${Number(f.dia) === n ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
        <p class="sc-dlg-n">Con día fijo, a los clientes con esta etiqueta se les escribe ese día de la semana (el primero desde que les toca).</p>
        <label class="sc-check"><input type="checkbox" name="siempre"${f.siempre ? ' checked' : ''}><span><b>Aparecer aunque ya se les habló</b><small>Figuran cada semana ese día, aunque hayan pedido o se les haya escrito. Solo tiene efecto con un día fijo.</small></span></label>
        ${err}<div class="sc-dlg-pie"><button type="button" class="sc-btn" data-d="et-lista">Cancelar</button><button type="submit" class="sc-accion" data-d-aplicar>Guardar etiqueta</button></div></form>`, 'input[name="nombre"]');
    } else if (d.modo === 'borrar') {
      const e = v2().etiquetas.find(x => x.id === d.borrando); if (!e) { d.modo = 'lista'; return pasoEtiquetas(); }
      abrirDlg(`<div class="sc-dlg-c"><h3 id="sc-dlg-t">¿Borrar la etiqueta «${esc(e.nombre)}»?</h3><p class="sc-dlg-s">Se la saca de los <b>${usoEtiqueta(e.id)}</b> clientes que la tienen y deja de aplicar su día fijo. <b>No cambia pedidos ni clientes.</b></p>${err}
        <div class="sc-dlg-pie"><button type="button" class="sc-btn" data-d="et-lista">Cancelar</button><button type="button" class="sc-accion" data-d="et-borrar-ok">${ico('trash-2', 'ico-sm')}Borrar etiqueta</button></div></div>`, '[data-d="et-lista"]');
    } else {
      const l = v2().etiquetas;
      abrirDlg(`<div class="sc-dlg-c"><h3 id="sc-dlg-t">Etiquetas de grupo</h3><p class="sc-dlg-s">Agrupan clientes (por zona, por ejemplo) y pueden fijar el día en que se les escribe.</p>
        ${l.length ? `<ul class="sc-etl">${l.map(e => `<li><div class="sc-etl-d"><b>${esc(e.nombre)}</b><span class="sc-muted">${e.dia_semana ? `Los ${esc(S.DIAS[e.dia_semana])}${e.siempre ? ' · aparece siempre' : ''}` : 'Sin día fijo'} · ${usoEtiqueta(e.id)} ${usoEtiqueta(e.id) === 1 ? 'cliente' : 'clientes'}</span></div>
          <button type="button" class="sc-btn sc-btn--chico" data-d="et-edit" data-e="${at(e.id)}" aria-label="${at('Editar ' + e.nombre)}">${ico('pencil', 'ico-sm')}Editar</button><button type="button" class="sc-btn sc-btn--chico" data-d="et-borrar" data-e="${at(e.id)}" aria-label="${at('Borrar ' + e.nombre)}">${ico('trash-2', 'ico-sm')}Borrar</button></li>`).join('')}</ul>` : '<p class="sc-vacio">Todavía no hay etiquetas.</p>'}
        ${err}<div class="sc-dlg-pie"><button type="button" class="sc-btn" data-d="cerrar">Cerrar</button><button type="button" class="sc-accion" data-d="et-nueva">${ico('plus', 'ico-sm')}Nueva etiqueta</button></div></div>`, '[data-d="et-nueva"]');
    }
  }
  function abrirEtiquetas() {
    if (!esGestor()) return;
    E.foco = { etq: true }; E.dlg = { paso: 'etiquetas', modo: 'lista' };
    pasoEtiquetas();
  }
  async function guardarEtiqueta(form) {
    const d = E.dlg; if (!d || d.modo !== 'form' || E.ocupado) return;
    const nombre = form.querySelector('[name="nombre"]').value.trim(), dia = form.querySelector('[name="dia"]').value, siempre = form.querySelector('[name="siempre"]').checked;
    if (!nombre) return errorDlg('Escribí el nombre de la etiqueta.');
    d.form = { id: d.form.id, nombre, dia, siempre };
    errorDlg(''); ocupar(true);
    let r; try { r = await conPlazo(almacenActual().etiquetaGuardar({ id: d.form.id, nombre, dia_semana: dia ? Number(dia) : null, siempre })); } catch (e) { r = { ok: false, error: String((e && e.message) || e) }; }
    ocupar(false);
    if (r && r.ok) { ocupar(true); await recargar(); ocupar(false); d.modo = 'lista'; pasoEtiquetas(); E.aviso = { tono: 'ok', html: esc(`Etiqueta «${nombre}» guardada.`) }; render(); return; }
    errorDlg(`No se pudo guardar${r && r.error ? ': ' + r.error : ''}.`);
  }
  async function borrarEtiqueta() {
    const d = E.dlg; if (!d || d.modo !== 'borrar' || E.ocupado) return;
    errorDlg(''); ocupar(true);
    let r; try { r = await conPlazo(almacenActual().etiquetaBorrar(d.borrando)); } catch (e) { r = { ok: false, error: String((e && e.message) || e) }; }
    ocupar(false);
    if (r && r.ok) { ocupar(true); await recargar(); ocupar(false); if (E.filtroEt === d.borrando) E.filtroEt = ''; d.modo = 'lista'; pasoEtiquetas(); render(); return; }
    errorDlg(`No se pudo borrar${r && r.error ? ': ' + r.error : ''}.`);
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

  // ── Arrastrar (PC): se agarra una tarjeta y se suelta en otro día (mover). Con teclado y en
  //    celular se usa «Mover a…» de la ficha. El estilo es el de Pedidos (copia flotante que sigue al cursor, hueco en el lugar de origen). ──
  function iniciarArrastre(ev, el) {
    if (!puedeEditar() || E.ocupado || ev.button !== 0 || ev.pointerType === 'touch' || !ancho() || E.guardando.has(el.dataset.k)) return;
    E.arr = { k: el.dataset.k, el, sx: ev.clientX, sy: ev.clientY, x: ev.clientX, y: ev.clientY, activo: false, id: ev.pointerId, zona: null, raf: 0 };
    try { el.setPointerCapture(ev.pointerId); } catch (e) { /* sin captura: igual funciona dentro de la ventana */ }
  }
  // ¿Se puede soltar acá? Un día de hoy en adelante (si hay agenda).
  const zonaValida = z => !!z && z.dataset.zona === 'dia' && puedeAgendar() && z.dataset.fecha >= hoy();
  function empezarArrastre(a) {
    a.activo = true; cerrarToast();
    document.body.classList.add('sc-arrastrando'); $('sc-raiz').classList.add('sc--arr');
    a.el.classList.add('daytask--arr');
    const r = a.el.getBoundingClientRect(); a.dx = a.sx - r.left; a.dy = a.sy - r.top;
    const pos = document.createElement('div'); pos.className = 'sc-ghost-pos';
    const clon = a.el.cloneNode(true); clon.classList.remove('daytask--arr'); clon.classList.add('sc-ghost-card'); clon.removeAttribute('data-sc'); clon.removeAttribute('aria-current'); clon.style.width = r.width + 'px';
    pos.appendChild(clon); document.body.appendChild(pos); a.ghost = pos;
    const vuelta = () => {
      if (E.arr !== a) return;
      const zona = 90, dy = a.y < zona ? -Math.ceil((zona - a.y) / 5) : (a.y > window.innerHeight - zona ? Math.ceil((a.y - (window.innerHeight - zona)) / 5) : 0); if (dy) window.scrollBy(0, dy);
      // la lista de un día con muchas tarjetas se desplaza por dentro: cerca de su borde de arriba o de abajo, avanza sola
      const l = a.zona && a.zona.dataset.zona === 'dia' && a.zona.querySelector('.sc-dia-l');
      if (l) { const r = l.getBoundingClientRect(), borde = 40; if (a.y < r.top + borde) l.scrollTop -= Math.ceil((r.top + borde - a.y) / 4); else if (a.y > r.bottom - borde) l.scrollTop += Math.ceil((a.y - (r.bottom - borde)) / 4); }
      a.raf = requestAnimationFrame(vuelta);
    };
    a.raf = requestAnimationFrame(vuelta);
    posicionar(a);
  }
  function posicionar(a) {
    a.ghost.style.transform = `translate(${a.x - a.dx}px, ${a.y - a.dy}px)`;
    const el = document.elementFromPoint(a.x, a.y), z = el && el.closest ? el.closest('[data-zona]') : null, nueva = zonaValida(z) ? z : null;
    if (nueva !== a.zona) { if (a.zona) a.zona.classList.remove('sc-zona--sobre'); if (nueva) nueva.classList.add('sc-zona--sobre'); a.zona = nueva; }
    // sobre «Esta semana» / «Semana que viene»: tras un instante se cambia de semana (la tarjeta sigue en la mano)
    const sb = el && el.closest ? el.closest('[data-sc="semana"]') : null;
    if (sb && Number(sb.dataset.s) !== E.semana) { if (a.dwell !== sb) { clearTimeout(a.dt); a.dwell = sb; a.dt = setTimeout(() => { if (E.arr === a) { E.semana = Number(sb.dataset.s); a.zona = null; repintarGrilla(); posicionar(a); } }, 450); } }
    else if (a.dwell) { clearTimeout(a.dt); a.dwell = null; }
  }
  function moverArrastre(ev) {
    const a = E.arr; if (!a || ev.pointerId !== a.id) return;
    if (!a.activo) { if (Math.hypot(ev.clientX - a.sx, ev.clientY - a.sy) < 6) return; empezarArrastre(a); }
    a.x = ev.clientX; a.y = ev.clientY; posicionar(a);
  }
  function limpiarArrastre() {
    const a = E.arr; if (!a) return;
    cancelAnimationFrame(a.raf); clearTimeout(a.dt);
    if (a.ghost) a.ghost.remove();
    document.body.classList.remove('sc-arrastrando'); const r = $('sc-raiz'); if (r) r.classList.remove('sc--arr');
    document.querySelectorAll('.sc-zona--sobre').forEach(x => x.classList.remove('sc-zona--sobre'));
    a.el.classList.remove('daytask--arr');
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
  }
  const cancelarArrastre = () => { if (E.arr) limpiarArrastre(); };

  document.addEventListener('pointerdown', ev => { const a = ev.target.closest && ev.target.closest('#sc-raiz .daytask[data-arr]'); if (a) iniciarArrastre(ev, a); });
  document.addEventListener('pointermove', moverArrastre);
  document.addEventListener('pointerup', soltarArrastre);
  document.addEventListener('pointercancel', cancelarArrastre);
  window.addEventListener('blur', cancelarArrastre);
  // Al pasar de PC a celular (o al revés) el calendario cambia de forma
  if (window.matchMedia) { const mq = window.matchMedia('(min-width: 1024px)'), alCambiar = () => { if (pestana() === 'clientes' && E.calc) render(); }; if (mq.addEventListener) mq.addEventListener('change', alCambiar); else if (mq.addListener) mq.addListener(alCambiar); }

  document.addEventListener('click', ev => {
    if (ev.target.closest && ev.target.closest('#sc-ficha [data-wa-client]')) cerrarFicha();   // va a WhatsApp: la ventana se cierra
    const d = ev.target.closest && ev.target.closest('#sc-dlg [data-d]');
    if (d) {
      const a = d.dataset.d, k = E.dlg && E.dlg.k;
      if (a === 'cerrar') cerrarDlg();
      else if (a === 'dia') { cerrarDlg(); moverA(k, d.dataset.f); }
      else if (a === 'volver-dia') { cerrarDlg(); moverA(k, null); }
      else if (a === 'pausar-ok') pausar(k);
      else if (a === 'res-op') resultadoOp(d.dataset.r);
      else if (a === 'res-menu') { if (E.dlg) { E.dlg.nota = notaDlg() || E.dlg.nota; E.dlg.sub = 'menu'; pasoResultado(); } }
      else if (a === 'res-dia') resultadoFecha(d.dataset.f);
      else if (a === 'res-fecha') { const i = document.querySelector('#sc-dlg [name="fecha"]'); resultadoFecha(i && i.value); }
      else if (a === 'res-otro') { const i = document.querySelector('#sc-dlg [name="fecha"]'); if (i && i.value) resultadoFecha(i.value); else resultadoOtro(); }
      else if (a === 'et-nueva') { E.dlg = Object.assign(E.dlg, { modo: 'form', nueva: true, form: { id: idNuevo(), nombre: '', dia: '', siempre: false } }); pasoEtiquetas(); }
      else if (a === 'et-edit') { const e = v2().etiquetas.find(x => x.id === d.dataset.e); if (e) { E.dlg = Object.assign(E.dlg, { modo: 'form', nueva: false, form: { id: e.id, nombre: e.nombre, dia: e.dia_semana || '', siempre: !!e.siempre } }); pasoEtiquetas(); } }
      else if (a === 'et-borrar') { E.dlg = Object.assign(E.dlg, { modo: 'borrar', borrando: d.dataset.e }); pasoEtiquetas(); }
      else if (a === 'et-borrar-ok') borrarEtiqueta();
      else if (a === 'et-lista') { E.dlg.modo = 'lista'; pasoEtiquetas(); }
      else if (a === 'reactivar-ok') reactivar();
      return;
    }
    const t = ev.target.closest && ev.target.closest('#sc-toast [data-sc]');
    if (t) { if (t.dataset.sc === 'deshacer') deshacer(); else cerrarToast(); return; }
    const b = ev.target.closest && ev.target.closest('#sc-raiz [data-sc], #sc-ficha [data-sc]');
    if (!b) return;
    const a = b.dataset.sc, k = b.dataset.k;
    if (a === 'fila') { if (!E.sinClick) seleccionar(k, b); }
    else if (a === 'cerrar-ficha') cerrarFicha();
    else if (a === 'sacar') { E.foco = { k, tl: 1 }; confirmarPausa(k); }
    else if (a === 'volver-seg') { E.foco = { k, tl: 1 }; cerrarDecision(k, 'retomado'); }
    else if (a === 'filtro') { if (FILTROS.includes(b.dataset.f) && E.filtro !== b.dataset.f) { E.filtro = b.dataset.f; guardarFiltro(E.filtro); render(); const x = document.querySelector(`#sc-raiz .sc-fil-b[data-f="${b.dataset.f}"]`); if (x) x.focus({ preventScroll: true }); } }
    else if (a === 'filtro-et') { E.filtroEt = E.filtroEt === b.dataset.e ? '' : b.dataset.e; render(); const x = document.querySelector(`#sc-raiz .sc-fil-b--et[data-e="${CSS.escape(b.dataset.e)}"]`); if (x) x.focus({ preventScroll: true }); }
    else if (a === 'vista') { if (E.vista !== b.dataset.v) { E.vista = b.dataset.v; E.cLimite = 100; render(); } const x = document.querySelector(`#sc-raiz .sc-vista[data-v="${b.dataset.v}"]`); if (x) x.focus({ preventScroll: true }); }
    else if (a === 'alertas-mas') { const t = b.dataset.t; if (E.alertasTodas.has(t)) E.alertasTodas.delete(t); else E.alertasTodas.add(t); render(); const x = document.querySelector(`#sc-raiz [data-sc="alertas-mas"][data-t="${t}"]`); if (x) x.focus({ preventScroll: true }); }
    else if (a === 'clientes-mas') { E.cLimite += 100; refrescarClientes(); }
    else if (a === 'semana') { E.semana = Number(b.dataset.s); repintarGrilla(); }
    else if (a === 'limpiar-filtros') { E.cf = { tipo: '', senal: '', etiqueta: '', vendedor: '', seguimiento: '' }; E.cq = ''; E.cLimite = 100; render(); }
    else if (a === 'resultado') { E.foco = { k, acc: 'resultado' }; abrirResultado(k); }
    else if (a === 'etiquetas') abrirEtiquetas();
    else if (a === 'et-toggle') cambiarEtiqueta(k, b.dataset.e);
    else if (a === 'contactos-reintentar') cargarContactos(k, true);
    else if (a === 'copiar') copiar();
    else if (a === 'reintentar') pedirHistorial();
    else if (a === 'reintentar-datos') cargarDatos();
    else if (a === 'cerrar-aviso') { E.aviso = null; render(); }
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
    else if (f.matches('#sc-dlg form[data-d="form-etiqueta"]')) { ev.preventDefault(); guardarEtiqueta(f); }
  });
  document.addEventListener('change', ev => {
    const f = ev.target.closest && ev.target.closest('#sc-dlg form[data-d="form-aviso"]'); if (f && ev.target.name === 'regla') sincronizarAviso(f);
    const t = ev.target;
    if (t && t.matches && t.matches('select[data-sc="vendedor-sel"]')) cambiarVendedor(t.dataset.k, t.value);
    else if (t && t.matches && t.matches('#sc-raiz select[data-cf]')) { E.cf[t.dataset.cf] = t.value; E.cLimite = 100; refrescarClientes(); }
  });
  // Teclado: flechas arriba/abajo pasan de una tarjeta a otra (sin abrirla: abrir es Enter o Espacio); Escape cancela un arrastre, vacía el buscador o vuelve
  // Escape cierra la ficha (ventana emergente). Enter en el buscador abre el primer resultado.
  document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape' && E.arr) { ev.preventDefault(); cancelarArrastre(); return; }
    const dlgAbierto = !!($('sc-dlg') && $('sc-dlg').open);
    // ventanas encima del calendario: la última que se abrió (la ficha, si está) recibe Escape y el Tab queda adentro; la confirmación (diálogo) va primero y se ocupa de su Escape
    const ventana = E.fichaAbierta ? $('sc-ficha') : null;
    if (ventana && !dlgAbierto) {
      if (ev.key === 'Escape') { ev.preventDefault(); cerrarFicha(); return; }
      if (ev.key === 'Tab') {   // el foco no se escapa de la ventana
        const l = [...ventana.querySelectorAll('button:not([disabled]), summary, a[href], input:not([disabled])')].filter(x => x.offsetParent !== null);
        if (l.length) { const i = l.indexOf(document.activeElement); if (ev.shiftKey && i <= 0) { ev.preventDefault(); l[l.length - 1].focus(); } else if (!ev.shiftKey && i === l.length - 1) { ev.preventDefault(); l[0].focus(); } else if (i === -1) { ev.preventDefault(); l[0].focus(); } }
        return;
      }
    }
    const raiz = $('sc-raiz'); if (!raiz || !raiz.contains(ev.target)) return;
    if (ev.target.id === 'sc-q') {
      if (ev.key === 'Enter') { const p = raiz.querySelector('.sc-bus-it'); if (p) { ev.preventDefault(); seleccionar(p.dataset.k, null); } }
      else if (ev.key === 'ArrowDown') { const p = raiz.querySelector('.sc-bus-it'); if (p) { ev.preventDefault(); p.focus(); } }
      else if (ev.key === 'Escape' && E.q) { ev.preventDefault(); E.q = ''; ev.target.value = ''; renderBusqueda(); }
      return;
    }
    const cl = ev.target.classList; if (!cl) return;
    const sel = cl.contains('sc-bus-it') ? '.sc-bus-it' : cl.contains('daytask') ? '.daytask' : '';
    if (!sel || (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp')) return;
    const filas = [...raiz.querySelectorAll(sel)].filter(x => x.offsetParent !== null), i = filas.indexOf(ev.target), j = i + (ev.key === 'ArrowDown' ? 1 : -1);
    if (filas[j]) { ev.preventDefault(); filas[j].focus(); } else if (sel === '.sc-bus-it' && j < 0) { ev.preventDefault(); $('sc-q').focus(); }
  });
  // Recuerda qué días (celular) y qué "Ver historial y cálculo" están abiertos, aunque la pantalla se vuelva a dibujar
  document.addEventListener('toggle', ev => {
    const d = ev.target; if (!d || !d.matches) return;
    if (d.matches('#sc-raiz details.sc-dcel')) E.abiertos.set(d.dataset.dkey, d.open);
    else if (d.matches('#sc-ficha details.sc-hist')) { if (d.open) E.ritmo.add(d.dataset.k); else E.ritmo.delete(d.dataset.k); }
    else if (d.matches('#sc-ficha details.sc-cambios')) E.cambiosAbierto = d.open;
  }, true);
  document.addEventListener('input', ev => { if (ev.target && ev.target.id === 'sc-q') { E.q = ev.target.value; renderBusqueda(); } });
  document.addEventListener('input', ev => { if (ev.target && ev.target.id === 'sv-pq') { E.pq = ev.target.value; refrescarPanelTabla(); } });
  document.addEventListener('input', ev => { if (ev.target && ev.target.id === 'sc-cq') { E.cq = ev.target.value; E.cLimite = 100; refrescarClientes(); } });

  window.SegUI = {
    abrir, render, aplicarAcceso, puedeVer, puedeCelular, cerrarFicha, cerrarVentanas, pedirHistorial, cargarDatos, contexto, verCliente, asegurar,
    // Administración cambió pedidos o clientes: se descarta el cálculo guardado para rehacerlo con los datos nuevos.
    invalidar() { E.huella = ''; E.calc = null; },
    alRefrescar() {
      if (pestana() !== 'clientes') { cerrarVentanas(); return; }
      render();
      if (Date.now() - E.datos.ts > DATOS_VIEJOS_MS && !E.datos.cargando && E.datos.estado !== 'pendiente' && !E.dlg && !E.arr && !E.guardando.size) cargarDatos(true);
    },
    _estado: E, _plazo: PLAZO,
  };
})();
