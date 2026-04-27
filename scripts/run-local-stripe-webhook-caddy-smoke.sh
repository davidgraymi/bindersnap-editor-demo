#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/docker-compose.webhook-smoke.yml"
WEBHOOK_SECRET="${STRIPE_WEBHOOK_SECRET:-whsec_smoke}"

cleanup() {
  docker compose -f "${COMPOSE_FILE}" down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

export STRIPE_WEBHOOK_SECRET="${WEBHOOK_SECRET}"
export STRIPE_WEBHOOK_TARGET_URL="https://api.bindersnap.test:${WEBHOOK_SMOKE_HTTPS_PORT:-8443}/stripe/webhook"
export STRIPE_WEBHOOK_RESOLVE_TARGET="api.bindersnap.test:${WEBHOOK_SMOKE_HTTPS_PORT:-8443}:127.0.0.1"
export STRIPE_WEBHOOK_CURL_INSECURE="1"
export BUILDX_CONFIG="${BUILDX_CONFIG:-/tmp/bindersnap-buildx}"

mkdir -p "${BUILDX_CONFIG}"

docker compose -f "${COMPOSE_FILE}" up --build -d

for _ in $(seq 1 30); do
  if curl --silent --show-error --insecure --resolve "${STRIPE_WEBHOOK_RESOLVE_TARGET}" "${STRIPE_WEBHOOK_TARGET_URL}" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

bash "${ROOT_DIR}/scripts/smoke-stripe-webhook.sh"
