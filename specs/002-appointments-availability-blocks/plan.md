# Implementation Plan: Etapa 3 — Motor de Agendamientos, Disponibilidad y Bloqueios de Horario

**Branch**: `002-appointments-availability-blocks` | **Date**: 2026-11-20 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/002-appointments-availability-blocks/spec.md`

## Summary

Implementar el motor completo de agendamientos, cálculo de disponibilidad real y bloqueos de horario en el módulo `src/modules/appointments/` siguiendo estrictamente la arquitectura hexagonal en 3 capas (`domain/` → `application/` → `infra/`), con extensión de `companies.timezone` (default `"America/Caracas"`), paso de slots de `15` minutos, creación pública (`PENDING`) y de `OWNER` (`PENDING` o `CONFIRMED`, prohibida para `COLLABORATOR`), validación completa de disponibilidad en dominio sin depender de consultas previas, derivación obligatoria de `endsAt` en backend, prevención atómica de double-booking con `pg_advisory_xact_lock`, retorno de `affectedAppointments` + puerto desacoplado `AbsenceNotificationPort` al registrar bloqueos, documentación OpenAPI/Swagger y pruebas unitarias e integración en Vitest.

## Technical Context

**Language/Version**: Node.js (ESM) + TypeScript 6.0 (`"strict": true`, sin `any` ni `@ts-ignore`)  
**Primary Dependencies**: Fastify 5, Drizzle ORM 0.45, PostgreSQL (`pg`), Zod 4, `@fastify/swagger`, `@fastify/swagger-ui`, `jsonwebtoken` (sin nuevas dependencias externas; manejo de timezone IANA vía `Intl.DateTimeFormat` nativo)  
**Storage**: PostgreSQL serverless (NeonDB) con migración SQL versionada `0004` (`companies.timezone`, `schedule_blocks`, `appointments`)  
**Testing**: Vitest 5 (pruebas unitarias de `domain/`, pruebas de `application/` con `InMemoryRepositories` y pruebas de capa HTTP con `app.inject`)  
**Target Platform**: Linux / Windows server (Node.js runtime)  
**Project Type**: Backend REST API multi-tenant (web-service)  
**Performance Goals**: Cálculo de disponibilidad y creación de citas determinísticos en < 150ms en operación normal; lock granular por `(companyId, collaboratorId)` para evitar contención global  
**Constraints**: Aislamiento estricto por `companyId`; `domain/` 100% libre de imports de infraestructura; `endsAt` derivado únicamente en backend; prevención estricta de double-booking  
**Scale/Scope**: 1 módulo nuevo (`appointments`) + columna `timezone` en `companies` + 13 endpoints HTTP documentados en Swagger + migración `0004`

## Constitution Check

*GATE: Evaluated before Phase 0 and re-verified after Phase 1 design.*

| Principio Constitucional | Estado | Evidencia / Cumplimiento |
|---|---|---|
| **I. Stack Tecnológico Oficial** | PASS | TypeScript `strict`, Fastify, Drizzle/NeonDB, Zod, Vitest. Cero librerías nuevas. |
| **II. Arquitectura Hexagonal (`infra` → `application` → `domain`)** | PASS | `domain/` puro (entidades, `TimeRange`, `AppointmentStatus`, `AvailabilityCalculator`, `timezone-utils`, errores, puertos); `application/` con 1 clase `UseCase` por acción; `infra/` con Drizzle, Zod y Fastify. |
| **III. Aislamiento Multi-Tenant y RBAC** | PASS | Todas las consultas y mutaciones filtran por `companyId`. `OWNER` gestiona su empresa y puede crear citas (`POST /appointments`); `COLLABORATOR` solo gestiona sus bloqueos personales, ve sus citas y actualiza estado de sus propias citas, con prohibición estricta de crear citas (`403`). `CLIENT` accede a endpoints públicos (`/public/companies/:companyId/...`) sin cuenta. |
| **IV. Invariantes Críticas y Desacoplamiento de IA** | PASS | Validación completa de disponibilidad en dominio al crear/reprogramar (jornada + descanso + bloqueos + citas activas + futuro). Registro de bloqueo detecta `affectedAppointments` y dispara `AbsenceNotificationPort` desacoplado (listo para Etapa 5 WhatsApp). |
| **V. Flujo Obligatorio (Anti-Vibe Coding)** | PASS | Implementación secuencial obligatoria: Fase 1 `domain/` + tests unitarios → Fase 2 `application/` + `InMemoryRepositories` + tests unitarios → Fase 3 `infra/` (Drizzle, migración `0004`, Zod, Fastify, Swagger) + tests HTTP. |

## Project Structure

### Documentation (this feature)

```text
specs/002-appointments-availability-blocks/
├── spec.md                     # Especificación funcional aprobada
├── plan.md                     # Este plan técnico (/speckit-plan)
├── research.md                 # Decisiones técnicas (timezone, lock, modularidad)
├── data-model.md               # Modelo de datos Drizzle, constraints y máquina de estados
├── quickstart.md               # Guía de validación y comandos de prueba
├── checklists/
│   └── requirements.md         # Checklist de calidad de spec (16/16)
├── contracts/
│   └── openapi.yaml            # Contrato OpenAPI 3.1 de los 13 endpoints
└── tasks.md                    # Generado por /speckit-tasks (siguiente paso)
```

### Source Code (repository root)

```text
src/
├── modules/
│   ├── Company/
│   │   └── infra/database/schema/
│   │       └── companies-schema.ts                          # + columna timezone (default 'America/Caracas')
│   └── appointments/                                        # NUEVO MÓDULO (Etapa 3)
│       ├── domain/
│       │   ├── entities/
│       │   │   ├── schedule-block.entity.ts
│       │   │   └── appointment.entity.ts
│       │   ├── value-objects/
│       │   │   ├── time-range.vo.ts
│       │   │   ├── appointment-status.vo.ts
│       │   │   └── client-contact.vo.ts
│       │   ├── services/
│       │   │   ├── timezone-utils.ts
│       │   │   └── availability-calculator.ts               # Cálculo de slots (15 min) + validación completa de reserva
│       │   ├── errors/
│       │   │   └── appointment-errors.ts
│       │   ├── repositories/
│       │   │   ├── schedule-blocks.repository.ts
│       │   │   ├── appointments.repository.ts
│       │   │   └── scheduling-context-lookup.repository.ts
│       │   └── __tests__/
│       │       ├── time-range-and-status.spec.ts
│       │       └── availability-calculator.spec.ts
│       ├── application/
│       │   ├── dtos/
│       │   │   ├── schedule-block.dtos.ts
│       │   │   ├── availability.dtos.ts
│       │   │   └── appointment.dtos.ts
│       │   ├── ports/
│       │   │   └── absence-notification.port.ts
│       │   ├── use-cases/
│       │   │   ├── create-schedule-block.use-case.ts
│       │   │   ├── list-schedule-blocks.use-case.ts
│       │   │   ├── delete-schedule-block.use-case.ts
│       │   │   ├── get-availability.use-case.ts
│       │   │   ├── create-appointment.use-case.ts           # Unifica flujo público (PENDING) y OWNER (PENDING/CONFIRMED)
│       │   │   ├── list-appointments.use-case.ts
│       │   │   ├── update-appointment-status.use-case.ts
│       │   │   └── reschedule-appointment.use-case.ts
│       │   └── __tests__/
│       │       ├── in-memory-schedule-blocks.repository.ts
│       │       ├── in-memory-appointments.repository.ts     # Incluye mutex por (companyId, collaboratorId)
│       │       ├── in-memory-scheduling-context-lookup.repository.ts
│       │       ├── schedule-blocks.use-cases.spec.ts
│       │       └── appointments.use-cases.spec.ts
│       └── infra/
│           ├── database/
│           │   ├── schema/
│           │   │   ├── schedule-blocks-schema.ts
│           │   │   └── appointments-schema.ts
│           │   └── repositories/
│           │       ├── drizzle-schedule-blocks.repository.ts
│           │       ├── drizzle-appointments.repository.ts   # Transacción + pg_advisory_xact_lock
│           │       └── drizzle-scheduling-context-lookup.repository.ts
│           ├── notifications/
│           │   └── noop-absence-notification.adapter.ts
│           └── http/
│               ├── schemas/
│               │   └── appointments-http.schemas.ts
│               ├── controllers/
│               │   ├── schedule-blocks.controller.ts
│               │   └── appointments.controller.ts
│               ├── factories/
│               │   └── make-appointments-controllers.ts
│               └── routes/
│                   └── appointments.routes.ts
└── shared/
    ├── database/migrations/
    │   ├── 0004_appointments_and_schedule_blocks.sql        # + actualización de meta/_journal.json
    └── http/
        ├── App.ts                                           # Registrar appointmentsRoutes
        └── __tests__/
            └── appointments.http.spec.ts                    # Pruebas HTTP (Zod, JWT, RBAC, multi-tenant, 409, Swagger)
```

**Structure Decision**: Se mantiene el layout modular `src/modules/<feature>/{domain,application,infra}` ya consolidado en `services`, `work-schedules` y `auth`, sin tocar módulos previos salvo la adición estrictamente necesaria de `companies.timezone` y el registro de rutas en `src/shared/http/App.ts`.

## Phased Implementation Roadmap (Principio V)

### Fase 1 — Capa `domain/` + Tests Unitarios de Dominio
1. Implementar errores de dominio (`appointment-errors.ts` extendiendo `DomainError`).
2. Implementar Value Objects (`TimeRange`, `AppointmentStatus` con matriz de transiciones, `ClientContact`).
3. Implementar `timezone-utils.ts` (validación IANA + conversión local↔UTC) y `AvailabilityCalculator` (generación de slots con paso de `15` min + validación integral de intervalo contra futuro, jornada, descanso y bloqueos).
4. Implementar entidades `ScheduleBlock` y `Appointment` (con derivación obligatoria de `endsAt` y snapshots inmutables) e interfaces de repositorios.
5. **Compuerta Fase 1:** Ejecutar `npx vitest run src/modules/appointments/domain` y `npx tsc --noEmit`.

### Fase 2 — Capa `application/` + `InMemoryRepositories` + Tests Unitarios
1. Definir DTOs y el puerto `AbsenceNotificationPort`.
2. Implementar los 8 casos de uso:
   - `CreateScheduleBlockUseCase` (permite crear con citas activas, retorna `affectedAppointments` y dispara `AbsenceNotificationPort`), `ListScheduleBlocksUseCase`, `DeleteScheduleBlockUseCase`.
   - `GetAvailabilityUseCase` (colaborador específico o todos los habilitados).
   - `CreateAppointmentUseCase` (soporta canal público → `PENDING` y canal `OWNER` → `PENDING`/`CONFIRMED`; valida en dominio futuro + jornada + descanso + bloqueos + lock anti double-booking; deriva `endsAt` en backend).
   - `ListAppointmentsUseCase`, `UpdateAppointmentStatusUseCase`, `RescheduleAppointmentUseCase`.
3. Implementar `InMemoryRepositories` (con lock/mutex por `(companyId, collaboratorId)` para probar concurrencia real con `Promise.all`).
4. **Compuerta Fase 2:** Ejecutar `npx vitest run src/modules/appointments` y `npx tsc --noEmit` verificando 100% de escenarios de éxito, multi-tenancy, RBAC, snapshots inmutables y double-booking concurrente.

### Fase 3 — Capa `infra/` (Drizzle, Migración `0004`, Fastify, Zod, Swagger) + Tests HTTP
1. Agregar columna `timezone` (`default("America/Caracas")`) en `companies-schema.ts`, crear `schedule-blocks-schema.ts` y `appointments-schema.ts`, y generar la migración SQL versionada `0004_appointments_and_schedule_blocks.sql` (+ `meta/_journal.json`).
2. Implementar repositorios Drizzle (`drizzle-appointments.repository.ts` con `db.transaction` + `pg_advisory_xact_lock`), `drizzle-schedule-blocks.repository.ts`, `drizzle-scheduling-context-lookup.repository.ts` y `NoopAbsenceNotificationAdapter`.
3. Implementar validación Zod (`appointments-http.schemas.ts`), controladores, factories y rutas Fastify con documentación OpenAPI/Swagger completa para los 13 endpoints, registrando `appointmentsRoutes` en `src/shared/http/App.ts`.
4. Implementar `src/shared/http/__tests__/appointments.http.spec.ts` cubriendo validación Zod, JWT, RBAC (`OWNER` vs `COLLABORATOR` vs público), aislamiento multi-tenant, concurrencia, `affectedAppointments` y esquema `/docs/json`.
5. **Compuerta Fase 3:** Ejecutar `npx tsc --noEmit` y `yarn test` (suite completa). *(Nota: confirmar entorno antes de ejecutar la migración `0004` contra NeonDB).*

## Complexity Tracking

No existen violaciones a la Constitución; no se requiere justificación de excepciones.
