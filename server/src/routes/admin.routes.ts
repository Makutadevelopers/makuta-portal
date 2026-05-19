// admin.routes.ts
// TEMPORARY diagnostic endpoint for the bulk-import corruption audit
// (see server/src/db/diagnostics/2026-05-19_import_corruption_audit.sql).
// Returns the D1-D5 results as JSON so we can size the cleanup without
// needing SSH/tunnel access to RDS. HO-only. Remove this file once the
// repair work is complete.

import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { query } from '../db/query';

const router = Router();

router.use(authenticate);

router.get('/import-audit', requireRole(['ho']), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const d1 = await query(`
      SELECT
        p.batch_id,
        MIN(p.created_at)::date AS imported_on,
        COUNT(*) AS total_payments,
        COUNT(*) FILTER (WHERE p.payment_ref ~ '^\\s*\\d{1,2}[-/\\s][A-Za-z]{3}[-/\\s]\\d{2,4}\\s*$') AS f1_ref_is_date,
        COUNT(*) FILTER (WHERE p.bank   ~ '^\\s*[A-Za-z]{3,}[- ]?\\d{2,4}\\s*$')                AS f1b_bank_is_month,
        COUNT(*) FILTER (WHERE p.payment_date = i.invoice_date)                                AS f1c_paydate_eq_invdate,
        COUNT(*) FILTER (WHERE p.payment_ref LIKE 'IMPORT-%')                                  AS f5_synthetic_ref,
        COUNT(*) FILTER (WHERE p.payment_type = 'Import')                                      AS f6_invalid_type,
        COUNT(*) FILTER (WHERE p.payment_type ~ '\\d')                                          AS f7_type_has_digits,
        COUNT(*) FILTER (WHERE p.payment_date = DATE '2001-01-01')                              AS f8_paydate_epoch_sentinel,
        COUNT(*) FILTER (
          WHERE p.payment_date = DATE '2001-01-01'
            AND p.payment_ref ~ '^\\s*\\d{1,2}[/\\-.\\s]\\d{1,2}[/\\-.\\s]\\d{2,4}\\s*$'
        )                                                                                       AS f8b_paydate_numeric_ref
      FROM payments p
      JOIN invoices i ON i.id = p.invoice_id
      WHERE p.batch_id IS NOT NULL
      GROUP BY p.batch_id
      ORDER BY imported_on DESC
    `);

    const d2_count = await query<{ count: string }>(`
      SELECT COUNT(*)::text AS count
      FROM payments p
      JOIN invoices i ON i.id = p.invoice_id
      WHERE p.payment_date = i.invoice_date
        AND p.payment_ref ~ '^\\s*\\d{1,2}[-/\\s][A-Za-z]{3}[-/\\s]\\d{2,4}\\s*$'
    `);

    const d2_sample = await query(`
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

    const d3 = await query(`
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

    const d4 = await query(`
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

    const d5 = await query(`
      SELECT bt.id, bt.txn_ref, bt.bank, bt.txn_type, bt.txn_date, bt.txn_amount
      FROM bank_transactions bt
      WHERE bt.bank ~ '^[A-Za-z]{3,}[- ]?\\d{2,4}$'
         OR bt.txn_ref ~ '^\\d{1,2}[-/][A-Za-z]{3}[-/]\\d{2,4}$'
      ORDER BY bt.created_at DESC
      LIMIT 50
    `);

    const d6_f8_count = await query<{ count: string }>(`
      SELECT COUNT(*)::text AS count
      FROM payments
      WHERE payment_date = DATE '2001-01-01'
        AND payment_ref ~ '^\\s*\\d{1,2}[-/\\s][A-Za-z]{3}[-/\\s]\\d{2,4}\\s*$'
    `);

    const d6_f8_sample = await query(`
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
      WHERE p.payment_date = DATE '2001-01-01'
        AND p.payment_ref ~ '^\\s*\\d{1,2}[-/\\s][A-Za-z]{3}[-/\\s]\\d{2,4}\\s*$'
      ORDER BY p.batch_id, p.created_at
      LIMIT 25
    `);

    // D7 — Did migration 031 (batch 90209c92 timezone date-shift) actually
    // get applied on this RDS? The migration file is untracked locally and
    // doesn't appear in schema_migrations from today's deploy logs, but it
    // may have been run manually. We probe by reading the 4 reference
    // invoices the migration comment lists (CSV-known expected dates). If
    // they match the post-fix expected date, the migration is effectively
    // applied. If they match (expected − 1 day), the migration is still
    // pending and 1,181 invoices are off by one day.
    const d7_migration_031 = await query<{
      invoice_no: string;
      invoice_date: string;
      expected_after_fix: string;
      status: string;
    }>(`
      SELECT
        invoice_no,
        invoice_date,
        expected.expected_after_fix,
        CASE
          WHEN invoice_date = expected.expected_after_fix THEN 'fixed'
          WHEN invoice_date = expected.expected_after_fix - INTERVAL '1 day' THEN 'pending'
          ELSE 'unexpected'
        END AS status
      FROM invoices
      JOIN (VALUES
        ('SCMP25059012', DATE '2026-02-12'),
        ('SCMP25059015', DATE '2026-02-12'),
        ('SCMP25060488', DATE '2026-02-19'),
        ('SCMP25060831', DATE '2026-02-20')
      ) AS expected(invoice_no, expected_after_fix)
        USING (invoice_no)
    `);

    // Batch-wide count so we know the blast radius if the migration is
    // still pending (the migration comment claims ~1,181 invoices).
    const d7_batch_count = await query<{ count: string }>(`
      SELECT COUNT(*)::text AS count
      FROM invoices
      WHERE batch_id = '90209c92-5c25-4ddc-8cd1-e01e36ff9610'
    `);

    res.json({
      generated_at: new Date().toISOString(),
      d1_per_batch_fingerprint: d1,
      d2_f1_rows: {
        total_count: d2_count[0]?.count ?? '0',
        sample: d2_sample,
      },
      d3_synthetic_ref_batches: d3,
      d4_day1_clusters: d4,
      d5_bank_transactions: d5,
      d6_f8_epoch_sentinel_rows: {
        total_count: d6_f8_count[0]?.count ?? '0',
        sample: d6_f8_sample,
      },
      d7_migration_031_status: {
        batch_size: d7_batch_count[0]?.count ?? '0',
        reference_invoices: d7_migration_031,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
