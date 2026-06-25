/**
 * scripts/db-reset.ts
 *
 * Wipes ALL data from the database that DATABASE_URL points at, then leaves the
 * schema intact (so `npm run seed` can repopulate). Dynamic: truncates every
 * table in the public schema (except Drizzle's migration bookkeeping), so it
 * stays correct as the schema grows.
 *
 * GUARDED: prints the target host and refuses to run without --yes. Use this for
 * both local and the remote RDS — double-check the host line before confirming.
 *
 * Usage:
 *   npm run db:reset -- --yes                         # uses DATABASE_URL from .env
 *   DATABASE_URL=postgres://…/arena npm run db:reset -- --yes
 */

import 'dotenv/config';
import { pool } from '@/db/client';

function targetLabel(url?: string): string {
  if (!url) return '(DATABASE_URL not set)';
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || '5432'}${u.pathname}`;
  } catch {
    return '(unparseable DATABASE_URL)';
  }
}

async function main() {
  const confirmed = process.argv.includes('--yes');
  const target = targetLabel(process.env.DATABASE_URL);

  console.log('=== DB reset — TRUNCATE all data (schema preserved) ===');
  console.log(`target: ${target}`);

  const { rows } = await pool.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables
     WHERE schemaname = 'public' AND tablename NOT LIKE '%drizzle%'
     ORDER BY tablename`,
  );
  const tables = rows.map((r) => r.tablename);

  if (tables.length === 0) {
    console.log('No public tables found — nothing to truncate (has the schema been migrated?).');
    return;
  }

  console.log(`tables (${tables.length}): ${tables.join(', ')}`);

  if (!confirmed) {
    console.log('\nThis permanently DELETES ALL ROWS in the tables above.');
    console.log('Re-run with --yes to proceed:  npm run db:reset -- --yes');
    process.exitCode = 1;
    return;
  }

  const list = tables.map((t) => `"${t}"`).join(', ');
  await pool.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  console.log(`\n✅ Truncated ${tables.length} tables on ${target}. Run \`npm run seed\` to repopulate.`);
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error('db:reset failed:', err?.message ?? err);
    void pool.end();
    process.exit(1);
  });
