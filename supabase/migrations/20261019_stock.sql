-- Stock propio de la app (19/10/2026).
--
-- Cómo funciona:
--   · Dubix sigue facturando. Sus ventas entran acá subiendo el CSV
--     "Productos Vendidos" (stock_importar_ventas) y se descuentan solas.
--   · El stock real sale de los RECUENTOS que se hacen con el celular.
--     Un recuento vale como stock al ARRANCAR el día de su fecha: todo lo
--     vendido o ingresado desde ese día en adelante se suma o resta después.
--   · Ingresos de mercadería y ajustes se cargan a mano en la app.
--   · stock_actual = último recuento cerrado + movimientos desde esa fecha.
--
-- Solo lo ven y lo tocan los usuarios de stock_acceso (Oscar y Joaquín).

-- ── Quién tiene acceso ─────────────────────────────────────────────
create table if not exists public.stock_acceso (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nombre  text not null
);
alter table public.stock_acceso enable row level security;

create or replace function public.stock_es_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from stock_acceso where user_id = auth.uid());
$$;

create or replace function public.stock_autor()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select nombre from stock_acceso where user_id = auth.uid()), '?');
$$;

create policy stock_acceso_leer on public.stock_acceso
  for select to authenticated using (user_id = auth.uid());

-- ── Productos (catálogo de Dubix) ─────────────────────────────────
create table if not exists public.stock_productos (
  id           uuid primary key default gen_random_uuid(),
  codigo       text,                          -- código de Dubix (algunos no tienen)
  nombre       text not null,                 -- descripción de Dubix
  nombre_key   text generated always as (lower(trim(nombre))) stored,
  marca        text not null default 'Otros', -- para ordenar el recuento por estante/proveedor
  unidad       text not null default 'u' check (unidad in ('u','kg','caja')),
  activo       boolean not null default true,
  producto_id  uuid references public.productos(id) on delete set null, -- vínculo con la app de pedidos (opcional)
  stock_dubix  numeric,                       -- lo que decía Dubix la última vez que se leyó
  dubix_leido_en timestamptz,
  costo        numeric,                       -- costo s/IVA de Dubix
  creado_en    timestamptz not null default now()
);
create unique index if not exists stock_productos_codigo_uq on public.stock_productos (codigo) where codigo is not null;
create unique index if not exists stock_productos_nombre_sin_codigo_uq on public.stock_productos (nombre_key) where codigo is null;
alter table public.stock_productos enable row level security;
create policy stock_prod_todo on public.stock_productos
  for all to authenticated using (stock_es_admin()) with check (stock_es_admin());

-- ── Recuentos ──────────────────────────────────────────────────────
create table if not exists public.stock_recuentos (
  id          uuid primary key default gen_random_uuid(),
  fecha       date not null default (now() at time zone 'America/Argentina/Buenos_Aires')::date,
  estado      text not null default 'abierto' check (estado in ('abierto','cerrado','anulado')),
  nota        text check (nota is null or length(nota) <= 500),
  autor       text not null default stock_autor(),
  creado_en   timestamptz not null default now(),
  cerrado_en  timestamptz,
  cerrado_por text
);
-- Un solo recuento abierto a la vez: así Oscar y Joaquín cuentan sobre el mismo.
create unique index if not exists stock_recuentos_un_abierto on public.stock_recuentos ((true)) where estado = 'abierto';
alter table public.stock_recuentos enable row level security;
create policy stock_rec_leer  on public.stock_recuentos for select to authenticated using (stock_es_admin());
create policy stock_rec_crear on public.stock_recuentos for insert to authenticated with check (stock_es_admin() and estado = 'abierto');

create table if not exists public.stock_recuento_items (
  id           bigint generated always as identity primary key,
  recuento_id  uuid not null references public.stock_recuentos(id) on delete cascade,
  producto_id  uuid not null references public.stock_productos(id),
  contado      numeric not null check (contado >= 0),
  sistema      numeric,   -- stock de la app al cerrar (null si nunca se contó)
  dubix        numeric,   -- stock de Dubix al cerrar (para el ajuste en Dubix)
  autor        text not null default stock_autor(),
  contado_en   timestamptz not null default now(),
  unique (recuento_id, producto_id)
);
alter table public.stock_recuento_items enable row level security;
create policy stock_ri_leer on public.stock_recuento_items for select to authenticated using (stock_es_admin());
-- Solo se carga o corrige mientras el recuento está abierto.
create policy stock_ri_crear on public.stock_recuento_items for insert to authenticated
  with check (stock_es_admin() and exists (select 1 from stock_recuentos r where r.id = recuento_id and r.estado = 'abierto'));
create policy stock_ri_editar on public.stock_recuento_items for update to authenticated
  using (stock_es_admin() and exists (select 1 from stock_recuentos r where r.id = recuento_id and r.estado = 'abierto'))
  with check (stock_es_admin());
create policy stock_ri_borrar on public.stock_recuento_items for delete to authenticated
  using (stock_es_admin() and exists (select 1 from stock_recuentos r where r.id = recuento_id and r.estado = 'abierto'));

-- ── Importaciones de ventas (CSV de Dubix) ─────────────────────────
create table if not exists public.stock_importaciones (
  id        uuid primary key default gen_random_uuid(),
  archivo   text,
  desde     date not null,
  hasta     date not null check (hasta >= desde),
  filas     integer not null default 0,
  sin_match integer not null default 0,
  autor     text not null default stock_autor(),
  creado_en timestamptz not null default now(),
  anulada   boolean not null default false
);
alter table public.stock_importaciones enable row level security;
create policy stock_imp_leer on public.stock_importaciones for select to authenticated using (stock_es_admin());

-- ── Movimientos (ventas, ingresos, ajustes, mermas) ────────────────
-- cantidad con signo: + entra, − sale.
create table if not exists public.stock_movimientos (
  id            bigint generated always as identity primary key,
  producto_id   uuid not null references public.stock_productos(id),
  tipo          text not null check (tipo in ('venta','ingreso','ajuste','merma')),
  cantidad      numeric not null check (cantidad <> 0),
  fecha         date not null default (now() at time zone 'America/Argentina/Buenos_Aires')::date,
  importacion_id uuid references public.stock_importaciones(id) on delete cascade,
  nota          text check (nota is null or length(nota) <= 300),
  autor         text not null default stock_autor(),
  creado_en     timestamptz not null default now()
);
create index if not exists stock_mov_prod_fecha on public.stock_movimientos (producto_id, fecha);
alter table public.stock_movimientos enable row level security;
create policy stock_mov_leer on public.stock_movimientos for select to authenticated using (stock_es_admin());
-- A mano solo ingresos, ajustes y mermas; las ventas entran por la importación.
create policy stock_mov_crear on public.stock_movimientos for insert to authenticated
  with check (stock_es_admin() and tipo in ('ingreso','ajuste','merma') and importacion_id is null);
create policy stock_mov_borrar on public.stock_movimientos for delete to authenticated
  using (stock_es_admin() and importacion_id is null);

-- ── Stock actual ───────────────────────────────────────────────────
create or replace view public.stock_actual with (security_invoker = true) as
with ultimo as (
  select distinct on (i.producto_id)
         i.producto_id, i.contado, r.fecha
  from stock_recuento_items i
  join stock_recuentos r on r.id = i.recuento_id and r.estado = 'cerrado'
  order by i.producto_id, r.fecha desc, r.cerrado_en desc
),
mov as (
  select p.id as producto_id,
         coalesce(sum(m.cantidad) filter (where m.tipo = 'venta'), 0)   as ventas,
         coalesce(sum(m.cantidad) filter (where m.tipo = 'ingreso'), 0) as ingresos,
         coalesce(sum(m.cantidad) filter (where m.tipo in ('ajuste','merma')), 0) as ajustes
  from stock_productos p
  left join ultimo u on u.producto_id = p.id
  left join stock_movimientos m on m.producto_id = p.id and (u.fecha is null or m.fecha >= u.fecha)
  group by p.id
)
select p.id, p.codigo, p.nombre, p.marca, p.unidad, p.activo, p.stock_dubix, p.dubix_leido_en,
       u.fecha   as ultimo_recuento,
       u.contado as contado_ultimo,
       m.ventas, m.ingresos, m.ajustes,
       case when u.producto_id is null then null
            else u.contado + m.ventas + m.ingresos + m.ajustes end as stock
from stock_productos p
join mov m on m.producto_id = p.id
left join ultimo u on u.producto_id = p.id;

grant select on public.stock_actual to authenticated;

-- ── Cerrar un recuento ─────────────────────────────────────────────
-- Guarda, para cada ítem, cuánto decía la app y cuánto decía Dubix en ese
-- momento (así queda la diferencia y el ajuste a pasar a Dubix).
create or replace function public.stock_cerrar_recuento(p_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare v_fecha date; v_n integer;
begin
  if not stock_es_admin() then raise exception 'Sin permiso'; end if;
  select fecha into v_fecha from stock_recuentos where id = p_id and estado = 'abierto' for update;
  if v_fecha is null then raise exception 'El recuento no existe o ya está cerrado'; end if;
  if exists (select 1 from stock_importaciones x
             where not x.anulada and x.desde < v_fecha and x.hasta >= v_fecha) then
    raise exception 'Hay ventas importadas que cruzan el %: importá las ventas por separado antes y después de esa fecha', to_char(v_fecha,'DD/MM');
  end if;
  update stock_recuento_items i
     set sistema = a.stock, dubix = p.stock_dubix
    from stock_actual a, stock_productos p
   where i.recuento_id = p_id and a.id = i.producto_id and p.id = i.producto_id;
  get diagnostics v_n = row_count;
  update stock_recuentos set estado = 'cerrado', cerrado_en = now(), cerrado_por = stock_autor() where id = p_id;
  return v_n;
end $$;

create or replace function public.stock_anular_recuento(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not stock_es_admin() then raise exception 'Sin permiso'; end if;
  update stock_recuentos set estado = 'anulado', cerrado_en = now(), cerrado_por = stock_autor()
   where id = p_id and estado = 'abierto';
  if not found then raise exception 'El recuento no existe o no está abierto'; end if;
end $$;

-- ── Importar ventas del CSV de Dubix ───────────────────────────────
-- p_filas: [{"producto_id": uuid, "cantidad": numeric}] ya emparejadas en la app.
create or replace function public.stock_importar_ventas(p_archivo text, p_desde date, p_hasta date, p_filas jsonb, p_sin_match integer default 0)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_cruce date;
begin
  if not stock_es_admin() then raise exception 'Sin permiso'; end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde then raise exception 'Fechas inválidas'; end if;
  if p_hasta >= (now() at time zone 'America/Argentina/Buenos_Aires')::date + 1 then
    raise exception 'La fecha hasta no puede ser futura';
  end if;
  if exists (select 1 from stock_importaciones x
             where not x.anulada and x.desde <= p_hasta and x.hasta >= p_desde) then
    raise exception 'Ya hay ventas importadas para parte de ese período (% a %)', to_char(p_desde,'DD/MM'), to_char(p_hasta,'DD/MM');
  end if;
  select r.fecha into v_cruce from stock_recuentos r
   where r.estado in ('abierto','cerrado') and r.fecha > p_desde and r.fecha <= p_hasta limit 1;
  if v_cruce is not null then
    raise exception 'El período cruza el recuento del %: importá hasta el % y desde el % por separado',
      to_char(v_cruce,'DD/MM'), to_char(v_cruce - 1,'DD/MM'), to_char(v_cruce,'DD/MM');
  end if;
  insert into stock_importaciones (archivo, desde, hasta, filas, sin_match)
  values (p_archivo, p_desde, p_hasta, jsonb_array_length(p_filas), coalesce(p_sin_match,0))
  returning id into v_id;
  insert into stock_movimientos (producto_id, tipo, cantidad, fecha, importacion_id, nota)
  select (f->>'producto_id')::uuid, 'venta', -abs((f->>'cantidad')::numeric), p_desde, v_id, p_archivo
    from jsonb_array_elements(p_filas) f
   where coalesce((f->>'cantidad')::numeric, 0) <> 0;
  return v_id;
end $$;

create or replace function public.stock_anular_importacion(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not stock_es_admin() then raise exception 'Sin permiso'; end if;
  delete from stock_movimientos where importacion_id = p_id;
  update stock_importaciones set anulada = true where id = p_id;
end $$;

revoke execute on function public.stock_cerrar_recuento(uuid), public.stock_anular_recuento(uuid),
  public.stock_importar_ventas(text, date, date, jsonb, integer), public.stock_anular_importacion(uuid) from public, anon;
grant execute on function public.stock_cerrar_recuento(uuid), public.stock_anular_recuento(uuid),
  public.stock_importar_ventas(text, date, date, jsonb, integer), public.stock_anular_importacion(uuid),
  public.stock_es_admin(), public.stock_autor() to authenticated;

-- Oscar y Joaquín
insert into public.stock_acceso (user_id, nombre)
select id, case when lower(email) = 'bianchi.i.oscar@gmail.com' then 'Oscar' else 'Joaquin' end
  from auth.users where lower(email) in ('bianchi.i.oscar@gmail.com', 'joakocalvo321@gmail.com')
on conflict (user_id) do nothing;
