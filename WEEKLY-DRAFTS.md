# Entrega semanal en AsyneStudio

Destino: PostgreSQL local mediante la API de AsyneStudio. No generar un manifiesto como entrega ni crear borradores en Pinterest.

1. Desde esta carpeta comprobar `docker compose ps`; iniciar `docker compose up -d` si hace falta. No borrar volúmenes. Comprobar `GET http://localhost:5180/api/health`.
2. Consultar `/api/collections` y `/api/pins` para evitar repeticiones. Preparar dos colecciones de 5–8 pines, manteniendo las instrucciones editoriales de la automatización.
3. Preparar un prompt de escena inicial por subtablero y descargar las fotos reales de los productos disponibles en `public/media/` con nombres únicos. Se sirven como `/media/nombre.png` sin recompilar Docker. No generar imágenes ni consumir créditos en este flujo. El prompt debe identificar productos y referencias por ASIN, exigir fidelidad y detener la generación si faltan fotos. No referenciar archivos temporales o rutas del escritorio en la base de datos.
4. Enviar un POST JSON a `http://localhost:5180/api/weekly-drafts` por colección. El cuerpo se transmite directamente; no requiere un archivo manifest:

```json
{
  "batchKey": "2026-09-21-entrada",
  "collection": {
    "name": "Entrada acogedora · 21 septiembre",
    "boardName": "",
    "prompt": "Escena vertical 2:3 de una entrada. Usar las fotos reales adjuntas de los productos seleccionados; conservar forma, color, material y proporciones. Si faltan referencias, pedirlas antes de generar.",
    "referenceImages": []
  },
  "pins": [{
    "key": "01-banco",
    "title": "Una entrada para llegar con calma",
    "description": "Texto propuesto para revisar",
    "product": "",
    "asin": "",
    "affiliateUrl": "",
    "image": "",
    "alt": "",
    "board": "Entradas acogedoras",
    "notes": "Idea visual: banco y cestas. Pendiente seleccionar producto y generar imagen."
  }]
}
```

Los valores del ejemplo no son datos reales. Completar con investigación y contenido del lote. No inventar ASIN, enlaces afiliados, disponibilidad ni imágenes. Si no se puede completar algún paso externo, conservar la idea en estado borrador con campos vacíos y pendientes en notes. Guardar también en notes las referencias y las relaciones con el board de Picsart y la lista de Amazon que existan realmente.

Cada referencia tiene `{ "name": "nombre real", "image": "/media/archivo.png", "asin": "ASIN verificado", "sourceUrl": "URL real de Amazon España" }`. Máximo 16 referencias PNG/JPEG/WebP por subtablero. `boardName` es el tablero padre verificado; dejar vacío si aún no se conoce. `prompt` admite hasta 12000 caracteres. Los reintentos no modifican el subtablero existente. Para editarlo, GET /api/collections y PATCH /api/collections/:id con version, name, boardName, prompt y referenceImages; no sobrescribir revisiones humanas.

La interfaz separa ideas de pines publicados por estado local y organiza ambos por tablero y subtablero. Esto no sincroniza automáticamente Pinterest. Cada subtablero permite editar/copiar el prompt y subir fotos locales; guardar el subtablero conserva sus asociaciones en PostgreSQL.

Cada batchKey identifica la fecha del lunes y la colección. Cada key identifica de forma estable la pieza, sin cambiarla al reintentar. La API crea siempre con estado draft, sin fecha programada. Si una clave ya existe, devuelve su id y no cambia el contenido ni el estado (protege las revisiones humanas). Nunca usar claves nuevas solo para sortear un reintento. Para completar posteriormente un borrador existente, consultar su versión actual y usar PATCH /api/pins/:id para campos editoriales; las imágenes iniciales deben estar guardadas antes del POST. No sobrescribir el trabajo del usuario.

5. Verificar los IDs devueltos consultando `/api/pins`, las dos colecciones y la existencia/acceso de cada imagen. Informar solo tras confirmar la persistencia. Si Docker o la base de datos no están accesibles, informar del bloqueo; no afirmar que se guardaron ni volver al manifiesto como entrega.

La aplicación no llama a la API de OpenAI. La tarea prepara el contenido desde Codex con sus herramientas disponibles. La ejecución local depende de que el ordenador y Docker estén disponibles.

## Pin base y pines derivados
Cada subtablero nuevo contiene un pin base adicional (`kind: "base"`, key estable `00-base`) y un pin por producto (`kind: "product"`). Cada pin incluye su propio `prompt` editable (máximo 12000 caracteres). El prompt del pin base describe el conjunto y parte del prompt inicial de la colección. Los prompts de producto usan DOS referencias: imagen base generada para ambiente/continuidad y foto original de Amazon para fidelidad del objeto. Especificar encuadre, foco y detalles a preservar por producto. Si la base aún no existe, indicarlo como pendiente; no fingir que está adjunta. Generar primero el conjunto, luego sus derivados. Con 5 productos son 6 pines. Mantener draft, sin generar ni gastar créditos. No modificar lotes publicados para aplicar retroactivamente esta estructura.

## Textos alternativos y calendario editorial
Codex rellena alt y fecha/hora previstas. Describe la imagen final tras verla; si aún falta, deja un texto propuesto coherente con el prompt y marca en notes que necesita revisión con la imagen final. Revisa los borradores con imágenes nuevas en cada ejecución. Asigna fechas futuras orientativas (Europe/Madrid) a los borradores con PATCH /api/pins/:id, primero el conjunto y luego un producto por día, evitando solapamientos con fechas ya asignadas. Mantén draft: son previsiones locales, no programación en Pinterest. No inventes fechas para lotes ya publicados/programados externamente ni sobrescribas fechas elegidas por el usuario. El tablero padre lo asigna el usuario en el subtablero; no rellenar board en cada pin. Mantén los prompts individuales breves: usar imagen principal, enfocarse en el producto, conservar ambiente e iluminación.
