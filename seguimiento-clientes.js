/* Seguimiento de clientes por ritmo de compra (app de Pedidos): motor de cálculo. Funciones puras, sin DOM ni red.
   Objetivo: cada mañana, definir a quién escribirle comparando a cada cliente contra SU PROPIO ritmo de pedido, no contra una regla fija.

   Método (el del usuario, de su sesión de seguimiento; lo no confirmado está marcado [INFERIDO]):
   · Un pedido cuenta salvo que esté eliminado (papelera) o Cancelado. Los Pendientes cuentan como pedido hecho.
   · Fecha de referencia del pedido = fecha de despacho si existe; si no, la de carga. El reloj de recompra arranca en el despacho.
   · Se excluyen cuentas de prueba o muestra (CONFIG.excluir) y se unifican nombres (sin mayúsculas/tildes + CONFIG.unificar).
   · Por cliente: n (pedidos), intervalo mediano entre fechas distintas, días sin pedir = hoy − último pedido,
     atraso = días sin pedir ÷ intervalo (1 o más = vencido; 3 = ya pasó el triple de lo que suele tardar).
   · Día habitual: el día de la semana con ≥ 30 % de sus pedidos, medido por fecha de carga.
   · Con un solo pedido no hay intervalo propio: se usa la mediana de la cartera. Con menos de 3 pedidos el ritmo es poco confiable.
   · La semana va de lunes a domingo.
   · Bloques (cada cliente en uno solo, en este orden): Recuperación → Compra única → Prioridad alta → Les tocaba esta semana → No tocar
     (en pantalla "No tocar" ya no es un bloque de Para hoy: en Clientes se ve como "Dentro de su ciclo", "Pidió esta semana" o "Inactivo").
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
    // Quién ve la pestaña Clientes (nombres como figuran en la app; se comparan sin mayúsculas ni tildes): Oscar, Joaquin y Charly (decisión del
    // usuario, 13/10). Charly pasa a llamarse Juan Marcos: están los dos para que el cambio de nombre no le saque el acceso. Es solo de interfaz:
    // no protege los datos (la base deja leer los pedidos a cualquier sesión con PIN válido).
    usuarios: ['Oscar', 'Joaquin', 'Charly', 'Juan Marcos'],
    // Quién puede mover, pausar y resolver avisos (por ahora los mismos que ven la pestaña; propuesta a validar con el usuario). Solo de interfaz:
    // el permiso real lo da la base (tabla seg_editores, ver supabase/14-seguimiento-decisiones.sql).
    editores: ['Oscar', 'Joaquin', 'Charly', 'Juan Marcos'],
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
  const cuenta = p => p && !p.eliminado_en && p.estado !== 'Cancelado' && p.cliente && String(p.cliente).trim() && p.fecha;
  const diaCarga = p => String(p.fecha).slice(0, 10);
  const diaRef = (p, hoy) => { const d = p.fechaDespacho ? String(p.fechaDespacho).slice(0, 10) : ''; return d && d <= hoy ? d : diaCarga(p); };

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
        const habito = q.veces >= U.dejoVecesMin && q.hace <= U.ventanaDias;
        if (g.tipo === 'reemplazo') {
          const nuevo = [...new Set((prods.get(g.B) || { fechas: [] }).fechas)].sort().find(d => d > q.ultima && d >= g.desde);
          if (nuevo) contexto.push({ tipo: 'cambio', de: q.nombre, a: nombreRegla(g, 'B'), fecha: nuevo, regla: g.id });
          else if (habito) contexto.push({ tipo: 'alternativa', de: q.nombre, a: nombreRegla(g, 'B'), disponibilidad: 'sin confirmar', regla: g.id });
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
      if (!cuenta(p)) return;
      let nombre = String(p.cliente).trim(), k = norm(nombre);
      if (coincide(k, C.excluir) || termina(k, C.excluirTerminaEn)) { excluidos++; return; }
      const unificado = !!alias[k];
      if (unificado) { nombre = alias[k]; k = norm(nombre); }
      if (diaRef(p, hoy) > hoy || diaCarga(p) > hoy) return;   // pedidos con fecha futura no cuentan
      if (!mapa.has(k)) mapa.set(k, { clave: k, nombre, pedidos: [], canon: false });
      if (unificado) mapa.get(k).canon = true;
      mapa.get(k).pedidos.push(p);
    });

    // 2. Fechas, intervalo propio y mediana de la cartera
    const base = [], brechas = [];
    mapa.forEach(x => {
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
      let manual = null;
      const dm = decs.get(x.clave);
      if (dm) {
        const conocidos = new Set((dm.pedidosConocidos || []).map(String));
        // «Nuevo pedido»: uno válido que no existía al decidir y se cargó desde ese día (una importación vieja o un despacho tardío no cuentan).
        const nuevos = x.pedidos.filter(p => !conocidos.has(String(p.id)) && diaCarga(p) >= String(dm.desde || '').slice(0, 10));
        manual = { id: dm.id, tipo: dm.tipo, motivo: dm.motivo || '', motivoTxt: MOTIVOS[dm.motivo] || '', nota: dm.nota || '', revision: dm.tipo === 'pausa' ? String(dm.revision || '').slice(0, 10) : '',
          desde: String(dm.desde || '').slice(0, 10), autor: dm.autor || '', creado: dm.creado || '', version: dm.version || 1,
          nuevosPedidos: nuevos.length, ultimoNuevo: nuevos.length ? nuevos[nuevos.length - 1]._ref : '', conocidos: (dm.pedidosConocidos || []).map(String) };
        manual.revisar = manual.tipo === 'pausa' && !!manual.revision && manual.revision <= hoy;
        bloque = dm.tipo; motivo = ''; razon = razonManual(manual);
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
      const fechasRecientes = x.fechas.slice(-U.fechasFicha).map(d => ({ fecha: d, despacho: despachoDe.has(d) }));

      return {
        clave: x.clave, nombre: x.nombre, n, poco, ultimo, dias, intervalo, intervaloPropio, atraso, diasHab, bloque, motivo,
        hoyEsSuDia: diasHab.includes(diaSemana(hoy)), lleva, dejoDe, dejoDeTodos, cambiosProductos, productos, observacion,
        auto, manual, pedidoIds: x.pedidos.map(p => String(p.id)),
        diaUltimo: fechaLarga(ultimo), primer: x.fechas[0],
        // Solo para mostrar (no cambian ningún bloque): razón del bloque, confianza del ritmo y datos de la ficha
        razon, refTipo, ultimoDespacho: despachoDe.has(ultimo), fechasRecientes, nFechas: x.fechas.length, nIntervalos: x.gaps.length,
        pedidosVentana: enVentana.length, porDia, plazo,
      };
    });

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
    const claves = new Set(clientes.map(c => c.clave));
    const sinCliente = [...decs.keys()].filter(k => !claves.has(k));   // decisiones de clientes que ya no figuran (no se pierden: solo no se muestran)
    return { hoy, lunes, medianaCartera, bloques, clientes, excluidos, noTocar, pausa, reglas: { validas: R.lista, invalidas: R.invalidas }, decisionesSinCliente: sinCliente };
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

  const api = { CONFIG, UMBRALES, DIAS, BLOQUES, TIPOS_DECISION, TIPOS_REGLA, MOTIVOS, norm, calcular, alcanceAviso, textoDias, diasTxt, cadaTxt, ritmoTxt, atrasoTxt, lineaTexto, nombreProducto,
    fechas: { ymd, aFecha, sumarDias, diffDias, lunesDe, diaSemana, fmtCorta, fechaLarga } };
  raiz.SegClientes = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
