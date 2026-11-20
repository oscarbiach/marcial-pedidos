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
