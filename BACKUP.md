# Backup & Restore

> When something has already gone wrong, jump straight to [RECOVERY.md](RECOVERY.md).

Complete daily backup of everything that matters: the PostgreSQL database
(all sites, invoices, payments, vendors, audit log, petty cash) **and** the
S3 invoice-attachment files. Two independent destinations:

1. **Cloud (GitHub Actions + a separate S3 backup bucket)** — runs daily at
   20:30 UTC automatically. No manual action needed.
2. **External hard drive** — runs **on demand** when you plug your backup
   drive into the Mac and run one command. Nothing is scheduled, so the
   drive does not need to live attached to the machine.

## What gets backed up

| Data | Mechanism |
|---|---|
| invoices, payments, vendors, users, audit_logs, petty_cash_*, attachments metadata, credit_notes, bank_transactions, alerts | `pg_dump` (full schema + data) |
| Invoice PDF files in S3 (`makuta-invoice-attachments`) | `aws s3 sync` to local mirror + date-stamped snapshot in backup bucket |

---

## Backing up to your external drive (on demand)

### One-time prep when you get the new drive

1. Format it. Recommended:
   - **APFS (case-sensitive)** — best on macOS. S3 filenames may differ only
     in case, so a case-insensitive filesystem will collapse them.
   - **ExFAT** is fine if the drive will move between Mac/Windows.
   - **Avoid FAT32** — it cannot store files larger than 4 GiB.
2. Plug it in and confirm it shows up: `ls /Volumes`
3. (Optional) Set `APP_NAME` in `.env` if the default `makuta-portal` is not
   the folder name you want on the drive.

### Running a backup

Plug the drive in, then run **one** of:

```
# Interactive — lists every drive currently mounted under /Volumes and asks
# you to pick one. Backup lands at /Volumes/<picked>/<APP_NAME>/.
./scripts/backup-to-drive.sh

# Direct — pass the drive path as the first argument.
./scripts/backup-to-drive.sh /Volumes/MakutaBackup

# Direct + also push copies to the cloud backup bucket in the same run.
./scripts/backup-to-drive.sh /Volumes/MakutaBackup --upload-s3
```

The script:
- refuses to run if the drive is not actually mounted (no silent fallback to
  the boot disk),
- refuses to run if there is less than `MIN_FREE_GB` (default 5 GiB) free,
- writes everything under `<drive>/<APP_NAME>/` so several apps can share
  one drive without colliding,
- prints the safe-eject command at the end.

When it finishes you can unplug the drive and put it away.

---

## Cloud backup (automatic)

### Step A — provision the backup bucket + IAM user (Terraform)

Self-contained module at [infra/terraform/backup/](infra/terraform/backup/).
Creates a versioned, encrypted, public-access-blocked bucket with lifecycle
rules (file snapshots → Glacier IR after 30 days, expire after a year; old
versions expire after 90 days), plus an IAM user whose policy can **read**
the source bucket and **put/list** on the backup bucket but cannot delete
anything on either side.

```
cd infra/terraform/backup
cp terraform.tfvars.example terraform.tfvars
# edit terraform.tfvars — at minimum set a globally unique backup_bucket_name
terraform init
terraform apply

# grab the outputs
terraform output -raw backup_bucket_name
terraform output -raw backup_user_access_key_id
terraform output -raw backup_user_secret_access_key
```

### Step B — wire the secrets into GitHub Actions

At **Settings → Secrets and variables → Actions** add:

| Secret | Source |
|---|---|
| `DATABASE_URL` | Postgres connection string for the dump |
| `AWS_ACCESS_KEY_ID` | `terraform output backup_user_access_key_id` |
| `AWS_SECRET_ACCESS_KEY` | `terraform output backup_user_secret_access_key` |
| `AWS_REGION` | e.g. `ap-south-1` |
| `S3_SOURCE_BUCKET` | server's `S3_BUCKET_NAME` (live invoice bucket) |
| `S3_BACKUP_BUCKET` | `terraform output backup_bucket_name` |

The workflow at [.github/workflows/daily-db-backup.yml](.github/workflows/daily-db-backup.yml)
runs daily and:

- dumps the DB to a 90-day GitHub artifact,
- copies the dump to `s3://$S3_BACKUP_BUCKET/db-backups/YYYY-MM-DD/`,
- mirrors invoice files to `s3://$S3_BACKUP_BUCKET/file-backups/YYYY-MM-DD/`.

If the AWS secrets are missing, the S3 steps skip gracefully (DB-only backup).

---

## Reusing this pattern across your other apps

The drive backup is deliberately app-agnostic. To add a new app:

1. Copy these four files into the other repo's `scripts/`:
   - `backup-db.sh`, `backup-files.sh`, `backup-all.sh`, `backup-to-drive.sh`
2. In that repo's `.env`, set `APP_NAME=<that-app-name>`.
3. Plug the same drive in, run `./scripts/backup-to-drive.sh`, pick the same
   drive. Backups land at `/Volumes/<drive>/<that-app-name>/`.

Each app gets its own folder on the drive, its own DB dump cadence, and its
own S3 mirror. The drive becomes a single "backups" volume for everything
you build.

---

## Restore

### Database

```
./scripts/restore-db.sh /Volumes/MakutaBackup/makuta-portal/makuta_makuta_portal_20260505_020000.sql.gz

# or from S3
./scripts/restore-db.sh s3://makuta-backups-prod/db-backups/2026-05-05/makuta_makuta_portal_20260505_020000.sql.gz
```

The script prompts for confirmation before overwriting.

### S3 files

```
# Restore an entire day's snapshot back into the live bucket
aws s3 sync \
  s3://makuta-backups-prod/file-backups/2026-05-05/ \
  s3://makuta-invoice-attachments/

# Or pull from your drive's local mirror
aws s3 sync /Volumes/MakutaBackup/makuta-portal/files/ \
  s3://makuta-invoice-attachments/
```

## Verifying backups

After every drive backup:

```
ls -lh /Volumes/MakutaBackup/makuta-portal/        # newest dump = today
du -sh /Volumes/MakutaBackup/makuta-portal/files/  # mirror size matches S3 source
```

For the cloud backup: open **Actions → Daily full backup** — the latest run
should be green within the last 24 h.
