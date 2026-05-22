-- 2026-05-20_human_edit_vs_repair.sql  (READ-ONLY diagnostics)
--
-- Context: repairs 040/042/043 overwrote some hand-entered payment dates with a
-- date recovered from the misfiled payment_ref. Per the "human edits are final"
-- rule (CLAUDE.md), migration 046 restores those. Run these BEFORE deploying 046
-- to confirm the exact blast radius, and AFTER to confirm it landed.

-- (1) DRY-RUN: the exact rows migration 046 will restore (date diverges from the
--     latest human 'Edited payment' audit value). This is identical to 046's
--     target set. Eyeball every row before deploying.
WITH latest_edit AS (
  SELECT DISTINCT ON (a.metadata->>'paymentId')
         (a.metadata->>'paymentId')::uuid                       AS payment_id,
         (left(a.metadata->'after'->>'payment_date', 10))::date AS human_date,
         a.created_at                                           AS edited_at,
         a.user_id
  FROM audit_logs a
  WHERE a.action LIKE 'Edited payment%'
    AND a.metadata ? 'paymentId'
    AND a.metadata->'after'->>'payment_date' IS NOT NULL
  ORDER BY a.metadata->>'paymentId', a.created_at DESC
)
SELECT i.internal_no, u.name AS edited_by, le.edited_at::date AS edited_on,
       p.payment_date  AS live_date_repair_wrote,
       le.human_date   AS will_restore_to,
       p.payment_ref, p.payment_type
FROM latest_edit le
JOIN payments p ON p.id = le.payment_id
JOIN invoices i ON i.id = p.invoice_id
LEFT JOIN users u ON u.id = le.user_id
WHERE p.payment_date IS DISTINCT FROM le.human_date
ORDER BY u.name, p.payment_date;

-- (2) MKT-03996 anomaly: it has a human Mar-30 edit + live Apr-10, yet did NOT
--     appear in the divergence scan. List EVERY audit row for its payment id
--     (regardless of invoice link) to see whether a later 'Edited payment' set
--     Apr-10 (i.e. a human re-confirmed the repaired date -> correctly excluded).
SELECT a.created_at, a.invoice_id, a.action,
       a.metadata->'after'->>'payment_date' AS after_date
FROM audit_logs a
WHERE a.metadata->>'paymentId' = '58aaf69a-0465-4b40-9bdf-ce22e499e6bc'
ORDER BY a.created_at;

-- (3) POST-DEPLOY check: snapshot vs restored value for every row 046 touched.
SELECT i.internal_no,
       s.payment_date AS was_repair_value,
       p.payment_date AS now_human_value,
       p.payment_month
FROM payments_repair_snapshot s
JOIN payments p ON p.id = s.payment_id
JOIN invoices i ON i.id = p.invoice_id
WHERE s.repair_tag = '046_restore_human_dates'
ORDER BY i.internal_no;
