-- Initial installation. The earlier draft was not deployed.
-- WhatsApp access is explicitly assigned below; it is NOT granted to every PIN login.
begin;
create table public.whatsapp_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  can_send boolean not null default false,
  can_manage boolean not null default false
);
alter table public.whatsapp_access enable row level security;
create function public.wa_has_access() returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from whatsapp_access where user_id=auth.uid()); $$;
create function public.wa_permissions() returns jsonb language sql stable security definer set search_path=public
as $$ select coalesce((select jsonb_build_object('read',true,'send',can_send,'manage',can_manage)
from whatsapp_access where user_id=auth.uid()), '{"read":false,"send":false,"manage":false}'::jsonb); $$;
revoke all on function public.wa_has_access(), public.wa_permissions() from public;
grant execute on function public.wa_has_access(), public.wa_permissions() to authenticated, service_role;

create table public.whatsapp_contacts (
  contact_key text primary key,
  phone_number_id text not null,
  phone_number text,
  business_scoped_user_id text,
  display_name text,
  conversation_id text,
  linked_client_name text,
  last_message_at timestamptz,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  last_content text,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.whatsapp_messages (
  whatsapp_message_id text primary key,
  contact_key text not null references public.whatsapp_contacts(contact_key),
  direction text not null check(direction in ('inbound','outbound')),
  message_type text not null,
  content text,
  message_status text,
  origin text,
  occurred_at timestamptz not null,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index on public.whatsapp_messages(contact_key,occurred_at desc,whatsapp_message_id desc);
create index on public.whatsapp_contacts(linked_client_name);
create table public.whatsapp_message_statuses(
  whatsapp_message_id text not null, message_status text not null, status_at timestamptz not null,
  primary key(whatsapp_message_id,message_status)
);
create table public.whatsapp_notes(
  id uuid primary key default gen_random_uuid(),
  contact_key text not null references public.whatsapp_contacts(contact_key),
  body text not null check(length(body) between 1 and 4000),
  follow_up_date date,
  author_id uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);
create table public.whatsapp_send_requests(
  request_id uuid primary key, user_id uuid not null, contact_key text not null,
  body text not null, state text not null default 'processing',
  message_id text, error text, created_at timestamptz not null default now()
);
create table public.whatsapp_sync_runs(
  id uuid primary key default gen_random_uuid(), phone_number_id text not null,
  since_at timestamptz not null, until_at timestamptz not null,
  cursor text, processed integer not null default 0,
  state text not null default 'pending', lock_until timestamptz, updated_at timestamptz not null default now()
);
create unique index whatsapp_one_active_sync on public.whatsapp_sync_runs(phone_number_id)
where state in ('pending','running');
create function public.wa_status_rank(s text) returns integer language sql immutable
as $$ select case s when 'read' then 4 when 'delivered' then 3 when 'failed' then 2
when 'sent' then 1 when 'received' then 1 else 0 end; $$;

-- Only the verified webhook and authenticated server API may ingest provider events.
create function public.wa_ingest_message(p jsonb) returns void language plpgsql security definer set search_path=public
as $$
declare at_time timestamptz; known_status text; changed boolean;
begin
  if coalesce((p->>'status_only')::boolean,false) then
    insert into whatsapp_message_statuses values(p->>'whatsapp_message_id',p->>'message_status',(p->>'status_at')::timestamptz)
    on conflict(whatsapp_message_id,message_status) do update
    set status_at=greatest(whatsapp_message_statuses.status_at,excluded.status_at);
    update whatsapp_messages set message_status=p->>'message_status'
    where whatsapp_message_id=p->>'whatsapp_message_id'
      and wa_status_rank(p->>'message_status') > wa_status_rank(message_status);
    if (p->>'request_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}
  at_time := (p->>'occurred_at')::timestamptz;
  insert into whatsapp_contacts(contact_key,phone_number_id,phone_number,business_scoped_user_id,display_name,conversation_id)
  values(p->>'contact_key',p->>'phone_number_id',p->>'phone_number',p->>'business_scoped_user_id',p->>'display_name',p->>'conversation_id')
  on conflict(contact_key) do update set
    display_name=coalesce(excluded.display_name,whatsapp_contacts.display_name),
    conversation_id=coalesce(excluded.conversation_id,whatsapp_contacts.conversation_id),
    phone_number=coalesce(excluded.phone_number,whatsapp_contacts.phone_number),
    business_scoped_user_id=coalesce(excluded.business_scoped_user_id,whatsapp_contacts.business_scoped_user_id);
  select message_status into known_status from whatsapp_message_statuses
    where whatsapp_message_id=p->>'whatsapp_message_id' order by wa_status_rank(message_status) desc limit 1;
  if wa_status_rank(known_status) <= wa_status_rank(p->>'message_status') then known_status:=p->>'message_status'; end if;
  insert into whatsapp_messages(whatsapp_message_id,contact_key,direction,message_type,content,message_status,origin,occurred_at,raw_payload)
  values(p->>'whatsapp_message_id',p->>'contact_key',p->>'direction',p->>'message_type',p->>'content',known_status,p->>'origin',at_time,coalesce(p->'raw_payload','{}'::jsonb))
  on conflict(whatsapp_message_id) do update set
    content=coalesce(excluded.content,whatsapp_messages.content),
    message_status=case when wa_status_rank(excluded.message_status)>wa_status_rank(whatsapp_messages.message_status)
      then excluded.message_status else whatsapp_messages.message_status end,
    origin=coalesce(excluded.origin,whatsapp_messages.origin);
  -- Greatest timestamps preserve contact order when delayed events/history arrive.
  update whatsapp_contacts set
    last_content=case when last_message_at is null or at_time>=last_message_at then p->>'content' else last_content end,
    last_message_at=greatest(last_message_at,at_time),
    last_inbound_at=case when p->>'direction'='inbound' then greatest(last_inbound_at,at_time) else last_inbound_at end,
    last_outbound_at=case when p->>'direction'='outbound' then greatest(last_outbound_at,at_time) else last_outbound_at end,
    updated_at=now()
  where contact_key=p->>'contact_key';
end $$;
revoke all on function public.wa_ingest_message(jsonb) from public,anon,authenticated;
grant execute on function public.wa_ingest_message(jsonb) to service_role;

alter table public.whatsapp_contacts enable row level security;
alter table public.whatsapp_messages enable row level security;
alter table public.whatsapp_notes enable row level security;
alter table public.whatsapp_send_requests enable row level security;
alter table public.whatsapp_sync_runs enable row level security;
alter table public.whatsapp_message_statuses enable row level security;
create policy wa_contacts_read on public.whatsapp_contacts for select to authenticated using(wa_has_access());
create policy wa_messages_read on public.whatsapp_messages for select to authenticated using(wa_has_access());
create policy wa_notes_read on public.whatsapp_notes for select to authenticated using(wa_has_access());
create policy wa_notes_add on public.whatsapp_notes for insert to authenticated
with check(wa_has_access() and author_id=auth.uid());
grant select on public.whatsapp_contacts,public.whatsapp_messages,public.whatsapp_notes to authenticated;
grant insert(body,contact_key,follow_up_date) on public.whatsapp_notes to authenticated;
revoke all on public.whatsapp_access,public.whatsapp_send_requests,public.whatsapp_sync_runs,public.whatsapp_message_statuses from anon,authenticated;

create view public.whatsapp_contact_summary with(security_invoker=true) as
select c.*, x.inbound_count,x.outbound_count,x.unread_count from public.whatsapp_contacts c
left join lateral (select count(*) filter(where direction='inbound') inbound_count,
count(*) filter(where direction='outbound') outbound_count,
count(*) filter(where direction='inbound' and (c.last_seen_at is null or occurred_at>c.last_seen_at)) unread_count
from public.whatsapp_messages m where m.contact_key=c.contact_key) x on true;
grant select on public.whatsapp_contact_summary to authenticated;
create function public.wa_contacts_page(p_query text default '',p_client text default null,p_offset integer default 0,p_limit integer default 100)
returns setof public.whatsapp_contact_summary language sql stable security invoker set search_path=public as $
select * from whatsapp_contact_summary where
(p_client is null or linked_client_name=p_client) and
(coalesce(display_name,'') ilike '%'||p_query||'%' or coalesce(linked_client_name,'') ilike '%'||p_query||'%'
or coalesce(phone_number,'') ilike '%'||p_query||'%')
order by last_message_at desc nulls last,contact_key limit greatest(1,least(p_limit,100)) offset greatest(0,p_offset); $;
revoke all on function public.wa_contacts_page(text,text,integer,integer) from public;
grant execute on function public.wa_contacts_page(text,text,integer,integer) to authenticated;

create function public.wa_mark_seen(p_contact text) returns void language plpgsql security definer set search_path=public
as $$ begin
if not wa_has_access() then raise exception 'No WhatsApp access' using errcode='42501'; end if;
update whatsapp_contacts set last_seen_at=now() where contact_key=p_contact;
end $$;
create function public.wa_link_client(p_contact text,p_name text) returns void language plpgsql security definer set search_path=public
as $$ begin
if not wa_has_access() then raise exception 'No WhatsApp access' using errcode='42501'; end if;
if p_name is not null and not exists(select 1 from clientes where nombre=p_name)
then raise exception 'Unknown customer'; end if;
update whatsapp_contacts set linked_client_name=p_name where contact_key=p_contact;
end $$;
revoke all on function public.wa_mark_seen(text),public.wa_link_client(text,text) from public;
grant execute on function public.wa_mark_seen(text),public.wa_link_client(text,text) to authenticated;
create function public.wa_messages_page(p_contact text,p_before_time timestamptz default null,p_before_id text default null,p_limit integer default 100)
returns setof public.whatsapp_messages language sql stable security invoker set search_path=public as $$
select * from whatsapp_messages where contact_key=p_contact and
(p_before_time is null or occurred_at<p_before_time or(occurred_at=p_before_time and whatsapp_message_id<p_before_id))
order by occurred_at desc,whatsapp_message_id desc limit greatest(1,least(p_limit,100)); $$;
revoke all on function public.wa_messages_page(text,timestamptz,text,integer) from public;
grant execute on function public.wa_messages_page(text,timestamptz,text,integer) to authenticated;
create function public.wa_ingest_batch(p_events jsonb) returns integer language plpgsql security definer set search_path=public
as $ declare e jsonb; n integer:=0; begin
for e in select value from jsonb_array_elements(p_events) loop perform wa_ingest_message(e); n:=n+1; end loop;
return n; end $;
revoke all on function public.wa_ingest_batch(jsonb) from public,anon,authenticated;
grant execute on function public.wa_ingest_batch(jsonb) to service_role;
create function public.wa_claim_sync(p_id uuid) returns setof whatsapp_sync_runs language sql security definer set search_path=public as $
update whatsapp_sync_runs set lock_until=now()+interval '60 seconds',state='running'
where id=p_id and state in ('pending','running') and (lock_until is null or lock_until<now()) returning *; $;
revoke all on function public.wa_claim_sync(uuid) from public,anon,authenticated;
grant execute on function public.wa_claim_sync(uuid) to service_role;
grant all on public.whatsapp_access,public.whatsapp_contacts,public.whatsapp_messages,
public.whatsapp_message_statuses,public.whatsapp_notes,public.whatsapp_send_requests,public.whatsapp_sync_runs to service_role;
commit;
-- NEXT: explicitly grant access to the real Supabase Auth accounts.
-- Inspect: select id,email from auth.users order by email;
-- Assign only the people allowed to see Clients (e.g. Oscar, Joaquin, Juan Marcos).
-- insert into public.whatsapp_access(user_id,can_send,can_manage)
-- values ('UUID_FROM_AUTH_USERS',true,true) on conflict(user_id) do update
-- set can_send=excluded.can_send,can_manage=excluded.can_manage;
 then
      update whatsapp_send_requests set
        state=case when p->>'message_status'='failed' then 'rejected' else 'sent' end,
        message_id=p->>'whatsapp_message_id'
      where request_id=(p->>'request_id')::uuid and state in ('processing','uncertain');
    end if;
    return;
  end if;
  at_time := (p->>'occurred_at')::timestamptz;
  insert into whatsapp_contacts(contact_key,phone_number_id,phone_number,business_scoped_user_id,display_name,conversation_id)
  values(p->>'contact_key',p->>'phone_number_id',p->>'phone_number',p->>'business_scoped_user_id',p->>'display_name',p->>'conversation_id')
  on conflict(contact_key) do update set
    display_name=coalesce(excluded.display_name,whatsapp_contacts.display_name),
    conversation_id=coalesce(excluded.conversation_id,whatsapp_contacts.conversation_id),
    phone_number=coalesce(excluded.phone_number,whatsapp_contacts.phone_number),
    business_scoped_user_id=coalesce(excluded.business_scoped_user_id,whatsapp_contacts.business_scoped_user_id);
  select message_status into known_status from whatsapp_message_statuses
    where whatsapp_message_id=p->>'whatsapp_message_id' order by wa_status_rank(message_status) desc limit 1;
  if wa_status_rank(known_status) <= wa_status_rank(p->>'message_status') then known_status:=p->>'message_status'; end if;
  insert into whatsapp_messages(whatsapp_message_id,contact_key,direction,message_type,content,message_status,origin,occurred_at,raw_payload)
  values(p->>'whatsapp_message_id',p->>'contact_key',p->>'direction',p->>'message_type',p->>'content',known_status,p->>'origin',at_time,coalesce(p->'raw_payload','{}'::jsonb))
  on conflict(whatsapp_message_id) do update set
    content=coalesce(excluded.content,whatsapp_messages.content),
    message_status=case when wa_status_rank(excluded.message_status)>wa_status_rank(whatsapp_messages.message_status)
      then excluded.message_status else whatsapp_messages.message_status end,
    origin=coalesce(excluded.origin,whatsapp_messages.origin);
  -- Greatest timestamps preserve contact order when delayed events/history arrive.
  update whatsapp_contacts set
    last_content=case when last_message_at is null or at_time>=last_message_at then p->>'content' else last_content end,
    last_message_at=greatest(last_message_at,at_time),
    last_inbound_at=case when p->>'direction'='inbound' then greatest(last_inbound_at,at_time) else last_inbound_at end,
    last_outbound_at=case when p->>'direction'='outbound' then greatest(last_outbound_at,at_time) else last_outbound_at end,
    updated_at=now()
  where contact_key=p->>'contact_key';
end $$;
revoke all on function public.wa_ingest_message(jsonb) from public,anon,authenticated;
grant execute on function public.wa_ingest_message(jsonb) to service_role;

alter table public.whatsapp_contacts enable row level security;
alter table public.whatsapp_messages enable row level security;
alter table public.whatsapp_notes enable row level security;
alter table public.whatsapp_send_requests enable row level security;
alter table public.whatsapp_sync_runs enable row level security;
alter table public.whatsapp_message_statuses enable row level security;
create policy wa_contacts_read on public.whatsapp_contacts for select to authenticated using(wa_has_access());
create policy wa_messages_read on public.whatsapp_messages for select to authenticated using(wa_has_access());
create policy wa_notes_read on public.whatsapp_notes for select to authenticated using(wa_has_access());
create policy wa_notes_add on public.whatsapp_notes for insert to authenticated
with check(wa_has_access() and author_id=auth.uid());
grant select on public.whatsapp_contacts,public.whatsapp_messages,public.whatsapp_notes to authenticated;
grant insert(body,contact_key,follow_up_date) on public.whatsapp_notes to authenticated;
revoke all on public.whatsapp_access,public.whatsapp_send_requests,public.whatsapp_sync_runs,public.whatsapp_message_statuses from anon,authenticated;

create view public.whatsapp_contact_summary with(security_invoker=true) as
select c.*, x.inbound_count,x.outbound_count,x.unread_count from public.whatsapp_contacts c
left join lateral (select count(*) filter(where direction='inbound') inbound_count,
count(*) filter(where direction='outbound') outbound_count,
count(*) filter(where direction='inbound' and (c.last_seen_at is null or occurred_at>c.last_seen_at)) unread_count
from public.whatsapp_messages m where m.contact_key=c.contact_key) x on true;
grant select on public.whatsapp_contact_summary to authenticated;
create function public.wa_contacts_page(p_query text default '',p_client text default null,p_offset integer default 0,p_limit integer default 100)
returns setof public.whatsapp_contact_summary language sql stable security invoker set search_path=public as $
select * from whatsapp_contact_summary where
(p_client is null or linked_client_name=p_client) and
(coalesce(display_name,'') ilike '%'||p_query||'%' or coalesce(linked_client_name,'') ilike '%'||p_query||'%'
or coalesce(phone_number,'') ilike '%'||p_query||'%')
order by last_message_at desc nulls last,contact_key limit greatest(1,least(p_limit,100)) offset greatest(0,p_offset); $;
revoke all on function public.wa_contacts_page(text,text,integer,integer) from public;
grant execute on function public.wa_contacts_page(text,text,integer,integer) to authenticated;

create function public.wa_mark_seen(p_contact text) returns void language plpgsql security definer set search_path=public
as $$ begin
if not wa_has_access() then raise exception 'No WhatsApp access' using errcode='42501'; end if;
update whatsapp_contacts set last_seen_at=now() where contact_key=p_contact;
end $$;
create function public.wa_link_client(p_contact text,p_name text) returns void language plpgsql security definer set search_path=public
as $$ begin
if not wa_has_access() then raise exception 'No WhatsApp access' using errcode='42501'; end if;
if p_name is not null and not exists(select 1 from clientes where nombre=p_name)
then raise exception 'Unknown customer'; end if;
update whatsapp_contacts set linked_client_name=p_name where contact_key=p_contact;
end $$;
revoke all on function public.wa_mark_seen(text),public.wa_link_client(text,text) from public;
grant execute on function public.wa_mark_seen(text),public.wa_link_client(text,text) to authenticated;
create function public.wa_messages_page(p_contact text,p_before_time timestamptz default null,p_before_id text default null,p_limit integer default 100)
returns setof public.whatsapp_messages language sql stable security invoker set search_path=public as $$
select * from whatsapp_messages where contact_key=p_contact and
(p_before_time is null or occurred_at<p_before_time or(occurred_at=p_before_time and whatsapp_message_id<p_before_id))
order by occurred_at desc,whatsapp_message_id desc limit greatest(1,least(p_limit,100)); $$;
revoke all on function public.wa_messages_page(text,timestamptz,text,integer) from public;
grant execute on function public.wa_messages_page(text,timestamptz,text,integer) to authenticated;
create function public.wa_ingest_batch(p_events jsonb) returns integer language plpgsql security definer set search_path=public
as $ declare e jsonb; n integer:=0; begin
for e in select value from jsonb_array_elements(p_events) loop perform wa_ingest_message(e); n:=n+1; end loop;
return n; end $;
revoke all on function public.wa_ingest_batch(jsonb) from public,anon,authenticated;
grant execute on function public.wa_ingest_batch(jsonb) to service_role;
create function public.wa_claim_sync(p_id uuid) returns setof whatsapp_sync_runs language sql security definer set search_path=public as $
update whatsapp_sync_runs set lock_until=now()+interval '60 seconds',state='running'
where id=p_id and state in ('pending','running') and (lock_until is null or lock_until<now()) returning *; $;
revoke all on function public.wa_claim_sync(uuid) from public,anon,authenticated;
grant execute on function public.wa_claim_sync(uuid) to service_role;
grant all on public.whatsapp_access,public.whatsapp_contacts,public.whatsapp_messages,
public.whatsapp_message_statuses,public.whatsapp_notes,public.whatsapp_send_requests,public.whatsapp_sync_runs to service_role;
commit;
-- NEXT: explicitly grant access to the real Supabase Auth accounts.
-- Inspect: select id,email from auth.users order by email;
-- Assign only the people allowed to see Clients (e.g. Oscar, Joaquin, Juan Marcos).
-- insert into public.whatsapp_access(user_id,can_send,can_manage)
-- values ('UUID_FROM_AUTH_USERS',true,true) on conflict(user_id) do update
-- set can_send=excluded.can_send,can_manage=excluded.can_manage;
