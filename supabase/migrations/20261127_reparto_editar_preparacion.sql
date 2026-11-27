begin;
alter table public.prep_items add column if not exists revisar_edicion boolean not null default false;

create table if not exists public.prep_retirados (
  item_id bigint primary key,
  pedido_id text not null references public.pedidos(id) on delete cascade,
  producto text not null,
  preparacion jsonb not null,
  retirado_en timestamptz not null default now()
);
create index if not exists prep_retirados_pedido on public.prep_retirados(pedido_id);
alter table public.prep_retirados enable row level security;
revoke all on public.prep_retirados from public,anon,authenticated;
grant select on public.prep_retirados to authenticated;
drop policy if exists prep_retirados_lectura on public.prep_retirados;
create policy prep_retirados_lectura on public.prep_retirados for select to authenticated
 using (exists(select 1 from public.pedidos p where p.id=pedido_id));

create or replace function public.prep_tiene_evidencia(x public.prep_items) returns boolean
language sql immutable set search_path=public as $$
 select x.foto is not null or x.sustituto_foto is not null or x.peso>0 is true
    or x.sustituto_peso>0 is true or cardinality(x.fotos_extra)>0 or cardinality(x.sustituto_fotos_extra)>0;
$$;

create or replace function public.prep_archivar_retirado() returns trigger
language plpgsql security definer set search_path='' as $$
declare x public.prep_items;
begin
 if exists(select 1 from public.pedidos where id=old.pedido_id) then
  select * into x from public.prep_items where item_id=old.id for update;
  if found and public.prep_tiene_evidencia(x) then
   insert into public.prep_retirados(item_id,pedido_id,producto,preparacion)
    values(old.id,old.pedido_id,old.producto,to_jsonb(x));
  end if;
 end if;
 return old;
end $$;
revoke all on function public.prep_archivar_retirado() from public,anon,authenticated;
drop trigger if exists prep_conservar_retirado on public.pedido_items;
create trigger prep_conservar_retirado before delete on public.pedido_items
 for each row execute function public.prep_archivar_retirado();

create or replace function public.editar_pedido(p jsonb,its jsonb) returns jsonb
language plpgsql security invoker set search_path=public as $$
declare
 pedido text:=p->>'id'; est text; x jsonb; item bigint; candidatos bigint[];
 conservados bigint[]:='{}'; reservados bigint[]; fila public.pedido_items;
begin
 select estado into est from pedidos where id=pedido for update;
 if not found then return jsonb_build_object('ok',false,'error','Pedido no encontrado'); end if;
 if est<>'Pendiente' then return jsonb_build_object('ok',false,'error','Solo se pueden editar pedidos pendientes'); end if;
 perform 1 from pedido_items where pedido_id=pedido order by id for update;
 select coalesce(array_agg((j->>'id')::bigint),'{}') into reservados
  from jsonb_array_elements(its) j where j->>'id' is not null;
 if cardinality(reservados)<>(select count(*) from pedido_items where pedido_id=pedido and id=any(reservados)) then
  raise exception 'Los renglones del pedido cambiaron. Actualizá y volvé a abrirlo.';
 end if;
 update pedidos set cliente=p->>'cliente',fecha_entrega=nullif(p->>'fecha_entrega','')::date,
  direccion=nullif(p->>'direccion',''),notas=nullif(p->>'notas',''),retiro=coalesce((p->>'retiro')::boolean,false)
  where id=pedido;
 for x in select value from jsonb_array_elements(its) loop
  item:=(x->>'id')::bigint;
  -- Las versiones anteriores enviaban solo los datos del producto.
  if not (x ? 'id') then
   select array_agg(i.id) into candidatos from pedido_items i where i.pedido_id=pedido
    and i.producto=x->>'producto' and not (i.id=any(conservados||reservados));
   if cardinality(candidatos)=1 then item:=candidatos[1]; end if;
  end if;
  fila.producto:=x->>'producto'; fila.cantidad:=(x->>'cantidad')::numeric;
  fila.fetear:=coalesce((x->>'fetear')::boolean,false); fila.sin_cuero:=coalesce((x->>'sin_cuero')::boolean,false);
  fila.en_unidades:=coalesce((x->>'en_unidades')::boolean,false); fila.medida:=nullif(x->>'medida',''); fila.orden:=coalesce((x->>'orden')::int,0);
  if item is null then
   insert into pedido_items(pedido_id,producto,cantidad,fetear,sin_cuero,en_unidades,medida,orden)
    values(pedido,fila.producto,fila.cantidad,fila.fetear,fila.sin_cuero,fila.en_unidades,fila.medida,fila.orden) returning id into item;
  else
   update pedido_items set producto=fila.producto,cantidad=fila.cantidad,fetear=fila.fetear,sin_cuero=fila.sin_cuero,
    en_unidades=fila.en_unidades,medida=fila.medida,orden=fila.orden where id=item and pedido_id=pedido;
  end if;
  conservados:=array_append(conservados,item);
 end loop;
 delete from pedido_items where pedido_id=pedido and not(id=any(conservados));
 update prep_items prep set revisar_edicion=true where item_id=any(conservados) and not revisar_edicion and prep_tiene_evidencia(prep);
 insert into clientes(nombre,direccion) values(p->>'cliente',nullif(p->>'direccion',''))
  on conflict(nombre_key) do update set direccion=coalesce(nullif(excluded.direccion,''),clientes.direccion);
 return jsonb_build_object('ok',true);
end $$;
notify pgrst,'reload schema';
commit;
