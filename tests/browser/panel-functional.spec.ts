import { expect, test, type Page, type Route } from './fixtures';

type Action = 'ASSIGN' | 'START' | 'RESUME' | 'WAIT' | 'RESOLVE' | 'CLOSE' | 'REOPEN';
type Ticket = Record<string, unknown> & {
  id: string;
  title: string;
  status: string;
  allowedTransitions?: unknown;
};

type ApiCall = {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
};

const NOW = '2030-01-01T12:00:00.000Z';

function descriptor(action: Action, ticketId: string): Record<string, unknown> {
  const contract: Record<Action, { targetStatus: string | null; input: string }> = {
    ASSIGN: { targetStatus: null, input: 'RESPONSIBLE_ID' },
    START: { targetStatus: 'EN_PROGRESO', input: 'NONE' },
    RESUME: { targetStatus: 'EN_PROGRESO', input: 'NONE' },
    WAIT: { targetStatus: 'EN_ESPERA', input: 'NONE' },
    RESOLVE: { targetStatus: 'RESUELTO', input: 'RESOLUTION_NOTE' },
    CLOSE: { targetStatus: 'CERRADO', input: 'NONE' },
    REOPEN: { targetStatus: 'EN_PROGRESO', input: 'NONE' },
  };
  const endpoint = action === 'ASSIGN' ? 'assignment' : 'status';
  return {
    action,
    method: 'PATCH',
    href: `/tickets/${ticketId}/${endpoint}`,
    ...contract[action],
  };
}

function ticket(
  id: string,
  overrides: Partial<Ticket> = {},
): Ticket {
  return {
    id,
    title: `Ticket ${id}`,
    description: `Descripción de ${id}`,
    category: 'ACCESOS',
    priority: 'ALTA',
    requester: 'solicitante-1',
    responsibleId: null,
    status: 'EN_PROGRESO',
    createdAt: NOW,
    updatedAt: NOW,
    dueAt: '2030-01-01T13:00:00.000Z',
    resolutionNote: null,
    resolvedAt: null,
    closedAt: null,
    overdue: false,
    overdueCycle: 0,
    escalations: [],
    supervisorNotifications: [],
    allowedTransitions: [descriptor('RESOLVE', id)],
    ...overrides,
  };
}

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function requestBody(request: { postData(): string | null }): Promise<unknown> {
  const body = request.postData();
  return body ? JSON.parse(body) : undefined;
}

async function captureApi(
  page: Page,
  handler: (route: Route, call: ApiCall) => Promise<void>,
): Promise<ApiCall[]> {
  const calls: ApiCall[] = [];
  await page.route(/\/tickets(?:\/.*|\?.*)?$/, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const call: ApiCall = {
      method: request.method(),
      path: `${url.pathname}${url.search}`,
      headers: request.headers(),
      body: await requestBody(request),
    };
    calls.push(call);
    await handler(route, call);
  });
  return calls;
}

async function openPanel(page: Page): Promise<void> {
  await page.goto('/panel/', { waitUntil: 'domcontentloaded' });
}

async function setActor(page: Page, actorId: string): Promise<void> {
  await page.locator('#actor-id').fill(actorId);
  await page.locator('#actor-id').blur();
}

async function openTicketDetail(page: Page, id: string): Promise<void> {
  await page.getByRole('button', { name: `Ver detalle del ticket ${id}` }).click();
  await expect(page.locator('#ticket-dialog')).toBeVisible();
}

// **Validates: Requirements 2.1–2.6, 4.1–4.7**
test('carga inicialmente, anuncia carga y muestra una colección vacía', async ({ panelPage }) => {
  let releaseRequest!: () => void;
  const requestReleased = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  const calls = await captureApi(panelPage, async (route, call) => {
    expect(call.method).toBe('GET');
    expect(call.path).toBe('/tickets');
    await requestReleased;
    await fulfillJson(route, []);
  });

  const navigation = openPanel(panelPage);
  await expect(panelPage.locator('#query-loading-status')).toHaveText('Cargando tickets...');
  expect(calls).toHaveLength(1);
  releaseRequest();
  await navigation;

  await expect(panelPage.locator('#query-loading-status')).toHaveText('');
  await expect(panelPage.locator('#ticket-empty-state')).toBeVisible();
  await expect(panelPage.locator('#ticket-empty-state')).toContainText('No hay tickets');
  await expect(panelPage.locator('#open-count')).toHaveText('0');
  await expect(panelPage.locator('#overdue-count')).toHaveText('0');
  await expect(panelPage.locator('#resolved-count')).toHaveText('0');
});

// **Validates: Requirements 7.1–7.7**
test('consulta filtros de estado con la ruta exacta y conserva la respuesta activa', async ({ panelPage }) => {
  const assigned = ticket('assigned', { status: 'ASIGNADO', title: 'Asignado visible' });
  const calls = await captureApi(panelPage, async (route, call) => {
    if (call.path === '/tickets') {
      await fulfillJson(route, [ticket('all')]);
      return;
    }
    expect(call.path).toBe('/tickets?status=ASIGNADO');
    expect(call.method).toBe('GET');
    expect(call.headers['x-actor-id']).toBeUndefined();
    await fulfillJson(route, [assigned]);
  });

  await openPanel(panelPage);
  await panelPage.locator('#ticket-filter').selectOption('ASIGNADO');
  await expect(panelPage.locator('#ticket-filter')).toHaveValue('ASIGNADO');
  await expect(panelPage.locator('.ticket-card-title')).toHaveText('Asignado visible');
  expect(calls.map((call) => call.path)).toEqual(['/tickets', '/tickets?status=ASIGNADO']);
});

// **Validates: Requirements 4.7, 7.5**
test('permite reintentar una consulta de red sin crear una tercera solicitud', async ({ panelPage }) => {
  let attempts = 0;
  const calls = await captureApi(panelPage, async (route, call) => {
    expect(call.path).toBe('/tickets');
    attempts += 1;
    if (attempts === 1) {
      await route.abort('failed');
      return;
    }
    await fulfillJson(route, [ticket('after-retry')]);
  });

  await openPanel(panelPage);
  await expect(panelPage.locator('#query-error-status')).toContainText('Error de conexión');
  await expect(panelPage.locator('#query-retry')).toBeVisible();
  await panelPage.locator('#query-retry').click();
  await expect(panelPage.locator('.ticket-card-title')).toHaveText('Ticket after-retry');
  expect(calls).toHaveLength(2);
});

// **Validates: Requirements 3.1–3.5, 7.4, 7.8**
test('usa Actor_Id de sessionStorage en Solo vencidos y ofrece volver a Todos ante 403', async ({ panelPage }) => {
  await panelPage.addInitScript(() => {
    window.sessionStorage.setItem('ticketops.actorId', '  supervisor-7  ');
  });
  const calls = await captureApi(panelPage, async (route, call) => {
    if (call.path === '/tickets') {
      await fulfillJson(route, []);
      return;
    }
    expect(call.path).toBe('/tickets/overdue');
    expect(call.headers['x-actor-id']).toBe('supervisor-7');
    await fulfillJson(route, {
      error: {
        code: 'SUPERVISOR_REQUIRED',
        message: 'Este actor no tiene permisos de supervisor.',
      },
    }, 403);
  });

  await openPanel(panelPage);
  await expect(panelPage.locator('#actor-id')).toHaveValue('supervisor-7');
  await setActor(panelPage, 'supervisor-7');
  await panelPage.locator('#ticket-filter').selectOption('OVERDUE');
  await expect(panelPage.locator('#query-error-status')).toContainText('no tiene permisos de supervisor');
  await expect(panelPage.locator('#ticket-filter')).toHaveValue('OVERDUE');
  const overdueCall = calls.find((call) => call.path === '/tickets/overdue');
  expect(overdueCall?.headers['x-actor-id']).toBe('supervisor-7');

  await panelPage.locator('#ticket-filter').selectOption('ALL');
  await expect(panelPage.locator('#ticket-filter')).toHaveValue('ALL');
  expect(calls.at(-1)?.path).toBe('/tickets');
});

// **Validates: Requirements 5.1–5.9, 11.3, 12.4**
test('crea un ticket con body exacto, sin responsables, y ejecuta successful_query', async ({ panelPage }) => {
  const created = ticket('created', { title: 'VPN creada', status: 'NUEVO', allowedTransitions: [] });
  const calls = await captureApi(panelPage, async (route, call) => {
    if (call.method === 'GET' && call.path === '/tickets') {
      await fulfillJson(route, calls.some((item) => item.method === 'POST') ? [created] : []);
      return;
    }
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/tickets');
    expect(call.headers['content-type']).toContain('application/json');
    await fulfillJson(route, created, 201);
  });

  await openPanel(panelPage);
  await panelPage.locator('#ticket-title').fill('  VPN creada  ');
  await panelPage.locator('#ticket-description').fill('  No conecta desde la oficina.  ');
  await panelPage.locator('#ticket-category').selectOption('ACCESOS');
  await panelPage.locator('#ticket-priority').selectOption('ALTA');
  await panelPage.locator('#ticket-requester').fill('  user-42  ');
  await panelPage.locator('#new-ticket-form').evaluate((form) => {
    (form as HTMLFormElement).requestSubmit();
  });

  await expect(panelPage.locator('#panel-message')).toHaveText('Ticket creado correctamente.');
  await expect(panelPage.locator('#ticket-title')).toHaveValue('');
  await expect(panelPage.locator('.ticket-card-title')).toHaveText('VPN creada');
  const post = calls.find((call) => call.method === 'POST');
  expect(post).toBeDefined();
  expect(post?.body).toEqual({
    title: 'VPN creada',
    description: 'No conecta desde la oficina.',
    category: 'ACCESOS',
    priority: 'ALTA',
    requester: 'user-42',
  });
  expect(Object.keys(post?.body as object)).not.toContain('responsibleId');
  expect(Object.keys(post?.body as object)).not.toContain('responsible');
  expect(Object.keys(post?.body as object)).not.toContain('responsable');
  expect(calls.map((call) => call.path)).toEqual(['/tickets', '/tickets', '/tickets']);
});

// **Validates: Requirements 6.1–6.7, 8.1–8.11, 9.1–9.6, 11.3, 15.4**
test('muestra detalle, tiempos y acciones de allowedTransitions; successful_query elimina Asignar', async ({ panelPage }) => {
  const initial = ticket('assignable', {
    title: 'Ticket asignable',
    status: 'NUEVO',
    dueAt: '2029-12-31T12:00:00.000Z',
    allowedTransitions: [descriptor('ASSIGN', 'assignable')],
  });
  const updated = ticket('assignable', {
    title: 'Ticket asignado',
    status: 'ASIGNADO',
    responsibleId: 'agent-9',
    allowedTransitions: [descriptor('START', 'assignable')],
  });
  const calls = await captureApi(panelPage, async (route, call) => {
    if (call.path === '/tickets' && call.method === 'GET') {
      await fulfillJson(route, calls.some((item) => item.path === '/tickets/assignable') ? [updated] : [initial]);
      return;
    }
    if (call.path === '/tickets/assignable' && call.method === 'GET') {
      await fulfillJson(route, updated);
      return;
    }
    expect(call.method).toBe('PATCH');
    expect(call.path).toBe('/tickets/assignable/assignment');
    expect(call.headers['x-actor-id']).toBe('operator-1');
    expect(call.headers['content-type']).toContain('application/json');
    expect(call.body).toEqual({ responsibleId: 'agent-9' });
    await fulfillJson(route, updated);
  });

  await panelPage.addInitScript(() => window.sessionStorage.setItem('ticketops.actorId', 'operator-1'));
  await openPanel(panelPage);
  await setActor(panelPage, 'operator-1');
  await openTicketDetail(panelPage, 'assignable');
  await expect(panelPage.locator('#ticket-detail-fields')).toContainText('No disponible');
  await expect(panelPage.getByRole('button', { name: 'Asignar ticket assignable' })).toBeVisible();
  await panelPage.getByRole('button', { name: 'Asignar ticket assignable' }).click();
  await panelPage.locator('#responsible-id').fill(' agent-9 ');
  await panelPage.locator('#assignment-form').evaluate((form) => {
    (form as HTMLFormElement).requestSubmit();
  });

  await expect(panelPage.locator('#panel-message')).toHaveText('Ticket asignado correctamente.');
  expect(calls.map((call) => call.path)).toEqual([
    '/tickets',
    '/tickets/assignable/assignment',
    '/tickets',
    '/tickets/assignable',
  ]);
  await openTicketDetail(panelPage, 'assignable');
  await expect(panelPage.getByRole('button', { name: 'Iniciar ticket assignable' })).toBeVisible();
  await expect(panelPage.getByRole('button', { name: 'Asignar ticket assignable' })).toHaveCount(0);
});

// **Validates: Requirements 10.1–10.5, 11.3**
test('resuelve con nota obligatoria y body exacto incluyendo successful_query', async ({ panelPage }) => {
  const initial = ticket('resolvable', {
    status: 'EN_PROGRESO',
    allowedTransitions: [descriptor('RESOLVE', 'resolvable')],
  });
  const updated = ticket('resolvable', {
    status: 'RESUELTO',
    resolutionNote: 'Se restableció la conexión.',
    resolvedAt: NOW,
    allowedTransitions: [descriptor('CLOSE', 'resolvable')],
  });
  const calls = await captureApi(panelPage, async (route, call) => {
    if (call.path === '/tickets' && call.method === 'GET') {
      await fulfillJson(route, calls.some((item) => item.path === '/tickets/resolvable') ? [updated] : [initial]);
      return;
    }
    if (call.path === '/tickets/resolvable' && call.method === 'GET') {
      await fulfillJson(route, updated);
      return;
    }
    expect(call.method).toBe('PATCH');
    expect(call.path).toBe('/tickets/resolvable/status');
    expect(call.headers['x-actor-id']).toBe('operator-2');
    expect(call.body).toEqual({
      status: 'RESUELTO',
      resolutionNote: 'Se restableció la conexión.',
    });
    await fulfillJson(route, updated);
  });

  await panelPage.addInitScript(() => window.sessionStorage.setItem('ticketops.actorId', 'operator-2'));
  await openPanel(panelPage);
  await setActor(panelPage, 'operator-2');
  await openTicketDetail(panelPage, 'resolvable');
  await panelPage.getByRole('button', { name: 'Resolver ticket resolvable' }).click();
  await panelPage.locator('#resolution-note').fill(' Se restableció la conexión. ');
  await panelPage.locator('#resolution-form').evaluate((form) => {
    (form as HTMLFormElement).requestSubmit();
  });

  await expect(panelPage.locator('#panel-message')).toHaveText('Ticket resuelto correctamente.');
  expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({
    status: 'RESUELTO',
    resolutionNote: 'Se restableció la conexión.',
  });
  await openTicketDetail(panelPage, 'resolvable');
  await expect(panelPage.locator('#ticket-detail-fields')).toContainText('Se restableció la conexión.');
  await expect(panelPage.getByRole('button', { name: 'Resolver ticket resolvable' })).toHaveCount(0);
});

// **Validates: Requirements 10.6, 15.4**
test('una transición inválida reconsulta el ticket y elimina acciones obsoletas', async ({ panelPage }) => {
  const initial = ticket('invalid', {
    allowedTransitions: [descriptor('WAIT', 'invalid')],
  });
  const refreshed = ticket('invalid', {
    allowedTransitions: [descriptor('RESOLVE', 'invalid')],
  });
  const calls = await captureApi(panelPage, async (route, call) => {
    if (call.path === '/tickets' && call.method === 'GET') {
      await fulfillJson(route, [initial]);
      return;
    }
    if (call.path === '/tickets/invalid' && call.method === 'GET') {
      await fulfillJson(route, refreshed);
      return;
    }
    expect(call.path).toBe('/tickets/invalid/status');
    await fulfillJson(route, {
      error: { code: 'INVALID_TRANSITION', message: 'La transición ya no es válida.' },
    }, 409);
  });

  await panelPage.addInitScript(() => window.sessionStorage.setItem('ticketops.actorId', 'operator-3'));
  await openPanel(panelPage);
  await setActor(panelPage, 'operator-3');
  await openTicketDetail(panelPage, 'invalid');
  await panelPage.getByRole('button', { name: 'Poner en espera ticket invalid' }).click();

  await expect(panelPage.locator('#panel-message')).toHaveText('El ticket cambió y la acción ya no es válida.');
  await expect(panelPage.getByRole('button', { name: 'Poner en espera ticket invalid' })).toHaveCount(0);
  await expect(panelPage.getByRole('button', { name: 'Resolver ticket invalid' })).toBeVisible();
  expect(calls.map((call) => call.path)).toEqual([
    '/tickets',
    '/tickets/invalid/status',
    '/tickets/invalid',
  ]);
});

// **Validates: Requirements 11.1, 11.3**
test('un ticket inexistente cierra el detalle, informa el error y actualiza la lista', async ({ panelPage }) => {
  const existing = ticket('missing', { allowedTransitions: [descriptor('CLOSE', 'missing')] });
  let listReads = 0;
  const calls = await captureApi(panelPage, async (route, call) => {
    if (call.path === '/tickets' && call.method === 'GET') {
      listReads += 1;
      await fulfillJson(route, listReads === 1 ? [existing] : []);
      return;
    }
    expect(call.path).toBe('/tickets/missing/status');
    await fulfillJson(route, {
      error: { code: 'TICKET_NOT_FOUND', message: 'Ticket no encontrado.' },
    }, 404);
  });

  await panelPage.addInitScript(() => window.sessionStorage.setItem('ticketops.actorId', 'operator-4'));
  await openPanel(panelPage);
  await setActor(panelPage, 'operator-4');
  await openTicketDetail(panelPage, 'missing');
  await panelPage.getByRole('button', { name: 'Cerrar ticket missing' }).click();

  await expect(panelPage.locator('#panel-message')).toHaveText('El ticket ya no existe.');
  await expect(panelPage.locator('#ticket-empty-state')).toBeVisible();
  await expect(panelPage.locator('#ticket-dialog')).not.toHaveAttribute('open');
  expect(calls.map((call) => call.path)).toEqual([
    '/tickets',
    '/tickets/missing/status',
    '/tickets',
  ]);
});

// **Validates: Requirements 6.1–6.6, 8.1–8.10**
test('presenta vencimiento textual, detalle con fallbacks y error de contrato sin botones', async ({ panelPage }) => {
  const overdue = ticket('overdue', {
    title: 'Ticket vencido',
    dueAt: '2029-12-31T12:00:00.000Z',
    overdue: true,
    allowedTransitions: [],
  });
  const future = ticket('future', {
    title: 'Ticket futuro',
    dueAt: '2030-01-01T13:00:00.000Z',
    allowedTransitions: [descriptor('RESOLVE', 'future')],
  });
  const broken = ticket('broken', {
    title: 'Ticket sin acciones',
  });
  delete broken.allowedTransitions;
  await captureApi(panelPage, async (route, call) => {
    expect(call.path).toBe('/tickets');
    await fulfillJson(route, [overdue, future, broken]);
  });

  await openPanel(panelPage);
  await expect(panelPage.getByLabel('VENCIDO')).toBeVisible();
  await expect(panelPage.locator('[data-overdue="true"] .ticket-card-due')).toContainText('hace');
  await expect(panelPage.locator('.ticket-card').nth(1).locator('.ticket-card-due')).toContainText('en');

  await openTicketDetail(panelPage, 'broken');
  await expect(panelPage.locator('#ticket-detail-fields')).toContainText('No disponible');
  await expect(panelPage.locator('#dialog-actions')).toContainText('No se pudieron cargar las acciones de este ticket.');
  await expect(panelPage.locator('#dialog-actions [data-action]')).toHaveCount(0);
});

// **Validates: Requirements 4.2, 4.4, 8.10**
test('muestra error de contrato cuando la consulta no es una colección de tickets', async ({ panelPage }) => {
  const calls = await captureApi(panelPage, async (route, call) => {
    expect(call.path).toBe('/tickets');
    await fulfillJson(route, { unexpected: true });
  });

  await openPanel(panelPage);
  await expect(panelPage.locator('#query-error-status')).toContainText('La respuesta del servidor no cumple el contrato esperado.');
  expect(calls).toHaveLength(1);
  await expect(panelPage.locator('#ticket-list')).toHaveCount(1);
});
