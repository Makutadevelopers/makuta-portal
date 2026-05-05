# Recovery Runbook

Step-by-step recovery for the four realistic disaster scenarios. See
[BACKUP.md](BACKUP.md) for how the backups themselves are produced.

Inputs you need before starting any recovery:

- This GitHub repo (clone fresh: `git clone <repo-url>`)
- Either: the external backup drive, or access to GitHub Actions artifacts
- A target Postgres + S3 (existing or freshly provisioned)

---

## Scenario 1 — AWS account lost (banned, suspended, locked out)

**What's gone:** live RDS database, live S3 invoice bucket, cloud backup
bucket, the EC2 host, CloudFront, the IAM user.
**What survives:** external drive + GitHub repo + GitHub Actions artifacts.
**Recovery time:** 4–8 hours assuming a fresh AWS account or another
provider is ready.

### 1.1 Stand up new infrastructure
- Open a new AWS account, or pick another provider (Hetzner, DigitalOcean,
  GCP, etc.).
- Provision Postgres (RDS / managed Postgres) and an S3-compatible bucket.
- If returning to AWS, you can re-run the Terraform module:
  ```
  cd infra/terraform/backup
  # edit terraform.tfvars with new bucket name
  terraform init && terraform apply
  ```

### 1.2 Restore the database
Pick the freshest dump from either source.

From the drive:
```
ls -lht /Volumes/MakutaBackup/makuta-portal/*.sql.gz | head
./scripts/restore-db.sh /Volumes/MakutaBackup/makuta-portal/makuta_makuta_portal_<latest>.sql.gz
```

From GitHub Actions:
- Open **Actions → Daily full backup → most recent successful run → Artifacts**
- Download the `db-backup-<n>.zip`, unzip it
- `./scripts/restore-db.sh ./makuta_portal_<latest>.sql.gz`

Point `.env` at the new Postgres host before running restore.

### 1.3 Restore the invoice files
The drive holds a complete mirror at `<drive>/makuta-portal/files/`.
Push it to the new bucket:
```
aws s3 sync /Volumes/MakutaBackup/makuta-portal/files/ s3://<new-bucket-name>/
```

If your "new bucket" is non-AWS (R2, B2, etc.), set `AWS_ENDPOINT_URL`
accordingly and the same `aws s3 sync` works.

### 1.4 Redeploy the app
- Update `.env` (new DB host, new S3 bucket, new region, new keys, new
  `JWT_SECRET` — old one is irrelevant since users log in fresh).
- Build and deploy: `npm run build`, then push to the new host using your
  usual deploy process (`infra/prod/deploy.sh` or equivalent).
- Update DNS to point at the new host.

### 1.5 Sanity-check
- Log in as HO; spot-check 3–5 invoices for amount + vendor + payment status.
- Open a recent invoice with a PDF attachment — verify the file loads.
- Check the audit log shows entries from before the recovery.

---

## Scenario 2 — Drive lost or corrupted

**What's gone:** local mirror of S3 files, local DB dumps.
**What survives:** everything in AWS (live DB + S3 + cloud backup bucket),
plus 90 days of DB dumps in GitHub Actions artifacts.
**Recovery time:** zero — production is unaffected. Just rebuild the drive
backup.

### 2.1 Get a new drive (or remount the old one)
Format APFS (case-sensitive). See [BACKUP.md](BACKUP.md) for choices.

### 2.2 Run a fresh backup to it
```
./scripts/backup-to-drive.sh /Volumes/<new-drive>
```
This dumps the live DB and pulls down the entire S3 bucket. Takes a while
on first run; subsequent runs are incremental.

No data is at risk during this scenario — the drive is a redundant copy.

---

## Scenario 3 — Database corrupted (bad migration, accidental delete, etc.)

**What's gone:** the live database is in a bad state. S3 files are fine.
**Recovery time:** 15–30 minutes.
**Data loss:** anything written since the last good dump (≤24h with daily
GHA backups).

### 3.1 Stop writes immediately
Take the app offline so users don't write more bad data on top of bad data.
The fastest way: stop the app server / scale it to zero.

### 3.2 Pick the most recent **good** dump
"Most recent" is not always right — if the corruption happened yesterday,
yesterday's dump is also corrupt. Look at the dump from before the bad
event.

```
# From drive (date-stamped filenames)
ls -lht /Volumes/MakutaBackup/makuta-portal/*.sql.gz

# From GHA (Actions → Daily full backup → pick a run from before the incident)
```

### 3.3 Restore into a side database first (safety check)
Don't blow away the live DB before you've confirmed the dump is clean.

```
# In .env, temporarily point DB_NAME at a scratch DB on the same RDS
DB_NAME=makuta_portal_restore_test
./scripts/restore-db.sh <chosen-dump>.sql.gz
```

Connect with psql, run a few sanity queries (row counts, recent invoices),
confirm the data looks right.

### 3.4 Restore for real
Point `.env` back at the live DB and re-run:
```
./scripts/restore-db.sh <chosen-dump>.sql.gz
```

### 3.5 Re-replay anything you can recover
For data lost between the dump and the incident: check if anyone has
emails/PDFs of the affected invoices and re-enter manually. The audit log
in the restored dump shows what existed before the gap.

### 3.6 Bring the app back up
Resume the app server. Spot-check as in 1.5.

---

## Scenario 4 — A single invoice PDF lost from S3

**What's gone:** one (or a few) invoice attachment files in the live bucket.
DB metadata still references them, so the UI shows a broken link.
**Recovery time:** seconds per file.

### 4.1 Find the s3_key
Look up the missing file's `s3_key` in the database:
```sql
SELECT id, file_name, s3_key
FROM attachments
WHERE id = '<attachment-uuid>';
```

### 4.2 Re-upload from the drive's mirror
```
aws s3 cp \
  /Volumes/MakutaBackup/makuta-portal/files/<s3_key> \
  s3://makuta-invoice-attachments/<s3_key>
```

That's it — the `s3_key` column already points at the right path, so the
UI starts working again immediately.

If the file isn't in the drive mirror either, check the date-stamped
snapshots in the cloud backup bucket:
```
aws s3 ls s3://makuta-backups-prod/file-backups/ --recursive | grep <s3_key>
aws s3 cp s3://makuta-backups-prod/file-backups/<date>/<s3_key> \
          s3://makuta-invoice-attachments/<s3_key>
```

---

## After any recovery

1. Run `./scripts/backup-to-drive.sh --upload-s3` to refresh both copies
   against the recovered live state.
2. Open a GitHub issue noting what happened, what was restored from, and
   what (if anything) was permanently lost. Useful next time.
3. If you found a hole in the backup setup during recovery, fix it and
   update [BACKUP.md](BACKUP.md).
