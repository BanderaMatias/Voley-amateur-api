# API

Las rutas se sirven en la API sin prefijo y en el frontend mediante `/api`. Todas salvo salud, nonce, login y tareas con secreto o calendario con token requieren sesión. Escrituras requieren `Origin` igual a `WEB_ORIGIN`. No se aceptan roles enviados por el navegador.

| Método y ruta | Permiso / función |
|---|---|
| GET /health | Estado del proceso |
| GET /auth/nonce | Nonce temporal para GIS |
| POST /auth/google | Valida Google y crea cookie de sesión |
| POST /auth/logout | Revoca sesión |
| GET, PATCH /me | Perfil propio |
| GET /players?q= | Directorio autenticado, hasta 50 resultados |
| GET /players/:id | Perfil y promedio de habilidades |
| POST /players/:id/ratings | Asistencia compartida, valores 1–5 |
| GET, POST /teams | Mis equipos / crear equipo con líder |
| PATCH /teams/:id | Editar como líder |
| GET, POST /tournaments | Listar / crear como administrador |
| POST /teams/:id/tournaments | Inscripción interna como líder |
| GET /registrations | Administrador |
| PATCH /registrations/:id | Administrador: externalName y division |
| GET /recruitments | Búsquedas abiertas |
| POST /teams/:id/recruitments | Líder; fan-out de notificaciones |
| PATCH /recruitments/:id/close | Líder |
| POST /recruitments/:id/apply | Jugador no miembro |
| GET /teams/:id/applications | Líder |
| POST /recruitments/:id/applications/:userId | Líder; `{accept: boolean}` |
| GET, POST /matches | Partidos visibles / crear |
| GET /matches/:id | Acceso validado también por ID |
| PATCH /matches/:id/price | Organizador; inscripción abierta |
| POST /matches/:id/call-up | Organizador; `{userIds: []}` suma el equipo |
| POST /matches/:id/respond | CONFIRMED, REJECTED o MAYBE |
| POST /matches/:id/status | Organizador; CLOSED, CANCELLED o COMPLETED y attendedIds |
| GET /notifications | Últimas 100 propias |
| PATCH /notifications/:id/read | Solo destinatario |
| POST /podio/cron | Secreto de integración, no sesión de usuario |
| POST /podio/download | Administrador |
| GET /podio/imports | Administrador: últimas 10 |
| POST /podio/imports/:id/approve | Administrador: candidates revisados |

Los IDs internos se validan mediante existencia/pertenencia, no por confianza en el cliente. Todos los montos se almacenan como centavos enteros. Fechas de creación en ISO 8601 con offset; la UI ingresa horario argentino. El cierre congela el reparto entre confirmados. Finalizar registra asistencia; no modifica costos ya congelados.

## Comunidad

| Método y ruta | Permiso / función |
|---|---|
| GET, POST /series | Organizador: series semanales |
| POST /series/:id/stop | Organizador: cancelar futuras fechas |
| GET /matches/:id/conflicts | Conflictos propios; confirmar con allowConflict |
| POST /matches/:id/guests | Organizador: agregar invitado sin cuenta |
| POST /matches/:id/guests/:guestId/remove | Organizador: retirar invitado |
| POST /matches/:id/guests/:guestId/invite | Organizador: proponer vinculación |
| POST /matches/:id/guests/:guestId/claim | Jugador invitado: aceptar vinculación |
| PATCH /matches/:id/payment-alias | Organizador |
| GET /matches/:id/payments | Organizador: todos; confirmado: propio |
| POST /matches/:id/payments/:payerKey | Jugador declara propio pago; organizador confirma |
| POST, PATCH /matches/:id/balance | Organizador: propuesta o distribución manual |
| PATCH /matches/:id/result | Organizador: sets de partido finalizado |
| GET /history?teamId= | Propio o equipo del que se es miembro |
| PATCH /me/replacements | Preferencias de avisos de reemplazos |
| GET /replacements | Búsquedas abiertas sin dirección privada |
| POST /replacements/:id/apply | Postulación |
| GET, POST /matches/:id/replacement | Organizador: ver o abrir búsqueda |
| GET /me/ratings | Valoraciones recibidas para denunciar abusos |
| GET /blocks | Bloqueos propios |
| POST /players/:id/block | Bloquear/desbloquear |
| POST /players/:id/report | Denunciar usuario o valoración recibida |
| GET /reports | Administrador |
| POST /reports/:id/resolve | Administrador: resolver denuncia |
| POST /players/:id/restore | Administrador: restaurar usuario |
| POST /me/calendar | Generar o revocar token de lectura ICS |
| GET /calendar/:token.ics | Token secreto, sin cookie; no permite escrituras |
| POST /jobs/run | Secreto JOBS_CRON_SECRET |
| POST /ops/run-reminders | Administrador |
| GET /matches/:id/changes | Historial, con acceso al partido |
| GET /podio/matches | Administrador |
| POST /podio/matches/:id/reschedule | Administrador: reprogramar conservando convocatoria |

Los invitados activos sin cuenta vinculada también ocupan cupo y participan del reparto. Finalizar permite `attendedGuestIds`. Las tareas tienen claves de deduplicación para avisos repetidos. Los bloqueos limitan nuevas interacciones; no borran historia ni pagos.
