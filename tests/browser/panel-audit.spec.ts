import { expect, test, type Page, type Route } from './fixtures';

type Ticket = Record<string, unknown> & {
  id: string;
  title: string;
  status: string;
  allowedTransitions?: unknown;
};

type Action = 'ASSIGN' | 'RESOLVE';

const NOW = '2030-01-01T12:00:00.000Z';

function descriptor(action: Action, ticketId: string): Record<string, unknown> {
  return action === 'ASSIGN'
    ? {
        action,
        method: 'PATCH',
        href: `/tickets/${ticketId}/assignment`,
        targetStatus: null,
        input: 'RESPONSIBLE_ID',
      }
    : {
        action,
        method: 'PATCH',
        href: `/tickets/${ticketId}/status`,
        targetStatus: 'RESUELTO',
        input: 'RESOLUTION_NOTE',
      };
}

function ticket(id: string, overrides: Partial<Ticket> = {}): Ticket {
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
    allowedTransitions: [],
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

async function openPanel(page: Page): Promise<void> {
  await page.goto('/panel/', { waitUntil: 'domcontentloaded' });
}

async function waitForInitialQuery(page: Page): Promise<void> {
  await expect(page.locator('#query-loading-status')).toHaveText('');
}

// **Validates: Requirements 12.1–12.3**
test('representa payloads de markup, atributos y entidades como texto literal', async ({ panelPage }) => {
  await panelPage.addInitScript(() => {
    (window as unknown as { __xssAudit: number }).__xssAudit = 0;
  });

  const payloads = {
    title: '<script>window.__xssAudit=1</script> &lt;entidad&gt;',
    description: '<img src="https://evil.invalid/pixel" onerror="window.__xssAudit=2"> <svg><script>window.__xssAudit=3</script></svg>',
    requester: '" autofocus onfocus="window.__xssAudit=4',
    responsibleId: '<b data-value="atributo">agente</b>',
    resolutionNote: '&lt;script&gt;window.__xssAudit=5&lt;/script&gt;',
  };
  const unsafe = ticket('unsafe', {
    title: payloads.title,
    description: payloads.description,
    requester: payloads.requester,
    responsibleId: payloads.responsibleId,
    resolutionNote: payloads.resolutionNote,
  });

  await panelPage.route(/\/tickets$/, (route) => fulfillJson(route, [unsafe]));
  await openPanel(panelPage);
  await waitForInitialQuery(panelPage);

  await expect(panelPage.locator('.ticket-card-title')).toHaveText(payloads.title);
  await expect(panelPage.locator('#ticket-list')).not.toContainText('agente');
  expect(await panelPage.locator('#ticket-list script, #ticket-list img, #ticket-list svg').count()).toBe(0);
  expect(await panelPage.evaluate(() => (window as unknown as { __xssAudit: number }).__xssAudit)).toBe(0);

  const detailButton = panelPage.getByRole('button', { name: 'Ver detalle del ticket unsafe' });
  await detailButton.click();
  await expect(panelPage.locator('#ticket-dialog')).toBeVisible();
  await expect(panelPage.locator('#ticket-detail-fields')).toContainText(payloads.description);
  await expect(panelPage.locator('#ticket-detail-fields')).toContainText(payloads.requester);
  await expect(panelPage.locator('#ticket-detail-fields')).toContainText(payloads.responsibleId);
  await expect(panelPage.locator('#ticket-detail-fields')).toContainText(payloads.resolutionNote);
  expect(await panelPage.locator('#ticket-dialog script, #ticket-dialog img, #ticket-dialog svg').count()).toBe(0);
  expect(await panelPage.evaluate(() => (window as unknown as { __xssAudit: number }).__xssAudit)).toBe(0);
});

// **Validates: Requirements 13.1, 13.3, 13.7, 13.10**
test('expone labels, aria-live, aria-describedby, aria-invalid y foco visible', async ({ panelPage }) => {
  await panelPage.route(/\/tickets$/, (route) => fulfillJson(route, []));
  await openPanel(panelPage);
  await waitForInitialQuery(panelPage);

  const labelledControls = [
    ['actor-id', 'Actor_Id'],
    ['ticket-title', 'Título'],
    ['ticket-description', 'Descripción'],
    ['ticket-category', 'Categoría'],
    ['ticket-priority', 'Prioridad'],
    ['ticket-requester', 'Solicitante'],
  ] as const;
  for (const [id, label] of labelledControls) {
    await expect(panelPage.getByLabel(label)).toHaveAttribute('id', id);
  }

  const descriptionReferences = await panelPage.locator('input, select, textarea').evaluateAll((controls) =>
    controls.map((control) => ({
      id: control.id,
      describedBy: (control.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean),
    })),
  );
  expect(descriptionReferences.length).toBeGreaterThan(0);
  for (const control of descriptionReferences) {
    expect(control.id).not.toBe('');
    for (const reference of control.describedBy) {
      expect(await panelPage.locator(`#${reference}`).count()).toBe(1);
    }
  }

  await expect(panelPage.locator('#open-count')).toHaveAttribute('aria-label', 'Abiertos: 0');
  await expect(panelPage.locator('#overdue-count')).toHaveAttribute('aria-label', 'Vencimientos: 0');
  await expect(panelPage.locator('#resolved-count')).toHaveAttribute('aria-label', 'Resueltos: 0');

  await expect(panelPage.locator('#notification-region')).not.toHaveAttribute('aria-live', /.+/);
  await expect(panelPage.locator('#panel-message')).toHaveAttribute('aria-live', 'polite');
  await expect(panelPage.locator('#query-status-region')).not.toHaveAttribute('aria-live', /.+/);
  await expect(panelPage.locator('#query-loading-status')).toHaveAttribute('role', 'status');
  await expect(panelPage.locator('#query-error-status')).toHaveAttribute('role', 'alert');

  await panelPage.locator('#new-ticket-form').evaluate((form) => {
    (form as HTMLFormElement).requestSubmit();
  });
  await expect(panelPage.locator('#ticket-title')).toHaveAttribute('aria-invalid', 'true');
  await expect(panelPage.locator('#ticket-title-error')).toHaveText('El título es obligatorio.');
  await expect(panelPage.locator('#ticket-title-error')).toHaveAttribute('role', 'alert');
  await expect(panelPage.locator('#ticket-title-error')).toHaveAttribute('aria-live', 'assertive');
  await expect(panelPage.locator('#ticket-title')).toBeFocused();

  const focusStyle = await panelPage.locator('#ticket-title').evaluate((control) => {
    const styles = getComputedStyle(control);
    return {
      isFocusVisible: control.matches(':focus-visible'),
      outlineWidth: styles.outlineWidth,
      outlineStyle: styles.outlineStyle,
      boxShadow: styles.boxShadow,
    };
  });
  expect(focusStyle.isFocusVisible).toBe(true);
  expect(Number.parseFloat(focusStyle.outlineWidth)).toBeGreaterThanOrEqual(3);
  expect(focusStyle.outlineStyle).not.toBe('none');
  expect(focusStyle.boxShadow).not.toBe('none');
});

// **Validates: Requirements 13.2, 13.5–13.6**
test('opera por teclado, mantiene el foco en el modal y lo restaura al cerrarlo', async ({ panelPage }) => {
  const modalTicket = ticket('modal', {
    allowedTransitions: [descriptor('ASSIGN', 'modal'), descriptor('RESOLVE', 'modal')],
  });
  await panelPage.route(/\/tickets$/, (route) => fulfillJson(route, [modalTicket]));
  await openPanel(panelPage);
  await waitForInitialQuery(panelPage);

  const detailTrigger = panelPage.getByRole('button', { name: 'Ver detalle del ticket modal' });
  await detailTrigger.focus();
  await panelPage.keyboard.press('Enter');
  const dialog = panelPage.locator('#ticket-dialog');
  await expect(dialog).toBeVisible();
  await expect(panelPage.locator('#dialog-title')).toHaveText('Detalle del ticket modal');
  await expect(panelPage.locator('#dialog-close')).toBeFocused();

  await panelPage.keyboard.press('Shift+Tab');
  expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  await panelPage.keyboard.press('Tab');
  await expect(panelPage.locator('#dialog-close')).toBeFocused();
  await panelPage.keyboard.press('Tab');
  expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);

  await panelPage.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(detailTrigger).toBeFocused();

  await detailTrigger.press('Enter');
  await expect(dialog).toBeVisible();
  const assignTrigger = panelPage.getByRole('button', { name: 'Asignar ticket modal' });
  await assignTrigger.focus();
  await panelPage.keyboard.press('Enter');
  await expect(panelPage.locator('#assignment-form')).toBeVisible();
  await expect(panelPage.getByLabel('ID del responsable')).toBeFocused();
  await expect(panelPage.getByRole('button', { name: 'Cancelar' })).toBeVisible();
  await panelPage.getByRole('button', { name: 'Cancelar' }).press('Enter');
  await expect(dialog).toBeVisible();
  await expect(panelPage.locator('#assignment-form')).toBeHidden();
  const restoredAssignTrigger = panelPage.getByRole('button', { name: 'Asignar ticket modal' });
  await expect(restoredAssignTrigger).toBeVisible();
  await expect(restoredAssignTrigger).toBeFocused();

  await restoredAssignTrigger.focus();
  await panelPage.keyboard.press('Enter');
  await panelPage.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(detailTrigger).toBeFocused();
});

// **Valida: Requisitos 13.2, 13.5–13.7**
test('usa un modal accesible sin showModal y restaura foco con fallback si desaparece el ticket', async ({ panelPage }) => {
  await panelPage.addInitScript(() => {
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      configurable: true,
      value: undefined,
    });
  });
  const fallbackTicket = ticket('fallback');
  await panelPage.route(/\/tickets$/, (route) => fulfillJson(route, [fallbackTicket]));
  await openPanel(panelPage);
  await waitForInitialQuery(panelPage);

  await panelPage.getByRole('button', { name: 'Ver detalle del ticket fallback' }).click();
  const dialog = panelPage.locator('#ticket-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveClass(/is-fallback-modal/);
  await expect(panelPage.locator('body')).toHaveClass(/panel-fallback-modal/);
  await expect(panelPage.locator('#panel-main')).toHaveAttribute('inert', '');
  await expect(panelPage.locator('#panel-main')).toHaveAttribute('aria-hidden', 'true');

  await panelPage.locator('.ticket-card').evaluate((node) => node.remove());
  await panelPage.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(panelPage.locator('#ticket-filter')).toBeFocused();
  await expect(panelPage.locator('#panel-main')).not.toHaveAttribute('inert', /.+/);
  await expect(panelPage.locator('#panel-main')).not.toHaveAttribute('aria-hidden', /.+/);
});

// **Valida: Requisitos 13.4, 13.8, 13.9**
test('audita contraste AA, VENCIDO textual y reduced motion', async ({ panelPage }) => {
  await panelPage.emulateMedia({ reducedMotion: 'reduce' });
  const overdue = ticket('overdue', {
    title: 'Ticket vencido',
    dueAt: '2029-12-31T12:00:00.000Z',
    overdue: true,
  });
  await panelPage.route(/\/tickets$/, (route) => fulfillJson(route, [overdue]));
  await openPanel(panelPage);
  await waitForInitialQuery(panelPage);

  await expect(panelPage.locator('.ticket-overdue-badge')).toContainText('VENCIDO');
  await expect(panelPage.locator('[aria-label="VENCIDO"]')).toContainText('VENCIDO');

  await panelPage.locator('#new-ticket-form').evaluate((form) => {
    (form as HTMLFormElement).requestSubmit();
  });
  const contrastSamples = await panelPage.evaluate(() => {
    const selectors = [
      'body',
      '.panel-header h1',
      '.header-introduction',
      '.actor-panel label',
      '.actor-panel .field-help',
      '#actor-id',
      '.field-help',
      '.field-error',
      '#panel-message',
      '#create-ticket-submit',
      '.filter-section select',
      '.ticket-overdue-badge',
    ];

    const parseColor = (value: string): [number, number, number, number] | null => {
      const channels = value.match(/[\d.]+/g)?.map((channel) => Number.parseFloat(channel)) ?? [];
      if (channels.length < 3 || channels.some((channel) => !Number.isFinite(channel))) return null;
      return [channels[0], channels[1], channels[2], channels.length === 4 ? channels[3] : 1];
    };

    const luminance = (color: [number, number, number, number]): number => {
      const linear = color.slice(0, 3).map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.03928
          ? normalized / 12.92
          : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    };

    const backgroundFor = (element: Element): [number, number, number, number] => {
      let current: Element | null = element;
      while (current) {
        const color = parseColor(getComputedStyle(current).backgroundColor);
        if (color && color[3] > 0) return color;
        current = current.parentElement;
      }
      return [255, 255, 255, 1];
    };

    return selectors.map((selector) => {
      const element = document.querySelector(selector);
      if (!element) return { selector, ratio: 0, missing: true };
      const foreground = parseColor(getComputedStyle(element).color) ?? [0, 0, 0, 1];
      const background = backgroundFor(element);
      const foregroundLuminance = luminance(foreground);
      const backgroundLuminance = luminance(background);
      return {
        selector,
        ratio: (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
          (Math.min(foregroundLuminance, backgroundLuminance) + 0.05),
        missing: false,
      };
    });
  });
  for (const sample of contrastSamples) {
    expect(sample.missing, `${sample.selector} debe existir`).toBe(false);
    expect(sample.ratio, `${sample.selector} no cumple contraste AA`).toBeGreaterThanOrEqual(4.5);
  }

  const borderSamples = await panelPage.evaluate(() => {
    const selectors = [
      '.summary-section',
      '.filter-section',
      '.new-ticket-panel',
      '.ticket-list-section',
      '.ticket-card',
      '.actor-panel',
      '.actor-panel input',
    ];

    const parseColor = (value: string): [number, number, number, number] | null => {
      const channels = value.match(/[\d.]+/g)?.map((channel) => Number.parseFloat(channel)) ?? [];
      if (channels.length < 3 || channels.some((channel) => !Number.isFinite(channel))) return null;
      return [channels[0], channels[1], channels[2], channels.length === 4 ? channels[3] : 1];
    };

    const luminance = (color: [number, number, number, number]): number => {
      const linear = color.slice(0, 3).map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.03928
          ? normalized / 12.92
          : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    };

    const ratio = (first: [number, number, number, number], second: [number, number, number, number]): number => {
      const firstLuminance = luminance(first);
      const secondLuminance = luminance(second);
      return (Math.max(firstLuminance, secondLuminance) + 0.05) /
        (Math.min(firstLuminance, secondLuminance) + 0.05);
    };

    const backgroundFor = (element: Element | null): [number, number, number, number] => {
      let current = element;
      while (current) {
        const color = parseColor(getComputedStyle(current).backgroundColor);
        if (color && color[3] > 0) return color;
        current = current.parentElement;
      }
      return [255, 255, 255, 1];
    };

    return selectors.map((selector) => {
      const element = document.querySelector(selector);
      if (!element) return { selector, missing: true, ratios: [] };
      const border = parseColor(getComputedStyle(element).borderTopColor);
      if (!border) return {
        selector,
        missing: false,
        ratios: [],
        borderColor: getComputedStyle(element).borderTopColor,
      };
      const ownBackground = backgroundFor(element);
      const adjacentBackground = backgroundFor(element.parentElement);
      return {
        selector,
        missing: false,
        ratios: [ratio(border, ownBackground), ratio(border, adjacentBackground)],
      };
    });
  });
  for (const sample of borderSamples) {
    expect(sample.missing, `${sample.selector} debe existir`).toBe(false);
    expect(sample.ratios.length, `${sample.selector} debe tener color de borde (${sample.borderColor ?? 'sin color'})`).toBe(2);
    for (const borderRatio of sample.ratios) {
      expect(borderRatio, `${sample.selector} no cumple contraste de borde 3:1`).toBeGreaterThanOrEqual(3);
    }
  }

  const motionStyles = await panelPage.evaluate(() => ({
    rootScrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
    buttonTransitionDuration: getComputedStyle(document.querySelector('button')!).transitionDuration,
    buttonAnimationName: getComputedStyle(document.querySelector('button')!).animationName,
  }));
  expect(motionStyles.rootScrollBehavior).toBe('auto');
  expect(motionStyles.buttonTransitionDuration).toBe('0s');
  expect(motionStyles.buttonAnimationName).toBe('none');
});

// **Validates: Requirements 14.1–14.5**
test('mantiene tarjetas legibles, acciones visibles y sin scroll horizontal a 375px', async ({ panelPage }) => {
  await panelPage.setViewportSize({ width: 375, height: 900 });
  const longText = 'Texto muy largo '.repeat(80);
  const responsiveTicket = ticket('responsive', {
    title: `${longText} título final`,
    description: longText,
    dueAt: '2029-12-31T12:00:00.000Z',
    overdue: true,
    allowedTransitions: [descriptor('ASSIGN', 'responsive'), descriptor('RESOLVE', 'responsive')],
  });
  await panelPage.route(/\/tickets$/, (route) => fulfillJson(route, [responsiveTicket]));
  await openPanel(panelPage);
  await waitForInitialQuery(panelPage);

  const dimensions = await panelPage.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    ticketGrid: getComputedStyle(document.querySelector('.ticket-card')!).gridTemplateColumns,
    formTop: document.querySelector('#new-ticket-panel')!.getBoundingClientRect().top,
    listTop: document.querySelector('#ticket-list-section')!.getBoundingClientRect().top,
  }));
  expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.bodyWidth).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.ticketGrid.split(' ').length).toBe(1);
  expect(dimensions.formTop).toBeLessThan(dimensions.listTop);

  const mobileOrder = await panelPage.evaluate(() => {
    const selectors = [
      '#filter-section',
      '#new-ticket-panel',
      '#ticket-workspace > .section-heading',
      '#ticket-list-section',
    ];
    const elements = selectors.map((selector) => document.querySelector(selector));
    const positions = elements.map((element) => element?.getBoundingClientRect().top ?? Number.NaN);
    const styles = elements.map((element) => element ? getComputedStyle(element) : null);
    const domOrder = elements.every((element, index) =>
      element && (index === 0 || Boolean(elements[index - 1]?.compareDocumentPosition(element) &&
        (elements[index - 1]!.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING))),
    );
    return {
      positions,
      domOrder,
      hasReorderingStyle: styles.some((style) => style?.display === 'contents' || style?.order !== '0'),
      positiveTabIndexes: Array.from(document.querySelectorAll<HTMLElement>('[tabindex]'))
        .filter((element) => element.tabIndex > 0).length,
    };
  });
  expect(mobileOrder.domOrder).toBe(true);
  expect(mobileOrder.positions.every((top, index) => index === 0 || top > mobileOrder.positions[index - 1])).toBe(true);
  expect(mobileOrder.hasReorderingStyle).toBe(false);
  expect(mobileOrder.positiveTabIndexes).toBe(0);

  const card = panelPage.locator('.ticket-card');
  await expect(card).toBeVisible();
  await expect(card.locator('.ticket-card-title')).toContainText('título final');
  await expect(card.locator('.status-badge')).toContainText('En progreso');
  await expect(card.locator('.ticket-card-due')).toContainText('hace');
  await expect(card.locator('.ticket-overdue-badge')).toContainText('VENCIDO');
  await expect(card.getByRole('button', { name: 'Ver detalle del ticket responsive' })).toBeVisible();

  await card.getByRole('button', { name: 'Ver detalle del ticket responsive' }).click();
  await expect(panelPage.locator('#ticket-dialog')).toBeVisible();
  const dialogDimensions = await panelPage.locator('#ticket-dialog .dialog-content').evaluate((node) => ({
    clientWidth: node.clientWidth,
    scrollWidth: node.scrollWidth,
  }));
  expect(dialogDimensions.scrollWidth).toBeLessThanOrEqual(dialogDimensions.clientWidth);
  await expect(panelPage.locator('#ticket-detail-fields')).toContainText('Texto muy largo');
});

// **Validates: Requirements 12.4–12.5, 15.2, 15.5**
test('no carga recursos externos ni registra datos sensibles', async ({ panelPage }) => {
  const sensitive = ticket('sensitive', {
    title: 'Título sensible <script>actor-secret</script>',
    description: 'Descripción sensible resolution-secret',
    requester: 'requester-secret',
    responsibleId: 'responsible-secret',
    resolutionNote: 'resolution-secret',
  });
  const requests: string[] = [];
  const consoleMessages: string[] = [];
  panelPage.on('request', (request) => requests.push(request.url()));
  panelPage.on('console', (message) => consoleMessages.push(message.text()));
  await panelPage.route(/\/tickets$/, (route) => fulfillJson(route, [sensitive]));
  await openPanel(panelPage);
  await waitForInitialQuery(panelPage);
  await panelPage.locator('#actor-id').fill('actor-secret');
  await panelPage.locator('#actor-id').blur();
  await panelPage.getByRole('button', { name: 'Ver detalle del ticket sensitive' }).click();
  await expect(panelPage.locator('#ticket-dialog')).toBeVisible();

  const resources = await panelPage.evaluate(() => ({
    scripts: Array.from(document.scripts).map((script) => script.src),
    stylesheets: Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map((link) => (link as HTMLLinkElement).href),
    externalElements: document.querySelectorAll('img, iframe, object, embed, video, audio, source, frame').length,
    origin: location.origin,
  }));
  expect(resources.scripts).toEqual([`${resources.origin}/panel/panel.js`]);
  expect(resources.stylesheets).toEqual([`${resources.origin}/panel/panel.css`]);
  expect(resources.externalElements).toBe(0);
  expect(requests.every((url) => new URL(url).origin === resources.origin)).toBe(true);
  expect(requests.some((url) => url.includes('evil.invalid'))).toBe(false);
  expect(consoleMessages.join('\n')).not.toContain('actor-secret');
  expect(consoleMessages.join('\n')).not.toContain('resolution-secret');
  expect(consoleMessages.join('\n')).not.toContain('Descripción sensible');

  const [javascript, stylesheet] = await Promise.all([
    panelPage.request.get('/panel/panel.js'),
    panelPage.request.get('/panel/panel.css'),
  ]);
  expect(javascript.ok()).toBe(true);
  expect(stylesheet.ok()).toBe(true);
  expect(await javascript.text()).not.toMatch(/\bimport\s+(?:["']|[^;]+\s+from\s+)/);
  expect(await stylesheet.text()).not.toMatch(/@import|https?:\/\//i);
  expect(await javascript.text()).not.toMatch(/\bconsole\s*\./);
});
