#!/usr/bin/env bash
# backup-to-drive.sh
# On-demand backup to an external drive. Run this whenever you plug your
# backup drive in and want a fresh local copy of the database + invoice files.
#
# Usage:
#   ./scripts/backup-to-drive.sh                          # interactive (pick a drive)
#   ./scripts/backup-to-drive.sh /Volumes/MyBackupDrive   # use this drive directly
#   ./scripts/backup-to-drive.sh /Volumes/MyBackupDrive --upload-s3
#                                                         # also push copies to cloud bucket
#
# Backups land at <drive>/<APP_NAME>/ so the same drive can hold backups
# from several apps without colliding. Set APP_NAME in .env to override.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

if [ -f "$PROJECT_DIR/.env" ]; then
  set -a
  source "$PROJECT_DIR/.env"
  set +a
fi

APP_NAME="${APP_NAME:-makuta-portal}"

DRIVE_PATH="${1:-}"
UPLOAD_FLAG="${2:-}"

# ─── Pick a drive interactively if none supplied ───────────────────────────
if [ -z "$DRIVE_PATH" ]; then
  echo "External drives mounted under /Volumes:"
  echo ""

  drives=()
  i=1
  while IFS= read -r d; do
    [ -d "$d" ] || continue
    base="$(basename "$d")"
    # Skip the boot disk symlink and Time Machine internals
    [ "$base" = "Macintosh HD" ] && continue
    [ "$base" = "Macintosh HD - Data" ] && continue
    free=$(df -h "$d" 2>/dev/null | awk 'NR==2 {print $4}')
    printf "  %d) %-30s (free: %s)\n" "$i" "$base" "$free"
    drives+=("$d")
    i=$((i+1))
  done < <(find /Volumes -mindepth 1 -maxdepth 1 \( -type d -o -type l \) 2>/dev/null | sort)

  if [ ${#drives[@]} -eq 0 ]; then
    echo "  (none — plug your backup drive in and try again)"
    exit 1
  fi

  echo ""
  read -r -p "Pick a drive [1-${#drives[@]}]: " choice
  if ! [[ "$choice" =~ ^[0-9]+$ ]] || (( choice < 1 || choice > ${#drives[@]} )); then
    echo "Invalid choice"
    exit 1
  fi
  DRIVE_PATH="${drives[$((choice-1))]}"
fi

# ─── Validate the chosen drive ─────────────────────────────────────────────
if [ ! -d "$DRIVE_PATH" ]; then
  echo "ERROR: not a directory: $DRIVE_PATH"
  exit 1
fi

# Make sure it's actually an external mount, not a stub folder under /Volumes.
if [[ "$DRIVE_PATH" == /Volumes/* ]] && ! mount | grep -q " on ${DRIVE_PATH%/} "; then
  echo "ERROR: $DRIVE_PATH is not a mount point — drive may be unplugged."
  exit 1
fi

# ─── Run the unified backup, pointed at the drive ──────────────────────────
export BACKUP_DIR="$DRIVE_PATH/$APP_NAME"
mkdir -p "$BACKUP_DIR"

echo ""
echo "App:         $APP_NAME"
echo "Destination: $BACKUP_DIR"
echo ""

"$SCRIPT_DIR/backup-all.sh" "$UPLOAD_FLAG"

echo ""
echo "Backup written to: $BACKUP_DIR"
echo "Eject the drive safely with:  diskutil unmount \"$DRIVE_PATH\""
