-- «Marcar todo como leído» (15/10/2026): lo mismo que abrir cada chat (wa_mark_seen), pero para todos los que tienen
-- mensajes sin leer. No toca mensajes ni contactos: solo la fecha de «visto». Devuelve cuántas conversaciones marcó.
create or replace function public.wa_mark_all_seen() returns integer language plpgsql security definer set search_path=public
as $$ declare n integer; begin
if not wa_has_access() then raise exception 'No WhatsApp access' using errcode='42501'; end if;
update whatsapp_contacts c set last_seen_at=greatest(now(),c.last_inbound_at)
 where c.last_inbound_at is not null and (c.last_seen_at is null or c.last_inbound_at>c.last_seen_at);
get diagnostics n=row_count;
return n;
end $$;
revoke all on function public.wa_mark_all_seen() from public,anon;
grant execute on function public.wa_mark_all_seen() to authenticated;
