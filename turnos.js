/* Turno de entrega manual, compartido por Pedidos y Reparto. */
(function(){
 'use strict';
 const opciones=[['manana','Mañana'],['tarde','Tarde'],['','Sin turno']];
 const clave=p=>!p.retiro&&['manana','tarde'].includes(p.turno)?p.turno:'';
 const nombre=t=>opciones.find(([k])=>k===t)?.[1]||'Sin turno';
 const abiertos=new Map();
 const llave=(contexto,t)=>`${state.who}:${contexto}:${t}`;
 function plegar(summary){
  const grupo=summary.parentElement;
  abiertos.set(grupo.dataset.turnoClave,!grupo.open);
 }
 function grupos(lista,render,contexto){
  const retiros=lista.filter(p=>p.retiro);
  const entregas=lista.filter(p=>!p.retiro);
  return (retiros.length?`<section class="retiros-grupo">${entregas.length?'<h4 class="turno-titulo">Retiros</h4>':''}${retiros.map(render).join('')}</section>`:'')+opciones.map(([t,n])=>{
  const pedidos=entregas.filter(p=>clave(p)===t);
  if(!pedidos.length)return '';
  const titulo=`<span class="turno-nombre">${n}</span><span class="turno-cantidad">${pedidos.length}</span>`;
  if(!contexto)return `<section class="turno-grupo" data-turno="${t}"><h4 class="turno-titulo turno-${t||'sin'}">${titulo}</h4>${pedidos.map(render).join('')}</section>`;
  const key=llave(contexto,t);
  return `<details class="turno-grupo turno-plegable" data-turno="${t}" data-turno-clave="${esc(key)}" ${abiertos.get(key)?'open':''}><summary class="turno-titulo turno-${t||'sin'}" onclick="Turnos.plegar(this)">${titulo}</summary><div class="turno-contenido">${pedidos.map(render).join('')}</div></details>`;
 }).join('');}
 function selector(p,disabled=false){
  if(p.retiro)return '';
  return `<label class="turno-selector" onclick="event.stopPropagation()" onpointerdown="event.stopPropagation()" onmousedown="event.stopPropagation()">Turno <select aria-label="Turno de ${esc(p.cliente)}" data-turno-id="${esc(p.id)}" data-anterior="${clave(p)}" onchange="Turnos.cambiar(this)" ${disabled?'disabled':''}>${opciones.map(([t,n])=>`<option value="${t}" ${clave(p)===t?'selected':''}>${n}</option>`).join('')}</select></label>`;
 }
 async function cambiar(el){
  const id=el.dataset.turnoId,prev=el.dataset.anterior,next=el.value,who=state.who;
  if(next===prev)return;
  el.disabled=true;
  try{
   if(!navigator.onLine)throw new Error('Sin conexión. El turno no se cambió.');
   const {data,error}=await RepartoRed.pedir(sb.rpc('pedido_cambiar_turno',{p_id:id,p_turno:next,p_anterior:prev}));
   if(error)throw error;if(!data?.ok)throw new Error('No se pudo guardar el turno.');
   if(state.who!==who)return;
   const p=state.pedidos.find(p=>p.id===id);if(p)p.turno=next;
   el.dataset.anterior=next;renderPedidos();RepartoVivo.refrescar();
  }catch(e){if(state.who===who){el.value=prev;toast(e.message||'No se pudo guardar el turno.');RepartoVivo.refrescar();}}
  finally{el.disabled=false;}
 }
 function filtros(actual,attr){return `<div class="turno-filtros" role="group" aria-label="Filtrar por turno">${[['todos','Todos'],...opciones].map(([t,n])=>`<button type="button" ${attr}="${t}" aria-pressed="${actual===t}">${n}</button>`).join('')}</div>`;}
 function retiro(prefijo){
  const campo=document.getElementById(prefijo+'_turno');
  const activo=document.getElementById(prefijo+'_retiro').checked;
  campo.closest('.turno-campo').hidden=activo;campo.disabled=activo;
  if(activo)campo.value='';
 }
 window.Turnos={retiro,clave,nombre,grupos,selector,cambiar,filtros,plegar};
})();
