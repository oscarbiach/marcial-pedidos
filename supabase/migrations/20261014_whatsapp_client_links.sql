-- Client links based on registered customers and their valid order history.
-- Requires WhatsApp initial schema. No pedidos/clientes rows are changed.
begin;
create or replace function public.wa_name_key(value text) returns text
language sql immutable parallel safe as $$
 select regexp_replace(btrim(lower(translate(coalesce(value,''),'ÁÉÍÓÚÜáéíóúü','AEIOUUaeiouu'))),'\s+',' ','g');
$$;
create or replace view public.wa_client_order_activity as
with registry as (
 select nombre,direccion,wa_name_key(nombre) as name_key from clientes
 where nullif(btrim(nombre),'') is not null
), raw_orders as (
 select wa_name_key(cliente) as name_key,
 left(fecha::text,10) as loaded,
 case when nullif(fecha_despacho::text,'') is not null
  and left(fecha_despacho::text,10)<=(now() at time zone 'America/Montevideo')::date::text
  then left(fecha_despacho::text,10) else left(fecha::text,10) end as ordered
 from pedidos where eliminado_en is null and coalesce(estado,'')<>'Cancelado'
 and nullif(btrim(cliente),'') is not null and fecha is not null
), normalized_orders as (
 select case when o.name_key in ('eber','lucas charruca','sofi')
  and (select count(*) from registry r where r.name_key like o.name_key||' - %')=1
  then (select r.name_key from registry r where r.name_key like o.name_key||' - %' limit 1)
  else o.name_key end as name_key, ordered
 from raw_orders o where loaded ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
 and loaded<=(now() at time zone 'America/Montevideo')::date::text
 and ordered ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
), activity as (
 select name_key,count(*)::integer as order_count,max(ordered)::date as last_order
 from normalized_orders group by name_key
)
select r.nombre,r.direccion,r.name_key,a.order_count,a.last_order,
 a.last_order>=(now() at time zone 'America/Montevideo')::date-150 as active,
 (select count(*) from registry other where other.name_key=r.name_key)::integer as registry_matches
from registry r join activity a using(name_key)
where r.name_key !~ '^(negro - prueba|muestras|tomas cliente nuevo)( |$)'
 and r.name_key not like '% evento';
revoke all on public.wa_client_order_activity from public,anon,authenticated;
grant select on public.wa_client_order_activity to service_role;

create table if not exists public.whatsapp_client_review(
 client_name text primary key,
 deferred boolean not null default true,
 reviewed_by uuid references auth.users(id),
 reviewed_at timestamptz not null default now()
);
alter table public.whatsapp_client_review enable row level security;
revoke all on public.whatsapp_client_review from public,anon,authenticated;
grant all on public.whatsapp_client_review to service_role;

create or replace function public.wa_require_manager() returns void
language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is null or not coalesce((select can_manage from whatsapp_access where user_id=auth.uid()),false) then
  raise exception 'Management permission required' using errcode='42501';
 end if;
end $$;
revoke all on function public.wa_require_manager() from public,anon;
grant execute on function public.wa_require_manager() to authenticated,service_role;

create or replace function public.wa_auto_link_exact(p_active_only boolean default true)
returns jsonb language plpgsql security definer set search_path=public as $$
declare n integer;
begin
 perform wa_require_manager();
 with unique_customers as (
  select * from wa_client_order_activity where registry_matches=1
  and (not p_active_only or active)
  and char_length(name_key)>=6
  and (position(' ' in name_key)>0 or name_key not in
   ('joaquin','oscar','marcos','carlos','lucas','martin','miguel','daniel','sergio','claudio','sofia','maria','juan','josu','cliente','contacto','negocio','pizzeria','panaderia','rotiseria','cliente nuevo','sin nombre','no agendado','usuario whatsapp'))
 ), unique_contacts as (
  select wa_name_key(display_name) as name_key,min(contact_key) as contact_key
  from whatsapp_contacts where nullif(btrim(display_name),'') is not null
  group by wa_name_key(display_name) having count(*)=1
 ), matches as (
  select c.nombre,w.contact_key from unique_customers c join unique_contacts w using(name_key)
  where not exists(select 1 from whatsapp_contacts existing
    where wa_name_key(existing.linked_client_name)=c.name_key)
 )
 update whatsapp_contacts c set linked_client_name=m.nombre,updated_at=now()
 from matches m where c.contact_key=m.contact_key and c.linked_client_name is null;
 get diagnostics n=row_count;
 return jsonb_build_object('linked',n);
end $$;
revoke all on function public.wa_auto_link_exact(boolean) from public,anon;
grant execute on function public.wa_auto_link_exact(boolean) to authenticated;

create or replace function public.wa_client_link_review(p_active_only boolean default true,p_deferred boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare c record; suggestions jsonb; total integer;
begin
 perform wa_require_manager();
 select count(*) into total from wa_client_order_activity a
 where (not p_active_only or a.active)
 and coalesce((select deferred from whatsapp_client_review where client_name=a.nombre),false)=p_deferred
 and not exists(select 1 from whatsapp_contacts w where wa_name_key(w.linked_client_name)=a.name_key);
 select a.* into c from wa_client_order_activity a
 where (not p_active_only or a.active)
 and coalesce((select deferred from whatsapp_client_review where client_name=a.nombre),false)=p_deferred
 and not exists(select 1 from whatsapp_contacts w where wa_name_key(w.linked_client_name)=a.name_key)
 order by case when p_deferred then (select reviewed_at from whatsapp_client_review where client_name=a.nombre) end asc nulls first,
 a.active desc,a.last_order desc,a.order_count desc,a.nombre limit 1;
 if not found then return jsonb_build_object('remaining',0,'client',null,'suggestions','[]'::jsonb); end if;
 select coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb) into suggestions from (
  select w.contact_key,w.phone_number,w.display_name,w.linked_client_name,w.last_message_at,w.last_content,
   case when wa_name_key(w.display_name)=c.name_key then 'Nombre exacto; requiere revisión'
    else 'Nombre parecido; confirmar antes de vincular' end as reason
  from whatsapp_contacts w
  where nullif(btrim(w.display_name),'') is not null and (
   wa_name_key(w.display_name)=c.name_key or exists(
    select 1 from regexp_split_to_table(c.name_key,'\s+') as t(token)
    where char_length(token)>=3 and token not in ('los','las','del','don','bar','pizzeria','panaderia','rotiseria','hamburgueseria')
    and token=any(regexp_split_to_array(wa_name_key(w.display_name),'\s+'))
   )
  )
  order by (wa_name_key(w.display_name)=c.name_key) desc,
   (w.linked_client_name is null) desc,w.last_message_at desc nulls last,w.contact_key limit 6
 ) s;
 return jsonb_build_object('remaining',total,'client',to_jsonb(c),'suggestions',suggestions);
end $$;
revoke all on function public.wa_client_link_review(boolean,boolean) from public,anon;
grant execute on function public.wa_client_link_review(boolean,boolean) to authenticated;

create or replace function public.wa_review_client_link(p_client text,p_contact text)
returns void language plpgsql security definer set search_path=public as $$
declare current_link text;
begin
 perform wa_require_manager();
 perform pg_advisory_xact_lock(hashtext('wa-client:'||coalesce(p_client,'')));
 if not exists(select 1 from wa_client_order_activity where nombre=p_client)
 or (select count(*) from clientes where nombre=p_client)<>1 then
  raise exception 'Customer missing or ambiguous';
 end if;
 select linked_client_name into current_link from whatsapp_contacts where contact_key=p_contact for update;
 if not found then raise exception 'Contact missing'; end if;
 if current_link is not null and current_link<>p_client then
  raise exception 'This number is already linked to another customer' using errcode='40001';
 end if;
 if exists(select 1 from whatsapp_contacts where wa_name_key(linked_client_name)=wa_name_key(p_client)
  and contact_key<>p_contact) then
  raise exception 'Customer already linked; refresh review' using errcode='40001';
 end if;
 update whatsapp_contacts set linked_client_name=p_client,updated_at=now() where contact_key=p_contact;
 delete from whatsapp_client_review where client_name=p_client;
end $$;
revoke all on function public.wa_review_client_link(text,text) from public,anon;
grant execute on function public.wa_review_client_link(text,text) to authenticated;

create or replace function public.wa_defer_client_link(p_client text)
returns void language plpgsql security definer set search_path=public as $$
begin
 perform wa_require_manager();
 if not exists(select 1 from wa_client_order_activity where nombre=p_client) then raise exception 'Customer missing'; end if;
 insert into whatsapp_client_review(client_name,reviewed_by) values(p_client,auth.uid())
 on conflict(client_name) do update set deferred=true,reviewed_by=excluded.reviewed_by,reviewed_at=now();
end $$;
revoke all on function public.wa_defer_client_link(text) from public,anon;
grant execute on function public.wa_defer_client_link(text) to authenticated;
commit;
