begin;
-- Identidad confirmada por el ingreso real de Juan Marcos el 20/11/2026.
-- El nombre interno de Auth es anterior al nombre visible del perfil.
do $$
declare u uuid; correo text;
begin
 select id,email into u,correo from auth.users where id='e11a2d13-2b31-4fc4-bac2-26a882caa51b' and lower(email)='thiagoforneron@marcial.app';
 if u is null then raise exception 'No coincide la cuenta verificada de Juan Marcos'; end if;
 insert into public.notas_acceso(user_id,nombre) values(u,'Juan Marcos') on conflict(user_id) do update set nombre=excluded.nombre;
 update public.seg_editores set nombre='Juan Marcos' where lower(email)=lower(correo);
 insert into public.seg_editores(email,nombre) select correo,'Juan Marcos' where not exists(select 1 from public.seg_editores where lower(email)=lower(correo));
 -- Retirar únicamente los permisos concedidos por error a la cuenta sin uso.
 delete from public.notas_acceso where user_id='0af26beb-bd57-4c5c-925d-e869838e282b' and nombre='Juan Marcos';
 delete from public.seg_editores where lower(email)='charly@marcial.app' and nombre='Juan Marcos';
end $$;
commit;
