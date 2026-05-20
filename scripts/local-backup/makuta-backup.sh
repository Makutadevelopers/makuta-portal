#!/usr/bin/env bash
# makuta-backup.sh
# Daily local backup pull from AWS S3 to the user's external drive.
#
# What this does, every run:
#   1. Confirms /Volumes/mac-scratch is mounted (defers + alerts if not).
#   2. Reads AWS read-only creds from macOS Keychain (set up once via INSTALL.md).
#   3. Catch-up sync: for each of the last CATCHUP_DAYS (default 7), downloads
#      any dated DB dump / file-backup from s3://makuta-backup-use1/ that isn't
#      already present locally — so a skipped run self-heals on the next run.
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
  echo "[skip] External drive $DRIVE_ROOT is not mounted — backup deferred."
  echo "       The next run will backfill this gap automatically (catch-up window: ${CATCHUP_DAYS:-7} days)."
  # Best-effort desktop alert so a skip isn't silent. May not surface from a
  # LaunchAgent context, but is harmless when it doesn't.
  osascript -e 'display notification "Backup drive not mounted — will backfill on next run." with title "Makuta backup skipped"' >/dev/null 2>&1 || true
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

# ── Catch-up sync ──────────────────────────────────────────────────────────
# Pull every dated backup from the last CATCHUP_DAYS that we don't already
# have locally — not just the newest. This makes a skipped run (drive
# unplugged, laptop asleep) self-heal: the next run backfills the gap instead
# of silently leaving a hole. db-backups/ holds dump files named
# makuta_*_YYYYMMDD_HHMMSS.sql.gz; file-backups/ holds YYYY-MM-DD sub-prefixes.
CATCHUP_DAYS="${CATCHUP_DAYS:-7}"
TODAY=$(date '+%Y-%m-%d')
TARGET="$DEST_ROOT/$TODAY"
mkdir -p "$TARGET"

# Dates we care about: today and the prior CATCHUP_DAYS-1 days.
WANTED_DATES=()
for d in $(seq 0 $((CATCHUP_DAYS - 1))); do
  WANTED_DATES+=("$(date -v-"${d}"d '+%Y-%m-%d')")
done

PULLED_ANY=0
BACKFILLED=()

# --- DB dumps ---
ALL_DB_KEYS=$(aws s3api list-objects-v2 --bucket "$S3_BUCKET" --prefix "db-backups/" \
  --query 'Contents[?ends_with(Key, `.sql.gz`)].Key' --output text 2>/dev/null | tr '\t' '\n' || true)
if [ -z "$ALL_DB_KEYS" ]; then
  echo "[warn] No db-backups found on s3://$S3_BUCKET — skipping DB sync."
fi

for wd in "${WANTED_DATES[@]}"; do
  compact="${wd//-/}"                                   # 2026-05-20 -> 20260520
  key=$(echo "$ALL_DB_KEYS" | grep "_${compact}_" | sort | tail -1 || true)
  [ -z "$key" ] && continue                             # no dump for that day on S3
  fname=$(basename "$key")
  dest="$DEST_ROOT/$wd/db/$fname"
  [ -f "$dest" ] && continue                            # already have it
  mkdir -p "$DEST_ROOT/$wd/db"
  echo "[sync] $key  →  $dest"
  if aws s3 cp "s3://$S3_BUCKET/$key" "$dest" --no-progress --only-show-errors; then
    PULLED_ANY=1
    [ "$wd" != "$TODAY" ] && BACKFILLED+=("$wd")
  fi
done

# --- File backups (date-prefixed) ---
ALL_FILE_PREFIXES=$(aws s3 ls "s3://$S3_BUCKET/file-backups/" \
  | awk '$1=="PRE"{sub("/","",$2); print $2}' || true)
if [ -z "$ALL_FILE_PREFIXES" ]; then
  echo "[warn] No file-backups found on s3://$S3_BUCKET — skipping file sync."
fi

for wd in "${WANTED_DATES[@]}"; do
  echo "$ALL_FILE_PREFIXES" | grep -qx "$wd" || continue # no file backup that day
  destdir="$DEST_ROOT/$wd/files"
  # Skip if we already have a non-empty local copy.
  if [ -d "$destdir" ] && [ -n "$(ls -A "$destdir" 2>/dev/null)" ]; then continue; fi
  mkdir -p "$destdir"
  echo "[sync] file-backups/$wd  →  $destdir"
  if aws s3 sync "s3://$S3_BUCKET/file-backups/$wd/" "$destdir/" --no-progress --only-show-errors; then
    PULLED_ANY=1
    [ "$wd" != "$TODAY" ] && BACKFILLED+=("$wd")
  fi
done

if [ "${#BACKFILLED[@]}" -gt 0 ]; then
  # De-dupe and report which prior days were recovered.
  uniq_days=$(printf '%s\n' "${BACKFILLED[@]}" | sort -u | tr '\n' ' ')
  echo "[catch-up] Backfilled missed day(s): $uniq_days"
fi
if [ "$PULLED_ANY" -eq 0 ]; then
  echo "[ok] Nothing new to pull — local copies already current for the last $CATCHUP_DAYS days."
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
