-- Cola compartida: no cambia el estado comercial ni despacha un pedido.
begin;
create table if not exists public.prep_cola (
  pedido_id text primary key references public.pedidos(id) on delete cascade,
  etapa text not null check (etapa in ('pendiente','por_preparar','preparando','listo')),
  version integer not null default 1,
  enviado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  actualizado_por text not null,
  usuario_id uuid references auth.users(id)
);
alter table public.prep_cola enable row level security;
create policy prep_cola_leer on public.prep_cola for select to authenticated using (true);
grant select on public.prep_cola to authenticated;
revoke insert, update, delete on public.prep_cola from anon, authenticated;

-- Un cambio lleva la versión que vio el operador. Dos pantallas no se pisan.
-- p_quien es la etiqueta de la sesión PIN existente; usuario_id audita la identidad Auth.
create or replace function public.prep_mover(p_id text, p_etapa text, p_version integer, p_quien text)
returns public.prep_cola language plpgsql security definer set search_path = public as $$
declare fila public.prep_cola; actual text;
begin
  if auth.uid() is null then raise exception 'Iniciá sesión nuevamente' using errcode='42501'; end if;
  if p_quien is null or p_quien not in ('Oscar','Thiago','Joaquin','Mateo') then
    raise exception 'Operador de preparación inválido';
  end if;
  -- La fila del pedido también serializa el primer envío y los cambios de estado.
  perform 1 from public.pedidos where id=p_id and estado='Pendiente'
    and coalesce(retiro,false)=false and eliminado_en is null for update;
  if not found then raise exception 'El pedido ya no está disponible para reparto'; end if;
  select * into fila from public.prep_cola where pedido_id=p_id for update;
  if coalesce(fila.version,0) <> p_version or p_version is null then
    raise exception 'Otro compañero actualizó este pedido. Revisá su estado.' using errcode='40001';
  end if;
  actual := coalesce(fila.etapa,'pendiente');
  if not ((actual='pendiente' and p_etapa='por_preparar')
    or (actual='por_preparar' and p_etapa in ('pendiente','preparando'))
    or (actual='preparando' and p_etapa in ('por_preparar','listo'))
    or (actual='listo' and p_etapa='preparando')) then
    raise exception 'Movimiento no válido';
  end if;
  if p_etapa='listo' then
    if not exists (select 1 from public.pedido_items where pedido_id=p_id) or exists (
      select 1 from public.pedido_items i
      left join public.prep_items pi on pi.item_id=i.id
      left join public.prep_productos pr on pr.nombre=i.producto
      where i.pedido_id=p_id and (
        not coalesce(pi.separado,false)
        or (coalesce(pi.falta,false) and (pi.enviado is null or pi.enviado < 0 or pi.enviado > i.cantidad))
        or (coalesce(pr.se_pesa,false) and not (coalesce(pi.falta,false) and pi.enviado=0)
            and (coalesce(pi.peso,0)<=0 or coalesce(pi.foto,'')=''))
      )
    ) then raise exception 'Revisá los productos: faltan separar, completar faltantes o registrar peso y foto.'; end if;
  end if;
  insert into public.prep_cola(pedido_id,etapa,version,enviado_en,actualizado_en,actualizado_por,usuario_id)
    values(p_id,p_etapa,1,now(),now(),p_quien,auth.uid())
  on conflict(pedido_id) do update set etapa=p_etapa,version=prep_cola.version+1,
    enviado_en=case when actual='pendiente' then now() else prep_cola.enviado_en end,
    actualizado_en=now(),actualizado_por=p_quien,usuario_id=auth.uid()
  returning * into fila;
  return fila;
end $$;
revoke all on function public.prep_mover(text,text,integer,text) from public, anon;
grant execute on function public.prep_mover(text,text,integer,text) to authenticated;

-- Realtime también cubre productos, renglones y cambios de pedidos.
do $$ declare t text; begin
  foreach t in array array['prep_cola','prep_items','prep_pedidos','prep_productos','pedidos','pedido_items'] loop
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
      execute format('alter publication supabase_realtime add table public.%I',t);
    end if;
  end loop;
end $$;
commit;
