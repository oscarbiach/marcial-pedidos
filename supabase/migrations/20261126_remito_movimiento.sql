-- Reprogramar una entrega no deshace un remito ya confeccionado.
create or replace function public.prep_al_cambiar_pedido() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if row(new.cliente,new.direccion,new.notas) is distinct from row(old.cliente,old.direccion,old.notas) then
  new.remito_hecho:=false;
 end if;
 if row(new.cliente,new.direccion,new.notas,new.fecha_entrega,new.retiro) is distinct from row(old.cliente,old.direccion,old.notas,old.fecha_entrega,old.retiro) then
  update prep_pedidos set controlado=false,control_firma=null where pedido_id=new.id;
 end if;
 return new;
end $$;

-- Solo mueve la entrega: no reescribe renglones ni valores de preparación.
create or replace function public.pedido_mover_entrega(p_id text,p_fecha date,p_anterior date) returns jsonb
language plpgsql security invoker set search_path=public as $$
begin
 if auth.uid() is null then raise exception 'Iniciá sesión nuevamente' using errcode='42501'; end if;
 update pedidos set fecha_entrega=p_fecha where id=p_id and estado='Pendiente' and eliminado_en is null
  and fecha_entrega is not distinct from p_anterior;
 if not found then raise exception 'El pedido cambió. Actualizá y volvé a moverlo.'; end if;
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.pedido_mover_entrega(text,date,date) from public,anon;
grant execute on function public.pedido_mover_entrega(text,date,date) to authenticated;
