#!/usr/bin/env bash
# Renew all Let's Encrypt certs and reload the public nginx container.
# Wire to cron (e.g. weekly):
#   sudo crontab -e
#   17 3 * * 0  /opt/makuta-portal/infra/prod/renew-certs.sh >> /var/log/letsencrypt-renew.log 2>&1

set -euo pipefail

WEBROOT_VOL=$(sudo docker volume ls --format '{{.Name}}' | grep -E 'certbot_webroot$' | head -1)

sudo docker run --rm \
  -v "$WEBROOT_VOL":/var/www/certbot \
  -v /etc/letsencrypt:/etc/letsencrypt \
  certbot/certbot renew --quiet --webroot -w /var/www/certbot

# Only reload if any cert was actually renewed (renew is idempotent and silent
# when nothing changed; reload is cheap so we always do it for safety).
sudo docker exec makuta_nginx_prod nginx -s reload
