-- 054_add_reset_attempt_counter.sql
-- Caps how many times a password-reset OTP can be guessed.
--
-- Before this, a wrong OTP returned 400 and left the code valid for its full
-- 15-minute window. With only the global 200/min/IP limiter in front of it,
-- that allowed roughly 3,000 guesses per window per IP against a 6-digit
-- (1,000,000-value) code — and more from additional IPs, since a per-IP limit
-- cannot bound a distributed attempt.
--
-- A per-ACCOUNT counter fixes this regardless of how many IPs an attacker has,
-- and — unlike a per-IP login limit — it cannot be tripped by the office
-- sharing one NAT address (see the note in auth.routes.ts).
--
-- Reset to 0 whenever a new OTP is issued, and the row is cleared on success,
-- so this never accumulates against a legitimate user.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS reset_attempts INTEGER NOT NULL DEFAULT 0;
