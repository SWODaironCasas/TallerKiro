# Implementation Plan: Ticket Reassignment Feature

## Overview
Implementación del endpoint de reasignación de tickets en el sistema TallerKiro con autenticación como condición previa incondicional.

## Tasks

- [x] 1. Definir tipos y errores de dominio para reasignación
  - En `src/domain/errors.ts`, agregar nuevas clases de error:
    - `TicketClosedError` para tickets cerrados
    - `SameAgentReassignmentError` para reasignación al mismo agente
    - `AgentNotResponsibleError` para agentes que intentan reasignar tickets no asignados a ellos
  - Exportar nuevas clases en `src/domain/index.ts`
  - **Nota:** Los errores de autenticación (`AuthenticationError`) ya existen en el middleware `requireActor`
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [x] 1.1 Crear tests unitarios para cada nuevo error
    - Tests en `src/domain/errors.test.ts`
    - Verificar códigos descriptivos (TICKET_CLOSED, SAME_AGENT_REASSIGNMENT, AGENT_NOT_RESPONSIBLE)
    - Verificar mensajes de error claros e informativos

  - [x] 1.2 Verificar que errores siguen estructura existente
    - Revisar que errores nuevos extienden clases base correctas
    - Verificar consistencia con otros errores del dominio

- [x] 2. Implementar método reassign en TicketService
  - En `src/application/ticket-service.ts`, agregar método `reassign(id: string, responsibleId: string, actorId: string): Ticket`
  - Implementar validaciones:
    - Ticket existe y no está cerrado
    - Actor existe y tiene permisos (agente vs supervisor)
    - Nuevo agente existe y está activo
    - No es reasignación al mismo agente
  - Para agentes: validar que son responsables actuales del ticket
  - Para supervisores: permitir cualquier reasignación
  - Actualizar `responsibleId` y `updatedAt` manteniendo otros campos
  - Registrar entrada en historial específica para reasignación
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 2.1 Implementar validaciones de permisos
    - Agente solo puede reasignar tickets donde es responsable actual
    - Supervisor puede reasignar cualquier ticket
    - Validar existencia de agentes usando AgentDirectory

  - [x] 2.2 Implementar lógica de actualización
    - Actualizar `responsibleId` y `updatedAt`
    - Mantener todos los demás campos sin cambios (estado, prioridad, SLA, etc.)
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 2.3 Implementar registro de historial
    - Entrada específica para reasignación con datos completos
    - Registrar quién, cuándo, de/a quién y rol del actor
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x] 2.4 Escribir tests unitarios para reassign
    - Tests para casos exitosos (agente y supervisor)
    - Tests para casos de error (ticket cerrado, permisos, mismo agente)
    - Tests para conservación de campos no-responsable

- [x] 3. Extender esquemas de validación Zod
  - En `src/http/schemas.ts`, agregar:
    - `reassignmentSchema` para validar body del endpoint
    - `ReassignmentBody` type para TypeScript
  - Usar patrón consistente con schemas existentes (`assignmentSchema`, `statusSchema`)
  - Validar que `responsibleId` es string no vacío
  - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [x] 3.1 Crear schema de validación Zod
    - Validar estructura requerida `{ responsibleId: string }`
    - Schema debe ser strict (rechazar keys adicionales)
    - Compatible con middleware de validación existente

  - [x] 3.2 Escribir tests para schema
    - Verificar validación de input válido
    - Verificar rechazo de input inválido
    - Verificar tipos TypeScript generados correctamente

- [x] 4. Agregar endpoint HTTP de reasignación
  - En `src/http/ticket-routes.ts`, agregar ruta `PATCH /tickets/:id/reassignment`
  - **CONDICIÓN PREVIA:** Usar middleware `requireActor` existente como primera validación incondicional
  - Validar params con `idParamSchema`
  - Validar body con `reassignmentSchema`
  - Llamar a `service.reassign()`
  - Retornar ticket mapeado con `mapTicketToResponse`
  - Actualizar `ROUTE_CATALOG` para incluir nueva ruta
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [x] 4.1 Configurar middleware y orden de validaciones
    - **Orden crítico:** 1) `requireActor` (autenticación), 2) Validación Zod, 3) Lógica de negocio
    - **Condición previa:** Autenticación válida requerida antes de cualquier otra validación
    - Verificar que middleware rechaza requests sin autenticación con 401

  - [x] 4.2 Implementar handler de endpoint
    - Parsear y validar params y body
    - Llamar a `ticketService.reassign()`
    - Mapear respuesta con `mapTicketToResponse`
    - Manejar errores con middleware de error existente

  - [x] 4.3 Escribir documentación y metadatos
    - Agregar JSDoc al handler enfatizando condición previa de autenticación
    - Actualizar `ROUTE_CATALOG` para descubribilidad
    - Documentar status codes (401, 422, 403, etc.)

- [x] 5. Crear tests de propiedad para reasignación
  - Crear `src/application/ticket-reassignment.property.test.ts`
  - Implementar tests para propiedades 1-10 del documento de diseño
  - Usar fast-check para generación de datos aleatorios
  - Configurar arbitrarios para tickets, agentes, supervisores
  - _Requirements: Validación de todas las propiedades de correctitud del diseño_

  - [x] 5.1 Implementar tests para propiedades de permisos
    - **Propiedad 1:** Agente solo puede reasignar tickets donde es responsable actual
    - **Propiedad 2:** Supervisor puede reasignar cualquier ticket
    - _Validates: Requirements 1.1, 1.2_

  - [x] 5.2 Implementar tests para propiedades de idempotencia
    - **Propiedad 3:** Reasignación al mismo agente debe fallar
    - **Propiedad 4:** Reasignaciones idénticas secuenciales deben fallar
    - _Validates: Requirements 1.1, 1.2_

  - [x] 5.3 Implementar tests para propiedades de integridad
    - **Propiedad 5:** Tickets cerrados no pueden ser reasignados
    - **Propiedad 6-7:** Campos no-responsable no cambian durante reasignación
    - **Propiedad 8-9:** Historial correcto de reasignaciones
    - **Propiedad 10:** Validación de agente inexistente
    - _Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5_

- [x] 6. Crear tests de integración HTTP
  - Crear `src/http/ticket-reassignment.integration.test.ts`
  - Implementar tests con énfasis en condición previa de autenticación
  - Usar supertest para requests HTTP reales
  - Verificar status codes y formatos de respuesta
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [x] 6.1 Implementar tests para condición previa de autenticación
    - **Tests críticos:** Request sin header X-Actor-Id debe retornar 401
    - **Tests críticos:** Request con X-Actor-Id inválido debe retornar 401
    - Verificar que autenticación fallida (401) ocurre **antes** que validaciones Zod (422)
    - _Validates: Requirement 4.5 (condición previa incondicional)_

  - [x] 6.2 Implementar tests para casos exitosos
    - Agente reasigna su ticket (debe retornar 200)
    - Supervisor reasigna cualquier ticket (debe retornar 200)
    - Verificar formato de respuesta correcto
    - Verificar que campos no-responsable permanecen inalterados

  - [x] 6.3 Implementar tests para casos de error
    - Ticket cerrado (debe retornar 409)
    - Agente intenta reasignar ticket no asignado a él (debe retornar 403)
    - Agente inexistente (debe retornar 404)
    - Mismo agente (debe retornar 409)
    - Validación Zod fallida (debe retornar 422)

- [x] 7. Checkpoint - Validación de implementación básica
  - Ejecutar tests existentes para verificar que nada se rompió
  - Verificar que middleware de autenticación funciona como condición previa
  - Verificar que todas las validaciones siguen orden correcto
  - Asegurar que tests de integración HTTP pasan

- [x] 8. Crear tests de browser (UI)
  - Crear `tests/browser/ticket-reassignment.spec.ts`
  - Implementar tests Playwright para flujo de reasignación en interfaz
  - Configurar fixtures para datos de prueba
  - Verificar que UI se actualiza correctamente después de reasignación
  - _Requirements: Experiencia de usuario completa_

  - [x] 8.1 Implementar tests para flujo de agente
    - Agente reasigna ticket desde panel de UI
    - Verificar mensajes de confirmación y feedback visual
    - Verificar que UI refleja nuevo responsable

  - [x] 8.2 Implementar tests para flujo de supervisor
    - Supervisor reasigna cualquier ticket desde panel de UI
    - Verificar permisos especiales en interfaz
    - Verificar que historial muestra correctamente reasignación por supervisor

- [x] 9. Pruebas de regresión y validación final
  - Ejecutar suite completa de tests existentes
  - Verificar que todos los tests pasan
  - Ejecutar linter y TypeScript compiler
  - Verificar que build funciona correctamente
  - _Requirements: Compatibilidad con versiones anteriores_

  - [x] 9.1 Ejecutar tests de regresión
    - Ejecutar todos los tests del proyecto (unitarios, integración, propiedad, browser)
    - Verificar que no hay regresiones en funcionalidad existente

  - [x] 9.2 Verificar calidad de código
    - Ejecutar linter para verificar estándares de código
    - Verificar que no hay errores de TypeScript
    - Verificar que build produce output válido

- [x] 10. Documentación y refinamiento final
  - Actualizar README.md con nueva funcionalidad
  - Agregar ejemplos de uso del endpoint en documentación
  - Documentar nuevos errores y códigos de error
  - Actualizar cualquier documentación de API existente
  - _Requirements: Documentación completa para usuarios y desarrolladores_

  - [x] 10.1 Actualizar documentación técnica
    - Documentar endpoint `PATCH /tickets/:id/reassignment`
    - Documentar condición previa de autenticación
    - Documentar nuevos códigos de error

  - [x] 10.2 Actualizar documentación de usuario
    - Agregar sección sobre reasignación de tickets en README
    - Incluir ejemplos prácticos de uso
    - Documentar diferencias entre agente y supervisor

## Notes

- **Condición Previa de Autenticación:** La autenticación válida es una condición previa incondicional que debe verificarse antes de cualquier otra validación o lógica de negocio
- **Orden de Validaciones:** 1) Middleware `requireActor` (autenticación), 2) Validación Zod, 3) Lógica de negocio en TicketService
- Los errores de autenticación (401) deben retornarse antes que cualquier otro error de validación o negocio
- Las tareas marcadas con `*` son opcionales y pueden omitirse para un MVP más rápido
- Cada tarea referencia requisitos específicos para trazabilidad
- Los checkpoints aseguran validación incremental
- Los tests de propiedad validan propiedades universales de correctitud
- Los tests unitarios validan ejemplos específicos y casos límite

## Task Dependency Graph
```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1", "2.2", "2.3", "2.4"] },
    { "id": 2, "tasks": ["3.1", "3.2"] },
    { "id": 3, "tasks": ["4.1", "4.2", "4.3"] },
    { "id": 4, "tasks": ["5.1", "5.2", "5.3"] },
    { "id": 5, "tasks": ["6.1", "6.2", "6.3"] },
    { "id": 6, "tasks": ["7"] },
    { "id": 7, "tasks": ["8.1", "8.2"] },
    { "id": 8, "tasks": ["9.1", "9.2"] },
    { "id": 9, "tasks": ["10.1", "10.2"] }
  ]
}
```