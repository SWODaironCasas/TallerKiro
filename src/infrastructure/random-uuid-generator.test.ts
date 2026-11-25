import { describe, expect, it } from 'vitest';
import { RandomUuidGenerator, randomUuidGenerator } from './random-uuid-generator.js';

describe('RandomUuidGenerator', () => {
  it('generates cryptographic UUID-shaped identifiers', () => {
    const generator = new RandomUuidGenerator();
    const identifier = generator.next();

    expect(identifier).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('exports a reusable production IdGenerator instance', () => {
    expect(randomUuidGenerator.next()).not.toBe(randomUuidGenerator.next());
  });
});
