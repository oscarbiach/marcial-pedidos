-- Only the two phone identities confirmed by the account owner.
-- Keeps a contact snapshot and routes future events to the surviving contact.
begin;
lock table public.whatsapp_contacts,public.whatsapp_messages,
 public.whatsapp_notes,public.whatsapp_send_requests in share row exclusive mode;
create table if not exists public.whatsapp_contact_aliases(
 alias_contact_key text primary key,
 canonical_contact_key text not null references public.whatsapp_contacts(contact_key),
 original_contact jsonb not null,
 created_at timestamptz not null default now()
);
alter table public.whatsapp_contact_aliases enable row level security;
revoke all on public.whatsapp_contact_aliases from public,anon,authenticated;
grant all on public.whatsapp_contact_aliases to service_role;

create or replace function public.wa_merge_confirmed_contacts(p_old text,p_new text)
returns void language plpgsql security definer set search_path=public as $
declare pair record; old_contact public.whatsapp_contacts; new_contact public.whatsapp_contacts;
begin
 if auth.uid() is not null and not coalesce((select can_manage from whatsapp_access where user_id=auth.uid()),false) then raise exception 'Management permission required' using errcode='42501'; end if;
 for pair in select p_old as old_key,p_new as new_key
 loop
  select * into old_contact from public.whatsapp_contacts where contact_key=pair.old_key;
  if not found then continue; end if;
  select * into new_contact from public.whatsapp_contacts where contact_key=pair.new_key;
  if not found then raise exception 'Missing destination contact %',pair.new_key; end if;
  if old_contact.linked_client_name is not null and new_contact.linked_client_name is not null
   and old_contact.linked_client_name<>new_contact.linked_client_name then
   raise exception 'Conflicting customer links for %',pair.old_key;
  end if;
  insert into public.whatsapp_contact_aliases(alias_contact_key,canonical_contact_key,original_contact)
  values(pair.old_key,pair.new_key,to_jsonb(old_contact)) on conflict(alias_contact_key) do nothing;
  update public.whatsapp_messages set contact_key=pair.new_key where contact_key=pair.old_key;
  update public.whatsapp_notes set contact_key=pair.new_key where contact_key=pair.old_key;
  update public.whatsapp_send_requests set contact_key=pair.new_key where contact_key=pair.old_key;
  update public.whatsapp_contacts set
   display_name=coalesce(nullif(new_contact.display_name,''),old_contact.display_name),
   linked_client_name=coalesce(new_contact.linked_client_name,old_contact.linked_client_name),
   conversation_id=coalesce(new_contact.conversation_id,old_contact.conversation_id),
   business_scoped_user_id=coalesce(new_contact.business_scoped_user_id,old_contact.business_scoped_user_id),
   last_message_at=(select max(occurred_at) from public.whatsapp_messages where contact_key=pair.new_key),
   last_inbound_at=(select max(occurred_at) from public.whatsapp_messages where contact_key=pair.new_key and direction='inbound'),
   last_outbound_at=(select max(occurred_at) from public.whatsapp_messages where contact_key=pair.new_key and direction='outbound'),
   last_content=(select content from public.whatsapp_messages where contact_key=pair.new_key order by occurred_at desc,whatsapp_message_id desc limit 1),
   last_seen_at=case when new_contact.last_seen_at is null or old_contact.last_seen_at is null then null
     else least(new_contact.last_seen_at,old_contact.last_seen_at) end,
   created_at=least(new_contact.created_at,old_contact.created_at),updated_at=now()
  where contact_key=pair.new_key;
  delete from public.whatsapp_contacts where contact_key=pair.old_key;
 end loop;
end $;
revoke all on function public.wa_merge_confirmed_contacts(text,text) from public,anon;
grant execute on function public.wa_merge_confirmed_contacts(text,text) to authenticated,service_role;

create or replace function public.wa_ingest_message(p jsonb) returns void language plpgsql security definer set search_path=public
as $$
declare at_time timestamptz; known_status text; canonical_key text; canonical_phone text;
begin
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
  update whatsapp_contacts set
    last_content=case when last_message_at is null or at_time>=last_message_at then p->>'content' else last_content end,
    last_message_at=greatest(last_message_at,at_time),
    last_inbound_at=case when p->>'direction'='inbound' then greatest(last_inbound_at,at_time) else last_inbound_at end,
    last_outbound_at=case when p->>'direction'='outbound' then greatest(last_outbound_at,at_time) else last_outbound_at end,
    updated_at=now()
  where contact_key=p->>'contact_key';
end $$;
commit;
