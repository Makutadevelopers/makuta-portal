#!/usr/bin/env bash
# daily-overdue-alert.sh
# Triggers the overdue email alert via the cron API endpoint.
#
# Cron example (daily at 9 AM IST):
#   30 3 * * * /path/to/scripts/daily-overdue-alert.sh >> /var/log/makuta-cron.log 2>&1
#
# Requires: CRON_SECRET and API_URL environment variables (or set in .env)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Load env
if [ -f "$PROJECT_DIR/.env" ]; then
  set -a
  source "$PROJECT_DIR/.env"
  set +a
fi

API_URL="${API_URL:-http://localhost:4000}"
CRON_SECRET="${CRON_SECRET:-}"

if [ -z "$CRON_SECRET" ]; then
  echo "ERROR: CRON_SECRET not set"
  exit 1
fi

echo "=== Overdue Alert — $(date) ==="

RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST "$API_URL/api/cron/overdue-alert" \
  -H "Content-Type: application/json" \
  -H "x-cron-secret: $CRON_SECRET")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -n -1)

echo "Status: $HTTP_CODE"
echo "Response: $BODY"

if [ "$HTTP_CODE" != "200" ]; then
  echo "ERROR: Overdue alert failed"
  exit 1
fi

echo "=== Done ==="
