import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

type Action = 'ASSIGN' | 'START' | 'RESUME' | 'WAIT' | 'RESOLVE' | 'CLOSE' | 'REOPEN';
type Outcome = 'success' | 'stale' | 'failed';
type Input = 'RESPONSIBLE_ID' | 'NONE' | 'RESOLUTION_NOTE';

type Descriptor = {
  action: Action;
  method: 'PATCH';
  href: string;
  targetStatus: string | null;
  input: Input;
};

type Ticket = {
  id: string;
  status: string;
  allowedTransitions: Descriptor[];
};

type Mutation = {
  phase: string;
  action: Action;
  ticketId: string;
};

type PanelState = {
  actorId: string;
  tickets: Ticket[];
  selectedFilter: { kind: string; value?: string };
  query: {
    phase: string;
    active: unknown;
    error: unknown;
    sequence: number;
  };
  mutation: Mutation | null;
};

type QueryCoordinator = {
  load: (filter: unknown, actorId?: string, options?: { apply?: boolean }) => Promise<unknown>;
  commit: (token: unknown, tickets: Ticket[], options?: { notify?: boolean }) => unknown;
  fail: (token: unknown, error: unknown) => unknown;
  state: PanelState;
};

class FakeElement {
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  readonly dataset: Record<string, string> = {};
  textContent = '';
  className = '';
  disabled = false;
  hidden = false;
  type = '';
  id = '';

  constructor(readonly tagName: string) {}

  get firstChild(): FakeElement | undefined {
    return this.children[0];
  }

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }

  removeChild(child: FakeElement): FakeElement {
    const index = this.children.indexOf(child);
    if (index < 0) {
      throw new Error('The child is not attached to this element.');
    }
    this.children.splice(index, 1);
    return child;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  addEventListener(): void {
    // Event wiring is outside this property; the render surface only needs a DOM-shaped node.
  }

  querySelectorAll(selector: string): FakeElement[] {
    return selector === 'button'
      ? this.children.filter((child) => child.tagName === 'button')
      : [];
  }
}

class FakeDocument {
  readonly nodes = new Map<string, FakeElement>();

  constructor() {
    [
      'dialog-close',
      'assignment-submit',
      'assignment-cancel',
      'resolution-submit',
      'resolution-cancel',
      'responsible-id',
      'resolution-note',
      'dialog-actions',
      'panel-message',
      'notification-region',
      'assignment-form-errors',
      'resolution-form-errors',
    ].forEach((id) => {
      const node = new FakeElement(id === 'dialog-actions' ? 'div' : 'span');
      node.id = id;
      this.nodes.set(id, node);
    });
  }

  getElementById(id: string): FakeElement | null {
    return this.nodes.get(id) ?? null;
  }

  createElement(tagName: string): FakeElement {
    return new FakeElement(tagName);
  }

  createTextNode(value: string): FakeElement {
    const node = new FakeElement('#text');
    node.textContent = value;
    return node;
  }
}

type PanelTestSurface = {
  readonly ACTION_DESCRIPTOR_CONTRACT: Readonly<
    Record<Action, { targetStatus: string | null; input: Input }>
  >;
  readonly PanelApiError: new (options: {
    code: string;
    message: string;
    retryable: boolean;
    kind: string;
  }) => Error;
  createInitialState: () => PanelState;
  createQueryCoordinator: (options: {
    state: PanelState;
    adapter: {
      getTickets: (
        filter: unknown,
        actorId: string,
        options: { signal: unknown },
      ) => Promise<Ticket[]>;
    };
    AbortControllerImpl: new () => { signal: { aborted: boolean }; abort: () => void };
  }) => QueryCoordinator;
  reconcileSuccessfulMutation: (
    documentObject: FakeDocument,
    state: PanelState,
    adapter: { getTicket: (ticketId: string, options?: { signal?: unknown }) => Promise<Ticket> },
    mutation: Mutation,
    queryCoordinator: QueryCoordinator,
    closeDialog: () => void,
    renderState: () => void,
    renderDialog: (ticket: Ticket) => void,
  ) => Promise<boolean>;
  renderTicketActions: (
    documentObject: FakeDocument,
    ticket: Ticket,
  ) => { valid: boolean; descriptors: Descriptor[] };
};

class TestAbortController {
  readonly signal = { aborted: false };

  abort(): void {
    this.signal.aborted = true;
  }
}

function loadPanelTestSurface(): PanelTestSurface {
  const panelScript = readFileSync(
    new URL('../../public/panel/panel.js', import.meta.url),
    'utf8',
  );
  const context: Record<string, unknown> = {};
  runInNewContext(panelScript, context, { filename: 'public/panel/panel.js' });
  return context.TicketOpsPanelTest as PanelTestSurface;
}

const panel = loadPanelTestSurface();
const actions: readonly Action[] = [
  'ASSIGN',
  'START',
  'RESUME',
  'WAIT',
  'RESOLVE',
  'CLOSE',
  'REOPEN',
];

function descriptorFor(action: Action): Descriptor {
  const contract = panel.ACTION_DESCRIPTOR_CONTRACT[action];
  return {
    action,
    method: 'PATCH',
    href: action === 'ASSIGN' ? '/tickets/ticket-1/assignment' : '/tickets/ticket-1/status',
    targetStatus: contract.targetStatus,
    input: contract.input,
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (error: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function actionValues(documentObject: FakeDocument): Action[] {
  const actionsNode = documentObject.getElementById('dialog-actions');
  return (actionsNode?.querySelectorAll('button') ?? []).map((button) =>
    button.getAttribute('data-action') as Action,
  );
}

function allMutationControlsDisabled(documentObject: FakeDocument): boolean {
  const controlIds = [
    'dialog-close',
    'assignment-submit',
    'assignment-cancel',
    'resolution-submit',
    'resolution-cancel',
    'responsible-id',
    'resolution-note',
  ];
  const controls = controlIds.map((id) => documentObject.getElementById(id));
  const actionButtons = documentObject.getElementById('dialog-actions')?.querySelectorAll('button') ?? [];
  return [...controls, ...actionButtons].every((control) => control?.disabled === true);
}

type Scenario = {
  oldActions: Action[];
  currentActions: Action[];
  outcome: Outcome;
};

const scenarioArbitrary = fc.subarray(actions, { minLength: 1 }).chain((oldActions) =>
  fc.record({
    currentActions: fc.subarray(oldActions),
    outcome: fc.constantFrom<Outcome>('success', 'stale', 'failed'),
  }).map(({ currentActions, outcome }) => ({ oldActions, currentActions, outcome })),
);

function networkError(panelSurface: PanelTestSurface): Error {
  return new panelSurface.PanelApiError({
    code: 'NETWORK_ERROR',
    message: 'No se pudo conectar con TicketOps.',
    retryable: true,
    kind: 'network',
  });
}

// Feature: ticketops-panel, Property 13: `successful_query` precede la reactivación
// **Validates: Requirements 10.5, 11.3, 15.4**

describe('Property 13: successful_query precede la reactivación', () => {
  it('bloquea acciones durante la reconciliación y sólo aplica la representación vigente', async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArbitrary, async ({ oldActions, currentActions, outcome }: Scenario) => {
        const oldTicket: Ticket = {
          id: 'ticket-1',
          status: 'EN_PROGRESO',
          allowedTransitions: oldActions.map(descriptorFor),
        };
        const currentTicket: Ticket = {
          id: oldTicket.id,
          status: 'RESUELTO',
          allowedTransitions: currentActions.map(descriptorFor),
        };
        const state = panel.createInitialState();
        state.tickets = [oldTicket];
        state.mutation = {
          phase: 'reconciling',
          action: oldActions[0],
          ticketId: oldTicket.id,
        };
        const mutation = state.mutation;
        const documentObject = new FakeDocument();
        panel.renderTicketActions(documentObject, oldTicket);
        documentObject.getElementById('dialog-actions')?.querySelectorAll('button')
          .forEach((button) => { button.disabled = true; });
        [
          'dialog-close',
          'assignment-submit',
          'assignment-cancel',
          'resolution-submit',
          'resolution-cancel',
          'responsible-id',
          'resolution-note',
        ].forEach((id) => {
          const control = documentObject.getElementById(id);
          if (control) control.disabled = true;
        });

        const listResponse = deferred<Ticket[]>();
        const detailResponse = deferred<Ticket>();
        let requestNumber = 0;
        const coordinatorHolder: { current?: QueryCoordinator } = {};
        const adapter = {
          getTickets: () => {
            requestNumber += 1;
            if (requestNumber === 1 && outcome === 'success') {
              return listResponse.promise;
            }
            if (requestNumber === 1 && outcome === 'failed') {
              return Promise.reject(networkError(panel));
            }
            if (requestNumber === 1 && outcome === 'stale') {
              void coordinatorHolder.current?.load('CERRADO');
              return Promise.resolve([oldTicket]);
            }
            return Promise.resolve([oldTicket]);
          },
          getTicket: () => outcome === 'success'
            ? detailResponse.promise
            : Promise.resolve(currentTicket),
        };
        const coordinator = panel.createQueryCoordinator({
          state,
          adapter,
          AbortControllerImpl: TestAbortController,
        });
        coordinatorHolder.current = coordinator;

        let renderCount = 0;
        const reconciliation = panel.reconcileSuccessfulMutation(
          documentObject,
          state,
          adapter,
          mutation,
          coordinator,
          () => undefined,
          () => {
            renderCount += 1;
            const ticket = state.tickets[0];
            if (ticket) panel.renderTicketActions(documentObject, ticket);
          },
          () => undefined,
        );

        expect(state.mutation?.phase).toBe('reconciling');
        expect(allMutationControlsDisabled(documentObject)).toBe(true);
        expect(actionValues(documentObject)).toEqual(oldActions);

        if (outcome === 'success') {
          listResponse.resolve([currentTicket]);
          detailResponse.resolve(currentTicket);
        }

        const reconciled = await reconciliation;

        if (outcome === 'success') {
          expect(reconciled).toBe(true);
          expect(state.mutation).toBeNull();
          expect(state.tickets).toEqual([currentTicket]);
          expect(actionValues(documentObject)).toEqual(currentActions);
          expect(actionValues(documentObject).filter((action) => !currentActions.includes(action))).toEqual([]);
          expect(allMutationControlsDisabled(documentObject)).toBe(false);
          expect(renderCount).toBe(1);
        } else {
          expect(reconciled).toBe(false);
          expect(state.mutation?.phase).toBe('error');
          expect(allMutationControlsDisabled(documentObject)).toBe(true);
          expect(actionValues(documentObject)).toEqual(oldActions);
          expect(state.tickets).toEqual([oldTicket]);
          expect(renderCount).toBe(0);
        }
      }),
      { numRuns: 100 },
    );
  });
});
