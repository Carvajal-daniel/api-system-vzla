<!--
Sync Impact Report
- Version change: template (unversioned) → 1.0.0
- Modified principles: Initial ratification (I. Stack Tecnológico Oficial; II. Arquitectura Hexagonal y Regla de Dependencias; III. Aislamiento Multi-Tenant y Control de Acceso (RBAC); IV. Invariantes Críticas del Negocio y Desacoplamiento de IA; V. Flujo Obligatorio de Implementación (Anti-Vibe Coding))
- Added sections: Restricciones Técnicas y Estándares de Código; Calidad, Pruebas y Compuertas de Revisión; Governance
- Removed sections: None
- Follow-up TODOs: None (all placeholders resolved). Nota operativa fuera de la constitución: instalar y configurar Vitest en package.json antes de implementar el primer módulo nuevo.
-->

# SaaS de Gestión de Barberías y Salones Constitution

Este documento establece las leyes arquitectónicas, técnicas y de dominio innegociables del proyecto. Ningún plan, especificación, tarea o implementación puede violar estas reglas.

## Core Principles

### I. Stack Tecnológico Oficial

Todo el backend DEBE construirse exclusivamente sobre el stack oficial aprobado:

- **Lenguaje y Runtime:** Node.js con TypeScript en modo estricto (`"strict": true`). Está estrictamente prohibido el uso de `any` o `@ts-ignore`.
- **Framework HTTP:** Fastify.
- **Base de Datos y ORM:** PostgreSQL serverless en **NeonDB**, gestionado exclusivamente mediante **Drizzle ORM** con schemas tipados y migraciones explícitas versionadas.
- **Validación de Contratos:** **Zod** para validación de esquemas HTTP, variables de entorno y DTOs en la capa de frontera.
- **Seguridad y Criptografía:** **bcrypt** para hashing de contraseñas y tokens sensibles.
- **Testing:** **Vitest** para pruebas unitarias y de integración.

Cualquier sustitución de estas tecnologías o incorporación de frameworks/ORMs alternativos requiere una enmienda constitucional explícita.

### II. Arquitectura Hexagonal y Regla de Dependencias

El código DEBE organizarse por módulos de negocio, respetando tres capas concéntricas donde las dependencias apuntan estrictamente hacia adentro (`infra` → `application` → `domain`):

1. **`domain/` (Núcleo Puro):** Contiene Entidades, Value Objects, Errores de Dominio e Interfaces de Repositorios (Puertos). Es 100% TypeScript puro y tiene prohibición absoluta de importar Fastify, Drizzle, Zod, bcrypt o cualquier librería externa de infraestructura.
2. **`application/` (Casos de Uso):** Contiene los `UseCases` (una clase por acción de negocio con método `execute()`), DTOs de entrada/salida e interfaces de servicios externos (por ejemplo, notificaciones o transcripción). Solo puede depender de `domain/` y nunca conocer detalles de HTTP ni de SQL.
3. **`infra/` (Adaptadores y Frameworks):** Contiene implementaciones de repositorios con Drizzle/NeonDB, rutas y controladores Fastify, esquemas de validación Zod, adaptadores de IA/WhatsApp y composición de dependencias.

### III. Aislamiento Multi-Tenant y Control de Acceso (RBAC)

- **Aislamiento obligatorio por `companyId`:** Toda entidad operativa pertenece a una empresa (`companyId`). Toda consulta, actualización o eliminación en los repositorios DEBE incluir `companyId` como filtro obligatorio para impedir fugas de datos entre salones.
- **Control de Acceso por Rol (RBAC):**
  - `OWNER` (Dueño): Acceso total a su propio `companyId` (configuración, servicios, comisiones, agenda global, reportes financieros, inventario y alertas IA).
  - `COLLABORATOR` (Colaborador): Acceso restringido únicamente a su propia agenda, sus propias comisiones, sus evaluaciones y al registro de sus ausencias con motivo. **Un colaborador tiene estrictamente prohibido crear agendamientos por su cuenta.**
  - `CLIENT` (Cliente Final): Interactúa sin cuenta ni aplicación móvil, mediante WhatsApp (IA) o enlace web público, exclusivamente para consultar disponibilidad, agendar, reprogramar, cancelar o evaluar.

### IV. Invariantes Críticas del Negocio y Desacoplamiento de IA

- **Regla de Disponibilidad:** Un cliente puede agendar a cualquier hora siempre que coincida con un **día de trabajo activo** y exista **disponibilidad real del colaborador** (sin ausencias registradas ni citas solapadas considerando la duración del servicio). Sin disponibilidad real, la reserva DEBE rechazarse en la capa de dominio.
- **Reactividad ante Ausencias:** Registrar una ausencia de un colaborador DEBE disparar un evento o flujo para notificar automáticamente vía WhatsApp a los clientes con citas afectadas.
- **Desacoplamiento de la IA:** Los agentes de IA (atención por texto/audio en WhatsApp y análisis financiero) DEBEN implementarse como adaptadores en `infra/`. La IA interpreta intenciones o genera reportes, pero siempre invoca `UseCases` de `application/`. Tiene estrictamente prohibido escribir directamente en la base de datos o contener reglas de negocio.

### V. Flujo Obligatorio de Implementación (Anti-Vibe Coding)

Todo nuevo módulo o funcionalidad DEBE implementarse y validarse estrictamente en el siguiente orden secuencial:

1. **Capa `domain/`:** Entidades, Value Objects, Errores de Dominio e Interfaces de Repositorio.
2. **Capa `application/` + Tests Unitarios:** Casos de uso verificados mediante `InMemoryRepositories` en Vitest antes de tocar la base de datos o la capa HTTP.
3. **Capa `infra/`:** Esquemas Drizzle, migraciones, implementación real del repositorio para NeonDB, validaciones Zod y rutas/controladores Fastify.

Está prohibido saltar directamente a rutas HTTP o persistencia sin haber cerrado y probado las capas internas.

## Restricciones Técnicas y Estándares de Código

- **Convenciones de nombres:** Archivos en `kebab-case` (por ejemplo, `create-booking.use-case.ts`, `drizzle-booking.repository.ts`), clases en `PascalCase`, código fuente e identificadores en inglés, y mensajes de error orientados al usuario claros y seguros (sin exponer detalles internos).
- **Regla de transición gradual para archivos previos en `src/`:** Las convenciones de nombres (`kebab-case` en archivos y carpetas de módulo) aplican de manera obligatoria e inmediata a todo módulo o archivo nuevo. Los archivos preexistentes en `src/` que no sigan estrictamente esta convención se alinearán de forma progresiva cuando sean modificados dentro de un alcance autorizado, evitando refactorizaciones masivas fuera de alcance.
- **Integridad de tipos:** El compilador TypeScript en modo estricto debe pasar sin errores ni supresiones (`@ts-ignore`, `@ts-expect-error` sin justificación ni `any`).

## Calidad, Pruebas y Compuertas de Revisión

- **Compuerta de Dominio y Aplicación:** Ningún caso de uso puede darse por terminado sin pruebas unitarias en Vitest ejecutadas con repositorios en memoria que cubran casos exitosos, reglas de negocio, aislamiento por `companyId` y rechazos por permisos o disponibilidad.
- **Compuerta de Infraestructura:** Toda modificación de esquema en Drizzle debe acompañarse de su migración explícita y validación de entrada con Zod en la frontera HTTP.
- **Compuerta de Seguridad:** Toda revisión de código o plan DEBE verificar que las consultas estén filtradas por `companyId`, que se respete el rol (`OWNER`, `COLLABORATOR`, `CLIENT`) y que ningún secreto o hash se exponga en respuestas o logs.

## Governance

Esta Constitución prevalece sobre cualquier otra práctica, plan o borrador dentro del proyecto.

- **Procedimiento de enmienda:** Toda modificación a esta Constitución requiere justificación documentada, revisión de impacto en los módulos afectados y aprobación explícita antes de aplicarse.
- **Política de versionado (SemVer):**
  - `MAJOR`: Eliminación o redefinición incompatible de principios, arquitectura o invariantes críticas.
  - `MINOR`: Incorporación de nuevos principios, secciones o expansión sustancial de reglas.
  - `PATCH`: Aclaraciones, correcciones de redacción o ajustes menores sin cambio semántico.
- **Cumplimiento:** Todos los comandos de planificación, especificación, generación de tareas y revisiones de PR DEBEN verificar el cumplimiento de esta Constitución antes de aprobar cambios.

**Version**: 1.0.0 | **Ratified**: 2026-11-20 | **Last Amended**: 2026-11-20
