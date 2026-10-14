-- Disposable PostgreSQL fixture; never run the fixture on the production database.
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create table auth.users(id uuid primary key,email text);
create function auth.uid() returns uuid language sql stable as $$
select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid; $$;
create table public.clientes(nombre text primary key,direccion text);
grant usage on schema public,auth to anon,authenticated,service_role;
grant select on public.clientes to authenticated;
\ir ../supabase/migrations/20261014_whatsapp_messages.sql
insert into auth.users values('11111111-1111-1111-1111-111111111111','allowed@example.test'),
('22222222-2222-2222-2222-222222222222','denied@example.test');
insert into whatsapp_access values('11111111-1111-1111-1111-111111111111',true,true);
insert into clientes values('Cliente Real','Dirección');
select wa_ingest_message('{"status_only":true,"whatsapp_message_id":"fixture1","message_status":"read","status_at":"2026-10-14T12:01:00Z"}');
select wa_ingest_message('{"contact_key":"p:549","phone_number_id":"p","phone_number":"549","display_name":"Cliente",
"whatsapp_message_id":"fixture1","direction":"inbound","message_type":"text","content":"Hola","occurred_at":"2026-10-14T12:00:00Z","message_status":"received"}');
select wa_ingest_message('{"contact_key":"p:549","phone_number_id":"p","phone_number":"549",
"whatsapp_message_id":"fixture1","direction":"inbound","message_type":"text","content":"Hola","occurred_at":"2026-10-14T12:00:00Z","message_status":"received"}');
select wa_ingest_message('{"contact_key":"p:549","phone_number_id":"p","phone_number":"549",
"whatsapp_message_id":"fixture0","direction":"outbound","message_type":"text","content":"Anterior","occurred_at":"2026-10-13T12:00:00Z","message_status":"sent"}');
do $$ begin
if (select count(*) from whatsapp_messages)<>2 then raise exception 'Duplicate message rows'; end if;
if (select last_message_at from whatsapp_contacts where contact_key='p:549')<>'2026-10-14T12:00:00Z' then raise exception 'Contact timestamp regressed'; end if;
if (select occurred_at from whatsapp_messages where whatsapp_message_id='fixture1')<>'2026-10-14T12:00:00Z' then raise exception 'Status changed message timestamp'; end if;
if (select message_status from whatsapp_messages where whatsapp_message_id='fixture1')<>'read' then raise exception 'Pre-arrival status lost'; end if;
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
do $$ begin
if (select count(*) from whatsapp_contacts)<>0 then raise exception 'Unauthorized read'; end if;
begin perform wa_ingest_message('{}'); raise exception 'Unauthorized write';
exception when insufficient_privilege then null; end;
begin perform wa_link_client('p:549','Cliente Real');raise exception 'Unauthorized linking';
exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select wa_link_client('p:549','Cliente Real');
select wa_mark_seen('p:549');
insert into whatsapp_notes(contact_key,body) values('p:549','Seguimiento del cliente');
do $$ begin
if (select linked_client_name from whatsapp_contacts where contact_key='p:549')<>'Cliente Real' then raise exception 'Link failed'; end if;
if (select count(*) from wa_messages_page('p:549'))<>2 then raise exception 'History inaccessible'; end if;
if (select unread_count from whatsapp_contact_summary where contact_key='p:549')<>0 then raise exception 'Mark seen failed'; end if;
if (select author_id from whatsapp_notes limit 1)<>'11111111-1111-1111-1111-111111111111' then raise exception 'Note author incorrect'; end if;
begin perform wa_link_client('p:549','Unknown');raise exception 'Unknown client accepted';
exception when raise_exception then if sqlerrm='Unknown client accepted' then raise; end if; end;
end $$;
reset role;

-- Confirmed Argentina aliases: preserve messages/notes and route future events.
insert into whatsapp_contacts(contact_key,phone_number_id,phone_number,display_name) values
('340539642484757:543424323354','340539642484757','543424323354',null),
('340539642484757:5493424323354','340539642484757','5493424323354','Oscar Bianchi');
insert into whatsapp_messages(whatsapp_message_id,contact_key,direction,message_type,content,occurred_at)
values('alias-before','340539642484757:543424323354','inbound','text','Preservar','2026-10-14T12:00:00Z');
insert into whatsapp_notes(contact_key,body,author_id)
values('340539642484757:543424323354','Preservar nota','11111111-1111-1111-1111-111111111111');
\ir ../supabase/migrations/20261014_whatsapp_confirmed_aliases.sql
\ir ../supabase/migrations/20261014_whatsapp_confirmed_aliases.sql
select wa_ingest_message('{"contact_key":"340539642484757:543424323354","phone_number_id":"340539642484757","phone_number":"543424323354",
"whatsapp_message_id":"alias-after","direction":"inbound","message_type":"text","content":"Nuevo","occurred_at":"2026-10-14T13:00:00Z","message_status":"received"}');
do $$ begin
if exists(select 1 from whatsapp_contacts where contact_key='340539642484757:543424323354') then raise exception 'Alias recreated'; end if;
if (select count(*) from whatsapp_messages where contact_key='340539642484757:5493424323354')<>2 then raise exception 'Messages lost'; end if;
if not exists(select 1 from whatsapp_notes where contact_key='340539642484757:5493424323354' and body='Preservar nota') then raise exception 'Note lost'; end if;
if (select display_name from whatsapp_contacts where contact_key='340539642484757:5493424323354')<>'Oscar Bianchi' then raise exception 'Name lost'; end if;
end $$;
