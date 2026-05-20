// _oneoff_payment_column_shift_audit.ts
// READ-ONLY diagnostic. Measures the scope of the "column-shift" corruption
// from the old (pre-2026-05-19) importer, where payment columns landed in the
// wrong fields:  payment date -> payment_ref,  payment month -> bank,
// invoice date -> payment_date (real payment date lost), and some bank
// payments were left with no reference at all.
//
// Run on the EC2 box (or anywhere the prod .env is loaded):
//     cd /opt/makuta-portal/server && npx tsx src/db/_oneoff_payment_column_shift_audit.ts
// Mutates nothing — only SELECTs.

import { pool } from './query.js';

// ref holds a date instead of a cheque no / UTR
const REF_IS_DATE = `(
  p.payment_ref ~ '^\\s*\\d{1,2}-[A-Za-z]{3,}-\\d{2,4}\\s*$'
  OR p.payment_ref ~ '^\\s*\\d{4}-\\d{2}-\\d{2}\\s*$'
  OR p.payment_ref ~ '^\\s*\\d{1,2}/\\d{1,2}/\\d{2,4}\\s*$'
)`;
// bank holds a "Mon-YY" / "Mon-YYYY" month token instead of a bank name
const BANK_IS_MONTH = `(
  p.bank ~* '^\\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[- ]?\\d{2,4}\\s*$'
)`;
// non-cash payment with no reference at all (the blank #5422 case)
const BANK_NO_REF = `(
  lower(COALESCE(p.payment_type,'')) <> 'cash'
  AND NULLIF(trim(p.payment_ref), '') IS NULL
)`;

async function main(): Promise<void> {
  // A. Headline counts per fingerprint
  const a = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE ${REF_IS_DATE})                        AS ref_is_date,
       COUNT(*) FILTER (WHERE ${BANK_IS_MONTH})                      AS bank_is_month,
       COUNT(*) FILTER (WHERE ${BANK_NO_REF})                        AS bank_payment_no_ref,
       COUNT(*) FILTER (WHERE p.payment_date = i.invoice_date)       AS paydate_eq_invdate,
       COUNT(*) FILTER (WHERE ${REF_IS_DATE} OR ${BANK_IS_MONTH} OR ${BANK_NO_REF}) AS any_shift,
       COUNT(*)                                                      AS total_payments
     FROM payments p JOIN invoices i ON i.id = p.invoice_id`
  );
  console.log('\n=== A. Fingerprint summary (DB-wide) ===');
  console.table(a.rows);

  // B. Per-batch breakdown (attribute via the invoice's batch_id)
  const b = await pool.query(
    `SELECT
       i.batch_id,
       COUNT(*)                                  AS payments,
       COUNT(*) FILTER (WHERE ${REF_IS_DATE})    AS ref_is_date,
       COUNT(*) FILTER (WHERE ${BANK_IS_MONTH})  AS bank_is_month,
       COUNT(*) FILTER (WHERE ${BANK_NO_REF})    AS bank_no_ref,
       MIN(p.created_at)::date                   AS first_created,
       MAX(p.created_at)::date                   AS last_created
     FROM payments p JOIN invoices i ON i.id = p.invoice_id
     GROUP BY i.batch_id
     HAVING COUNT(*) FILTER (WHERE ${REF_IS_DATE} OR ${BANK_IS_MONTH} OR ${BANK_NO_REF}) > 0
     ORDER BY 3 + 4 + 5 DESC`
  );
  console.log('\n=== B. Affected batches (NULL batch = manual / pre-batch) ===');
  console.table(b.rows);

  // C. Cross-type orphan duplicate bank_transactions (the "row 6" case)
  const c = await pool.query(
    `WITH bt_alloc AS (
       SELECT bt.*, COUNT(p.id) AS pay_count
       FROM bank_transactions bt
       LEFT JOIN payments p ON p.bank_txn_id = bt.id
       GROUP BY bt.id
     )
     SELECT o.id AS orphan_txn_id, o.txn_type AS orphan_type, o.txn_ref AS orphan_ref,
            o.bank AS orphan_bank, o.txn_amount, o.txn_date,
            l.txn_type AS linked_type, l.txn_ref AS linked_ref, l.bank AS linked_bank
     FROM bt_alloc o
     JOIN bt_alloc l
       ON l.txn_amount = o.txn_amount AND l.txn_date = o.txn_date
      AND l.id <> o.id AND l.pay_count > 0
     WHERE o.pay_count = 0
     ORDER BY o.txn_amount DESC`
  );
  console.log(`\n=== C. Cross-type orphan duplicate cheques (${c.rowCount} rows) ===`);
  console.table(c.rows);

  // D. The reference case: cheque 000968 / batch 5fdcc961
  const d = await pool.query(
    `SELECT i.invoice_no, i.internal_no, i.vendor_name,
            p.amount, p.payment_type, p.payment_ref, p.bank,
            p.payment_date, i.invoice_date, p.payment_month
     FROM payments p JOIN invoices i ON i.id = p.invoice_id
     WHERE p.bank_txn_id IN (
             SELECT id FROM bank_transactions
             WHERE txn_ref ILIKE '%000968%' OR remarks ILIKE '%5fdcc961%')
        OR i.batch_id = (SELECT batch_id FROM invoices WHERE internal_no = 'MKT-04008')
     ORDER BY i.invoice_no`
  );
  console.log('\n=== D. Cheque 000968 / batch 5fdcc961 detail ===');
  console.table(d.rows);

  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
