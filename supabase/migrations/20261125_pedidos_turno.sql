begin;
alter table public.pedidos add column if not exists turno text not null default '' check (turno in ('','manana','tarde'));

-- Keep the original save/edit functions and their validations. Both writes
-- belong to one transaction; legacy clients continue to leave turno unchanged.
create or replace function public.pedido_guardar_turno(p jsonb, its jsonb, p_editar boolean default false)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare r jsonb; t text:=coalesce(p->>'turno','');
begin
 if auth.uid() is null then raise exception 'Iniciá sesión'; end if;
 if t not in ('','manana','tarde') then raise exception 'Turno inválido'; end if;
 if p_editar then
  r:=public.editar_pedido(p,its);
 else
  r:=public.guardar_pedido(p,its);
 end if;
 if coalesce((r->>'ok')::boolean,false) and not coalesce((r->>'yaEstaba')::boolean,false) and p ? 'turno' then
  update public.pedidos set turno=t where id=coalesce(r->>'id',p->>'id');
  if not found then raise exception 'No se pudo guardar el turno'; end if;
 end if;
 return r;
end $$;

create or replace function public.pedido_cambiar_turno(p_id text,p_turno text,p_anterior text)
returns jsonb language plpgsql security invoker set search_path=public as $$
begin
 if auth.uid() is null then raise exception 'Iniciá sesión'; end if;
 if p_turno is null or p_turno not in ('','manana','tarde') then raise exception 'Turno inválido'; end if;
 update public.pedidos set turno=p_turno
 where id=p_id and estado='Pendiente' and eliminado_en is null and turno=p_anterior;
 if not found then raise exception 'El pedido cambió. Actualizá y volvé a intentarlo.'; end if;
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.pedido_guardar_turno(jsonb,jsonb,boolean),public.pedido_cambiar_turno(text,text,text) from public,anon;
grant execute on function public.pedido_guardar_turno(jsonb,jsonb,boolean),public.pedido_cambiar_turno(text,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
