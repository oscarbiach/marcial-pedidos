# Preferencias de interfaz de Marcial Pedidos

## Cargar pedido

Probar las propuestas en un prototipo independiente con datos ficticios. Antes de integrar, comparar la misma tarea en computadora y celular. Conservar los botones, las unidades y los atajos que ya usa la persona que carga pedidos.

- En escritorio se eligen productos escribiendo. Las filas comparten columnas para cantidad, producto y quitar. Ubicar el control de preparación dentro del campo del producto, en el extremo derecho. Los productos que no se fetean aprovechan todo el ancho del campo.
- Para agregar un renglón se eligió «Lista fluida»: la apertura de espacio y la aparición de la fila comparten una curva y duran 320 ms. Al editar una cantidad, el foco queda listo para seguir escribiendo. Evitar vuelos de etiquetas y rebotes de campos.
- En celular se eligió el selector de productos a pantalla completa, el teclado de cantidad y la entrada de la fila. Cada dispositivo puede tener su propio recorrido.
- Mantener el azul marino de la marca, los botones principales en azul a índigo y la tarjeta completa con los colores de los grupos de Pedidos. Fecha visible, dirección y observación plegables. Animaciones integradas, sin selector de demostración.
- La colaboración que funcionó en esta pantalla: Codex prototipó y ajustó las interacciones con feedback del usuario. Claude adaptó esa base, volvió accionable «Suele pedir» y sumó los atajos Hoy/Mañana y el día de la semana. Para otra pantalla, compartir con ambos el mismo recorrido, ejemplos y criterios de aceptación.

## Para cargar y Telegram

La bandeja «Para cargar» está desactivada por decisión de Marcial. El bot de Telegram nunca se implementó. Se conserva pedidos-a-cargar.js para un posible uso futuro. La app no carga el módulo ni inicia sus consultas periódicas. Para reactivarlo, primero confirmar que exista un origen operativo de pedidos y probar el circuito de recepción, carga y descarte con datos ficticios.
