import { describe, expect, it } from 'vitest';
import {
  ALLOWED_TRANSITIONS,
  isAllowedTransition,
  isReopenTransition,
  type TicketStatus,
} from '../domain/index.js';
import { calculateAllowedTransitions } from './allowed-transitions.js';

const EXPECTED_ACTIONS: Record<TicketStatus, string[]> = {
  NUEVO: ['ASSIGN'],
  ASIGNADO: ['ASSIGN', 'START'],
  EN_PROGRESO: ['ASSIGN', 'WAIT', 'RESOLVE'],
  EN_ESPERA: ['ASSIGN', 'RESUME', 'RESOLVE'],
  RESUELTO: ['ASSIGN', 'CLOSE', 'REOPEN'],
  CERRADO: ['ASSIGN', 'REOPEN'],
};

describe('calculateAllowedTransitions', () => {
  it('exposes the assignment operation and state actions allowed by the domain', () => {
    for (const [status, actions] of Object.entries(EXPECTED_ACTIONS) as [
      TicketStatus,
      string[],
    ][]) {
      expect(
        calculateAllowedTransitions({ id: 'ticket-1', status }).map(
          (descriptor) => descriptor.action,
        ),
      ).toEqual(actions);
    }
  });

  it('describes assignment with its own endpoint and no target status', () => {
    const [assignment] = calculateAllowedTransitions({
      id: 'ticket/1',
      status: 'NUEVO',
    });

    expect(assignment).toEqual({
      action: 'ASSIGN',
      method: 'PATCH',
      href: '/tickets/ticket%2F1/assignment',
      targetStatus: null,
      input: 'RESPONSIBLE_ID',
    });
  });

  it('uses the status endpoint and the correct input for every state action', () => {
    const descriptors = calculateAllowedTransitions({
      id: 'ticket-1',
      status: 'EN_PROGRESO',
    });

    expect(descriptors).toEqual([
      {
        action: 'ASSIGN',
        method: 'PATCH',
        href: '/tickets/ticket-1/assignment',
        targetStatus: null,
        input: 'RESPONSIBLE_ID',
      },
      {
        action: 'WAIT',
        method: 'PATCH',
        href: '/tickets/ticket-1/status',
        targetStatus: 'EN_ESPERA',
        input: 'NONE',
      },
      {
        action: 'RESOLVE',
        method: 'PATCH',
        href: '/tickets/ticket-1/status',
        targetStatus: 'RESUELTO',
        input: 'RESOLUTION_NOTE',
      },
    ]);
  });

  it('marks reopening transitions as REOPEN while keeping their target status', () => {
    expect(calculateAllowedTransitions({ id: 'ticket-1', status: 'RESUELTO' })).toContainEqual({
      action: 'REOPEN',
      method: 'PATCH',
      href: '/tickets/ticket-1/status',
      targetStatus: 'EN_PROGRESO',
      input: 'NONE',
    });
    expect(calculateAllowedTransitions({ id: 'ticket-1', status: 'CERRADO' })).toContainEqual({
      action: 'REOPEN',
      method: 'PATCH',
      href: '/tickets/ticket-1/status',
      targetStatus: 'EN_PROGRESO',
      input: 'NONE',
    });
  });

  it('emits only relative PATCH routes', () => {
    for (const status of Object.keys(EXPECTED_ACTIONS) as TicketStatus[]) {
      for (const descriptor of calculateAllowedTransitions({
        id: 'ticket-1',
        status,
      })) {
        expect(descriptor.method).toBe('PATCH');
        expect(descriptor.href.startsWith('/')).toBe(true);
        expect(descriptor.href).not.toMatch(/^https?:\/\//);
      }
    }
  });
});


describe('allowed transition descriptor invariants', () => {
  it('derives every state descriptor from the domain transition rules', () => {
    for (const status of Object.keys(EXPECTED_ACTIONS) as TicketStatus[]) {
      const descriptors = calculateAllowedTransitions({
        id: 'ticket-1',
        status,
      });
      const statusDescriptors = descriptors.filter(
        (descriptor) => descriptor.action !== 'ASSIGN',
      );
      const expectedTargets = ALLOWED_TRANSITIONS.filter(
        ([from, target]) =>
          from === status && !(from === 'NUEVO' && target === 'ASIGNADO'),
      ).map(([, target]) => target);

      expect(
        statusDescriptors.map((descriptor) => descriptor.targetStatus),
      ).toEqual(expectedTargets);

      for (const descriptor of statusDescriptors) {
        const target = descriptor.targetStatus;
        expect(target).not.toBeNull();
        expect(isAllowedTransition(status, target as TicketStatus)).toBe(true);
        expect(descriptor.action === 'REOPEN').toBe(
          isReopenTransition(status, target as TicketStatus),
        );
      }
    }
  });

  it('does not emit descriptors with invalid operation fields or actions', () => {
    const validActions = new Set([
      'ASSIGN',
      'START',
      'RESUME',
      'WAIT',
      'RESOLVE',
      'CLOSE',
      'REOPEN',
    ]);
    const validInputs = new Set(['RESPONSIBLE_ID', 'NONE', 'RESOLUTION_NOTE']);

    for (const status of Object.keys(EXPECTED_ACTIONS) as TicketStatus[]) {
      const descriptors = calculateAllowedTransitions({
        id: 'ticket-1',
        status,
      });

      expect(new Set(descriptors.map((descriptor) => descriptor.action)).size).toBe(
        descriptors.length,
      );

      for (const descriptor of descriptors) {
        expect(validActions.has(descriptor.action)).toBe(true);
        expect(descriptor.method).toBe('PATCH');
        expect(validInputs.has(descriptor.input)).toBe(true);
        expect(descriptor.href).toMatch(/^\/tickets\/[^/]+\/(assignment|status)$/);
        expect(descriptor.href).not.toMatch(/^\/\//);
        expect(descriptor.href).not.toMatch(/^[a-z]+:\/\//i);

        if (descriptor.action === 'ASSIGN') {
          expect(descriptor.href).toBe('/tickets/ticket-1/assignment');
          expect(descriptor.targetStatus).toBeNull();
          expect(descriptor.input).toBe('RESPONSIBLE_ID');
        } else {
          expect(descriptor.href).toBe('/tickets/ticket-1/status');
          expect(descriptor.targetStatus).not.toBeNull();
          expect(descriptor.input).toBe(
            descriptor.action === 'RESOLVE' ? 'RESOLUTION_NOTE' : 'NONE',
          );
        }
      }
    }
  });
});
