# Reparto en vivo

## Uso

- Oscar, Thiago y Joaquín ven «Sin enviar», «Por preparar», «Preparando» y «Listos». Un deslizamiento horizontal hacia la derecha o el botón de la tarjeta avanza el pedido. Los botones secundarios permiten devolverlo.
- Mateo entra en Reparto y tiene únicamente Reparto y Pedidos en ambas navegaciones. Ve la cola compartida sin los pedidos que todavía no enviaron ni las hojas anteriores.
- «Ver pedido» abre el detalle individual con productos, cantidades, faltantes, peso, foto, remito y carga. «Listo» valida que esté separado; lo pesado requiere peso y foto, salvo faltante total. No despacha el pedido.
- Los demás conservan las hojas y sus herramientas detrás de «Hojas de reparto».
- Los cambios se reciben por Supabase Realtime. Un refresco cada 15 segundos y al recuperar conexión/visibilidad recupera eventos perdidos. Si falla una escritura, la tarjeta permanece en su estado confirmado. La base rechaza una versión vieja si otra pantalla ya cambió el pedido.

## Activación

1. La base debe tener aplicada `20261113_preparacion.sql`.
2. Ejecutar `supabase/migrations/20261116_reparto_en_vivo.sql` en el proyecto Supabase de la app **antes de publicar el frontend**. Crea la cola, su RPC transaccional y agrega seis tablas a `supabase_realtime`. No mueve pedidos ni importa hojas guardadas automáticamente.
3. Publicar el frontend de esta rama, incluyendo ambos archivos `reparto-vivo.*` y `sw.js` (caché v95).
4. Abrir dos sesiones reales: enviar con Oscar/Thiago/Joaquín y comprobar la llegada a Mateo, el retorno de cambios y la reconexión.

Las restricciones de navegación solicitadas para Mateo son de interfaz, coherentes con el esquema PIN existente. No sustituyen permisos de servidor sobre pedidos. La nueva cola exige sesión Auth; las escrituras pasan por la RPC y se auditan con `auth.uid()`. `actualizado_por` conserva el nombre de la sesión como etiqueta, no como prueba de identidad. Esta entrega no redefine los permisos de las tablas anteriores.

## Verificación

`npm ci`, `npm test`, `npx playwright install chromium`, `npm run test:ui`.

- Pruebas SQL con PostgreSQL embebido (PGlite): transiciones, versiones concurrentes, sesión requerida, exclusión de pedidos despachados, validación de cantidades/peso/foto y publicación Realtime.
- Navegador: dos sesiones con backend simulado, eventos compartidos, gesto horizontal/scroll vertical, escritura fallida, campos en edición, navegación de Mateo y cambio de usuario. Sin pedidos reales ni mensajes externos.
- Las pruebas simuladas no verifican la configuración ni las credenciales del Supabase productivo. La activación y el ensayo real siguen siendo necesarios.
