-- WhatsApp: foto de cada contacto, subida o pegada a mano desde la app (16/10/2026).
-- La API de WhatsApp no entrega las fotos de perfil de los clientes, así que se cargan desde «Importar → Fotos de contactos».
-- La app achica la imagen a 160×160 (JPEG o WebP, unos 10 KB) antes de guardarla; acá se guarda como texto (data URL).
-- Solo agrega una tabla y una función: no cambia datos existentes, así que no hace falta respaldo. Volver atrás:
--   drop function if exists public.wa_set_photo(text,text); drop table if exists public.whatsapp_contact_photos;
create table if not exists public.whatsapp_contact_photos (
  contact_key text primary key references public.whatsapp_contacts(contact_key) on delete cascade,
  image text not null check (length(image) <= 120000 and image ~ '^data:image/(jpeg|webp|png);base64,[A-Za-z0-9+/]+=*$'),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
alter table public.whatsapp_contact_photos enable row level security;
drop policy if exists wa_photos_read on public.whatsapp_contact_photos -- revisado: re-ejecutable, la política es de esta misma tabla nueva
;
create policy wa_photos_read on public.whatsapp_contact_photos for select to authenticated using (wa_has_access());
revoke all on table public.whatsapp_contact_photos from public, anon, authenticated;
grant select on table public.whatsapp_contact_photos to authenticated;

-- Poner (o cambiar) la foto de un contacto; con p_image null la quita. Repetirla con la misma imagen deja todo igual.
-- Solo quien puede vincular clientes (permiso «manage»).
create or replace function public.wa_set_photo(p_contact text, p_image text) returns void
language plpgsql security definer set search_path=public as $$
begin
  if not coalesce((wa_permissions()->>'manage')::boolean, false) then
    raise exception 'No WhatsApp manage access' using errcode='42501';
  end if;
  if not exists(select 1 from whatsapp_contacts where contact_key=p_contact) then
    raise exception 'Unknown contact' using errcode='P0002';
  end if;
  if p_image is null then
    delete from whatsapp_contact_photos where contact_key=p_contact;
  else
    insert into whatsapp_contact_photos(contact_key, image, updated_by, updated_at)
    values (p_contact, p_image, auth.uid(), now())
    on conflict (contact_key) do update set image=excluded.image, updated_by=excluded.updated_by, updated_at=excluded.updated_at;
  end if;
end $$;
revoke all on function public.wa_set_photo(text,text) from public, anon;
grant execute on function public.wa_set_photo(text,text) to authenticated;
