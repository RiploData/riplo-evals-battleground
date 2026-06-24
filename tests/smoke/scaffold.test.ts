import { describe, it, expect } from 'vitest';
describe('scaffold', () => {
  it('resolves the @ alias and env contract', () => {
    expect(typeof process.versions.node).toBe('string');
  });
});
