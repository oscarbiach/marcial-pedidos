-- =============================================================================
--  Seguimiento v2 (24/11/2026): clientes por vendedor, etiquetas de grupo y resultado de contacto.
-- -----------------------------------------------------------------------------
--  Idempotente: se puede correr de nuevo sin duplicar ni perder datos. NO se aplicó en Supabase (hace falta OK del usuario).
--  Requiere lo ya aplicado: seg_editores, seg_decisiones, seg_agenda (14 y 21), notas_acceso, stock_es_admin()/stock_autor() y,
--  para registrar los cambios de vendedor, admin_cambios (20261120_panel_admin.sql; si no está, se omite el registro).
--
--  1. seg_usuarios(user_id, nombre, ve_todo): quién es quién en el seguimiento. Se siembra desde seg_editores (unida a auth.users por mail)
--     y desde notas_acceso. ve_todo = Joaquin y Juan Marcos (los demás ven solo los clientes que tienen asignados). Lo ya sembrado no se pisa.
--     seg_es_editor() y seg_autor() siguen aceptando a quien hoy tiene acceso (seg_editores) además de seg_usuarios: nadie pierde el acceso.
--  2. clientes.vendedor (nombre de seg_usuarios; null = atención general: solo lo ven los ve_todo). seg_puede_cliente(cliente).
--     seg_agendar, seg_escribi, seg_decidir y seg_cerrar_decision exigen seg_puede_cliente (sin cambiar sus firmas). La lectura de
--     seg_agenda y seg_decisiones se limita igual.
--  3. Etiquetas de grupo (seg_etiquetas, clientes_etiquetas): día fijo de la semana y «aparecer aunque ya se les habló».
--     Solo las cambia un administrador (stock_es_admin) o un ve_todo, por funciones idempotentes (el id lo genera el navegador).
--  4. seg_contactos: resultado de un contacto (no contestó / tiene stock / no le interesa por ahora / otro). seg_contacto_registrar es
--     idempotente por id y, en la misma transacción, actualiza seg_agenda (a qué día vuelve y la espera).
--  5. seg_cliente_vendedor: asigna el vendedor (solo administrador o ve_todo); queda en admin_cambios si existe.
--  6. seg_clientes_meta(): lo que la app lee de una vez (etiquetas, vendedor, etiquetas de cada cliente y último contacto; la lista de
--     usuarios solo para quien puede asignar).
--
--  Volver atrás (antes, sacar la app nueva): redefinir seg_es_editor/seg_autor/seg_agendar/seg_escribi/seg_decidir/seg_cerrar_decision con
--  20261120_seguimiento_identidad.sql, 14-seguimiento-decisiones.sql y 21-seguimiento-agenda.sql; restaurar las políticas seg_agenda_leer y
--  seg_dec_leer con `using (seg_es_editor())`; drop function de las nuevas; drop table seg_contactos, clientes_etiquetas, seg_etiquetas,
--  seg_usuarios; alter table clientes drop column vendedor.
-- =============================================================================
begin;

-- ── 1. Quién es quién ──────────────────────────────────────────────────────
create table if not exists public.seg_usuarios (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nombre  text not null unique,
  ve_todo boolean not null default false
);
create unique index if not exists seg_usuarios_nombre_lower on public.seg_usuarios (lower(trim(nombre)));
alter table public.seg_usuarios enable row level security;

insert into public.seg_usuarios (user_id, nombre, ve_todo)
select u.id, e.nombre, lower(trim(e.nombre)) in ('joaquin', 'joaquín', 'juan marcos')
from public.seg_editores e join auth.users u on lower(u.email) = lower(e.email)
on conflict do nothing;

do $$
begin
  if to_regclass('public.notas_acceso') is not null then
    insert into public.seg_usuarios (user_id, nombre, ve_todo)
    select n.user_id, n.nombre, lower(trim(n.nombre)) in ('joaquin', 'joaquín', 'juan marcos')
    from public.notas_acceso n where exists (select 1 from auth.users u where u.id = n.user_id)
    on conflict do nothing;
  end if;
end $$;

-- Nombre de quien tiene la sesión, o null (no levanta error).
create or replace function public.seg_nombre() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select u.nombre from public.seg_usuarios u where u.user_id = auth.uid()),
    (select e.nombre from public.seg_editores e join auth.users x on lower(e.email) = lower(x.email) where x.id = auth.uid() limit 1));
$$;

create or replace function public.seg_es_editor() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.seg_usuarios u where u.user_id = auth.uid())
      or exists (select 1 from public.seg_editores e join auth.users x on lower(e.email) = lower(x.email) where x.id = auth.uid());
$$;

create or replace function public.seg_autor() returns text
language plpgsql stable security definer set search_path = public as $$
declare v text := public.seg_nombre();
begin
  if v is null then raise exception 'No tenés permiso para el seguimiento de clientes' using errcode = '42501'; end if;
  return v;
end $$;

create or replace function public.seg_es_ve_todo() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select u.ve_todo from public.seg_usuarios u where u.user_id = auth.uid()), false);
$$;

-- Quien puede cambiar etiquetas y vendedores: un administrador de la app o un ve_todo.
create or replace function public.seg_es_gestor() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.stock_es_admin(), false) or public.seg_es_ve_todo();
$$;

create or replace function public.seg_gestor_exigir() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.seg_es_gestor() then raise exception 'Solo quien administra puede cambiar etiquetas y vendedores' using errcode = '42501'; end if;
end $$;

-- {nombre, ve_todo, gestor} de la sesión; null si no figura en el seguimiento.
create or replace function public.seg_yo() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when public.seg_nombre() is null then null
    else jsonb_build_object('nombre', public.seg_nombre(), 've_todo', public.seg_es_ve_todo(), 'gestor', public.seg_es_gestor()) end;
$$;

drop policy if exists seg_usuarios_leer on public.seg_usuarios;
create policy seg_usuarios_leer on public.seg_usuarios for select to authenticated using (user_id = auth.uid() or public.seg_es_gestor());
revoke all on public.seg_usuarios from anon, authenticated;
grant select on public.seg_usuarios to authenticated;

-- ── 2. Clientes por vendedor ───────────────────────────────────────────────
alter table public.clientes add column if not exists vendedor text;

create or replace function public.seg_puede_cliente(p_cliente_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.seg_es_ve_todo()
      or exists (select 1 from public.clientes c
                 where c.id = p_cliente_id and nullif(trim(c.vendedor), '') is not null
                   and lower(trim(c.vendedor)) = lower(trim(coalesce(public.seg_nombre(), ''))));
$$;

drop policy if exists seg_agenda_leer on public.seg_agenda;
create policy seg_agenda_leer on public.seg_agenda for select to authenticated
  using (public.seg_es_editor() and public.seg_puede_cliente(cliente_id));
drop policy if exists seg_dec_leer on public.seg_decisiones;
create policy seg_dec_leer on public.seg_decisiones for select to authenticated
  using (public.seg_es_editor() and public.seg_puede_cliente(cliente_id));

create or replace function public.seg_agendar(p_cliente_id uuid, p_fecha date, p_ciclo date)
 returns jsonb language plpgsql security definer set search_path = public as $$
declare v_autor text := public.seg_autor();
begin
  if not exists (select 1 from clientes where id = p_cliente_id) then
    raise exception 'Cliente desconocido' using errcode = '22023';
  end if;
  if not public.seg_puede_cliente(p_cliente_id) then raise exception 'Ese cliente no está asignado a tu usuario' using errcode = '42501'; end if;
  insert into seg_agenda (cliente_id, fecha, ciclo, actualizado_por)
  values (p_cliente_id, p_fecha, p_ciclo, v_autor)
  on conflict (cliente_id) do update
    set fecha = excluded.fecha, ciclo = excluded.ciclo,
        actualizado_por = excluded.actualizado_por, actualizado_en = now();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.seg_escribi(p_cliente_id uuid, p_fecha date)
 returns jsonb language plpgsql security definer set search_path = public as $$
declare v_autor text := public.seg_autor();
begin
  if not exists (select 1 from clientes where id = p_cliente_id) then
    raise exception 'Cliente desconocido' using errcode = '22023';
  end if;
  if not public.seg_puede_cliente(p_cliente_id) then raise exception 'Ese cliente no está asignado a tu usuario' using errcode = '42501'; end if;
  insert into seg_agenda (cliente_id, escrito_en, actualizado_por)
  values (p_cliente_id, p_fecha, v_autor)
  on conflict (cliente_id) do update
    set escrito_en = excluded.escrito_en,
        actualizado_por = excluded.actualizado_por, actualizado_en = now();
  return jsonb_build_object('ok', true);
end $$;

-- Mismas funciones de 14-seguimiento-decisiones.sql (misma firma y cuerpo) con la comprobación de que el cliente sea del usuario.
create or replace function public.seg_decidir(
  p_cliente_id uuid, p_tipo text, p_motivo text, p_nota text, p_revision date,
  p_conocidos text[], p_espera uuid, p_desde date default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_autor text := public.seg_autor(); v_nombre text; v_act seg_decisiones%rowtype; v_new uuid; v_hoy date := coalesce(p_desde, (now() at time zone 'America/Argentina/Buenos_Aires')::date);
begin
  if p_tipo not in ('atender', 'recuperacion', 'pausa') then raise exception 'Destino desconocido: %', p_tipo using errcode = '22023'; end if;
  select nombre into v_nombre from clientes where id = p_cliente_id;
  if v_nombre is null then raise exception 'El cliente no está en el registro de clientes' using errcode = '22023'; end if;
  if not public.seg_puede_cliente(p_cliente_id) then raise exception 'Ese cliente no está asignado a tu usuario' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('seg_dec:' || p_cliente_id::text, 0));
  select * into v_act from seg_decisiones where cliente_id = p_cliente_id and vigente;
  if found and v_act.id is distinct from p_espera then
    return jsonb_build_object('ok', false, 'conflicto', true, 'actual', jsonb_build_object('id', v_act.id, 'tipo', v_act.tipo, 'autor', v_act.autor, 'creado_en', v_act.creado_en));
  end if;
  if not found and p_espera is not null then
    return jsonb_build_object('ok', false, 'conflicto', true, 'actual', null);
  end if;
  if found then update seg_decisiones set vigente = false, cerrada_en = now(), cerrada_por = v_autor, cierre = 'reemplazada' where id = v_act.id; end if;
  insert into seg_decisiones (cliente_id, cliente_nombre, tipo, motivo, nota, revision_en, pedidos_conocidos, desde, version, autor)
  values (p_cliente_id, v_nombre, p_tipo, p_motivo, nullif(trim(p_nota), ''), case when p_tipo = 'pausa' then p_revision end, coalesce(p_conocidos, '{}'), v_hoy, coalesce(v_act.version, 0) + 1, v_autor)
  returning id into v_new;
  return jsonb_build_object('ok', true, 'id', v_new);
end $$;

create or replace function public.seg_cerrar_decision(p_cliente_id uuid, p_espera uuid, p_cierre text default 'automatico') returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_autor text := public.seg_autor(); v_act seg_decisiones%rowtype;
begin
  if p_cierre not in ('automatico', 'retomado', 'deshecha', 'pedido_nuevo') then raise exception 'Cierre desconocido: %', p_cierre using errcode = '22023'; end if;
  if not public.seg_puede_cliente(p_cliente_id) then raise exception 'Ese cliente no está asignado a tu usuario' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('seg_dec:' || p_cliente_id::text, 0));
  select * into v_act from seg_decisiones where cliente_id = p_cliente_id and vigente;
  if not found then return jsonb_build_object('ok', true, 'yaEstaba', true); end if;
  if v_act.id is distinct from p_espera then
    return jsonb_build_object('ok', false, 'conflicto', true, 'actual', jsonb_build_object('id', v_act.id, 'tipo', v_act.tipo, 'autor', v_act.autor, 'creado_en', v_act.creado_en));
  end if;
  update seg_decisiones set vigente = false, cerrada_en = now(), cerrada_por = v_autor, cierre = p_cierre where id = v_act.id;
  return jsonb_build_object('ok', true);
end $$;

-- ── 3. Etiquetas de grupo ──────────────────────────────────────────────────
create table if not exists public.seg_etiquetas (
  id            uuid primary key,
  nombre        text not null check (length(trim(nombre)) between 1 and 60),
  dia_semana    smallint check (dia_semana between 1 and 6),   -- 1 = lunes … 6 = sábado
  siempre       boolean not null default false,                 -- aparece cada semana ese día aunque haya pedido o se le haya escrito
  activa        boolean not null default true,
  creado_en     timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create unique index if not exists seg_etiquetas_nombre_uk on public.seg_etiquetas (lower(trim(nombre))) where activa;
create table if not exists public.clientes_etiquetas (
  cliente_id  uuid not null references public.clientes(id) on delete cascade,
  etiqueta_id uuid not null references public.seg_etiquetas(id) on delete cascade,
  primary key (cliente_id, etiqueta_id)
);
alter table public.seg_etiquetas enable row level security;
alter table public.clientes_etiquetas enable row level security;
drop policy if exists seg_etiquetas_leer on public.seg_etiquetas;
create policy seg_etiquetas_leer on public.seg_etiquetas for select to authenticated using (public.seg_es_editor());
drop policy if exists clientes_etiquetas_leer on public.clientes_etiquetas;
create policy clientes_etiquetas_leer on public.clientes_etiquetas for select to authenticated
  using (public.seg_es_editor() and public.seg_puede_cliente(cliente_id));
revoke all on public.seg_etiquetas, public.clientes_etiquetas from anon, authenticated;
grant select on public.seg_etiquetas, public.clientes_etiquetas to authenticated;

-- Crea o edita una etiqueta (el id lo genera el navegador: repetir la llamada deja lo mismo).
-- p_datos: { nombre, dia_semana (null o 1 a 6), siempre (bool) }. Solo se cambia lo que viene en p_datos.
create or replace function public.seg_etiqueta_guardar(p_id uuid, p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_prev seg_etiquetas%rowtype; v_nom text; v_dia smallint; v_sie boolean; v_row seg_etiquetas%rowtype; v_hay boolean;
begin
  perform public.seg_gestor_exigir();
  if p_id is null then raise exception 'Falta el id de la etiqueta' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('seg_etq:' || p_id::text, 0));
  select * into v_prev from seg_etiquetas where id = p_id; v_hay := found;
  v_nom := case when p_datos ? 'nombre' then nullif(trim(p_datos ->> 'nombre'), '') else v_prev.nombre end;
  v_dia := case when p_datos ? 'dia_semana' then nullif(p_datos ->> 'dia_semana', '')::smallint else v_prev.dia_semana end;
  v_sie := case when p_datos ? 'siempre' then coalesce((p_datos ->> 'siempre')::boolean, false) else coalesce(v_prev.siempre, false) end;
  if v_nom is null then raise exception 'Escribí el nombre de la etiqueta' using errcode = '22023'; end if;
  if length(v_nom) > 60 then raise exception 'El nombre es demasiado largo (máximo 60 letras)' using errcode = '22023'; end if;
  if v_dia is not null and v_dia not between 1 and 6 then raise exception 'El día tiene que ser de lunes (1) a sábado (6)' using errcode = '22023'; end if;
  if exists (select 1 from seg_etiquetas where id <> p_id and activa and lower(trim(nombre)) = lower(v_nom)) then
    return jsonb_build_object('ok', false, 'error', 'Ya hay una etiqueta con ese nombre');
  end if;
  if v_hay then
    update seg_etiquetas set nombre = v_nom, dia_semana = v_dia, siempre = v_sie, activa = true, actualizado_en = now() where id = p_id returning * into v_row;
  else
    insert into seg_etiquetas (id, nombre, dia_semana, siempre) values (p_id, v_nom, v_dia, v_sie) returning * into v_row;
  end if;
  return jsonb_build_object('ok', true, 'etiqueta', jsonb_build_object('id', v_row.id, 'nombre', v_row.nombre, 'dia_semana', v_row.dia_semana, 'siempre', v_row.siempre));
end $$;

-- «Borrar» una etiqueta: queda desactivada (no se pierde el historial). Repetir la llamada no cambia nada.
create or replace function public.seg_etiqueta_borrar(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform public.seg_gestor_exigir();
  update seg_etiquetas set activa = false, actualizado_en = now() where id = p_id and activa;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'yaEstaba', n = 0);
end $$;

-- Reemplaza las etiquetas de un cliente por exactamente este conjunto.
create or replace function public.seg_cliente_etiquetas(p_cliente_id uuid, p_etiquetas uuid[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_set uuid[] := coalesce(p_etiquetas, '{}');
begin
  perform public.seg_gestor_exigir();
  if not exists (select 1 from clientes where id = p_cliente_id) then raise exception 'Cliente desconocido' using errcode = '22023'; end if;
  delete from clientes_etiquetas where cliente_id = p_cliente_id and not (etiqueta_id = any (v_set));
  insert into clientes_etiquetas (cliente_id, etiqueta_id)
  select p_cliente_id, e.id from seg_etiquetas e where e.id = any (v_set) and e.activa on conflict do nothing;
  return jsonb_build_object('ok', true, 'etiquetas', coalesce((select jsonb_agg(ce.etiqueta_id) from clientes_etiquetas ce where ce.cliente_id = p_cliente_id), '[]'::jsonb));
end $$;

-- ── 4. Resultado de contacto ───────────────────────────────────────────────
create table if not exists public.seg_contactos (
  id         uuid primary key,   -- lo genera el navegador una sola vez por acción
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  resultado  text not null check (resultado in ('no_contesto', 'tiene_stock', 'no_interesa', 'otro')),
  volver_el  date,
  nota       text check (nota is null or length(nota) <= 500),
  autor      text not null,
  creado_en  timestamptz not null default now()
);
create index if not exists seg_contactos_cliente on public.seg_contactos (cliente_id, creado_en desc);
alter table public.seg_contactos enable row level security;
drop policy if exists seg_contactos_leer on public.seg_contactos;
create policy seg_contactos_leer on public.seg_contactos for select to authenticated
  using (public.seg_es_editor() and public.seg_puede_cliente(cliente_id));
revoke all on public.seg_contactos from anon, authenticated;
grant select on public.seg_contactos to authenticated;

-- Registra el resultado y, en la misma transacción, actualiza la agenda:
--   · tiene_stock / no_interesa / otro con volver_el → la tarjeta pasa a ese día (con el ciclo p_ciclo = su último pedido) y deja de esperar;
--   · no_contesto → deja de esperar (vuelve a pendiente enseguida).
-- Si el id ya existe devuelve ok sin repetir nada.
create or replace function public.seg_contacto_registrar(p_id uuid, p_cliente_id uuid, p_resultado text, p_volver_el date, p_nota text, p_ciclo date)
 returns jsonb language plpgsql security definer set search_path = public as $$
declare v_autor text := public.seg_autor(); v_nota text := nullif(trim(coalesce(p_nota, '')), ''); n int;
begin
  if p_id is null then raise exception 'Falta el id del contacto' using errcode = '22023'; end if;
  if p_resultado not in ('no_contesto', 'tiene_stock', 'no_interesa', 'otro') then raise exception 'Resultado desconocido: %', p_resultado using errcode = '22023'; end if;
  if not exists (select 1 from clientes where id = p_cliente_id) then raise exception 'Cliente desconocido' using errcode = '22023'; end if;
  if not public.seg_puede_cliente(p_cliente_id) then raise exception 'Ese cliente no está asignado a tu usuario' using errcode = '42501'; end if;
  if v_nota is not null and length(v_nota) > 500 then raise exception 'La nota es demasiado larga (máximo 500 letras)' using errcode = '22023'; end if;
  if p_resultado in ('tiene_stock', 'no_interesa') and p_volver_el is null then raise exception 'Elegí el día para volver a escribirle' using errcode = '22023'; end if;
  if p_resultado = 'no_contesto' then p_volver_el := null; end if;
  perform pg_advisory_xact_lock(hashtextextended('seg_cto:' || p_id::text, 0));
  if exists (select 1 from seg_contactos where id = p_id) then return jsonb_build_object('ok', true, 'id', p_id, 'yaEstaba', true); end if;
  insert into seg_contactos (id, cliente_id, resultado, volver_el, nota, autor) values (p_id, p_cliente_id, p_resultado, p_volver_el, v_nota, v_autor);
  if p_resultado = 'no_contesto' then
    insert into seg_agenda (cliente_id, escrito_en, actualizado_por) values (p_cliente_id, null, v_autor)
    on conflict (cliente_id) do update set escrito_en = null, actualizado_por = excluded.actualizado_por, actualizado_en = now();
  elsif p_volver_el is not null then
    insert into seg_agenda (cliente_id, fecha, ciclo, escrito_en, actualizado_por) values (p_cliente_id, p_volver_el, p_ciclo, null, v_autor)
    on conflict (cliente_id) do update set fecha = excluded.fecha, ciclo = excluded.ciclo, escrito_en = null, actualizado_por = excluded.actualizado_por, actualizado_en = now();
  end if;
  return jsonb_build_object('ok', true, 'id', p_id);
end $$;

create or replace function public.seg_contactos_leer(p_cliente_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.seg_autor();
  if not public.seg_puede_cliente(p_cliente_id) then raise exception 'Ese cliente no está asignado a tu usuario' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'resultado', x.resultado, 'volver_el', x.volver_el, 'nota', x.nota, 'autor', x.autor, 'creado_en', x.creado_en) order by x.creado_en desc)
                   from (select * from seg_contactos where cliente_id = p_cliente_id order by creado_en desc limit 30) x), '[]'::jsonb);
end $$;

-- ── 5. Vendedor ────────────────────────────────────────────────────────────
create or replace function public.seg_cliente_vendedor(p_cliente_id uuid, p_vendedor text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_cli clientes%rowtype; v text; v_autor text;
begin
  perform public.seg_gestor_exigir();
  select * into v_cli from clientes where id = p_cliente_id;
  if not found then raise exception 'Cliente desconocido' using errcode = '22023'; end if;
  if nullif(trim(coalesce(p_vendedor, '')), '') is null then v := null;
  else
    select u.nombre into v from seg_usuarios u where lower(trim(u.nombre)) = lower(trim(p_vendedor));
    if v is null then raise exception 'Ese vendedor no existe en el seguimiento: %', p_vendedor using errcode = '22023'; end if;
  end if;
  if v_cli.vendedor is distinct from v then
    update clientes set vendedor = v where id = p_cliente_id;   -- sin tocar actualizado_en: no genera falsos conflictos en Administración
    if to_regclass('public.admin_cambios') is not null then
      v_autor := coalesce(public.seg_nombre(), public.stock_autor(), '?');
      insert into admin_cambios (op_id, tabla, registro, accion, antes, despues, resultado, autor)
      values (null, 'clientes', p_cliente_id::text, 'vendedor', jsonb_build_object('vendedor', v_cli.vendedor), jsonb_build_object('vendedor', v), null, v_autor);
    end if;
  end if;
  return jsonb_build_object('ok', true, 'vendedor', v);
end $$;

-- ── 6. Lectura de la app ───────────────────────────────────────────────────
-- {etiquetas:[{id,nombre,dia_semana,siempre}], usuarios:[{nombre,ve_todo}] (solo para quien puede asignar),
--  clientes:[{cliente_id,nombre,vendedor,etiquetas:[id],contacto:{resultado,volver_el,nota,autor,creado_en}|null}]}
-- Clientes: los que tienen vendedor, etiquetas o contactos. Quien puede asignar (administrador / ve_todo) recibe todos; los demás, solo los suyos.
create or replace function public.seg_clientes_meta() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_gestor boolean := public.seg_es_gestor(); v_yo text := lower(trim(coalesce(public.seg_nombre(), '')));
begin
  if not (public.seg_es_editor() or v_gestor) then raise exception 'No tenés permiso para el seguimiento de clientes' using errcode = '42501'; end if;
  return jsonb_build_object(
    'etiquetas', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'nombre', e.nombre, 'dia_semana', e.dia_semana, 'siempre', e.siempre) order by lower(e.nombre)) from seg_etiquetas e where e.activa), '[]'::jsonb),
    'usuarios', case when v_gestor then coalesce((select jsonb_agg(jsonb_build_object('nombre', u.nombre, 've_todo', u.ve_todo) order by u.nombre) from seg_usuarios u), '[]'::jsonb) else '[]'::jsonb end,
    'clientes', coalesce((select jsonb_agg(f.j) from (
      select jsonb_build_object('cliente_id', c.id, 'nombre', c.nombre, 'vendedor', c.vendedor,
        'etiquetas', coalesce((select jsonb_agg(ce.etiqueta_id) from clientes_etiquetas ce join seg_etiquetas e on e.id = ce.etiqueta_id and e.activa where ce.cliente_id = c.id), '[]'::jsonb),
        'contacto', (select jsonb_build_object('resultado', k.resultado, 'volver_el', k.volver_el, 'nota', k.nota, 'autor', k.autor, 'creado_en', k.creado_en)
                     from seg_contactos k where k.cliente_id = c.id order by k.creado_en desc limit 1)) as j
      from clientes c
      where (v_gestor or lower(trim(coalesce(c.vendedor, ''))) = v_yo)
        and (nullif(trim(coalesce(c.vendedor, '')), '') is not null
             or exists (select 1 from clientes_etiquetas ce where ce.cliente_id = c.id)
             or exists (select 1 from seg_contactos k where k.cliente_id = c.id))
    ) f), '[]'::jsonb));
end $$;

-- ── Permisos: solo sesiones iniciadas; las funciones internas no se exponen ─
revoke all on function
  public.seg_nombre(), public.seg_es_editor(), public.seg_autor(), public.seg_es_ve_todo(), public.seg_es_gestor(), public.seg_gestor_exigir(), public.seg_yo(),
  public.seg_puede_cliente(uuid), public.seg_agendar(uuid, date, date), public.seg_escribi(uuid, date),
  public.seg_decidir(uuid, text, text, text, date, text[], uuid, date), public.seg_cerrar_decision(uuid, uuid, text),
  public.seg_etiqueta_guardar(uuid, jsonb), public.seg_etiqueta_borrar(uuid), public.seg_cliente_etiquetas(uuid, uuid[]),
  public.seg_contacto_registrar(uuid, uuid, text, date, text, date), public.seg_contactos_leer(uuid),
  public.seg_cliente_vendedor(uuid, text), public.seg_clientes_meta()
  from public, anon;
revoke execute on function public.seg_nombre(), public.seg_autor(), public.seg_gestor_exigir() from authenticated;   -- internas
grant execute on function
  public.seg_es_editor(), public.seg_es_ve_todo(), public.seg_es_gestor(), public.seg_yo(), public.seg_puede_cliente(uuid),
  public.seg_agendar(uuid, date, date), public.seg_escribi(uuid, date),
  public.seg_decidir(uuid, text, text, text, date, text[], uuid, date), public.seg_cerrar_decision(uuid, uuid, text),
  public.seg_etiqueta_guardar(uuid, jsonb), public.seg_etiqueta_borrar(uuid), public.seg_cliente_etiquetas(uuid, uuid[]),
  public.seg_contacto_registrar(uuid, uuid, text, date, text, date), public.seg_contactos_leer(uuid),
  public.seg_cliente_vendedor(uuid, text), public.seg_clientes_meta()
  to authenticated;

commit;
