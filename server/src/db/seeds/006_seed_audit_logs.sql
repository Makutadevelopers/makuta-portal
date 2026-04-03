-- 006_seed_audit_logs.sql
-- 7 audit log entries tracking invoice creation, approval, and payment actions

INSERT INTO audit_logs (id, user_id, action, invoice_id, metadata, created_at)
VALUES
  -- 1. Suresh Reddy created invoice 4306
  (
    'ee000001-0000-4000-a000-000000000001',
    'c3d4e5f6-a7b8-4c9d-ae1f-2a3b4c5d6e7f',
    'invoice_created',
    'bb000001-0000-4000-a000-000000000001',
    '{"invoice_no": "4306", "vendor": "Salasar Iron and Steels Pvt Ltd", "amount": 1508053.00, "site": "Nirvana"}',
    '2025-11-14T00:00:00Z'
  ),

  -- 2. Rajesh Kumar approved and pushed invoice 4306
  (
    'ee000002-0000-4000-a000-000000000002',
    'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
    'invoice_approved_and_pushed',
    'bb000001-0000-4000-a000-000000000001',
    '{"invoice_no": "4306", "vendor": "Salasar Iron and Steels Pvt Ltd", "amount": 1508053.00}',
    '2025-12-01T00:00:00Z'
  ),

  -- 3. Suresh Reddy created invoice 5877
  (
    'ee000003-0000-4000-a000-000000000003',
    'c3d4e5f6-a7b8-4c9d-ae1f-2a3b4c5d6e7f',
    'invoice_created',
    'bb000004-0000-4000-a000-000000000004',
    '{"invoice_no": "5877", "vendor": "Salasar Iron and Steels Pvt Ltd", "amount": 1741182.00, "site": "Nirvana"}',
    '2026-02-01T00:00:00Z'
  ),

  -- 4. Mahesh Babu created invoice UC-8821
  (
    'ee000004-0000-4000-a000-000000000004',
    'e5f6a7b8-c9d0-4e1f-aa3b-4c5d6e7f8091',
    'invoice_created',
    'bb000007-0000-4000-a000-000000000007',
    '{"invoice_no": "UC-8821", "vendor": "Ultratech Cement Ltd", "amount": 890000.00, "site": "Horizon"}',
    '2026-02-11T00:00:00Z'
  ),

  -- 5. Priya Sharma created invoice NV-3312
  (
    'ee000005-0000-4000-a000-000000000005',
    'd4e5f6a7-b8c9-4d0e-9f2a-3b4c5d6e7f80',
    'invoice_created',
    'bb000008-0000-4000-a000-000000000008',
    '{"invoice_no": "NV-3312", "vendor": "Nuvoco Vistas Corp", "amount": 1250000.00, "site": "Taranga"}',
    '2026-03-06T00:00:00Z'
  ),

  -- 6. Rajesh Kumar approved and pushed NV-3312
  (
    'ee000006-0000-4000-a000-000000000006',
    'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
    'invoice_approved_and_pushed',
    'bb000008-0000-4000-a000-000000000008',
    '{"invoice_no": "NV-3312", "vendor": "Nuvoco Vistas Corp", "amount": 1250000.00}',
    '2026-03-21T00:00:00Z'
  ),

  -- 7. Suresh Reddy recorded minor site payment PIL-2231
  (
    'ee000007-0000-4000-a000-000000000007',
    'c3d4e5f6-a7b8-4c9d-ae1f-2a3b4c5d6e7f',
    'minor_payment_recorded',
    'bb00000b-0000-4000-a000-00000000000b',
    '{"invoice_no": "PIL-2231", "vendor": "Pidilite Industries", "amount": 38500.00, "payment_type": "UPI", "payment_ref": "UPI-38500"}',
    '2026-03-12T00:00:00Z'
  )
ON CONFLICT (id) DO NOTHING;
