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

# ── Discover latest backup folders on S3 ──────────────────────────────────
latest_prefix() {
  aws s3 ls "s3://$S3_BUCKET/$1/" \
    | awk '$1=="PRE"{sub("/","",$2); print $2}' \
    | sort \
    | tail -1
}

LATEST_DB=$(latest_prefix db-backups || true)
LATEST_FILES=$(latest_prefix file-backups || true)

if [ -z "$LATEST_DB" ]; then
  echo "[warn] No db-backups found on s3://$S3_BUCKET — skipping DB sync."
fi
if [ -z "$LATEST_FILES" ]; then
  echo "[warn] No file-backups found on s3://$S3_BUCKET — skipping file sync."
fi

# ── Sync ──────────────────────────────────────────────────────────────────
TODAY=$(date '+%Y-%m-%d')
TARGET="$DEST_ROOT/$TODAY"
mkdir -p "$TARGET"

if [ -n "$LATEST_DB" ]; then
  echo "[sync] db-backups/$LATEST_DB  →  $TARGET/db"
  aws s3 sync "s3://$S3_BUCKET/db-backups/$LATEST_DB/" "$TARGET/db/" \
    --no-progress --only-show-errors
fi
if [ -n "$LATEST_FILES" ]; then
  echo "[sync] file-backups/$LATEST_FILES  →  $TARGET/files"
  aws s3 sync "s3://$S3_BUCKET/file-backups/$LATEST_FILES/" "$TARGET/files/" \
    --no-progress --only-show-errors
fi

# ── Retention — trim local copies older than $RETENTION_DAYS days ────────
echo "[trim] removing local backups older than $RETENTION_DAYS days"
find "$DEST_ROOT" -mindepth 1 -maxdepth 1 -type d -mtime "+$RETENTION_DAYS" -print -exec rm -rf {} \;

# ── Summary ───────────────────────────────────────────────────────────────
SIZE=$(du -sh "$TARGET" 2>/dev/null | awk '{print $1}')
echo "[done] Backup at $TARGET — $SIZE"
