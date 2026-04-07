// migrate.ts
// Runs all SQL migration files in server/src/db/migrations/ in numbered order.
// Tracks completed migrations in a schema_migrations table to avoid re-running.
// Usage: npx ts-node src/db/migrate.ts

import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function migrate(): Promise<void> {
  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || 'makuta_portal',
    user: process.env.DB_USER || 'makuta_admin',
    password: process.env.DB_PASSWORD || 'localdevpassword',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });

  const client = await pool.connect();

  try {
    // Create tracking table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        file_name TEXT PRIMARY KEY,
        run_at    TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Get already-run migrations
    const { rows: done } = await client.query(
      'SELECT file_name FROM schema_migrations ORDER BY file_name'
    );
    const completed = new Set(done.map((r: { file_name: string }) => r.file_name));

    // Read and sort migration files
    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    let ran = 0;

    for (const file of files) {
      if (completed.has(file)) {
        console.log(`  SKIP  ${file} (already applied)`);
        continue;
      }

      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (file_name) VALUES ($1)',
          [file]
        );
        await client.query('COMMIT');
        console.log(`  OK    ${file}`);
        ran++;
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`  FAIL  ${file}`);
        throw err;
      }
    }

    if (ran === 0) {
      console.log('\nNo pending migrations.');
    } else {
      console.log(`\n${ran} migration(s) applied successfully.`);
    }
  } catch (err) {
    console.error('\nMigration failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
