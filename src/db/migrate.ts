import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import path from 'path';
import fs from 'fs';

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);

  console.log('Running drizzle migrations…');
  await migrate(db, { migrationsFolder: path.join(__dirname, 'migrations') });
  console.log('Drizzle migrations complete.');

  const immutabilityPath = path.join(__dirname, 'migrations', '0001_immutability.sql');
  const sql = fs.readFileSync(immutabilityPath, 'utf8');
  console.log('Applying immutability guards…');
  await pool.query(sql);
  console.log('Immutability guards applied.');

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
