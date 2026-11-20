-- Panel de administración (solo Oscar y Joaquín): Productos, Clientes e Historial de pedidos.
--
-- Decisiones:
--  * Permisos: todas las funciones admin_* validan stock_es_admin() (tabla stock_acceso por auth.uid())
--    y el autor sale siempre de stock_autor(), nunca del navegador. Sin sesión o sin acceso: 42501.
--  * pedidos.fecha_pedido = «fecha real en que el cliente hizo el pedido». null = no corregida (vale pedidos.fecha).
--    pedidos.creado_en NO es confiable en pedidos viejos importados, por eso la corrección es un campo aparte.
--    La app usa coalesce(fecha_pedido, fecha) para frecuencia, último pedido y orden del historial.
--  * Clientes: los pedidos se vinculan por TEXTO (lower(trim(cliente)) = clientes.nombre_key). Renombrar un
--    cliente actualiza ese texto en la misma transacción en pedidos (todos, incluidos eliminados), pedidos_fijos,
--    app_notas, pedidos_a_cargar, whatsapp_contacts.linked_client_name y whatsapp_client_review.client_name
--    (cola de «vínculos diferidos» indexada por nombre: acompaña al cliente). Quedan intactos los snapshots
--    históricos (seg_decisiones/seg_reglas_producto.cliente_nombre, hojas_reparto.clientes) y el log whatsapp_link_log.
--    El trigger prep_al_cambiar_pedido desmarcaría remito/control al cambiar el nombre: en pedidos que NO están
--    Pendientes (ya despachados, cancelados o eliminados) se restauran esos dos valores tal como estaban.
--  * Baja de cliente = soft delete (eliminado_en/eliminado_por). No se borra ni se toca ningún pedido.
--  * Idempotencia: cada escritura lleva p_op (uuid generado una vez por intento en el navegador). Si el op ya
--    figura en admin_cambios se devuelve el resultado guardado sin repetir nada.
--  * Concurrencia: p_version = actualizado_en leído; si no coincide: «Otro cambio se guardó antes: recargá».
--  * admin_cambios: registro de antes/después. RLS sin políticas y sin permisos de tabla: solo se lee por función.
--
-- Cómo volver atrás (nada de esto toca datos existentes):
--   drop function admin_pedidos_buscar(text,date,date,text,jsonb,int), admin_pedido_leer(text),
--     admin_pedido_guardar(uuid,text,timestamptz,jsonb), admin_clientes_listar(text,boolean),
--     admin_cliente_impacto(uuid), admin_cliente_guardar(uuid,uuid,timestamptz,jsonb),
--     admin_cliente_baja(uuid,uuid,boolean), admin_cambios_leer(text,text), admin_pedido_json(text),
--     admin_key(text), admin_hoy(), admin_exigir();
--   drop table admin_cambios;
--   alter table pedidos drop constraint pedidos_fecha_pedido_chk, drop column fecha_pedido;   -- pierde las correcciones
--   alter table clientes drop column eliminado_en, drop column eliminado_por, drop column actualizado_en;
begin;

alter table public.pedidos add column if not exists fecha_pedido date;
do $$ begin
 if not exists(select 1 from pg_constraint where conname='pedidos_fecha_pedido_chk' and conrelid='public.pedidos'::regclass) then
  alter table public.pedidos add constraint pedidos_fecha_pedido_chk check(fecha_pedido is null or fecha_pedido<=fecha);
 end if;
end $$;
comment on column public.pedidos.fecha_pedido is 'Fecha real en que el cliente hizo el pedido. null = no corregida (vale fecha, el día de carga).';

alter table public.clientes add column if not exists eliminado_en timestamptz;
alter table public.clientes add column if not exists eliminado_por text;
alter table public.clientes add column if not exists actualizado_en timestamptz not null default now();

create table if not exists public.admin_cambios(
 id bigint generated always as identity primary key,
 op_id uuid unique,
 tabla text not null,
 registro text not null,
 accion text not null,
 antes jsonb,
 despues jsonb,
 resultado jsonb,           -- lo que devolvió la operación: un reintento con el mismo op recibe esto
 autor text not null,
 en timestamptz not null default now()
);
create index if not exists admin_cambios_registro on public.admin_cambios(tabla,registro,en desc);
alter table public.admin_cambios enable row level security;
revoke all on public.admin_cambios from public,anon,authenticated;

-- ── Auxiliares (no se exponen) ──
create or replace function public.admin_key(t text) returns text language sql immutable as $$
 select lower(regexp_replace(trim(translate(coalesce(t,''),'ÁÉÍÓÚÜáéíóúü','AEIOUUaeiouu')),'\s+',' ','g'));
$$;
create or replace function public.admin_hoy() returns date language sql stable as $$
 select (now() at time zone 'America/Argentina/Buenos_Aires')::date;
$$;
create or replace function public.admin_exigir() returns void language plpgsql stable security definer set search_path=public as $$
begin
 if not stock_es_admin() then raise exception 'Sin acceso al panel de administración' using errcode='42501'; end if;
end $$;
revoke all on function public.admin_key(text),public.admin_hoy(),public.admin_exigir() from public,anon,authenticated;

create or replace function public.admin_pedido_json(p_id text) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object(
  'pedido',jsonb_build_object('id',p.id,'cliente',p.cliente,'direccion',p.direccion,'notas',p.notas,'quien',p.quien,
    'fecha',p.fecha,'fecha_pedido',p.fecha_pedido,'creado_en',p.creado_en,'fecha_entrega',p.fecha_entrega,'fecha_despacho',p.fecha_despacho,
    'estado',p.estado,'retiro',coalesce(p.retiro,false),'eliminado_en',p.eliminado_en,'eliminado_por',p.eliminado_por,'version',p.actualizado_en),
  'items',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'producto',i.producto,'cantidad',i.cantidad,'medida',i.medida,'fetear',coalesce(i.fetear,false),'sin_cuero',coalesce(i.sin_cuero,false)) order by i.orden,i.id)
    from pedido_items i where i.pedido_id=p.id),'[]'),
  -- Para avisar antes de guardar: cambiar cliente/dirección/observación/entrega/retiro desmarca remito y control.
  'armado',jsonb_build_object('remito_hecho',coalesce(p.remito_hecho,false),'controlado',coalesce(pp.controlado,false),'cargado',coalesce(pp.cargado,false),'etapa',pc.etapa))
 from pedidos p left join prep_pedidos pp on pp.pedido_id=p.id left join prep_cola pc on pc.pedido_id=p.id where p.id=p_id
$$;
revoke all on function public.admin_pedido_json(text) from public,anon,authenticated;

create or replace function public.admin_cliente_json(p_id uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('id',c.id,'nombre',c.nombre,'direccion',c.direccion,'eliminado_en',c.eliminado_en,'eliminado_por',c.eliminado_por,'version',c.actualizado_en,'creado_en',c.creado_en)
 from clientes c where c.id=p_id
$$;
revoke all on function public.admin_cliente_json(uuid) from public,anon,authenticated;

-- ── Historial de pedidos ──
create or replace function public.admin_pedidos_buscar(p_q text,p_desde date,p_hasta date,p_estado text,p_cursor jsonb,p_limite int default 30)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare lim int:=least(greatest(coalesce(p_limite,30),1),100); q text:=admin_key(p_q); est text:=coalesce(nullif(p_estado,''),'todos'); cf date; ci text; filas jsonb; n int;
begin
 perform admin_exigir();
 if est not in ('todos','Pendiente','Despachado','Cancelado','Eliminado') then raise exception 'Estado no válido'; end if;
 if p_cursor is not null and p_cursor<>'null'::jsonb then cf:=(p_cursor->>'f')::date; ci:=p_cursor->>'id'; end if;
 with pag as (
  select p.*,coalesce(p.fecha_pedido,p.fecha) as efecha from pedidos p
  where (q='' or position(q in admin_key(p.cliente))>0)
   and (p_desde is null or coalesce(p.fecha_pedido,p.fecha)>=p_desde)
   and (p_hasta is null or coalesce(p.fecha_pedido,p.fecha)<=p_hasta)
   and case est when 'todos' then true when 'Eliminado' then p.eliminado_en is not null else p.eliminado_en is null and p.estado=est end
   and (cf is null or (coalesce(p.fecha_pedido,p.fecha),p.id)<(cf,ci))
  order by coalesce(p.fecha_pedido,p.fecha) desc,p.id desc limit lim+1
 ), num as (select pag.*,row_number() over(order by efecha desc,id desc) as rn from pag)
 select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'cliente',x.cliente,'fecha',x.fecha,'fecha_pedido',x.fecha_pedido,'creado_en',x.creado_en,
   'fecha_entrega',x.fecha_entrega,'fecha_despacho',x.fecha_despacho,'estado',x.estado,'eliminado_en',x.eliminado_en,'retiro',coalesce(x.retiro,false),
   'renglones',r.n,'resumen',r.resumen) order by x.efecha desc,x.id desc) filter(where x.rn<=lim),'[]'),count(*) into filas,n
 from num x left join lateral (
  select count(*)::int as n,
   (select string_agg(s.producto,', ' order by s.orden,s.id) from (select i2.producto,i2.orden,i2.id from pedido_items i2 where i2.pedido_id=x.id order by i2.orden,i2.id limit 3) s) as resumen
  from pedido_items i where i.pedido_id=x.id) r on true;
 return jsonb_build_object('filas',filas,'hay_mas',n>lim,
  'siguiente',case when n>lim then jsonb_build_object('f',coalesce(filas->-1->>'fecha_pedido',filas->-1->>'fecha'),'id',filas->-1->>'id') end);
end $$;

create or replace function public.admin_pedido_leer(p_id text) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare r jsonb;
begin
 perform admin_exigir();
 r:=admin_pedido_json(p_id);
 if r is null then raise exception 'El pedido no existe'; end if;
 return r;
end $$;

create or replace function public.admin_pedido_guardar(p_op uuid,p_id text,p_version timestamptz,p_datos jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare ped pedidos; permitidos text[]; k text; res jsonb; previo admin_cambios; autor text;
 nfp date; ncli text; ndir text; nnotas text; nent date; nret boolean;
 antes jsonb:='{}'; despues jsonb:='{}'; hubo boolean:=false;
begin
 perform admin_exigir();
 if p_op is null then raise exception 'Falta el identificador de la operación'; end if;
 select * into previo from admin_cambios where op_id=p_op;
 if found then
  if previo.tabla<>'pedidos' or previo.registro<>p_id then raise exception 'Operación ya usada en otro registro'; end if;
  return previo.resultado;
 end if;
 if p_datos is null or jsonb_typeof(p_datos)<>'object' then raise exception 'Datos no válidos'; end if;
 select * into ped from pedidos where id=p_id for update;
 if not found then raise exception 'El pedido no existe'; end if;
 if ped.eliminado_en is not null then raise exception 'Un pedido eliminado no se puede modificar'; end if;
 if p_version is distinct from ped.actualizado_en then raise exception 'Otro cambio se guardó antes: recargá'; end if;
 permitidos:=case when ped.estado='Pendiente' then array['fecha_pedido','cliente','direccion','notas','fecha_entrega','retiro'] else array['fecha_pedido'] end;
 for k in select jsonb_object_keys(p_datos) loop
  if not k=any(permitidos) then raise exception 'El campo % no se puede modificar en un pedido %',k,ped.estado; end if;
 end loop;
 nfp:=ped.fecha_pedido;ncli:=ped.cliente;ndir:=ped.direccion;nnotas:=ped.notas;nent:=ped.fecha_entrega;nret:=ped.retiro;
 if p_datos?'fecha_pedido' then
  nfp:=nullif(p_datos->>'fecha_pedido','')::date;
  if nfp is not null and nfp>ped.fecha then raise exception 'La fecha del pedido no puede ser posterior al día de carga (%)',ped.fecha; end if;
  if nfp is not null and nfp>admin_hoy() then raise exception 'La fecha del pedido no puede ser futura'; end if;
 end if;
 if p_datos?'cliente' then
  ncli:=trim(coalesce(p_datos->>'cliente',''));
  if ncli='' or length(ncli)>200 then raise exception 'Escribí el cliente (hasta 200 letras)'; end if;
  ncli:=coalesce((select c.nombre from clientes c where c.nombre_key=lower(trim(ncli)) limit 1),ncli);
 end if;
 if p_datos?'direccion' then ndir:=p_datos->>'direccion'; end if;
 if p_datos?'notas' then nnotas:=p_datos->>'notas'; end if;
 if p_datos?'fecha_entrega' then nent:=nullif(p_datos->>'fecha_entrega','')::date; end if;
 if p_datos?'retiro' then nret:=(p_datos->>'retiro')::boolean; end if;
 if nfp is distinct from ped.fecha_pedido then antes:=antes||jsonb_build_object('fecha_pedido',ped.fecha_pedido);despues:=despues||jsonb_build_object('fecha_pedido',nfp);hubo:=true; end if;
 if ncli is distinct from ped.cliente then antes:=antes||jsonb_build_object('cliente',ped.cliente);despues:=despues||jsonb_build_object('cliente',ncli);hubo:=true; end if;
 if coalesce(ndir,'')<>coalesce(ped.direccion,'') then antes:=antes||jsonb_build_object('direccion',ped.direccion);despues:=despues||jsonb_build_object('direccion',ndir);hubo:=true; else ndir:=ped.direccion; end if;
 if coalesce(nnotas,'')<>coalesce(ped.notas,'') then antes:=antes||jsonb_build_object('notas',ped.notas);despues:=despues||jsonb_build_object('notas',nnotas);hubo:=true; else nnotas:=ped.notas; end if;
 if nent is distinct from ped.fecha_entrega then antes:=antes||jsonb_build_object('fecha_entrega',ped.fecha_entrega);despues:=despues||jsonb_build_object('fecha_entrega',nent);hubo:=true; end if;
 if nret is distinct from ped.retiro then antes:=antes||jsonb_build_object('retiro',ped.retiro);despues:=despues||jsonb_build_object('retiro',nret);hubo:=true; end if;
 if not hubo then return admin_pedido_json(p_id); end if;   -- nada cambió: no se escribe ni se registra
 -- Un solo update atómico. No toca renglones, fotos, faltantes, sustitutos, reposiciones, preparación ni hojas.
 update pedidos set fecha_pedido=nfp,cliente=ncli,direccion=ndir,notas=nnotas,fecha_entrega=nent,retiro=nret where id=p_id;
 res:=admin_pedido_json(p_id);
 insert into admin_cambios(op_id,tabla,registro,accion,antes,despues,resultado,autor) values(p_op,'pedidos',p_id,'editar',antes,despues,res,stock_autor());
 return res;
end $$;

-- ── Clientes ──
create or replace function public.admin_clientes_listar(p_q text,p_bajas boolean default false) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare q text:=admin_key(p_q);
begin
 perform admin_exigir();
 return coalesce((
  select jsonb_agg(jsonb_build_object('id',c.id,'nombre',c.nombre,'direccion',c.direccion,'eliminado_en',c.eliminado_en,'version',c.actualizado_en,
    'pedidos',coalesce(a.n,0),'ultimo_pedido',a.ultimo,'telefonos',coalesce(t.tels,'[]')) order by admin_key(c.nombre),c.id)
  from clientes c
  left join (select lower(trim(cliente)) k,count(*)::int n,max(coalesce(fecha_pedido,fecha)) ultimo from pedidos where eliminado_en is null group by 1) a on a.k=c.nombre_key
  left join (select lower(trim(linked_client_name)) k,jsonb_agg(distinct coalesce(phone_number,contact_key)) tels from whatsapp_contacts where linked_client_name is not null group by 1) t on t.k=c.nombre_key
  where (coalesce(p_bajas,false) or c.eliminado_en is null)
   and (q='' or position(q in admin_key(c.nombre))>0 or position(q in admin_key(c.direccion))>0)
 ),'[]');
end $$;

-- Cuántos registros de cada tabla se actualizarían si se renombra el cliente (para avisar antes de confirmar).
create or replace function public.admin_cliente_impacto(p_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare k text;
begin
 perform admin_exigir();
 select nombre_key into k from clientes where id=p_id;
 if k is null then raise exception 'El cliente no existe'; end if;
 return jsonb_build_object('pedidos',(select count(*) from pedidos where lower(trim(cliente))=k),
  'pedidos_fijos',(select count(*) from pedidos_fijos where lower(trim(cliente))=k),
  'app_notas',(select count(*) from app_notas where lower(trim(cliente))=k),
  'pedidos_a_cargar',(select count(*) from pedidos_a_cargar where lower(trim(cliente))=k),
  'whatsapp_contacts',(select count(*) from whatsapp_contacts where lower(trim(linked_client_name))=k),
  'whatsapp_client_review',(select count(*) from whatsapp_client_review where lower(trim(client_name))=k));
end $$;

create or replace function public.admin_cliente_guardar(p_op uuid,p_id uuid,p_version timestamptz,p_datos jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare previo admin_cambios; cli clientes; nn text; nd text; k_old text; k_new text; antes jsonb:='{}'; despues jsonb:='{}'; cont jsonb:='{}'; c int; res jsonb; renombra boolean:=false;
begin
 perform admin_exigir();
 if p_op is null or p_id is null then raise exception 'Falta el identificador de la operación'; end if;
 select * into previo from admin_cambios where op_id=p_op;
 if found then
  if previo.tabla<>'clientes' or previo.registro<>p_id::text then raise exception 'Operación ya usada en otro registro'; end if;
  return previo.resultado;
 end if;
 if p_datos is null or jsonb_typeof(p_datos)<>'object' then raise exception 'Datos no válidos'; end if;
 if exists(select 1 from jsonb_object_keys(p_datos) k where k not in ('nombre','direccion')) then raise exception 'Solo se pueden modificar nombre y dirección'; end if;
 perform pg_advisory_xact_lock(hashtext('admin_clientes'));
 select * into cli from clientes where id=p_id for update;
 nn:=case when p_datos?'nombre' then trim(coalesce(p_datos->>'nombre','')) else cli.nombre end;
 nd:=case when p_datos?'direccion' then nullif(trim(coalesce(p_datos->>'direccion','')),'') else cli.direccion end;
 if not found then
  -- Alta: el id lo genera el navegador una sola vez por cliente nuevo.
  if nn is null or nn='' or length(nn)>200 then raise exception 'Escribí el nombre del cliente (hasta 200 letras)'; end if;
  if exists(select 1 from clientes where nombre_key=lower(trim(nn))) then raise exception 'Ya existe un cliente con ese nombre'; end if;
  insert into clientes(id,nombre,direccion,actualizado_en) values(p_id,nn,nd,now());
  res:=admin_cliente_json(p_id);
  insert into admin_cambios(op_id,tabla,registro,accion,antes,despues,resultado,autor) values(p_op,'clientes',p_id::text,'crear',null,jsonb_build_object('nombre',nn,'direccion',nd),res,stock_autor());
  return res;
 end if;
 if p_version is distinct from cli.actualizado_en then raise exception 'Otro cambio se guardó antes: recargá'; end if;
 if nn='' or length(nn)>200 then raise exception 'Escribí el nombre del cliente (hasta 200 letras)'; end if;
 if length(coalesce(nd,''))>300 then raise exception 'La dirección es demasiado larga'; end if;
 k_old:=cli.nombre_key;k_new:=lower(trim(nn));
 if exists(select 1 from clientes where nombre_key=k_new and id<>p_id) then raise exception 'Ya existe un cliente con ese nombre'; end if;
 if nn is distinct from cli.nombre then antes:=antes||jsonb_build_object('nombre',cli.nombre);despues:=despues||jsonb_build_object('nombre',nn);renombra:=true; end if;
 if coalesce(nd,'')<>coalesce(cli.direccion,'') then antes:=antes||jsonb_build_object('direccion',cli.direccion);despues:=despues||jsonb_build_object('direccion',nd); else nd:=cli.direccion; end if;
 if antes='{}'::jsonb then return admin_cliente_json(p_id); end if;
 if renombra then
  -- Los pedidos que ya no están Pendientes conservan remito/control: el trigger los desmarcaría por cambiar el texto del cliente.
  create temp table if not exists _admin_remitos(pedido_id text primary key,remito boolean,controlado boolean,firma text) on commit drop;
  truncate _admin_remitos;
  insert into _admin_remitos select p.id,p.remito_hecho,pp.controlado,pp.control_firma from pedidos p left join prep_pedidos pp on pp.pedido_id=p.id
   where lower(trim(p.cliente))=k_old and (p.estado<>'Pendiente' or p.eliminado_en is not null);
  update pedidos set cliente=nn where lower(trim(cliente))=k_old;get diagnostics c=row_count;cont:=cont||jsonb_build_object('pedidos',c);
  update pedidos p set remito_hecho=r.remito from _admin_remitos r where r.pedido_id=p.id and p.remito_hecho is distinct from r.remito;
  update prep_pedidos pp set controlado=r.controlado,control_firma=r.firma from _admin_remitos r where r.pedido_id=pp.pedido_id and (pp.controlado is distinct from r.controlado or pp.control_firma is distinct from r.firma);
  update pedidos_fijos set cliente=nn where lower(trim(cliente))=k_old;get diagnostics c=row_count;cont:=cont||jsonb_build_object('pedidos_fijos',c);
  update app_notas set cliente=nn where lower(trim(cliente))=k_old;get diagnostics c=row_count;cont:=cont||jsonb_build_object('app_notas',c);
  update pedidos_a_cargar set cliente=nn where lower(trim(cliente))=k_old;get diagnostics c=row_count;cont:=cont||jsonb_build_object('pedidos_a_cargar',c);
  update whatsapp_contacts set linked_client_name=nn where lower(trim(linked_client_name))=k_old;get diagnostics c=row_count;cont:=cont||jsonb_build_object('whatsapp_contacts',c);
  -- La cola de revisión es una fila por nombre: si ya hubiera una huérfana con el nombre nuevo, se descarta la vieja.
  if exists(select 1 from whatsapp_client_review where lower(trim(client_name))=k_new) then delete from whatsapp_client_review where lower(trim(client_name))=k_old;
  else update whatsapp_client_review set client_name=nn where lower(trim(client_name))=k_old; end if;
  get diagnostics c=row_count;cont:=cont||jsonb_build_object('whatsapp_client_review',c);
  despues:=despues||jsonb_build_object('actualizados',cont);
 end if;
 update clientes set nombre=nn,direccion=nd,actualizado_en=now() where id=p_id;
 res:=admin_cliente_json(p_id);
 insert into admin_cambios(op_id,tabla,registro,accion,antes,despues,resultado,autor) values(p_op,'clientes',p_id::text,case when renombra then 'renombrar' else 'editar' end,antes,despues,res,stock_autor());
 return res;
end $$;

create or replace function public.admin_cliente_baja(p_op uuid,p_id uuid,p_baja boolean) returns jsonb language plpgsql security definer set search_path=public as $$
declare previo admin_cambios; cli clientes; res jsonb;
begin
 perform admin_exigir();
 if p_op is null or p_id is null or p_baja is null then raise exception 'Falta el identificador de la operación'; end if;
 select * into previo from admin_cambios where op_id=p_op;
 if found then
  if previo.tabla<>'clientes' or previo.registro<>p_id::text then raise exception 'Operación ya usada en otro registro'; end if;
  return previo.resultado;
 end if;
 select * into cli from clientes where id=p_id for update;
 if not found then raise exception 'El cliente no existe'; end if;
 if (cli.eliminado_en is not null)=p_baja then return admin_cliente_json(p_id); end if;   -- ya estaba así
 update clientes set eliminado_en=case when p_baja then now() end,eliminado_por=case when p_baja then stock_autor() end,actualizado_en=now() where id=p_id;
 res:=admin_cliente_json(p_id);
 insert into admin_cambios(op_id,tabla,registro,accion,antes,despues,resultado,autor)
 values(p_op,'clientes',p_id::text,case when p_baja then 'baja' else 'restaurar' end,jsonb_build_object('eliminado_en',cli.eliminado_en),jsonb_build_object('eliminado_en',res->>'eliminado_en'),res,stock_autor());
 return res;
end $$;

create or replace function public.admin_cambios_leer(p_tabla text,p_registro text) returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 perform admin_exigir();
 return coalesce((select jsonb_agg(jsonb_build_object('accion',x.accion,'antes',x.antes,'despues',x.despues,'autor',x.autor,'en',x.en) order by x.en desc,x.id desc)
  from (select * from admin_cambios where tabla=p_tabla and registro=p_registro order by en desc,id desc limit 50) x),'[]');
end $$;

revoke all on function public.admin_pedidos_buscar(text,date,date,text,jsonb,int),public.admin_pedido_leer(text),public.admin_pedido_guardar(uuid,text,timestamptz,jsonb),
 public.admin_clientes_listar(text,boolean),public.admin_cliente_impacto(uuid),public.admin_cliente_guardar(uuid,uuid,timestamptz,jsonb),
 public.admin_cliente_baja(uuid,uuid,boolean),public.admin_cambios_leer(text,text) from public,anon;
grant execute on function public.admin_pedidos_buscar(text,date,date,text,jsonb,int),public.admin_pedido_leer(text),public.admin_pedido_guardar(uuid,text,timestamptz,jsonb),
 public.admin_clientes_listar(text,boolean),public.admin_cliente_impacto(uuid),public.admin_cliente_guardar(uuid,uuid,timestamptz,jsonb),
 public.admin_cliente_baja(uuid,uuid,boolean),public.admin_cambios_leer(text,text) to authenticated;

commit;
