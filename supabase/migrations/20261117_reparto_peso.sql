-- El peso entregado solo equivale a cantidad en pedidos expresados en kg.
begin;
create or replace function public.prep_medida(i public.pedido_items, medida_real text)
returns text language sql stable security definer set search_path=public as $$
 select case when i.fetear then 'kg' else coalesce(nullif(medida_real,''),nullif(i.medida,''),
   case when i.en_unidades then case
     when p.unidad in ('caja','tira') and p.unidades_por_caja>0 then case when p.unidad='caja' and p.caja_en='kg' then 'kg' else 'unidad' end
     when p.alterna_unidad and p.unidad='kg' then 'unidad'
     when p.alterna_unidad and p.unidad='unidad' then 'kg'
     else p.unidad end else p.unidad end) end
 from (select 1) seed left join lateral
   (select * from productos where nombre=i.producto order by activo desc,creado_en desc limit 1) p on true
$$;
revoke all on function public.prep_medida(public.pedido_items,text) from public,anon,authenticated;

create or replace function public.prep_peso_cantidad() returns trigger
language plpgsql security definer set search_path=public as $$
declare i pedido_items;
begin
 select * into i from pedido_items where id=new.item_id;
 if prep_medida(i,new.medida_real)='kg' and new.peso>0 and new.peso::text not in ('NaN','Infinity','-Infinity') then
   new.enviado:=least(i.cantidad,round(new.peso,3));
   new.falta:=new.enviado<i.cantidad or nullif(trim(new.sustituto),'') is not null;
 end if;
 return new;
end $$;
revoke all on function public.prep_peso_cantidad() from public,anon,authenticated;
drop trigger if exists prep_peso_cantidad on public.prep_items;
create trigger prep_peso_cantidad before insert or update on public.prep_items
for each row execute function public.prep_peso_cantidad();
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
 for i in select it.*,x.falta,x.enviado,x.sustituto,x.sustituto_cantidad,x.sustituto_medida,x.sustituye,x.medida_real,x.peso,prep_medida(it,x.medida_real) as medida_pedido
  from pedido_items it join prep_items x on x.item_id=it.id where it.pedido_id=p_id order by it.orden,it.id loop
  restante:=case when i.medida_pedido='kg' and i.peso>0 and i.peso::text not in ('NaN','Infinity','-Infinity') then greatest(0,i.cantidad-round(i.peso,3)-coalesce(i.sustituye,0)) when i.falta then greatest(0,i.cantidad-i.enviado-coalesce(i.sustituye,0)) else 0 end;
  update pedido_items set cantidad_entregada=case when restante>0 then i.cantidad-restante else null end,
   motivo_faltante=case when restante>0 then 'otro' else null end,
   detalle_faltante=case when restante>0 then 'Pendiente de completar' else null end where id=i.id;
  if restante>0 then
   faltantes:=faltantes||jsonb_build_array(jsonb_build_object('producto',i.producto,'cantidad',restante,'fetear',i.fetear,'sin_cuero',i.sin_cuero,'en_unidades',i.en_unidades,'medida',i.medida_pedido,'orden',jsonb_array_length(faltantes)));
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
notify pgrst,'reload schema';
commit;
