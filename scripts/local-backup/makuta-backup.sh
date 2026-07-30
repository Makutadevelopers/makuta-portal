#!/usr/bin/env bash
# makuta-backup.sh
# Daily local backup pull from AWS S3 to three independent destinations.
#
# The point of three: each one survives a different disaster.
#   1. INTERNAL DISK  ~/Makuta-Backups
#      Always available — no drive to forget to plug in. Survives AWS being
#      gone, the hosting being down, the app being retired.
#   2. EXTERNAL DRIVE /Volumes/mac-scratch
#      Survives the Mac dying. Optional: if unmounted, the run still succeeds
#      and the next mounted run backfills the gap.
#   3. iCLOUD Drive (encrypted)
#      Survives losing the Mac AND the drive together (fire, theft). Offsite
#      and on a vendor unrelated to the app stack. gpg-encrypted, because
#      company financial data should not sit in plaintext in personal cloud.
#
# Every destination gets CSV exports alongside the .sql.gz — a Postgres dump
# needs a Postgres server to read, which is exactly what you won't have in a
# disaster. The CSVs open in Excel. See dump-to-csv.py.
#
# What this does, every run:
#   1. Reads AWS read-only creds from macOS Keychain (setup: INSTALL.md).
#   2. Catch-up sync: pulls any dated DB dump / file snapshot from the last
#      CATCHUP_DAYS that isn't already on the internal disk, so a skipped run
#      self-heals rather than leaving a hole.
#   3. Generates CSVs from the newest dump.
#   4. Mirrors internal -> external drive (local copy, no extra S3 egress).
#   5. Writes an encrypted copy of the newest dump + CSVs to iCloud.
#   6. Trims each destination to its own retention window.
#   7. Logs everything to ~/Library/Logs/makuta-backup.log
#
# Usage (manual):    ./makuta-backup.sh
# Usage (automatic): see INSTALL.md — installed as a LaunchAgent.

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────
S3_BUCKET="makuta-backup-use1"
S3_REGION="us-east-1"

# Scoped to its own subfolder: ~/Makuta-Backups is shared with the CRM's mongo
# and secrets backups, and two backup systems writing (and pruning) one folder
# is a future accident. Keep the portal's copies clearly separate.
INTERNAL_ROOT="${INTERNAL_ROOT:-$HOME/Makuta-Backups/invoice-portal}"
DRIVE_ROOT="${DRIVE_ROOT:-/Volumes/mac-scratch}"
DRIVE_DEST="$DRIVE_ROOT/Backups/invoice portal"
ICLOUD_DEST="${ICLOUD_DEST:-$HOME/Library/Mobile Documents/com~apple~CloudDocs/Makuta-Backups}"

# Retention differs per destination: the internal disk is the smallest, iCloud
# costs the most per GB, the drive is cheap and roomy.
INTERNAL_RETENTION_DAYS="${INTERNAL_RETENTION_DAYS:-14}"
DRIVE_RETENTION_DAYS="${DRIVE_RETENTION_DAYS:-30}"
ICLOUD_KEEP="${ICLOUD_KEEP:-7}"
CATCHUP_DAYS="${CATCHUP_DAYS:-7}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CSV_TOOL="$SCRIPT_DIR/dump-to-csv.py"
LOG_FILE="$HOME/Library/Logs/makuta-backup.log"

mkdir -p "$(dirname "$LOG_FILE")"
exec >>"$LOG_FILE" 2>&1

echo ""
echo "════════════════════════════════════════════════════════"
echo "Makuta backup run — $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo "════════════════════════════════════════════════════════"

# ── Preflight ─────────────────────────────────────────────────────────────
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

TODAY=$(date '+%Y-%m-%d')
mkdir -p "$INTERNAL_ROOT"

# ── 1. Catch-up sync: S3 → internal disk ──────────────────────────────────
# Dates we care about: today and the prior CATCHUP_DAYS-1 days.
WANTED_DATES=()
for d in $(seq 0 $((CATCHUP_DAYS - 1))); do
  WANTED_DATES+=("$(date -v-"${d}"d '+%Y-%m-%d')")
done

PULLED_ANY=0
BACKFILLED=()

# --- DB dumps (dated folders; tiny, ~1.4 MB each) ---
ALL_DB_KEYS=$(aws s3api list-objects-v2 --bucket "$S3_BUCKET" --prefix "db-backups/" \
  --query 'Contents[?ends_with(Key, `.sql.gz`)].Key' --output text 2>/dev/null | tr '\t' '\n' || true)
if [ -z "$ALL_DB_KEYS" ]; then
  echo "[warn] No db-backups found on s3://$S3_BUCKET — skipping DB sync."
fi

for wd in "${WANTED_DATES[@]}"; do
  compact="${wd//-/}"                                   # 2026-05-20 -> 20260520
  # Several dumps can exist for one day (the nightly cron plus any on-demand
  # run). Take the newest by name — the timestamp suffix sorts correctly.
  key=$(echo "$ALL_DB_KEYS" | grep "_${compact}_" | sort | tail -1 || true)
  [ -z "$key" ] && continue                             # no dump for that day on S3
  fname=$(basename "$key")
  dest="$INTERNAL_ROOT/$wd/db/$fname"
  [ -f "$dest" ] && continue                            # already have it
  mkdir -p "$INTERNAL_ROOT/$wd/db"
  echo "[sync] $key  →  internal/$wd/db/$fname"
  if aws s3 cp "s3://$S3_BUCKET/$key" "$dest" --no-progress --only-show-errors; then
    PULLED_ANY=1
    [ "$wd" != "$TODAY" ] && BACKFILLED+=("$wd")
  fi
done

# --- Invoice files ---
# One rolling mirror rather than a dated copy per day: these are the same ~76 MB
# of invoice scans every day, so dated copies would waste gigabytes on the
# internal disk for no recovery benefit. `aws s3 sync` is incremental, so after
# the first run this transfers only genuinely new attachments.
LATEST_FILE_PREFIX=$(aws s3 ls "s3://$S3_BUCKET/file-backups/" \
  | awk '$1=="PRE"{sub("/","",$2); print $2}' | sort | tail -1 || true)
if [ -z "$LATEST_FILE_PREFIX" ]; then
  echo "[warn] No file-backups found on s3://$S3_BUCKET — skipping file sync."
else
  mkdir -p "$INTERNAL_ROOT/files-latest"
  echo "[sync] file-backups/$LATEST_FILE_PREFIX  →  internal/files-latest/"
  if aws s3 sync "s3://$S3_BUCKET/file-backups/$LATEST_FILE_PREFIX/" \
       "$INTERNAL_ROOT/files-latest/" --no-progress --only-show-errors; then
    echo "$LATEST_FILE_PREFIX" >"$INTERNAL_ROOT/files-latest/.snapshot-date"
    PULLED_ANY=1
  fi
fi

if [ "${#BACKFILLED[@]}" -gt 0 ]; then
  uniq_days=$(printf '%s\n' "${BACKFILLED[@]}" | sort -u | tr '\n' ' ')
  echo "[catch-up] Backfilled missed day(s): $uniq_days"
fi
if [ "$PULLED_ANY" -eq 0 ]; then
  echo "[ok] Nothing new to pull — internal copy already current."
fi

# ── 2. CSV export from the newest dump ────────────────────────────────────
# Find the newest dump we hold locally, whatever day it landed on.
NEWEST_DUMP=$(find "$INTERNAL_ROOT" -name '*.sql.gz' -type f 2>/dev/null \
  | sort | tail -1 || true)
CSV_DIR=""
if [ -z "$NEWEST_DUMP" ]; then
  echo "[warn] No local dump found — skipping CSV export."
elif [ ! -f "$CSV_TOOL" ]; then
  echo "[warn] $CSV_TOOL missing — skipping CSV export."
else
  DUMP_DAY=$(basename "$(dirname "$(dirname "$NEWEST_DUMP")")")
  CSV_DIR="$INTERNAL_ROOT/$DUMP_DAY/csv"
  if [ -d "$CSV_DIR" ] && [ -f "$CSV_DIR/invoice_register.csv" ] \
     && [ "$CSV_DIR/invoice_register.csv" -nt "$NEWEST_DUMP" ]; then
    echo "[ok] CSVs already current for $DUMP_DAY."
  else
    rm -rf "$CSV_DIR"
    echo "[csv] $(basename "$NEWEST_DUMP")  →  internal/$DUMP_DAY/csv/"
    if python3 "$CSV_TOOL" "$NEWEST_DUMP" "$CSV_DIR" | sed 's/^/       /'; then
      :
    else
      echo "[warn] CSV export failed — the .sql.gz copies are unaffected."
      CSV_DIR=""
    fi
  fi
fi

# ── 3. Mirror internal → external drive ───────────────────────────────────
# Local copy, so this costs no S3 egress. Not a delete-mirror: the drive keeps
# a longer window than the internal disk, and must not lose the older days.
if [ ! -d "$DRIVE_ROOT" ]; then
  echo "[skip] External drive $DRIVE_ROOT not mounted — internal + iCloud copies still done."
  echo "       The next mounted run backfills it (window: $CATCHUP_DAYS days)."
  osascript -e 'display notification "Drive not mounted — internal + iCloud copies still saved." with title "Makuta backup"' >/dev/null 2>&1 || true
else
  mkdir -p "$DRIVE_DEST"
  for wd in "${WANTED_DATES[@]}"; do
    [ -d "$INTERNAL_ROOT/$wd" ] || continue
    mkdir -p "$DRIVE_DEST/$wd"
    # -n: never overwrite what the drive already holds. Anything already there
    # is by definition an equally good copy, and skipping keeps the run fast.
    cp -Rn "$INTERNAL_ROOT/$wd/." "$DRIVE_DEST/$wd/" 2>/dev/null || true
  done
  # The drive keeps dated file snapshots (it has the room), so today's folder
  # gets its own copy of the invoice files.
  if [ -d "$INTERNAL_ROOT/files-latest" ]; then
    snap_date=$(cat "$INTERNAL_ROOT/files-latest/.snapshot-date" 2>/dev/null || echo "$TODAY")
    dest="$DRIVE_DEST/$snap_date/files"
    if [ ! -d "$dest" ] || [ -z "$(ls -A "$dest" 2>/dev/null)" ]; then
      mkdir -p "$dest"
      cp -Rn "$INTERNAL_ROOT/files-latest/." "$dest/" 2>/dev/null || true
      echo "[drive] files snapshot $snap_date copied"
    fi
  fi
  echo "[drive] mirrored → $DRIVE_DEST"
fi

# ── 4. Encrypted offsite copy → iCloud Drive ──────────────────────────────
# Only the newest dump + CSVs go here, encrypted. This is the copy that
# survives losing both the Mac and the drive, so it is deliberately small
# and deliberately not plaintext.
ENC_KEY=$(security find-generic-password -a makuta-backup -s makuta-backup-encryption-key -w 2>/dev/null || true)
if [ -z "$ENC_KEY" ]; then
  echo "[skip] iCloud copy — no encryption passphrase in Keychain."
  echo "       Set one up:  security add-generic-password -a makuta-backup \\"
  echo "                      -s makuta-backup-encryption-key -w '<passphrase>'"
  echo "       Store that passphrase in your password manager, or the offsite copy"
  echo "       is unrecoverable. See RESTORE.md."
elif ! command -v gpg >/dev/null 2>&1; then
  echo "[skip] iCloud copy — gpg not installed (brew install gnupg)."
elif [ -z "$NEWEST_DUMP" ]; then
  echo "[skip] iCloud copy — no dump to encrypt."
else
  mkdir -p "$ICLOUD_DEST"
  stamp=$(basename "$NEWEST_DUMP" .sql.gz)
  enc_dump="$ICLOUD_DEST/$stamp.sql.gz.gpg"
  if [ -f "$enc_dump" ]; then
    echo "[ok] iCloud already holds $stamp."
  else
    if gpg --batch --yes --quiet --symmetric --cipher-algo AES256 \
         --passphrase "$ENC_KEY" --output "$enc_dump" "$NEWEST_DUMP"; then
      echo "[icloud] $stamp.sql.gz.gpg  ($(du -h "$enc_dump" | awk '{print $1}'))"
    else
      echo "[warn] iCloud dump encryption failed."
      rm -f "$enc_dump"
    fi
    if [ -n "$CSV_DIR" ] && [ -d "$CSV_DIR" ]; then
      enc_csv="$ICLOUD_DEST/$stamp-csv.tar.gz.gpg"
      if tar -czf - -C "$(dirname "$CSV_DIR")" "$(basename "$CSV_DIR")" \
         | gpg --batch --yes --quiet --symmetric --cipher-algo AES256 \
               --passphrase "$ENC_KEY" --output "$enc_csv"; then
        echo "[icloud] $stamp-csv.tar.gz.gpg  ($(du -h "$enc_csv" | awk '{print $1}'))"
      else
        echo "[warn] iCloud CSV encryption failed."
        rm -f "$enc_csv"
      fi
    fi
  fi
  # Keep the restore instructions readable in iCloud, next to the encrypted
  # files — instructions you can't open are no use in a disaster.
  [ -f "$SCRIPT_DIR/RESTORE.md" ] && cp -f "$SCRIPT_DIR/RESTORE.md" "$ICLOUD_DEST/RESTORE.md"
  # Retention: keep the newest ICLOUD_KEEP of each artifact kind.
  for pat in '*.sql.gz.gpg' '*-csv.tar.gz.gpg'; do
    # shellcheck disable=SC2086
    ls -1t "$ICLOUD_DEST"/$pat 2>/dev/null | tail -n +$((ICLOUD_KEEP + 1)) \
      | while read -r old; do echo "[trim] iCloud: $(basename "$old")"; rm -f "$old"; done
  done
fi

# ── 5. Retention ──────────────────────────────────────────────────────────
echo "[trim] internal: removing dated folders older than $INTERNAL_RETENTION_DAYS days"
find "$INTERNAL_ROOT" -mindepth 1 -maxdepth 1 -type d -name '20*-*-*' \
  -mtime "+$INTERNAL_RETENTION_DAYS" -print -exec rm -rf {} \; 2>/dev/null || true

if [ -d "$DRIVE_ROOT" ]; then
  # Best-effort: macOS TCC can block traversal of /Volumes/* from a LaunchAgent
  # context (Removable Volumes privacy). The sync itself is unaffected; only
  # this cleanup. Old folders prune on the next Terminal run.
  echo "[trim] drive: removing dated folders older than $DRIVE_RETENTION_DAYS days"
  if ! find "$DRIVE_DEST" -mindepth 1 -maxdepth 1 -type d -mtime "+$DRIVE_RETENTION_DAYS" \
       -print -exec rm -rf {} \; 2>/dev/null; then
    echo "[trim] skipped (likely macOS Removable-Volumes TCC restriction)"
  fi
fi

# ── Summary ───────────────────────────────────────────────────────────────
int_size=$(du -sh "$INTERNAL_ROOT" 2>/dev/null | awk '{print $1}')
echo "[done] internal $INTERNAL_ROOT — ${int_size:-?}"
if [ -d "$DRIVE_ROOT" ]; then
  drv_size=$(du -sh "$DRIVE_DEST" 2>/dev/null | awk '{print $1}')
  echo "[done] drive    $DRIVE_DEST — ${drv_size:-?}"
fi
if [ -d "$ICLOUD_DEST" ]; then
  icl_size=$(du -sh "$ICLOUD_DEST" 2>/dev/null | awk '{print $1}')
  icl_n=$(ls -1 "$ICLOUD_DEST"/*.gpg 2>/dev/null | wc -l | tr -d ' ')
  echo "[done] icloud   $ICLOUD_DEST — ${icl_size:-?} ($icl_n encrypted files)"
fi
