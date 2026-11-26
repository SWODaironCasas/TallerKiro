# API Standards Steering

Este steering aplica estándares y mejores prácticas cuando se trabajan con archivos relacionados a APIs en el proyecto TallerKiro.

## Cuando se aplica
```yaml
fileMatch:
  - "**/*-routes.ts"
  - "**/*-controller.ts"
  - "**/*-api.ts"
  - "**/*-endpoints.ts"
  - "**/http/**/*.ts"
  - "**/api/**/*.ts"
  - "**/*.openapi.yaml"
  - "**/*.openapi.yml"
  - "**/*.openapi.json"
  - "**/*swagger*.yaml"
  - "**/*swagger*.yml"
  - "**/*swagger*.json"
```

## Estándares generales de API

### 1. Estructura de rutas REST
- Usar sustantivos en plural para colecciones: `/tickets`, `/users`
- Usar sustantivos singulares para recursos específicos: `/tickets/{id}`
- Nestear recursos cuando corresponda: `/tickets/{id}/messages`
- Versionar APIs en la URL: `/v1/tickets` o usando headers de aceptación

### 2. Convenciones HTTP
- **GET**: Solo lectura, nunca efectos secundarios
- **POST**: Crear nuevos recursos
- **PUT**: Reemplazar completamente un recurso
- **PATCH**: Actualizar parcialmente un recurso
- **DELETE**: Eliminar un recurso

### 3. Respuestas HTTP
- 200 OK: Éxito para GET, PUT, PATCH
- 201 Created: Éxito para POST (incluir header Location)
- 204 No Content: Éxito para DELETE sin contenido
- 400 Bad Request: Error en la solicitud del cliente
- 401 Unauthorized: Autenticación requerida
- 403 Forbidden: Permisos insuficientes
- 404 Not Found: Recurso no existe
- 409 Conflict: Estado conflictivo
- 422 Unprocessable Entity: Validación fallida
- 500 Internal Server Error: Error del servidor

## Estándares específicos para TallerKiro

### 1. Validación con Zod
```typescript
// Ejemplo: Definir schema de validación
const createTicketSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(1000),
  category: z.enum(['INFRAESTRUCTURA', 'ACCESOS', 'APLICACIONES', 'INSTALACIONES']),
  priority: z.enum(['CRITICA', 'ALTA', 'MEDIA', 'BAJA'])
});

// Ejemplo: Validar en handler
const parsed = createTicketSchema.safeParse(req.body);
if (!parsed.success) {
  return res.status(422).json({ errors: parsed.error.errors });
}
```

### 2. Manejo de errores consistente
```typescript
// Usar estructura de error estándar
interface ApiError {
  message: string;
  code?: string;
  details?: Record<string, unknown>;
}

// En error handler middleware
app.use((error: Error, req: Request, res: Response, next: NextFunction) => {
  if (error instanceof ZodError) {
    return res.status(422).json({
      message: 'Validation failed',
      details: error.errors
    });
  }
  
  // Error específico del dominio
  if (error instanceof DomainError) {
    return res.status(400).json({
      message: error.message,
      code: error.code
    });
  }
  
  // Error interno
  console.error(error);
  return res.status(500).json({
    message: 'Internal server error'
  });
});
```

### 3. Mapeo de datos
```typescript
// Usar mappers para transformar entre dominio y API
// Ejemplo en src/http/mappers.ts
export const toTicketResponse = (ticket: Ticket): TicketResponse => ({
  id: ticket.id,
  title: ticket.title,
  description: ticket.description,
  status: ticket.status,
  priority: ticket.priority,
  category: ticket.category,
  createdAt: ticket.createdAt.toISOString(),
  updatedAt: ticket.updatedAt.toISOString(),
  // Incluir solo información necesaria para la respuesta
});

export const toTicketListResponse = (tickets: Ticket[]): TicketListResponse => ({
  items: tickets.map(toTicketResponse),
  total: tickets.length
});
```

### 4. Paginación y filtros
```typescript
// Para listados, siempre soportar paginación
interface PaginatedResponse<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  hasNext: boolean;
  hasPrev: boolean;
}

// Parámetros de consulta estándar
interface ListQueryParams {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  filter?: Record<string, string>;
}
```

### 5. Documentación OpenAPI
- Mantener documentación actualizada con la implementación
- Usar decoradores JSDoc para tipos
- Generar especificación OpenAPI 3.x
- Incluir ejemplos de request/response

```yaml
# Ejemplo en openapi.yaml
paths:
  /tickets:
    get:
      summary: List tickets
      parameters:
        - name: page
          in: query
          schema:
            type: integer
            minimum: 1
            default: 1
        - name: pageSize
          in: query
          schema:
            type: integer
            minimum: 1
            maximum: 100
            default: 20
      responses:
        '200':
          description: Success
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/PaginatedTicketResponse'
```

## Reglas de nomenclatura

### Archivos de rutas
- `ticket-routes.ts`: Rutas relacionadas con tickets
- `user-routes.ts`: Rutas relacionadas con usuarios
- `auth-routes.ts`: Rutas de autenticación

### Controladores/handlers
- `ticket-handlers.ts` o `ticket-controller.ts`
- Mantener handlers específicos por recurso

### Middleware
- Nombre descriptivo: `validate-request.ts`, `authenticate.ts`, `rate-limit.ts`
- Usar sufijo `-middleware` cuando sea apropiado

## Seguridad

### 1. Validación de entrada
- Validar todos los inputs con Zod
- Sanitizar strings para prevenir XSS
- Validar límites de tamaño en archivos

### 2. Autenticación/autorización
- Usar middleware para validar tokens JWT
- Verificar roles y permisos por ruta
- Implementar rate limiting apropiado

### 3. Headers de seguridad
- Configurar CORS apropiadamente
- Usar headers de seguridad HTTP (HSTS, CSP, etc.)
- Implementar Content Security Policy

## Testing de APIs

### 1. Tests de integración
```typescript
// Ejemplo en src/http/ticket-routes.integration.test.ts
describe('GET /tickets', () => {
  it('should return paginated tickets', async () => {
    const response = await request(app)
      .get('/tickets')
      .query({ page: 1, pageSize: 10 });
    
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('items');
    expect(response.body).toHaveProperty('total');
  });
});
```

### 2. Tests de validación
- Probar casos de error de validación (422)
- Probar casos de autorización (401, 403)
- Probar casos de recurso no encontrado (404)

## Performance

### 1. Optimizaciones
- Implementar paginación para listados grandes
- Usar proyección de campos para reducir payload
- Considerar caching para respuestas frecuentes

### 2. Monitoreo
- Loggear métricas de rendimiento
- Trackear tiempos de respuesta por endpoint
- Alertar sobre errores frecuentes

## Checklist para nuevas APIs
- [ ] Definir schema de validación Zod
- [ ] Implementar handler con manejo de errores
- [ ] Crear mapper para respuesta
- [ ] Escribir tests de integración
- [ ] Documentar en OpenAPI
- [ ] Configurar middleware de seguridad
- [ ] Implementar paginación si es listado
- [ ] Verificar autorización/autenticación