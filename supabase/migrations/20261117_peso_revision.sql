-- Lecturas automáticas y revisión de dudas por quien confecciona el remito.
begin;
alter table public.prep_items
 add column if not exists peso_revision text check (peso_revision in ('automatico','dudoso','confirmado')),
 add column if not exists sustituto_peso_revision text check (sustituto_peso_revision in ('automatico','dudoso','confirmado'));

create or replace function public.prep_peso_cantidad() returns trigger
language plpgsql security definer set search_path=public as $$
declare i pedido_items;
begin
 select * into i from pedido_items where id=new.item_id;
 if prep_medida(i,new.medida_real)='kg' and new.peso>0 and new.peso::text not in ('NaN','Infinity','-Infinity')
  and new.peso_revision is distinct from 'dudoso' then
   new.enviado:=least(i.cantidad,round(new.peso,3));
   new.falta:=new.enviado<i.cantidad or nullif(trim(new.sustituto),'') is not null;
 end if;
 return new;
end $$;

create or replace function public.prep_revisar_peso(p_id text,p_item bigint,p_sub boolean,p_peso numeric,p_firma text,p_quien text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare anterior text;
begin
 if auth.uid() is null then raise exception 'Iniciá sesión nuevamente' using errcode='42501'; end if;
 if p_quien is null or p_quien not in ('Oscar','Thiago','Joaquin') then raise exception 'La revisión corresponde a quien hace el remito' using errcode='42501'; end if;
 if p_peso is null or p_peso<=0 or p_peso>150 or p_peso::text in ('NaN','Infinity','-Infinity') then raise exception 'Ingresá un peso válido en kg'; end if;
 perform 1 from pedidos where id=p_id and estado='Pendiente' and eliminado_en is null for update;
 if not found then raise exception 'El pedido ya no está disponible para revisar'; end if;
 if p_firma is distinct from prep_firma(p_id) then raise exception 'El pedido cambió. Volvé a revisar la foto.' using errcode='40001'; end if;
 perform 1 from pedido_items i join prep_items x on x.item_id=i.id where i.id=p_item and i.pedido_id=p_id
  and (not p_sub or nullif(trim(x.sustituto),'') is not null);
 if not found then raise exception 'El producto ya no está disponible'; end if;
 select etapa into anterior from prep_cola where pedido_id=p_id;
 if p_sub then
  update prep_items set sustituto_peso=round(p_peso,3),sustituto_peso_revision='confirmado',quien=p_quien,actualizado_en=now() where item_id=p_item;
 else
  update prep_items set peso=round(p_peso,3),peso_revision='confirmado',quien=p_quien,actualizado_en=now() where item_id=p_item;
 end if;
 -- Revisar kilos en oficina no obliga a Mateo a volver a preparar el pedido.
 -- El control y el remito anteriores sí quedan invalidados por el trigger.
 if anterior='listo' then
  perform prep_validar(p_id);
  update prep_cola set etapa='listo',version=version+1,actualizado_en=now(),actualizado_por=p_quien where pedido_id=p_id;
 end if;
 return prep_leer(p_id);
end $$;
revoke all on function public.prep_revisar_peso(text,bigint,boolean,numeric,text,text) from public,anon;
grant execute on function public.prep_revisar_peso(text,bigint,boolean,numeric,text,text) to authenticated;

-- Se puede preparar sin peso ni foto. Un peso numérico dudoso, en cambio,
-- debe revisarse en el remito antes de utilizarlo para despachar/reposición.
create or replace function public.prep_pesos_revisados(p_id text) returns void
language plpgsql security definer set search_path=public as $$
begin
 if exists(select 1 from prep_items x join pedido_items i on i.id=x.item_id where i.pedido_id=p_id and
  ((x.peso>0 and x.peso_revision='dudoso') or (x.sustituto_peso>0 and x.sustituto_peso_revision='dudoso'))) then
  raise exception 'Hay un peso con dudas. Revisalo desde el resumen para remito antes de despachar.';
 end if;
end $$;
revoke all on function public.prep_pesos_revisados(text) from public,anon,authenticated;
do $$ declare src text; begin
 src:=pg_get_functiondef('public.prep_cargar(text,text,text)'::regprocedure);
 if position('perform prep_pesos_revisados(p_id);' in src)=0 then
  if position('perform prep_validar(p_id);' in src)=0 then raise exception 'No se reconoce prep_cargar'; end if;
  execute replace(src,'perform prep_validar(p_id);','perform prep_validar(p_id); perform prep_pesos_revisados(p_id);');
 end if;
 src:=pg_get_functiondef('public.despachar_con_faltantes(text[],jsonb,text)'::regprocedure);
 if position('perform prep_pesos_revisados(p.id);' in src)=0 then
  if position('faltantes:=''[]'';' in src)=0 then raise exception 'No se reconoce despachar_con_faltantes'; end if;
  execute replace(src,'faltantes:=''[]'';','perform prep_pesos_revisados(p.id); faltantes:=''[]'';');
 end if;
end $$;
notify pgrst,'reload schema';
commit;
