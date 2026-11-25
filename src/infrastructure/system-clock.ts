import type { Clock } from './contracts.js';

/** Production clock backed by the current system time. */
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
