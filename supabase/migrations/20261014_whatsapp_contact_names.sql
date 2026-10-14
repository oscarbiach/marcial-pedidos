-- Fill missing names on existing conversations only. Do not create contacts or change customer links.
begin;
create or replace function public.wa_import_contact_names(p_phone_id text,p_contacts jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare item jsonb; phone text; name text; candidate text; alternate text; target text;
 named integer:=0; matched integer:=0; filled integer:=0; n integer;
begin
 if jsonb_typeof(p_contacts)<>'array' or jsonb_array_length(p_contacts)>100 then
  raise exception 'Expected up to 100 contacts';
 end if;
 for item in select value from jsonb_array_elements(p_contacts) loop
  phone:=item->>'phone'; name:=nullif(btrim(item->>'name'),'');
  if phone is null or phone !~ '^[0-9]{6,20}$' or name is null then continue; end if;
  name:=left(name,250); named:=named+1; candidate:=p_phone_id||':'||phone; target:=null;
  select canonical_contact_key into target from whatsapp_contact_aliases where alias_contact_key=candidate;
  if target is null then
   select contact_key into target from whatsapp_contacts
    where contact_key=candidate and phone_number_id=p_phone_id;
  end if;
  -- Country-specific representation only, never match by a similar name.
  if target is null then
   alternate:=case when phone ~ '^549[0-9]{10}$' then '54'||substring(phone from 4)
    when phone ~ '^54[0-9]{10}$' then '549'||substring(phone from 3) else null end;
   if alternate is not null then
    select contact_key into target from whatsapp_contacts
     where contact_key=p_phone_id||':'||alternate and phone_number_id=p_phone_id;
   end if;
  end if;
  if target is not null then
   matched:=matched+1;
   update whatsapp_contacts set display_name=name,updated_at=now()
    where contact_key=target and phone_number_id=p_phone_id
    and nullif(btrim(display_name),'') is null;
   get diagnostics n=row_count; filled:=filled+n;
  end if;
 end loop;
 return jsonb_build_object('named',named,'matched',matched,'filled',filled);
end $$;
revoke all on function public.wa_import_contact_names(text,jsonb) from public,anon,authenticated;
grant execute on function public.wa_import_contact_names(text,jsonb) to service_role;
commit;
