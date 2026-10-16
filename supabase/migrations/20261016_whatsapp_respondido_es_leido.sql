-- WhatsApp: un chat respondido cuenta como leído (16/10/2026).
-- Antes, «sin leer» contaba los mensajes del cliente posteriores a la última vez que se abrió el chat EN LA APP; si
-- se le contestaba desde WhatsApp Business (celular), el número seguía. Ahora cuenta solo los mensajes posteriores a
-- la última apertura en la app Y a la última respuesta (desde la app o desde el celular), como hace WhatsApp.
-- No cambia datos: solo la vista que calcula el número. Volver atrás: correr de nuevo la definición anterior
-- (filtro «c.last_seen_at is null or m.occurred_at > c.last_seen_at», en 20261014_whatsapp_messages.sql).
-- Leer un chat en el celular sin contestar no se puede reflejar: WhatsApp no avisa esa lectura a la API.
create or replace view public.whatsapp_contact_summary with (security_invoker=true) as
select c.contact_key, c.phone_number_id, c.phone_number, c.business_scoped_user_id, c.display_name,
  c.conversation_id, c.linked_client_name, c.last_message_at, c.last_inbound_at, c.last_outbound_at,
  c.last_content, c.last_seen_at, c.created_at, c.updated_at,
  x.inbound_count, x.outbound_count, x.unread_count
from public.whatsapp_contacts c
left join lateral (select count(*) filter (where m.direction='inbound') as inbound_count,
  count(*) filter (where m.direction='outbound') as outbound_count,
  count(*) filter (where m.direction='inbound'
    and (c.last_seen_at is null or m.occurred_at > c.last_seen_at)
    and (c.last_outbound_at is null or m.occurred_at > c.last_outbound_at)) as unread_count
  from public.whatsapp_messages m where m.contact_key=c.contact_key) x on true;
