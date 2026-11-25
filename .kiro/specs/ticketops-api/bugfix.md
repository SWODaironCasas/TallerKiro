# Bugfix Requirements Document

## Introduction

TicketOps API incluye en `GET /tickets/overdue` tickets cuyo estado actual es `RESUELTO` o `CERRADO` cuando esos tickets superaron su Fecha_de_Vencimiento antes de resolverse o cerrarse. Esto mezcla incumplimientos históricos con tickets que todavía requieren atención y hace que el listado de vencidos no represente únicamente trabajo abierto fuera de SLA.

El bugfix debe corregir la selección del listado de vencidos sin borrar ni alterar el indicador de vencimiento, los escalamientos o las notificaciones históricas conservadas en el ticket terminal.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN un ticket tiene el instante actual posterior a su Fecha_de_Vencimiento y su Estado actual es `RESUELTO`, THEN el sistema conserva sus datos históricos de vencimiento pero también lo incluye en la respuesta de `GET /tickets/overdue`.

1.2 WHEN un ticket tiene el instante actual posterior a su Fecha_de_Vencimiento y su Estado actual es `CERRADO`, THEN el sistema conserva sus datos históricos de vencimiento pero también lo incluye en la respuesta de `GET /tickets/overdue`.

1.3 WHEN `GET /tickets/overdue` evalúa una colección que contiene tickets abiertos vencidos y tickets vencidos que ya están `RESUELTO` o `CERRADO`, THEN el sistema devuelve conjuntamente los tickets abiertos y los tickets terminales.

### Expected Behavior (Correct)

2.1 WHEN un ticket cuyo Estado actual es `RESUELTO` ha superado su Fecha_de_Vencimiento, THEN el sistema SHALL conservar su indicador de vencimiento, sus escalamientos y sus Notificaciones_al_Supervisor históricas, pero SHALL excluirlo del resultado de `GET /tickets/overdue`.

2.2 WHEN un ticket cuyo Estado actual es `CERRADO` ha superado su Fecha_de_Vencimiento, THEN el sistema SHALL conservar su indicador de vencimiento, sus escalamientos y sus Notificaciones_al_Supervisor históricas, pero SHALL excluirlo del resultado de `GET /tickets/overdue`.

2.3 WHEN `GET /tickets/overdue` evalúa una colección que contiene tickets abiertos vencidos y tickets vencidos que ya están `RESUELTO` o `CERRADO`, THEN el sistema SHALL devolver únicamente los tickets cuyo Estado actual no sea `RESUELTO` ni `CERRADO` y cuyo instante actual supere su Fecha_de_Vencimiento.

2.4 WHEN un ticket está en un Estado distinto de `RESUELTO` y `CERRADO`, y el instante actual supera su Fecha_de_Vencimiento, THEN el sistema SHALL continuar marcándolo como vencido y SHALL incluirlo en `GET /tickets/overdue`.

2.5 WHEN un ticket cambia a `RESUELTO` o `CERRADO` después de haber sido marcado como vencido, THEN el sistema SHALL conservar el indicador de vencimiento y los eventos históricos ya registrados, aunque SHALL dejar de incluir el ticket en consultas posteriores de `GET /tickets/overdue`.

### Unchanged Behavior (Regression Prevention)

3.1 WHEN un ticket permanece en un Estado abierto distinto de `RESUELTO` y `CERRADO` y el instante actual supera su Fecha_de_Vencimiento, THEN el sistema SHALL CONTINUE TO marcarlo como vencido, registrar como máximo un Escalamiento y una Notificación_al_Supervisor por ciclo, e incluirlo en `GET /tickets/overdue`.

3.2 WHEN un ticket permanece en un Estado abierto y el instante actual es igual o anterior a su Fecha_de_Vencimiento, THEN el sistema SHALL CONTINUE TO excluirlo de `GET /tickets/overdue` y no tratarlo como vencido.

3.3 WHEN una consulta repetida de `GET /tickets/overdue` evalúa el mismo ticket abierto dentro del mismo ciclo de vencimiento, THEN el sistema SHALL CONTINUE TO devolver el ticket sin duplicar sus escalamientos ni sus Notificaciones_al_Supervisor.

3.4 WHEN una consulta de `GET /tickets/overdue` usa un filtro válido de Categoría, THEN el sistema SHALL CONTINUE TO aplicar el filtro únicamente a los tickets vencidos que cumplen la condición de Estado abierto, sin volver a incluir tickets `RESUELTO` o `CERRADO`.

3.5 WHEN una consulta de `GET /tickets/overdue` es realizada por un actor sin permisos de Supervisor o contiene una Categoría inválida, THEN el sistema SHALL CONTINUE TO devolver el error HTTP definido para esa condición, sin cambiar por este bugfix la autorización ni la validación.

FUNCTION isBugCondition(X)
  INPUT: X of type TicketAndQueryEvaluation
  OUTPUT: boolean

  RETURN X.now > X.ticket.dueAt
    AND X.ticket.status IN { RESUELTO, CERRADO }
    AND X.operation = GET_TICKETS_OVERDUE
END FUNCTION

// Property: Fix Checking
FOR ALL X WHERE isBugCondition(X) DO
  result <- evaluateOverdueQuery'(X)
  ASSERT X.ticket.id NOT IN result.tickets
    AND X.ticket.overdue = X.originalTicket.overdue
    AND X.ticket.escalations = X.originalTicket.escalations
    AND X.ticket.supervisorNotifications = X.originalTicket.supervisorNotifications
END FOR

// Property: Preservation Checking
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT evaluateOverdueQuery(X) = evaluateOverdueQuery'(X)
END FOR

// Property: Open overdue tickets remain visible
FOR ALL X WHERE X.ticket.status NOT IN { RESUELTO, CERRADO }
  AND X.now > X.ticket.dueAt
  AND X.operation = GET_TICKETS_OVERDUE DO
  result <- evaluateOverdueQuery'(X)
  ASSERT X.ticket.id IN result.tickets
END FOR

// Property: Terminal history remains observable
FOR ALL X WHERE X.ticket.status IN { RESUELTO, CERRADO }
  AND X.ticket.overdue = true DO
  result <- evaluateTicket'(X)
  ASSERT result.overdue = true
    AND result.escalations = X.ticket.escalations
    AND result.supervisorNotifications = X.ticket.supervisorNotifications
END FOR
