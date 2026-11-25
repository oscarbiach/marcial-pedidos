begin;
do $$
begin
  if not exists(select 1 from auth.users where id='e11a2d13-2b31-4fc4-bac2-26a882caa51b' and lower(email)='thiagoforneron@marcial.app') then
    raise exception 'No coincide la cuenta verificada de Juan Marcos';
  end if;
  insert into public.whatsapp_access(user_id,can_send,can_manage)
  values('e11a2d13-2b31-4fc4-bac2-26a882caa51b',true,false)
  on conflict(user_id) do update set can_send=true,can_manage=false;
  delete from public.notas_acceso where user_id='e11a2d13-2b31-4fc4-bac2-26a882caa51b';
end $$;
commit;
