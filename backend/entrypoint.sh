#!/usr/bin/env bash
set -e

: "${PG_DSN:=postgresql://ragdocs:ragdocs@postgres:5432/ragdocs}"
: "${MINIO_ENDPOINT:=http://minio:9000}"
: "${KAFKA_BOOTSTRAP_SERVERS:=[\"kafka:9092\"]}"

wait_postgres() {
  echo "[entrypoint] Waiting for PostgreSQL..."
  until python - <<'EOF'
import os, sys, psycopg2
try:
    psycopg2.connect(os.environ.get("PG_DSN", "postgresql://ragdocs:ragdocs@postgres:5432/ragdocs"))
    sys.exit(0)
except Exception as e:
    print(f"  postgres not ready: {e}", flush=True)
    sys.exit(1)
EOF
  do sleep 2; done
  echo "[entrypoint] PostgreSQL ready."
}

wait_minio() {
  echo "[entrypoint] Waiting for MinIO..."
  until curl -sf "${MINIO_ENDPOINT}/minio/health/live" > /dev/null; do
    echo "  minio not ready, retrying..."
    sleep 2
  done
  echo "[entrypoint] MinIO ready."
}

wait_kafka() {
  echo "[entrypoint] Waiting for Kafka..."
  until python - <<'EOF'
import os, sys, json
from kafka import KafkaAdminClient
servers = json.loads(os.environ.get("KAFKA_BOOTSTRAP_SERVERS", '["kafka:9092"]'))
try:
    c = KafkaAdminClient(bootstrap_servers=servers, client_id="healthcheck", request_timeout_ms=3000)
    c.close()
    sys.exit(0)
except Exception as e:
    print(f"  kafka not ready: {e}", flush=True)
    sys.exit(1)
EOF
  do sleep 3; done
  echo "[entrypoint] Kafka ready."
}

wait_postgres
wait_minio
wait_kafka

echo "[entrypoint] Running Django migrations..."
python manage.py migrate --noinput

echo "[entrypoint] Starting: $*"
exec "$@"
