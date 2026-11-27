-- Juan Marcos: cartera propia + atención general. No cambia asignaciones de clientes.
begin;
alter table public.seg_usuarios add column if not exists ve_sin_vendedor boolean not null default false;
update public.seg_usuarios set ve_todo = false, ve_sin_vendedor = true
where lower(trim(nombre)) = 'juan marcos';

create or replace function public.seg_ve_sin_vendedor() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select ve_sin_vendedor from public.seg_usuarios where user_id = auth.uid()), false);
$$;
revoke all on function public.seg_ve_sin_vendedor() from public, anon;
grant execute on function public.seg_ve_sin_vendedor() to authenticated;

create or replace function public.seg_yo() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when public.seg_nombre() is null then null
    else jsonb_build_object('nombre', public.seg_nombre(), 've_todo', public.seg_es_ve_todo(),
      'gestor', public.seg_es_gestor(), 've_sin_vendedor', public.seg_ve_sin_vendedor()) end;
$$;

create or replace function public.seg_puede_cliente(p_cliente_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.seg_es_ve_todo() or exists (
    select 1 from public.clientes c where c.id = p_cliente_id and (
      (nullif(trim(c.vendedor), '') is not null
        and lower(trim(c.vendedor)) = lower(trim(coalesce(public.seg_nombre(), ''))))
      or (public.seg_ve_sin_vendedor() and nullif(trim(c.vendedor), '') is null)));
$$;

-- Conserva la definición instalada y cualquier otra condición de lectura.
-- Incluye explícitamente los clientes generales: faltar en metadata NO significa «sin vendedor».
do $$
declare v text := pg_get_functiondef('public.seg_clientes_meta()'::regprocedure);
  viejo text := '(v_gestor or lower(trim(coalesce(c.vendedor, ''''))) = v_yo)';
  nuevo text := '(v_gestor or public.seg_puede_cliente(c.id))';
  viejo_meta text := 'and (nullif(trim(coalesce(c.vendedor, '''')), '''') is not null';
  nuevo_meta text := 'and (public.seg_ve_sin_vendedor() or nullif(trim(coalesce(c.vendedor, '''')), '''') is not null';
begin
  if position(viejo in v) > 0 and position(viejo_meta in v) > 0 then
    execute replace(replace(v, viejo, nuevo), viejo_meta, nuevo_meta);
  elsif position(nuevo in v) = 0 or position(nuevo_meta in v) = 0 then
    raise exception 'La función de clientes cambió: revisar antes de aplicar';
  end if;
end $$;
commit;
