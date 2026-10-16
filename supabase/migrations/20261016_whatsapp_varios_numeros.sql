-- WhatsApp: varios números por cliente y desvincular (16/10/2026, pedido del usuario).
-- · wa_review_client_link deja de frenar el 2.º número de un cliente («Customer already linked»). Sigue frenando un
--   número que ya es de OTRO cliente: para moverlo, primero se desvincula de ese.
-- · wa_unlink_contact: desvincula un número (solo quien puede administrar). Repetirla no hace nada.
-- · wa_linked_clients: clientes que ya tienen números, para buscarlos y agregar o quitar números.
-- · whatsapp_link_log: queda anotado cada vínculo y desvínculo (quién, cuándo, qué cliente), para poder volver atrás.
-- No cambia datos existentes (los 101 vínculos actuales quedan igual), así que no hace falta respaldo; los cambios
-- que hagan después las funciones quedan en whatsapp_link_log. Volver atrás: la definición anterior de
-- wa_review_client_link está en 20261014_whatsapp_client_links.sql; drop de wa_unlink_contact, wa_linked_clients y de la tabla.
begin;

create table if not exists public.whatsapp_link_log (
  id bigint generated always as identity primary key,
  contact_key text not null,
  client_name text not null,
  action text not null check (action in ('vincular','desvincular')),
  done_by uuid,
  done_at timestamptz not null default now()
);
alter table public.whatsapp_link_log enable row level security;
revoke all on table public.whatsapp_link_log from public, anon, authenticated;

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
 if current_link is distinct from p_client then
  update whatsapp_contacts set linked_client_name=p_client,updated_at=now() where contact_key=p_contact;
  insert into whatsapp_link_log(contact_key,client_name,action,done_by) values(p_contact,p_client,'vincular',auth.uid());
 end if;
 -- Ya vinculado: deja de estar «pospuesto» (si alguna vez se le quitan todos los números, vuelve a la revisión normal).
 -- (Antes era un delete de la fila; el conector de Supabase no dejaba aplicarlo sin una confirmación que no llegaba.)
 update whatsapp_client_review set deferred=false where client_name=p_client and deferred;
end $$;
revoke all on function public.wa_review_client_link(text,text) from public,anon;
grant execute on function public.wa_review_client_link(text,text) to authenticated;

create or replace function public.wa_unlink_contact(p_contact text)
returns void language plpgsql security definer set search_path=public as $$
declare current_link text;
begin
 perform wa_require_manager();
 select linked_client_name into current_link from whatsapp_contacts where contact_key=p_contact for update;
 if not found then raise exception 'Contact missing'; end if;
 if current_link is null then return; end if;   -- ya estaba desvinculado
 update whatsapp_contacts set linked_client_name=null,updated_at=now() where contact_key=p_contact;
 insert into whatsapp_link_log(contact_key,client_name,action,done_by) values(p_contact,current_link,'desvincular',auth.uid());
end $$;
revoke all on function public.wa_unlink_contact(text) from public,anon;
grant execute on function public.wa_unlink_contact(text) to authenticated;

create or replace function public.wa_linked_clients(p_query text default '')
returns jsonb language plpgsql security definer set search_path=public as $$
declare q text:=wa_name_key(coalesce(p_query,''));
begin
 perform wa_require_manager();
 return coalesce((select jsonb_agg(x order by x.last_order desc nulls last,x.nombre) from (
  select a.nombre,a.direccion,a.last_order,a.order_count,count(w.contact_key)::int as numeros
  from wa_client_order_activity a
  join whatsapp_contacts w on wa_name_key(w.linked_client_name)=a.name_key
  where q='' or a.name_key like '%'||q||'%'
  group by a.nombre,a.direccion,a.last_order,a.order_count
  order by a.last_order desc nulls last,a.nombre limit 30) x),'[]'::jsonb);
end $$;
revoke all on function public.wa_linked_clients(text) from public,anon;
grant execute on function public.wa_linked_clients(text) to authenticated;

commit;
