import { randomUUID } from 'node:crypto';
import type { IdGenerator } from './contracts.js';

/** Production identifier generator backed by Node's cryptographic UUID source. */
export class RandomUuidGenerator implements IdGenerator {
  next(): string {
    return randomUUID();
  }
}

/** Shared production generator for dependency injection defaults. */
export const randomUuidGenerator: IdGenerator = new RandomUuidGenerator();
