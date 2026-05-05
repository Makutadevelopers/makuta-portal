-- 020_add_password_reset.sql
-- Self-service password reset flow.
-- Token is generated server-side, the SHA-256 hash is stored (not the raw token).
-- Expiry is 30 minutes from issue.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS reset_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS reset_token_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS users_reset_token_hash_idx ON users (reset_token_hash);
