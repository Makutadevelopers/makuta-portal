#!/usr/bin/env bash
# backup-db.sh
# Creates a compressed PostgreSQL dump and optionally uploads to S3.
#
# Usage:
#   ./scripts/backup-db.sh                    # local backup only
#   ./scripts/backup-db.sh --upload-s3        # local + S3 upload
#
# Requirements:
#   - pg_dump (PostgreSQL client tools)
#   - aws CLI (only if using --upload-s3)
#   - .env file with DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
#
# Cron example (daily at 2 AM):
#   0 2 * * * /path/to/makuta-portal/scripts/backup-db.sh --upload-s3 >> /var/log/makuta-backup.log 2>&1

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Load environment variables
if [ -f "$PROJECT_DIR/.env" ]; then
  set -a
  source "$PROJECT_DIR/.env"
  set +a
else
  echo "ERROR: .env file not found at $PROJECT_DIR/.env"
  exit 1
fi

# Configuration
BACKUP_DIR="${BACKUP_DIR:-$PROJECT_DIR/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
S3_BACKUP_BUCKET="${S3_BACKUP_BUCKET:-${S3_BUCKET_NAME}}"
S3_BACKUP_PREFIX="db-backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="makuta_${DB_NAME}_${TIMESTAMP}.sql.gz"

# Create backup directory
mkdir -p "$BACKUP_DIR"

echo "=== Makuta DB Backup — $(date) ==="
echo "Database: ${DB_NAME}@${DB_HOST}:${DB_PORT}"

# Create compressed backup
PGPASSWORD="$DB_PASSWORD" pg_dump \
  -h "$DB_HOST" \
  -p "$DB_PORT" \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  --no-owner \
  --no-privileges \
  --format=plain \
  --verbose \
  2>/dev/null | gzip > "$BACKUP_DIR/$BACKUP_FILE"

FILESIZE=$(du -h "$BACKUP_DIR/$BACKUP_FILE" | cut -f1)
echo "Backup created: $BACKUP_DIR/$BACKUP_FILE ($FILESIZE)"

# Upload to S3 if requested
if [[ "${1:-}" == "--upload-s3" ]]; then
  echo "Uploading to S3: s3://$S3_BACKUP_BUCKET/$S3_BACKUP_PREFIX/$BACKUP_FILE"
  aws s3 cp "$BACKUP_DIR/$BACKUP_FILE" \
    "s3://$S3_BACKUP_BUCKET/$S3_BACKUP_PREFIX/$BACKUP_FILE" \
    --storage-class STANDARD_IA \
    --region "${AWS_REGION:-ap-south-1}"
  echo "S3 upload complete"
fi

# Clean up old local backups (keep last N days)
echo "Cleaning backups older than $RETENTION_DAYS days..."
find "$BACKUP_DIR" -name "makuta_*.sql.gz" -mtime +"$RETENTION_DAYS" -delete 2>/dev/null || true

# List remaining backups
BACKUP_COUNT=$(find "$BACKUP_DIR" -name "makuta_*.sql.gz" | wc -l | tr -d ' ')
echo "Local backups retained: $BACKUP_COUNT"
echo "=== Backup complete ==="
