# Reparto en vivo

## Uso

- Oscar, Thiago y Joaquín ven «Sin enviar», «Por preparar», «Preparando» y «Listos». Se agarra una tarjeta con el mouse y se suelta en una columna resaltada para avanzar o retroceder un paso. En pantallas táctiles, el símbolo ⠿ permite arrastrar en cualquier dirección; el resto de la tarjeta conserva el desplazamiento vertical y el deslizamiento horizontal para avanzar. Los botones siguen disponibles como alternativa.
- «Sin enviar» agrupa por fecha de entrega, no por fecha de carga. Hoy, atrasados (cada fecha por separado) y sin fecha están abiertos; mañana y los días posteriores se muestran plegados con su cantidad. Cada grupo se puede abrir/cerrar y conserva esa elección ante los refrescos. Al cambiar de día o usuario se restablece la vista inicial. La cola ya enviada a Mateo permanece visible, incluso si tiene pedidos futuros.
- El arrastre incluye una copia flotante, destinos resaltados y desplazamiento automático. Soltar afuera, en una columna no permitida, presionar Escape, salir de la ventana o perder el gesto no mueve el pedido. Si otro operador cambia ese pedido durante el gesto, se pide revisar el estado antes de intentar de nuevo.
- Mateo entra en Reparto y tiene únicamente Reparto y Pedidos en ambas navegaciones. Ve la cola compartida sin los pedidos que todavía no enviaron ni las hojas anteriores.
- Tocar cualquier tarjeta, usar Enter/Espacio sobre ella o «Abrir armado» abre el pedido sin cambiar su etapa. El arrastre y el deslizamiento no abren el detalle.
- El armado muestra un producto por vez. Peso y foto son opcionales en la interfaz y en la base. Los productos que no requieren pesaje muestran «Agregar peso o foto»; los que no tienen medida permiten definirla para ese pedido. «Guardar y seguir» confirma el guardado antes de avanzar. Cambiar cantidad, producto o peso retira el pesaje/foto anterior cuando ya no corresponde; no exige volver a cargarlo.
- En «Faltante o sustituto» se indica cuánto se envía del original y, si corresponde, el producto sustituto, su cantidad/medida y cuánto reemplaza. El sustituto tiene su propio peso y foto opcionales. Lo reemplazado se considera resuelto. Solo el resto queda pendiente.
- Guardar un producto de la cola inicia su preparación; editar uno listo vuelve a Preparando. «Marcar pedido listo» exige separar todos los productos e indicar cantidades válidas. No despacha. Un faltante registrado permite completar el armado.
- Oscar, Thiago y Joaquín tocan un pedido listo para abrir el resumen de remito: productos enviados, cantidades reales registradas, fotos, sustitutos y pendientes. Los datos de pesaje ausentes se señalan sin bloquear. «Marcar remito hecho» y «Confirmar control» se comparten en vivo.
- Cuando todos los pedidos de la cola están listos, «Camioneta · Controlar y cargar» abre el lote. «Cargar y despachar» requiere control del contenido vigente y marca ese pedido Despachado en Pedidos. Si hay faltantes, crea la reposición violeta en la misma transacción; un fallo revierte todo y reintentar no duplica. El lote abierto conserva los pedidos ya cargados. Los nuevos pedidos se preparan en el tablero.
- Cambios en productos, cantidades o encabezado invalidan el control y remito anterior. Un cambio de cantidades vuelve a exigir separar el producto. Una carga con un resumen viejo se rechaza para revisar las novedades.
- Los demás conservan las hojas y sus herramientas detrás de «Hojas de reparto».
- Los cambios se reciben por Supabase Realtime. Un refresco cada 15 segundos y al recuperar conexión/visibilidad recupera eventos perdidos. Si falla una escritura, la tarjeta permanece en su estado confirmado. La base rechaza una versión vieja si otra pantalla ya cambió el pedido.

## Activación

1. La base debe tener aplicada `20261113_preparacion.sql`.
2. Ejecutar `supabase/migrations/20261116_reparto_en_vivo.sql` en el proyecto Supabase de la app **antes de publicar el frontend**. Crea la cola, su RPC transaccional y agrega seis tablas a `supabase_realtime`. No mueve pedidos ni importa hojas guardadas automáticamente.
3. Aplicar `20261116_reparto_carga.sql`: agrega medidas/sustituciones, elimina requisitos de peso/foto y crea lectura, confirmación y carga atómica, además de invalidar controles ante ediciones. No modifica pedidos existentes durante la migración.
4. Publicar `reparto-vivo.*`, `armado-pedido.*`, `reparto-control.*`, `preparacion.js`, `index.html` y `sw.js` (caché v98). Las referencias con versión evitan que una caché anterior mezcle archivos nuevos y viejos.
5. Abrir dos sesiones reales: enviar con Oscar/Thiago/Joaquín y comprobar la llegada a Mateo, el retorno de cambios y la reconexión.

Las restricciones de navegación solicitadas para Mateo son de interfaz, coherentes con el esquema PIN existente. No sustituyen permisos de servidor sobre pedidos. La nueva cola exige sesión Auth; las escrituras pasan por la RPC y se auditan con `auth.uid()`. `actualizado_por` conserva el nombre de la sesión como etiqueta, no como prueba de identidad. Esta entrega no redefine los permisos de las tablas anteriores.

## Verificación

`npm ci`, `npm test`, `npx playwright install chromium`, `npm run test:ui`.

- Pruebas SQL con PostgreSQL embebido (PGlite): transiciones, sesión requerida, cantidades/sustitutos, datos opcionales, carga completa/parcial, reposición atómica, rollback ante fallos, reintentos, invalidación de controles y publicación Realtime.
- Navegador: dos sesiones con backend simulado, eventos compartidos, arrastre, fechas, gesto horizontal/scroll vertical, toque y teclado, avance por producto, validación de pesos/fotos/faltantes, errores y reintentos, borradores concurrentes, navegación de Mateo y cambio de usuario. Sin modificar pedidos reales.
- Las pruebas simuladas no verifican la configuración ni las credenciales del Supabase productivo. La activación y el ensayo real siguen siendo necesarios.
