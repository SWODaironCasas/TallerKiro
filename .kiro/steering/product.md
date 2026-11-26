# TallerKiro - Product Overview

## Summary
TallerKiro is a ticket management system designed for IT support operations. It handles the full lifecycle of support tickets with features for assignment, escalation, resolution tracking, and supervisor oversight.

## Reglas tecnológicas
- Gestor de paquetes: pnpm. Nunca usar npm ni yarn; los comandos son pnpm install, pnpm test y pnpm build.
- Lenguaje: TypeScript 5.9. No usar TypeScript 7: typescript-eslint todavía no lo soporta.
- Pruebas con Vitest; los archivos *.test.ts no se compilan a dist.
- Si pnpm bloquea scripts de instalación (ERR_PNPM_IGNORED_BUILDS), aprobar solo lo necesario con pnpm approve-builds.
- Destino de despliegue previsto: AWS (API Gateway + Lambda + DynamoDB), definido con AWS SAM o CDK.
- Las credenciales de AWS nunca se guardan en el repositorio; se usan roles IAM y variables de entorno.

## Contexto
La organización ficticia "Andes Operaciones" atiende incidencias de infraestructura, accesos, aplicaciones e instalaciones.

## Usuarios
- Solicitante: cualquier colaborador que reporta una incidencia.
- Agente: resuelve tickets asignados.
- Supervisor: recibe escalamientos y revisa tickets vencidos.

## Políticas
- Un ticket CRITICA se atiende de inmediato y se escala al supervisor si no tiene responsable en 15 minutos.
- Nunca se elimina un ticket; solo se cierra.
- Los mensajes al usuario son breves, en español neutro y sin tecnicismos.

## Core Capabilities
- **Ticket Management**: Create, assign, resolve, and close support tickets
- **Escalation System**: Automated escalation based on SLA rules and overdue cycles
- **Role-Based Access**: Support for agents and supervisors with different permissions
- **SLA Compliance**: Track response and resolution times against service level agreements
- **Audit Trail**: Comprehensive history of ticket state transitions

## Domain Model
The system centers around tickets with configurable:
- Categories: INFRAESTRUCTURA, ACCESOS, APLICACIONES, INSTALACIONES
- Priorities: CRITICA, ALTA, MEDIA, BAJA  
- Statuses: NUEVO, ASIGNADO, EN_PROGRESO, EN_ESPERA, RESUELTO, CERRADO
- Actors: AGENT, SUPERVISOR roles

## Key Business Rules
1. Tickets escalate through cycles when overdue
2. Supervisors are notified on specific escalation cycles
3. State transitions follow specific allowed paths
4. SLA calculations based on priority and escalation cycles