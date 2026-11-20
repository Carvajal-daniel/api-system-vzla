# Implementation Plan: Servicios, Días de Trabajo y Comisiones (Etapa 1)

**Branch**: `001-services-schedules-commissions` | **Date**: 2026-11-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-services-schedules-commissions/spec.md`

## Summary

Implementar el módulo fundacional de Etapa 1 dividido en dos módulos hexagonales cohesivos (`services` y `work-schedules`) que permiten al `OWNER` gestionar el catálogo de servicios, vincular colaboradores con sus porcentajes de comisión y configurar los días/horarios semanales de trabajo; al `COLLABORATOR` consultar en solo lectura sus propios servicios, comisiones y horarios; y al `CLIENT` consultar públicamente los servicios activos y colaboradores habilitados de un salón sin exponer datos internos. Se seguirá estrictamente el orden Anti-Vibe Coding de la Constitución (`domain/` → `application/` + tests en Vitest con `InMemoryRepositories` → `infra/` con Drizzle/NeonDB, Zod, JWT auth guard y rutas Fastify).

## Technical Context

**Language/Version**: TypeScript 6.0.3 (`"strict": true`, `"exactOptionalPropertyTypes": true`, `"noUncheckedIndexedAccess": true`, `"verbatimModuleSyntax": true`, ESM `NodeNext`) sobre Node.js  
**Primary Dependencies**: Fastify `^5.8.5`, Drizzle ORM `^0.45.2` (`drizzle-orm/node-postgres` + `pg`), Zod `^4.4.3`, `jsonwebtoken` `^9.0.3` (ya instalado), `bcrypt` `^6.0.0`. *Dependencias nuevas aprobadas*: `@fastify/swagger` y `@fastify/swagger-ui` para documentación OpenAPI en desarrollo.  
**Storage**: PostgreSQL (NeonDB) con migraciones explícitas gestionadas por `drizzle-kit` en `src/shared/database/migrations/`  
**Testing**: Vitest `^5.1.1` (ya configurado en `vitest.config.ts`) con `InMemoryRepositories` para pruebas unitarias de dominio y casos de uso; pruebas de integración HTTP con `app.inject()` de Fastify  
**Target Platform**: Linux / Windows server (API HTTP REST)  
**Project Type**: Backend web service (SaaS Multi-Tenant API)  
**Performance Goals**: Respuestas p95 < 150 ms en catálogo público y gestión interna mediante índices compuestos por `company_id`  
**Constraints**: Aislamiento estricto por `companyId` en el 100% de consultas/mutaciones; RBAC (`OWNER` / `COLLABORATOR` / `CLIENT`); validaciones de dominio ejecutadas antes de persistencia; cero uso de `any` o `@ts-ignore`  
**Scale/Scope**: Etapa 1 (3 entidades nuevas: `Service`, `CollaboratorService`, `WorkSchedule`; 11 endpoints HTTP; 12 casos de uso)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio / Compuerta | Estado Pre-Diseño | Estado Post-Diseño | Evidencia en el Plan |
|-----------------------|-------------------|--------------------|----------------------|
| **I. Stack Tecnológico Oficial** (TS estricto, Fastify, PostgreSQL/NeonDB, Drizzle, Zod, bcrypt, Vitest) | PASS | PASS | Se mantiene intacto el stack oficial. `@fastify/swagger` y `@fastify/swagger-ui` son plugins oficiales de Fastify para OpenAPI (se solicitan explícitamente antes de instalar). |
| **II. Arquitectura Hexagonal y Regla de Dependencias** (`infra` → `application` → `domain`) | PASS | PASS | `domain/` 100% TS puro (entidades, VO `TimeOfDay`, `DomainError`, puertos de repositorio). `application/` solo importa `domain/`. Drizzle, Zod, JWT y Fastify viven exclusivamente en `infra/` y `shared/http/`. |
| **III. Aislamiento Multi-Tenant y RBAC** (`companyId` obligatorio, roles `OWNER`/`COLLABORATOR`/`CLIENT`) | PASS | PASS | Todo método de repositorio exige `companyId`. Todo `UseCase` protegido recibe `ActorContext` y valida rol y `companyId`. Middleware JWT extrae `companyId` del token firmado, nunca del body/params del cliente. |
| **IV. Invariantes Críticas y Desacoplamiento de IA** | PASS | PASS | Todas las invariantes (duración `> 0`, precio `>= 0`, unicidad normalizada, comisión `0..100`, `endTime > startTime`, descansos dentro de jornada, día `0..6`) viven en `domain/` y se refuerzan con `CHECK`/`UNIQUE` en PostgreSQL. (IA no aplica en Etapa 1). |
| **V. Flujo Obligatorio (Anti-Vibe Coding)** | PASS | PASS | Implementación estrictamente secuencial: (1) `domain/` → (2) `application/` + tests Vitest con `InMemoryRepositories` → (3) `infra/` (schemas Drizzle, migración SQL, repositorios DB, Zod, rutas Fastify, OpenAPI). |
| **Estándares de Nombres y Calidad** (`kebab-case` en nuevos módulos, inglés en código, errores seguros) | PASS | PASS | Todos los nuevos archivos y carpetas siguen `kebab-case`, identificadores en inglés y mensajes de error claros sin filtrar detalles internos. Los módulos legacy (`Company/`, `Collaborators/`) no se renombran fuera de alcance. |

## Project Structure

### Documentation (this feature)

```text
specs/001-services-schedules-commissions/
├── plan.md              # Este archivo
├── research.md          # Decisiones técnicas y alternativas evaluadas
├── data-model.md        # Entidades, invariantes y esquema PostgreSQL/Drizzle
├── quickstart.md        # Guía de validación end-to-end
├── contracts/
│   └── openapi.yaml     # Contrato OpenAPI 3.1 de los 11 endpoints
└── tasks.md             # Pendiente de generar con /speckit-tasks
```

### Source Code (repository root)

```text
src/
├── shared/
│   ├── config/
│   │   └── env.ts                                  # Validación fail-fast de JWT_SECRET y variables requeridas
│   ├── errors/
│   │   └── domain-error.ts                         # Clase base pura para errores de dominio (sin HTTP)
│   ├── auth/
│   │   └── actor-context.ts                        # Tipos puros ActorContext y ActorRole (OWNER | COLLABORATOR)
│   ├── http/
│   │   ├── App.ts                                  # Registro de rutas nuevas, error handler y Swagger (solo dev)
│   │   ├── error-handler.ts                        # Mapeo centralizado DomainError / ZodError / AppError -> HTTP
│   │   ├── auth/
│   │   │   └── authenticate.ts                     # Fastify preHandler JWT (jsonwebtoken + Zod) y authorizeRoles()
│   │   └── __tests__/
│   │       └── services-schedules.http.spec.ts     # Tests de integración HTTP con app.inject() (JWT, RBAC, Zod, OpenAPI)
│   └── database/
│       └── migrations/
│           └── <timestamp>_services_schedules.sql  # Migración explícita generada por drizzle-kit
│
├── modules/
│   ├── services/
│   │   ├── domain/
│   │   │   ├── entities/
│   │   │   │   ├── service.entity.ts
│   │   │   │   └── collaborator-service.entity.ts
│   │   │   ├── errors/
│   │   │   │   └── service-errors.ts
│   │   │   └── repositories/
│   │   │       ├── services.repository.ts
│   │   │       ├── collaborator-services.repository.ts
│   │   │       └── collaborator-lookup.repository.ts
│   │   ├── application/
│   │   │   ├── dtos/
│   │   │   │   └── service.dtos.ts
│   │   │   ├── use-cases/
│   │   │   │   ├── create-service.use-case.ts
│   │   │   │   ├── list-company-services.use-case.ts
│   │   │   │   ├── update-service.use-case.ts
│   │   │   │   ├── update-service-status.use-case.ts
│   │   │   │   ├── link-collaborator-to-service.use-case.ts
│   │   │   │   ├── update-collaborator-service-commission.use-case.ts
│   │   │   │   ├── unlink-collaborator-from-service.use-case.ts
│   │   │   │   ├── list-collaborator-assigned-services.use-case.ts
│   │   │   │   └── list-public-company-catalog.use-case.ts
│   │   │   └── __tests__/
│   │   │       ├── in-memory-services.repository.ts
│   │   │       ├── in-memory-collaborator-services.repository.ts
│   │   │       ├── in-memory-collaborator-lookup.repository.ts
│   │   │       ├── services.use-cases.spec.ts
│   │   │       ├── collaborator-services.use-cases.spec.ts
│   │   │       └── public-catalog.use-case.spec.ts
│   │   └── infra/
│   │       ├── database/
│   │       │   ├── schema/
│   │       │   │   ├── services-schema.ts
│   │       │   │   └── collaborator-services-schema.ts
│   │       │   └── repositories/
│   │       │       ├── drizzle-services.repository.ts
│   │       │       ├── drizzle-collaborator-services.repository.ts
│   │       │       └── drizzle-collaborator-lookup.repository.ts
│   │       └── http/
│   │           ├── schemas/
│   │           │   └── service-http.schemas.ts
│   │           ├── controllers/
│   │           │   ├── services.controller.ts
│   │           │   ├── collaborator-services.controller.ts
│   │           │   └── public-catalog.controller.ts
│   │           ├── factories/
│   │           │   └── make-services-controllers.ts
│   │           └── routes/
│   │               └── services.routes.ts
│   │
│   └── work-schedules/
│       ├── domain/
│       │   ├── value-objects/
│       │   │   └── time-of-day.vo.ts
│       │   ├── entities/
│       │   │   └── work-schedule.entity.ts
│       │   ├── errors/
│       │   │   └── work-schedule-errors.ts
│       │   └── repositories/
│       │       ├── work-schedules.repository.ts
│       │       └── collaborator-lookup.repository.ts
│       ├── application/
│       │   ├── dtos/
│       │   │   └── work-schedule.dtos.ts
│       │   ├── use-cases/
│       │   │   ├── upsert-collaborator-work-schedules.use-case.ts
│       │   │   ├── list-collaborator-work-schedules.use-case.ts
│       │   │   └── list-own-work-schedules.use-case.ts
│       │   └── __tests__/
│       │       ├── in-memory-work-schedules.repository.ts
│       │       ├── in-memory-collaborator-lookup.repository.ts
│       │       └── work-schedules.use-cases.spec.ts
│       └── infra/
│           ├── database/
│           │   ├── schema/
│           │   │   └── work-schedules-schema.ts
│           │   └── repositories/
│           │       ├── drizzle-work-schedules.repository.ts
│           │       └── drizzle-collaborator-lookup.repository.ts
│           └── http/
│               ├── schemas/
│               │   └── work-schedule-http.schemas.ts
│               ├── controllers/
│               │   └── work-schedules.controller.ts
│               ├── factories/
│               │   └── make-work-schedules-controllers.ts
│               └── routes/
│                   └── work-schedules.routes.ts
```

**Structure Decision**: Se adoptan dos módulos independientes en `kebab-case` (`src/modules/services/` y `src/modules/work-schedules/`) siguiendo exactamente la Arquitectura Hexagonal definida en la Constitución y compatible con `drizzle.config.ts` (`./src/modules/**/infra/database/schema/*.ts`) y `vitest.config.ts` (`src/**/*.spec.ts`). Los módulos preexistentes (`Company/` y `Collaborators/`) permanecen intactos para evitar refactorizaciones fuera de alcance.

## Complexity Tracking

No existen violaciones a la Constitución; no se requiere justificación de excepciones.
