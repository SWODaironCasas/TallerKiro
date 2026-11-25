import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Priority } from './types.js';
import {
  calculateDueAt,
  getSlaDurationMs,
  SLA_DURATION_MS,
} from './sla.js';
import { FixedClock } from '../test-utils/index.js';

const PRIORITIES: readonly Priority[] = [
  'CRITICA',
  'ALTA',
  'MEDIA',
  'BAJA',
];

const MAX_SLA_DURATION_MS = Math.max(...Object.values(SLA_DURATION_MS));

const validInstantArbitrary = fc
  .integer({
    min: -8_640_000_000_000_000,
    max: 8_640_000_000_000_000 - MAX_SLA_DURATION_MS,
  })
  .map((timestamp) => new Date(timestamp));

const priorityArbitrary = fc.constantFrom(...PRIORITIES);

describe('SLA due-at calculation properties', () => {
  it('calculates dueAt as createdAt plus the priority SLA for every valid instant', () => {
    // Feature: ticketops-api, Property 4: SLA y fecha de vencimiento son deterministas
    fc.assert(
      fc.property(validInstantArbitrary, priorityArbitrary, (createdAt, priority) => {
        const clock = new FixedClock(createdAt);
        const createdAtFromClock = clock.now();
        const dueAt = calculateDueAt(createdAtFromClock, priority);
        const expectedDueAt = new Date(
          createdAtFromClock.getTime() + getSlaDurationMs(priority),
        );

        expect(dueAt.getTime()).toBe(expectedDueAt.getTime());
      }),
      { numRuns: 100 },
    );
  });
});
