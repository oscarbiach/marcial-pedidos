-- Panel de administración, segunda parte: observaciones de clientes y fusión de clientes duplicados.
-- (No edita 20261120_panel_admin.sql, ya aplicada: redefine con create or replace las funciones que cambian.)
--
-- Decisiones:
--  * clientes.observaciones (hasta 1000 letras, opcional). La editan admin_cliente_guardar y la ve el seguimiento.
--  * Fusión: el DESTINO conserva su nombre; el ORIGEN queda como baja con fusionado_en = destino (no se borra nada).
--    En una transacción se pasan al destino pedidos (incluidos eliminados), pedidos fijos, notas, pedidos por cargar,
--    vínculos de WhatsApp, agenda, decisiones y excepciones de seguimiento. Los pedidos que no están Pendientes (o están
--    eliminados) conservan remito/control: el trigger los desmarcaría por cambiar el texto del cliente.
--    Si ambos clientes tenían decisión de seguimiento vigente, queda la del destino y la del origen se cierra como
--    «reemplazada» (y se mueve con todo su historial). Con excepciones de producto repetidas pasa lo mismo.
--    Se registra en admin_cambios (en el destino y en el origen) la lista de pedidos movidos para revertir a mano. No hay deshacer automático.
--  * Para que no se vuelva a duplicar: trigger BEFORE INSERT en pedidos que reemplaza el nombre de un cliente fusionado
--    por el del cliente final (sigue cadenas de fusiones, con tope). guardar_pedido inserta el pedido primero (ya con el
--    nombre del destino) y después hace upsert en clientes con el nombre ORIGINAL de la app: cae en la fila del origen
--    (nombre_key único), solo puede tocar su dirección y NO la revive ni crea otra. El pedido queda en el destino.
--  * admin_pedido_guardar usa admin_cliente_final para que corregir el cliente de un pedido tampoco apunte a un fusionado.
--
-- Cómo volver atrás: drop trigger admin_pedido_redirigir_fusion on pedidos; drop function admin_pedido_redirigir_fusion(),
--   admin_cliente_fusionar(uuid,uuid,uuid,timestamptz,timestamptz), admin_cliente_fusion_impacto(uuid,uuid), admin_cliente_final(text);
--   alter table clientes drop column fusionado_en, drop column observaciones;
--   (las funciones redefinidas se restauran volviendo a correr 20261120_panel_admin.sql; los pedidos movidos se revierten con la lista de admin_cambios).
begin;

alter table public.clientes add column if not exists observaciones text;
alter table public.clientes add column if not exists fusionado_en uuid references public.clientes(id);
do $$ begin
 if not exists(select 1 from pg_constraint where conname='clientes_observaciones_chk' and conrelid='public.clientes'::regclass) then
  alter table public.clientes add constraint clientes_observaciones_chk check(observaciones is null or length(observaciones)<=1000);
 end if;
end $$;

-- Nombre del cliente final tras seguir las fusiones (con tope); si no coincide con ningún cliente, el mismo texto limpio.
create or replace function public.admin_cliente_final(t text) returns text language plpgsql stable security definer set search_path=public as $$
declare cur clientes; n int:=0; k text:=lower(trim(coalesce(t,'')));
begin
 select * into cur from clientes where nombre_key=k;
 if not found then return trim(coalesce(t,'')); end if;
 while cur.fusionado_en is not null and n<10 loop
  select * into cur from clientes where id=cur.fusionado_en;
  if not found then exit; end if;
  n:=n+1;
 end loop;
 return cur.nombre;
end $$;
revoke all on function public.admin_cliente_final(text) from public,anon,authenticated;

create or replace function public.admin_pedido_redirigir_fusion() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.cliente is not null and exists(select 1 from clientes where nombre_key=lower(trim(new.cliente)) and fusionado_en is not null) then
  new.cliente:=admin_cliente_final(new.cliente);
 end if;
 return new;
end $$;
revoke all on function public.admin_pedido_redirigir_fusion() from public,anon,authenticated;
create or replace trigger admin_pedido_redirigir_fusion before insert on public.pedidos for each row execute function public.admin_pedido_redirigir_fusion();

create or replace function public.admin_cliente_json(p_id uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('id',c.id,'nombre',c.nombre,'direccion',c.direccion,'observaciones',c.observaciones,'fusionado_en',c.fusionado_en,'eliminado_en',c.eliminado_en,'eliminado_por',c.eliminado_por,'version',c.actualizado_en,'creado_en',c.creado_en)
 from clientes c where c.id=p_id
$$;

create or replace function public.admin_clientes_listar(p_q text,p_bajas boolean default false) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare q text:=admin_key(p_q);
begin
 perform admin_exigir();
 return coalesce((
  select jsonb_agg(jsonb_build_object('id',c.id,'nombre',c.nombre,'direccion',c.direccion,'observaciones',c.observaciones,'eliminado_en',c.eliminado_en,'fusionado_en',c.fusionado_en,'fusionado_con',(select f.nombre from clientes f where f.id=c.fusionado_en),'version',c.actualizado_en,
    'pedidos',coalesce(a.n,0),'ultimo_pedido',a.ultimo,'telefonos',coalesce(t.tels,'[]')) order by admin_key(c.nombre),c.id)
  from clientes c
  left join (select lower(trim(cliente)) k,count(*)::int n,max(coalesce(fecha_pedido,fecha)) ultimo from pedidos where eliminado_en is null group by 1) a on a.k=c.nombre_key
  left join (select lower(trim(linked_client_name)) k,jsonb_agg(distinct coalesce(phone_number,contact_key)) tels from whatsapp_contacts where linked_client_name is not null group by 1) t on t.k=c.nombre_key
  where (coalesce(p_bajas,false) or c.eliminado_en is null)
   and (q='' or position(q in admin_key(c.nombre))>0 or position(q in admin_key(c.direccion))>0)
 ),'[]');
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
 if cli.fusionado_en is not null and not p_baja then raise exception 'Este cliente fue fusionado con otro y no se puede restaurar'; end if;
 if (cli.eliminado_en is not null)=p_baja then return admin_cliente_json(p_id); end if;   -- ya estaba así
 update clientes set eliminado_en=case when p_baja then now() end,eliminado_por=case when p_baja then stock_autor() end,actualizado_en=now() where id=p_id;
 res:=admin_cliente_json(p_id);
 insert into admin_cambios(op_id,tabla,registro,accion,antes,despues,resultado,autor)
 values(p_op,'clientes',p_id::text,case when p_baja then 'baja' else 'restaurar' end,jsonb_build_object('eliminado_en',cli.eliminado_en),jsonb_build_object('eliminado_en',res->>'eliminado_en'),res,stock_autor());
 return res;
end $$;

create or replace function public.admin_cliente_guardar(p_op uuid,p_id uuid,p_version timestamptz,p_datos jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare previo admin_cambios; cli clientes; nn text; nd text; nobs text; k_old text; k_new text; antes jsonb:='{}'; despues jsonb:='{}'; cont jsonb:='{}'; c int; res jsonb; renombra boolean:=false;
begin
 perform admin_exigir();
 if p_op is null or p_id is null then raise exception 'Falta el identificador de la operación'; end if;
 select * into previo from admin_cambios where op_id=p_op;
 if found then
  if previo.tabla<>'clientes' or previo.registro<>p_id::text then raise exception 'Operación ya usada en otro registro'; end if;
  return previo.resultado;
 end if;
 if p_datos is null or jsonb_typeof(p_datos)<>'object' then raise exception 'Datos no válidos'; end if;
 if exists(select 1 from jsonb_object_keys(p_datos) k where k not in ('nombre','direccion','observaciones')) then raise exception 'Solo se pueden modificar nombre, dirección y observaciones'; end if;
 perform pg_advisory_xact_lock(hashtext('admin_clientes'));
 select * into cli from clientes where id=p_id for update;
 nn:=case when p_datos?'nombre' then trim(coalesce(p_datos->>'nombre','')) else cli.nombre end;
 nd:=case when p_datos?'direccion' then nullif(trim(coalesce(p_datos->>'direccion','')),'') else cli.direccion end;
 nobs:=case when p_datos?'observaciones' then nullif(trim(coalesce(p_datos->>'observaciones','')),'') else cli.observaciones end;
 if length(coalesce(nobs,''))>1000 then raise exception 'La observación es demasiado larga (hasta 1000 letras)'; end if;
 if not found then
  -- Alta: el id lo genera el navegador una sola vez por cliente nuevo.
  if nn is null or nn='' or length(nn)>200 then raise exception 'Escribí el nombre del cliente (hasta 200 letras)'; end if;
  if exists(select 1 from clientes where nombre_key=lower(trim(nn))) then raise exception 'Ya existe un cliente con ese nombre'; end if;
  insert into clientes(id,nombre,direccion,observaciones,actualizado_en) values(p_id,nn,nd,nobs,now());
  res:=admin_cliente_json(p_id);
  insert into admin_cambios(op_id,tabla,registro,accion,antes,despues,resultado,autor) values(p_op,'clientes',p_id::text,'crear',null,jsonb_build_object('nombre',nn,'direccion',nd,'observaciones',nobs),res,stock_autor());
  return res;
 end if;
 if cli.fusionado_en is not null then raise exception 'Este cliente fue fusionado con otro y ya no se puede editar'; end if;
 if p_version is distinct from cli.actualizado_en then raise exception 'Otro cambio se guardó antes: recargá'; end if;
 if nn='' or length(nn)>200 then raise exception 'Escribí el nombre del cliente (hasta 200 letras)'; end if;
 if length(coalesce(nd,''))>300 then raise exception 'La dirección es demasiado larga'; end if;
 k_old:=cli.nombre_key;k_new:=lower(trim(nn));
 if exists(select 1 from clientes where nombre_key=k_new and id<>p_id) then raise exception 'Ya existe un cliente con ese nombre'; end if;
 if nn is distinct from cli.nombre then antes:=antes||jsonb_build_object('nombre',cli.nombre);despues:=despues||jsonb_build_object('nombre',nn);renombra:=true; end if;
 if coalesce(nd,'')<>coalesce(cli.direccion,'') then antes:=antes||jsonb_build_object('direccion',cli.direccion);despues:=despues||jsonb_build_object('direccion',nd); else nd:=cli.direccion; end if;
 if coalesce(nobs,'')<>coalesce(cli.observaciones,'') then antes:=antes||jsonb_build_object('observaciones',cli.observaciones);despues:=despues||jsonb_build_object('observaciones',nobs); else nobs:=cli.observaciones; end if;
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
 update clientes set nombre=nn,direccion=nd,observaciones=nobs,actualizado_en=now() where id=p_id;
 res:=admin_cliente_json(p_id);
 insert into admin_cambios(op_id,tabla,registro,accion,antes,despues,resultado,autor) values(p_op,'clientes',p_id::text,case when renombra then 'renombrar' else 'editar' end,antes,despues,res,stock_autor());
 return res;
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
  ncli:=admin_cliente_final(ncli);
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

-- Vista previa de lo que haría la fusión (nada se modifica).
create or replace function public.admin_cliente_fusion_impacto(p_origen uuid,p_destino uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare o clientes; d clientes; dec_o seg_decisiones; dec_d seg_decisiones; seg boolean:=to_regclass('public.seg_decisiones') is not null; ex_o int:=0; ex_rep int:=0; ag_o int:=0; ag_d int:=0; dec_n int:=0;
begin
 perform admin_exigir();
 select * into o from clientes where id=p_origen; select * into d from clientes where id=p_destino;
 if o.id is null or d.id is null then raise exception 'El cliente no existe'; end if;
 if o.id=d.id then raise exception 'No se puede fusionar un cliente consigo mismo'; end if;
 if o.fusionado_en is not null or d.fusionado_en is not null then raise exception 'Uno de los clientes ya fue fusionado'; end if;
 if seg then
  select * into dec_o from seg_decisiones where cliente_id=o.id and vigente; select * into dec_d from seg_decisiones where cliente_id=d.id and vigente;
  select count(*) into dec_n from seg_decisiones where cliente_id=o.id;
  select count(*) into ex_o from seg_reglas_producto where cliente_id=o.id and tipo='excepcion' and vigente;
  select count(*) into ex_rep from seg_reglas_producto r where r.cliente_id=o.id and r.tipo='excepcion' and r.vigente and exists(select 1 from seg_reglas_producto x where x.cliente_id=d.id and x.tipo='excepcion' and x.vigente and x.producto_clave=r.producto_clave);
 end if;
 if to_regclass('public.seg_agenda') is not null then
  select count(*) into ag_o from seg_agenda where cliente_id=o.id; select count(*) into ag_d from seg_agenda where cliente_id=d.id;
 end if;
 return jsonb_build_object('origen',admin_cliente_json(o.id),'destino',admin_cliente_json(d.id),
  'pedidos',(select count(*) from pedidos where lower(trim(cliente))=o.nombre_key),
  'pedidos_fijos',(select count(*) from pedidos_fijos where lower(trim(cliente))=o.nombre_key),
  'app_notas',(select count(*) from app_notas where lower(trim(cliente))=o.nombre_key),
  'pedidos_a_cargar',(select count(*) from pedidos_a_cargar where lower(trim(cliente))=o.nombre_key),
  'whatsapp_contacts',(select count(*) from whatsapp_contacts where lower(trim(linked_client_name))=o.nombre_key),
  'whatsapp_client_review',(select count(*) from whatsapp_client_review where lower(trim(client_name))=o.nombre_key),
  'agenda',case when ag_o=0 then 'sin' when ag_d>0 then 'se_descarta_la_del_origen' else 'pasa_al_destino' end,
  'decisiones',dec_n,
  'decision_origen',dec_o.tipo,'decision_destino',dec_d.tipo,
  'decision_conserva',case when dec_o.id is not null and dec_d.id is not null then 'destino' when dec_o.id is not null then 'origen' when dec_d.id is not null then 'destino' end,
  'decision_reemplazada',dec_o.id is not null and dec_d.id is not null,
  'excepciones',ex_o,'excepciones_reemplazadas',ex_rep);
end $$;

create or replace function public.admin_cliente_fusionar(p_op uuid,p_origen uuid,p_destino uuid,p_version_origen timestamptz,p_version_destino timestamptz) returns jsonb language plpgsql security definer set search_path=public as $$
declare previo admin_cambios; o clientes; d clientes; cont jsonb:='{}'; c int; ids jsonb; res jsonb; nd text; nobs text; antes_d jsonb; despues_d jsonb; ncli text; seg boolean:=to_regclass('public.seg_decisiones') is not null; v_autor text;
begin
 perform admin_exigir();
 if p_op is null or p_origen is null or p_destino is null then raise exception 'Falta el identificador de la operación'; end if;
 select * into previo from admin_cambios where op_id=p_op;
 if found then
  if previo.tabla<>'clientes' or previo.registro<>p_destino::text or previo.accion<>'fusionar' then raise exception 'Operación ya usada en otro registro'; end if;
  return previo.resultado;
 end if;
 if p_origen=p_destino then raise exception 'No se puede fusionar un cliente consigo mismo'; end if;
 perform pg_advisory_xact_lock(hashtext('admin_clientes'));
 select * into o from clientes where id=p_origen for update; if not found then raise exception 'El cliente no existe'; end if;
 select * into d from clientes where id=p_destino for update; if not found then raise exception 'El cliente no existe'; end if;
 if o.fusionado_en is not null or d.fusionado_en is not null then raise exception 'Uno de los clientes ya fue fusionado'; end if;
 if d.eliminado_en is not null then raise exception 'El cliente que queda no puede estar dado de baja'; end if;
 if p_version_origen is distinct from o.actualizado_en or p_version_destino is distinct from d.actualizado_en then raise exception 'Otro cambio se guardó antes: recargá'; end if;
 v_autor:=stock_autor(); ncli:=d.nombre;
 select coalesce(jsonb_agg(id order by id),'[]') into ids from pedidos where lower(trim(cliente))=o.nombre_key;
 -- Pedidos: los que ya no están Pendientes (o eliminados) conservan remito y control.
 create temp table if not exists _admin_remitos(pedido_id text primary key,remito boolean,controlado boolean,firma text) on commit drop;
 truncate _admin_remitos;
 insert into _admin_remitos select p.id,p.remito_hecho,pp.controlado,pp.control_firma from pedidos p left join prep_pedidos pp on pp.pedido_id=p.id
  where lower(trim(p.cliente))=o.nombre_key and (p.estado<>'Pendiente' or p.eliminado_en is not null);
 update pedidos set cliente=ncli where lower(trim(cliente))=o.nombre_key;get diagnostics c=row_count;cont:=cont||jsonb_build_object('pedidos',c);
 update pedidos p set remito_hecho=r.remito from _admin_remitos r where r.pedido_id=p.id and p.remito_hecho is distinct from r.remito;
 update prep_pedidos pp set controlado=r.controlado,control_firma=r.firma from _admin_remitos r where r.pedido_id=pp.pedido_id and (pp.controlado is distinct from r.controlado or pp.control_firma is distinct from r.firma);
 update pedidos_fijos set cliente=ncli where lower(trim(cliente))=o.nombre_key;get diagnostics c=row_count;cont:=cont||jsonb_build_object('pedidos_fijos',c);
 update app_notas set cliente=ncli where lower(trim(cliente))=o.nombre_key;get diagnostics c=row_count;cont:=cont||jsonb_build_object('app_notas',c);
 update pedidos_a_cargar set cliente=ncli where lower(trim(cliente))=o.nombre_key;get diagnostics c=row_count;cont:=cont||jsonb_build_object('pedidos_a_cargar',c);
 update whatsapp_contacts set linked_client_name=ncli where lower(trim(linked_client_name))=o.nombre_key;get diagnostics c=row_count;cont:=cont||jsonb_build_object('whatsapp_contacts',c);
 if exists(select 1 from whatsapp_client_review where lower(trim(client_name))=d.nombre_key) then delete from whatsapp_client_review where lower(trim(client_name))=o.nombre_key;
 else update whatsapp_client_review set client_name=ncli where lower(trim(client_name))=o.nombre_key; end if;
 get diagnostics c=row_count;cont:=cont||jsonb_build_object('whatsapp_client_review',c);
 -- Seguimiento: agenda, decisiones y excepciones pasan al destino; si chocan, manda el destino.
 if to_regclass('public.seg_agenda') is not null then
  if exists(select 1 from seg_agenda where cliente_id=d.id) then delete from seg_agenda where cliente_id=o.id;get diagnostics c=row_count;cont:=cont||jsonb_build_object('seg_agenda_descartada',c);
  else update seg_agenda set cliente_id=d.id where cliente_id=o.id;get diagnostics c=row_count;cont:=cont||jsonb_build_object('seg_agenda',c); end if;
 end if;
 if seg then
  if exists(select 1 from seg_decisiones where cliente_id=d.id and vigente) then
   update seg_decisiones set vigente=false,cerrada_en=now(),cerrada_por=v_autor,cierre='reemplazada' where cliente_id=o.id and vigente;get diagnostics c=row_count;cont:=cont||jsonb_build_object('seg_decisiones_reemplazadas',c);
  end if;
  update seg_decisiones set cliente_id=d.id where cliente_id=o.id;get diagnostics c=row_count;cont:=cont||jsonb_build_object('seg_decisiones',c);
  update seg_reglas_producto r set vigente=false,cerrada_en=now(),cerrada_por=v_autor,cierre='reemplazada'
   where r.cliente_id=o.id and r.tipo='excepcion' and r.vigente and exists(select 1 from seg_reglas_producto x where x.cliente_id=d.id and x.tipo='excepcion' and x.vigente and x.producto_clave=r.producto_clave);get diagnostics c=row_count;cont:=cont||jsonb_build_object('seg_excepciones_reemplazadas',c);
  update seg_reglas_producto set cliente_id=d.id where cliente_id=o.id and tipo='excepcion';get diagnostics c=row_count;cont:=cont||jsonb_build_object('seg_excepciones',c);
 end if;
 -- Dirección y observaciones
 nd:=case when coalesce(d.direccion,'')='' and coalesce(o.direccion,'')<>'' then o.direccion else d.direccion end;
 nobs:=case when coalesce(d.observaciones,'')<>'' and coalesce(o.observaciones,'')<>'' then left(d.observaciones||' / '||o.observaciones,1000)
  when coalesce(d.observaciones,'')='' then o.observaciones else d.observaciones end;
 antes_d:=jsonb_build_object('direccion',d.direccion,'observaciones',d.observaciones);despues_d:=jsonb_build_object('direccion',nd,'observaciones',nobs);
 update clientes set direccion=nd,observaciones=nobs,actualizado_en=now() where id=d.id;
 update clientes set eliminado_en=now(),eliminado_por=v_autor,fusionado_en=d.id,actualizado_en=now() where id=o.id;
 res:=jsonb_build_object('destino',admin_cliente_json(d.id),'origen',admin_cliente_json(o.id),'actualizados',cont,'pedidos_movidos',ids);
 insert into admin_cambios(op_id,tabla,registro,accion,antes,despues,resultado,autor)
  values(p_op,'clientes',d.id::text,'fusionar',antes_d||jsonb_build_object('origen',o.nombre),despues_d||jsonb_build_object('origen',o.nombre,'origen_id',o.id,'actualizados',cont,'pedidos_movidos',ids),res,v_autor);
 insert into admin_cambios(tabla,registro,accion,antes,despues,autor)
  values('clientes',o.id::text,'fusionar',jsonb_build_object('eliminado_en',o.eliminado_en,'nombre',o.nombre),jsonb_build_object('fusionado_en',d.id,'destino',d.nombre,'actualizados',cont,'pedidos_movidos',ids),v_autor);
 return res;
end $$;

revoke all on function public.admin_cliente_fusion_impacto(uuid,uuid),public.admin_cliente_fusionar(uuid,uuid,uuid,timestamptz,timestamptz) from public,anon;
grant execute on function public.admin_cliente_fusion_impacto(uuid,uuid),public.admin_cliente_fusionar(uuid,uuid,uuid,timestamptz,timestamptz) to authenticated;
-- Las funciones redefinidas conservan sus permisos (create or replace); se reafirman por si acaso.
revoke all on function public.admin_clientes_listar(text,boolean),public.admin_cliente_guardar(uuid,uuid,timestamptz,jsonb),public.admin_cliente_baja(uuid,uuid,boolean),public.admin_pedido_guardar(uuid,text,timestamptz,jsonb) from public,anon;
grant execute on function public.admin_clientes_listar(text,boolean),public.admin_cliente_guardar(uuid,uuid,timestamptz,jsonb),public.admin_cliente_baja(uuid,uuid,boolean),public.admin_pedido_guardar(uuid,text,timestamptz,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
