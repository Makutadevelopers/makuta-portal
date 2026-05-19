// Read-only diagnostic runner for the bulk-import corruption audit.
// Mirrors the queries in 2026-05-19_import_corruption_audit.sql and prints
// them as tables so we can size the cleanup without manual psql access.
//
// Usage:  cd server && npx tsx src/db/diagnostics/runAudit.ts
//
// Connects to whatever database the regular query.ts wrapper resolves to —
// in this repo that's production RDS via the root .env.

import { query, pool } from '../query.js';

function printSection(title: string) {
  // eslint-disable-next-line no-console
  console.log(`\n[1m──────────  ${title}  ──────────[0m`);
}

function printTable(rows: Record<string, unknown>[]) {
  if (rows.length === 0) {
    // eslint-disable-next-line no-console
    console.log('  (no rows)');
    return;
  }
  // eslint-disable-next-line no-console
  console.table(rows);
}

async function main() {
  printSection('D1 — Per-batch corruption fingerprint');
  const d1 = await query<Record<string, unknown>>(`
    SELECT
      p.batch_id,
      MIN(p.created_at)::date AS imported_on,
      COUNT(*) AS total_payments,
      COUNT(*) FILTER (WHERE p.payment_ref ~ '^\\s*\\d{1,2}[-/\\s][A-Za-z]{3}[-/\\s]\\d{2,4}\\s*$') AS f1_ref_is_date,
      COUNT(*) FILTER (WHERE p.bank   ~ '^\\s*[A-Za-z]{3,}[- ]?\\d{2,4}\\s*$')                AS f1b_bank_is_month,
      COUNT(*) FILTER (WHERE p.payment_date = i.invoice_date)                                AS f1c_paydate_eq_invdate,
      COUNT(*) FILTER (WHERE p.payment_ref LIKE 'IMPORT-%')                                  AS f5_synthetic_ref,
      COUNT(*) FILTER (WHERE p.payment_type = 'Import')                                      AS f6_invalid_type,
      COUNT(*) FILTER (WHERE p.payment_type ~ '\\d')                                          AS f7_type_has_digits
    FROM payments p
    JOIN invoices i ON i.id = p.invoice_id
    WHERE p.batch_id IS NOT NULL
    GROUP BY p.batch_id
    ORDER BY imported_on DESC
  `);
  printTable(d1);

  printSection('D2 — Rows hit by F1 (top 25)');
  const d2 = await query<Record<string, unknown>>(`
    SELECT
      p.id, i.invoice_no, i.vendor_name, i.site, p.amount,
      i.invoice_date,
      p.payment_date AS stored_payment_date,
      p.payment_ref  AS suspect_real_date,
      p.bank         AS suspect_payment_month,
      p.payment_type,
      p.batch_id
    FROM payments p
    JOIN invoices i ON i.id = p.invoice_id
    WHERE p.payment_date = i.invoice_date
      AND p.payment_ref ~ '^\\s*\\d{1,2}[-/\\s][A-Za-z]{3}[-/\\s]\\d{2,4}\\s*$'
    ORDER BY p.batch_id, p.created_at
    LIMIT 25
  `);
  printTable(d2);

  const d2Count = await query<{ count: string }>(`
    SELECT COUNT(*) AS count
    FROM payments p
    JOIN invoices i ON i.id = p.invoice_id
    WHERE p.payment_date = i.invoice_date
      AND p.payment_ref ~ '^\\s*\\d{1,2}[-/\\s][A-Za-z]{3}[-/\\s]\\d{2,4}\\s*$'
  `);
  // eslint-disable-next-line no-console
  console.log(`  total F1 rows: ${d2Count[0]?.count ?? '0'}`);

  printSection('D3 — Batches dominated by synthetic refs (IMPORT-xxxx)');
  const d3 = await query<Record<string, unknown>>(`
    SELECT
      p.batch_id,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE p.payment_ref LIKE 'IMPORT-%') AS synthetic_count,
      ROUND(100.0 * COUNT(*) FILTER (WHERE p.payment_ref LIKE 'IMPORT-%') / COUNT(*), 1) AS pct_synthetic
    FROM payments p
    WHERE p.batch_id IS NOT NULL
    GROUP BY p.batch_id
    HAVING COUNT(*) FILTER (WHERE p.payment_ref LIKE 'IMPORT-%') > 0
    ORDER BY pct_synthetic DESC
  `);
  printTable(d3);

  printSection('D4 — Invoice-date day-1 clusters (possible F3)');
  const d4 = await query<Record<string, unknown>>(`
    SELECT
      batch_id,
      COUNT(*) AS total_in_batch,
      COUNT(*) FILTER (WHERE EXTRACT(DAY FROM invoice_date) = 1) AS day1_count,
      ROUND(100.0 * COUNT(*) FILTER (WHERE EXTRACT(DAY FROM invoice_date) = 1) / COUNT(*), 1) AS pct_day1
    FROM invoices
    WHERE batch_id IS NOT NULL
    GROUP BY batch_id
    HAVING COUNT(*) FILTER (WHERE EXTRACT(DAY FROM invoice_date) = 1) > 0
    ORDER BY pct_day1 DESC
    LIMIT 20
  `);
  printTable(d4);

  printSection('D5 — bank_transactions inheriting the bug');
  const d5 = await query<Record<string, unknown>>(`
    SELECT bt.id, bt.txn_ref, bt.bank, bt.txn_type, bt.txn_date, bt.txn_amount
    FROM bank_transactions bt
    WHERE bt.bank ~ '^[A-Za-z]{3,}[- ]?\\d{2,4}$'
       OR bt.txn_ref ~ '^\\d{1,2}[-/][A-Za-z]{3}[-/]\\d{2,4}$'
    ORDER BY bt.created_at DESC
    LIMIT 50
  `);
  printTable(d5);

  await pool.end();
}

main().catch(err => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
