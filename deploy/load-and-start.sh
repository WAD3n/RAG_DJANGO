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

# Start
echo "[3/3] Starting services..."
docker compose -f "$SCRIPT_DIR/docker-compose.yml" up -d

echo ""
echo "Services:"
echo "  Frontend:      http://localhost:3000"
echo "  API:           http://localhost:8000"
echo "  MinIO console: http://localhost:9001  (minioadmin / minioadmin)"
echo ""
echo "Logs: docker compose -f $SCRIPT_DIR/docker-compose.yml logs -f"
