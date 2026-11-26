begin;
create table public.bitacora_calculos (
 usuario uuid not null references public.bitacora_acceso(user_id),semana date not null,
 valor_hora numeric(12,2) not null check(valor_hora>=0),bonos jsonb not null default '[]',
 version integer not null default 1,actualizado timestamptz not null default now(),autor uuid not null references auth.users(id),
 primary key(usuario,semana),check(extract(isodow from semana)=1),check(jsonb_typeof(bonos)='array')
);
alter table public.bitacora_calculos enable row level security;
revoke all on public.bitacora_calculos from public,anon,authenticated;
create function public.bitacora_calculos_leer(p_semana date) returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 if not exists(select 1 from bitacora_acceso where user_id=auth.uid() and rol='supervisor') then raise exception 'Solo Joaquín puede consultar cálculos' using errcode='42501';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('usuario',a.user_id,'valor_hora',coalesce(c.valor_hora,(select v.valor_hora from bitacora_calculos v where v.usuario=a.user_id and v.semana<p_semana order by v.semana desc limit 1),0),'bonos',coalesce(c.bonos,'[]'::jsonb),'version',coalesce(c.version,0))),'[]'::jsonb) from bitacora_acceso a left join bitacora_calculos c on c.usuario=a.user_id and c.semana=p_semana where a.rol='trabajador');
end $$;
create function public.bitacora_calculos_guardar(p_usuario uuid,p_semana date,p_valor_hora numeric,p_bonos jsonb,p_version integer) returns jsonb language plpgsql security definer set search_path=public as $$
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
 select * into c from bitacora_calculos where usuario=p_usuario and semana=p_semana for update;
 if coalesce(c.version,0) is distinct from p_version then raise exception 'El cálculo cambió. Cerrá y volvé a abrirlo antes de guardar.';end if;
 insert into bitacora_calculos(usuario,semana,valor_hora,bonos,autor) values(p_usuario,p_semana,p_valor_hora,p_bonos,auth.uid())
 on conflict(usuario,semana) do update set valor_hora=excluded.valor_hora,bonos=excluded.bonos,version=bitacora_calculos.version+1,actualizado=now(),autor=auth.uid() returning * into c;
 return jsonb_build_object('ok',true,'calculo',to_jsonb(c));
end $$;
revoke all on function public.bitacora_calculos_leer(date),public.bitacora_calculos_guardar(uuid,date,numeric,jsonb,integer) from public,anon;
grant execute on function public.bitacora_calculos_leer(date),public.bitacora_calculos_guardar(uuid,date,numeric,jsonb,integer) to authenticated;
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
 insert into bitacora_cambios(jornada_id,autor_id,accion,motivo,antes,despues) values(j.id,yo,'corregir',nullif(trim(p_motivo),''),antes,to_jsonb(j));
 res:=jsonb_build_object('ok',true,'jornada',to_jsonb(j));insert into bitacora_operaciones values(p_op,yo,req,res);return res;
end $$;

commit;
