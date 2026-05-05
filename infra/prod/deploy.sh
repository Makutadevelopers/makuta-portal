#!/usr/bin/env bash
# Deploy / redeploy the Makuta Portal on the EC2 host.
# Idempotent — safe to re-run after a `git pull`.
#
# Usage (on the EC2 box, run from /opt/makuta-portal):
#   ./infra/prod/deploy.sh           # build + up + migrate
#   ./infra/prod/deploy.sh --no-build  # skip rebuild, just up
#   ./infra/prod/deploy.sh --migrate-only

set -euo pipefail

REPO_DIR="/opt/makuta-portal"
COMPOSE_FILE="$REPO_DIR/infra/prod/docker-compose.prod.yml"
ENV_FILE="$REPO_DIR/infra/prod/.env"

cd "$REPO_DIR/infra/prod"

# Compose v2 reads the .env file in the directory of -f by default.
if [[ ! -f "$ENV_FILE" ]]; then
  echo "[fatal] $ENV_FILE not found. Copy .env.prod.example → .env and fill it in." >&2
  exit 1
fi

# Ensure the CRM network exists — we attach to it as external.
if ! sudo docker network inspect crm_makuta_prod_net >/dev/null 2>&1; then
  echo "[fatal] Docker network crm_makuta_prod_net not found." >&2
  echo "        The CRM stack must be up first (cd /opt/makuta/crm && docker compose up -d)." >&2
  exit 1
fi

case "${1:-}" in
  --migrate-only)
    echo "[deploy] running migrations only…"
    sudo docker exec -i makuta_portal_api_prod npx tsx src/db/migrate.ts
    exit 0
    ;;
  --no-build)
    BUILD=0
    ;;
  *)
    BUILD=1
    ;;
esac

if [[ $BUILD -eq 1 ]]; then
  echo "[deploy] building images sequentially (low-RAM box)…"
  # Compose v5+ dropped --no-parallel; build services one at a time instead
  # so peak memory stays low on the t3.micro-class box.
  sudo docker compose -f "$COMPOSE_FILE" build api
  sudo docker compose -f "$COMPOSE_FILE" build web
fi

echo "[deploy] starting containers…"
sudo docker compose -f "$COMPOSE_FILE" up -d

echo "[deploy] waiting for api to be healthy…"
for i in {1..30}; do
  status=$(sudo docker inspect -f '{{.State.Health.Status}}' makuta_portal_api_prod 2>/dev/null || echo "starting")
  if [[ "$status" == "healthy" ]]; then
    echo "[deploy] api is healthy"
    break
  fi
  if [[ $i -eq 30 ]]; then
    echo "[fatal] api failed to become healthy after 5 minutes" >&2
    sudo docker logs --tail 50 makuta_portal_api_prod >&2
    exit 1
  fi
  sleep 10
done

echo "[deploy] running database migrations…"
sudo docker exec -i makuta_portal_api_prod npx tsx src/db/migrate.ts

echo "[deploy] reloading public nginx so any vhost changes take effect…"
sudo docker exec makuta_nginx_prod nginx -t
sudo docker exec makuta_nginx_prod nginx -s reload

echo "[deploy] done."
echo "[deploy] tail logs:  sudo docker logs -f makuta_portal_api_prod"
