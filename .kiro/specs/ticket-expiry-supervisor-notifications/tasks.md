# Implementation Plan: notificaciones de vencimiento al supervisor

## Overview

Implementar y verificar la evaluación observable de vencimiento usando las funciones, interfaces y dependencias existentes de TicketOps. El trabajo se limita a `src/domain`, `src/application`, `src/infrastructure` y `src/http`, preservando los archivos que ya cumplen el diseño y ajustando sólo desviaciones comprobadas. No se añadirán workers, colas, bases de datos ni dependencias de producción.

Cada tarea está formulada como un paso incremental para un agente de generación de código: implementa o verifica una pieza concreta, cubre requisitos trazables y deja el sistema integrado con los pasos anteriores. Las pruebas property-based usarán `fast-check` y Vitest con al menos `numRuns: 100`, además de pruebas unitarias e integración concretas.

## Tasks

- [x] 1. Verificar y completar la regla temporal de dominio
  - [x] 1.1 Revisar `src/domain/temporal.ts` y conservar o ajustar únicamente lo necesario para que `isOverdueAt` use la comparación estricta `now > dueAt`, excluya `RESUELTO` y `CERRADO`, y `evaluateOverdueCycle` devuelva copias sin mutar la entrada.
    - Mantener `dueAt` como la fecha calculada por `calculateDueAt`; no introducir un plazo paralelo.
    - Mantener `startOverdueCycle` para incrementar `overdueCycle`, reiniciar `overdue` y conservar los eventos históricos.
    - _Requisitos: 1.1, 1.2, 1.3, 1.4, 1.5, 3.4, 5.4, 6.1, 6.4_

  - [x] 1.2 Añadir o completar pruebas unitarias de `src/domain/temporal.test.ts` para los casos anterior, igual y posterior a `dueAt`, estados terminales, preservación de eventos y copias profundas.
    - Verificar que la igualdad exacta no genera registros y que la evaluación terminal no genera eventos nuevos.
    - _Requisitos: 1.1, 1.2, 1.3, 1.4, 5.3, 5.4_

  - [x] 1.3 Escribir la prueba property-based de la **Property 1: Vencimiento estricto y exclusión de estados terminales** en un archivo de propiedad dedicado, con generadores de Tickets válidos, estados e instantes antes, iguales y después de `dueAt`.
    - Usar `fc.property` con al menos `{ numRuns: 100 }` y el comentario `Feature: ticket-expiry-supervisor-notifications, Property 1: ...`.
    - **Valida: Requisitos 1.1, 1.2, 1.3, 1.4, 5.4.**

  - [x] 1.4 Escribir la prueba property-based de la **Property 2: El primer vencimiento crea un par coherente** sobre `evaluateOverdueCycle`.
    - Comprobar `overdue: true`, un escalamiento y una notificación del mismo `ticketId` y `cycle`, con el mismo `notifiedAt`.
    - **Valida: Requisitos 2.1, 2.2, 2.4, 8.1, 8.2, 8.3.**

  - [x] 1.5 Punto de control: ejecutar las pruebas unitarias y property-based del dominio y corregir cualquier fallo antes de continuar.
    - Asegurar que las pruebas pasan sin cambiar requisitos ni diseño.

- [x] 2. Coordinar `TicketService` con Clock, Store y Notifier
  - [x] 2.1 Revisar `src/application/ticket-service.ts` y conservar o ajustar `evaluateAndSave` para que obtenga el instante desde `Clock`, evalúe la copia del Ticket, consulte registros por `(ticketId, cycle)`, persista antes de notificar y devuelva una copia final del Store.
    - Verificar que `get`, `list`, `listOverdue`, `assign` y `changeStatus` evalúan antes de devolver la representación, y que `listOverdue` evalúa todos los Tickets antes de filtrar.
    - Mantener la emisión única cuando el Store no contiene el ciclo y evitar persistencia o emisión duplicada cuando ya existe cualquiera de los registros del ciclo.
    - _Requisitos: 2.3, 3.1, 3.2, 3.3, 7.1, 7.2, 7.3, 7.4, 7.5_

  - [x] 2.2 Añadir o completar pruebas unitarias de `TicketService` para creación con `dueAt` proveniente del SLA, evaluación en operaciones de lectura y mutación, persistencia previa a `notify` y retorno del estado final almacenado.
    - Usar `FixedClock`, Store en memoria, Notifier inspeccionable e `IdGenerator` determinista.
    - _Requisitos: 1.5, 2.1, 2.2, 2.3, 2.4, 7.1, 7.2, 7.4, 7.5_

  - [x] 2.3 Escribir la prueba property-based de la **Property 3: La evaluación es idempotente por `(ticketId, cycle)`** sobre secuencias de evaluaciones del mismo Ticket vencido.
    - Comprobar como máximo un escalamiento, una notificación persistida y una emisión al Notifier, incluyendo el caso de registros preexistentes.
    - **Valida: Requisitos 3.1, 3.2, 3.3, 6.5.**

  - [x] 2.4 Escribir la prueba property-based de la **Property 7: El instante inyectado gobierna el cálculo y los registros** usando un `Clock` controlado y distintos instantes válidos.
    - Comprobar que `overdue`, `escalatedAt` y `notifiedAt` usan el instante inyectado y que no se consulta el reloj del sistema.
    - **Valida: Requisito 7.4.**

- [x] 3. Verificar persistencia defensiva en memoria
  - [x] 3.1 Revisar `src/infrastructure/in-memory-ticket-store.ts` y conservar o completar las copias defensivas de Tickets, fechas, colecciones, historial, escalamientos y notificaciones en `save`, `get`, `list` y consultas de eventos.
    - Mantener el particionamiento por `ticketId` y no agregar métodos ni dependencias de persistencia externa.
    - _Requisitos: 4.1, 4.2, 4.4, 4.5, 8.5_

  - [x] 3.2 Revisar `src/infrastructure/in-memory-supervisor-notifier.ts` y conservar o completar la copia aislada de cada registro recibido y de cada lectura inspeccionable.
    - No mover al Notifier la decisión de idempotencia, que permanece en `TicketService` y `TicketStore`.
    - _Requisitos: 2.3, 4.3, 8.1_

  - [x] 3.3 Añadir o completar pruebas unitarias de `InMemoryTicketStore` y `InMemorySupervisorNotifier` para mutaciones de entradas y salidas, fechas anidadas, separación entre Tickets y conservación de registros.
    - Verificar que modificar una copia leída no altera el almacenamiento ni una segunda lectura.
    - _Requisitos: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [x] 3.4 Escribir la prueba property-based de la **Property 4: La evaluación no muta la entrada** para Tickets con fechas y registros anidados.
    - Comprobar aislamiento entre entrada, resultado y datos almacenados.
    - **Valida: Requisito 3.4.**

  - [x] 3.5 Escribir la prueba property-based de la **Property 5: El Store aísla y particiona por Ticket** usando múltiples `ticketId`, ciclos y lecturas mutadas.
    - Comprobar que los eventos no se cruzan entre Tickets y que las copias permanecen aisladas.
    - **Valida: Requisitos 4.1, 4.2, 4.4.**

- [x] 4. Implementar y probar ciclos, estados terminales y reapertura
  - [x] 4.1 Revisar `changeStatus` y `startOverdueCycle` para que la resolución y el cierre conserven `overdue` e historial, mientras que `RESUELTO -> EN_PROGRESO` y `CERRADO -> EN_PROGRESO` incrementen el ciclo, reinicien `overdue` y conserven eventos de ciclos anteriores.
    - Aplicar el nuevo ciclo sólo después de validar la transición y mantener `dueAt` sin recalcular.
    - _Requisitos: 5.1, 5.2, 5.3, 5.4, 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x] 4.2 Añadir o completar pruebas unitarias e integración de `TicketService` para terminalización antes y después del vencimiento, reapertura desde ambos estados terminales, nuevo vencimiento y conservación histórica.
    - Comprobar que el ciclo nuevo registra exactamente sus propios eventos y que el ciclo anterior no se sobrescribe.
    - _Requisitos: 5.1, 5.2, 5.3, 5.4, 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x] 4.3 Escribir la prueba property-based de la **Property 6: La reapertura conserva la historia e inicia un ciclo** para Tickets terminales con eventos históricos.
    - Comprobar `overdueCycle + 1`, `overdue: false`, conservación exacta de los eventos anteriores y disponibilidad del nuevo ciclo para evaluación independiente.
    - **Valida: Requisitos 6.1, 6.3, 6.4.**

- [x] 5. Mantener la serialización HTTP y probar el contrato externo
  - [x] 5.1 Revisar `src/http/mappers.ts` y conservar o ajustar únicamente lo necesario para exponer `overdue`, `overdueCycle`, colecciones vacías, identificadores, ciclos y todos los instantes mediante ISO UTC sin recalcular ni mutar los datos.
    - Mantener separados los mapeos de escalamiento, notificación, historial y Ticket.
    - _Requisitos: 2.5, 7.5, 8.1, 8.2, 8.3, 8.4, 8.5_

  - [x] 5.2 Añadir o completar pruebas unitarias de los mappers para fechas con milisegundos, colecciones vacías, múltiples eventos, ciclos e identificadores sin alteración.
    - Verificar que un Date inválido no se oculta ni se sustituye silenciosamente.
    - _Requisitos: 2.5, 8.4, 8.5_

  - [x] 5.3 Escribir la prueba property-based de la **Property 8: La serialización conserva identidad, ciclos y tiempo** para Tickets con cero o más eventos válidos.
    - Comprobar equivalencia temporal con `toISOString()` y preservación de los campos del dominio.
    - **Valida: Requisitos 2.5, 8.4, 8.5.**

  - [x] 5.4 Añadir o completar pruebas de integración HTTP para consultar Tickets antes, en y después de `dueAt`, comprobar fechas ISO UTC, campos de vencimiento, registros completos y colecciones vacías.
    - Verificar que HTTP sólo serializa el resultado de `TicketService` y no crea eventos ni recalcula vencimientos por su cuenta.
    - _Requisitos: 1.2, 1.3, 2.5, 7.1, 7.5, 8.4, 8.5_

- [x] 6. Completar manejo de errores y ausencia de efectos parciales
  - [x] 6.1 Revisar las fronteras de `TicketService`, `Clock`, Store y Notifier para propagar `TicketNotFoundError`, errores de transición, validación de actor, autorización de Supervisor y Clock inválido sin sustituir valores ni persistir efectos antes de la validación.
    - Si falta la validación de un `Date` inválido, añadirla en la frontera existente sin introducir una nueva dependencia.
    - Mantener la persistencia de una notificación antes de `SupervisorNotifier.notify`; si `notify` falla, conservar el registro persistido para impedir una segunda emisión automática.
    - _Requisitos: 3.3, 7.1, 7.2, 7.3, 7.4_

  - [x] 6.2 Añadir o completar pruebas unitarias para Ticket inexistente, Clock inválido, actor o Supervisor inválido, agente inactivo, transición inválida, nota de resolución ausente y fallos del Store o Notifier.
    - Comprobar que las validaciones fallidas no cambian el Ticket, el historial ni los eventos.
    - _Requisitos: 3.3, 5.3, 5.4, 7.1, 7.3_

  - [x] 6.3 Añadir o completar pruebas de integración para autorización de `listOverdue`, errores HTTP, persistencia antes de notificar y ausencia de duplicados después de un fallo del Notifier.
    - Verificar los códigos y contratos de error existentes sin modificar el formato general de la API.
    - _Requisitos: 2.3, 3.3, 7.2, 7.3_

  - [x] 6.4 Punto de control: ejecutar las pruebas de dominio, aplicación, infraestructura y HTTP; resolver regresiones antes de la verificación final.
    - Confirmar que las pruebas no requieren red, base de datos, filesystem, worker ni cola.

- [x] 7. Verificación final del código integrado
  - [x] 7.1 Ejecutar la suite completa con `pnpm test`, la compilación con `pnpm build` y el lint con `pnpm lint`, y corregir únicamente fallos relacionados con esta feature.
    - Confirmar cobertura de requisitos 1–8, las ocho propiedades de corrección, los ciclos de reapertura, la serialización HTTP y los errores definidos en el diseño.
    - No modificar `requirements.md`, `design.md` ni introducir dependencias de producción.

## Notes

- Las tareas marcadas con `*` serían opcionales sólo para infraestructura de pruebas no bloqueante; este plan no marca como opcionales las pruebas que validan el MVP.
- La implementación existente debe conservarse cuando ya cumple el diseño; las tareas de revisión indican explícitamente el comportamiento que debe comprobarse y el ajuste mínimo permitido.
- Cada propiedad de corrección tiene una tarea independiente y debe usar `fast-check`, Vitest y al menos 100 ejecuciones.
- Las tareas de prueba son complementarias: las propiedades cubren invariantes universales y las pruebas unitarias o de integración cubren orden de efectos, autorización, errores y contratos HTTP.
- Las tareas no incluyen despliegue, documentación de usuario, métricas, procesos operativos ni cambios fuera del código y sus pruebas.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "3.1", "3.2", "5.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "2.1", "3.3", "5.2"] },
    { "id": 2, "tasks": ["1.4", "3.4", "3.5", "5.3", "6.1"] },
    { "id": 3, "tasks": ["1.5"] },
    { "id": 4, "tasks": ["2.2", "2.3", "2.4", "6.2"] },
    { "id": 5, "tasks": ["4.1"] },
    { "id": 6, "tasks": ["4.2", "4.3", "5.4", "6.3"] },
    { "id": 7, "tasks": ["6.4"] },
    { "id": 8, "tasks": ["7.1"] }
  ]
}
```
