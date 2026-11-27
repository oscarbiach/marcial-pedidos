-- Los tres usuarios pueden registrar o corregir el estado del pago.
begin;
update public.proveedores_pagos_acceso set puede_transferir=true
 where nombre in ('Oscar','Joaquin','Thiago');
commit;
