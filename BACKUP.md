# Backup & Restore

> When something has already gone wrong, jump straight to [RECOVERY.md](RECOVERY.md).

Complete daily backup of everything that matters: the PostgreSQL database
(all sites, invoices, payments, vendors, audit log, petty cash) **and** the
S3 invoice-attachment files. Three independent destinations:

1. **AWS S3 backup bucket (`makuta-backup-use1`)** — production EC2 cron
   runs `pg_dump` at 02:00 UTC, pushes the compressed dump and an S3 file
   mirror to `s3://makuta-backup-use1/{db,file}-backups/…`. EC2 sits in
   the same VPC as RDS, so no public-RDS exposure is needed.
2. **GitHub Actions artifact (off-AWS copy)** — a workflow runs at 05:00
   UTC, downloads the latest dump from the backup bucket, and stores it
   as a 90-day GHA artifact. Survives "AWS account lost" scenarios.
3. **External hard drive** — runs **on demand** when you plug a backup
   drive into the Mac and run one command. Nothing scheduled.

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

## Cloud backup (automatic, EC2-driven)

The actual `pg_dump` runs on the production EC2 box because RDS is not
publicly accessible — only resources inside the VPC can reach it. The EC2
cron writes dumps + S3 file mirrors into a dedicated backup bucket; a
separate GitHub Actions workflow then mirrors those dumps into a 90-day
GHA artifact for off-AWS retention.

### Step A — backup bucket + IAM user (one-time, already provisioned)

For this account the backup bucket (`makuta-backup-use1`) and a dedicated
IAM user (`makuta-backup-automation`) already exist. The IAM user policy
allows **read** on `makuta-portal-use1` and **put/list** on
`makuta-backup-use1` — **no `s3:Delete*`** anywhere. For a fresh setup
elsewhere, [infra/terraform/backup/](infra/terraform/backup/) bootstraps
the same shape (versioned bucket, encryption, lifecycle rules, scoped
IAM user).

### Step B — install the cron on the EC2 box

1. Generate an access key for `makuta-backup-automation` on your laptop:
   ```
   aws iam create-access-key --user-name makuta-backup-automation \
     | python3 -c "import json,sys,os; \
         k=json.load(sys.stdin)['AccessKey']; \
         open('/tmp/makuta-backup-key.env','w').write( \
           f'AWS_ACCESS_KEY_ID={k[\"AccessKeyId\"]}\n' \
           f'AWS_SECRET_ACCESS_KEY={k[\"SecretAccessKey\"]}\n' \
           f'S3_BACKUP_BUCKET=makuta-backup-use1\n' \
           f'AWS_REGION=us-east-1\n'); \
         os.chmod('/tmp/makuta-backup-key.env',0o600)"
   ```
2. Copy the key file to the EC2 box and install:
   ```
   scp /tmp/makuta-backup-key.env ec2-user@52.3.199.149:/tmp/
   ssh ec2-user@52.3.199.149
   cd /opt/makuta-portal && git pull
   sudo bash scripts/install-ec2-backup-cron.sh /tmp/makuta-backup-key.env
   ```
   The installer:
   - moves the key file to `/etc/makuta/backup-creds.env` (root:root, 600)
   - adds a root crontab entry that fires every day at 02:00 UTC
   - runs the backup once now to verify

3. Cleanup on both ends:
   ```
   rm /tmp/makuta-backup-key.env       # both your laptop and the EC2 box
   ```

After install, daily logs land at `/var/log/makuta/backup-YYYYMMDD.log`.

### Step C — GHA mirror secrets

The mirror workflow at
[.github/workflows/daily-db-backup.yml](.github/workflows/daily-db-backup.yml)
needs **read** access to the backup bucket so it can pull the freshest
dump and store it as a 90-day artifact. Set these repo secrets at
**Settings → Secrets and variables → Actions**:

| Secret | Value |
|---|---|
| `AWS_ACCESS_KEY_ID` | a key from `makuta-backup-automation` |
| `AWS_SECRET_ACCESS_KEY` | (matching secret) |
| `AWS_REGION` | `us-east-1` |
| `S3_BACKUP_BUCKET` | `makuta-backup-use1` |

The workflow runs at 05:00 UTC (~3h after the EC2 cron), downloads the
freshest dump from the bucket, and stores it as `db-backup-<run-number>`.

`DATABASE_URL` is no longer used by the workflow — it can be deleted from
GH secrets (the EC2 cron uses the production `.env` directly).

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
