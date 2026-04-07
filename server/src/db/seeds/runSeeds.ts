// runSeeds.ts
// Executes all 6 SQL seed files in order against the database within a single transaction.
// Usage: npx ts-node src/db/seeds/runSeeds.ts

import fs from 'fs';
import path from 'path';
import { Pool, PoolClient } from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

const SEED_FILES = [
  '001_seed_users.sql',
  '002_seed_vendors.sql',
  '003_seed_invoices.sql',
  '004_seed_payments.sql',
  '005_seed_attachments.sql',
  '006_seed_audit_logs.sql',
];

/**
 * Check that 001_seed_users.sql has no REPLACE_WITH_BCRYPT_HASH placeholders
 */
function checkNoPlaceholders(): void {
  const usersSqlPath = path.join(__dirname, '001_seed_users.sql');
  const content = fs.readFileSync(usersSqlPath, 'utf-8');
  
  if (content.includes('REPLACE_WITH_BCRYPT_HASH')) {
    throw new Error(
      '❌ ABORT: 001_seed_users.sql still contains REPLACE_WITH_BCRYPT_HASH placeholders.\n' +
      'Run: node src/db/seeds/generatePasswordHashes.js'
    );
  }
}

/**
 * Print row counts for all 6 tables
 */
async function printRowCounts(client: PoolClient): Promise<void> {
  console.log('\n📊 Row counts after seeding:');

  const tables = ['users', 'vendors', 'invoices', 'payments', 'attachments', 'audit_logs'];
  
  for (const table of tables) {
    const result = await client.query(`SELECT COUNT(*) as count FROM ${table}`);
    const count = result.rows[0].count;
    console.log(`  ${table.padEnd(20)} ${count} rows`);
  }
}

/**
 * Verify payment statuses match sum of payments
 */
async function verifyPaymentStatuses(client: PoolClient): Promise<void> {
  console.log('\n🔍 Verifying payment statuses:');

  const result = await client.query(`
    SELECT 
      i.id,
      i.invoice_no,
      i.invoice_amount,
      COALESCE(SUM(p.amount), 0) as total_paid,
      i.payment_status,
      CASE
        WHEN COALESCE(SUM(p.amount), 0) = i.invoice_amount THEN 'Paid'
        WHEN COALESCE(SUM(p.amount), 0) > 0 AND COALESCE(SUM(p.amount), 0) < i.invoice_amount THEN 'Partial'
        WHEN COALESCE(SUM(p.amount), 0) = 0 THEN 'Not Paid'
      END as expected_status
    FROM invoices i
    LEFT JOIN payments p ON i.id = p.invoice_id
    GROUP BY i.id, i.invoice_no, i.invoice_amount, i.payment_status
    ORDER BY i.invoice_no
  `);

  let mismatches = 0;
  for (const row of result.rows) {
    const match = row.payment_status === row.expected_status;
    const symbol = match ? '✓' : '✗';
    console.log(
      `  ${symbol} ${row.invoice_no.padEnd(15)} ` +
      `amount=${row.invoice_amount} paid=${row.total_paid} ` +
      `status=${row.payment_status} (expected: ${row.expected_status})`
    );
    if (!match) mismatches++;
  }

  if (mismatches > 0) {
    throw new Error(`❌ Payment status mismatch found on ${mismatches} invoice(s)`);
  }

  console.log(`✓ All ${result.rows.length} invoices have correct payment statuses`);
}

async function runSeeds(): Promise<void> {
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
    // Step 1: Check for placeholders
    console.log('🔐 Checking for unhashed password placeholders...');
    checkNoPlaceholders();
    console.log('✓ No placeholders found\n');

    // Step 2: Begin transaction
    await client.query('BEGIN');
    console.log('📝 Starting transaction...\n');

    // Step 3: Execute all seed files
    console.log('🌱 Executing seed files:');
    for (const file of SEED_FILES) {
      const filePath = path.join(__dirname, file);
      const sql = fs.readFileSync(filePath, 'utf-8');
      await client.query(sql);
      console.log(`  ✓ ${file}`);
    }

    // Step 4: Print row counts
    await printRowCounts(client);

    // Step 5: Verify payment statuses
    await verifyPaymentStatuses(client);

    // Step 6: Commit transaction
    await client.query('COMMIT');
    console.log('\n✅ All seeds committed successfully!');

  } catch (err) {
    console.error('\n❌ Seed failed:', err instanceof Error ? err.message : err);
    
    try {
      await client.query('ROLLBACK');
      console.log('🔄 Transaction rolled back');
    } catch (rollbackErr) {
      console.error('Failed to rollback:', rollbackErr);
    }
    
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runSeeds();
