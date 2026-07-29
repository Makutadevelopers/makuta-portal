# Region Migration Plan — us-east-1 → ap-south-1 (Mumbai)

**Why:** the app's load time is dominated by the ~250 ms each-way distance between the
servers (Virginia) and the users (India). A CDN (see cloudfront-cdn-runbook.md) fixes the
*static + TLS* latency but **not** the API round-trip — every authenticated call still
crosses the ocean. Moving the whole stack to Mumbai drops that RTT to ~20–40 ms for
*everything*, including the database. This is the ultimate fix; it's also the largest effort
and needs a maintenance window.

**Scope of the move (all currently us-east-1):**
- EC2 application host (`52.3.199.149`, `/opt/makuta-portal`) — API + web containers, co-tenant with the CRM stack.
- RDS PostgreSQL 18 (`realestate`/portal DB).
- S3 bucket(s): app file storage + `makuta-backup-use1` (backups).

> ⚠️ The EC2 box is **shared with the CRM stack** on `crm_makuta_prod_net`. Decide whether
> the CRM moves too or stays — if it stays, the portal needs its own new box in Mumbai and
> the shared-nginx fronting must be rebuilt. This decision drives most of the plan.

---

## Pre-work
- [ ] Confirm the user base is genuinely India-only (if mixed, CloudFront alone may be the better call).
- [ ] Inventory every hardcoded `us-east-1` / endpoint: RDS host, S3 bucket region, SDK region configs, `infra/prod/*`, env files, deploy scripts.
- [ ] Decide CRM co-tenancy (move together vs. split the portal onto its own Mumbai host).
- [ ] Schedule a maintenance window (portal is in live use during the workday — evenings).
- [ ] Take a verified backup immediately before cutover (we already have the on-demand tooling).

## Phase 1 — Network + host (ap-south-1)
- [ ] VPC/subnets/security groups in ap-south-1 mirroring current SGs.
- [ ] Launch the new EC2 host; install Docker; clone `/opt/makuta-portal`; bring images.
- [ ] Re-create the nginx fronting (portal-web + portal-api) for the new box.

## Phase 2 — Database (the careful part)
Two options:
- **A. Snapshot copy (simple, has downtime):**
  - [ ] RDS snapshot in us-east-1 → **copy snapshot** to ap-south-1 → restore as new instance.
  - [ ] Downtime = time between final snapshot and cutover; any writes after the snapshot are lost unless you re-sync.
- **B. Logical replication (minimal downtime, more work):**
  - [ ] Set up a Mumbai RDS as a logical replica (pglogical / native logical replication) from Virginia.
  - [ ] Let it catch up; cut over when lag ≈ 0.
- [ ] Either way: keep SSL required; update `DB_HOST`/`DB_*` env on the new host.
- [ ] Verify row counts + a checksum on key tables (invoices, payments) post-restore.

## Phase 3 — S3 / files
- [ ] Create ap-south-1 bucket(s); `aws s3 sync` existing objects across.
- [ ] Update app S3 region/bucket env + any presigned-URL region config.
- [ ] Re-point the backup LaunchAgent/cron prefixes if the bucket name changes.

## Phase 4 — Cutover
- [ ] Lower DNS TTL (60 s) ahead of time.
- [ ] Maintenance window: stop writes on old → final DB sync (option A: final snapshot/restore; option B: confirm zero lag).
- [ ] Bring up Mumbai stack; smoke test `/api/health`, login, invoice list, a payment, an attachment view.
- [ ] Flip DNS `invoice.makutadevelopers.com` → Mumbai (or its CloudFront origin).
- [ ] Watch logs + the deploy health probe.

## Phase 5 — Decommission
- [ ] Keep Virginia stack idle (not deleted) for a rollback window (e.g. 1 week).
- [ ] Confirm backups now run against Mumbai; verify a restore.
- [ ] Tear down old EC2/RDS/S3 once confident.

## Rollback
Until DNS is flipped and the old stack is torn down, rollback = re-point DNS to Virginia.
After teardown, rollback means restoring from backup — so **don't delete the old stack until
a few clean days** on Mumbai.

## Cost/effort note
- Effort: ~1–2 focused days incl. testing; the DB cutover is the risk.
- Combine with CloudFront for best result (edge for static + nearby origin for API).
- If CRM stays in Virginia, factor in cross-region calls between portal and any shared CRM
  resources (the portal currently shares the CRM Docker network/nginx).
