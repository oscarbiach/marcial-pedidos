/* Seguimiento de clientes por ritmo de compra (app de Pedidos): motor de cálculo. Funciones puras, sin DOM ni red.
   Objetivo: cada mañana, definir a quién escribirle comparando a cada cliente contra SU PROPIO ritmo de pedido, no contra una regla fija.

   Método (el del usuario, de su sesión de seguimiento; lo no confirmado está marcado [INFERIDO]):
   · Un pedido comercial cuenta salvo que esté eliminado o Cancelado. Las reposiciones no son compras nuevas. Los Pendientes sí cuentan.
   · El ritmo usa la fecha real del pedido (o la de carga si no se corrigió). El despacho se muestra por separado.
   · Se excluyen cuentas de prueba o muestra (CONFIG.excluir) y se unifican nombres (sin mayúsculas/tildes + CONFIG.unificar).
   · Por cliente: n (pedidos), intervalo mediano entre fechas distintas, días sin pedir = hoy − último pedido,
     atraso = días sin pedir ÷ intervalo (1 o más = vencido; 3 = ya pasó el triple de lo que suele tardar).
   · Día habitual: el día de la semana con ≥ 30 % de sus pedidos, medido por fecha de carga.
   · Con un solo pedido no hay intervalo propio: se usa la mediana de la cartera. Con menos de 3 pedidos el ritmo es poco confiable.
   · La semana va de lunes a domingo.
   · Bloques (cada cliente en uno solo, en este orden): Recuperación → Compra única → Prioridad alta → Les tocaba esta semana → No tocar
     (en pantalla "No tocar" ya no es un bloque de Para hoy: en Clientes se ve como "Dentro de su ciclo", "Pidió esta semana" o "Inactivo").
   Calendario de 2 semanas (18/11/2026): `agenda()` ubica a cada cliente en el día en que hay que escribirle (ver más abajo); lo que la persona mueve o marca
   se guarda aparte (seg_agenda) y se le pasa por opciones. No cambia ningún cálculo anterior.
   Forma de cada pedido (la de mapPedido_ en index.html):
     { id, fecha (carga), fechaDespacho, cliente, estado, notas, items: [{ prod, qty }], eliminado_en? }
   Cambios del 13/10/2026 (pedido del usuario): no hay pedidos fijos; "dejó de llevar" = compró el producto 2 o más veces y después hizo
   al menos 2 pedidos sin pedirlo; se suma el plazo entre el día que pidió y el día que se le entregó (campo `plazo`).
   IDEA-10/11/12 (propuesta de ChatGPT, 13/10/2026): sobre el cálculo automático (que NO cambia) se aplica en una capa aparte, y solo si se
   la pasan por opciones: `decisiones` (a un cliente se lo mueve a «Atender» o «Recuperación», o se lo pausa; el cálculo automático queda
   guardado en `auto`) y `reglas` (producto retirado, producto reemplazado, excepción de un cliente: filtran los avisos «dejó de llevar»
   ANTES de recortarlos). Sin decisiones ni reglas el resultado es el de siempre. Ver `calcular`. */
(function (raiz) {
  'use strict';

  // Ajustes que dependen del negocio. Se pueden pisar desde afuera con opciones.config (ver calcular).
  const CONFIG = {
    // Seguimiento v2 (24/11/2026): se suma Thiago (también en celular). Qué clientes ve cada uno NO sale de esta lista: lo decide la base (seg_usuarios.ve_todo y
    // clientes.vendedor) y el motor lo aplica con opciones.usuario / opciones.meta.
    // Quién ve la pestaña Clientes (nombres como figuran en la app; se comparan sin mayúsculas ni tildes): Oscar, Joaquin y Charly (decisión del
    // usuario, 13/10). Charly pasa a llamarse Juan Marcos: están los dos para que el cambio de nombre no le saque el acceso. Es solo de interfaz:
    // no protege los datos (la base deja leer los pedidos a cualquier sesión con PIN válido).
    usuarios: ['Oscar', 'Joaquin', 'Charly', 'Juan Marcos', 'Thiago'],
    // Quién ve Clientes también en el celular (pantalla táctil angosta): Oscar, Joaquin y Juan Marcos. Los demás siguen igual que antes:
    // en el celular la pestaña no se muestra y redirige a Pedidos. En PC no cambia nada.
    celular: ['Oscar', 'Joaquin', 'Juan Marcos', 'Thiago'],
    // «Le escribí»: pasados estos días hábiles (lunes a sábado; el domingo no cuenta) sin que el cliente pida, la tarjeta vuelve a pendiente con «Volver a escribir».
    reescribirDias: 2,
    // Quién puede mover, pausar y resolver avisos (por ahora los mismos que ven la pestaña; propuesta a validar con el usuario). Solo de interfaz:
    // el permiso real lo da la base (tabla seg_editores, ver supabase/14-seguimiento-decisiones.sql).
    editores: ['Oscar', 'Joaquin', 'Charly', 'Juan Marcos', 'Thiago'],
    // Cuentas que no son clientes: de prueba o muestra (eventuales, no hay ritmo de compra que seguir; decisión del usuario 13/10).
    // Se comparan sin mayúsculas ni tildes: coincide el nombre completo o el comienzo + espacio.
    excluir: ['negro - prueba', 'muestras', 'tomas cliente nuevo'],
    // Y toda cuenta de evento: el nombre termina en «evento» (por ejemplo «X evento»). Una cuenta de evento nueva queda excluida sola.
    excluirTerminaEn: ['evento'],
    // Nombres cortos que son el mismo cliente que el que se escribe «<nombre> - <negocio>» (confirmado por el usuario el 13/10): se unen
    // solo si hay exactamente un cliente con ese comienzo; el nombre que se muestra es el largo. NO se unifican los demás nombres parecidos
    // sin confirmar (el usuario aclaró que hay nombres parecidos que son clientes distintos). Para unificar otro caso, se agrega acá.
    unificar: ['eber', 'lucas charruca', 'sofi'],
  };

  const UMBRALES = {
    ventanaDias: 180,         // [INFERIDO] el ritmo se mide sobre los últimos 6 meses
    intervaloCartera: 7.5,    // por si no hay datos para calcular la mediana de la cartera (da entre 7 y 8 días)
    atrasoAlto: 1.3,          // "más o menos desde 1,3": prioridad alta
    recuperacionDias: 35,     // compraban y cortaron hace más de 30 a 35 días
    inactivoDias: 150,        // [INFERIDO] más allá de esto ya no se ofrece para recuperar: se cuenta aparte
    pocosPedidos: 3,          // con menos de 3 pedidos el intervalo es poco confiable
    diaHabitualShare: 0.30,   // un día concentra el 30 % o más de sus pedidos
    diaHabitualMin: 5,        // [INFERIDO] hace falta algo de historia para hablar de un día habitual
    dejoVecesMin: 2,          // "dejó de llevar": compró ese producto 2 o más veces…
    dejoPedidosDespues: 2,    // …y después hizo al menos 2 pedidos sin pedirlo
    plazoMin: 3,              // para hablar del plazo pedido → entrega hacen falta 3 pedidos ya despachados
    plazoConstante: 0.6,      // el plazo es "constante" si al menos el 60 % de los pedidos tuvo el mismo
    plazoUltimos: 8,          // cuántos pedidos recientes se muestran (día que pidió → día que se entregó)
    productosMax: 5,
    dejoMax: 2,               // cuántos avisos «dejó de llevar» se muestran por fila (se recortan DESPUÉS de filtrar los ya explicados)
    fechasFicha: 12,          // cuántas fechas de pedido se muestran en la línea de tiempo de la ficha
    unicaSinVolverDias: 14,   // alerta «Única compra sin volver»: pasaron más de estos días desde su único pedido
    esperandoAlertaDias: 2,   // alerta «Esperando hace 2+ días»: días corridos desde que se le escribió y sigue sin pedir
    menosUltimos: 2,          // «Pidió menos variedad»: renglones por pedido de los últimos N pedidos…
    menosPrevios: 6,          // …contra el promedio de los N anteriores
    menosMinPrevios: 3,       // hacen falta al menos estos pedidos anteriores (todos con renglones cargados)
    menosMinRenglones: 4,     // y que antes llevara al menos tantos renglones por pedido (si no, la diferencia no dice nada)
    menosRatio: 0.6,          // «pidió menos variedad» = los últimos pedidos tienen el 60 % o menos de los renglones de antes
  };

  const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const BLOQUES = ['atender', 'alta', 'semana', 'recuperacion', 'unica', 'notocar', 'pausa'];
  // Decisiones manuales (IDEA-10/11): destinos a los que se puede mover un cliente, y los motivos rápidos (sin escribir un párrafo).
  const TIPOS_DECISION = ['atender', 'recuperacion', 'pausa'];
  const MOTIVOS = { revisar_relacion: 'Revisar relación', pedido_postergado: 'Pedido postergado', cierre_temporal: 'Cierre temporal', otro: 'Otro' };
  // Reglas de producto (IDEA-12): «ya no lo vendemos», «tiene reemplazo» (globales) y «no aplica a este cliente» (individual).
  const TIPOS_REGLA = ['retirado', 'reemplazo', 'excepcion'];

  const norm = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const aFecha = s => new Date(String(s).slice(0, 10) + 'T12:00:00');
  const sumarDias = (s, n) => { const d = aFecha(s); d.setDate(d.getDate() + n); return ymd(d); };
  const diffDias = (a, b) => Math.round((aFecha(a) - aFecha(b)) / 864e5);
  // días entre dos fechas sin contar los domingos (sábado → lunes es 1: no se reparte los domingos)
  const diasHabiles = (a, b) => { let n = 0, d = a; for (let i = 0; i < 60 && d < b; i++) { d = sumarDias(d, 1); if (diaSemana(d) !== 0) n++; } return n; };
  const lunesDe = s => sumarDias(s, -((aFecha(s).getDay() + 6) % 7));
  const diaSemana = s => aFecha(s).getDay();
  const fmtCorta = s => { const d = aFecha(s); return `${d.getDate()} ${MESES[d.getMonth()]}`; };
  const fechaLarga = s => `${DIAS[diaSemana(s)]} ${fmtCorta(s)}`;
  const mediana = l => { if (!l.length) return null; const s = [...l].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const lista = a => (a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' y ' + a[a.length - 1]);
  // El sufijo "(= N un.)" cambia con la cantidad pedida y parte el mismo producto en varios (viene de listados exportados)
  const nombreProducto = s => String(s || '').replace(/\s*\(=\s*[\d.,]+\s*un\.?\)\s*$/i, '').trim();

  const termina = (clave, sufijos) => (sufijos || []).some(x => { const k = norm(x); return clave === k || clave.endsWith(' ' + k); });
  const coincide = (clave, patrones) => (patrones || []).some(p => { const k = norm(p); return clave === k || clave.startsWith(k + ' '); });
  const valido = p => p && !p.eliminado_en && p.estado !== 'Cancelado' && p.cliente && String(p.cliente).trim() && p.fecha;
  // Misma marca que esReposicion() en Pedidos; una entrega de faltantes no reinicia la compra.
  const reposicion = p => String(p.notas || '').startsWith('🔁 REPOSICIÓN');
  const cuenta = p => valido(p) && !reposicion(p);
  // La fecha real en que el cliente hizo el pedido (fechaPedido, corregida desde Administración) manda sobre el día de carga.
  const diaCarga = p => String(p.fechaPedido || p.fecha).slice(0, 10);
  const diaRef = p => diaCarga(p);
  // Compatibilidad de agendas ya guardadas antes de separar pedido y despacho.
  const referenciaAnterior = (p, hoy) => { const d = p.fechaDespacho ? String(p.fechaDespacho).slice(0, 10) : ''; return d && d <= hoy ? d : diaCarga(p); };

  // ── Reglas de producto (IDEA-12) ──
  // Cada regla: { id, tipo: 'retirado' | 'reemplazo' | 'excepcion', producto, sustituto?, clave? (cliente, solo excepción), desde, revision?, motivo?, nota?,
  //               productoNombre?, sustitutoNombre?, creado?, vigente? }. Se identifican por el nombre normalizado del producto (el pedido no trae id de producto).
  // «Retirado» y «reemplazo» son globales; «excepción» es de un cliente. No se aplica ninguna regla con fecha futura. El reemplazo es direccional
  // (A→B no es B→A ni A→C); se rechazan las autorreferencias, los ciclos y un segundo reemplazo para el mismo producto (queda a la vista en `reglas.invalidas`).
  function prepararReglas(reglas, hoy) {
    const lista = [], invalidas = [], globales = new Map(), excepciones = new Map(), sust = new Map();
    const orden = (reglas || []).filter(r => r && r.vigente !== false && TIPOS_REGLA.includes(r.tipo))
      .map(r => Object.assign({}, r, { A: norm(nombreProducto(r.producto)), B: r.sustituto ? norm(nombreProducto(r.sustituto)) : '', desde: String(r.desde || '').slice(0, 10) || hoy }))
      .sort((a, b) => String(a.creado || a.desde).localeCompare(String(b.creado || b.desde)) || String(a.id).localeCompare(String(b.id)));
    const rechazo = (r, por) => { invalidas.push({ regla: r, por }); };
    orden.forEach(r => {
      if (!r.A) return rechazo(r, 'sin producto');
      if (r.tipo === 'excepcion') {
        if (!r.clave) return rechazo(r, 'una excepción necesita un cliente');
        excepciones.set(r.clave + '|' + r.A, r); lista.push(r); return;
      }
      if (r.tipo === 'reemplazo') {
        if (!r.B) return rechazo(r, 'sin producto de reemplazo');
        if (r.B === r.A) return rechazo(r, 'un producto no puede reemplazarse a sí mismo');
        for (let t = r.B, i = 0; t && i < 50; t = sust.get(t), i++) if (t === r.A) return rechazo(r, 'el reemplazo forma un ciclo');
        if (sust.has(r.A)) return rechazo(r, 'ese producto ya tiene otro reemplazo (hay que elegir uno)');
        sust.set(r.A, r.B);
      }
      const previa = globales.get(r.A);
      if (!(previa && previa.tipo === 'reemplazo' && r.tipo === 'retirado')) globales.set(r.A, r);   // un reemplazo explícito no lo pisa un «retirado» a secas
      lista.push(r);
    });
    return { lista, invalidas, globales, excepciones };
  }
  const nombreRegla = (r, cual) => (cual === 'B' ? (r.sustitutoNombre || r.sustituto) : (r.productoNombre || r.producto));
  // Avisos «dejó de llevar» de UN cliente. Orden de resolución: producto retirado o reemplazado (global) → excepción de este cliente → detección automática.
  // Se evalúan TODAS las candidatas y recién después se recorta (si no, una retirada podría tapar una tercera alerta válida).
  function avisosProductos(productos, prods, claveCliente, R, hoy, U) {
    const avisos = [], contexto = [];
    productos.forEach(q => {
      const g = R.globales.get(q.clave);
      if (g && g.desde <= hoy) {
        const compro = q.hace <= U.ventanaDias, habito = q.veces >= U.dejoVecesMin && compro;
        if (g.tipo === 'reemplazo') {
          // «Hay otro producto parecido»: no dice que sean lo mismo. Si ya compró el otro después de la última vez: «ya pasó»; si no: «todavía no compró» (y se le puede ofrecer).
          const nuevo = [...new Set((prods.get(g.B) || { fechas: [] }).fechas)].sort().find(d => d > q.ultima && d >= g.desde);
          if (nuevo) contexto.push({ tipo: 'cambio', de: q.nombre, a: nombreRegla(g, 'B'), fecha: nuevo, veces: q.veces, hace: q.hace, regla: g.id });
          else if (compro) contexto.push({ tipo: 'alternativa', de: q.nombre, a: nombreRegla(g, 'B'), disponibilidad: 'sin confirmar', veces: q.veces, hace: q.hace, regla: g.id });
        } else if (habito || q.dejo) contexto.push({ tipo: 'retirado', de: q.nombre, regla: g.id });
        q.aviso = g.tipo;
        return;
      }
      if (!q.dejo) return;
      const ex = R.excepciones.get(claveCliente + '|' + q.clave);
      // La excepción se cierra sola si volvió a comprar el producto después de ella: un abandono posterior se detecta de nuevo.
      if (ex && ex.desde <= hoy && !(q.ultima > ex.desde)) {
        contexto.push({ tipo: 'excepcion', de: q.nombre, motivo: ex.motivo || '', nota: ex.nota || '', revisar: !!ex.revision && ex.revision <= hoy, regla: ex.id });
        q.aviso = 'excepcion';
        return;
      }
      avisos.push(q);
    });
    avisos.sort((a, b) => b.veces - a.veces || a.nombre.localeCompare(b.nombre, 'es'));
    return { avisos, contexto };
  }
  // ── Decisiones manuales (IDEA-10/11) ──
  // Cada decisión: { id, clave (cliente), tipo: 'atender' | 'recuperacion' | 'pausa', motivo?, nota?, revision? (solo pausa), desde (día de la decisión),
  //                  pedidosConocidos: [ids de pedidos que ya existían], autor?, creado?, version?, vigente? }. Una sola vigente por cliente.
  function prepararDecisiones(decisiones) {
    const m = new Map();
    (decisiones || []).filter(d => d && d.vigente !== false && TIPOS_DECISION.includes(d.tipo) && d.clave).forEach(d => {
      const previa = m.get(d.clave);
      if (!previa || String(d.creado || '') >= String(previa.creado || '')) m.set(d.clave, d);
    });
    return m;
  }
  function razonManual(m) {
    const mot = m.motivoTxt ? ` (${m.motivoTxt.toLowerCase()})` : '';
    if (m.tipo === 'atender') return `lo marcaron para atender${mot}`;
    if (m.tipo === 'recuperacion') return `lo pasaron a recuperación${mot}`;
    return m.revision ? `está en pausa${mot}; se revisa el ${fmtCorta(m.revision)}` : `está en pausa${mot} hasta que lo retomemos`;
  }

  function calcular(pedidos, hoy, opciones) {
    const C = Object.assign({}, CONFIG, (opciones && opciones.config) || {});
    const U = Object.assign({}, UMBRALES, (opciones && opciones.umbrales) || {});
    const desde = sumarDias(hoy, -U.ventanaDias), lunes = lunesDe(hoy);
    // Para cada nombre corto de CONFIG.unificar: el cliente «<nombre> - <negocio>» con el que se junta (si hay uno solo).
    const alias = {}, nombres = new Map();
    (pedidos || []).forEach(p => { if (cuenta(p)) { const n = String(p.cliente).trim(); nombres.set(norm(n), n); } });
    (C.unificar || []).forEach(corto => {
      const k = norm(corto), largos = [...nombres.keys()].filter(n => n.startsWith(k + ' - ') && !coincide(n, C.excluir) && !termina(n, C.excluirTerminaEn));
      if (largos.length === 1) alias[k] = nombres.get(largos[0]);
    });

    // 1. Limpieza y unión por cliente
    const mapa = new Map(); let excluidos = 0;
    (pedidos || []).forEach(p => {
      if (!valido(p)) return;
      let nombre = String(p.cliente).trim(), k = norm(nombre);
      if (coincide(k, C.excluir) || termina(k, C.excluirTerminaEn)) { excluidos++; return; }
      const unificado = !!alias[k];
      if (unificado) { nombre = alias[k]; k = norm(nombre); }
      if (diaRef(p, hoy) > hoy || diaCarga(p) > hoy) return;   // pedidos con fecha futura no cuentan
      if (!mapa.has(k)) mapa.set(k, { clave: k, nombre, pedidos: [], entregas: [], ciclosAnteriores: [], canon: false });
      if (unificado) mapa.get(k).canon = true;
      const grupo = mapa.get(k);
      grupo.entregas.push(p);
      grupo.ciclosAnteriores.push(referenciaAnterior(p, hoy));
      if (cuenta(p)) grupo.pedidos.push(p);
    });

    // 2. Fechas, intervalo propio y mediana de la cartera
    const base = [], brechas = [];
    mapa.forEach(x => {
      if (!x.pedidos.length) return;
      x.pedidos.forEach(p => { p._ref = diaRef(p, hoy); });
      x.pedidos.sort((a, b) => a._ref.localeCompare(b._ref) || diaCarga(a).localeCompare(diaCarga(b)));
      const ult = x.pedidos[x.pedidos.length - 1];
      if (!x.canon) x.nombre = String(ult.cliente).trim();   // el nombre como se escribió la última vez (salvo los unificados a mano)
      x.fechas = [...new Set(x.pedidos.map(p => p._ref))];
      x.ventana = x.fechas.filter(d => d >= desde);
      x.gaps = x.ventana.slice(1).map((d, i) => diffDias(d, x.ventana[i]));
      x.gaps.forEach(g => brechas.push(g));
      base.push(x);
    });
    const medianaCartera = mediana(brechas) || U.intervaloCartera;
    const R = prepararReglas(opciones && opciones.reglas, hoy), decs = prepararDecisiones(opciones && opciones.decisiones);
    const cierresPendientes = [];   // «Atender» y «Recuperación» que ya cumplieron su objetivo (pidió de nuevo): hay que cerrarlas en el guardado

    // 3. Métricas y bloque de cada cliente
    const clientes = base.map(x => {
      const n = x.pedidos.length, ultimo = x.fechas[x.fechas.length - 1];
      const intervaloPropio = x.gaps.length > 0;
      const intervalo = Math.max(1, intervaloPropio ? mediana(x.gaps) : medianaCartera);
      const dias = diffDias(hoy, ultimo), atraso = dias / intervalo;
      const poco = n < U.pocosPedidos;

      // Día habitual (por fecha de carga, últimos 6 meses)
      const enVentana = x.pedidos.filter(p => diaCarga(p) >= desde);
      const porDia = [0, 0, 0, 0, 0, 0, 0]; enVentana.forEach(p => { porDia[diaSemana(diaCarga(p))]++; });
      const diasHab = enVentana.length >= U.diaHabitualMin
        ? porDia.map((c, d) => [d, c]).filter(([, c]) => c / enVentana.length >= U.diaHabitualShare).sort((a, b) => ((a[0] + 6) % 7) - ((b[0] + 6) % 7)).map(([d]) => d)
        : [];

      // Productos: los que más lleva y los que dejó de llevar
      const prods = new Map();
      x.pedidos.forEach(p => {
        const vistos = new Set();
        (p.items || []).forEach(it => {
          const nom = nombreProducto(it && it.prod); if (!nom || vistos.has(norm(nom))) return; vistos.add(norm(nom));
          const q = prods.get(norm(nom)) || { nombre: nom, fechas: [] }; q.fechas.push(p._ref); prods.set(norm(nom), q);
        });
      });
      const productos = [...prods.entries()].map(([clave, q]) => {
        const fs = [...new Set(q.fechas)].sort(), ultimaVez = fs[fs.length - 1];
        const hace = diffDias(hoy, ultimaVez);
        const despues = x.fechas.filter(d => d > ultimaVez).length;   // pedidos del cliente posteriores a la última vez que lo llevó
        const dejo = fs.length >= U.dejoVecesMin && despues >= U.dejoPedidosDespues;
        return { nombre: q.nombre, clave, veces: fs.length, ultima: ultimaVez, hace, dejo, fechas: fs };
      }).sort((a, b) => b.veces - a.veces || a.nombre.localeCompare(b.nombre, 'es'));
      const lleva = productos.filter(q => !q.dejo).slice(0, U.productosMax).map(q => q.nombre);
      // `dejo` es la detección automática; `dejoDeTodos` ya sacó los productos retirados/reemplazados y las excepciones de este cliente, y recién
      // `dejoDe` recorta a los que se muestran en la fila.
      const av = avisosProductos(productos, prods, x.clave, R, hoy, U);
      const dejoDeTodos = av.avisos, dejoDe = dejoDeTodos.slice(0, U.dejoMax), cambiosProductos = av.contexto;

      // «Pidió menos variedad»: renglones (productos distintos) por pedido de los últimos pedidos contra el promedio de los anteriores. Solo si TODOS esos pedidos
      // tienen renglones cargados; si no, no se dice nada (no se inventa). Las cantidades no se comparan: mezclan cajas, unidades y kilos.
      const nMenos = U.menosUltimos + U.menosPrevios, colaMenos = x.pedidos.slice(-nMenos);
      let compraMenos = null;
      if (colaMenos.length >= U.menosUltimos + U.menosMinPrevios && colaMenos.every(p => (p.items || []).length)) {
        const reng = p => new Set((p.items || []).map(it => norm(nombreProducto(it && it.prod))).filter(Boolean)).size;
        const ult = colaMenos.slice(-U.menosUltimos).map(reng), prev = colaMenos.slice(0, -U.menosUltimos).map(reng);
        const mU = ult.reduce((a, b) => a + b, 0) / ult.length, mP = prev.reduce((a, b) => a + b, 0) / prev.length;
        if (mP >= U.menosMinRenglones && mU <= mP * U.menosRatio) compraMenos = { ultimos: mU, previos: mP, nUltimos: ult.length, nPrevios: prev.length };
      }

      // Última observación (nota de un pedido)
      const conNota = [...x.pedidos].reverse().find(p => String(p.notas || '').trim());
      const observacion = conNota ? { texto: String(conNota.notas).trim(), fecha: diaCarga(conNota) } : null;

      // Bloque (cada cliente en uno solo). `razon` dice, en una frase, la condición que lo asignó: se muestra tal cual al lado del nombre.
      const ritmoDe = intervaloPropio ? 'su ritmo habitual' : 'el ritmo de la cartera';
      const veces = Math.round(atraso * 10) / 10, vecesTxt = String(veces).replace('.', ',');
      const cuando = diasHab.includes(diaSemana(hoy)) ? ` y hoy es uno de sus días de pedir (${textoDias(diasHab)})` : '';
      let bloque, motivo = '', razon;
      if (dias >= U.inactivoDias) { bloque = 'notocar'; motivo = 'inactivo'; razon = `hace ${dias} días que no pide (más de ${U.inactivoDias}): se cuenta como inactivo`; }
      else if (ultimo >= lunes) { bloque = 'notocar'; motivo = 'semana'; razon = 'ya pidió esta semana (desde el lunes)'; }
      else if (n === 1) {
        if (dias >= medianaCartera) { bloque = 'unica'; razon = `pidió una sola vez, ${diasTxt(dias)}`; }
        else { bloque = 'notocar'; motivo = 'ciclo'; razon = `pidió una sola vez ${diasTxt(dias)} y todavía no pasó el ritmo de la cartera`; }
      }
      else if (atraso < 1) { bloque = 'notocar'; motivo = 'ciclo'; razon = intervaloPropio ? 'todavía está dentro de lo que suele tardar' : 'todavía está dentro del ritmo de la cartera'; }
      else if (dias >= U.recuperacionDias) { bloque = 'recuperacion'; razon = `hace ${dias} días que no pide (más de ${U.recuperacionDias}): compraba y cortó`; }
      else if (atraso >= U.atrasoAlto) { bloque = 'alta'; razon = `pasó ${vecesTxt} veces ${ritmoDe}${cuando}`; }
      else if (diasHab.includes(diaSemana(hoy))) { bloque = 'alta'; razon = `ya cumplió ${ritmoDe}${cuando}`; }
      else { bloque = 'semana'; razon = veces <= 1 ? `ya cumplió ${ritmoDe} y no pidió desde el lunes` : `pasó ${vecesTxt} veces ${ritmoDe} y no pidió desde el lunes`; }

      // Decisión manual vigente (IDEA-10/11): cambia DÓNDE se trabaja al cliente, no sus números. El cálculo automático queda en `auto`.
      const auto = { bloque, motivo, razon };
      let manual = null, volvioSolo = null;
      const dm = decs.get(x.clave);
      if (dm) {
        const conocidos = new Set((dm.pedidosConocidos || []).map(String));
        // «Nuevo pedido»: uno válido que no existía al decidir y se cargó desde ese día (una importación vieja o un despacho tardío no cuentan).
        const nuevos = x.pedidos.filter(p => !conocidos.has(String(p.id)) && diaCarga(p) >= String(dm.desde || '').slice(0, 10));
        manual = { id: dm.id, tipo: dm.tipo, motivo: dm.motivo || '', motivoTxt: MOTIVOS[dm.motivo] || '', nota: dm.nota || '', revision: dm.tipo === 'pausa' ? String(dm.revision || '').slice(0, 10) : '',
          desde: String(dm.desde || '').slice(0, 10), autor: dm.autor || '', creado: dm.creado || '', version: dm.version || 1,
          nuevosPedidos: nuevos.length, ultimoNuevo: nuevos.length ? nuevos[nuevos.length - 1]._ref : '', conocidos: (dm.pedidosConocidos || []).map(String) };
        manual.revisar = manual.tipo === 'pausa' && !!manual.revision && manual.revision <= hoy;
        if (dm.tipo !== 'pausa' && nuevos.length) {
          // Pidió de nuevo después de pasarlo a Atender o Recuperación: ya no hace falta, vuelve solo a donde lo ubica el cálculo (decisión del usuario, 13/10).
          // La pausa NO se levanta por un pedido nuevo. `cierresPendientes` le pide a la pantalla que deje cerrada la decisión (para que un pedido que se cancele
          // después no la reviva) y `volvioSolo` explica por qué ya no figura como manual.
          volvioSolo = { tipo: dm.tipo, desde: manual.desde, fecha: manual.ultimoNuevo, motivoTxt: manual.motivoTxt };
          cierresPendientes.push({ id: dm.id, clave: x.clave, nombre: x.nombre, tipo: dm.tipo, fecha: manual.ultimoNuevo });
          manual = null;
        } else { bloque = dm.tipo; motivo = ''; razon = razonManual(manual); }
      }

      // Plazo entre el día que pidió (carga) y el día que se le entregó (despacho), sin contar domingos. Solo pedidos ya despachados.
      const plazos = x.pedidos.filter(p => p.fechaDespacho && String(p.fechaDespacho).slice(0, 10) <= hoy && String(p.fechaDespacho).slice(0, 10) >= diaCarga(p) && diaCarga(p) >= desde)
        .map(p => ({ carga: diaCarga(p), entrega: String(p.fechaDespacho).slice(0, 10) })).map(o => Object.assign(o, { dias: diasHabiles(o.carga, o.entrega) }))
        .sort((a, b) => a.carga.localeCompare(b.carga) || a.entrega.localeCompare(b.entrega));
      const medPlazo = mediana(plazos.map(o => o.dias));
      const enMed = plazos.length ? plazos.filter(o => o.dias === medPlazo).length / plazos.length : 0;
      const plazo = { n: plazos.length, mediana: medPlazo, enMediana: enMed, ultimos: plazos.slice(-U.plazoUltimos),
        tipo: plazos.length < U.plazoMin ? 'pocos' : enMed < U.plazoConstante ? 'variable' : medPlazo <= 0 ? 'mismoDia' : medPlazo === 1 ? 'diaSiguiente' : 'anticipado' };

      // Para la ficha: cuánta información hay detrás del ritmo, fechas para la línea de tiempo y pedidos por día de carga
      const unSoloDia = x.fechas.length === 1;
      const refTipo = intervaloPropio ? (poco ? 'poca' : 'propio') : n === 1 ? 'unico' : unSoloDia ? 'mismoDia' : 'sinRecientes';
      const despachoDe = new Set(x.pedidos.filter(p => p.fechaDespacho && String(p.fechaDespacho).slice(0, 10) === p._ref).map(p => p._ref));
      const ultimaCarga = x.pedidos.map(diaCarga).sort().at(-1) || '';
      // La app registra despacho, no una confirmación independiente de recepción.
      const ultimaEntrega = x.entregas.filter(p => p.estado === 'Despachado' && p.fechaDespacho)
        .map(p => String(p.fechaDespacho).slice(0, 10)).filter(d => d <= hoy).sort().at(-1) || '';
      const fechasRecientes = x.fechas.slice(-U.fechasFicha).map(d => ({ fecha: d, despacho: despachoDe.has(d) }));

      return {
        clave: x.clave, nombre: x.nombre, n, poco, ultimo, dias, intervalo, intervaloPropio, atraso, diasHab, bloque, motivo,
        ciclosAnteriores: [...new Set(x.ciclosAnteriores.filter(d => d >= ultimo))],
        hoyEsSuDia: diasHab.includes(diaSemana(hoy)), lleva, dejoDe, dejoDeTodos, cambiosProductos, productos, observacion,
        auto, manual, volvioSolo, pedidoIds: x.pedidos.map(p => String(p.id)),
        diaUltimo: fechaLarga(ultimo), primer: x.fechas[0],
        // Solo para mostrar (no cambian ningún bloque): razón del bloque, confianza del ritmo y datos de la ficha
        razon, refTipo, ultimoDespacho: despachoDe.has(ultimo), fechasRecientes, nFechas: x.fechas.length, nIntervalos: x.gaps.length,
        pedidosVentana: enVentana.length, porDia, plazo, ultimaCarga, ultimaEntrega, compraMenos,
      };
    });

    // Seguimiento v2: vendedor, etiquetas y último contacto de cada cliente (opciones.meta: Map u objeto clave → { vendedor, etiquetas: [{id, nombre, dia_semana, siempre}], contacto })
    // y visibilidad (opciones.usuario = { nombre, ve_todo }): quien no ve todo solo tiene los clientes cuyo vendedor es él. Sin `usuario` no se filtra nada.
    const metaIn = opciones && opciones.meta, usuario = opciones && opciones.usuario;
    const metaDe = k => (metaIn instanceof Map ? metaIn.get(k) : metaIn && metaIn[k]) || {};
    clientes.forEach(c => { const m = metaDe(c.clave); c.vendedor = m.vendedor ? String(m.vendedor) : null; c.etiquetas = Array.isArray(m.etiquetas) ? m.etiquetas.slice() : []; c.contacto = m.contacto || null; });
    const yo = usuario && !usuario.ve_todo ? norm(usuario.nombre) : null;
    const todosN = clientes.length, clavesTodas = new Set(clientes.map(c => c.clave));
    if (yo !== null) { for (let i = clientes.length - 1; i >= 0; i--) if (!clientes[i].vendedor || norm(clientes[i].vendedor) !== yo) clientes.splice(i, 1); }
    const clavesVisibles = new Set(clientes.map(c => c.clave));
    for (let i = cierresPendientes.length - 1; i >= 0; i--) if (!clavesVisibles.has(cierresPendientes[i].clave)) cierresPendientes.splice(i, 1);

    // 4. Bloques ordenados
    const orden = {
      atender: (a, b) => b.atraso - a.atraso || b.dias - a.dias,
      alta: (a, b) => b.atraso - a.atraso || b.dias - a.dias,
      semana: (a, b) => b.atraso - a.atraso || b.dias - a.dias,
      recuperacion: (a, b) => a.dias - b.dias,          // los que cortaron hace menos se recuperan mejor: primero
      unica: (a, b) => a.dias - b.dias,
      notocar: (a, b) => a.nombre.localeCompare(b.nombre, 'es'),
      pausa: (a, b) => (b.manual.revisar ? 1 : 0) - (a.manual.revisar ? 1 : 0) || (a.manual.revision || '9999').localeCompare(b.manual.revision || '9999') || a.nombre.localeCompare(b.nombre, 'es'),
    };
    const bloques = {}; BLOQUES.forEach(b => { bloques[b] = clientes.filter(c => c.bloque === b).sort(orden[b]); });
    const noTocar = { inactivo: 0, semana: 0, ciclo: 0 }; bloques.notocar.forEach(c => { noTocar[c.motivo]++; });
    const pausa = { total: bloques.pausa.length, revisar: bloques.pausa.filter(c => c.manual.revisar).length };
    const sinCliente = [...decs.keys()].filter(k => !clavesTodas.has(k));   // decisiones de clientes que ya no figuran (no se pierden: solo no se muestran)
    return { hoy, lunes, medianaCartera, bloques, clientes, ocultos: todosN - clientes.length, excluidos, noTocar, pausa, cierresPendientes, reglas: { validas: R.lista, invalidas: R.invalidas }, decisionesSinCliente: sinCliente };
  }

  // ── Calendario de 2 semanas (pedido del usuario, 18/11/2026) ──
  // Día de contacto: último pedido + frecuencia redondeada. El día habitual es informativo; no posterga el vencimiento.
  // Los movimientos manuales se respetan en agenda().
  // Los domingos no se mandan mensajes: todo lo que caería en domingo pasa al lunes siguiente.
  const sinDomingo = d => (diaSemana(d) === 0 ? sumarDias(d, 1) : d);
  // fecha + n días hábiles (de lunes a sábado: los domingos no cuentan)
  const habilMas = (f, n) => { let d = f; for (let i = 0; i < n;) { d = sumarDias(d, 1); if (diaSemana(d) !== 0) i++; } return d; };
  // Etiquetas con día fijo (seg_etiquetas.dia_semana, 1 = lunes … 6 = sábado). `c.etiquetas` lo completa calcular() con opciones.meta.
  const diasFijos = c => [...new Set((c.etiquetas || []).map(e => Number(e && e.dia_semana)).filter(d => d >= 1 && d <= 6))];
  const primerDia = (desde, dow) => { let d = desde; for (let i = 0; i < 7 && diaSemana(d) !== dow; i++) d = sumarDias(d, 1); return d; };
  // Día de contacto. Regla de siempre (Codex #27): vence = último pedido + frecuencia; el día habitual NO lo posterga. Excepción explícita: un cliente
  // con una etiqueta de día fijo se ubica en el primer día con ese día de la semana desde el vencimiento (si tiene varias etiquetas con día, la más próxima).
  const diaCalculado = c => {
    const vence = sumarDias(c.ultimo, Math.max(1, Math.round(c.intervalo))), fijos = diasFijos(c);
    if (fijos.length) return fijos.map(d => primerDia(vence, d)).sort()[0];
    return sinDomingo(vence);
  };
  // Tipo de cliente (para saber si se le habla o se le hace seguimiento):
  //   'recupero'  → dejó de comprar: bloque «Recuperación» del motor (cálculo o decisión manual) o pasó 2 veces su frecuencia sin pedir. Gana sobre «unica».
  //   'unica'     → una sola compra: hay que hacerle seguimiento para que vuelva.
  //   'habitual'  → compra siempre (2 o más pedidos): es a quien se le escribe porque le toca.
  const tipoDe = c => ((c.bloque === 'recuperacion' || (c.manual && c.manual.tipo === 'recuperacion') || c.atraso >= 2) ? 'recupero' : (c.n === 1 || c.bloque === 'unica') ? 'unica' : 'habitual');

  // agenda(calc, { hoy?, agenda: Map(clave del cliente → { fecha, ciclo, escrito }), pedidos })
  //   `agenda` guarda solo lo que la persona hizo: a qué día lo movió (`fecha`, válida solo si `ciclo` es la fecha de su último pedido actual) y el día en
  //   que escribió (`escrito`). `pedidos` sirve para ver quién ya pidió esta semana («Pidió»). Devuelve:
  //   { hoy, lunes, hasta, dias: [12 × { fecha, dow, semana, hoy, pasado, tarjetas }] (de lunes a sábado, dos semanas: no hay domingos), masAdelante, pausados: [cliente],
  //     porCliente: Map(clave → su tarjeta del ciclo actual, incluso la que cae fuera de la ventana), pidieron: Map(clave → día en que cargó su pedido de esta semana) }
  //   Tarjeta: { clave, nombre, c, estado: 'pendiente' | 'escribi' (le escribió y espera: «Esperando») | 'pidio' (hecho), reescribir (le escribió, pasaron los días hábiles y no pidió: vuelve a pendiente), vuelveEl (cuándo vuelve), dia, calculado, movido, escrito, atraso (días de atraso), atrasado (pasaron 2 días o más de su día, o es recuperación: va a hoy, primero), recuperacion, fuera }.
  //   La clave del cliente es la del motor (nombre normalizado), no el id de la base: seguimiento-datos.js traduce.
  function agenda(calc, opciones) {
    const o = opciones || {}, hoy = o.hoy || calc.hoy, lunes = lunesDe(hoy), ultimoDia = sumarDias(lunes, 12);   // la ventana termina el sábado de la semana que viene
    const reDias = o.reescribirDias != null ? o.reescribirDias : CONFIG.reescribirDias;
    const hoyEf = sinDomingo(hoy);   // un domingo «hoy» no tiene columna: lo de hoy se ve el lunes
    const ag = o.agenda instanceof Map ? o.agenda : new Map(Object.entries(o.agenda || {}));
    const dia10 = v => (v ? String(v).slice(0, 10) : '');
    const porId = new Map(); calc.clientes.forEach(c => c.pedidoIds.forEach(id => porId.set(id, c)));
    // «Pidió»: el pedido válido más reciente cargado entre el lunes de esta semana y hoy (uno cargado un domingo se ve el sábado: no hay columna de domingo)
    const pidio = new Map();
    (o.pedidos || []).forEach(p => {
      if (!cuenta(p)) return;
      const c = porId.get(String(p.id)), d = diaCarga(p); if (!c || d < lunes || d > hoy) return;
      if (!pidio.has(c.clave) || d > pidio.get(c.clave)) pidio.set(c.clave, d);
    });
    const tarjetas = [], pausados = [], porCliente = new Map();
    let masAdelante = 0;
    calc.clientes.forEach(c => {
      const pausa = !!(c.manual && c.manual.tipo === 'pausa');
      if (pausa) { pausados.push(c); return; }
      const tipo = tipoDe(c);
      if (pidio.has(c.clave)) { const d = pidio.get(c.clave); tarjetas.push({ clave: c.clave, nombre: c.nombre, c, estado: 'pidio', tipo, dia: diaSemana(d) === 0 ? sumarDias(d, -1) : d, calculado: '', movido: false, escrito: '', atraso: 0, atrasado: false, recuperacion: tipo === 'recupero', fuera: false }); }
      if (c.bloque === 'notocar' && c.motivo === 'inactivo') return;   // más de 150 días sin pedir: no se ofrece (se sigue encontrando en el buscador)
      const fila = ag.get(c.clave) || null, calculado = diaCalculado(c);
      const movido = !!(fila && dia10(fila.fecha) && (dia10(fila.ciclo) === c.ultimo || (c.ciclosAnteriores || []).includes(dia10(fila.ciclo)))), base = movido ? sinDomingo(dia10(fila.fecha)) : calculado;   // conserva movimientos del ciclo anterior; un pedido comercial posterior los invalida
      // «Le escribí»: vale mientras el cliente no haya vuelto a pedir. Pasados `reescribirDias` días hábiles (el domingo no cuenta) sin pedido vuelve a pendiente («volver a escribir»).
      const escribi = !!(fila && dia10(fila.escrito) && dia10(fila.escrito) >= c.ultimo), escritoF = escribi ? dia10(fila.escrito) : '';
      const vuelveEl = escribi ? habilMas(escritoF, reDias) : '', espera = escribi && hoyEf < vuelveEl, reescribir = escribi && !espera;
      const atraso = base < hoy ? diffDias(hoy, base) : 0;
      // Resultado «No contestó» (seg_contactos): la base ya le sacó la espera; como no hay «Le escribí» vigente la app lo recuerda con «Volver a escribir» hasta que pida o se le escriba de nuevo.
      const ct = c.contacto || null, noContesto = !escribi && !!ct && ct.resultado === 'no_contesto' && dia10(ct.creado_en) >= c.ultimo;
      let dia = base, atrasado = false;
      if (espera) dia = base >= lunes ? base : hoyEf;                              // esperando: la tarjeta se queda donde estaba
      else if (reescribir || noContesto) dia = movido && base >= hoyEf ? base : hoyEf;                              // no pidió en los días que se esperaba (o no contestó): vuelve a hoy
      else if (base < hoyEf) { dia = hoyEf; atrasado = !movido && atraso >= 2 && tipo === 'habitual'; }   // vencido: se corre a hoy; «atrasado» solo un habitual con 2 días o más pasados de su día
      const t = { clave: c.clave, nombre: c.nombre, c, estado: espera ? 'escribi' : 'pendiente', reescribir: reescribir || noContesto, noContesto, contacto: ct, tipo, dia, calculado, movido, escrito: escritoF, vuelveEl, atraso, atrasado, recuperacion: tipo === 'recupero', fuera: dia > ultimoDia };
      porCliente.set(c.clave, t);
      if (t.fuera) masAdelante++; else tarjetas.push(t);
    });
    // Etiqueta con día fijo y «aparecer aunque ya se les habló» (siempre): el cliente figura CADA semana ese día dentro de la ventana, aunque haya pedido o se le haya
    // escrito (con su estado: si pidió esta semana, «Pidió»). Son tarjetas de repetición (`recurrente`): no se mueven ni cuentan como el ciclo del cliente.
    // Sin día fijo, `siempre` no tiene ningún efecto.
    const finSemana0 = sumarDias(lunes, 7);
    calc.clientes.forEach(c => {
      if ((c.manual && c.manual.tipo === 'pausa') || (c.bloque === 'notocar' && c.motivo === 'inactivo')) return;
      const dias = [...new Set((c.etiquetas || []).filter(e => e && e.siempre).map(e => Number(e.dia_semana)).filter(d => d >= 1 && d <= 6))];
      if (!dias.length) return;
      const principal = porCliente.get(c.clave), tipo = tipoDe(c), pid = pidio.get(c.clave);
      for (let i = 0; i < 14; i++) {
        const fecha = sumarDias(lunes, i);
        if (!dias.includes(diaSemana(fecha)) || fecha < hoyEf || fecha > ultimoDia || tarjetas.some(t => t.clave === c.clave && t.dia === fecha)) continue;
        let estado = 'pendiente', escrito = '', vuelveEl = '';
        if (fecha < finSemana0 && pid) estado = 'pidio';
        else if (principal && principal.estado === 'escribi' && fecha < principal.vuelveEl) { estado = 'escribi'; escrito = principal.escrito; vuelveEl = principal.vuelveEl; }
        tarjetas.push({ clave: c.clave, nombre: c.nombre, c, estado, reescribir: false, noContesto: false, contacto: c.contacto || null, tipo, dia: fecha, calculado: fecha, movido: false, escrito, vuelveEl, atraso: 0, atrasado: false, recuperacion: tipo === 'recupero', fuera: false, recurrente: true });
      }
    });
    const hecho = t => (t.estado === 'pendiente' ? 0 : t.estado === 'escribi' ? 1 : 2), grupo = t => (t.tipo === 'habitual' ? 0 : 1);
    // dentro de un día: primero los pendientes (los habituales y después los de seguimiento; los atrasados primero en su grupo), después los que están esperando (le escribió)
    // y al final los hechos (pidió)
    const orden = (a, b) => hecho(a) - hecho(b) || grupo(a) - grupo(b) || (b.atrasado ? 1 : 0) - (a.atrasado ? 1 : 0) || b.atraso - a.atraso || a.nombre.localeCompare(b.nombre, 'es');
    const dias = [];
    for (let i = 0; i < 14; i++) {
      const fecha = sumarDias(lunes, i); if (diaSemana(fecha) === 0) continue;   // sin domingos
      dias.push({ fecha, dow: diaSemana(fecha), semana: i < 7 ? 0 : 1, hoy: fecha === hoyEf, pasado: fecha < hoyEf, tarjetas: tarjetas.filter(t => t.dia === fecha).sort(orden) });
    }
    const conteo = { todos: tarjetas.length, habitual: tarjetas.filter(t => t.tipo === 'habitual').length, seguimiento: tarjetas.filter(t => t.tipo !== 'habitual').length };
    return { hoy, lunes, hasta: ultimoDia, dias, masAdelante, pausados, porCliente, pidieron: pidio, conteo };
  }

  // Alertas comerciales del panel «Hoy» (Seguimiento v2): una por cliente y motivo, a partir de lo que ya calculó el motor. Cada una nombra al cliente y se abre en su ficha.
  //   reescribir  → «Volver a escribir» (le escribió, pasaron los días hábiles y no pidió; o no contestó)
  //   esperando   → esperando respuesta o pedido hace `esperandoAlertaDias` días corridos o más
  //   dejo        → «Dejó de comprar» (tipo recupero)
  //   unica       → «Única compra sin volver» (un solo pedido, hace más de `unicaSinVolverDias` días)
  //   productos   → «Dejó de llevar» uno o más productos (ya sin los retirados, reemplazados o con excepción)
  //   menos       → «Pidió menos variedad»: SOLO si el cliente tiene renglones cargados en todos los pedidos comparados (ver `compraMenos` en calcular); si no, no se inventa
  const ALERTAS = { reescribir: 'Volver a escribir', esperando: 'Esperando hace días', dejo: 'Dejó de comprar', unica: 'Única compra sin volver', productos: 'Dejó de llevar', menos: 'Pidió menos variedad' };
  const ALERTAS_ORDEN = ['reescribir', 'esperando', 'dejo', 'unica', 'productos', 'menos'];
  function alertas(calc, ag, opciones) {
    const o = opciones || {}, hoy = o.hoy || calc.hoy, U = Object.assign({}, UMBRALES, o.umbrales), out = [];
    const add = (tipo, c, detalle, peso) => out.push({ tipo, titulo: ALERTAS[tipo], clave: c.clave, nombre: c.nombre, detalle, peso });
    calc.clientes.forEach(c => {
      if (c.manual && c.manual.tipo === 'pausa') return;
      const t = ag.porCliente.get(c.clave); if (!t) return;   // los inactivos (más de 150 días) no figuran
      if (t.estado === 'escribi') { const d = diffDias(hoy, t.escrito); if (d >= U.esperandoAlertaDias) add('esperando', c, `Le escribiste ${diasTxt(d)} y sigue sin ${t.tipo === 'habitual' ? 'pedir' : 'contestar'}`, d); }
      else if (t.reescribir && t.estado === 'pendiente') add('reescribir', c, t.noContesto ? 'No contestó la última vez' : `Le escribiste ${diasTxt(diffDias(hoy, t.escrito))} y no pidió`, 1);
      // Un cliente con un solo pedido que pasó de largo es «Única compra sin volver» (aunque tipoDe ya lo cuente como «recupero» por haber pasado el doble del ritmo de la cartera);
      // «Dejó de comprar» es de quien compraba más de una vez.
      if (c.n === 1) { if (c.dias > U.unicaSinVolverDias) add('unica', c, `Pidió una sola vez, ${diasTxt(c.dias)}`, c.dias); }
      else if (t.tipo === 'recupero') add('dejo', c, `Hace ${c.dias} días que no pide (${cadaTxt(c)})`, c.dias);
      if (c.dejoDeTodos.length) add('productos', c, 'Dejó de llevar ' + lista(c.dejoDeTodos.slice(0, 3).map(q => q.nombre)) + (c.dejoDeTodos.length > 3 ? ` y ${c.dejoDeTodos.length - 3} más` : ''), c.dejoDeTodos.length);
      if (c.compraMenos) { const m = c.compraMenos, f = v => String(Math.round(v * 10) / 10).replace('.', ','); add('menos', c, `Sus últimos ${m.nUltimos} pedidos tienen ${f(m.ultimos)} renglones en promedio; antes, ${f(m.previos)}`, m.previos - m.ultimos); }
    });
    return out.sort((a, b) => ALERTAS_ORDEN.indexOf(a.tipo) - ALERTAS_ORDEN.indexOf(b.tipo) || b.peso - a.peso || a.nombre.localeCompare(b.nombre, 'es'));
  }

  // Textos para la lista ("hace 12 días · suele cada 7")
  const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
  const diasTxt = n => (n === 0 ? 'hoy' : `hace ${plural(n, 'día', 'días')}`);
  const cadaTxt = c => { const v = Math.round(c.intervalo * 10) / 10; return 'suele cada ' + (Number.isInteger(v) ? v : String(v).replace('.', ',')); };
  const atrasoTxt = c => { const a = Math.round(c.atraso * 10) / 10; return a >= 1 ? `×${String(a).replace('.', ',')}` : ''; };
  function textoDias(dias) {
    if (!dias || !dias.length) return 'sin un día fijo';
    return 'los ' + lista(dias.map(d => DIAS[d] + (d === 6 || d === 0 ? 's' : '')));
  }
  // Una línea por cliente para copiar y pegar: "1. Nombre — hace 21 días (suele cada 7)"
  // Con ritmo propio: "suele cada 7". Sin él (un solo pedido o todos el mismo día) el número es una referencia de la cartera, nunca "su" hábito
  const ritmoTxt = c => (c.intervaloPropio ? cadaTxt(c) : 'referencia de la cartera: ' + cadaTxt(c).replace('suele ', ''));
  const lineaTexto = (c, i) => `${i + 1}. ${c.nombre} — ${diasTxt(c.dias)} (${ritmoTxt(c)})`;

  // Clientes que hoy tienen el aviso «dejó de llevar» de un producto (para mostrar el alcance ANTES de confirmar una regla global).
  const alcanceAviso = (calc, claveProducto) => calc.clientes.filter(c => c.dejoDeTodos.some(q => q.clave === claveProducto)).map(c => ({ clave: c.clave, nombre: c.nombre }));

  const api = { CONFIG, UMBRALES, DIAS, BLOQUES, TIPOS_DECISION, TIPOS_REGLA, MOTIVOS, norm, calcular, alcanceAviso, textoDias, diasTxt, cadaTxt, ritmoTxt, atrasoTxt, lineaTexto, nombreProducto, agenda, alertas, ALERTAS, ALERTAS_ORDEN, diaCalculado, tipoDe,
    fechas: { ymd, aFecha, sumarDias, habilMas, diffDias, lunesDe, diaSemana, fmtCorta, fechaLarga } };
  raiz.SegClientes = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
