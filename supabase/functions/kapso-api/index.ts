import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { normalizeMessage, persistEvents } from "../_shared/whatsapp.js";

const headers={'Access-Control-Allow-Origin':'*',
 'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info',
 'Access-Control-Allow-Methods':'POST,OPTIONS','Content-Type':'application/json'};
function result(status,body){return new Response(JSON.stringify(body),{status,headers});}
async function provider(path, key, options={}){
  const response=await fetch('https://api.kapso.ai/'+path,{
    ...options,headers:{'X-API-Key':key,'Content-Type':'application/json'},
    signal:AbortSignal.timeout(15000)});
  const body=await response.json().catch(()=>({}));
  if(!response.ok){
    const error=new Error(body.error?.message || body.error || 'Kapso rejected the request');
    error.status=response.status; error.providerCode=body.error?.code;
    error.definite=response.status>=400 && response.status<500;
    throw error;
  }
  return body;
}
Deno.serve(async request=>{
  if(request.method==='OPTIONS')return result(200,{ok:true});
  if(request.method!=='POST')return result(405,{error:'POST only'});
  const authorization=request.headers.get('authorization') || '';
  if(!authorization.startsWith('Bearer '))return result(401,{error:'Volvé a ingresar con tu PIN.'});
  const url=Deno.env.get('SUPABASE_URL'), anon=Deno.env.get('SUPABASE_ANON_KEY');
  const userDb=createClient(url,anon,{global:{headers:{Authorization:authorization}},auth:{persistSession:false}});
  const {data:auth,error:authError}=await userDb.auth.getUser(authorization.slice(7));
  if(authError || !auth.user)return result(401,{error:'La sesión venció. Volvé a ingresar.'});
  const {data:permissions,error:permissionError}=await userDb.rpc('wa_permissions');
  if(permissionError || !permissions?.read)return result(403,{error:'Tu cuenta no tiene acceso a WhatsApp.'});
  let body;try{body=await request.json();}catch{return result(400,{error:'Solicitud inválida.'});}
  const key=Deno.env.get('KAPSO_API_KEY'),phoneId=Deno.env.get('KAPSO_PHONE_NUMBER_ID');
  if(!key || !phoneId)return result(503,{error:'Falta configurar Kapso en Supabase.'});
  const db=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false}});
  const base='meta/whatsapp/v24.0/'+phoneId;
  try{
    if(body.action==='mark_read'){
      // «Marcar como leído en WhatsApp»: avisa a WhatsApp que se leyó el último mensaje del cliente (y los anteriores).
      // El cliente ve los tildes azules y, con la coexistencia, el chat queda leído también en WhatsApp Business.
      // Marcar «no leído» en WhatsApp no existe en la API. Repetirlo no cambia nada: es seguro reintentar.
      if(!permissions.send)return result(403,{error:'Tu cuenta no puede marcar chats como leídos en WhatsApp.'});
      if(typeof body.contact_key!=='string' || !body.contact_key || body.contact_key.length>200)return result(400,{error:'Contacto inválido.'});
      const {data:contact,error}=await db.from('whatsapp_contacts').select('contact_key,phone_number_id').eq('contact_key',body.contact_key).maybeSingle();
      if(error)throw new Error('Could not read contact');
      if(!contact || contact.phone_number_id!==phoneId)return result(404,{error:'Contacto inexistente.'});
      const {data:last,error:lastError}=await db.from('whatsapp_messages').select('whatsapp_message_id,occurred_at')
        .eq('contact_key',contact.contact_key).eq('direction','inbound').order('occurred_at',{ascending:false}).limit(1).maybeSingle();
      if(lastError)throw new Error('Could not read last message');
      if(!last)return result(409,{error:'Este chat no tiene mensajes del cliente para marcar.'});
      if(Date.now()-new Date(last.occurred_at).getTime()>30*86400000)
        return result(409,{error:'WhatsApp solo deja marcar como leídos los mensajes de los últimos 30 días.'});
      await provider(base+'/messages',key,{method:'POST',body:JSON.stringify({
        messaging_product:'whatsapp',status:'read',message_id:last.whatsapp_message_id})});
      return result(200,{ok:true});
    }
    if(body.action==='send_status'){
      const {data:prior,error}=await db.from('whatsapp_send_requests').select('state,message_id')
        .eq('request_id',body.request_id).eq('user_id',auth.user.id).maybeSingle();
      if(error)throw new Error('Could not query send confirmation');
      return result(200,prior || {state:'missing'});
    }
    if(body.action==='send'){
      if(!permissions.send)return result(403,{error:'Tu cuenta no puede enviar mensajes.'});
      if(typeof body.content!=='string' || !body.content.trim() || body.content.length>4096 ||
        !/^[0-9a-f-]{36}$/i.test(body.request_id || ''))return result(400,{error:'Mensaje o identificador inválido.'});
      const {data:contact,error}=await db.from('whatsapp_contacts').select('*').eq('contact_key',body.contact_key).single();
      if(error || contact.phone_number_id!==phoneId)return result(404,{error:'Contacto inexistente.'});
      if(!contact.last_inbound_at || Date.now()-new Date(contact.last_inbound_at).getTime()>86400000)
        return result(409,{error:'Pasaron 24 horas desde el mensaje del cliente. Usá WhatsApp Business o una plantilla aprobada.'});
      const text=body.content.trim();
      const {error:claimError}=await db.from('whatsapp_send_requests').insert({
        request_id:body.request_id,user_id:auth.user.id,contact_key:body.contact_key,body:text});
      if(claimError){
        if(claimError.code!=='23505')throw new Error('Could not reserve message');
        const {data:prior}=await db.from('whatsapp_send_requests').select('*').eq('request_id',body.request_id).single();
        if(!prior || prior.user_id!==auth.user.id || prior.contact_key!==body.contact_key || prior.body!==text)
          return result(409,{error:'Identificador de envío ya utilizado.'});
        return result(prior.state==='sent'?200:409,{ok:prior.state==='sent',state:prior.state,message_id:prior.message_id,
          error:prior.state==='sent'?null:'El envío anterior está pendiente o sin confirmar. Revisá el chat antes de reenviar.'});
      }
      let sent;
      try{
        const target=contact.phone_number?{to:contact.phone_number}:
          contact.business_scoped_user_id?{recipient:contact.business_scoped_user_id}:null;
        if(!target)throw Object.assign(new Error('No hay destinatario disponible.'),{definite:true});
        sent=await provider(base+'/messages',key,{method:'POST',body:JSON.stringify({
          messaging_product:'whatsapp',recipient_type:'individual',biz_opaque_callback_data:body.request_id,...target,type:'text',text:{body:text}})});
        if(!sent.messages?.[0]?.id)throw new Error('Provider did not return a message ID');
      }catch(error){
        const state=error.definite?'rejected':'uncertain';
        await db.from('whatsapp_send_requests').update({state,error:String(error.message).slice(0,500)}).eq('request_id',body.request_id);
        return result(error.definite?422:502,{state,error:error.definite?
          'WhatsApp rechazó el mensaje: '+error.message:'El resultado del envío no está confirmado. Revisá Inbox/WhatsApp antes de reenviar.'});
      }
      const id=sent.messages[0].id;
      // Record acceptance immediately. Delivered/read/failed are updated by the webhook.
      const {error:saveError}=await db.from('whatsapp_send_requests').update({state:'sent',message_id:id}).eq('request_id',body.request_id);
      try{
        await persistEvents(db,[normalizeMessage({id,timestamp:String(Math.floor(Date.now()/1000)),
          type:'text',to:contact.phone_number,text:{body:text},kapso:{direction:'outbound',status:'accepted'}},
          {id:contact.conversation_id,phone_number:contact.phone_number,
            business_scoped_user_id:contact.business_scoped_user_id,contact_name:contact.display_name},phoneId)]);
      }catch{ return result(200,{ok:true,message_id:id,warning:'WhatsApp aceptó el envío; el registro local está pendiente del webhook.'}); }
      return result(200,{ok:true,message_id:id,warning:saveError?'Registro de confirmación pendiente.':null});
    }
    if(body.action==='sync_contacts'){
      if(!permissions.manage)return result(403,{error:'Tu cuenta no puede importar los nombres.'});
      if(body.cursor!=null && (typeof body.cursor!=='string' || body.cursor.length>4000))
        return result(400,{error:'Cursor inválido.'});
      const query=new URLSearchParams({limit:'100'});
      if(body.cursor)query.set('after',body.cursor);
      const page=await provider(base+'/contacts?'+query,key);
      if(!Array.isArray(page.data))throw new Error('Invalid contact response');
      const contacts=page.data.map(c=>({
        phone:typeof c.wa_id==='string'?c.wa_id.replace(/\D/g,''):null,
        name:[c.display_name,c.profile_name,c.profile?.name].find(n=>typeof n==='string' && n.trim()) || null
      }));
      const {data:counts,error}=await db.rpc('wa_import_contact_names',{p_phone_id:phoneId,p_contacts:contacts});
      if(error)throw new Error('No se pudieron guardar los nombres. Instalá la migración de contactos en Supabase.');
      const next=page.data.length?(page.paging?.cursors?.after || null):null;
      if(next && next===body.cursor)throw new Error('Repeated contact pagination cursor');
      return result(200,{...counts,processed:page.data.length,cursor:next,done:!next});
    }
    if(body.action==='sync' || body.action==='sync_state'){
      if(!permissions.manage)return result(403,{error:'Tu cuenta no puede importar el historial.'});
      let run;
      const {data:runs,error:runError}=await db.from('whatsapp_sync_runs').select('*')
        .eq('phone_number_id',phoneId).order('updated_at',{ascending:false}).limit(1);
      if(runError)throw new Error('Could not read sync state');
      run=runs?.[0];
      if(body.action==='sync_state')return result(200,{run});
      if(!run || run.state==='done' || body.restart===true){
        if(run && ['pending','running'].includes(run.state))return result(409,{error:'Hay una importación activa.'});
        const since=new Date();since.setMonth(since.getMonth()-6);
        const {data:newRun,error:insertError}=await db.from('whatsapp_sync_runs').insert({
          phone_number_id:phoneId,since_at:since.toISOString(),until_at:new Date().toISOString()}).select().single();
        if(insertError)return result(409,{error:'Otra persona inició la importación. Actualizá y continuá.'});
        run=newRun;
      }
      const {data:claimed,error:claimError}=await db.rpc('wa_claim_sync',{p_id:run.id});
      if(claimError || !claimed?.length)return result(409,{error:'La importación está procesando una página. Esperá un momento.'});
      run=claimed[0];
      try{
        const query=new URLSearchParams({limit:'100',fields:'kapso()',since:run.since_at,until:run.until_at});
        if(run.cursor)query.set('after',run.cursor);
        const page=await provider(base+'/messages?'+query,key);
        if(!Array.isArray(page.data))throw new Error('Invalid history response');
        const events=page.data.map(message=>normalizeMessage(message,{},phoneId));
        await persistEvents(db,events);
        const next=page.data.length?(page.paging?.cursors?.after || null):null;
        if(next && next===run.cursor)throw new Error('Repeated pagination cursor');
        const updated={cursor:next,processed:run.processed+events.length,state:next?'running':'done',
          lock_until:null,updated_at:new Date().toISOString()};
        const {error:updateError}=await db.from('whatsapp_sync_runs').update(updated).eq('id',run.id).eq('lock_until',run.lock_until).select('id').single();
        if(updateError)throw new Error('Could not checkpoint history');
        return result(200,{run:{...run,...updated}});
      }catch(error){
        await db.from('whatsapp_sync_runs').update({lock_until:null}).eq('id',run.id).eq('lock_until',run.lock_until);
        throw error;
      }
    }
    if(body.action==='media'){
      // Archivo de un mensaje (foto, audio, video, documento o sticker) para verlo en la app. Se guarda en el almacenamiento
      // privado «whatsapp-media» la primera vez que alguien lo abre, porque WhatsApp borra los archivos a las pocas semanas.
      if(typeof body.message_id!=='string' || !body.message_id || body.message_id.length>200)return result(400,{error:'Mensaje inválido.'});
      const {data:msg,error}=await db.from('whatsapp_messages').select('whatsapp_message_id,contact_key,message_type,raw_payload')
        .eq('whatsapp_message_id',body.message_id).maybeSingle();
      if(error)throw new Error('Could not read message');
      const media=msg && ['image','audio','video','document','sticker'].includes(msg.message_type)?msg.raw_payload?.message?.[msg.message_type]:null;
      if(!media?.id)return result(404,{error:'Este mensaje no tiene un archivo para mostrar.'});
      const {data:owner}=await db.from('whatsapp_contacts').select('phone_number_id').eq('contact_key',msg.contact_key).maybeSingle();
      if(!owner || owner.phone_number_id!==phoneId)return result(404,{error:'Contacto inexistente.'});
      const mime=(typeof media.mime_type==='string' && media.mime_type.split(';')[0].trim()) || 'application/octet-stream';
      const fileHeaders={...headers,'Content-Type':mime,'Cache-Control':'private, max-age=86400'};
      const path=phoneId+'/'+encodeURIComponent(msg.whatsapp_message_id);
      const stored=await db.storage.from('whatsapp-media').download(path);
      if(!stored.error && stored.data)return new Response(stored.data,{status:200,headers:fileHeaders});
      const meta=await provider('meta/whatsapp/v24.0/'+encodeURIComponent(media.id)+'?phone_number_id='+encodeURIComponent(phoneId),key);
      const target=meta.download_url || meta.downloadUrl || meta.url;
      if(typeof target!=='string')throw new Error('Kapso did not return a media URL');
      const kapsoHost=new URL(target).hostname.toLowerCase().endsWith('kapso.ai');
      // La clave de Kapso se manda solo a Kapso; un enlace de otro sitio ya trae su permiso en la dirección.
      const file=await fetch(target,{headers:kapsoHost?{'X-API-Key':key}:{},signal:AbortSignal.timeout(25000)});
      if(!file.ok)return result(410,{error:'WhatsApp ya no tiene este archivo disponible.'});
      const bytes=new Uint8Array(await file.arrayBuffer());
      if(bytes.byteLength>25*1024*1024)return result(413,{error:'El archivo es demasiado grande para mostrarlo acá: abrilo en WhatsApp Business.'});
      const saved=await db.storage.from('whatsapp-media').upload(path,bytes,{contentType:mime,upsert:true});
      if(saved.error)console.error('Media not cached:',saved.error.message);
      return new Response(bytes,{status:200,headers:fileHeaders});
    }
    return result(400,{error:'Acción desconocida.'});
  }catch(error){
    console.error('WhatsApp API failed:',error.message);
    return result(502,{error:'No se pudo completar la operación. '+String(error.message).slice(0,200)});
  }
});
