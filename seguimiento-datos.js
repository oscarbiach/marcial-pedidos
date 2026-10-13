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
   El autor lo pone el almacén (en la base lo decide el servidor por el mail de la sesión; acá nunca se confía en lo que diga la pantalla). */
(function (raiz) {
  'use strict';
  const S = raiz.SegClientes || (typeof require === 'function' ? require('./seguimiento-clientes.js') : null);
  const norm = S.norm, MOTIVOS = S.MOTIVOS, TIPOS = S.TIPOS_DECISION, TIPOS_REGLA = S.TIPOS_REGLA;
  const vacio = v => v === undefined || v === null || v === '';
  const o = v => (vacio(v) ? null : String(v));
  const idNuevo = () => (raiz.crypto && raiz.crypto.randomUUID ? raiz.crypto.randomUUID() : 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

  // ── Almacén local (modo prueba y pruebas automáticas) ──
  // opts: { storage (como localStorage), clave (nombre del almacén), quien: () => 'Oscar', hoy: () => 'YYYY-MM-DD', ahora?: () => iso }
  function almacenLocal(opts) {
    const quien = () => (opts.quien && opts.quien()) || 'Prueba', hoy = () => opts.hoy(), ahora = () => (opts.ahora ? opts.ahora() : new Date().toISOString());
    const leer = () => { try { const d = JSON.parse(opts.storage.getItem(opts.clave)); if (d && Array.isArray(d.decisiones) && Array.isArray(d.reglas)) return d; } catch (e) { /* vacío o dañado: se empieza de cero */ } return { decisiones: [], reglas: [] }; };
    const guardar = d => { opts.storage.setItem(opts.clave, JSON.stringify(d)); };
    const cerrar = (x, cierre) => { x.vigente = false; x.cerradaEn = ahora(); x.cerradaPor = quien(); x.cierre = cierre; };
    const actual = x => (x ? { id: x.id, tipo: x.tipo, autor: x.autor, creado: x.creado } : null);
    return {
      modo: 'prueba',
      async cargar() {
        const d = leer();
        return { estado: 'ok', decisiones: d.decisiones.filter(x => x.vigente), reglas: d.reglas.filter(x => x.vigente) };
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
        if (!['automatico', 'retomado', 'deshecha'].includes(cierre)) return { ok: false, error: 'Cierre desconocido' };
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
          return { estado: 'ok', decisiones, reglas };
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
