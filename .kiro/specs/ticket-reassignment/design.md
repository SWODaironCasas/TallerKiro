# Design Document

## Overview

Este documento detalla el diseño de la funcionalidad de reasignación de tickets en el sistema TallerKiro. La funcionalidad permite transferir tickets entre agentes manteniendo la integridad de datos, registrando el historial y respetando las reglas de negocio existentes.

**Condición Previa Incondicional:** De acuerdo con el Requirement 4.5, toda reasignación requiere autenticación válida del actor (agente o supervisor) como condición previa antes de procesar cualquier otra validación.

## Architecture

La funcionalidad se integrará en la arquitectura de capas existente de TallerKiro:

### Capa de Dominio
- Extenderá las reglas de negocio para validar permisos de reasignación
- Mantendrá invariantes de integridad de datos
- Definirá nuevos tipos de errores específicos para reasignación

### Capa de Aplicación
- Agregará un método `reassign` al `TicketService`
- Implementará la lógica de orquestación para reasignaciones
- Coordinará validaciones, actualizaciones y registro de historial

### Capa de Infraestructura
- No requiere cambios significativos
- Utilizará los repositorios existentes

### Capa HTTP
- Agregará endpoint REST `PATCH /tickets/:id/reassignment`
- Creará esquema Zod para validación de entrada
- Implementará handlers con manejo de errores adecuado

## Components and Interfaces

### 1. Método de Reasignación en TicketService

```typescript
// En src/application/ticket-service.ts
interface TicketService {
  // Método existente para asignación inicial
  assign(id: string, responsibleId: string, actorId: string): Ticket;
  
  // Nuevo método para reasignación
  reassign(id: string, responsibleId: string, actorId: string): Ticket;
}
```

**Implementación del método reassign:**
- Validar que el ticket existe
- Validar que el actor existe y tiene permisos
- Validar que el nuevo agente existe y está activo
- Validar que no es una reasignación al mismo agente
- Validar que el ticket no está cerrado
- Para agentes: validar que el ticket está asignado a ellos
- Para supervisores: permitir reasignación de cualquier ticket
- Actualizar el responsable manteniendo estado actual
- Registrar entrada en el historial específica para reasignación
- Actualizar marca de tiempo `updatedAt`
- Mantener todos los demás campos (SLA, escalamientos, etc.) sin cambios

### 2. Endpoint HTTP

```typescript
// En src/http/ticket-routes.ts
router.patch(
  '/tickets/:id/reassignment',
  requireActor(agentDirectory), // Middleware incondicional que valida autenticación
  routeHandler((request, response) => {
    const { id } = idParamSchema.parse(request.params);
    const { responsibleId } = reassignmentSchema.parse(request.body);
    const ticket = service.reassign(id, responsibleId, request.actorId as string);
    response.status(200).json(mapTicketToResponse(ticket));
  }),
);
```

## Data Models

### 1. Esquema de Validación Zod
```typescript
// En src/http/schemas.ts
export const reassignmentSchema = z
  .object({
    responsibleId: requiredText,
  })
  .strict();

export type ReassignmentBody = z.infer<typeof reassignmentSchema>;
```

### 2. Nuevos Errores de Dominio
```typescript
// En src/domain/errors.ts
export class TicketClosedError extends Error {
  code = 'TICKET_CLOSED';
  constructor(ticketId: string) {
    super(`Ticket ${ticketId} is closed and cannot be reassigned`);
  }
}

export class SameAgentReassignmentError extends Error {
  code = 'SAME_AGENT_REASSIGNMENT';
  constructor() {
    super('Cannot reassign ticket to the same agent');
  }
}

export class AgentNotResponsibleError extends Error {
  code = 'AGENT_NOT_RESPONSIBLE';
  constructor(agentId: string, ticketId: string) {
    super(`Agent ${agentId} is not responsible for ticket ${ticketId}`);
  }
}
```

### 3. Registro de Historial Específico
```typescript
interface ReassignmentHistoryEntry extends StateHistoryEntry {
  type: 'REASSIGNMENT';
  previousResponsibleId: string | null;
  newResponsibleId: string;
  actorRole: ActorRole;
}
```

## Data Flow

### Flujo de Reasignación por Agente:
1. Cliente envía PATCH /tickets/:id/reassignment con `responsibleId`
2. **CONDICIÓN PREVIA:** Middleware `requireActor` valida autenticación incondicional del actor
3. Handler parsea y valida input con Zod
4. TicketService.reassign() ejecuta:
   - Valida existencia del ticket y que no esté cerrado
   - Valida que el actor es el responsable actual del ticket
   - Valida que el nuevo agente existe y está activo
   - Valida que no es reasignación al mismo agente
   - Actualiza `responsibleId` y `updatedAt`
   - Registra entrada en historial específica
5. Retorna ticket actualizado con mapeo apropiado

### Flujo de Reasignación por Supervisor:
1. **CONDICIÓN PREVIA:** Mismo middleware `requireActor` valida autenticación incondicional del supervisor
2. Handler parsea y valida input con Zod
3. TicketService.reassign() ejecuta:
   - Valida existencia del ticket y que no esté cerrado
   - Omitir validación de que actor es responsable actual (permiso de supervisor)
   - Valida que el nuevo agente existe y está activo
   - Valida que no es reasignación al mismo agente
   - Actualiza `responsibleId` y `updatedAt`
   - Registra entrada en historial específica
4. Retorna ticket actualizado con mapeo apropiado

## Integration Points

### Con Componentes Existentes:
- **AgentDirectory**: Para validar existencia y estado de agentes
- **TicketStore**: Para persistir cambios y registrar historial
- **Clock**: Para marcas de tiempo consistentes
- **Error Handler Middleware**: Para manejo uniforme de errores

### Con Reglas de Negocio Existentes:
- **SLA**: Tiempos de respuesta/resolución no se reinician
- **Estado EN_ESPERA**: SLA permanece pausado si aplica
- **Escalamientos**: Ciclos activos se mantienen
- **Historial**: Secuencia incremental se preserva

## Correctness Properties

### Property 1: Permisos de Agente
**Validates: Requirements 1.1**  
Agente solo puede reasignar tickets donde es el responsable actual  
Para todo ticket T, agente A, y nuevo agente N:  
Si `T.responsibleId !== A.id` entonces `reassign(T.id, N.id, A.id)` debe fallar con `AgentNotResponsibleError`

### Property 2: Permisos de Supervisor
**Validates: Requirements 1.2**  
Supervisor puede reasignar cualquier ticket independientemente del responsable  
Para todo ticket T, supervisor S, y nuevo agente N:  
`reassign(T.id, N.id, S.id)` debe tener éxito si N existe y T no está cerrado

### Property 3: Idempotencia Misma Reasignación
**Validates: Requirements 1.1, 1.2**  
Reasignación al mismo agente debe fallar  
Para todo ticket T y actor R:  
`reassign(T.id, T.responsibleId, R.id)` debe fallar con `SameAgentReassignmentError`

### Property 4: Idempotencia Reasignaciones Secuenciales
**Validates: Requirements 1.1, 1.2**  
Reasignaciones idénticas secuenciales deben fallar  
Para todo ticket T, actor R, y agente N:  
Si `reassign(T.id, N.id, R.id)` tiene éxito, entonces `reassign(T.id, N.id, R.id)` debe fallar con `SameAgentReassignmentError`

### Property 5: Estado Cerrado
**Validates: Requirements 1.1**  
Tickets cerrados no pueden ser reasignados  
Para todo ticket T con `T.status === 'CERRADO'`, actor R, y agente N:  
`reassign(T.id, N.id, R.id)` debe fallar con `TicketClosedError`

### Property 6: Conservación de Campos no-Responsable
**Validates: Requirements 1.3**  
Campos no-responsable no cambian durante reasignación exitosa  
Para todo ticket T, actor R, y agente N donde `reassign(T.id, N.id, R.id)` tiene éxito produciendo T':  
- `T'.status === T.status`
- `T'.priority === T.priority` 
- `T'.category === T.category`
- `T'.dueAt === T.dueAt`
- `T'.overdue === T.overdue`
- `T'.overdueCycle === T.overdueCycle`
- `T'.escalations === T.escalations`
- `T'.supervisorNotifications === T.supervisorNotifications`
- Si `T.status === 'EN_ESPERA'` entonces SLA permanece pausado

### Property 7: Único Cambio Permitido
**Validates: Requirements 1.3**  
Único cambio permitido es responsibleId y updatedAt  
Para toda reasignación exitosa T → T':  
El conjunto de campos cambiados debe ser exactamente `{responsibleId, updatedAt}`

### Property 8: Historial de Reasignaciones
**Validates: Requirements 1.5**  
Cada reasignación exitosa agrega exactamente una entrada al historial  
Para todo ticket T, actor R, y agente N donde `reassign(T.id, N.id, R.id)` tiene éxito:  
El historial de T' debe tener exactamente una entrada más que el historial de T

### Property 9: Datos Correctos en Historial
**Validates: Requirements 1.5**  
Entrada de historial contiene datos correctos  
Para toda entrada de historial H creada por reasignación:  
- `H.type === 'REASSIGNMENT'`
- `H.previousResponsibleId === T.responsibleId`
- `H.newResponsibleId === N.id`
- `H.actorRole === R.role`
- `H.actorId === R.id`

### Property 10: Validación de Agente Inexistente
**Validates: Requirements 1.1, 1.2, 1.4**  
Agentes inexistentes causan error de validación  
Para todo ticket T, actor R, y agenteId N donde N no existe en AgentDirectory:  
`reassign(T.id, N, R.id)` debe fallar con `AgentUnavailableError`

## Security Considerations

### Validaciones de Seguridad:
1. **Autenticación Incondicional:** Requerida como condición previa para cualquier reasignación via X-Actor-Id header
2. **Autorización:** 
   - Agente: Solo tickets asignados a él
   - Supervisor: Cualquier ticket
3. **Validación de Input:** Zod schema rechaza datos malformados
4. **Prevención de IDOR:** Validación de que actor tiene permisos sobre el ticket específico

### Consideraciones de Auditoría:
1. Historial registra quién, cuándo y de/a quién se reasignó
2. Entradas diferenciadas para cambios de estado vs reasignaciones
3. Preservación de secuencia completa para trazabilidad

## Testing Strategy

### Tests Unitarios (src/application/ticket-service.test.ts):
- Casos exitosos para agentes y supervisores
- Casos de error: ticket cerrado, agente inexistente, mismo agente, permisos insuficientes
- Verificación de que campos críticos no cambian

### Tests de Propiedad (src/application/ticket-reassignment.property.test.ts):
1. **Propiedad de Permisos:** Generar tickets y actores aleatorios, verificar que solo responsables/supervisores pueden reasignar
2. **Propiedad de Idempotencia:** `reassign(x, a, s) → reassign(x, a, s)` debe fallar
3. **Propiedad de Conservación:** Campos no-responsable deben ser idénticos antes/después
4. **Propiedad de Historial:** Cada reasignación exitosa debe agregar exactamente una entrada

### Tests de Integración (src/http/ticket-reassignment.integration.test.ts):
- Endpoint retorna 200 para casos válidos con autenticación válida
- **Condición Previa:** Endpoint retorna 401 para cualquier petición sin autenticación válida
- Endpoint retorna errores apropiados (403, 404, 422, 400) cuando autenticación es válida pero otros requisitos fallan
- Verificación de formato de respuesta
- Pruebas con middleware de autenticación `requireActor`

### Tests de Browser (tests/browser/ticket-reassignment.spec.ts):
- Flujo de reasignación en panel de UI
- Validación de mensajes de error en interfaz
- Comportamiento con permisos diferentes

## Error Handling

### Condiciones Previas:
1. **401 Unauthorized:** Autenticación faltante o inválida - condición previa incondicional según Requirement 4.5

### Errores Específicos (post-autenticación):
1. **400 Bad Request:** Datos de entrada inválidos
2. **403 Forbidden:** Agente intenta reasignar ticket no asignado a él
3. **404 Not Found:** Ticket o agente no existe
4. **422 Unprocessable Entity:** Validación Zod falla
5. **409 Conflict:** Ticket cerrado, mismo agente

### Mensajes de Error Claro:
- **Condición Previa:** "Authentication required" (401 - autenticación faltante)
- "Ticket {id} is closed and cannot be reassigned"
- "Agent {agentId} is not responsible for ticket {ticketId}"
- "Cannot reassign ticket to the same agent"
- "Agent {responsibleId} is not available or does not exist"

## Deployment Considerations

### Cambios de Base de Datos:
- No requiere migraciones de base de datos
- Utiliza schema existente de historial (posible extensión para tipo de evento)

### Compatibilidad con Versiones:
- Endpoint nuevo, no rompe API existente
- Método nuevo en servicio, compatible con usos existentes
- Errores nuevos, manejados por error handler existente
- **Middleware de autenticación:** Utiliza `requireActor` existente que ya implementa la condición previa incondicional

### Rollback Strategy:
- Eliminar endpoint de rutas
- Eliminar método del servicio
- Eliminar esquemas y tipos
- Los tests existentes deben seguir pasando
- La condición previa de autenticación permanece intacta para otros endpoints

## Performance Impact

### Impacto en Rendimiento:
- **Latencia:** Operación en memoria, similar a `assign` existente
- **Throughput:** Comparable a operaciones de cambio de estado
- **Almacenamiento:** Una entrada adicional en historial por reasignación

### Consideraciones de Escala:
- Validaciones O(1) con índices existentes
- No introduce queries costosas
- Cache-friendly (datos locales en servicio)

## Monitoring and Observability

### Métricas a Monitorear:
- Tasa de reasignaciones exitosas/fallidas
- Tiempo de procesamiento de reasignaciones
- Distribución de reasignaciones por rol (agente vs supervisor)
- Tickets más frecuentemente reasignados

### Logs Clave:
- Reasignación exitosa: ticketId, actorId, previousResponsibleId, newResponsibleId
- Reasignación fallida: ticketId, actorId, errorCode, razón
- Auditoría: histórico completo preservado en base de datos