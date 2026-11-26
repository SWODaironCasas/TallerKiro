# Agents Documentation Steering

Este steering aplica estándares para documentación relacionada con agentes y flujos de trabajo en el sistema TallerKiro.

## Cuando se aplica
```yaml
fileMatch:
  - ".kiro/agents/**/*.md"
  - "docs/agents/**/*.md"
  - "**/AGENTS.md"
  - "**/agents*.md"
  - "src/**/*agent*.ts"
  - "src/**/*supervisor*.ts"
```

## Estándares de Documentación de Agentes

### 1. Estructura del documento
- **Título claro**: Describe el tipo de agente o documento
- **Secciones lógicas**: Responsabilidades, permisos, flujos, políticas
- **Ejemplos prácticos**: Casos de uso reales
- **Diagramas cuando sea útil**: Flujos de trabajo visuales

### 2. Contenido requerido
Cada documento de agente debe incluir:
- **Responsabilidades**: Qué hace el agente
- **Permisos**: Qué puede hacer en el sistema
- **Flujos de trabajo**: Cómo realiza sus tareas
- **Políticas aplicables**: Reglas que debe seguir
- **Métricas de desempeño**: Cómo se mide su efectividad

### 3. Formato consistente
- Usar markdown estándar
- Encabezados jerárquicos (##, ###)
- Listas para responsabilidades y permisos
- Tablas para comparaciones cuando sea apropiado
- Código de ejemplo en bloques de código

### 4. Actualización
- Revisar documentación cuando cambien responsabilidades
- Mantener consistencia entre documentos relacionados
- Verificar que ejemplos sigan siendo válidos
- Actualizar diagramas si cambian los flujos

## Plantilla para nuevos documentos de agente

```markdown
# [Nombre del Agente/Rol]

## Responsabilidades
- [Responsabilidad 1]
- [Responsabilidad 2]
- [Responsabilidad 3]

## Permisos
- **Ver**: [qué puede ver]
- **Crear**: [qué puede crear]
- **Modificar**: [qué puede modificar]
- **Eliminar**: [qué puede eliminar]

## Flujos de Trabajo
### Flujo principal
1. [Paso 1]
2. [Paso 2]
3. [Paso 3]

### Flujos alternativos
- **Caso especial 1**: [descripción]
- **Caso especial 2**: [descripción]

## Políticas Aplicables
- [Política 1]
- [Política 2]

## Métricas de Desempeño
- **Eficiencia**: [métrica]
- **Calidad**: [métrica]
- **Tiempo**: [métrica]

## Ejemplos
### Ejemplo 1: [Caso típico]
Descripción del caso...

### Ejemplo 2: [Caso complejo]
Descripción del caso...
```

## Checklist para nueva documentación
- [ ] Estructura completa (responsabilidades, permisos, flujos)
- [ ] Ejemplos prácticos incluidos
- [ ] Políticas relevantes documentadas
- [ ] Métricas de desempeño definidas
- [ ] Formato consistente con otros documentos
- [ ] Diagramas o flujos visuales cuando sea necesario
- [ ] Revisión de consistencia con implementación real
