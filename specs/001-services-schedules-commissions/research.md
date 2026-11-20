# Research & Technical Decisions: Servicios, Días de Trabajo y Comisiones (Etapa 1)

**Feature**: `001-services-schedules-commissions`  
**Date**: 2026-11-20  
**Spec**: [spec.md](./spec.md)

Este documento consolida las decisiones técnicas y arquitectónicas tomadas a partir de la inspección del repositorio real y la Constitución del proyecto (`.specify/memory/constitution.md`). Todos los puntos de contexto técnico han quedado resueltos sin elementos `NEEDS CLARIFICATION`.

---

## 1. Organización Modular y Convenciones de Nombres

- **Decision**: Crear dos módulos nuevos cohesivos en `kebab-case` bajo `src/modules/`:
  - `src/modules/services/` — dueño de `Service` (catálogo de servicios), `CollaboratorService` (vínculo colaborador-servicio y comisión) y la consulta pública del catálogo.
  - `src/modules/work-schedules/` — dueño de `WorkSchedule` (días y horarios semanales de trabajo con descanso opcional por colaborador).
- **Rationale**:
  - Respeta la Constitución (Principio II: Arquitectura Hexagonal `infra` → `application` → `domain`; y Regla de transición gradual: todo módulo y archivo nuevo usa `kebab-case`).
  - `drizzle.config.ts` ya escanea automáticamente `./src/modules/**/infra/database/schema/*.ts`, por lo que los nuevos esquemas en `src/modules/services/infra/database/schema/` y `src/modules/work-schedules/infra/database/schema/` se integran sin modificar la configuración de Drizzle.
  - Agrupar `Service` y `CollaboratorService` en `services/` evita dependencias circulares entre dos módulos diminutos y refleja que el catálogo público (`GET /public/companies/:companyId/services`) consulta servicios activos junto con sus colaboradores vinculados.
- **Alternatives considered**:
  - *Un único módulo gigante (`catalog-and-schedules`)*: Descartado porque mezcla catálogo comercial/comisiones con configuración temporal/horaria de colaboradores.
  - *Tres módulos separados (`services`, `commissions`, `work-schedules`)*: Descartado porque `CollaboratorService` no tiene ciclo de vida independiente de `Service` en la Etapa 1 y fragmentaría innecesariamente el catálogo público.

---

## 2. Contexto de Autenticación, RBAC y Aislamiento Multi-Tenant

- **Decision**:
  - En `domain/` y `application/`, toda operación protegida recibe un `ActorContext` tipado (unión discriminada: `{ role: 'OWNER'; companyId: string; userId: string } | { role: 'COLLABORATOR'; companyId: string; collaboratorId: string }`) y valida explícitamente el rol y el `companyId` antes de acceder a repositorios.
  - En `infra/http/` (`src/shared/http/auth/authenticate.ts`), se implementa un `preHandler` reutilizable de Fastify que valida el token `Bearer` mediante `jsonwebtoken` (ya instalado en `package.json`, `^9.0.3`) usando `process.env.JWT_SECRET`, decodifica y valida con Zod el payload (`sub`, `companyId`, `role`) y expone `request.actor`. Se añade un helper `authorizeRoles(...roles)` para restringir endpoints por rol.
  - El `companyId` en rutas protegidas **siempre** proviene de `request.actor.companyId`, nunca del body, query ni headers arbitrarios del cliente.
- **Rationale**:
  - El repositorio aún no cuenta con endpoints de login ni middleware JWT, pero `jsonwebtoken` ya forma parte de las dependencias instaladas. Implementar la verificación JWT en `src/shared/http/auth/` garantiza que ninguna ruta protegida quede abierta y que las pruebas HTTP/integración puedan firmar tokens reales de prueba sin inventar un módulo de login fuera de alcance.
  - Mantener `ActorContext` en `application/` permite probar 100% de las reglas de RBAC y aislamiento multi-tenant en Vitest usando `InMemoryRepositories` (Principio V y Compuerta de Dominio).
- **Alternatives considered**:
  - *Leer `x-company-id` o `x-role` desde headers HTTP sin firma*: Descartado por violar gravemente la seguridad y el Principio III (el cliente podría suplantar identidad y empresa).
  - *Implementar el módulo completo de Login/Refresh Tokens en esta etapa*: Descartado por estar explícitamente fuera del alcance de Etapa 1 según `spec.md` (Assumptions).

---

## 3. Consulta Cruzada de Colaboradores sin Romper Arquitectura Hexagonal

- **Decision**: Cada módulo nuevo (`services/` y `work-schedules/`) define un puerto mínimo de solo lectura en su capa `domain/` (por ejemplo, `CollaboratorLookupRepository` con `findByIdInCompany(collaboratorId, companyId)` y `findActivePublicByIdsInCompany(ids, companyId)`) implementado en su propia capa `infra/database/repositories/` consultando `CollaboratorTable` filtrado siempre por `company_id`.
- **Rationale**:
  - Cumple la Regla de Dependencias (`application/` solo depende de interfaces en `domain/`, nunca importa `drizzle-orm` ni `Collaborators/infra`).
  - Permite que los tests unitarios de `services/` y `work-schedules/` usen dobles en memoria (`InMemoryCollaboratorLookupRepository`) sin depender de PostgreSQL.
  - No requiere refactorizar el módulo preexistente `src/modules/Collaborators/`.
- **Alternatives considered**:
  - *Importar `CollaboratorRepositoryDB` directamente desde `use-cases`*: Descartado por violar el Principio II (dependencia desde `application/` hacia `infra/`).
  - *Ampliar `CollaboratorsRepository` en `src/modules/Collaborators/` y compartirlo*: Posible, pero acopla los nuevos módulos a un módulo legacy con convenciones anteriores; un puerto de lectura pequeño por módulo mantiene fronteras limpias.

---

## 4. Unicidad Normalizada de Nombres de Servicios y Manejo de Concurrencia

- **Decision**:
  - En `domain/`, la entidad `Service` recorta espacios extremos (`trim()`) al almacenar `name`, rechaza cadenas vacías y calcula `normalizedName = name.trim().toLowerCase()`.
  - En PostgreSQL, se define un índice único funcional: `UNIQUE (company_id, lower(btrim(name)))` (o columna normalizada/expresión en Drizzle con `sql` en `uniqueIndex`).
  - El repositorio de infraestructura captura el error de violación de unicidad de PostgreSQL (`code === '23505'`) y lo traduce al error de dominio `ServiceNameAlreadyExistsError`.
- **Rationale**:
  - Cumple `FR-004` y `FR-016` (validación previa en lógica de negocio) y adicionalmente protege contra condiciones de carrera cuando dos solicitudes simultáneas intentan crear el mismo nombre en la misma empresa.
  - Mantiene la presentación original del nombre elegido por el `OWNER` (ej. `"Corte Clásico"`) mientras bloquea duplicados como `"  corte clásico  "`.
- **Alternatives considered**:
  - *Validar solo en memoria/consulta previa sin índice único en DB*: Descartado por ser vulnerable a condiciones de carrera concurrentes.
  - *Guardar `name` siempre en minúsculas*: Descartado porque degrada la presentación en el catálogo público.

---

## 5. Representación de Precios, Comisiones y Horarios

- **Decision**:
  - **Precio (`priceInCents`)**: `integer` en PostgreSQL con `CHECK (price_in_cents >= 0)`. En dominio: `Number.isInteger(priceInCents) && priceInCents >= 0`.
  - **Duración (`durationMinutes`)**: `integer` en PostgreSQL con `CHECK (duration_minutes > 0)`. En dominio: `Number.isInteger(durationMinutes) && durationMinutes > 0`.
  - **Comisión (`commissionPercentage`)**: `numeric(5, 2)` con `{ mode: 'number' }` en Drizzle (coherente con `CollaboratorTable`) y `CHECK (commission_percentage >= 0 AND commission_percentage <= 100)`. En dominio: número finito, `0 <= value <= 100` y máximo 2 decimales (`Math.round(value * 100) === Number((value * 100).toFixed(6))` / verificación decimal exacta sin errores de coma flotante).
  - **Horarios (`startTime`, `endTime`, `breakStart`, `breakEnd`)**: `varchar(5)` (`HH:MM` en formato 24h) nullable en PostgreSQL (nulos cuando `is_working_day = false`, y `break_start`/`break_end` nulos cuando no hay pausa). Validación en dominio mediante Value Object `TimeOfDay` (`/^([01]\d|2[0-3]):[0-5]\d$/`, conversión a minutos totales para comparar `startTime < endTime` y `startTime < breakStart < breakEnd < endTime`).
- **Rationale**:
  - Evita errores de precisión de punto flotante en montos monetarios (centavos enteros) y comisiones (`numeric(5,2)`).
  - Almacenar `HH:MM` como `varchar(5)` evita conversiones implícitas de zona horaria del tipo `time with time zone` y coincide exactamente con `spec.md` (Assumptions: hora local del salón, sin cruce de medianoche).
  - La columna existente `collaborators.commission_percentage` no se elimina ni modifica en esta etapa para no causar regresiones en `src/modules/Collaborators/`.
- **Alternatives considered**:
  - *Usar tipo `time` de PostgreSQL*: Devuelve `HH:MM:SS` al leer con `node-postgres`, obligando a formatear/truncar segundos constantemente sin aportar valor en Etapa 1.
  - *Guardar horarios como minutos enteros (`540` para `"09:00"`)*: Válido internamente para comparar, pero menos legible en DB y contratos HTTP; un Value Object `TimeOfDay` da ambos beneficios.

---

## 6. Configuración Semanal de Horarios (Operación Batch Idempotente)

- **Decision**: Exponer `PUT /collaborators/:collaboratorId/work-schedules` recibiendo un arreglo `schedules` (1 a 7 días distintos) que realiza `UPSERT` atómico dentro de una transacción de base de datos, además de `GET /collaborators/:collaboratorId/work-schedules` para consultar la grilla completa.
- **Rationale**:
  - Permite configurar toda la semana laboral de un colaborador en una sola solicitud o actualizar un solo día enviando 1 elemento, logrando el objetivo de usabilidad `SC-001` (< 3 minutos).
  - Al ser un `UPSERT` transaccional por `(company_id, collaborator_id, day_of_week)`, evita estados parciales si un día falla validación o persistencia.
  - Toda validación de negocio de todos los elementos del lote se ejecuta en `domain/` antes de abrir cualquier escritura en persistencia (`FR-016`).
- **Alternatives considered**:
  - *Solo endpoints individuales por día (`PUT .../work-schedules/:dayOfWeek`)*: Obliga al cliente a hacer hasta 7 llamadas HTTP secuenciales para configurar una semana.

---

## 7. Manejo de Errores, Strict TypeScript y OpenAPI/Swagger

- **Decision**:
  - Crear una clase base pura `DomainError` en `src/shared/errors/domain-error.ts` (sin `statusCode` ni dependencias de HTTP) para todos los errores de dominio de los nuevos módulos.
  - Registrar en `src/shared/http/App.ts` un error handler centralizado que traduzca `ZodError` (400), `DomainError` por tipo/código de dominio (400/401/403/404/409) y `AppError` (compatibilidad con módulos existentes), ocultando stack traces y detalles internos en 500.
  - Respetar estrictamente la configuración actual de `tsconfig.json`: `"strict": true`, `"exactOptionalPropertyTypes": true`, `"noUncheckedIndexedAccess": true`, `"verbatimModuleSyntax": true`, `"moduleResolution": "NodeNext"` (imports con `.js`).
  - Documentar el contrato HTTP completo en `specs/001-services-schedules-commissions/contracts/openapi.yaml` (OpenAPI 3.1). En la implementación HTTP, se propone instalar `@fastify/swagger` y `@fastify/swagger-ui` (solo habilitado cuando `NODE_ENV !== 'production'`), sujeto a aprobación explícita del usuario por tratarse de nuevas dependencias.
- **Rationale**:
  - Mantiene `domain/` 100% agnóstico a HTTP (Principio II), cumple la Regla de Documentación de APIs (OpenAPI/Swagger sin exposición pública en producción) y evita duplicar bloques `try/catch` repetitivos en cada controlador.
- **Alternatives considered**:
  - *Usar `AppError(message, statusCode)` directamente en `domain/`*: Descartado porque acopla la capa de dominio a códigos HTTP.
