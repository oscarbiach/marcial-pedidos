# Reparto en vivo

## Uso

- Oscar, Thiago y Joaquín ven «Sin enviar», «Por preparar», «Preparando» y «Listos». Se agarra una tarjeta con el mouse y se suelta en una columna resaltada para avanzar o retroceder un paso. En pantallas táctiles, el símbolo ⠿ permite arrastrar en cualquier dirección; el resto de la tarjeta conserva el desplazamiento vertical y el deslizamiento horizontal para avanzar. Los botones siguen disponibles como alternativa.
- «Sin enviar» agrupa por fecha de entrega, no por fecha de carga. Hoy, atrasados (cada fecha por separado) y sin fecha están abiertos; mañana y los días posteriores se muestran plegados con su cantidad. Cada grupo se puede abrir/cerrar y conserva esa elección ante los refrescos. Al cambiar de día o usuario se restablece la vista inicial. La cola ya enviada a Mateo permanece visible, incluso si tiene pedidos futuros.
- El arrastre incluye una copia flotante, destinos resaltados y desplazamiento automático. Soltar afuera, en una columna no permitida, presionar Escape, salir de la ventana o perder el gesto no mueve el pedido. Si otro operador cambia ese pedido durante el gesto, se pide revisar el estado antes de intentar de nuevo.
- Mateo entra en Reparto y tiene únicamente Reparto y Pedidos en ambas navegaciones. Ve la cola compartida sin los pedidos que todavía no enviaron ni las hojas anteriores.
- Tocar cualquier tarjeta, usar Enter/Espacio sobre ella o «Abrir armado» abre el pedido sin cambiar su etapa. El arrastre y el deslizamiento no abren el detalle.
- El armado muestra un producto por vez: cantidad solicitada, indicaciones, peso real, foto del pesaje y faltante editable dentro de la misma pantalla. «Guardar y seguir» confirma el guardado y abre el próximo producto pendiente. El avance refleja productos guardados; conserva los borradores ante actualizaciones y errores. Las fotos llevan cliente, producto y peso; cambiar el peso exige renovar la foto cuando es obligatoria. Un faltante total no necesita peso ni foto.
- Guardar un producto de la cola inicia su preparación; editar uno listo vuelve a Preparando. «Marcar pedido listo» exige que todos estén separados, con faltantes válidos y peso/foto donde corresponde. La base valida nuevamente. No despacha el pedido. «Remito y carga en camioneta» conserva las herramientas operativas anteriores.
- Los demás conservan las hojas y sus herramientas detrás de «Hojas de reparto».
- Los cambios se reciben por Supabase Realtime. Un refresco cada 15 segundos y al recuperar conexión/visibilidad recupera eventos perdidos. Si falla una escritura, la tarjeta permanece en su estado confirmado. La base rechaza una versión vieja si otra pantalla ya cambió el pedido.

## Activación

1. La base debe tener aplicada `20261113_preparacion.sql`.
2. Ejecutar `supabase/migrations/20261116_reparto_en_vivo.sql` en el proyecto Supabase de la app **antes de publicar el frontend**. Crea la cola, su RPC transaccional y agrega seis tablas a `supabase_realtime`. No mueve pedidos ni importa hojas guardadas automáticamente.
3. Publicar el frontend de esta rama, incluyendo `reparto-vivo.*`, `armado-pedido.*`, `preparacion.js`, `index.html` y `sw.js` (caché v97). Las mejoras de arrastre, fechas y armado individual no requieren otra migración.
4. Abrir dos sesiones reales: enviar con Oscar/Thiago/Joaquín y comprobar la llegada a Mateo, el retorno de cambios y la reconexión.

Las restricciones de navegación solicitadas para Mateo son de interfaz, coherentes con el esquema PIN existente. No sustituyen permisos de servidor sobre pedidos. La nueva cola exige sesión Auth; las escrituras pasan por la RPC y se auditan con `auth.uid()`. `actualizado_por` conserva el nombre de la sesión como etiqueta, no como prueba de identidad. Esta entrega no redefine los permisos de las tablas anteriores.

## Verificación

`npm ci`, `npm test`, `npx playwright install chromium`, `npm run test:ui`.

- Pruebas SQL con PostgreSQL embebido (PGlite): transiciones, versiones concurrentes, sesión requerida, exclusión de pedidos despachados, validación de cantidades/peso/foto y publicación Realtime.
- Navegador: dos sesiones con backend simulado, eventos compartidos, arrastre, fechas, gesto horizontal/scroll vertical, toque y teclado, avance por producto, validación de pesos/fotos/faltantes, errores y reintentos, borradores concurrentes, navegación de Mateo y cambio de usuario. Sin modificar pedidos reales.
- Las pruebas simuladas no verifican la configuración ni las credenciales del Supabase productivo. La activación y el ensayo real siguen siendo necesarios.
