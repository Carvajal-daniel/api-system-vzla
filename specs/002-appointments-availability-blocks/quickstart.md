# Quickstart & Validation Guide: Etapa 3 — Motor de Agendamientos, Disponibilidad y Bloqueios

**Feature**: `002-appointments-availability-blocks`  
**Related Artifacts**: [spec.md](spec.md) · [data-model.md](data-model.md) · [contracts/openapi.yaml](contracts/openapi.yaml)

## 1. Prerrequisitos

- Node.js + Yarn instalados y dependencias sincronizadas (`yarn install`).
- Archivo `.env` con `DATABASE_URL` (NeonDB/PostgreSQL) y `JWT_SECRET` configurados para ejecución del servidor o aplicación de migraciones.

## 2. Comandos de Verificación

```bash
# Verificación estricta de TypeScript (debe pasar con 0 errores)
npx tsc --noEmit

# Ejecutar toda la suite de pruebas (unitarias de dominio, casos de uso e integración HTTP)
yarn test

# Ejecutar solo las pruebas del módulo de agendamientos y capa HTTP
npx vitest run src/modules/appointments src/shared/http/__tests__/appointments.http.spec.ts

# Levantar el servidor en desarrollo y verificar Swagger UI en http://localhost:3333/docs
yarn dev
```

## 3. Escenarios de Validación End-to-End

1. **Bloqueos y citas afectadas (`ScheduleBlock`)**:
   - `OWNER` crea bloqueo global (`POST /schedule-blocks` con `collaboratorId: null`) y bloqueo individual.
   - `COLLABORATOR` crea bloqueo personal (`POST /me/schedule-blocks`) en una franja con cita `CONFIRMED`: responde `201` con `block` + `affectedAppointments` conteniendo la cita impactada y dispara `AbsenceNotificationPort`.
   - `COLLABORATOR` intenta acceder a `POST /schedule-blocks` o borrar un bloqueo de otro colaborador → `403` / `404`.
2. **Disponibilidad real (`GET /public/companies/:companyId/availability`)**:
   - Consulta con `serviceId` + `date` (sin `collaboratorId` y con `collaboratorId`): devuelve slots cada `15` min respetando `companies.timezone` (`America/Caracas`), excluyendo descansos, bloqueos individuales/globales, citas `PENDING`/`CONFIRMED` y horarios pasados.
   - Tras cancelar una cita (`CANCELED`) o marcar `NO_SHOW`, el slot reaparece inmediatamente.
3. **Creación pública y de `OWNER` + validación estricta + anti double-booking**:
   - `POST /public/companies/:companyId/appointments` crea cita en estado `PENDING`, calcula `endsAt` en backend y persiste snapshots inmutables de nombre, precio, duración y comisión.
   - `POST /appointments` como `OWNER` permite `initialStatus: "CONFIRMED"` (o `PENDING` por defecto); como `COLLABORATOR` responde `403`.
   - Intentos directos en horario fuera de jornada, en descanso, en bloqueo o en el pasado son rechazados con `400` sin depender de haber consultado `/availability`.
   - Dos peticiones concurrentes (`Promise.all`) para el mismo colaborador y horario solapado resultan en una respuesta `201` y una `409`.
4. **Ciclo de vida y reprogramación**:
   - `PATCH /appointments/:appointmentId/status` aplica transiciones válidas (`PENDING → CONFIRMED/CANCELED`, `CONFIRMED → COMPLETED/CANCELED/NO_SHOW`) y rechaza transiciones inválidas o desde estados terminales con `409`.
   - `PATCH /appointments/:appointmentId/reschedule` (solo `OWNER`) mueve una cita activa excluyendo su propio `id` del chequeo de solapamiento y validando disponibilidad + lock atómico.
5. **Aislamiento Multi-Tenant y Swagger**:
   - Un `OWNER` de la empresa A no puede ver, cambiar estado, reprogramar ni borrar bloqueos/citas de la empresa B.
   - `/docs/json` expone todas las rutas de la Etapa 3 con esquemas completos y `bearerAuth` en rutas protegidas.
