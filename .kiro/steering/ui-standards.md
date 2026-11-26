# UI Standards Steering

Este steering aplica estándares de interfaz de usuario cuando se trabaja con archivos en la carpeta pública del proyecto TallerKiro.

## Cuando se aplica
```yaml
fileMatch:
  - "public/**/*.html"
  - "public/**/*.css"
  - "public/**/*.js"
  - "public/**/*.ts"
  - "public/panel/**/*"  # Carpeta específica del panel
```

## Estándares generales de UI

### 1. Idioma y contenido
- **Todos los textos deben estar en español neutro**
- Evitar tecnicismos innecesarios
- Mensajes claros y comprensibles para usuarios no técnicos
- Títulos descriptivos y acciones con verbos claros

### 2. Accesibilidad (WCAG AA)
- **Contraste de color**: Relación mínimo 4.5:1 para texto normal, 3:1 para texto grande
- **Navegación por teclado**: Todos los elementos interactivos deben ser accesibles con tabulación
- **Roles ARIA**: Definir roles apropiados para elementos interactivos
- **Etiquetas accesibles**: Todo campo de formulario debe tener label asociado
- **Focus visible**: Indicador visual claro del elemento con foco
- **Alt text**: Imágenes deben tener texto alternativo descriptivo

### 3. Dependencias externas
- **No usar dependencias externas** en archivos públicos
- Todo CSS y JavaScript debe ser auto-contenido
- No cargar recursos de CDNs externos
- Usar assets locales o empaquetados

### 4. Estados de interfaz
Cada componente debe manejar explícitamente estos estados:

#### Estado de carga
```html
<!-- Ejemplo de estado de carga -->
<div class="loading-state" aria-live="polite" aria-busy="true">
  <span class="spinner" aria-hidden="true"></span>
  <span>Cargando tickets...</span>
</div>
```

#### Estado vacío
```html
<!-- Ejemplo de estado vacío -->
<div class="empty-state" aria-live="polite">
  <img src="/assets/empty-tickets.svg" alt="No hay tickets disponibles">
  <h3>No hay tickets pendientes</h3>
  <p>No se encontraron tickets que requieran atención en este momento.</p>
</div>
```

#### Estado de error
```html
<!-- Ejemplo de estado de error -->
<div class="error-state" role="alert" aria-live="assertive">
  <h3>Ocurrió un error</h3>
  <p>No se pudieron cargar los tickets. Por favor, intente nuevamente.</p>
  <button onclick="location.reload()">Reintentar</button>
</div>
```

### 5. Patrones específicos para el panel

#### Cards de ticket
```html
<div class="ticket-card" role="article">
  <header>
    <h4 class="ticket-title">[TÍTULO DEL TICKET]</h4>
    <span class="ticket-priority priority-critica" aria-label="Prioridad crítica">CRITICA</span>
  </header>
  <p class="ticket-description">[DESCRIPCIÓN BREVE]</p>
  <footer>
    <time datetime="[ISO_DATE]">Creado: [FECHA LEGIBLE]</time>
    <button class="btn-view" aria-label="Ver detalles del ticket">Ver detalles</button>
  </footer>
</div>
```

#### Formularios
```html
<form>
  <div class="form-group">
    <label for="ticket-title">Título del ticket</label>
    <input 
      type="text" 
      id="ticket-title" 
      name="title" 
      required
      aria-describedby="title-help"
    >
    <small id="title-help">Ingrese un título descriptivo del problema</small>
  </div>
</form>
```

### 6. Responsive Design
- Mobile-first approach
- Breakpoints estándar: 320px, 768px, 1024px, 1280px
- Contenido legible sin scroll horizontal en móviles

### 7. Performance
- Minimizar archivos estáticos
- Usar lazy loading para imágenes
- Optimizar recursos de fuentes e iconos
- Implementar caching apropiado

## Checklist para nuevas interfaces
- [ ] Textos en español neutro y sin tecnicismos
- [ ] Contraste WCAG AA verificado
- [ ] Navegación por teclado funcional
- [ ] Estados de carga, vacío y error implementados
- [ ] Sin dependencias externas
- [ ] Responsive en todos los breakpoints
- [ ] Performance optimizada
- [ ] ARIA labels y roles apropiados
