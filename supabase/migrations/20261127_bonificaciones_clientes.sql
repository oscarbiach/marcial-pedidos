-- Consulta privada. No actualiza pedidos, remitos ni precios del catálogo.
begin;
create table if not exists public.bonif_importaciones(
 sha256 text primary key, fuente text not null, importado_en timestamptz not null default now(), autor uuid not null
);
create table if not exists public.bonif_ventas(
 clave text primary key, fuente_sha text not null references bonif_importaciones(sha256),
 cliente_id uuid references clientes(id), producto_id uuid references productos(id),
 fecha date, comprobante text not null, renglon text not null,
 datos jsonb not null, actualizado_en timestamptz not null default now()
);
create index if not exists bonif_cliente_producto on public.bonif_ventas(cliente_id,producto_id,fecha desc);
alter table public.bonif_ventas add column if not exists stock_producto_id uuid references public.stock_productos(id);
alter table public.bonif_importaciones enable row level security;
alter table public.bonif_ventas enable row level security;
revoke all on public.bonif_importaciones,public.bonif_ventas from public,anon,authenticated;

create or replace function public.bonif_unidad(v text) returns text
language sql immutable set search_path=public as $$
 select case lower(trim(v)) when 'unidad' then 'u' when 'unidades' then 'u' when 'un.' then 'u' when 'kilogramos' then 'kg' when 'kilogramo' then 'kg' else lower(trim(v)) end;
$$;
revoke all on function public.bonif_unidad(text) from public,anon,authenticated;

create or replace function public.admin_bonificaciones_importar(p_fuente text,p_sha text,p_registros jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare x jsonb; cid uuid; pid uuid; sid uuid; ids uuid[]; n integer:=0;
begin
 perform public.admin_exigir();
 if p_sha !~ '^[a-f0-9]{64}$' or nullif(trim(p_fuente),'') is null or jsonb_typeof(p_registros)<>'array' then raise exception 'Archivo de importación inválido'; end if;
 if jsonb_array_length(p_registros)>5000 then raise exception 'Importá hasta 5000 renglones por lote'; end if;
 insert into bonif_importaciones(sha256,fuente,autor) values(p_sha,p_fuente,auth.uid()) on conflict do nothing;
 for x in select value from jsonb_array_elements(p_registros) loop
  if coalesce(x->>'clave','') !~ '^[a-f0-9]{64}$' or nullif(x->>'comprobante','') is null or nullif(x->>'renglon','') is null then raise exception 'Falta identificar el comprobante y renglón'; end if;
  cid:=null;pid:=null;sid:=null;
  if gestion_key(x->>'cliente')<>'consumidor final' and coalesce(x->>'motivo','') not like 'Consumidor Final%' then
   select array_agg(distinct id) into ids from (
    select c.id from clientes c where c.eliminado_en is null and c.fusionado_en is null
     and gestion_key(c.nombre) in (gestion_key(x->>'cliente'),nullif(gestion_key(x->>'comercial'),''))
    union select a.cliente_id from seg_clientes_aliases() a join clientes c on c.id=a.cliente_id
     where c.eliminado_en is null and c.fusionado_en is null and gestion_key(a.alias) in (gestion_key(x->>'cliente'),nullif(gestion_key(x->>'comercial'),''))
   ) t;
   if cardinality(ids)=1 then cid:=ids[1]; end if;
  end if;
  -- Un código solo no vincula: exige descripción/presentación y unidad coincidentes.
  select array_agg(distinct id) into ids from (
   select s.producto_id as id from stock_productos s join productos p on p.id=s.producto_id
    where s.activo and p.activo and s.codigo=x->>'codigo'
     and gestion_key(s.nombre)=gestion_key(x->>'producto') and bonif_unidad(s.unidad)=bonif_unidad(x->>'unidad')
   union select p.id from productos p where p.activo and gestion_key(p.nombre)=gestion_key(x->>'producto')
    and bonif_unidad(p.unidad)=bonif_unidad(x->>'unidad')
  ) t;
  if cardinality(ids)=1 then pid:=ids[1]; end if;
  -- El catálogo de stock también pertenece a la app y conserva los identificadores Dubix.
  -- Solo se usa si no hay una coincidencia ambigua en el catálogo de pedidos.
  if coalesce(cardinality(ids),0)=0 then
   select array_agg(s.id) into ids from stock_productos s where s.activo and s.codigo=x->>'codigo'
    and gestion_key(s.nombre)=gestion_key(x->>'producto') and bonif_unidad(s.unidad)=bonif_unidad(x->>'unidad');
   if cardinality(ids)=1 then sid:=ids[1]; end if;
  end if;
  if x->'referencia' is not null and x->'referencia'<>'null'::jsonb then
   if coalesce((x->>'cantidad')::numeric,0)<=0 or coalesce((x->>'subtotal_con_iva')::numeric,0)<=0
    or coalesce((x->'referencia'->>'lista_con_iva')::numeric,0)<=0 or coalesce((x->'referencia'->>'iva')::numeric,0)<=0
    or nullif(x->>'fecha','') is null then raise exception 'Referencia sin importes o IVA válidos'; end if;
  end if;
  insert into bonif_ventas(clave,fuente_sha,cliente_id,producto_id,stock_producto_id,fecha,comprobante,renglon,datos)
   values(x->>'clave',p_sha,cid,pid,sid,(x->>'fecha')::date,x->>'comprobante',x->>'renglon',x)
   on conflict(clave) do update set fuente_sha=excluded.fuente_sha,cliente_id=excluded.cliente_id,producto_id=excluded.producto_id,
    stock_producto_id=excluded.stock_producto_id,fecha=excluded.fecha,comprobante=excluded.comprobante,renglon=excluded.renglon,datos=excluded.datos,actualizado_en=now();
  n:=n+1;
 end loop;
 return jsonb_build_object('procesados',n,'pendientes_vinculacion',(select count(*) from bonif_ventas where cliente_id is null or coalesce(producto_id,stock_producto_id) is null));
end $$;

create or replace function public.admin_bonificaciones_cliente(p_cliente uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
begin
 perform public.admin_exigir();
 return jsonb_build_object('productos',coalesce((select jsonb_agg(t.d order by t.nombre) from (
  select p.nombre,jsonb_build_object('producto_id',ids.producto_id,'stock_producto_id',ids.stock_producto_id,'producto',p.nombre,'unidad',v.datos->>'unidad',
   'estado',case when v.clave is null then 'Sin referencia verificada' when
    (v.datos->>'subtotal_con_iva')::numeric/(v.datos->>'cantidad')::numeric>(v.datos->'referencia'->>'lista_con_iva')::numeric+.005/(v.datos->>'cantidad')::numeric then 'Sobre lista' else 'Verificada' end,
   'porcentaje',case when v.clave is null then null when abs((v.datos->>'subtotal_con_iva')::numeric-(v.datos->>'cantidad')::numeric*(v.datos->'referencia'->>'lista_con_iva')::numeric)<=.005 then 0 else
    100*(1-(v.datos->>'subtotal_con_iva')::numeric/(v.datos->>'cantidad')::numeric/(v.datos->'referencia'->>'lista_con_iva')::numeric) end,
   'lista_con_iva',v.datos->'referencia'->'lista_con_iva','cobrado_con_iva',case when v.clave is not null then (v.datos->>'subtotal_con_iva')::numeric/(v.datos->>'cantidad')::numeric end,
   'iva',v.datos->'referencia'->'iva','fecha',v.fecha,'comprobante',v.comprobante,'renglon',v.renglon,'fila_excel',v.datos->'fila_excel') d
  from (select distinct producto_id,stock_producto_id from bonif_ventas where cliente_id=p_cliente and coalesce(producto_id,stock_producto_id) is not null) ids
  cross join lateral(select nombre from productos where id=ids.producto_id union all select nombre from stock_productos where id=ids.stock_producto_id and ids.producto_id is null) p
  left join lateral(select b.* from bonif_ventas b where b.cliente_id=p_cliente and b.producto_id is not distinct from ids.producto_id and b.stock_producto_id is not distinct from ids.stock_producto_id
   and b.datos->'referencia' is not null and b.datos->'referencia'<>'null'::jsonb
   order by b.fecha desc,(b.datos->>'emitido_en')::timestamp desc nulls last,b.comprobante desc,(b.renglon)::integer desc limit 1) v on true
 ) t),'[]'::jsonb),'pendientes_vinculacion',(select count(*) from bonif_ventas where cliente_id=p_cliente and coalesce(producto_id,stock_producto_id) is null));
end $$;
revoke all on function public.admin_bonificaciones_importar(text,text,jsonb),public.admin_bonificaciones_cliente(uuid) from public,anon;
grant execute on function public.admin_bonificaciones_importar(text,text,jsonb),public.admin_bonificaciones_cliente(uuid) to authenticated;

create or replace function public.admin_bonificaciones_resumen() returns jsonb
language plpgsql stable security definer set search_path=public as $$
begin
 perform public.admin_exigir();
 return jsonb_build_object(
  'renglones_importados',(select count(*) from bonif_ventas),
  'referencias_visibles',(select count(distinct (cliente_id,producto_id,stock_producto_id)) from bonif_ventas
    where cliente_id is not null and coalesce(producto_id,stock_producto_id) is not null and datos->'referencia' is not null and datos->'referencia'<>'null'::jsonb),
  'renglones_pendientes_vinculacion',(select count(*) from bonif_ventas where cliente_id is null or coalesce(producto_id,stock_producto_id) is null),
  'renglones_sin_referencia_valida',(select count(*) from bonif_ventas where datos->'referencia' is null or datos->'referencia'='null'::jsonb),
  'motivos',(select jsonb_object_agg(motivo,n) from (select coalesce(datos->>'motivo','Verificable') motivo,count(*) n from bonif_ventas group by 1) t));
end $$;
revoke all on function public.admin_bonificaciones_resumen() from public,anon;
grant execute on function public.admin_bonificaciones_resumen() to authenticated;
commit;
