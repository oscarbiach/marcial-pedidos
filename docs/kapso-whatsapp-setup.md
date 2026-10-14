# Kapso WhatsApp for Marcial

This change adds the secure Supabase receiver and the database tables. It does not place the Kapso API key in browser code.

## Before enabling

1. Apply `supabase/migrations/20261014_whatsapp_messages.sql` to the Marcial Supabase project.
2. Deploy `supabase/functions/kapso-webhook/index.ts` as the Edge Function named `kapso-webhook`.
3. In Supabase Edge Function secrets, keep the existing `KAPSO_API_KEY` and `KAPSO_PHONE_NUMBER_ID`, and add `KAPSO_WEBHOOK_SECRET` after Kapso creates the webhook. Never put credentials in this repository.
4. In Kapso, add a WhatsApp webhook for the connected number, selecting `whatsapp.message.received` and `whatsapp.message.sent`, destination `https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/kapso-webhook`, and a generated signing secret. Copy the same signing secret to Supabase as `KAPSO_WEBHOOK_SECRET`.
5. Send a test message and verify rows arrive in `whatsapp_contacts` and `whatsapp_messages`.

## Current matching limitation

The app's current `clientes` query loads only `nombre,direccion`; it does not load a phone field. This receiver therefore saves WhatsApp contacts by normalized phone number, but does not guess which existing Marcial customer they represent. A later inbox UI should let an authorized user link a contact to a customer, or the customer table can be extended to store a verified phone number.

## Current scope

The webhook stores message events and text/caption content. Media is recorded as a type placeholder; media download, contact history import, customer linking UI, and sending replies from Marcial are follow-up work. For replies outside WhatsApp's 24-hour customer-service window, use an approved template.
