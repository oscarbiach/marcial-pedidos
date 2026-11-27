-- Ejecutar en una transacción de prueba. Solo usa el pedido ficticio recién creado.
do $$
declare
 pedido text := 'QA-' || gen_random_uuid();
 item bigint; perfil record; otro text; fila public.prep_cola; ver integer := 0;
begin
 insert into pedidos(id,fecha,cliente,estado) values(pedido,current_date,'Prueba '||pedido,'Pendiente');
 insert into pedido_items(pedido_id,producto,cantidad,orden) values(pedido,'Prueba '||pedido,2,0) returning id into item;
 insert into prep_items(item_id,separado,peso,foto) values(item,true,2.5,'prueba.jpg');
 for perfil in select * from (values
   ('dbcd0e59-fc02-4c23-b1d6-aba342da21e8','Oscar','por_preparar'),
   ('e3e52cc0-d8e3-41e0-a641-26e33ffbcde6','Joaquin','preparando'),
   ('b8b830b5-2268-4e92-897e-36f8f74135ea','Thiago','listo')
 ) as perfiles(uid,nombre,salida) loop
   perform set_config('request.jwt.claim.sub',perfil.uid,true),set_config('test.uid',perfil.uid,true);
   fila := prep_mover(pedido,'preparando',ver,perfil.nombre);
   if fila.etapa <> 'preparando' or fila.version <> ver+1 then raise exception 'Envío incorrecto'; end if;
   begin
     perform prep_mover(pedido,'pendiente',ver,perfil.nombre);
     raise exception 'Aceptó una versión anterior';
   exception when serialization_failure then null; end;
   ver := fila.version;
   foreach otro in array array['a5936112-a9b4-4627-bf12-73df5936c42a','e11a2d13-2b31-4fc4-bac2-26a882caa51b'] loop
     perform set_config('request.jwt.claim.sub',otro,true),set_config('test.uid',otro,true);
     begin
       perform prep_mover(pedido,'pendiente',ver,'Oscar');
       raise exception 'Salida sin permiso';
     exception when insufficient_privilege then null; end;
   end loop;
   if perfil.salida <> 'preparando' then
     perform set_config('request.jwt.claim.sub','a5936112-a9b4-4627-bf12-73df5936c42a',true),
             set_config('test.uid','a5936112-a9b4-4627-bf12-73df5936c42a',true);
     fila := prep_mover(pedido,perfil.salida,ver,'Mateo');
     if fila.etapa <> perfil.salida then raise exception 'Movimiento entre columnas incorrecto'; end if;
     ver := fila.version;
   end if;
   perform set_config('request.jwt.claim.sub',perfil.uid,true),set_config('test.uid',perfil.uid,true);
   fila := prep_mover(pedido,'pendiente',ver,perfil.nombre);
   if fila.etapa <> 'pendiente' then raise exception 'Salida incorrecta'; end if;
   ver := fila.version;
   foreach otro in array array['a5936112-a9b4-4627-bf12-73df5936c42a','e11a2d13-2b31-4fc4-bac2-26a882caa51b'] loop
     perform set_config('request.jwt.claim.sub',otro,true),set_config('test.uid',otro,true);
     begin
       perform prep_mover(pedido,'preparando',ver,'Oscar');
       raise exception 'Entrada sin permiso';
     exception when insufficient_privilege then null; end;
   end loop;
 end loop;
 if not exists(select 1 from pedidos where id=pedido and estado='Pendiente')
 or not exists(select 1 from prep_items where item_id=item and peso=2.5 and foto='prueba.jpg')
 then raise exception 'No conservó el pedido o su preparación'; end if;
end $$;
