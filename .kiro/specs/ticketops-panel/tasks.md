# Implementation Plan: TicketOps Panel

## Overview

Implementar TicketOps Panel bajo `/panel/` como una interfaz HTML, CSS y JavaScript nativos, servida por la misma aplicación Express que la API. La API seguirá siendo la única fuente de verdad: el servidor calculará y expondrá `allowedTransitions`, mientras que el navegador consultará, representará y solicitará mutaciones sin duplicar reglas de dominio.

El plan usa TypeScript para los cambios del servidor y JavaScript nativo para los tres archivos públicos del panel. Las dependencias de producción no se amplían. Las pruebas reutilizan Vitest, fast-check y Supertest; si las pruebas de navegador requieren un runner adicional, éste será exclusivamente de desarrollo.

## Tasks

- [x] 1. Ampliar el contrato HTTP y calcular `allowedTransitions` en el servidor
  - [x] 1.1 Implementar el cálculo de descriptores desde las reglas existentes
    - Añadir en la capa de aplicación un método o colaborador que produzca descriptores para `ASSIGN`, `START`, `RESUME`, `WAIT`, `RESOLVE`, `CLOSE` y `REOPEN` según el ticket y las capacidades actuales del servicio.
    - Reutilizar `isAllowedTransition`, `isReopenTransition`, las tablas/reglas del dominio y la operación de asignación existente; no copiar una segunda tabla de transiciones en el mapper ni en el cliente.
    - Emitir para cada descriptor `action`, `method`, `href`, `targetStatus` e `input`; representar asignación con `PATCH /tickets/:id/assignment`, `targetStatus: null` e input `RESPONSIBLE_ID`.
    - Emitir sólo rutas relativas same-origin construidas con el ID del ticket y conservar la validación final en `TicketService`.
    - _Requisitos: 8.1–8.8, 8.11, 15.3._
    - Verificación: cada estado permitido produce los descriptores definidos por las reglas de dominio, la asignación no se representa como transición de estado y ningún descriptor contiene una URL absoluta.

  - [x] 1.2 Extender `HttpTicket` y todos sus mapeos de respuesta
    - Modificar `src/http/mappers.ts` para declarar `HttpAllowedTransition` y añadir `allowedTransitions` a `HttpTicket`.
    - Integrar el resultado del cálculo en `mapTicketToResponse`, de modo que las respuestas de lista, detalle, creación, asignación y cambio de estado incluyan el mismo campo sin duplicar lógica por ruta.
    - Mantener intactos los campos existentes, las fechas ISO UTC, los historiales, escalaciones y notificaciones.
    - _Requisitos: 8.1, 8.10, 11.3, 15.3, 15.4._
    - Verificación: todas las rutas que usan `mapTicketToResponse` devuelven `allowedTransitions` con forma consistente y los consumidores existentes siguen recibiendo los campos anteriores.

  - [x] 1.3 Escribir pruebas unitarias del contrato de descriptores
    - Cubrir asignación, cada transición de estado, `targetStatus`, `input`, método, ruta y ausencia de acciones no permitidas.
    - Cubrir que la función usa las reglas del dominio y que un descriptor inválido no es generado por el servidor.
    - Actualizar o crear pruebas bajo `src/application/` y `src/http/` sin modificar los archivos públicos del panel.
    - _Requisitos: 8.1–8.10, 15.3._
    - Verificación: `pnpm test --run` ejecuta las pruebas nuevas y detecta cualquier descriptor inesperado o ruta incorrecta.

- [x] 2. Servir el panel bajo `/panel/` desde el mismo origen
  - [x] 2.1 Montar los archivos estáticos con una raíz absoluta y segura
    - Crear el directorio `public/panel/` y preparar el montaje de `index.html`, `panel.css` y `panel.js` mediante `express.static` bajo `/panel`.
    - Resolver la ruta física respecto al módulo ejecutado, compatible con el código compilado en `dist/`, sin depender del working directory.
    - Montar el middleware antes del router de negocio y del fallback de rutas, sin añadir CORS, proxy, host, puerto ni origen separado.
    - Mantener el catálogo de rutas de negocio, `/`, `/health`, `/tickets` y los códigos `405`/`404` sin cambios funcionales.
    - _Requisitos: 1.1–1.3, 1.5, 15.1, 15.2._
    - Verificación: `GET /panel/`, `GET /panel/panel.css` y `GET /panel/panel.js` devuelven sus archivos y tipos correctos; una ruta de asset inexistente no permite salir de `public/panel`.

- [x] 3. Construir la estructura semántica del documento
  - [x] 3.1 Crear `public/panel/index.html`
    - Definir `header`, `main`, indicadores, selector de filtros, `aside` para «Nuevo ticket», lista principal y regiones de estado con nombres accesibles.
    - Incluir el título visible «TicketOps Panel de tickets», el campo de Actor_Id, los seis estados, «Todos» y «Solo vencidos».
    - Crear los campos etiquetados y obligatorios de título, descripción, categoría, prioridad y solicitante, con IDs estables, mensajes de validación y `aria-describedby`.
    - Añadir un `<dialog>` reutilizable para detalle, asignación y resolución, con botones de cancelar, formularios y encabezados accesibles.
    - Cargar únicamente `./panel.css` y `./panel.js`; no incluir handlers, estilos, datos, imports, scripts inline ni recursos externos.
    - _Requisitos: 1.4–1.6, 3.1, 5.1–5.3, 7.1, 13.1, 13.7, 15.1–15.2._
    - Verificación: el HTML contiene todos los controles y etiquetas requeridos, no contiene datos de tickets ni sinks HTML dinámicos y sólo referencia los dos assets relativos del panel.

- [x] 4. Crear el lenguaje visual responsive y accesible
  - [x] 4.1 Crear `public/panel/panel.css`
    - Implementar la cuadrícula de escritorio con indicadores arriba, formulario lateral y lista principal.
    - Definir superficies, tipografía de sistema, contraste AA, estados explícitos, foco visible de al menos 3 px y estilos para errores, carga, éxito y vencimientos sin depender sólo del color.
    - Usar `min-width: 0`, `overflow-wrap: anywhere` y distribución flexible para evitar desbordamientos por títulos, IDs o descripciones largas.
    - Añadir `@media (max-width: 375px)` para convertir filas en tarjetas apiladas y ordenar encabezado, indicadores, filtros, formulario y lista verticalmente sin scroll horizontal.
    - Añadir `@media (prefers-reduced-motion: reduce)` para retirar transiciones, animaciones y desplazamientos no esenciales.
    - _Requisitos: 1.5, 6.4–6.5, 13.3–13.4, 13.8–13.9, 14.1–14.5._
    - Verificación: una ventana de 375 px no genera `scrollWidth` mayor que `clientWidth`, el foco es visible y «VENCIDO», errores y estados siguen siendo distinguibles por texto.

- [x] 5. Implementar la base segura del cliente y el adaptador HTTP
  - [x] 5.1 Implementar catálogos, estado, validación y utilidades seguras en `public/panel/panel.js`
    - Definir catálogos de categorías, prioridades, estados y acciones con sus etiquetas en español.
    - Crear el estado de lectura y drafts descrito en el diseño, incluyendo selección de filtro, fases de consulta/mutación, diálogo, trigger de foco y mensaje accesible.
    - Implementar normalización con `trim()`, validación de campos obligatorios y límite de título de 120 caracteres.
    - Crear utilidades de renderizado con `createElement`, `textContent`, `createTextNode`, `value` y propiedades seguras; prohibir `innerHTML`, `outerHTML`, `document.write` y equivalentes.
    - Crear una superficie mínima y controlada para probar funciones puras sin exponer datos de usuario ni habilitar logging sensible en producción.
    - _Requisitos: 5.3–5.5, 6.7, 12.1–12.3, 13.1, 15.1._
    - Verificación: una entrada con HTML, entidades o `<script>` queda como texto literal; el archivo no contiene sinks inseguros ni registra Actor_Id, descripción o nota de resolución.

  - [x] 5.2 Implementar el adaptador HTTP same-origin y tokens de consulta
    - Centralizar todas las llamadas en `fetch` con rutas relativas, `Content-Type` sólo cuando haya body y payloads explícitos.
    - Implementar `GET /tickets`, `GET /tickets?status={status}`, `GET /tickets/overdue` y `GET /tickets/:id`, usando `X-Actor-Id` sólo donde el contrato lo exige.
    - Implementar timeout/cancelación con `AbortController`, parseo de la respuesta JSON, validación de status HTTP y conversión del envelope estándar a un error de interfaz seguro.
    - Añadir tokens monotónicos con filtro activo y abortar consultas obsoletas sin aplicar sus respuestas.
    - Mantener la colección anterior en error de red, mostrar carga durante la consulta y diferenciar «sin resultados» de «error de conexión».
    - _Requisitos: 3.2–3.5, 4.1–4.7, 7.2–7.8, 12.4, 15.3–15.5._
    - Verificación: una respuesta tardía no reemplaza la consulta activa; `Todos` no añade filtros, los estados codifican el valor API y «Solo vencidos» exige actor antes de enviar.

- [x] 6. Implementar actor y creación de tickets
  - [x] 6.1 Implementar Actor_Id con `sessionStorage` y el flujo «Nuevo ticket»
    - Leer una clave propia de `sessionStorage`, aceptar sólo strings cuyo `trim()` no sea vacío y guardar únicamente el valor normalizado.
    - Sincronizar el campo visible de Actor_Id con la sesión de la pestaña, volver a solicitarlo si falta y no usar `localStorage`, cookies, URL ni consola.
    - Validar localmente título, descripción, categoría, prioridad y solicitante; asociar cada error a su campo y conservar drafts cuando la API falle.
    - Construir `POST /tickets` con exactamente `title`, `description`, `category`, `priority` y `requester`, sin `responsibleId`, `responsible` ni `responsable`.
    - Tras `201`, anunciar éxito, limpiar el formulario sólo después de aceptar la respuesta y ejecutar la consulta vigente para actualizar lista e indicadores.
    - _Requisitos: 3.1–3.5, 5.1–5.9, 11.2–11.4, 12.4–12.5._
    - Verificación: un actor vacío bloquea sólo operaciones dependientes; una creación válida envía las cinco claves exactas y una creación inválida conserva los valores introducidos.

- [x] 7. Implementar consulta, lista, indicadores y detalle
  - [x] 7.1 Renderizar colección, filtros, vencimientos y detalle con datos remotos
    - Calcular «Abiertos», «Vencidos» y «Resueltos» sólo desde la colección aceptada y mostrar cero para una colección vacía.
    - Renderizar por ticket ID, título, categoría, prioridad, estado, vencimiento y sección de acciones, con etiquetas españolas.
    - Implementar el selector remoto de «Todos», seis estados y «Solo vencidos», conservando el filtro visible cuando la solicitud falla.
    - Formatear `dueAt` futuro como tiempo restante; cuando `overdue` sea true o la fecha pasada corresponda al ticket vigente, mostrar un texto que empiece por «hace» y la insignia textual «VENCIDO».
    - Abrir el detalle con descripción, solicitante, responsable, fechas y nota de resolución; representar cada ausencia como «No disponible» junto a su etiqueta.
    - _Requisitos: 2.1–2.6, 4.5–4.7, 6.1–6.7, 7.1–7.8, 13.7, 13.9._
    - Verificación: la lista se reemplaza sólo con la respuesta del filtro activo, los tres indicadores usan la colección vigente y ningún dato remoto se interpreta como HTML.

- [x] 8. Implementar acciones derivadas y diálogos operativos
  - [x] 8.1 Renderizar acciones exclusivamente desde `allowedTransitions`
    - Validar la forma de la colección y de cada descriptor antes de mostrar botones.
    - Mapear `ASSIGN`, `START`, `RESUME`, `WAIT`, `RESOLVE`, `CLOSE` y `REOPEN` a «Asignar», «Iniciar», «Reanudar», «Poner en espera», «Resolver», «Cerrar» y «Reabrir».
    - Usar `method`, `href`, `targetStatus` e `input` del descriptor como fuente de la operación; no inferir acciones desde estado, color, etiqueta o estado local.
    - Si falta `allowedTransitions` o no es válida, mantener el ticket visible, anunciar «No se pudieron cargar las acciones de este ticket.» y no crear botones.
    - Implementar el diálogo de detalle y conservar el elemento que abrió cada diálogo para restaurar el foco.
    - _Requisitos: 6.1, 8.1–8.10, 13.2, 13.5–13.6, 15.4._
    - Verificación: los botones visibles corresponden uno a uno con descriptores válidos; un descriptor ausente no produce ningún control ni solicitud de mutación.

  - [x] 8.2 Implementar asignación, cambios de estado y resolución
    - Para «Asignar», abrir un diálogo con «ID del responsable», validar `trim()` no vacío y enviar `PATCH /tickets/:id/assignment` con `{ responsibleId }` y `X-Actor-Id`.
    - Para «Iniciar», «Reanudar», «Poner en espera», «Cerrar» y «Reabrir», usar el `targetStatus` del descriptor y enviar sólo `{ status }` con actor.
    - Para «Resolver», abrir un diálogo con «Nota de resolución», validar que no quede vacía y enviar `{ status: "RESUELTO", resolutionNote }`.
    - Deshabilitar el formulario o acción durante la mutación, impedir doble envío, conservar drafts ante fallo y cerrar o mantener abierto el diálogo según el código de respuesta.
    - _Requisitos: 9.1–9.6, 10.1–10.8, 11.4, 12.4._
    - Verificación: asignación exitosa muestra el responsable, resolución exige nota, cancelar no hace requests y ningún formulario envía campos de otra operación.

- [x] 9. Implementar errores, reconciliación y retry limitado
  - [x] 9.1 Implementar `successful_query` y sincronización posterior a mutaciones
    - Mantener deshabilitadas las acciones del ticket después de un éxito de mutación hasta aplicar un `GET /tickets/:id` vigente y la consulta de lista activa.
    - Aplicar ambas respuestas sólo si sus tokens siguen siendo actuales; recalcular indicadores, ciclos de vencimiento, escalaciones, notificaciones y acciones desde la representación recibida.
    - Cerrar el diálogo y anunciar éxito sólo después de la reconciliación completa.
    - Ante `INVALID_TRANSITION`, reconsultar el ticket, retirar acciones obsoletas y no anunciar la mutación como exitosa.
    - Ante `TICKET_NOT_FOUND`, cerrar el diálogo, anunciar que el ticket ya no existe y actualizar la lista.
    - _Requisitos: 10.5–10.8, 11.1, 11.3, 15.4._
    - Verificación: ninguna mutación exitosa reactiva botones antes de `successful_query`; una consulta posterior fallida deja las acciones bloqueadas y visible el error.

  - [x] 9.2 Implementar mapa de errores, estados anunciables y retry de mutaciones
    - Traducir `INVALID_REQUEST`, `ACTOR_REQUIRED`, `ACTOR_UNKNOWN`, `AGENT_UNAVAILABLE`, `INVALID_TRANSITION`, `SUPERVISOR_REQUIRED`, `TICKET_NOT_FOUND` e `INTERNAL_ERROR` a mensajes españoles claros.
    - Asociar `error.details` con campos conocidos y mostrar detalles no asociables como mensaje general, sin exponer trazas ni texto sensible en consola.
    - En errores de red o timeout de una mutación, conservar método, ruta, actor y body; hacer exactamente un retry automático con la misma copia y ofrecer un retry manual si vuelve a fallar.
    - No reintentar automáticamente respuestas HTTP recibidas; impedir clicks duplicados y mantener el draft de la operación pendiente.
    - Añadir una región `aria-live` para carga, éxito, error, contrato y retry, sin mover el foco inesperadamente.
    - _Requisitos: 3.4, 4.4, 4.7, 5.9, 7.7–7.8, 9.5, 10.6, 11.1–11.7, 13.7, 15.5._
    - Verificación: una mutación de red produce como máximo dos envíos automáticos con payload idéntico; un segundo fallo ofrece reintento manual y conserva los datos.

- [x] 10. Completar accesibilidad y comportamiento responsive
  - [x] 10.1 Integrar teclado, foco modal y estados ARIA
    - Asegurar nombres accesibles y labels visibles para todos los controles, incluyendo filtros, tarjetas, acciones, retry y botones de cancelar.
    - Implementar foco inicial en cada diálogo, ciclo Tab/Shift+Tab, cierre con Escape y devolución del foco al control disparador.
    - Añadir `aria-invalid`, `aria-describedby` y anuncios de validación para errores de campos, sin usar sólo color.
    - Verificar que mensajes de carga, error, éxito y contrato tienen región nombrada y `aria-live` apropiado.
    - _Requisitos: 13.1–13.7, 13.10, 14.5._
    - Verificación: todo flujo funcional se puede operar con teclado; el foco no escapa de un diálogo modal y vuelve al disparador al cerrar.

  - [-] 10.2 Ajustar layout móvil, contraste y movimiento reducido
    - Revisar `panel.css` con contenido largo, IDs extensos, mensajes de error y acciones múltiples.
    - Confirmar tarjetas apiladas a 375 px o menos, título/estado/vencimiento/acciones visibles y ausencia de recorte horizontal.
    - Confirmar contraste AA de texto, controles, foco e información; mantener señales textuales para vencimiento, éxito y error.
    - Confirmar que `prefers-reduced-motion: reduce` elimina transiciones y desplazamientos no esenciales.
    - _Requisitos: 6.4–6.5, 13.3–13.4, 13.8–13.9, 14.1–14.5._
    - Verificación: el viewport de 375 px permite leer y activar todos los controles sin scroll horizontal y conserva nombres/foco accesibles.

- [x] 11. Añadir pruebas property-based para las propiedades de corrección
  - [x] 11.1 Probar Property 1: indicadores correctos para cualquier colección
    - Crear una prueba fast-check con al menos 100 casos para estados, `overdue` y colección vacía.
    - **Property 1: Indicadores correctos para cualquier colección.**
    - **Valida: Requisitos 2.2, 2.3, 2.4 y 2.6.**
    - Verificación: cada contador coincide con un oráculo independiente y la colección vacía produce tres ceros.

  - [x] 11.2 Probar Property 2: body de creación exacto
    - Generar formularios válidos y comprobar conjunto exacto de claves, textos normalizados y ausencia de responsables.
    - **Property 2: Body de creación exacto.**
    - **Valida: Requisitos 5.4, 5.6, 5.7, 12.4 y 15.3.**
    - Verificación: ningún caso generado añade o elimina una clave del body esperado.

  - [x] 11.3 Probar Property 3: validación de textos y límites
    - Generar strings vacíos, whitespace, títulos de longitud 1, 120 y mayor de 120.
    - **Property 3: Validación de textos y límites.**
    - **Valida: Requisitos 3.3, 5.4, 5.5, 9.2 y 10.3.**
    - Verificación: sólo los valores no vacíos y de título hasta 120 pasan la validación.

  - [x] 11.4 Probar Property 4: construcción de consultas y actor
    - Generar estados válidos y filtros; comprobar URLs exactas, ausencia de filtros en `Todos` y header normalizado en vencidos.
    - **Property 4: Construcción de consultas y actor.**
    - **Valida: Requisitos 3.2, 7.2, 7.3, 7.4 y 12.4.**
    - Verificación: un actor ausente bloquea vencidos antes de llamar a fetch y cada estado usa su valor API.

  - [x] 11.5 Probar Property 5: acciones derivadas de descriptors
    - Generar colecciones válidas de `allowedTransitions` y comprobar correspondencia exacta de botones y etiquetas.
    - **Property 5: Acciones exactamente derivadas de descriptors.**
    - **Valida: Requisitos 8.1–8.9.**
    - Verificación: retirar un descriptor retira su acción y ningún estado local crea controles adicionales.

  - [x] 11.6 Probar Property 6: requests compatibles con el input del descriptor
    - Generar descriptores de asignación y estado; comprobar método, `href`, actor y body mínimo según `input`.
    - **Property 6: Requests compatibles con el input del descriptor.**
    - **Valida: Requisitos 8.11, 9.3, 10.1, 10.4, 12.4 y 15.3.**
    - Verificación: cada request usa sólo las claves permitidas por su descriptor y una ruta relativa.

  - [x] 11.7 Probar Property 7: presentación temporal con señal textual
    - Generar instantes actuales, fechas futuras/pasadas y flags `overdue`; comprobar «en», «hace» y «VENCIDO» como texto.
    - **Property 7: Presentación temporal con señal textual.**
    - **Valida: Requisitos 6.3–6.5 y 13.9.**
    - Verificación: la señal de vencimiento no depende de clase CSS, color ni pseudo-elemento.

  - [x] 11.8 Probar Property 8: fallback explícito del detalle
    - Generar combinaciones de valores opcionales presentes, `null` y ausentes.
    - **Property 8: Fallback explícito del detalle.**
    - **Valida: Requisito 6.6.**
    - Verificación: cada valor existente aparece literalmente y cada ausencia muestra «No disponible» con etiqueta.

  - [x] 11.9 Probar Property 9: renderizado literal seguro
    - Generar strings con etiquetas, atributos, entidades y secuencias de script; inspeccionar el árbol resultante.
    - **Property 9: Renderizado literal seguro.**
    - **Valida: Requisitos 6.7, 12.1 y 12.2.**
    - Verificación: no se crean nodos derivados del string ni se ejecuta código; la prueba también falla si aparece un sink prohibido.

  - [x] 11.10 Probar Property 10: details y conservación del draft
    - Generar errores `INVALID_REQUEST` con paths conocidos y desconocidos; comprobar asociación y conservación de valores válidos.
    - **Property 10: Details de validación y conservación del draft.**
    - **Valida: Requisitos 5.9 y 11.2.**
    - Verificación: cada path conocido llega a su campo, los demás a mensaje general y ningún draft válido se borra.

  - [x] 11.11 Probar Property 11: retry limitado y reproducible
    - Simular fallos de red y timeout, observar máximo dos envíos automáticos, payload inmutable y retry manual.
    - **Property 11: Retry de mutación acotado y reproducible.**
    - **Valida: Requisitos 11.5 y 11.6.**
    - Verificación: nunca hay un tercer envío automático y el segundo intento coincide byte a byte en método, ruta, actor y body.

  - [x] 11.12 Probar Property 12: sólo la consulta activa reemplaza el estado
    - Generar secuencias de filtros y órdenes de resolución; comprobar que sólo el token activo modifica tickets, fase, indicadores y mensajes.
    - **Property 12: Sólo la consulta activa reemplaza el estado.**
    - **Valida: Requisitos 4.5, 4.6, 7.5 y 15.4.**
    - Verificación: ninguna respuesta obsoleta cambia contenido visible ni el filtro seleccionado.

  - [x] 11.13 Probar Property 13: `successful_query` precede la reactivación
    - Simular mutaciones exitosas con consultas posteriores exitosas, obsoletas o fallidas.
    - **Property 13: `successful_query` precede la reactivación.**
    - **Valida: Requisitos 10.5, 11.3 y 15.4.**
    - Verificación: las acciones permanecen bloqueadas hasta aplicar una representación vigente y desaparecen las acciones obsoletas.

- [x] 12. Completar pruebas unitarias e integración HTTP
  - [x] 12.1 Actualizar pruebas HTTP del contrato y del montaje estático
    - Verificar con Supertest `GET /panel/`, los tipos de contenido, los tres assets, path traversal y coexistencia con `/`, `/health` y `/tickets`.
    - Verificar que `GET /tickets`, `GET /tickets/:id`, `POST /tickets` y ambos `PATCH` incluyen `allowedTransitions` con forma exacta.
    - Verificar los descriptores por estado, `ASSIGN` en `/assignment`, actor, overdue, códigos HTTP y errores estándar existentes.
    - _Requisitos: 1.1–1.3, 4.1–4.4, 8.1–8.11, 9.3–9.5, 10.1–10.6, 15.1–15.5._
    - Verificación: `pnpm test --run` pasa sin regresiones y una respuesta sin `allowedTransitions` sólo puede proceder de un fixture defectuoso, no del mapper normal.

  - [x] 12.2 Añadir pruebas de regresión de errores y contrato de API
    - Cubrir `ACTOR_REQUIRED`, `ACTOR_UNKNOWN`, `SUPERVISOR_REQUIRED`, `AGENT_UNAVAILABLE`, `INVALID_TRANSITION`, `TICKET_NOT_FOUND` e `INVALID_REQUEST` con detalles de campos.
    - Comprobar que una transición inválida no cambia el ticket y que el mapper conserva escalaciones, ciclos y notificaciones.
    - _Requisitos: 3.4, 5.9, 7.7–7.8, 9.5, 10.6, 11.1–11.2._
    - Verificación: las respuestas mantienen códigos y envelopes existentes y las pruebas detectan pérdida de estado o detalles útiles.

- [x] 13. Añadir pruebas de navegador y auditorías del panel
  - [x] 13.1 Configurar un runner de navegador sólo para desarrollo
    - Reutilizar Vitest, fast-check y Supertest donde sea suficiente; incorporar un runner de navegador compatible sólo si es necesario para DOM, foco, viewport y red.
    - Mantener cualquier dependencia de navegador fuera de `dependencies`, del build del servidor y de los tres archivos públicos.
    - Definir fixture same-origin controlado y comandos de ejecución de una sola pasada, sin modo watch.
    - _Requisitos: 1.2–1.3, 12.4, 13.1–13.10, 14.1–14.5, 15.2, 15.5._
    - Verificación: el build de producción no incorpora el runner ni recursos externos y la suite puede iniciar la aplicación de prueba sin servidor distinto de TicketOps.

  - [x] 13.2 Cubrir flujos funcionales, errores y sincronización en navegador
    - Probar carga inicial, colección vacía, filtros, retry de consulta, creación, actor en `sessionStorage`, asignación, resolución, transición inválida, ticket inexistente y `Solo vencidos` con 403.
    - Interceptar requests y verificar rutas, headers y bodies exactos, incluida la ausencia de responsables en creación.
    - Probar `allowedTransitions`, detalle, tiempos, vencimiento textual, errores de contrato, successful_query y eliminación de acciones obsoletas.
    - _Requisitos: 2.1–2.6, 3.1–3.5, 4.1–4.7, 5.1–5.9, 6.1–6.7, 7.1–7.8, 8.1–8.11, 9.1–9.6, 10.1–10.8, 11.1–11.7._
    - Verificación: cada flujo esperado termina en el estado visible correcto y las operaciones duplicadas no generan requests adicionales.

  - [x] 13.3 Auditar seguridad, accesibilidad y responsive en navegador
    - Probar payloads con `<script>`, atributos, entidades y markup sin ejecución ni creación de elementos.
    - Probar teclado completo, foco visible, labels, `aria-live`, `aria-invalid`, `aria-describedby`, ciclo modal, Escape, restauración de foco y reduced motion.
    - Probar contraste AA, `VENCIDO` textual, viewport de 375 px, tarjetas apiladas, texto largo y ausencia de scroll horizontal.
    - Auditar que no hay imports, fuentes, imágenes, scripts, estilos ni requests a dominios externos y que no se registran datos sensibles.
    - _Requisitos: 12.1–12.5, 13.1–13.10, 14.1–14.5, 15.2, 15.5._
    - Verificación: la auditoría no encuentra sinks XSS, solicitudes externas, fallos de foco ni desbordamiento horizontal en 375 px.

- [x] 14. Punto de control final: integrar y verificar el alcance completo
  - Ejecutar `pnpm build`, `pnpm lint` y `pnpm test --run`.
  - Confirmar que los únicos archivos públicos del panel son `public/panel/index.html`, `public/panel/panel.css` y `public/panel/panel.js`.
  - Confirmar que el servidor calcula `allowedTransitions`, que el cliente no contiene reglas de dominio duplicadas y que las acciones sólo se reactivan tras `successful_query`.
  - Confirmar cobertura trazable de los Requisitos 1–15 y de las Properties 1–13 mediante las pruebas unitarias, property-based, HTTP y navegador disponibles.
  - Criterio de verificación: todas las comprobaciones pasan o queda documentado como bloqueo un requisito de entorno de pruebas, sin modificar el alcance ni introducir dependencias de producción.

## Notes

- Las tareas sin `*` son requeridas para completar la implementación. Las tareas marcadas con `*` son pruebas o infraestructura de pruebas opcionales para un MVP, pero deben ejecutarse para afirmar cobertura completa del diseño.
- Cada Property 1–13 tiene una tarea separada y referencia explícita a sus requisitos.
- Las tareas de `public/panel/panel.js` están ordenadas para que cada paso integre el anterior; no se deben implementar tareas posteriores dejando handlers o componentes huérfanos.
- El cliente no debe duplicar `NORMAL_TRANSITIONS`, `REOPEN_TRANSITIONS` ni ninguna regla de autorización. `allowedTransitions` es una vista de disponibilidad; la API conserva la autorización final.
- Las acciones de mutación no deben habilitarse de nuevo hasta aplicar una `successful_query` vigente.
- Ningún test runner, dependencia de pruebas, fuente, icono, imagen, script o stylesheet externo puede llegar al bundle público o a las dependencias de producción.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "3.1"] },
    { "id": 1, "tasks": ["1.2", "4.1", "5.1"] },
    { "id": 2, "tasks": ["1.3", "5.2"] },
    { "id": 3, "tasks": ["6.1"] },
    { "id": 4, "tasks": ["7.1"] },
    { "id": 5, "tasks": ["8.1"] },
    { "id": 6, "tasks": ["8.2"] },
    { "id": 7, "tasks": ["9.1"] },
    { "id": 8, "tasks": ["9.2"] },
    { "id": 9, "tasks": ["10.1", "10.2"] },
    { "id": 10, "tasks": ["11.1"] },
    { "id": 11, "tasks": ["11.2"] },
    { "id": 12, "tasks": ["11.3"] },
    { "id": 13, "tasks": ["11.4"] },
    { "id": 14, "tasks": ["11.5"] },
    { "id": 15, "tasks": ["11.6"] },
    { "id": 16, "tasks": ["11.7"] },
    { "id": 17, "tasks": ["11.8"] },
    { "id": 18, "tasks": ["11.9"] },
    { "id": 19, "tasks": ["11.10"] },
    { "id": 20, "tasks": ["11.11"] },
    { "id": 21, "tasks": ["11.12"] },
    { "id": 22, "tasks": ["11.13"] },
    { "id": 23, "tasks": ["12.1"] },
    { "id": 24, "tasks": ["12.2", "13.1"] },
    { "id": 25, "tasks": ["13.2"] },
    { "id": 26, "tasks": ["13.3"] },
    { "id": 27, "tasks": ["14"] }
  ]
}
```
