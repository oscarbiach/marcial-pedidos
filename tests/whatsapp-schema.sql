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
('340539642484757:541100000001','340539642484757','541100000001',null),
('340539642484757:5491100000001','340539642484757','5491100000001','Fixture Contact');
insert into whatsapp_messages(whatsapp_message_id,contact_key,direction,message_type,content,occurred_at)
values('alias-before','340539642484757:541100000001','inbound','text','Preservar','2026-10-14T12:00:00Z');
insert into whatsapp_notes(contact_key,body,author_id)
values('340539642484757:541100000001','Preservar nota','11111111-1111-1111-1111-111111111111');
\ir ../supabase/migrations/20261014_whatsapp_confirmed_aliases.sql
select wa_merge_confirmed_contacts('340539642484757:541100000001','340539642484757:5491100000001');
select wa_merge_confirmed_contacts('340539642484757:541100000001','340539642484757:5491100000001');
select wa_ingest_message('{"contact_key":"340539642484757:541100000001","phone_number_id":"340539642484757","phone_number":"541100000001",
"whatsapp_message_id":"alias-after","direction":"inbound","message_type":"text","content":"Nuevo","occurred_at":"2026-10-14T13:00:00Z","message_status":"received"}');
do $$ begin
if exists(select 1 from whatsapp_contacts where contact_key='340539642484757:541100000001') then raise exception 'Alias recreated'; end if;
if (select count(*) from whatsapp_messages where contact_key='340539642484757:5491100000001')<>2 then raise exception 'Messages lost'; end if;
if not exists(select 1 from whatsapp_notes where contact_key='340539642484757:5491100000001' and body='Preservar nota') then raise exception 'Note lost'; end if;
if (select display_name from whatsapp_contacts where contact_key='340539642484757:5491100000001')<>'Fixture Contact' then raise exception 'Name lost'; end if;
end $$;

\ir ../supabase/migrations/20261014_whatsapp_contact_names.sql
insert into whatsapp_contacts(contact_key,phone_number_id,phone_number)
values('fixture-phone:541100000002','fixture-phone','541100000002');
select wa_import_contact_names('fixture-phone','[
 {"phone":"5491100000002","name":"Nombre de agenda"},
 {"phone":"541100000003","name":"No crear contacto"}
]');
select wa_import_contact_names('fixture-phone','[{"phone":"541100000002","name":"No sobrescribir"}]');
do $$ begin
 if (select display_name from whatsapp_contacts where contact_key='fixture-phone:541100000002')<>'Nombre de agenda' then raise exception 'Contact name import failed'; end if;
 if exists(select 1 from whatsapp_contacts where contact_key='fixture-phone:541100000003') then raise exception 'Unexpected contact created'; end if;
 if has_function_privilege('authenticated','public.wa_import_contact_names(text,jsonb)','execute') then raise exception 'Importer exposed to clients'; end if;
end $$;

\ir ../supabase/migrations/20261014_whatsapp_agenda_import.sql
set role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
do $$ begin
 begin perform wa_import_agenda_names('fixture-phone','[]');
 raise exception 'Unauthorized agenda import';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select wa_import_agenda_names('fixture-phone','[{"phone":"541100000002","name":"Conservar"}]');
reset role;

-- Linking uses the actual pedidos schema fields; this table exists only in the test database.
create table public.pedidos(
 id text primary key,cliente text,fecha timestamptz,fecha_despacho timestamptz,estado text,eliminado_en timestamptz
);
insert into clientes(nombre,direccion) values
 ('Pizzería Fixture Uno','Dirección 1'),('Cliente Repetido','Dirección 2'),
 ('Proveedor No Activo','Dirección 3'),('Juan','Dirección 4'),
 ('Cliente Solo Cancelado','Dirección 5'),('Cliente Eliminado','Dirección 6');
insert into pedidos(id,cliente,fecha,estado,eliminado_en) values
 ('link-order1','Pizzería Fixture Uno',(now() at time zone 'America/Montevideo')::date-2,'Despachado',null),
 ('link-order2','Cliente Repetido',(now() at time zone 'America/Montevideo')::date-1,'Pendiente',null),
 ('link-order3','Proveedor No Activo',(now() at time zone 'America/Montevideo')::date-200,'Despachado',null),
 ('link-order4','Juan',(now() at time zone 'America/Montevideo')::date-3,'Despachado',null),
 ('link-order5','Cliente Solo Cancelado',(now() at time zone 'America/Montevideo')::date,'Cancelado',null),
 ('link-order6','Cliente Eliminado',(now() at time zone 'America/Montevideo')::date,'Despachado',now());
insert into whatsapp_contacts(contact_key,phone_number_id,phone_number,display_name) values
 ('link:1','link','541100000101','  PIZZERIA   FIXTURE UNO '),
 ('link:2','link','541100000102','Cliente Repetido'),
 ('link:3','link','541100000103','Cliente Repetido'),
 ('link:4','link','541100000104','Proveedor No Activo'),
 ('link:5','link','541100000105','Juan');
\ir ../supabase/migrations/20261014_whatsapp_client_links.sql
\ir ../supabase/migrations/20261015_whatsapp_link_performance.sql
set role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
do $$ begin
 begin perform wa_auto_link_exact(true); raise exception 'Unauthorized auto link';
 exception when insufficient_privilege then null; end;
 begin perform wa_client_link_review(true,false); raise exception 'Unauthorized review';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
do $$ declare first_result jsonb; review jsonb; begin
 first_result:=wa_auto_link_exact(true);
 if (first_result->>'linked')::integer<>1 then raise exception 'Unexpected exact link count %',first_result; end if;
 if (select linked_client_name from whatsapp_contacts where contact_key='link:1')<>'Pizzería Fixture Uno' then raise exception 'Exact match missing'; end if;
 if exists(select 1 from whatsapp_contacts where contact_key in ('link:2','link:3','link:4','link:5') and linked_client_name is not null) then raise exception 'Ambiguous/inactive/short match linked'; end if;
 if (wa_auto_link_exact(true)->>'linked')::integer<>0 then raise exception 'Auto link not idempotent'; end if;
 review:=wa_client_link_review(true,false);
 if review->'client'->>'nombre'<>'Cliente Repetido' then raise exception 'Recent customer not prioritized %',review; end if;
 if (review->>'remaining')::integer<>2 then raise exception 'Invalid active queue %',review; end if;
 perform wa_defer_client_link('Cliente Repetido');
 if wa_client_link_review(true,false)->'client'->>'nombre'<>'Juan' then raise exception 'Deferred customer not skipped'; end if;
 if wa_client_link_review(false,true)->'client'->>'nombre'<>'Cliente Repetido' then raise exception 'Deferred review missing'; end if;
 perform wa_review_client_link('Cliente Repetido','link:2');
 begin perform wa_review_client_link('Juan','link:2');raise exception 'Existing link overwritten';
 exception when serialization_failure then null; end;
 if wa_client_link_review(false,true)->'client'<>'null'::jsonb then raise exception 'Linked customer remains deferred'; end if;
 if has_table_privilege('authenticated','public.whatsapp_client_review','select') then raise exception 'Private queue exposed'; end if;
end $$;
reset role;

-- Representative scale regression: 800 customers, 32,000 orders and 3,200 contacts.
-- Reuse the production API timeout instead of hiding slow queries with a larger budget.
insert into clientes(nombre,direccion)
select 'Rendimiento Cliente '||n,'Dirección de prueba' from generate_series(1,800) n;
insert into pedidos(id,cliente,fecha,estado)
select 'perf-'||n||'-'||k,'Rendimiento Cliente '||n,
 (now() at time zone 'America/Montevideo')::date-(k%30),'Despachado'
from generate_series(1,800) n cross join generate_series(1,40) k;
insert into whatsapp_contacts(contact_key,phone_number_id,phone_number,display_name)
select 'perf:'||n,'perf','5411999'||lpad(n::text,4,'0'),
 case when n<=800 then 'Rendimiento Cliente '||n else 'Contacto adicional '||n end
from generate_series(1,3200) n;
analyze clientes; analyze pedidos; analyze whatsapp_contacts;
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
set statement_timeout='3s';
do $$ declare q jsonb; begin
 q:=wa_client_link_review(true,false);
 if (q->>'remaining')::integer<800 then raise exception 'Missing scaled queue'; end if;
 if (wa_auto_link_exact(true)->>'linked')::integer<>800 then raise exception 'Scaled matching failed'; end if;
 q:=wa_client_link_review(true,false);
 if (q->>'remaining')::integer>=800 then raise exception 'Linked rows remain queued'; end if;
end $$;
reset statement_timeout;
reset role;
