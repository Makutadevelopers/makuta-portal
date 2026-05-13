#!/usr/bin/env bash
# makuta-backup.sh
# Daily local backup pull from AWS S3 to the user's external drive.
#
# What this does, every run:
#   1. Confirms /Volumes/mac-scratch is mounted (skips harmlessly if not).
#   2. Reads AWS read-only creds from macOS Keychain (set up once via INSTALL.md).
#   3. Picks the latest dated folder from each S3 prefix on
#      s3://makuta-backup-use1/{db-backups,file-backups}/.
#   4. Downloads them to
#        /Volumes/mac-scratch/Backups/invoice portal/<YYYY-MM-DD>/{db,files}/
#   5. Trims local copies older than RETENTION_DAYS (default 30).
#   6. Logs everything to ~/Library/Logs/makuta-backup.log
#
# Usage (manual): ./makuta-backup.sh
# Usage (automatic): see INSTALL.md — installed as a LaunchAgent.

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────
DRIVE_ROOT="/Volumes/mac-scratch"
DEST_ROOT="$DRIVE_ROOT/Backups/invoice portal"
S3_BUCKET="makuta-backup-use1"
S3_REGION="us-east-1"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
LOG_FILE="$HOME/Library/Logs/makuta-backup.log"

mkdir -p "$(dirname "$LOG_FILE")"
exec >>"$LOG_FILE" 2>&1

echo ""
echo "════════════════════════════════════════════════════════"
echo "Makuta backup run — $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo "════════════════════════════════════════════════════════"

# ── Preflight ─────────────────────────────────────────────────────────────
if [ ! -d "$DRIVE_ROOT" ]; then
  echo "[skip] External drive $DRIVE_ROOT is not mounted. Will catch up next run."
  exit 0
fi
if ! command -v aws >/dev/null 2>&1; then
  echo "[fatal] aws CLI not found. Install with: brew install awscli"
  exit 1
fi
if ! command -v security >/dev/null 2>&1; then
  echo "[fatal] macOS 'security' tool missing — this script is macOS-only."
  exit 1
fi

# ── Credentials from Keychain ─────────────────────────────────────────────
AWS_ACCESS_KEY_ID=$(security find-generic-password -a makuta-backup -s makuta-backup-access-key -w 2>/dev/null || true)
AWS_SECRET_ACCESS_KEY=$(security find-generic-password -a makuta-backup -s makuta-backup-secret-key -w 2>/dev/null || true)
if [ -z "$AWS_ACCESS_KEY_ID" ] || [ -z "$AWS_SECRET_ACCESS_KEY" ]; then
  echo "[fatal] AWS creds missing from Keychain. See scripts/local-backup/INSTALL.md."
  exit 1
fi
export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
export AWS_DEFAULT_REGION="$S3_REGION"

mkdir -p "$DEST_ROOT"

# ── Discover latest backup folders / files on S3 ──────────────────────────
# file-backups/ holds date-stamped sub-prefixes (file-backups/YYYY-MM-DD/...).
# db-backups/   holds dump files directly (makuta_*.sql.gz), no sub-prefix.

latest_prefix() {
  aws s3 ls "s3://$S3_BUCKET/$1/" \
    | awk '$1=="PRE"{sub("/","",$2); print $2}' \
    | sort \
    | tail -1
}

latest_file() {
  aws s3api list-objects-v2 \
    --bucket "$S3_BUCKET" \
    --prefix "$1/" \
    --query 'reverse(sort_by(Contents[?ends_with(Key, `.sql.gz`)], &LastModified))[0].Key' \
    --output text 2>/dev/null
}

LATEST_DB_KEY=$(latest_file db-backups || true)
LATEST_FILES=$(latest_prefix file-backups || true)

if [ -z "$LATEST_DB_KEY" ] || [ "$LATEST_DB_KEY" = "None" ]; then
  echo "[warn] No db-backups found on s3://$S3_BUCKET — skipping DB sync."
  LATEST_DB_KEY=""
fi
if [ -z "$LATEST_FILES" ]; then
  echo "[warn] No file-backups found on s3://$S3_BUCKET — skipping file sync."
fi

# ── Sync ──────────────────────────────────────────────────────────────────
TODAY=$(date '+%Y-%m-%d')
TARGET="$DEST_ROOT/$TODAY"
mkdir -p "$TARGET"

if [ -n "$LATEST_DB_KEY" ]; then
  mkdir -p "$TARGET/db"
  DB_FILE=$(basename "$LATEST_DB_KEY")
  echo "[sync] $LATEST_DB_KEY  →  $TARGET/db/$DB_FILE"
  aws s3 cp "s3://$S3_BUCKET/$LATEST_DB_KEY" "$TARGET/db/$DB_FILE" \
    --no-progress --only-show-errors
fi
if [ -n "$LATEST_FILES" ]; then
  echo "[sync] file-backups/$LATEST_FILES  →  $TARGET/files"
  aws s3 sync "s3://$S3_BUCKET/file-backups/$LATEST_FILES/" "$TARGET/files/" \
    --no-progress --only-show-errors
fi

# ── Retention — trim local copies older than $RETENTION_DAYS days ────────
# Best-effort: macOS TCC may block traversal of /Volumes/* from a
# LaunchAgent context (Removable Volumes privacy). The sync itself is
# unaffected; only this cleanup step. Old folders prune the next time
# the script runs from Terminal (which has full user permissions).
echo "[trim] removing local backups older than $RETENTION_DAYS days"
if ! find "$DEST_ROOT" -mindepth 1 -maxdepth 1 -type d -mtime "+$RETENTION_DAYS" -print -exec rm -rf {} \; 2>/dev/null; then
  echo "[trim] skipped (likely macOS Removable-Volumes TCC restriction in LaunchAgent context)"
fi

# ── Summary ───────────────────────────────────────────────────────────────
SIZE=$(du -sh "$TARGET" 2>/dev/null | awk '{print $1}')
echo "[done] Backup at $TARGET — $SIZE"
