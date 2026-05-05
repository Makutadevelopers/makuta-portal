#!/usr/bin/env bash
# run-ec2-backup.sh
# Wrapper invoked by cron on the production EC2 box.
# Loads the production .env (DB creds + app AWS keys), then OVERLAYS the
# dedicated backup-pipeline AWS credentials so the daily dump + S3 mirror
# write to the backup bucket without touching the live app's keys.
#
# Installed by scripts/install-ec2-backup-cron.sh — do not run by hand.

set -euo pipefail

PROD_ENV=/opt/makuta-portal/infra/prod/.env
BACKUP_CREDS=/etc/makuta/backup-creds.env
LOG_DIR=/var/log/makuta
LOG_FILE="$LOG_DIR/backup-$(date -u +%Y%m%d).log"

mkdir -p "$LOG_DIR"
exec > >(tee -a "$LOG_FILE") 2>&1

echo "############################################"
echo "# Makuta portal EC2 backup — $(date -u)"
echo "############################################"

if [ ! -f "$PROD_ENV" ];     then echo "ERROR: $PROD_ENV missing";     exit 1; fi
if [ ! -f "$BACKUP_CREDS" ]; then echo "ERROR: $BACKUP_CREDS missing"; exit 1; fi

# Load prod first, then overlay backup creds — last source wins, so the
# AWS_* in backup-creds.env replaces the app's AWS_* from prod env.
set -a
source "$PROD_ENV"
source "$BACKUP_CREDS"
set +a

# backup-all.sh derives PROJECT_DIR=/opt/makuta-portal and looks for
# /opt/makuta-portal/.env (which doesn't exist on EC2 — prod env lives
# under infra/prod/.env). The source there is skipped, so our exported
# env wins. ✓
exec /opt/makuta-portal/scripts/backup-all.sh --upload-s3
