/* Turno de entrega manual, compartido por Pedidos y Reparto. */
(function(){
 'use strict';
 const opciones=[['manana','Mañana'],['tarde','Tarde'],['','Sin turno']];
 const clave=p=>['manana','tarde'].includes(p.turno)?p.turno:'';
 const nombre=t=>opciones.find(([k])=>k===t)?.[1]||'Sin turno';
 function grupos(lista,render){return opciones.map(([t,n])=>{
  const pedidos=lista.filter(p=>clave(p)===t);
  return pedidos.length?`<section class="turno-grupo" data-turno="${t}"><h4 class="turno-titulo turno-${t||'sin'}">${n}<span>${pedidos.length}</span></h4>${pedidos.map(render).join('')}</section>`:'';
 }).join('');}
 function selector(p,disabled=false){
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
 window.Turnos={clave,nombre,grupos,selector,cambiar,filtros};
})();
