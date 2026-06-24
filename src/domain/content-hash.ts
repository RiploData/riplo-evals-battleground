import { createHash } from 'node:crypto';

/**
 * Canonicalizes a value by converting it to JSON with recursively sorted object keys.
 * Arrays maintain their original order.
 */
function canonicalize(value: unknown): string {
  if (value === null) {
    return JSON.stringify(null);
  }

  if (typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    const canonicalElements = value.map((element) => canonicalize(element));
    return '[' + canonicalElements.join(',') + ']';
  }

  // Handle objects: sort keys and recurse
  const keys = Object.keys(value).sort();
  const entries = keys.map((key) => {
    const canonicalValue = canonicalize((value as Record<string, unknown>)[key]);
    return JSON.stringify(key) + ':' + canonicalValue;
  });
  return '{' + entries.join(',') + '}';
}

/**
 * Computes a SHA-256 hash of the canonical JSON representation of a value.
 * Objects have their keys recursively sorted; arrays preserve order.
 */
export function contentHash(value: unknown): string {
  const canonical = canonicalize(value);
  return createHash('sha256').update(canonical).digest('hex');
}
