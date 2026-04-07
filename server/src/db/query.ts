// query.ts
// Typed PostgreSQL query wrapper used by all services and controllers.
// Never import pg directly elsewhere — always use these helpers.

import { Pool, PoolConfig } from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const poolConfig: PoolConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'makuta_portal',
  user: process.env.DB_USER || 'makuta_admin',
  password: process.env.DB_PASSWORD || 'localdevpassword',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
};

const pool = new Pool(poolConfig);

/**
 * Execute a query and return all matching rows.
 * Always use parameterised queries — never interpolate values into sql.
 *
 * @example
 *   const invoices = await query<Invoice>(
 *     'SELECT * FROM invoices WHERE site = $1',
 *     ['Nirvana']
 *   );
 */
export async function query<T>(sql: string, params?: unknown[]): Promise<T[]> {
  const { rows } = await pool.query(sql, params);
  return rows as T[];
}

/**
 * Execute a query and return the first row, or null if no rows match.
 *
 * @example
 *   const user = await queryOne<User>(
 *     'SELECT * FROM users WHERE email = $1',
 *     ['rajesh@makuta.in']
 *   );
 */
export async function queryOne<T>(sql: string, params?: unknown[]): Promise<T | null> {
  const { rows } = await pool.query(sql, params);
  return (rows[0] as T) ?? null;
}

export { pool };
