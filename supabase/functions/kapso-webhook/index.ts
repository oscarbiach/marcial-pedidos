import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { normalizeWebhook, verifySignature, persistEvents } from "../_shared/whatsapp.js";

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
