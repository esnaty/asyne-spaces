# Viabilidad de integraciones

Validado el 15 de septiembre de 2026.

## Pinterest

La API v5 permite crear, consultar, actualizar y eliminar pines, además de consultar y crear estructuras de tableros según el nivel de acceso de la aplicación. La primera integración debe probarse en Sandbox y después solicitar acceso de producción. La compatibilidad exacta de borradores, programación y etiquetado de productos debe validarse con la cuenta comercial; el MVP conservará esos pasos como acciones asistidas si la API no los expone.

- https://developers.pinterest.com/docs/developer-tools/sandbox/
- https://developers.pinterest.com/docs/work-with-organic-content-and-users/create-boards-and-pins/

## Amazon Afiliados

La integración nueva debe usar Creators API. PA-API 5 está obsoleta. Creators API ofrece búsqueda, consulta por ASIN, variaciones, imágenes y enlaces de detalle con el Partner Tag. Usa OAuth 2.0 y requiere una cuenta de Afiliados aceptada, credenciales de Creators API y un Partner Tag válido para Amazon España.

- https://affiliate-program.amazon.com/creatorsapi/docs/en-us/api-reference
- https://affiliate-program.amazon.com/creatorsapi/docs/en-us/onboarding/register-for-creators-api
- https://affiliate-program.amazon.com/creatorsapi/docs/en-us/migrating-to-creatorsapi-from-paapi

## Picsart

La automatización depende de que el plan contratado exponga generación con imagen de referencia mediante API. Hasta confirmar esa capacidad y sus límites, el conector debe implementarse como adaptador: API cuando esté disponible y flujo asistido en Playground cuando no lo esté.

## OpenAI

Puede generar textos, analizar semejanza visual y producir o editar imágenes a partir de entradas visuales. Se utilizará como control editorial y como generador de respaldo únicamente cuando el usuario lo autorice.

- https://platform.openai.com/docs/api-reference/images

## Arquitectura recomendada

- Interfaz: Next.js o React.
- API y trabajos: Node.js/TypeScript.
- Datos: PostgreSQL con almacenamiento de objetos compatible con S3.
- Cola: trabajos idempotentes por pin con reintentos y registro de auditoría.
- Secretos: solo en servidor, cifrados y separados por proveedor.
- Estados: propuesta, producto validado, generado, control aprobado, borrador preparado, aprobado por usuario y publicado.
- Regla de seguridad: publicar requiere una acción humana explícita y registra quién aprobó, cuándo y qué versión del pin.
