-- Asignar etiquetas no requiere acceso a toda la cartera ni cambiar vendedores.
begin;
create or replace function public.seg_puede_etiquetar() returns boolean
language sql stable security definer set search_path=public as $$
 select public.seg_es_gestor() or (public.seg_es_editor() and lower(trim(public.seg_nombre()))='juan marcos');
$$;
revoke all on function public.seg_puede_etiquetar() from public,anon;
grant execute on function public.seg_puede_etiquetar() to authenticated;

create or replace function public.seg_yo() returns jsonb
language sql stable security definer set search_path=public as $$
 select case when public.seg_nombre() is null then null else jsonb_build_object(
  'nombre',public.seg_nombre(),'ve_todo',public.seg_es_ve_todo(),'gestor',public.seg_es_gestor(),
  've_sin_vendedor',public.seg_ve_sin_vendedor(),'puede_etiquetar',public.seg_puede_etiquetar()) end;
$$;

create or replace function public.seg_cliente_etiquetas(p_cliente_id uuid,p_etiquetas uuid[]) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_set uuid[]:=coalesce(p_etiquetas,'{}');
begin
 if not public.seg_es_gestor() then
  if not public.seg_puede_etiquetar() or not public.seg_puede_cliente(p_cliente_id) then
   raise exception 'No tenés permiso para etiquetar este cliente' using errcode='42501';
  end if;
 end if;
 if not exists(select 1 from clientes where id=p_cliente_id) then raise exception 'Cliente desconocido' using errcode='22023'; end if;
 delete from clientes_etiquetas where cliente_id=p_cliente_id and not(etiqueta_id=any(v_set));
 insert into clientes_etiquetas(cliente_id,etiqueta_id)
 select p_cliente_id,e.id from seg_etiquetas e where e.id=any(v_set) and e.activa on conflict do nothing;
 return jsonb_build_object('ok',true,'etiquetas',coalesce((select jsonb_agg(etiqueta_id) from clientes_etiquetas where cliente_id=p_cliente_id),'[]'::jsonb));
end $$;
commit;
