-- WhatsApp conversations imported from Kapso.
-- Run this migration in the Marcial Supabase project before deploying the webhook.

create table if not exists public.whatsapp_contacts (
  phone_number text primary key,
  display_name text,
  conversation_id text,
  linked_client_name text,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.whatsapp_messages (
  whatsapp_message_id text primary key,
  phone_number text not null references public.whatsapp_contacts(phone_number) on delete cascade,
  direction text not null check (direction in ('inbound', 'outbound')),
  message_type text not null default 'unknown',
  content text,
  message_status text,
  occurred_at timestamptz not null,
  webhook_event text,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists whatsapp_messages_phone_time_idx
  on public.whatsapp_messages (phone_number, occurred_at desc);

alter table public.whatsapp_contacts enable row level security;
alter table public.whatsapp_messages enable row level security;

drop policy if exists "Marcial users can read WhatsApp contacts" on public.whatsapp_contacts;
create policy "Marcial users can read WhatsApp contacts"
  on public.whatsapp_contacts for select to authenticated using (true);

drop policy if exists "Marcial users can read WhatsApp messages" on public.whatsapp_messages;
create policy "Marcial users can read WhatsApp messages"
  on public.whatsapp_messages for select to authenticated using (true);

grant select on public.whatsapp_contacts, public.whatsapp_messages to authenticated;
