const assert = require('node:assert/strict');
const S = require('../seguimiento-clientes.js');
const hoy = '2026-11-20';
const cliente = (nombre,ultimo,intervalo) => ({clave:nombre,nombre,ultimo,intervalo,diasHab:[1],n:6,atraso:S.fechas.diffDias(hoy,ultimo)/intervalo,bloque:'semana',pedidoIds:[]});
const baharat=cliente('Baharat','2026-11-13',7), grimaldi=cliente('Grimaldi','2026-11-05',13);
const calc={hoy,clientes:[baharat,grimaldi]};
let a=S.agenda(calc);
assert.equal(a.porCliente.get('Baharat').dia,hoy);
assert.equal(a.porCliente.get('Grimaldi').calculado,'2026-11-18');
assert.equal(a.porCliente.get('Grimaldi').dia,hoy);
assert.equal(a.porCliente.get('Grimaldi').atrasado,true);
a=S.agenda(calc,{agenda:new Map([['Grimaldi',{fecha:'2026-11-23',ciclo:grimaldi.ultimo}]])});
assert.equal(a.porCliente.get('Grimaldi').dia,'2026-11-23');
assert.equal(a.porCliente.get('Grimaldi').movido,true);
a=S.agenda(calc,{agenda:new Map([['Grimaldi',{fecha:'2026-11-23',ciclo:'2026-10-01'}]])});
assert.equal(a.porCliente.get('Grimaldi').dia,hoy);
assert.equal(S.diaCalculado(cliente('Futuro','2026-11-19',7)),'2026-11-26');
assert.equal(S.diaCalculado(cliente('Domingo','2026-11-15',7)),'2026-11-23');
a=S.agenda(calc,{agenda:new Map([['Baharat',{escrito:hoy}]])});
assert.equal(a.porCliente.get('Baharat').estado,'escribi');
console.log('OK: vence por frecuencia, atrasados hoy, movimiento manual, ciclo nuevo, futuro, domingo y espera.');

const pedidosEntrega=[
 {id:'e1',cliente:'Cliente prueba',fecha:'2026-11-10',fechaDespacho:'2026-11-12',estado:'Despachado',items:[]},
 {id:'e2',cliente:'Cliente prueba',fecha:'2026-11-19',fechaDespacho:'',estado:'Pendiente',items:[]},
 {id:'e3',cliente:'Cliente prueba',fecha:'2026-11-18',fechaDespacho:'2026-11-20',estado:'Cancelado',items:[]}
];
let ficha=S.calcular(pedidosEntrega,hoy).clientes[0];
assert.equal(ficha.ultimaCarga,'2026-11-19');assert.equal(ficha.ultimaEntrega,'2026-11-12');
ficha=S.calcular([pedidosEntrega[1]],hoy).clientes[0];assert.equal(ficha.ultimaEntrega,'');
console.log('OK: pedido reciente separado de última entrega, sin usar cancelados ni inventar fechas.');

// Fecha real corregida: el pedido pendiente se cargó hoy pero el cliente lo hizo ayer.
const ayer='2026-11-19',cargadoHoy={id:'fr1',cliente:'Cliente real',fecha:hoy,fechaPedido:ayer,fechaDespacho:'',estado:'Pendiente',items:[]};
const previo={id:'fr0',cliente:'Cliente real',fecha:'2026-11-12',fechaDespacho:'2026-11-12',estado:'Despachado',items:[]};
let real=S.calcular([previo,cargadoHoy],hoy);let fr=real.clientes[0];
assert.equal(fr.ultimo,ayer);assert.equal(fr.ultimaCarga,ayer);assert.equal(fr.intervalo,7);
assert.equal(S.agenda(real).porCliente.get(fr.clave).calculado,S.diaCalculado(fr));
assert.equal(S.diaCalculado(fr),'2026-11-26');   // ayer + 7 días (con la fecha de carga saldría el 28/11)
real=S.calcular([previo,{...cargadoHoy,fechaPedido:''}],hoy);fr=real.clientes[0];
assert.equal(fr.ultimo,hoy);assert.equal(S.diaCalculado(fr),'2026-11-28');   // (intervalo 8) sin corrección vale el día de carga
console.log('OK: la fecha real del pedido (fechaPedido) corrige último pedido y día de contacto.');

// ── Seguimiento v2: visibilidad por vendedor, día fijo por etiqueta, «siempre», contactos y alertas ──
const hoy2='2026-11-24';   // martes
const ped=(id,cliente,fecha,renglones=3,extra={})=>({id,cliente,fecha,fechaDespacho:fecha,estado:'Despachado',items:Array.from({length:renglones},(_,i)=>({prod:'Prod '+i,qty:1})),...extra});
const semanal=(cliente,fechas,renglones)=>fechas.map((f,i)=>ped(cliente+i,cliente,f,renglones));
const pedidosV2=[
 ...semanal('Almacén Norte',['2026-10-26','2026-11-02','2026-11-09','2026-11-16']),       // de Thiago; último 16/11: vence el 23/11
 ...semanal('Sauce Mercado',['2026-10-30','2026-11-06','2026-11-13']),                      // de Oscar; vence el viernes 20/11
 ...semanal('Santo Tomé Kiosco',['2026-10-26','2026-11-02','2026-11-09','2026-11-16','2026-11-23']),   // de Juan Marcos; pidió ayer lunes
 ...semanal('Sin Dueño',['2026-10-26','2026-11-02','2026-11-09','2026-11-16']),
];
const etq=(id,nombre,dia_semana=null,siempre=false)=>({id,nombre,dia_semana,siempre});
const martes=etq('e-mar','Sauce',2), jueves=etq('e-jue','Santo Tomé',4,true), miercoles=etq('e-mie','Costa',3,true);
const meta=new Map([['almacen norte',{vendedor:'Thiago'}],['sauce mercado',{vendedor:'oscar',etiquetas:[martes]}],['santo tome kiosco',{vendedor:'Juan Marcos',etiquetas:[jueves]}]]);
const todos=S.calcular(pedidosV2,hoy2,{meta});
assert.equal(todos.clientes.length,4);   // sin `usuario` no se filtra nada
assert.deepEqual(S.calcular(pedidosV2,hoy2,{meta,usuario:{nombre:'Thiago',ve_todo:false}}).clientes.map(c=>c.nombre),['Almacén Norte']);
assert.deepEqual(S.calcular(pedidosV2,hoy2,{meta,usuario:{nombre:' ÓSCAR ',ve_todo:false}}).clientes.map(c=>c.nombre),['Sauce Mercado']);   // sin tildes ni mayúsculas
for(const u of ['Juan Marcos','Joaquin'])assert.equal(S.calcular(pedidosV2,hoy2,{meta,usuario:{nombre:u,ve_todo:true}}).clientes.length,4);   // los clientes sin vendedor, solo para ve_todo
const sinMeta=S.calcular(pedidosV2,hoy2,{meta:new Map(),usuario:{nombre:'Thiago',ve_todo:false}});assert.equal(sinMeta.clientes.length,0);assert.equal(sinMeta.ocultos,4);
assert.equal(S.calcular(pedidosV2,hoy2,{meta,usuario:{nombre:'Thiago',ve_todo:false}}).ocultos,3);
console.log('OK: cada usuario ve solo sus clientes; ve_todo, todos.');
const jm = {nombre:'Juan Marcos',ve_todo:false,ve_sin_vendedor:true};
const metaGeneral = new Map(meta).set('sin dueno',{vendedor:null});
assert.deepEqual(S.calcular(pedidosV2,hoy2,{meta:metaGeneral,usuario:jm}).clientes.map(c=>c.nombre).sort(),['Santo Tomé Kiosco','Sin Dueño']);
assert.deepEqual(S.calcular(pedidosV2,hoy2,{meta,usuario:jm}).clientes.map(c=>c.nombre),['Santo Tomé Kiosco']);
assert.equal(S.calcular(pedidosV2,hoy2,{meta:new Map(),usuario:jm}).clientes.length,0);

// Día fijo: primer día de esa etiqueta desde el vencimiento; sin etiqueta rige la regla #27 (no se posterga al día habitual).
const sauce=todos.clientes.find(c=>c.nombre==='Sauce Mercado');
assert.equal(S.diaCalculado({...sauce,etiquetas:[]}),'2026-11-20');                       // vence el viernes 20: sin etiqueta no se corre
assert.equal(S.diaCalculado({...sauce,etiquetas:[etq('x','Sin día')]}),'2026-11-20');    // una etiqueta sin día fijo no cambia nada
assert.equal(S.diaCalculado(sauce),'2026-11-24');                                         // etiqueta de martes: el primer martes desde el 20/11
assert.equal(S.diaCalculado({...sauce,etiquetas:[martes,etq('l','Lunes',1)]}),'2026-11-23');   // dos con día: la más próxima
const tSauce=S.agenda(todos).porCliente.get('sauce mercado');assert.equal(tSauce.calculado,'2026-11-24');assert.equal(tSauce.dia,hoy2);
console.log('OK: día fijo por etiqueta (primer día desde el vencimiento) y regla #27 intacta sin etiqueta.');

// «Siempre» + día fijo: aparece cada semana ese día, aunque ya haya pedido
let ag=S.agenda(todos,{pedidos:pedidosV2});
const deKiosco=d=>ag.dias.find(x=>x.fecha===d).tarjetas.filter(t=>t.clave==='santo tome kiosco');
assert.deepEqual(deKiosco('2026-11-26').map(t=>[t.estado,!!t.recurrente]),[['pidio',true]]);        // pidió el lunes: el jueves igual figura, «Pidió»
assert.deepEqual(deKiosco('2026-12-03').map(t=>[t.estado,!!t.recurrente]),[['pendiente',false]]);   // la semana que viene, pendiente: su ciclo normal cae justo ese jueves (23/11 + 7 = 30/11 → primer jueves)
assert.deepEqual(S.agenda(S.calcular(pedidosV2,hoy2,{meta:new Map([['santo tome kiosco',{etiquetas:[etq('w','Lunes y siempre',1,true)]}]])}),{pedidos:pedidosV2}).dias.find(d=>d.fecha==='2026-11-30').tarjetas.filter(t=>t.clave==='santo tome kiosco').length,1);   // y una sola tarjeta por día
assert.equal(deKiosco('2026-11-23').length,1);                                                       // su tarjeta «Pidió» del lunes sigue
assert.equal(ag.dias.flatMap(d=>d.tarjetas).filter(t=>t.clave==='santo tome kiosco'&&!t.recurrente&&t.estado==='pendiente').length,1);   // y su ciclo normal sigue siendo una sola tarjeta
// sin día fijo, `siempre` no hace nada
const sinDia=S.calcular(pedidosV2,hoy2,{meta:new Map([['santo tome kiosco',{etiquetas:[etq('z','Siempre',null,true)]}]])});
assert.equal(S.agenda(sinDia,{pedidos:pedidosV2}).dias.flatMap(d=>d.tarjetas).filter(t=>t.recurrente).length,0);
// a quien se le escribió hoy y sigue esperando, la repetición del miércoles lo muestra «Esperando»
const conMie=S.calcular(pedidosV2,hoy2,{meta:new Map([['sauce mercado',{etiquetas:[miercoles]}]])});
ag=S.agenda(conMie,{agenda:new Map([['sauce mercado',{escrito:hoy2}]])});
assert.deepEqual(ag.dias.find(d=>d.fecha==='2026-11-25').tarjetas.filter(t=>t.clave==='sauce mercado').map(t=>t.estado),['escribi']);
console.log('OK: «siempre» con día fijo repite al cliente cada semana (con su estado) y sin día no tiene efecto.');

// Resultado de contacto: tiene stock con día (la base lo deja en seg_agenda) y no contestó
const base2=S.calcular(pedidosV2,hoy2,{meta:new Map([['almacen norte',{vendedor:'Thiago',contacto:{resultado:'tiene_stock',volver_el:'2026-12-01',creado_en:'2026-11-24T13:00:00Z'}}]])});
const norte=base2.clientes.find(c=>c.clave==='almacen norte');
ag=S.agenda(base2,{agenda:new Map([['almacen norte',{fecha:'2026-12-01',ciclo:norte.ultimo,escrito:null}]])});
assert.equal(ag.porCliente.get('almacen norte').dia,'2026-12-01');assert.equal(ag.porCliente.get('almacen norte').estado,'pendiente');assert.equal(ag.porCliente.get('almacen norte').contacto.resultado,'tiene_stock');
assert.equal(S.agenda(base2).porCliente.get('almacen norte').dia,hoy2);   // sin el movimiento guardado estaba atrasado: hoy
const noCont=S.calcular(pedidosV2,hoy2,{meta:new Map([['almacen norte',{contacto:{resultado:'no_contesto',creado_en:'2026-11-24T13:00:00Z'}}]])});
ag=S.agenda(noCont,{agenda:new Map([['almacen norte',{escrito:null}]])});
let tn=ag.porCliente.get('almacen norte');assert.equal(tn.estado,'pendiente');assert.equal(tn.reescribir,true);assert.equal(tn.noContesto,true);assert.equal(tn.dia,hoy2);
ag=S.agenda(noCont,{agenda:new Map([['almacen norte',{escrito:hoy2}]])});assert.equal(ag.porCliente.get('almacen norte').estado,'escribi');   // si se le vuelve a escribir, espera de nuevo
assert.equal(S.agenda(noCont,{agenda:new Map([['almacen norte',{escrito:null}]]),hoy:hoy2}).porCliente.get('almacen norte').escrito,'');
console.log('OK: «tiene stock» vuelve el día elegido y «no contestó» vuelve a pendiente con «Volver a escribir».');

// Alertas: solo con datos reales; «compra menos» exige renglones cargados en todos los pedidos comparados
const menos=[...semanal('Compra Menos',['2026-09-28','2026-10-05','2026-10-12','2026-10-19','2026-10-26','2026-11-02'],7),...semanal('Compra Menos',['2026-11-09','2026-11-16'],2).map(p=>({...p,id:'m'+p.id}))];
const sinItems=semanal('Sin Renglones',['2026-09-28','2026-10-05','2026-10-12','2026-10-19','2026-10-26','2026-11-02','2026-11-09','2026-11-16'],0);
const unica=[ped('u1','Unica Vieja','2026-11-01')];
const cM=S.calcular([...menos,...sinItems,...unica,...pedidosV2],hoy2);
assert.ok(cM.clientes.find(c=>c.nombre==='Compra Menos').compraMenos);assert.equal(cM.clientes.find(c=>c.nombre==='Sin Renglones').compraMenos,null);assert.equal(cM.clientes.find(c=>c.nombre==='Santo Tomé Kiosco').compraMenos,null);
const hoyLun='2026-11-23',agL=S.agenda(cM,{hoy:hoyLun,pedidos:[...menos,...sinItems,...unica,...pedidosV2],agenda:new Map([['almacen norte',{escrito:'2026-11-21'}]])});
const al=S.alertas(cM,agL,{hoy:hoyLun});
const tipos=n=>al.filter(a=>a.nombre===n).map(a=>a.tipo);
assert.ok(tipos('Compra Menos').includes('menos'));assert.ok(!tipos('Sin Renglones').includes('menos'));
assert.ok(tipos('Unica Vieja').includes('unica'));   // única compra de hace 23 días
assert.ok(tipos('Almacén Norte').includes('esperando'));   // le escribió el sábado 21: el lunes lleva 2 días corridos y sigue esperando (vuelve el martes)
for(const a of al)assert.ok(S.ALERTAS[a.tipo]&&a.nombre&&a.clave);
console.log('OK: alertas del panel (compra menos solo con datos).');

// Una reprogramación explícita manda sobre la alerta roja, incluso después de recargar.
for(const escenario of [noCont,todos]){
 const c=escenario.clientes.find(c=>c.clave==='almacen norte');
 for(const fecha of ['2026-11-25','2026-12-01']){
  const fila={fecha,ciclo:c.ultimo,escrito:escenario===todos?'2026-11-20':null};
  const t=S.agenda(escenario,{agenda:new Map([[c.clave,fila]])}).porCliente.get(c.clave);
  assert.equal(t.dia,fecha);assert.equal(t.reescribir,true);assert.equal(t.movido,true);
 }
 const vencido=S.agenda(escenario,{agenda:new Map([[c.clave,{fecha:'2026-11-23',ciclo:c.ultimo,escrito:escenario===todos?'2026-11-20':null}]])}).porCliente.get(c.clave);
 assert.equal(vencido.dia,hoy2);
}
console.log('OK: reprogramar alertas rojas respeta día/semana manual; vencidos regresan a hoy.');

// Etapa 1: el despacho y las reposiciones no alteran el ritmo comercial.
const compras=[
 {id:'c1',cliente:'Ritmo estable',fecha:'2026-11-05',fechaDespacho:'2026-11-07',estado:'Despachado',items:[{prod:'Pan',qty:1}]},
 {id:'c2',cliente:'Ritmo estable',fecha:'2026-11-12',fechaDespacho:'2026-11-18',estado:'Despachado',items:[{prod:'Pan',qty:1}]},
];
const repo={id:'rep',cliente:'Ritmo estable',fecha:'2026-11-19',fechaDespacho:'2026-11-20',estado:'Despachado',notas:'🔁 REPOSICIÓN — Faltó del pedido anterior',items:[{prod:'Pan',qty:1}]};
const motor=ps=>S.calcular(ps,'2026-11-20');
let etapa=motor(compras),ce=etapa.clientes[0];
assert.equal(ce.intervalo,7);assert.equal(ce.ultimo,'2026-11-12');assert.equal(ce.ultimaEntrega,'2026-11-18');
assert.deepEqual(ce.fechasRecientes.map(f=>f.fecha),['2026-11-05','2026-11-12']);
assert.equal(motor(compras.map(p=>({...p,fechaDespacho:''}))).clientes[0].intervalo,7);
etapa=motor([...compras,repo]);ce=etapa.clientes[0];
assert.equal(ce.n,2);assert.equal(ce.ultimo,'2026-11-12');assert.equal(ce.ultimaEntrega,'2026-11-20');assert.equal(ce.intervalo,7);
assert.deepEqual(ce.pedidoIds,['c1','c2']);
assert.equal(S.agenda(etapa,{pedidos:[...compras,repo]}).pidieron.size,0);
assert.equal(motor([repo]).clientes.length,0);
for(const ciclo of ['2026-11-12','2026-11-18','2026-11-20']){
 const ag=new Map([[ce.clave,{fecha:'2026-11-27',ciclo}]]);
 assert.equal(S.agenda(etapa,{agenda:ag}).porCliente.get(ce.clave).dia,'2026-11-27');
}
const compraNueva={...compras[1],id:'c3',fecha:'2026-11-21',fechaDespacho:'',estado:'Pendiente'};
const nuevo=S.calcular([...compras,repo,compraNueva],'2026-11-21');
assert.equal(S.agenda(nuevo,{agenda:new Map([[ce.clave,{fecha:'2026-11-27',ciclo:'2026-11-20'}]])}).porCliente.get(ce.clave).movido,false);
const decision={id:'dec',clave:ce.clave,tipo:'recuperacion',motivo:'otro',desde:'2026-11-18',pedidosConocidos:['c1','c2']};
assert.equal(S.calcular([...compras,repo],'2026-11-20',{decisiones:[decision]}).clientes[0].manual.tipo,'recuperacion');
assert.equal(S.ALERTAS.menos,'Pidió menos variedad');
console.log('OK: compras por fecha real, despacho independiente, reposiciones sin recompra, agenda anterior conservada y nuevo ciclo comercial.');
