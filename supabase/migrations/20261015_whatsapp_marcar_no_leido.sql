-- «Marcar como no leído» (15/10/2026), como en WhatsApp Business pero solo en la app de Marcial (WhatsApp no se entera).
-- La marca es de la conversación (la ven todos los que usan WhatsApp en la app). Se limpia al abrir el chat (wa_mark_seen)
-- y con «Marcar todo como leído» (wa_mark_all_seen). Agregar la columna con valor por defecto es instantáneo y no toca datos.
-- Sin respaldo: al aplicarse solo agrega la columna (todas en false) y define funciones; no modifica datos existentes.
alter table public.whatsapp_contacts add column if not exists marked_unread boolean not null default false;

create or replace function public.wa_mark_unread(p_contact text,p_value boolean default true) returns void
language plpgsql security definer set search_path=public as $$ begin
if not wa_has_access() then raise exception 'No WhatsApp access' using errcode='42501'; end if;
update whatsapp_contacts set marked_unread=coalesce(p_value,true) where contact_key=p_contact;
end $$;
revoke all on function public.wa_mark_unread(text,boolean) from public,anon;
grant execute on function public.wa_mark_unread(text,boolean) to authenticated;

create or replace function public.wa_mark_seen(p_contact text) returns void language plpgsql security definer set search_path=public
as $$ begin
if not wa_has_access() then raise exception 'No WhatsApp access' using errcode='42501'; end if;
update whatsapp_contacts set last_seen_at=now(),marked_unread=false where contact_key=p_contact;
end $$;

create or replace function public.wa_mark_all_seen() returns integer language plpgsql security definer set search_path=public
as $$ declare n integer; begin
if not wa_has_access() then raise exception 'No WhatsApp access' using errcode='42501'; end if;
update whatsapp_contacts c set last_seen_at=greatest(now(),c.last_inbound_at),marked_unread=false
 where c.marked_unread or (c.last_inbound_at is not null and (c.last_seen_at is null or c.last_inbound_at>c.last_seen_at));
get diagnostics n=row_count;
return n;
end $$;
revoke all on function public.wa_mark_seen(text) from public,anon;
grant execute on function public.wa_mark_seen(text) to authenticated;
