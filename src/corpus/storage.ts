import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const STORAGE_ROOT = join(process.cwd(), '.storage');

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Persists a blob under a key in the local ./.storage directory.
 * The key may include path separators (e.g. "cases/abc/memo.md").
 */
export function putBlob(key: string, bytes: Buffer | Uint8Array): void {
  const filePath = join(STORAGE_ROOT, key);
  const dir = filePath.substring(0, filePath.lastIndexOf('/'));
  ensureDir(dir);
  writeFileSync(filePath, bytes);
}

/**
 * Returns a file:// URL for a blob stored under the given key.
 * Throws if the key does not exist.
 */
export function getBlobUrl(key: string): string {
  const filePath = join(STORAGE_ROOT, key);
  if (!existsSync(filePath)) {
    throw new Error(`Blob not found: ${key}`);
  }
  return `file://${filePath}`;
}

/**
 * Returns the raw bytes for a stored blob. Throws if not found.
 */
export function getBlob(key: string): Buffer {
  const filePath = join(STORAGE_ROOT, key);
  if (!existsSync(filePath)) {
    throw new Error(`Blob not found: ${key}`);
  }
  return readFileSync(filePath);
}
