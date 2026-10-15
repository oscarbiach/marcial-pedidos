/* Review registered customers against WhatsApp contacts, one customer at a time. */
(function(){
'use strict';
const R={active:true,deferred:false,busy:false,client:null,candidates:[],generation:0};
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const shortDate=value=>value?new Date(value+'T12:00:00').toLocaleDateString('es-AR'):'Sin pedidos';
function message(value,error=false){const e=$('wa-review-status');if(e){e.textContent=value;e.classList.toggle('wa-error',error);}}
function failure(error){message(error.code==='57014'?'La consulta tardó demasiado. Instalá el SQL de optimización de vínculos y volvé a intentar.':error.code==='PGRST202'?
 'Falta instalar el SQL de vinculación de clientes en Supabase.':error.message || String(error),true);}
// En modo prueba (sandbox-whatsapp.js) las consultas se resuelven en memoria, sin tocar la red.
async function rpc(name,args){const {data,error}=await (window.WhatsAppPrueba || sb).rpc(name,args);if(error)throw error;return data;}
function shell(){
 const panel=$('wa-review-panel');if(!panel)return;
 panel.innerHTML='<div class="wa-review-top"><h3>Vincular clientes con WhatsApp</h3><button type="button" id="wa-review-close">Volver a conversaciones</button></div>'+
 '<p class="wa-help">Revisá el nombre, teléfono y último mensaje antes de confirmar. Los pedidos y las conversaciones se conservan.</p>'+
 '<div class="wa-review-controls"><label for="wa-review-scope">Clientes a revisar</label><select id="wa-review-scope">'+
 '<option value="active">Activos sin vincular (pedidos en los últimos 150 días)</option><option value="all">Todos con pedidos, sin vincular</option><option value="deferred">Pospuestos</option></select>'+
 '<button type="button" id="wa-review-auto">Vincular coincidencias exactas de activos</button></div>'+
 '<p id="wa-review-status" role="status" aria-live="polite"></p><div id="wa-review-current"></div>';
 $('wa-review-close').onclick=()=>{R.generation++;panel.hidden=true;$('wa-layout').hidden=false;window.WhatsAppUI?.refresh?.();};
 $('wa-review-scope').onchange=event=>{
  R.active=event.target.value==='active';R.deferred=event.target.value==='deferred';
  load().catch(failure);
 };
 $('wa-review-auto').onclick=()=>autoLink().catch(failure);
}
function buttonsBusy(value){R.busy=value;const panel=$('wa-review-panel');panel?.querySelectorAll('button,select').forEach(b=>b.disabled=value || b.dataset.locked==='true');}
function drawCandidates(){
 const container=$('wa-review-candidates');if(!container)return;
 container.innerHTML=R.candidates.map(c=>'<article class="wa-review-candidate">'+
 '<div><b>'+esc(c.display_name || 'Sin nombre')+'</b><p>'+esc(c.phone_number || 'Sin teléfono')+'</p>'+
 '<p class="wa-help">'+esc(c.reason || 'Resultado de búsqueda: confirmar')+'</p>'+
 (c.last_content?'<p class="wa-review-preview">Último mensaje: '+esc(c.last_content.slice(0,180))+'</p>':'')+
 (c.linked_client_name?'<p class="wa-help">Ya vinculado a '+esc(c.linked_client_name)+'</p>':'')+'</div>'+
 '<button type="button" data-review-contact="'+esc(c.contact_key)+'" data-locked="'+(c.linked_client_name?'true':'false')+'" '+(c.linked_client_name?'disabled':'')+'>Vincular este número</button></article>').join('') ||
 '<p class="wa-empty">No hay coincidencias claras. Buscá por el nombre de la agenda o por teléfono, o dejalo pendiente.</p>';
 container.querySelectorAll('[data-review-contact]').forEach(b=>b.onclick=()=>link(b.dataset.reviewContact).catch(failure));
}
async function load(){
 const generation=++R.generation;
 buttonsBusy(true);
 try{
  const data=await rpc('wa_client_link_review',{p_active_only:R.active,p_deferred:R.deferred});
  if(generation!==R.generation)return;
  R.client=data.client;R.candidates=data.suggestions || [];
  const pane=$('wa-review-current');
  if(!R.client){pane.innerHTML='<p class="wa-empty">No quedan clientes pendientes en esta vista.</p>';return;}
  const c=R.client;
  pane.innerHTML='<div class="wa-review-client"><span class="wa-help">'+Number(data.remaining)+' clientes pendientes en esta vista</span>'+
   '<h3>'+esc(c.nombre)+'</h3><p>'+esc(c.direccion || 'Sin dirección registrada')+'</p>'+
   '<p>'+Number(c.order_count)+' pedidos · Último pedido: '+esc(shortDate(c.last_order))+'</p>'+
   (c.registry_matches>1?'<p class="wa-help">Hay nombres similares en el registro. Este caso requiere confirmación manual.</p>':'')+'</div>'+
   '<label for="wa-review-search">Buscar otro contacto por nombre o teléfono</label>'+
   '<input id="wa-review-search" type="search" autocomplete="off" placeholder="Nombre o número de WhatsApp">'+
   '<div id="wa-review-candidates"></div><button type="button" id="wa-review-defer">Dejar pendiente y seguir</button>';
  drawCandidates();
  let timer;
  $('wa-review-search').oninput=event=>{
   clearTimeout(timer);const query=event.target.value;
   timer=setTimeout(async()=>{
    try{
     const contacts=await rpc('wa_contacts_page',{p_query:query,p_client:null,p_offset:0,p_limit:20});
     if(generation!==R.generation || $('wa-review-search')?.value!==query)return;
     R.candidates=contacts;drawCandidates();
    }catch(error){failure(error);}
   },250);
  };
  $('wa-review-defer').onclick=()=>defer().catch(failure);
 }finally{if(generation===R.generation)buttonsBusy(false);}
}
async function autoLink(){
 if(R.busy)return;
 buttonsBusy(true);
 try{
  const data=await rpc('wa_auto_link_exact',{p_active_only:true});
  message(Number(data.linked)+' clientes activos vinculados por coincidencia exacta y única. Revisá los restantes abajo.');
 }finally{buttonsBusy(false);}
 await load();
}
async function link(key){
 if(R.busy || !R.client)return;
 const clientName=R.client.nombre;
 buttonsBusy(true);
 try{
  await rpc('wa_review_client_link',{p_client:clientName,p_contact:key});
  message('Vinculado: '+clientName+'.');
 }finally{buttonsBusy(false);}
 await load();
}
async function defer(){
 if(R.busy || !R.client)return;
 buttonsBusy(true);
 try{await rpc('wa_defer_client_link',{p_client:R.client.nombre});message('Quedó en Pospuestos; podés volver a revisarlo.');}
 finally{buttonsBusy(false);}
 await load();
}
async function open(){
 shell();$('wa-review-panel').hidden=false;$('wa-layout').hidden=true;
 R.active=true;R.deferred=false;$('wa-review-scope').value='active';
 // Loading the review is read-only. Exact linking runs from its explicit button.
 message('Revisá un cliente o tocá Vincular coincidencias exactas de activos.');
 await load();
}
if(!window.WhatsAppPrueba)sb.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT'){R.generation++;R.client=null;R.candidates=[];const panel=$('wa-review-panel');if(panel){panel.hidden=true;panel.innerHTML='';}}});
window.WhatsAppClientReview={open:()=>open().catch(failure)};
})();
