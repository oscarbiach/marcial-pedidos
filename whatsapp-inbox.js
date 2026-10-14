/* WhatsApp for Marcial. Credentials are held only by Supabase Edge Functions.
   Client association is explicit; profiles with similar names are never guessed. */
(function(){
'use strict';
const E={permissions:null,contacts:[],clients:[],selected:null,messages:[],notes:[],
  query:'',client:null,listMore:false,messageMore:false,loading:false,generation:0,
  sendBusy:false,sendRequest:null,syncBusy:false,syncPaused:false,namesBusy:false,namesPaused:false,namesCursor:null,namesCounts:{processed:0,named:0,matched:0,filled:0}};
const $=id=>document.getElementById(id);
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=value=>value?new Date(value).toLocaleString('es-AR',{dateStyle:'short',timeStyle:'short'}):'Sin registro';
const errorText=e=>e?.message || String(e);
function status(text,isError=false){const p=$('wa-status');if(p){p.textContent=text;p.classList.toggle('wa-error',isError);}}
function contact(){return E.contacts.find(c=>c.contact_key===E.selected) || E.selectedContact;}
function title(c){return c.linked_client_name || c.display_name || c.phone_number || 'Contacto sin teléfono';}
function handleError(error){status(/PGRST202|42P01|42883/.test(error.code || '')?
  'La conexión está preparada, pero falta instalar las funciones y tablas en Supabase.':errorText(error),true);}
async function api(body){
  const {data:{session}}=await sb.auth.getSession();
  if(!session)throw new Error('Volvé a ingresar con tu PIN.');
  const response=await fetch(SB_URL+'/functions/v1/kapso-api',{
    method:'POST',headers:{'Content-Type':'application/json','apikey':SB_ANON,
      'Authorization':'Bearer '+session.access_token},body:JSON.stringify(body)});
  const data=await response.json().catch(()=>({error:'Respuesta inválida del servidor.'}));
  if(!response.ok)throw Object.assign(new Error(data.error || 'No se pudo completar.'),{data});
  return data;
}
function shell(){
  if($('wa-layout'))return;
  $('wa-raiz').innerHTML=`<div class="wa-top"><div><h2>Conversaciones con clientes</h2>
    <p>Historial automático de WhatsApp y contexto para el seguimiento.</p></div>
    <div class="wa-actions"><button type="button" id="wa-refresh">Actualizar</button>
    <button type="button" id="wa-sync" hidden>Importar historial</button><button type="button" id="wa-import-names" hidden>Importar nombres</button></div></div>
    <p id="wa-status" role="status" aria-live="polite"></p>
    <div id="wa-client-filter" hidden></div>
    <div id="wa-layout" class="wa-layout"><section class="wa-list" aria-label="Contactos">
      <label for="wa-search">Buscar contacto, cliente o teléfono</label><input id="wa-search" type="search" autocomplete="off">
      <div id="wa-contacts"></div><button id="wa-more-contacts" type="button" hidden>Cargar más contactos</button>
    </section><section id="wa-thread" class="wa-thread" aria-label="Conversación">
      <p class="wa-empty">Elegí un contacto para ver qué hablaron.</p>
    </section></div>`;
  $('wa-refresh').addEventListener('click',()=>refresh().catch(handleError));
  $('wa-search').addEventListener('input',event=>{
    E.query=event.target.value;clearTimeout(E.searchTimer);
    E.searchTimer=setTimeout(()=>loadContacts().catch(handleError),250);
  });
  $('wa-more-contacts').addEventListener('click',()=>loadContacts(true).catch(handleError));
  $('wa-sync').addEventListener('click',()=>importHistory());
  $('wa-import-names').addEventListener('click',()=>importNames());
  $('wa-contacts').addEventListener('click',event=>{
    const b=event.target.closest('[data-wa-contact]');if(b)selectContact(b.dataset.waContact).catch(handleError);
  });
}
function renderContacts(){
  $('wa-contacts').innerHTML=E.contacts.map(c=>`<button type="button" class="wa-contact ${c.contact_key===E.selected?'on':''}"
    data-wa-contact="${escape(c.contact_key)}" aria-pressed="${c.contact_key===E.selected}">
    <span class="wa-contact-name">${escape(title(c))}${Number(c.unread_count)>0?` <span class="wa-badge">${Number(c.unread_count)}</span>`:''}</span>
    <span>${escape(c.phone_number || c.business_scoped_user_id || 'Identidad de WhatsApp')}</span>
    <span class="wa-preview">${escape(c.last_content || 'Mensaje multimedia')}</span>
    <small>${escape(date(c.last_message_at))}${c.linked_client_name?'':' · Sin vincular'}</small></button>`).join('') ||
    '<p class="wa-empty">No hay conversaciones en esta búsqueda. Si es la primera vez, importá el historial disponible en Kapso.</p>';
  $('wa-more-contacts').hidden=!E.listMore;
}
async function loadContacts(append=false){
  const query=E.query, client=E.client, offset=append?E.contacts.length:0;
  const {data,error}=await sb.rpc('wa_contacts_page',{p_query:query,p_client:client,p_offset:offset,p_limit:100});
  if(error)throw error;
  if(query!==E.query || client!==E.client)return;
  E.contacts=append?E.contacts.concat(data.filter(c=>!E.contacts.some(x=>x.contact_key===c.contact_key))):data;
  E.listMore=data.length===100;renderContacts();
  const current=E.contacts.find(c=>c.contact_key===E.selected);if(current)E.selectedContact=current;
}
function drawThread(){
  const c=contact();if(!c)return;
  $('wa-layout').classList.add('wa-has-selection');
  $('wa-thread').innerHTML=`<button type="button" id="wa-back" class="wa-back">Volver a contactos</button>
    <div class="wa-thread-header"><h3>${escape(title(c))}</h3><p>${escape(c.phone_number || 'Sin teléfono compartido')}</p>
    <div class="wa-metrics"><span><b>${Number(c.inbound_count)}</b> recibidos</span><span><b>${Number(c.outbound_count)}</b> enviados</span>
    <span>Último contacto: ${escape(date(c.last_message_at))}</span></div></div>
    <details class="wa-context"><summary>Cliente asociado y notas de seguimiento</summary>
      <form id="wa-link-form"><label for="wa-client">Cliente de Marcial</label><input id="wa-client" list="wa-clients"
      autocomplete="off" value="${escape(c.linked_client_name || '')}" placeholder="Elegí el cliente exacto">
      <datalist id="wa-clients">${E.clients.map(n=>`<option value="${escape(n)}"></option>`).join('')}</datalist>
      <button type="submit">Guardar vínculo</button></form>
      <p class="wa-help">Se confirma una vez. Los mensajes siguientes quedan asociados automáticamente. Dejá el campo vacío para desvincular.</p>
      <div id="wa-notes"></div><form id="wa-note-form">
      <label for="wa-note">Contexto o pendiente</label><textarea id="wa-note" maxlength="4000" required placeholder="Ej.: pidió que lo contactemos el viernes"></textarea>
      <label for="wa-followup">Fecha de seguimiento (opcional)</label><input type="date" id="wa-followup">
      <button type="submit">Guardar nota</button></form>
    </details>
    <button type="button" id="wa-older" hidden>Cargar mensajes anteriores</button>
    <div id="wa-messages" class="wa-messages" role="log" aria-label="Mensajes de WhatsApp" aria-live="off"></div>
    <form id="wa-compose" class="wa-compose"><label for="wa-draft">Responder al cliente</label>
      <textarea id="wa-draft" maxlength="4096" required placeholder="Escribí tu respuesta"></textarea>
      <div><span id="wa-send-help" class="wa-help"></span><button type="submit" id="wa-send">Enviar por WhatsApp</button></div>
      ${c.phone_number?`<a href="https://wa.me/${escape(c.phone_number)}" target="_blank" rel="noopener">Abrir en WhatsApp Business</a>`:''}
    </form>`;
  $('wa-back').onclick=()=>{$('wa-layout').classList.remove('wa-has-selection');};
  $('wa-older').onclick=()=>loadMessages(true).catch(handleError);
  $('wa-link-form').onsubmit=async event=>{
    event.preventDefault();const name=$('wa-client').value.trim() || null;
    if(name && !E.clients.includes(name)){status('Elegí un cliente existente en la lista.',true);return;}
    const {error}=await sb.rpc('wa_link_client',{p_contact:c.contact_key,p_name:name});
    if(error){handleError(error);return;} c.linked_client_name=name;
    renderContacts();$('wa-thread').querySelector('h3').textContent=title(c);status('Contacto vinculado. Los próximos mensajes quedarán en esta ficha.');
  };
  $('wa-note-form').onsubmit=async event=>{
    event.preventDefault();const field=$('wa-note'), value=field.value.trim();
    if(!value)return;
    const button=event.target.querySelector('button');button.disabled=true;
    const {error}=await sb.from('whatsapp_notes').insert({contact_key:c.contact_key,body:value,
      follow_up_date:$('wa-followup').value || null});
    button.disabled=false;
    if(error){handleError(error);return;}field.value='';$('wa-followup').value='';await loadNotes();
  };
  $('wa-compose').onsubmit=event=>{event.preventDefault();send().catch(handleError);};
  updateComposer();
  requestAnimationFrame(sizeThread);
}
function sizeThread(){
  const thread=$('wa-thread');if(!thread || thread.getClientRects().length===0)return;
  const viewport=window.visualViewport;
  const bottom=(viewport?.offsetTop || 0)+(viewport?.height || window.innerHeight);
  const nav=$('bottomNav');
  const navHeight=nav && getComputedStyle(nav).display!=='none'?nav.getBoundingClientRect().height:0;
  const top=Math.max(0,thread.getBoundingClientRect().top);
  thread.style.setProperty('--wa-thread-height',Math.max(280,bottom-top-navHeight-16)+'px');
}
window.addEventListener('resize',sizeThread);
window.visualViewport?.addEventListener('resize',sizeThread);
function updateComposer(){
  const c=contact();if(!c || !$('wa-send'))return;
  const within=!!c.last_inbound_at && Date.now()-new Date(c.last_inbound_at).getTime()<86400000;
  $('wa-send').disabled=(E.sendBusy && !E.sendRequest?.uncertain) || !within || !E.permissions?.send;
  $('wa-draft').disabled=E.sendBusy || !within || !E.permissions?.send;
  $('wa-send').textContent=E.sendRequest?.uncertain?'Consultar envío':'Enviar por WhatsApp';
  $('wa-send-help').textContent=!E.permissions?.send?'Tu cuenta tiene acceso de lectura.':
    !within?'Pasaron 24 horas desde el mensaje del cliente. Respondé desde WhatsApp Business o usá una plantilla aprobada.':
    'Se enviará al número de este contacto.';
}
function renderMessages(initial=false){
  const pane=$('wa-messages');if(!pane)return;
  const nearBottom=pane.scrollHeight-pane.scrollTop-pane.clientHeight<100, previousHeight=pane.scrollHeight;
  const statuses={accepted:'Aceptado',sent:'Enviado',delivered:'Entregado',read:'Leído',failed:'No entregado',received:'Recibido'};
  pane.innerHTML=E.messages.map(m=>`<article class="wa-message ${m.direction==='outbound'?'wa-out':'wa-in'}">
    ${m.message_type!=='text'?`<small>${escape(m.message_type)}${m.origin==='business_app'?' · WhatsApp Business':''}</small>`:''}
    <p>${escape(m.content || '['+m.message_type+']')}</p>
    <small>${escape(date(m.occurred_at))} · ${escape(statuses[m.message_status] || m.message_status || '')}</small></article>`).join('') ||
    '<p class="wa-empty">Todavía no hay mensajes guardados.</p>';
  $('wa-older').hidden=!E.messageMore;
  if(initial || nearBottom)pane.scrollTop=pane.scrollHeight;
  else if(E.prepending){pane.scrollTop+=pane.scrollHeight-previousHeight;E.prepending=false;}
}
async function loadMessages(older=false){
  const selected=E.selected, generation=E.generation;
  if(!selected)return;
  const first=older?E.messages[0]:null;
  const {data,error}=await sb.rpc('wa_messages_page',{p_contact:selected,p_before_time:first?.occurred_at || null,
    p_before_id:first?.whatsapp_message_id || null,p_limit:100});
  if(error)throw error;
  if(generation!==E.generation || selected!==E.selected)return;
  const map=new Map(E.messages.map(m=>[m.whatsapp_message_id,m]));for(const m of data)map.set(m.whatsapp_message_id,m);
  E.messages=[...map.values()].sort((a,b)=>a.occurred_at.localeCompare(b.occurred_at) ||
    a.whatsapp_message_id.localeCompare(b.whatsapp_message_id));
  if(older || E.messages.length<=100)E.messageMore=data.length===100;
  E.prepending=older;renderMessages(!older && E.messages.length===data.length);
  if(activeTab==='whatsapp' && !document.hidden){
    const {error:seenError}=await sb.rpc('wa_mark_seen',{p_contact:selected});if(seenError)throw seenError;
  }
}
async function loadNotes(){
  const selected=E.selected, generation=E.generation;
  const {data,error}=await sb.from('whatsapp_notes').select('id,body,follow_up_date,created_at')
    .eq('contact_key',selected).order('created_at',{ascending:false}).limit(100);
  if(error)throw error;
  if(generation!==E.generation)return;
  E.notes=data;
  $('wa-notes').innerHTML=(data.length===100?'<p class="wa-help">Se muestran las últimas 100 notas.</p>':'')+data.map(n=>`<article class="wa-note"><p>${escape(n.body)}</p>
    <small>${escape(date(n.created_at))}${n.follow_up_date?' · Seguimiento: '+escape(n.follow_up_date):''}</small></article>`).join('');
}
async function selectContact(key){
  if(E.sendBusy){status('Esperá a que termine el envío antes de cambiar de contacto.',true);return;}
  if(E.selected && $('wa-draft')?.value.trim() && !confirm('Hay una respuesta sin enviar. ¿Cambiar de contacto y descartarla?'))return;
  E.selected=key;E.selectedContact=E.contacts.find(c=>c.contact_key===key);E.generation++;E.messages=[];E.sendRequest=null;
  drawThread();renderContacts();await Promise.all([loadMessages(),loadNotes()]);
}
async function send(){
  if(E.sendBusy)return;
  const c=contact(),field=$('wa-draft'), content=field.value.trim();
  if(!c || !content)return;
  if(E.sendRequest?.uncertain){
    const prior=await api({action:'send_status',request_id:E.sendRequest.request_id});
    if(prior.state==='sent'){field.value='';E.sendRequest=null;status('El envío anterior fue confirmado.');await refresh();return;}
    if(prior.state==='missing'){E.sendRequest.uncertain=false;status('No hay un envío registrado. Volvé a tocar Enviar para intentar con el mismo identificador.');return;}
    status('El envío sigue sin confirmar. Revisá el Inbox antes de reenviar.',true);return;
  }
  if(!E.sendRequest || E.sendRequest.content!==content || E.sendRequest.contact_key!==c.contact_key)
    E.sendRequest={request_id:crypto.randomUUID(),content,contact_key:c.contact_key};
  E.sendBusy=true;updateComposer();status('Enviando…');
  try{
    const data=await api({action:'send',...E.sendRequest});
    field.value='';E.sendRequest=null;status(data.warning || 'WhatsApp aceptó el mensaje.');
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
  if(E.selected===selected && selected){await loadMessages();updateComposer();}
}
async function readClients(){
  let names=[];
  for(let offset=0;;offset+=1000){
    const {data,error}=await sb.from('clientes').select('nombre').order('nombre').range(offset,offset+999);
    if(error)throw error;names=names.concat(data.map(c=>c.nombre));if(data.length<1000)return names;
  }
}
async function open(client=null){
  shell();E.client=client;E.query='';E.selected=null;E.selectedContact=null;E.contacts=[];E.generation++;
  $('wa-thread').innerHTML='<p class="wa-empty">Elegí un contacto para ver la conversación.</p>';
  $('wa-layout').classList.remove('wa-has-selection');renderContacts();$('wa-search').value='';
  const banner=$('wa-client-filter');banner.hidden=!client;
  banner.innerHTML=client?`<p>Conversaciones vinculadas a <b>${escape(client)}</b>.
    <button id="wa-all" type="button">Ver todos / vincular otro contacto</button></p>`:'';
  if(client)$('wa-all').onclick=()=>open(null).catch(handleError);
  E.permissions=null;
  const {data:permissions,error}=await sb.rpc('wa_permissions');
  if(error){handleError(error);return;}
  E.permissions=permissions;
  if(!permissions.read){status('Tu cuenta todavía no tiene acceso a WhatsApp. El administrador debe habilitarla en Supabase.',true);return;}
  E.clients=await readClients();
  $('wa-sync').hidden=!permissions.manage;
  $('wa-import-names').hidden=!permissions.manage;
  status('');await loadContacts();
  if(client && E.contacts.length===1)await selectContact(E.contacts[0].contact_key);
}
async function importNames(){
  if(E.namesBusy){E.namesPaused=true;status('La importación de nombres se pausará al terminar esta página.');return;}
  E.namesBusy=true;E.namesPaused=false;$('wa-import-names').textContent='Pausar nombres';
  if(!E.namesCursor)E.namesCounts={processed:0,named:0,matched:0,filled:0};
  let finished=false;
  try{
    for(let page=0;page<50 && !E.namesPaused;page++){
      const data=await api({action:'sync_contacts',cursor:E.namesCursor});
      E.namesCursor=data.cursor || null;
      for(const key of ['processed','named','matched','filled'])E.namesCounts[key]+=Number(data[key] || 0);
      const c=E.namesCounts;
      status('Contactos revisados: '+c.processed+'. Nombres completados: '+c.filled+'.');
      if(data.done){
        finished=true;
        status('Importación terminada: '+c.filled+' nombres completados de '+c.processed+' contactos revisados.'+
          (c.named===0?' Kapso no devolvió nombres; necesitaremos importar la agenda del celular.':' Los contactos sin nombre en Kapso siguen pendientes.'));
        break;
      }
      if(page===49)status('Nombres: importación pausada. Tocá Continuar nombres para seguir.');
    }
    await refresh();
    const selected=contact();if(selected && $('wa-thread').querySelector('h3'))
      $('wa-thread').querySelector('h3').textContent=title(selected);
  }catch(error){handleError(error);}
  finally{E.namesBusy=false;$('wa-import-names').textContent=E.namesCursor?'Continuar nombres':'Importar nombres';}
}
async function importHistory(){
  if(E.syncBusy){E.syncPaused=true;status('La importación se pausará al terminar esta página.');return;}
  E.syncBusy=true;E.syncPaused=false;$('wa-sync').textContent='Pausar importación';
  try{
    for(let page=0;page<50 && !E.syncPaused;page++){
      const data=await api({action:'sync'});
      status('Historial: '+data.run.processed+' mensajes procesados'+(data.run.state==='done'?'. Importación terminada.':'…'));
      if(data.run.state==='done')break;
      if(page===49)status('Importación pausada después de 50 páginas. Tocá Importar historial para continuar desde donde quedó.');
    }
    await refresh();
  }catch(error){handleError(error);}finally{E.syncBusy=false;$('wa-sync').textContent='Importar historial';}
}
document.addEventListener('click',event=>{
  const b=event.target.closest('[data-wa-client]');
  if(b){E.pendingClient=b.dataset.waClient;setTab('whatsapp');}
});
setInterval(()=>{if(typeof activeTab!=='undefined' && activeTab==='whatsapp' && !document.hidden &&
  !E.sendBusy && !E.loading && typeof state!=='undefined' && state.pin && $('appShell')?.style.display!=='none'){E.loading=true;refresh().catch(handleError).finally(()=>{E.loading=false;});}},10000);
sb.auth.onAuthStateChange(event=>{
  if(event==='SIGNED_OUT'){
    E.permissions=null;E.contacts=[];E.messages=[];E.notes=[];E.selected=null;E.selectedContact=null;E.generation++;
    if($('wa-contacts'))$('wa-contacts').innerHTML='';
    if($('wa-thread'))$('wa-thread').innerHTML='';
  }
});
window.WhatsAppUI={open:()=>{const client=E.pendingClient || null;E.pendingClient=null;return open(client).catch(handleError);}};
})();
