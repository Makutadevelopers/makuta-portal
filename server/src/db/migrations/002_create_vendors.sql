-- 002_create_vendors.sql

CREATE TABLE IF NOT EXISTS vendors (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT UNIQUE NOT NULL,
  payment_terms INTEGER NOT NULL DEFAULT 30,
  category      TEXT,
  gstin         TEXT,
  contact_name  TEXT,
  phone         TEXT,
  email         TEXT,
  notes         TEXT,
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
