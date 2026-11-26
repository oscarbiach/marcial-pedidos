begin;
create table public.app_auditoria (
 id bigint generated always as identity primary key,
 en timestamptz not null default clock_timestamp(), usuario_id uuid, usuario text not null,
 tabla text not null, registro text not null, titulo text not null, accion text not null,
 antes jsonb not null default '{}', despues jsonb not null default '{}', origen text not null default 'app'
);
create index app_auditoria_fecha on public.app_auditoria(en desc,id desc);
create index app_auditoria_usuario on public.app_auditoria(usuario,en desc,id desc);
alter table public.app_auditoria enable row level security;
revoke all on public.app_auditoria from public,anon,authenticated;
revoke all on sequence public.app_auditoria_id_seq from public,anon,authenticated;

-- Solo campos de negocio. No PIN, claves, mensajes privados, enlaces a fotos ni importes salariales.
create or replace function public.auditoria_datos(j jsonb) returns jsonb language sql immutable set search_path=public as $$
 select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) from jsonb_each(coalesce(j,'{}')) where key=any(array[
 'nombre','cliente','cliente_nombre','producto','direccion','notas','observaciones','texto','fecha','fecha_pedido','fecha_entrega','fecha_despacho','turno','estado','etapa','retiro','remito_hecho','eliminado_en','eliminada_en','fusionado_en','vendedor',
 'cantidad','cantidad_entregada','medida','unidad','unidades_por_caja','en_unidades','fetear','sin_cuero','activo','se_fetea','alterna_unidad','caja_en','medidas','motivo_faltante','detalle_faltante','producto_id',
 'juntado','separado','falta','enviado','peso','medida_real','sustituto','sustituto_cantidad','sustituto_medida','sustituye','controlado','cargado','reposicion_id','frio','se_pesa',
 'tipo','motivo','nota','revision_en','desde','vigente','cierre','ciclo','escrito_en','deferred','linked_client_name','client_name','semana','pagado_en','anulado_en','entrada','salida','fin_pausa','resultado','volver_el','dia_semana','siempre','etiqueta_id','orden','items'
 ])
$$;
create function public.auditoria_usuario(p_id uuid) returns text language sql stable security definer set search_path=public as $$
 select case when p_id is null then 'Sistema' else coalesce(
 (select nombre from bitacora_acceso where user_id=p_id),
 (select nombre from notas_acceso where user_id=p_id),
 (select nombre from stock_acceso where user_id=p_id),
 (select initcap(split_part(email,'@',1)) from auth.users where id=p_id),'Usuario '||left(p_id::text,8)) end
$$;
create or replace function public.auditoria_capturar() returns trigger language plpgsql security definer set search_path=public as $$
declare a jsonb:='{}';b jsonb:='{}';r jsonb;aa jsonb;bb jsonb;da jsonb;db jsonb;k text;pid text;titulo text;ident text;accion text;nom text;
begin
 if TG_OP<>'INSERT' then a:=to_jsonb(old);end if;
 if TG_OP<>'DELETE' then b:=to_jsonb(new);end if;
 r:=case when TG_OP='DELETE' then a else b end;
 aa:=auditoria_datos(a);bb:=auditoria_datos(b);
 if TG_TABLE_NAME='whatsapp_send_requests' then aa:=jsonb_build_object('estado',a->'status');bb:=jsonb_build_object('estado',b->'status');end if;
 -- Las fotos se registran como presencia/cantidad, nunca se copia la ruta privada.
 foreach k in array array['foto','sustituto_foto','fotos_extra','sustituto_fotos_extra'] loop
  if a ? k then aa:=aa||jsonb_build_object(k,case when jsonb_typeof(a->k)='array' then jsonb_array_length(a->k) when coalesce(a->>k,'')<>'' then 1 else 0 end);end if;
  if b ? k then bb:=bb||jsonb_build_object(k,case when jsonb_typeof(b->k)='array' then jsonb_array_length(b->k) when coalesce(b->>k,'')<>'' then 1 else 0 end);end if;
 end loop;
 if TG_TABLE_NAME in ('bitacora_calculos','bitacora_pagos') then
  aa:=aa-'texto'-'nota';bb:=bb-'texto'-'nota';
  if TG_OP='UPDATE' and a is distinct from b and aa=bb then bb:=bb||jsonb_build_object('calculo_modificado',true);end if;
 end if;
 if TG_OP='UPDATE' then
  select coalesce(jsonb_object_agg(key,value),'{}') into da from jsonb_each(aa) where value is distinct from bb->key;
  select coalesce(jsonb_object_agg(key,value),'{}') into db from jsonb_each(bb) where value is distinct from aa->key;
  aa:=da;bb:=db;
  if aa='{}' and bb='{}' then return new;end if;
 end if;
 ident:=coalesce(r->>'id',r->>'pedido_id',r->>'item_id',r->>'cliente_id',r->>'user_id',r->>'usuario',r->>'clave',r->>'contact_key',r->>'nombre','');
 titulo:=coalesce(nullif(r->>'cliente',''),nullif(r->>'nombre',''),nullif(r->>'cliente_nombre',''),nullif(r->>'producto',''),nullif(r->>'client_name',''));
 if titulo is null and r->>'cliente_id' is not null then select nombre into titulo from clientes where id=(r->>'cliente_id')::uuid;end if;
 pid:=r->>'pedido_id';
 if TG_TABLE_NAME='prep_items' then select pedido_id into pid from pedido_items where id=(r->>'item_id')::bigint;end if;
 if pid is not null then select cliente into nom from pedidos where id=pid;titulo:=concat_ws(' · ',nom,titulo);end if;
 if TG_TABLE_NAME like 'bitacora_%' then titulo:=auditoria_usuario(coalesce(r->>'user_id',r->>'usuario')::uuid);end if;
 accion:=case TG_OP when 'INSERT' then 'Creó' when 'DELETE' then 'Eliminó' else 'Modificó' end;
 if TG_OP='UPDATE' and coalesce(b->>'eliminado_en',b->>'eliminada_en') is not null and coalesce(a->>'eliminado_en',a->>'eliminada_en') is null then accion:='Dio de baja';end if;
 insert into app_auditoria(usuario_id,usuario,tabla,registro,titulo,accion,antes,despues)
 values(auth.uid(),auditoria_usuario(auth.uid()),TG_TABLE_NAME,ident,coalesce(nullif(titulo,''),ident),accion,aa,bb);
 return case when TG_OP='DELETE' then old else new end;
end $$;
revoke all on function public.auditoria_datos(jsonb),public.auditoria_usuario(uuid),public.auditoria_capturar() from public,anon,authenticated;

do $$ declare t text;begin
 foreach t in array array['pedidos','pedido_items','pedidos_fijos','pedidos_a_cargar','clientes','productos','catalogo_decisiones','app_notas','prep_cola','prep_items','prep_pedidos','prep_productos','hojas_reparto','seg_agenda','seg_contactos','seg_decisiones','seg_reglas_producto','seg_etiquetas','clientes_etiquetas','whatsapp_client_review','whatsapp_contacts','whatsapp_send_requests','stock_recuentos','stock_recuento_items','stock_movimientos','bitacora_jornadas','bitacora_pausa','bitacora_calculos','bitacora_pagos'] loop
  if to_regclass('public.'||t) is not null then execute format('create trigger auditoria_cambio after insert or update or delete on public.%I for each row execute function public.auditoria_capturar()',t);end if;
 end loop;
end $$;

-- Recuperar únicamente historial que ya existía, identificado como previo.
insert into app_auditoria(en,usuario,tabla,registro,titulo,accion,antes,despues,origen)
select en,autor,tabla,registro,coalesce(despues->>'cliente',despues->>'nombre',antes->>'cliente',antes->>'nombre',registro),accion,auditoria_datos(antes),auditoria_datos(despues),'historial previo' from admin_cambios;
insert into app_auditoria(en,usuario_id,usuario,tabla,registro,titulo,accion,antes,despues,origen)
select en,autor_id,auditoria_usuario(autor_id),'bitacora_jornadas',jornada_id::text,'Corrección de jornada',accion,auditoria_datos(antes),auditoria_datos(despues),'historial previo' from bitacora_cambios;

create function public.admin_auditoria_leer(p_usuario text default '',p_q text default '',p_desde date default null,p_hasta date default null,p_cursor jsonb default null) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare filas jsonb;
begin
 perform admin_exigir();
 select coalesce(jsonb_agg(to_jsonb(x) order by x.en desc,x.id desc),'[]') into filas from (
  select * from app_auditoria where (coalesce(p_usuario,'')='' or usuario=p_usuario)
  and (coalesce(p_q,'')='' or strpos(lower(titulo||' '||tabla||' '||accion||' '||registro),lower(left(p_q,200)))>0)
  and (p_desde is null or en>=p_desde::timestamp at time zone 'America/Argentina/Buenos_Aires')
  and (p_hasta is null or en<(p_hasta+1)::timestamp at time zone 'America/Argentina/Buenos_Aires')
  and (p_cursor is null or (en,id)<((p_cursor->>'en')::timestamptz,(p_cursor->>'id')::bigint))
  order by en desc,id desc limit 51
 )x;
 return jsonb_build_object('filas',filas,'usuarios',(select coalesce(jsonb_agg(usuario order by usuario),'[]') from (select distinct usuario from app_auditoria)x));
end $$;
revoke all on function public.admin_auditoria_leer(text,text,date,date,jsonb) from public,anon;
grant execute on function public.admin_auditoria_leer(text,text,date,date,jsonb) to authenticated;
commit;
