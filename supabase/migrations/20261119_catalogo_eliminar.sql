begin;
alter table public.productos add column if not exists eliminado_en timestamptz;
create or replace function public.catalogo_eliminar(p_id uuid,p_restaurar boolean default false) returns boolean
language plpgsql security definer set search_path=public as $$
begin
 if not stock_es_admin() then raise exception 'Sin acceso a Productos' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtext('catalogo_guardar'));
 perform 1 from productos where id=p_id for update;
 if not found then raise exception 'El producto ya no existe'; end if;
 update productos set eliminado_en=case when p_restaurar then null else coalesce(eliminado_en,now()) end,
 activo=p_restaurar where id=p_id;
 return true;
end $$;
-- Una ficha vieja abierta en otro equipo no puede reactivar un eliminado.
create or replace function public.catalogo_proteger_eliminado() returns trigger language plpgsql as $$
begin
 if new.eliminado_en is not null then new.activo:=false; end if;
 return new;
end $$;
create or replace trigger catalogo_eliminado before insert or update on public.productos
 for each row execute function public.catalogo_proteger_eliminado();
revoke all on function public.catalogo_eliminar(uuid,boolean),public.catalogo_proteger_eliminado() from public,anon;
grant execute on function public.catalogo_eliminar(uuid,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
