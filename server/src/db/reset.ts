// reset.ts
// Drops all tables, re-runs migrations, and re-seeds the database.
// Usage: npm run db:reset

import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const SEEDS_DIR = path.join(__dirname, 'seeds');

async function reset(): Promise<void> {
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
    // Drop all tables
    console.log('\n--- Dropping all tables ---');
    await client.query(`
      DO $$ DECLARE
        r RECORD;
      BEGIN
        FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
          EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident(r.tablename) || ' CASCADE';
        END LOOP;
      END $$;
    `);
    console.log('  All tables dropped.\n');

    // Run migrations
    console.log('--- Running migrations ---');
    const migrationFiles = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort();

    // Create tracking table
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        file_name TEXT PRIMARY KEY,
        run_at    TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    for (const file of migrationFiles) {
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
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`  FAIL  ${file}`);
        throw err;
      }
    }

    // Run seeds
    console.log('\n--- Running seeds ---');
    const seedFiles = fs
      .readdirSync(SEEDS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort();

    for (const file of seedFiles) {
      const sql = fs.readFileSync(path.join(SEEDS_DIR, file), 'utf-8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('COMMIT');
        console.log(`  OK    ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`  FAIL  ${file}`);
        throw err;
      }
    }

    console.log('\nDatabase reset complete.\n');
  } catch (err) {
    console.error('\nReset failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

reset();
