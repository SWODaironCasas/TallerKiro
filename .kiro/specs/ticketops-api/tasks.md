# Implementation Plan: TicketOps API

## Overview

Este plan convierte el diseño vigente de TicketOps en prompts incrementales para un agente de generación de código. Cada tarea produce código o pruebas integradas con las tareas anteriores y termina conectando la aplicación Express, sus dependencias en memoria y la suite automatizada.

La implementación usará Node.js 20+, TypeScript 5.9.x, Express, zod, Vitest, fast-check, supertest, ESLint y pnpm. El almacenamiento será exclusivamente en memoria. Las pruebas de propiedades cubrirán las 15 propiedades de corrección definidas en `design.md`; las pruebas de ejemplo e integración cubrirán los contratos HTTP, configuración y arranque.

## Tasks

- [x] 1. Preparar la estructura ejecutable y las herramientas del proyecto
  - [x] 1.1 Crear el manifiesto y los scripts reproducibles del proyecto
    - Crear o actualizar `package.json` con `type: module`, `engines.node` para Node.js 20+, `packageManager` de pnpm y dependencias de Express, zod, TypeScript 5.9.x, Vitest, fast-check, supertest, ESLint y los adaptadores de TypeScript.
    - Definir `start` como `node dist/server.js`, `build` como la compilación TypeScript, `test` como `vitest run` y `lint` como ESLint sobre el código TypeScript.
    - No añadir TypeScript 7 ni requerir scripts basados en npm o yarn.
    - _Requisitos: 13.4, 13.5, 13.6, 14.1, 14.2, 14.3, 14.4_

  - [x] 1.2 Configurar TypeScript para la aplicación ESM
    - Crear `tsconfig.json` con `strict: true`, `rootDir: src`, `outDir: dist`, módulos compatibles con `type: module` y resolución coherente con Node.js 20.
    - Excluir `src/**/*.test.ts` y `dist` de la compilación.
    - Asegurar que la compilación produzca `dist/server.js` sin incluir archivos `*.test.ts`.
    - _Requisitos: 13.4, 13.6, 14.2, 14.5, 14.7_

  - [x] 1.3 Configurar ESLint para TypeScript
    - Crear la configuración flat de ESLint con reglas recomendadas para TypeScript.
    - Hacer que el script `lint` revise el código fuente TypeScript y excluya `dist` y los artefactos generados.
    - _Requisitos: 14.4_

  - [x] 1.4 Configurar Vitest y las utilidades de prueba
    - Configurar Vitest para ejecución única y preparar utilidades compartidas para dependencias aisladas, relojes controlados y restauración de mocks.
    - Registrar fast-check para PBT y supertest para solicitudes contra `createApp()` sin abrir un puerto.
    - _Requisitos: 13.4, 14.3, 14.6_

- [x] 2. Implementar el dominio y los contratos internos
  - [x] 2.1 Definir catálogos, entidades y contratos de infraestructura
    - Crear tipos para `Category`, `Priority`, `TicketStatus`, `ActorRole`, `Ticket`, `StateHistoryEntry`, `EscalationRecord`, `SupervisorNotification` y `ActorRecord`.
    - Definir `Clock`, `TicketStore`, `AgentDirectory`, `SupervisorNotifier` e `IdGenerator`.
    - Mantener las fechas como `Date` dentro del dominio y usar `null` para `responsibleId`, `resolutionNote`, `resolvedAt` y `closedAt` cuando no existan.
    - Tratar `responsibleId` como una cadena opaca, sin asumir un formato numérico o una estructura interna.
    - _Requisitos: 1.1, 1.3, 5.3, 6.3, 7.3, 7.5, 8.3, 8.4, 9.1, 9.2, 12.1_

  - [x] 2.2 Implementar las tablas de SLA, transiciones y reglas temporales
    - Implementar el catálogo `CRITICA=4` horas, `ALTA=8` horas, `MEDIA=24` horas y `BAJA=72` horas.
    - Implementar las siete transiciones normales: `NUEVO -> ASIGNADO`, `ASIGNADO -> EN_PROGRESO`, `EN_PROGRESO -> EN_ESPERA`, `EN_ESPERA -> EN_PROGRESO`, `EN_PROGRESO -> RESUELTO`, `EN_ESPERA -> RESUELTO` y `RESUELTO -> CERRADO`.
    - Implementar las dos reaperturas: `RESUELTO -> EN_PROGRESO` y `CERRADO -> EN_PROGRESO`.
    - Distinguir un no-op del resto de transiciones inválidas y aplicar el predicado estricto `now > dueAt`, excluyendo `RESUELTO` y `CERRADO`.
    - Implementar el cálculo de `dueAt`, la normalización de textos de resolución y los ciclos de vencimiento.
    - _Requisitos: 6.1, 6.2, 6.3, 6.5, 7.1, 7.4, 7.6, 8.1, 8.2, 8.3, 8.4, 8.5_

  - [x] 2.3 Crear errores de dominio y utilidades de tiempo e identificación
    - Definir errores tipados para solicitud inválida, actor requerido/desconocido, supervisor requerido, ticket inexistente, agente no disponible, transición inválida, ruta/método no soportado e error interno.
    - Crear `SystemClock` basado en `new Date()` y un generador de producción que delegue en `crypto.randomUUID()`.
    - Mantener `Clock` e `IdGenerator` inyectables para usar `FixedClock` y generadores deterministas en pruebas, sin esperar horas reales.
    - _Requisitos: 5.3, 6.3, 6.4, 6.5, 8.8, 8.9, 9.4, 10.1, 10.2, 10.3, 10.4_

  - [x] 2.4 Escribir la prueba de propiedad de creación e invariantes
    - Crear una prueba PBT en un archivo propio para la **Property 1: Creación conserva invariantes y campos obligatorios**.
    - Generar entradas válidas y verificar título, descripción, categoría, prioridad, solicitante, estado `NUEVO`, ID opaco, fechas válidas y `responsibleId: null`.
    - Ejecutar al menos 100 casos y añadir el comentario `Feature: ticketops-api, Property 1: Creación conserva invariantes y campos obligatorios`.
    - **Valida: Requisitos 1.1, 1.3, 2.1, 2.5**

  - [x] 2.5 Escribir la prueba de propiedad de normalización y longitud
    - Crear una prueba PBT en un archivo propio para la **Property 2: Textos y título se validan después de recortar**.
    - Verificar que textos obligatorios vacíos después de recortar se rechazan, que títulos de 1 a 120 caracteres normalizados cumplen la regla y que títulos de más de 120 caracteres se rechazan.
    - Ejecutar al menos 100 casos y añadir el comentario `Feature: ticketops-api, Property 2: Textos y título se validan después de recortar`.
    - **Valida: Requisitos 1.6, 2.2, 2.3, 3.1, 3.2, 3.3**

  - [x] 2.6 Escribir la prueba de propiedad de catálogos y tipos
    - Crear una prueba PBT en un archivo propio para la **Property 3: Catálogos y tipos inválidos se rechazan**.
    - Verificar que categorías o prioridades desconocidas o de tipo incorrecto generan una solicitud inválida y no crean tickets.
    - Ejecutar al menos 100 casos y añadir el comentario `Feature: ticketops-api, Property 3: Catálogos y tipos inválidos se rechazan`.
    - **Valida: Requisitos 1.7, 2.1, 2.4**

  - [x] 2.7 Escribir la prueba de propiedad de SLA y vencimiento
    - Crear una prueba PBT en un archivo propio para la **Property 4: SLA y fecha de vencimiento son deterministas**.
    - Verificar para cualquier instante y prioridad válida que `dueAt` sea exactamente `createdAt + sla(priority)` usando un `FixedClock`.
    - Ejecutar al menos 100 casos y añadir el comentario `Feature: ticketops-api, Property 4: SLA y fecha de vencimiento son deterministas`.
    - **Valida: Requisitos 1.2, 8.1**

  - [x] 2.8 Escribir la prueba de propiedad de la máquina de estados
    - Crear una prueba PBT en un archivo propio para la **Property 7: La máquina acepta exactamente las transiciones permitidas**.
    - Cubrir todos los pares de estados, los siete cambios normales, las dos reaperturas y los no-op; verificar que cualquier otro cambio produce conflicto sin mutar el ticket.
    - Ejecutar al menos 100 casos y añadir el comentario `Feature: ticketops-api, Property 7: La máquina acepta exactamente las transiciones permitidas`.
    - **Valida: Requisitos 6.1, 6.3, 7.4, 7.6**

  - [x] 2.9 Escribir pruebas unitarias de las reglas puras del dominio
    - Probar catálogos, tablas de transición, normalización, cálculo de fechas y comparación estricta en los límites `dueAt - 1`, `dueAt` y `dueAt + 1`.
    - Verificar que las reglas no dependan de Express, una base de datos, `Date.now()` global ni un listener HTTP.
    - _Requisitos: 6.1, 6.2, 6.3, 8.1, 8.2, 13.1, 13.3_

- [x] 3. Implementar la infraestructura sustituible en memoria
  - [x] 3.1 Implementar `InMemoryTicketStore`
    - Usar un `Map<string, Ticket>` y colecciones separadas para historial, escalaciones y notificaciones.
    - Implementar lectura, listado, guardado y copias defensivas de tickets y registros para impedir mutaciones por referencia desde HTTP.
    - Ordenar el historial por fecha ascendente y por secuencia cuando dos fechas coincidan.
    - Exponer métodos observables para `listEscalations` y `listSupervisorNotifications`.
    - _Requisitos: 8.3, 9.1, 9.2, 9.5, 12.1, 12.2_

  - [x] 3.2 Implementar directorio, reloj, identificador y notificador en memoria
    - Crear `InMemoryAgentDirectory` con agentes activos, un agente inactivo y un supervisor por defecto, permitiendo reemplazos en pruebas.
    - Crear `InMemorySupervisorNotifier` con una colección consultable de notificaciones emitidas.
    - Usar `SystemClock` y el generador basado en `crypto.randomUUID()` en la configuración de producción; permitir `FixedClock` y generadores deterministas en las pruebas.
    - Garantizar que cada instancia de dependencias comienza aislada y sin conexión externa.
    - _Requisitos: 5.3, 8.3, 8.9, 12.1, 12.2, 12.3, 13.2_

  - [x] 3.3 Escribir pruebas unitarias de aislamiento y observabilidad
    - Verificar copias defensivas del almacén, persistencia observable de escalaciones y notificaciones, y aislamiento entre dos instancias.
    - Verificar que el notificador recibe como máximo una notificación por ciclo y que los registros exponen el ticket, ciclo y fechas correspondientes.
    - _Requisitos: 8.3, 8.4, 12.1, 12.2, 12.3_

- [x] 4. Implementar los servicios de aplicación y las reglas de negocio
  - [x] 4.1 Implementar creación, consulta y filtrado de tickets
    - Crear `TicketService.create` para recortar los textos, generar el ID, fijar fechas con `Clock`, calcular `dueAt`, inicializar `NUEVO`, `responsibleId: null`, `overdue: false` y `overdueCycle: 1`.
    - Crear `list` y `get`, evaluando vencimientos antes de devolver resultados.
    - Combinar filtros válidos de `category`, `status` y `priority` con lógica AND.
    - Mantener `responsibleId` como cadena opaca y no permitir asignarlo durante la creación.
    - _Requisitos: 1.1, 1.2, 1.3, 2.1, 2.5, 4.1, 4.2, 4.4, 4.5, 4.6, 4.7_

  - [x] 4.2 Implementar asignación exclusivamente mediante `responsibleId`
    - Crear `assign` para validar actor identificable, ticket existente y agente activo.
    - Guardar el identificador opaco recibido en `responsibleId`; aplicar `NUEVO -> ASIGNADO` sólo cuando el estado anterior sea `NUEVO` y conservar el estado en los demás casos.
    - Actualizar `updatedAt` y crear historial únicamente si la asignación cambia el estado.
    - _Requisitos: 5.1, 5.2, 5.3, 5.4, 5.5, 9.1, 9.5_

  - [x] 4.3 Implementar cambios de estado, resolución, cierre y reapertura
    - Crear `changeStatus` con soporte para no-op, validación de actor, tabla de transiciones y actualización atómica.
    - Exigir y normalizar `resolutionNote` al entrar a `RESUELTO`, fijar `resolvedAt`, exigir origen `RESUELTO` al cerrar y fijar `closedAt`.
    - Permitir `RESUELTO -> EN_PROGRESO` y `CERRADO -> EN_PROGRESO` mediante `PATCH /tickets/:id/status`.
    - Al reabrir, conservar historial, escalamientos y notificaciones; limpiar `resolvedAt`, `closedAt` y `resolutionNote`; incrementar `overdueCycle` y reiniciar `overdue`.
    - Añadir una entrada de historial con actor, origen, destino, fecha y secuencia por cada cambio real.
    - _Requisitos: 6.1, 6.2, 6.3, 6.6, 6.7, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 8.3, 8.4, 9.1, 9.5_

  - [x] 4.4 Implementar evaluación de vencimiento, escalamiento y consulta overdue
    - Evaluar cada ticket usando `Clock`, `dueAt` y el estado actual antes de filtrar o devolver resultados.
    - Registrar exactamente una escalación y una notificación observable por ciclo al detectar por primera vez `now > dueAt`, con fechas consistentes.
    - Conservar el indicador de vencimiento y los eventos cuando el ticket llegue a `RESUELTO` o `CERRADO`.
    - Crear `listOverdue` con autorización de supervisor, filtro opcional por categoría y nuevos eventos después de reabrir y volver a superar el SLA.
    - _Requisitos: 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 12.1_

  - [x] 4.5 Escribir la prueba de propiedad de filtros AND
    - Crear una prueba PBT en un archivo propio para la **Property 5: Los filtros se aplican por intersección**.
    - Verificar que cada combinación válida de `category`, `status` y `priority` devuelve exactamente los tickets que cumplen simultáneamente todos los filtros.
    - Ejecutar al menos 100 casos y añadir el comentario `Feature: ticketops-api, Property 5: Los filtros se aplican por intersección`.
    - **Valida: Requisitos 4.4, 4.5, 4.6, 4.7**

  - [x] 4.6 Escribir la prueba de propiedad de asignación
    - Crear una prueba PBT en un archivo propio para la **Property 6: La asignación aplica sólo la transición automática definida**.
    - Verificar que cualquier agente activo se guarda como `responsibleId`, que `NUEVO` pasa a `ASIGNADO` y que los demás estados operativos se conservan.
    - Ejecutar al menos 100 casos y añadir el comentario `Feature: ticketops-api, Property 6: La asignación aplica sólo la transición automática definida`.
    - **Valida: Requisitos 5.1, 5.2**

  - [x] 4.7 Escribir la prueba de propiedad de no-op e historial
    - Crear una prueba PBT en un archivo propio para la **Property 8: Las operaciones sin cambio no añaden historial**.
    - Verificar que un no-op conserva estado, contenido e historial; una reasignación sin cambio de estado sólo puede modificar el responsable y `updatedAt`.
    - Ejecutar al menos 100 casos y añadir el comentario `Feature: ticketops-api, Property 8: Las operaciones sin cambio no añaden historial`.
    - **Valida: Requisitos 6.2, 9.5**

  - [x] 4.8 Escribir la prueba de propiedad de timestamps
    - Crear una prueba PBT en un archivo propio para la **Property 9: Las mutaciones reales actualizan el timestamp**.
    - Usar un `FixedClock` que avance y verificar que una asignación válida o transición real actualiza `updatedAt` al instante posterior.
    - Ejecutar al menos 100 casos y añadir el comentario `Feature: ticketops-api, Property 9: Las mutaciones reales actualizan el timestamp`.
    - **Valida: Requisitos 5.5, 6.6**

  - [x] 4.9 Escribir la prueba de propiedad de resolución
    - Crear una prueba PBT en un archivo propio para la **Property 10: Resolver exige y conserva una nota**.
    - Verificar que una nota vacía después de recortar se rechaza y que una nota válida se conserva normalizada junto con `resolvedAt`.
    - Ejecutar al menos 100 casos y añadir el comentario `Feature: ticketops-api, Property 10: Resolver exige y conserva una nota`.
    - **Valida: Requisitos 7.1, 7.2, 7.3**

  - [x] 4.10 Escribir la prueba de propiedad de cierre
    - Crear una prueba PBT en un archivo propio para la **Property 11: Cerrar respeta la precondición de resolución**.
    - Verificar que sólo un ticket `RESUELTO` puede pasar a `CERRADO`, que el cierre fija `closedAt` y que los rechazos no mutan el ticket.
    - Ejecutar al menos 100 casos y añadir el comentario `Feature: ticketops-api, Property 11: Cerrar respeta la precondición de resolución`.
    - **Valida: Requisitos 7.4, 7.5, 7.6**

  - [x] 4.11 Escribir la prueba de propiedad del predicado de vencimiento
    - Crear una prueba PBT en un archivo propio para la **Property 12: El predicado de vencimiento usa tiempo estricto y estado actual**.
    - Verificar `now > dueAt`, igualdad exacta con `dueAt` y exclusión de los estados `RESUELTO` y `CERRADO`.
    - Ejecutar al menos 100 casos y añadir el comentario `Feature: ticketops-api, Property 12: El predicado de vencimiento usa tiempo estricto y estado actual`.
    - **Valida: Requisitos 8.2, 8.5**

  - [x] 4.12 Escribir la prueba de propiedad de idempotencia por ciclo
    - Crear una prueba PBT en un archivo propio para la **Property 13: Cada ciclo de vencimiento es idempotente**.
    - Evaluar un ticket vencido una o muchas veces y verificar exactamente un escalamiento y una notificación por ciclo, con fechas relacionadas consistentes.
    - Ejecutar al menos 100 casos y añadir el comentario `Feature: ticketops-api, Property 13: Cada ciclo de vencimiento es idempotente`.
    - **Valida: Requisitos 8.3**

  - [x] 4.13 Escribir la prueba de propiedad de reapertura y nuevos ciclos
    - Crear una prueba PBT en un archivo propio para la **Property 14: La reapertura conserva eventos y comienza un ciclo nuevo**.
    - Verificar las reaperturas desde `RESUELTO` y `CERRADO`, la conservación de historial y eventos anteriores, la limpieza de datos de resolución, el incremento de `overdueCycle`, el reinicio de `overdue` y los nuevos eventos cuando corresponda.
    - Ejecutar al menos 100 casos y añadir el comentario `Feature: ticketops-api, Property 14: La reapertura conserva eventos y comienza un ciclo nuevo`.
    - **Valida: Requisitos 6.1, 7.3, 8.3, 8.4**

  - [x] 4.14 Escribir la prueba de propiedad del historial atribuible y ordenado
    - Crear una prueba PBT en un archivo propio para la **Property 15: Cada cambio real genera historial ordenado y atribuible**.
    - Generar secuencias de transiciones válidas y actores identificables; verificar una entrada por cambio real, actor correcto, fechas y orden por fecha y secuencia.
    - Ejecutar al menos 100 casos y añadir el comentario `Feature: ticketops-api, Property 15: Cada cambio real genera historial ordenado y atribuible`.
    - **Valida: Requisitos 9.1, 9.2**

  - [x] 4.15 Escribir pruebas unitarias de los servicios de aplicación
    - Probar creación, consulta, asignación, transiciones, resolución, cierre, reapertura, filtros AND y overdue con relojes y generadores inyectados.
    - Probar que errores de actor, agente, transición y supervisor no mutan el almacén.
    - _Requisitos: 4.1, 4.2, 4.3, 4.7, 5.3, 5.5, 6.3, 7.2, 7.6, 8.6, 8.9, 9.4_

- [x] 5. Implementar validación HTTP, mapeadores, rutas y manejo de errores
  - [x] 5.1 Crear esquemas zod y mapeadores HTTP
    - Crear un esquema estricto para `POST /tickets` que exija presencia y tipos correctos de `title`, `description`, `category`, `priority` y `requester`.
    - Recortar `title`, `description` y `requester`; rechazar textos vacíos después de recortar y títulos de más de 120 caracteres después de recortar.
    - Rechazar en `POST /tickets` las propiedades `responsibleId`, `responsible` y `responsable`; usar `responsibleId` sólo en el cuerpo de assignment.
    - Crear esquemas para filtros, assignment, status, actor y categoría overdue, incluyendo enums y tipos correctos.
    - Mapear fechas `Date` a ISO UTC, `null` para valores ausentes y arreglos observables de escalaciones y notificaciones.
    - _Requisitos: 1.5, 1.6, 1.7, 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 4.8, 5.4, 6.5, 8.8, 10.1, 10.4_

  - [x] 5.2 Crear middleware de actor, autorización y errores estándar
    - Leer `X-Actor-Id`, recortar su valor y distinguir actor ausente o inválido, actor desconocido y supervisor insuficiente.
    - Crear el formateador `{ error: { code, message, details? } }` sin stack trace ni información interna.
    - Normalizar JSON inválido, errores de zod, errores de dominio y errores inesperados al contrato HTTP establecido.
    - _Requisitos: 8.9, 9.4, 10.1, 10.4, 10.5_

  - [x] 5.3 Implementar routers de tickets y respuestas de éxito
    - Registrar `GET /`, `GET /health`, `POST /tickets`, `GET /tickets`, `GET /tickets/:id`, `PATCH /tickets/:id/assignment`, `PATCH /tickets/:id/status`, `GET /tickets/:id/history` y `GET /tickets/overdue`.
    - Registrar `/tickets/overdue` antes de `/tickets/:id` y conectar cada handler con `TicketService` sin introducir reglas de negocio en Express.
    - Usar `{ responsibleId }` exclusivamente en assignment y devolver `201` al crear y `200` en consultas y mutaciones correctas.
    - _Requisitos: 1.4, 4.1, 4.2, 5.5, 6.7, 8.6, 9.2, 10.5, 11.1, 11.2_

  - [x] 5.4 Implementar `src/app.ts`, catálogo de rutas y método no permitido
    - Exportar `createApp(dependencies?)` y una instancia `app` por defecto con dependencias en memoria.
    - Configurar `express.json()` y el orden de middleware descrito, sin llamar `listen`, sin leer `PORT` y sin crear timers globales.
    - Detectar rutas conocidas con método incorrecto, devolver `405` y cabecera `Allow`; devolver `404` estándar para rutas desconocidas.
    - _Requisitos: 10.2, 10.3, 11.1, 13.1, 13.3_

  - [x] 5.5 Implementar `src/server.ts` y el arranque por `PORT`
    - Importar `app` desde `src/app.ts` y hacer que únicamente `src/server.ts` invoque `listen`.
    - Usar el puerto `3000` cuando `PORT` no esté definido y el puerto válido indicado cuando exista.
    - Validar valores inválidos de `PORT` con un fallo rápido y un mensaje claro.
    - _Requisitos: 11.3, 11.4, 13.2_

  - [x] 5.6 Escribir pruebas unitarias de validación y mapeo HTTP
    - Probar presencia, tipos, textos recortados, límites de 120 y 121 caracteres, y rechazo de `responsibleId`, `responsible` y `responsable` en creación.
    - Probar validadores de filtros, assignment, status, actor y categoría overdue.
    - Probar serialización ISO UTC, formato estándar de error, catálogo de rutas y cabecera `Allow`.
    - _Requisitos: 1.5, 1.6, 1.7, 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 4.8, 8.8, 10.1, 10.2, 10.4_

- [x] 6. Añadir pruebas de integración de la API y del proceso
  - [x] 6.1 Probar creación y validación HTTP de tickets
    - Usar `supertest(createApp(...))` para probar `POST /tickets` exitoso con `201`, fechas ISO UTC, `responsibleId: null` y todos los campos obligatorios.
    - Cubrir ausencia, tipo inválido, texto vacío después de recortar, título de 120 caracteres, título de 121 caracteres y HTTP `400` con error estándar.
    - Verificar HTTP `400` para `responsibleId`, `responsible` y `responsable` en el cuerpo de creación.
    - _Requisitos: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 10.1_

  - [x] 6.2 Probar consultas, filtros AND y recursos inexistentes
    - Probar `GET /tickets`, `GET /tickets/:id`, respuestas `200`, recurso inexistente `404` y respuestas JSON coherentes.
    - Verificar filtros individuales y combinados `category`, `status` y `priority` con lógica AND, incluyendo resultados vacíos y valores inválidos.
    - _Requisitos: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 10.1, 10.5_

  - [x] 6.3 Probar asignación y responsables opacos HTTP
    - Probar asignación mediante `{ responsibleId }`, actores válidos, desconocidos y ausentes, agentes activos, inactivos y desconocidos.
    - Verificar la transición automática desde `NUEVO`, la conservación del estado en reasignaciones y el rechazo de identificadores ausentes o inválidos.
    - _Requisitos: 5.1, 5.2, 5.3, 5.4, 5.5, 9.4_

  - [x] 6.4 Probar estados, resolución, cierre y reapertura HTTP
    - Probar las siete transiciones normales, las dos reaperturas mediante `PATCH /tickets/:id/status`, no-op y conflictos.
    - Verificar nota de resolución, `resolvedAt`, `closedAt`, limpieza de los tres campos al reabrir, incremento de `overdueCycle` y conservación de historial y eventos SLA.
    - Comprobar que el historial sólo crece cuando hay un cambio real y conserva el actor.
    - _Requisitos: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 8.3, 8.4, 9.1, 9.5_

  - [x] 6.5 Probar SLA, overdue, ciclos y observabilidad
    - Usar `FixedClock` o fake timers para comprobar el instante anterior, igual y posterior a `dueAt` sin esperar horas reales.
    - Probar `GET /tickets/overdue` con supervisor, filtro de categoría, categoría inválida y actor no supervisor.
    - Repetir consultas overdue dentro del mismo ciclo y verificar exactamente una escalación y una notificación observable, con fechas consistentes y sin duplicados.
    - Resolver/cerrar, reabrir, volver a superar el SLA y verificar nuevos eventos con ciclo distinto, conservando todos los registros anteriores.
    - _Requisitos: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 12.1_

  - [x] 6.6 Probar historial, errores HTTP y rutas
    - Probar historial ascendente, historial inexistente, actor requerido, JSON mal formado, `405` con `Allow`, `404` de ruta y formato de error estándar.
    - Verificar que las respuestas exitosas y de error siempre son JSON y no contienen detalles internos.
    - _Requisitos: 9.2, 9.3, 9.4, 10.1, 10.2, 10.3, 10.4, 10.5_

  - [x] 6.7 Probar raíz, salud, aislamiento y separación de arranque
    - Verificar que `GET /` devuelve nombre, estado y todas las rutas requeridas.
    - Verificar que `GET /health` devuelve exactamente `{ "status": "ok" }`.
    - Importar `src/app.ts` sin abrir listener, comprobar que `src/server.ts` es el único módulo que llama `listen` y confirmar que una nueva instancia empieza vacía sin base de datos.
    - _Requisitos: 11.1, 11.2, 13.1, 13.2, 13.3, 12.1, 12.2, 12.3_

  - [x] 6.8 Probar configuración, compilación y scripts
    - Automatizar comprobaciones del manifest para Node.js 20+, pnpm, Express, zod, Vitest, fast-check, supertest, ESLint y TypeScript 5.9.x, rechazando TypeScript 7 y flujos npm/yarn.
    - Verificar que `pnpm build` produce `dist/server.js`, excluye `*.test.ts`, que `pnpm test` usa Vitest en single-run y que `pnpm lint` ejecuta ESLint sobre TypeScript.
    - _Requisitos: 13.4, 13.5, 13.6, 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7_

- [x] 7. Checkpoint de integración inicial
  - Ejecutar la suite completa de pruebas, la compilación y el lint; corregir errores de integración antes de cerrar el plan.
  - Confirmar que las 15 propiedades, los servicios, las rutas, el arranque y las dependencias en memoria están conectados y que no existen módulos huérfanos.

- [x] 8. Cerrar la integración y la trazabilidad de la implementación
  - [x] 8.1 Conectar el grafo final de dependencias de la aplicación
    - Verificar que `createApp` recibe dependencias inyectables, que la instancia por defecto usa `InMemoryTicketStore`, `InMemoryAgentDirectory`, `SystemClock`, el generador UUID y el notificador en memoria.
    - Verificar que cada ruta usa el servicio correspondiente, que `src/app.ts` no inicia listeners y que `src/server.ts` es el único arranque.
    - Verificar que el build conserva `dist/server.js` como punto de entrada y que las instancias nuevas no comparten datos.
    - _Requisitos: 12.1, 12.2, 12.3, 13.1, 13.2, 13.3, 14.2, 14.7_

  - [x] 8.2 Ejecutar la validación final automatizada
    - Ejecutar `pnpm lint`, `pnpm test` y `pnpm build` en ese orden y dejar la suite verde con las 15 propiedades, las pruebas unitarias y las pruebas de integración.
    - Comprobar que la cobertura incluye validación de creación, título, `responsibleId`, filtros AND, reaperturas, ciclos de vencimiento, escalamiento/notificación observable, contratos HTTP, salud, configuración y aislamiento en memoria.
    - _Requisitos: 1.6, 3.3, 4.7, 8.3, 10.1, 10.4, 12.3, 14.2, 14.3, 14.4, 14.7_

## Notes

- Las tareas marcadas con `*` son opcionales según la convención de la especificación; las tareas de implementación sin `*` son el camino mínimo requerido para completar la API.
- Cada una de las 15 propiedades de corrección del diseño aparece en una tarea PBT independiente: Properties 1–4 en 2.4–2.7, Property 7 en 2.8, y Properties 5–6 y 8–15 en 4.5–4.14.
- Cada prueba PBT debe usar fast-check, ejecutar al menos 100 casos y conservar el comentario de trazabilidad `Feature: ticketops-api, Property N: ...`.
- Las pruebas de límite deben cubrir explícitamente títulos recortados de 120 y 121 caracteres, además de textos obligatorios vacíos tras recortar.
- Los IDs de tickets se generan con `crypto.randomUUID()` en producción; las pruebas deben inyectar generadores deterministas. El `Clock` de producción usa `new Date()` y las pruebas usan `FixedClock` o fake timers.
- Las tareas de integración comprueban que `responsibleId` es el nombre canónico y opaco, que la creación rechaza `responsibleId`, `responsible` y `responsable`, y que la asignación sólo usa `PATCH /tickets/:id/assignment`.
- Los checkpoints sólo verifican código, pruebas, compilación y conexión de módulos; no incluyen despliegue, documentación de usuario ni aceptación manual.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["1.4"] },
    { "id": 3, "tasks": ["2.1", "2.2", "2.3"] },
    { "id": 4, "tasks": ["2.4", "2.5", "2.6", "2.7", "2.8", "2.9"] },
    { "id": 5, "tasks": ["3.1", "3.2"] },
    { "id": 6, "tasks": ["3.3"] },
    { "id": 7, "tasks": ["4.1"] },
    { "id": 8, "tasks": ["4.2"] },
    { "id": 9, "tasks": ["4.3"] },
    { "id": 10, "tasks": ["4.4"] },
    { "id": 11, "tasks": ["4.5", "4.6", "4.7", "4.8", "4.9", "4.10", "4.11", "4.12", "4.13", "4.14", "4.15"] },
    { "id": 12, "tasks": ["5.1", "5.2"] },
    { "id": 13, "tasks": ["5.3"] },
    { "id": 14, "tasks": ["5.4", "5.5"] },
    { "id": 15, "tasks": ["5.6"] },
    { "id": 16, "tasks": ["6.1", "6.2", "6.3", "6.4", "6.5", "6.6", "6.7", "6.8"] },
    { "id": 17, "tasks": ["7"] },
    { "id": 18, "tasks": ["8.1"] },
    { "id": 19, "tasks": ["8.2"] }
  ]
}
```
