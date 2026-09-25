# Vóley Amateur — API

Backend independiente para organizar equipos y partidos: NestJS y PostgreSQL con Prisma. El frontend Next.js se encuentra en [Voley-amateur](https://github.com/BanderaMatias/Voley-amateur). No incluye credenciales ni datos personales de producción.

## Funcionalidades implementadas

- Registro/login con Google Identity Services: ID token validado en servidor, nonce, sesiones opacas con cookie HttpOnly y validación de origen en escrituras. Identidad por Google `sub`.
- Equipos múltiples por jugador; líder por equipo; inscripción a torneos creados exclusivamente por un administrador.
- Reclutamiento, notificaciones internas para todos los jugadores con alertas habilitadas, postulaciones y aceptación/rechazo por el líder.
- Partidos recreativos, amistosos y de torneo. Públicos para usuarios registrados o privados para miembros/invitados.
- Convocatorias, respuestas, cupos con transacciones serializables y lista de espera; promoción cuando alguien se baja.
- Precio total en centavos, reparto exacto entre confirmados y costo fijado al cerrar inscripción. Precio desconocido distinto de cancha gratuita.
- Perfiles deportivos y valoraciones de ataque, recepción, defensa y salto (1–5). Solo entre jugadores con asistencia registrada en un mismo partido finalizado; sin autoevaluación.
- Panel administrativo para torneos, correspondencias de equipos de Podio e importaciones.
- Notificaciones dentro de la aplicación, con consulta cada 30 segundos; detalle de partido actualizado cada 20 segundos. No incluye email, push ni WebSockets.

## Mejoras de comunidad

- Recordatorios a 24 y 2 horas, solicitudes de respuesta y avisos de cambios, dentro de la app.
- Detección de superposiciones de horario con confirmación explícita; la lista de espera evita promociones con conflictos.
- Búsqueda de reemplazos por zona, posición, días y horario configurables. El organizador acepta la postulación y el jugador confirma su lugar.
- Invitados sin cuenta, incluidos en cupos, asistencia y costos; vinculación posterior con consentimiento del jugador.
- Series de 2 a 52 partidos semanales y cancelación de encuentros futuros.
- Registro de pagos declarados y confirmación del organizador, alias de transferencia y reparto exacto fijado al cerrar. No procesa dinero.
- Equipos equilibrados para recreativos según posiciones y habilidades, con ajuste manual. Con menos de tres evaluadores se usa el nivel declarado.
- Resultados por sets, historial personal y por equipo, y asistencia registrada.
- Suscripción de calendario ICS mediante un enlace privado revocable. Quien tenga el enlace puede leer el calendario: regenerarlo invalida el anterior.
- Bloqueos, denuncias de usuarios o valoraciones y moderación administrativa con suspensión y restauración.

Para recordatorios, activar `JOBS_CRON_ENABLED=true` en una API siempre encendida, o llamar `POST /jobs/run` cada 15 minutos con `Authorization: Bearer <JOBS_CRON_SECRET>` (mínimo 32 caracteres). Usar un solo mecanismo. Administración permite ejecutar una revisión manual.

`PODIO_WATCH_ENABLED=true` revisa nuevas versiones del PDF cada seis horas y avisa al administrador. Las importaciones aprobadas que cambian hora/cancha avisan a los convocados y dejan historial. Los cambios de día requieren reprogramación explícita desde Administración antes de aprobar nuevamente la importación. La limitación del parser real indicada debajo sigue vigente.

## Requisitos

Node.js 22+, npm, Docker (o PostgreSQL 16+) y `pdftotext` de Poppler para importar PDFs. En Debian/Ubuntu: `apt-get install poppler-utils`. El Dockerfile de la API ya lo incluye.

## Desarrollo local

```bash
cp .env.example .env
# Completar GOOGLE_CLIENT_ID.
docker compose up -d
npm ci
npm run db:generate
npm run db:deploy
npm run dev
```

API: http://localhost:4000. Se carga `.env` desde la raíz de este repositorio. El comando `dev` genera Prisma, compila y arranca el servidor; para recompilación continua ejecutar también `npm run watch` en otra terminal.

Clonar el frontend por separado y seguir su README. Configurar allí `API_INTERNAL_URL=http://localhost:4000` y el mismo cliente Google. Next.js reenvía `/api/*` a esta API: el navegador sigue usando el origen del frontend, incluida la cookie de sesión. `WEB_ORIGIN` debe coincidir con ese origen.

Las migraciones se trasladaron sin cambios. Si ya existe una base de datos, mantener `DATABASE_URL` y ejecutar `npm run db:deploy`; no reiniciar ni recrear la base. El código se extrajo de `Voley-amateur` en el commit `8c1e7a18b5b6e480d19dc941efb8db8f665b7d28`; el historial anterior permanece en ese repositorio.

`package-lock.json` se generó en GitHub Actions y fija las dependencias verificadas. Usar `npm ci` para reproducir la instalación. Los overrides de `deepmerge-ts` y `effect` actualizan dependencias transitivas de Prisma afectadas por GHSA-ggr8-5vv4-36mx y GHSA-38f7-945m-qr2g; CI comprueba generación del cliente, migración y auditoría.

## Google y primer administrador

1. Crear un cliente OAuth de tipo aplicación web en Google Cloud.
2. Configurar los orígenes JavaScript autorizados: `http://localhost:3000` y el dominio HTTPS de producción. Esta implementación usa el botón GIS y callback JavaScript, no una ruta OAuth de redirección.
3. Configurar el mismo ID en `GOOGLE_CLIENT_ID` (API) y `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (web). No requiere un client secret.
4. En producción, `WEB_ORIGIN` debe ser el origen exacto del frontend, sin barra final. Solo HTTPS para que la cookie Secure funcione.
5. Para el primer administrador, configurar `ADMIN_GOOGLE_SUB` antes del primer login, o ingresar una vez y usar `npm run db:studio` para marcar `admin=true` al usuario correcto. No se asigna automáticamente al primer visitante.

No usar credenciales de pruebas como credenciales reales. Las pruebas de integración crean sesiones directamente en su base aislada; no existe endpoint de login alternativo ni bypass de autenticación.

## Podio: estado y activación

El importador descubre el enlace titulado “Próximos Partidos por Cancha”, sigue frames, restringe URLs/redirecciones a los hosts HTTPS de Podio y acepta PDFs de hasta 15 MB. `PODIO_PDF_URL` permite configurar un enlace verificado si cambia la página.

Guarda el PDF binario, su hash, el texto con diseño preservado, propuestas y estado en PostgreSQL. Un PDF repetido no vuelve a descargarse a la base. El precio queda sin definir; el líder lo completa y abre la convocatoria.

**Limitación pendiente de validación real:** no fue posible descargar el PDF actual de Podio durante la implementación. El parser es conservador y está probado únicamente con un fixture sintético: fecha, hora, local, visitante, código de cancha y categoría, separados por columnas o `|`, con directorio `CANCHA código: dirección` al final. No se afirma compatibilidad con el formato actual de Podio.

Por eso `PODIO_AUTO_IMPORT=false` de forma predeterminada. El administrador revisa el texto y corrige las propuestas JSON antes de importarlas. Para habilitar creación automática:

1. Crear el torneo con origen PODIO e inscribir los equipos.
2. Vincular nombre externo y categoría desde Administración. Desvincular registros de temporadas anteriores que causen ambigüedad.
3. Descargar una programación real, adaptar `podio-parser.mjs` a sus columnas y agregar ese PDF/texto como fixture sin datos innecesarios.
4. Confirmar que fecha, hora y dirección coinciden con el directorio al final del PDF.
5. Activar `PODIO_AUTO_IMPORT=true` y programar el proceso.

El cron interno (`PODIO_CRON_ENABLED=true`) corre los lunes a las 13:00, con reintentos a las 16:00 y 19:00, zona `America/Argentina/Buenos_Aires`. Requiere una API siempre activa. Alternativa para servidores que se suspenden: un cron externo cada lunes a las **16:00 UTC**, que llame `POST /podio/cron` con `Authorization: Bearer <PODIO_CRON_SECRET>`; el secreto debe tener al menos 32 caracteres. No ejecutar ambos esquemas a la vez. No se ha activado ningún scheduler externo con este repositorio.

Identidad de partido importado: inscripción + día local + rival. Una nueva versión del PDF actualiza hora/cancha conservando convocatoria y precio. Cambios de día, dos encuentros ante el mismo rival el mismo día, equipos ambiguos, cancelaciones o equipos ausentes del siguiente PDF requieren revisión manual: el importador no cancela por ausencia ni intenta adivinar reprogramaciones.

## Verificación

```bash
npm test
npm run typecheck
npm run build
```

CI ejecuta migración sobre PostgreSQL vacío, tests de dominio, builds e integración HTTP de permisos, privacidad, reclutamiento, cupos concurrentes y valoraciones. Las pruebas de integración requieren una base **descartable**, la API arrancada y las variables del workflow; no ejecutarlas contra producción.

Validación ejecutada: instalación, auditoría de dependencias, generación y validación de Prisma, ambas migraciones sobre PostgreSQL vacío, 12 tests de dominio, compilación de API y frontend anterior a la separación y las dos suites de integración HTTP. Estas cubren permisos, privacidad, concurrencia, invitados, pagos, series, agenda, reemplazos, calendario revocable, moderación y actualizaciones de Podio con datos sintéticos. [Ejecución verificada](https://github.com/BanderaMatias/Voley-amateur/actions/runs/36057506404). No se verificaron login real de Google ni un PDF real de Podio.

## Despliegue

- PostgreSQL: configurar `DATABASE_URL` y ejecutar `npm run db:deploy` (nunca `db push` en producción).
- API: `Dockerfile`, contexto en la raíz de este repositorio. Configurar variables de `.env.example` en el proveedor y usar `/health` como healthcheck.
- Frontend: repositorio `Voley-amateur`, Vercel con raíz `apps/web`, `API_INTERNAL_URL` apuntando a la API y `NEXT_PUBLIC_GOOGLE_CLIENT_ID`. Configurar `WEB_ORIGIN` en la API con el dominio final.
- No hay despliegue automático configurado. El workflow valida código, no publica la aplicación.

## Organización

- `src`: autenticación, API, dominio e importador.
- `prisma`: esquema y migraciones.
- `tests`: dominio y pruebas HTTP con PostgreSQL.
- `docs/API.md`: rutas y permisos.

Las inscripciones a torneos son registros internos de esta aplicación: no inscriben ni pagan en la organización externa. Los montos son reparto informativo, no una integración de cobros. Los partidos privados requieren sesión y acceso explícito. La excepción es el calendario ICS: su enlace secreto autoriza únicamente la lectura de ese calendario.

Para un despliegue Node sin Docker: build `npm ci && npm run build`, migraciones `npm run db:deploy` y arranque `npm start`. El host debe tener Poppler (`pdftotext`) y OpenSSL; el Dockerfile ya los instala. La CI independiente valida esta API con PostgreSQL y sus pruebas HTTP.
