# Requirements Document

## Introduction

El módulo de notificaciones al supervisor forma parte de TicketOps y registra la notificación observable cuando un Ticket supera su Fecha_de_Vencimiento mientras permanece en un Estado no terminal. El módulo trabaja con el dominio existente de SLA, evalúa el vencimiento mediante el Clock inyectado y conserva en memoria el indicador de vencimiento, los Escalamientos y las Notificaciones_al_Supervisor.

La notificación es consecuencia de la primera evaluación que detecta el vencimiento de un Ciclo_Activo. El módulo no depende de un proceso en segundo plano: las operaciones existentes que evalúan Tickets activan la evaluación. La entrega observable está representada por el registro persistido en Ticket_Store y por la invocación de Supervisor_Notifier.

El módulo conserva los eventos de ciclos anteriores cuando un Ticket se reabre. La evaluación repetida del mismo ciclo es idempotente y no produce notificaciones ni escalamientos duplicados.

## Orden del proceso de especificación

Esta feature usa el enfoque **Requirements-First**, cuyo orden es **Requirements → Design → Tasks**. Los documentos proporcionados del panel describen el enfoque **Design-First**, cuyo orden es **Design → Requirements → Tasks**.

Existe una discrepancia de documentación: la solicitud clasifica el panel como Design-First, pero `.kiro/specs/ticketops-panel/.config.kiro` declara `workflowType: "requirements-first"`. Esta spec registra la discrepancia sin modificar la spec del panel.

## Glossary

- **TicketOps**: sistema existente que registra, consulta y opera Tickets.
- **Modulo_Notificaciones_Vencimiento**: componente de TicketOps que evalúa el vencimiento de un Ticket y genera la Notificación_al_Supervisor correspondiente.
- **Ticket**: unidad de trabajo de TicketOps con `id`, `dueAt`, `status`, `overdue`, `overdueCycle`, `escalations` y `supervisorNotifications`, además de sus datos operativos.
- **Ticket_Service**: servicio de aplicación existente que crea, consulta y modifica Tickets, y que coordina la evaluación de vencimiento.
- **Ticket_Store**: almacenamiento de Tickets y de sus registros de historial, escalamiento y notificación.
- **Clock**: dependencia que proporciona el instante actual usado por TicketOps.
- **Supervisor_Notifier**: dependencia que recibe una Notificación_al_Supervisor para hacerla observable fuera del Ticket_Store.
- **Fecha_de_Vencimiento**: instante `dueAt` calculado por el SLA_de_Resolución de la Prioridad del Ticket.
- **SLA_de_Resolución**: tiempo máximo permitido desde la creación del Ticket hasta su resolución, determinado por la Prioridad.
- **Ticket_Vencido**: Ticket cuyo instante actual es posterior a `dueAt` y cuyo Estado no es `RESUELTO` ni `CERRADO`.
- **Estado**: valor `NUEVO`, `ASIGNADO`, `EN_PROGRESO`, `EN_ESPERA`, `RESUELTO` o `CERRADO`.
- **Estado_Terminal**: Estado `RESUELTO` o `CERRADO`.
- **Ciclo_de_Vencimiento**: número entero positivo que identifica una oportunidad de vencimiento. El primer ciclo de un Ticket es `1`.
- **Ciclo_Activo**: Ciclo_de_Vencimiento vigente después de la creación o de una reapertura del Ticket.
- **Evaluación_de_Vencimiento**: operación que compara el instante proporcionado por Clock con `dueAt` y aplica los registros del Ciclo_Activo.
- **Escalamiento**: registro de que un Ticket_Vencido fue elevado al Supervisor, con `ticketId`, `cycle`, `escalatedAt` y `notifiedAt`.
- **Notificación_al_Supervisor**: registro observable con `ticketId`, `cycle` y `notifiedAt` que indica que el vencimiento fue notificado al Supervisor.
- **Reapertura**: transición desde `RESUELTO` o `CERRADO` hacia `EN_PROGRESO` que inicia un nuevo Ciclo_de_Vencimiento.
- **Idempotencia**: propiedad por la cual repetir una Evaluación_de_Vencimiento del mismo Ticket y Ciclo_Activo no añade efectos observables después de la primera aplicación.
- **Fecha_ISO_UTC**: fecha serializada en formato ISO 8601 con zona UTC cuando un registro se expone fuera del dominio.
- **Almacenamiento_En_Memoria**: implementación de Ticket_Store que conserva copias aisladas de Tickets y registros durante la ejecución del proceso.

## Requirements

### Requirement 1: Evaluación del vencimiento según SLA

**User Story:** Como responsable de operaciones, quiero que el sistema detecte el momento exacto en que un Ticket vence, para iniciar una notificación coherente con el SLA.

#### Acceptance Criteria

1. WHEN una Evaluación_de_Vencimiento compara un instante anterior a `dueAt`, THE Modulo_Notificaciones_Vencimiento SHALL conservar `overdue` como `false` y los registros del Ciclo_Activo sin cambios.
2. WHEN una Evaluación_de_Vencimiento compara un instante exactamente igual a `dueAt`, THE Modulo_Notificaciones_Vencimiento SHALL conservar `overdue` como `false` sin crear un Escalamiento ni una Notificación_al_Supervisor. (Propiedad de frontera temporal.)
3. WHEN una Evaluación_de_Vencimiento compara un instante posterior a `dueAt` para un Ticket cuyo Estado no es Estado_Terminal, THE Modulo_Notificaciones_Vencimiento SHALL marcar el Ticket como Ticket_Vencido.
4. WHEN una Evaluación_de_Vencimiento compara un instante posterior a `dueAt` para un Ticket cuyo Estado es Estado_Terminal, THE Modulo_Notificaciones_Vencimiento SHALL conservar los registros existentes sin crear un nuevo Escalamiento ni una Notificación_al_Supervisor.
5. WHEN el SLA_de_Resolución determina `dueAt` para un Ticket, THE Modulo_Notificaciones_Vencimiento SHALL evaluar el vencimiento contra el `dueAt` calculado por TicketOps y no contra un plazo independiente.

### Requirement 2: Registro conjunto del primer vencimiento

**User Story:** Como supervisor, quiero recibir un registro consistente cuando un Ticket vence, para identificar el Ticket, el ciclo y el instante del incumplimiento.

#### Acceptance Criteria

1. WHEN una Evaluación_de_Vencimiento detecta por primera vez un Ticket_Vencido en un Ciclo_Activo, THE Modulo_Notificaciones_Vencimiento SHALL crear exactamente un Escalamiento y exactamente una Notificación_al_Supervisor para ese `ticketId` y `cycle`.
2. WHEN el Modulo_Notificaciones_Vencimiento crea el Escalamiento y la Notificación_al_Supervisor del mismo Ciclo_Activo, THE Modulo_Notificaciones_Vencimiento SHALL conservar el mismo `ticketId`, el mismo `cycle` y el mismo instante de notificación en ambos registros.
3. WHEN una Notificación_al_Supervisor nueva se registra, THE Modulo_Notificaciones_Vencimiento SHALL entregar el registro al Supervisor_Notifier y conservar el registro en Ticket_Store.
4. WHEN una Evaluación_de_Vencimiento completa el primer registro de un Ticket_Vencido, THE Modulo_Notificaciones_Vencimiento SHALL conservar `overdue` como `true` en el Ticket almacenado.
5. WHEN una Notificación_al_Supervisor se expone fuera del dominio, THE Modulo_Notificaciones_Vencimiento SHALL representar `notifiedAt` como Fecha_ISO_UTC.

### Requirement 3: Idempotencia dentro de un ciclo

**User Story:** Como operador de la plataforma, quiero que consultas repetidas no generen avisos duplicados, para conservar un historial confiable de vencimientos.

#### Acceptance Criteria

1. WHEN un Ticket_Vencido del mismo Ciclo_Activo se somete a una segunda o posterior Evaluación_de_Vencimiento, THE Modulo_Notificaciones_Vencimiento SHALL conservar exactamente un Escalamiento, exactamente una Notificación_al_Supervisor y exactamente una emisión al Supervisor_Notifier para ese ciclo. (Propiedad de idempotencia.)
2. WHEN una operación de Ticket_Service evalúa varias veces el mismo Ticket_Vencido del mismo Ciclo_Activo, THE Modulo_Notificaciones_Vencimiento SHALL producir el mismo estado observable que una sola evaluación posterior a `dueAt`. (Propiedad de idempotencia.)
3. WHEN el Ticket_Store ya contiene un Escalamiento o una Notificación_al_Supervisor para un `cycle`, THE Modulo_Notificaciones_Vencimiento SHALL evitar una nueva persistencia y una nueva invocación del Supervisor_Notifier para ese `cycle`.
4. WHEN una Evaluación_de_Vencimiento recibe un Ticket como entrada, THE Modulo_Notificaciones_Vencimiento SHALL conservar la entrada sin mutación observable y manejar copias aisladas de los datos temporales. (Propiedad de aislamiento.)

### Requirement 4: Persistencia y aislamiento en memoria

**User Story:** Como desarrollador de TicketOps, quiero inspeccionar los eventos de vencimiento durante la ejecución, para verificar el comportamiento sin una base de datos externa.

#### Acceptance Criteria

1. THE Ticket_Store SHALL conservar los Escalamientos y las Notificaciones_al_Supervisor agrupados por `ticketId` y `cycle` durante la ejecución del proceso.
2. WHEN una persona lectora obtiene un Ticket, un Escalamiento o una Notificación_al_Supervisor desde Almacenamiento_En_Memoria, THE Ticket_Store SHALL devolver una copia cuyos cambios posteriores no modifiquen el registro almacenado. (Propiedad de aislamiento.)
3. WHEN el Supervisor_Notifier recibe una Notificación_al_Supervisor, THE Supervisor_Notifier SHALL conservar una copia inspeccionable del registro recibido.
4. WHEN el proceso crea dos Tickets con identificadores distintos, THE Ticket_Store SHALL conservar los eventos de cada Ticket separados e impedir que una evaluación de un Ticket cree registros para otro `ticketId`.
5. WHEN el proceso termina, THE Almacenamiento_En_Memoria SHALL dejar de ser fuente de persistencia y no requerir una conexión externa para registrar los eventos durante la ejecución.

### Requirement 5: Conservación de eventos en estados terminales

**User Story:** Como auditor, quiero conservar la evidencia de un vencimiento después de la resolución o el cierre, para consultar el historial completo del Ticket.

#### Acceptance Criteria

1. WHEN un Ticket_Vencido cambia a `RESUELTO`, THE Modulo_Notificaciones_Vencimiento SHALL conservar `overdue` como `true`, los Escalamientos existentes y las Notificaciones_al_Supervisor existentes.
2. WHEN un Ticket_Vencido cambia a `CERRADO`, THE Modulo_Notificaciones_Vencimiento SHALL conservar `overdue` como `true`, los Escalamientos existentes y las Notificaciones_al_Supervisor existentes.
3. WHEN un Ticket con Estado_Terminal se consulta después de su vencimiento histórico, THE Modulo_Notificaciones_Vencimiento SHALL conservar los eventos históricos y no añadir un evento para una evaluación posterior del mismo Ciclo_Activo.
4. WHEN un Ticket cambia a un Estado_Terminal antes de superar `dueAt`, THE Modulo_Notificaciones_Vencimiento SHALL conservar `overdue` como `false` y no crear registros de vencimiento para ese ciclo.

### Requirement 6: Nuevos ciclos después de la reapertura

**User Story:** Como operador, quiero que una reapertura permita registrar un nuevo vencimiento sin borrar los eventos anteriores, para distinguir incumplimientos de ciclos diferentes.

#### Acceptance Criteria

1. WHEN un Ticket se reabre desde `RESUELTO` o `CERRADO`, THE Ticket_Service SHALL incrementar `overdueCycle`, iniciar un nuevo Ciclo_Activo y reiniciar `overdue` a `false`.
2. WHEN un Ticket reabierto supera `dueAt` en el nuevo Ciclo_Activo, THE Modulo_Notificaciones_Vencimiento SHALL crear exactamente un Escalamiento y exactamente una Notificación_al_Supervisor con el nuevo `cycle`.
3. WHEN un Ticket reabierto se evalúa antes de superar `dueAt` en el nuevo Ciclo_Activo, THE Modulo_Notificaciones_Vencimiento SHALL conservar los eventos de los ciclos anteriores y no crear eventos para el nuevo ciclo.
4. WHEN una Evaluación_de_Vencimiento registra un nuevo ciclo después de una reapertura, THE Modulo_Notificaciones_Vencimiento SHALL conservar los Escalamientos y las Notificaciones_al_Supervisor de ciclos anteriores sin sobrescribirlos. (Propiedad de conservación histórica.)
5. WHEN un Ticket reabierto ya está vencido en el instante de la siguiente evaluación, THE Modulo_Notificaciones_Vencimiento SHALL registrar el nuevo evento una sola vez para el nuevo `cycle`, aunque el mismo Ticket se consulte repetidamente.

### Requirement 7: Activación por operaciones observables

**User Story:** Como operador, quiero que la consulta o modificación que detecta un vencimiento actualice los registros de forma determinista, para no depender de un proceso oculto.

#### Acceptance Criteria

1. WHEN Ticket_Service ejecuta una operación de consulta o mutación que realiza una Evaluación_de_Vencimiento, THE Modulo_Notificaciones_Vencimiento SHALL aplicar los cambios de vencimiento antes de devolver la representación del Ticket.
2. WHEN una operación consulta Tickets vencidos, THE Ticket_Service SHALL evaluar cada Ticket contra el instante actual proporcionado por Clock antes de filtrar los resultados.
3. WHEN una operación de consulta o mutación no alcanza un Ticket cuyo vencimiento aún no se evalúa, THE Modulo_Notificaciones_Vencimiento SHALL conservar los registros existentes y no prometer una notificación fuera de las operaciones que ejecutan una Evaluación_de_Vencimiento.
4. WHEN Clock proporciona instantes controlados para una evaluación, THE Modulo_Notificaciones_Vencimiento SHALL usar esos instantes para determinar `overdue`, `escalatedAt` y `notifiedAt` sin leer directamente el reloj del sistema.
5. WHEN una operación de consulta o mutación evalúa un Ticket_Vencido, THE Modulo_Notificaciones_Vencimiento SHALL hacer visible en la representación resultante el estado `overdue` y los registros correspondientes del ciclo evaluado.

### Requirement 8: Consistencia de los registros de notificación

**User Story:** Como consumidor de TicketOps, quiero que cada notificación tenga una forma estable, para integrarla y verificarla sin depender de detalles internos.

#### Acceptance Criteria

1. THE Notificación_al_Supervisor SHALL contener `ticketId`, `cycle` y `notifiedAt` para cada evento emitido.
2. THE Escalamiento SHALL contener `ticketId`, `cycle`, `escalatedAt` y `notifiedAt` para cada evento persistido.
3. WHEN una Notificación_al_Supervisor corresponde al primer vencimiento de un ciclo, THE Modulo_Notificaciones_Vencimiento SHALL asociar la notificación con el mismo `ticketId` y `cycle` del Ticket que originó la evaluación.
4. WHEN una operación serializa un Ticket con eventos de vencimiento, THE TicketOps SHALL exponer los eventos sin alterar su `cycle`, sus identificadores ni sus instantes.
5. WHEN una operación no ha registrado eventos de vencimiento para un Ticket, THE TicketOps SHALL exponer colecciones vacías de Escalamientos y Notificaciones_al_Supervisor.
