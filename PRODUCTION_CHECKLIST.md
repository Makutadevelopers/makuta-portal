# Production Deployment Checklist — Makuta Portal

Run through every item before pointing real users at this system.
The backend will **refuse to start** with `NODE_ENV=production` if any of
the items marked **ENFORCED** are missing or use dev defaults — that check
lives in `server/src/config/env.ts`.

---

## 1. Secrets & credentials

- [ ] **JWT_SECRET** (ENFORCED) — generate with `openssl rand -hex 48`, paste into production `.env`. Must be 48+ chars and not contain the placeholder string.
- [ ] **DB_PASSWORD** (ENFORCED) — must be strong (12+ chars) and not `localdevpassword`. Store in a secret manager, not git.
- [ ] **CRON_SECRET** (ENFORCED) — generate with `openssl rand -hex 32`. Required for scheduled jobs (`POST /api/cron/overdue-alert`).
- [ ] **AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY** (ENFORCED) — real IAM user with `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject` on `S3_BUCKET_NAME` only. Scope narrowly.
- [ ] **SMTP_USER / SMTP_PASS** — set these if you want invoice-pushed / payment-recorded / overdue emails. Empty = emails silently skipped (check server logs).

## 2. Infrastructure

- [ ] **Database**: AWS RDS PostgreSQL 16 in `ap-south-1`, multi-AZ for production.
- [ ] **DB_SSL=true** (ENFORCED) — RDS requires TLS in transit.
- [ ] **S3 bucket** exists in `ap-south-1`, versioning enabled, public access fully blocked, lifecycle rule for attachments older than ~3 years if desired.
- [ ] **Private subnets** for EC2/ECS running the Node server; public load balancer in front.
- [ ] **HTTPS everywhere** — terminate TLS at the ALB. Never serve `/api` over plain HTTP (the JWT would leak).
- [ ] **Automated backups** — RDS automated backup window set, retention ≥ 7 days.

## 3. CORS & client config

- [ ] **ALLOWED_ORIGINS** (ENFORCED) — set to the real frontend domain(s), comma-separated. Must not contain `localhost`.
- [ ] **VITE_API_BASE_URL** — point to the production API URL (e.g. `https://portal.makutadevelopers.com/api`).
- [ ] **VITE_DEMO_MODE=false** — never expose the demo login hints on a production login page.

## 4. Database migrations & seed data

- [ ] Run `npm run db:migrate` against the production database — all 14 migrations should apply cleanly.
- [ ] **Replace seeded users** — `001_seed_users.sql` has hard-coded accounts with weak passwords (`ho123`, `md123`, `nv123` …). Before go-live:
  - Create real user accounts with `bcrypt` hashes generated from strong passwords.
  - Delete or disable the demo accounts (`UPDATE users SET is_active = FALSE WHERE email IN (…)`).
- [ ] Seed only the **vendors** and **users** tables for production — invoices/payments will be entered by the real users.

## 5. Scheduled jobs

- [ ] Cron entry calling `POST /api/cron/overdue-alert` with header `x-cron-secret: <CRON_SECRET>` — runs daily at e.g. 9 AM IST.
- [ ] Cron entry calling `POST /api/invoices/bin/purge` (authenticated as HO) to auto-delete 30-day-old bin entries weekly.

## 6. Code / build

- [ ] `npm run typecheck` — 0 errors.
- [ ] `npm run lint` — 0 errors.
- [ ] `npm run build` — successful for both `client` and `server`.
- [ ] **Commit everything** — no uncommitted production changes allowed.
- [ ] Run `git log --oneline -20` — every commit has a meaningful message.

## 7. Monitoring & observability

- [ ] **Structured logging** — pipe `console.error` / `console.log` to CloudWatch Logs or similar.
- [ ] **Uptime check** — an external probe hitting `GET /api/health` (add one if not present) every 1 minute.
- [ ] **DB slow query log** — RDS parameter group set to log queries > 1 second.
- [ ] **S3 access logs** — enabled to a separate bucket.
- [ ] **Error alerting** — any `Unhandled error:` log line should page the on-call engineer.

## 8. Security

- [ ] **Rate limiting** — `express-rate-limit` is already installed (check `server/src/index.ts`). Confirm it's applied to `/api/auth/login` at minimum.
- [ ] **helmet** — already installed. Confirm it's applied globally.
- [ ] **CSP headers** — configure in helmet for the frontend domain.
- [ ] **Session timeout** — JWT_EXPIRES_IN=8h is reasonable; any 401 now auto-logs out the frontend (fix H6).
- [ ] **Audit log retention** — decide how long `audit_logs` rows are kept (recommend ≥ 1 year for financial data).
- [ ] **Backup the demo accounts** before disabling them in case you need to roll back.

## 9. RBAC final verification

- [ ] Log in as each of the three roles and confirm:
  - `ho` sees all invoices, all sites, can create / edit / delete / finalize.
  - `mgmt` sees all invoices **read-only** — no New Invoice button, no Mark Paid, no delete.
  - `site` sees only their own site, cannot see payment data at all, can create up to ₹50k minor payments only, **cannot pay finalized invoices** (H4 fix), **cannot change invoice.site** (H1 fix), **cannot bulk-import payments** (C2 fix).

## 10. Data-correctness smoke tests

- [ ] Create an invoice → soft-delete → verify hidden from Dashboard / All Invoices / Cashflow / Payment Aging / PDF export / Bin shows it restorable.
- [ ] Create invoice with `confirm_duplicate` flow — single create returns 409; bulk import shows preview with per-row confirm/dismiss.
- [ ] Record a payment larger than balance → 400.
- [ ] Run `curl -s -X POST http://…/api/cron/overdue-alert -H "x-cron-secret: $CRON_SECRET"` → non-empty response (or "No overdue invoices").
- [ ] Upload a `.heic` photo → 201; upload an `.exe` → 400.

---

## Quick-reference commands

```bash
# Generate secrets
openssl rand -hex 48          # JWT_SECRET
openssl rand -hex 32          # CRON_SECRET

# Generate a bcrypt hash for a real user password (run from server/)
node -e "require('bcrypt').hash('STRONG_PASSWORD_HERE', 12).then(h => console.log(h))"

# Apply DB migrations to production
DB_HOST=<rds-endpoint> DB_SSL=true DB_USER=<user> DB_PASSWORD=<pw> DB_NAME=makuta_portal \
  npm run db:migrate

# Full build
cd client && npm run build   # builds client/dist
cd ../server && npm run build # builds server/dist
```

---

## What's already fixed in this release

All 32 findings from the production-readiness audit (`makuta-audit-report.pdf`) are closed.
See the summary in the final "Complete Fix Summary" message of the conversation that produced this checklist, or run `git log` after committing.
