-- Optimize client linking without changing links or the timeout setting.
begin;
create or replace view public.wa_client_order_activity as
with registry as materialized (
 select nombre,direccion,wa_name_key(nombre) as name_key,
 (count(*) over(partition by wa_name_key(nombre)))::integer as registry_matches
 from clientes where nullif(btrim(nombre),'') is not null
), aliases as materialized (
 select x.short,min(r.name_key) as canonical
 from unnest(array['eber','lucas charruca','sofi']) as x(short)
 join registry r on r.name_key like x.short||' - %'
 group by x.short having count(*)=1
), raw_orders as materialized (
 select wa_name_key(cliente) as name_key,
 left(fecha::text,10) as loaded,
 case when nullif(fecha_despacho::text,'') is not null
  and left(fecha_despacho::text,10)<=(now() at time zone 'America/Montevideo')::date::text
  then left(fecha_despacho::text,10) else left(fecha::text,10) end as ordered
 from pedidos where eliminado_en is null and coalesce(estado,'')<>'Cancelado'
 and nullif(btrim(cliente),'') is not null and fecha is not null
), activity as materialized (
 select coalesce(a.canonical,o.name_key) as name_key,
 count(*)::integer as order_count,max(o.ordered)::date as last_order
 from raw_orders o left join aliases a on a.short=o.name_key
 where o.loaded ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
 and o.loaded<=(now() at time zone 'America/Montevideo')::date::text
 and o.ordered ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
 group by coalesce(a.canonical,o.name_key)
)
select r.nombre,r.direccion,r.name_key,a.order_count,a.last_order,
 a.last_order>=(now() at time zone 'America/Montevideo')::date-150 as active,
 r.registry_matches
from registry r join activity a using(name_key)
where r.name_key !~ '^(negro - prueba|muestras|tomas cliente nuevo)( |$)'
 and r.name_key not like '% evento';

create index if not exists whatsapp_linked_name_key_idx
 on public.whatsapp_contacts(public.wa_name_key(linked_client_name))
 where linked_client_name is not null;
create index if not exists whatsapp_display_name_key_idx
 on public.whatsapp_contacts(public.wa_name_key(display_name))
 where display_name is not null;
create or replace function public.wa_auto_link_exact(p_active_only boolean default true)
returns jsonb language plpgsql security definer set search_path=public as $$
declare n integer;
begin
 perform wa_require_manager();
 with unique_customers as materialized (
  select * from wa_client_order_activity where registry_matches=1
  and (not p_active_only or active)
  and char_length(name_key)>=6
  and position(' ' in name_key)>0 and name_key not in
   ('joaquin','oscar','marcos','carlos','lucas','martin','miguel','daniel','sergio','claudio','sofia','maria','juan','josu','cliente','contacto','negocio','pizzeria','panaderia','rotiseria','cliente nuevo','sin nombre','no agendado','usuario whatsapp')
 ), unique_contacts as materialized (
  select wa_name_key(display_name) as name_key,min(contact_key) as contact_key
  from whatsapp_contacts where nullif(btrim(display_name),'') is not null
  group by wa_name_key(display_name) having count(*)=1
 ), matches as (
  select c.nombre,w.contact_key from unique_customers c join unique_contacts w using(name_key)
  where not exists(select 1 from whatsapp_contacts existing
    where existing.linked_client_name is not null and wa_name_key(existing.linked_client_name)=c.name_key)
 )
 update whatsapp_contacts c set linked_client_name=m.nombre,updated_at=now()
 from matches m where c.contact_key=m.contact_key and c.linked_client_name is null;
 get diagnostics n=row_count;
 return jsonb_build_object('linked',n);
end $$;
create or replace function public.wa_client_link_review(p_active_only boolean default true,p_deferred boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare c jsonb; suggestions jsonb; queue jsonb;
begin
 perform wa_require_manager();
 -- Calculate the order history and pending queue once, shared by count and selection.
 with linked as materialized (
  select distinct wa_name_key(linked_client_name) as name_key
  from whatsapp_contacts where linked_client_name is not null
 ), pending as materialized (
  select a.*,r.reviewed_at from wa_client_order_activity a
  left join whatsapp_client_review r on r.client_name=a.nombre
  left join linked l on l.name_key=a.name_key
  where (not p_active_only or a.active)
  and coalesce(r.deferred,false)=p_deferred and l.name_key is null
 )
 select jsonb_build_object('remaining',(select count(*) from pending),
  'client',(select to_jsonb(p)-'reviewed_at' from pending p
   order by case when p_deferred then reviewed_at end asc nulls first,
    active desc,last_order desc,order_count desc,nombre limit 1))
 into queue;
 c:=queue->'client';
 if c is null or c='null'::jsonb then
  return jsonb_build_object('remaining',0,'client',null,'suggestions','[]'::jsonb);
 end if;
 with named as materialized (
  select w.contact_key,w.phone_number,w.display_name,w.linked_client_name,w.last_message_at,w.last_content,
   wa_name_key(w.display_name) as name_key
  from whatsapp_contacts w where nullif(btrim(w.display_name),'') is not null
 ), tokens as materialized (
  select token from regexp_split_to_table(c->>'name_key','\s+') as t(token)
  where char_length(token)>=3 and token not in
   ('los','las','del','don','bar','pizzeria','panaderia','rotiseria','hamburgueseria')
 ), selected as (
  select w.contact_key,w.phone_number,w.display_name,w.linked_client_name,w.last_message_at,w.last_content,
   case when w.name_key=c->>'name_key' then 'Nombre exacto; requiere revisión'
    else 'Nombre parecido; confirmar antes de vincular' end as reason
  from named w where w.name_key=c->>'name_key' or exists(
   select 1 from tokens t where t.token=any(regexp_split_to_array(w.name_key,'\s+'))
  )
  order by (w.name_key=c->>'name_key') desc,(w.linked_client_name is null) desc,
   w.last_message_at desc nulls last,w.contact_key limit 6
 )
 select coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb) into suggestions from selected s;
 return queue||jsonb_build_object('suggestions',suggestions);
end $$;

commit;
