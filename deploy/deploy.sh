#!/usr/bin/env bash
# Redeploy the betting market to the EC2 box: rsync the working tree, rebuild
# the app image on the server, restart containers. Safe to run repeatedly.
#
# Usage: deploy/deploy.sh [user@host]   (defaults to DEPLOY_HOST below)
set -euo pipefail

# Filled in after provisioning (Elastic IP).
DEPLOY_HOST_DEFAULT="ubuntu@ELASTIC_IP_PLACEHOLDER"

HOST="${1:-${DEPLOY_HOST:-$DEPLOY_HOST_DEFAULT}}"
KEY="${DEPLOY_KEY:-$HOME/.ssh/betting-market.pem}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"

if [[ "$HOST" == *ELASTIC_IP_PLACEHOLDER* ]]; then
  echo "error: server address not set — pass user@host or edit DEPLOY_HOST_DEFAULT" >&2
  exit 1
fi

# --exclude'd paths are also protected from --delete, so the server-side
# deploy/.env and deploy/data (the live SQLite db) are never touched.
rsync -az --delete -e "ssh -i $KEY" \
  --exclude node_modules --exclude .next --exclude data --exclude .git \
  --exclude ".env*" --exclude deploy/data --exclude deploy/.env \
  "$DIR"/ "$HOST":/srv/betting/

ssh -i "$KEY" "$HOST" "cd /srv/betting/deploy && docker compose build app && docker compose up -d && docker compose ps"
echo "deployed."
