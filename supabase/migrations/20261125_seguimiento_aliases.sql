-- Nombres anteriores comprobados por Administración, nunca coincidencias aproximadas.
begin;
create or replace function public.seg_clientes_aliases()
returns table(alias text,nombre text,cliente_id uuid)
language sql stable security definer set search_path=public as $$
 with recursive origen as (
  select a.antes->>'nombre' as alias,c.id
  from admin_cambios a join clientes c on c.id::text=a.registro
  where a.tabla='clientes' and a.accion='renombrar' and nullif(a.antes->>'nombre','') is not null
  union select c.nombre,c.id from clientes c where c.fusionado_en is not null
 ), semillas as (
  select * from origen
  union
  select corto,o.id from origen o cross join unnest(array['eber','lucas charruca','sofi']) corto
  where lower(trim(o.alias)) like corto||' - %'
   and not exists(select 1 from clientes x where x.id<>o.id and (x.nombre_key=corto or x.nombre_key like corto||' - %'))
 ), camino as (
  select s.alias,c.id,c.nombre,c.fusionado_en,array[c.id] as visitados from semillas s join clientes c on c.id=s.id
  union all
  select p.alias,c.id,c.nombre,c.fusionado_en,p.visitados||c.id
  from camino p join clientes c on c.id=p.fusionado_en where not c.id=any(p.visitados)
 ), finales as (
  select lower(trim(p.alias)) as alias,p.nombre,p.id from camino p
  where p.fusionado_en is null and lower(trim(p.alias))<>lower(trim(p.nombre))
   and not exists(select 1 from clientes x where x.nombre_key=lower(trim(p.alias)) and x.id<>p.id and x.fusionado_en is null)
 )
 select f.alias,min(f.nombre),min(f.id::text)::uuid from finales f
 where auth.uid() is not null
 group by f.alias having count(distinct f.id)=1;
$$;
revoke all on function public.seg_clientes_aliases() from public,anon;
grant execute on function public.seg_clientes_aliases() to authenticated;
-- Pedido antiguo verificado: quedó fuera del renombre porque usaba el nombre corto.
with corregido as (
 update pedidos p set cliente=c.nombre
 from clientes c
 where p.id='mrv0ocwjdbk' and p.cliente='Lucas Charruca'
  and p.estado='Despachado' and not p.remito_hecho
  and not exists(select 1 from prep_pedidos pp where pp.pedido_id=p.id)
  and c.id='8ba90423-f273-40cd-8c75-8818db97e864'
  and c.nombre='Lucas Onlyburger Sauce' and c.fusionado_en is null
 returning p.id,p.cliente
)
insert into admin_cambios(tabla,registro,accion,antes,despues,autor)
select 'pedidos',id,'editar',jsonb_build_object('cliente','Lucas Charruca'),
 jsonb_build_object('cliente',cliente),'Corrección de nombre histórico' from corregido;
commit;
