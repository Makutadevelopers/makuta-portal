-- 005_seed_attachments.sql
-- 6 attachment metadata rows
-- Actual files are in S3 — these are metadata pointers only

INSERT INTO attachments (id, invoice_id, file_name, file_size, mime_type, s3_key, s3_bucket, uploaded_by, uploaded_at)
VALUES
  -- Invoice 4306 (Salasar)
  (
    'dd000001-0000-4000-a000-000000000001',
    'bb000001-0000-4000-a000-000000000001',
    'salasar_inv_4306.pdf', 245760, 'application/pdf',
    'invoices/bb000001-0000-4000-a000-000000000001/salasar_inv_4306.pdf',
    'makuta-invoice-attachments',
    'c3d4e5f6-a7b8-4c9d-ae1f-2a3b4c5d6e7f',
    DEFAULT
  ),

  -- Invoice 4403 (Salasar)
  (
    'dd000002-0000-4000-a000-000000000002',
    'bb000002-0000-4000-a000-000000000002',
    'salasar_inv_4403.pdf', 312400, 'application/pdf',
    'invoices/bb000002-0000-4000-a000-000000000002/salasar_inv_4403.pdf',
    'makuta-invoice-attachments',
    'c3d4e5f6-a7b8-4c9d-ae1f-2a3b4c5d6e7f',
    DEFAULT
  ),

  -- Invoice 4400 (Salasar)
  (
    'dd000003-0000-4000-a000-000000000003',
    'bb000003-0000-4000-a000-000000000003',
    'salasar_inv_4400.pdf', 289100, 'application/pdf',
    'invoices/bb000003-0000-4000-a000-000000000003/salasar_inv_4400.pdf',
    'makuta-invoice-attachments',
    'c3d4e5f6-a7b8-4c9d-ae1f-2a3b4c5d6e7f',
    DEFAULT
  ),

  -- Invoice NV-3312 (Nuvoco)
  (
    'dd000004-0000-4000-a000-000000000004',
    'bb000008-0000-4000-a000-000000000008',
    'nuvoco_inv_NV-3312.pdf', 198500, 'application/pdf',
    'invoices/bb000008-0000-4000-a000-000000000008/nuvoco_inv_NV-3312.pdf',
    'makuta-invoice-attachments',
    'd4e5f6a7-b8c9-4d0e-9f2a-3b4c5d6e7f80',
    DEFAULT
  ),

  -- Invoice PIL-2231 (Pidilite)
  (
    'dd000005-0000-4000-a000-000000000005',
    'bb00000b-0000-4000-a000-00000000000b',
    'pidilite_inv_PIL-2231.jpg', 1540200, 'image/jpeg',
    'invoices/bb00000b-0000-4000-a000-00000000000b/pidilite_inv_PIL-2231.jpg',
    'makuta-invoice-attachments',
    'c3d4e5f6-a7b8-4c9d-ae1f-2a3b4c5d6e7f',
    DEFAULT
  ),

  -- Invoice 5877 (Salasar, Partial — uploaded by Suresh Reddy on 2026-02-01)
  (
    'dd000006-0000-4000-a000-000000000006',
    'bb000004-0000-4000-a000-000000000004',
    'Invoice_5877.pdf', 319488, 'application/pdf',
    'invoices/bb000004-0000-4000-a000-000000000004/Invoice_5877.pdf',
    'makuta-invoice-attachments',
    'c3d4e5f6-a7b8-4c9d-ae1f-2a3b4c5d6e7f',
    '2026-02-01T00:00:00Z'
  )
ON CONFLICT (id) DO NOTHING;
