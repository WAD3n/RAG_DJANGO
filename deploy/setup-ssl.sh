#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CERTS_DIR="$SCRIPT_DIR/certs"
HTPASSWD="$SCRIPT_DIR/nginx.htpasswd"

# ── TLS cert ──────────────────────────────────────────────────────────────────
if [ ! -f "$CERTS_DIR/cert.pem" ]; then
  mkdir -p "$CERTS_DIR"
  echo "[SSL] Generating self-signed certificate..."
  openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout "$CERTS_DIR/key.pem" \
    -out    "$CERTS_DIR/cert.pem" \
    -subj "/CN=ragdla" \
    -addext "subjectAltName=IP:$(hostname -I | awk '{print $1}')"
  echo "[SSL] Certificate generated: $CERTS_DIR/cert.pem"
else
  echo "[SSL] Certificate already exists — skipping."
fi

# ── Basic auth ────────────────────────────────────────────────────────────────
if [ ! -f "$HTPASSWD" ]; then
  echo ""
  read -p "Basic auth username: " NGINX_USER
  read -s -p "Basic auth password: " NGINX_PASS
  echo ""
  printf '%s:%s\n' "$NGINX_USER" "$(openssl passwd -apr1 "$NGINX_PASS")" > "$HTPASSWD"
  echo "[Auth] htpasswd created: $HTPASSWD"
else
  echo "[Auth] htpasswd already exists — skipping."
fi

echo ""
echo "Done. Run load-and-start.sh to start services."
