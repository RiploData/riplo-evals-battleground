import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import path from 'node:path';
import fs from 'node:fs';

/**
 * Vitest global setup.
 *
 * Integration tests run against a DEDICATED database (`arena_test`) so they are
 * fully isolated from the dev database (`arena`), which holds the real seeded
 * corpus used by `npm run dev` and the Playwright e2e. This setup creates the
 * test database if missing and applies all migrations + immutability guards.
 *
 * The test DATABASE_URL is injected via vitest.config.ts `test.env`; test files
 * that `import 'dotenv/config'` will NOT override it (dotenv does not overwrite
 * already-set env vars).
 */
const ADMIN_URL = 'postgres://arena:arena@localhost:5544/arena';
const TEST_DB = 'arena_test';
const TEST_URL = `postgres://arena:arena@localhost:5544/${TEST_DB}`;

export default async function setup() {
  // 1. Ensure the test database exists (connect to the default db to create it).
  const admin = new Pool({ connectionString: ADMIN_URL });
  try {
    const { rows } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [TEST_DB]);
    if (rows.length === 0) {
      await admin.query(`CREATE DATABASE ${TEST_DB}`);
    }
  } finally {
    await admin.end();
  }

  // 2. Migrate the test database (idempotent via the drizzle journal) + immutability guards.
  const pool = new Pool({ connectionString: TEST_URL });
  try {
    const db = drizzle(pool);
    const migrationsFolder = path.join(__dirname, '..', 'src', 'db', 'migrations');
    await migrate(db, { migrationsFolder });
    const immutabilitySql = fs.readFileSync(
      path.join(migrationsFolder, '0001_immutability.sql'),
      'utf8',
    );
    await pool.query(immutabilitySql);
  } finally {
    await pool.end();
  }
}
