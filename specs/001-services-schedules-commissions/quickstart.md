# Quickstart & Validation Guide: Servicios, Días de Trabajo y Comisiones (Etapa 1)

**Feature**: `001-services-schedules-commissions`  
**Contract**: [contracts/openapi.yaml](./contracts/openapi.yaml)  
**Data Model**: [data-model.md](./data-model.md)

Esta guía define cómo verificar de punta a punta el módulo una vez completada su implementación (en orden: pruebas unitarias de dominio/aplicación → migración en PostgreSQL → validación HTTP).

---

## 1. Prerrequisitos

- Node.js instalado y dependencias sincronizadas (`npm install` o `yarn install`).
- Variables de entorno configuradas en `.env`:
  - `DATABASE_URL`: cadena de conexión a PostgreSQL / NeonDB de desarrollo.
  - `JWT_SECRET`: secreto para firmar/verificar los tokens JWT en pruebas HTTP locales.
  - `PORT`: puerto del servidor (por defecto `3908`).

---

## 2. Verificación de Capas Internas (Dominio y Aplicación — Sin Base de Datos)

Ejecutar el verificador de tipos en modo estricto y las pruebas unitarias en Vitest con `InMemoryRepositories`:

```powershell
npx tsc --noEmit
npm test
```

**Resultado esperado**:
- `tsc --noEmit` finaliza con código `0` sin errores ni uso de `any`/`@ts-ignore`.
- Todos los tests de `services/` y `work-schedules/` pasan cubriendo:
  - Creación, edición, listado y desactivación/reactivación de servicios (incluyendo unicidad normalizada, `priceInCents = 0`, rechazo de `durationMinutes <= 0` y `priceInCents < 0`).
  - Vinculación de colaboradores, actualización de comisión (`0..100`), desvinculación y rechazos por comisión inválida o duplicada.
  - Configuración de horarios semanales (`0..6`, `endTime > startTime`, descansos estrictamente dentro de `[startTime, endTime]`, días inactivos).
  - Aislamiento estricto por `companyId` (100% de accesos entre empresas rechazados).
  - Control de acceso RBAC (100% de mutaciones por `COLLABORATOR` rechazadas; consultas `/me/*` aisladas al propio colaborador).
  - Catálogo público (solo servicios activos y colaboradores habilitados, sin comisiones ni datos de otras empresas).

---

## 3. Migración de Base de Datos y Arranque del Servidor

Generar/aplicar la migración Drizzle y levantar el servidor local:

```powershell
npx drizzle-kit migrate
npm run dev
```

**Resultado esperado**:
- Las tablas `services`, `collaborator_services` y `work_schedules` se crean con sus índices y restricciones `CHECK`.
- El servidor Fastify inicia en `http://localhost:3908`.
- Si Swagger UI está habilitado en desarrollo, la documentación interactiva responde en `http://localhost:3908/docs` sin errores de esquema OpenAPI.

---

## 4. Escenarios de Validación End-to-End (HTTP)

Los payloads exactos y códigos de respuesta están especificados en [contracts/openapi.yaml](./contracts/openapi.yaml).

### Escenario A — Flujo Completo del Dueño (`OWNER`)
1. `POST /services` con JWT de `OWNER` (empresa A): crear `"Corte Clásico"` (`durationMinutes: 45`, `priceInCents: 3500`) → `201 Created` con `active: true`.
2. Repetir `POST /services` con `"  corte clásico  "` → `409 Conflict`.
3. `POST /services/:serviceId/collaborators` con colaborador de empresa A y `commissionPercentage: 40` → `201 Created`.
4. `PATCH /services/:serviceId/collaborators/:collaboratorId` con `commissionPercentage: 50` → `200 OK`.
5. `PUT /collaborators/:collaboratorId/work-schedules` configurando lunes (`dayOfWeek: 1`, `09:00`–`18:00`, descanso `12:00`–`13:00`) y domingo (`dayOfWeek: 0`, `isWorkingDay: false`) → `200 OK`.

### Escenario B — Aislamiento Multi-Tenant y RBAC
1. Con JWT de `OWNER` de empresa B, intentar `PATCH /services/:serviceIdDeEmpresaA` → `404 Not Found` (sin revelar datos).
2. Con JWT de `COLLABORATOR` de empresa A, intentar `POST /services` o `PUT /collaborators/:id/work-schedules` → `403 Forbidden`.
3. Con JWT de `COLLABORATOR` de empresa A, consultar `GET /me/services` y `GET /me/work-schedules` → `200 OK` mostrando solo sus servicios vinculados, sus comisiones y su propia grilla.

### Escenario C — Catálogo Público para Clientes (`CLIENT`)
1. Sin cabecera `Authorization`, llamar `GET /public/companies/:companyAId/services` → `200 OK` con `"Corte Clásico"` y el colaborador vinculado (`id`, `name`, `specialty`), **sin** `commissionPercentage`.
2. Desactivar el servicio como `OWNER` (`PATCH /services/:serviceId/status` con `{ "active": false }`) → `200 OK`.
3. Volver a consultar `GET /public/companies/:companyAId/services` → el servicio desactivado ya no aparece en `services`.
