-- Peso/foto opcionales, sustituciones y carga con despacho/reposición atómicos.
begin;
alter table public.prep_items
  add column if not exists medida_real text,
  add column if not exists sustituto text,
  add column if not exists sustituto_cantidad numeric,
  add column if not exists sustituto_medida text,
  add column if not exists sustituto_peso numeric,
  add column if not exists sustituto_foto text,
  add column if not exists sustituye numeric;
alter table public.prep_pedidos
  add column if not exists control_firma text,
  add column if not exists reposicion_id text;

create or replace function public.prep_firma(p_id text) returns text
language sql stable security definer set search_path=public as $$
 select md5(jsonb_build_object('pedido',(select jsonb_build_array(p.cliente,p.direccion,p.notas,p.fecha_entrega,p.retiro) from pedidos p where p.id=p_id),
   'items',coalesce(jsonb_agg(jsonb_build_object('item',to_jsonb(i),
   'prep',to_jsonb(pi)-'quien'-'actualizado_en'-'juntado') order by i.id),'[]'))::text)
 from pedido_items i left join prep_items pi on pi.item_id=i.id where i.pedido_id=p_id
$$;
revoke all on function public.prep_firma(text) from public,anon,authenticated;

create or replace function public.prep_validar(p_id text) returns void
language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from pedido_items where pedido_id=p_id) or exists(
  select 1 from pedido_items i left join prep_items x on x.item_id=i.id where i.pedido_id=p_id and (
   not coalesce(x.separado,false)
   or (coalesce(x.falta,false) and (x.enviado is null or x.enviado<0 or x.enviado>i.cantidad or x.enviado::text in ('NaN','Infinity','-Infinity')))
   or (nullif(trim(x.sustituto),'') is not null and (
     not coalesce(x.falta,false) or coalesce(x.sustituto_cantidad,0)<=0
     or coalesce(x.sustituye,0)<=0 or x.sustituye>i.cantidad-coalesce(x.enviado,0)
     or x.sustituto_cantidad::text in ('NaN','Infinity','-Infinity') or x.sustituye::text in ('NaN','Infinity','-Infinity')
     or x.sustituto_medida is null or x.sustituto_medida not in ('unidad','kg','caja','tira')))
   or (nullif(trim(x.sustituto),'') is null and coalesce(x.sustituye,0)<>0)
  )
 ) then raise exception 'Revisá los productos: faltan separar o completar las cantidades y sustitutos.'; end if;
end $$;
revoke all on function public.prep_validar(text) from public,anon,authenticated;

create or replace function public.prep_mover(p_id text,p_etapa text,p_version integer,p_quien text)
returns public.prep_cola language plpgsql security definer set search_path=public as $$
declare fila public.prep_cola; actual text;
begin
 if auth.uid() is null then raise exception 'Iniciá sesión nuevamente' using errcode='42501'; end if;
 if p_quien is null or p_quien not in ('Oscar','Thiago','Joaquin','Mateo') then raise exception 'Operador inválido'; end if;
 perform 1 from pedidos where id=p_id and estado='Pendiente' and coalesce(retiro,false)=false and eliminado_en is null for update;
 if not found then raise exception 'El pedido ya no está disponible para reparto'; end if;
 select * into fila from prep_cola where pedido_id=p_id for update;
 if coalesce(fila.version,0)<>p_version or p_version is null then raise exception 'Otro compañero actualizó este pedido. Revisá su estado.' using errcode='40001'; end if;
 actual:=coalesce(fila.etapa,'pendiente');
 if not ((actual='pendiente' and p_etapa='por_preparar') or (actual='por_preparar' and p_etapa in ('pendiente','preparando'))
  or (actual='preparando' and p_etapa in ('por_preparar','listo')) or (actual='listo' and p_etapa='preparando')) then raise exception 'Movimiento no válido'; end if;
 if p_etapa='listo' then perform prep_validar(p_id); end if;
 insert into prep_cola(pedido_id,etapa,version,enviado_en,actualizado_en,actualizado_por,usuario_id)
 values(p_id,p_etapa,1,now(),now(),p_quien,auth.uid())
 on conflict(pedido_id) do update set etapa=p_etapa,version=prep_cola.version+1,
 enviado_en=case when actual='pendiente' then now() else prep_cola.enviado_en end,
 actualizado_en=now(),actualizado_por=p_quien,usuario_id=auth.uid() returning * into fila;
 return fila;
end $$;

-- Serializa las ediciones con la carga. Un cambio de contenido invalida el control/remito.
create or replace function public.prep_al_editar() returns trigger
language plpgsql security definer set search_path=public as $$
declare pid text;
begin
 select pedido_id into pid from pedido_items where id=new.item_id;
 perform 1 from pedidos where id=pid and estado='Pendiente' and eliminado_en is null for update;
 if not found then raise exception 'El pedido ya no está disponible para preparar'; end if;
 if tg_op='UPDATE' and (to_jsonb(new)-'quien'-'actualizado_en'-'juntado')=(to_jsonb(old)-'quien'-'actualizado_en'-'juntado') then return new; end if;
 update prep_cola set etapa='preparando',version=version+1,actualizado_en=now(),actualizado_por=coalesce(new.quien,actualizado_por),usuario_id=auth.uid()
 where pedido_id=pid and etapa='listo';
 update pedidos set remito_hecho=false where id=pid and remito_hecho=true;
 update prep_pedidos set controlado=false,control_firma=null where pedido_id=pid;
 return new;
end $$;
create or replace trigger prep_item_edicion before insert or update on public.prep_items for each row execute function public.prep_al_editar();
revoke all on function public.prep_al_editar() from public,anon,authenticated;

create or replace function public.prep_al_cambiar_renglon() returns trigger
language plpgsql security definer set search_path=public as $$
declare pid text;
begin
 if tg_op='UPDATE' and (to_jsonb(new)-'cantidad_entregada'-'motivo_faltante'-'detalle_faltante')=(to_jsonb(old)-'cantidad_entregada'-'motivo_faltante'-'detalle_faltante') then return new; end if;
 pid:=case when tg_op='DELETE' then old.pedido_id else new.pedido_id end;
 perform 1 from pedidos where id=pid and estado='Pendiente' for update;
 if not found then if tg_op='DELETE' then return old; end if; return new; end if;
 if tg_op='UPDATE' and row(new.producto,new.cantidad,new.fetear,new.sin_cuero,new.medida,new.en_unidades) is distinct from row(old.producto,old.cantidad,old.fetear,old.sin_cuero,old.medida,old.en_unidades) then
  update prep_items set separado=false where item_id=new.id;
 end if;
 update prep_cola set etapa='preparando',version=version+1,actualizado_en=now() where pedido_id=pid and etapa='listo';
 update pedidos set remito_hecho=false where id=pid and remito_hecho=true;
 update prep_pedidos set controlado=false,control_firma=null where pedido_id=pid;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
create or replace trigger prep_renglon_edicion before insert or update or delete on public.pedido_items for each row execute function public.prep_al_cambiar_renglon();
revoke all on function public.prep_al_cambiar_renglon() from public,anon,authenticated;

create or replace function public.prep_al_cambiar_pedido() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if row(new.cliente,new.direccion,new.notas,new.fecha_entrega,new.retiro) is distinct from row(old.cliente,old.direccion,old.notas,old.fecha_entrega,old.retiro) then
  new.remito_hecho:=false;
  update prep_pedidos set controlado=false,control_firma=null where pedido_id=new.id;
 end if;
 return new;
end $$;
create or replace trigger prep_pedido_edicion before update on public.pedidos for each row execute function public.prep_al_cambiar_pedido();
revoke all on function public.prep_al_cambiar_pedido() from public,anon,authenticated;

-- Una sola lectura coherente para el resumen, su control y el despacho.
create or replace function public.prep_leer(p_id text) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare p pedidos; r jsonb;
begin
 if auth.uid() is null then raise exception 'Iniciá sesión nuevamente' using errcode='42501'; end if;
 select * into p from pedidos where id=p_id and eliminado_en is null;
 if not found then return null; end if;
 select to_jsonb(p)||jsonb_build_object('pedido_items',coalesce(jsonb_agg(to_jsonb(i) order by i.orden,i.id),'[]')) into r from pedido_items i where i.pedido_id=p_id;
 return jsonb_build_object('pedido',r,'cola',(select to_jsonb(c) from prep_cola c where c.pedido_id=p_id),
  'control',(select to_jsonb(c) from prep_pedidos c where c.pedido_id=p_id),
  'items',coalesce((select jsonb_agg(to_jsonb(x)) from prep_items x join pedido_items i on i.id=x.item_id where i.pedido_id=p_id),'[]'),
  'productos',coalesce((select jsonb_agg(to_jsonb(x)) from prep_productos x where exists(select 1 from pedido_items i where i.pedido_id=p_id and i.producto=x.nombre)),'[]'),
  'firma',prep_firma(p_id));
end $$;

create or replace function public.prep_confirmar(p_id text,p_firma text,p_quien text,p_accion text,p_valor boolean) returns jsonb
language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is null then raise exception 'Iniciá sesión nuevamente' using errcode='42501'; end if;
 if p_quien is null or p_quien not in ('Oscar','Thiago','Joaquin','Mateo') then raise exception 'Operador inválido'; end if;
 perform 1 from pedidos where id=p_id and estado='Pendiente' and eliminado_en is null for update;
 if not found then raise exception 'El pedido ya no está pendiente'; end if;
 if p_firma is distinct from prep_firma(p_id) then raise exception 'El pedido cambió. Revisá el resumen actualizado.' using errcode='40001'; end if;
 if not exists(select 1 from prep_cola where pedido_id=p_id and etapa='listo') then raise exception 'El pedido todavía se está preparando'; end if;
 if p_valor is null then raise exception 'Indicá la confirmación'; end if;
 if p_accion='remito' then update pedidos set remito_hecho=p_valor where id=p_id;
 elsif p_accion='control' then
  insert into prep_pedidos(pedido_id,controlado,controlado_por,controlado_en,control_firma)
  values(p_id,p_valor,p_quien,now(),case when p_valor then p_firma else null end)
  on conflict(pedido_id) do update set controlado=p_valor,controlado_por=p_quien,controlado_en=now(),control_firma=case when p_valor then p_firma else null end;
 else raise exception 'Acción inválida'; end if;
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.prep_cargar(p_id text,p_firma text,p_quien text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare p pedidos; c prep_pedidos; i record; faltantes jsonb:='[]'; detalle text:=''; repo text; respuesta jsonb; restante numeric; hoy date;
begin
 if auth.uid() is null then raise exception 'Iniciá sesión nuevamente' using errcode='42501'; end if;
 if p_quien is null or p_quien not in ('Oscar','Thiago','Joaquin','Mateo') then raise exception 'Operador inválido'; end if;
 select * into p from pedidos where id=p_id and eliminado_en is null for update;
 if not found then raise exception 'El pedido ya no está disponible'; end if;
 select * into c from prep_pedidos where pedido_id=p_id;
 -- Reintentar tras perder la respuesta nunca duplica el despacho ni la reposición.
 if p.estado='Despachado' and c.cargado then return jsonb_build_object('ok',true,'ya_cargado',true,'reposicion_id',c.reposicion_id); end if;
 if p.estado<>'Pendiente' or coalesce(p.retiro,false) then raise exception 'El pedido ya no está disponible para reparto'; end if;
 if p_firma is distinct from prep_firma(p_id) then raise exception 'El pedido cambió. Revisá el resumen actualizado.' using errcode='40001'; end if;
 if not exists(select 1 from prep_cola where pedido_id=p_id and etapa='listo') then raise exception 'El pedido todavía se está preparando'; end if;
 perform prep_validar(p_id);
 if not coalesce(c.controlado,false) or c.control_firma is distinct from p_firma then raise exception 'Controlá los productos antes de cargarlos'; end if;
 hoy:=(now() at time zone 'America/Montevideo')::date;
 for i in select it.*,x.falta,x.enviado,x.sustituto,x.sustituto_cantidad,x.sustituto_medida,x.sustituye,x.medida_real
  from pedido_items it join prep_items x on x.item_id=it.id where it.pedido_id=p_id order by it.orden,it.id loop
  restante:=case when i.falta then greatest(0,i.cantidad-i.enviado-coalesce(i.sustituye,0)) else 0 end;
  update pedido_items set cantidad_entregada=case when restante>0 then i.cantidad-restante else null end,
   motivo_faltante=case when restante>0 then 'otro' else null end,
   detalle_faltante=case when restante>0 then 'Pendiente de completar' else null end where id=i.id;
  if restante>0 then
   faltantes:=faltantes||jsonb_build_array(jsonb_build_object('producto',i.producto,'cantidad',restante,'fetear',i.fetear,'sin_cuero',i.sin_cuero,'en_unidades',i.en_unidades,'medida',coalesce(i.medida_real,i.medida),'orden',jsonb_array_length(faltantes)));
   detalle:=detalle||case when detalle='' then '' else '; ' end||restante||' '||i.producto;
  end if;
 end loop;
 if jsonb_array_length(faltantes)>0 then
  repo:='repo_'||md5(p_id||clock_timestamp()::text||random()::text);
  select public.guardar_pedido(jsonb_build_object('id',repo,'fecha',hoy,'quien',p_quien,'cliente',p.cliente,'fecha_entrega','',
   'direccion',coalesce(p.direccion,''),'retiro',false,'notas','🔁 REPOSICIÓN — Pendiente del pedido '||p_id||': '||detalle),faltantes) into respuesta;
  if not coalesce((respuesta->>'ok')::boolean,false) then raise exception 'No se pudo generar la reposición: %',respuesta; end if;
 end if;
 update pedidos set estado='Despachado',fecha_despacho=hoy where id=p_id;
 update prep_pedidos set cargado=true,cargado_por=p_quien,cargado_en=now(),reposicion_id=repo where pedido_id=p_id;
 return jsonb_build_object('ok',true,'reposicion_id',repo);
end $$;
revoke all on function public.prep_leer(text),public.prep_confirmar(text,text,text,text,boolean),public.prep_cargar(text,text,text) from public,anon;
grant execute on function public.prep_leer(text),public.prep_confirmar(text,text,text,text,boolean),public.prep_cargar(text,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
