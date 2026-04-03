-- 003_seed_invoices.sql
-- 12 invoices across multiple sites, vendors, and statuses

INSERT INTO invoices (
  id, month, invoice_date, vendor_id, vendor_name, invoice_no, po_number,
  purpose, site, invoice_amount, payment_status, remarks,
  pushed, pushed_at, approved_by, minor_payment, created_by
)
VALUES
  -- 1. Salasar inv 4306 — Paid, pushed
  (
    'bb000001-0000-4000-a000-000000000001',
    '2025-11-01', '2025-11-13',
    'aa000001-0000-4000-a000-000000000001', 'Salasar Iron and Steels Pvt Ltd',
    '4306', 'MDLLP/NV/25-26/PO/1194',
    'Steel', 'Nirvana', 1508053.00, 'Paid', NULL,
    TRUE, '2025-12-01T00:00:00Z', 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
    FALSE, 'c3d4e5f6-a7b8-4c9d-ae1f-2a3b4c5d6e7f'
  ),

  -- 2. Salasar inv 4403 — Paid, pushed
  (
    'bb000002-0000-4000-a000-000000000002',
    '2025-11-01', '2025-11-17',
    'aa000001-0000-4000-a000-000000000001', 'Salasar Iron and Steels Pvt Ltd',
    '4403', 'MDLLP/NV/25-26/PO/1194',
    'Steel', 'Nirvana', 2018967.00, 'Paid', NULL,
    TRUE, '2025-12-01T00:00:00Z', 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
    FALSE, 'c3d4e5f6-a7b8-4c9d-ae1f-2a3b4c5d6e7f'
  ),

  -- 3. Salasar inv 4400 — Paid, pushed
  (
    'bb000003-0000-4000-a000-000000000003',
    '2025-11-01', '2025-11-17',
    'aa000001-0000-4000-a000-000000000001', 'Salasar Iron and Steels Pvt Ltd',
    '4400', 'MDLLP/NV/25-26/PO/1329',
    'Steel', 'Nirvana', 2119098.00, 'Paid', NULL,
    TRUE, '2025-12-01T00:00:00Z', 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
    FALSE, 'c3d4e5f6-a7b8-4c9d-ae1f-2a3b4c5d6e7f'
  ),

  -- 4. Salasar inv 5877 — Partial (₹8,00,000 paid), not pushed
  (
    'bb000004-0000-4000-a000-000000000004',
    '2026-01-01', '2026-01-31',
    'aa000001-0000-4000-a000-000000000001', 'Salasar Iron and Steels Pvt Ltd',
    '5877', 'MDLLP/NV/25-26/PO/1614',
    'Steel', 'Nirvana', 1741182.00, 'Partial', 'Awaiting HO payment',
    FALSE, NULL, NULL,
    FALSE, 'c3d4e5f6-a7b8-4c9d-ae1f-2a3b4c5d6e7f'
  ),

  -- 5. My Home inv TGPS036479 — Not Paid, not pushed
  (
    'bb000005-0000-4000-a000-000000000005',
    '2025-12-01', '2025-12-09',
    'aa000002-0000-4000-a000-000000000002', 'My Home Industries',
    'TGPS036479', 'MDLLP/NV/25-26/PO/1228',
    'Cement', 'Nirvana', 153516.00, 'Not Paid', NULL,
    FALSE, NULL, NULL,
    FALSE, 'c3d4e5f6-a7b8-4c9d-ae1f-2a3b4c5d6e7f'
  ),

  -- 6. Salasar inv 4455 — Not Paid, not pushed
  (
    'bb000006-0000-4000-a000-000000000006',
    '2025-11-01', '2025-11-19',
    'aa000001-0000-4000-a000-000000000001', 'Salasar Iron and Steels Pvt Ltd',
    '4455', 'MDLLP/NV/25-26/PO/1329',
    'Steel', 'Nirvana', 1876487.00, 'Not Paid', NULL,
    FALSE, NULL, NULL,
    FALSE, 'c3d4e5f6-a7b8-4c9d-ae1f-2a3b4c5d6e7f'
  ),

  -- 7. Ultratech inv UC-8821 — Not Paid, not pushed
  (
    'bb000007-0000-4000-a000-000000000007',
    '2026-02-01', '2026-02-10',
    'aa000003-0000-4000-a000-000000000003', 'Ultratech Cement Ltd',
    'UC-8821', 'MDLLP/HZ/25-26/PO/0201',
    'Cement', 'Horizon', 890000.00, 'Not Paid', 'Needs review',
    FALSE, NULL, NULL,
    FALSE, 'e5f6a7b8-c9d0-4e1f-aa3b-4c5d6e7f8091'
  ),

  -- 8. Nuvoco inv NV-3312 — Paid, pushed
  (
    'bb000008-0000-4000-a000-000000000008',
    '2026-03-01', '2026-03-05',
    'aa000004-0000-4000-a000-000000000004', 'Nuvoco Vistas Corp',
    'NV-3312', 'MDLLP/TR/25-26/PO/0311',
    'Cement', 'Taranga', 1250000.00, 'Paid', NULL,
    TRUE, '2026-03-21T00:00:00Z', 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
    FALSE, 'd4e5f6a7-b8c9-4d0e-9f2a-3b4c5d6e7f80'
  ),

  -- 9. Dalmia inv DBS-4491 — Not Paid, not pushed
  (
    'bb000009-0000-4000-a000-000000000009',
    '2026-02-01', '2026-02-14',
    'aa000005-0000-4000-a000-000000000005', 'Dalmia Bharat Steel',
    'DBS-4491', 'MDLLP/GW/25-26/PO/0144',
    'Steel', 'Green Wood Villas', 3200000.00, 'Not Paid', NULL,
    FALSE, NULL, NULL,
    FALSE, 'f6a7b8c9-d0e1-4f2a-bb4c-5d6e7f809102'
  ),

  -- 10. Orient Electric inv OE-9911 — Not Paid, not pushed
  (
    'bb00000a-0000-4000-a000-00000000000a',
    '2026-03-01', '2026-03-01',
    'aa000006-0000-4000-a000-000000000006', 'Orient Electric Ltd',
    'OE-9911', 'MDLLP/AA/25-26/PO/0091',
    'Electrical Material', 'Aruna Arcade', 450000.00, 'Not Paid', NULL,
    FALSE, NULL, NULL,
    FALSE, '07b8c9d0-e1f2-4a3b-8c5d-6e7f80910213'
  ),

  -- 11. Pidilite inv PIL-2231 — Paid, minor payment by site, pushed
  (
    'bb00000b-0000-4000-a000-00000000000b',
    '2026-03-01', '2026-03-10',
    'aa000007-0000-4000-a000-000000000007', 'Pidilite Industries',
    'PIL-2231', 'MDLLP/NV/25-26/PO/0998',
    'Admixtures', 'Nirvana', 38500.00, 'Paid', NULL,
    TRUE, '2026-03-12T00:00:00Z', NULL,
    TRUE, 'c3d4e5f6-a7b8-4c9d-ae1f-2a3b4c5d6e7f'
  ),

  -- 12. Ramco inv RC-7821 — Not Paid, not pushed
  (
    'bb00000c-0000-4000-a000-00000000000c',
    '2026-03-01', '2026-03-15',
    'aa000008-0000-4000-a000-000000000008', 'Ramco Cements',
    'RC-7821', 'MDLLP/TR/25-26/PO/0422',
    'Cement', 'Taranga', 42000.00, 'Not Paid', NULL,
    FALSE, NULL, NULL,
    FALSE, 'd4e5f6a7-b8c9-4d0e-9f2a-3b4c5d6e7f80'
  )
ON CONFLICT (id) DO NOTHING;
