/* Review registered customers against WhatsApp contacts, one customer at a time.
   16/10/2026 (pedido del usuario): un cliente puede tener varios números, y cualquier número se puede desvincular.
   Vista «Ya vinculados»: se busca el cliente, se ven sus números (cada uno con «Desvincular») y se agregan otros.
   Un número que ya es de OTRO cliente no se puede vincular: primero se lo desvincula de ese (lo frena también la base). */
(function(){
'use strict';
const R={mode:'review',active:true,deferred:false,busy:false,client:null,candidates:[],generation:0};
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const shortDate=value=>value?new Date(value+'T12:00:00').toLocaleDateString('es-AR'):'Sin pedidos';
const tel=n=>n?'+'+String(n).replace(/^\+/,''):'Sin teléfono';
function message(value,error=false){const e=$('wa-review-status');if(e){e.textContent=value;e.classList.toggle('wa-error',error);}}
function failure(error){message(error.code==='57014'?'La consulta tardó demasiado. Instalá el SQL de optimización de vínculos y volvé a intentar.':error.code==='PGRST202'?
 'Falta instalar el SQL de vinculación de clientes en Supabase.':/already linked to another/i.test(error.message||'')?
 'Ese número ya está vinculado a otro cliente. Desvinculalo primero desde ese cliente (Ya vinculados).':error.code==='42501'?
 'Tu cuenta no puede cambiar vínculos.':error.message || String(error),true);}
// En modo prueba (sandbox-whatsapp.js) las consultas se resuelven en memoria, sin tocar la red.
async function rpc(name,args){const {data,error}=await (window.WhatsAppPrueba || sb).rpc(name,args);if(error)throw error;return data;}
function shell(){
 const panel=$('wa-review-panel');if(!panel)return;
 panel.innerHTML='<div class="wa-review-top"><h3>Vincular clientes con WhatsApp</h3><button type="button" id="wa-review-close">Volver a conversaciones</button></div>'+
 '<p class="wa-help">Revisá el nombre, teléfono y último mensaje antes de confirmar. Un cliente puede tener varios números. Los pedidos y las conversaciones se conservan.</p>'+
 '<div class="wa-review-controls"><label for="wa-review-scope">Clientes a revisar</label><select id="wa-review-scope">'+
 '<option value="active">Activos sin vincular (pedidos en los últimos 150 días)</option><option value="all">Todos con pedidos, sin vincular</option><option value="deferred">Pospuestos</option>'+
 '<option value="linked">Ya vinculados: agregar o quitar números</option></select>'+
 '<button type="button" id="wa-review-auto">Vincular coincidencias exactas de activos</button></div>'+
 '<p id="wa-review-status" role="status" aria-live="polite"></p><div id="wa-review-current"></div>';
 $('wa-review-close').onclick=()=>{R.generation++;panel.hidden=true;$('wa-layout').hidden=false;window.WhatsAppUI?.refresh?.();};
 $('wa-review-scope').onchange=event=>{
  const v=event.target.value;
  R.mode=v==='linked'?'linked':'review';R.active=v==='active';R.deferred=v==='deferred';
  $('wa-review-auto').hidden=R.mode==='linked';message('');
  (R.mode==='linked'?loadLinked():load()).catch(failure);
 };
 $('wa-review-auto').onclick=()=>autoLink().catch(failure);
}
function buttonsBusy(value){R.busy=value;const panel=$('wa-review-panel');panel?.querySelectorAll('button,select').forEach(b=>b.disabled=value || b.dataset.locked==='true');}
function drawCandidates(){
 const container=$('wa-review-candidates');if(!container)return;
 const actual=R.client && R.client.nombre;
 container.innerHTML=R.candidates.map(c=>{
  const propio=!!c.linked_client_name && c.linked_client_name===actual, ajeno=!!c.linked_client_name && !propio;
  return '<article class="wa-review-candidate">'+
  '<div><b>'+esc(c.display_name || 'Sin nombre')+'</b><p>'+esc(c.phone_number || 'Sin teléfono')+'</p>'+
  '<p class="wa-help">'+esc(c.reason || 'Resultado de búsqueda: confirmar')+'</p>'+
  (c.last_content?'<p class="wa-review-preview">Último mensaje: '+esc(c.last_content.slice(0,180))+'</p>':'')+
  (propio?'<p class="wa-help">Ya es un número de este cliente</p>':ajeno?'<p class="wa-help">Ya vinculado a '+esc(c.linked_client_name)+'</p>':'')+'</div>'+
  '<button type="button" data-review-contact="'+esc(c.contact_key)+'" data-locked="'+(c.linked_client_name?'true':'false')+'" '+(c.linked_client_name?'disabled':'')+'>Vincular este número</button></article>';
 }).join('') ||
 '<p class="wa-empty">No hay coincidencias claras. Buscá por el nombre de la agenda o por teléfono'+(R.mode==='review'?', o dejalo pendiente':'')+'.</p>';
 container.querySelectorAll('[data-review-contact]').forEach(b=>b.onclick=()=>link(b.dataset.reviewContact).catch(failure));
}
// Buscador de otro contacto (por nombre o teléfono) para el cliente en pantalla.
function bindSearch(generation){
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
  drawCandidates();bindSearch(generation);
  $('wa-review-defer').onclick=()=>defer().catch(failure);
 }finally{if(generation===R.generation)buttonsBusy(false);}
}
// ── Ya vinculados: buscar el cliente ──
async function loadLinked(){
 const generation=++R.generation;
 R.client=null;R.candidates=[];
 $('wa-review-current').innerHTML='<label for="wa-linked-search">Buscar cliente</label>'+
  '<input id="wa-linked-search" type="search" autocomplete="off" placeholder="Nombre del cliente">'+
  '<div id="wa-linked-list" class="wa-linked-list"></div>';
 let timer;
 $('wa-linked-search').oninput=event=>{clearTimeout(timer);const q=event.target.value;timer=setTimeout(()=>searchLinked(q,generation).catch(failure),250);};
 await searchLinked('',generation);
}
async function searchLinked(query,generation){
 const data=await rpc('wa_linked_clients',{p_query:query});
 if(generation!==R.generation || ($('wa-linked-search')?.value||'')!==query)return;
 const list=$('wa-linked-list');if(!list)return;
 list.innerHTML=(data||[]).map(c=>'<button type="button" class="wa-linked-item" data-client="'+esc(c.nombre)+'"><span><b>'+esc(c.nombre)+'</b>'+
  '<small>'+Number(c.numeros)+' '+(Number(c.numeros)===1?'número':'números')+' · Último pedido: '+esc(shortDate(c.last_order))+'</small></span><span aria-hidden="true">›</span></button>').join('') ||
  '<p class="wa-empty">'+(query?'Ningún cliente vinculado coincide.':'Todavía no hay clientes vinculados.')+'</p>';
 list.querySelectorAll('[data-client]').forEach(b=>b.onclick=()=>openClient(b.dataset.client).catch(failure));
}
// ── Un cliente: sus números (con «Desvincular») y el buscador para agregar otro ──
async function openClient(nombre){
 const generation=++R.generation;
 buttonsBusy(true);
 try{
  const nums=await rpc('wa_contacts_page',{p_query:'',p_client:nombre,p_offset:0,p_limit:50});
  if(generation!==R.generation)return;
  R.client={nombre};R.candidates=[];
  $('wa-review-current').innerHTML='<button type="button" id="wa-linked-back" class="wa-linked-back">‹ Otros clientes</button>'+
   '<div class="wa-review-client"><span class="wa-help">Números de WhatsApp de este cliente</span><h3>'+esc(nombre)+'</h3></div>'+
   '<div class="wa-linked-nums">'+((nums||[]).map(c=>'<article class="wa-review-candidate">'+
    '<div><b>'+esc(c.display_name || 'Sin nombre')+'</b><p>'+esc(tel(c.phone_number))+'</p>'+
    (c.last_content?'<p class="wa-review-preview">Último mensaje: '+esc(String(c.last_content).slice(0,180))+'</p>':'')+'</div>'+
    '<button type="button" class="wa-desvincular" data-unlink="'+esc(c.contact_key)+'" data-tel="'+esc(tel(c.phone_number))+'">Desvincular</button></article>').join('') ||
    '<p class="wa-empty">Este cliente no tiene números vinculados.</p>')+'</div>'+
   '<label for="wa-review-search">Agregar otro número: buscá por nombre o teléfono</label>'+
   '<input id="wa-review-search" type="search" autocomplete="off" placeholder="Nombre o número de WhatsApp">'+
   '<div id="wa-review-candidates"></div>';
  $('wa-linked-back').onclick=()=>{$('wa-review-scope').value='linked';R.mode='linked';loadLinked().catch(failure);};
  $('wa-review-current').querySelectorAll('[data-unlink]').forEach(b=>b.onclick=()=>unlink(b.dataset.unlink,b.dataset.tel).catch(failure));
  bindSearch(generation);
 }finally{if(generation===R.generation)buttonsBusy(false);}
}
async function unlink(key,telefono){
 if(R.busy || !R.client)return;
 const nombre=R.client.nombre;
 if(!confirm('¿Desvincular '+telefono+' de '+nombre+'? La conversación y los pedidos se conservan; el número queda sin cliente.'))return;
 buttonsBusy(true);
 try{await rpc('wa_unlink_contact',{p_contact:key});message('Desvinculado: '+telefono+' ya no es de '+nombre+'.');}
 finally{buttonsBusy(false);}
 window.WhatsAppUI?.cargarVinculos?.(true);
 await openClient(nombre);
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
 window.WhatsAppUI?.cargarVinculos?.(true);
 if(R.mode==='linked'){await openClient(clientName);return;}
 await load();
 // Para sumarle otro número al que se acaba de vincular, sin buscarlo de nuevo.
 const st=$('wa-review-status');
 if(st){const b=document.createElement('button');b.type='button';b.className='wa-link';b.textContent='Agregar otro número a '+clientName;
  b.onclick=()=>{$('wa-review-scope').value='linked';R.mode='linked';$('wa-review-auto').hidden=true;openClient(clientName).catch(failure);};
  st.append(' ',b);}
}
async function defer(){
 if(R.busy || !R.client)return;
 buttonsBusy(true);
 try{await rpc('wa_defer_client_link',{p_client:R.client.nombre});message('Quedó en Pospuestos; podés volver a revisarlo.');}
 finally{buttonsBusy(false);}
 await load();
}
// open() = la revisión de siempre; open('Nombre') = directo a los números de ese cliente (desde la ficha del chat).
async function open(cliente){
 shell();$('wa-review-panel').hidden=false;$('wa-layout').hidden=true;
 if(cliente){
  R.mode='linked';$('wa-review-scope').value='linked';$('wa-review-auto').hidden=true;
  await openClient(cliente);return;
 }
 R.mode='review';R.active=true;R.deferred=false;$('wa-review-scope').value='active';
 // Loading the review is read-only. Exact linking runs from its explicit button.
 message('Revisá un cliente o tocá Vincular coincidencias exactas de activos.');
 await load();
}
if(!window.WhatsAppPrueba)sb.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT'){R.generation++;R.client=null;R.candidates=[];const panel=$('wa-review-panel');if(panel){panel.hidden=true;panel.innerHTML='';}}});
window.WhatsAppClientReview={open:cliente=>open(typeof cliente==='string'?cliente:null).catch(failure)};
})();
