-- 002_seed_vendors.sql
-- 8 vendors with payment terms, categories, and contact info
-- created_by = Rajesh Kumar (HO)

INSERT INTO vendors (id, name, payment_terms, category, gstin, contact_name, phone, email, notes, created_by)
VALUES
  (
    'aa000001-0000-4000-a000-000000000001',
    'Salasar Iron and Steels Pvt Ltd',
    45,
    'Steel',
    '29AABCS1429B1ZB',
    'Ramesh Gupta',
    '9848012345',
    'billing@salasar.com',
    'Major steel supplier',
    'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'
  ),
  (
    'aa000002-0000-4000-a000-000000000002',
    'My Home Industries',
    30,
    'Cement',
    '36AABCM1234C1ZA',
    'Naresh Reddy',
    '9848023456',
    'accounts@myhome.in',
    NULL,
    'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'
  ),
  (
    'aa000003-0000-4000-a000-000000000003',
    'Ultratech Cement Ltd',
    30,
    'Cement',
    '27AAACL1234D1ZC',
    'Accounts Dept',
    '1800220801',
    'ar@ultratech.in',
    'Credit limit Rs.50L',
    'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'
  ),
  (
    'aa000004-0000-4000-a000-000000000004',
    'Nuvoco Vistas Corp',
    21,
    'Cement',
    '27AABCN1234E1ZD',
    'Venkat S',
    '9848034567',
    'billing@nuvoco.com',
    NULL,
    'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'
  ),
  (
    'aa000005-0000-4000-a000-000000000005',
    'Dalmia Bharat Steel',
    60,
    'Steel',
    '29AABCD1234F1ZE',
    'Suresh Kumar',
    '9848045678',
    'ar@dalmia.com',
    '90-day credit available',
    'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'
  ),
  (
    'aa000006-0000-4000-a000-000000000006',
    'Orient Electric Ltd',
    15,
    'Electrical Material',
    '29AABCO1234G1ZF',
    'Pradeep Nair',
    '9848056789',
    'accounts@orient.in',
    'Strict 15-day terms',
    'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'
  ),
  (
    'aa000007-0000-4000-a000-000000000007',
    'Pidilite Industries',
    15,
    'Admixtures',
    '27AABCP1234H1ZG',
    'Sales Team',
    '1800220666',
    'ar@pidilite.com',
    NULL,
    'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'
  ),
  (
    'aa000008-0000-4000-a000-000000000008',
    'Ramco Cements',
    30,
    'Cement',
    '33AABCR1234I1ZH',
    'Balu Subramanian',
    '9848067890',
    'billing@ramco.in',
    NULL,
    'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'
  )
ON CONFLICT (name) DO NOTHING;
