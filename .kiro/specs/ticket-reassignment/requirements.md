# Requirements Document

## Introduction

Este documento define los requisitos para la funcionalidad de reasignación de tickets en el sistema TallerKiro. La funcionalidad permite a agentes y supervisores transferir tickets entre agentes, manteniendo un registro completo del historial de cambios de asignación y garantizando la integridad del ciclo de vida del ticket.

## Glossary

- **Ticket**: Un registro formal de una incidencia o solicitud de soporte con historial de estados y asignaciones.
- **Agente**: Miembro del equipo de soporte responsable de resolver tickets asignados.
- **Supervisor**: Miembro senior del equipo con permisos especiales de supervisión y reasignación.
- **Reasignación**: Proceso de transferir un ticket de un agente a otro manteniendo su estado actual.
- **Sistema**: El sistema de gestión de tickets TallerKiro en su totalidad.
- **Ticket_Service**: El servicio de aplicación que orquesta las operaciones de tickets.
- **Historial_De_Ticket**: Registro cronológico de todas las transiciones de estado y cambios de asignación de un ticket.
- **Director_De_Agentes**: Componente de infraestructura que gestiona el catálogo de agentes disponibles.

## Requirements

### Requirement 1: Reasignación de Tickets por Agentes

**User Story:** Como agente, quiero reasignar un ticket a otro agente, para que el ticket sea atendido por alguien con mejor capacidad o experiencia.

#### Acceptance Criteria

1. WHEN un agente solicita reasignar un ticket a otro agente existente, THE Ticket_Service SHALL transferir la responsabilidad del ticket al nuevo agente
2. WHEN ocurre una reasignación exitosa, THE Ticket_Service SHALL registrar una entrada en el historial del ticket indicando el cambio de responsable
3. WHEN un agente intenta reasignar un ticket que no está asignado a él, THE Ticket_Service SHALL rechazar la operación con un error de autorización
4. WHEN un agente intenta reasignar un ticket a un agente inexistente, THE Ticket_Service SHALL rechazar la operación con un error de validación
5. WHERE el ticket está en estado CERRADO, THE Ticket_Service SHALL rechazar la reasignación con un error indicando que el ticket está cerrado

### Requirement 2: Reasignación de Tickets por Supervisores

**User Story:** Como supervisor, quiero reasignar cualquier ticket entre agentes, para optimizar la distribución de carga y resolver bloqueos.

#### Acceptance Criteria

1. WHEN un supervisor solicita reasignar cualquier ticket a cualquier agente existente, THE Ticket_Service SHALL transferir la responsabilidad del ticket al nuevo agente independientemente del asignado actual
2. WHEN un supervisor reasigna un ticket vencido, THE Ticket_Service SHALL mantener el estado de vencimiento y ciclo de escalamiento actual
3. WHERE el ticket está en estado NUEVO (sin asignar), THE Ticket_Service SHALL asignarlo directamente al agente especificado en lugar de reasignarlo
4. WHERE el nuevo agente es el mismo que el actual, THE Ticket_Service SHALL rechazar la operación indicando que no hay cambio necesario
5. WHEN ocurre una reasignación por supervisor, THE Ticket_Service SHALL registrar en el historial que fue realizada por un supervisor

### Requirement 3: Integridad de Datos y SLA

**User Story:** Como administrador del sistema, quiero que las reasignaciones mantengan la integridad de los datos del ticket, para que los cálculos de SLA y escalamiento sigan siendo precisos.

#### Acceptance Criteria

1. WHILE un ticket está siendo reasignado, THE Ticket_Service SHALL mantener inalterados su estado actual, prioridad y categoría
2. WHEN un ticket es reasignado mientras está en estado EN_ESPERA, THE Ticket_Service SHALL mantener la pausa del SLA activa
3. WHEN un ticket es reasignado, THE Ticket_Service SHALL no reiniciar los contadores de tiempo de respuesta o resolución del SLA
4. WHERE un ticket tiene escalamientos activos, THE Ticket_Service SHALL mantener los ciclos de escalamiento sin cambios
5. THE Ticket_Service SHALL actualizar la marca de tiempo de última modificación del ticket al realizar una reasignación

### Requirement 4: API Endpoint de Reasignación

**User Story:** Como desarrollador de API, quiero un endpoint REST para reasignar tickets, para integrar esta funcionalidad en la interfaz de usuario.

#### Acceptance Criteria

1. WHEN se recibe una petición PATCH a `/tickets/:id/reassignment` con datos válidos, THE API_Endpoint SHALL procesar la reasignación y retornar el ticket actualizado
2. WHEN los datos de reasignación son inválidos (agente inexistente, datos faltantes), THE API_Endpoint SHALL retornar un error 422 con detalles de validación
3. WHEN el usuario no tiene permisos para reasignar el ticket, THE API_Endpoint SHALL retornar un error 403
4. WHEN el ticket no existe, THE API_Endpoint SHALL retornar un error 404
5. THE API_Endpoint SHALL requerir autenticación válida del actor (agente o supervisor) como condición previa para procesar cualquier reasignación
6. THE API_Endpoint SHALL validar el input con un schema Zod que defina `{ responsibleId: string }`

### Requirement 5: Historial de Reasignaciones

**User Story:** Como auditor del sistema, quiero ver un registro completo de todas las reasignaciones de tickets, para realizar análisis de desempeño y trazabilidad.

#### Acceptance Criteria

1. THE Historial_De_Ticket SHALL incluir una entrada específica para cada reasignación con:
   - Timestamp de la reasignación
   - ID del responsable anterior
   - ID del nuevo responsable
   - ID del actor que realizó la reasignación
   - Rol del actor (AGENTE o SUPERVISOR)
2. WHEN se consulta el historial de un ticket, THE API_Endpoint SHALL incluir las entradas de reasignación en orden cronológico
3. THE Historial_De_Ticket SHALL diferenciar entre reasignaciones y cambios de estado en sus registros
4. FOR ALL tickets reasignados, el historial SHALL preservar la secuencia completa de responsables a lo largo del tiempo