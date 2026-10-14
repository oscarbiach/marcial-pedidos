// Receives signed Kapso v2 WhatsApp webhooks and stores message/contact history.
// Required Supabase function secrets: KAPSO_WEBHOOK_SECRET, KAPSO_PHONE_NUMBER_ID.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are supplied by Supabase at runtime.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-webhook-event, x-webhook-signature, x-webhook-batch, x-idempotency-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function response(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function hex(bytes: Uint8Array) {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function validSignature(raw: string, signature: string | null, secret: string) {
  if (!signature) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)));
  const expected = hex(digest);
  if (expected.length !== signature.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return mismatch === 0;
}

type Payload = Record<string, any>;

function messageTime(value: unknown): string {
  if (typeof value === "number" || (typeof value === "string" && /^\d+$/.test(value))) {
    return new Date(Number(value) * 1000).toISOString();
  }
  const parsed = typeof value === "string" ? new Date(value) : new Date();
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

async function saveEvent(db: ReturnType<typeof createClient>, event: string, payload: Payload) {
  const message = payload.message || {};
  const conversation = payload.conversation || {};
  const id = message.id || message.whatsapp_message_id;
  const phone = String(conversation.phone_number || message.from || message.to || "").replace(/[^\d]/g, "");
  const phoneNumberId = String(payload.phone_number_id || conversation.phone_number_id || "");

  // Ignore events for another connected number and non-message events.
  const configuredId = Deno.env.get("KAPSO_PHONE_NUMBER_ID");
  if (configuredId && phoneNumberId && phoneNumberId !== configuredId) return;
  if (!id || !phone) return;

  const direction = message.kapso?.direction === "outbound" || event === "whatsapp.message.sent"
    ? "outbound"
    : "inbound";
  const timestamp = messageTime(message.timestamp || message.created_at);
  const content = message.kapso?.content
    || message.text?.body
    || message.image?.caption
    || message.document?.caption
    || message.interactive?.button_reply?.title
    || message.interactive?.list_reply?.title
    || (message.type && message.type !== "text" ? `[${message.type}]` : null);
  const name = conversation.contact_name || conversation.display_name || null;
  const status = message.kapso?.status || (event === "whatsapp.message.received" ? "received" : "sent");

  const { error: contactError } = await db.from("whatsapp_contacts").upsert({
    phone_number: phone,
    display_name: name,
    conversation_id: conversation.id || null,
    last_message_at: timestamp,
    updated_at: new Date().toISOString(),
  }, { onConflict: "phone_number" });
  if (contactError) throw contactError;

  const { error: messageError } = await db.from("whatsapp_messages").upsert({
    whatsapp_message_id: id,
    phone_number: phone,
    direction,
    message_type: message.type || "unknown",
    content,
    message_status: status,
    occurred_at: timestamp,
    webhook_event: event,
    raw_payload: payload,
  }, { onConflict: "whatsapp_message_id" });
  if (messageError) throw messageError;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return response(405, { error: "Method not allowed" });

  const secret = Deno.env.get("KAPSO_WEBHOOK_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!secret || !supabaseUrl || !serviceKey) return response(500, { error: "Missing server configuration" });

  const raw = await request.text();
  if (!(await validSignature(raw, request.headers.get("x-webhook-signature"), secret))) {
    return response(401, { error: "Invalid webhook signature" });
  }

  let body: Payload;
  try { body = JSON.parse(raw); } catch { return response(400, { error: "Invalid JSON" }); }
  const event = request.headers.get("x-webhook-event") || body.type || "unknown";
  const payloads: Payload[] = body.batch === true && Array.isArray(body.data) ? body.data : [body];
  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  try {
    for (const payload of payloads) await saveEvent(db, event, payload);
    return response(200, { ok: true, processed: payloads.length });
  } catch (error) {
    console.error("Kapso webhook persistence failed", error);
    return response(500, { error: "Could not save webhook" });
  }
});
