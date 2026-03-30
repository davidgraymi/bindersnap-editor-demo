#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/dev/docker-compose.yml"

cleanup() {
  docker compose -f "$COMPOSE_FILE" down -v --remove-orphans >/dev/null 2>&1 || true
}

trap cleanup EXIT

echo "Resetting integration stack..."
BINDERSNAP_DEV_AUTO_LOGIN=false docker compose -f "$COMPOSE_FILE" down -v --remove-orphans || true

echo "Starting integration stack..."
BINDERSNAP_DEV_AUTO_LOGIN=false docker compose -f "$COMPOSE_FILE" up --build -d

echo "Waiting for app at http://localhost:5173 ..."
for _ in $(seq 1 60); do
  if curl -fsS "http://localhost:5173/" >/dev/null; then
    break
  fi
  sleep 2
done

if ! curl -fsS "http://localhost:5173/" >/dev/null; then
  echo "App failed to become ready on http://localhost:5173" >&2
  exit 1
fi

echo "Running Playwright integration tests (auto-login forced OFF)..."
BINDERSNAP_DEV_AUTO_LOGIN=false playwright test --config=dev/tests/playwright.config.ts
