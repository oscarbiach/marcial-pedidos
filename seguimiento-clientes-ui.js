/* Pestaña "Clientes" de la app de Pedidos: seguimiento por ritmo de compra (motor: seguimiento-clientes.js). Prioridad: PC.
   Dos vistas: "Para hoy" (los cinco bloques, con un resumen arriba que lleva a cada uno) y "Clientes" (toda la cartera, con buscador).
   En PC la pantalla tiene dos columnas: la lista a la izquierda y la ficha del cliente elegido a la derecha (no se abre entre las filas).
   En pantallas angostas la ficha ocupa el lugar de la lista, con "Volver a la lista" (se conservan la búsqueda y la posición).
   La ficha trae dos gráficos que contestan una pregunta cada uno (¿cuánto pasó respecto de su ritmo? y ¿qué días suele pedir?) y una tira
   corta con el plazo entre el día que pidió y el día que se le entregó; la línea de tiempo, el indicador de atraso y el detalle del
   cálculo quedan detrás de "Ver historial y cálculo". Todo gráfico lleva sus valores escritos. El color en las letras es selectivo.
   "Para hoy" no tiene bloque "No tocar": quienes están al día se ven en "Clientes" con su estado ("Dentro de su ciclo").
   Usa, de index.html: state, setTab, esc, mIco, toast y google.script.run.
   Solo lectura: no escribe nada en la base. El historial largo (más de 7 días) se pide aparte con historialAntiguo() y se guarda acá,
   sin tocar state.pedidos, para no interferir con el buscador de Pedidos. Elegir un cliente NO es un contacto: no se registra nada. */
(function () {
  'use strict';
  const S = window.SegClientes, F = S.fechas;
  const VIEJO_MS = 10 * 60 * 1000;   // el historial se vuelve a pedir si tiene más de 10 minutos
  const E = { q: '', vista: 'hoy', sel: null, fichaAbierta: false, scrollLista: 0, ritmo: new Set(), historial: null, cargando: false, error: false, ts: 0, calc: null, huella: '' };
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
    alta: ['Prioridad alta', 'Ya pasó mucho más de lo que suelen tardar, o hoy es su día de pedir.', 'triangle-alert', 'error'],
    semana: ['Les tocaba esta semana', 'Su ciclo ya venció y no pidieron desde el lunes.', 'calendar-clock', 'aviso'],
    recuperacion: ['Recuperación', 'Compraban y cortaron hace más de 35 días.', 'rotate-ccw', 'info'],
    unica: ['Compra única', 'Pidieron una sola vez: para convertir.', 'user-plus', 'neutro'],
  };
  // "Para hoy" muestra solo estos bloques. Los clientes al día (el bloque "notocar" del motor) no tienen sección: en "Clientes" llevan su estado.
  const BLOQUES_HOY = ['alta', 'semana', 'recuperacion', 'unica'];
  const ESTADOS_AL_DIA = { ciclo: ['Dentro de su ciclo', 'circle-check', 'ok'], semana: ['Pidió esta semana', 'circle-check', 'ok'], inactivo: ['Inactivo', 'clock', 'neutro'] };
  const ABREV = { 1: 'lun', 2: 'mar', 3: 'mié', 4: 'jue', 5: 'vie', 6: 'sáb', 0: 'dom' };
  const SEMANA = [1, 2, 3, 4, 5, 6, 0];   // la semana va de lunes a domingo
  const ALTO_COLUMNAS = 88;                // alto (px) de la barra más alta del gráfico de días

  // ── Datos ──
  function mezclar() {
    const vistos = new Set(), todos = [];
    ((estadoApp() && estadoApp().pedidos) || []).concat(E.historial || []).forEach(p => { if (p && !vistos.has(p.id)) { vistos.add(p.id); todos.push(p); } });
    return todos;
  }
  function recalcular() {
    const todos = mezclar();
    const huella = todos.length + '|' + hoy() + '|' + todos.reduce((h, p) => h + String(p.id).length + String(p.estado).length + String(p.fechaDespacho || '').length + String(p.notas || '').length, 0);
    if (E.calc && E.huella === huella) return E.calc;
    E.huella = huella; E.calc = S.calcular(todos, hoy());
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
      .withSuccessHandler(extra => { clearTimeout(vence); E.historial = Array.isArray(extra) ? extra : []; E.ts = Date.now(); E.cargando = false; E.error = false; E.huella = ''; render(); })
      .withFailureHandler(() => { clearTimeout(vence); E.cargando = false; E.error = true; render(); })
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
    E.q = ''; E.vista = 'hoy'; E.sel = null; E.fichaAbierta = false;   // al entrar siempre se ve la lista del día, no una búsqueda ni una ficha vieja
    if (!E.historial || Date.now() - E.ts > VIEJO_MS) pedirHistorial(); else render();
  }

  // ── Textos ──
  const ico = (n, c) => (window.mIco ? mIco(n, c) : '');
  const fechaTitulo = () => { const d = F.aFecha(hoy()); const dia = S.DIAS[d.getDay()]; return `${dia[0].toUpperCase() + dia.slice(1)} ${d.getDate()} de ${['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'][d.getMonth()]}`; };
  const hora = ms => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const numTxt = v => String(Math.round(v * 10) / 10).replace('.', ',');
  const diasN = n => `${numTxt(n)} ${n === 1 ? 'día' : 'días'}`;
  const pedidosN = n => `${n} ${n === 1 ? 'pedido' : 'pedidos'}`;
  // Por qué todavía no se conoce el ritmo propio del cliente (el número que se muestra en ese caso es una referencia de la cartera)
  function avisoRitmo(c) {
    if (c.refTipo === 'propio') return '';
    if (c.refTipo === 'poca') return `Pocos datos (${c.n} pedidos): todavía no conocemos bien su frecuencia`;
    if (c.refTipo === 'unico') return 'Un solo pedido: todavía no conocemos su frecuencia';
    if (c.refTipo === 'mismoDia') return `Sus ${c.n} pedidos son de un mismo día: todavía no conocemos su frecuencia`;
    return 'Sin pedidos recientes suficientes: todavía no conocemos su frecuencia';
  }
  const direccionDe = c => { const cli = ((estadoApp() && estadoApp().clientes) || []).find(x => String(x.n).toLowerCase() === c.nombre.toLowerCase()); return cli && cli.d ? cli.d : ''; };
  // estado que se ve en la insignia: [texto, ícono, tono]
  const estado = c => (c.bloque === 'notocar' ? ESTADOS_AL_DIA[c.motivo] : [TITULOS[c.bloque][0], TITULOS[c.bloque][2], TITULOS[c.bloque][3]]);
  const tono = c => estado(c)[2];
  const pill = c => { const [t, i, tn] = estado(c); return `<span class="sc-pill sc-t-${tn}">${ico(i, 'ico-sm')}${esc(t)}</span>`; };

  // ── Fila de la lista ──
  // Nombre; dos datos alineados (desde el último pedido / frecuencia); y una última línea solo si ayuda. Los días sin pedir llevan el color
  // del estado (rojo, ámbar, azul, verde); el resto del texto va en tinta. El indicador de atraso no está acá: está en "Ver historial y cálculo".
  function metricas(c) {
    return `<span class="sc-met"><span class="sc-met-k">Desde el último</span> <b class="sc-met-ult">${esc(c.dias === 0 ? 'hoy' : diasN(c.dias))}</b></span>`
      + `<span class="sc-met"><span class="sc-met-k">${c.intervaloPropio ? 'Frecuencia' : 'Referencia de cartera'}</span> <b>${esc(diasN(c.intervalo))}</b></span>`;
  }
  function subFila(c, bloque) {
    const t = [];
    if (bloque === 'recuperacion' && c.lleva.length) t.push(esc('Llevaba: ' + c.lleva.slice(0, 3).join(', ')));
    else if (c.dejoDe.length) t.push(`<span class="sc-warn"><b>Dejó de llevar:</b> ${esc(c.dejoDe.map(d => d.nombre).join(', '))}</span>`);
    const av = avisoRitmo(c); if (av) t.push(`<span class="sc-warn">${esc(av)}</span>`);
    return t.length ? `<span class="sc-sub">${t.join(' · ')}</span>` : '';
  }
  function fila(c, bloque, conEstado) {
    return `<li><button type="button" class="sc-fila sc-t-${tono(c)}" data-sc="fila" data-k="${at(c.clave)}"${E.sel === c.clave ? ' aria-current="true"' : ''}>
        <span class="sc-fila-1"><span class="sc-nom">${esc(c.nombre)}</span>${conEstado ? pill(c) : ''}</span>
        <span class="sc-mets">${metricas(c)}</span>${subFila(c, bloque)}</button></li>`;
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
    const nf = c.fechasRecientes.length;
    return `<details class="sc-hist" data-k="${at(c.clave)}"${E.ritmo.has(c.clave) ? ' open' : ''}><summary>${ico('history', 'ico-sm')}Ver historial y cálculo${ico('chevron-down', 'ico-sm sc-chev')}</summary>
      <div class="sc-hist-cuerpo">
        <p class="sc-tit-mini">${nf === 1 ? 'Único pedido' : `Últimos ${nf} pedidos`} · fecha de despacho (o de carga si todavía no se despachó)</p>
        ${lineaTiempo(c)}
        <p class="sc-leyenda">${esc(calculo)} ${esc(pedidosN(c.n))} en total.</p>
        <p class="sc-leyenda"><b>Indicador:</b> ${esc(c.razon[0].toUpperCase() + c.razon.slice(1))}.</p>
      </div></details>`;
  }

  function productos(c) {
    const lista = (items, icono) => `<ul class="sc-prods">${items.map(t => `<li>${ico(icono, 'ico-sm')}<span>${esc(t)}</span></li>`).join('')}</ul>`;
    return `<section class="sc-f-sec"><h4>Productos</h4>
      ${c.lleva.length ? `<p class="sc-lbl">Suele llevar</p>${lista(c.lleva, 'package')}` : '<p class="sc-vacio">Todavía sin productos registrados.</p>'}
      ${c.dejoDe.length ? nota('aviso', 'triangle-alert', `<b>Dejó de llevar:</b> ${esc(c.dejoDe.map(d => `${d.nombre} (lo llevó ${d.veces} veces; la última, hace ${d.hace} días)`).join(', '))}`) : ''}</section>`;
  }

  function ficha(c) {
    const dir = direccionDe(c);
    return `<div class="sc-f sc-t-${tono(c)}">
      <button type="button" class="sc-volver" data-sc="volver">${ico('arrow-left', 'ico-sm')}Volver a la lista</button>
      <div class="sc-f-cab"><h3 class="sc-f-nom">${esc(c.nombre)}</h3>${pill(c)}</div>
      <p class="sc-f-dir">${ico('map-pin', 'ico-sm')}<span>${dir ? esc(dir) : 'Dirección sin completar'}</span></p>
      <p class="sc-f-ult">${ico('calendar', 'ico-sm')}<span>Último pedido: <b>${esc(F.fechaLarga(c.ultimo))}</b> <span class="sc-muted">(${c.ultimoDespacho ? 'fecha de despacho' : 'fecha de carga: todavía no se despachó'})</span></span></p>
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
  // Franja de resumen: nombre y cantidad de cada bloque; al tocar lleva al bloque (y lo abre si está plegado). No cambia nada del cálculo.
  function resumen(calc) {
    return `<nav class="sc-resumen" aria-label="Resumen por bloque">${BLOQUES_HOY.map(b => {
      const [t, , i, tn] = TITULOS[b];
      return `<button type="button" class="sc-res sc-t-${tn}" data-sc="ir" data-b="${b}">${ico(i, 'ico-sm')}<span class="sc-res-t">${esc(t)}</span><span class="sc-res-n">${calc.bloques[b].length}</span></button>`;
    }).join('')}</nav>`;
  }

  // ── Pantalla ──
  function vistas(calc) {
    const b = (v, txt, extra) => `<button type="button" class="sc-vista" data-sc="vista" data-v="${v}" aria-pressed="${E.vista === v}">${txt}${extra || ''}</button>`;
    return `<div class="sc-vistas" role="group" aria-label="Vista">${b('hoy', 'Para hoy')}${b('clientes', 'Clientes', ` <span class="sc-cant">${calc.clientes.length}</span>`)}</div>`;
  }
  function render() {
    const raiz = $('sc-raiz'); if (!raiz) return;
    if (E.cargando && !E.historial) { raiz.className = 'sc'; raiz.innerHTML = esqueleto(); return; }
    if (E.error && !E.historial) {
      // Sin el historial completo no se muestra ninguna clasificación: con una parte de los pedidos saldría un ritmo falso.
      raiz.className = 'sc';
      raiz.innerHTML = `<div class="sc-estado" role="alert"><b>No se pudo traer el historial de pedidos.</b><p>Sin el historial no se puede ver cada cuánto pide cada cliente. Revisá la conexión y probá de nuevo.</p><button type="button" class="sc-accion" data-sc="reintentar">Reintentar</button></div>`;
      return;
    }
    const calc = recalcular();
    if (!calc.clientes.length) { raiz.className = 'sc'; raiz.innerHTML = `<div class="sc-estado"><b>Todavía no hay pedidos para analizar.</b><p>Cuando se carguen pedidos, acá aparece a quién escribirle cada mañana.</p></div>`; return; }
    const aviso = E.cargando ? '<p class="sc-aviso">Actualizando historial…</p>'
      : E.error ? `<p class="sc-aviso sc-aviso--error" role="alert">No se pudo actualizar el historial. Lo que ves es de las ${esc(hora(E.ts))} y puede estar desactualizado. <button type="button" class="sc-link" data-sc="reintentar">Reintentar</button></p>` : '';
    const enHoy = E.vista === 'hoy';
    const lateral = contenidoFicha(calc);   // antes que la lista: si el elegido ya no figura, la lista no lo marca
    raiz.className = 'sc' + (E.fichaAbierta ? ' sc--ficha' : '');
    raiz.innerHTML = `<div class="sc-cab"><div class="sc-cab-t"><h2>Seguimiento</h2><p class="sc-fecha">${esc(fechaTitulo())}</p></div>${vistas(calc)}</div>${aviso}${enHoy ? resumen(calc) : ''}
      <div class="sc-area${E.fichaAbierta ? ' sc-area--ficha' : ''}" id="sc-area">
        <div class="sc-col sc-col--lista">${enHoy ? '' : `<label class="sc-buscar">${ico('search', 'ico-sm')}<input type="search" id="sc-q" placeholder="Buscar un cliente" aria-label="Buscar un cliente" autocomplete="off" value="${at(E.q)}"></label>`}<div id="sc-cuerpo">${cuerpo(calc)}</div></div>
        <aside class="sc-col sc-col--ficha" id="sc-ficha" aria-label="Ficha del cliente">${lateral}</aside>
      </div>`;
  }

  function resultados(calc) {
    const q = S.norm(E.q);
    return calc.clientes.filter(c => !q || S.norm(c.nombre).includes(q)).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }
  function cuerpo(calc) {
    if (E.vista === 'clientes') {
      const q = S.norm(E.q), res = resultados(calc);
      return res.length
        ? `<section class="sc-bloque sc-bloque--todos"><div class="sc-bhead"><h3 class="sc-bh1"><span class="sc-tit">${q ? 'Resultados' : 'Cartera'}</span><span class="sc-cant">${res.length}</span></h3></div>${q ? '' : '<p class="sc-subt">Por orden alfabético, con el estado de cada uno (también los que están dentro de su ciclo). Elegí un cliente para ver su ficha.</p>'}<ol class="sc-ol">${res.map(c => fila(c, c.bloque, true)).join('')}</ol></section>`
        : '<p class="sc-nadie">Ningún cliente coincide.</p>';
    }
    const B = calc.bloques;
    return bloque('alta', B.alta, { copiar: true }) + bloque('semana', B.semana, { copiar: true }) + bloque('recuperacion', B.recuperacion, { copiar: true })
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

  document.addEventListener('click', ev => {
    const b = ev.target.closest && ev.target.closest('#sc-raiz [data-sc]');
    if (!b) return;
    const a = b.dataset.sc;
    if (a === 'fila') seleccionar(b.dataset.k, b);
    else if (a === 'volver') volver();
    else if (a === 'ir') irA(b.dataset.b);
    else if (a === 'vista') { if (E.vista !== b.dataset.v) { E.vista = b.dataset.v; E.q = ''; E.fichaAbierta = false; render(); window.scrollTo(0, 0); } }
    else if (a === 'copiar') copiar(b.dataset.b);
    else if (a === 'reintentar') pedirHistorial();
  });
  // Teclado: flechas arriba/abajo pasan de una fila a la otra (sin elegirla: elegir es Enter o Espacio); Escape vuelve a la lista en pantallas angostas.
  document.addEventListener('keydown', ev => {
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
  }, true);
  document.addEventListener('input', ev => { if (ev.target && ev.target.id === 'sc-q') { E.q = ev.target.value; renderBusqueda(); } });

  window.SegUI = { abrir, render, aplicarAcceso, puedeVer, pedirHistorial, alRefrescar() { if (pestana() === 'clientes') render(); }, _estado: E };
})();
