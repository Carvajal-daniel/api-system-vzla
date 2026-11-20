# Feature Specification: Motor de Agendamientos, Disponibilidad y Bloqueios de Horario (Etapa 3)

**Feature Branch**: `002-appointments-availability-blocks`

**Created**: 2026-11-20

**Status**: Draft

**Input**: User description: "Etapa 3: Motor de Agendamentos, Disponibilidade e Bloqueios de Horário. Bloqueios pontuais por colaborador ou empresa toda (schedule_blocks), agendamentos (appointments) com dados do cliente sem conta/login, status e snapshot de preço/duração, cálculo de disponibilidade cruzando grade semanal com fuso horário da empresa, prevenção de double-booking concorrente, transições de status e gestão por OWNER/COLLABORATOR/público."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Gestión de bloqueios de horario y ausencias (Priority: P1)

Como Dueño (`OWNER`) o Colaborador (`COLLABORATOR`), quiero registrar, consultar y eliminar bloqueos puntuales de horario (como almuerzos, ausencias personales, capacitaciones o feriados de toda la empresa) para que esos intervalos queden excluidos de la disponibilidad real de atención.

**Why this priority**: Los bloqueos son un insumo directo del motor de disponibilidad. Sin bloqueos, el cálculo de horarios libres ofrecería turnos en feriados o ausencias de profesionales, generando reservas inválidas.

**Independent Test**: Se puede probar creando bloqueos individuales (por un `OWNER` para cualquier colaborador o por un `COLLABORATOR` solo para sí mismo) y bloqueos globales de empresa (solo por `OWNER`), listándolos por rango de fechas, eliminándolos y verificando el rechazo ante rangos invertidos, permisos indebidos o accesos entre empresas distintas.

**Acceptance Scenarios**:

1. **Given** un `OWNER` autenticado de la empresa A, **When** registra un bloqueo puntual con inicio y fin válidos y motivo opcional para un colaborador activo de su empresa o para toda la empresa (sin colaborador específico), **Then** el bloqueo queda guardado asociado exclusivamente a su `companyId`.
2. **Given** un `COLLABORATOR` autenticado de la empresa A, **When** registra, consulta o elimina un bloqueo asignado a sí mismo con motivo opcional, **Then** la operación se realiza correctamente sobre su propia agenda.
3. **Given** un `COLLABORATOR` autenticado de la empresa A, **When** intenta crear, consultar o eliminar un bloqueo de otro colaborador o un bloqueo global de la empresa, **Then** el sistema rechaza la operación por falta de autorización.
4. **Given** cualquier actor intentando crear un bloqueo con fecha/hora de fin menor o igual a la de inicio, **When** envía la solicitud, **Then** el sistema rechaza la operación por validación de negocio antes de persistir datos.
5. **Given** un colaborador que ya tiene agendamientos activos (`PENDING` o `CONFIRMED`) dentro del intervalo de un nuevo bloqueo, **When** se registra el bloqueo, **Then** el bloqueo se guarda igualmente, el sistema identifica las citas afectadas y dispara el aviso desacoplado de ausencia para futura notificación al cliente.
6. **Given** un `OWNER` de la empresa A, **When** intenta crear, listar o eliminar bloqueos de la empresa B o de un colaborador perteneciente a la empresa B, **Then** el sistema rechaza la operación protegiendo el aislamiento multi-tenant.

---

### User Story 2 - Consulta de disponibilidad real por fecha y servicio (Priority: P1)

Como Cliente Final (`CLIENT`) sin cuenta o como usuario interno del salón, quiero consultar los horarios disponibles para un servicio y una fecha específica (eligiendo un colaborador concreto o cualquier colaborador habilitado) para saber exactamente en qué momentos puedo reservar sin conflictos.

**Why this priority**: Es el núcleo operativo que conecta el catálogo de servicios, la grilla semanal de trabajo, los bloqueos y las citas existentes en horarios concretos reservables.

**Independent Test**: Se puede probar configurando un servicio activo con duración conocida, uno o más colaboradores habilitados con su grilla semanal, bloqueos y citas previas en distintos estados, y verificando que los slots devueltos respeten el huso horario de la empresa, excluyan descansos, bloqueos y citas activas, y liberen horarios de citas canceladas o `NO_SHOW`.

**Acceptance Scenarios**:

1. **Given** una empresa activa con un servicio activo de 45 minutos, un colaborador activo habilitado para ese servicio con jornada laboral de 09:00 a 12:00 y descanso de 10:30 a 11:00 en el huso horario de la empresa, **When** se consulta la disponibilidad para esa fecha y servicio, **Then** se devuelven únicamente los horarios de inicio donde el servicio cabe completo dentro de los tramos laborables sin invadir el descanso ni el fin de jornada.
2. **Given** un colaborador con un bloqueo puntual de 09:00 a 10:00 o una empresa con un bloqueo global en esa franja, **When** se consulta la disponibilidad para esa fecha, **Then** ningún horario solapado con el bloqueo aparece disponible.
3. **Given** un colaborador con una cita en estado `PENDING` o `CONFIRMED` de 10:00 a 10:45 y otra cita en estado `CANCELED` o `NO_SHOW` de 11:00 a 11:45, **When** se consulta la disponibilidad, **Then** la franja de 10:00 a 10:45 queda ocupada y la franja de 11:00 a 11:45 vuelve a aparecer disponible.
4. **Given** una consulta de disponibilidad sin especificar colaborador ("cualquier colaborador disponible"), **When** existen varios colaboradores activos habilitados para el servicio, **Then** el sistema evalúa la disponibilidad de cada colaborador elegible y retorna los horarios disponibles indicando los colaboradores disponibles para cada opción.
5. **Given** una empresa inactiva, un servicio inactivo o un colaborador inactivo o no vinculado al servicio, **When** se consulta disponibilidad, **Then** el sistema rechaza la consulta o no ofrece horarios para esa combinación inválida sin exponer datos de otras empresas.

---

### User Story 3 - Creación de agendamiento público sin cuenta y prevención de doble reserva (Priority: P1)

Como Cliente Final (`CLIENT`), quiero reservar un horario disponible indicando únicamente el servicio, el colaborador, la fecha/hora de inicio y mis datos de contacto (nombre y teléfono/WhatsApp), sin necesidad de crear una cuenta ni iniciar sesión, garantizando que nunca se confirmen dos citas superpuestas para el mismo profesional.

**Why this priority**: Habilita el flujo principal de negocio (reservas directas por enlace web o futuro asistente de WhatsApp) y protege la integridad de la agenda frente a solicitudes simultáneas.

**Independent Test**: Se puede probar creando citas públicas válidas para una empresa activa, verificando que guarden el snapshot inmutable de precio, duración y comisión vigente, que rechacen horarios fuera de jornada, bloqueados o en el pasado, y que ante dos solicitudes concurrentes para el mismo colaborador y horario exactamente una tenga éxito y la otra sea rechazada por conflicto.

**Acceptance Scenarios**:

1. **Given** una empresa activa, un servicio activo, un colaborador activo habilitado para ese servicio y un horario disponible en su jornada, **When** un `CLIENT` envía su nombre, teléfono/WhatsApp y horario de inicio, **Then** el sistema crea el agendamiento en estado inicial `PENDING`, calcula automáticamente el horario de fin según la duración del servicio y guarda un snapshot inmutable del precio, duración y porcentaje de comisión vigentes.
2. **Given** un servicio cuyo precio, duración o comisión del colaborador se modifican posteriormente, **When** se consulta el agendamiento ya creado, **Then** conserva exactamente los valores históricos capturados al momento de la reserva.
3. **Given** dos solicitudes simultáneas que intentan reservar el mismo horario (o rangos superpuestos) con el mismo colaborador en la misma empresa, **When** ambas se procesan de forma concurrente, **Then** exactamente una reserva se concreta y la segunda es rechazada por conflicto de horario (prevención de double-booking).
4. **Given** un intento de reserva para una empresa inactiva, un servicio o colaborador perteneciente a otra empresa, un colaborador inactivo o no habilitado para el servicio, o un horario fuera de jornada / en bloqueo / en el pasado, **When** se envía la solicitud, **Then** la reserva es rechazada antes de confirmar la cita.
5. **Given** un `COLLABORATOR` autenticado, **When** intenta crear un agendamiento a través de las operaciones internas protegidas, **Then** el sistema lo impide respetando la prohibición de que un colaborador cree citas por su cuenta.

---

### User Story 4 - Gestión interna de agenda, consulta y transiciones de status (Priority: P2)

Como Dueño (`OWNER`) o Colaborador (`COLLABORATOR`), quiero consultar los agendamientos de mi ámbito autorizado y actualizar su estado siguiendo reglas válidas del ciclo de vida (`PENDING`, `CONFIRMED`, `COMPLETED`, `CANCELED`, `NO_SHOW`), además de permitir al `OWNER` reprogramar citas activas, para operar el día a día del salón.

**Why this priority**: Una vez creadas las citas, el salón necesita ver la agenda diaria/semanal, confirmar asistencia, marcar servicios finalizados o inasistencias y liberar horarios cuando una cita se cancela o reprograma.

**Independent Test**: Se puede probar autenticando un `OWNER` y un `COLLABORATOR`, verificando que el `OWNER` visualiza y gestiona todas las citas de su `companyId`, el `COLLABORATOR` solo visualiza y actualiza el estado de sus propias citas, y que cualquier transición inválida (ej. de `CANCELED` a `CONFIRMED` o de `COMPLETED` a `PENDING`) es rechazada.

**Acceptance Scenarios**:

1. **Given** un `OWNER` autenticado de la empresa A, **When** lista los agendamientos filtrando por rango de fechas, colaborador o estado, **Then** recibe únicamente los agendamientos de su empresa ordenados cronológicamente.
2. **Given** un `COLLABORATOR` autenticado de la empresa A, **When** consulta su agenda, **Then** visualiza únicamente los agendamientos asignados a su propio `collaboratorId` dentro de su empresa, sin acceso a citas de otros colaboradores.
3. **Given** un agendamiento en estado `PENDING`, **When** el `OWNER` o el `COLLABORATOR` asignado actualiza su estado a `CONFIRMED` o `CANCELED`, **Then** el cambio se guarda correctamente; si se pasa a `CANCELED`, el horario vuelve a quedar libre.
4. **Given** un agendamiento en estado `CONFIRMED`, **When** el `OWNER` o el `COLLABORATOR` asignado actualiza su estado a `COMPLETED`, `CANCELED` o `NO_SHOW`, **Then** el cambio se guarda correctamente; si pasa a `CANCELED` o `NO_SHOW`, el horario vuelve a quedar libre.
5. **Given** un agendamiento en un estado terminal (`COMPLETED`, `CANCELED` o `NO_SHOW`) o una transición directa inválida (ej. `PENDING` → `COMPLETED` o `PENDING` → `NO_SHOW`), **When** se intenta cambiar su estado, **Then** el sistema rechaza la transición indicando que no está permitida.
6. **Given** un `OWNER` autenticado y una cita en estado `PENDING` o `CONFIRMED`, **When** la reprograma a un nuevo horario disponible (con el mismo u otro colaborador habilitado de su empresa), **Then** el sistema valida disponibilidad y concurrencia de forma atómica, libera el horario anterior y actualiza la cita.

---

### Edge Cases

- **Citas adyacentes sin solapamiento**: Una cita de 09:00 a 09:45 y otra de 09:45 a 10:30 NO se superponen (`existing.startsAt < candidate.endsAt && existing.endsAt > candidate.startsAt`) y deben permitirse ambas.
- **Horarios en el pasado**: No se debe permitir crear una cita pública ni ofrecer slots disponibles cuyo `startsAt` ya haya pasado respecto al instante actual.
- **Cambio de día por huso horario (UTC vs hora local)**: Una cita creada a las 22:00 en `America/Caracas` (UTC-4) corresponde a las 02:00 UTC del día siguiente; el motor debe convertir correctamente el día calendario local de la empresa al rango UTC correspondiente para buscar bloqueos y citas sin perder turnos nocturnos.
- **Bloqueo que cubre parcialmente la jornada o abarca varios días**: Un bloqueo de varios días (ej. vacaciones del lunes 00:00 al viernes 23:59) debe descontar correctamente la porción que intersecta la fecha consultada.
- **Servicio más largo que cualquier tramo libre**: Si un servicio dura 120 minutos pero el colaborador trabaja de 09:00 a 12:00 con descanso de 10:30 a 11:00 (tramos de 90 min y 60 min), no debe ofrecerse ningún slot ese día.
- **Colaborador desactivado con citas futuras ya creadas**: Un colaborador inactivo no puede recibir nuevas reservas ni aparecer en disponibilidad, pero sus citas históricas siguen visibles en la agenda interna del `OWNER`.
- **Teléfono del cliente con espacios o formato variado**: El teléfono/WhatsApp del cliente debe normalizarse y validarse (mínimo 10 dígitos válidos) antes de persistir el agendamiento.
- **Acceso cruzado entre empresas**: Intentar consultar, actualizar estado o reprogramar un agendamiento de la empresa B usando un token de la empresa A debe rechazarse sin revelar la existencia del registro.
- **Reprogramación al mismo horario del mismo colaborador**: Al reprogramar una cita existente, la verificación de solapamiento debe excluir el propio `appointmentId` que se está moviendo para permitir ajustes parciales de hora (ej. mover de 10:00–10:45 a 10:15–11:00).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema DEBE aislar estrictamente toda operación de bloqueos, disponibilidad y agendamientos por `companyId`, impidiendo leer, crear o modificar recursos de otra empresa.
- **FR-002**: El sistema DEBE permitir crear, listar y eliminar bloqueos puntuales de horario (`ScheduleBlock`) con fecha/hora de inicio y fin (`startsAt`, `endsAt`), motivo opcional y alcance por colaborador específico o global para toda la empresa (`collaboratorId` nulo).
- **FR-003**: El sistema DEBE validar en `ScheduleBlock` que `endsAt > startsAt` y que, cuando se informe `collaboratorId`, dicho colaborador exista y pertenezca al mismo `companyId`.
- **FR-004**: El sistema DEBE restringir los permisos sobre `ScheduleBlock` de forma que `OWNER` gestione bloqueos propios de empresa y de cualquier colaborador de su `companyId`, mientras que `COLLABORATOR` solo pueda crear, consultar y eliminar bloqueos personales propios (`collaboratorId` igual a su identidad autenticada).
- **FR-005**: Al registrar un `ScheduleBlock` (tanto por `OWNER` como por `COLLABORATOR`), el sistema DEBE permitir su creación aunque existan agendamientos activos (`PENDING` o `CONFIRMED`) solapados (para emergencias/imprevistos), identificar y devolver la lista de citas afectadas (`affectedAppointments`) en la respuesta y disparar el mecanismo desacoplado de notificación de ausencias (`AbsenceNotificationPort`, preparado para integración futura con WhatsApp).
- **FR-006**: El sistema DEBE calcular la disponibilidad real para una `companyId`, `serviceId`, `date` (fecha calendario `YYYY-MM-DD`) y opcionalmente `collaboratorId`, utilizando el huso horario configurado de la empresa (`companies.timezone`, por defecto `"America/Caracas"`, con soporte de parámetro opcional de huso horario IANA válido) y generando slots cada `15` minutos dentro de cada tramo libre.
- **FR-007**: El cálculo de disponibilidad DEBE cruzar: (a) empresa activa, (b) servicio activo de esa empresa, (c) colaborador(es) activo(s) vinculados al servicio en esa empresa, (d) jornada semanal activa (`WorkSchedule`) correspondiente al día de la semana local excluyendo el descanso configurado, (e) bloqueos puntuales (`ScheduleBlock`) del colaborador y globales de la empresa, y (f) agendamientos existentes en estado `PENDING` o `CONFIRMED`.
- **FR-008**: El cálculo de disponibilidad DEBE excluir horarios en el pasado y considerar disponibles los horarios previamente ocupados por citas en estado `CANCELED` o `NO_SHOW`.
- **FR-009**: El sistema DEBE permitir crear agendamientos (`Appointment`) por dos vías: (a) acceso público sin cuenta ni login del cliente exigiendo `companyId` válido de una empresa activa, `serviceId`, `collaboratorId`, `startsAt`, `clientName` y `clientPhone` (estado inicial obligatorio `PENDING`); y (b) acceso autenticado exclusivo de `OWNER` extrayendo `companyId` del token, permitiendo elegir estado inicial `PENDING` (por defecto) o `CONFIRMED`.
- **FR-010**: En toda creación de agendamiento (tanto pública como de `OWNER`), el sistema DEBE validar de forma independiente en el dominio —sin asumir que se consultó previamente disponibilidad— que: (a) empresa, servicio y colaborador pertenecen al mismo `companyId`, están activos y el colaborador está habilitado para el servicio; (b) `startsAt > now` (en el futuro); (c) el intervalo `[startsAt, endsAt)` cabe íntegramente dentro de la jornada semanal (`work_schedules`) del colaborador en el huso horario de la empresa; (d) no intersecta el intervalo de descanso (`breakStart`–`breakEnd`); (e) no se solapa con ningún `schedule_block` (del colaborador ni global de la empresa); y (f) no se solapa con ninguna cita activa (`PENDING` o `CONFIRMED`). Además DEBE almacenar un snapshot inmutable del nombre, precio (`priceInCents`), duración (`durationMinutes`) del servicio y porcentaje de comisión vigente del colaborador para ese servicio.
- **FR-011**: El sistema DEBE derivar siempre `endsAt` en el backend a partir de `startsAt + service.durationMinutes`, rechazando o ignorando cualquier intento de imponer un `endsAt` arbitrario desde el payload del cliente.
- **FR-012**: El sistema DEBE garantizar atomicidad y prevención de double-booking ante solicitudes concurrentes de creación o reprogramación, asegurando que nunca coexistan dos agendamientos activos (`PENDING` o `CONFIRMED`) con intervalos superpuestos para el mismo colaborador.
- **FR-013**: El sistema DEBE impedir que un `COLLABORATOR` autenticado cree nuevos agendamientos por su cuenta en las rutas internas, respetando las reglas constitucionales de RBAC.
- **FR-014**: El sistema DEBE aplicar una máquina de estados estricta en la lógica de negocio para las transiciones de `Appointment.status`:
  - `PENDING` → `CONFIRMED` o `CANCELED`
  - `CONFIRMED` → `COMPLETED`, `CANCELED` o `NO_SHOW`
  - `COMPLETED`, `CANCELED` y `NO_SHOW` son estados terminales sin transiciones salientes permitidas.
- **FR-015**: El sistema DEBE permitir al `OWNER` listar y filtrar todos los agendamientos de su empresa, cambiar su estado según la máquina de estados y reprogramar citas activas (`PENDING` o `CONFIRMED`) validando disponibilidad y concurrencia.
- **FR-016**: El sistema DEBE permitir al `COLLABORATOR` listar únicamente sus propios agendamientos y actualizar el estado de sus propias citas siguiendo las transiciones válidas, impidiendo acceder o modificar citas de otros colaboradores.
- **FR-017**: Toda validación de reglas de negocio (solapamiento, transiciones de status inválidas, rangos de tiempo invertidos, datos de cliente inválidos, horario en el pasado, inconsistencias multi-tenant) DEBE ejecutarse en la lógica de dominio/aplicación antes de confirmar cualquier cambio persistente.

### Key Entities *(include if feature involves data)*

- **ScheduleBlock (Bloqueo de Horario)**: Representa una indisponibilidad puntual en una empresa (`companyId`). Puede aplicarse a un colaborador específico (`collaboratorId`) o a toda la empresa (`collaboratorId` nulo). Atributos clave: identificador único, `companyId`, `collaboratorId` opcional, `startsAt` (instante UTC), `endsAt` (instante UTC), motivo opcional (`reason`) y marcas temporales de auditoría.
- **Appointment (Agendamiento / Cita)**: Representa una reserva de un servicio realizada para un cliente final sin cuenta dentro de una empresa (`companyId`). Atributos clave: identificador único, `companyId`, `collaboratorId`, `serviceId`, datos del cliente (`clientName`, `clientPhone`), rango temporal (`startsAt`, `endsAt` en UTC), estado (`PENDING`, `CONFIRMED`, `COMPLETED`, `CANCELED`, `NO_SHOW`), motivo opcional de cancelación (`cancellationReason`), snapshots inmutables del servicio y comisión al momento de la creación (`serviceNameSnapshot`, `servicePriceInCentsSnapshot`, `serviceDurationMinutesSnapshot`, `commissionPercentageSnapshot`) y marcas temporales de auditoría.
- **AvailabilitySlot (Horario Disponible — concepto de cálculo)**: Representa una ventana reservable calculada en tiempo real para una fecha y servicio, compuesta por `startsAt`, `endsAt` y el `collaboratorId` (con nombre del colaborador) disponible para atenderla.
- **Company.timezone (Extensión de Empresa)**: Identificador IANA de zona horaria de la empresa (por ejemplo `America/Caracas` o `America/Sao_Paulo`) usado para interpretar los días y horarios locales de `WorkSchedule` al calcular disponibilidad y validar reservas.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un cliente sin cuenta puede consultar horarios disponibles y concretar una reserva válida en menos de 2 pasos (consultar disponibilidad y crear agendamiento) con respuesta determinística y exacta respecto a la agenda real.
- **SC-002**: El 100% de los intentos concurrentes de doble reserva (double-booking) sobre intervalos solapados del mismo colaborador resultan en exactamente una cita creada y el rechazo controlado de los intentos conflictivos.
- **SC-003**: El 100% de las transiciones de estado inválidas, accesos entre empresas distintas (`companyId` diferente) y operaciones fuera de rol (`COLLABORATOR` intentando crear citas o gestionar bloqueos ajenos) son rechazados de forma consistente.
- **SC-004**: El 100% de los agendamientos creados preservan de manera inmutable el precio, la duración y el porcentaje de comisión vigentes en el momento de la reserva, incluso tras modificaciones posteriores del catálogo.
- **SC-005**: El 100% de los bloqueos individuales y globales de empresa, así como citas `PENDING` y `CONFIRMED`, se descuentan inmediatamente del cálculo de disponibilidad, mientras que citas `CANCELED` y `NO_SHOW` liberan el horario de forma inmediata.

## Assumptions

- Las empresas existentes recibirán la zona horaria IANA por defecto `"America/Caracas"` en la migración y las nuevas empresas podrán configurarla o heredar `"America/Caracas"`.
- Los slots de disponibilidad se generan avanzando con un paso fijo por defecto de `15` minutos dentro de cada tramo laborable libre (por ejemplo, 09:00, 09:15, 09:30...) siempre que el servicio completo (`durationMinutes`) quepa antes del descanso, bloqueo, cita existente o fin de jornada.
- Todo agendamiento creado por el endpoint público nace con estado `PENDING` y reserva el horario de inmediato; un `OWNER` autenticado puede crear agendamientos con estado inicial `PENDING` (por defecto) o `CONFIRMED`. `COLLABORATOR` nunca puede crear agendamientos.
- La integración real con WhatsApp y el envío efectivo de mensajes de notificación ante ausencias o confirmaciones corresponden a la Etapa 5; en la Etapa 3 se define el puerto de notificación de ausencias desacoplado y se reportan las citas afectadas al crear un bloqueo.
- La cancelación o reprogramación directa por parte del cliente final sin cuenta (vía enlace con token o flujo conversacional de WhatsApp) se apoya en las reglas de dominio definidas aquí y su canal público dedicado se completará junto con las Etapas 4 y 5; en la Etapa 3 la gestión de estados y reprogramación se expone para `OWNER` (y cambios de estado de citas propias para `COLLABORATOR`).
- No se crea una entidad separada de cuenta de usuario para `CLIENT`; los datos del cliente (`clientName`, `clientPhone`) se almacenan directamente en el agendamiento conforme a los requisitos de esta etapa.
