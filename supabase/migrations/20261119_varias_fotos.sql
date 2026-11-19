-- Conserva la foto principal para clientes anteriores; las nuevas son adicionales.
begin;
alter table public.prep_items
  add column if not exists fotos_extra text[] not null default '{}',
  add column if not exists sustituto_fotos_extra text[] not null default '{}';

-- Agregar/quitar es atómico: dos dispositivos no pisan las fotos del otro.
create or replace function public.prep_foto(p_item bigint,p_ruta text,p_sub boolean,p_quitar boolean,p_quien text,p_cambios jsonb default '{}')
returns public.prep_items language plpgsql security definer set search_path=public as $$
declare pid text; x prep_items; rutas text[]; k text;
begin
 if auth.uid() is null then raise exception 'Iniciá sesión nuevamente' using errcode='42501'; end if;
 select pedido_id into pid from pedido_items where id=p_item;
 perform 1 from pedidos where id=pid and estado='Pendiente' and eliminado_en is null and not coalesce(retiro,false) for update;
 if not found then raise exception 'El pedido ya no está disponible para preparar.'; end if;
 if nullif(p_ruta,'') is null or (not p_quitar and p_ruta not like 'pedido-'||pid||'/%') then raise exception 'Ruta de foto inválida'; end if;
 for k in select jsonb_object_keys(p_cambios) loop
  if not k=any(array['peso','peso_revision','falta','enviado','foto','medida_real','sustituto','sustituto_cantidad','sustituto_medida','sustituye','sustituto_peso','sustituto_peso_revision','sustituto_foto','separado']) then raise exception 'Cambio no permitido'; end if;
 end loop;
 insert into prep_items(item_id) values(p_item) on conflict(item_id) do nothing;
 select * into x from prep_items where item_id=p_item for update;
 x:=jsonb_populate_record(x,p_cambios);
 if x.foto is null then x.fotos_extra:='{}'; end if;
 if x.sustituto_foto is null then x.sustituto_fotos_extra:='{}'; end if;
 if p_sub and nullif(x.sustituto,'') is null then raise exception 'Elegí el sustituto antes de agregar su foto.'; end if;
 rutas:=array_remove(case when p_sub then array[x.sustituto_foto]||x.sustituto_fotos_extra else array[x.foto]||x.fotos_extra end,null);
 if p_quitar then rutas:=array_remove(rutas,p_ruta);
 elsif not p_ruta=any(rutas) then rutas:=array_append(rutas,p_ruta); end if;
 if p_sub then x.sustituto_foto:=rutas[1];x.sustituto_fotos_extra:=coalesce(rutas[2:],'{}');
 else x.foto:=rutas[1];x.fotos_extra:=coalesce(rutas[2:],'{}'); end if;
 update prep_items set peso=x.peso,peso_revision=x.peso_revision,falta=x.falta,enviado=x.enviado,
 foto=x.foto,fotos_extra=x.fotos_extra,medida_real=x.medida_real,separado=x.separado,
 sustituto=x.sustituto,sustituto_cantidad=x.sustituto_cantidad,sustituto_medida=x.sustituto_medida,sustituye=x.sustituye,
 sustituto_peso=x.sustituto_peso,sustituto_peso_revision=x.sustituto_peso_revision,
 sustituto_foto=x.sustituto_foto,sustituto_fotos_extra=x.sustituto_fotos_extra,
 quien=p_quien,actualizado_en=now() where item_id=p_item returning * into x;
 return x;
end $$;
revoke all on function public.prep_foto(bigint,text,boolean,boolean,text,jsonb) from public,anon;
grant execute on function public.prep_foto(bigint,text,boolean,boolean,text,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
