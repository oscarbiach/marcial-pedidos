# Respaldo antes de la primera etapa de Seguimiento

Fecha: 26/11/2026 (Argentina).
Versión anterior: `423a3f6d3a673b6c0c486dcd26ec420084d88592`.
Rama remota: `backup/seguimiento-2026-11-26-antes-etapa1`.
ZIP local: `../seguimiento-backup-2026-11-26.zip` (repositorio completo, sin secretos locales). Los cuatro archivos de Seguimiento se verificaron contra el commit, normalizando saltos de línea Windows.

La primera etapa solo modifica cálculos y textos de Clientes. No migra ni reescribe pedidos, contactos, agendas, reglas ni permisos en Supabase.

## Volver al seguimiento anterior

Restaurar `seguimiento-clientes.js` y `seguimiento-clientes-ui.js` desde el commit anterior. Mantener el resto de la app actual, aumentar la versión de caché y las referencias de esos dos archivos en `index.html` y `sw.js`, comprobar las pruebas y publicar. Revertir también las pruebas de la etapa 1 si se restaura su comportamiento. No restaurar toda la rama sobre main: eso desharía mejoras ajenas al seguimiento.

Los pedidos y contactos seguirán siendo los actuales. No se restaura la base de datos ni se pierden registros posteriores.

## Primera etapa

- Frecuencia y último pedido por `fechaPedido` (fecha real); fecha de carga como respaldo.
- Reposiciones con la misma marca de Pedidos: no reinician compras ni finalizan recuperación.
- Último despacho separado; incluye entregas de reposiciones.
- Agendas anteriores compatibles con su referencia de despacho/reposición, siempre que no exista una compra comercial posterior a ese ciclo.
- La alerta por menos productos distintos dice “Pidió menos variedad”. No representa kilos ni facturación.
