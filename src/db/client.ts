import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';
import { sslOption } from './ssl';

// Pool size is bounded for RDS-Proxy / serverless parity. On Vercel, many
// function instances each open a pool, so keep DB_POOL_MAX small (e.g. 3) or
// front the database with RDS Proxy.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DB_POOL_MAX ?? 5),
  ssl: sslOption(),
});
export const db = drizzle(pool, { schema });
