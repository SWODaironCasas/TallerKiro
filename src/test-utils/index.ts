import type { Express } from 'express';
import request from 'supertest';
import { vi } from 'vitest';

export type DependencyFactories<T extends Record<string, () => unknown>> = T;

export type IsolatedDependencies<T extends Record<string, () => unknown>> = {
  [Key in keyof T]: ReturnType<T[Key]>;
};

/**
 * Creates a fresh dependency graph from factories for each test.
 *
 * Factories are evaluated exactly once per call, so stateful stores, clocks,
 * directories, and notifiers are not shared accidentally between tests.
 */
export function createIsolatedDependencies<
  T extends Record<string, () => unknown>,
>(factories: T): IsolatedDependencies<T> {
  const dependencies = {} as IsolatedDependencies<T>;

  for (const key of Object.keys(factories) as Array<keyof T>) {
    const factory = factories[key] as () => ReturnType<T[typeof key]>;
    dependencies[key] = factory();
  }

  return dependencies;
}

export interface Clock {
  now(): Date;
}

/**
 * Deterministic clock for unit and integration tests.
 * Dates are copied on input and output so callers cannot mutate the clock.
 */
export class FixedClock implements Clock {
  private current: Date;

  constructor(current: Date) {
    this.assertValidDate(current);
    this.current = new Date(current);
  }

  now(): Date {
    return new Date(this.current);
  }

  set(current: Date): void {
    this.assertValidDate(current);
    this.current = new Date(current);
  }

  advanceBy(milliseconds: number): void {
    if (!Number.isFinite(milliseconds)) {
      throw new TypeError('Clock increments must be finite numbers');
    }

    this.set(new Date(this.current.getTime() + milliseconds));
  }

  private assertValidDate(value: Date): void {
    if (Number.isNaN(value.getTime())) {
      throw new TypeError('FixedClock requires a valid date');
    }
  }
}

/**
 * Restores Vitest mocks, timers, globals, and environment stubs.
 * This is also installed globally by the Vitest setup file.
 */
export function restoreTestEnvironment(): void {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
}

/**
 * Creates a Supertest client from an Express app factory without calling
 * listen. The factory is invoked only when the client is created.
 */
export function requestFromApp(createApp: () => Express) {
  return request(createApp());
}

/**
 * Creates a Supertest client for an already-created Express app without
 * opening a network port.
 */
export function requestAgainstApp(app: Express) {
  return request(app);
}
