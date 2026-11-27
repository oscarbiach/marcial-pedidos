begin;
create or replace function public.prep_mover(p_id text,p_etapa text,p_version integer,p_quien text)
returns public.prep_cola language plpgsql security definer set search_path=public as $$
declare fila public.prep_cola; actual text; operador text;
begin
 if auth.uid() is null then raise exception 'Iniciá sesión nuevamente' using errcode='42501'; end if;
 if p_quien is null or p_quien not in ('Oscar','Thiago','Joaquin','Mateo') then raise exception 'Operador inválido'; end if;
 perform 1 from pedidos where id=p_id and estado='Pendiente' and coalesce(retiro,false)=false and eliminado_en is null for update;
 if not found then raise exception 'El pedido ya no está disponible para reparto'; end if;
 select * into fila from prep_cola where pedido_id=p_id for update;
 if coalesce(fila.version,0)<>p_version or p_version is null then raise exception 'Otro compañero actualizó este pedido. Revisá su estado.' using errcode='40001'; end if;
 actual:=coalesce(fila.etapa,'pendiente');
 if actual='pendiente' or p_etapa='pendiente' then
  operador:=case auth.uid()
   when 'dbcd0e59-fc02-4c23-b1d6-aba342da21e8'::uuid then 'Oscar'
   when 'e3e52cc0-d8e3-41e0-a641-26e33ffbcde6'::uuid then 'Joaquin'
   when 'b8b830b5-2268-4e92-897e-36f8f74135ea'::uuid then 'Thiago'
  end;
  if operador is null or operador<>p_quien then
   raise exception 'No tenés permiso para enviar o sacar pedidos del reparto' using errcode='42501';
  end if;
 end if;
 if p_etapa is null or not (
    (actual='pendiente' and p_etapa in ('por_preparar','preparando'))
    or (actual in ('por_preparar','preparando','listo') and p_etapa='pendiente')
    or (actual='por_preparar' and p_etapa='preparando')
    or (actual='preparando' and p_etapa in ('por_preparar','listo'))
    or (actual='listo' and p_etapa='preparando')
 ) then raise exception 'Movimiento no válido'; end if;
 if p_etapa='listo' then perform prep_validar(p_id); end if;
 insert into prep_cola(pedido_id,etapa,version,enviado_en,actualizado_en,actualizado_por,usuario_id)
 values(p_id,p_etapa,1,now(),now(),p_quien,auth.uid())
 on conflict(pedido_id) do update set etapa=p_etapa,version=prep_cola.version+1,
 enviado_en=case when actual='pendiente' then now() else prep_cola.enviado_en end,
 actualizado_en=now(),actualizado_por=p_quien,usuario_id=auth.uid() returning * into fila;
 return fila;
end $$;
commit;
