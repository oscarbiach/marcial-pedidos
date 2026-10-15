/* WhatsApp: lo que se puede leer del chat sin que nadie lo escriba. Funciones puras, sin DOM ni red (se prueban con node).
   Se mira solo lo que escribió el cliente (mensajes recibidos) en los últimos 60 días:
   · productos del catálogo que nombró, y si ya los lleva, si los había dejado o si serían nuevos para él;
   · temas: precios, pedido por chat, reclamo, entrega y pagos.
   Es una lectura por palabras, no una interpretación: en pantalla se presenta como «detectado en el chat» y con la frase de origen. */
(function (raiz) {
  'use strict';
  const DIAS = 60, MAX_PRODUCTOS = 6, MAX_FRASE = 90;
  const norm = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ]+/g, ' ').trim();
  // Palabras que no identifican un producto: medidas, envases, unidades y conectores.
  const VACIAS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'con', 'sin', 'en', 'por', 'para', 'x', 'y', 'a', 'al', 'un', 'una', 'kg', 'kgs', 'gr', 'grs', 'g', 'lt', 'lts', 'ml', 'cc', 'unidad', 'unidades', 'u', 'bolsa', 'caja', 'cajas', 'pack', 'paquete', 'bandeja', 'horma', 'barra', 'prueba', 'tipo', 'premium', 'especial', 'clasico', 'clasica', 'entero', 'entera', 'feteado', 'feteada']);
  const palabras = t => norm(t).split(' ').filter(w => w.length >= 3 && !VACIAS.has(w) && !/\d/.test(w));
  // Singular simple, para que «papas» encuentre «papa» y «quesos» encuentre «queso».
  const raizDe = w => (w.length > 4 && w.endsWith('es') ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w);

  // Cada producto se reconoce por su «núcleo»: las dos primeras palabras que lo identifican, sin la marca (lo que va después de « - »).
  // Productos del mismo núcleo («Panceta Ahumada 1kg» y «… 2kg») se juntan en una sola familia, con el nombre más corto.
  function familias(catalogo) {
    const mapa = new Map();
    (catalogo || []).forEach(nombre => {
      const base = String(nombre || '').split(' - ')[0], nucleo = palabras(base).slice(0, 2);
      if (!nucleo.length) return;
      const k = nucleo.map(raizDe).join(' ');
      const f = mapa.get(k) || { clave: k, nucleo: nucleo.map(raizDe), nombres: [] };
      f.nombres.push(String(nombre)); mapa.set(k, f);
    });
    const lista = [...mapa.values()];
    // Una palabra larga que aparece en una sola familia alcanza sola para reconocerla («adoradas», «panceta»); «papas» no, porque hay varias.
    const usos = new Map(); lista.forEach(f => new Set(f.nucleo).forEach(w => usos.set(w, (usos.get(w) || 0) + 1)));
    lista.forEach(f => {
      f.nombre = f.nombres.slice().sort((a, b) => a.length - b.length)[0].split(' - ')[0].replace(/\s+\d+([.,]\d+)?\s*(kg|gr|g|lt|ml|cc)\b.*$/i, '').trim();
      f.sueltas = f.nucleo.filter(w => w.length >= 5 && usos.get(w) === 1);
    });
    return lista;
  }
  function nombra(f, set) {
    if (f.nucleo.every(w => set.has(w))) return f.nucleo.length > 1 || f.nucleo[0].length >= 5;
    return f.sueltas.some(w => set.has(w));
  }

  const TEMAS = [
    { clave: 'precio', etiqueta: 'Consultó precios', tono: 'info', icono: 'circle-dollar-sign', re: /\b(precio|precios|lista de precio|cuanto (sale|salen|esta|estan|cuesta|cuestan|vale|valen|seria)|a cuanto|valor|cotiza)/ },
    { clave: 'pedido', etiqueta: 'Pidió por chat', tono: 'marca', icono: 'shopping-cart', re: /\b(mandame|mandanos|enviame|traeme|traenos|anotame|anota|necesito|necesitamos|quiero|queria|quisiera|me podes (mandar|traer)|(te )?(hago|hacer|paso|pasar) (el |un )?pedido|para manana)\b/ },
    { clave: 'reclamo', etiqueta: 'Reclamo o problema', tono: 'error', icono: 'triangle-alert', re: /\b(no (me )?(llego|llegaron|vino|vinieron|trajeron|mandaron)|falto|faltaron|faltaba|vino mal|vinieron mal|en mal estado|roto|rota|vencido|vencida|devolver|devolucion|reclamo|queja|equivocad|cambiar(lo|la|los|las)?)\b/ },
    { clave: 'entrega', etiqueta: 'Preguntó por la entrega', tono: 'aviso', icono: 'truck', re: /\b(a que hora|cuando (llega|llegan|viene|vienen|pasan|pasa|me traen|lo traen)|horario|reparto|entrega|llegan hoy|pasan hoy)\b/ },
    { clave: 'pago', etiqueta: 'Habló de pagos', tono: 'ok', icono: 'banknote', re: /\b(transferencia|transferi|transfiero|pago|pague|pagar|alias|cbu|factura|comprobante|deuda|saldo|efectivo|cuenta corriente)\b/ },
  ];
  const PREGUNTA = /\?|^(tenes|tienen|tenian|hay|te queda|les queda|precio|cuanto|me pasas|trabajan)\b/;

  const frase = t => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > MAX_FRASE ? s.slice(0, MAX_FRASE - 1) + '…' : s; };

  // mensajes: [{ direction, content, occurred_at }]; catalogo: nombres de productos; cliente (opcional): { productos:[{nombre, dejo}], dejoDeTodos:[{nombre}] }.
  // ahora: fecha ISO o Date (para probar). Devuelve { productos:[...], temas:[...], analizados }.
  function analizar(mensajes, catalogo, cliente, ahora) {
    const fin = ahora ? new Date(ahora) : new Date(), desde = fin.getTime() - DIAS * 86400000;
    const recibidos = (mensajes || []).filter(m => m && m.direction === 'inbound' && m.content && new Date(m.occurred_at).getTime() >= desde)
      .sort((a, b) => String(b.occurred_at).localeCompare(String(a.occurred_at)));   // el más reciente primero: la frase que se muestra es la última
    const fams = familias(catalogo);
    const lleva = new Map(), dejo = new Set();
    if (cliente) {
      (cliente.productos || []).forEach(p => { const f = fams.find(x => nombra(x, new Set(palabras(p.nombre).map(raizDe)))); if (f) lleva.set(f.clave, p); });
      (cliente.dejoDeTodos || []).forEach(p => { const f = fams.find(x => nombra(x, new Set(palabras(p.nombre).map(raizDe)))); if (f) dejo.add(f.clave); });
    }
    const prods = new Map(), temas = new Map();
    recibidos.forEach(m => {
      const texto = norm(m.content), set = new Set(texto.split(' ').map(raizDe));
      const pregunta = PREGUNTA.test(texto) || /\?/.test(m.content);
      fams.forEach(f => {
        if (!nombra(f, set)) return;
        const p = prods.get(f.clave) || { clave: f.clave, nombre: f.nombre, veces: 0, ultima: m.occurred_at, frase: frase(m.content), pregunta: false };
        p.veces++; if (pregunta) p.pregunta = true; prods.set(f.clave, p);
      });
      TEMAS.forEach(t => {
        if (!t.re.test(texto)) return;
        const x = temas.get(t.clave) || { clave: t.clave, etiqueta: t.etiqueta, tono: t.tono, icono: t.icono, veces: 0, ultima: m.occurred_at, frase: frase(m.content) };
        x.veces++; temas.set(t.clave, x);
      });
    });
    // Relación con lo que compra: lo había dejado > nunca lo compró (oportunidad) > ya lo lleva.
    const productos = [...prods.values()].map(p => Object.assign(p, {
      relacion: dejo.has(p.clave) ? 'dejo' : !cliente ? '' : lleva.has(p.clave) ? 'lleva' : 'nuevo',
    })).sort((a, b) => String(b.ultima).localeCompare(String(a.ultima)) || b.veces - a.veces).slice(0, MAX_PRODUCTOS);
    const ordenTemas = TEMAS.map(t => t.clave);
    return { productos, temas: [...temas.values()].sort((a, b) => ordenTemas.indexOf(a.clave) - ordenTemas.indexOf(b.clave)), analizados: recibidos.length, dias: DIAS };
  }
  // Para resaltar en la burbuja del mensaje las palabras que nombran un producto: devuelve las palabras (normalizadas) a marcar.
  function palabrasProducto(texto, catalogo) {
    const fams = familias(catalogo), set = new Set(norm(texto).split(' ').map(raizDe)), marcar = new Set();
    fams.forEach(f => { if (nombra(f, set)) (f.nucleo.every(w => set.has(w)) ? f.nucleo : f.sueltas.filter(w => set.has(w))).forEach(w => marcar.add(w)); });
    return marcar;
  }

  const api = { analizar, familias, palabrasProducto, norm, raizDe, TEMAS, DIAS };
  raiz.WhatsAppTemas = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
