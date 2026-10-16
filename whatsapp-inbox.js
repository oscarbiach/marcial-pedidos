/* WhatsApp for Marcial. Credentials are held only by Supabase Edge Functions.
   Client association is explicit (Vincular clientes); profiles with similar names are never guessed.
   Rediseño (15/10/2026): tres columnas en PC (conversaciones | chat | ficha del cliente). La ficha usa el mismo cálculo que la pestaña
   Clientes (estado, avisos, últimos pedidos, lo que suele llevar y lo que dejó de llevar) y lo que se detecta en el chat (whatsapp-temas.js).
   El vínculo con un cliente ya no se edita acá: se hace en «Vincular clientes». Las notas siguen, más simples (sin fecha). */
(function(){
'use strict';
const E={marcados:new Set(),permissions:null,contacts:[],selected:null,messages:[],notes:[],filtro:'todos',vista:'lista',
  query:'',client:null,listMore:false,messageMore:false,loading:false,generation:0,noteBusy:false,
  sendBusy:false,sendRequest:null,syncBusy:false,syncPaused:false,agendaBusy:false,namesBusy:false,namesPaused:false,namesCursor:null,namesCounts:{processed:0,named:0,matched:0,filled:0}};
const $=id=>document.getElementById(id);
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ico=(n,c)=>(window.mIco?mIco(n,c||'ico-sm'):'');
const errorText=e=>e?.message || String(e);
const T=()=>window.WhatsAppTemas;
const Seg=()=>(window.SegUI && SegUI.contexto?SegUI:null);
// Datos: Supabase y la función kapso-api. En modo prueba (sandbox-whatsapp.js) todo se resuelve en memoria, sin tocar la red.
const DB=window.WhatsAppPrueba || {
  rpc:(name,args)=>sb.rpc(name,args),
  notas:{listar:key=>sb.from('whatsapp_notes').select('id,body,follow_up_date,created_at').eq('contact_key',key).order('created_at',{ascending:false}).limit(100),
    agregar:(key,body)=>sb.from('whatsapp_notes').insert({contact_key:key,body})},
  vinculos:()=>sb.from('whatsapp_contacts').select('contact_key,linked_client_name,last_inbound_at,last_outbound_at').not('linked_client_name','is',null).limit(5000),
  recordatorios:()=>sb.from('whatsapp_notes').select('contact_key,body,created_at').like('body','Para el próximo pedido: %').order('created_at',{ascending:false}).limit(300),
  api:realApi,
  media:realMedia,
  // Chats marcados «no leído» a mano (columna marked_unread). Sin la columna instalada devuelve error y no se marca nada.
  marcados:()=>sb.from('whatsapp_contacts').select('contact_key').eq('marked_unread',true).limit(1000),
  // Fotos cargadas a mano (whatsapp-fotos.js); unos 10 KB cada una.
  fotos:()=>sb.from('whatsapp_contact_photos').select('contact_key,image').limit(2000),
};

// ── Fechas ──
const dia=d=>{const x=new Date(d);return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0');};
const hoyYmd=()=>dia(Date.now()), ayerYmd=()=>dia(Date.now()-86400000);
const hora=d=>new Date(d).toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const SEM=['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
function cuando(d){   // para la lista: 10:42 · Ayer · martes · 03/10
  if(!d)return '';const k=dia(d);
  if(k===hoyYmd())return hora(d);if(k===ayerYmd())return 'Ayer';
  const dias=(Date.now()-new Date(d).getTime())/86400000;
  return dias<6?SEM[new Date(d).getDay()]:new Date(d).toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit'});
}
function cuandoLargo(d){   // para la ficha: hoy 10:42 · ayer 18:03 · el martes · hace 12 días
  if(!d)return 'Sin registro';const k=dia(d);
  if(k===hoyYmd())return 'hoy '+hora(d);if(k===ayerYmd())return 'ayer '+hora(d);
  const dias=Math.floor((Date.now()-new Date(d).getTime())/86400000);
  return dias<6?'el '+SEM[new Date(d).getDay()]:'hace '+dias+' días';
}
function separador(d){const k=dia(d);if(k===hoyYmd())return 'Hoy';if(k===ayerYmd())return 'Ayer';
  const x=new Date(d);return SEM[x.getDay()][0].toUpperCase()+SEM[x.getDay()].slice(1)+' '+x.toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit'});}
const corta=ymd=>{if(!ymd)return '';const [y,m,d]=String(ymd).slice(0,10).split('-');return d+'/'+m;};
const diasN=n=>n===0?'hoy':n===1?'hace 1 día':'hace '+n+' días';

// ── Contactos ──
function status(text,isError=false){const p=$('wa-status');if(p){p.textContent=text;p.classList.toggle('wa-error',isError);p.hidden=!text;}}
function contact(){return E.contacts.find(c=>c.contact_key===E.selected) || E.selectedContact;}
function title(c){return c.linked_client_name || c.display_name || formatoTel(c.phone_number) || 'Contacto sin teléfono';}
function formatoTel(t){const s=String(t||'');const m=s.match(/^54(9)?(11|\d{3})(\d{3,4})(\d{4})$/);return m?'+54 '+(m[1]?'9 ':'')+m[2]+' '+m[3]+'-'+m[4]:(s?'+'+s:'');}
function iniciales(c){const n=(c.linked_client_name || c.display_name || '').replace(/[^\p{L}\p{N} ]/gu,' ').trim();
  if(!n)return ico('user','ico-sm');const p=n.split(/\s+/);return escape((p[0][0]+(p[1]?p[1][0]:'')).toUpperCase());}
function tonoAvatar(c){const s=c.linked_client_name || c.display_name || c.phone_number || c.contact_key;let h=0;for(const ch of String(s))h=(h*31+ch.charCodeAt(0))>>>0;return h%7;}
// Con foto cargada (Importar → Fotos de contactos) se ve la foto; si no, las iniciales sobre un color.
function avatar(c,extra=''){
  const foto=window.WhatsAppFotos && WhatsAppFotos.de(c.contact_key);
  return foto?`<span class="wa-av wa-av--foto ${extra}" aria-hidden="true"><img src="${escape(foto)}" alt=""></span>`
    :`<span class="wa-av wa-av--${tonoAvatar(c)} ${extra}" aria-hidden="true">${iniciales(c)}</span>`;
}
function handleError(error){status(/PGRST202|42P01|42883/.test(error.code || '')?
  'La conexión está preparada, pero falta instalar las funciones y tablas en Supabase.':errorText(error),true);}
async function realApi(body){
  const {data:{session}}=await sb.auth.getSession();
  if(!session)throw new Error('Volvé a ingresar con tu PIN.');
  const response=await fetch(SB_URL+'/functions/v1/kapso-api',{
    method:'POST',headers:{'Content-Type':'application/json','apikey':SB_ANON,
      'Authorization':'Bearer '+session.access_token},body:JSON.stringify(body)});
  const data=await response.json().catch(()=>({error:'Respuesta inválida del servidor.'}));
  if(!response.ok)throw Object.assign(new Error(data.error || 'No se pudo completar.'),{data});
  return data;
}
const api=body=>DB.api(body);
// Archivo de un mensaje (foto, audio, video, documento): lo trae kapso-api con la clave del servidor y lo devuelve como Blob.
async function realMedia(id){
  const {data:{session}}=await sb.auth.getSession();
  if(!session)throw new Error('Volvé a ingresar con tu PIN.');
  const r=await fetch(SB_URL+'/functions/v1/kapso-api',{method:'POST',headers:{'Content-Type':'application/json','apikey':SB_ANON,
    'Authorization':'Bearer '+session.access_token},body:JSON.stringify({action:'media',message_id:id})});
  if(!r.ok){const d=await r.json().catch(()=>({}));throw new Error(d.error || 'No se pudo traer el archivo.');}
  return r.blob();
}

// Estado del cliente vinculado según Clientes (seguimiento). Sin pedir el historial: eso lo hace la ficha.
function segDe(c,opciones){const S=Seg();return S && c.linked_client_name?S.contexto(c.linked_client_name,opciones):null;}
const PARA_HOY=new Set(['atender','alta','semana','recuperacion','unica']);
// Sin leer: tiene mensajes nuevos o alguien lo marcó «no leído» (clic derecho), como en WhatsApp Business. Solo en la app.
const sinLeer=c=>Number(c.unread_count)>0 || E.marcados.has(c.contact_key);
// «Espera respuesta»: el último mensaje es del cliente y nadie le contestó todavía (ni desde la app ni desde el celular).
// Si el chat ya se leyó, la marca dura como máximo 10 horas: pasado ese tiempo se da por atendido sin respuesta.
const ESPERA_LEIDO_MS=10*3600000;
function espera(c){
  if(!c.last_inbound_at || (c.last_outbound_at && c.last_inbound_at<=c.last_outbound_at))return null;
  const ms=Date.now()-new Date(c.last_inbound_at).getTime();
  return !sinLeer(c) && ms>ESPERA_LEIDO_MS?null:ms;
}
function pillEspera(c){
  const ms=espera(c);if(ms===null)return '';
  const min=Math.max(1,Math.round(ms/60000)), h=Math.floor(min/60), d=Math.floor(h/24);
  const t=d>=1?(d===1?'1 día':d+' días'):h>=1?h+' h':min+' min';
  return pill('Espera respuesta · '+t,min>=60?'error':'aviso','clock',' wa-pill--espera');
}
const pill=(texto,tono,icono,extra='')=>`<span class="wa-pill wa-t-${tono} ${extra}">${icono?ico(icono,'ico-xs'):''}${escape(texto)}</span>`;
function pillCliente(c){
  if(!c.linked_client_name)return pill('Sin vincular','gris','',' wa-pill--hueco');
  const s=segDe(c,{sinCargar:true});
  if(!s || s.estado!=='ok')return pill('Cliente','marca','user');
  const [t,i,tn]=s.insignia;return pill(t,tn,i);
}

// ── Estructura ──
function shell(){
  if($('wa-layout'))return;
  $('wa-raiz').innerHTML=`<div class="wa-top"><div class="wa-top-t"><h2>${ico('message-circle','ico')}WhatsApp</h2>
    <p>Cada conversación, con los pedidos y el seguimiento del cliente al lado.</p></div>
    <div class="wa-actions">
      <button type="button" id="wa-review-clients" class="wa-btn" hidden>${ico('user-plus')}Vincular clientes</button>
      <details class="wa-mas" id="wa-mas" hidden><summary class="wa-btn">${ico('download')}Importar${ico('chevron-down','ico-xs wa-chev')}</summary>
        <div class="wa-mas-menu">
          <button type="button" id="wa-sync">${ico('history')}<span><b>Historial de mensajes</b><small>Trae lo guardado en Kapso</small></span></button>
          <button type="button" id="wa-import-names">${ico('users')}<span><b>Nombres de Kapso</b><small>Completa los contactos sin nombre</small></span></button>
          <button type="button" id="wa-import-agenda">${ico('smartphone')}<span><b>Agenda del iPhone</b><small>Archivo .vcf exportado del celular</small></span></button>
          <button type="button" id="wa-fotos-abrir">${ico('image')}<span><b>Fotos de contactos</b><small>Subí o pegá una foto para reconocerlos</small></span></button>
          <div class="wa-mas-sep" role="separator"></div>
          <button type="button" id="wa-leer-todo" class="wa-mas-chico">${ico('check')}<span><b>Marcar todo como leído</b><small>Pone en cero los «sin leer» de todos los chats</small></span></button>
        </div></details>
      <button type="button" id="wa-refresh" class="wa-btn wa-btn--icono" aria-label="Actualizar conversaciones" title="Actualizar">${ico('refresh-cw')}</button>
      <input type="file" id="wa-agenda-file" accept=".vcf,text/vcard,text/x-vcard" hidden></div></div>
    <p id="wa-status" role="status" aria-live="polite" hidden></p>
    <div id="wa-client-filter" hidden></div>
    <section id="wa-review-panel" class="wa-review" hidden></section>
    <div id="wa-layout" class="wa-layout" data-vista="lista">
      <section class="wa-list" aria-label="Conversaciones">
        <label class="wa-buscar">${ico('search')}<input id="wa-search" type="search" autocomplete="off" placeholder="Buscar nombre, cliente o teléfono" aria-label="Buscar contacto, cliente o teléfono"></label>
        <div class="wa-filtros" id="wa-filtros" role="group" aria-label="Mostrar"></div>
        <div id="wa-contacts" class="wa-contacts"></div><button id="wa-more-contacts" class="wa-mas-contactos" type="button" hidden>Cargar más conversaciones</button>
      </section>
      <section id="wa-thread" class="wa-thread" aria-label="Conversación"></section>
      <aside id="wa-ficha" class="wa-ficha" aria-label="Ficha del cliente"></aside>
    </div>`;
  $('wa-refresh').addEventListener('click',()=>refresh().catch(handleError));
  $('wa-search').addEventListener('input',event=>{
    E.query=event.target.value;clearTimeout(E.searchTimer);
    E.searchTimer=setTimeout(()=>loadContacts().catch(handleError),250);
  });
  $('wa-more-contacts').addEventListener('click',()=>loadContacts(true).catch(handleError));
  $('wa-sync').addEventListener('click',()=>{$('wa-mas').open=false;importHistory();});
  $('wa-import-names').addEventListener('click',()=>{$('wa-mas').open=false;importNames();});
  $('wa-review-clients').addEventListener('click',()=>window.WhatsAppClientReview.open());
  $('wa-leer-todo').addEventListener('click',()=>{$('wa-mas').open=false;leerTodo().catch(handleError);});
  $('wa-fotos-abrir').addEventListener('click',()=>{$('wa-mas').open=false;window.WhatsAppFotos?.abrir(E.selectedContact);});
  $('wa-import-agenda').addEventListener('click',()=>{$('wa-mas').open=false;$('wa-agenda-file').value='';$('wa-agenda-file').click();});
  $('wa-agenda-file').addEventListener('change',event=>{const file=event.target.files?.[0];if(file)importAgenda(file).catch(handleError);});
  $('wa-contacts').addEventListener('click',event=>{
    const b=event.target.closest('[data-wa-contact]');if(b)selectContact(b.dataset.waContact).catch(handleError);
  });
  $('wa-filtros').addEventListener('click',event=>{
    const b=event.target.closest('[data-filtro]');if(!b)return;E.filtro=b.dataset.filtro;renderContacts();
  });
  $('wa-layout').addEventListener('click',event=>{
    const b=event.target.closest('[data-wa]');if(!b)return;
    const a=b.dataset.wa;
    if(a==='volver')mostrar('lista');
    else if(a==='ficha')mostrar('ficha');
    else if(a==='chat')mostrar('chat');
    else if(a==='ver-cliente' && contact())Seg()?.verCliente(contact().linked_client_name);
    else if(a==='vincular')window.WhatsAppClientReview.open();
    else if(a==='numeros' && contact())window.WhatsAppClientReview.open(contact().linked_client_name);
    else if(a==='reintentar-seg'){Seg()?.pedirHistorial();drawFicha();}
    else if(a==='cargar' && contact()?.linked_client_name)window.WhatsAppCarga?.abrir({cliente:contact().linked_client_name,productos:productosDelChat()});
    else if(a==='reclamo-pedido')reclamoEnPedido(b.dataset.id);
    else if(a==='reclamo-guardar')reclamoGuardar(b).catch(handleError);
  });
}
// En celular se ve una cosa por vez (lista → chat → ficha); en PC las tres columnas a la vez.
function mostrar(vista){E.vista=vista;const l=$('wa-layout');if(!l)return;l.dataset.vista=vista;$('wa-raiz').dataset.vista=vista;
  if(vista==='lista'){const b=document.querySelector(`#wa-contacts [data-wa-contact="${CSS.escape(E.selected||'')}"]`);b?.focus({preventScroll:true});}
  if(vista==='ficha')$('wa-ficha').scrollTop=0;
  requestAnimationFrame(sizeLayout);}

// ── Lista ──
const FILTROS=[['todos','Todos',''],['sinresp','Sin responder','error'],['sinleer','Sin leer','ok'],['hoy','Para hoy','aviso'],['sinvincular','Sin vincular','gris']];
function pasa(c,f){
  if(f==='sinleer')return sinLeer(c);
  if(f==='sinvincular')return !c.linked_client_name;
  if(f==='sinresp')return espera(c)!==null;
  if(f==='hoy'){const s=segDe(c,{sinCargar:true});return !!(s && s.estado==='ok' && (PARA_HOY.has(s.c.bloque) || s.pausaRevisar));}
  return true;
}
function renderFiltros(){
  $('wa-filtros').innerHTML=FILTROS.map(([k,t,tn])=>{const n=k==='todos'?0:E.contacts.filter(c=>pasa(c,k)).length;
    return `<button type="button" class="wa-chip${tn?' wa-chip--'+tn:''}" data-filtro="${k}" aria-pressed="${E.filtro===k}">${t}${n?`<span class="wa-chip-n">${n}</span>`:''}</button>`;}).join('');
}
function renderContacts(){
  if(!$('wa-contacts'))return;
  renderFiltros();
  const lista=E.contacts.filter(c=>pasa(c,E.filtro));
  $('wa-contacts').innerHTML=lista.map(c=>{
    const n=Number(c.unread_count)||0, marcado=!n && E.marcados.has(c.contact_key), sale=c.last_outbound_at && c.last_outbound_at===c.last_message_at;
    const sub=c.linked_client_name && c.display_name && c.display_name!==c.linked_client_name?c.display_name:formatoTel(c.phone_number);
    return `<button type="button" class="wa-contact${c.contact_key===E.selected?' on':''}${n || marcado?' wa-contact--nuevo':''}"
    data-wa-contact="${escape(c.contact_key)}" aria-current="${c.contact_key===E.selected}">
    ${avatar(c)}<span class="wa-c-cuerpo">
      <span class="wa-c-1"><span class="wa-c-nom">${escape(title(c))}</span><span class="wa-c-hora">${escape(cuando(c.last_message_at))}</span></span>
      <span class="wa-c-2"><span class="wa-preview">${sale?'<span class="wa-vos">Vos:</span> ':''}${escape(c.last_content || 'Foto, audio o archivo')}</span>${n?`<span class="wa-badge" aria-label="${n} sin leer">${n}</span>`:marcado?'<span class="wa-badge wa-badge--punto" role="img" aria-label="Marcado como no leído"></span>':''}</span>
      <span class="wa-c-3">${pillEspera(c)}${pillCliente(c)}${sub && espera(c)===null?`<span class="wa-c-sub">${escape(sub)}</span>`:''}</span>
    </span></button>`;}).join('') ||
    `<p class="wa-empty">${E.contacts.length?'No hay conversaciones con este filtro.':'No hay conversaciones en esta búsqueda. Si es la primera vez, importá el historial desde «Importar».'}</p>`;
  $('wa-more-contacts').hidden=!E.listMore;
}
async function loadContacts(append=false){
  const query=E.query, client=E.client, offset=append?E.contacts.length:0;
  const {data,error}=await DB.rpc('wa_contacts_page',{p_query:query,p_client:client,p_offset:offset,p_limit:100});
  if(error)throw error;
  if(query!==E.query || client!==E.client)return;
  E.contacts=append?E.contacts.concat(data.filter(c=>!E.contacts.some(x=>x.contact_key===c.contact_key))):data;
  E.listMore=data.length===100;
  // Las consultas de Supabase se pueden esperar pero no son promesas completas (no tienen .catch): se envuelven.
  const m=await Promise.resolve().then(()=>DB.marcados()).catch(()=>({error:true}));
  if(m && !m.error)E.marcados=new Set((m.data||[]).map(x=>x.contact_key));
  renderContacts();
  const current=E.contacts.find(c=>c.contact_key===E.selected);if(current){E.selectedContact=current;drawCabecera();}
}

// ── Chat ──
function vacioThread(){return `<div class="wa-vacio">${ico('message-circle','ico')}<p><b>Elegí una conversación</b></p><p>A la derecha vas a ver sus pedidos, su seguimiento y lo que se habló.</p></div>`;}
function drawCabecera(){
  const c=contact(), cab=$('wa-chat-cab');if(!c || !cab)return;
  const sub=[formatoTel(c.phone_number),c.linked_client_name && c.display_name && c.display_name!==c.linked_client_name?'agenda: '+c.display_name:''].filter(Boolean).join(' · ');
  cab.innerHTML=`<button type="button" class="wa-icono-btn wa-solo-angosto" data-wa="volver" aria-label="Volver a conversaciones">${ico('arrow-left','ico')}</button>
    ${avatar(c,'wa-av--g')}<div class="wa-chat-t"><h3>${escape(title(c))}</h3><p><span class="wa-chat-tel">${escape(sub || 'Sin teléfono compartido')}</span><span class="wa-cab-pills">${pillEspera(c)}${pillCliente(c)}</span></p></div>
    <div class="wa-chat-acc">
    ${c.linked_client_name?`<button type="button" class="wa-btn wa-btn--verde" data-wa="cargar" title="Cargar un pedido para ${escape(c.linked_client_name)}">${ico('shopping-cart')}<span class="wa-txt-ancho">Cargar pedido</span></button>`:''}
    <button type="button" class="wa-btn wa-btn--ficha wa-sin-ficha" data-wa="ficha">${ico('user')}Ficha</button>
    ${c.phone_number?`<a class="wa-btn wa-btn--wa" href="https://wa.me/${escape(c.phone_number)}" target="_blank" rel="noopener" title="Abrir en WhatsApp Business">${ico('arrow-up-right')}<span class="wa-txt-ancho">WhatsApp</span></a>`:''}</div>`;
}
function drawThread(){
  const c=contact();if(!c)return;
  $('wa-thread').innerHTML=`<div id="wa-chat-cab" class="wa-chat-cab"></div>
    <div id="wa-messages" class="wa-messages" role="log" aria-label="Mensajes de WhatsApp" aria-live="off">
      <button type="button" id="wa-older" class="wa-older" hidden>Ver mensajes anteriores</button><div id="wa-burbujas"><p class="wa-cargando">Cargando mensajes…</p></div></div>
    <form id="wa-compose" class="wa-compose"><p id="wa-ventana" class="wa-ventana" hidden></p>
      <div class="wa-compose-fila"><label for="wa-draft" class="wa-sr">Responder al cliente</label>
      <textarea id="wa-draft" maxlength="4096" rows="1" required placeholder="Escribí tu respuesta…"></textarea>
      <button type="submit" id="wa-send" class="wa-send" aria-label="Enviar por WhatsApp" title="Enviar por WhatsApp">${ico('arrow-right','ico')}</button></div>
      <p id="wa-send-help" class="wa-help"></p></form>`;
  drawCabecera();
  $('wa-older').onclick=()=>loadMessages(true).catch(handleError);
  $('wa-compose').onsubmit=event=>{event.preventDefault();send().catch(handleError);};
  $('wa-draft').addEventListener('keydown',event=>{if(event.key==='Enter' && (event.ctrlKey || event.metaKey)){event.preventDefault();$('wa-compose').requestSubmit();}});
  $('wa-draft').addEventListener('input',crecer);
  updateComposer();
  requestAnimationFrame(sizeLayout);
}
function crecer(){const t=$('wa-draft');if(!t)return;t.style.height='auto';t.style.height=Math.min(140,t.scrollHeight+2)+'px';}
function sizeLayout(){
  const l=$('wa-layout');if(!l || l.getClientRects().length===0)return;
  const viewport=window.visualViewport;
  const bottom=(viewport?.offsetTop || 0)+(viewport?.height || window.innerHeight);
  const nav=$('bottomNav');
  const navHeight=nav && getComputedStyle(nav).display!=='none'?nav.getBoundingClientRect().height:0;
  const top=Math.max(0,l.getBoundingClientRect().top);
  l.style.setProperty('--wa-alto',Math.max(360,bottom-top-navHeight-12)+'px');
}
window.addEventListener('resize',sizeLayout);
window.visualViewport?.addEventListener('resize',sizeLayout);
function updateComposer(){
  const c=contact();if(!c || !$('wa-send'))return;
  const within=!!c.last_inbound_at && Date.now()-new Date(c.last_inbound_at).getTime()<86400000;
  $('wa-send').disabled=(E.sendBusy && !E.sendRequest?.uncertain) || !within || !E.permissions?.send;
  $('wa-draft').disabled=E.sendBusy || !within || !E.permissions?.send;
  $('wa-send').classList.toggle('wa-send--consultar',!!E.sendRequest?.uncertain);
  $('wa-send').setAttribute('aria-label',E.sendRequest?.uncertain?'Consultar envío':'Enviar por WhatsApp');
  const v=$('wa-ventana');
  if(!E.permissions?.send){v.hidden=false;v.className='wa-ventana wa-t-gris';v.innerHTML=ico('lock')+'Tu cuenta puede leer, pero no responder desde acá.';}
  else if(!within){v.hidden=false;v.className='wa-ventana wa-t-aviso';v.innerHTML=ico('clock')+'Pasaron más de 24 horas desde su último mensaje: respondé desde WhatsApp Business.';}
  else v.hidden=true;
  $('wa-send-help').textContent=E.sendRequest?.uncertain?'El envío anterior no se confirmó. Tocá el botón para consultar antes de reenviar.':
    E.sendBusy?'Enviando…':'';
  $('wa-send-help').innerHTML+=!E.sendBusy && !E.sendRequest?.uncertain && within && E.permissions?.send?'<span class="wa-atajo">Ctrl + Enter para enviar</span>':'';
}
const TIPOS={image:['Foto','eye'],audio:['Audio','message-circle'],voice:['Audio','message-circle'],video:['Video','eye'],document:['Archivo','file-text'],sticker:['Sticker','star'],location:['Ubicación','map-pin'],contacts:['Contacto compartido','user'],order:['Pedido del catálogo','shopping-cart'],
  media_placeholder:['Foto, audio o archivo del historial','clock'],errors:['Mensaje que WhatsApp no deja ver acá','circle-alert'],unsupported:['Mensaje que WhatsApp no deja ver acá','circle-alert']};
const ESTADOS={accepted:['Aceptado','✓'],sent:['Enviado','✓'],delivered:['Entregado','✓✓'],read:['Leído','✓✓'],failed:['No entregado','!']};
// Resalta en el mensaje las palabras que nombran un producto del catálogo (mismo criterio que la ficha).
function resaltar(texto){
  const t=T(), cat=catalogo();if(!t || !cat.length || !texto)return escape(texto);
  const marcar=t.palabrasProducto(texto,cat);if(!marcar.size)return escape(texto);
  return String(texto).split(/(\s+)/).map(w=>{const n=t.raizDe(t.norm(w));return n && marcar.has(n)?`<mark class="wa-prod">${escape(w)}</mark>`:escape(w);}).join('');
}
// Ediciones, reacciones y mensajes borrados llegan como mensajes aparte que apuntan al original (raw_payload):
// se aplican sobre el original (texto nuevo + «Editado», emoji abajo, «Lo eliminó») y no se muestran sueltos si el original está en pantalla.
const cuerpoDe=m=>(m.raw_payload && m.raw_payload.message) || {};
function preparar(msgs){
  const ids=new Set(msgs.map(m=>m.whatsapp_message_id)), ed=new Map(), rx=new Map(), borrado=new Set(), ocultos=new Set();
  msgs.forEach(m=>{
    const c=cuerpoDe(m);
    if(m.message_type==='edit'){const o=c.edit && c.edit.original_message_id, txt=(c.edit && c.edit.message && c.edit.message.text && c.edit.message.text.body) || m.content;
      if(o && ids.has(o)){ed.set(o,txt);ocultos.add(m.whatsapp_message_id);}}
    else if(m.message_type==='reaction'){const o=c.reaction && c.reaction.message_id, e=c.reaction && c.reaction.emoji;
      if(o && ids.has(o)){const l=rx.get(o)||new Map();if(e)l.set(m.direction,e);else l.delete(m.direction);rx.set(o,l);ocultos.add(m.whatsapp_message_id);}}
    else if(m.message_type==='revoke'){const o=c.revoke && c.revoke.original_message_id;if(o && ids.has(o)){borrado.add(o);ocultos.add(m.whatsapp_message_id);}}
  });
  return {ed,rx,borrado,ocultos};
}
// Lo que se muestra de cada tipo de mensaje: etiqueta (ícono + texto) y texto (el del mensaje, el pie de la foto o el nombre del archivo).
function contenidoDe(m,prep){
  const c=cuerpoDe(m), x=c[m.message_type] || {};
  if(m.message_type==='edit')return {tag:['Editado','square-pen'],texto:(x.message && x.message.text && x.message.text.body) || m.content};
  if(m.message_type==='reaction')return {tag:null,texto:x.emoji?'Reaccionó '+x.emoji+' a un mensaje':'Sacó una reacción'};
  if(m.message_type==='revoke')return {tag:['Eliminó un mensaje','ban'],texto:''};
  if(m.message_type==='contacts'){const n=(c.contacts || []).map(k=>k.name && (k.name.formatted_name || k.name.first_name)).filter(Boolean).join(', ');return {tag:TIPOS.contacts,texto:n};}
  if(m.message_type==='location')return {tag:TIPOS.location,texto:[x.name,x.address].filter(Boolean).join(' · ')};
  if(m.message_type==='document')return {tag:TIPOS.document,texto:[x.filename,m.content].filter(Boolean).join(' — ')};
  const tag=m.message_type!=='text'?(TIPOS[m.message_type] || ['Mensaje','file-text']):null;
  return {tag,texto:prep.ed.has(m.whatsapp_message_id)?prep.ed.get(m.whatsapp_message_id):m.content};
}
// ── Fotos, audios, videos y archivos ──
// Las fotos se cargan solas al aparecer en pantalla; audio, video y archivos, al tocarlos. Lo ya traído queda en memoria
// mientras la app esté abierta (y en el servidor, guardado para siempre).
const MEDIA={url:new Map(),pend:new Map(),error:new Map()};
const TIENE_ARCHIVO=['image','audio','video','document','sticker'];
const mediaId=m=>{const x=cuerpoDe(m)[m.message_type];return TIENE_ARCHIVO.includes(m.message_type) && x && x.id?m.whatsapp_message_id:null;};
function archivo(m){
  const id=mediaId(m);if(!id)return '';
  const t=m.message_type, url=MEDIA.url.get(id), err=MEDIA.error.get(id), a=escape(id);
  if(err)return `<span class="wa-archivo wa-archivo--error">${ico('circle-alert','ico-xs')}${escape(err)}</span>`;
  if(url && (t==='image' || t==='sticker'))return `<button type="button" class="wa-foto${t==='sticker'?' wa-foto--sticker':''}" data-abrir="${a}" title="Ver más grande"><img src="${url}" alt="${t==='sticker'?'Sticker':'Foto'} del chat"></button>`;
  if(url && t==='audio')return `<audio class="wa-audio" controls preload="metadata" src="${url}"></audio>`;
  if(url && t==='video')return `<video class="wa-video" controls preload="metadata" src="${url}"></video>`;
  if(url && t==='document'){const n=(cuerpoDe(m).document || {}).filename || 'archivo';return `<a class="wa-archivo" href="${url}" download="${escape(n)}" target="_blank" rel="noopener">${ico('download','ico-xs')}Abrir ${escape(n)}</a>`;}
  const cargando=MEDIA.pend.has(id);
  const txt=cargando?'Trayendo…':t==='audio'?'Escuchar audio':t==='video'?'Ver video':t==='document'?'Abrir archivo':'Ver foto';
  const icono=t==='audio'?'message-circle':t==='document'?'file-text':'eye';
  return `<button type="button" class="wa-archivo${t==='image' || t==='sticker'?' wa-archivo--auto':''}" data-media="${a}"${cargando?' disabled':''}>${ico(icono,'ico-xs')}${escape(txt)}</button>`;
}
async function traerArchivo(id){
  if(MEDIA.url.has(id) || MEDIA.pend.has(id))return;
  const p=DB.media(id).then(blob=>{MEDIA.url.set(id,URL.createObjectURL(blob));MEDIA.error.delete(id);})
    .catch(e=>{MEDIA.error.set(id,errorText(e));}).finally(()=>{MEDIA.pend.delete(id);redibujarArchivo(id);});
  MEDIA.pend.set(id,p);redibujarArchivo(id);
  return p;
}
function redibujarArchivo(id){
  const art=document.querySelector(`#wa-burbujas [data-id="${CSS.escape(id)}"]`), m=E.messages.find(x=>x.whatsapp_message_id===id);
  if(!art || !m)return;
  const viejo=art.querySelector('.wa-archivo,.wa-foto,.wa-audio,.wa-video');if(!viejo)return;
  viejo.outerHTML=archivo(m);
  const a=art.querySelector('audio,video');if(a && MEDIA.url.has(id) && MEDIA.reproducir===id){MEDIA.reproducir=null;a.play().catch(()=>{});}
  observarFotos();
}
// Fotos: se piden al acercarse a la vista (como mucho 4 a la vez para no saturar).
let visor=null;
function observarFotos(){
  if(!('IntersectionObserver' in window))return;
  const raiz=$('wa-messages');if(!raiz)return;
  if(visor && visor.root!==raiz){visor.disconnect();visor=null;}   // el chat se redibujó: el vigilante tiene que mirar el nuevo
  if(!visor)visor=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){visor.unobserve(e.target);if(MEDIA.pend.size<4)traerArchivo(e.target.dataset.media);else setTimeout(()=>observarFotos(),800);}}),{root:raiz,rootMargin:'200px'});
  document.querySelectorAll('#wa-burbujas .wa-archivo--auto[data-media]:not([disabled])').forEach(b=>visor.observe(b));
}
document.addEventListener('click',event=>{
  const b=event.target.closest('#wa-burbujas [data-media]');
  if(b){MEDIA.reproducir=b.dataset.media;traerArchivo(b.dataset.media);return;}
  const f=event.target.closest('#wa-burbujas [data-abrir]');
  if(f){const u=MEDIA.url.get(f.dataset.abrir);if(u)window.open(u,'_blank','noopener');}
});
function renderMessages(initial=false){
  const pane=$('wa-messages'), lista=$('wa-burbujas');if(!pane || !lista)return;
  // La actualización cada 10 s no redibuja si no cambió nada (no corta un audio que se está escuchando).
  const firma=E.selected+'|'+E.messages.map(m=>m.whatsapp_message_id+':'+m.message_status+':'+(m.content||'').length).join(',');
  if(!initial && !E.prepending && firma===E.firmaMsgs)return;
  E.firmaMsgs=firma;
  const nearBottom=pane.scrollHeight-pane.scrollTop-pane.clientHeight<100, previousHeight=pane.scrollHeight;
  const prep=preparar(E.messages);
  let ultimoDia='';
  lista.innerHTML=E.messages.filter(m=>!prep.ocultos.has(m.whatsapp_message_id)).map(m=>{
    const d=dia(m.occurred_at), sep=d!==ultimoDia?`<p class="wa-dia"><span>${escape(separador(m.occurred_at))}</span></p>`:'';ultimoDia=d;
    const {tag,texto}=contenidoDe(m,prep), id=m.whatsapp_message_id;
    const editado=prep.ed.has(id), borrado=prep.borrado.has(id), reac=prep.rx.get(id);
    const st=m.direction==='outbound'?ESTADOS[m.message_status]:null;
    const sinArchivo=['image','audio','voice','video','document','sticker'].includes(m.message_type);
    return sep+`<article class="wa-msg ${m.direction==='outbound'?'wa-out':'wa-in'}${borrado?' wa-msg--borrado':''}${m.message_type==='reaction'?' wa-msg--reac':''}" data-id="${escape(id)}">
      ${borrado?`<span class="wa-adjunto wa-adjunto--borrado">${ico('ban','ico-xs')}Lo eliminó del chat</span>`:''}
      ${tag && !(sinArchivo && mediaId(m))?`<span class="wa-adjunto${m.message_type==='media_placeholder' || tag===TIPOS.errors?' wa-adjunto--gris':''}"${m.message_type==='media_placeholder'?' title="WhatsApp no comparte las fotos, audios ni archivos de los chats viejos importados"':''}>${ico(tag[1],'ico-xs')}${escape(tag[0])}</span>`:''}
      ${archivo(m)}
      ${texto?`<p>${m.direction==='inbound'?resaltar(texto):escape(texto)}</p>`:''}
      <span class="wa-msg-pie">${editado || m.message_type==='edit'?'<span class="wa-origen">editado</span>':''}${m.origin==='business_app'?'<span class="wa-origen">desde el celular</span>':''}<time>${escape(hora(m.occurred_at))}</time>${st?`<span class="wa-tilde${m.message_status==='read'?' wa-tilde--leido':''}${m.message_status==='failed'?' wa-tilde--error':''}" title="${escape(st[0])}" aria-label="${escape(st[0])}">${st[1]}</span>`:''}</span>
      ${reac && reac.size?`<span class="wa-reac" aria-label="Reacciones">${[...reac.values()].map(e=>escape(e)).join(' ')}</span>`:''}</article>`;
  }).join('') || '<p class="wa-empty">Todavía no hay mensajes guardados.</p>';
  $('wa-older').hidden=!E.messageMore;
  observarFotos();
  if(initial || nearBottom)pane.scrollTop=pane.scrollHeight;
  else if(E.prepending){pane.scrollTop+=pane.scrollHeight-previousHeight;E.prepending=false;}
}
async function loadMessages(older=false){
  const selected=E.selected, generation=E.generation;
  if(!selected)return;
  const first=older?E.messages[0]:null;
  const {data,error}=await DB.rpc('wa_messages_page',{p_contact:selected,p_before_time:first?.occurred_at || null,
    p_before_id:first?.whatsapp_message_id || null,p_limit:100});
  if(error)throw error;
  if(generation!==E.generation || selected!==E.selected)return;
  const map=new Map(E.messages.map(m=>[m.whatsapp_message_id,m]));for(const m of data)map.set(m.whatsapp_message_id,m);
  const antes=E.messages.length;
  E.messages=[...map.values()].sort((a,b)=>a.occurred_at.localeCompare(b.occurred_at) ||
    a.whatsapp_message_id.localeCompare(b.whatsapp_message_id));
  if(older || E.messages.length<=100)E.messageMore=data.length===100;
  E.prepending=older;renderMessages(!older && E.messages.length===data.length);
  if(E.messages.length!==antes)drawFichaDatos();   // lo detectado en el chat depende de los mensajes
  if(activeTab==='whatsapp' && !document.hidden){
    const {error:seenError}=await DB.rpc('wa_mark_seen',{p_contact:selected});if(seenError)throw seenError;
  }
}

// ── Ficha del cliente ──
// Todo en secciones desplegables, en este orden: Últimos pedidos, Avisos, Suele llevar, Ficha completa y Notas (pedido del usuario, 15/10).
// Lo abierto o cerrado se recuerda al pasar de un chat a otro. Arranca abierta solo «Últimos pedidos», que es lo principal.
const catalogo=()=>((typeof state!=='undefined' && state.products) || []).map(p=>p.n).filter(Boolean);
const normN=t=>(window.SegClientes?SegClientes.norm(t):String(t||'').trim().toLowerCase());
E.secs=new Set(['pedidos']);
function seccion(k,icono,titulo,n,cuerpo,tono){
  return `<details class="wa-sec" data-sec="${k}"${E.secs.has(k)?' open':''}><summary>${ico(icono)}<span class="wa-sec-t">${escape(titulo)}</span>
    ${n?`<span class="wa-sec-n${tono?' wa-t-'+tono:''}">${n}</span>`:''}${ico('chevron-down','ico-sm wa-chev')}</summary><div class="wa-sec-cuerpo">${cuerpo}</div></details>`;
}
document.addEventListener('toggle',event=>{const d=event.target;if(d.matches && d.matches('#wa-ficha details.wa-sec')){if(d.open)E.secs.add(d.dataset.sec);else E.secs.delete(d.dataset.sec);}},true);
function drawFicha(){
  const f=$('wa-ficha');if(!f)return;
  const c=contact();
  if(!c){f.innerHTML=`<div class="wa-vacio wa-vacio--ficha">${ico('users','ico')}<p><b>Ficha del cliente</b></p><p>Pedidos, avisos del seguimiento y lo que se habló, en un solo lugar.</p></div>`;return;}
  f.innerHTML=`<button type="button" class="wa-volver-chat wa-sin-ficha" data-wa="chat">${ico('arrow-left')}Volver al chat</button>
    <div id="wa-f-datos"></div>
    <details class="wa-sec" data-sec="notas"${E.secs.has('notas')?' open':''}><summary>${ico('notebook-pen')}<span class="wa-sec-t">Notas</span><span class="wa-sec-n" id="wa-notas-n" hidden></span>${ico('chevron-down','ico-sm wa-chev')}</summary>
      <div class="wa-sec-cuerpo"><div id="wa-notes"></div>
      <form id="wa-note-form" class="wa-nota-form"><label for="wa-note" class="wa-sr">Nueva nota</label>
        <textarea id="wa-note" maxlength="4000" rows="2" required placeholder="Ej.: prefiere que le escribamos a la tarde"></textarea>
        <button type="submit" class="wa-btn wa-btn--prim">${ico('plus')}Agregar nota</button></form></div>
    </details>`;
  $('wa-note-form').onsubmit=guardarNota;
  E.fichaHtml='';drawFichaDatos();renderNotes();
}
function drawFichaDatos(){
  const box=$('wa-f-datos'), c=contact();if(!box || !c)return;
  const s=c.linked_client_name?segDe(c,{pedidos:9999}):null;
  const html=c.linked_client_name?fichaCliente(c,s):fichaSinVincular(c);
  if(html===E.fichaHtml)return;   // la actualización periódica no mueve la ficha si no cambió nada
  E.fichaHtml=html;box.innerHTML=html;
}
const analisis=(s)=>{const t=T();return t?t.analizar(E.messages,catalogo(),s && s.estado==='ok'?s.c:null):null;};
const validos=s=>(s && s.estado==='ok' && s.pedidos?s.pedidos.filter(p=>p.estado!=='Cancelado'):[]);
const fmtQty=it=>(typeof itemLabelCorto==='function'?itemLabelCorto(it):String(Math.round(Number(it.qty)*100)/100).replace('.',','));
const ESTADO_PEDIDO={Pendiente:'aviso',Despachado:'ok',Cancelado:'error'};
function diaPedido(f){const x=new Date(String(f).slice(0,10)+'T12:00:00');return SEM[x.getDay()].slice(0,3)+' '+corta(f);}
// Últimos pedidos: un producto por renglón (cantidad | producto), igual que el historial de Cargar Pedido.
function secPedidos(s){
  const ps=(s && s.estado==='ok' && s.pedidos?s.pedidos:[]).slice(0,4);
  if(!ps.length)return seccion('pedidos','shopping-cart','Últimos pedidos',0,'<p class="wa-muted">Todavía no tiene pedidos.</p>');
  return seccion('pedidos','shopping-cart','Últimos pedidos',ps.length,ps.map(p=>{
    const dias=Math.max(0,Math.round((Date.now()-new Date(String(p.fecha).slice(0,10)+'T12:00:00').getTime())/86400000));
    return `<div class="wa-ped"><div class="wa-ped-cab"><b>${escape(diaPedido(p.fecha))}</b><span class="wa-muted">${escape(dias===0?'hoy':dias===1?'ayer':'hace '+dias+' días')}</span>${pill(p.estado||'—',ESTADO_PEDIDO[p.estado]||'gris')}</div>
      <div class="wa-ped-items">${(p.items||[]).map(it=>`<span class="wa-q">${escape(fmtQty(it))}</span><span class="wa-n">${escape(it.prod)}</span>`).join('')}</div></div>`;}).join(''));
}
// Reclamo detectado en el chat → que lo tenga en cuenta el reparto: en su pedido pendiente (se abre «Editar pedido» con la observación escrita)
// o, si no tiene, guardado para el próximo pedido (se ofrece al cargarlo, también desde Cargar Pedido).
function obsReclamo(tema){return `Reclamo por WhatsApp (${corta(dia(tema.ultima))}): «${tema.frase}»`;}
function accionReclamo(c,s,tema){
  if(!c.linked_client_name || !tema)return '';
  const obs=obsReclamo(tema), desde=dia(tema.ultima);
  const ps=validos(s), anotado=ps.find(p=>String(p.fecha).slice(0,10)>=desde && String(p.notas||'').includes(obs));
  if(anotado)return `<p class="wa-hecho">${ico('circle-check')}Anotado en su pedido del ${escape(corta(anotado.fecha))}.</p>`;
  const pend=((typeof state!=='undefined' && state.pedidos) || []).filter(p=>normN(p.cliente)===normN(c.linked_client_name) && p.estado==='Pendiente')
    .sort((a,b)=>String(b.fecha).localeCompare(String(a.fecha)))[0];
  if(pend)return `<button type="button" class="wa-btn wa-btn--chico" data-wa="reclamo-pedido" data-id="${escape(pend.id)}">${ico('square-pen')}Anotar en su pedido del ${escape(corta(pend.fecha))}</button>`;
  if(recordatoriosDe(c.linked_client_name).some(r=>r.obs===obs))return `<p class="wa-hecho">${ico('clock')}Guardado: se ofrece al cargar su próximo pedido.</p>`;
  return `<button type="button" class="wa-btn wa-btn--chico" data-wa="reclamo-guardar">${ico('pin')}Anotar para su próximo pedido</button>`;
}
function secAvisos(c,s){
  const out=[];let tono='';
  const r=analisis(s), reclamo=r && r.temas.find(t=>t.clave==='reclamo');
  if(reclamo){tono='error';out.push(['error','triangle-alert',`<b>Reclamo en el chat</b> <span class="wa-muted">(${escape(cuandoLargo(reclamo.ultima))})</span>: «${escape(reclamo.frase)}»${accionReclamo(c,s,reclamo)}`]);}
  if(s && s.estado==='ok'){
    const k=s.c, [t,i,tn]=s.insignia;
    if(!s.alDia || k.manual){out.push([tn,i,`<b>${escape(t)}:</b> ${escape(k.razon)}.`]);if(tn==='error')tono='error';}
    k.dejoDeTodos.forEach(d=>out.push(['aviso','trending-down',`<b>Dejó de llevar ${escape(d.nombre)}</b> <span class="wa-muted">(lo llevó ${d.veces} veces; la última hace ${d.hace} días)</span>`]));
    (k.cambiosProductos||[]).filter(x=>x.tipo==='alternativa').forEach(x=>out.push(['info','package',`<b>Compraba ${escape(x.de)}</b> y todavía no compró <b>${escape(x.a)}</b>: se le puede ofrecer.`]));
    if(k.manual && k.manual.nota)out.push(['gris','notebook-pen',`<b>Nota del seguimiento:</b> ${escape(k.manual.nota)}`]);
  }
  const REL={nuevo:['Nunca lo compró','marca'],dejo:['Lo había dejado','aviso'],lleva:['Ya lo lleva','ok']};
  const temas=r?r.temas.filter(x=>x.clave!=='reclamo'):[], prods=r?r.productos:[];
  const chat=(temas.length || prods.length)?`<div class="wa-chat-det"><p class="wa-sub">${ico('message-circle','ico-xs')}Del chat <span class="wa-muted">· lo que escribió el cliente, últimos ${r.dias} días</span></p>
    ${temas.length?`<div class="wa-temas">${temas.map(x=>`<span class="wa-pill wa-t-${x.tono}" title="${escape('«'+x.frase+'» · '+cuandoLargo(x.ultima))}">${ico(x.icono,'ico-xs')}${escape(x.etiqueta)}</span>`).join('')}</div>`:''}
    ${prods.map(p=>`<div class="wa-interes"><div class="wa-interes-1">${ico('package')}<b>${escape(p.nombre)}</b>${p.relacion?pill(REL[p.relacion][0],REL[p.relacion][1]):''}</div>
      <p class="wa-cita">${p.pregunta?'Preguntó':'Lo nombró'} ${escape(cuandoLargo(p.ultima))}: «${escape(p.frase)}»</p></div>`).join('')}</div>`:'';
  const n=out.length+prods.length+temas.length;
  if(!n)return seccion('avisos','bell','Avisos',0,'<p class="wa-muted">Sin avisos: está dentro de su ritmo y no hay nada para destacar en el chat.</p>');
  return seccion('avisos','bell','Avisos',n,`${out.length?`<ul class="wa-alertas">${out.map(([tn,ic,h])=>`<li class="wa-alerta wa-t-${tn}">${ico(ic)}<span>${h}</span></li>`).join('')}</ul>`:''}${chat}`,tono || (out.length?'aviso':'marca'));
}
// Suele llevar: el mismo cálculo que el historial de Cargar Pedido (cantidad más repetida y en cuántos pedidos aparece).
function secSuele(s){
  const ps=validos(s);
  const habs=typeof habitualesDe==='function' && ps.length>=2?habitualesDe(ps):[];
  if(!habs.length)return seccion('suele','star','Suele llevar',0,'<p class="wa-muted">Hacen falta al menos dos pedidos para saberlo.</p>');
  return seccion('suele','star','Suele llevar',habs.length,`<div class="wa-habs">${habs.map(h=>`<span class="wa-q">${escape(h.qty)}</span><span class="wa-n">${escape(h.prod)}</span><span class="wa-v">${h.veces}×</span>`).join('')}</div>`);
}
function secFicha(c,s){
  const tiles=[];
  if(s && s.estado==='ok'){const k=s.c;
    tiles.push(`<div class="wa-tile wa-t-${s.insignia[2]}"><span class="wa-tile-k">Último pedido</span><b>${escape(diasN(k.dias))}</b><span class="wa-tile-s">${escape(corta(k.ultimo))}</span></div>`);
    tiles.push(`<div class="wa-tile wa-t-marca"><span class="wa-tile-k">${k.intervaloPropio?'Suele pedir':'Referencia'}</span><b>cada ${escape(String(Math.round(k.intervalo*10)/10).replace('.',','))} días</b><span class="wa-tile-s">${escape(k.n+' '+(k.n===1?'pedido':'pedidos'))}</span></div>`);
  }
  const quien=c.last_inbound_at && (!c.last_outbound_at || c.last_inbound_at>=c.last_outbound_at)?'te escribió':'le escribimos';
  tiles.push(`<div class="wa-tile wa-t-ok"><span class="wa-tile-k">Último contacto</span><b>${escape(cuandoLargo(c.last_message_at))}</b><span class="wa-tile-s">${escape(c.last_message_at?quien:'')}</span></div>`);
  const ver=s && s.estado==='ok'?`<button type="button" class="wa-btn wa-btn--bloque" data-wa="ver-cliente">${ico('users')}Ver ficha completa en Clientes${ico('arrow-right','ico-xs')}</button>`:'';
  // Un cliente puede tener varios números: se agregan o se quitan en «Vincular clientes» (solo quien administra).
  const nums=c.linked_client_name && E.permissions?.manage?`<button type="button" class="wa-btn wa-btn--bloque" data-wa="numeros">${ico('smartphone')}Números de este cliente: agregar o quitar</button>`:'';
  return seccion('ficha','user','Ficha completa','',`<div class="wa-tiles">${tiles.join('')}</div>${ver}${nums}`);
}
function fichaCliente(c,s){
  let seg='', resumen='';
  if(!s || s.estado==='cargando')seg=`<p class="wa-cargando">${ico('refresh-cw')}Buscando sus pedidos y su seguimiento…</p>`;
  else if(s.estado==='error')seg=`<p class="wa-ventana wa-t-error">${ico('circle-alert')}No se pudo traer el historial de pedidos. <button type="button" class="wa-link" data-wa="reintentar-seg">Reintentar</button></p>`;
  else if(s.estado==='sinpedidos')seg=`<p class="wa-ventana wa-t-gris">${ico('info')}Todavía no tiene pedidos registrados con este nombre.</p>`;
  else{const k=s.c;resumen=`<p class="wa-f-res">Último pedido <b>${escape(diasN(k.dias))}</b> · pide cada <b>${escape(String(Math.round(k.intervalo*10)/10).replace('.',','))} días</b></p>`;}
  return `<div class="wa-f-cab">${avatar(c,'wa-av--g')}<div><h3>${escape(c.linked_client_name)}</h3>${s && s.estado==='ok'?pill(s.insignia[0],s.insignia[2],s.insignia[1]):pill('Cliente','marca','user')}</div></div>
    ${resumen}<button type="button" class="wa-btn wa-btn--verde wa-btn--bloque" data-wa="cargar">${ico('shopping-cart')}Cargar pedido</button>
    ${seg}${secPedidos(s)}${secAvisos(c,s)}${secSuele(s)}${secFicha(c,s)}`;
}
function fichaSinVincular(c){
  return `<div class="wa-f-cab">${avatar(c,'wa-av--g')}<div><h3>${escape(title(c))}</h3>${pill('Sin vincular','gris','',' wa-pill--hueco')}</div></div>
    <div class="wa-sinvinc">${ico('user-plus','ico')}<div><p><b>Este número todavía no es un cliente de la app.</b></p>
    <p class="wa-muted">Vinculalo para ver acá sus pedidos, sus avisos y lo que suele llevar.</p>
    ${E.permissions?.manage?'<button type="button" class="wa-btn wa-btn--prim" data-wa="vincular">'+ico('user-plus')+'Vincular clientes</button>':''}</div></div>
    ${secAvisos(c,null)}${secFicha(c,null)}`;
}
function renderNotes(){
  const box=$('wa-notes');if(!box)return;
  const n=$('wa-notas-n');if(n){n.textContent=E.notes.length||'';n.hidden=!E.notes.length;}
  box.innerHTML=E.notes.length?`<ul class="wa-notas">${E.notes.map(n=>`<li class="wa-nota"><p>${escape(n.body)}</p>
    <span class="wa-muted">${escape(cuandoLargo(n.created_at))}${n.follow_up_date?' · seguimiento: '+escape(corta(n.follow_up_date)):''}</span></li>`).join('')}</ul>`+
    (E.notes.length===100?'<p class="wa-nota-pie">Se muestran las últimas 100 notas.</p>':''):'';
}
async function loadNotes(){
  const selected=E.selected, generation=E.generation;
  const {data,error}=await DB.notas.listar(selected);
  if(error)throw error;
  if(generation!==E.generation)return;
  E.notes=data;renderNotes();
}
async function guardarNota(event){
  event.preventDefault();
  const c=contact(), field=$('wa-note'), value=field.value.trim();
  if(!c || !value || E.noteBusy)return;
  const button=event.target.querySelector('button');E.noteBusy=true;button.disabled=true;
  try{
    const {error}=await DB.notas.agregar(c.contact_key,value);
    if(error){handleError(error);return;}
    field.value='';await loadNotes();
  }finally{E.noteBusy=false;button.disabled=false;}
}
// Acciones de la ficha que necesitan datos (las de navegación están en shell)
async function reclamoGuardar(boton){
  const c=contact();if(!c || E.noteBusy)return;
  const r=analisis(segDe(c,{pedidos:9999})), tema=r && r.temas.find(t=>t.clave==='reclamo');if(!tema)return;
  E.noteBusy=true;boton.disabled=true;
  try{
    const {error}=await DB.notas.agregar(c.contact_key,PREFIJO_PROXIMO+obsReclamo(tema));
    if(error){handleError(error);return;}
    await Promise.all([loadNotes(),cargarVinculos(true)]);E.fichaHtml='';drawFichaDatos();
  }finally{E.noteBusy=false;boton.disabled=false;}
}
function reclamoEnPedido(id){
  const c=contact(), r=analisis(segDe(c,{pedidos:9999})), tema=r && r.temas.find(t=>t.clave==='reclamo');
  if(!tema || typeof openPedidoEdit!=='function')return;
  openPedidoEdit(id);
  const notas=$('p_notas'), obs=obsReclamo(tema);
  if(notas && !notas.value.includes(obs)){notas.value=(notas.value.trim()?notas.value.trim()+'\n':'')+obs;}
  if(typeof setExtrasOpen==='function')setExtrasOpen('p',true);
  notas?.focus();
}

// ── Clientes conectados con WhatsApp: a quién se le escribió y qué quedó anotado para el próximo pedido ──
// Una lectura liviana de los contactos vinculados (último mensaje enviado y recibido) y de las notas «Para el próximo pedido».
// La usan la pestaña Clientes («Le escribimos hoy» en Para hoy) y Cargar Pedido (lo anotado aparece al elegir el cliente).
const PREFIJO_PROXIMO='Para el próximo pedido: ';
const V={ts:0,cargando:null,porNombre:new Map(),recs:[]};
async function cargarVinculos(forzar){
  if(V.cargando)return V.cargando;
  if(!forzar && V.ts && Date.now()-V.ts<60000)return;
  V.cargando=(async()=>{
    try{
      const [a,b]=await Promise.all([DB.vinculos(),DB.recordatorios()]);
      if(a.error || b.error)return;   // sin acceso a WhatsApp: no se muestra nada, sin error
      const m=new Map(), clave=new Map();
      (a.data||[]).forEach(x=>{const k=normN(x.linked_client_name);clave.set(x.contact_key,k);
        const v=m.get(k)||{out:null,in:null};if(x.last_outbound_at && (!v.out || x.last_outbound_at>v.out))v.out=x.last_outbound_at;
        if(x.last_inbound_at && (!v.in || x.last_inbound_at>v.in))v.in=x.last_inbound_at;m.set(k,v);});
      V.porNombre=m;
      V.recs=(b.data||[]).filter(x=>clave.has(x.contact_key) && String(x.body).startsWith(PREFIJO_PROXIMO))
        .map(x=>({k:clave.get(x.contact_key),obs:String(x.body).slice(PREFIJO_PROXIMO.length),desde:dia(x.created_at),creado:x.created_at}));
      V.ts=Date.now();
      document.dispatchEvent(new CustomEvent('wa:vinculos'));
    }catch(e){/* sin conexión: se reintenta la próxima vez */}
    finally{V.cargando=null;}
  })();
  return V.cargando;
}
// Fecha del último mensaje que le mandamos, si fue después de su último pedido (ultimo = 'AAAA-MM-DD').
function contactado(nombre,ultimo){const v=V.porNombre.get(normN(nombre));return v && v.out && dia(v.out)>String(ultimo||'')?v.out:null;}
// Lo guardado «para el próximo pedido» que todavía no quedó en ningún pedido cargado desde ese día.
function recordatoriosDe(nombre){
  const k=normN(nombre);if(!k)return [];
  const peds=((typeof state!=='undefined' && state.pedidos)||[]).filter(p=>normN(p.cliente)===k && p.estado!=='Cancelado');
  const vistos=new Set();
  return V.recs.filter(r=>r.k===k && !vistos.has(r.obs) && vistos.add(r.obs) && !peds.some(p=>String(p.fecha).slice(0,10)>=r.desde && String(p.notas||'').includes(r.obs)));
}
// Productos nombrados en el chat abierto, con el nombre exacto del catálogo (el que el cliente compra, si lo compró).
function productosDelChat(){
  const c=contact();if(!c)return [];
  const s=segDe(c,{sinCargar:true}), r=analisis(s);if(!r)return [];
  const compra=new Set(s && s.estado==='ok'?s.c.productos.map(p=>normN(p.nombre)):[]);
  return r.productos.map(p=>{const n=p.nombres.find(x=>compra.has(normN(x))) || p.nombres.slice().sort((a,b)=>a.length-b.length)[0];return {prod:n,nombre:p.nombre,frase:p.frase};});
}
document.addEventListener('wa:vinculos',()=>{if(typeof activeTab!=='undefined' && activeTab==='whatsapp')drawFichaDatos();});
document.addEventListener('seg:actualizado',()=>{if(typeof activeTab!=='undefined' && activeTab==='whatsapp'){renderContacts();drawCabecera();drawFichaDatos();}});

// ── Clic derecho en un chat: «Marcar como no leído / leído (en la app)», que WhatsApp no se entera, y
// «Marcar como leído en WhatsApp», que avisa a WhatsApp (el cliente ve los tildes azules y Business lo muestra leído).
// «No leído en WhatsApp» no se ofrece: la API de WhatsApp no lo permite.
function cerrarMenuChat(){const m=$('wa-ctx');if(m)m.remove();}
function abrirMenuChat(event,boton){
  cerrarMenuChat();
  const key=boton.dataset.waContact, c=E.contacts.find(x=>x.contact_key===key);if(!c)return;
  const leido=!sinLeer(c);
  const opciones=[[leido?'no-leido':'leido',leido?'message-circle':'check',leido?'Marcar como no leído (en la app)':'Marcar como leído (en la app)']];
  if(E.permissions?.send && c.last_inbound_at)opciones.push(['leido-wa','check','Marcar como leído en WhatsApp']);
  const m=document.createElement('div');m.id='wa-ctx';m.className='wa-ctx';m.setAttribute('role','menu');
  m.innerHTML=opciones.map(([id,icono,texto])=>`<button type="button" role="menuitem" data-ctx="${id}">${ico(icono)}${texto}</button>`).join('');
  $('wa-raiz').appendChild(m);E.menuDesde=Date.now();
  // Con el mouse, donde se hizo clic; con teclado (tecla de menú o Shift+F10), debajo del chat.
  const r=boton.getBoundingClientRect(), x=event.clientX || r.left+24, y=event.clientY || r.top+r.height/2;
  const w=m.offsetWidth, h=m.offsetHeight;
  m.style.left=Math.min(x,innerWidth-w-8)+'px';m.style.top=Math.min(y,innerHeight-h-8)+'px';
  m.querySelector('button').focus();
  m.querySelectorAll('button').forEach(b=>b.onclick=()=>{
    cerrarMenuChat();
    (b.dataset.ctx==='leido-wa'?leidoEnWhatsApp(key):marcarChat(key,leido)).catch(handleError);
    boton.focus();
  });
  // Flechas para moverse entre opciones, como en un menú del sistema.
  m.addEventListener('keydown',e=>{
    if(e.key!=='ArrowDown' && e.key!=='ArrowUp')return;
    const bs=[...m.querySelectorAll('button')], k=bs.indexOf(document.activeElement);
    bs[(k+(e.key==='ArrowDown'?1:bs.length-1))%bs.length].focus();e.preventDefault();
  });
}
async function marcarChat(key,noLeido){
  if(E.marcando)return;E.marcando=true;
  try{
    const {error}=noLeido?await DB.rpc('wa_mark_unread',{p_contact:key,p_value:true}):await DB.rpc('wa_mark_seen',{p_contact:key});
    if(error){if(error.code==='PGRST202')throw new Error('Falta instalar «marcar como no leído» en Supabase.');throw error;}
    if(noLeido){
      E.marcados.add(key);
      // Igual que WhatsApp: el chat marcado se cierra (si quedara abierto, se volvería a marcar leído enseguida).
      if(E.selected===key){E.selected=null;E.selectedContact=null;E.generation++;E.messages=[];E.notes=[];$('wa-thread').innerHTML=vacioThread();drawFicha();mostrar('lista');}
    }else E.marcados.delete(key);
    await loadContacts();
  }finally{E.marcando=false;}
}
// Leído en WhatsApp y también en la app. Repetirlo es inofensivo; mientras está en curso no se puede volver a pedir.
async function leidoEnWhatsApp(key){
  if(E.marcando)return;E.marcando=true;
  try{
    status('Marcando como leído en WhatsApp…');
    await api({action:'mark_read',contact_key:key});
    const {error}=await DB.rpc('wa_mark_seen',{p_contact:key});if(error)throw error;
    E.marcados.delete(key);
    status('Listo: quedó leído en WhatsApp y en la app.');
    await loadContacts();
  }finally{E.marcando=false;}
}
document.addEventListener('contextmenu',event=>{
  const b=event.target.closest && event.target.closest('#wa-contacts [data-wa-contact]');
  if(!b){cerrarMenuChat();return;}
  event.preventDefault();abrirMenuChat(event,b);
});
document.addEventListener('pointerdown',event=>{if(!event.target.closest('#wa-ctx'))cerrarMenuChat();},true);
document.addEventListener('keydown',event=>{if(event.key==='Escape' && $('wa-ctx')){cerrarMenuChat();}});
window.addEventListener('resize',cerrarMenuChat);
// Un desplazamiento lo cierra, salvo el que hace el propio navegador al abrirlo (para mostrar el chat).
document.addEventListener('scroll',()=>{if(Date.now()-(E.menuDesde||0)>250)cerrarMenuChat();},true);
async function selectContact(key){
  if(E.sendBusy){status('Esperá a que termine el envío antes de cambiar de contacto.',true);return;}
  if(E.selected && E.selected!==key && $('wa-draft')?.value.trim() && !confirm('Hay una respuesta sin enviar. ¿Cambiar de contacto y descartarla?'))return;
  E.marcados.delete(key);
  E.selected=key;E.selectedContact=E.contacts.find(c=>c.contact_key===key);E.generation++;E.messages=[];E.notes=[];E.sendRequest=null;
  drawThread();drawFicha();renderContacts();mostrar('chat');
  await Promise.all([loadMessages(),loadNotes()]);
}
async function send(){
  if(E.sendBusy)return;
  const c=contact(),field=$('wa-draft'), content=field.value.trim();
  if(!c || !content)return;
  if(E.sendRequest?.uncertain){
    const prior=await api({action:'send_status',request_id:E.sendRequest.request_id});
    if(prior.state==='sent'){field.value='';crecer();E.sendRequest=null;status('El envío anterior fue confirmado.');updateComposer();await refresh();return;}
    if(prior.state==='missing'){E.sendRequest.uncertain=false;updateComposer();status('No hay un envío registrado. Volvé a tocar Enviar para intentar con el mismo identificador.');return;}
    status('El envío sigue sin confirmar. Revisá el Inbox antes de reenviar.',true);return;
  }
  if(!E.sendRequest || E.sendRequest.content!==content || E.sendRequest.contact_key!==c.contact_key)
    E.sendRequest={request_id:crypto.randomUUID(),content,contact_key:c.contact_key};
  E.sendBusy=true;updateComposer();
  try{
    const data=await api({action:'send',...E.sendRequest});
    field.value='';crecer();E.sendRequest=null;status(data.warning || '');
    await refresh().catch(handleError);
  }catch(error){
    if(E.sendRequest && (error.data?.state==='uncertain' || !error.data))E.sendRequest.uncertain=true;
    throw error;
  }finally{E.sendBusy=false;updateComposer();}
}
async function refresh(){
  if(!E.permissions?.read)return;
  const selected=E.selected;
  await loadContacts();
  if(E.selected===selected && selected){await loadMessages();updateComposer();drawFichaDatos();}
}
async function open(client=null){
  shell();$('wa-layout').hidden=false;$('wa-review-panel').hidden=true;E.client=client;E.query='';E.selected=null;E.selectedContact=null;E.contacts=[];E.messages=[];E.notes=[];E.generation++;
  $('wa-thread').innerHTML=vacioThread();drawFicha();mostrar('lista');
  renderContacts();$('wa-search').value='';
  const banner=$('wa-client-filter');banner.hidden=!client;
  banner.innerHTML=client?`${ico('funnel')}<span>Conversaciones de <b>${escape(client)}</b></span>
    <button id="wa-all" class="wa-btn" type="button">Ver todas</button>`:'';
  if(client)$('wa-all').onclick=()=>open(null).catch(handleError);
  E.permissions=null;
  const {data:permissions,error}=await DB.rpc('wa_permissions');
  if(error){handleError(error);return;}
  E.permissions=permissions;
  if(!permissions.read){status('Tu cuenta todavía no tiene acceso a WhatsApp. El administrador debe habilitarla en Supabase.',true);return;}
  $('wa-mas').hidden=false;
  ['wa-sync','wa-import-names','wa-import-agenda','wa-fotos-abrir'].forEach(id=>{$(id).hidden=!permissions.manage;});
  document.querySelector('#wa-mas .wa-mas-sep').hidden=!permissions.manage;
  $('wa-review-clients').hidden=!permissions.manage;
  status('');
  cargarVinculos();
  if(window.WhatsAppFotos){
    WhatsAppFotos.init({DB,titulo:title,avatar,aviso:t=>status(t),alCambiar:()=>{renderContacts();if(E.selectedContact){drawCabecera();drawFichaDatos();}}});
    WhatsAppFotos.cargar().then(()=>{renderContacts();if(E.selectedContact)drawCabecera();}).catch(()=>{});
  }
  Seg()?.asegurar();   // pide el historial de Clientes (si hace falta) para los estados de la lista y la ficha
  await loadContacts();
  if(client && E.contacts.length===1)await selectContact(E.contacts[0].contact_key);
}
// Marca como leídos todos los chats de una vez (con confirmación). Es lo mismo que abrir cada uno: no borra ni cambia mensajes.
async function leerTodo(){
  if(E.leyendoTodo)return;
  const n=E.contacts.filter(sinLeer).length;
  if(!confirm(n?`¿Marcar como leídos los ${n} chats con mensajes sin leer?`:'¿Marcar todos los chats como leídos?'))return;
  E.leyendoTodo=true;$('wa-leer-todo').disabled=true;
  try{
    const {data,error}=await DB.rpc('wa_mark_all_seen');
    if(error){if(error.code==='PGRST202')throw new Error('Falta instalar la función de «marcar todo como leído» en Supabase.');throw error;}
    E.marcados=new Set();await loadContacts();
    status(Number(data)?`Listo: ${Number(data)} ${Number(data)===1?'chat marcado':'chats marcados'} como leídos.`:'No había chats sin leer.');
  }finally{E.leyendoTodo=false;$('wa-leer-todo').disabled=false;}
}
async function importAgenda(file){
  if(E.agendaBusy || !E.permissions?.manage)return;
  if(file.size>10*1024*1024)throw new Error('La agenda debe pesar menos de 10 MB.');
  const parsed=window.WhatsAppAgenda.parse(await file.text());
  if(!parsed.contacts.length)throw new Error('No se encontraron nombres con teléfonos válidos y sin conflictos.');
  const phoneId=E.contacts[0]?.phone_number_id;
  if(!phoneId)throw new Error('Primero importá el historial para tener conversaciones a las que agregar nombres.');
  E.agendaBusy=true;$('wa-import-agenda').disabled=true;
  let filled=0,matched=0;
  try{
    for(let offset=0;offset<parsed.contacts.length;offset+=100){
      const {data,error}=await DB.rpc('wa_import_agenda_names',{
        p_phone_id:phoneId,p_contacts:parsed.contacts.slice(offset,offset+100)});
      if(error){
        if(error.code==='PGRST202')throw new Error('Falta instalar el SQL de importación de agenda en Supabase.');
        throw error;
      }
      filled+=Number(data.filled || 0);matched+=Number(data.matched || 0);
      status('Agenda: '+Math.min(offset+100,parsed.contacts.length)+' de '+parsed.contacts.length+' números revisados. '+filled+' nombres completados.');
    }
    await refresh();drawCabecera();
    status('Agenda importada: '+filled+' nombres completados; '+matched+' números coincidieron con conversaciones.'+
      (parsed.conflicts?' '+parsed.conflicts+' números con nombres distintos quedaron pendientes.':'')+
      (parsed.skipped?' '+parsed.skipped+' tarjetas sin nombre o teléfono válido se omitieron.':'')+
      ' Los nombres existentes se conservaron.');
  }finally{E.agendaBusy=false;$('wa-import-agenda').disabled=false;}
}
function rotulo(id,titulo){const b=$(id)?.querySelector('b');if(b)b.textContent=titulo;}
async function importNames(){
  if(E.namesBusy){E.namesPaused=true;status('La importación de nombres se pausará al terminar esta página.');return;}
  E.namesBusy=true;E.namesPaused=false;rotulo('wa-import-names','Pausar nombres');
  if(!E.namesCursor)E.namesCounts={processed:0,named:0,matched:0,filled:0};
  try{
    for(let page=0;page<50 && !E.namesPaused;page++){
      const data=await api({action:'sync_contacts',cursor:E.namesCursor});
      E.namesCursor=data.cursor || null;
      for(const key of ['processed','named','matched','filled'])E.namesCounts[key]+=Number(data[key] || 0);
      const c=E.namesCounts;
      status('Contactos revisados: '+c.processed+'. Nombres completados: '+c.filled+'.');
      if(data.done){
        status('Importación terminada: '+c.filled+' nombres completados de '+c.processed+' contactos revisados.'+
          (c.named===0?' Kapso no devolvió nombres; necesitaremos importar la agenda del celular.':' Los contactos sin nombre en Kapso siguen pendientes.'));
        break;
      }
      if(page===49)status('Nombres: importación pausada. Tocá Continuar nombres para seguir.');
    }
    await refresh();drawCabecera();
  }catch(error){handleError(error);}
  finally{E.namesBusy=false;rotulo('wa-import-names',E.namesCursor?'Continuar nombres':'Nombres de Kapso');}
}
async function importHistory(){
  if(E.syncBusy){E.syncPaused=true;status('La importación se pausará al terminar esta página.');return;}
  E.syncBusy=true;E.syncPaused=false;rotulo('wa-sync','Pausar importación');
  try{
    for(let page=0;page<50 && !E.syncPaused;page++){
      const data=await api({action:'sync'});
      status('Historial: '+data.run.processed+' mensajes procesados'+(data.run.state==='done'?'. Importación terminada.':'…'));
      if(data.run.state==='done')break;
      if(page===49)status('Importación pausada después de 50 páginas. Tocá Historial de mensajes para continuar desde donde quedó.');
    }
    await refresh();
  }catch(error){handleError(error);}finally{E.syncBusy=false;rotulo('wa-sync','Historial de mensajes');}
}
document.addEventListener('click',event=>{
  const b=event.target.closest('[data-wa-client]');
  if(b){E.pendingClient=b.dataset.waClient;setTab('whatsapp');}
  const m=$('wa-mas');if(m && m.open && !event.target.closest('#wa-mas'))m.open=false;
});
setInterval(()=>{if(typeof activeTab!=='undefined' && activeTab==='whatsapp' && !document.hidden &&
  !E.sendBusy && !E.loading && typeof state!=='undefined' && state.pin && $('appShell')?.style.display!=='none'){E.loading=true;refresh().catch(handleError).finally(()=>{E.loading=false;});}},10000);
if(!window.WhatsAppPrueba)sb.auth.onAuthStateChange(event=>{
  if(event==='SIGNED_OUT'){
    E.permissions=null;E.contacts=[];E.messages=[];E.notes=[];E.selected=null;E.selectedContact=null;E.generation++;
    if($('wa-contacts'))$('wa-contacts').innerHTML='';
    if($('wa-thread'))$('wa-thread').innerHTML='';
    if($('wa-ficha'))$('wa-ficha').innerHTML='';
  }
});
window.WhatsAppUI={cargarVinculos,contactado,recordatoriosDe,refresh:()=>refresh().catch(handleError),open:()=>{const client=E.pendingClient || null;E.pendingClient=null;return open(client).catch(handleError);}};
})();
