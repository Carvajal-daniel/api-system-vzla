# Research & Technical Decisions: Etapa 3 — Motor de Agendamientos, Disponibilidad y Bloqueios

**Feature**: `002-appointments-availability-blocks`  
**Date**: 2026-11-20

## 1. Conversión de Zona Horaria (IANA) sin Dependencias Externas

- **Decision**: Implementar una utilidad pura de zona horaria en `src/modules/appointments/domain/services/timezone-utils.ts` basada exclusivamente en `Intl.DateTimeFormat` nativo de Node.js (v20+), soportando:
  1. Validación de identificadores IANA (`isValidIanaTimeZone`).
  2. Conversión de una fecha local (`YYYY-MM-DD`) + hora local (`HH:MM`) en una zona IANA a instante UTC (`Date`), manejando correctamente offsets y DST (horario de verano) mediante iteración de convergencia de offset (`formatToParts`).
  3. Obtención de la fecha local (`YYYY-MM-DD`), `dayOfWeek` (`0`–`6`) y minutos desde medianoche local para un instante UTC dado.
- **Rationale**:
  - Respeta la Constitución (Principio I y II): `domain/` permanece 100% TypeScript puro y evita instalar librerías nuevas (`luxon`, `dayjs`, `date-fns-tz`) cuando el runtime Node.js ya incluye datos ICU completos.
  - Garantiza que una cita a las `22:00` en `America/Caracas` (UTC-4) se evalúe correctamente contra el día local correcto aunque en UTC ya sea `02:00` del día siguiente.
- **Alternatives considered**:
  - Instalar `luxon` o `date-fns-tz`: descartado para mantener el stack ligero y no introducir dependencias externas sin necesidad real.
  - Usar offsets fijos manuales (ej. `-04:00`): descartado porque falla con zonas que aplican DST si una empresa usa otra zona IANA en el futuro.

## 2. Prevención de Doble Reserva Concurrente (Double-Booking)

- **Decision**: Usar una transacción PostgreSQL (`db.transaction`) combinada con un **advisory lock transaccional por colaborador**:
  ```sql
  SELECT pg_advisory_xact_lock(hashtext($lockKey))
  ```
  donde `$lockKey = "appointment:${companyId}:${collaboratorId}"`. Dentro de la misma transacción, después de adquirir el lock:
  1. Se consultan citas solapadas activas (`status IN ('PENDING', 'CONFIRMED') AND starts_at < $endsAt AND ends_at > $startsAt`, excluyendo `id != $excludeAppointmentId` en reprogramaciones).
  2. Si existe solapamiento, se lanza `AppointmentTimeConflictError` (`409 CONFLICT`) haciendo rollback automático y liberando el lock.
  3. Si está libre, se ejecuta el `INSERT` o `UPDATE` y al hacer `COMMIT` PostgreSQL libera el lock automáticamente.
  En los tests unitarios con `InMemoryAppointmentsRepository`, se implementa un mutex en memoria por `${companyId}:${collaboratorId}` que serializa las promesas concurrentes de forma equivalente.
- **Rationale**:
  - Funciona de forma nativa en PostgreSQL / NeonDB sin depender de habilitar extensiones como `btree_gist` (necesaria para `EXCLUDE USING gist`).
  - Bloquea únicamente el par `(companyId, collaboratorId)` durante unos milisegundos, sin degradar el rendimiento de otros colaboradores u otras empresas.
  - Sirve tanto para `create` como para `reschedule` (incluyendo cambio de colaborador en reprogramación, bloqueando al colaborador destino).
- **Alternatives considered**:
  - `EXCLUDE USING gist` con `tstzrange`: muy sólido, pero requiere `CREATE EXTENSION btree_gist` en NeonDB y complica el rollback/testing si la extensión no está prehabilitada; puede agregarse luego como capa defensiva extra si se desea.
  - Solo `SELECT` + `INSERT` sin lock: vulnerable a race conditions (TOCTOU) cuando dos peticiones llegan al mismo tiempo.
  - `SERIALIZABLE` isolation level: genera errores `40001` que requieren bucles de reintento complejos en toda la transacción.

## 3. Validación Completa de Disponibilidad al Crear y Reprogramar Citas

- **Decision**: Extraer un servicio de dominio reutilizable `AvailabilityValidator` (o método en `AvailabilityCalculator`) invocado tanto por `CreateAppointmentUseCase` (público y `OWNER`) como por `RescheduleAppointmentUseCase`:
  - Valida `startsAt > now` (no permite horarios en el pasado).
  - Deriva `endsAt = startsAt + service.durationMinutes * 60_000` (nunca aceptado del cliente).
  - Verifica que `[startsAt, endsAt)` caiga en un mismo día calendario local de `company.timezone` donde exista un `WorkSchedule` con `isWorkingDay = true`.
  - Verifica `slotStart >= workSchedule.startTime` y `slotEnd <= workSchedule.endTime`.
  - Verifica que `[startsAt, endsAt)` no intersecte `[breakStart, breakEnd)` si el colaborador tiene descanso configurado.
  - Verifica que `[startsAt, endsAt)` no intersecte ningún `ScheduleBlock` (ni del colaborador ni global de la empresa).
  - Finalmente, dentro del lock transaccional, verifica ausencia de citas activas (`PENDING`, `CONFIRMED`) solapadas.
- **Rationale**: Cumple el ajuste obligatorio de nunca asumir que el cliente consultó `/availability` previamente y garantiza la invariante constitucional IV incluso ante llamadas directas a la API o desde un agente de IA.
- **Alternatives considered**: Validar solo contra citas existentes: descartado porque permitiría reservar en días no laborables, durante descansos o sobre bloqueos.

## 4. Organización Modular y Alineación con Módulos Existentes

- **Decision**: Crear un único módulo cohesionado `src/modules/appointments/` con estructura estándar de 3 capas (`domain/`, `application/`, `infra/`), siguiendo exactamente el patrón de `src/modules/services/` y `src/modules/work-schedules/`. Además, agregar la columna `timezone` en `src/modules/Company/infra/database/schema/companies-schema.ts` con default `"America/Caracas"` mediante la migración `0004_appointments_and_schedule_blocks.sql`.
- **Rationale**: `ScheduleBlock`, `Appointment` y `AvailabilityCalculator` comparten exactamente el mismo contexto de lectura (`Company` activa + `timezone`, `Service` activo, `Collaborator` activo + `CollaboratorService` + `WorkSchedule`) y se afectan mutuamente (crear un `ScheduleBlock` consulta `Appointment` afectados; crear un `Appointment` valida contra `ScheduleBlock`). Mantenerlos en un solo módulo evita dependencias circulares entre módulos hermanos.
- **Alternatives considered**: Separar en `src/modules/schedule-blocks/` y `src/modules/appointments/`: descartado porque generaría acoplamiento cruzado entre ambos módulos y duplicaría repositorios de lookup.

## 5. Reactividad ante Ausencias (Puerto Desacoplado para Etapa 5)

- **Decision**: Definir la interfaz `AbsenceNotificationPort` en `src/modules/appointments/application/ports/absence-notification.port.ts` con el método `notifyAffectedAppointments(payload)` y proveer `NoopAbsenceNotificationAdapter` en `infra/` que registra un log estructurado (sin datos sensibles) en Etapa 3. Adicionalmente, `CreateScheduleBlockUseCase` devuelve `{ block, affectedAppointments }` en la respuesta HTTP para ambos actores (`OWNER` y `COLLABORATOR`).
- **Rationale**: Satisface el Principio IV de la Constitución ("Reactividad ante Ausencias" + "Desacoplamiento de la IA") sin acoplar Etapa 3 a WhatsApp (Etapa 5).
- **Alternatives considered**: Cancelar automáticamente las citas afectadas al crear un bloqueo: descartado porque en la operación real el salón/cliente puede preferir reprogramar en lugar de cancelar silenciosamente.
