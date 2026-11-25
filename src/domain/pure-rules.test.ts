import { describe, expect, it, vi } from 'vitest';
import {
  ALLOWED_TRANSITIONS,
  isAllowedTransition,
  isNoOpTransition,
  isReopenTransition,
  NORMAL_TRANSITIONS,
  normalizeResolutionNote,
  REOPEN_TRANSITIONS,
} from './transitions.js';
import {
  calculateDueAt,
  getSlaDurationMs,
  getSlaHours,
  SLA_DURATION_MS,
  SLA_HOURS,
} from './sla.js';
import { isOverdueAt, isTerminalStatus } from './temporal.js';
import type { Priority, TicketStatus } from './types.js';
import { FixedClock } from '../test-utils/index.js';

const PRIORITIES: readonly Priority[] = [
  'CRITICA',
  'ALTA',
  'MEDIA',
  'BAJA',
];

const STATUSES: readonly TicketStatus[] = [
  'NUEVO',
  'ASIGNADO',
  'EN_PROGRESO',
  'EN_ESPERA',
  'RESUELTO',
  'CERRADO',
];

const EXPECTED_NORMAL_TRANSITIONS = [
  ['NUEVO', 'ASIGNADO'],
  ['ASIGNADO', 'EN_PROGRESO'],
  ['EN_PROGRESO', 'EN_ESPERA'],
  ['EN_ESPERA', 'EN_PROGRESO'],
  ['EN_PROGRESO', 'RESUELTO'],
  ['EN_ESPERA', 'RESUELTO'],
  ['RESUELTO', 'CERRADO'],
] as const;

const EXPECTED_REOPEN_TRANSITIONS = [
  ['RESUELTO', 'EN_PROGRESO'],
  ['CERRADO', 'EN_PROGRESO'],
] as const;

// Feature: ticketops-api, Task 2.9: pruebas unitarias de las reglas puras del dominio

describe('pure domain rules', () => {
  it('exposes the exact priority SLA catalog in hours and milliseconds', () => {
    expect(Object.keys(SLA_HOURS)).toEqual(PRIORITIES);
    expect(SLA_HOURS).toEqual({
      CRITICA: 4,
      ALTA: 8,
      MEDIA: 24,
      BAJA: 72,
    });
    expect(SLA_DURATION_MS).toEqual({
      CRITICA: 4 * 60 * 60 * 1000,
      ALTA: 8 * 60 * 60 * 1000,
      MEDIA: 24 * 60 * 60 * 1000,
      BAJA: 72 * 60 * 60 * 1000,
    });

    for (const priority of PRIORITIES) {
      expect(getSlaHours(priority)).toBe(SLA_HOURS[priority]);
      expect(getSlaDurationMs(priority)).toBe(SLA_DURATION_MS[priority]);
    }
  });

  it('exposes the exact normal, reopening, and combined transition tables', () => {
    expect(NORMAL_TRANSITIONS).toEqual(EXPECTED_NORMAL_TRANSITIONS);
    expect(REOPEN_TRANSITIONS).toEqual(EXPECTED_REOPEN_TRANSITIONS);
    expect(ALLOWED_TRANSITIONS).toEqual([
      ...EXPECTED_NORMAL_TRANSITIONS,
      ...EXPECTED_REOPEN_TRANSITIONS,
    ]);

    for (const [from, to] of EXPECTED_NORMAL_TRANSITIONS) {
      expect(isAllowedTransition(from, to)).toBe(true);
      expect(isReopenTransition(from, to)).toBe(false);
    }

    for (const [from, to] of EXPECTED_REOPEN_TRANSITIONS) {
      expect(isAllowedTransition(from, to)).toBe(true);
      expect(isReopenTransition(from, to)).toBe(true);
    }
  });

  it('treats every same-state request as a no-op, not an allowed transition', () => {
    for (const status of STATUSES) {
      expect(isNoOpTransition(status, status)).toBe(true);
      expect(isAllowedTransition(status, status)).toBe(false);
    }
  });

  it('normalizes resolution notes by trimming only the outer whitespace', () => {
    expect(normalizeResolutionNote('  VPN reiniciada correctamente  ')).toBe(
      'VPN reiniciada correctamente',
    );
    expect(normalizeResolutionNote('\t\n')).toBe('');
    expect(normalizeResolutionNote('nota  con  espacios')).toBe(
      'nota  con  espacios',
    );
  });

  it('calculates dueAt from an injected fixed instant without mutating createdAt', () => {
    const clock = new FixedClock(new Date('2025-01-01T12:00:00.000Z'));
    const createdAt = clock.now();
    const dueAt = calculateDueAt(createdAt, 'ALTA');

    expect(dueAt).not.toBe(createdAt);
    expect(createdAt.toISOString()).toBe('2025-01-01T12:00:00.000Z');
    expect(dueAt.toISOString()).toBe('2025-01-01T20:00:00.000Z');
  });

  it.each<Priority>(PRIORITIES)(
    'uses the catalog duration for %s date calculations',
    (priority) => {
      const createdAt = new Date('2025-01-01T00:00:00.000Z');
      const dueAt = calculateDueAt(createdAt, priority);

      expect(dueAt.getTime()).toBe(
        createdAt.getTime() + SLA_DURATION_MS[priority],
      );
    },
  );

  it.each<Exclude<TicketStatus, 'RESUELTO' | 'CERRADO'>>([
    'NUEVO',
    'ASIGNADO',
    'EN_PROGRESO',
    'EN_ESPERA',
  ])(
    'uses strict comparison at dueAt - 1, dueAt, and dueAt + 1 for %s',
    (status) => {
      const dueAt = new Date('2025-01-01T08:00:00.000Z');

      expect(
        isOverdueAt(new Date(dueAt.getTime() - 1), dueAt, status),
      ).toBe(false);
      expect(isOverdueAt(new Date(dueAt), dueAt, status)).toBe(false);
      expect(
        isOverdueAt(new Date(dueAt.getTime() + 1), dueAt, status),
      ).toBe(true);
    },
  );

  it.each<Extract<TicketStatus, 'RESUELTO' | 'CERRADO'>>([
    'RESUELTO',
    'CERRADO',
  ])('never marks terminal status %s as overdue', (status) => {
    const dueAt = new Date('2025-01-01T08:00:00.000Z');

    expect(isTerminalStatus(status)).toBe(true);
    expect(isOverdueAt(new Date(dueAt.getTime() + 1), dueAt, status)).toBe(
      false,
    );
  });

  it('runs pure rules with explicit dates and without global Date.now', () => {
    vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('Pure domain rules must not call global Date.now');
    });

    const clock = new FixedClock(new Date('2025-01-01T00:00:00.000Z'));
    const createdAt = clock.now();
    const dueAt = calculateDueAt(createdAt, 'CRITICA');

    expect(normalizeResolutionNote('  nota  ')).toBe('nota');
    expect(isAllowedTransition('NUEVO', 'ASIGNADO')).toBe(true);
    expect(isOverdueAt(new Date(dueAt.getTime() + 1), dueAt, 'NUEVO')).toBe(
      true,
    );
  });
});
