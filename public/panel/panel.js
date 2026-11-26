"use strict";

(function createTicketOpsPanel(globalObject) {
  const CATEGORY_CATALOG = Object.freeze([
    Object.freeze({ value: "INFRAESTRUCTURA", label: "Infraestructura" }),
    Object.freeze({ value: "ACCESOS", label: "Accesos" }),
    Object.freeze({ value: "APLICACIONES", label: "Aplicaciones" }),
    Object.freeze({ value: "INSTALACIONES", label: "Instalaciones" })
  ]);

  const PRIORITY_CATALOG = Object.freeze([
    Object.freeze({ value: "CRITICA", label: "Crítica" }),
    Object.freeze({ value: "ALTA", label: "Alta" }),
    Object.freeze({ value: "MEDIA", label: "Media" }),
    Object.freeze({ value: "BAJA", label: "Baja" })
  ]);

  const STATUS_CATALOG = Object.freeze([
    Object.freeze({ value: "NUEVO", label: "Nuevo" }),
    Object.freeze({ value: "ASIGNADO", label: "Asignado" }),
    Object.freeze({ value: "EN_PROGRESO", label: "En progreso" }),
    Object.freeze({ value: "EN_ESPERA", label: "En espera" }),
    Object.freeze({ value: "RESUELTO", label: "Resuelto" }),
    Object.freeze({ value: "CERRADO", label: "Cerrado" })
  ]);

  const ACTION_CATALOG = Object.freeze([
    Object.freeze({ value: "ASSIGN", label: "Asignar" }),
    Object.freeze({ value: "START", label: "Iniciar" }),
    Object.freeze({ value: "RESUME", label: "Reanudar" }),
    Object.freeze({ value: "WAIT", label: "Poner en espera" }),
    Object.freeze({ value: "RESOLVE", label: "Resolver" }),
    Object.freeze({ value: "CLOSE", label: "Cerrar" }),
    Object.freeze({ value: "REOPEN", label: "Reabrir" })
  ]);

  const FILTER_CATALOG = Object.freeze([
    Object.freeze({ value: "ALL", label: "Todos", kind: "ALL" }),
    Object.freeze({ value: "OVERDUE", label: "Solo vencidos", kind: "OVERDUE" }),
    ...STATUS_CATALOG.map((status) =>
      Object.freeze({ value: status.value, label: status.label, kind: "STATUS" })
    )
  ]);

  const QUERY_PHASES = Object.freeze(["idle", "loading", "success", "empty", "error"]);
  const MUTATION_PHASES = Object.freeze(["idle", "loading", "reconciling", "retry-pending", "error"]);
  const DIALOG_KINDS = Object.freeze(["detail", "assignment", "resolution"]);
  const CREATE_FIELDS = Object.freeze([
    "title",
    "description",
    "category",
    "priority",
    "requester"
  ]);
  const DIALOG_FIELDS = Object.freeze(["responsibleId", "resolutionNote"]);
  const ACTOR_STORAGE_KEY = "ticketops.actorId";
  const DEFAULT_QUERY_TIMEOUT_MS = 10000;
  const QUERY_ERROR_MESSAGES = Object.freeze({
    ACTOR_REQUIRED: "El identificador del actor es obligatorio.",
    ACTOR_UNKNOWN: "El identificador del actor no es válido.",
    SUPERVISOR_REQUIRED: "Este actor no tiene permisos de supervisor.",
    TICKET_NOT_FOUND: "El ticket ya no existe.",
    AGENT_UNAVAILABLE: "El agente no existe o no está activo.",
    INVALID_TRANSITION: "El ticket cambió y la acción ya no es válida.",
    INVALID_REQUEST: "Revisa los datos introducidos.",
    ROUTE_NOT_FOUND: "La consulta solicitada no existe.",
    METHOD_NOT_ALLOWED: "La consulta no está permitida.",
    INTERNAL_ERROR: "Ocurrió un error del servidor.",
    INVALID_JSON: "La respuesta del servidor no tiene un formato válido.",
    CONTRACT_ERROR: "La respuesta del servidor no cumple el contrato esperado.",
    TIMEOUT: "La consulta tardó demasiado.",
    NETWORK_ERROR: "No se pudo conectar con TicketOps.",
    REQUEST_ABORTED: "La consulta fue cancelada."
  });

  const CATEGORY_LABELS = createLabelMap(CATEGORY_CATALOG);
  const PRIORITY_LABELS = createLabelMap(PRIORITY_CATALOG);
  const STATUS_LABELS = createLabelMap(STATUS_CATALOG);
  const ACTION_LABELS = createLabelMap(ACTION_CATALOG);

  function createLabelMap(catalog) {
    return Object.freeze(
      catalog.reduce((labels, item) => {
        labels[item.value] = item.label;
        return labels;
      }, {})
    );
  }

  function isCatalogValue(catalog, value) {
    return catalog.some((item) => item.value === value);
  }

  function toSafeString(value) {
    return value === null || value === undefined ? "" : String(value);
  }

  function normalizeText(value) {
    return toSafeString(value).trim();
  }

  function getSessionStorage(storageObject) {
    if (storageObject !== undefined) {
      return storageObject;
    }
    try {
      return globalObject.sessionStorage || null;
    } catch (_error) {
      return null;
    }
  }

  function readStoredActorId(storageObject) {
    const storage = getSessionStorage(storageObject);
    if (!storage || typeof storage.getItem !== "function") {
      return "";
    }

    try {
      const storedValue = storage.getItem(ACTOR_STORAGE_KEY);
      const normalized = typeof storedValue === "string" ? normalizeText(storedValue) : "";
      if (!normalized && typeof storage.removeItem === "function") {
        storage.removeItem(ACTOR_STORAGE_KEY);
      } else if (normalized && normalized !== storedValue &&
        typeof storage.setItem === "function") {
        storage.setItem(ACTOR_STORAGE_KEY, normalized);
      }
      return normalized;
    } catch (_error) {
      return "";
    }
  }

  function persistActorId(value, storageObject) {
    const normalized = normalizeText(value);
    const storage = getSessionStorage(storageObject);
    if (!storage) {
      return normalized;
    }

    try {
      if (normalized && typeof storage.setItem === "function") {
        storage.setItem(ACTOR_STORAGE_KEY, normalized);
      } else if (!normalized && typeof storage.removeItem === "function") {
        storage.removeItem(ACTOR_STORAGE_KEY);
      }
    } catch (_error) {
      // La sesión puede no permitir almacenamiento; el valor sigue disponible en memoria.
    }
    return normalized;
  }

  function synchronizeActorId(state, control, storageObject) {
    const normalized = persistActorId(control ? control.value : state.actorId, storageObject);
    state.actorId = normalized;
    if (control && control.value !== normalized) {
      setSafeValue(control, normalized);
    }
    return normalized;
  }

  function createEmptyCreateDraft() {
    return {
      title: "",
      description: "",
      category: "",
      priority: "",
      requester: ""
    };
  }

  function createEmptyDialogDraft() {
    return {
      responsibleId: "",
      resolutionNote: ""
    };
  }

  function createInitialState() {
    return {
      actorId: "",
      tickets: [],
      selectedFilter: { kind: "ALL" },
      query: {
        phase: "idle",
        active: null,
        error: null,
        sequence: 0
      },
      mutation: null,
      dialog: null,
      lastDialogTrigger: null,
      createDraft: createEmptyCreateDraft(),
      dialogDraft: createEmptyDialogDraft(),
      message: null
    };
  }

  function createFilterSelection(value) {
    if (value === "OVERDUE") {
      return { kind: "OVERDUE" };
    }

    if (isCatalogValue(STATUS_CATALOG, value)) {
      return { kind: "STATUS", value };
    }

    return { kind: "ALL" };
  }

  function normalizeFilterSelection(filter) {
    if (!filter || typeof filter !== "object") {
      return { kind: "ALL" };
    }

    if (filter.kind === "OVERDUE") {
      return { kind: "OVERDUE" };
    }

    if (filter.kind === "STATUS" && isCatalogValue(STATUS_CATALOG, filter.value)) {
      return { kind: "STATUS", value: filter.value };
    }

    return { kind: "ALL" };
  }

  function filterKey(filter) {
    const selection = normalizeFilterSelection(filter);
    return selection.kind === "STATUS"
      ? `STATUS:${selection.value}`
      : selection.kind;
  }

  function getCatalogLabel(catalog, value) {
    const item = catalog.find((entry) => entry.value === value);
    return item ? item.label : toSafeString(value);
  }

  function createValidationError(fieldErrors, field, message) {
    fieldErrors[field] = message;
  }

  function validateCreateDraft(draft) {
    const source = draft && typeof draft === "object" ? draft : {};
    const normalized = CREATE_FIELDS.reduce((values, field) => {
      values[field] = normalizeText(source[field]);
      return values;
    }, {});
    const fieldErrors = {};

    if (!normalized.title) {
      createValidationError(fieldErrors, "title", "El título es obligatorio.");
    } else if (normalized.title.length > 120) {
      createValidationError(fieldErrors, "title", "El título no puede superar los 120 caracteres.");
    }

    if (!normalized.description) {
      createValidationError(fieldErrors, "description", "La descripción es obligatoria.");
    }

    if (!normalized.category) {
      createValidationError(fieldErrors, "category", "La categoría es obligatoria.");
    } else if (!isCatalogValue(CATEGORY_CATALOG, normalized.category)) {
      createValidationError(fieldErrors, "category", "Selecciona una categoría válida.");
    }

    if (!normalized.priority) {
      createValidationError(fieldErrors, "priority", "La prioridad es obligatoria.");
    } else if (!isCatalogValue(PRIORITY_CATALOG, normalized.priority)) {
      createValidationError(fieldErrors, "priority", "Selecciona una prioridad válida.");
    }

    if (!normalized.requester) {
      createValidationError(fieldErrors, "requester", "El solicitante es obligatorio.");
    }

    return {
      valid: Object.keys(fieldErrors).length === 0,
      normalized,
      fieldErrors
    };
  }

  function buildCreateTicketBody(draft) {
    return validateCreateDraft(draft).normalized;
  }

  function createValidationApiError(validation) {
    return new PanelApiError({
      code: "INVALID_REQUEST",
      message: QUERY_ERROR_MESSAGES.INVALID_REQUEST,
      details: Object.keys(validation.fieldErrors).map((field) => ({
        path: [field],
        message: validation.fieldErrors[field]
      })),
      kind: "validation"
    });
  }

  function validateRequiredText(value, message) {
    const normalized = normalizeText(value);
    return {
      valid: normalized.length > 0,
      value: normalized,
      error: normalized ? "" : message
    };
  }

  function createSafeTextNode(ownerDocument, value) {
    if (!ownerDocument || typeof ownerDocument.createTextNode !== "function") {
      throw new TypeError("Se necesita un documento para crear texto seguro.");
    }
    return ownerDocument.createTextNode(toSafeString(value));
  }

  function createSafeElement(ownerDocument, tagName, text) {
    if (!ownerDocument || typeof ownerDocument.createElement !== "function") {
      throw new TypeError("Se necesita un documento para crear un elemento seguro.");
    }
    const element = ownerDocument.createElement(tagName);
    if (text !== undefined && text !== null) {
      element.appendChild(createSafeTextNode(ownerDocument, text));
    }
    return element;
  }

  function setSafeText(node, value) {
    if (!node || !("textContent" in node)) {
      throw new TypeError("El destino no admite texto seguro.");
    }
    node.textContent = toSafeString(value);
    return node;
  }

  function setSafeValue(control, value) {
    if (!control || !("value" in control)) {
      throw new TypeError("El control no admite un valor seguro.");
    }
    control.value = toSafeString(value);
    return control;
  }

  function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function safeErrorText(value, fallback) {
    const text = normalizeText(value);
    return text.length > 0 && text.length <= 500 ? text : fallback;
  }

  function normalizeErrorDetails(details) {
    if (!Array.isArray(details)) {
      return [];
    }

    return details.slice(0, 50).map((detail) => {
      const item = isRecord(detail) ? detail : {};
      const path = Array.isArray(item.path)
        ? item.path.slice(0, 20).map((part) =>
            typeof part === "number" || typeof part === "string" ? String(part) : ""
          )
        : [];
      return Object.freeze({
        path: Object.freeze(path),
        message: safeErrorText(item.message, ""),
        code: safeErrorText(item.code, "")
      });
    });
  }

  function errorMessageForCode(code, fallback) {
    return QUERY_ERROR_MESSAGES[code] || safeErrorText(fallback, "No se pudo completar la consulta.");
  }

  class PanelApiError extends Error {
    constructor({
      code = "NETWORK_ERROR",
      status = 0,
      message = "",
      details = [],
      retryable = false,
      kind = "http"
    } = {}) {
      super(errorMessageForCode(code, message));
      this.name = "PanelApiError";
      this.code = code;
      this.status = Number.isFinite(status) ? status : 0;
      this.details = normalizeErrorDetails(details);
      this.retryable = retryable;
      this.kind = kind;
    }
  }

  function createApiErrorFromBody(body, status) {
    const source = isRecord(body) && isRecord(body.error) ? body.error : {};
    const code = normalizeText(source.code) || "HTTP_ERROR";
    return new PanelApiError({
      code,
      status,
      message: source.message,
      details: source.details,
      retryable: false,
      kind: "http"
    });
  }

  function createContractError() {
    return new PanelApiError({
      code: "CONTRACT_ERROR",
      status: 200,
      message: QUERY_ERROR_MESSAGES.CONTRACT_ERROR,
      retryable: false,
      kind: "contract"
    });
  }

  function isAbortError(error) {
    return Boolean(error && (error.name === "AbortError" || error.code === "ABORT_ERR"));
  }

  function createTransportError(error, timedOut) {
    if (timedOut) {
      return new PanelApiError({
        code: "TIMEOUT",
        message: QUERY_ERROR_MESSAGES.TIMEOUT,
        retryable: true,
        kind: "timeout"
      });
    }

    if (isAbortError(error)) {
      return new PanelApiError({
        code: "REQUEST_ABORTED",
        message: QUERY_ERROR_MESSAGES.REQUEST_ABORTED,
        retryable: false,
        kind: "aborted"
      });
    }

    return new PanelApiError({
      code: "NETWORK_ERROR",
      message: QUERY_ERROR_MESSAGES.NETWORK_ERROR,
      retryable: true,
      kind: "network"
    });
  }

  function isSuccessfulResponse(response) {
    if (!response || typeof response !== "object") {
      return false;
    }
    if (typeof response.ok === "boolean") {
      return response.ok;
    }
    return Number.isInteger(response.status) && response.status >= 200 && response.status < 300;
  }

  async function readJsonBody(response) {
    if (!response || typeof response !== "object") {
      throw createContractError();
    }

    try {
      if (typeof response.json === "function") {
        return await response.json();
      }
      if (typeof response.text === "function") {
        const text = await response.text();
        return text ? JSON.parse(text) : undefined;
      }
    } catch (_error) {
      throw new PanelApiError({
        code: "INVALID_JSON",
        status: Number.isInteger(response.status) ? response.status : 0,
        message: QUERY_ERROR_MESSAGES.INVALID_JSON,
        retryable: false,
        kind: "parse"
      });
    }

    throw createContractError();
  }

  function isValidTicketEnvelope(ticket) {
    return isRecord(ticket) && typeof ticket.id === "string" && ticket.id.trim().length > 0;
  }

  function validateTicketCollection(body) {
    if (!Array.isArray(body) || !body.every(isValidTicketEnvelope)) {
      throw createContractError();
    }
    return body;
  }

  function validateTicketDetail(body) {
    if (!isValidTicketEnvelope(body)) {
      throw createContractError();
    }
    return body;
  }

  async function parseHttpResponse(response, expectedEnvelope, expectedStatus) {
    const status = Number.isInteger(response && response.status) ? response.status : 0;
    const body = await readJsonBody(response);

    if (!isSuccessfulResponse(response)) {
      throw createApiErrorFromBody(body, status);
    }

    if (expectedStatus !== undefined && status !== expectedStatus) {
      throw new PanelApiError({
        code: "UNEXPECTED_STATUS",
        status,
        message: "La respuesta de la API no es válida.",
        retryable: false,
        kind: "contract"
      });
    }

    if (expectedEnvelope === "tickets") {
      return validateTicketCollection(body);
    }
    if (expectedEnvelope === "ticket") {
      return validateTicketDetail(body);
    }
    return body;
  }

  function assertRelativePath(path) {
    const value = toSafeString(path);
    if (!value.startsWith("/") || value.startsWith("//") || /^[a-z][a-z\d+.-]*:/i.test(value)) {
      throw new PanelApiError({
        code: "CONTRACT_ERROR",
        message: "La ruta de la API no es válida.",
        kind: "contract"
      });
    }
    return value;
  }

  function freezeMutationBody(body) {
    if (!isRecord(body)) {
      return body;
    }
    return Object.freeze({ ...body });
  }

  function snapshotMutationRequest(request, operation = "ticket") {
    if (!request || typeof request !== "object") {
      throw new PanelApiError({
        code: "CONTRACT_ERROR",
        message: "La solicitud de mutación no es válida.",
        kind: "contract"
      });
    }
    return Object.freeze({
      operation,
      method: request.method,
      href: assertRelativePath(request.href),
      actorId: normalizeText(request.actorId),
      headers: Object.freeze({ ...(request.headers || {}) }),
      body: freezeMutationBody(request.body),
      descriptor: request.descriptor || null
    });
  }

  function buildCreateMutationRequest(payload) {
    const body = buildCreateTicketBody(payload);
    return snapshotMutationRequest({
      method: "POST",
      href: "/tickets",
      actorId: "",
      headers: { Accept: "application/json" },
      body
    }, "create");
  }

  function buildMutationRequest(descriptor, actorId, draft = {}) {
    if (!isValidAllowedTransitionDescriptor(descriptor)) {
      throw new PanelApiError({
        code: "CONTRACT_ERROR",
        message: ACTION_CONTRACT_ERROR_MESSAGE,
        kind: "contract"
      });
    }

    const normalizedActorId = normalizeText(actorId);
    if (!normalizedActorId) {
      throw new PanelApiError({
        code: "ACTOR_REQUIRED",
        message: QUERY_ERROR_MESSAGES.ACTOR_REQUIRED,
        kind: "validation"
      });
    }

    const input = descriptor.input;
    let body;
    if (input === "RESPONSIBLE_ID") {
      const responsible = validateRequiredText(
        draft.responsibleId,
        "El ID del responsable es obligatorio."
      );
      if (!responsible.valid) {
        throw new PanelApiError({
          code: "INVALID_REQUEST",
          message: QUERY_ERROR_MESSAGES.INVALID_REQUEST,
          details: [{ path: ["responsibleId"], message: responsible.error }],
          kind: "validation"
        });
      }
      body = { responsibleId: responsible.value };
    } else if (input === "RESOLUTION_NOTE") {
      const note = validateRequiredText(
        draft.resolutionNote,
        "La nota de resolución es obligatoria."
      );
      if (!note.valid) {
        throw new PanelApiError({
          code: "INVALID_REQUEST",
          message: QUERY_ERROR_MESSAGES.INVALID_REQUEST,
          details: [{ path: ["resolutionNote"], message: note.error }],
          kind: "validation"
        });
      }
      body = { status: "RESUELTO", resolutionNote: note.value };
    } else {
      body = { status: descriptor.targetStatus };
    }

    return snapshotMutationRequest({
      method: descriptor.method,
      href: descriptor.href,
      headers: {
        Accept: "application/json",
        "X-Actor-Id": normalizedActorId
      },
      body,
      actorId: normalizedActorId,
      descriptor
    }, "ticket");
  }

  function getAbortControllerConstructor(options) {
    const constructor = options && options.AbortControllerImpl
      ? options.AbortControllerImpl
      : globalObject.AbortController;
    if (typeof constructor !== "function") {
      throw new PanelApiError({
        code: "CONTRACT_ERROR",
        message: "El navegador no admite cancelación de consultas.",
        kind: "configuration"
      });
    }
    return constructor;
  }

  function createHttpAdapter(options = {}) {
    const fetchImpl = options.fetchImpl || globalObject.fetch;
    const timeoutMs = Number.isFinite(options.timeoutMs)
      ? Math.max(0, options.timeoutMs)
      : DEFAULT_QUERY_TIMEOUT_MS;
    const AbortControllerImpl = getAbortControllerConstructor(options);

    if (typeof fetchImpl !== "function") {
      throw new PanelApiError({
        code: "NETWORK_ERROR",
        message: QUERY_ERROR_MESSAGES.NETWORK_ERROR,
        retryable: true,
        kind: "configuration"
      });
    }

    async function requestJson(path, requestOptions = {}) {
      const relativePath = assertRelativePath(path);
      const method = requestOptions.method || "GET";
      const hasBody = Object.prototype.hasOwnProperty.call(requestOptions, "body") &&
        requestOptions.body !== undefined;
      const headers = {
        Accept: "application/json",
        ...(requestOptions.headers || {})
      };

      if (hasBody) {
        headers["Content-Type"] = "application/json";
      } else {
        delete headers["Content-Type"];
        delete headers["content-type"];
      }

      const controller = new AbortControllerImpl();
      const externalSignal = requestOptions.signal;
      let timedOut = false;
      let timeoutHandle = null;
      let removeAbortListener = null;

      if (externalSignal) {
        if (externalSignal.aborted) {
          controller.abort();
        } else if (typeof externalSignal.addEventListener === "function") {
          const abortExternalRequest = () => controller.abort();
          externalSignal.addEventListener("abort", abortExternalRequest, { once: true });
          removeAbortListener = () => {
            externalSignal.removeEventListener("abort", abortExternalRequest);
          };
        }
      }

      if (timeoutMs > 0 && typeof globalObject.setTimeout === "function") {
        timeoutHandle = globalObject.setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMs);
      }

      const fetchOptions = {
        method,
        headers,
        signal: controller.signal
      };
      if (hasBody) {
        fetchOptions.body = typeof requestOptions.body === "string"
          ? requestOptions.body
          : JSON.stringify(requestOptions.body);
      }

      try {
        const response = await fetchImpl(relativePath, fetchOptions);
        return await parseHttpResponse(
          response,
          requestOptions.expectedEnvelope,
          requestOptions.expectedStatus
        );
      } catch (error) {
        if (error instanceof PanelApiError) {
          throw error;
        }
        throw createTransportError(error, timedOut);
      } finally {
        if (timeoutHandle !== null && typeof globalObject.clearTimeout === "function") {
          globalObject.clearTimeout(timeoutHandle);
        }
        if (removeAbortListener) {
          removeAbortListener();
        }
      }
    }

    function getFilterRequest(filter, actorId) {
      const selection = normalizeFilterSelection(
        typeof filter === "string" ? createFilterSelection(filter) : filter
      );
      if (selection.kind === "OVERDUE") {
        const normalizedActorId = normalizeText(actorId);
        if (!normalizedActorId) {
          throw new PanelApiError({
            code: "ACTOR_REQUIRED",
            message: QUERY_ERROR_MESSAGES.ACTOR_REQUIRED,
            kind: "validation"
          });
        }
        return {
          path: "/tickets/overdue",
          headers: { "X-Actor-Id": normalizedActorId },
          filter: selection
        };
      }

      if (selection.kind === "STATUS") {
        return {
          path: `/tickets?status=${encodeURIComponent(selection.value)}`,
          headers: {},
          filter: selection
        };
      }

      return {
        path: "/tickets",
        headers: {},
        filter: { kind: "ALL" }
      };
    }

    return Object.freeze({
      requestJson,
      getFilterRequest,
      createTicket(payload, requestOptions = {}) {
        const validation = validateCreateDraft(payload);
        if (!validation.valid) {
          throw createValidationApiError(validation);
        }
        return requestJson("/tickets", {
          ...requestOptions,
          method: "POST",
          body: buildCreateTicketBody(validation.normalized),
          expectedEnvelope: "ticket",
          expectedStatus: 201
        });
      },
      getTickets(filter, actorId, requestOptions = {}) {
        const request = getFilterRequest(filter, actorId);
        return requestJson(request.path, {
          ...requestOptions,
          body: undefined,
          method: "GET",
          headers: request.headers,
          expectedEnvelope: "tickets"
        });
      },
      getTicket(id, requestOptions = {}) {
        const normalizedId = normalizeText(id);
        if (!normalizedId) {
          throw new PanelApiError({
            code: "CONTRACT_ERROR",
            message: "El identificador del ticket es obligatorio.",
            kind: "validation"
          });
        }
        return requestJson(`/tickets/${encodeURIComponent(normalizedId)}`, {
          ...requestOptions,
          body: undefined,
          method: "GET",
          headers: {},
          expectedEnvelope: "ticket"
        });
      },
      createTicketRequest(request, requestOptions = {}) {
        const snapshot = snapshotMutationRequest(request, "create");
        return requestJson(snapshot.href, {
          ...requestOptions,
          method: snapshot.method,
          headers: snapshot.headers,
          body: snapshot.body,
          expectedEnvelope: "ticket",
          expectedStatus: 201
        });
      },
      mutateRequest(request, requestOptions = {}) {
        const snapshot = snapshotMutationRequest(request, "ticket");
        return requestJson(snapshot.href, {
          ...requestOptions,
          method: snapshot.method,
          headers: snapshot.headers,
          body: snapshot.body,
          expectedEnvelope: "ticket",
          expectedStatus: 200
        });
      },
      mutateTicket(descriptor, actorId, draft, requestOptions = {}) {
        const request = buildMutationRequest(descriptor, actorId, draft);
        return requestJson(request.href, {
          ...requestOptions,
          method: request.method,
          headers: request.headers,
          body: request.body,
          expectedEnvelope: "ticket",
          expectedStatus: 200
        });
      }
    });
  }

  function setPanelMessage(documentObject, message, kind = "status") {
    if (!documentObject || typeof documentObject.getElementById !== "function") {
      return;
    }
    const node = documentObject.getElementById("panel-message");
    if (!node) {
      return;
    }
    setSafeText(node, message || "");
    node.className = message ? `message-${kind} is-${kind}` : "";
    node.setAttribute("role", kind === "error" ? "alert" : "status");
    node.setAttribute("aria-live", kind === "error" ? "assertive" : "polite");
    if (message) {
      node.dataset.state = kind;
    } else {
      node.removeAttribute("data-state");
    }
  }

  function setMutationRetryControl(documentObject, state, onRetry) {
    if (!documentObject || typeof documentObject.getElementById !== "function") {
      return;
    }
    const region = documentObject.getElementById("notification-region");
    if (!region) {
      return;
    }
    let button = documentObject.getElementById("mutation-retry");
    if (!button && typeof documentObject.createElement === "function") {
      button = createSafeElement(documentObject, "button");
      button.id = "mutation-retry";
      button.type = "button";
      button.className = "secondary-action";
      button.retryHandler = null;
      button.addEventListener("click", () => {
        if (typeof button.retryHandler === "function") {
          button.retryHandler();
        }
      });
      region.appendChild(button);
    }
    if (!button) {
      return;
    }
    button.retryHandler = onRetry || null;
    setSafeText(button, "Reintentar operación");
    const mutation = state && state.mutation;
    button.hidden = !(mutation && mutation.phase === "error" && mutation.retryAvailable === true);
    button.disabled = Boolean(mutation && ["loading", "reconciling", "retry-pending"].includes(mutation.phase));
  }

  function announceMutationState(documentObject, state, message, kind = "status", onRetry) {
    setPanelMessage(documentObject, message, kind);
    setMutationRetryControl(documentObject, state, onRetry);
  }

  function getCreateDraftFromForm(documentObject) {
    const draft = createEmptyCreateDraft();
    const controlIds = {
      title: "ticket-title",
      description: "ticket-description",
      category: "ticket-category",
      priority: "ticket-priority",
      requester: "ticket-requester"
    };
    CREATE_FIELDS.forEach((field) => {
      const control = documentObject && typeof documentObject.getElementById === "function"
        ? documentObject.getElementById(controlIds[field])
        : null;
      draft[field] = control && "value" in control ? control.value : "";
    });
    return draft;
  }

  function setCreateFieldError(documentObject, field, message) {
    const control = documentObject.getElementById(`ticket-${field}`);
    const errorNode = documentObject.getElementById(`ticket-${field}-error`);
    if (errorNode) {
      setSafeText(errorNode, message || "");
    }
    if (control) {
      if (message) {
        control.setAttribute("aria-invalid", "true");
      } else {
        control.removeAttribute("aria-invalid");
      }
    }
  }

  function clearCreateErrors(documentObject) {
    CREATE_FIELDS.forEach((field) => setCreateFieldError(documentObject, field, ""));
    const generalErrors = documentObject.getElementById("new-ticket-form-errors");
    if (generalErrors) {
      setSafeText(generalErrors, "");
    }
  }

  function focusFirstCreateError(documentObject, fieldErrors) {
    const firstInvalidField = CREATE_FIELDS.find((field) => fieldErrors && fieldErrors[field]);
    if (!firstInvalidField) {
      return false;
    }
    const control = documentObject.getElementById(`ticket-${firstInvalidField}`);
    if (control && typeof control.focus === "function") {
      control.focus();
      return true;
    }
    return false;
  }

  function showCreateErrors(documentObject, fieldErrors, generalMessages = []) {
    CREATE_FIELDS.forEach((field) => {
      setCreateFieldError(documentObject, field, fieldErrors[field] || "");
    });
    const generalErrors = documentObject.getElementById("new-ticket-form-errors");
    if (generalErrors) {
      setSafeText(generalErrors, generalMessages.filter(Boolean).join(" "));
    }
    focusFirstCreateError(documentObject, fieldErrors);
  }

  function showCreateApiError(documentObject, error) {
    const fieldErrors = {};
    const generalMessages = [];
    const knownFields = new Set(CREATE_FIELDS);
    const details = error && Array.isArray(error.details) ? error.details : [];

    details.forEach((detail) => {
      const field = detail.path.find((part) => knownFields.has(part));
      const message = safeErrorText(detail.message, "Revisa este campo.");
      if (field) {
        fieldErrors[field] = message;
      } else if (message) {
        generalMessages.push(message);
      }
    });

    const summary = error && error.message ? error.message : QUERY_ERROR_MESSAGES.INVALID_REQUEST;
    if (!Object.keys(fieldErrors).length && !generalMessages.length) {
      generalMessages.push(summary);
    } else if (error && error.code !== "INVALID_REQUEST") {
      generalMessages.unshift(summary);
    }
    showCreateErrors(documentObject, fieldErrors, generalMessages);
    setPanelMessage(documentObject, summary, "error");
  }

  function initializeCreateForm(documentObject, state, adapter, queryCoordinator) {
    const form = documentObject.getElementById("new-ticket-form");
    const submitButton = documentObject.getElementById("create-ticket-submit");
    if (!form || typeof form.addEventListener !== "function") {
      return;
    }

    let pending = false;
    const controlIds = {
      title: "ticket-title",
      description: "ticket-description",
      category: "ticket-category",
      priority: "ticket-priority",
      requester: "ticket-requester"
    };

    CREATE_FIELDS.forEach((field) => {
      const control = documentObject.getElementById(controlIds[field]);
      if (control && typeof control.addEventListener === "function") {
        control.addEventListener("input", () => {
          state.createDraft[field] = control.value;
          setCreateFieldError(documentObject, field, "");
        });
      }
    });

    form.addEventListener("submit", async (event) => {
      if (event && typeof event.preventDefault === "function") {
        event.preventDefault();
      }
      if (pending) {
        return;
      }

      const draft = getCreateDraftFromForm(documentObject);
      state.createDraft = draft;
      clearCreateErrors(documentObject);
      const validation = validateCreateDraft(draft);
      if (!validation.valid) {
        showCreateErrors(documentObject, validation.fieldErrors);
        return;
      }

      if (!adapter || typeof adapter.createTicket !== "function") {
        showCreateApiError(documentObject, new PanelApiError({
          code: "NETWORK_ERROR",
          message: QUERY_ERROR_MESSAGES.NETWORK_ERROR,
          retryable: true,
          kind: "configuration"
        }));
        return;
      }

      pending = true;
      if (submitButton) {
        submitButton.disabled = true;
      }
      let mutationRequest;
      try {
        mutationRequest = buildCreateMutationRequest(validation.normalized);
      } catch (error) {
        pending = false;
        if (submitButton) submitButton.disabled = false;
        showCreateApiError(documentObject, error);
        return;
      }

      const createMutation = {
        phase: "loading",
        action: "CREATE",
        ticketId: "",
        payload: mutationRequest.body,
        request: mutationRequest,
        draft: Object.freeze({ ...validation.normalized }),
        automaticRetryUsed: false,
        retryAvailable: false
      };
      state.mutation = createMutation;

      const finishCreateMutation = async (mutation, allowAutomaticRetry) => {
        const manualRetry = () => finishCreateMutation(state.mutation, false);
        const result = await runPreservedMutation(
          documentObject,
          state,
          adapter,
          mutation,
          allowAutomaticRetry,
          manualRetry
        );
        if (!result.ok) {
          if (!result.stale) {
            showCreateApiError(documentObject, result.error);
            setMutationRetryControl(documentObject, state, manualRetry);
          }
          const waitingForManualRetry = Boolean(
            state.mutation && state.mutation.retryAvailable === true
          );
          pending = waitingForManualRetry;
          if (submitButton) submitButton.disabled = waitingForManualRetry;
          return false;
        }

        state.mutation = null;
        setMutationRetryControl(documentObject, state, null);
        state.createDraft = createEmptyCreateDraft();
        CREATE_FIELDS.forEach((field) => {
          const control = documentObject.getElementById(controlIds[field]);
          if (control) {
            setSafeValue(control, "");
          }
        });
        clearCreateErrors(documentObject);
        setPanelMessage(documentObject, "Ticket creado correctamente.", "success");
        if (queryCoordinator) {
          await queryCoordinator.load(state.selectedFilter, state.actorId);
        }
        pending = false;
        if (submitButton) {
          submitButton.disabled = false;
        }
        return true;
      };

      await finishCreateMutation(createMutation, true);
    });
  }

  function setQueryStatus(documentObject, state) {
    if (!documentObject || typeof documentObject.getElementById !== "function") {
      return;
    }

    const region = documentObject.getElementById("query-status-region");
    const loadingNode = documentObject.getElementById("query-loading-status");
    const errorNode = documentObject.getElementById("query-error-status");
    const retryButton = documentObject.getElementById("query-retry");
    const emptyNode = documentObject.getElementById("ticket-empty-state");
    const actorErrorNode = documentObject.getElementById("actor-id-error");
    const actorControl = documentObject.getElementById("actor-id");

    if (region) {
      region.setAttribute("aria-busy", state.query.phase === "loading" ? "true" : "false");
    }
    if (loadingNode) {
      setSafeText(loadingNode, state.query.phase === "loading" ? "Cargando tickets..." : "");
    }
    if (errorNode) {
      const error = state.query.error;
      const detailMessages = error && Array.isArray(error.details)
        ? error.details
          .map((detail) => safeErrorText(detail.message, ""))
          .filter(Boolean)
        : [];
      const message = error
        ? [
          error.retryable ? `Error de conexión: ${error.message}` : error.message,
          ...detailMessages
        ].filter(Boolean).join(" ")
        : "";
      setSafeText(errorNode, message);
    }
    if (retryButton) {
      retryButton.hidden = state.query.phase !== "error";
      retryButton.disabled = state.query.phase === "loading";
    }
    if (emptyNode) {
      emptyNode.hidden = state.query.phase !== "empty";
    }
    if (actorErrorNode) {
      const actorMessage = state.query.error && state.query.error.code === "ACTOR_REQUIRED"
        ? state.query.error.message
        : "";
      setSafeText(actorErrorNode, actorMessage);
      if (actorControl) {
        if (actorMessage) {
          actorControl.setAttribute("aria-invalid", "true");
        } else {
          actorControl.removeAttribute("aria-invalid");
        }
      }
    }
  }

  function notifyQueryChange(state, documentObject, onChange) {
    setQueryStatus(documentObject, state);
    if (typeof onChange === "function") {
      onChange(state);
    }
  }

  function isCurrentQueryToken(state, token) {
    if (!state || !state.query || !state.query.active || !token) {
      return false;
    }
    return state.query.active === token &&
      state.query.sequence === token.sequence &&
      filterKey(state.selectedFilter) === token.filterKey;
  }

  function createQueryToken(state, filter, AbortControllerImpl) {
    const selection = normalizeFilterSelection(filter);
    if (state.query.active && state.query.active.controller) {
      state.query.active.controller.abort();
    }
    const controller = new AbortControllerImpl();
    const token = Object.freeze({
      sequence: state.query.sequence + 1,
      filterKey: filterKey(selection),
      controller
    });
    state.query.sequence = token.sequence;
    state.query.active = token;
    state.query.phase = "loading";
    state.query.error = null;
    state.selectedFilter = selection;
    return token;
  }

  function createQueryCoordinator(options = {}) {
    const state = options.state || createInitialState();
    const adapter = options.adapter || createHttpAdapter(options);
    const documentObject = options.documentObject || null;
    const onChange = options.onChange;
    const AbortControllerImpl = options.AbortControllerImpl || globalObject.AbortController;

    if (typeof AbortControllerImpl !== "function") {
      throw new PanelApiError({
        code: "CONTRACT_ERROR",
        message: "El navegador no admite cancelación de consultas.",
        kind: "configuration"
      });
    }

    async function load(filter = state.selectedFilter, actorId = state.actorId, loadOptions = {}) {
      const applyResult = loadOptions.apply !== false;
      const selection = normalizeFilterSelection(
        typeof filter === "string" ? createFilterSelection(filter) : filter
      );
      const token = createQueryToken(state, selection, AbortControllerImpl);
      if (actorId !== undefined) {
        state.actorId = normalizeText(actorId);
      }
      notifyQueryChange(state, documentObject, onChange);

      try {
        const tickets = await adapter.getTickets(selection, state.actorId, {
          signal: token.controller.signal
        });
        if (!isCurrentQueryToken(state, token)) {
          return { stale: true, tickets: state.tickets, token };
        }
        if (!applyResult) {
          return { stale: false, tickets, phase: "pending", token };
        }
        return commit(token, tickets);
      } catch (error) {
        if (!isCurrentQueryToken(state, token)) {
          return { stale: true, tickets: state.tickets, token };
        }
        const safeError = error instanceof PanelApiError
          ? error
          : createTransportError(error, false);
        if (!applyResult) {
          return { stale: false, tickets: state.tickets, error: safeError, phase: "error", token };
        }
        return fail(token, safeError);
      }
    }

    function commit(token, tickets, commitOptions = {}) {
      if (!isCurrentQueryToken(state, token) || !Array.isArray(tickets)) {
        return { stale: true, tickets: state.tickets, token };
      }
      state.tickets = tickets;
      state.query.active = null;
      state.query.error = null;
      state.query.phase = tickets.length === 0 ? "empty" : "success";
      if (commitOptions.notify !== false) {
        notifyQueryChange(state, documentObject, onChange);
      }
      return { stale: false, tickets, phase: state.query.phase, token };
    }

    function fail(token, error) {
      if (!isCurrentQueryToken(state, token)) {
        return { stale: true, tickets: state.tickets, token };
      }
      const safeError = error instanceof PanelApiError
        ? error
        : createTransportError(error, false);
      state.query.active = null;
      state.query.error = safeError;
      state.query.phase = "error";
      notifyQueryChange(state, documentObject, onChange);
      return { stale: false, tickets: state.tickets, error: safeError, phase: "error", token };
    }

    function abort() {
      if (state.query.active && state.query.active.controller) {
        state.query.active.controller.abort();
      }
    }

    function retry() {
      return load(state.selectedFilter, state.actorId);
    }

    return Object.freeze({ load, retry, abort, commit, fail, state });
  }

  const OPEN_STATUS_VALUES = Object.freeze([
    "NUEVO",
    "ASIGNADO",
    "EN_PROGRESO",
    "EN_ESPERA"
  ]);

  const RESOLVED_STATUS_VALUES = Object.freeze(["RESUELTO", "CERRADO"]);

  function calculateTicketSummary(tickets) {
    const collection = Array.isArray(tickets) ? tickets : [];
    return collection.reduce((summary, ticket) => {
      const status = ticket && ticket.status;
      if (OPEN_STATUS_VALUES.includes(status)) {
        summary.open += 1;
      }
      if (ticket && ticket.overdue === true) {
        summary.overdue += 1;
      }
      if (RESOLVED_STATUS_VALUES.includes(status)) {
        summary.resolved += 1;
      }
      return summary;
    }, { open: 0, overdue: 0, resolved: 0 });
  }

  function parseDate(value) {
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value;
    }
    if (typeof value !== "string" && typeof value !== "number") {
      return null;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function formatDuration(milliseconds) {
    const seconds = Math.max(0, Math.round(milliseconds / 1000));
    if (seconds < 60) {
      return `${seconds} ${seconds === 1 ? "segundo" : "segundos"}`;
    }
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) {
      return `${minutes} ${minutes === 1 ? "minuto" : "minutos"}`;
    }
    const hours = Math.round(minutes / 60);
    if (hours < 24) {
      return `${hours} ${hours === 1 ? "hora" : "horas"}`;
    }
    const days = Math.round(hours / 24);
    if (days < 30) {
      return `${days} ${days === 1 ? "día" : "días"}`;
    }
    const months = Math.round(days / 30);
    if (months < 12) {
      return `${months} ${months === 1 ? "mes" : "meses"}`;
    }
    const years = Math.round(months / 12);
    return `${years} ${years === 1 ? "año" : "años"}`;
  }

  function formatRelativeDue(dueAt, nowValue = new Date(), overdueFlag = false) {
    const dueDate = parseDate(dueAt);
    const nowDate = parseDate(nowValue) || new Date();
    if (!dueDate) {
      return overdueFlag === true
        ? { text: "hace un tiempo no disponible", overdue: true }
        : { text: "No disponible", overdue: false };
    }

    const difference = dueDate.getTime() - nowDate.getTime();
    const isOverdue = overdueFlag === true || difference < 0;
    return {
      text: isOverdue
        ? `hace ${formatDuration(Math.abs(difference))}`
        : `en ${formatDuration(difference)}`,
      overdue: isOverdue
    };
  }

  function formatDateTime(value) {
    const date = parseDate(value);
    if (!date) {
      return "No disponible";
    }
    try {
      return new Intl.DateTimeFormat("es-ES", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC"
      }).format(date);
    } catch (_error) {
      return date.toISOString();
    }
  }

  function displayValue(value) {
    if (value === null || value === undefined) {
      return "No disponible";
    }
    if (typeof value === "string") {
      return value.trim() ? value : "No disponible";
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    return "No disponible";
  }

  function removeChildren(node) {
    if (!node) {
      return;
    }
    while (node.firstChild) {
      node.removeChild(node.firstChild);
    }
  }

  function appendTextElement(documentObject, parent, tagName, className, value) {
    const element = createSafeElement(documentObject, tagName);
    if (className) {
      element.className = className;
    }
    setSafeText(element, value);
    parent.appendChild(element);
    return element;
  }

  function appendDetailField(documentObject, container, label, value) {
    appendTextElement(documentObject, container, "dt", "", label);
    appendTextElement(documentObject, container, "dd", "", displayValue(value));
  }

  function getTicketResponsible(ticket) {
    if (!ticket || typeof ticket !== "object") {
      return undefined;
    }
    if (ticket.responsibleId !== null && ticket.responsibleId !== undefined) {
      return ticket.responsibleId;
    }
    return ticket.responsible ?? ticket.responsable;
  }

  function createTicketCard(documentObject, ticket, nowValue, onDetail) {
    const item = createSafeElement(documentObject, "li");
    item.className = "ticket-card";
    const relativeDue = formatRelativeDue(ticket && ticket.dueAt, nowValue, ticket && ticket.overdue);
    if (relativeDue.overdue) {
      item.classList.add("is-overdue");
      item.setAttribute("data-overdue", "true");
    }

    const content = createSafeElement(documentObject, "div");
    content.className = "ticket-card-content";
    appendTextElement(documentObject, content, "p", "ticket-card-id", `ID: ${displayValue(ticket && ticket.id)}`);
    appendTextElement(documentObject, content, "h4", "ticket-card-title", displayValue(ticket && ticket.title));

    const metadata = createSafeElement(documentObject, "div");
    metadata.className = "ticket-card-meta";
    appendTextElement(
      documentObject,
      metadata,
      "span",
      "category-badge",
      `Categoría: ${getCatalogLabel(CATEGORY_CATALOG, ticket && ticket.category)}`
    );
    appendTextElement(
      documentObject,
      metadata,
      "span",
      "priority-badge",
      `Prioridad: ${getCatalogLabel(PRIORITY_CATALOG, ticket && ticket.priority)}`
    );
    appendTextElement(
      documentObject,
      metadata,
      "span",
      "status-badge",
      `Estado: ${getCatalogLabel(STATUS_CATALOG, ticket && ticket.status)}`
    );
    content.appendChild(metadata);

    const due = appendTextElement(
      documentObject,
      content,
      "p",
      "ticket-card-due",
      `Vencimiento: ${relativeDue.text}`
    );
    if (relativeDue.overdue) {
      due.classList.add("is-overdue");
      const badge = appendTextElement(documentObject, content, "span", "ticket-overdue-badge", "VENCIDO");
      badge.setAttribute("aria-label", "VENCIDO");
    }
    item.appendChild(content);

    const actions = createSafeElement(documentObject, "div");
    actions.className = "ticket-card-actions";
    actions.setAttribute("aria-label", "Acciones del ticket");
    const detailButton = createSafeElement(documentObject, "button");
    detailButton.type = "button";
    detailButton.className = "secondary-action";
    detailButton.setAttribute("data-ticket-detail-id", displayValue(ticket && ticket.id));
    detailButton.setAttribute("aria-label", `Ver detalle del ticket ${displayValue(ticket && ticket.id)}`);
    setSafeText(detailButton, "Ver detalle");
    if (typeof onDetail === "function") {
      detailButton.addEventListener("click", () => onDetail(ticket, detailButton));
    }
    actions.appendChild(detailButton);
    item.appendChild(actions);
    return item;
  }

  const ACTION_CONTRACT_ERROR_MESSAGE = "No se pudieron cargar las acciones de este ticket.";

  const ACTION_DESCRIPTOR_CONTRACT = Object.freeze({
    ASSIGN: Object.freeze({ targetStatus: null, input: "RESPONSIBLE_ID" }),
    START: Object.freeze({ targetStatus: "EN_PROGRESO", input: "NONE" }),
    RESUME: Object.freeze({ targetStatus: "EN_PROGRESO", input: "NONE" }),
    WAIT: Object.freeze({ targetStatus: "EN_ESPERA", input: "NONE" }),
    RESOLVE: Object.freeze({ targetStatus: "RESUELTO", input: "RESOLUTION_NOTE" }),
    CLOSE: Object.freeze({ targetStatus: "CERRADO", input: "NONE" }),
    REOPEN: Object.freeze({ targetStatus: "EN_PROGRESO", input: "NONE" })
  });

  function isValidAllowedTransitionDescriptor(descriptor) {
    if (!isRecord(descriptor) || !Object.prototype.hasOwnProperty.call(ACTION_DESCRIPTOR_CONTRACT, descriptor.action)) {
      return false;
    }
    if (descriptor.method !== "PATCH" || typeof descriptor.href !== "string") {
      return false;
    }

    try {
      assertRelativePath(descriptor.href);
    } catch (_error) {
      return false;
    }

    const contract = ACTION_DESCRIPTOR_CONTRACT[descriptor.action];
    return descriptor.targetStatus === contract.targetStatus && descriptor.input === contract.input;
  }

  function validateAllowedTransitions(allowedTransitions) {
    if (!Array.isArray(allowedTransitions)) {
      return {
        valid: false,
        descriptors: [],
        message: ACTION_CONTRACT_ERROR_MESSAGE
      };
    }

    const valid = allowedTransitions.every(isValidAllowedTransitionDescriptor);
    return {
      valid,
      descriptors: valid ? allowedTransitions.slice() : [],
      message: valid ? "" : ACTION_CONTRACT_ERROR_MESSAGE
    };
  }

  function setActionDescriptorAttributes(button, descriptor) {
    button.setAttribute("data-action", descriptor.action);
    button.setAttribute("data-method", descriptor.method);
    button.setAttribute("data-href", descriptor.href);
    button.setAttribute("data-target-status", descriptor.targetStatus === null ? "" : descriptor.targetStatus);
    button.setAttribute("data-input", descriptor.input);
  }

  function renderTicketActions(documentObject, ticket, onAction) {
    const actionsNode = documentObject.getElementById("dialog-actions");
    if (!actionsNode) {
      return { valid: false, descriptors: [] };
    }

    removeChildren(actionsNode);
    const validation = validateAllowedTransitions(ticket && ticket.allowedTransitions);
    if (!validation.valid) {
      setSafeText(actionsNode, ACTION_CONTRACT_ERROR_MESSAGE);
      actionsNode.setAttribute("role", "alert");
      setPanelMessage(documentObject, ACTION_CONTRACT_ERROR_MESSAGE, "error");
      return validation;
    }

    actionsNode.removeAttribute("role");
    validation.descriptors.forEach((descriptor) => {
      const label = ACTION_LABELS[descriptor.action];
      const button = createSafeElement(documentObject, "button");
      button.type = "button";
      button.className = "action-secondary";
      setSafeText(button, label);
      setActionDescriptorAttributes(button, descriptor);
      button.setAttribute(
        "aria-label",
        `${label} ticket ${displayValue(ticket && ticket.id)}`
      );
      if (typeof onAction === "function") {
        button.addEventListener("click", () => onAction(descriptor, button));
      }
      actionsNode.appendChild(button);
    });
    return validation;
  }

  function renderTicketSummary(documentObject, tickets) {
    const summary = calculateTicketSummary(tickets);
    const values = {
      "open-count": { label: "Abiertos", value: summary.open },
      "overdue-count": { label: "Vencimientos", value: summary.overdue },
      "resolved-count": { label: "Resueltos", value: summary.resolved }
    };
    Object.keys(values).forEach((id) => {
      const node = documentObject.getElementById(id);
      if (node) {
        setSafeText(node, values[id].value);
        node.setAttribute("aria-label", `${values[id].label}: ${values[id].value}`);
      }
    });
    return summary;
  }

  function renderTicketCollection(documentObject, state, nowValue = new Date(), onDetail) {
    if (!documentObject || !state) {
      return;
    }
    const list = documentObject.getElementById("ticket-list");
    const summaryNode = documentObject.getElementById("ticket-list-summary");
    const emptyNode = documentObject.getElementById("ticket-empty-state");
    const collection = Array.isArray(state.tickets) ? state.tickets : [];
    renderTicketSummary(documentObject, collection);

    if (summaryNode) {
      setSafeText(summaryNode, `${collection.length} ${collection.length === 1 ? "ticket disponible" : "tickets disponibles"}.`);
    }
    if (!list) {
      return;
    }
    removeChildren(list);
    collection.forEach((ticket) => {
      list.appendChild(createTicketCard(documentObject, ticket, nowValue, onDetail));
    });
    if (emptyNode) {
      setSafeText(emptyNode, `No hay tickets para el filtro ${getFilterLabel(state.selectedFilter)}.`);
      emptyNode.hidden = state.query && state.query.phase === "empty" ? false : true;
    }
  }

  function setDialogFieldError(documentObject, field, message) {
    const controlId = field === "responsibleId" ? "responsible-id" : "resolution-note";
    const errorId = `${controlId}-error`;
    const control = documentObject.getElementById(controlId);
    const errorNode = documentObject.getElementById(errorId);
    if (errorNode) {
      setSafeText(errorNode, message || "");
    }
    if (control) {
      if (message) {
        control.setAttribute("aria-invalid", "true");
      } else {
        control.removeAttribute("aria-invalid");
      }
    }
  }

  function clearDialogErrors(documentObject) {
    ["responsibleId", "resolutionNote"].forEach((field) => {
      setDialogFieldError(documentObject, field, "");
    });
    ["assignment-form-errors", "resolution-form-errors"].forEach((id) => {
      const node = documentObject.getElementById(id);
      if (node) {
        setSafeText(node, "");
      }
    });
  }

  function showMutationError(documentObject, error) {
    const safeError = error instanceof PanelApiError
      ? error
      : new PanelApiError({
        code: "NETWORK_ERROR",
        message: QUERY_ERROR_MESSAGES.NETWORK_ERROR,
        retryable: true,
        kind: "network"
      });
    const fieldErrors = {};
    const generalMessages = [];
    const knownFields = new Set(DIALOG_FIELDS);
    safeError.details.forEach((detail) => {
      const field = detail.path.find((part) => knownFields.has(part));
      const message = safeErrorText(detail.message, "Revisa este campo.");
      if (field) {
        fieldErrors[field] = message;
      } else if (message) {
        generalMessages.push(message);
      }
    });
    const summary = safeError.message || errorMessageForCode(safeError.code, "No se pudo completar la operación.");
    DIALOG_FIELDS.forEach((field) => setDialogFieldError(documentObject, field, fieldErrors[field] || ""));
    const formErrorId = fieldErrors.responsibleId !== undefined || documentObject.getElementById("assignment-form")?.hidden === false
      ? "assignment-form-errors"
      : "resolution-form-errors";
    const formError = documentObject.getElementById(formErrorId);
    const visibleMessage = [summary, ...generalMessages].filter(Boolean).join(" ");
    if (formError) {
      setSafeText(formError, generalMessages.length ? generalMessages.join(" ") : summary);
    }
    if (safeError.code === "ACTOR_REQUIRED" || safeError.code === "ACTOR_UNKNOWN") {
      const actorErrorNode = documentObject.getElementById("actor-id-error");
      const actorControl = documentObject.getElementById("actor-id");
      if (actorErrorNode) setSafeText(actorErrorNode, summary);
      if (actorControl) actorControl.setAttribute("aria-invalid", "true");
    }
    setPanelMessage(documentObject, visibleMessage, "error");
    return safeError;
  }

  function setDialogMode(documentObject, kind) {
    const detailView = documentObject.getElementById("ticket-detail-view");
    const assignmentForm = documentObject.getElementById("assignment-form");
    const resolutionForm = documentObject.getElementById("resolution-form");
    const actionsNode = documentObject.getElementById("dialog-actions");
    const titleNode = documentObject.getElementById("dialog-title");
    const descriptionNode = documentObject.getElementById("dialog-description");
    if (detailView) detailView.hidden = kind !== "detail";
    if (assignmentForm) assignmentForm.hidden = kind !== "assignment";
    if (resolutionForm) resolutionForm.hidden = kind !== "resolution";
    if (actionsNode) actionsNode.hidden = kind !== "detail";
    if (titleNode && kind === "assignment") setSafeText(titleNode, "Asignar ticket");
    if (titleNode && kind === "resolution") setSafeText(titleNode, "Resolver ticket");
    if (descriptionNode && kind === "assignment") {
      setSafeText(descriptionNode, "Indica el identificador del responsable.");
    }
    if (descriptionNode && kind === "resolution") {
      setSafeText(descriptionNode, "Registra la nota de resolución para cerrar la atención.");
    }
  }

  function setMutationControlsDisabled(documentObject, disabled) {
    [
      "dialog-close",
      "assignment-submit",
      "assignment-cancel",
      "resolution-submit",
      "resolution-cancel",
      "responsible-id",
      "resolution-note"
    ].forEach((id) => {
      const control = documentObject.getElementById(id);
      if (control) control.disabled = disabled;
    });
    const actionsNode = documentObject.getElementById("dialog-actions");
    if (actionsNode && typeof actionsNode.querySelectorAll === "function") {
      actionsNode.querySelectorAll("button").forEach((button) => {
        button.disabled = disabled;
      });
    }
  }

  function openFallbackModal(documentObject, dialog) {
    if (!documentObject || !dialog || !documentObject.body) {
      return false;
    }
    const siblings = Array.from(documentObject.body.children)
      .filter((element) => element !== dialog)
      .map((element) => ({
        element,
        hadInertAttribute: element.hasAttribute("inert"),
        hadAriaHidden: element.getAttribute("aria-hidden")
      }));
    siblings.forEach(({ element }) => {
      element.setAttribute("inert", "");
      element.setAttribute("aria-hidden", "true");
    });
    dialog.__panelFallbackModal = { siblings };
    dialog.hidden = false;
    dialog.setAttribute("open", "");
    dialog.setAttribute("aria-modal", "true");
    dialog.classList.add("is-fallback-modal");
    documentObject.body.classList.add("panel-fallback-modal");
    return true;
  }

  function closeFallbackModal(documentObject, dialog) {
    if (!dialog || !dialog.__panelFallbackModal) {
      return false;
    }
    dialog.__panelFallbackModal.siblings.forEach(({ element, hadInertAttribute, hadAriaHidden }) => {
      if (!hadInertAttribute) {
        element.removeAttribute("inert");
      }
      if (hadAriaHidden === null) {
        element.removeAttribute("aria-hidden");
      } else {
        element.setAttribute("aria-hidden", hadAriaHidden);
      }
    });
    dialog.__panelFallbackModal = null;
    dialog.classList.remove("is-fallback-modal");
    dialog.removeAttribute("open");
    dialog.hidden = true;
    if (documentObject && documentObject.body) {
      documentObject.body.classList.remove("panel-fallback-modal");
    }
    return true;
  }

  function openTicketOperationDialog(documentObject, state, ticket, descriptor, trigger) {
    const dialog = documentObject.getElementById("ticket-dialog");
    if (!dialog || !ticket) return;
    const kind = descriptor.action === "ASSIGN" ? "assignment" : "resolution";
    state.dialog = {
      kind,
      ticketId: displayValue(ticket.id),
      descriptor
    };
    state.dialogDraft = createEmptyDialogDraft();
    setDialogMode(documentObject, kind);
    clearDialogErrors(documentObject);
    const responsibleControl = documentObject.getElementById("responsible-id");
    const resolutionControl = documentObject.getElementById("resolution-note");
    if (responsibleControl) setSafeValue(responsibleControl, "");
    if (resolutionControl) setSafeValue(resolutionControl, "");
    state.lastDialogTrigger = trigger || null;
    if (typeof dialog.showModal === "function") {
      dialog.hidden = false;
      if (!dialog.open) dialog.showModal();
    } else {
      openFallbackModal(documentObject, dialog);
    }
    focusFirstDialogControl(documentObject, kind);
  }

  function applyMutationTicket(state, ticket) {
    if (!ticket || !isValidTicketEnvelope(ticket)) return;
    const index = state.tickets.findIndex((item) => item && item.id === ticket.id);
    if (index >= 0) {
      state.tickets = state.tickets.map((item, itemIndex) => itemIndex === index ? ticket : item);
    }
  }

  function isCurrentMutation(state, mutation) {
    return Boolean(state && state.mutation === mutation);
  }

  function getMutationSuccessMessage(action) {
    return action === "ASSIGN"
      ? "Ticket asignado correctamente."
      : action === "RESOLVE"
        ? "Ticket resuelto correctamente."
        : "Estado del ticket actualizado correctamente.";
  }

  function createReconciliationError(error, fallbackMessage = "No se pudo sincronizar el ticket con la API.") {
    if (error instanceof PanelApiError) {
      return error;
    }
    return new PanelApiError({
      code: "NETWORK_ERROR",
      message: fallbackMessage,
      retryable: true,
      kind: "reconciliation"
    });
  }

  function markReconciliationFailure(documentObject, state, mutation, error, queryCoordinator, queryToken) {
    if (!isCurrentMutation(state, mutation)) {
      return false;
    }
    const safeError = createReconciliationError(error);
    if (queryCoordinator && queryToken && isCurrentQueryToken(state, queryToken) &&
      typeof queryCoordinator.fail === "function") {
      queryCoordinator.fail(queryToken, safeError);
    }
    state.mutation = { ...mutation, phase: "error", reconciliationError: safeError };
    setMutationControlsDisabled(documentObject, true);
    showMutationError(documentObject, safeError);
    return false;
  }

  async function reconcileSuccessfulMutation(
    documentObject,
    state,
    adapter,
    mutation,
    queryCoordinator,
    closeDialog,
    renderState,
    renderDialog
  ) {
    if (!queryCoordinator || typeof queryCoordinator.load !== "function" ||
      !adapter || typeof adapter.getTicket !== "function") {
      return markReconciliationFailure(
        documentObject,
        state,
        mutation,
        new PanelApiError({
          code: "CONTRACT_ERROR",
          message: "No se pudo iniciar la sincronización del ticket.",
          kind: "reconciliation"
        }),
        queryCoordinator,
        null
      );
    }

    const selectedFilter = normalizeFilterSelection(state.selectedFilter);
    const listPromise = queryCoordinator.load(selectedFilter, state.actorId, { apply: false });
    const queryToken = state.query.active;
    const detailPromise = Promise.resolve().then(() => adapter.getTicket(mutation.ticketId, {
      signal: queryToken && queryToken.controller ? queryToken.controller.signal : undefined
    })).then(
      (ticket) => ({ ticket }),
      (error) => ({ error: createReconciliationError(error) })
    );
    const [listResult, detailResult] = await Promise.all([listPromise, detailPromise]);

    if (!isCurrentMutation(state, mutation)) {
      return false;
    }
    if (!queryToken || !isCurrentQueryToken(state, queryToken) || listResult.stale ||
      listResult.error || !Array.isArray(listResult.tickets)) {
      return markReconciliationFailure(
        documentObject,
        state,
        mutation,
        listResult.error || new PanelApiError({
          code: "NETWORK_ERROR",
          message: "La consulta de la lista quedó obsoleta y no se pudo sincronizar el ticket.",
          retryable: true,
          kind: "reconciliation"
        }),
        queryCoordinator,
        queryToken
      );
    }
    if (detailResult.error || !isValidTicketEnvelope(detailResult.ticket)) {
      return markReconciliationFailure(
        documentObject,
        state,
        mutation,
        detailResult.error || new PanelApiError({
          code: "CONTRACT_ERROR",
          message: "La representación vigente del ticket no es válida.",
          kind: "reconciliation"
        }),
        queryCoordinator,
        queryToken
      );
    }

    const currentTicket = detailResult.ticket;
    const reconciledTickets = listResult.tickets.map((ticket) =>
      ticket && ticket.id === currentTicket.id ? currentTicket : ticket
    );
    const committed = queryCoordinator.commit(queryToken, reconciledTickets, { notify: false });
    if (!committed || committed.stale || !isCurrentMutation(state, mutation)) {
      return markReconciliationFailure(
        documentObject,
        state,
        mutation,
        new PanelApiError({
          code: "NETWORK_ERROR",
          message: "La respuesta de sincronización quedó obsoleta.",
          retryable: true,
          kind: "reconciliation"
        }),
        queryCoordinator,
        queryToken
      );
    }

    state.tickets = reconciledTickets;
    state.mutation = null;
    state.dialogDraft = createEmptyDialogDraft();
    if (typeof renderState === "function") {
      renderState();
    }
    if (typeof renderDialog === "function" && state.dialog && state.dialog.ticketId === currentTicket.id) {
      renderDialog(currentTicket);
    }
    setMutationControlsDisabled(documentObject, false);
    if (typeof closeDialog === "function") {
      closeDialog();
    }
    setPanelMessage(documentObject, getMutationSuccessMessage(mutation.action), "success");
    return true;
  }

  async function refreshAfterInvalidTransition(
    documentObject,
    state,
    adapter,
    mutation,
    closeDialog,
    renderState,
    renderDialog
  ) {
    state.mutation = { ...mutation, phase: "reconciling" };
    const reconciliation = state.mutation;
    setMutationControlsDisabled(documentObject, true);
    try {
      const ticket = await adapter.getTicket(mutation.ticketId);
      if (!isCurrentMutation(state, reconciliation)) {
        return false;
      }
      applyMutationTicket(state, ticket);
      state.mutation = null;
      if (typeof renderState === "function") renderState();
      if (typeof renderDialog === "function") renderDialog(ticket);
      setMutationControlsDisabled(documentObject, false);
      setPanelMessage(documentObject, errorMessageForCode("INVALID_TRANSITION"), "error");
      return true;
    } catch (error) {
      markReconciliationFailure(documentObject, state, reconciliation, error, null, null);
      return false;
    }
  }

  async function refreshAfterTicketNotFound(
    documentObject,
    state,
    mutation,
    queryCoordinator,
    closeDialog,
    renderState
  ) {
    if (typeof closeDialog === "function") {
      closeDialog();
    }
    state.mutation = { ...mutation, phase: "reconciling" };
    const reconciliation = state.mutation;
    setMutationControlsDisabled(documentObject, true);
    if (!queryCoordinator || typeof queryCoordinator.load !== "function") {
      return markReconciliationFailure(
        documentObject,
        state,
        reconciliation,
        new PanelApiError({
          code: "CONTRACT_ERROR",
          message: "No se pudo actualizar la lista de tickets.",
          kind: "reconciliation"
        }),
        null,
        null
      );
    }

    const result = await queryCoordinator.load(state.selectedFilter, state.actorId);
    if (!isCurrentMutation(state, reconciliation)) {
      return false;
    }
    if (result.stale || result.error) {
      return markReconciliationFailure(
        documentObject,
        state,
        reconciliation,
        result.error || new PanelApiError({
          code: "NETWORK_ERROR",
          message: "No se pudo actualizar la lista de tickets.",
          retryable: true,
          kind: "reconciliation"
        }),
        null,
        null
      );
    }
    state.mutation = null;
    if (typeof renderState === "function") renderState();
    setMutationControlsDisabled(documentObject, false);
    setPanelMessage(documentObject, errorMessageForCode("TICKET_NOT_FOUND"), "error");
    return true;
  }

  function toSafeMutationError(error) {
    return error instanceof PanelApiError
      ? error
      : new PanelApiError({
        code: "NETWORK_ERROR",
        message: QUERY_ERROR_MESSAGES.NETWORK_ERROR,
        retryable: true,
        kind: "network"
      });
  }

  function isRetryableMutationTransportError(error) {
    const safeError = toSafeMutationError(error);
    return safeError.retryable === true &&
      (safeError.kind === "network" || safeError.kind === "timeout");
  }

  function sendPreservedMutation(adapter, mutation) {
    if (!adapter || !mutation || !mutation.request) {
      return Promise.reject(new PanelApiError({
        code: "NETWORK_ERROR",
        message: QUERY_ERROR_MESSAGES.NETWORK_ERROR,
        retryable: true,
        kind: "configuration"
      }));
    }
    const request = mutation.request;
    if (request.operation === "create" && typeof adapter.createTicketRequest === "function") {
      return adapter.createTicketRequest(request);
    }
    if (request.operation === "ticket" && typeof adapter.mutateRequest === "function") {
      return adapter.mutateRequest(request);
    }
    if (request.operation === "create" && typeof adapter.createTicket === "function") {
      return adapter.createTicket(request.body);
    }
    if (request.operation === "ticket" && typeof adapter.mutateTicket === "function") {
      return adapter.mutateTicket(request.descriptor, request.actorId, mutation.draft);
    }
    return Promise.reject(new PanelApiError({
      code: "NETWORK_ERROR",
      message: QUERY_ERROR_MESSAGES.NETWORK_ERROR,
      retryable: true,
      kind: "configuration"
    }));
  }

  async function runPreservedMutation(
    documentObject,
    state,
    adapter,
    mutation,
    allowAutomaticRetry,
    onManualRetry
  ) {
    let current = mutation;
    let automaticRetryUsed = mutation.automaticRetryUsed === true;
    while (true) {
      if (!isCurrentMutation(state, current)) {
        return { ok: false, stale: true, mutation: current };
      }
      state.mutation = { ...current, phase: automaticRetryUsed ? "retry-pending" : "loading" };
      current = state.mutation;
      setMutationControlsDisabled(documentObject, true);
      if (automaticRetryUsed && allowAutomaticRetry) {
        announceMutationState(
          documentObject,
          state,
          "No se pudo conectar con TicketOps. Reintentando automáticamente.",
          "error",
          onManualRetry
        );
      } else if (mutation.automaticRetryUsed === true && !allowAutomaticRetry) {
        announceMutationState(
          documentObject,
          state,
          "Reintentando operación con los datos conservados.",
          "status",
          onManualRetry
        );
      } else {
        announceMutationState(
          documentObject,
          state,
          "Procesando operación...",
          "status",
          onManualRetry
        );
      }

      try {
        const value = await sendPreservedMutation(adapter, current);
        return { ok: true, value, mutation: current };
      } catch (error) {
        const safeError = toSafeMutationError(error);
        if (allowAutomaticRetry && !automaticRetryUsed && isRetryableMutationTransportError(safeError)) {
          automaticRetryUsed = true;
          current = {
            ...current,
            phase: "retry-pending",
            automaticRetryUsed: true,
            retryAvailable: false,
            lastError: safeError
          };
          state.mutation = current;
          setMutationControlsDisabled(documentObject, true);
          announceMutationState(
            documentObject,
            state,
            "No se pudo conectar con TicketOps. Reintentando automáticamente.",
            "error",
            onManualRetry
          );
          continue;
        }

        current = {
          ...current,
          phase: "error",
          retryAvailable: isRetryableMutationTransportError(safeError),
          automaticRetryUsed,
          lastError: safeError
        };
        state.mutation = current;
        if (isRetryableMutationTransportError(safeError)) {
          setMutationControlsDisabled(documentObject, true);
        } else {
          setMutationControlsDisabled(documentObject, false);
        }
        showMutationError(documentObject, safeError);
        setMutationRetryControl(documentObject, state, onManualRetry);
        return { ok: false, error: safeError, mutation: current };
      }
    }
  }

  async function retryTicketMutation(
    documentObject,
    state,
    adapter,
    closeDialog,
    renderState,
    queryCoordinator,
    renderDialog
  ) {
    const pendingMutation = state && state.mutation;
    if (!pendingMutation || pendingMutation.phase !== "error" || !pendingMutation.retryAvailable) {
      return false;
    }
    const result = await runPreservedMutation(
      documentObject,
      state,
      adapter,
      pendingMutation,
      false,
      () => retryTicketMutation(
        documentObject,
        state,
        adapter,
        closeDialog,
        renderState,
        queryCoordinator,
        renderDialog
      )
    );
    if (!result.ok) {
      return false;
    }
    state.mutation = { ...result.mutation, phase: "reconciling" };
    return reconcileSuccessfulMutation(
      documentObject,
      state,
      adapter,
      state.mutation,
      queryCoordinator,
      closeDialog,
      renderState,
      renderDialog
    );
  }

  async function executeTicketMutation(
    documentObject,
    state,
    adapter,
    descriptor,
    closeDialog,
    renderState,
    queryCoordinator,
    renderDialog
  ) {
    if (state.mutation && ["loading", "reconciling", "retry-pending"].includes(state.mutation.phase)) return;

    let request;
    try {
      request = buildMutationRequest(descriptor, state.actorId, state.dialogDraft);
    } catch (error) {
      const safeError = showMutationError(documentObject, error);
      if (safeError.code === "INVALID_REQUEST") {
        focusFirstDialogError(documentObject, safeError);
      }
      return;
    }

    const mutationDraft = Object.freeze({ ...state.dialogDraft });
    const mutation = {
      phase: "loading",
      action: descriptor.action,
      descriptor,
      ticketId: state.dialog ? state.dialog.ticketId : "",
      payload: request.body,
      request,
      draft: mutationDraft,
      automaticRetryUsed: false,
      retryAvailable: false
    };
    state.mutation = mutation;
    const manualRetry = () => retryTicketMutation(
      documentObject,
      state,
      adapter,
      closeDialog,
      renderState,
      queryCoordinator,
      renderDialog
    );
    const result = await runPreservedMutation(
      documentObject,
      state,
      adapter,
      mutation,
      true,
      manualRetry
    );
    if (!result.ok) {
      if (result.stale) {
        return;
      }
      const safeError = result.error;
      if (safeError.code === "INVALID_TRANSITION") {
        await refreshAfterInvalidTransition(
          documentObject,
          state,
          adapter,
          mutation,
          closeDialog,
          renderState,
          renderDialog
        );
        return;
      }
      if (safeError.code === "TICKET_NOT_FOUND") {
        await refreshAfterTicketNotFound(
          documentObject,
          state,
          mutation,
          queryCoordinator,
          closeDialog,
          renderState
        );
      }
      return;
    }

    state.mutation = { ...result.mutation, phase: "reconciling" };
    await reconcileSuccessfulMutation(
      documentObject,
      state,
      adapter,
      state.mutation,
      queryCoordinator,
      closeDialog,
      renderState,
      renderDialog
    );
  }

  function renderTicketDetail(documentObject, ticket, onAction) {
    const titleNode = documentObject.getElementById("dialog-title");
    const fieldsNode = documentObject.getElementById("ticket-detail-fields");
    if (!fieldsNode) {
      return;
    }
    removeChildren(fieldsNode);
    const ticketId = displayValue(ticket && ticket.id);
    if (titleNode) {
      setSafeText(titleNode, `Detalle del ticket ${ticketId}`);
    }
    appendDetailField(documentObject, fieldsNode, "ID", ticket && ticket.id);
    appendDetailField(documentObject, fieldsNode, "Título", ticket && ticket.title);
    appendDetailField(documentObject, fieldsNode, "Descripción", ticket && ticket.description);
    appendDetailField(documentObject, fieldsNode, "Categoría", getCatalogLabel(CATEGORY_CATALOG, ticket && ticket.category));
    appendDetailField(documentObject, fieldsNode, "Prioridad", getCatalogLabel(PRIORITY_CATALOG, ticket && ticket.priority));
    appendDetailField(documentObject, fieldsNode, "Estado", getCatalogLabel(STATUS_CATALOG, ticket && ticket.status));
    appendDetailField(documentObject, fieldsNode, "Solicitante", ticket && ticket.requester);
    appendDetailField(documentObject, fieldsNode, "Responsable", getTicketResponsible(ticket));
    appendDetailField(documentObject, fieldsNode, "Creado", formatDateTime(ticket && ticket.createdAt));
    appendDetailField(documentObject, fieldsNode, "Actualizado", formatDateTime(ticket && ticket.updatedAt));
    appendDetailField(documentObject, fieldsNode, "Vencimiento", formatDateTime(ticket && ticket.dueAt));
    appendDetailField(documentObject, fieldsNode, "Resuelto", formatDateTime(ticket && ticket.resolvedAt));
    appendDetailField(documentObject, fieldsNode, "Cerrado", formatDateTime(ticket && ticket.closedAt));
    appendDetailField(documentObject, fieldsNode, "Nota de resolución", ticket && ticket.resolutionNote);
    renderTicketActions(documentObject, ticket, onAction);
  }

  function getDialogFocusableElements(dialog) {
    if (!dialog || typeof dialog.querySelectorAll !== "function") {
      return [];
    }
    const candidates = dialog.querySelectorAll(
      "button, input, select, textarea, [href], [tabindex]"
    );
    return Array.from(candidates).filter((element) => {
      if (!element || element.disabled || element.hidden || element.tabIndex < 0) {
        return false;
      }
      if (element.getAttribute("aria-hidden") === "true") {
        return false;
      }
      return !(typeof element.closest === "function" && element.closest("[hidden]"));
    });
  }

  function focusDialogFallback(documentObject) {
    const fallbackIds = ["ticket-filter", "ticket-workspace-title", "panel-message"];
    for (const id of fallbackIds) {
      const fallback = documentObject && typeof documentObject.getElementById === "function"
        ? documentObject.getElementById(id)
        : null;
      if (!fallback || fallback.hidden ||
        (typeof fallback.closest === "function" && fallback.closest("[hidden]")) ||
        (id === "panel-message" && !normalizeText(fallback.textContent))) {
        continue;
      }
      if (typeof fallback.focus === "function") {
        fallback.focus();
        return true;
      }
    }
    return false;
  }

  function focusDialogReturnTarget(documentObject, state, allowInsideDialog = false) {
    const trigger = state && state.lastDialogTrigger;
    const dialog = documentObject && typeof documentObject.getElementById === "function"
      ? documentObject.getElementById("ticket-dialog")
      : null;
    const triggerIsInsideDialog = dialog && typeof dialog.contains === "function" &&
      dialog.contains(trigger);
    if (trigger && trigger.isConnected && !trigger.disabled &&
      (allowInsideDialog || !triggerIsInsideDialog) &&
      typeof trigger.focus === "function") {
      trigger.focus();
      return true;
    }

    const ticketId = state && state.dialog ? state.dialog.ticketId : "";
    const list = documentObject && documentObject.getElementById
      ? documentObject.getElementById("ticket-list")
      : null;
    if (list && typeof list.querySelectorAll === "function") {
      const detailButtons = list.querySelectorAll("button[data-ticket-detail-id]");
      const replacement = Array.from(detailButtons).find((button) =>
        button.getAttribute("data-ticket-detail-id") === ticketId && !button.disabled
      );
      if (replacement && typeof replacement.focus === "function") {
        replacement.focus();
        return true;
      }
    }
    return focusDialogFallback(documentObject);
  }

  function handleDialogKeydown(documentObject, state, dialog, closeDialog, event) {
    if (!state || !state.dialog || !dialog ||
      (typeof dialog.hasAttribute === "function" && dialog.hasAttribute("hidden"))) {
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      closeDialog();
      return;
    }

    if (event.key !== "Tab") {
      return;
    }

    const focusableElements = getDialogFocusableElements(dialog);
    if (!focusableElements.length) {
      event.preventDefault();
      if (typeof dialog.focus === "function") {
        dialog.focus();
      }
      return;
    }

    const first = focusableElements[0];
    const last = focusableElements[focusableElements.length - 1];
    const activeElement = documentObject.activeElement;
    const activeIsInside = activeElement && typeof dialog.contains === "function" &&
      dialog.contains(activeElement);

    if (event.shiftKey && (!activeIsInside || activeElement === first)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (!activeIsInside || activeElement === last)) {
      event.preventDefault();
      first.focus();
    }
  }

  function focusFirstDialogControl(documentObject, kind) {
    const controlId = kind === "assignment" ? "responsible-id"
      : kind === "resolution" ? "resolution-note" : "dialog-close";
    const control = documentObject.getElementById(controlId);
    if (control && typeof control.focus === "function" && !control.disabled) {
      control.focus();
      return true;
    }
    const dialog = documentObject.getElementById("ticket-dialog");
    const first = getDialogFocusableElements(dialog)[0];
    if (first && typeof first.focus === "function") {
      first.focus();
      return true;
    }
    if (dialog && typeof dialog.focus === "function") {
      dialog.focus();
      return true;
    }
    return false;
  }

  function focusFirstDialogError(documentObject, error) {
    if (!error || !Array.isArray(error.details)) {
      return;
    }
    const fieldIds = {
      responsibleId: "responsible-id",
      resolutionNote: "resolution-note"
    };
    const detail = error.details.find((item) => item && Array.isArray(item.path) &&
      item.path.some((part) => Object.prototype.hasOwnProperty.call(fieldIds, part)));
    if (!detail) {
      return;
    }
    const field = detail.path.find((part) => Object.prototype.hasOwnProperty.call(fieldIds, part));
    const control = documentObject.getElementById(fieldIds[field]);
    if (control && typeof control.focus === "function") {
      control.focus();
    }
  }

  function getFilterLabel(filter) {
    const selection = normalizeFilterSelection(filter);
    if (selection.kind === "STATUS") {
      return STATUS_LABELS[selection.value] || selection.value;
    }
    return selection.kind === "OVERDUE" ? "Solo vencidos" : "Todos";
  }

  function renderPanelState(documentObject, state, onAction) {
    if (!documentObject || !state) {
      return;
    }
    const filterControl = documentObject.getElementById("ticket-filter");
    if (filterControl) {
      const selectedValue = state.selectedFilter.kind === "STATUS"
        ? state.selectedFilter.value
        : state.selectedFilter.kind;
      setSafeValue(filterControl, selectedValue);
    }
    renderTicketCollection(documentObject, state, new Date(), (ticket, trigger) => {
      openTicketDetail(documentObject, state, ticket, trigger, onAction);
    });
  }

  function openTicketDetail(documentObject, state, ticket, trigger, onAction) {
    const dialog = documentObject.getElementById("ticket-dialog");
    if (!dialog || !ticket) {
      return;
    }
    setDialogMode(documentObject, "detail");
    clearDialogErrors(documentObject);
    renderTicketDetail(documentObject, ticket, onAction);
    state.dialog = { kind: "detail", ticketId: displayValue(ticket.id) };
    state.dialogDraft = createEmptyDialogDraft();
    state.lastDialogTrigger = trigger || null;
    if (typeof dialog.showModal === "function") {
      dialog.hidden = false;
      if (!dialog.open) {
        dialog.showModal();
      }
    } else {
      openFallbackModal(documentObject, dialog);
    }
    focusFirstDialogControl(documentObject, "detail");
  }

  function initializePanel(documentObject) {
    if (!documentObject || typeof documentObject.getElementById !== "function") {
      return null;
    }

    const state = createInitialState();
    const filterControl = documentObject.getElementById("ticket-filter");
    const actorControl = documentObject.getElementById("actor-id");
    const dialog = documentObject.getElementById("ticket-dialog");
    state.actorId = readStoredActorId();
    if (actorControl) {
      setSafeValue(actorControl, state.actorId);
    }
    if (filterControl) {
      setSafeValue(filterControl, "ALL");
    }

    const closeDialog = () => {
      if (state.mutation && ["loading", "reconciling", "retry-pending"].includes(state.mutation.phase)) {
        return;
      }
      if (dialog && dialog.__panelFallbackModal) {
        closeFallbackModal(documentObject, dialog);
        setDialogMode(documentObject, "detail");
        focusDialogReturnTarget(documentObject, state);
        state.dialog = null;
        state.dialogDraft = createEmptyDialogDraft();
        state.lastDialogTrigger = null;
      } else if (dialog && typeof dialog.close === "function" && dialog.open) {
        dialog.close();
      } else if (dialog) {
        dialog.hidden = true;
        setDialogMode(documentObject, "detail");
        focusDialogReturnTarget(documentObject, state);
        state.dialog = null;
        state.dialogDraft = createEmptyDialogDraft();
        state.lastDialogTrigger = null;
      }
    };

    const closeOperationDialog = () => {
      if (state.mutation && ["loading", "reconciling", "retry-pending"].includes(state.mutation.phase)) {
        return;
      }
      const operation = state.dialog && ["assignment", "resolution"].includes(state.dialog.kind)
        ? state.dialog
        : null;
      if (!operation) {
        closeDialog();
        return;
      }
      setDialogMode(documentObject, "detail");
      clearDialogErrors(documentObject);
      state.dialog = { kind: "detail", ticketId: operation.ticketId };
      state.dialogDraft = createEmptyDialogDraft();
      focusDialogReturnTarget(documentObject, state, true);
    };

    const synchronizeVisibleActor = () => {
      synchronizeActorId(state, actorControl, undefined);
      const actorErrorNode = documentObject.getElementById("actor-id-error");
      if (actorErrorNode) {
        setSafeText(actorErrorNode, "");
      }
      if (actorControl) {
        actorControl.removeAttribute("aria-invalid");
      }
    };
    if (actorControl && typeof actorControl.addEventListener === "function") {
      ["input", "change", "blur"].forEach((eventName) => {
        actorControl.addEventListener(eventName, synchronizeVisibleActor);
      });
    }

    const hasFetch = typeof globalObject.fetch === "function";
    const panelAdapter = hasFetch ? createHttpAdapter() : null;

    function renderState() {
      renderPanelState(documentObject, state, handleTicketAction);
    }

    function renderDialog(ticket) {
      if (!ticket || !state.dialog) {
        return;
      }
      const activeElement = documentObject.activeElement;
      const activeAction = activeElement && typeof activeElement.closest === "function"
        ? activeElement.closest("#dialog-actions [data-action]")
        : null;
      const activeActionName = activeAction ? activeAction.getAttribute("data-action") : "";
      renderTicketDetail(documentObject, ticket, handleTicketAction);
      if (!activeActionName) {
        return;
      }
      const actionsNode = documentObject.getElementById("dialog-actions");
      const replacement = actionsNode && typeof actionsNode.querySelectorAll === "function"
        ? Array.from(actionsNode.querySelectorAll("[data-action]")).find((button) =>
          button.getAttribute("data-action") === activeActionName && !button.disabled
        )
        : null;
      if (replacement && typeof replacement.focus === "function") {
        replacement.focus();
      } else {
        focusFirstDialogControl(documentObject, "detail");
      }
    }

    function handleTicketAction(descriptor, trigger) {
      if (!isValidAllowedTransitionDescriptor(descriptor) ||
        (state.mutation && ["loading", "reconciling", "retry-pending"].includes(state.mutation.phase))) {
        return;
      }
      const ticketId = state.dialog && state.dialog.ticketId;
      const ticket = state.tickets.find((item) => item && item.id === ticketId);
      if (!ticket) {
        setPanelMessage(documentObject, "No se encontró el ticket seleccionado.", "error");
        return;
      }
      if (descriptor.action === "ASSIGN" || descriptor.action === "RESOLVE") {
        openTicketOperationDialog(documentObject, state, ticket, descriptor, trigger);
        return;
      }
      executeTicketMutation(
        documentObject,
        state,
        panelAdapter,
        descriptor,
        closeDialog,
        renderState,
        panelQueryCoordinator,
        renderDialog
      );
    }

    if (panelAdapter) {
      panelQueryCoordinator = createQueryCoordinator({
        state,
        adapter: panelAdapter,
        documentObject,
        onChange: (currentState) => renderPanelState(
          documentObject,
          currentState,
          handleTicketAction
        )
      });
    }

    initializeCreateForm(documentObject, state, panelAdapter, panelQueryCoordinator);

    const assignmentForm = documentObject.getElementById("assignment-form");
    const resolutionForm = documentObject.getElementById("resolution-form");
    const responsibleControl = documentObject.getElementById("responsible-id");
    const resolutionControl = documentObject.getElementById("resolution-note");
    if (responsibleControl && typeof responsibleControl.addEventListener === "function") {
      responsibleControl.addEventListener("input", () => {
        state.dialogDraft.responsibleId = responsibleControl.value;
        setDialogFieldError(documentObject, "responsibleId", "");
      });
    }
    if (resolutionControl && typeof resolutionControl.addEventListener === "function") {
      resolutionControl.addEventListener("input", () => {
        state.dialogDraft.resolutionNote = resolutionControl.value;
        setDialogFieldError(documentObject, "resolutionNote", "");
      });
    }
    if (assignmentForm && typeof assignmentForm.addEventListener === "function") {
      assignmentForm.addEventListener("submit", (event) => {
        if (event && typeof event.preventDefault === "function") event.preventDefault();
        if (!state.dialog || state.dialog.kind !== "assignment") return;
        executeTicketMutation(
          documentObject,
          state,
          panelAdapter,
          state.dialog.descriptor,
          closeDialog,
          renderState,
          panelQueryCoordinator,
          renderDialog
        );
      });
    }
    if (resolutionForm && typeof resolutionForm.addEventListener === "function") {
      resolutionForm.addEventListener("submit", (event) => {
        if (event && typeof event.preventDefault === "function") event.preventDefault();
        if (!state.dialog || state.dialog.kind !== "resolution") return;
        executeTicketMutation(
          documentObject,
          state,
          panelAdapter,
          state.dialog.descriptor,
          closeDialog,
          renderState,
          panelQueryCoordinator,
          renderDialog
        );
      });
    }

    const closeButton = documentObject.getElementById("dialog-close");
    if (closeButton && typeof closeButton.addEventListener === "function") {
      closeButton.addEventListener("click", closeDialog);
    }
    ["assignment-cancel", "resolution-cancel"].forEach((id) => {
      const cancelButton = documentObject.getElementById(id);
      if (cancelButton && typeof cancelButton.addEventListener === "function") {
        cancelButton.addEventListener("click", closeOperationDialog);
      }
    });
    if (dialog && typeof dialog.addEventListener === "function") {
      dialog.addEventListener("keydown", (event) => {
        handleDialogKeydown(documentObject, state, dialog, closeDialog, event);
      });
      dialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        closeDialog();
      });
      dialog.addEventListener("close", () => {
        closeFallbackModal(documentObject, dialog);
        setDialogMode(documentObject, "detail");
        focusDialogReturnTarget(documentObject, state);
        state.dialog = null;
        state.dialogDraft = createEmptyDialogDraft();
        state.lastDialogTrigger = null;
      });
    }

    renderState();

    if (filterControl && typeof filterControl.addEventListener === "function") {
      filterControl.addEventListener("change", () => {
        synchronizeVisibleActor();
        if (panelQueryCoordinator) {
          panelQueryCoordinator.load(
            createFilterSelection(filterControl.value),
            state.actorId
          );
        }
      });
    }
    const retryButton = documentObject.getElementById("query-retry");
    if (retryButton && typeof retryButton.addEventListener === "function") {
      retryButton.addEventListener("click", () => {
        if (panelQueryCoordinator) {
          synchronizeVisibleActor();
          panelQueryCoordinator.retry();
        }
      });
    }

    if (panelQueryCoordinator) {
      panelQueryCoordinator.load("ALL", state.actorId);
    }
    return state;
  }

  let panelState = null;
  let panelQueryCoordinator = null;

  const testSurface = Object.freeze({
    get panelState() {
      return panelState;
    },
    ACTION_CATALOG,
    ACTION_LABELS,
    ACTION_CONTRACT_ERROR_MESSAGE,
    ACTION_DESCRIPTOR_CONTRACT,
    ACTOR_STORAGE_KEY,
    CATEGORY_CATALOG,
    CATEGORY_LABELS,
    DIALOG_FIELDS,
    DIALOG_KINDS,
    FILTER_CATALOG,
    MUTATION_PHASES,
    PRIORITY_CATALOG,
    PRIORITY_LABELS,
    QUERY_ERROR_MESSAGES,
    QUERY_PHASES,
    STATUS_CATALOG,
    STATUS_LABELS,
    CREATE_FIELDS,
    DEFAULT_QUERY_TIMEOUT_MS,
    OPEN_STATUS_VALUES,
    RESOLVED_STATUS_VALUES,
    PanelApiError,
    buildCreateTicketBody,
    buildCreateMutationRequest,
    buildMutationRequest,
    snapshotMutationRequest,
    calculateTicketSummary,
    createApiErrorFromBody,
    createFilterSelection,
    createHttpAdapter,
    createInitialState,
    createQueryCoordinator,
    createQueryToken,
    createSafeElement,
    createSafeTextNode,
    errorMessageForCode,
    filterKey,
    formatDateTime,
    formatRelativeDue,
    getCatalogLabel,
    isCurrentQueryToken,
    isValidTicketEnvelope,
    normalizeErrorDetails,
    normalizeFilterSelection,
    normalizeText,
    parseHttpResponse,
    parseDate,
    persistActorId,
    readStoredActorId,
    renderPanelState,
    renderTicketActions,
    renderTicketCollection,
    renderTicketDetail,
    reconcileSuccessfulMutation,
    runPreservedMutation,
    setQueryStatus,
    setSafeText,
    setSafeValue,
    showCreateApiError,
    isValidAllowedTransitionDescriptor,
    validateAllowedTransitions,
    validateCreateDraft,
    validateRequiredText
  });

  Object.defineProperty(globalObject, "TicketOpsPanelTest", {
    configurable: false,
    enumerable: false,
    value: testSurface,
    writable: false
  });

  if (globalObject.document) {
    panelState = initializePanel(globalObject.document);
  }
})(typeof globalThis === "undefined" ? this : globalThis);
