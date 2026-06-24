import type { PoolConfig } from 'pg';

/**
 * SSL config for the Postgres pool.
 *
 * Local Docker Postgres needs no SSL (DATABASE_SSL unset).
 * Managed Postgres (AWS RDS / Aurora, Neon, Supabase, …) requires TLS — set
 * DATABASE_SSL=true. For a test deployment we don't pin the provider CA, so
 * `rejectUnauthorized: false` is used (encrypted, but not cert-verified). For a
 * hardened production posture, supply the RDS CA bundle and flip this to verify.
 */
export function sslOption(): PoolConfig['ssl'] {
  return process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined;
}
