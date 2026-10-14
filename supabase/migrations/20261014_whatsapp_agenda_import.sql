-- Administrator-only browser agenda import. Uses the existing service-only importer.
begin;
create or replace function public.wa_import_agenda_names(p_phone_id text,p_contacts jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is null or not coalesce((select can_manage from whatsapp_access where user_id=auth.uid()),false) then
  raise exception 'Management permission required' using errcode='42501';
 end if;
 if p_phone_id is null or length(p_phone_id)>100 then raise exception 'Invalid phone ID'; end if;
 if p_contacts is null or jsonb_typeof(p_contacts)<>'array' or jsonb_array_length(p_contacts)>100 then
  raise exception 'Expected up to 100 contacts';
 end if;
 return wa_import_contact_names(p_phone_id,p_contacts);
end $$;
revoke all on function public.wa_import_agenda_names(text,jsonb) from public,anon;
grant execute on function public.wa_import_agenda_names(text,jsonb) to authenticated;
commit;
