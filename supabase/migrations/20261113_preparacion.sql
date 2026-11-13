-- Preparación de pedidos en el depósito (iPad del repartidor), pedido de Oscar 13/11/2026.
-- Sigue el cartel del depósito: 2 juntar el total · 3 separar por cliente · 4 pesar y foto · 5 remitos · 6 controlar · cargar.
-- No toca pedidos ni pedido_items: todo lo de la preparación va en tablas propias.

-- Seco / frío y si se pesa, por producto (se puede cambiar desde la pantalla de preparación).
create table if not exists prep_productos (
  nombre text primary key,
  frio boolean not null default true,
  se_pesa boolean not null default false,
  actualizado_en timestamptz not null default now()
);

-- Estado de cada renglón de pedido mientras se prepara.
create table if not exists prep_items (
  item_id bigint primary key references pedido_items(id) on delete cascade,
  juntado boolean not null default false,
  separado boolean not null default false,
  falta boolean not null default false,
  enviado numeric,                 -- si falta: cuánto se mandó de verdad (en la medida del renglón)
  peso numeric,                    -- kg pesados
  foto text,                       -- ruta en el bucket «preparacion»
  quien text,
  actualizado_en timestamptz not null default now()
);

-- Estado de cada pedido: controlado (responsable de remitos) y cargado (repartidor).
create table if not exists prep_pedidos (
  pedido_id text primary key references pedidos(id) on delete cascade,
  controlado boolean not null default false,
  controlado_por text,
  controlado_en timestamptz,
  cargado boolean not null default false,
  cargado_por text,
  cargado_en timestamptz
);

alter table prep_productos enable row level security;
alter table prep_items enable row level security;
alter table prep_pedidos enable row level security;
create policy prep_productos_todo on prep_productos for all to authenticated using (true) with check (true);
create policy prep_items_todo on prep_items for all to authenticated using (true) with check (true);
create policy prep_pedidos_todo on prep_pedidos for all to authenticated using (true) with check (true);

-- Fotos de lo pesado (privadas: solo usuarios con sesión).
insert into storage.buckets (id, name, public) values ('preparacion', 'preparacion', false) on conflict (id) do nothing;
create policy prep_fotos_leer on storage.objects for select to authenticated using (bucket_id = 'preparacion');
create policy prep_fotos_subir on storage.objects for insert to authenticated with check (bucket_id = 'preparacion');
create policy prep_fotos_cambiar on storage.objects for update to authenticated using (bucket_id = 'preparacion');
