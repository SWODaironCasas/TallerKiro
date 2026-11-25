import express from 'express';
import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import {
  createIsolatedDependencies,
  FixedClock,
  requestFromApp,
  restoreTestEnvironment,
} from './index.js';

describe('test utilities', () => {
  it('creates fresh dependency values for each factory invocation', () => {
    const first = createIsolatedDependencies({
      values: () => [] as string[],
      clock: () => new FixedClock(new Date('2025-01-01T00:00:00.000Z')),
    });
    const second = createIsolatedDependencies({
      values: () => [] as string[],
      clock: () => new FixedClock(new Date('2025-01-01T00:00:00.000Z')),
    });

    first.values.push('only-first');

    expect(second.values).toEqual([]);
    expect(first.clock).not.toBe(second.clock);
  });

  it('returns defensive dates and supports controlled time changes', () => {
    const clock = new FixedClock(new Date('2025-01-01T00:00:00.000Z'));
    const observed = clock.now();
    observed.setUTCDate(2);

    expect(clock.now().toISOString()).toBe('2025-01-01T00:00:00.000Z');

    clock.advanceBy(1_000);
    expect(clock.now().toISOString()).toBe('2025-01-01T00:00:01.000Z');

    clock.set(new Date('2025-01-02T00:00:00.000Z'));
    expect(clock.now().toISOString()).toBe('2025-01-02T00:00:00.000Z');
  });

  it('restores mocks and real timers between tests', () => {
    vi.useFakeTimers();
    const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(42);

    restoreTestEnvironment();

    expect(dateSpy).not.toHaveBeenCalled();
    expect(Date.now()).not.toBe(42);
  });

  it('supports fast-check imports for property-based test modules', () => {
    expect(fc.assert).toBeTypeOf('function');
    expect(fc.property).toBeTypeOf('function');
  });

  it('creates Supertest requests from an app factory without listening', async () => {
    const createApp = () => {
      const app = express();
      app.get('/health', (_request, response) => {
        response.json({ status: 'ok' });
      });
      return app;
    };

    const response = await requestFromApp(createApp).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });
});
