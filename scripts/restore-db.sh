#!/usr/bin/env bash
# restore-db.sh
# Restores a PostgreSQL database from a compressed backup.
#
# Usage:
#   ./scripts/restore-db.sh backups/makuta_portal_20260407_020000.sql.gz
#   ./scripts/restore-db.sh s3://bucket/db-backups/makuta_portal_20260407_020000.sql.gz
#
# WARNING: This will DROP and recreate all tables in the target database.

set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: $0 <backup-file-or-s3-path>"
  echo "  Local:  $0 backups/makuta_portal_20260407_020000.sql.gz"
  echo "  S3:     $0 s3://bucket/db-backups/makuta_portal_20260407_020000.sql.gz"
  exit 1
fi

BACKUP_PATH="$1"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Load environment variables
if [ -f "$PROJECT_DIR/.env" ]; then
  set -a
  source "$PROJECT_DIR/.env"
  set +a
else
  echo "ERROR: .env file not found"
  exit 1
fi

echo "=== Makuta DB Restore — $(date) ==="
echo "Target: ${DB_NAME}@${DB_HOST}:${DB_PORT}"

# Download from S3 if needed
if [[ "$BACKUP_PATH" == s3://* ]]; then
  TEMP_FILE=$(mktemp /tmp/makuta_restore_XXXXXX.sql.gz)
  echo "Downloading from S3: $BACKUP_PATH"
  aws s3 cp "$BACKUP_PATH" "$TEMP_FILE" --region "${AWS_REGION:-ap-south-1}"
  BACKUP_PATH="$TEMP_FILE"
fi

# Confirm
echo ""
echo "WARNING: This will restore the database from backup."
echo "All current data in '$DB_NAME' will be overwritten."
read -p "Continue? (yes/no): " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  echo "Aborted."
  exit 0
fi

# Restore
echo "Restoring..."
gunzip -c "$BACKUP_PATH" | PGPASSWORD="$DB_PASSWORD" psql \
  -h "$DB_HOST" \
  -p "$DB_PORT" \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  --set ON_ERROR_STOP=on \
  2>&1

echo "=== Restore complete ==="

# Clean up temp file if downloaded from S3
if [[ "${TEMP_FILE:-}" != "" ]] && [ -f "$TEMP_FILE" ]; then
  rm -f "$TEMP_FILE"
fi
