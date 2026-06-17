#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== RAGdla deployment ==="

# Load images
echo "[1/3] Loading images..."
docker load -i "$SCRIPT_DIR/images/backend.tar"
docker load -i "$SCRIPT_DIR/images/frontend.tar"
echo "Images loaded."

# Copy env if not exists
if [ ! -f "$SCRIPT_DIR/.env" ]; then
  cp "$SCRIPT_DIR/.env.example" "$SCRIPT_DIR/.env"
  echo "[2/3] Created .env from .env.example — edit it before proceeding!"
  echo "      nano $SCRIPT_DIR/.env"
  exit 1
else
  echo "[2/3] .env found."
fi

# SSL + basic auth
echo "[3/4] Setting up SSL and basic auth..."
bash "$SCRIPT_DIR/setup-ssl.sh"

# Start
echo "[4/4] Starting services..."
docker compose -f "$SCRIPT_DIR/docker-compose.yml" up -d

echo ""
echo "Services:"
echo "  Frontend:      https://localhost"
echo "  MinIO console: http://localhost:9001  (minioadmin / minioadmin)"
echo ""
echo "Logs: docker compose -f $SCRIPT_DIR/docker-compose.yml logs -f"
