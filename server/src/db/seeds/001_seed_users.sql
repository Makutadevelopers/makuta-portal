-- 001_seed_users.sql
-- 8 users: 1 HO, 1 Mgmt, 6 Site accountants
-- Run generatePasswordHashes.js FIRST to replace __HASH_*__ placeholders with bcrypt hashes

INSERT INTO users (id, name, email, password_hash, role, site, title, is_active)
VALUES
  (
    'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
    'Rajesh Kumar',
    'rajesh@makuta.in',
    '$2b$12$UNA2bXHvNL6boXHkpA6dSucJj8H/N4pm.9cUyv/4FmRthNM0/wg6.',
    'ho',
    NULL,
    'Head Accountant',
    TRUE
  ),
  (
    'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e',
    'Arun Makuta',
    'arun@makuta.in',
    '$2b$12$.gQRbcSdWO.ffz4gKPJ.Pectxe/GR/mS2Rk24ApveyKMNaVZeazdK',
    'mgmt',
    NULL,
    'Managing Director',
    TRUE
  ),
  (
    'c3d4e5f6-a7b8-4c9d-ae1f-2a3b4c5d6e7f',
    'Suresh Reddy',
    'suresh@makuta.in',
    '$2b$12$g5JtbbCgevbDL3HHHRXa/ebso9nWYrkGoSpAA8vhRRhLYeFOScxSa',
    'site',
    'Nirvana',
    'Site Accountant',
    TRUE
  ),
  (
    'd4e5f6a7-b8c9-4d0e-9f2a-3b4c5d6e7f80',
    'Priya Sharma',
    'priya@makuta.in',
    '$2b$12$mRxe429cLqxda6aDr7FaG.W.sk14BiUPzWPBTm8qpVKnDHdiLrkLW',
    'site',
    'Taranga',
    'Site Accountant',
    TRUE
  ),
  (
    'e5f6a7b8-c9d0-4e1f-aa3b-4c5d6e7f8091',
    'Mahesh Babu',
    'mahesh@makuta.in',
    '$2b$12$6B/fLZ19bs/dLLQRNGUzJOpNEjBJj107pSvve26bgoRVq/PFMmiHq',
    'site',
    'Horizon',
    'Site Accountant',
    TRUE
  ),
  (
    'f6a7b8c9-d0e1-4f2a-bb4c-5d6e7f809102',
    'Kavitha Rao',
    'kavitha@makuta.in',
    '$2b$12$a1aTUHzRnpVJ9fT8VAsfy.Sl5Sd6uft3hKEvRMdP8JgCQFYHdOhuK',
    'site',
    'Green Wood Villas',
    'Site Accountant',
    TRUE
  ),
  (
    '07b8c9d0-e1f2-4a3b-8c5d-6e7f80910213',
    'Venkat Naidu',
    'venkat@makuta.in',
    '$2b$12$sQ7Ka4unrjpOfbbA.6HlaOup.t4uCDnYAIUDoQamfz8CBXG9HgM2.',
    'site',
    'Aruna Arcade',
    'Site Accountant',
    TRUE
  ),
  (
    '18c9d0e1-f2a3-4b4c-9d6e-7f8091021324',
    'Lakshmi Devi',
    'lakshmi@makuta.in',
    '$2b$12$rvwXWo8hqKWCJkqnYZMysOCQhv67HBIJfr7Tuf89QSt4NA8gcHQqu',
    'site',
    'Office',
    'Site Accountant',
    TRUE
  )
ON CONFLICT (email) DO NOTHING;
