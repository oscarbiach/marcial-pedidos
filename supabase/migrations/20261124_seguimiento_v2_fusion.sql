-- Seguimiento v2, ajuste (24/11/2026): la fusión de clientes (admin_cliente_fusionar, 20261120_panel_admin_fusion.sql)
-- también pasa al cliente que queda las etiquetas, el historial de contactos (seg_contactos) y el vendedor si el que queda no tiene.
-- Requiere 20261124_seguimiento_v2.sql (clientes.vendedor). Volver atrás: correr de nuevo la definición de 20261120_panel_admin_fusion.sql.
-- Aplicada en Supabase el 24/11/2026 con OK del usuario.
begin;
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
 -- Seguimiento v2: vendedor (si el que queda no tiene, toma el del otro), etiquetas (se suman) e historial de contactos.
 if to_regclass('public.clientes_etiquetas') is not null then
  insert into clientes_etiquetas(cliente_id,etiqueta_id) select d.id,etiqueta_id from clientes_etiquetas where cliente_id=o.id on conflict do nothing;
  delete from clientes_etiquetas where cliente_id=o.id;get diagnostics c=row_count;cont:=cont||jsonb_build_object('etiquetas',c);
 end if;
 if to_regclass('public.seg_contactos') is not null then
  update seg_contactos set cliente_id=d.id where cliente_id=o.id;get diagnostics c=row_count;cont:=cont||jsonb_build_object('seg_contactos',c);
 end if;
 if d.vendedor is null and o.vendedor is not null then update clientes set vendedor=o.vendedor where id=d.id;cont:=cont||jsonb_build_object('vendedor',o.vendedor); end if;
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
-- El vendedor solo se cambia por seg_cliente_vendedor o la fusión (funciones del dueño): la tabla clientes deja editar a cualquier
-- sesión con PIN (cli_todo), así que un cambio directo de vendedor desde la app se rechaza si no es administrador ni ve_todo.
-- security invoker: así current_user es quien hace el cambio (authenticated); desde las funciones del dueño es postgres y pasa.
create or replace function public.seg_clientes_vendedor_guard() returns trigger language plpgsql security invoker set search_path=public as $$
begin
 if new.vendedor is distinct from old.vendedor and current_user in ('authenticated','anon') and not public.seg_es_gestor() then
  raise exception 'Solo quien administra puede cambiar el vendedor' using errcode='42501';
 end if;
 return new;
end $$;
revoke all on function public.seg_clientes_vendedor_guard() from public,anon,authenticated;
drop trigger if exists seg_clientes_vendedor_guard on public.clientes;
create trigger seg_clientes_vendedor_guard before update of vendedor on public.clientes for each row execute function public.seg_clientes_vendedor_guard();

notify pgrst,'reload schema';
commit;
