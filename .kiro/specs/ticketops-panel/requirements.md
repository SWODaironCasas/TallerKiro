# Requirements Document

## Introduction

TicketOps Panel es un panel web servido por la misma aplicación de TicketOps bajo `/panel/`. El panel permitirá consultar, crear y operar tickets mediante la API REST existente, sin introducir una segunda fuente de datos ni una capa de autenticación distinta.

La implementación futura estará limitada a tres archivos públicos: `public/panel/index.html`, `public/panel/panel.css` y `public/panel/panel.js`. La implementación usará HTML, CSS y JavaScript nativos, sin frameworks ni librerías externas. Todo texto visible para las personas usuarias estará en español.

El panel consumirá la API usando rutas relativas del mismo origen. El panel no almacenará tickets como fuente de verdad, no ejecutará reglas de estado distintas de las proporcionadas por la API y no insertará como HTML ningún texto proveniente de una persona usuaria o de una respuesta remota.

## Glossary

- **Panel_TicketOps**: interfaz web de TicketOps disponible bajo `/panel/`.
- **API_TicketOps**: API REST de TicketOps que expone los recursos de tickets en el mismo origen que Panel_TicketOps.
- **Ticket**: recurso con `id`, `title`, `description`, `category`, `priority`, `requester`, `responsibleId`, `status`, `createdAt`, `updatedAt`, `dueAt`, `resolutionNote`, `resolvedAt`, `closedAt`, `overdue`, `overdueCycle`, `escalations` y `supervisorNotifications`.
- **Categoría**: valor `INFRAESTRUCTURA`, `ACCESOS`, `APLICACIONES` o `INSTALACIONES` enviado a la API; las etiquetas visibles serán «Infraestructura», «Accesos», «Aplicaciones» e «Instalaciones».
- **Prioridad**: valor `CRITICA`, `ALTA`, `MEDIA` o `BAJA` enviado a la API; las etiquetas visibles serán «Crítica», «Alta», «Media» y «Baja».
- **Estado**: valor `NUEVO`, `ASIGNADO`, `EN_PROGRESO`, `EN_ESPERA`, `RESUELTO` o `CERRADO` enviado por la API; las etiquetas visibles serán «Nuevo», «Asignado», «En progreso», «En espera», «Resuelto» y «Cerrado».
- **Ticket_Abierto**: Ticket cuyo Estado es `NUEVO`, `ASIGNADO`, `EN_PROGRESO` o `EN_ESPERA`.
- **Ticket_Resuelto**: Ticket cuyo Estado es `RESUELTO` o `CERRADO`.
- **Ticket_Vencido**: Ticket cuya propiedad `overdue` es `true`, según la evaluación realizada por API_TicketOps.
- **Actor_Id**: identificador opaco enviado en el encabezado HTTP `X-Actor-Id` para operaciones que requieren actor.
- **Acción**: operación visible sobre un Ticket: «Asignar», «Iniciar», «Reanudar», «Poner en espera», «Resolver», «Cerrar» o «Reabrir».
- **allowedTransitions**: colección de descriptores devuelta por API_TicketOps para cada Ticket. Cada descriptor identifica una Acción disponible, su estado destino cuando corresponda y el endpoint que debe utilizar Panel_TicketOps. La colección es la única fuente autorizada para mostrar acciones.
- **Respuesta_de_Error_Estándar**: objeto JSON con `error.code`, `error.message` y, opcionalmente, `error.details`, conforme al contrato actual de API_TicketOps.
- **Estado_de_Interfaz**: condición visual y anunciable de Panel_TicketOps: «cargando», «sin resultados», «error de conexión» o contenido disponible.
- **Texto_de_Usuario**: cualquier valor introducido en un formulario, incluido título, descripción, solicitante, Actor_Id, responsable y nota de resolución.
- **Tiempo_Relativo**: texto que expresa tiempo restante antes de `dueAt` o tiempo transcurrido después de `dueAt`.
- **Diálogo**: superficie modal accesible que requiere interacción antes de volver al contenido principal.
- **Mismo_Origen**: combinación de protocolo, host y puerto desde la que se sirvió `/panel/`; las solicitudes del panel no usarán un dominio externo.
- **successful_query**: consulta posterior a un cambio que termina correctamente y devuelve la representación vigente de los Tickets.
- **WCAG_2_1_AA**: nivel AA de las Pautas de Accesibilidad para el Contenido Web 2.1.
- **JavaScript_Nativo**: JavaScript del navegador sin frameworks, paquetes ni librerías externas.

## Requirements

### Requirement 1: Acceso y estructura del panel

**User Story:** Como operador, quiero abrir un panel web en la misma aplicación de TicketOps, para consultar y operar tickets sin cambiar de sistema.

#### Acceptance Criteria

1. WHEN un navegador solicita `/panel/`, THE Panel_TicketOps SHALL devolver y mostrar la interfaz desde el Mismo_Origen que API_TicketOps.
2. THE Panel_TicketOps SHALL usar únicamente `public/panel/index.html`, `public/panel/panel.css` y `public/panel/panel.js` como archivos de implementación del panel.
3. THE Panel_TicketOps SHALL usar JavaScript_Nativo, HTML y CSS sin frameworks ni librerías externas.
4. WHEN la interfaz termina de renderizarse, THE Panel_TicketOps SHALL mostrar el encabezado visible «TicketOps Panel de tickets».
5. THE Panel_TicketOps SHALL organizar visualmente el contenido con indicadores en la parte superior, el formulario «Nuevo ticket» en una zona lateral y la lista de tickets en la zona principal.
6. THE Panel_TicketOps SHALL mostrar todos los textos destinados a las personas usuarias en español, incluidos títulos, etiquetas, botones, estados, mensajes, validaciones y errores.

### Requirement 2: Indicadores de resumen

**User Story:** Como operador, quiero ver un resumen inmediato del trabajo, para identificar la carga abierta, los vencimientos y los tickets completados.

#### Acceptance Criteria

1. WHEN Panel_TicketOps dispone de una colección de Tickets, THE Panel_TicketOps SHALL mostrar los indicadores «Abiertos», «Vencidos» y «Resueltos».
2. WHEN Panel_TicketOps calcula el indicador «Abiertos», THE Panel_TicketOps SHALL contar únicamente Tickets_Abiertos.
3. WHEN Panel_TicketOps calcula el indicador «Vencidos», THE Panel_TicketOps SHALL contar únicamente Tickets_Vencidos.
4. WHEN Panel_TicketOps calcula el indicador «Resueltos», THE Panel_TicketOps SHALL contar únicamente Tickets_Resueltos.
5. WHEN una consulta o una mutación actualiza la colección de Tickets, THE Panel_TicketOps SHALL actualizar los tres indicadores con la colección más reciente.
6. WHEN una colección de Tickets está vacía, THE Panel_TicketOps SHALL mostrar cero en cada indicador.

### Requirement 3: Identificación del actor

**User Story:** Como operador, quiero identificar el actor de la sesión, para que API_TicketOps autorice las operaciones que lo requieren.

#### Acceptance Criteria

1. WHEN Panel_TicketOps solicita un Actor_Id, THE Panel_TicketOps SHALL mostrar una etiqueta visible en español y un campo de texto asociado para introducir el identificador.
2. WHEN Panel_TicketOps envía una solicitud de asignación, cambio de estado o consulta de vencidos, THE Panel_TicketOps SHALL incluir el Actor_Id normalizado en el encabezado `X-Actor-Id`.
3. WHEN el campo Actor_Id está ausente o contiene únicamente espacios, THEN THE Panel_TicketOps SHALL impedir la solicitud dependiente del actor y mostrar un mensaje visible en español que indique que el identificador es obligatorio.
4. WHEN una respuesta de API_TicketOps contiene `ACTOR_REQUIRED`, `ACTOR_UNKNOWN` o `SUPERVISOR_REQUIRED`, THE Panel_TicketOps SHALL mostrar el mensaje de API_TicketOps en un Estado_de_Interfaz de error sin exponer detalles técnicos innecesarios.
5. THE Panel_TicketOps SHALL conservar el Actor_Id en `sessionStorage` durante la sesión de la pestaña y SHALL solicitarlo de nuevo cuando `sessionStorage` no contenga un valor válido.

### Requirement 4: Carga y contrato de consulta de tickets

**User Story:** Como operador, quiero que el panel cargue los tickets desde la API real, para trabajar con información vigente.

#### Acceptance Criteria

1. WHEN Panel_TicketOps se inicia o se refresca, THE Panel_TicketOps SHALL solicitar `GET /tickets` mediante una ruta relativa del Mismo_Origen.
2. WHEN API_TicketOps responde correctamente a `GET /tickets`, THE Panel_TicketOps SHALL interpretar la respuesta como una colección JSON de Tickets.
3. WHEN Panel_TicketOps solicita un Ticket individual para una acción que requiera datos actualizados, THE Panel_TicketOps SHALL usar `GET /tickets/:id` mediante una ruta relativa del Mismo_Origen.
4. WHEN API_TicketOps responde con un error de HTTP, THEN THE Panel_TicketOps SHALL interpretar `Respuesta_de_Error_Estándar` y mostrar un mensaje claro en español.
5. WHEN una solicitud de consulta está en curso, THE Panel_TicketOps SHALL mostrar el Estado_de_Interfaz «cargando» y SHALL impedir acciones duplicadas para la misma solicitud.
6. WHEN una solicitud de consulta termina correctamente, THE Panel_TicketOps SHALL ocultar el Estado_de_Interfaz «cargando» y mostrar la colección recibida o el Estado_de_Interfaz «sin resultados».
7. WHEN una solicitud de consulta falla por red, timeout o indisponibilidad de API_TicketOps, THEN THE Panel_TicketOps SHALL mostrar el Estado_de_Interfaz «error de conexión» con una acción visible para reintentar.

### Requirement 5: Creación de tickets

**User Story:** Como solicitante, quiero registrar un ticket desde el panel, para iniciar una atención sin usar una herramienta externa.

#### Acceptance Criteria

1. THE Panel_TicketOps SHALL mostrar una sección con el título visible «Nuevo ticket».
2. THE Panel_TicketOps SHALL mostrar campos etiquetados para «Título», «Descripción», «Categoría», «Prioridad» y «Solicitante».
3. THE Panel_TicketOps SHALL marcar «Título», «Descripción», «Categoría», «Prioridad» y «Solicitante» como campos obligatorios.
4. WHEN una persona intenta enviar el formulario con un campo obligatorio vacío después de quitar espacios exteriores, THEN THE Panel_TicketOps SHALL impedir el envío y mostrar el mensaje de validación junto al campo correspondiente.
5. WHEN el título contiene más de 120 caracteres después de quitar espacios exteriores, THEN THE Panel_TicketOps SHALL impedir el envío y mostrar un mensaje en español que indique el máximo de 120 caracteres.
6. WHEN el formulario «Nuevo ticket» es válido, THE Panel_TicketOps SHALL enviar `POST /tickets` con exactamente `title`, `description`, `category`, `priority` y `requester` en el cuerpo JSON.
7. WHEN Panel_TicketOps envía `POST /tickets`, THE Panel_TicketOps SHALL no enviar `responsibleId`, `responsible` ni `responsable` en el cuerpo de creación.
8. WHEN API_TicketOps responde `201` a la creación, THE Panel_TicketOps SHALL mostrar un mensaje de éxito en español, limpiar el formulario y actualizar la colección y los indicadores.
9. WHEN API_TicketOps responde `INVALID_REQUEST` a la creación y contiene errores asociados a campos, THEN THE Panel_TicketOps SHALL mostrar cada error junto al campo correspondiente y SHALL mostrar cada error no asociable como mensaje general sin borrar los valores válidos que la persona ya introdujo.

### Requirement 6: Presentación de tickets y vencimientos

**User Story:** Como operador, quiero leer los datos importantes de cada ticket, para decidir qué atención realizar.

#### Acceptance Criteria

1. WHEN Panel_TicketOps muestra la colección de Tickets, THE Panel_TicketOps SHALL presentar para cada Ticket el ID, título, Categoría, Prioridad, Estado, vencimiento y Acciones.
2. WHEN Panel_TicketOps muestra un Estado, THE Panel_TicketOps SHALL usar la etiqueta visible en español asociada al valor de API_TicketOps.
3. WHEN `dueAt` está después del instante actual, THE Panel_TicketOps SHALL mostrar un Tiempo_Relativo que indique el tiempo restante hasta el vencimiento.
4. WHEN `overdue` es `true` o `dueAt` está antes del instante actual para un Ticket vigente en la respuesta, THE Panel_TicketOps SHALL mostrar un Tiempo_Relativo que empiece por «hace» y SHALL mostrar la insignia textual «VENCIDO».
5. WHEN un Ticket tiene la insignia «VENCIDO», THE Panel_TicketOps SHALL conservar el texto «VENCIDO» aunque el color, el contraste o un modo de alto contraste eliminen la diferencia cromática.
6. WHEN una persona abre el detalle de un Ticket, THE Panel_TicketOps SHALL mostrar descripción, solicitante, responsable, fechas relevantes y nota de resolución cuando API_TicketOps proporcione esos valores, y SHALL mostrar «No disponible» con una etiqueta explícita cuando API_TicketOps no proporcione cualquiera de esos campos.
7. WHEN el ID, título, descripción, solicitante, responsable o nota de resolución proviene de Texto_de_Usuario, THE Panel_TicketOps SHALL mostrar el valor como texto literal y SHALL preservar caracteres especiales sin interpretarlos como marcado.

### Requirement 7: Filtros y estados de la lista

**User Story:** Como operador, quiero filtrar la lista, para concentrarme en los tickets que requieren una atención concreta.

#### Acceptance Criteria

1. THE Panel_TicketOps SHALL mostrar las opciones de filtro «Todos» y «Solo vencidos» y una opción visible en español para cada Estado permitido.
2. WHEN una persona selecciona «Todos», THE Panel_TicketOps SHALL solicitar `GET /tickets` sin filtros de categoría, estado o prioridad.
3. WHEN una persona selecciona un Estado, THE Panel_TicketOps SHALL solicitar `GET /tickets?status={status}` usando el valor de Estado definido por API_TicketOps.
4. WHEN una persona selecciona «Solo vencidos», THE Panel_TicketOps SHALL solicitar `GET /tickets/overdue` con el Actor_Id en `X-Actor-Id`.
5. WHEN una persona cambia el filtro, THE Panel_TicketOps SHALL mostrar «cargando» durante la nueva consulta y SHALL reemplazar la lista anterior únicamente con la respuesta asociada al filtro seleccionado.
6. WHEN el filtro seleccionado no devuelve Tickets, THE Panel_TicketOps SHALL mostrar un mensaje visible en español que indique que no hay resultados para el filtro activo.
7. WHEN API_TicketOps responde `400` por una categoría, Estado o Prioridad inválida, THEN THE Panel_TicketOps SHALL mostrar el error estándar y SHALL conservar exactamente visible el filtro que originó la petición fallida.
8. WHEN API_TicketOps responde `403` para «Solo vencidos», THEN THE Panel_TicketOps SHALL informar en español que el Actor_Id no tiene permisos de Supervisor y SHALL ofrecer volver a «Todos».

### Requirement 8: Acciones derivadas de allowedTransitions

**User Story:** Como operador, quiero ver únicamente las acciones permitidas para cada ticket, para evitar operaciones inválidas y reflejar la máquina de estados de la API.

#### Acceptance Criteria

1. WHEN API_TicketOps devuelve un Ticket con `allowedTransitions`, THE Panel_TicketOps SHALL usar esa colección como única fuente para decidir qué Acciones mostrar.
2. WHEN `allowedTransitions` incluye una descriptor de asignación, THE Panel_TicketOps SHALL mostrar la Acción «Asignar».
3. WHEN `allowedTransitions` incluye el destino `EN_PROGRESO` desde `ASIGNADO`, THE Panel_TicketOps SHALL mostrar la Acción «Iniciar».
4. WHEN `allowedTransitions` incluye el destino `EN_PROGRESO` desde `EN_ESPERA`, THE Panel_TicketOps SHALL mostrar la Acción «Reanudar».
5. WHEN `allowedTransitions` incluye el destino `EN_ESPERA`, THE Panel_TicketOps SHALL mostrar la Acción «Poner en espera».
6. WHEN `allowedTransitions` incluye el destino `RESUELTO`, THE Panel_TicketOps SHALL mostrar la Acción «Resolver».
7. WHEN `allowedTransitions` incluye el destino `CERRADO`, THE Panel_TicketOps SHALL mostrar la Acción «Cerrar».
8. WHEN `allowedTransitions` incluye el destino `EN_PROGRESO` desde `RESUELTO` o `CERRADO`, THE Panel_TicketOps SHALL mostrar la Acción «Reabrir».
9. WHEN `allowedTransitions` no incluye una Acción, THE Panel_TicketOps SHALL ocultar el control de esa Acción y SHALL no enviar la mutación correspondiente.
10. WHEN un Ticket no contiene `allowedTransitions` en una respuesta que debe habilitar acciones, THEN THE Panel_TicketOps SHALL mostrar los datos del Ticket, SHALL mostrar un error de contrato no bloqueante en español en la sección de acciones y SHALL no mostrar botones de acciones ni inferir acciones a partir de colores, etiquetas o estado local.
11. WHEN una persona pulsa una Acción, THE Panel_TicketOps SHALL enviar la mutación indicada por el descriptor de `allowedTransitions` y SHALL actualizar el Ticket después de una respuesta exitosa.

### Requirement 9: Asignación de responsables

**User Story:** Como operador, quiero asignar un ticket a un agente activo, para que una persona responsable pueda atenderlo.

#### Acceptance Criteria

1. WHEN una persona selecciona «Asignar», THE Panel_TicketOps SHALL abrir un Diálogo con el campo etiquetado «ID del responsable».
2. WHEN el campo «ID del responsable» está vacío después de quitar espacios exteriores, THEN THE Panel_TicketOps SHALL impedir el envío y mostrar un mensaje de obligatoriedad en español.
3. WHEN el formulario de asignación es válido, THE Panel_TicketOps SHALL enviar `PATCH /tickets/:id/assignment` con `{ "responsibleId": "..." }` y el encabezado `X-Actor-Id`.
4. WHEN API_TicketOps responde `200` a la asignación, THE Panel_TicketOps SHALL cerrar el Diálogo, actualizar el Ticket y mostrar el responsable asignado.
5. WHEN API_TicketOps responde `AGENT_UNAVAILABLE`, THEN THE Panel_TicketOps SHALL mostrar un mensaje en español que indique que el agente no existe o no está activo y SHALL conservar abierto el Diálogo.
6. WHEN una persona cancela la asignación, THE Panel_TicketOps SHALL cerrar el Diálogo sin enviar una solicitud ni modificar la colección local.

### Requirement 10: Cambios de estado y resolución

**User Story:** Como operador, quiero ejecutar las transiciones permitidas y documentar las resoluciones, para mantener el ciclo de vida del ticket actualizado.

#### Acceptance Criteria

1. WHEN una persona selecciona «Iniciar», «Reanudar», «Poner en espera», «Cerrar» o «Reabrir», THE Panel_TicketOps SHALL enviar `PATCH /tickets/:id/status` con el Estado destino recibido en `allowedTransitions` y el encabezado `X-Actor-Id`.
2. WHEN una persona selecciona «Resolver», THE Panel_TicketOps SHALL abrir un Diálogo con el campo etiquetado «Nota de resolución».
3. WHEN la Nota de resolución está vacía después de quitar espacios exteriores, THEN THE Panel_TicketOps SHALL impedir la resolución y mostrar un mensaje en español que indique que la nota es obligatoria.
4. WHEN la Nota de resolución es válida, THE Panel_TicketOps SHALL enviar `PATCH /tickets/:id/status` con `status: "RESUELTO"`, `resolutionNote` y el encabezado `X-Actor-Id`.
5. WHEN API_TicketOps responde `200` a una transición, THE Panel_TicketOps SHALL cerrar cualquier Diálogo asociado, actualizar el Ticket, recalcular los indicadores y mostrar un mensaje de éxito en español.
6. WHEN API_TicketOps responde `INVALID_TRANSITION`, THEN THE Panel_TicketOps SHALL mostrar el conflicto en español, volver a consultar el Ticket y no presentar la mutación como exitosa.
7. WHEN una persona cancela el Diálogo de resolución, THE Panel_TicketOps SHALL cerrar el Diálogo sin enviar una mutación ni modificar la Nota de resolución almacenada.
8. WHEN un Ticket se reabre, THE Panel_TicketOps SHALL mostrar los datos que API_TicketOps devuelva para el nuevo Estado, el nuevo ciclo de vencimiento y los eventos de escalamiento conservados.

### Requirement 11: Errores, mensajes y sincronización

**User Story:** Como operador, quiero recibir mensajes claros cuando una operación falla, para saber qué ocurrió y qué acción puedo realizar.

#### Acceptance Criteria

1. WHEN API_TicketOps devuelve `TICKET_NOT_FOUND`, THEN THE Panel_TicketOps SHALL mostrar un mensaje en español que indique que el Ticket ya no existe y SHALL actualizar la lista.
2. WHEN API_TicketOps devuelve `INVALID_REQUEST`, `ACTOR_REQUIRED`, `ACTOR_UNKNOWN`, `AGENT_UNAVAILABLE`, `INVALID_TRANSITION` o `SUPERVISOR_REQUIRED`, THEN THE Panel_TicketOps SHALL mostrar el `error.message` y los `error.details` útiles en lenguaje visible en español o en la traducción definida por el panel.
3. WHEN una mutación termina con éxito, THE Panel_TicketOps SHALL ejecutar una `successful_query` que consulte o actualice la representación vigente del Ticket y SHALL tratar esa `successful_query` como precondición para volver a habilitar sus Acciones.
4. WHEN una mutación está en curso, THE Panel_TicketOps SHALL indicar visualmente que la operación está cargando y SHALL impedir envíos duplicados del mismo formulario o Acción.
5. WHEN un error de conexión impide una mutación, THEN THE Panel_TicketOps SHALL conservar los datos introducidos en el formulario o los datos de la Acción, SHALL mostrar el Estado_de_Interfaz de error mientras la repetición automática esté pendiente y SHALL reintentar automáticamente una única vez la misma mutación con los datos preservados.
6. WHEN la única repetición automática de una mutación falla, THEN THE Panel_TicketOps SHALL mantener el Estado_de_Interfaz de error y SHALL ofrecer reintentar manualmente la misma mutación con los datos preservados.
7. WHEN un mensaje dinámico aparece, THE Panel_TicketOps SHALL anunciar el mensaje mediante una región accesible para lectores de pantalla sin mover el foco de forma inesperada.

### Requirement 12: Seguridad de representación y solicitudes

**User Story:** Como responsable de seguridad, quiero que el panel trate los textos y respuestas remotas como datos, para evitar inyección de contenido y solicitudes no autorizadas.

#### Acceptance Criteria

1. WHEN Panel_TicketOps representa Texto_de_Usuario o contenido de API_TicketOps, THE Panel_TicketOps SHALL usar nodos de texto o propiedades seguras equivalentes y SHALL no interpretar el contenido como HTML, SVG o JavaScript.
2. WHEN Texto_de_Usuario contiene etiquetas, atributos, entidades o secuencias de script, THE Panel_TicketOps SHALL mostrar el contenido literal o neutralizado sin ejecutarlo.
3. THE Panel_TicketOps SHALL no usar `innerHTML`, `outerHTML`, `document.write` ni mecanismos equivalentes para insertar Texto_de_Usuario.
4. WHEN Panel_TicketOps envía solicitudes a API_TicketOps, THE Panel_TicketOps SHALL usar únicamente rutas del Mismo_Origen y SHALL incluir solamente los datos requeridos por cada contrato.
5. THE Panel_TicketOps SHALL no registrar en consola el Actor_Id, la Nota de resolución, la descripción ni otros Texto_de_Usuario.

### Requirement 13: Accesibilidad WCAG 2.1 AA

**User Story:** Como persona que usa teclado o tecnología de asistencia, quiero operar el panel completo, para consultar y actualizar tickets sin depender de un ratón o de la percepción del color.

#### Acceptance Criteria

1. THE Panel_TicketOps SHALL asociar cada campo de formulario con una etiqueta visible y un nombre accesible.
2. THE Panel_TicketOps SHALL permitir alcanzar y activar mediante teclado el formulario, filtros, filas o tarjetas, Acciones, Diálogos, botones de cancelar y controles de reintento.
3. THE Panel_TicketOps SHALL mostrar un indicador de foco visible en cada elemento interactivo enfocado por teclado.
4. THE Panel_TicketOps SHALL proporcionar contraste suficiente para texto normal, texto grande, controles y elementos informativos conforme a WCAG_2_1_AA, sin depender únicamente del color.
5. WHEN un Diálogo se abre, THE Panel_TicketOps SHALL anunciar el nombre del Diálogo, mover el foco al primer control operativo y mantener el foco dentro del Diálogo hasta su cierre.
6. WHEN un Diálogo se cierra, THE Panel_TicketOps SHALL devolver el foco al control que abrió el Diálogo.
7. WHEN un Estado_de_Interfaz cambia, THE Panel_TicketOps SHALL exponer el cambio mediante una región con nombre accesible y `aria-live` apropiado.
8. WHEN una persona usa `prefers-reduced-motion: reduce`, THE Panel_TicketOps SHALL reducir o eliminar animaciones, transiciones y desplazamientos no esenciales.
9. WHEN un Ticket está vencido, THE Panel_TicketOps SHALL comunicar «VENCIDO» mediante texto accesible además de cualquier estilo visual.
10. WHEN una validación falla, THE Panel_TicketOps SHALL asociar el mensaje de error con el campo afectado y SHALL anunciar el error sin depender únicamente del color.

### Requirement 14: Diseño responsive

**User Story:** Como operador que usa una pantalla pequeña, quiero consultar y operar tickets desde un ancho de 375 píxeles, para trabajar sin desplazamiento horizontal.

#### Acceptance Criteria

1. WHEN la ventana del navegador tiene un ancho de 375 píxeles o menor, THE Panel_TicketOps SHALL mostrar cada fila de Ticket como una tarjeta apilada.
2. WHEN la ventana del navegador tiene un ancho de 375 píxeles o menor, THE Panel_TicketOps SHALL mantener visibles el título, Estado, vencimiento y Acciones de cada tarjeta sin scroll horizontal.
3. WHEN la ventana del navegador tiene un ancho de 375 píxeles o menor, THE Panel_TicketOps SHALL reordenar el formulario lateral, indicadores y lista en un flujo vertical legible.
4. WHEN el contenido de un Ticket es largo, THE Panel_TicketOps SHALL permitir leer el contenido sin desbordar el viewport ni ocultar las Acciones mediante recorte horizontal.
5. THE Panel_TicketOps SHALL conservar foco visible, nombres accesibles y controles operables en todas las disposiciones responsive.

### Requirement 15: Integridad de la implementación futura

**User Story:** Como mantenedor, quiero límites técnicos claros para el panel, para poder implementarlo sin introducir dependencias o contratos paralelos.

#### Acceptance Criteria

1. THE Panel_TicketOps SHALL cargar comportamiento únicamente desde `public/panel/panel.js` y estilos únicamente desde `public/panel/panel.css`.
2. THE Panel_TicketOps SHALL no importar módulos, fuentes, iconos, imágenes, hojas de estilo ni scripts desde dominios externos.
3. THE Panel_TicketOps SHALL usar los nombres de campo, valores de catálogo, rutas, códigos HTTP y códigos de error definidos por API_TicketOps.
4. WHEN `successful_query` ocurre después de un cambio en el Estado o las Acciones permitidas de un Ticket, THE Panel_TicketOps SHALL reflejar la respuesta vigente y SHALL eliminar las Acciones obsoletas.
5. THE Panel_TicketOps SHALL conservar los errores y estados de interfaz verificables mediante pruebas de navegador o integración sin requerir un servidor externo distinto de API_TicketOps.

## Decisiones confirmadas para el diseño y las tareas

Las decisiones de esta sección forman parte del alcance aprobado y deben conservarse al regenerar `design.md` y `tasks.md`. No son alternativas abiertas.

1. **Exposición de `allowedTransitions`.** API_TicketOps ampliará las representaciones de `GET /tickets` y `GET /tickets/:id` con una colección `allowedTransitions` calculada por el servidor. Cada Ticket podrá exponer los descriptores de `ASIGNAR`, `EN_PROGRESO`, `EN_ESPERA`, `RESUELTO`, `CERRADO` y `REABRIR` según corresponda. Panel_TicketOps no inferirá acciones si la respuesta no entrega la colección.
2. **Forma de `allowedTransitions`.** Cada descriptor identificará de forma no ambigua la acción, el Estado destino cuando corresponda, el método HTTP, la ruta y la entrada requerida. La forma deberá representar la asignación mediante `PATCH /tickets/:id/assignment`, aunque «Asignar» sea una Acción y no una transición de estado. La colección será la única fuente para mostrar y enviar Acciones.
3. **Actor_Id sin login.** Panel_TicketOps solicitará el Actor_Id en un campo visible, lo normalizará antes de enviarlo en `X-Actor-Id` y lo conservará únicamente en `sessionStorage` durante la sesión de la pestaña. Panel_TicketOps volverá a solicitarlo cuando `sessionStorage` no contenga un valor válido.
4. **Identificador del responsable.** Como API_TicketOps valida `responsibleId` como texto opaco y no expone un catálogo de agentes, Panel_TicketOps solicitará manualmente el ID del responsable en el Diálogo «Asignar». Esta decisión se mantiene hasta que un contrato posterior defina un catálogo.
5. **Consulta de vencidos.** `GET /tickets/overdue` continuará protegido por el rol Supervisor. «Solo vencidos» requerirá un Actor_Id autorizado y usará esa ruta; Panel_TicketOps no sustituirá la consulta por un filtrado local de `GET /tickets`.
6. **Definición de los indicadores.** «Abiertos» contará `NUEVO`, `ASIGNADO`, `EN_PROGRESO` y `EN_ESPERA`; «Vencidos» contará únicamente Tickets con `overdue: true`; «Resueltos» contará `RESUELTO` y `CERRADO`.
7. **Ruta de archivos estáticos.** La aplicación servirá `public/panel/index.html`, `public/panel/panel.css` y `public/panel/panel.js` bajo `/panel/` desde el mismo origen que API_TicketOps, sin abrir un origen adicional. `/panel/` entregará `index.html` y resolverá los dos assets relativos.
8. **Texto de errores.** Panel_TicketOps usará un mapa de códigos a mensajes visibles en español. Conservará `error.details` para asociar errores de validación con campos y mostrar detalles generales útiles, sin exponer trazas internas ni Texto_de_Usuario en consola.
9. **Precondición de sincronización.** `successful_query` será la precondición para volver a habilitar las Acciones de un Ticket después de una mutación exitosa. Panel_TicketOps mantendrá las Acciones deshabilitadas hasta recibir y aplicar la representación vigente del Ticket y la colección correspondiente; una respuesta obsoleta o fallida no podrá presentarse como sincronización exitosa.
