begin;
create table public.bitacora_acceso(user_id uuid primary key references auth.users(id),nombre text not null,rol text not null check(rol in ('trabajador','supervisor')));
insert into public.bitacora_acceso values
 ('dbcd0e59-fc02-4c23-b1d6-aba342da21e8','Oscar','trabajador'),
 ('e11a2d13-2b31-4fc4-bac2-26a882caa51b','Juan Marcos','trabajador'),
 ('e3e52cc0-d8e3-41e0-a641-26e33ffbcde6','Joaquin','supervisor');
create table public.bitacora_jornadas(id uuid primary key default gen_random_uuid(),user_id uuid not null references bitacora_acceso(user_id),entrada timestamptz not null,salida timestamptz,version integer not null default 1,check(salida is null or salida>entrada));
create unique index bitacora_una_abierta on public.bitacora_jornadas(user_id) where salida is null;
create index bitacora_por_fecha on public.bitacora_jornadas(user_id,entrada);
create table public.bitacora_cambios(id bigint generated always as identity primary key,jornada_id uuid not null references bitacora_jornadas(id),autor_id uuid not null references auth.users(id),en timestamptz not null default now(),accion text not null,motivo text,antes jsonb,despues jsonb not null);
create table public.bitacora_operaciones(id uuid primary key,user_id uuid not null references auth.users(id),solicitud jsonb not null,resultado jsonb not null);
alter table public.bitacora_acceso enable row level security;
alter table public.bitacora_jornadas enable row level security;
alter table public.bitacora_cambios enable row level security;
alter table public.bitacora_operaciones enable row level security;
revoke all on public.bitacora_acceso,public.bitacora_jornadas,public.bitacora_cambios,public.bitacora_operaciones from anon,authenticated;

create function public.bitacora_leer(p_semana date default null) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare yo bitacora_acceso; lunes date; desde timestamptz; hasta timestamptz;
begin
 select * into yo from bitacora_acceso where user_id=auth.uid();if not found then raise exception 'Sin acceso a la bitácora' using errcode='42501';end if;
 lunes:=date_trunc('week',coalesce(p_semana,(now() at time zone 'America/Argentina/Buenos_Aires')::date)::timestamp)::date;
 desde:=lunes::timestamp at time zone 'America/Argentina/Buenos_Aires';hasta:=(lunes+7)::timestamp at time zone 'America/Argentina/Buenos_Aires';
 return jsonb_build_object('ahora',now(),'semana',lunes,'yo',to_jsonb(yo),
 'personas',(select coalesce(jsonb_agg(jsonb_build_object('user_id',a.user_id,'nombre',a.nombre,
  'activa',(select to_jsonb(j) from bitacora_jornadas j where j.user_id=a.user_id and j.salida is null),
  'segundos',(select coalesce(sum(greatest(0,extract(epoch from least(coalesce(j.salida,now()),hasta)-greatest(j.entrada,desde)))),0) from bitacora_jornadas j where j.user_id=a.user_id and j.entrada<hasta and coalesce(j.salida,now())>desde),
  'segundos_cerrados',(select coalesce(sum(greatest(0,extract(epoch from least(j.salida,hasta)-greatest(j.entrada,desde)))),0) from bitacora_jornadas j where j.user_id=a.user_id and j.salida is not null and j.entrada<hasta and j.salida>desde)
 ) order by a.nombre),'[]'::jsonb) from bitacora_acceso a where a.rol='trabajador' and (yo.rol='supervisor' or a.user_id=yo.user_id)),
 'jornadas',(select coalesce(jsonb_agg(to_jsonb(j)||jsonb_build_object('nombre',a.nombre,'segundos_semana',greatest(0,extract(epoch from least(coalesce(j.salida,now()),hasta)-greatest(j.entrada,desde)))) order by j.entrada desc),'[]'::jsonb) from bitacora_jornadas j join bitacora_acceso a using(user_id) where (yo.rol='supervisor' or j.user_id=yo.user_id) and j.entrada<hasta and coalesce(j.salida,now())>desde),
 'cambios',(select coalesce(jsonb_agg(x),'[]'::jsonb) from (select c.*,a.nombre as autor from bitacora_cambios c join bitacora_acceso a on a.user_id=c.autor_id join bitacora_jornadas j on j.id=c.jornada_id where yo.rol='supervisor' and c.accion='corregir' and j.entrada<hasta and coalesce(j.salida,now())>desde order by c.en desc limit 100)x));
end $$;

create function public.bitacora_marcar(p_op uuid,p_accion text) returns jsonb language plpgsql security definer set search_path=public as $$
declare yo bitacora_acceso;j bitacora_jornadas;prev bitacora_operaciones;req jsonb:=jsonb_build_object('accion',p_accion);res jsonb;antes jsonb;
begin
 select * into yo from bitacora_acceso where user_id=auth.uid() and rol='trabajador';if not found then raise exception 'Sin permiso para marcar' using errcode='42501';end if;
 if p_op is null or p_accion not in ('entrada','salida') or p_accion is null then raise exception 'Marcación inválida';end if;
 perform pg_advisory_xact_lock(hashtext('bitacora:'||yo.user_id));
 select * into prev from bitacora_operaciones where id=p_op;
 if found then if prev.user_id<>yo.user_id or prev.solicitud<>req then raise exception 'Operación ya utilizada';end if;return prev.resultado;end if;
 select * into j from bitacora_jornadas where user_id=yo.user_id and salida is null for update;
 antes:=case when found then to_jsonb(j) else null end;
 if p_accion='entrada' then
  if j.id is not null then raise exception 'Ya tenés una entrada abierta. Actualizá la pantalla.';end if;
  insert into bitacora_jornadas(user_id,entrada) values(yo.user_id,clock_timestamp()) returning * into j;
 else
  if j.id is null then raise exception 'No tenés una entrada abierta. Actualizá la pantalla.';end if;
  update bitacora_jornadas set salida=clock_timestamp(),version=version+1 where id=j.id returning * into j;
 end if;
 insert into bitacora_cambios(jornada_id,autor_id,accion,antes,despues) values(j.id,yo.user_id,p_accion,antes,to_jsonb(j));
 res:=jsonb_build_object('ok',true,'jornada',to_jsonb(j));insert into bitacora_operaciones values(p_op,yo.user_id,req,res);return res;
end $$;

create function public.bitacora_corregir(p_op uuid,p_id uuid,p_usuario uuid,p_version integer,p_entrada timestamptz,p_salida timestamptz,p_motivo text) returns jsonb language plpgsql security definer set search_path=public as $$
declare yo uuid:=auth.uid();j bitacora_jornadas;prev bitacora_operaciones;antes jsonb;res jsonb;req jsonb:=jsonb_build_object('id',p_id,'usuario',p_usuario,'version',p_version,'entrada',p_entrada,'salida',p_salida,'motivo',p_motivo);
begin
 if not exists(select 1 from bitacora_acceso where user_id=yo and rol='supervisor') then raise exception 'Solo Joaquín puede corregir horarios' using errcode='42501';end if;
 if p_op is null or p_entrada is null or p_entrada>clock_timestamp() or p_salida>clock_timestamp() or p_salida<=p_entrada or length(trim(coalesce(p_motivo,'')))<3 then raise exception 'Revisá los horarios y escribí el motivo del cambio';end if;
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
 insert into bitacora_cambios(jornada_id,autor_id,accion,motivo,antes,despues) values(j.id,yo,'corregir',trim(p_motivo),antes,to_jsonb(j));
 res:=jsonb_build_object('ok',true,'jornada',to_jsonb(j));insert into bitacora_operaciones values(p_op,yo,req,res);return res;
end $$;
revoke all on function public.bitacora_leer(date),public.bitacora_marcar(uuid,text),public.bitacora_corregir(uuid,uuid,uuid,integer,timestamptz,timestamptz,text) from public,anon;
grant execute on function public.bitacora_leer(date),public.bitacora_marcar(uuid,text),public.bitacora_corregir(uuid,uuid,uuid,integer,timestamptz,timestamptz,text) to authenticated;
commit;
