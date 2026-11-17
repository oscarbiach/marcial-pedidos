-- Despacho general: conserva faltantes del armado y crea reposición en la misma transacción.
begin;
create or replace function public.despachar_con_faltantes(p_ids text[],p_respuestas jsonb,p_quien text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare p pedidos; i record; r jsonb; falta numeric; armado numeric; faltantes jsonb;
 hechos jsonb:='[]'; repos jsonb:='[]'; repo text; resultado jsonb; hoy date:=(now() at time zone 'America/Montevideo')::date;
begin
 if auth.uid() is null then raise exception 'Iniciá sesión nuevamente' using errcode='42501'; end if;
 if p_quien is null or p_quien not in ('Oscar','Thiago','Joaquin','Mateo') then raise exception 'Operador inválido'; end if;
 if cardinality(p_ids)>100 then raise exception 'Seleccioná hasta 100 pedidos'; end if;
 for p in select * from pedidos where id=any(p_ids) and estado='Pendiente' and eliminado_en is null order by id for update loop
  faltantes:='[]';
  for i in select it.*,x.falta,x.enviado,x.sustituye,x.peso,x.separado,prep_medida(it,x.medida_real) as medida_pedido
   from pedido_items it left join prep_items x on x.item_id=it.id where it.pedido_id=p.id order by it.orden,it.id loop
   r:=p_respuestas->p.id->i.id::text;
   if r is null or (r->>'cantidadPedida')::numeric is distinct from i.cantidad then raise exception 'El pedido cambió. Volvé a revisar el despacho.' using errcode='40001'; end if;
   falta:=case when (r->>'completo')::boolean then 0 else (r->>'cantidadNoEntregada')::numeric end;
   if falta is null or falta<0 or falta>i.cantidad or falta::text in ('NaN','Infinity','-Infinity') then raise exception 'Revisá la cantidad pendiente de %',i.producto; end if;
   armado:=case when i.separado and i.medida_pedido='kg' and i.peso>0 and i.peso::text not in ('NaN','Infinity','-Infinity') then greatest(0,i.cantidad-round(i.peso,3)-coalesce(i.sustituye,0))
    when i.separado and i.falta then greatest(0,i.cantidad-coalesce(i.enviado,0)-coalesce(i.sustituye,0)) else 0 end;
   falta:=greatest(falta,armado);
   update pedido_items set cantidad_entregada=case when falta>0 then i.cantidad-falta else null end,
    motivo_faltante=case when falta>0 then 'otro' else null end,detalle_faltante=case when falta>0 then 'Pendiente de completar' else null end where id=i.id;
   if falta>0 then faltantes:=faltantes||jsonb_build_array(jsonb_build_object('producto',i.producto,'cantidad',falta,'fetear',i.fetear,'sin_cuero',i.sin_cuero,'en_unidades',i.en_unidades,'medida',i.medida_pedido,'orden',jsonb_array_length(faltantes))); end if;
  end loop;
  if jsonb_array_length(faltantes)>0 then
   repo:='repo_'||md5(p.id||clock_timestamp()::text||random()::text);
   select guardar_pedido(jsonb_build_object('id',repo,'fecha',hoy,'quien',p_quien,'cliente',p.cliente,'direccion',coalesce(p.direccion,''),'fecha_entrega','','retiro',p.retiro,
    'notas','🔁 REPOSICIÓN — Pendiente del pedido '||p.id),faltantes) into resultado;
   if not coalesce((resultado->>'ok')::boolean,false) then raise exception 'No se pudo crear la reposición'; end if;
   repos:=repos||jsonb_build_array(repo);
  else repo:=null; end if;
  update pedidos set estado='Despachado',fecha_despacho=hoy where id=p.id;
  insert into prep_pedidos(pedido_id,cargado,cargado_por,cargado_en,reposicion_id) values(p.id,true,p_quien,now(),repo)
   on conflict(pedido_id) do update set cargado=true,cargado_por=p_quien,cargado_en=now(),reposicion_id=excluded.reposicion_id;
  hechos:=hechos||jsonb_build_array(p.id);
 end loop;
 return jsonb_build_object('ok',true,'ids',hechos,'reposiciones',repos);
end $$;
revoke all on function public.despachar_con_faltantes(text[],jsonb,text) from public,anon;
grant execute on function public.despachar_con_faltantes(text[],jsonb,text) to authenticated;
notify pgrst,'reload schema';
commit;
