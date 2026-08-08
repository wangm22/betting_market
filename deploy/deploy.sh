#!/usr/bin/env bash
# Redeploy the betting market to the EC2 box: rsync the working tree, rebuild
# the app image on the server, restart containers. Safe to run repeatedly.
#
# Usage: deploy/deploy.sh [user@host]   (defaults to DEPLOY_HOST below)
set -euo pipefail

# GCP VM (static IP, us-east1-b).
DEPLOY_HOST_DEFAULT="michaelwang@34.26.188.129"

HOST="${1:-${DEPLOY_HOST:-$DEPLOY_HOST_DEFAULT}}"
KEY="${DEPLOY_KEY:-$HOME/.ssh/google_compute_engine}"
SSH_OPTS="-i $KEY -o StrictHostKeyChecking=accept-new"
DIR="$(cd "$(dirname "$0")/.." && pwd)"

if [[ "$HOST" == *ELASTIC_IP_PLACEHOLDER* ]]; then
  echo "error: server address not set — pass user@host or edit DEPLOY_HOST_DEFAULT" >&2
  exit 1
fi

# --exclude'd paths are also protected from --delete, so the server-side
# deploy/.env and deploy/data (the live SQLite db) are never touched.
# Leading "/" anchors each pattern to the repo root — an unanchored "data"
# would also match src/lib/data and silently break the build.
rsync -az --delete -e "ssh $SSH_OPTS" \
  --exclude /node_modules --exclude /.next --exclude /data --exclude /.git \
  --exclude "/.env*" --exclude /deploy/data --exclude /deploy/.env \
  "$DIR"/ "$HOST":/srv/betting/

ssh $SSH_OPTS "$HOST" "cd /srv/betting/deploy && docker compose build app && docker compose up -d && docker compose ps"
echo "deployed."
