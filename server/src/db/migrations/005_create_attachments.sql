-- 005_create_attachments.sql

CREATE TABLE IF NOT EXISTS attachments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id      UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  file_name       TEXT NOT NULL,
  file_size       INTEGER,
  mime_type       TEXT,
  s3_key          TEXT NOT NULL,
  s3_bucket       TEXT NOT NULL,
  uploaded_by     UUID REFERENCES users(id),
  uploaded_at     TIMESTAMPTZ DEFAULT NOW()
);
