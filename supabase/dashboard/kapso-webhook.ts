import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

// Pure helpers shared by webhook, history import, and authenticated API.
function normalizePhone(value) {
  return typeof value === 'string' && /^[+\d\s()-]+$/.test(value) ? value.replace(/\D/g, '') : null;
}
function isoTime(value) {
  const date = typeof value === 'number' || /^\d+$/.test(String(value || ''))
    ? new Date(Number(value) * 1000) : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
function statusRank(status) {
  return ({ pending: 0, accepted: 0, sent: 1, failed: 2, delivered: 3, read: 4, received: 1 })[status] ?? 0;
}
function normalizeMessage(message, conversation = {}, phoneId, event = '', forcedDirection) {
  const k = message.kapso || {};
  const direction = forcedDirection || k.direction || (event === 'whatsapp.message.received' ? 'inbound' :
    event === 'whatsapp.message.sent' ? 'outbound' : message.to ? 'outbound' : 'inbound');
  const phone = normalizePhone(conversation.phone_number || k.phone_number ||
    (direction === 'outbound' ? message.to : message.from));
  const bsuid = conversation.business_scoped_user_id || k.business_scoped_user_id ||
    (direction === 'outbound' ? message.to_user_id : message.from_user_id) || null;
  const conversationId = conversation.id || k.whatsapp_conversation_id || null;
  const identity = phone || bsuid || conversationId;
  const id = message.id || message.whatsapp_message_id;
  const occurred = isoTime(message.timestamp || message.created_at);
  if (!id || !identity || !phoneId || !occurred || !['inbound','outbound'].includes(direction))
    throw new Error('Message missing ID, identity, timestamp, or direction');
  const type = message.type || 'unknown';
  const data = message[type] || {};
  const content = k.content ?? message.text?.body ?? data.caption ??
    message.interactive?.button_reply?.title ?? message.interactive?.list_reply?.title ??
    message.button?.text ?? null;
  return { whatsapp_message_id: String(id), contact_key: String(phoneId) + ':' + identity,
    phone_number_id: String(phoneId), phone_number: phone, business_scoped_user_id: bsuid,
    display_name: conversation.contact_name || k.contact_name || null, conversation_id: conversationId,
    direction, message_type: type, content: typeof content === 'string' ? content : null,
    message_status: k.status || (direction === 'inbound' ? 'received' : 'sent'),
    origin: k.origin || null, occurred_at: occurred, raw_payload: {message, conversation} };
}
function normalizeWebhook(body, event, configuredId) {
  const events = [];
  if (Array.isArray(body.entry)) {
    for (const entry of body.entry) for (const change of entry.changes || []) {
      const value = change.value || {}, pid = String(value.metadata?.phone_number_id || '');
      if (pid !== configuredId) continue;
      for (const message of value.messages || []) {
        const contact = (value.contacts || []).find(c => c.wa_id === message.from) || {};
        events.push(normalizeMessage(message, {contact_name:contact.profile?.name}, pid, '', 'inbound'));
      }
      for (const message of value.message_echoes || []) {
        events.push({...normalizeMessage(message, {}, pid, '', 'outbound'), origin:'business_app'});
      }
      for (const s of value.statuses || []) if (s.id && isoTime(s.timestamp)) {
        events.push({status_only:true, whatsapp_message_id:s.id, message_status:s.status,
          status_at:isoTime(s.timestamp), phone_number_id:pid, request_id:s.biz_opaque_callback_data || null});
      }
    }
    return events;
  }
  const batch = body.batch === true ? body.data : [body];
  if (!Array.isArray(batch)) throw new Error('Invalid webhook batch');
  for (const item of batch) {
    const pid = String(item.phone_number_id || item.conversation?.phone_number_id || '');
    if (pid !== configuredId) throw new Error('Webhook belongs to a different phone number');
    const message = item.message;
    if (!message) continue;
    const status = event.split('.').at(-1);
    if (['delivered','read','failed'].includes(status)) {
      const times = (message.kapso?.statuses || []).filter(s => s.status === status);
      const at = isoTime(times.at(-1)?.timestamp || message.timestamp);
      if (!message.id || !at) throw new Error('Malformed status event');
      events.push({status_only:true, whatsapp_message_id:message.id, message_status:status,
        status_at:at, phone_number_id:pid});
    } else if (['whatsapp.message.received','whatsapp.message.sent','whatsapp.thread.standby'].includes(event)) {
      if (item.standby?.kind === 'status') continue;
      events.push(normalizeMessage(message,item.conversation,pid,event));
    }
  }
  return events;
}
async function verifySignature(bytes, signature, secret) {
  if (!secret || !/^[a-f0-9]{64}$/.test(signature || '')) return false;
  const key = await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),
    {name:'HMAC',hash:'SHA-256'},false,['verify']);
  const sig = Uint8Array.from(signature.match(/../g),x => parseInt(x,16));
  return crypto.subtle.verify('HMAC',key,sig,bytes);
}
async function persistEvents(db, events) {
  if (!events.length) return 0;
  const {data,error} = await db.rpc('wa_ingest_batch',{p_events:events});
  if (error) throw new Error('Database write failed: ' + error.code);
  return data;
}

Deno.serve(async request => {
  if(request.method !== 'POST') return new Response('POST only',{status:405});
  const secret=Deno.env.get('KAPSO_WEBHOOK_SECRET'), phoneId=Deno.env.get('KAPSO_PHONE_NUMBER_ID');
  if(!secret || !phoneId) return new Response('Missing server configuration',{status:503});
  if(Number(request.headers.get('content-length') || 0)>3*1024*1024)
    return new Response('Payload too large',{status:413});
  const bytes=new Uint8Array(await request.arrayBuffer());
  if(bytes.length>3*1024*1024) return new Response('Payload too large',{status:413});
  if(!await verifySignature(bytes,request.headers.get('x-webhook-signature'),secret))
    return new Response('Invalid signature',{status:401});
  try {
    const body=JSON.parse(new TextDecoder().decode(bytes));
    const events=normalizeWebhook(body,request.headers.get('x-webhook-event') || body.type || '',phoneId);
    const db=createClient(Deno.env.get('SUPABASE_URL'),Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
      {auth:{persistSession:false}});
    await persistEvents(db,events);
    return new Response('OK',{status:200});
  } catch(error) {
    console.error('WhatsApp webhook failed:',error.message);
    // Non-200 asks Kapso to retry; partially processed events remain idempotent.
    return new Response('Webhook not saved',{status:500});
  }
});
