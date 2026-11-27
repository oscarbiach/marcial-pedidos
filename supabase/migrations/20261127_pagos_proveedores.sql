begin;
create table public.proveedores_pagos_acceso (
 user_id uuid primary key references auth.users(id), nombre text not null,
 puede_transferir boolean not null default false, puede_cargar boolean not null default false
);
insert into public.proveedores_pagos_acceso(user_id,nombre,puede_transferir,puede_cargar)
 select user_id,nombre,nombre='Thiago',nombre='Joaquin' from public.notas_acceso where nombre in ('Oscar','Joaquin','Thiago');
create table public.proveedores_pagos (
 id uuid primary key, proveedor text not null check(length(trim(proveedor)) between 1 and 160),
 importe numeric(14,2) not null check(importe>0 and importe<1000000000000),
 fecha_prevista date not null, eliminado_en timestamptz,
 estado text not null default 'pendiente' check(estado in ('pendiente','transferido')),
 creado_por uuid not null references auth.users(id), creado_en timestamptz not null default now(),
 actualizado_en timestamptz not null default now(), version integer not null default 1,
 transferido_por uuid references auth.users(id), transferido_en timestamptz,
 check((estado='transferido')=(transferido_por is not null and transferido_en is not null))
);
create index proveedores_pagos_fecha on public.proveedores_pagos(estado,fecha_prevista);
create table public.proveedores_pagos_operaciones (
 id uuid primary key, usuario uuid not null, solicitud jsonb not null, resultado jsonb not null
);
alter table public.proveedores_pagos_acceso enable row level security;
alter table public.proveedores_pagos enable row level security;
alter table public.proveedores_pagos_operaciones enable row level security;
revoke all on public.proveedores_pagos_acceso,public.proveedores_pagos,public.proveedores_pagos_operaciones from anon,authenticated;

create function public.proveedores_pagos_leer() returns jsonb language plpgsql stable security definer set search_path=public as $$
declare yo proveedores_pagos_acceso;
begin
 select * into yo from proveedores_pagos_acceso where user_id=auth.uid();
 if not found then raise exception 'No tenés acceso a pagos de proveedores' using errcode='42501';end if;
 return jsonb_build_object('puede_transferir',yo.puede_transferir,'puede_cargar',yo.puede_cargar,'pagos',(
  select coalesce(jsonb_agg(to_jsonb(x) order by x.fecha_prevista,x.creado_en),'[]') from (
   select p.*,a.nombre as autor,t.nombre as transferido_por_nombre from proveedores_pagos p
   join proveedores_pagos_acceso a on a.user_id=p.creado_por
   left join proveedores_pagos_acceso t on t.user_id=p.transferido_por
  )x));
end $$;

create function public.proveedores_pagos_guardar(p_op uuid,p_id uuid,p_version integer,p_accion text,p_datos jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=public as $$
declare yo proveedores_pagos_acceso; pago proveedores_pagos; anterior proveedores_pagos_operaciones;
 req jsonb:=jsonb_build_object('id',p_id,'version',p_version,'accion',p_accion,'datos',p_datos);res jsonb;
begin
 select * into yo from proveedores_pagos_acceso where user_id=auth.uid();
 if not found then raise exception 'No tenés acceso a pagos de proveedores' using errcode='42501';end if;
 if p_op is null or p_id is null or p_version is null or p_accion is null or p_accion not in ('guardar','transferir','reabrir','eliminar','restaurar') then raise exception 'Operación inválida';end if;
 if p_accion in ('transferir','reabrir') and not yo.puede_transferir then raise exception 'Solo la persona encargada de transferir puede marcar este pago' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtext(p_op::text));
 select * into anterior from proveedores_pagos_operaciones where id=p_op;
 if found then
  if anterior.usuario<>yo.user_id or anterior.solicitud<>req then raise exception 'Operación ya utilizada';end if;
  return anterior.resultado;
 end if;
 perform pg_advisory_xact_lock(hashtext('proveedor:'||p_id::text));
 select * into pago from proveedores_pagos where id=p_id for update;
 if (pago.id is null and p_version<>0) or (pago.id is not null and pago.version<>p_version) then raise exception 'El pago cambió. Actualizá antes de continuar.' using errcode='40001';end if;
 if p_accion='guardar' then
  if pago.id is null and not yo.puede_cargar then raise exception 'Solo Joaquín puede cargar pagos' using errcode='42501';end if;
  if pago.eliminado_en is not null then raise exception 'Restaurá el pago antes de editarlo';end if;
  if p_datos is null or jsonb_typeof(p_datos)<>'object' or nullif(trim(p_datos->>'proveedor'),'') is null or nullif(p_datos->>'importe','') is null or nullif(p_datos->>'fecha_prevista','') is null then raise exception 'Completá proveedor, importe y fecha';end if;
  insert into proveedores_pagos(id,proveedor,importe,fecha_prevista,creado_por)
  values(p_id,trim(p_datos->>'proveedor'),(p_datos->>'importe')::numeric,(p_datos->>'fecha_prevista')::date,yo.user_id)
  on conflict(id) do update set proveedor=excluded.proveedor,importe=excluded.importe,fecha_prevista=excluded.fecha_prevista,actualizado_en=now(),version=proveedores_pagos.version+1
  returning * into pago;
 else
  if pago.id is null then raise exception 'No se encontró el pago';end if;
  if p_accion in ('transferir','reabrir') then
   if pago.eliminado_en is not null then raise exception 'El pago está eliminado';end if;
   if p_accion='reabrir' and pago.estado<>'transferido' then raise exception 'El pago no está pagado';end if;
   if p_accion='transferir' and pago.estado<>'pendiente' then raise exception 'El pago ya no está pendiente';end if;
   update proveedores_pagos set estado=case p_accion when 'transferir' then 'transferido' else 'pendiente' end,
    transferido_por=case when p_accion='transferir' then yo.user_id else null end,
    transferido_en=case when p_accion='transferir' then clock_timestamp() else null end,
    actualizado_en=clock_timestamp(),version=version+1 where id=p_id returning * into pago;
  else
   update proveedores_pagos set eliminado_en=case when p_accion='eliminar' then clock_timestamp() else null end,
    actualizado_en=clock_timestamp(),version=version+1 where id=p_id returning * into pago;
  end if;
 end if;
 res:=jsonb_build_object('ok',true,'pago',to_jsonb(pago));
 insert into proveedores_pagos_operaciones values(p_op,yo.user_id,req,res);
 return res;
end $$;
revoke all on function public.proveedores_pagos_leer(),public.proveedores_pagos_guardar(uuid,uuid,integer,text,jsonb) from public,anon;
grant execute on function public.proveedores_pagos_leer(),public.proveedores_pagos_guardar(uuid,uuid,integer,text,jsonb) to authenticated;
create trigger auditoria_cambio after insert or update or delete on public.proveedores_pagos for each row execute function public.auditoria_capturar();
notify pgrst,'reload schema';
commit;
