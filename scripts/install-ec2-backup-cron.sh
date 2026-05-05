#!/usr/bin/env bash
# install-ec2-backup-cron.sh
# Run ONCE on the production EC2 box to wire up the daily backup cron.
#
# Prereq: copy /tmp/makuta-backup-key.env from your laptop to the EC2 box,
#         e.g.  scp /tmp/makuta-backup-key.env ec2-user@52.3.199.149:/tmp/
#
# Usage (on EC2):
#   sudo bash /opt/makuta-portal/scripts/install-ec2-backup-cron.sh /tmp/makuta-backup-key.env
#
# What it does:
#   1. Moves the credentials file to /etc/makuta/backup-creds.env (root:root, 600)
#   2. Adds a root crontab entry that fires every day at 02:00 UTC (07:30 IST)
#   3. Runs the backup once now to verify
#
# Safe to re-run — replaces existing creds + crontab entry idempotently.

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: must be run as root (use sudo)"
  exit 1
fi

if [ $# -lt 1 ]; then
  echo "Usage: sudo $0 /path/to/makuta-backup-key.env"
  exit 1
fi

SRC_KEYFILE="$1"
if [ ! -f "$SRC_KEYFILE" ]; then
  echo "ERROR: key file not found: $SRC_KEYFILE"
  exit 1
fi

WRAPPER=/opt/makuta-portal/scripts/cron/run-ec2-backup.sh
if [ ! -f "$WRAPPER" ]; then
  echo "ERROR: wrapper not found at $WRAPPER"
  echo "       Run 'cd /opt/makuta-portal && git pull' first to fetch the latest scripts."
  exit 1
fi
chmod +x "$WRAPPER"

# 1. Install credentials file
mkdir -p /etc/makuta
install -m 0600 -o root -g root "$SRC_KEYFILE" /etc/makuta/backup-creds.env
echo "Installed /etc/makuta/backup-creds.env (root:root, 600)"

# Recommend deleting the source copy
echo "TIP: delete the source key copy now:  rm $SRC_KEYFILE"

# 2. Install crontab entry (idempotent — strip any prior makuta backup entry first)
TMPCRON=$(mktemp)
crontab -l 2>/dev/null | grep -v "run-ec2-backup.sh" > "$TMPCRON" || true
echo "# Makuta portal — daily backup (DB dump + S3 file mirror) at 02:00 UTC" >> "$TMPCRON"
echo "0 2 * * * $WRAPPER" >> "$TMPCRON"
crontab "$TMPCRON"
rm -f "$TMPCRON"
echo "Installed root crontab entry:"
crontab -l | grep -E "(Makuta|run-ec2-backup)"

# 3. Verify by running once now
echo ""
echo "Running backup once now to verify…"
echo "----"
"$WRAPPER"
echo "----"
echo ""
echo "Done. Check /var/log/makuta/backup-*.log for future runs."
