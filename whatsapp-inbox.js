/* WhatsApp for Marcial. Credentials are held only by Supabase Edge Functions.
   Client association is explicit (Vincular clientes); profiles with similar names are never guessed.
   Rediseño (15/10/2026): tres columnas en PC (conversaciones | chat | ficha del cliente). La ficha usa el mismo cálculo que la pestaña
   Clientes (estado, avisos, últimos pedidos, lo que suele llevar y lo que dejó de llevar) y lo que se detecta en el chat (whatsapp-temas.js).
   El vínculo con un cliente ya no se edita acá: se hace en «Vincular clientes». Las notas siguen, más simples (sin fecha). */
(function(){
'use strict';
const E={permissions:null,contacts:[],selected:null,messages:[],notes:[],filtro:'todos',vista:'lista',
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
  api:realApi,
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
const avatar=(c,extra='')=>`<span class="wa-av wa-av--${tonoAvatar(c)} ${extra}" aria-hidden="true">${iniciales(c)}</span>`;
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

// Estado del cliente vinculado según Clientes (seguimiento). Sin pedir el historial: eso lo hace la ficha.
function segDe(c,opciones){const S=Seg();return S && c.linked_client_name?S.contexto(c.linked_client_name,opciones):null;}
const PARA_HOY=new Set(['atender','alta','semana','recuperacion','unica']);
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
    else if(a==='reintentar-seg'){Seg()?.pedirHistorial();drawFicha();}
  });
}
// En celular se ve una cosa por vez (lista → chat → ficha); en PC las tres columnas a la vez.
function mostrar(vista){E.vista=vista;const l=$('wa-layout');if(!l)return;l.dataset.vista=vista;$('wa-raiz').dataset.vista=vista;
  if(vista==='lista'){const b=document.querySelector(`#wa-contacts [data-wa-contact="${CSS.escape(E.selected||'')}"]`);b?.focus({preventScroll:true});}
  if(vista==='ficha')$('wa-ficha').scrollTop=0;
  requestAnimationFrame(sizeLayout);}

// ── Lista ──
const FILTROS=[['todos','Todos',''],['sinleer','Sin leer','ok'],['hoy','Para hoy','error'],['sinvincular','Sin vincular','gris']];
function pasa(c,f){
  if(f==='sinleer')return Number(c.unread_count)>0;
  if(f==='sinvincular')return !c.linked_client_name;
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
    const n=Number(c.unread_count)||0, sale=c.last_outbound_at && c.last_outbound_at===c.last_message_at;
    const sub=c.linked_client_name && c.display_name && c.display_name!==c.linked_client_name?c.display_name:formatoTel(c.phone_number);
    return `<button type="button" class="wa-contact${c.contact_key===E.selected?' on':''}${n?' wa-contact--nuevo':''}"
    data-wa-contact="${escape(c.contact_key)}" aria-current="${c.contact_key===E.selected}">
    ${avatar(c)}<span class="wa-c-cuerpo">
      <span class="wa-c-1"><span class="wa-c-nom">${escape(title(c))}</span><span class="wa-c-hora">${escape(cuando(c.last_message_at))}</span></span>
      <span class="wa-c-2"><span class="wa-preview">${sale?'<span class="wa-vos">Vos:</span> ':''}${escape(c.last_content || 'Foto, audio o archivo')}</span>${n?`<span class="wa-badge" aria-label="${n} sin leer">${n}</span>`:''}</span>
      <span class="wa-c-3">${pillCliente(c)}${sub?`<span class="wa-c-sub">${escape(sub)}</span>`:''}</span>
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
  E.listMore=data.length===100;renderContacts();
  const current=E.contacts.find(c=>c.contact_key===E.selected);if(current){E.selectedContact=current;drawCabecera();}
}

// ── Chat ──
function vacioThread(){return `<div class="wa-vacio">${ico('message-circle','ico')}<p><b>Elegí una conversación</b></p><p>A la derecha vas a ver sus pedidos, su seguimiento y lo que se habló.</p></div>`;}
function drawCabecera(){
  const c=contact(), cab=$('wa-chat-cab');if(!c || !cab)return;
  const sub=[formatoTel(c.phone_number),c.linked_client_name && c.display_name && c.display_name!==c.linked_client_name?'agenda: '+c.display_name:''].filter(Boolean).join(' · ');
  cab.innerHTML=`<button type="button" class="wa-icono-btn wa-solo-angosto" data-wa="volver" aria-label="Volver a conversaciones">${ico('arrow-left','ico')}</button>
    ${avatar(c,'wa-av--g')}<div class="wa-chat-t"><h3>${escape(title(c))}</h3><p>${escape(sub || 'Sin teléfono compartido')}</p></div>
    <div class="wa-chat-acc">${pillCliente(c)}
    <button type="button" class="wa-btn wa-btn--ficha wa-sin-ficha" data-wa="ficha">${ico('user')}Ficha</button>
    ${c.phone_number?`<a class="wa-btn wa-btn--wa" href="https://wa.me/${escape(c.phone_number)}" target="_blank" rel="noopener" title="Abrir en WhatsApp Business">${ico('arrow-up-right')}<span class="wa-txt-ancho">WhatsApp Business</span></a>`:''}</div>`;
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
const TIPOS={image:['Foto','eye'],audio:['Audio','message-circle'],voice:['Audio','message-circle'],video:['Video','eye'],document:['Archivo','file-text'],sticker:['Sticker','star'],location:['Ubicación','map-pin'],contacts:['Contacto','user'],reaction:['Reacción','star']};
const ESTADOS={accepted:['Aceptado','✓'],sent:['Enviado','✓'],delivered:['Entregado','✓✓'],read:['Leído','✓✓'],failed:['No entregado','!']};
// Resalta en el mensaje las palabras que nombran un producto del catálogo (mismo criterio que la ficha).
function resaltar(texto){
  const t=T(), cat=catalogo();if(!t || !cat.length || !texto)return escape(texto);
  const marcar=t.palabrasProducto(texto,cat);if(!marcar.size)return escape(texto);
  return String(texto).split(/(\s+)/).map(w=>{const n=t.raizDe(t.norm(w));return n && marcar.has(n)?`<mark class="wa-prod">${escape(w)}</mark>`:escape(w);}).join('');
}
function renderMessages(initial=false){
  const pane=$('wa-messages'), lista=$('wa-burbujas');if(!pane || !lista)return;
  const nearBottom=pane.scrollHeight-pane.scrollTop-pane.clientHeight<100, previousHeight=pane.scrollHeight;
  let ultimoDia='';
  lista.innerHTML=E.messages.map(m=>{
    const d=dia(m.occurred_at), sep=d!==ultimoDia?`<p class="wa-dia"><span>${escape(separador(m.occurred_at))}</span></p>`:'';ultimoDia=d;
    const tipo=m.message_type!=='text'?TIPOS[m.message_type] || [m.message_type,'file-text']:null;
    const st=m.direction==='outbound'?ESTADOS[m.message_status]:null;
    return sep+`<article class="wa-msg ${m.direction==='outbound'?'wa-out':'wa-in'}">
      ${tipo?`<span class="wa-adjunto">${ico(tipo[1],'ico-xs')}${escape(tipo[0])}</span>`:''}
      ${m.content?`<p>${m.direction==='inbound'?resaltar(m.content):escape(m.content)}</p>`:''}
      <span class="wa-msg-pie">${m.origin==='business_app'?'<span class="wa-origen">desde el celular</span>':''}<time>${escape(hora(m.occurred_at))}</time>${st?`<span class="wa-tilde${m.message_status==='read'?' wa-tilde--leido':''}${m.message_status==='failed'?' wa-tilde--error':''}" title="${escape(st[0])}" aria-label="${escape(st[0])}">${st[1]}</span>`:''}</span></article>`;
  }).join('') || '<p class="wa-empty">Todavía no hay mensajes guardados.</p>';
  $('wa-older').hidden=!E.messageMore;
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
const catalogo=()=>((typeof state!=='undefined' && state.products) || []).map(p=>p.n).filter(Boolean);
function drawFicha(){
  const f=$('wa-ficha');if(!f)return;
  const c=contact();
  if(!c){f.innerHTML=`<div class="wa-vacio wa-vacio--ficha">${ico('users','ico')}<p><b>Ficha del cliente</b></p><p>Pedidos, avisos del seguimiento y lo que se habló, en un solo lugar.</p></div>`;return;}
  f.innerHTML=`<button type="button" class="wa-volver-chat wa-sin-ficha" data-wa="chat">${ico('arrow-left')}Volver al chat</button>
    <div id="wa-f-datos"></div>
    <section class="wa-f-sec wa-f-notas" aria-labelledby="wa-notas-t"><h4 id="wa-notas-t">${ico('notebook-pen')}Notas</h4>
      <div id="wa-notes"></div>
      <form id="wa-note-form" class="wa-nota-form"><label for="wa-note" class="wa-sr">Nueva nota</label>
        <textarea id="wa-note" maxlength="4000" rows="2" required placeholder="Ej.: prefiere que le escribamos a la tarde"></textarea>
        <button type="submit" class="wa-btn wa-btn--prim">${ico('plus')}Agregar nota</button></form>
    </section>`;
  $('wa-note-form').onsubmit=guardarNota;
  E.fichaHtml='';drawFichaDatos();renderNotes();
}
function drawFichaDatos(){
  const box=$('wa-f-datos'), c=contact();if(!box || !c)return;
  const s=c.linked_client_name?segDe(c,{pedidos:4}):null;
  const html=c.linked_client_name?fichaCliente(c,s):fichaSinVincular(c);
  if(html===E.fichaHtml)return;   // la actualización periódica no mueve la ficha si no cambió nada
  E.fichaHtml=html;box.innerHTML=html;
}
function contactoTiles(c,s){
  const tiles=[];
  if(s && s.estado==='ok'){const k=s.c;
    tiles.push(`<div class="wa-tile wa-t-${s.insignia[2]}"><span class="wa-tile-k">Último pedido</span><b>${escape(diasN(k.dias))}</b><span class="wa-tile-s">${escape(corta(k.ultimo))}</span></div>`);
    tiles.push(`<div class="wa-tile wa-t-marca"><span class="wa-tile-k">${k.intervaloPropio?'Suele pedir':'Referencia'}</span><b>cada ${escape(String(Math.round(k.intervalo*10)/10).replace('.',','))} días</b><span class="wa-tile-s">${escape(k.n+' '+(k.n===1?'pedido':'pedidos'))}</span></div>`);
  }
  const quien=c.last_inbound_at && (!c.last_outbound_at || c.last_inbound_at>=c.last_outbound_at)?'te escribió':'le escribimos';
  tiles.push(`<div class="wa-tile wa-t-ok"><span class="wa-tile-k">Último contacto</span><b>${escape(cuandoLargo(c.last_message_at))}</b><span class="wa-tile-s">${escape(c.last_message_at?quien:'')}</span></div>`);
  return `<div class="wa-tiles">${tiles.join('')}</div>`;
}
function alertas(s){
  if(!s || s.estado!=='ok')return '';
  const k=s.c, out=[];
  const [t,i,tn]=s.insignia;
  if(!s.alDia || k.manual)out.push([tn,i,`<b>${escape(t)}:</b> ${escape(k.razon)}.`]);
  k.dejoDeTodos.forEach(d=>out.push(['aviso','trending-down',`<b>Dejó de llevar ${escape(d.nombre)}</b> <span class="wa-muted">(lo llevó ${d.veces} veces; la última hace ${d.hace} días)</span>`]));
  (k.cambiosProductos||[]).filter(x=>x.tipo==='alternativa').forEach(x=>out.push(['info','package',`<b>Compraba ${escape(x.de)}</b> y todavía no compró <b>${escape(x.a)}</b>: se le puede ofrecer.`]));
  if(k.manual && k.manual.nota)out.push(['gris','notebook-pen',`<b>Nota del seguimiento:</b> ${escape(k.manual.nota)}`]);
  if(k.observacion && Date.now()-new Date(k.observacion.fecha+'T12:00:00').getTime()<45*86400000)out.push(['gris','info',`<b>Observación del último pedido:</b> ${escape(k.observacion.texto)}`]);
  if(!out.length)out.push(['ok','circle-check','<b>Todo en orden:</b> está dentro de su ritmo de compra.']);
  return `<section class="wa-f-sec"><h4>${ico('bell')}Avisos</h4><ul class="wa-alertas">${out.map(([tono,icono,h])=>`<li class="wa-alerta wa-t-${tono}">${ico(icono)}<span>${h}</span></li>`).join('')}</ul></section>`;
}
function delChat(c,s){
  const t=T();if(!t)return '';
  const r=t.analizar(E.messages,catalogo(),s && s.estado==='ok'?s.c:null);
  if(!r.analizados)return `<section class="wa-f-sec"><h4>${ico('message-circle')}Del chat</h4><p class="wa-muted">El cliente no escribió en los últimos ${r.dias} días.</p></section>`;
  if(!r.productos.length && !r.temas.length)return `<section class="wa-f-sec"><h4>${ico('message-circle')}Del chat</h4><p class="wa-muted">Nada para destacar en sus mensajes de los últimos ${r.dias} días.</p></section>`;
  const REL={nuevo:['Nunca lo compró','marca'],dejo:['Lo había dejado','aviso'],lleva:['Ya lo lleva','ok']};
  const temas=r.temas.length?`<div class="wa-temas">${r.temas.map(x=>`<span class="wa-pill wa-t-${x.tono}" title="${escape('«'+x.frase+'» · '+cuandoLargo(x.ultima))}">${ico(x.icono,'ico-xs')}${escape(x.etiqueta)}</span>`).join('')}</div>`:'';
  const prods=r.productos.map(p=>`<li class="wa-interes">
      <div class="wa-interes-1">${ico('package')}<b>${escape(p.nombre)}</b>${p.relacion?pill(REL[p.relacion][0],REL[p.relacion][1]):''}</div>
      <p class="wa-cita">${p.pregunta?'Preguntó':'Lo nombró'} ${escape(cuandoLargo(p.ultima))}: «${escape(p.frase)}»</p></li>`).join('');
  return `<section class="wa-f-sec"><h4>${ico('message-circle')}Del chat</h4>${temas}${prods?`<ul class="wa-intereses">${prods}</ul>`:''}
    <p class="wa-nota-pie">Detectado en lo que escribió el cliente (últimos ${r.dias} días).</p></section>`;
}
const ESTADO_PEDIDO={Pendiente:'aviso',Despachado:'ok',Cancelado:'error','En preparación':'info'};
function pedidos(s){
  if(!s || s.estado!=='ok' || !s.pedidos || !s.pedidos.length)return '';
  const fmtQty=q=>String(Math.round(Number(q)*100)/100).replace('.',',');
  return `<section class="wa-f-sec"><h4>${ico('shopping-cart')}Últimos pedidos</h4><ul class="wa-pedidos">${s.pedidos.map(p=>{
    const items=(p.items||[]).map(it=>fmtQty(it.qty)+' × '+it.prod);
    return `<li class="wa-pedido"><div class="wa-pedido-1"><span class="wa-fecha">${escape(corta(p.fecha))}</span>${pill(p.estado||'—',ESTADO_PEDIDO[p.estado]||'gris')}<span class="wa-muted">${escape(items.length+' '+(items.length===1?'producto':'productos'))}</span></div>
      <p class="wa-pedido-items">${escape(items.slice(0,3).join(' · '))}${items.length>3?' <span class="wa-muted">y '+(items.length-3)+' más</span>':''}</p></li>`;}).join('')}</ul></section>`;
}
function suele(s){
  if(!s || s.estado!=='ok' || !s.c.lleva.length)return '';
  return `<section class="wa-f-sec"><h4>${ico('star')}Suele llevar</h4><div class="wa-temas">${s.c.lleva.map(n=>`<span class="wa-pill wa-t-marca">${escape(n)}</span>`).join('')}</div></section>`;
}
function fichaCliente(c,s){
  let seg='';
  if(!s || s.estado==='cargando')seg=`<p class="wa-cargando">${ico('refresh-cw')}Buscando sus pedidos y su seguimiento…</p>`;
  else if(s.estado==='error')seg=`<p class="wa-ventana wa-t-error">${ico('circle-alert')}No se pudo traer el historial de pedidos. <button type="button" class="wa-link" data-wa="reintentar-seg">Reintentar</button></p>`;
  else if(s.estado==='sinpedidos')seg=`<p class="wa-ventana wa-t-gris">${ico('info')}Todavía no tiene pedidos registrados con este nombre.</p>`;
  const verMas=s && s.estado==='ok'?`<button type="button" class="wa-btn wa-btn--bloque" data-wa="ver-cliente">${ico('users')}Ver ficha completa en Clientes${ico('arrow-right','ico-xs')}</button>`:'';
  return `<div class="wa-f-cab">${avatar(c,'wa-av--g')}<div><h3>${escape(c.linked_client_name)}</h3>${s && s.estado==='ok'?pill(s.insignia[0],s.insignia[2],s.insignia[1]):pill('Cliente','marca','user')}</div></div>
    ${contactoTiles(c,s)}${seg}${alertas(s)}${delChat(c,s)}${pedidos(s)}${suele(s)}${verMas}`;
}
function fichaSinVincular(c){
  return `<div class="wa-f-cab">${avatar(c,'wa-av--g')}<div><h3>${escape(title(c))}</h3>${pill('Sin vincular','gris','',' wa-pill--hueco')}</div></div>
    <div class="wa-sinvinc">${ico('user-plus','ico')}<div><p><b>Este número todavía no es un cliente de la app.</b></p>
    <p class="wa-muted">Vinculalo para ver acá sus pedidos, sus avisos y lo que suele llevar.</p>
    ${E.permissions?.manage?'<button type="button" class="wa-btn wa-btn--prim" data-wa="vincular">'+ico('user-plus')+'Vincular clientes</button>':''}</div></div>
    ${contactoTiles(c,null)}${delChat(c,null)}`;
}
function renderNotes(){
  const box=$('wa-notes');if(!box)return;
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
document.addEventListener('seg:actualizado',()=>{if(typeof activeTab!=='undefined' && activeTab==='whatsapp'){renderContacts();drawCabecera();drawFichaDatos();}});

async function selectContact(key){
  if(E.sendBusy){status('Esperá a que termine el envío antes de cambiar de contacto.',true);return;}
  if(E.selected && E.selected!==key && $('wa-draft')?.value.trim() && !confirm('Hay una respuesta sin enviar. ¿Cambiar de contacto y descartarla?'))return;
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
  $('wa-mas').hidden=!permissions.manage;
  $('wa-review-clients').hidden=!permissions.manage;
  status('');
  Seg()?.asegurar();   // pide el historial de Clientes (si hace falta) para los estados de la lista y la ficha
  await loadContacts();
  if(client && E.contacts.length===1)await selectContact(E.contacts[0].contact_key);
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
window.WhatsAppUI={refresh:()=>refresh().catch(handleError),open:()=>{const client=E.pendingClient || null;E.pendingClient=null;return open(client).catch(handleError);}};
})();
