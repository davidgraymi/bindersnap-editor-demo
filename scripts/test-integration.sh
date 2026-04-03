#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker-compose.yml"
APP_PORT="${APP_PORT:-5173}"
APP_BASE_URL="http://localhost:${APP_PORT}"

cleanup() {
  docker compose -f "$COMPOSE_FILE" down -v --remove-orphans >/dev/null 2>&1 || true
}

trap cleanup EXIT

echo "Resetting integration stack..."
APP_PORT="$APP_PORT" docker compose -f "$COMPOSE_FILE" down -v --remove-orphans || true

echo "Starting integration stack..."
APP_PORT="$APP_PORT" docker compose -f "$COMPOSE_FILE" up --build -d

echo "Waiting for app at ${APP_BASE_URL} ..."
for _ in $(seq 1 60); do
  if curl -fsS "${APP_BASE_URL}/" >/dev/null; then
    break
  fi
  sleep 2
done

if ! curl -fsS "${APP_BASE_URL}/" >/dev/null; then
  echo "App failed to become ready on ${APP_BASE_URL}" >&2
  exit 1
fi

echo "Running Playwright integration tests..."

if command -v playwright >/dev/null 2>&1; then
  PLAYWRIGHT_RUNNER=(playwright)
elif command -v npx >/dev/null 2>&1; then
  PLAYWRIGHT_RUNNER=(npx playwright)
elif command -v bunx >/dev/null 2>&1; then
  PLAYWRIGHT_RUNNER=(bunx playwright)
else
  echo "No Playwright runner found (expected one of: playwright, bunx, npx)." >&2
  exit 1
fi

APP_PORT="$APP_PORT" PLAYWRIGHT_BASE_URL="$APP_BASE_URL" "${PLAYWRIGHT_RUNNER[@]}" test --config=tests/playwright.config.ts
