/* Seguimiento de clientes: dónde se GUARDAN las decisiones (mover / pausar) y las reglas de producto (IDEA-10, 11 y 12).
   Sin DOM. Dos almacenes con la misma interfaz:
   · local (modo prueba): localStorage del navegador; nunca toca Supabase. Imita las funciones SQL de supabase/14-seguimiento-decisiones.sql
     (una sola decisión vigente por cliente, versiones, conflicto si otra persona cambió antes, ciclos de reemplazo).
   · base (Supabase): las funciones seg_* de esa migración. MIENTRAS NO SE CORRA ESA MIGRACIÓN (hace falta aprobación del usuario) el estado es
     "noInstalado": la pantalla no ofrece mover, pausar ni resolver avisos y se ve exactamente como siempre.
   Interfaz (todo async):
     cargar()            → { estado: 'ok' | 'noInstalado' | 'sinPermiso' | 'error', decisiones, reglas, mensaje? }  (solo lo vigente, en la forma del motor)
     decidir(p)          → { ok:true, id } | { ok:false, conflicto:true, actual } | { ok:false, error }
                           p = { clave, nombre, tipo, motivo, nota?, revision?, conocidos: [ids], espera }  (espera = id de la decisión que se veía, o null)
     cerrarDecision(p)   → { ok:true } | { ok:false, conflicto:true, actual } | { ok:false, error }      p = { clave, nombre, espera, cierre }
     crearRegla(p)       → { ok:true, id } | { ok:false, error }   p = { tipo, producto, productoNombre, sustituto?, sustitutoNombre?, clave?, nombre?, motivo?, nota?, revision?, desde? }
     cerrarRegla(id)     → { ok:true }
   Agenda del calendario (supabase/21-seguimiento-agenda.sql): `cargar()` trae también `agenda: [{ clave, fecha, ciclo, escrito }]` y `agendaOk` (false si la tabla
   todavía no existe o no se pudo leer: el calendario funciona igual con los días calculados, sin poder mover ni marcar).
     agendar(p)          → { ok:true } | { ok:false, error }   p = { clave, fecha ('YYYY-MM-DD' o null = volver a su día), ciclo (fecha de su último pedido) }   (idempotente)
     escribi(p)          → { ok:true } | { ok:false, error }   p = { clave, fecha (día en que le escribió, o null para desmarcar) }                         (idempotente)
   Seguimiento v2 (supabase/migrations/20261124_seguimiento_v2.sql): `cargar()` trae también `v2: { instalado, yo: { nombre, ve_todo, gestor } | null, etiquetas: [{ id, nombre, dia_semana, siempre }],
   usuarios: [{ nombre, ve_todo }] (solo para quien puede asignar), clientes: [{ clave, vendedor, etiquetas: [id], contacto }], error? }`. Con `instalado: false` (la migración no está aplicada) la app
   se ve como antes: sin vendedores, etiquetas ni resultados. Escrituras (todas idempotentes: el id lo genera la pantalla UNA vez por acción y se reutiliza en los reintentos):
     etiquetaGuardar(p)    → { ok, etiqueta } | { ok:false, error }   p = { id, nombre, dia_semana (1 a 6 o null), siempre }
     etiquetaBorrar(id)    → { ok:true }
     clienteEtiquetas(p)   → { ok, etiquetas }                        p = { clave, etiquetas: [id] }   (reemplaza el conjunto)
     clienteVendedor(p)    → { ok, vendedor }                         p = { clave, vendedor (nombre o null) }
     contactoRegistrar(p)  → { ok, id, yaEstaba? }                    p = { id, clave, resultado ('no_contesto'|'tiene_stock'|'no_interesa'|'otro'), volver_el, nota, ciclo }
     contactosLeer(clave)  → { ok, lista: [{ id, resultado, volver_el, nota, autor, creado_en }] }  (últimos 30)
   El autor lo pone el almacén (en la base lo decide el servidor por el mail de la sesión; acá nunca se confía en lo que diga la pantalla). */
(function (raiz) {
  'use strict';
  const S = raiz.SegClientes || (typeof require === 'function' ? require('./seguimiento-clientes.js') : null);
  const norm = S.norm, MOTIVOS = S.MOTIVOS, TIPOS = S.TIPOS_DECISION, TIPOS_REGLA = S.TIPOS_REGLA;
  const vacio = v => v === undefined || v === null || v === '';
  const o = v => (vacio(v) ? null : String(v));
  const fechaOk = v => vacio(v) || /^\d{4}-\d{2}-\d{2}$/.test(String(v));
  const idNuevo = () => (raiz.crypto && raiz.crypto.randomUUID ? raiz.crypto.randomUUID() : 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

  // ── Almacén local (modo prueba y pruebas automáticas) ──
  // opts: { storage (como localStorage), clave (nombre del almacén), quien: () => 'Oscar', hoy: () => 'YYYY-MM-DD', ahora?: () => iso,
  //         semilla?: () => ({ clave: { fecha, ciclo, escrito } }) (agenda de ejemplo del modo prueba: solo se usa mientras no se haya guardado nada) }
  function almacenLocal(opts) {
    const quien = () => (opts.quien && opts.quien()) || 'Prueba', hoy = () => opts.hoy(), ahora = () => (opts.ahora ? opts.ahora() : new Date().toISOString());
    const v2Vacio = d => { ['etiquetas', 'contactos'].forEach(k => { if (!Array.isArray(d[k])) d[k] = []; }); ['clienteEtiquetas', 'vendedores'].forEach(k => { if (!d[k] || typeof d[k] !== 'object') d[k] = {}; }); return d; };
    const leer = () => { try { const d = JSON.parse(opts.storage.getItem(opts.clave)); if (d && Array.isArray(d.decisiones) && Array.isArray(d.reglas)) { if (!d.agenda || typeof d.agenda !== 'object') d.agenda = {}; return v2Vacio(d); } } catch (e) { /* vacío o dañado: se empieza de cero */ } return v2Vacio({ decisiones: [], reglas: [], agenda: opts.semilla && !opts.storage.getItem(opts.clave) ? (opts.semilla() || {}) : {} }); };
    // Modo prueba: quien entra ve todo y puede asignar (no hay base que limite). opts.yo permite probar otros perfiles.
    const yoLocal = () => (opts.yo ? opts.yo() : { nombre: quien(), ve_todo: true, gestor: true });
    const USUARIOS = [{ nombre: 'Oscar', ve_todo: false }, { nombre: 'Joaquin', ve_todo: true }, { nombre: 'Juan Marcos', ve_todo: true }, { nombre: 'Thiago', ve_todo: false }];
    const guardar = d => { opts.storage.setItem(opts.clave, JSON.stringify(d)); };
    const cerrar = (x, cierre) => { x.vigente = false; x.cerradaEn = ahora(); x.cerradaPor = quien(); x.cierre = cierre; };
    const actual = x => (x ? { id: x.id, tipo: x.tipo, autor: x.autor, creado: x.creado } : null);
    return {
      modo: 'prueba',
      async cargar() {
        const d = leer();
        const yo = yoLocal(), ult = {};
        d.contactos.forEach(c => { if (!ult[c.clave] || String(c.creado_en) >= String(ult[c.clave].creado_en)) ult[c.clave] = c; });
        const claves = new Set([...Object.keys(d.vendedores), ...Object.keys(d.clienteEtiquetas).filter(k => (d.clienteEtiquetas[k] || []).length), ...Object.keys(ult)]);
        const activas = d.etiquetas.filter(e => e.activa !== false);
        return { estado: 'ok', decisiones: d.decisiones.filter(x => x.vigente), reglas: d.reglas.filter(x => x.vigente), agendaOk: true,
          agenda: Object.entries(d.agenda).map(([clave, f]) => ({ clave, fecha: f.fecha || null, ciclo: f.ciclo || null, escrito: f.escrito || null })),
          v2: { instalado: true, yo, etiquetas: activas.map(e => ({ id: e.id, nombre: e.nombre, dia_semana: e.dia_semana, siempre: !!e.siempre })), usuarios: yo.gestor ? USUARIOS : [],
            clientes: [...claves].map(clave => ({ clave, vendedor: d.vendedores[clave] || null, etiquetas: (d.clienteEtiquetas[clave] || []).filter(id => activas.some(e => e.id === id)),
              contacto: ult[clave] ? { resultado: ult[clave].resultado, volver_el: ult[clave].volver_el, nota: ult[clave].nota, autor: ult[clave].autor, creado_en: ult[clave].creado_en } : null })) } };
      },
      // Seguimiento v2 en modo prueba (imitan las funciones seg_* de la migración).
      async etiquetaGuardar(p) {
        const nombre = String(p.nombre || '').trim(), dia = vacio(p.dia_semana) ? null : Number(p.dia_semana);
        if (!nombre) return { ok: false, error: 'Escribí el nombre de la etiqueta' };
        if (dia !== null && !(dia >= 1 && dia <= 6)) return { ok: false, error: 'El día tiene que ser de lunes a sábado' };
        const d = leer();
        if (d.etiquetas.some(e => e.id !== p.id && e.activa !== false && norm(e.nombre) === norm(nombre))) return { ok: false, error: 'Ya hay una etiqueta con ese nombre' };
        const e = d.etiquetas.find(x => x.id === p.id) || (d.etiquetas.push({ id: p.id }), d.etiquetas[d.etiquetas.length - 1]);
        Object.assign(e, { nombre, dia_semana: dia, siempre: !!p.siempre, activa: true }); guardar(d);
        return { ok: true, etiqueta: { id: e.id, nombre, dia_semana: dia, siempre: !!p.siempre } };
      },
      async etiquetaBorrar(id) { const d = leer(), e = d.etiquetas.find(x => x.id === id); if (e) e.activa = false; guardar(d); return { ok: true, yaEstaba: !e }; },
      async clienteEtiquetas(p) {
        if (!p.clave) return { ok: false, error: 'Falta el cliente' };
        const d = leer(), ok = new Set(d.etiquetas.filter(e => e.activa !== false).map(e => e.id)); d.clienteEtiquetas[p.clave] = [...new Set(p.etiquetas || [])].filter(id => ok.has(id)); guardar(d);
        return { ok: true, etiquetas: d.clienteEtiquetas[p.clave] };
      },
      async clienteVendedor(p) {
        if (!p.clave) return { ok: false, error: 'Falta el cliente' };
        const v = vacio(p.vendedor) ? null : USUARIOS.find(u => norm(u.nombre) === norm(p.vendedor));
        if (!vacio(p.vendedor) && !v) return { ok: false, error: 'Ese vendedor no existe en el seguimiento' };
        const d = leer(); if (v) d.vendedores[p.clave] = v.nombre; else delete d.vendedores[p.clave]; guardar(d);
        return { ok: true, vendedor: v ? v.nombre : null };
      },
      async contactoRegistrar(p) {
        const R = ['no_contesto', 'tiene_stock', 'no_interesa', 'otro'], nota = String(p.nota || '').trim() || null;
        if (!p.id || !p.clave) return { ok: false, error: 'Falta el cliente' };
        if (!R.includes(p.resultado)) return { ok: false, error: 'Resultado desconocido' };
        if (!fechaOk(p.volver_el) || !fechaOk(p.ciclo)) return { ok: false, error: 'Fecha inválida' };
        if (nota && nota.length > 500) return { ok: false, error: 'La nota es demasiado larga' };
        if ((p.resultado === 'tiene_stock' || p.resultado === 'no_interesa') && vacio(p.volver_el)) return { ok: false, error: 'Elegí el día para volver a escribirle' };
        const d = leer(); if (d.contactos.some(c => c.id === p.id)) return { ok: true, id: p.id, yaEstaba: true };
        const volver = p.resultado === 'no_contesto' ? null : o(p.volver_el);
        d.contactos.push({ id: p.id, clave: p.clave, resultado: p.resultado, volver_el: volver, nota, autor: quien(), creado_en: ahora() });
        const f = d.agenda[p.clave] || { fecha: null, ciclo: null };
        if (p.resultado === 'no_contesto') d.agenda[p.clave] = Object.assign(f, { escrito: null });
        else if (volver) d.agenda[p.clave] = Object.assign(f, { fecha: volver, ciclo: o(p.ciclo), escrito: null });
        guardar(d); return { ok: true, id: p.id };
      },
      async contactosLeer(clave) { return { ok: true, lista: leer().contactos.filter(c => c.clave === clave).sort((a, b) => String(b.creado_en).localeCompare(String(a.creado_en))).slice(0, 30).map(c => ({ id: c.id, resultado: c.resultado, volver_el: c.volver_el, nota: c.nota, autor: c.autor, creado_en: c.creado_en })) }; },
      // Imitan a seg_agendar y seg_escribi: un renglón por cliente; repetir la misma llamada deja lo mismo.
      async agendar(p) {
        if (!p.clave) return { ok: false, error: 'Falta el cliente' };
        if (!fechaOk(p.fecha) || !fechaOk(p.ciclo)) return { ok: false, error: 'Fecha inválida' };
        const d = leer(), f = d.agenda[p.clave] || {};
        d.agenda[p.clave] = Object.assign(f, { fecha: o(p.fecha), ciclo: o(p.ciclo), autor: quien(), en: ahora() }); guardar(d);
        return { ok: true };
      },
      async escribi(p) {
        if (!p.clave) return { ok: false, error: 'Falta el cliente' };
        if (!fechaOk(p.fecha)) return { ok: false, error: 'Fecha inválida' };
        const d = leer(), f = d.agenda[p.clave] || { fecha: null, ciclo: null };
        d.agenda[p.clave] = Object.assign(f, { escrito: o(p.fecha), autor: quien(), en: ahora() }); guardar(d);
        return { ok: true };
      },
      async decidir(p) {
        if (!TIPOS.includes(p.tipo)) return { ok: false, error: 'Destino desconocido' };
        if (!MOTIVOS[p.motivo]) return { ok: false, error: 'Falta el motivo' };
        const d = leer(), act = d.decisiones.find(x => x.clave === p.clave && x.vigente), espera = o(p.espera);
        if (act && act.id !== espera) return { ok: false, conflicto: true, actual: actual(act) };
        if (!act && espera) return { ok: false, conflicto: true, actual: null };
        if (act) cerrar(act, 'reemplazada');
        const nueva = { id: idNuevo(), clave: p.clave, nombre: p.nombre || p.clave, tipo: p.tipo, motivo: p.motivo, nota: o(String(p.nota || '').trim()), revision: p.tipo === 'pausa' ? o(p.revision) : null,
          pedidosConocidos: (p.conocidos || []).map(String), desde: hoy(), version: (act ? act.version : 0) + 1, autor: quien(), creado: ahora(), vigente: true };
        d.decisiones.push(nueva); guardar(d);
        return { ok: true, id: nueva.id };
      },
      async cerrarDecision(p) {
        const cierre = p.cierre || 'automatico';
        if (!['automatico', 'retomado', 'deshecha', 'pedido_nuevo'].includes(cierre)) return { ok: false, error: 'Cierre desconocido' };
        const d = leer(), act = d.decisiones.find(x => x.clave === p.clave && x.vigente);
        if (!act) return { ok: true, yaEstaba: true };
        if (act.id !== o(p.espera)) return { ok: false, conflicto: true, actual: actual(act) };
        cerrar(act, cierre); guardar(d);
        return { ok: true };
      },
      async crearRegla(p) {
        if (!TIPOS_REGLA.includes(p.tipo)) return { ok: false, error: 'Tipo de regla desconocido' };
        const A = norm(S.nombreProducto(p.producto)), B = p.sustituto ? norm(S.nombreProducto(p.sustituto)) : '';
        if (!A) return { ok: false, error: 'Falta el producto' };
        const d = leer(), vigentes = d.reglas.filter(x => x.vigente);
        if (p.tipo === 'excepcion') {
          if (!p.clave) return { ok: false, error: 'Falta el cliente' };
          vigentes.filter(x => x.tipo === 'excepcion' && x.clave === p.clave && x.producto === A).forEach(x => cerrar(x, 'reemplazada'));
        } else {
          const previa = vigentes.find(x => x.tipo !== 'excepcion' && x.producto === A);
          if (previa && previa.tipo === 'reemplazo') return { ok: false, error: 'ese producto ya tiene un reemplazo: hay que deshacerlo antes' };
          if (p.tipo === 'reemplazo') {
            if (!B) return { ok: false, error: 'Falta el producto de reemplazo' };
            if (B === A) return { ok: false, error: 'un producto no puede reemplazarse a sí mismo' };
            const sig = new Map(vigentes.filter(x => x.tipo === 'reemplazo').map(x => [x.producto, x.sustituto]));
            for (let t = B, i = 0; t && i < 50; t = sig.get(t), i++) if (t === A) return { ok: false, error: 'el reemplazo forma un ciclo' };
          }
          if (previa) cerrar(previa, 'reemplazada');
        }
        const r = { id: idNuevo(), tipo: p.tipo, producto: A, productoNombre: p.productoNombre || S.nombreProducto(p.producto), sustituto: p.tipo === 'reemplazo' ? B : '', sustitutoNombre: p.tipo === 'reemplazo' ? (p.sustitutoNombre || S.nombreProducto(p.sustituto)) : '',
          clave: p.tipo === 'excepcion' ? p.clave : '', nombre: p.tipo === 'excepcion' ? (p.nombre || p.clave) : '', motivo: o(String(p.motivo || '').trim()), nota: o(String(p.nota || '').trim()),
          revision: p.tipo === 'excepcion' ? o(p.revision) : null, desde: o(p.desde) || hoy(), autor: quien(), creado: ahora(), vigente: true };
        d.reglas.push(r); guardar(d);
        return { ok: true, id: r.id };
      },
      async cerrarRegla(id) {
        const d = leer(), r = d.reglas.find(x => x.id === id && x.vigente);
        if (!r) return { ok: true, yaEstaba: true };
        cerrar(r, 'deshecha'); guardar(d);
        return { ok: true };
      },
    };
  }

  // ── Almacén en la base (Supabase) ──
  // opts: { sb (cliente de supabase-js), hoy: () => 'YYYY-MM-DD' }. Todo lo que escribe pasa por las funciones seg_* (ver el SQL).
  function almacenBase(opts) {
    const sb = opts.sb;
    let registro = null;   // clientes del registro: id y nombre (los pedidos todavía no traen cliente_id)
    const err = e => String((e && (e.message || e.msg)) || e || 'Error');
    const noInstalada = e => !!e && (e.code === 'PGRST202' || e.code === 'PGRST205' || e.code === '42P01' || e.code === '42883' || e.status === 404 || /could not find the (function|table)/i.test(err(e)));
    async function cargarRegistro() {
      const r = await sb.from('clientes').select('id,nombre');
      if (r.error) throw r.error;
      registro = (r.data || []).map(c => ({ id: c.id, nombre: c.nombre, k: norm(c.nombre) }));
    }
    // El cliente del seguimiento se identifica por su nombre normalizado; se guarda por id del registro. Si no hay uno solo, no se guarda nada.
    function idDe(clave) {
      const m = (registro || []).filter(c => c.k === clave);
      return m.length === 1 ? m[0].id : null;
    }
    const claveDe = id => { const c = (registro || []).find(x => x.id === id); return c ? c.k : null; };
    const sinCliente = { ok: false, error: 'Este cliente no está (o está repetido) en el registro de clientes: no se puede guardar una decisión sobre él.' };
    async function rpc(nombre, args) {
      const r = await sb.rpc(nombre, args);
      if (r.error) return { ok: false, error: err(r.error), codigo: r.error.code };
      return r.data || { ok: true };
    }
    return {
      modo: 'base',
      async cargar() {
        try {
          const es = await sb.rpc('seg_es_editor');
          if (es.error) return noInstalada(es.error) ? { estado: 'noInstalado', decisiones: [], reglas: [] } : { estado: 'error', decisiones: [], reglas: [], mensaje: err(es.error) };
          if (es.data !== true) return { estado: 'sinPermiso', decisiones: [], reglas: [], mensaje: 'Tu usuario no figura entre los que pueden usar el seguimiento.' };
          await cargarRegistro();
          const [dr, rr] = await Promise.all([
            sb.from('seg_decisiones').select('id,cliente_id,cliente_nombre,tipo,motivo,nota,revision_en,pedidos_conocidos,desde,version,autor,creado_en').eq('vigente', true),
            sb.from('seg_reglas_producto').select('id,tipo,producto_clave,producto_nombre,sustituto_clave,sustituto_nombre,cliente_id,cliente_nombre,motivo,nota,revision_en,desde,autor,creado_en').eq('vigente', true),
          ]);
          if (dr.error || rr.error) { const e = dr.error || rr.error; return noInstalada(e) ? { estado: 'noInstalado', decisiones: [], reglas: [] } : { estado: 'error', decisiones: [], reglas: [], mensaje: err(e) }; }
          const decisiones = (dr.data || []).map(x => ({ id: x.id, clave: claveDe(x.cliente_id) || norm(x.cliente_nombre), nombre: x.cliente_nombre, tipo: x.tipo, motivo: x.motivo, nota: x.nota || '', revision: x.revision_en || '',
            desde: x.desde, pedidosConocidos: x.pedidos_conocidos || [], autor: x.autor, creado: x.creado_en, version: x.version, vigente: true }));
          const reglas = (rr.data || []).map(x => ({ id: x.id, tipo: x.tipo, producto: x.producto_clave, productoNombre: x.producto_nombre, sustituto: x.sustituto_clave || '', sustitutoNombre: x.sustituto_nombre || '',
            clave: x.cliente_id ? (claveDe(x.cliente_id) || norm(x.cliente_nombre)) : '', nombre: x.cliente_nombre || '', motivo: x.motivo || '', nota: x.nota || '', revision: x.revision_en || '', desde: x.desde, autor: x.autor, creado: x.creado_en, vigente: true }));
          // La agenda del calendario va aparte: si su tabla todavía no existe (o falla), lo demás sigue andando y el calendario solo muestra los días calculados.
          let agenda = [], agendaOk = true, agendaMensaje = '';
          try {
            const ar = await sb.from('seg_agenda').select('cliente_id,fecha,ciclo,escrito_en');
            if (ar.error) { agendaOk = false; agendaMensaje = noInstalada(ar.error) ? '' : err(ar.error); }
            else agenda = (ar.data || []).map(x => ({ clave: claveDe(x.cliente_id), fecha: x.fecha || null, ciclo: x.ciclo || null, escrito: x.escrito_en || null })).filter(x => x.clave);
          } catch (e) { agendaOk = false; agendaMensaje = noInstalada(e) ? '' : err(e); }
          // Seguimiento v2 (vendedor, etiquetas, resultado de contacto). Sin la migración (funciones inexistentes) la app se ve como antes; un error de conexión sí frena
          // (sin saber quién es el usuario no se puede decidir qué clientes mostrar).
          let v2 = { instalado: false, yo: null, etiquetas: [], usuarios: [], clientes: [] };
          const yoR = await sb.rpc('seg_yo');
          if (yoR.error) { if (!noInstalada(yoR.error)) return { estado: 'error', decisiones: [], reglas: [], mensaje: err(yoR.error) }; }
          else {
            v2.instalado = true; v2.yo = yoR.data || null;
            if (v2.yo) {
              const mr = await sb.rpc('seg_clientes_meta');
              if (mr.error) return { estado: 'error', decisiones: [], reglas: [], mensaje: err(mr.error) };
              const m = mr.data || {};
              v2.etiquetas = m.etiquetas || []; v2.usuarios = m.usuarios || [];
              v2.clientes = (m.clientes || []).map(x => ({ clave: claveDe(x.cliente_id) || norm(x.nombre), vendedor: x.vendedor || null, etiquetas: x.etiquetas || [], contacto: x.contacto || null })).filter(x => x.clave);
            }
          }
          return { estado: 'ok', decisiones, reglas, agenda, agendaOk, agendaMensaje, v2 };
        } catch (e) { return noInstalada(e) ? { estado: 'noInstalado', decisiones: [], reglas: [] } : { estado: 'error', decisiones: [], reglas: [], mensaje: err(e) }; }
      },
      async decidir(p) {
        if (!registro) { try { await cargarRegistro(); } catch (e) { return { ok: false, error: err(e) }; } }
        const id = idDe(p.clave); if (!id) return sinCliente;
        return rpc('seg_decidir', { p_cliente_id: id, p_tipo: p.tipo, p_motivo: p.motivo, p_nota: o(p.nota), p_revision: p.tipo === 'pausa' ? o(p.revision) : null, p_conocidos: (p.conocidos || []).map(String), p_espera: o(p.espera), p_desde: opts.hoy() });
      },
      async cerrarDecision(p) {
        if (!registro) { try { await cargarRegistro(); } catch (e) { return { ok: false, error: err(e) }; } }
        const id = idDe(p.clave); if (!id) return sinCliente;
        return rpc('seg_cerrar_decision', { p_cliente_id: id, p_espera: o(p.espera), p_cierre: p.cierre || 'automatico' });
      },
      async agendar(p) {
        if (!registro) { try { await cargarRegistro(); } catch (e) { return { ok: false, error: err(e) }; } }
        const id = idDe(p.clave); if (!id) return sinCliente;
        return rpc('seg_agendar', { p_cliente_id: id, p_fecha: o(p.fecha), p_ciclo: o(p.ciclo) });
      },
      async escribi(p) {
        if (!registro) { try { await cargarRegistro(); } catch (e) { return { ok: false, error: err(e) }; } }
        const id = idDe(p.clave); if (!id) return sinCliente;
        return rpc('seg_escribi', { p_cliente_id: id, p_fecha: o(p.fecha) });
      },
      // Seguimiento v2: todas pasan por las funciones seg_* (permisos y duplicados los resuelve la base).
      async etiquetaGuardar(p) { return rpc('seg_etiqueta_guardar', { p_id: p.id, p_datos: { nombre: p.nombre, dia_semana: vacio(p.dia_semana) ? null : Number(p.dia_semana), siempre: !!p.siempre } }); },
      async etiquetaBorrar(id) { return rpc('seg_etiqueta_borrar', { p_id: id }); },
      async clienteEtiquetas(p) {
        if (!registro) { try { await cargarRegistro(); } catch (e) { return { ok: false, error: err(e) }; } }
        const id = idDe(p.clave); if (!id) return sinCliente;
        return rpc('seg_cliente_etiquetas', { p_cliente_id: id, p_etiquetas: p.etiquetas || [] });
      },
      async clienteVendedor(p) {
        if (!registro) { try { await cargarRegistro(); } catch (e) { return { ok: false, error: err(e) }; } }
        const id = idDe(p.clave); if (!id) return sinCliente;
        return rpc('seg_cliente_vendedor', { p_cliente_id: id, p_vendedor: o(p.vendedor) });
      },
      async contactoRegistrar(p) {
        if (!registro) { try { await cargarRegistro(); } catch (e) { return { ok: false, error: err(e) }; } }
        const id = idDe(p.clave); if (!id) return sinCliente;
        return rpc('seg_contacto_registrar', { p_id: p.id, p_cliente_id: id, p_resultado: p.resultado, p_volver_el: o(p.volver_el), p_nota: o(String(p.nota || '').trim()), p_ciclo: o(p.ciclo) });
      },
      async contactosLeer(clave) {
        if (!registro) { try { await cargarRegistro(); } catch (e) { return { ok: false, error: err(e) }; } }
        const id = idDe(clave); if (!id) return sinCliente;
        const r = await sb.rpc('seg_contactos_leer', { p_cliente_id: id });
        return r.error ? { ok: false, error: err(r.error), codigo: r.error.code } : { ok: true, lista: Array.isArray(r.data) ? r.data : [] };
      },
      async crearRegla(p) {
        let cid = null;
        if (p.tipo === 'excepcion') {
          if (!registro) { try { await cargarRegistro(); } catch (e) { return { ok: false, error: err(e) }; } }
          cid = idDe(p.clave); if (!cid) return sinCliente;
        }
        const A = norm(S.nombreProducto(p.producto)), B = p.sustituto ? norm(S.nombreProducto(p.sustituto)) : null;
        return rpc('seg_regla_crear', { p_tipo: p.tipo, p_producto_clave: A, p_producto_nombre: p.productoNombre || S.nombreProducto(p.producto), p_sustituto_clave: B, p_sustituto_nombre: B ? (p.sustitutoNombre || S.nombreProducto(p.sustituto)) : null,
          p_cliente_id: cid, p_motivo: o(p.motivo), p_nota: o(p.nota), p_revision: p.tipo === 'excepcion' ? o(p.revision) : null, p_desde: o(p.desde) || opts.hoy() });
      },
      async cerrarRegla(id) { return rpc('seg_regla_cerrar', { p_id: id }); },
    };
  }

  const api = { almacenLocal, almacenBase };
  raiz.SegDatos = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
