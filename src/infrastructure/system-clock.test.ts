import { describe, expect, it, vi } from 'vitest';
import { FixedClock } from '../test-utils/index.js';
import { SystemClock } from './system-clock.js';

describe('SystemClock', () => {
  it('returns the current system time as a defensive Date value', () => {
    const systemTime = new Date('2025-03-01T12:34:56.000Z');
    vi.setSystemTime(systemTime);
    const clock = new SystemClock();

    const observed = clock.now();
    observed.setUTCFullYear(2030);

    expect(clock.now()).toEqual(systemTime);
    expect(clock.now()).not.toBe(systemTime);
  });

  it('can be replaced by a deterministic Clock implementation', () => {
    const fixedClock = new FixedClock(new Date('2025-03-01T12:34:56.000Z'));

    expect(fixedClock.now().toISOString()).toBe('2025-03-01T12:34:56.000Z');
  });
});
