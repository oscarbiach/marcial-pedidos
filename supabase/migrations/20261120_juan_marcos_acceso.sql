begin;
-- Misma cuenta Auth de Charly; no cambia credenciales ni pedidos histÃ³ricos.
do $$
declare u uuid; correo text;
begin
 select id,email into u,correo from auth.users where id='0af26beb-bd57-4c5c-925d-e869838e282b' and lower(email)='charly@marcial.app';
 if u is null then raise exception 'No coincide la cuenta existente de Charly'; end if;
 insert into public.notas_acceso(user_id,nombre) values(u,'Juan Marcos')
 on conflict(user_id) do update set nombre=excluded.nombre;
 update public.seg_editores set nombre='Juan Marcos' where lower(email)=lower(correo);
 insert into public.seg_editores(email,nombre) select correo,'Juan Marcos'
 where not exists(select 1 from public.seg_editores where lower(email)=lower(correo));
end $$;
commit;
