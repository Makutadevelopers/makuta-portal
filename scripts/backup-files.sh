#!/usr/bin/env bash
# backup-files.sh
# Mirrors the S3 invoice-attachments bucket to a local directory and (optionally)
# to a backup S3 bucket under a date-stamped prefix.
#
# Usage:
#   ./scripts/backup-files.sh                    # local mirror only
#   ./scripts/backup-files.sh --upload-s3        # local mirror + S3 snapshot
#
# Requirements:
#   - aws CLI (configured via .env: AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY)
#   - .env file with S3_BUCKET_NAME (source) and optional S3_BACKUP_BUCKET (dest)
#
# Env knobs (override in .env or shell):
#   FILES_BACKUP_DIR    Local mirror destination (default: $BACKUP_DIR/files)
#   S3_BACKUP_BUCKET    Destination bucket for date-stamped snapshot
#   AWS_REGION          AWS region (default: ap-south-1)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

if [ -f "$PROJECT_DIR/.env" ]; then
  set -a
  source "$PROJECT_DIR/.env"
  set +a
else
  echo "ERROR: .env file not found at $PROJECT_DIR/.env"
  exit 1
fi

if [ -z "${S3_BUCKET_NAME:-}" ]; then
  echo "ERROR: S3_BUCKET_NAME is not set in .env"
  exit 1
fi

BACKUP_DIR="${BACKUP_DIR:-$PROJECT_DIR/backups}"
FILES_BACKUP_DIR="${FILES_BACKUP_DIR:-$BACKUP_DIR/files}"
S3_BACKUP_BUCKET="${S3_BACKUP_BUCKET:-}"
AWS_REGION="${AWS_REGION:-ap-south-1}"
DATE_STAMP=$(date +%Y-%m-%d)

mkdir -p "$FILES_BACKUP_DIR"

echo "=== Makuta S3 file backup — $(date) ==="
echo "Source:    s3://$S3_BUCKET_NAME"
echo "Local dst: $FILES_BACKUP_DIR"

# Local mirror — incremental sync (only new/changed files transferred).
# We keep a single live mirror locally so the on-disk size stays bounded.
aws s3 sync \
  "s3://$S3_BUCKET_NAME/" \
  "$FILES_BACKUP_DIR/" \
  --region "$AWS_REGION" \
  --exact-timestamps

LOCAL_SIZE=$(du -sh "$FILES_BACKUP_DIR" | cut -f1)
LOCAL_COUNT=$(find "$FILES_BACKUP_DIR" -type f | wc -l | tr -d ' ')
echo "Local mirror: $LOCAL_COUNT files, $LOCAL_SIZE"

# Optional S3 snapshot under date-stamped prefix in a separate backup bucket.
if [[ "${1:-}" == "--upload-s3" ]]; then
  if [ -z "$S3_BACKUP_BUCKET" ]; then
    echo "ERROR: --upload-s3 requested but S3_BACKUP_BUCKET is not set in .env"
    exit 1
  fi
  if [ "$S3_BACKUP_BUCKET" = "$S3_BUCKET_NAME" ]; then
    echo "ERROR: S3_BACKUP_BUCKET must be a DIFFERENT bucket from S3_BUCKET_NAME"
    echo "       Storing backups in the source bucket defeats the purpose."
    exit 1
  fi
  DEST="s3://$S3_BACKUP_BUCKET/file-backups/$DATE_STAMP/"
  echo "S3 snapshot: $DEST"
  aws s3 sync \
    "s3://$S3_BUCKET_NAME/" \
    "$DEST" \
    --region "$AWS_REGION" \
    --storage-class STANDARD_IA
  echo "S3 snapshot complete"
fi

echo "=== File backup complete ==="
