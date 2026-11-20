---
description: "Task list for Etapa 3: Motor de Agendamientos, Disponibilidad y Bloqueios de Horario"
---

# Tasks: Etapa 3 — Motor de Agendamientos, Disponibilidad y Bloqueios de Horario

**Input**: Design documents from `/specs/002-appointments-availability-blocks/`  
**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/openapi.yaml](contracts/openapi.yaml), [quickstart.md](quickstart.md)

**Organization**: Estructurado estrictamente en **3 fases secuenciales obligatorias** conforme al Principio V de la Constitución (`domain/` → `application/` + tests → `infra/` + migración `0004` + Swagger + tests HTTP), con trazabilidad por historia de usuario (`[US1]`–`[US4]`) y compuerta de calidad obligatoria (`npx tsc --noEmit` + `vitest`) al cierre de cada fase.

## Format: `- [ ] [TaskID] [P?] [Story?] Description with file path`

- **[P]**: Puede ejecutarse en paralelo (archivos distintos, sin dependencia de tareas incompletas).
- **[Story]**: Traza la tarea a su User Story en `spec.md` (`[US1]` Bloqueos, `[US2]` Disponibilidad, `[US3]` Creación pública/OWNER y anti double-booking, `[US4]` Gestión interna, status y reprogramación).

---

## Fase 1: Capa `domain/` + Tests Unitarios de Dominio (Núcleo Puro, sin Infra)

**Purpose**: Construir todas las entidades, Value Objects, utilidades puras de zona horaria multi-país, motor de disponibilidad/validación, errores de dominio y contratos de repositorio en TypeScript 100% puro, cerrando con tests unitarios en verde antes de tocar `application/` o `infra/`.

### Núcleo transversal y soporte multi-país (Brasil y Venezuela)

- [x] T001 [P] Crear los errores tipados de dominio (`VALIDATION`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`) extendiendo `DomainError` en `src/modules/appointments/domain/errors/appointment-errors.ts`
- [x] T002 [P] Implementar utilidad pura de zona horaria IANA basada en `Intl.DateTimeFormat` (`isValidIanaTimeZone`, `assertValidIanaTimeZone`, conversión local `YYYY-MM-DD`/`HH:MM` ↔ UTC, `dayOfWeek` local) soportando Brasil (`America/Sao_Paulo`, `America/Fortaleza`), Venezuela (`America/Caracas`) y cualquier IANA válida en `src/modules/appointments/domain/services/timezone-utils.ts` (cita `data-model.md`: `Company.timezone`)
- [x] T003 [P] Revisar y robustecer el Value Object `Phone` en `src/shared/value-objects/phone.value-object.ts` para normalizar espacios/guiones/paréntesis y validar compatibilidad con formatos E.164 de Brasil (`+55`) y Venezuela (`+58`) manteniendo compatibilidad con los módulos existentes, y crear `ClientContact` VO en `src/modules/appointments/domain/value-objects/client-contact.vo.ts` (cita `data-model.md`: `Appointment.client_name`, `Appointment.client_phone`)
- [x] T004 [P] Implementar Value Object `TimeRange` (`endsAt > startsAt`, `overlaps()` sin colisión en intervalos adyacentes) en `src/modules/appointments/domain/value-objects/time-range.vo.ts` (cita `data-model.md`: `ScheduleBlock.starts_at`, `ScheduleBlock.ends_at`, `Appointment.starts_at`, `Appointment.ends_at`)
- [x] T005 [P] Implementar Value Object `AppointmentStatus` y máquina de estados estricta (`PENDING → CONFIRMED|CANCELED`, `CONFIRMED → COMPLETED|CANCELED|NO_SHOW`, estados terminales, `blocksAvailability()`) en `src/modules/appointments/domain/value-objects/appointment-status.vo.ts` (cita `data-model.md`: `Appointment.status`)

### Entidades, Motor de Disponibilidad y Puertos de Dominio

- [x] T006 [P] [US1] Implementar entidad `ScheduleBlock` (alcance por colaborador o global `collaboratorId: null`, motivo opcional y `TimeRange`) en `src/modules/appointments/domain/entities/schedule-block.entity.ts` (cita `data-model.md`: `ScheduleBlock.company_id`, `ScheduleBlock.collaborator_id`, `ScheduleBlock.starts_at`, `ScheduleBlock.ends_at`, `ScheduleBlock.reason`)
- [x] T007 [P] [US3] Implementar entidad `Appointment` con derivación obligatoria de `endsAt = startsAt + serviceDurationMinutes` en backend, estado inicial permitido (`PENDING` o `CONFIRMED`), snapshots inmutables y métodos `transitionStatus()` / `reschedule()` en `src/modules/appointments/domain/entities/appointment.entity.ts` (cita `data-model.md`: `Appointment.company_id`, `Appointment.collaborator_id`, `Appointment.service_id`, `Appointment.starts_at`, `Appointment.ends_at`, `Appointment.status`, `Appointment.cancellation_reason`, `Appointment.service_name_snapshot`, `Appointment.service_price_in_cents_snapshot`, `Appointment.service_duration_minutes_snapshot`, `Appointment.commission_percentage_snapshot`)
- [x] T008 [US2] Implementar servicio puro `AvailabilityCalculator` en `src/modules/appointments/domain/services/availability-calculator.ts` con: (a) generación de slots cada `15` minutos respetando `timezone` IANA, `work_schedules`, descansos, `schedule_blocks` individuales/globales, citas activas (`PENDING`/`CONFIRMED`), liberación por `CANCELED`/`NO_SHOW` y exclusión de pasado; y (b) `validateSlotAvailability()` para validar integralmente cualquier reserva/reprogramación sin asumir consulta previa a `/availability` (depende de T002, T004, T005)
- [x] T009 [P] [US1] Definir contrato de repositorio `ScheduleBlocksRepository` en `src/modules/appointments/domain/repositories/schedule-blocks.repository.ts`
- [x] T010 [P] [US3] Definir contrato de repositorio `AppointmentsRepository` (incluyendo operaciones atómicas `createWithLock` y `rescheduleWithLock` con exclusión del propio `appointmentId` y búsqueda de citas afectadas por bloqueo) en `src/modules/appointments/domain/repositories/appointments.repository.ts`
- [x] T011 [P] [US2] Definir contrato `SchedulingContextLookupRepository` (lectura multi-tenant de empresa activa + `timezone`, servicio activo, colaborador(es) activos habilitados en `collaborator_services` con comisión y `work_schedules`) en `src/modules/appointments/domain/repositories/scheduling-context-lookup.repository.ts`

### Tests Unitarios de Fase 1 y Compuerta de Calidad

- [x] T012 [P] Crear tests unitarios de `TimeRange`, `AppointmentStatus` (matriz completa de transiciones válidas e inválidas), `Phone` E.164 (`+55` Brasil y `+58` Venezuela) y `timezone-utils` (`America/Sao_Paulo`, `America/Fortaleza`, `America/Caracas`, IANA inválida) en `src/modules/appointments/domain/__tests__/time-range-and-status.spec.ts`
- [x] T013 [P] [US2] Crear tests unitarios de `AvailabilityCalculator` (cruce de medianoche UTC en Brasil y Venezuela, descansos, bloqueos parciales/globales/multidía, liberación por `CANCELED`/`NO_SHOW`, horarios en el pasado, servicio mayor al tramo libre y `validateSlotAvailability`) en `src/modules/appointments/domain/__tests__/availability-calculator.spec.ts`
- [x] T014 **Compuerta Fase 1**: Ejecutar `npx tsc --noEmit` y `npx vitest run src/modules/appointments/domain` y verificar 100% en verde antes de iniciar Fase 2

**Checkpoint Fase 1**: Núcleo de dominio completo, libre de infraestructura y 100% probado en Vitest.

---

## Fase 2: Capa `application/` + `InMemoryRepositories` + Tests Unitarios

**Purpose**: Implementar todos los casos de uso, DTOs y puertos de aplicación, verificando reglas de negocio, multi-tenancy, RBAC, snapshots inmutables, `affectedAppointments` y prevención concurrente de double-booking mediante `InMemoryRepositories` antes de tocar Drizzle o Fastify.

### DTOs y Puertos de Aplicación

- [x] T015 [P] [US1] Crear DTOs de bloqueos de horario (incluyendo `CreateScheduleBlockOutputDTO` con `{ block, affectedAppointments }`) en `src/modules/appointments/application/dtos/schedule-block.dtos.ts`
- [x] T016 [P] [US2] Crear DTOs de consulta de disponibilidad en `src/modules/appointments/application/dtos/availability.dtos.ts`
- [x] T017 [P] [US3] Crear DTOs de creación (pública y `OWNER`), listado, actualización de status y reprogramación de agendamientos en `src/modules/appointments/application/dtos/appointment.dtos.ts`
- [x] T018 [P] [US1] Definir puerto desacoplado `AbsenceNotificationPort` (preparado para Etapa 5 WhatsApp) en `src/modules/appointments/application/ports/absence-notification.port.ts`

### Casos de Uso (1 clase por acción de negocio)

- [x] T019 [US1] Implementar `CreateScheduleBlockUseCase` (permisos `OWNER` global/colaborador y `COLLABORATOR` solo propio; permite creación con citas activas solapadas, retorna `affectedAppointments` e invoca `AbsenceNotificationPort`) en `src/modules/appointments/application/use-cases/create-schedule-block.use-case.ts`
- [x] T020 [P] [US1] Implementar `ListScheduleBlocksUseCase` y `DeleteScheduleBlockUseCase` respetando aislamiento por `companyId` y permisos `OWNER` vs `COLLABORATOR` en `src/modules/appointments/application/use-cases/list-schedule-blocks.use-case.ts` y `src/modules/appointments/application/use-cases/delete-schedule-block.use-case.ts`
- [x] T021 [US2] Implementar `GetAvailabilityUseCase` (soporta `collaboratorId` específico o "cualquier colaborador habilitado", validando empresa activa, servicio activo y `timezone` IANA de empresa o parámetro) en `src/modules/appointments/application/use-cases/get-availability.use-case.ts`
- [x] T022 [US3] Implementar `CreateAppointmentUseCase` soportando canal público (`PENDING` obligatorio) y canal `OWNER` (`PENDING` por defecto o `CONFIRMED`; prohíbe `COLLABORATOR`), validando integralmente en dominio futuro + `work_schedules` + descansos + `schedule_blocks` + lock anti double-booking, derivando `endsAt` en backend y guardando snapshots inmutables en `src/modules/appointments/application/use-cases/create-appointment.use-case.ts`
- [x] T023 [P] [US4] Implementar `ListAppointmentsUseCase` (`OWNER` toda su empresa con filtros; `COLLABORATOR` solo su propio `collaboratorId`) en `src/modules/appointments/application/use-cases/list-appointments.use-case.ts`
- [x] T024 [P] [US4] Implementar `UpdateAppointmentStatusUseCase` (`OWNER` cualquier cita de su empresa; `COLLABORATOR` solo sus propias citas; aplica máquina de estados) en `src/modules/appointments/application/use-cases/update-appointment-status.use-case.ts`
- [x] T025 [US4] Implementar `RescheduleAppointmentUseCase` (exclusivo `OWNER`, solo citas `PENDING`/`CONFIRMED`, valida disponibilidad completa, excluye propio `appointmentId` y usa lock atómico anti double-booking) en `src/modules/appointments/application/use-cases/reschedule-appointment.use-case.ts`

### Repositorios en Memoria, Tests Unitarios de Fase 2 y Compuerta de Calidad

- [x] T026 [P] Implementar `InMemoryScheduleBlocksRepository`, `InMemorySchedulingContextLookupRepository` e `InMemoryAppointmentsRepository` (con mutex asíncrono por `${companyId}:${collaboratorId}` para probar concurrencia real) en `src/modules/appointments/application/__tests__/in-memory-schedule-blocks.repository.ts`, `src/modules/appointments/application/__tests__/in-memory-scheduling-context-lookup.repository.ts` y `src/modules/appointments/application/__tests__/in-memory-appointments.repository.ts`
- [x] T027 [P] [US1] Crear tests unitarios de bloqueos de horario (creación global/individual por `OWNER`, personal por `COLLABORATOR`, rechazos RBAC/multi-tenant, retorno de `affectedAppointments` e invocación de `AbsenceNotificationPort`) en `src/modules/appointments/application/__tests__/schedule-blocks.use-cases.spec.ts`
- [x] T028 [US3] Crear tests unitarios de disponibilidad, creación pública y de `OWNER`, snapshots inmutables, validación directa sin consultar `/availability`, concurrencia con `Promise.all` (1 éxito + 1 conflicto), listado, transiciones de status y reprogramación en `src/modules/appointments/application/__tests__/appointments.use-cases.spec.ts`
- [x] T029 **Compuerta Fase 2**: Ejecutar `npx tsc --noEmit` y `npx vitest run src/modules/appointments` y verificar 100% en verde antes de iniciar Fase 3

**Checkpoint Fase 2**: Todos los casos de uso y reglas de concurrencia/multi-tenancy verificados en memoria con Vitest.

---

## Fase 3: Capa `infra/` (Drizzle, Migración `0004`, Multi-País en Empresas, Fastify, Swagger) + Tests HTTP

**Purpose**: Implementar persistencia real en Drizzle/NeonDB con `pg_advisory_xact_lock`, migración SQL `0004`, soporte IANA en creación y actualización de empresas (Brasil/Venezuela), validación Zod, 13 endpoints Fastify con documentación OpenAPI/Swagger y pruebas HTTP integrales.

### Persistencia Drizzle y Migración `0004`

- [x] T030 Actualizar `CompanyTable` en `src/modules/Company/infra/database/schema/companies-schema.ts` agregando `timezone` (`varchar(64)`, `notNull`, `default("America/Caracas")`) y actualizar `CompanyEntity`, `RegisterCompanyInputDTO`, `RegisterCompanyUseCase`, `RegisterOwnerUseCase` (`POST /auth/register`), `POST /companies` y agregar endpoint `PATCH /companies/me/timezone` (JWT `OWNER`, validando IANA con `Intl.DateTimeFormat` para Brasil/Venezuela y cualquier zona válida) en `src/modules/Company/` y `src/modules/auth/` (cita `data-model.md`: `Company.timezone`)
- [x] T031 [P] [US1] Crear esquema Drizzle `ScheduleBlockTable` con constraints `CHECK` e índices en `src/modules/appointments/infra/database/schema/schedule-blocks-schema.ts` (cita `data-model.md`: `ScheduleBlock.*`)
- [x] T032 [P] [US3] Crear esquema Drizzle `AppointmentTable` con constraints `CHECK` (rango temporal, snapshots, status) e índices en `src/modules/appointments/infra/database/schema/appointments-schema.ts` (cita `data-model.md`: `Appointment.*`)
- [x] T033 Crear migración SQL versionada `src/shared/database/migrations/0004_appointments_and_schedule_blocks.sql` (alteración `companies.timezone` + tablas `schedule_blocks` y `appointments` + constraints + índices) y registrar la entrada en `src/shared/database/migrations/meta/_journal.json` (depende de T030, T031, T032)

### Adaptadores de Repositorio y Notificación

- [x] T034 [P] [US1] Implementar `DrizzleScheduleBlocksRepository` y `NoopAbsenceNotificationAdapter` en `src/modules/appointments/infra/database/repositories/drizzle-schedule-blocks.repository.ts` y `src/modules/appointments/infra/notifications/noop-absence-notification.adapter.ts`
- [x] T035 [P] [US2] Implementar `DrizzleSchedulingContextLookupRepository` en `src/modules/appointments/infra/database/repositories/drizzle-scheduling-context-lookup.repository.ts`
- [x] T036 [US3] Implementar `DrizzleAppointmentsRepository` usando `db.transaction` + `SELECT pg_advisory_xact_lock(hashtext($1))` por `${companyId}:${collaboratorId}` para `createWithLock` y `rescheduleWithLock`, además de consultas filtradas por `companyId` en `src/modules/appointments/infra/database/repositories/drizzle-appointments.repository.ts`

### Capa HTTP (Zod, Controladores, Factories, Rutas Fastify + Swagger)

- [x] T037 [P] Implementar esquemas Zod y esquemas OpenAPI/Swagger para los 13 endpoints (y `PATCH /companies/me/timezone`), garantizando que ningún payload acepte `endsAt` arbitrario, en `src/modules/appointments/infra/http/schemas/appointments-http.schemas.ts` (alineado con `contracts/openapi.yaml`)
- [x] T038 [P] [US1] Implementar `ScheduleBlocksController` en `src/modules/appointments/infra/http/controllers/schedule-blocks.controller.ts`
- [x] T039 [P] [US3] Implementar `AppointmentsController` (disponibilidad pública, creación pública, creación `OWNER`, listado `OWNER`/`COLLABORATOR`, actualización de status y reprogramación) en `src/modules/appointments/infra/http/controllers/appointments.controller.ts`
- [x] T040 Implementar composition factory en `src/modules/appointments/infra/http/factories/make-appointments-controllers.ts`, definir las 13 rutas con guards `authenticate`/`authorizeRoles` y schemas Swagger en `src/modules/appointments/infra/http/routes/appointments.routes.ts`, y registrar `appointmentsRoutes` en `src/shared/http/App.ts` (depende de T034–T039)

### Pruebas de Integración HTTP y Compuerta Final

- [x] T041 Crear suite de pruebas HTTP en `src/shared/http/__tests__/appointments.http.spec.ts` cubriendo: validación Zod (`400`), JWT y revocación (`401`), RBAC (`403`, incluyendo bloqueo a `COLLABORATOR` en `POST /appointments` y `POST /schedule-blocks`), aislamiento multi-tenant entre empresas A y B, creación con `affectedAppointments`, concurrencia básica (`201` + `409`), soporte multi-país (`America/Sao_Paulo` + `+55`, `America/Caracas` + `+58`), actualización de `timezone` de empresa y verificación de rutas en `/docs/json`
- [x] T042 **Compuerta Final Fase 3**: `npx tsc --noEmit` y `yarn test` verificados 100% en verde (77/77); migración `0004` aplicada y verificada en NeonDB (`appointments`, `schedule_blocks`, `companies.timezone`, 6 constraints `CHECK` y tabla `drizzle.__drizzle_migrations` sincronizada) y `ROADMAP.md` actualizado

---

## Dependencies & Execution Order

### Dependencias entre Fases (Principio V — Estrictamente Secuencial)
- **Fase 1 (`domain/`)**: Sin dependencias previas. **BLOQUEA** Fase 2 hasta pasar T014 (`tsc --noEmit` + tests de dominio en verde).
- **Fase 2 (`application/`)**: Depende de Fase 1 completa. **BLOQUEA** Fase 3 hasta pasar T029 (`tsc --noEmit` + tests de aplicación en verde).
- **Fase 3 (`infra/`)**: Depende de Fase 2 completa. Cierra con T042 (`tsc --noEmit` + `yarn test` completo en verde).

### Mapeo por Historia de Usuario
- **US1 (Bloqueos de horario y ausencias — P1)**: T006, T009, T015, T018, T019, T020, T027, T031, T034, T038
- **US2 (Disponibilidad real multi-país — P1)**: T002, T008, T011, T013, T016, T021, T030, T035
- **US3 (Creación pública y `OWNER`, snapshots y anti double-booking — P1)**: T003, T004, T007, T010, T017, T022, T026, T028, T032, T033, T036, T039, T040, T041
- **US4 (Gestión interna, máquina de estados y reprogramación — P2)**: T005, T023, T024, T025, T028, T039, T041

### Ejemplos de Ejecución en Paralelo dentro de cada Fase
- **Fase 1**: T001, T002, T003, T004, T005 en paralelo → T006, T007, T009, T010, T011 en paralelo → T008 → T012 y T013 en paralelo → T014.
- **Fase 2**: T015, T016, T017, T018 en paralelo → T019–T025 (paralelizando T020, T023, T024) → T026 → T027 y T028 → T029.
- **Fase 3**: T030, T031, T032 en paralelo → T033; T034, T035, T037, T038, T039 en paralelo → T036 → T040 → T041 → T042.
