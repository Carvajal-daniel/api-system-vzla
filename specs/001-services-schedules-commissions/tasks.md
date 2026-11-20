# Tasks: Servicios, Días de Trabajo y Comisiones (Etapa 1)

**Input**: Design documents from `/specs/001-services-schedules-commissions/`  
**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/openapi.yaml](./contracts/openapi.yaml), [quickstart.md](./quickstart.md)

**Tests**: **OBLIGATORIOS** por la Constitución del proyecto (Principio V: Anti-Vibe Coding y Compuerta de Dominio y Aplicación). Cada historia de usuario DEBE validar su lógica en `domain/` y `application/` con pruebas unitarias en Vitest usando `InMemoryRepositories` antes de avanzar a `infra/`.

**Organization**: Las tareas están agrupadas por Historia de Usuario (P1 → P5) para permitir implementación y verificación incremental, respetando el orden interno `domain/` → `application/` + tests en Vitest → `infra/`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Puede ejecutarse en paralelo (archivos distintos, sin dependencia de tareas incompletas).
- **[Story]**: Historia de usuario a la que pertenece (`[US1]`..`[US5]`). Fases Setup, Foundational y Polish no llevan etiqueta de historia.
- Todas las rutas son relativas a la raíz del repositorio (`d:\sistema-1\backend-saaS`).

---

## Phase 1: Setup (Shared Dependencies & Configuration)

**Purpose**: Instalar las dependencias aprobadas para documentación OpenAPI y validar la configuración de entorno necesaria para JWT.

- [X] T001 Install approved `@fastify/swagger` and `@fastify/swagger-ui` packages in `package.json`
- [X] T002 [P] Create environment validation helper for `JWT_SECRET` (fail-fast when missing/empty, never hardcoded) in `src/shared/config/env.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Infraestructura transversal compartida que bloquea todas las historias de usuario (errores de dominio puros, contexto de actor RBAC, guard JWT y error handler/Swagger en Fastify).

**⚠️ CRITICAL**: Ninguna tarea de historias de usuario puede comenzar hasta completar esta fase.

- [X] T003 [P] Create pure `DomainError` base class (no HTTP status codes or framework imports) in `src/shared/errors/domain-error.ts`
- [X] T004 [P] Create pure `ActorContext` (`OWNER` | `COLLABORATOR` discriminated union) and `ActorRole` types in `src/shared/auth/actor-context.ts`
- [X] T005 [P] Implement Fastify JWT authentication `preHandler` (`authenticate`) extracting `{ sub, companyId, role }` into `request.actor` via `jsonwebtoken` + Zod and `authorizeRoles(...roles)` guard in `src/shared/http/auth/authenticate.ts`
- [X] T006 Update centralized Fastify error handler to map `DomainError` subclasses, `ZodError`, and legacy `AppError` to safe HTTP status codes (`400`/`401`/`403`/`404`/`409`/`500`) without leaking internals in `src/shared/http/error-handler.ts`
- [X] T007 Register centralized error handler and development-only `@fastify/swagger` + `@fastify/swagger-ui` (`/docs`, disabled when `NODE_ENV === 'production'`) in `src/shared/http/App.ts`

**Checkpoint**: Base transversal lista — pueden comenzar las historias de usuario siguiendo el orden estricto `domain/` → `application/` + Vitest → `infra/`.

---

## Phase 3: User Story 1 — Gestión del catálogo de servicios por el Dueño (Priority: P1) 🎯 MVP

**Goal**: Permitir al `OWNER` crear, listar, editar y desactivar/reactivar servicios de su empresa con validaciones de negocio, unicidad normalizada de nombre y aislamiento estricto por `companyId`.

**Independent Test**: Ejecutar `npx vitest run src/modules/services/application/__tests__/services.use-cases.spec.ts` verificando creación, listado, edición, cambio de estado, unicidad normalizada (`"Corte Clásico"` vs `"  corte clásico  "`), `priceInCents = 0`, rechazos de duración `<= 0` y precio `< 0`, aislamiento por `companyId` y rechazo a `COLLABORATOR`.

### Domain Layer (US1)

- [X] T008 [P] [US1] Create service domain errors (`InvalidServiceNameError`, `InvalidServiceDurationError`, `InvalidServicePriceError`, `ServiceNameAlreadyExistsError`, `ServiceNotFoundError`, `UnauthorizedServiceActionError`) extending `DomainError` in `src/modules/services/domain/errors/service-errors.ts`
- [X] T009 [P] [US1] Create `ServiceEntity` implementing `Service.id`, `Service.companyId`, `Service.name`, `Service.description`, `Service.durationMinutes`, `Service.priceInCents`, `Service.active`, `Service.createdAt`, and `Service.updatedAt` constraints per `data-model.md` in `src/modules/services/domain/entities/service.entity.ts`
- [X] T010 [P] [US1] Define `ServicesRepository` port (all methods scoped by `companyId`, including normalized name lookup) in `src/modules/services/domain/repositories/services.repository.ts`

### Application Layer & Unit Tests (US1)

- [X] T011 [P] [US1] Create input/output DTOs for US1 operations in `src/modules/services/application/dtos/service.dtos.ts`
- [X] T012 [P] [US1] Implement `CreateServiceUseCase` (enforcing `OWNER` role, `companyId` scope, and normalized name uniqueness) in `src/modules/services/application/use-cases/create-service.use-case.ts`
- [X] T013 [P] [US1] Implement `ListCompanyServicesUseCase` (returning active and inactive services for `actor.companyId`) in `src/modules/services/application/use-cases/list-company-services.use-case.ts`
- [X] T014 [P] [US1] Implement `UpdateServiceUseCase` (preserving normalized name uniqueness and `companyId` isolation) in `src/modules/services/application/use-cases/update-service.use-case.ts`
- [X] T015 [P] [US1] Implement `UpdateServiceStatusUseCase` (activate/deactivate within `actor.companyId`) in `src/modules/services/application/use-cases/update-service-status.use-case.ts`
- [X] T016 [P] [US1] Create `InMemoryServicesRepository` for unit tests in `src/modules/services/application/__tests__/in-memory-services.repository.ts`
- [X] T017 [US1] Write and pass Vitest unit tests covering all US1 acceptance scenarios, edge cases, `companyId` isolation, and RBAC in `src/modules/services/application/__tests__/services.use-cases.spec.ts`

### Infrastructure Layer (US1)

- [X] T018 [P] [US1] Create Drizzle `ServiceTable` schema enforcing `Service.id`, `Service.companyId`, `Service.name`, `Service.description`, `Service.durationMinutes`, `Service.priceInCents`, `Service.active`, `Service.createdAt`, and `Service.updatedAt` constraints, `CHECK` rules, and unique normalized name index per `data-model.md` in `src/modules/services/infra/database/schema/services-schema.ts`
- [X] T019 [US1] Implement `DrizzleServicesRepository` (translating PostgreSQL `23505` unique violation to `ServiceNameAlreadyExistsError`) in `src/modules/services/infra/database/repositories/drizzle-services.repository.ts`
- [X] T020 [P] [US1] Create Zod HTTP request/param schemas for US1 endpoints matching `contracts/openapi.yaml` in `src/modules/services/infra/http/schemas/service-http.schemas.ts`
- [X] T021 [US1] Implement `ServicesController` (`create`, `list`, `update`, `updateStatus`) in `src/modules/services/infra/http/controllers/services.controller.ts`
- [X] T022 [US1] Wire US1 controller factory and protected Fastify routes (`POST /services`, `GET /services`, `PATCH /services/:serviceId`, `PATCH /services/:serviceId/status`) with `authenticate` + `authorizeRoles('OWNER')` and OpenAPI metadata in `src/modules/services/infra/http/factories/make-services-controllers.ts` and `src/modules/services/infra/http/routes/services.routes.ts`

**Checkpoint**: US1 (MVP) completa, probada en Vitest y conectada de punta a punta.

---

## Phase 4: User Story 2 — Vinculación de colaboradores a servicios y gestión de comisiones (Priority: P2)

**Goal**: Permitir al `OWNER` vincular colaboradores de su empresa a servicios de su empresa con porcentajes de comisión (`0..100`), actualizar el porcentaje para futuros agendamientos y desvincular colaboradores.

**Independent Test**: Ejecutar `npx vitest run src/modules/services/application/__tests__/collaborator-services.use-cases.spec.ts` verificando vínculo exitoso, extremos `0` y `100`, decimales válidos (`35.5`), rechazos `< 0` / `> 100` / duplicados, actualización de comisión, desvinculación, aislamiento por `companyId` y rechazo a `COLLABORATOR`.

### Domain Layer (US2)

- [X] T023 [P] [US2] Add `CollaboratorService` domain errors (`InvalidCommissionPercentageError`, `CollaboratorServiceAlreadyExistsError`, `CollaboratorServiceNotFoundError`, `CollaboratorNotFoundError`) in `src/modules/services/domain/errors/service-errors.ts`
- [X] T024 [P] [US2] Create `CollaboratorServiceEntity` implementing `CollaboratorService.id`, `CollaboratorService.companyId`, `CollaboratorService.collaboratorId`, `CollaboratorService.serviceId`, `CollaboratorService.commissionPercentage`, `CollaboratorService.createdAt`, and `CollaboratorService.updatedAt` constraints per `data-model.md` in `src/modules/services/domain/entities/collaborator-service.entity.ts`
- [X] T025 [P] [US2] Define `CollaboratorServicesRepository` and `CollaboratorLookupRepository` ports (strictly scoped by `companyId`) in `src/modules/services/domain/repositories/collaborator-services.repository.ts` and `src/modules/services/domain/repositories/collaborator-lookup.repository.ts`

### Application Layer & Unit Tests (US2)

- [X] T026 [P] [US2] Add input/output DTOs for collaborator-service links and commissions in `src/modules/services/application/dtos/service.dtos.ts`
- [X] T027 [P] [US2] Implement `LinkCollaboratorToServiceUseCase` (verifying `serviceId` belongs to `actor.companyId`, `collaboratorId` exists in `actor.companyId` with `isActive: true`, and preventing duplicate links) in `src/modules/services/application/use-cases/link-collaborator-to-service.use-case.ts`
- [X] T028 [P] [US2] Implement `UpdateCollaboratorServiceCommissionUseCase` in `src/modules/services/application/use-cases/update-collaborator-service-commission.use-case.ts`
- [X] T029 [P] [US2] Implement `UnlinkCollaboratorFromServiceUseCase` in `src/modules/services/application/use-cases/unlink-collaborator-from-service.use-case.ts`
- [X] T030 [P] [US2] Create `InMemoryCollaboratorServicesRepository` and `InMemoryCollaboratorLookupRepository` in `src/modules/services/application/__tests__/in-memory-collaborator-services.repository.ts` and `src/modules/services/application/__tests__/in-memory-collaborator-lookup.repository.ts`
- [X] T031 [US2] Write and pass Vitest unit tests covering all US2 acceptance scenarios, boundary commissions (`0`, `100`, `< 0`, `> 100`), duplicate links, inactive collaborator rejection (`isActive: false`), cross-company isolation, and RBAC in `src/modules/services/application/__tests__/collaborator-services.use-cases.spec.ts`

### Infrastructure Layer (US2)

- [X] T032 [P] [US2] Create Drizzle `CollaboratorServiceTable` schema enforcing `CollaboratorService.id`, `CollaboratorService.companyId`, `CollaboratorService.collaboratorId`, `CollaboratorService.serviceId`, `CollaboratorService.commissionPercentage`, `CollaboratorService.createdAt`, and `CollaboratorService.updatedAt` constraints, `CHECK` rule, and composite indexes per `data-model.md` in `src/modules/services/infra/database/schema/collaborator-services-schema.ts`
- [X] T033 [P] [US2] Implement `DrizzleCollaboratorServicesRepository` (translating PostgreSQL `23505` to `CollaboratorServiceAlreadyExistsError`) and `DrizzleCollaboratorLookupRepository` in `src/modules/services/infra/database/repositories/drizzle-collaborator-services.repository.ts` and `src/modules/services/infra/database/repositories/drizzle-collaborator-lookup.repository.ts`
- [X] T034 [US2] Add Zod HTTP schemas, `CollaboratorServicesController`, factory wiring, and protected `OWNER` routes (`POST /services/:serviceId/collaborators`, `PATCH /services/:serviceId/collaborators/:collaboratorId`, `DELETE /services/:serviceId/collaborators/:collaboratorId`) matching `contracts/openapi.yaml` in `src/modules/services/infra/http/schemas/service-http.schemas.ts`, `src/modules/services/infra/http/controllers/collaborator-services.controller.ts`, `src/modules/services/infra/http/factories/make-services-controllers.ts`, and `src/modules/services/infra/http/routes/services.routes.ts`

**Checkpoint**: US1 y US2 completas e independientemente verificadas.

---

## Phase 5: User Story 3 — Configuración de días y horarios de trabajo (Priority: P3)

**Goal**: Permitir al `OWNER` configurar y consultar la agenda semanal (`0..6`) de cada colaborador de su empresa, incluyendo horas de inicio/fin, descansos opcionales y días no laborables.

**Independent Test**: Ejecutar `npx vitest run src/modules/work-schedules/application/__tests__/work-schedules.use-cases.spec.ts` verificando configuración de días activos con y sin descanso, normalización de días inactivos, rechazos por `endTime <= startTime`, descansos incompletos o fuera de rango, `dayOfWeek` fuera de `0..6`, días duplicados en lote, aislamiento por `companyId` y rechazo a `COLLABORATOR`.

### Domain Layer (US3)

- [X] T035 [P] [US3] Create work-schedule domain errors (`InvalidTimeOfDayError`, `InvalidDayOfWeekError`, `InvalidWorkScheduleTimeError`, `InvalidWorkScheduleBreakError`, `DuplicateWorkScheduleDayError`, `WorkScheduleCollaboratorNotFoundError`, `UnauthorizedWorkScheduleActionError`) extending `DomainError` in `src/modules/work-schedules/domain/errors/work-schedule-errors.ts`
- [X] T036 [P] [US3] Create `TimeOfDay` Value Object implementing `TimeOfDay.value` (`HH:MM` 24h) and `toMinutes()` per `data-model.md` in `src/modules/work-schedules/domain/value-objects/time-of-day.vo.ts`
- [X] T037 [US3] Create `WorkScheduleEntity` implementing `WorkSchedule.id`, `WorkSchedule.companyId`, `WorkSchedule.collaboratorId`, `WorkSchedule.dayOfWeek`, `WorkSchedule.isWorkingDay`, `WorkSchedule.startTime`, `WorkSchedule.endTime`, `WorkSchedule.breakStart`, `WorkSchedule.breakEnd`, `WorkSchedule.createdAt`, and `WorkSchedule.updatedAt` constraints per `data-model.md` in `src/modules/work-schedules/domain/entities/work-schedule.entity.ts`
- [X] T038 [P] [US3] Define `WorkSchedulesRepository` and `WorkScheduleCollaboratorLookupRepository` ports (strictly scoped by `companyId`) in `src/modules/work-schedules/domain/repositories/work-schedules.repository.ts` and `src/modules/work-schedules/domain/repositories/collaborator-lookup.repository.ts`

### Application Layer & Unit Tests (US3)

- [X] T039 [P] [US3] Create input/output DTOs for work schedules in `src/modules/work-schedules/application/dtos/work-schedule.dtos.ts`
- [X] T040 [P] [US3] Implement `UpsertCollaboratorWorkSchedulesUseCase` (validating all entries in domain before persistence and rejecting duplicate `dayOfWeek` values in batch) in `src/modules/work-schedules/application/use-cases/upsert-collaborator-work-schedules.use-case.ts`
- [X] T041 [P] [US3] Implement `ListCollaboratorWorkSchedulesUseCase` in `src/modules/work-schedules/application/use-cases/list-collaborator-work-schedules.use-case.ts`
- [X] T042 [P] [US3] Create `InMemoryWorkSchedulesRepository` and `InMemoryWorkScheduleCollaboratorLookupRepository` in `src/modules/work-schedules/application/__tests__/in-memory-work-schedules.repository.ts` and `src/modules/work-schedules/application/__tests__/in-memory-collaborator-lookup.repository.ts`
- [X] T043 [US3] Write and pass Vitest unit tests covering all US3 acceptance scenarios, time/break validation edge cases, non-working days, cross-company isolation, and RBAC in `src/modules/work-schedules/application/__tests__/work-schedules.use-cases.spec.ts`

### Infrastructure Layer (US3)

- [X] T044 [P] [US3] Create Drizzle `WorkScheduleTable` schema enforcing `WorkSchedule.id`, `WorkSchedule.companyId`, `WorkSchedule.collaboratorId`, `WorkSchedule.dayOfWeek`, `WorkSchedule.isWorkingDay`, `WorkSchedule.startTime`, `WorkSchedule.endTime`, `WorkSchedule.breakStart`, `WorkSchedule.breakEnd`, `WorkSchedule.createdAt`, and `WorkSchedule.updatedAt` constraints, `CHECK` rules, and unique composite index per `data-model.md` in `src/modules/work-schedules/infra/database/schema/work-schedules-schema.ts`
- [X] T045 [P] [US3] Implement `DrizzleWorkSchedulesRepository` (transactional batch `upsertMany` by `(company_id, collaborator_id, day_of_week)`) and `DrizzleWorkScheduleCollaboratorLookupRepository` in `src/modules/work-schedules/infra/database/repositories/drizzle-work-schedules.repository.ts` and `src/modules/work-schedules/infra/database/repositories/drizzle-collaborator-lookup.repository.ts`
- [X] T046 [P] [US3] Create Zod HTTP schemas for work-schedule endpoints matching `contracts/openapi.yaml` in `src/modules/work-schedules/infra/http/schemas/work-schedule-http.schemas.ts`
- [X] T047 [US3] Implement `WorkSchedulesController`, factory, and protected `OWNER` routes (`PUT /collaborators/:collaboratorId/work-schedules`, `GET /collaborators/:collaboratorId/work-schedules`) matching `contracts/openapi.yaml` in `src/modules/work-schedules/infra/http/controllers/work-schedules.controller.ts`, `src/modules/work-schedules/infra/http/factories/make-work-schedules-controllers.ts`, and `src/modules/work-schedules/infra/http/routes/work-schedules.routes.ts`

**Checkpoint**: US1, US2 y US3 completas e independientemente verificadas.

---

## Phase 6: User Story 4 — Consulta de solo lectura para Colaboradores (Priority: P4)

**Goal**: Permitir al `COLLABORATOR` autenticado consultar únicamente sus servicios vinculados con sus propias comisiones y su propia grilla semanal de horarios, sin poder modificar configuraciones ni ver datos de otros colaboradores.

**Independent Test**: Ejecutar Vitest sobre los casos de uso de solo lectura verificando que el colaborador A visualiza solo sus propios servicios/comisiones/horarios, no accede a los del colaborador B y recibe rechazo de autorización ante cualquier intento de mutación.

### Application Layer & Unit Tests (US4)

- [X] T048 [P] [US4] Implement `ListCollaboratorAssignedServicesUseCase` (strictly scoped to `actor.collaboratorId` and `actor.companyId`, rejecting non-`COLLABORATOR` roles) in `src/modules/services/application/use-cases/list-collaborator-assigned-services.use-case.ts`
- [X] T049 [P] [US4] Implement `ListOwnWorkSchedulesUseCase` (strictly scoped to `actor.collaboratorId` and `actor.companyId`, rejecting non-`COLLABORATOR` roles) in `src/modules/work-schedules/application/use-cases/list-own-work-schedules.use-case.ts`
- [X] T050 [US4] Add Vitest unit tests verifying `COLLABORATOR` read-only self-service isolation (own services/commissions/schedules only, zero visibility into peer collaborators) in `src/modules/services/application/__tests__/collaborator-services.use-cases.spec.ts` and `src/modules/work-schedules/application/__tests__/work-schedules.use-cases.spec.ts`

### Infrastructure Layer (US4)

- [X] T051 [US4] Wire `ListCollaboratorAssignedServicesUseCase` and `ListOwnWorkSchedulesUseCase` into controllers, factories, and protected `GET /me/services` and `GET /me/work-schedules` routes (`authenticate` + `authorizeRoles('COLLABORATOR')`) matching `contracts/openapi.yaml` in `src/modules/services/infra/http/controllers/collaborator-services.controller.ts`, `src/modules/services/infra/http/factories/make-services-controllers.ts`, `src/modules/services/infra/http/routes/services.routes.ts`, `src/modules/work-schedules/infra/http/controllers/work-schedules.controller.ts`, `src/modules/work-schedules/infra/http/factories/make-work-schedules-controllers.ts`, and `src/modules/work-schedules/infra/http/routes/work-schedules.routes.ts`

**Checkpoint**: Vista de solo lectura de colaboradores verificada e integrada.

---

## Phase 7: User Story 5 — Consulta pública del catálogo para Clientes Finales (Priority: P5)

**Goal**: Permitir a un `CLIENT` sin autenticación consultar en una sola llamada los servicios activos (`active: true`) y los colaboradores habilitados (`id`, `name`, `specialty`) de un `companyId`, omitiendo servicios inactivos, comisiones y datos de otras empresas.

**Independent Test**: Ejecutar `npx vitest run src/modules/services/application/__tests__/public-catalog.use-case.spec.ts` verificando filtrado de servicios activos, lista vacía para servicios sin colaboradores o empresas inexistentes, y ausencia total de `commissionPercentage` or datos de otras empresas.

### Application Layer & Unit Tests (US5)

- [X] T052 [US5] Implement `ListPublicCompanyCatalogUseCase` (returning only `active: true` services and active linked collaborators with safe public fields `id`, `name`, `specialty`) in `src/modules/services/application/use-cases/list-public-company-catalog.use-case.ts`
- [X] T053 [US5] Write and pass Vitest unit tests covering all US5 acceptance scenarios and edge cases (inactive services hidden, active service without collaborators, unknown/empty `companyId`, zero commission leakage) in `src/modules/services/application/__tests__/public-catalog.use-case.spec.ts`

### Infrastructure Layer (US5)

- [X] T054 [US5] Implement `PublicCatalogController` and unauthenticated route `GET /public/companies/:companyId/services` (UUID param validation via Zod) matching `contracts/openapi.yaml` in `src/modules/services/infra/http/controllers/public-catalog.controller.ts`, `src/modules/services/infra/http/factories/make-services-controllers.ts`, and `src/modules/services/infra/http/routes/services.routes.ts`

**Checkpoint**: Todas las historias de usuario (US1–US5) están completas y verificadas de forma independiente.

---

## Phase 8: Polish, Database Migration & End-to-End Verification

**Purpose**: Conectar los módulos en `App.ts`, generar la migración SQL versionada en Drizzle y ejecutar las pruebas HTTP y el verificador estricto de TypeScript.

- [X] T055 Register `servicesRoutes` and `workSchedulesRoutes` in `src/shared/http/App.ts`
- [X] T056 Generate explicit Drizzle SQL migration for `services`, `collaborator_services`, and `work_schedules` in `src/shared/database/migrations/` using `npx drizzle-kit generate`
- [X] T057 Write Fastify HTTP integration tests using `app.inject()` covering JWT auth (`401`), RBAC (`403`), Zod validation (`400`), safe error responses, and OpenAPI schema generation in `src/shared/http/__tests__/services-schedules.http.spec.ts`
- [X] T058 Run full verification (`npx tsc --noEmit`, `npm test`) and validate all scenarios from `specs/001-services-schedules-commissions/quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: Sin dependencias — puede iniciarse de inmediato.
- **Phase 2 (Foundational)**: Depende de Phase 1 — **BLOQUEA** todas las historias de usuario.
- **Phase 3 (US1 — Services CRUD)**: Depende de Phase 2. Base para US2 y US5.
- **Phase 4 (US2 — Collaborator-Service Links & Commissions)**: Depende de US1 (`ServiceEntity`, `ServicesRepository`, `ServiceTable`).
- **Phase 5 (US3 — Work Schedules)**: Depende solo de Phase 2 (módulo independiente `work-schedules/`, puede desarrollarse en paralelo con US1/US2).
- **Phase 6 (US4 — Collaborator Read-Only)**: Depende de US2 (servicios/comisiones vinculados) y US3 (horarios semanales).
- **Phase 7 (US5 — Public Catalog)**: Depende de US1 y US2 (servicios activos + vínculos de colaboradores).
- **Phase 8 (Polish & Migration)**: Depende de la finalización de todas las historias deseadas.

### Within Each User Story (Constitución — Principio V)

1. `domain/` (Errores, Value Objects, Entidades, Puertos de Repositorio).
2. `application/` + Tests Unitarios en Vitest con `InMemoryRepositories` (deben pasar al 100% antes de pasar a `infra/`).
3. `infra/` (Schemas Drizzle, Repositorios DB, Schemas Zod, Controladores, Factories, Rutas Fastify).

### Parallel Opportunities

- **Phase 2**: `T003`, `T004`, `T005` pueden crearse en paralelo.
- **US1**: `T008`, `T009`, `T010` en paralelo; luego `T011`–`T016` en paralelo; luego `T018` y `T020` en paralelo.
- **US2**: `T023`, `T024`, `T025` en paralelo; luego `T026`–`T030` en paralelo; luego `T032` y `T033` en paralelo.
- **US3 (módulo independiente)**: Puede ejecutarse en paralelo con US1/US2 una vez completada Phase 2 (`T035`, `T036`, `T038` en paralelo; luego `T039`–`T042` en paralelo; luego `T044`–`T046` en paralelo).
- **US4**: `T048` y `T049` en paralelo.

---

## Parallel Example: User Story 1

```text
# 1. Domain layer in parallel:
T008: src/modules/services/domain/errors/service-errors.ts
T009: src/modules/services/domain/entities/service.entity.ts
T010: src/modules/services/domain/repositories/services.repository.ts

# 2. Application use cases & in-memory repo in parallel:
T011: src/modules/services/application/dtos/service.dtos.ts
T012: src/modules/services/application/use-cases/create-service.use-case.ts
T013: src/modules/services/application/use-cases/list-company-services.use-case.ts
T014: src/modules/services/application/use-cases/update-service.use-case.ts
T015: src/modules/services/application/use-cases/update-service-status.use-case.ts
T016: src/modules/services/application/__tests__/in-memory-services.repository.ts
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Completar Phase 1 (Setup) + Phase 2 (Foundational).
2. Completar Phase 3 (US1: Catálogo de servicios del `OWNER`) validando primero con Vitest (`InMemoryRepositories`) y luego integrando Drizzle + Fastify.
3. **Checkpoint MVP**: El `OWNER` ya puede administrar su catálogo de servicios con aislamiento multi-tenant y RBAC.

### Incremental Delivery

1. Setup + Foundational → Base de seguridad JWT, RBAC y errores lista.
2. US1 → Catálogo de servicios (`OWNER`).
3. US2 → Vínculos colaborador-servicio y comisiones (`OWNER`).
4. US3 → Días y horarios semanales de trabajo (`OWNER`).
5. US4 → Consultas de solo lectura para `COLLABORATOR` (`/me/services`, `/me/work-schedules`).
6. US5 → Catálogo público para `CLIENT` (`/public/companies/:companyId/services`).
7. Polish → Registro en `App.ts`, migración Drizzle SQL, tests HTTP con `app.inject()` y verificación completa (`tsc --noEmit` + `npm test`).
