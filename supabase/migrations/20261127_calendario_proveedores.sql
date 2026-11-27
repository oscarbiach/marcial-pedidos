begin;
-- El mismo permiso controla las lecturas de la semana y las escrituras.
create function public.proveedores_llegadas_acceso() returns boolean
language sql stable set search_path='' as $$
  select coalesce(auth.uid() in (
    'dbcd0e59-fc02-4c23-b1d6-aba342da21e8'::uuid, -- Oscar
    'e3e52cc0-d8e3-41e0-a641-26e33ffbcde6'::uuid, -- Joaquín
    'b8b830b5-2268-4e92-897e-36f8f74135ea'::uuid  -- Thiago
  ),false)
$$;
revoke all on function public.proveedores_llegadas_acceso() from public,anon;
grant execute on function public.proveedores_llegadas_acceso() to authenticated;

create table public.proveedores_llegadas (
  id uuid primary key,
  proveedor text not null check(length(trim(proveedor)) between 1 and 120),
  detalle text not null default '' check(length(detalle)<=300),
  fecha date not null check(extract(isodow from fecha) between 1 and 5),
  hora time,
  recibido boolean not null default false,
  version integer not null default 1 check(version>0)
);
create index proveedores_llegadas_fecha on public.proveedores_llegadas(fecha,id);
alter table public.proveedores_llegadas enable row level security;
revoke all on public.proveedores_llegadas from public,anon,authenticated;
grant select on public.proveedores_llegadas to authenticated;
create policy llegadas_leer on public.proveedores_llegadas for select to authenticated using ((select public.proveedores_llegadas_acceso()));

create function public.proveedores_llegadas_guardar(p_id uuid,p_proveedor text,p_detalle text,p_fecha date,p_hora time,p_recibido boolean,p_version integer)
returns void language plpgsql security definer set search_path='' as $$
declare fila public.proveedores_llegadas;
begin
  if not public.proveedores_llegadas_acceso() then raise exception 'Sin permiso para gestionar llegadas' using errcode='42501'; end if;
  if p_version is null or p_version<0 then raise exception 'Versión inválida'; end if;
  p_proveedor:=trim(p_proveedor);p_detalle:=trim(coalesce(p_detalle,''));
  if p_version=0 then
    insert into public.proveedores_llegadas(id,proveedor,detalle,fecha,hora,recibido)
      values(p_id,p_proveedor,p_detalle,p_fecha,p_hora,p_recibido) on conflict(id) do nothing;
    if found then return; end if;
  end if;
  select * into fila from public.proveedores_llegadas where id=p_id for update;
  -- Un reintento tras perder la respuesta puede confirmar la misma escritura.
  if found and fila.version=p_version+1 and
    (fila.proveedor,fila.detalle,fila.fecha,fila.hora,fila.recibido)
    is not distinct from (p_proveedor,p_detalle,p_fecha,p_hora,p_recibido) then return; end if;
  if fila.version is distinct from p_version then raise exception 'La llegada cambió. Cerrá la ficha y volvé a abrir el calendario.' using errcode='40001'; end if;
  update public.proveedores_llegadas set proveedor=p_proveedor,detalle=p_detalle,fecha=p_fecha,hora=p_hora,recibido=p_recibido,version=version+1 where id=p_id;
end $$;
revoke all on function public.proveedores_llegadas_guardar(uuid,text,text,date,time,boolean,integer) from public,anon;
grant execute on function public.proveedores_llegadas_guardar(uuid,text,text,date,time,boolean,integer) to authenticated;
commit;
