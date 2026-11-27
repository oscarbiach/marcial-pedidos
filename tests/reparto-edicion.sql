-- Ejecutar dentro de una transacción de prueba con sesión autenticada.
do $$
declare
 pedido text:='QA-'||gen_random_uuid(); cliente text:='Prueba '||pedido;
 cab jsonb:=jsonb_build_object('id',pedido,'cliente',cliente,'turno','tarde');
 uno bigint; dos bigint; x jsonb; items jsonb; r jsonb;
begin
 insert into pedidos(id,fecha,cliente,estado) values(pedido,current_date,cliente,'Pendiente');
 insert into pedido_items(pedido_id,producto,cantidad,orden) values(pedido,'Producto prueba A',2,0) returning id into uno;
 insert into pedido_items(pedido_id,producto,cantidad,orden) values(pedido,'Producto prueba B',1,1) returning id into dos;
 insert into prep_items(item_id,foto,peso,fotos_extra) values(uno,'prueba-a.jpg',2.4,array['prueba-a2.jpg']);
 insert into prep_items(item_id,foto,peso) values(dos,'prueba-b.jpg',1.2);
 x:=jsonb_build_object('producto','Producto prueba A','cantidad',3,'orden',0);
 items:=jsonb_build_array(x||jsonb_build_object('id',uno),jsonb_build_object('producto','Nuevo','cantidad',1,'orden',1,'id',null));
 r:=pedido_guardar_turno(cab,items,true);
 if r->>'ok' is distinct from 'true' or not exists(select 1 from prep_items where item_id=uno and revisar_edicion
  and peso=2.4 and foto='prueba-a.jpg' and fotos_extra=array['prueba-a2.jpg']) then raise exception 'No conservó el renglón preparado'; end if;
 if not exists(select 1 from prep_retirados where pedido_id=pedido and item_id=dos and preparacion->>'foto'='prueba-b.jpg'
  and (preparacion->>'peso')::numeric=1.2) or exists(select 1 from pedido_items where id=dos) then raise exception 'Retirado incorrecto'; end if;
 -- Un cliente con recursos antiguos también conserva la identidad del producto inequívoco.
 perform pedido_guardar_turno(cab,jsonb_build_array(x),true);
 if (select count(*) from pedido_items where pedido_id=pedido)<>1 or not exists(select 1 from pedido_items where id=uno and cantidad=3)
  or (select count(*) from prep_retirados where pedido_id=pedido)<>1 then raise exception 'Reintento o edición anterior incorrectos'; end if;
 if (select turno from pedidos where id=pedido)<>'tarde' then raise exception 'Se perdió el turno'; end if;
end $$;
