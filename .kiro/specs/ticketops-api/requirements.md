# Requirements Document

## Introduction

TicketOps es una API REST para registrar, consultar y operar tickets de una organización. La primera versión gestionará los datos en memoria y expondrá reglas explícitas para asignación, transiciones de estado, resolución, vencimiento de SLA, escalamiento e historial.

La especificación fija el comportamiento observable de la API y las restricciones de arranque y pruebas. La estructura interna, el mecanismo concreto para conservar datos en memoria y el mecanismo de identificación del actor quedan abiertos para el documento de diseño, siempre que el comportamiento descrito permanezca verificable.

## Glossary

- **TicketOps_API**: API REST que gestiona tickets operacionales.
- **Ticket**: unidad de trabajo operacional con título, descripción, categoría, prioridad, solicitante, responsable opcional, estado, fechas y metadatos de SLA.
- **Categoría**: clasificación del ticket. Los valores permitidos son `INFRAESTRUCTURA`, `ACCESOS`, `APLICACIONES` e `INSTALACIONES`.
- **Prioridad**: nivel de urgencia del ticket. Los valores permitidos son `CRITICA`, `ALTA`, `MEDIA` y `BAJA`.
- **Estado**: etapa del ciclo de vida del ticket. Los valores permitidos son `NUEVO`, `ASIGNADO`, `EN_PROGRESO`, `EN_ESPERA`, `RESUELTO` y `CERRADO`.
- **Solicitante**: identidad de la persona que registra o solicita el ticket.
- **Responsable**: agente que atiende el ticket. El responsable es opcional mientras el ticket no esté asignado.
- **Agente**: identidad operativa que puede ser responsable de un ticket.
- **Agente_Activo**: agente habilitado por el directorio de agentes para recibir asignaciones.
- **Supervisor**: actor con permiso para consultar tickets vencidos por categoría y recibir escalaciones.
- **Actor**: identidad que ejecuta una operación sobre un ticket y que queda registrada como autor de los cambios de estado.
- **Nota_de_Resolución**: explicación obligatoria que documenta cómo se resolvió un ticket.
- **SLA_de_Resolución**: tiempo máximo permitido desde la creación del ticket hasta su resolución, determinado por la prioridad.
- **Fecha_de_Vencimiento**: instante calculado al crear el ticket sumando el SLA de resolución a la fecha de creación.
- **Ticket_Vencido**: ticket sin resolución cuyo instante actual supera la Fecha_de_Vencimiento.
- **Escalamiento**: registro de que un Ticket_Vencido fue elevado al Supervisor.
- **Notificación_al_Supervisor**: registro observable en el modelo en memoria o en una respuesta de la API que indica que un Ticket_Vencido fue notificado al Supervisor, con el identificador del Ticket y la fecha de notificación.
- **Historial_de_Estado**: secuencia de entradas que registra cada cambio de estado, con estado anterior, estado nuevo, fecha y autor.
- **Formato_de_Error_Estándar**: respuesta JSON de error con un objeto `error` que contiene, como mínimo, `code` y `message`; el campo `details` puede incluir información de validación.
- **Fecha_ISO_UTC**: fecha y hora serializada en formato ISO 8601 con zona UTC.
- **Estado_de_Salud**: respuesta mínima que indica que TicketOps_API está disponible.
- **Directorio_de_Agentes**: fuente de verdad que permite determinar si un Agente está activo; el diseño establecerá si la fuente es interna o una dependencia configurable.
- **TypeScript_5_9**: versión de TypeScript requerida para compilar la aplicación; la versión 7 de TypeScript no está permitida.
- **Pruebas_de_API**: pruebas automatizadas de archivos `*.test.ts` ejecutadas con Vitest.
- **Proyecto_TicketOps**: código fuente, configuración y scripts que construyen y ejecutan TicketOps_API.
- **Node.js_20**: runtime de Node.js versión 20 o superior requerido para Proyecto_TicketOps.
- **Express**: framework HTTP requerido para exponer TicketOps_API.
- **zod**: biblioteca requerida para validar datos de entrada de TicketOps_API.
- **Vitest**: herramienta requerida para ejecutar Pruebas_de_API.
- **ESLint**: herramienta requerida para revisar la calidad estática del código TypeScript.
- **pnpm**: gestor de paquetes requerido para instalar dependencias y ejecutar scripts de Proyecto_TicketOps.

## Requirements

### Requirement 1: Modelo y creación de tickets

**User Story:** Como solicitante, quiero registrar un ticket operacional con datos consistentes, para que la organización pueda darle seguimiento.

#### Acceptance Criteria

1. WHEN una solicitud válida llega a `POST /tickets`, THE TicketOps_API SHALL crear un Ticket con un identificador único, título, descripción, Categoría, Prioridad, Solicitante, estado `NUEVO`, fecha de creación y fecha de actualización.
2. WHEN una solicitud válida llega a `POST /tickets`, THE TicketOps_API SHALL calcular la Fecha_de_Vencimiento usando la Fecha_de_Creación y el SLA_de_Resolución de la Prioridad recibida.
3. WHEN no se proporciona `responsable` al crear un Ticket, THE TicketOps_API SHALL conservar el Responsable como no asignado.
4. WHEN se crea un Ticket, THE TicketOps_API SHALL devolver el Ticket creado con una respuesta HTTP `201`.
5. WHEN se crea un Ticket, THE TicketOps_API SHALL serializar las fechas del Ticket como Fecha_ISO_UTC.
6. WHEN el título, la descripción o el solicitante está ausente, vacío o tiene un tipo inválido, THEN THE TicketOps_API SHALL rechazar la creación con HTTP `400` y el Formato_de_Error_Estándar.
7. WHEN la Categoría o la Prioridad contiene un valor fuera del catálogo permitido, THEN THE TicketOps_API SHALL rechazar la creación con HTTP `400` y el Formato_de_Error_Estándar.

### Requirement 2: Validación de campos obligatorios al crear tickets

**User Story:** Como solicitante, quiero que la API valide los campos obligatorios del ticket, para recibir errores claros cuando los datos de registro sean incompletos o inválidos.

#### Acceptance Criteria

1. WHEN una solicitud llega a `POST /tickets`, THE TicketOps_API SHALL validar que `title`, `description`, `category`, `priority` y `requester` estén presentes y tengan el tipo esperado.
2. WHEN una solicitud a `POST /tickets` omite cualquiera de los campos obligatorios `title`, `description`, `category`, `priority` o `requester`, THEN THE TicketOps_API SHALL rechazar la creación con HTTP `400` y el Formato_de_Error_Estándar.
3. WHEN un valor de texto de los campos obligatorios `title`, `description` o `requester` queda vacío después de quitar los espacios al inicio y al final, THEN THE TicketOps_API SHALL rechazar la creación con HTTP `400` y el Formato_de_Error_Estándar.
4. WHEN `category` o `priority` tiene un tipo distinto del esperado, THEN THE TicketOps_API SHALL rechazar la creación con HTTP `400` y el Formato_de_Error_Estándar.
5. WHEN `responsible` no se proporciona en una solicitud válida a `POST /tickets`, THE TicketOps_API SHALL aceptar la creación y conservar el Responsable como no asignado.

### Requirement 3: Longitud máxima del título del ticket

**User Story:** Como solicitante, quiero que la API limite la longitud del título, para conservar títulos claros y consistentes en los tickets.

#### Acceptance Criteria

1. WHEN una solicitud llega a `POST /tickets`, THE TicketOps_API SHALL evaluar la longitud de `title` después de quitar los espacios al inicio y al final.
2. WHEN el valor de `title` tiene como máximo 120 caracteres después de quitar los espacios al inicio y al final, THE TicketOps_API SHALL considerar válida la regla de longitud máxima.
3. WHEN el valor de `title` supera 120 caracteres después de quitar los espacios al inicio y al final, THEN THE TicketOps_API SHALL rechazar la creación con HTTP `400` y el Formato_de_Error_Estándar.

### Requirement 4: Consulta de tickets

**User Story:** Como operador, quiero consultar tickets, para conocer el trabajo pendiente y el estado de cada solicitud.

#### Acceptance Criteria

1. WHEN una solicitud llega a `GET /tickets`, THE TicketOps_API SHALL devolver HTTP `200` con una colección de Tickets existentes en memoria.
2. WHEN una solicitud llega a `GET /tickets/:id` con un identificador existente, THE TicketOps_API SHALL devolver HTTP `200` con el Ticket correspondiente.
3. WHEN una solicitud llega a `GET /tickets/:id` con un identificador inexistente, THEN THE TicketOps_API SHALL devolver HTTP `404` con el Formato_de_Error_Estándar.
4. WHEN una solicitud llega a `GET /tickets` con un filtro `category` válido, THE TicketOps_API SHALL devolver únicamente los Tickets cuya Categoría coincide con el filtro.
5. WHEN una solicitud llega a `GET /tickets` con un filtro `status` válido, THE TicketOps_API SHALL devolver únicamente los Tickets cuyo Estado coincide con el filtro.
6. WHEN una solicitud llega a `GET /tickets` con un filtro `priority` válido, THE TicketOps_API SHALL devolver únicamente los Tickets cuya Prioridad coincide con el filtro.
7. WHEN una solicitud llega a `GET /tickets` con varios filtros válidos entre `category`, `status` y `priority`, THE TicketOps_API SHALL combinar los filtros con lógica AND y devolver únicamente los Tickets que cumplan simultáneamente todos los filtros recibidos.
8. WHEN `category`, `status` o `priority` contiene un valor fuera de su catálogo permitido, THEN THE TicketOps_API SHALL devolver HTTP `400` con el Formato_de_Error_Estándar.

### Requirement 5: Asignación de responsables

**User Story:** Como operador, quiero asignar un ticket a un agente activo, para que una persona pueda atenderlo.

#### Acceptance Criteria

1. WHEN una solicitud válida llega a `PATCH /tickets/:id/assignment` y asigna un Agente_Activo a un Ticket existente, THE TicketOps_API SHALL guardar el Responsable y cambiar el Estado del Ticket a `ASIGNADO` cuando el Estado anterior sea `NUEVO`.
2. WHEN una solicitud válida asigna un Agente_Activo a un Ticket existente con otro Estado operativo, THE TicketOps_API SHALL guardar el nuevo Responsable sin cambiar el Estado, salvo que la transición solicitada sea válida según el Requisito 6.
3. WHEN una solicitud intenta asignar un agente que no existe en el Directorio_de_Agentes o no está activo, THEN THE TicketOps_API SHALL rechazar la operación con HTTP `409` y el Formato_de_Error_Estándar.
4. WHEN una solicitud intenta asignar un responsable con un identificador ausente o de tipo inválido, THEN THE TicketOps_API SHALL rechazar la operación con HTTP `400` y el Formato_de_Error_Estándar.
5. WHEN una asignación válida actualiza un Ticket, THE TicketOps_API SHALL actualizar la fecha de actualización del Ticket y devolver el Ticket actualizado con HTTP `200`.

### Requirement 6: Transiciones de estado

**User Story:** Como operador, quiero mover un ticket entre estados permitidos, para reflejar el avance real de la atención.

#### Acceptance Criteria

1. THE TicketOps_API SHALL permitir las transiciones `NUEVO` a `ASIGNADO`, `ASIGNADO` a `EN_PROGRESO`, `EN_PROGRESO` a `EN_ESPERA`, `EN_ESPERA` a `EN_PROGRESO`, `EN_PROGRESO` a `RESUELTO`, `EN_ESPERA` a `RESUELTO` y `RESUELTO` a `CERRADO` mediante `PATCH /tickets/:id/status`.
2. THE TicketOps_API SHALL conservar el Estado actual cuando una operación no solicita una transición.
3. WHEN una solicitud solicita una transición distinta de las transiciones permitidas, THEN THE TicketOps_API SHALL rechazar la operación con HTTP `409` y el Formato_de_Error_Estándar.
4. WHEN una solicitud intenta cambiar el Estado de un Ticket inexistente, THEN THE TicketOps_API SHALL devolver HTTP `404` con el Formato_de_Error_Estándar.
5. WHEN una solicitud solicita un Estado ausente o fuera del catálogo permitido, THEN THE TicketOps_API SHALL devolver HTTP `400` con el Formato_de_Error_Estándar.
6. WHEN una transición válida cambia el Estado, THE TicketOps_API SHALL actualizar la fecha de actualización del Ticket.
7. WHEN una solicitud válida llega a `PATCH /tickets/:id/status` y solicita una transición permitida, THE TicketOps_API SHALL devolver HTTP `200` con el Ticket actualizado.
### Requirement 7: Resolución y cierre

**User Story:** Como agente, quiero documentar la resolución antes de cerrar un ticket, para conservar la evidencia de la solución aplicada.

#### Acceptance Criteria

1. WHEN una solicitud a `PATCH /tickets/:id/status` cambia un Ticket a `RESUELTO`, THE TicketOps_API SHALL exigir una Nota_de_Resolución no vacía.
2. WHEN una solicitud intenta cambiar un Ticket a `RESUELTO` sin una Nota_de_Resolución válida, THEN THE TicketOps_API SHALL rechazar la operación con HTTP `400` y el Formato_de_Error_Estándar.
3. WHEN un Ticket cambia a `RESUELTO` con una Nota_de_Resolución válida, THE TicketOps_API SHALL guardar la Nota_de_Resolución y la fecha de resolución como Fecha_ISO_UTC.
4. WHEN un Ticket cambia a `CERRADO`, THE TicketOps_API SHALL exigir que el Estado anterior sea `RESUELTO`.
5. WHEN un Ticket cambia a `CERRADO`, THE TicketOps_API SHALL guardar la fecha de cierre como Fecha_ISO_UTC.
6. WHEN una solicitud intenta cerrar un Ticket que no está `RESUELTO`, THEN THE TicketOps_API SHALL rechazar la operación con HTTP `409` y el Formato_de_Error_Estándar.

### Requirement 8: SLA, vencimiento y escalamiento

**User Story:** Como supervisor, quiero identificar y recibir el escalamiento de tickets fuera de SLA, para priorizar la atención de incumplimientos.

#### Acceptance Criteria

1. THE TicketOps_API SHALL asociar `CRITICA` con 4 horas, `ALTA` con 8 horas, `MEDIA` con 24 horas y `BAJA` con 72 horas de SLA_de_Resolución.
2. WHEN el instante actual supera la Fecha_de_Vencimiento de un Ticket cuyo Estado no es `RESUELTO` ni `CERRADO`, THE TicketOps_API SHALL marcar el Ticket como Ticket_Vencido.
3. WHEN un Ticket supera su Fecha_de_Vencimiento por primera vez mientras su Estado no es `RESUELTO` ni `CERRADO`, o vuelve a superar su Fecha_de_Vencimiento después de haber cambiado a un Estado distinto de `RESUELTO` o `CERRADO`, THE TicketOps_API SHALL registrar un nuevo Escalamiento al Supervisor, conservar una nueva Notificación_al_Supervisor observable en el modelo en memoria o en una respuesta de la API, y registrar la fecha de escalamiento y la fecha de notificación como Fecha_ISO_UTC.
4. WHEN un Ticket_Vencido cambia a `RESUELTO` o `CERRADO`, THE TicketOps_API SHALL conservar el indicador de vencimiento y el registro de Escalamiento.
5. WHEN una operación consulta tickets vencidos, THE TicketOps_API SHALL evaluar el vencimiento con base en la Fecha_de_Vencimiento y el estado actual antes de devolver resultados.
6. WHEN una solicitud de un Supervisor llega a `GET /tickets/overdue`, THE TicketOps_API SHALL devolver HTTP `200` con los Tickets_Vencidos.
7. WHEN una solicitud de un Supervisor llega a `GET /tickets/overdue?category={category}`, THE TicketOps_API SHALL devolver únicamente los Tickets_Vencidos de la Categoría indicada.
8. WHEN una solicitud a `GET /tickets/overdue` contiene una Categoría inválida, THEN THE TicketOps_API SHALL devolver HTTP `400` con el Formato_de_Error_Estándar.
9. WHEN un actor sin permisos de Supervisor solicita `GET /tickets/overdue`, THEN THE TicketOps_API SHALL devolver HTTP `403` con el Formato_de_Error_Estándar.

### Requirement 9: Historial de estados y autoría

**User Story:** Como auditor, quiero consultar el historial de estados, para saber cuándo y quién realizó cada cambio.

#### Acceptance Criteria

1. WHEN un Ticket cambia de Estado, THE TicketOps_API SHALL añadir una entrada al Historial_de_Estado con Estado anterior, Estado nuevo, fecha y Actor.
2. WHEN una solicitud válida llega a `GET /tickets/:id/history` con un identificador existente, THE TicketOps_API SHALL devolver HTTP `200` con el Historial_de_Estado ordenado desde el cambio más antiguo al más reciente.
3. WHEN una solicitud llega a `GET /tickets/:id/history` con un identificador inexistente, THEN THE TicketOps_API SHALL devolver HTTP `404` con el Formato_de_Error_Estándar.
4. WHEN una operación cambia un Ticket sin un Actor identificable, THEN THE TicketOps_API SHALL rechazar la operación con HTTP `400` y el Formato_de_Error_Estándar.
5. WHEN una operación no cambia el Estado de un Ticket, THE TicketOps_API SHALL conservar el Historial_de_Estado sin añadir una entrada de cambio de estado.

### Requirement 10: Contrato HTTP y errores

**User Story:** Como consumidor de la API, quiero respuestas HTTP predecibles, para manejar correctamente resultados y errores.

#### Acceptance Criteria

1. THE TicketOps_API SHALL devolver el Formato_de_Error_Estándar para errores de validación, autorización, conflicto, recurso inexistente y ruta inexistente.
2. WHEN una solicitud usa un método no permitido para una ruta existente, THEN THE TicketOps_API SHALL devolver HTTP `405` con el Formato_de_Error_Estándar.
3. WHEN una solicitud llega a una ruta inexistente, THEN THE TicketOps_API SHALL devolver HTTP `404` con el Formato_de_Error_Estándar.
4. WHEN el cuerpo de una solicitud JSON no es válido, THEN THE TicketOps_API SHALL devolver HTTP `400` con el Formato_de_Error_Estándar.
5. WHEN una operación termina correctamente, THE TicketOps_API SHALL devolver un código HTTP de éxito y una representación JSON coherente con el recurso operado.

### Requirement 11: Información del servicio y salud

**User Story:** Como operador de plataforma, quiero comprobar la salud y las capacidades de TicketOps, para integrar y monitorizar el servicio.

#### Acceptance Criteria

1. WHEN una solicitud llega a `GET /`, THE TicketOps_API SHALL devolver HTTP `200` con el nombre del servicio, el estado del servicio y una lista que incluya `GET /`, `GET /health`, `POST /tickets`, `GET /tickets`, `GET /tickets/:id`, `PATCH /tickets/:id/assignment`, `PATCH /tickets/:id/status`, `GET /tickets/:id/history` y `GET /tickets/overdue`.
2. WHEN una solicitud llega a `GET /health`, THE TicketOps_API SHALL devolver HTTP `200` con exactamente el campo `status` y el valor `ok` en la respuesta mínima `{"status":"ok"}`.
3. WHEN el servicio se inicia sin una variable `PORT`, THE TicketOps_API SHALL escuchar en el puerto `3000`.
4. WHEN el servicio se inicia con una variable `PORT` válida, THE TicketOps_API SHALL escuchar en el puerto indicado por `PORT`.

### Requirement 12: Persistencia y aislamiento de ejecución

**User Story:** Como desarrollador, quiero una primera versión sin base de datos, para probar el flujo de tickets sin administrar infraestructura de persistencia.

#### Acceptance Criteria

1. THE TicketOps_API SHALL conservar Tickets, Historial_de_Estado, registros de Escalamiento y Notificaciones_al_Supervisor únicamente en memoria durante la ejecución del proceso.
2. WHEN el proceso de TicketOps_API termina, THE TicketOps_API SHALL permitir que los datos en memoria se pierdan sin requerir una migración o una operación de base de datos.
3. THE TicketOps_API SHALL operar sin exigir una conexión a una base de datos para iniciar o ejecutar los endpoints especificados.

### Requirement 13: Estructura de aplicación y arranque

**User Story:** Como desarrollador, quiero separar la aplicación HTTP del arranque del servidor, para probar la API sin abrir un puerto real.

#### Acceptance Criteria

1. THE Proyecto_TicketOps SHALL exponer la instancia de Express desde `src/app.ts` sin iniciar un listener.
2. THE Proyecto_TicketOps SHALL iniciar el listener desde `src/server.ts` mediante el puerto definido por `PORT` o `3000` cuando `PORT` no está definido.
3. WHEN un consumidor importa `src/app.ts` durante una Prueba_de_API, THE Proyecto_TicketOps SHALL permitir que el consumidor ejecute solicitudes contra la aplicación sin iniciar `listen`.
4. THE Proyecto_TicketOps SHALL usar Node.js_20, Express, zod y Vitest como tecnologías requeridas de ejecución, validación y pruebas.
5. THE Proyecto_TicketOps SHALL usar pnpm como gestor de paquetes y SHALL no requerir un flujo basado en npm o yarn.
6. THE Proyecto_TicketOps SHALL fijar TypeScript_5_9 como versión del compilador y SHALL excluir TypeScript 7 del proyecto.
### Requirement 14: Compilación, pruebas y scripts del proyecto

**User Story:** Como desarrollador, quiero comandos reproducibles de construcción, pruebas y calidad, para validar cambios antes de ejecutar TicketOps.

#### Acceptance Criteria

1. THE Proyecto_TicketOps SHALL definir en `package.json` un script `start` que ejecute `node dist/server.js`.
2. THE Proyecto_TicketOps SHALL define en `package.json` un script `build` que produzca la salida compilada de la aplicación en `dist`.
3. THE Proyecto_TicketOps SHALL definir en `package.json` un script `test` que ejecute las Pruebas_de_API con Vitest en modo de una sola ejecución.
4. THE Proyecto_TicketOps SHALL definir en `package.json` un script `lint` que ejecute ESLint sobre el código TypeScript del proyecto.
5. THE Proyecto_TicketOps SHALL configurar TypeScript_5_9 para excluir los archivos `*.test.ts` de la salida `dist`.
6. WHEN una Prueba_de_API importa `src/app.ts`, THE Pruebas_de_API SHALL poder ejecutarse sin iniciar el listener de `src/server.ts`.
7. WHEN el comando `build` finaliza correctamente, THE Proyecto_TicketOps SHALL contener el punto de entrada compilado del servidor en `dist/server.js`.
