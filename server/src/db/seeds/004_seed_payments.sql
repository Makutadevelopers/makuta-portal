-- 004_seed_payments.sql
-- 6 payment records across 6 invoices
-- 3 full cheque payments, 1 part NEFT, 1 full NEFT, 1 minor UPI

INSERT INTO payments (id, invoice_id, amount, payment_type, payment_ref, payment_date, bank, recorded_by)
VALUES
  -- Invoice 4306: full payment by cheque
  (
    'cc000001-0000-4000-a000-000000000001',
    'bb000001-0000-4000-a000-000000000001',
    1508053.00, 'Cheque', '000856', '2026-02-27', 'HDFC',
    'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'
  ),

  -- Invoice 4403: full payment by cheque
  (
    'cc000002-0000-4000-a000-000000000002',
    'bb000002-0000-4000-a000-000000000002',
    2018967.00, 'Cheque', '000856', '2026-02-27', 'HDFC',
    'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'
  ),

  -- Invoice 4400: full payment by cheque
  (
    'cc000003-0000-4000-a000-000000000003',
    'bb000003-0000-4000-a000-000000000003',
    2119098.00, 'Cheque', '000857', '2026-02-27', 'HDFC',
    'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'
  ),

  -- Invoice 5877: part payment — ₹8,00,000 of ₹17,41,182 (balance ₹9,41,182)
  (
    'cc000004-0000-4000-a000-000000000004',
    'bb000004-0000-4000-a000-000000000004',
    800000.00, 'NEFT', 'TXN44512', '2026-03-01', 'HDFC',
    'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'
  ),

  -- Invoice NV-3312: full payment by NEFT
  (
    'cc000005-0000-4000-a000-000000000005',
    'bb000008-0000-4000-a000-000000000008',
    1250000.00, 'NEFT', 'TXN88231', '2026-03-20', 'HDFC',
    'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'
  ),

  -- Invoice PIL-2231: minor payment by site accountant via UPI
  (
    'cc000006-0000-4000-a000-000000000006',
    'bb00000b-0000-4000-a000-00000000000b',
    38500.00, 'UPI', 'UPI-38500', '2026-03-12', 'HDFC',
    'c3d4e5f6-a7b8-4c9d-ae1f-2a3b4c5d6e7f'
  )
ON CONFLICT (id) DO NOTHING;
