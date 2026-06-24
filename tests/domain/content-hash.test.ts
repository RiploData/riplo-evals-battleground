import { describe, it, expect } from 'vitest';
import { contentHash } from '@/domain/content-hash';

describe('contentHash', () => {
  it('returns same hash for objects with different key order', () => {
    const hash1 = contentHash({ a: 1, b: 2 });
    const hash2 = contentHash({ b: 2, a: 1 });
    expect(hash1).toBe(hash2);
  });

  it('returns different hash for different values', () => {
    const hash1 = contentHash({ a: 1 });
    const hash2 = contentHash({ a: 2 });
    expect(hash1).not.toBe(hash2);
  });

  it('returns stable hash across multiple calls', () => {
    const value = { a: 1, b: 2 };
    const hash1 = contentHash(value);
    const hash2 = contentHash(value);
    expect(hash1).toBe(hash2);
  });

  it('preserves array order', () => {
    const hash1 = contentHash([1, 2]);
    const hash2 = contentHash([2, 1]);
    expect(hash1).not.toBe(hash2);
  });

  it('returns a hex string', () => {
    const hash = contentHash({ x: 1 });
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('handles nested objects with sorted keys', () => {
    const hash1 = contentHash({ nested: { b: 2, a: 1 } });
    const hash2 = contentHash({ nested: { a: 1, b: 2 } });
    expect(hash1).toBe(hash2);
  });

  it('handles primitives', () => {
    const hashNumber = contentHash(42);
    const hashString = contentHash('hello');
    const hashBoolean = contentHash(true);
    const hashNull = contentHash(null);

    expect(hashNumber).toMatch(/^[a-f0-9]{64}$/);
    expect(hashString).toMatch(/^[a-f0-9]{64}$/);
    expect(hashBoolean).toMatch(/^[a-f0-9]{64}$/);
    expect(hashNull).toMatch(/^[a-f0-9]{64}$/);
  });

  it('handles arrays of objects with sorted keys', () => {
    const hash1 = contentHash([{ b: 2, a: 1 }, { d: 4, c: 3 }]);
    const hash2 = contentHash([{ a: 1, b: 2 }, { c: 3, d: 4 }]);
    expect(hash1).toBe(hash2);
  });
});
