# Data Model: Servicios, Días de Trabajo y Comisiones (Etapa 1)

**Feature**: `001-services-schedules-commissions`  
**Date**: 2026-11-20  
**Spec**: [spec.md](./spec.md)

---

## 1. Visión General de Entidades y Relaciones

```text
companies (existente)
  ├── 1:N ── collaborators (existente)
  ├── 1:N ── services (NUEVO)
  ├── 1:N ── collaborator_services (NUEVO) ── N:1 ── collaborators & services
  └── 1:N ── work_schedules (NUEVO)        ── N:1 ── collaborators
```

Todas las nuevas tablas incluyen `company_id` obligatorio con clave foránea a `companies.id` e índices orientados a consultas multi-tenant.

---

## 2. Entidad: `Service` (Tabla: `services`)

Representa un servicio ofrecido por una empresa en su catálogo comercial.

### Atributos de Dominio (`src/modules/services/domain/entities/service.entity.ts`)

| Campo | Tipo TS | Restricciones de Dominio |
|-------|---------|--------------------------|
| `id` | `string` (UUID) | Generado con `randomUUID()` al crear |
| `companyId` | `string` (UUID) | Obligatorio, no vacío |
| `name` | `string` | Obligatorio, `trim()`, longitud `1..120` |
| `description` | `string \| null` | Opcional; si se envía vacío tras `trim()`, se normaliza a `null` (máx. 500 chars) |
| `durationMinutes` | `number` | Entero positivo (`Number.isInteger` y `> 0`) |
| `priceInCents` | `number` | Entero no negativo (`Number.isInteger` y `>= 0`) |
| `active` | `boolean` | `true` por defecto al crear |
| `createdAt` | `Date` | Timestamp de creación |
| `updatedAt` | `Date` | Timestamp de última actualización |

### Reglas de Negocio e Invariantes

- `Service.create(...)` y `service.update(...)` validan nombre no vacío, `durationMinutes > 0` (entero) y `priceInCents >= 0` (entero) antes de devolver/mutar la entidad.
- Unicidad de nombre por empresa: `name.trim().toLowerCase()` debe ser único dentro del mismo `companyId`.
- Transiciones de estado:
  - `active: true` → `active: false` (`deactivate()`): oculta el servicio del catálogo público (`CLIENT`), mantiene visibilidad para `OWNER` y preserva vínculos e historiales futuros.
  - `active: false` → `active: true` (`activate()`): vuelve a mostrar el servicio en el catálogo público.

### Esquema Drizzle / PostgreSQL (`src/modules/services/infra/database/schema/services-schema.ts`)

- **Tabla**: `services`
- **Columnas**:
  - `id`: `uuid('id').primaryKey().defaultRandom()`
  - `company_id`: `uuid('company_id').notNull().references(() => CompanyTable.id, { onDelete: 'cascade' })`
  - `name`: `text('name').notNull()`
  - `description`: `text('description')` (nullable)
  - `duration_minutes`: `integer('duration_minutes').notNull()`
  - `price_in_cents`: `integer('price_in_cents').notNull()`
  - `active`: `boolean('active').notNull().default(true)`
  - `created_at`: `timestamp('created_at', { withTimezone: true }).notNull().defaultNow()`
  - `updated_at`: `timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()`
- **Restricciones e Índices**:
  - `CHECK (duration_minutes > 0)`
  - `CHECK (price_in_cents >= 0)`
  - `UNIQUE INDEX services_company_normalized_name_uidx ON services (company_id, lower(btrim(name)))`
  - `INDEX services_company_active_idx ON services (company_id, active)` (optimiza el listado público de servicios activos y el listado del `OWNER`).

---

## 3. Entidad: `CollaboratorService` (Tabla: `collaborator_services`)

Representa la habilitación de un colaborador para prestar un servicio específico dentro de la misma empresa y su porcentaje de comisión vigente.

### Atributos de Dominio (`src/modules/services/domain/entities/collaborator-service.entity.ts`)

| Campo | Tipo TS | Restricciones de Dominio |
|-------|---------|--------------------------|
| `id` | `string` (UUID) | Generado con `randomUUID()` al crear |
| `companyId` | `string` (UUID) | Obligatorio; debe coincidir con `service.companyId` y `collaborator.companyId` |
| `collaboratorId` | `string` (UUID) | Obligatorio |
| `serviceId` | `string` (UUID) | Obligatorio |
| `commissionPercentage` | `number` | Número finito, `0 <= commissionPercentage <= 100`, máximo 2 decimales |
| `createdAt` | `Date` | Timestamp de creación |
| `updatedAt` | `Date` | Timestamp de última actualización |

### Reglas de Negocio e Invariantes

- Un par `(collaboratorId, serviceId)` solo puede existir una vez por `companyId`.
- Ambos (`collaboratorId` y `serviceId`) deben existir y pertenecer exactamente al `companyId` del `OWNER` autenticado.
- `updateCommission(newPercentage)` valida el rango `0..100` (hasta 2 decimales) antes de persistir. En Etapa 1 actualiza la configuración vigente; los agendamientos futuros (Etapa 2) copiarán este valor para preservar el histórico.
- Desvincular elimina el registro de `collaborator_services` filtrado por `(companyId, collaboratorId, serviceId)`.

### Esquema Drizzle / PostgreSQL (`src/modules/services/infra/database/schema/collaborator-services-schema.ts`)

- **Tabla**: `collaborator_services`
- **Columnas**:
  - `id`: `uuid('id').primaryKey().defaultRandom()`
  - `company_id`: `uuid('company_id').notNull().references(() => CompanyTable.id, { onDelete: 'cascade' })`
  - `collaborator_id`: `uuid('collaborator_id').notNull().references(() => CollaboratorTable.id, { onDelete: 'cascade' })`
  - `service_id`: `uuid('service_id').notNull().references(() => ServiceTable.id, { onDelete: 'cascade' })`
  - `commission_percentage`: `numeric('commission_percentage', { precision: 5, scale: 2, mode: 'number' }).notNull()`
  - `created_at`: `timestamp('created_at', { withTimezone: true }).notNull().defaultNow()`
  - `updated_at`: `timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()`
- **Restricciones e Índices**:
  - `CHECK (commission_percentage >= 0 AND commission_percentage <= 100)`
  - `UNIQUE INDEX collaborator_services_company_collab_service_uidx ON collaborator_services (company_id, collaborator_id, service_id)`
  - `INDEX collaborator_services_company_service_idx ON collaborator_services (company_id, service_id)` (optimiza consulta pública de colaboradores por servicio)
  - `INDEX collaborator_services_company_collab_idx ON collaborator_services (company_id, collaborator_id)` (optimiza vista de solo lectura del `COLLABORATOR`)

---

## 4. Entidad: `WorkSchedule` (Tabla: `work_schedules`)

Representa la configuración de disponibilidad semanal de un colaborador para un día específico de la semana dentro de su `companyId`.

### Value Object: `TimeOfDay` (`src/modules/work-schedules/domain/value-objects/time-of-day.vo.ts`)

- Acepta formato 24 horas estricto `HH:MM` (`/^([01]\d|2[0-3]):[0-5]\d$/`).
- Expone `value: string` (`"09:00"`) y `toMinutes(): number` (`540`) para comparaciones deterministas.

### Atributos de Dominio (`src/modules/work-schedules/domain/entities/work-schedule.entity.ts`)

| Campo | Tipo TS | Restricciones de Dominio |
|-------|---------|--------------------------|
| `id` | `string` (UUID) | Generado con `randomUUID()` al crear |
| `companyId` | `string` (UUID) | Obligatorio |
| `collaboratorId` | `string` (UUID) | Obligatorio; debe pertenecer a `companyId` |
| `dayOfWeek` | `number` | Entero `0..6` (`0` = Domingo, `6` = Sábado) |
| `isWorkingDay` | `boolean` | Indica si el colaborador atiende ese día |
| `startTime` | `string \| null` | Obligatorio (`HH:MM`) si `isWorkingDay === true`; `null` si `isWorkingDay === false` |
| `endTime` | `string \| null` | Obligatorio (`HH:MM`) y `> startTime` si `isWorkingDay === true`; `null` si `isWorkingDay === false` |
| `breakStart` | `string \| null` | Opcional si `isWorkingDay === true` (requiere `breakEnd`); `null` si `isWorkingDay === false` |
| `breakEnd` | `string \| null` | Opcional si `isWorkingDay === true` (requiere `breakStart`); `null` si `isWorkingDay === false` |
| `createdAt` | `Date` | Timestamp de creación |
| `updatedAt` | `Date` | Timestamp de última actualización |

### Reglas de Negocio e Invariantes

- `dayOfWeek` debe ser entero entre `0` y `6`.
- Si `isWorkingDay === true`:
  - `startTime` y `endTime` son obligatorios, válidos en formato `HH:MM` y cumplen `startTime < endTime`.
  - Si se informa `breakStart` o `breakEnd`, ambos deben estar presentes, ser válidos en formato `HH:MM` y cumplir estrictamente `startTime < breakStart < breakEnd < endTime`.
- Si `isWorkingDay === false`:
  - `startTime`, `endTime`, `breakStart` y `breakEnd` se normalizan a `null`.
- Un día sin registro en `work_schedules` o con `isWorkingDay = false` significa **sin disponibilidad**.

### Esquema Drizzle / PostgreSQL (`src/modules/work-schedules/infra/database/schema/work-schedules-schema.ts`)

- **Tabla**: `work_schedules`
- **Columnas**:
  - `id`: `uuid('id').primaryKey().defaultRandom()`
  - `company_id`: `uuid('company_id').notNull().references(() => CompanyTable.id, { onDelete: 'cascade' })`
  - `collaborator_id`: `uuid('collaborator_id').notNull().references(() => CollaboratorTable.id, { onDelete: 'cascade' })`
  - `day_of_week`: `smallint('day_of_week').notNull()`
  - `is_working_day`: `boolean('is_working_day').notNull().default(false)`
  - `start_time`: `varchar('start_time', { length: 5 })` (nullable)
  - `end_time`: `varchar('end_time', { length: 5 })` (nullable)
  - `break_start`: `varchar('break_start', { length: 5 })` (nullable)
  - `break_end`: `varchar('break_end', { length: 5 })` (nullable)
  - `created_at`: `timestamp('created_at', { withTimezone: true }).notNull().defaultNow()`
  - `updated_at`: `timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()`
- **Restricciones e Índices**:
  - `CHECK (day_of_week >= 0 AND day_of_week <= 6)`
  - `CHECK ((is_working_day = false AND start_time IS NULL AND end_time IS NULL AND break_start IS NULL AND break_end IS NULL) OR (is_working_day = true AND start_time IS NOT NULL AND end_time IS NOT NULL AND end_time > start_time))`
  - `CHECK ((break_start IS NULL AND break_end IS NULL) OR (break_start IS NOT NULL AND break_end IS NOT NULL AND break_start > start_time AND break_end > break_start AND break_end < end_time))`
  - `UNIQUE INDEX work_schedules_company_collab_day_uidx ON work_schedules (company_id, collaborator_id, day_of_week)`
  - `INDEX work_schedules_company_collab_idx ON work_schedules (company_id, collaborator_id)`

---

## 5. Notas de Migración

- Se generará una única migración SQL versionada con Drizzle Kit (`npx drizzle-kit generate`) en `src/shared/database/migrations/` que crea las tablas `services`, `collaborator_services` y `work_schedules`, junto con todas sus restricciones `CHECK`, claves foráneas e índices únicos/compuestos.
- No se modifican las tablas existentes `companies` ni `collaborators`.
