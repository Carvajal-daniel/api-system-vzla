# Feature Specification: Servicios, Días de Trabajo y Comisiones (Etapa 1)

**Feature Branch**: `001-services-schedules-commissions`

**Created**: 2026-11-20

**Status**: Draft

**Input**: User description: "Especificação do Módulo: Serviços, Dias de Trabalho e Comissões (Etapa 1) — Permitir que o Dono (OWNER) configure o catálogo de serviços do seu salão/barbearia, associe quais colaboradores realizam cada serviço com suas respectivas porcentagens de comissão, e defina os dias e horários de trabalho ativos de cada colaborador."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Gestión del catálogo de servicios por el Dueño (Priority: P1)

Como Dueño (`OWNER`) de un salón o barbería, quiero crear, editar, listar y desactivar (o reactivar) los servicios que ofrece mi negocio para mantener actualizado el catálogo con sus precios y duraciones.

**Why this priority**: El catálogo de servicios es la base indispensable para vincular colaboradores, definir comisiones y habilitar futuros agendamientos. Sin servicios configurados no existe oferta comercial en el sistema.

**Independent Test**: Se puede probar de forma independiente creando servicios para una empresa, listándolos, editando precio/duración/nombre, desactivándolos y verificando que se rechacen nombres duplicados, valores inválidos y accesos de otra empresa.

**Acceptance Scenarios**:

1. **Given** un `OWNER` autenticado perteneciente a una empresa (`companyId`), **When** crea un servicio con nombre único, descripción opcional, duración positiva en minutos (ej. 45) y precio entero no negativo en centavos (ej. 3500), **Then** el servicio queda registrado como activo (`active: true`) y asociado exclusivamente a su `companyId`.
2. **Given** un servicio existente en la empresa del `OWNER`, **When** intenta crear otro servicio con el mismo nombre (ignorando mayúsculas/minúsculas y espacios extremos) dentro del mismo `companyId`, **Then** la operación es rechazada indicando que ya existe un servicio con ese nombre en la empresa.
3. **Given** un `OWNER` intentando crear o editar un servicio con duración menor o igual a cero (`<= 0`) o precio negativo (`< 0`), **When** envía la solicitud, **Then** la operación es rechazada por validación de negocio antes de persistir datos.
4. **Given** un servicio activo en la empresa del `OWNER`, **When** lo edita para actualizar sus datos o lo desactiva (`active: false`), **Then** los cambios quedan guardados y el servicio permanece visible en el listado del `OWNER` con su nuevo estado.
5. **Given** un `OWNER` de la empresa A, **When** intenta consultar, editar o desactivar un servicio perteneciente a la empresa B, **Then** la operación es rechazada y no se revela ni altera información de la empresa B.

---

### User Story 2 - Vinculación de colaboradores a servicios y gestión de comisiones (Priority: P2)

Como Dueño (`OWNER`), quiero asociar qué colaboradores de mi empresa realizan cada servicio y definir su porcentaje de comisión individual, pudiendo ajustarlo en cualquier momento sin afectar registros históricos pasados.

**Why this priority**: Determina quién puede atender cada servicio y cuánto percibe por realizarlo, habilitando tanto la consulta pública de profesionales por servicio como el cálculo futuro de comisiones.

**Independent Test**: Se puede probar vinculando colaboradores existentes de la misma empresa a servicios existentes con distintos porcentajes de comisión, actualizando el porcentaje, desvinculando un colaborador y verificando los rechazos por rangos inválidos (`< 0` o `> 100`) o referencias de otra empresa.

**Acceptance Scenarios**:

1. **Given** un `OWNER`, un colaborador y un servicio pertenecientes al mismo `companyId`, **When** el `OWNER` vincula el colaborador al servicio con un porcentaje de comisión entre 0 y 100 (ej. 40), **Then** el vínculo queda registrado con dicha comisión.
2. **Given** un vínculo existente entre colaborador y servicio, **When** el `OWNER` actualiza el porcentaje de comisión a un nuevo valor válido (ej. 50), **Then** el nuevo porcentaje se guarda para futuros agendamientos sin modificar ningún registro histórico previo.
3. **Given** un `OWNER` intentando asignar una comisión menor a 0 o mayor a 100, **When** registra o actualiza el vínculo, **Then** la operación es rechazada por validación de negocio antes de persistir datos.
4. **Given** un `OWNER` de la empresa A, **When** intenta vincular un colaborador o servicio perteneciente a la empresa B, **Then** la operación es rechazada protegiendo el aislamiento entre empresas.
5. **Given** un vínculo existente, **When** el `OWNER` desvincula al colaborador del servicio, **Then** ese colaborador deja de figurar como habilitado para dicho servicio.

---

### User Story 3 - Configuración de días y horarios de trabajo (Priority: P3)

Como Dueño (`OWNER`), quiero definir los días de la semana y horarios en que trabaja cada colaborador (incluyendo pausas opcionales) para establecer cuándo existe disponibilidad real de atención.

**Why this priority**: Los días y horarios activos son requisito directo para el motor de disponibilidad y agendamiento de las etapas siguientes.

**Independent Test**: Se puede probar configurando la agenda semanal (`0` a `6`) de un colaborador con días activos, descansos opcionales y días inactivos, verificando que se rechacen horarios inconsistentes (`endTime <= startTime` o intervalos inválidos) y accesos entre empresas.

**Acceptance Scenarios**:

1. **Given** un `OWNER` y un colaborador de su `companyId`, **When** configura un día de la semana (`0` a `6`) como día laborable (`isWorkingDay: true`) con `startTime` `"09:00"`, `endTime` `"18:00"` y un intervalo opcional `"12:00"` a `"13:00"`, **Then** el horario queda guardado para ese colaborador y día.
2. **Given** un `OWNER` configurando un horario con `endTime` menor o igual a `startTime` (ej. `"18:00"` a `"09:00"` o `"09:00"` a `"09:00"`), **When** guarda el horario, **Then** la operación es rechazada por validación de negocio antes de persistir datos.
3. **Given** un `OWNER` configurando un intervalo de descanso donde falta uno de los límites, `breakEnd <= breakStart`, o el descanso queda fuera del rango `[startTime, endTime]`, **When** guarda el horario, **Then** la operación es rechazada por validación de negocio antes de persistir datos.
4. **Given** un día de la semana marcado como inactivo (`isWorkingDay: false`) o no configurado para un colaborador, **When** se consulta su disponibilidad semanal, **Then** ese día no ofrece disponibilidad de atención.

---

### User Story 4 - Consulta de solo lectura para Colaboradores (Priority: P4)

Como Colaborador (`COLLABORATOR`), quiero consultar únicamente los servicios a los que estoy vinculado, mis propios porcentajes de comisión y mis propios días y horarios de trabajo, sin poder modificar configuraciones del salón.

**Why this priority**: Brinda transparencia al colaborador sobre su trabajo y remuneración mientras protege la integridad financiera y operativa del salón frente a cambios no autorizados.

**Independent Test**: Se puede probar autenticando un colaborador y verificando que visualiza solo sus servicios vinculados, sus comisiones y su horario, mientras que cualquier intento de crear, editar o desactivar servicios, comisiones u horarios es rechazado por falta de autorización.

**Acceptance Scenarios**:

1. **Given** un `COLLABORATOR` autenticado en su `companyId`, **When** consulta sus servicios, comisiones y horarios, **Then** visualiza únicamente los servicios a los que está vinculado con sus propios porcentajes de comisión y su propia grilla semanal de trabajo.
2. **Given** un `COLLABORATOR` autenticado, **When** intenta crear, editar o desactivar un servicio, modificar comisiones o alterar días/horarios de trabajo, **Then** el sistema rechaza la operación por falta de autorización.
3. **Given** un `COLLABORATOR` A y un `COLLABORATOR` B de la misma empresa, **When** el colaborador A consulta información, **Then** no puede ver las comisiones ni los horarios privados del colaborador B.

---

### User Story 5 - Consulta pública del catálogo para Clientes Finales (Priority: P5)

Como Cliente Final (`CLIENT`), quiero consultar públicamente (sin iniciar sesión) los servicios activos de un salón específico y qué colaboradores están habilitados para cada servicio, para poder elegir qué reservar.

**Why this priority**: Conecta la configuración interna del salón con la experiencia pública del cliente que iniciará un agendamiento en la siguiente etapa.

**Independent Test**: Se puede probar consultando sin autenticación el catálogo público de un `companyId` y verificando que solo aparezcan servicios activos con sus colaboradores habilitados, sin exponer servicios inactivos, porcentajes de comisión ni datos de otras empresas.

**Acceptance Scenarios**:

1. **Given** un salón (`companyId`) con servicios activos e inactivos y colaboradores vinculados, **When** un `CLIENT` sin iniciar sesión consulta el catálogo público de ese `companyId`, **Then** recibe únicamente los servicios activos junto con los colaboradores habilitados para cada servicio.
2. **Given** un `CLIENT` consultando el catálogo público de un salón, **When** recibe la respuesta, **Then** no se exponen porcentajes de comisión, servicios desactivados ni información de ningún otro `companyId`.
3. **Given** un servicio desactivado por el `OWNER`, **When** un `CLIENT` consulta el catálogo público posteriormente, **Then** ese servicio ya no aparece disponible.

---

### Edge Cases

- **Precio gratuito (0 centavos)**: Un servicio con `priceInCents = 0` debe ser aceptado (es no negativo), mientras que `-1` debe rechazarse.
- **Comisión en extremos**: Porcentajes exactos de `0` y `100` deben ser aceptados; valores `< 0` o `> 100` deben rechazarse.
- **Unicidad de nombre con formato distinto**: Nombres como `"Corte Clásico"` y `"  corte clásico  "` dentro del mismo `companyId` deben considerarse duplicados y rechazarse. Dos empresas distintas sí pueden tener servicios con el mismo nombre.
- **Intervalo de descanso incompleto o inválido**: Enviar solo `breakStart` sin `breakEnd` (o viceversa), o un descanso que comience antes de `startTime`, termine después de `endTime` o tenga `breakEnd <= breakStart`, debe rechazarse.
- **Día de la semana fuera de rango**: Valores distintos de enteros entre `0` (Domingo) y `6` (Sábado) deben rechazarse.
- **Servicio activo sin colaboradores vinculados**: En la consulta pública, un servicio activo sin colaboradores habilitados devuelve una lista vacía de colaboradores sin provocar error.
- **Empresa inexistente o sin servicios activos en consulta pública**: Consultar un `companyId` sin servicios activos devuelve un catálogo vacío sin revelar datos de otras empresas.
- **Desactivación de servicio con vínculos existentes**: Desactivar un servicio lo oculta del catálogo público sin eliminar los registros previos ni alterar historiales futuros.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema DEBE aislar estrictamente todas las consultas y mutaciones por `companyId`, impidiendo leer, vincular o modificar datos pertenecientes a otra empresa.
- **FR-002**: El sistema DEBE restringir todas las operaciones de creación, edición, desactivación/reactivación de servicios, gestión de vínculos/comisiones y configuración de horarios exclusivamente al rol `OWNER` dentro de su propio `companyId`. Todo intento de modificación por parte de `COLLABORATOR` o `CLIENT` DEBE ser rechazado por falta de autorización.
- **FR-003**: El sistema DEBE permitir al `OWNER` crear servicios con nombre obligatorio, descripción opcional, duración en minutos (`durationMinutes`, entero positivo `> 0`), precio en centavos (`priceInCents`, entero no negativo `>= 0`) y estado activo (`active`, booleano, activo por defecto).
- **FR-004**: El sistema DEBE garantizar que el nombre de cada servicio sea único dentro de un mismo `companyId` (comparando de forma normalizada sin distinguir mayúsculas/minúsculas ni espacios extremos).
- **FR-005**: El sistema DEBE permitir al `OWNER` listar todos los servicios de su empresa (activos e inactivos), editar sus atributos y desactivarlos o reactivarlos respetando las reglas de validación y unicidad.
- **FR-006**: El sistema DEBE permitir al `OWNER` vincular colaboradores de su `companyId` con servicios de su `companyId`, asignando a cada vínculo un `commissionPercentage` entre `0` y `100` inclusive, evitando vínculos duplicados para el mismo par colaborador-servicio.
- **FR-007**: El sistema DEBE permitir al `OWNER` actualizar el `commissionPercentage` de un vínculo en cualquier momento; el cambio DEBE aplicarse únicamente a futuros agendamientos y nunca alterar registros históricos pasados.
- **FR-008**: El sistema DEBE permitir al `OWNER` desvincular un colaborador de un servicio dentro de su `companyId`.
- **FR-009**: El sistema DEBE permitir al `OWNER` configurar los días de la semana (`0` a `6`, de Domingo a Sábado) y horarios de trabajo (`startTime`, `endTime`, `isWorkingDay` e intervalo opcional `breakStart` y `breakEnd`) de cada colaborador de su `companyId`.
- **FR-010**: El sistema DEBE validar que, para todo día laborable activo (`isWorkingDay: true`), `startTime` y `endTime` sean horas válidas en formato 24 horas (`HH:MM`) con `endTime > startTime`, y que si se informa un descanso, ambos límites (`breakStart` y `breakEnd`) estén presentes y cumplan `startTime < breakStart < breakEnd < endTime`.
- **FR-011**: El sistema DEBE considerar que un colaborador no tiene disponibilidad en cualquier día de la semana que no esté configurado o que esté marcado con `isWorkingDay: false`.
- **FR-012**: En la Etapa 1, la configuración de días y horarios de trabajo (`WorkSchedule`) aplica exclusivamente a nivel individual de cada colaborador dentro de su `companyId`; una configuración separada de horarios generales de apertura del salón queda fuera del alcance de esta etapa.
- **FR-013**: El sistema DEBE permitir al `COLLABORATOR` consultar en modo solo lectura únicamente los servicios a los que está vinculado, sus propios porcentajes de comisión y sus propios días y horarios de trabajo dentro de su `companyId`.
- **FR-014**: El sistema DEBE permitir al `CLIENT`, sin necesidad de autenticación, consultar los servicios activos (`active: true`) y los colaboradores habilitados para cada servicio de un `companyId` específico.
- **FR-015**: El sistema DEBE omitir en las consultas públicas de `CLIENT` cualquier información sensible o interna, incluyendo porcentajes de comisión, servicios inactivos y datos de otras empresas.
- **FR-016**: Todas las validaciones de reglas de negocio (duración `<= 0`, precio `< 0`, comisión `< 0` o `> 100`, `endTime <= startTime`, intervalo de descanso inválido, nombre de servicio vacío, día de la semana fuera de `0–6`) DEBEN ejecutarse y rechazar datos inválidos en la lógica de negocio antes de realizar cualquier operación de persistencia.

### Key Entities *(include if feature involves data)*

- **Service (Servicio)**: Representa un servicio ofrecido por una empresa (`companyId`). Atributos clave: identificador único, empresa propietaria (`companyId`), nombre (único por empresa), descripción opcional, duración en minutos (entero positivo), precio en centavos (entero no negativo) y estado activo/inactivo.
- **CollaboratorService (Vínculo Colaborador-Servicio y Comisión)**: Representa la habilitación de un colaborador para realizar un servicio específico dentro de la misma empresa (`companyId`), junto con su porcentaje de comisión (`0` a `100`). Relaciona un Colaborador con un Servicio de forma única por par.
- **WorkSchedule (Día y Horario de Trabajo)**: Representa la configuración horaria de un colaborador para un día específico de la semana (`0` = Domingo a `6` = Sábado) dentro de su `companyId`. Atributos clave: día de la semana, indicador de día laborable (`isWorkingDay`), hora de inicio (`startTime`), hora de fin (`endTime`), e intervalo opcional de descanso (`breakStart`, `breakEnd`).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un `OWNER` puede configurar un servicio completo, vincular al menos un colaborador con su comisión y definir su jornada semanal en menos de 3 minutos sin asistencia técnica.
- **SC-002**: El 100% de los intentos de acceso o modificación entre empresas distintas (`companyId` diferente) son bloqueados sin fuga de datos.
- **SC-003**: El 100% de los intentos de mutación realizados por un `COLLABORATOR` sobre servicios, comisiones u horarios son rechazados por falta de autorización.
- **SC-004**: El 100% de los datos que violan reglas de negocio (duración `<= 0`, precio `< 0`, comisión fuera de `0–100`, `endTime <= startTime` o descanso fuera de rango) son rechazados antes de tocar el almacenamiento persistente.
- **SC-005**: Un `CLIENT` sin cuenta puede consultar el catálogo público de servicios activos y colaboradores habilitados de un salón en una única consulta y obtener resultados sin exposición de comisiones ni servicios inactivos.

## Assumptions

- Las entidades base `Company` y `Collaborator` ya existen en el sistema y cada colaborador pertenece a un único `companyId`.
- La identidad autenticada del actor (`OWNER` o `COLLABORATOR`) y su `companyId` provienen de un contexto de autenticación confiable (nunca de parámetros no validados enviados por el cliente); los mecanismos de login/sesión se integran o proveen como dependencia transversal del sistema.
- El porcentaje de comisión (`commissionPercentage`) acepta valores numéricos entre `0` y `100` inclusive con hasta dos decimales (ej. `40` o `35.5`).
- Los horarios (`startTime`, `endTime`, `breakStart`, `breakEnd`) se expresan en formato de 24 horas `HH:MM` en la zona horaria local del salón y no cruzan la medianoche dentro de un mismo registro diario (`endTime > startTime`).
- La inmutabilidad histórica de las comisiones se garantiza porque futuros agendamientos (Etapa 2) capturarán una copia del porcentaje vigente al momento de la reserva; en Etapa 1 actualizar `CollaboratorService` modifica únicamente la configuración vigente.
- La gestión de ausencias, bloqueos puntuales por fecha y creación de agendamientos quedan fuera del alcance de esta Etapa 1 y corresponden a etapas posteriores.
