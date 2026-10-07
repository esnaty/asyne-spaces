# Respaldo de AsyneStudio — 7 de octubre de 2026

Repositorio: esnaty/asyne-spaces.

Incluye código de AsyneStudio, configuración de Docker, pruebas, imágenes de pines y referencias en public/media, y la web informativa y política de privacidad en public-site.

No incluye .env, claves, tokens, dependencias instaladas ni volúmenes de Docker. Docker no estaba disponible al preparar esta copia: NO contiene una exportación actual de PostgreSQL. Los borradores, prompts editados, enlaces de afiliado, fechas y estados almacenados únicamente en la base de datos necesitan un respaldo adicional del volumen o una exportación editorial. Los datos iniciales del código no sustituyen esos datos actuales.

Restauración del código: clonar el repositorio, crear .env siguiendo README.md y ejecutar docker compose up -d --build. Una base nueva solo carga los datos iniciales incluidos en el código.

La programación de la tarea semanal de Codex pertenece al entorno local y no se restaura al clonar. WEEKLY-DRAFTS.md conserva las instrucciones del flujo editorial.
