begin;
alter table public.bitacora_jornadas add column fin_pausa boolean not null default false;
create table public.bitacora_pausa(user_id uuid primary key references bitacora_acceso(user_id),desde timestamptz not null);
alter table public.bitacora_pausa enable row level security;
revoke all on public.bitacora_pausa from public,anon,authenticated;
create table public.bitacora_pagos(id uuid primary key,usuario uuid not null references bitacora_acceso(user_id),semana date not null,valor_hora numeric not null,bonos jsonb not null,segundos numeric not null,total numeric not null,pagado_en timestamptz not null default now(),autor uuid not null references auth.users(id),anulado_en timestamptz,anulado_por uuid references auth.users(id));
create unique index bitacora_pago_unico on public.bitacora_pagos(usuario,semana) where anulado_en is null;
alter table public.bitacora_pagos enable row level security;
revoke all on public.bitacora_pagos from public,anon,authenticated;
create or replace function public.bitacora_marcar(p_op uuid,p_accion text) returns jsonb language plpgsql security definer set search_path=public as $$
declare yo bitacora_acceso;j bitacora_jornadas;prev bitacora_operaciones;req jsonb:=jsonb_build_object('accion',p_accion);res jsonb;antes jsonb;pausado boolean;t timestamptz;
begin
 select * into yo from bitacora_acceso where user_id=auth.uid() and rol='trabajador';if not found then raise exception 'Sin permiso para marcar' using errcode='42501';end if;
 if p_op is null or p_accion not in ('entrada','salida','pausa','reanudar') or p_accion is null then raise exception 'Marcación inválida';end if;
 perform pg_advisory_xact_lock(hashtext('bitacora:'||yo.user_id));
 select * into prev from bitacora_operaciones where id=p_op;
 if found then if prev.user_id<>yo.user_id or prev.solicitud<>req then raise exception 'Operación ya utilizada';end if;return prev.resultado;end if;
 select exists(select 1 from bitacora_pausa where user_id=yo.user_id) into pausado;
 select * into j from bitacora_jornadas where user_id=yo.user_id and salida is null for update;
 antes:=case when found then to_jsonb(j) else null end;t:=clock_timestamp();
 if p_accion in ('entrada','reanudar') then
  if j.id is not null then raise exception 'Ya tenés una entrada abierta. Actualizá la pantalla.';end if;
  if p_accion='reanudar' and not pausado then raise exception 'No hay una pausa activa. Actualizá la pantalla.';end if;
  delete from bitacora_pausa where user_id=yo.user_id;
  insert into bitacora_jornadas(user_id,entrada) values(yo.user_id,t) returning * into j;
 elsif p_accion='salida' and pausado and j.id is null then
  delete from bitacora_pausa where user_id=yo.user_id;
  select * into j from bitacora_jornadas where user_id=yo.user_id order by entrada desc limit 1;
  antes:=to_jsonb(j);
 else
  if j.id is null then raise exception 'No tenés una entrada abierta. Actualizá la pantalla.';end if;
  update bitacora_jornadas set salida=t,fin_pausa=(p_accion='pausa'),version=version+1 where id=j.id returning * into j;
  if p_accion='pausa' then insert into bitacora_pausa values(yo.user_id,t);end if;
 end if;
 insert into bitacora_cambios(jornada_id,autor_id,accion,antes,despues) values(j.id,yo.user_id,p_accion,antes,to_jsonb(j));
 res:=jsonb_build_object('ok',true,'jornada',to_jsonb(j));insert into bitacora_operaciones values(p_op,yo.user_id,req,res);return res;
end $$;
create or replace function public.bitacora_leer(p_semana date default null) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare yo bitacora_acceso; lunes date; desde timestamptz; hasta timestamptz;
begin
 select * into yo from bitacora_acceso where user_id=auth.uid();if not found then raise exception 'Sin acceso a la bitácora' using errcode='42501';end if;
 lunes:=date_trunc('week',coalesce(p_semana,(now() at time zone 'America/Argentina/Buenos_Aires')::date)::timestamp)::date;
 desde:=lunes::timestamp at time zone 'America/Argentina/Buenos_Aires';hasta:=(lunes+7)::timestamp at time zone 'America/Argentina/Buenos_Aires';
 return jsonb_build_object('ahora',now(),'semana',lunes,'yo',to_jsonb(yo),
 'personas',(select coalesce(jsonb_agg(jsonb_build_object('user_id',a.user_id,'nombre',a.nombre,
  'pausa_desde',(select bp.desde from bitacora_pausa bp where bp.user_id=a.user_id),'activa',(select to_jsonb(j) from bitacora_jornadas j where j.user_id=a.user_id and j.salida is null),
  'segundos',(select coalesce(sum(greatest(0,extract(epoch from least(coalesce(j.salida,now()),hasta)-greatest(j.entrada,desde)))),0) from bitacora_jornadas j where j.user_id=a.user_id and j.entrada<hasta and coalesce(j.salida,now())>desde),
  'segundos_cerrados',(select coalesce(sum(greatest(0,extract(epoch from least(j.salida,hasta)-greatest(j.entrada,desde)))),0) from bitacora_jornadas j where j.user_id=a.user_id and j.salida is not null and j.entrada<hasta and j.salida>desde)
 ) order by a.nombre),'[]'::jsonb) from bitacora_acceso a where a.rol='trabajador' and (yo.rol='supervisor' or a.user_id=yo.user_id)),
 'jornadas',(select coalesce(jsonb_agg(to_jsonb(j)||jsonb_build_object('nombre',a.nombre,'segundos_semana',greatest(0,extract(epoch from least(coalesce(j.salida,now()),hasta)-greatest(j.entrada,desde)))) order by j.entrada desc),'[]'::jsonb) from bitacora_jornadas j join bitacora_acceso a using(user_id) where (yo.rol='supervisor' or j.user_id=yo.user_id) and j.entrada<hasta and coalesce(j.salida,now())>desde),
 'cambios',(select coalesce(jsonb_agg(x),'[]'::jsonb) from (select c.*,a.nombre as autor from bitacora_cambios c join bitacora_acceso a on a.user_id=c.autor_id join bitacora_jornadas j on j.id=c.jornada_id where yo.rol='supervisor' and c.accion='corregir' and j.entrada<hasta and coalesce(j.salida,now())>desde order by c.en desc limit 100)x));
end $$;

create or replace function public.bitacora_corregir(p_op uuid,p_id uuid,p_usuario uuid,p_version integer,p_entrada timestamptz,p_salida timestamptz,p_motivo text) returns jsonb language plpgsql security definer set search_path=public as $$
declare yo uuid:=auth.uid();j bitacora_jornadas;prev bitacora_operaciones;antes jsonb;res jsonb;req jsonb:=jsonb_build_object('id',p_id,'usuario',p_usuario,'version',p_version,'entrada',p_entrada,'salida',p_salida,'motivo',p_motivo);
begin
 if not exists(select 1 from bitacora_acceso where user_id=yo and rol='supervisor') then raise exception 'Solo Joaquín puede corregir horarios' using errcode='42501';end if;
 if p_op is null or p_entrada is null or p_entrada>clock_timestamp() or p_salida>clock_timestamp() or p_salida<=p_entrada then raise exception 'Revisá los horarios';end if;
 if not exists(select 1 from bitacora_acceso where user_id=p_usuario and rol='trabajador') then raise exception 'Persona inválida';end if;
 perform pg_advisory_xact_lock(hashtext('bitacora:'||p_usuario));
 select * into prev from bitacora_operaciones where id=p_op;
 if found then if prev.user_id<>yo or prev.solicitud<>req then raise exception 'Operación ya utilizada';end if;return prev.resultado;end if;
 if p_id is not null then
  select * into j from bitacora_jornadas where id=p_id and user_id=p_usuario for update;
  if not found or j.version is distinct from p_version then raise exception 'El horario cambió. Actualizá antes de corregirlo.';end if;antes:=to_jsonb(j);
 end if;
 if exists(select 1 from bitacora_jornadas x where x.user_id=p_usuario and (p_id is null or x.id<>p_id) and tstzrange(x.entrada,x.salida,'[)') && tstzrange(p_entrada,p_salida,'[)')) then raise exception 'Ese horario se superpone con otro registro';end if;
 if p_id is null then insert into bitacora_jornadas(user_id,entrada,salida) values(p_usuario,p_entrada,p_salida) returning * into j;
 else update bitacora_jornadas set entrada=p_entrada,salida=p_salida,version=version+1 where id=p_id returning * into j;end if;
 if j.salida is null then delete from bitacora_pausa where user_id=p_usuario;end if;
 insert into bitacora_cambios(jornada_id,autor_id,accion,motivo,antes,despues) values(j.id,yo,'corregir',nullif(trim(p_motivo),''),antes,to_jsonb(j));
 res:=jsonb_build_object('ok',true,'jornada',to_jsonb(j));insert into bitacora_operaciones values(p_op,yo,req,res);return res;
end $$;
create or replace function public.bitacora_calculos_leer(p_semana date) returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 if not exists(select 1 from bitacora_acceso where user_id=auth.uid() and rol='supervisor') then raise exception 'Solo Joaquín puede consultar cálculos' using errcode='42501';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('usuario',a.user_id,'valor_hora',coalesce(c.valor_hora,(select v.valor_hora from bitacora_calculos v where v.usuario=a.user_id and v.semana<p_semana order by v.semana desc limit 1),0),'bonos',coalesce(c.bonos,'[]'::jsonb),'version',coalesce(c.version,0),'pago',(select to_jsonb(p) from bitacora_pagos p where p.usuario=a.user_id and p.semana=p_semana and p.anulado_en is null))),'[]'::jsonb) from bitacora_acceso a left join bitacora_calculos c on c.usuario=a.user_id and c.semana=p_semana where a.rol='trabajador');
end $$;
create or replace function public.bitacora_calculos_guardar(p_usuario uuid,p_semana date,p_valor_hora numeric,p_bonos jsonb,p_version integer) returns jsonb language plpgsql security definer set search_path=public as $$
declare c bitacora_calculos;b jsonb;
begin
 if not exists(select 1 from bitacora_acceso where user_id=auth.uid() and rol='supervisor') then raise exception 'Solo Joaquín puede guardar cálculos' using errcode='42501';end if;
 if not exists(select 1 from bitacora_acceso where user_id=p_usuario and rol='trabajador') then raise exception 'Persona inválida';end if;
 if p_semana is null or extract(isodow from p_semana)<>1 or p_valor_hora is null or p_valor_hora<0 or p_valor_hora>9999999999 or p_valor_hora::text in ('NaN','Infinity','-Infinity') or p_bonos is null or jsonb_typeof(p_bonos)<>'array' then raise exception 'Revisá los importes y la semana';end if;
 if jsonb_array_length(p_bonos)>30 then raise exception 'Demasiadas bonificaciones';end if;
 for b in select * from jsonb_array_elements(p_bonos) loop
  if jsonb_typeof(b->'importe') is distinct from 'number' or (b->>'importe')::numeric<0 or (b->>'importe')::numeric>9999999999 or length(coalesce(b->>'detalle',''))>200 then raise exception 'Revisá las bonificaciones';end if;
 end loop;
 perform pg_advisory_xact_lock(hashtext('bitacora-calculo:'||p_usuario||p_semana));
 if exists(select 1 from bitacora_pagos where usuario=p_usuario and semana=p_semana and anulado_en is null) then raise exception 'La semana está pagada. Volvé a pendiente antes de cambiar el cálculo.';end if;
 select * into c from bitacora_calculos where usuario=p_usuario and semana=p_semana for update;
 if coalesce(c.version,0) is distinct from p_version then raise exception 'El cálculo cambió. Cerrá y volvé a abrirlo antes de guardar.';end if;
 insert into bitacora_calculos(usuario,semana,valor_hora,bonos,autor) values(p_usuario,p_semana,p_valor_hora,p_bonos,auth.uid())
 on conflict(usuario,semana) do update set valor_hora=excluded.valor_hora,bonos=excluded.bonos,version=bitacora_calculos.version+1,actualizado=now(),autor=auth.uid() returning * into c;
 return jsonb_build_object('ok',true,'calculo',to_jsonb(c));
end $$;

create function public.bitacora_pago_marcar(p_op uuid,p_usuario uuid,p_semana date,p_version integer,p_segundos numeric) returns jsonb language plpgsql security definer set search_path=public as $$
declare c bitacora_calculos;p bitacora_pagos;seg numeric;ini timestamptz;fin timestamptz;extra numeric;
begin
 if not exists(select 1 from bitacora_acceso where user_id=auth.uid() and rol='supervisor') then raise exception 'Solo Joaquín puede registrar pagos' using errcode='42501';end if;
 if p_op is null or p_semana is null or extract(isodow from p_semana)<>1 then raise exception 'Semana inválida';end if;
 perform pg_advisory_xact_lock(hashtext('bitacora:'||p_usuario));
 perform pg_advisory_xact_lock(hashtext('bitacora-calculo:'||p_usuario||p_semana));
 select * into p from bitacora_pagos where id=p_op;
 if found then if p.usuario<>p_usuario or p.semana<>p_semana then raise exception 'Operación ya utilizada';end if;return jsonb_build_object('ok',true,'pago',to_jsonb(p));end if;
 select * into c from bitacora_calculos where usuario=p_usuario and semana=p_semana;
 if not found or c.valor_hora<=0 then raise exception 'Guardá primero el valor por hora y el cálculo semanal';end if;
 if c.version is distinct from p_version then raise exception 'El cálculo cambió. Actualizá antes de marcar pagada.';end if;
 if exists(select 1 from bitacora_pagos where usuario=p_usuario and semana=p_semana and anulado_en is null) then raise exception 'La semana ya está pagada. Actualizá la pantalla.';end if;
 ini:=p_semana::timestamp at time zone 'America/Argentina/Buenos_Aires';fin:=(p_semana+7)::timestamp at time zone 'America/Argentina/Buenos_Aires';
 if exists(select 1 from bitacora_jornadas where user_id=p_usuario and salida is null and entrada<fin and now()>ini) then raise exception 'Hay una jornada abierta en esa semana. Cerrala antes de marcar pagada.';end if;
 select coalesce(sum(greatest(0,extract(epoch from least(salida,fin)-greatest(entrada,ini)))),0) into seg from bitacora_jornadas where user_id=p_usuario and salida is not null and entrada<fin and salida>ini;
 if seg is distinct from p_segundos then raise exception 'Las horas cambiaron. Actualizá antes de marcar pagada.';end if;
 select coalesce(sum((b->>'importe')::numeric),0) into extra from jsonb_array_elements(c.bonos)b;
 insert into bitacora_pagos(id,usuario,semana,valor_hora,bonos,segundos,total,autor) values(p_op,p_usuario,p_semana,c.valor_hora,c.bonos,seg,round(seg/3600*c.valor_hora+extra,2),auth.uid()) returning * into p;
 return jsonb_build_object('ok',true,'pago',to_jsonb(p));
end $$;
create function public.bitacora_pago_anular(p_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare p bitacora_pagos;
begin
 if not exists(select 1 from bitacora_acceso where user_id=auth.uid() and rol='supervisor') then raise exception 'Solo Joaquín puede registrar pagos' using errcode='42501';end if;
 select * into p from bitacora_pagos where id=p_id;if not found then raise exception 'Pago no encontrado';end if;
 perform pg_advisory_xact_lock(hashtext('bitacora-calculo:'||p.usuario||p.semana));
 update bitacora_pagos set anulado_en=now(),anulado_por=auth.uid() where id=p_id and anulado_en is null;
 return jsonb_build_object('ok',true);
end $$;
create function public.bitacora_pagos_historial() returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 if not exists(select 1 from bitacora_acceso where user_id=auth.uid() and rol='supervisor') then raise exception 'Solo Joaquín puede consultar pagos' using errcode='42501';end if;
 return (select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('nombre',a.nombre) order by p.pagado_en desc),'[]'::jsonb) from bitacora_pagos p join bitacora_acceso a on a.user_id=p.usuario);
end $$;
revoke all on function public.bitacora_pago_marcar(uuid,uuid,date,integer,numeric),public.bitacora_pago_anular(uuid),public.bitacora_pagos_historial() from public,anon;
grant execute on function public.bitacora_pago_marcar(uuid,uuid,date,integer,numeric),public.bitacora_pago_anular(uuid),public.bitacora_pagos_historial() to authenticated;
commit;
