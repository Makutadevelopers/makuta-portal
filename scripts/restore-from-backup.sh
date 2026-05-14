#!/usr/bin/env bash
# restore-from-backup.sh
# One-command disaster recovery: rebuild the Makuta portal database +
# invoice files from the most recent (or a specific-date) backup.
#
# DANGER: this OVERWRITES the current database and live invoice bucket.
# Always run --dry-run first. The script will not proceed without an
# explicit "RESTORE NOW" confirmation typed at the prompt (or --yes).
#
# Usage:
#   ./scripts/restore-from-backup.sh                          # interactive — restore latest from S3
#   ./scripts/restore-from-backup.sh --dry-run                # show what would happen, change nothing
#   ./scripts/restore-from-backup.sh --date 2026-05-13        # restore from a specific date
#   ./scripts/restore-from-backup.sh --db-only                # only restore the database
#   ./scripts/restore-from-backup.sh --files-only             # only restore the files
#   ./scripts/restore-from-backup.sh --source local --path <dir>
#     # restore from a local backup tree (e.g. /Volumes/mac-scratch/Backups/invoice\ portal/2026-05-13)
#   ./scripts/restore-from-backup.sh --yes                    # skip the typed confirmation
#
# Required environment (.env or shell):
#   DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD  — target database
#   DB_ADMIN_USER (optional, default = DB_USER)      — must be able to DROP/CREATE the target DB
#   DB_ADMIN_PASSWORD (optional, default = DB_PASSWORD)
#   S3_BUCKET_NAME                                   — live invoice bucket (target for file restore)
#   S3_BACKUP_BUCKET                                 — backup bucket (source)
#   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION
#
# Exits non-zero on any failure. Safe to wire into a runbook.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# ─── Defaults / arg parsing ────────────────────────────────────────────────
SOURCE_KIND="s3"
SOURCE_PATH=""
DATE=""
DB_ONLY=false
FILES_ONLY=false
DRY_RUN=false
ASSUME_YES=false

usage() {
  sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's|^# \?||'
  exit "${1:-1}"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)    DRY_RUN=true; shift ;;
    --yes)        ASSUME_YES=true; shift ;;
    --db-only)    DB_ONLY=true; shift ;;
    --files-only) FILES_ONLY=true; shift ;;
    --date)       DATE="$2"; shift 2 ;;
    --source)     SOURCE_KIND="$2"; shift 2 ;;
    --path)       SOURCE_PATH="$2"; shift 2 ;;
    -h|--help)    usage 0 ;;
    *)            echo "Unknown flag: $1"; usage ;;
  esac
done

if $DB_ONLY && $FILES_ONLY; then
  echo "ERROR: --db-only and --files-only are mutually exclusive"
  exit 1
fi
if [ "$SOURCE_KIND" = "local" ] && [ -z "$SOURCE_PATH" ]; then
  echo "ERROR: --source local requires --path <dir>"
  exit 1
fi

# ─── Load env ──────────────────────────────────────────────────────────────
if [ -f "$PROJECT_DIR/.env" ]; then
  set -a
  source "$PROJECT_DIR/.env"
  set +a
fi
if [ -f /etc/makuta/backup-creds.env ]; then
  set -a
  source /etc/makuta/backup-creds.env
  set +a
fi

DB_ADMIN_USER="${DB_ADMIN_USER:-${DB_USER:-}}"
DB_ADMIN_PASSWORD="${DB_ADMIN_PASSWORD:-${DB_PASSWORD:-}}"

# ─── Validate required vars ────────────────────────────────────────────────
required_for_db=(DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWORD DB_ADMIN_USER DB_ADMIN_PASSWORD)
required_for_files=(S3_BUCKET_NAME S3_BACKUP_BUCKET AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_REGION)

if ! $FILES_ONLY; then
  for v in "${required_for_db[@]}"; do
    if [ -z "${!v:-}" ]; then echo "ERROR: $v is not set"; exit 1; fi
  done
fi
if ! $DB_ONLY; then
  for v in "${required_for_files[@]}"; do
    if [ -z "${!v:-}" ]; then echo "ERROR: $v is not set"; exit 1; fi
  done
fi

# ─── Discover source paths ─────────────────────────────────────────────────
DB_SOURCE=""
FILES_SOURCE=""

if [ "$SOURCE_KIND" = "s3" ]; then
  if [ -n "$DATE" ]; then
    # Specific date — find the dump uploaded on that day.
    DB_KEY=$(aws s3api list-objects-v2 \
      --bucket "$S3_BACKUP_BUCKET" \
      --prefix db-backups/makuta_${DB_NAME}_${DATE//-/} \
      --query 'reverse(sort_by(Contents, &LastModified))[0].Key' \
      --output text 2>/dev/null || echo "None")
    FILES_SOURCE="s3://$S3_BACKUP_BUCKET/file-backups/$DATE/"
  else
    # Latest available.
    DB_KEY=$(aws s3api list-objects-v2 \
      --bucket "$S3_BACKUP_BUCKET" \
      --prefix db-backups/ \
      --query 'reverse(sort_by(Contents[?ends_with(Key, `.sql.gz`)], &LastModified))[0].Key' \
      --output text 2>/dev/null || echo "None")
    LATEST_DATE=$(aws s3 ls "s3://$S3_BACKUP_BUCKET/file-backups/" \
      | awk '$1=="PRE"{sub("/","",$2); print $2}' | sort | tail -1)
    FILES_SOURCE="s3://$S3_BACKUP_BUCKET/file-backups/$LATEST_DATE/"
  fi
  DB_SOURCE="s3://$S3_BACKUP_BUCKET/$DB_KEY"

  if ! $FILES_ONLY && { [ -z "$DB_KEY" ] || [ "$DB_KEY" = "None" ]; }; then
    echo "ERROR: no DB dump found in s3://$S3_BACKUP_BUCKET/db-backups/"
    exit 1
  fi
elif [ "$SOURCE_KIND" = "local" ]; then
  # Local tree should look like <path>/db/<file>.sql.gz and <path>/files/
  DB_LOCAL_FILE=$(ls -t "$SOURCE_PATH/db/"*.sql.gz 2>/dev/null | head -1 || true)
  DB_SOURCE="$DB_LOCAL_FILE"
  FILES_SOURCE="$SOURCE_PATH/files/"

  if ! $FILES_ONLY && [ -z "$DB_LOCAL_FILE" ]; then
    echo "ERROR: no .sql.gz under $SOURCE_PATH/db/"
    exit 1
  fi
else
  echo "ERROR: --source must be 's3' or 'local'"
  exit 1
fi

# ─── Confirm before doing anything destructive ────────────────────────────
echo "════════════════════════════════════════════════════════"
echo "Makuta portal — RESTORE FROM BACKUP"
echo "════════════════════════════════════════════════════════"
echo "Mode:           $($DRY_RUN && echo "DRY RUN (no changes)" || echo "LIVE RESTORE")"
echo "Source kind:    $SOURCE_KIND"
if ! $FILES_ONLY; then
  echo "DB dump:        $DB_SOURCE"
  echo "Target DB:      $DB_NAME @ $DB_HOST:$DB_PORT (as $DB_USER)"
fi
if ! $DB_ONLY; then
  echo "Files source:   $FILES_SOURCE"
  echo "Files target:   s3://$S3_BUCKET_NAME/"
fi
echo "════════════════════════════════════════════════════════"

if $DRY_RUN; then
  echo "[dry-run] Stopping here. No changes made."
  exit 0
fi

if ! $ASSUME_YES; then
  echo ""
  echo "This will OVERWRITE the live database and files bucket."
  echo "Type 'RESTORE NOW' (in caps, exactly) to proceed:"
  read -r confirm
  if [ "$confirm" != "RESTORE NOW" ]; then
    echo "Aborted."
    exit 1
  fi
fi

# ─── DB restore ────────────────────────────────────────────────────────────
if ! $FILES_ONLY; then
  WORK=$(mktemp -d)
  trap 'rm -rf "$WORK"' EXIT

  DUMP_GZ="$WORK/$(basename "$DB_SOURCE")"
  DUMP_SQL="${DUMP_GZ%.gz}"

  echo ""
  echo "[1/3] Downloading dump…"
  if [ "$SOURCE_KIND" = "s3" ]; then
    aws s3 cp "$DB_SOURCE" "$DUMP_GZ" --no-progress
  else
    cp "$DB_SOURCE" "$DUMP_GZ"
  fi

  echo "[2/3] Decompressing…"
  gunzip -f "$DUMP_GZ"
  ls -lh "$DUMP_SQL"

  echo "[3/3] Restoring into $DB_NAME (drop + recreate)…"
  # Connect to the postgres maintenance DB to drop/create the target.
  export PGPASSWORD="$DB_ADMIN_PASSWORD"
  psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_ADMIN_USER" -d postgres -v ON_ERROR_STOP=1 <<SQL
SELECT pg_terminate_backend(pid)
  FROM pg_stat_activity
 WHERE datname = '$DB_NAME' AND pid <> pg_backend_pid();
DROP DATABASE IF EXISTS "$DB_NAME";
CREATE DATABASE "$DB_NAME" OWNER "$DB_USER";
SQL

  export PGPASSWORD="$DB_PASSWORD"
  psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$DUMP_SQL" >/dev/null

  ROWS=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tA \
    -c "SELECT (SELECT COUNT(*) FROM invoices) || ' invoices, ' || (SELECT COUNT(*) FROM vendors) || ' vendors'" 2>/dev/null || echo "?")
  echo "[ok] DB restored. Counts: $ROWS"
fi

# ─── Files restore ─────────────────────────────────────────────────────────
if ! $DB_ONLY; then
  echo ""
  echo "[files] Syncing $FILES_SOURCE → s3://$S3_BUCKET_NAME/"
  if [ "$SOURCE_KIND" = "s3" ]; then
    aws s3 sync "$FILES_SOURCE" "s3://$S3_BUCKET_NAME/" --delete --no-progress
  else
    aws s3 sync "$FILES_SOURCE" "s3://$S3_BUCKET_NAME/" --delete --no-progress
  fi
  echo "[ok] Files synced."
fi

echo ""
echo "════════════════════════════════════════════════════════"
echo "Restore complete."
echo "Next steps:"
echo "  1. Restart the API container so any cached state is dropped:"
echo "       sudo docker restart makuta_portal_api_prod"
echo "  2. Spot-check invoice list + an attachment download in the UI."
echo "════════════════════════════════════════════════════════"
