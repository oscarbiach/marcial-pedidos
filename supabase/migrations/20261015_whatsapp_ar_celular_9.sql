-- Celulares de Argentina con y sin el 9 (15/10/2026).
-- El mismo número llegaba de dos formas: 549… en los mensajes nuevos (webhook) y 54… sin el 9 en el historial importado,
-- y quedaba como dos contactos (por ejemplo, «Kike - La peña» vinculado y «Enrique Garcia» sin vincular). En los 63 pares
-- encontrados coincide la identidad de WhatsApp (business_scoped_user_id): son la misma persona.
-- Este script:
--   1. guarda un respaldo completo de whatsapp_contacts (whatsapp_contacts_respaldo_20261015);
--   2. pasa todos los celulares argentinos al formato con 9 (el que usa WhatsApp; las respuestas enviadas con 9 llegan) y une
--      cada par en un solo contacto con wa_merge_confirmed_contacts: mensajes, notas y envíos pasan juntos, se conserva el
--      vínculo con el cliente y el nombre de la agenda, y la clave vieja queda como alias (con el contacto original guardado);
--   3. desde ahora, todo lo que entra se guarda con 9, y el nombre ya guardado (agenda) no se pisa con el nombre de perfil;
--   4. mensajes editados: el texto nuevo venía solo dentro de raw_payload y el mensaje quedaba vacío. Se completa en los
--      existentes y en los que lleguen (así se ve en la lista, en la búsqueda y en lo detectado en el chat).
-- Volver atrás: los datos originales están en el respaldo y en whatsapp_contact_aliases.original_contact.
begin;
lock table public.whatsapp_contacts,public.whatsapp_messages,public.whatsapp_notes,
 public.whatsapp_send_requests,public.whatsapp_contact_aliases in share row exclusive mode;

create table if not exists public.whatsapp_contacts_respaldo_20261015 as select * from public.whatsapp_contacts;
alter table public.whatsapp_contacts_respaldo_20261015 enable row level security;
revoke all on public.whatsapp_contacts_respaldo_20261015 from public,anon,authenticated;
-- A qué contacto pertenecía cada mensaje, nota y envío, y los alias que había: con esto y el respaldo se deshace todo.
create table if not exists public.whatsapp_claves_respaldo_20261015 as
 select 'mensaje'::text as tabla,whatsapp_message_id as id,contact_key from public.whatsapp_messages
 union all select 'nota',id::text,contact_key from public.whatsapp_notes
 union all select 'envio',request_id::text,contact_key from public.whatsapp_send_requests;
create table if not exists public.whatsapp_alias_respaldo_20261015 as select * from public.whatsapp_contact_aliases;
create table if not exists public.whatsapp_editados_respaldo_20261015 as
 select whatsapp_message_id,content from public.whatsapp_messages where message_type='edit';
alter table public.whatsapp_claves_respaldo_20261015 enable row level security;
alter table public.whatsapp_alias_respaldo_20261015 enable row level security;
alter table public.whatsapp_editados_respaldo_20261015 enable row level security;
revoke all on public.whatsapp_claves_respaldo_20261015,public.whatsapp_alias_respaldo_20261015,public.whatsapp_editados_respaldo_20261015 from public,anon,authenticated;

-- 54 + 10 dígitos (sin el 9 de celular) → 549 + los mismos 10 dígitos. Cualquier otro número queda igual.
create or replace function public.wa_ar_celular(p text) returns text language sql immutable set search_path=public as $$
 select case when p ~ '^54[0-9]{10}$' and p !~ '^549' then '549'||substring(p from 3) else p end $$;
create or replace function public.wa_ar_clave(k text) returns text language sql immutable set search_path=public as $$
 select case when k ~ '^.+:54[0-9]{10}$' then regexp_replace(k,':([0-9]+)$','')||':'||public.wa_ar_celular(substring(k from ':([0-9]+)$')) else k end $$;
revoke all on function public.wa_ar_celular(text),public.wa_ar_clave(text) from public,anon;
grant execute on function public.wa_ar_celular(text),public.wa_ar_clave(text) to authenticated,service_role;

do $$
declare r public.whatsapp_contacts; nueva text; nombre text; pares int:=0; solos int:=0;
begin
 for r in select * from public.whatsapp_contacts
   where phone_number ~ '^54[0-9]{10}$' and phone_number !~ '^549' and contact_key=phone_number_id||':'||phone_number
   order by contact_key
 loop
  nueva:=r.phone_number_id||':'||public.wa_ar_celular(r.phone_number);
  nombre:=nullif(btrim(r.display_name),'');
  if exists(select 1 from public.whatsapp_contacts where contact_key=nueva) then
   pares:=pares+1;
  else
   -- Sin pareja: se crea el contacto con 9 (copia) y se unen, así queda un solo formato para todos.
   insert into public.whatsapp_contacts(contact_key,phone_number_id,phone_number,business_scoped_user_id,display_name,conversation_id,
     linked_client_name,last_message_at,last_inbound_at,last_outbound_at,last_content,last_seen_at,created_at,updated_at)
   values(nueva,r.phone_number_id,public.wa_ar_celular(r.phone_number),r.business_scoped_user_id,r.display_name,r.conversation_id,
     r.linked_client_name,r.last_message_at,r.last_inbound_at,r.last_outbound_at,r.last_content,r.last_seen_at,r.created_at,now());
   solos:=solos+1;
  end if;
  -- Un alias que apuntaba a la clave vieja pasa a apuntar a la nueva (la vieja se borra al unir).
  update public.whatsapp_contact_aliases set canonical_contact_key=nueva where canonical_contact_key=r.contact_key;
  perform public.wa_merge_confirmed_contacts(r.contact_key,nueva);
  -- El nombre de la agenda (el del historial) manda sobre el nombre de perfil de WhatsApp.
  if nombre is not null then update public.whatsapp_contacts set display_name=nombre where contact_key=nueva; end if;
 end loop;
 raise notice 'Celulares sin 9 unidos con su pareja: %, pasados al formato con 9: %',pares,solos;
end $$;

-- Mensajes editados ya guardados: el texto nuevo pasa a «content».
update public.whatsapp_messages set content=raw_payload->'message'->'edit'->'message'->'text'->>'body'
 where message_type='edit' and content is null and raw_payload->'message'->'edit'->'message'->'text'->>'body' is not null;
update public.whatsapp_contacts c set last_content=(select m.content from public.whatsapp_messages m where m.contact_key=c.contact_key
  order by m.occurred_at desc,m.whatsapp_message_id desc limit 1)
 where exists(select 1 from public.whatsapp_messages m where m.contact_key=c.contact_key and m.message_type='edit');

create or replace function public.wa_ingest_message(p jsonb) returns void language plpgsql security definer set search_path=public
as $$
declare at_time timestamptz; known_status text; canonical_key text; canonical_phone text;
begin
  -- Celulares de Argentina: siempre con 9 (ver arriba).
  if p ? 'contact_key' then p := p || jsonb_build_object('contact_key',wa_ar_clave(p->>'contact_key')); end if;
  if p->>'phone_number' is not null then p := p || jsonb_build_object('phone_number',wa_ar_celular(p->>'phone_number')); end if;
  -- Mensaje editado: el texto nuevo viene adentro de raw_payload.
  if p->>'message_type'='edit' and p->>'content' is null then
    p := p || jsonb_build_object('content',p->'raw_payload'->'message'->'edit'->'message'->'text'->>'body');
  end if;
  select a.canonical_contact_key,c.phone_number into canonical_key,canonical_phone
  from whatsapp_contact_aliases a join whatsapp_contacts c on c.contact_key=a.canonical_contact_key
  where a.alias_contact_key=p->>'contact_key';
  if canonical_key is not null then
    p := p || jsonb_build_object('contact_key',canonical_key,'phone_number',canonical_phone);
  end if;
  if coalesce((p->>'status_only')::boolean,false) then
    insert into whatsapp_message_statuses values(p->>'whatsapp_message_id',p->>'message_status',(p->>'status_at')::timestamptz)
    on conflict(whatsapp_message_id,message_status) do update
    set status_at=greatest(whatsapp_message_statuses.status_at,excluded.status_at);
    update whatsapp_messages set message_status=p->>'message_status'
    where whatsapp_message_id=p->>'whatsapp_message_id'
      and wa_status_rank(p->>'message_status') > wa_status_rank(message_status);
    if (p->>'request_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
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
    -- El nombre ya guardado (agenda o importado) no se pisa con el nombre de perfil que trae cada mensaje.
    display_name=coalesce(nullif(btrim(whatsapp_contacts.display_name),''),excluded.display_name),
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
commit;
