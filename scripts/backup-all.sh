#!/usr/bin/env bash
# backup-all.sh
# Runs a complete daily backup: PostgreSQL dump + S3 invoice files.
# Writes to a local backup directory (e.g. an external/connected drive) and
# optionally pushes copies to S3 for off-site redundancy.
#
# Usage:
#   ./scripts/backup-all.sh                    # local only
#   ./scripts/backup-all.sh --upload-s3        # local + S3 (DB dump + file snapshot)
#
# Configuration (via .env or shell):
#   BACKUP_DIR          Root backup directory.
#                       Set this to your external drive, e.g.
#                         BACKUP_DIR=/Volumes/mac-scratch/makuta-backups
#                       Defaults to <project>/backups.
#   FILES_BACKUP_DIR    Where to mirror S3 invoice files
#                       (default: $BACKUP_DIR/files)
#   S3_BACKUP_BUCKET    Off-site backup bucket for --upload-s3
#                       (must be DIFFERENT from S3_BUCKET_NAME)
#   RETENTION_DAYS      Days to keep DB dumps locally (default 30)
#
# Exits non-zero if any step fails. Safe to wire to launchd / cron.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

if [ -f "$PROJECT_DIR/.env" ]; then
  set -a
  source "$PROJECT_DIR/.env"
  set +a
fi

BACKUP_DIR="${BACKUP_DIR:-$PROJECT_DIR/backups}"
LOG_DIR="$BACKUP_DIR/logs"
mkdir -p "$LOG_DIR"

RUN_STAMP=$(date +%Y%m%d_%H%M%S)
LOG_FILE="$LOG_DIR/backup_${RUN_STAMP}.log"

# ─── Drive preflight ───────────────────────────────────────────────────────
# If BACKUP_DIR lives under /Volumes (an external drive on macOS), make sure
# the mount point itself exists *before* mkdir would silently create a stub
# folder on the boot disk.
if [[ "$BACKUP_DIR" == /Volumes/* ]]; then
  MOUNT_POINT=$(printf '%s' "$BACKUP_DIR" | awk -F/ '{print "/"$2"/"$3}')
  if ! mount | grep -q " on ${MOUNT_POINT} "; then
    echo "ERROR: External drive is not mounted: $MOUNT_POINT"
    echo "       Plug it in (or mount it) before running this backup."
    exit 1
  fi
fi

# Verify the destination directory is actually writable.
if ! mkdir -p "$BACKUP_DIR" 2>/dev/null || ! [ -w "$BACKUP_DIR" ]; then
  echo "ERROR: BACKUP_DIR is not writable: $BACKUP_DIR"
  exit 1
fi

# Free-space check. Default minimum is 5 GiB; override with MIN_FREE_GB.
MIN_FREE_GB="${MIN_FREE_GB:-5}"
FREE_KB=$(df -Pk "$BACKUP_DIR" | awk 'NR==2 {print $4}')
FREE_GB=$(( FREE_KB / 1024 / 1024 ))
if (( FREE_GB < MIN_FREE_GB )); then
  echo "ERROR: Only ${FREE_GB} GiB free at $BACKUP_DIR (need ≥ ${MIN_FREE_GB} GiB)."
  echo "       Free up space or point BACKUP_DIR somewhere else."
  exit 1
fi
echo "Drive OK: ${FREE_GB} GiB free at $BACKUP_DIR"

# Run with output captured to both stdout and the log file.
{
  echo "############################################"
  echo "# Makuta complete daily backup"
  echo "# Started: $(date)"
  echo "# Destination: $BACKUP_DIR"
  echo "# Mode: ${1:-local-only}"
  echo "############################################"

  echo ""
  echo "[1/2] Database dump…"
  "$SCRIPT_DIR/backup-db.sh" "${1:-}"

  echo ""
  echo "[2/2] S3 invoice files…"
  "$SCRIPT_DIR/backup-files.sh" "${1:-}"

  echo ""
  echo "############################################"
  echo "# Backup finished: $(date)"
  echo "# Total size on disk:"
  du -sh "$BACKUP_DIR" | sed 's/^/#   /'
  echo "############################################"
} 2>&1 | tee "$LOG_FILE"

# Trim old logs (keep last 60 runs)
ls -1t "$LOG_DIR"/backup_*.log 2>/dev/null | tail -n +61 | xargs -I{} rm -f "{}" || true
