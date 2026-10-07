# Asyne Studio

Aplicación local en Vue 3 y Element Plus, con API en Node.js 22 / Express 5 y PostgreSQL 17.

## Ejecutar con Docker

Con Docker Desktop iniciado, ejecuta desde esta carpeta:

```powershell
docker compose up -d --build
```

Abre http://localhost:5180. El archivo local `.env` contiene `POSTGRES_PASSWORD`; está excluido de Git y de las imágenes. Para una instalación nueva, crea ese archivo con una contraseña aleatoria antes de arrancar. Por ejemplo, en PowerShell 7:

```powershell
$studioPassword = [Convert]::ToHexString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
Set-Content .env "POSTGRES_PASSWORD=$studioPassword"
```

Genera la contraseña solo para una instalación nueva; cambiarla en el archivo no cambia la contraseña de una base de datos ya creada.

- Aplicar cambios de código: `docker compose up -d --build`.
- Detener: `docker compose down`.
- Ver servicios: `docker compose ps`.
- Ver registros: `docker compose logs --tail=100 api`.
- Ejecutar pruebas de integración: `docker compose exec -T api npm test`.

Los datos se guardan en el volumen `asyne-studio_studio-data`. Se conservan al reconstruir, reiniciar o ejecutar `docker compose down`. **No uses `docker compose down -v` si quieres conservarlos:** elimina el volumen. El volumen no sustituye una copia de seguridad.

Solo el frontend publica un puerto, vinculado a `127.0.0.1:5180`. Nginx reenvía `/api/` a Express; API y base de datos permanecen en la red interna de Docker. Esta versión es local y no tiene inicio de sesión: antes de exponerla en Internet necesita autenticación y una configuración de despliegue apropiada.

## Flujo editorial

Abre un pin para editar título, descripción, colección, producto, ASIN, texto alternativo, enlace de afiliado, tablero, fecha prevista y estado. Pulsa **Guardar cambios** para persistirlos en PostgreSQL.

Estados: **Borrador**, **Listo para revisar**, **Aprobado**, **Publicado**. Los filtros y contadores reflejan los datos guardados. El estado Publicado es un registro manual; no publica en Pinterest. La fecha prevista es orientativa y se muestra en la zona horaria del navegador.

La carga inicial incluye las dos colecciones y los diez pines originales. Los reinicios no sobrescriben las ediciones. Las marcas antiguas de revisión del prototipo siguen en el almacenamiento del navegador (`asyne-approved`); no se convierten automáticamente en aprobaciones.

Si se modifica el mismo pin desde dos ventanas, la API detecta una versión desactualizada y evita sobrescribir el trabajo más reciente. El formulario avisa de cambios pendientes antes de cerrarlo.

## API

| Método | Ruta | Función |
| --- | --- | --- |
| GET | /api/health | Estado de la API y conexión a PostgreSQL |
| GET | /api/collections | Colecciones |
| GET | /api/pins | Todos los pines |
| GET | /api/pins/:id | Un pin |
| PATCH | /api/pins/:id | Editar campos del pin |

Ejemplo de cuerpo JSON para PATCH:

```json
{
  "version": 1,
  "title": "Un rincón de café en calma",
  "description": "Ideas para organizar tu estación de café.",
  "affiliateUrl": "https://www.amazon.es/dp/B0FGPCG599",
  "board": "Rincones de café",
  "scheduledAt": "2026-09-20T10:30:00+02:00",
  "status": "ready"
}
```

Usa siempre la `version` devuelta por GET o PATCH. `scheduledAt` admite una fecha ISO con zona horaria o `null` para vaciarla. Estados de API: `draft`, `ready`, `approved`, `published`. Los errores devuelven JSON con `error`: 400 para datos inválidos, 404 para un pin inexistente y 409 para conflicto de versión.

Las consultas usan [parámetros de node-postgres](https://node-postgres.com/features/queries); los errores asíncronos pasan por el [manejador de Express](https://expressjs.com/en/guide/error-handling/). Las pruebas usan un esquema temporal separado y lo eliminan al terminar, sin modificar las colecciones reales.

## Desarrollo de la interfaz

Con Docker iniciado para servir la API:

```powershell
pnpm install
pnpm dev
```

Vite reenvía `/api` a http://localhost:5180. Para compilar: `pnpm build`.

## Archivos principales

- `src/App.vue`: edición, filtros y estados.
- `src/style.css`: diseño y responsive.
- `src/data/pins.js`: datos iniciales; editar este archivo no reemplaza datos ya guardados.
- `public/assets/`: imágenes de los pines.
- `server/app.js`: rutas, validación y errores.
- `server/db.js`: esquema inicial y carga de datos idempotente.
- `server/test/api.test.js`: pruebas de integración con PostgreSQL.
- `compose.yaml`: frontend, API, PostgreSQL y volumen.
- `nginx.conf`: distribución de frontend y API.

La autorización de Pinterest ya está preparada (ver abajo). Amazon funciona con carga manual y Picsart sigue pendiente. Antes de conectarlas, consulta [VIABILIDAD.md](VIABILIDAD.md). Las credenciales de proveedores se guardan solo en el servidor.

## Conectar Pinterest cuando aprueben el Trial

En el panel de tu aplicación de Pinterest, registra exactamente esta **Redirect URI**:

```text
http://localhost:5180/api/pinterest/callback
```

Es la dirección de retorno de OAuth para la aplicación local, distinta de las URL públicas de presentación y privacidad. Abre AsyneStudio desde `http://localhost:5180` para que la cookie de autorización use el mismo host.

Completa en el archivo local `.env` (no en el chat ni en el código):

```dotenv
PINTEREST_APP_ID=identificador_de_tu_app
PINTEREST_APP_SECRET=secreto_de_tu_app
PINTEREST_REDIRECT_URI=http://localhost:5180/api/pinterest/callback
```

Esta instalación ya tiene `PINTEREST_TOKEN_KEY`, una clave aleatoria de 32 bytes en hexadecimal, generada localmente. Consérvala: cifra los tokens almacenados en PostgreSQL con AES-256-GCM. En una instalación nueva, genera una clave con `[Convert]::ToHexString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))`. No la publiques ni la regeneres en cada arranque. Si se pierde o cambia, habrá que volver a autorizar la cuenta.

Después ejecuta `docker compose up -d --build` y pulsa **Conectar Pinterest**. La autorización solicita únicamente `boards:read` y `user_accounts:read`. Guarda tokens cifrados, cuenta y caducidad; no expone tokens al navegador ni registra códigos OAuth en los logs de Nginx. La respuesta requiere una cookie HttpOnly y un estado aleatorio de un solo uso que caduca en diez minutos.

El estado de aprobación Trial no se consulta automáticamente. Mientras esté pendiente, Pinterest puede rechazar la autorización. Esta primera fase **no lista tableros ni publica pines**: prepara la conexión y comprueba la cuenta. La renovación automática queda para la siguiente fase; al caducar se muestra la necesidad de volver a conectar. **Desconectar** borra los tokens locales; para revocar el permiso en Pinterest, utiliza también sus ajustes de aplicaciones. No se modifican los pines editoriales.

Pruebas: `docker compose exec -T api npm test`. Las pruebas OAuth simulan las respuestas de Pinterest y usan un esquema PostgreSQL aislado; la autorización real necesita aprobación Trial y las credenciales de tu app.

Referencia: [Autenticación y autorización de Pinterest](https://developer.pinterest.com/docs/getting-started/set-up-authentication-and-authorization/).


## Descartar y recuperar pines

En la ficha de un pin, pulsa **Descartar pin**. Si estás editando, **Guardar y descartar pin** guarda también esos cambios. El contenido se conserva y el pin deja de aparecer entre los activos y en la revisión siguiente.

El filtro **Descartados** permite encontrarlos. Abre uno y pulsa **Recuperar como borrador** para volver a trabajar con él. **Todos, incluidos descartados** muestra el conjunto completo. La API acepta también el estado `discarded`; el cambio de esquema se aplica automáticamente sin reemplazar datos existentes.

## Amazon: flujo manual

Abre un pin y pulsa **Cargar producto de Amazon**. Pega el enlace de afiliado, introduce el nombre y comprueba el ASIN (se extrae de enlaces largos compatibles de Amazon España; para amzn.to se introduce manualmente). Confirma la revisión y pulsa **Aplicar a la ficha del pin**, después **Guardar cambios**. El enlace se conserva sin modificar sus parámetros. La confirmación es una revisión humana, no una validación de la cuenta de Afiliados. No hay consultas a Amazon, expansión de enlaces cortos ni importación automática de imágenes, precios o disponibilidad. Los datos se guardan en los campos existentes de PostgreSQL y conservan la protección frente a ediciones simultáneas.



## Borradores semanales

La tarea del lunes entrega sus ideas directamente en PostgreSQL mediante POST /api/weekly-drafts. Consulta WEEKLY-DRAFTS.md para el contrato y la verificación. Los reintentos no duplican ni sobrescriben pines. Las ideas pueden guardarse sin producto, ASIN o imagen, con sus pendientes en Notas. La integración API de OpenAI se ha retirado de la interfaz, del servidor y de Docker.

