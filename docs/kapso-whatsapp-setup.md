# WhatsApp de Marcial: instalación y activación

El código de la rama `feat/kapso-whatsapp-inbox` agrega historial automático, búsqueda de conversaciones, recuento de mensajes, vínculos con clientes, notas/fechas de seguimiento, importación paginada del historial disponible y respuestas de texto desde Marcial. La clave de Kapso nunca va al HTML ni al navegador.

## Estado y límites

- El número ya está conectado a Kapso y la prueba de recepción fue exitosa.
- El código no está activado en producción hasta instalar la base, desplegar las funciones y configurar el webhook.
- Los mensajes de WhatsApp Business del celular se reciben por `smb_message_echoes` en el webhook **Meta**. Probar tanto el celular como los dispositivos que utiliza el equipo: algunos dispositivos vinculados pueden tener limitaciones de coexistencia.
- La importación usa lo que Kapso efectivamente pudo sincronizar. No garantiza recuperar mensajes eliminados, archivos antiguos ni los seis meses completos. Se puede reanudar sin duplicar mensajes.
- La primera asociación del contacto con un cliente se confirma manualmente. Después se conserva. No se adivina por nombres parecidos.
- Los archivos/audios se registran por tipo y texto/caption si existe. Esta versión no descarga archivos ni transcribe audios ni produce resúmenes con IA.
- Se puede responder texto dentro de las 24 horas del último mensaje entrante. Fuera de esa ventana, esta versión ofrece abrir WhatsApp Business; el envío de plantillas desde Marcial queda pendiente de definir/crear las plantillas del negocio.
- Los envíos se registran como aceptados antes de tener confirmación de entrega. Los estados reales llegan por webhook. Ante una respuesta de red ambigua no se reenvía automáticamente.
- Las fechas de seguimiento en notas son registro de contexto, no notificaciones programadas.

## 1. Crear las tablas en Supabase

En el proyecto `deavfpkpibvwccycszku`: **SQL Editor → New query**.
Copiar todo `supabase/migrations/20261014_whatsapp_messages.sql` y ejecutar.

Es una instalación inicial: el borrador anterior no fue aplicado durante esta conversación. Si alguien ejecutó ese borrador por su cuenta, detenerse y preparar una migración de actualización antes de aplicar esta versión. No borra ni cambia los pedidos, productos o clientes existentes.

## 2. Habilitar las cuentas reales que pueden acceder

La interfaz muestra WhatsApp a las personas que ya ven Clientes; el acceso real lo comprueba Supabase. No se habilita a todos los que tienen PIN.

Consultar en SQL Editor:

```sql
select id, email from auth.users order by email;
```

Identificar las cuentas de Oscar, Joaquín y Juan Marcos/Charly por la configuración real del login. Si todos los PIN utilizan una misma cuenta Auth compartida, no habilitar ese UUID para acceso selectivo: primero separar las identidades en la función de login. No deducirlas solo por semejanzas de texto. Agregar sus UUID confirmados:

```sql
insert into public.whatsapp_access(user_id, can_send, can_manage)
values ('UUID_REAL_DE_LA_CUENTA', true, true)
on conflict(user_id) do update
set can_send=excluded.can_send, can_manage=excluded.can_manage;
```

`can_send` permite responder; `can_manage` permite importar el historial. Para una cuenta de lectura usar false/false. No se necesita entregar el PIN ni ninguna clave a este repositorio.

## 3. Credenciales del servidor

Ya se cargaron:
- `KAPSO_API_KEY`
- `KAPSO_PHONE_NUMBER_ID=340539642484757`

Agregar `KAPSO_WEBHOOK_SECRET` con una contraseña aleatoria larga (al menos 32 caracteres, generada en un gestor de contraseñas o en el panel si ofrece esa opción). Usar exactamente el mismo valor en Kapso al registrar el webhook. No pegarlo en GitHub ni en el chat.

Supabase proporciona `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` dentro de las Edge Functions; no se copian al HTML.

## 4. Desplegar las dos funciones

### Desde el editor de Supabase (sin terminal)

**Edge Functions → Deploy a new function → Via Editor** (el nombre exacto del botón puede variar):
1. Crear `kapso-webhook`. Copiar TODO `supabase/dashboard/kapso-webhook.ts`. Publicar. En sus ajustes, desactivar **Verify JWT**: esta función autentica todas las peticiones mediante firma HMAC.
2. Crear `kapso-api`. Copiar TODO `supabase/dashboard/kapso-api.ts`. Publicar. Mantener **Verify JWT** activado; el código además valida la sesión y la tabla de permisos.

Las versiones del directorio `dashboard` incluyen los helpers en un único archivo para poder pegarlas en el editor. Las versiones del directorio `functions` usan un archivo compartido para mantener el código y las pruebas.

### Desde terminal, si se prefiere

```sh
supabase login
supabase link --project-ref deavfpkpibvwccycszku
supabase functions deploy kapso-webhook --no-verify-jwt
supabase functions deploy kapso-api
```

No desplegar otras funciones del proyecto ni modificar `login`.

## Despliegue real confirmado el 14/10/2026

El editor de Supabase muestra el nombre `kapso-webhook`, pero el slug real de su URL es `rapid-handler`.
El destino activo en Kapso debe ser la URL copiada de esa función:
`https://deavfpkpibvwccycszku.supabase.co/functions/v1/rapid-handler`.

Se confirmó en la base real:
- recepción de texto entrante;
- respuestas desde WhatsApp Business con `direction=outbound` y `origin=business_app`;
- registro de imágenes/documentos por tipo (content puede ser null).

En esta función real se desactivó Verify JWT y la prueba GET responde `POST only`. El secreto de firma sigue protegiendo las peticiones POST.
La API de Marcial conserva la ruta `kapso-api` y necesita Verify JWT activo.
La URL de abajo es la ruta canónica si se crea una función nueva con ese slug; para el despliegue actual usar `rapid-handler`.

## 5. Registrar el webhook en Kapso

Elegir el webhook de WhatsApp del número de Distribuidora Marcial; **formato/tipo Meta** (no un webhook general de eventos del proyecto).

- URL: `https://deavfpkpibvwccycszku.supabase.co/functions/v1/kapso-webhook`
- Secret key: el mismo valor de `KAPSO_WEBHOOK_SECRET`
- Activo: sí.

Si ya hay un webhook Meta configurado, inspeccionarlo antes de reemplazarlo: Kapso admite uno por número. El receptor también entiende eventos Kapso v2, pero el formato Meta permite captar respuestas de la app móvil con `message_echoes`.

Referencia oficial: https://docs.kapso.ai/docs/platform/webhooks/overview

## 6. Prueba real antes de publicar Marcial

1. Enviar un mensaje desde el WhatsApp personal al de Marcial.
2. Verificar filas en `whatsapp_contacts` y `whatsapp_messages`.
3. Responder desde WhatsApp Business en el celular principal. Debe aparecer otra fila con `direction=outbound`, `origin=business_app`.
4. Revisar en Kapso que el webhook recibe HTTP 200.
5. Probar también los dispositivos vinculados usados por el equipo. Si una respuesta no llega al webhook, no afirmar que ese dispositivo se registra automáticamente.

## 7. Publicar y usar

Revisar y fusionar el PR. El cambio del service worker carga la versión nueva en los dispositivos; si la app instalada conserva la anterior, cerrar y volver a abrir/actualizar.

En **WhatsApp**:
- Importar historial (solo usuarios habilitados para administrar); procesa páginas de 100 y conserva el avance. A las 50 páginas se pausa para continuar después.
- Elegir contacto → Cliente asociado y notas → seleccionar el cliente exacto → Guardar vínculo.
- Consultar historial, mensajes recibidos/enviados, última interacción y notas.
- Responder desde el formulario. Probar primero con el número personal del responsable.
- Desde la ficha de **Clientes**, usar **WhatsApp e historial de contacto** para ver los números ya vinculados a ese cliente.

## Verificación reproducible

```sh
node tests/whatsapp.test.cjs
```

Pruebas sin mensajes reales: firma correcta/alterada, lotes, ecos del celular, BSUID sin teléfono, permisos, ventana de respuesta, envío idempotente, resultado ambiguo y sintaxis.

`tests/whatsapp-schema.sql` es una base descartable de pruebas (PostgreSQL 15), **no se ejecuta en producción**. La acción de GitHub la usa para probar transacciones, RLS, estados fuera de orden, vínculos, notas y mensajes duplicados.
