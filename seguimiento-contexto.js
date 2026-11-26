/* Contexto comercial de solo lectura. Sin inferir kilos, precios ni disponibilidad. */
(function(root){
 'use strict';
 const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
 const familias=[['Panes',/\bpan(?:es)?\b/],['Papas',/\bpapas?\b/],['Quesos',/mozzarella|muzzarella|tybo|sardo|cheddar|queso|reggian|provol|cremoso|roquefort/],['Fiambres',/jamon|panceta|salame|salamin|mortadela|bondiola|paleta cocida/],['Carnes',/carne|picada|nalga|chinchulin|vacio|asado|pollo|suprema|hamburguesa/],['Aderezos y conservas',/mayonesa|ketchup|mostaza|aderezo|aceituna|pickles|morron|tomate|barbacoa/],['Repostería',/dulce de leche|variegato|pistacho|chocolate|frutilla.*sembrar/],['Aceites y secos',/\baceite|\bharina|condimento|oregano|pimienta|pimenton/]];
 const familia=n=>familias.find(([,r])=>r.test(norm(n)))?.[0]||null;
 const fecha=p=>String(p.fechaPedido||p.fecha||'').slice(0,10);
 const repo=p=>String(p.notas||'').startsWith('🔁 REPOSICIÓN');
 const diaContacto=x=>{const d=new Date(x);return Number.isNaN(d.getTime())?'':new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Argentina/Buenos_Aires',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);};
 function analizar({cliente:c,clientes=[],pedidos=[],catalogo=[],contactos=[],hoy,reglas=[]}){
  const validos=pedidos.filter(p=>!p.eliminado_en&&p.estado!=='Cancelado'&&fecha(p)&&fecha(p)<=hoy);
  const ids=new Set(c.pedidoIds||[]), nombres=new Set([norm(c.nombre),c.clave]);
  validos.filter(p=>ids.has(String(p.id))).forEach(p=>nombres.add(norm(p.cliente)));
  const propios=validos.filter(p=>ids.has(String(p.id))||nombres.has(norm(p.cliente)));
  const compras=propios.filter(p=>!repo(p)).sort((a,b)=>fecha(b).localeCompare(fecha(a))||String(b.id).localeCompare(String(a.id)));
  const pendientes=propios.filter(p=>repo(p)&&p.estado==='Pendiente');
  const eventos=[];
  propios.forEach(p=>{
   eventos.push({fecha:fecha(p),tipo:repo(p)?'Reposición creada':'Pedido',texto:(p.items||[]).map(i=>i.prod).join(' / ')});
   if(p.estado==='Despachado'&&p.fechaDespacho&&p.fechaDespacho<=hoy)eventos.push({fecha:p.fechaDespacho,tipo:repo(p)?'Reposición despachada':'Despacho',texto:(p.items||[]).map(i=>i.prod).join(' · ')});
  });
  const resultados={tiene_stock:'Tiene stock',no_contesto:'No contestó',no_interesa:'No le interesa por ahora',otro:'Contacto'};
  const cs=contactos.length?contactos:c.contacto?[c.contacto]:[];
  cs.forEach(x=>eventos.push({fecha:diaContacto(x.creado_en),tipo:resultados[x.resultado]||'Contacto',texto:[x.nota,x.volver_el?'Volver: '+x.volver_el:''].filter(Boolean).join(' · ')}));
  eventos.sort((a,b)=>b.fecha.localeCompare(a.fecha));
  const cat=new Map(catalogo.filter(p=>p.act!==false&&p.activo!==false).map(p=>[norm(p.n||p.nombre),p.n||p.nombre]));
  const retirados=new Set(reglas.filter(r=>r.tipo==='retirado'||r.tipo==='reemplazo'||(r.tipo==='excepcion'&&r.clave===c.clave)).map(r=>norm(r.producto)));
  const clasificar=n=>cat.has(norm(n))&&!retirados.has(norm(n))?familia(n):null;
  const grupos=new Map();let sinClasificar=0;
  (c.productos||[]).forEach(p=>{const f=clasificar(p.nombre);if(!f){sinClasificar++;return;}if(!grupos.has(f))grupos.set(f,[]);grupos.get(f).push(p);});
  const dejo=new Set((c.dejoDeTodos||[]).map(p=>p.clave));
  const matriz=[...grupos].map(([nombre,ps])=>({nombre,estado:ps.every(p=>dejo.has(p.clave))?'Dejó de pedir':ps.some(p=>p.veces>=2)?'Habitual':'Compra puntual',productos:ps.map(p=>p.nombre)}));
  const sugerencias=[];
  if(c.nFechas>=3&&!pendientes.length&&grupos.size){
   // Solo clientes visibles para este usuario; evidencia por cliente, nunca por cantidad de renglones.
   const apoyo=new Map();
   for(const otro of clientes){if(otro.clave===c.clave)continue;
    const fs=new Set((otro.productos||[]).filter(p=>p.ultima>=new Date(new Date(hoy+'T12:00:00Z').getTime()-180*86400000).toISOString().slice(0,10)).map(p=>clasificar(p.nombre)).filter(Boolean));
    if(![...fs].some(f=>grupos.has(f)))continue;
    fs.forEach(f=>{if(!grupos.has(f)){if(!apoyo.has(f))apoyo.set(f,new Set());apoyo.get(f).add(otro.clave);}});
   }
   [...apoyo].filter(([,ks])=>ks.size>=3).sort((a,b)=>b[1].size-a[1].size||a[0].localeCompare(b[0],'es')).slice(0,2).forEach(([nombre,ks])=>sugerencias.push({nombre,clientes:ks.size}));
  }
  return {ultimo:compras[0]||null,pendientes,eventos:eventos.slice(0,8),matriz,sugerencias,sinClasificar,ultimoContacto:cs.slice().sort((a,b)=>String(b.creado_en).localeCompare(String(a.creado_en)))[0]||null};
 }
 const api={analizar,familia};if(typeof module==='object'&&module.exports)module.exports=api;else root.SegContexto=api;
})(typeof globalThis!=='undefined'?globalThis:this);
