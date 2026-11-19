begin;
create or replace function public.gestion_key(t text) returns text language sql immutable as $$
 select lower(regexp_replace(trim(translate(coalesce(t,''),'ÁÉÍÓÚÜáéíóúü','AEIOUUaeiouu')),'\s+',' ','g'));
$$;
create table if not exists public.notas_acceso(user_id uuid primary key references auth.users(id),nombre text not null);
alter table public.notas_acceso enable row level security;
insert into notas_acceso select user_id,nombre from stock_acceso where nombre in ('Oscar','Joaquin') on conflict do nothing;
do $$ begin
 if (select count(*) from auth.users where split_part(email,'@',1)='thiago')<>1 then raise exception 'Revisar identidad de Thiago'; end if;
 insert into notas_acceso select id,'Thiago' from auth.users where split_part(email,'@',1)='thiago' on conflict do nothing;
end $$;
create or replace function public.notas_autor() returns text language sql stable security definer set search_path=public as $$
 select nombre from notas_acceso where user_id=auth.uid();
$$;
revoke all on function public.notas_autor() from public,anon;
grant execute on function public.notas_autor() to authenticated;

create table if not exists public.catalogo_decisiones(
 clave text primary key,texto text not null,estado text not null check(estado in ('pendiente','descartado','vinculado')),
 producto_id uuid references productos(id),autor text not null,actualizado_en timestamptz not null default now()
);
alter table public.catalogo_decisiones enable row level security;
create policy catalogo_decisiones_leer on public.catalogo_decisiones for select to authenticated using(stock_es_admin());

create or replace function public.catalogo_leer() returns jsonb language plpgsql security definer set search_path=public as $$
declare pendientes jsonb;
begin
 if not stock_es_admin() then raise exception 'Sin acceso a Productos' using errcode='42501'; end if;
 with escritos as (
  select i.producto as texto,p.id,p.cliente,p.fecha from pedido_items i join pedidos p on p.id=i.pedido_id where p.eliminado_en is null
  union all
  select x.sustituto,p.id,p.cliente,p.fecha from prep_items x join pedido_items i on i.id=x.item_id join pedidos p on p.id=i.pedido_id where p.eliminado_en is null and nullif(trim(x.sustituto),'') is not null
 ), agrupados as (
  select gestion_key(texto) clave,min(trim(texto)) texto,count(distinct id) usos,max(fecha) ultima,min(cliente) cliente
  from escritos where nullif(trim(texto),'') is not null group by gestion_key(texto)
 ) select coalesce(jsonb_agg(to_jsonb(a) order by a.ultima desc,a.texto),'[]') into pendientes from agrupados a
 where not exists(select 1 from productos p where gestion_key(p.nombre)=a.clave)
 and not exists(select 1 from catalogo_decisiones d where d.clave=a.clave and (d.estado='descartado' or d.estado='vinculado' and exists(select 1 from productos p where p.id=d.producto_id)));
 return jsonb_build_object('productos',(select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('frio',coalesce(m.frio,true),'se_pesa',coalesce(m.se_pesa,false)) order by p.nombre),'[]') from productos p left join prep_productos m on m.nombre=p.nombre),
 'pendientes',pendientes,'decisiones',(select coalesce(jsonb_agg(to_jsonb(d)||jsonb_build_object('producto',p.nombre) order by d.actualizado_en desc),'[]') from catalogo_decisiones d left join productos p on p.id=d.producto_id where d.estado<>'pendiente'));
end $$;

create or replace function public.catalogo_resolver(p_texto text,p_accion text,p_producto uuid default null) returns boolean language plpgsql security definer set search_path=public as $$
begin
 if not stock_es_admin() then raise exception 'Sin acceso a Productos' using errcode='42501'; end if;
 if nullif(trim(p_texto),'') is null or p_accion not in ('pendiente','descartado','vinculado') then raise exception 'Revisá la acción'; end if;
 if p_accion='vinculado' and not exists(select 1 from productos where id=p_producto) then raise exception 'Elegí un producto del catálogo'; end if;
 insert into catalogo_decisiones(clave,texto,estado,producto_id,autor) values(gestion_key(p_texto),trim(p_texto),p_accion,case when p_accion='vinculado' then p_producto end,stock_autor())
 on conflict(clave) do update set estado=excluded.estado,producto_id=excluded.producto_id,autor=excluded.autor,actualizado_en=now();return true;
end $$;

create or replace function public.catalogo_guardar(p_id uuid,p_datos jsonb,p_origen text default null) returns uuid language plpgsql security definer set search_path=public as $$
declare pid uuid; nombre_actual text; n text:=trim(p_datos->>'nombre'); u text:=p_datos->>'unidad'; caja integer:=coalesce((p_datos->>'unidades_por_caja')::integer,0); meds text[];
begin
 if not stock_es_admin() then raise exception 'Sin acceso a Productos' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtext('catalogo_guardar'));
 if nullif(n,'') is null or length(n)>200 or u not in ('unidad','caja','kg','tira') or u is null or caja<0 then raise exception 'Revisá nombre, medida y unidades por caja'; end if;
 if exists(select 1 from productos where gestion_key(nombre)=gestion_key(n) and id is distinct from p_id) then raise exception 'Ya existe un producto con ese nombre'; end if;
 select array_agg(value) into meds from jsonb_array_elements_text(coalesce(p_datos->'medidas','[]'));
 if meds is not null and not meds<@array['unidad','caja','kg','tira'] then raise exception 'Medidas no válidas'; end if;
 if meds is not null and not u=any(meds) then meds:=array_prepend(u,meds); end if;
 if p_id is null then
  insert into productos(nombre,unidad,unidades_por_caja,se_fetea,activo,alterna_unidad,caja_en,medidas)
  values(n,u,caja,coalesce((p_datos->>'se_fetea')::boolean,false),coalesce((p_datos->>'activo')::boolean,true),coalesce((p_datos->>'alterna_unidad')::boolean,false),case when p_datos->>'caja_en'='kg' then 'kg' else 'u' end,meds) returning id into pid;
 else
  select nombre into nombre_actual from productos where id=p_id for update;
  if not found then raise exception 'El producto ya no existe'; end if;
  if n<>nombre_actual then raise exception 'El nombre de un producto existente se conserva para no alterar pedidos'; end if;
  update productos set unidad=u,unidades_por_caja=caja,se_fetea=coalesce((p_datos->>'se_fetea')::boolean,false),activo=coalesce((p_datos->>'activo')::boolean,true),alterna_unidad=coalesce((p_datos->>'alterna_unidad')::boolean,false),caja_en=case when p_datos->>'caja_en'='kg' then 'kg' else 'u' end,medidas=meds where id=p_id;pid:=p_id;
 end if;
 insert into prep_productos(nombre,frio,se_pesa) values(n,coalesce((p_datos->>'frio')::boolean,true),coalesce((p_datos->>'se_pesa')::boolean,false)) on conflict(nombre) do update set frio=excluded.frio,se_pesa=excluded.se_pesa,actualizado_en=now();
 if nullif(trim(p_origen),'') is not null then perform catalogo_resolver(p_origen,'vinculado',pid); end if;
 return pid;
end $$;

-- Los alias son información del catálogo, disponible para cargar pedidos.
create or replace function public.catalogo_aliases() returns jsonb language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is null then raise exception 'Iniciá sesión' using errcode='42501'; end if;
 return (select coalesce(jsonb_object_agg(d.clave,p.nombre),'{}') from catalogo_decisiones d join productos p on p.id=d.producto_id where d.estado='vinculado');
end $$;

create table if not exists public.app_notas(
 id uuid primary key,cliente text not null default '',texto text not null check(length(trim(texto)) between 1 and 2000),
 fecha date,estado text not null default 'pendiente' check(estado in ('pendiente','resuelta','archivada')),
 autor text not null,actualizado_por text not null,creado_en timestamptz not null default now(),actualizado_en timestamptz not null default now(),version integer not null default 1
);
alter table public.app_notas enable row level security;
create policy notas_leer on public.app_notas for select to authenticated using(notas_autor() is not null);
create or replace function public.notas_leer() returns jsonb language plpgsql security definer set search_path=public as $$
begin
 if notas_autor() is null then raise exception 'Sin acceso a Notas' using errcode='42501'; end if;
 return (select coalesce(jsonb_agg(to_jsonb(n) order by n.fecha nulls last,n.creado_en desc),'[]') from app_notas n);
end $$;
create or replace function public.notas_guardar(p_id uuid,p_version integer,p_cliente text,p_texto text,p_fecha date,p_estado text) returns public.app_notas language plpgsql security definer set search_path=public as $$
declare quien text:=notas_autor(); n app_notas;
begin
 if quien is null then raise exception 'Sin acceso a Notas' using errcode='42501'; end if;
 if nullif(trim(p_texto),'') is null or length(p_texto)>2000 or p_estado not in ('pendiente','resuelta','archivada') or p_estado is null then raise exception 'Revisá el texto y estado de la nota'; end if;
 if p_version=0 then
  insert into app_notas(id,cliente,texto,fecha,estado,autor,actualizado_por) values(p_id,coalesce(trim(p_cliente),''),trim(p_texto),p_fecha,p_estado,quien,quien) on conflict(id) do nothing;
  select * into n from app_notas where id=p_id;return n;
 end if;
 update app_notas set cliente=coalesce(trim(p_cliente),''),texto=trim(p_texto),fecha=p_fecha,estado=p_estado,actualizado_por=quien,actualizado_en=now(),version=version+1 where id=p_id and version=p_version returning * into n;
 if not found then raise exception 'Otro compañero cambió esta nota. Actualizá para revisarla.' using errcode='40001'; end if;
 return n;
end $$;
revoke all on function public.catalogo_leer(),public.catalogo_resolver(text,text,uuid),public.catalogo_guardar(uuid,jsonb,text),public.catalogo_aliases(),public.notas_leer(),public.notas_guardar(uuid,integer,text,text,date,text) from public,anon;
grant execute on function public.catalogo_leer(),public.catalogo_resolver(text,text,uuid),public.catalogo_guardar(uuid,jsonb,text),public.catalogo_aliases(),public.notas_leer(),public.notas_guardar(uuid,integer,text,text,date,text) to authenticated;
grant select on public.app_notas,public.catalogo_decisiones to authenticated;
do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='app_notas') then alter publication supabase_realtime add table public.app_notas; end if;
end $$;
notify pgrst,'reload schema';
commit;
