# Agentes del Sistema - TallerKiro

Este documento define los diferentes tipos de agentes y sus responsabilidades en el sistema de gestión de tickets.

## Tipos de Agentes

### Agente Regular
**Responsabilidades**:
- Atender tickets asignados dentro del SLA
- Comunicarse con solicitantes para obtener información adicional
- Documentar soluciones aplicadas
- Escalar tickets cuando se requiere intervención especializada

**Permisos**:
- Ver tickets asignados
- Actualizar estado de tickets (ASIGNADO → EN_PROGRESO → EN_ESPERA → RESUELTO)
- Agregar notas y actualizaciones
- Reasignar tickets a otros agentes (con validaciones)

### Supervisor
**Responsabilidades**:
- Revisar tickets vencidos periódicamente
- Intervenir en tickets CRITICA no asignados en 15 minutos
- Gestionar recursos del equipo según carga de trabajo
- Aprobar soluciones complejas o de alto impacto

**Permisos especiales**:
- Ver todos los tickets del sistema
- Reasignar tickets entre agentes sin restricciones
- Forzar escalamientos
- Revisar tickets vencidos y en escalamiento
- Tomar posesión de tickets críticos

## Flujos de Trabajo

### Flujo para Agentes
1. **Asignación**: Recibe tickets asignados automáticamente o manualmente
2. **Análisis**: Revisa el ticket y determina el curso de acción
3. **Comunicación**: Contacta al solicitante si necesita más información
4. **Resolución**: Aplica solución y documenta el proceso
5. **Cierre**: Espera confirmación del solicitante y cierra el ticket

### Flujo para Supervisores
1. **Monitoreo**: Revisa dashboard de tickets vencidos y críticos
2. **Intervención**: Toma acción en tickets que requieren atención especial
3. **Asignación**: Distribuye carga de trabajo entre agentes
4. **Revisión**: Aprueba soluciones complejas
5. **Reporte**: Genera informes de desempeño del equipo

## Políticas de Escalamiento

### Escalamiento Automático
1. **Ciclo 1**: Ticket asignado pero sin avance dentro del SLA
2. **Ciclo 2**: Ticket ya escalado pero sigue sin resolución  
3. **Ciclo 3**: Ticket requiere intervención directa del supervisor

### Escalamiento Manual
- Agente puede escalar ticket cuando:
  - Requiere permisos especiales
  - Depende de recursos externos
  - Presenta complejidad técnica alta

## Requisitos de Comunicación

### Con Solicitantes
- Español neutro, sin tecnicismos
- Mensajes claros y concisos
- Confirmación de recepción y resolución
- Tiempos de respuesta según SLA

### Entre Agentes
- Notificaciones de reasignación
- Compartir conocimiento sobre soluciones
- Coordinación para tickets complejos
- Transición ordenada entre turnos

## Métricas de Desempeño

### Para Agentes
- Tiempo promedio de resolución
- Porcentaje de tickets dentro del SLA
- Satisfacción del solicitante
- Tasa de reapertura de tickets

### Para Supervisores
- Tiempo de intervención en críticos
- Distribución equilibrada de carga
- Efectividad en escalamientos
- Capacitación del equipo

## Procesos de Capacitación

### Nuevos Agentes
1. **Inducción**: Conocimiento del sistema y políticas
2. **Acompañamiento**: Trabajo conjunto con agente experimentado
3. **Evaluación**: Revisión de primeros tickets atendidos
4. **Autonomía**: Trabajo independiente con supervisión periódica

### Desarrollo Continuo
- Sesiones de conocimiento técnico
- Revisión de casos complejos
- Actualización de políticas y procedimientos
- Retroalimentación de desempeño
