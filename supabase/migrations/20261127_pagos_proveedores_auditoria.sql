begin;
-- El registro general omite importes por defecto. Aquí se registran solo
-- los tres campos del pago y su estado, visibles exclusivamente a admins.
create function public.proveedores_pagos_auditar() returns trigger language plpgsql security definer set search_path=public as $$
declare a jsonb:='{}';b jsonb;accion text;
begin
 if TG_OP='UPDATE' then a:=jsonb_build_object('proveedor',old.proveedor,'fecha_prevista',old.fecha_prevista,'importe',old.importe,'estado',old.estado,'eliminado_en',old.eliminado_en,'pagado_en',old.transferido_en);end if;
 b:=jsonb_build_object('proveedor',new.proveedor,'fecha_prevista',new.fecha_prevista,'importe',new.importe,'estado',new.estado,'eliminado_en',new.eliminado_en,'pagado_en',new.transferido_en);
 accion:=case when TG_OP='INSERT' then 'Creó' when old.eliminado_en is null and new.eliminado_en is not null then 'Eliminó' when old.eliminado_en is not null and new.eliminado_en is null then 'Restauró' when old.estado<>new.estado then case when new.estado='transferido' then 'Marcó pagado' else 'Volvió a pendiente' end else 'Editó' end;
 insert into app_auditoria(usuario_id,usuario,tabla,registro,titulo,accion,antes,despues)
 values(auth.uid(),auditoria_usuario(auth.uid()),'proveedores_pagos',new.id::text,new.proveedor,accion,a,b);
 return new;
end $$;
revoke all on function public.proveedores_pagos_auditar() from public,anon,authenticated;
drop trigger auditoria_cambio on public.proveedores_pagos;
create trigger auditoria_cambio after insert or update on public.proveedores_pagos for each row execute function public.proveedores_pagos_auditar();
commit;
