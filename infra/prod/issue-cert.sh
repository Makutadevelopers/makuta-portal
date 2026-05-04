#!/usr/bin/env bash
# Issue a Let's Encrypt cert for invoice.makutadevelopers.com via certbot
# webroot. Runs certbot in a Docker container so we don't need certbot on host.
#
# Pre-conditions (verify first or this WILL fail):
#   1) DNS A-record invoice.makutadevelopers.com → 52.3.199.149 has propagated.
#      Test: dig +short invoice.makutadevelopers.com  → should print 52.3.199.149
#   2) The HTTP-only block of the portal vhost is in place and nginx reloaded
#      (so /.well-known/acme-challenge/* is served from /var/www/certbot).
#   3) The same `crm_certbot_webroot` Docker volume that the CRM nginx mounts
#      at /var/www/certbot exists. Confirm: docker volume ls | grep certbot
#
# After success, install the HTTPS block by reloading the nginx container.

set -euo pipefail

DOMAIN="${1:-invoice.makutadevelopers.com}"
EMAIL="${LETSENCRYPT_EMAIL:-dm@makutadevelopers.com}"

# Find the actual volume name — compose prefixes with project name.
WEBROOT_VOL=$(sudo docker volume ls --format '{{.Name}}' | grep -E 'certbot_webroot$' | head -1)
if [[ -z "$WEBROOT_VOL" ]]; then
  echo "[fatal] No certbot_webroot Docker volume found." >&2
  echo "        The CRM stack must own one — bring its compose up first." >&2
  exit 1
fi
echo "[cert] using webroot volume: $WEBROOT_VOL"

sudo docker run --rm \
  -v "$WEBROOT_VOL":/var/www/certbot \
  -v /etc/letsencrypt:/etc/letsencrypt \
  certbot/certbot certonly \
    --webroot -w /var/www/certbot \
    -d "$DOMAIN" \
    --email "$EMAIL" \
    --agree-tos --no-eff-email \
    --non-interactive

echo "[cert] issued. Files at /etc/letsencrypt/live/$DOMAIN/"
echo "[cert] reloading public nginx…"
sudo docker exec makuta_nginx_prod nginx -t
sudo docker exec makuta_nginx_prod nginx -s reload

echo "[cert] done. Test:  curl -I https://$DOMAIN/"
