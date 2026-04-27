#!/usr/bin/env bash
set -euo pipefail

WEBHOOK_SECRET="${STRIPE_WEBHOOK_SECRET:-}"
if [[ -z "${WEBHOOK_SECRET}" ]]; then
  echo "STRIPE_WEBHOOK_SECRET is required." >&2
  exit 1
fi

TARGET_URL="${STRIPE_WEBHOOK_TARGET_URL:-https://api.bindersnap.test:${WEBHOOK_SMOKE_HTTPS_PORT:-8443}/stripe/webhook}"
RESOLVE_TARGET="${STRIPE_WEBHOOK_RESOLVE_TARGET:-}"
ALLOW_INSECURE="${STRIPE_WEBHOOK_CURL_INSECURE:-0}"
EVENT_FILE="${STRIPE_WEBHOOK_EVENT_FILE:-}"

cleanup() {
  if [[ -n "${TMP_EVENT_FILE:-}" && -f "${TMP_EVENT_FILE}" ]]; then
    rm -f "${TMP_EVENT_FILE}"
  fi
}
trap cleanup EXIT

if [[ -z "${EVENT_FILE}" ]]; then
  TMP_EVENT_FILE="$(mktemp)"
  NOW="$(date +%s)"
  cat >"${TMP_EVENT_FILE}" <<JSON
{"id":"evt_smoke_${NOW}","object":"event","type":"invoice.payment_failed","created":${NOW},"livemode":false,"data":{"object":{"id":"in_smoke_${NOW}","object":"invoice","customer":"cus_smoke_${NOW}"}}}
JSON
  EVENT_FILE="${TMP_EVENT_FILE}"
fi

TIMESTAMP="$(date +%s)"
SIGNATURE="$(
  {
    printf '%s.' "${TIMESTAMP}"
    cat "${EVENT_FILE}"
  } | openssl dgst -sha256 -hmac "${WEBHOOK_SECRET}" | awk '{print $NF}'
)"
HEADER="stripe-signature: t=${TIMESTAMP},v1=${SIGNATURE}"

CURL_ARGS=(
  --silent
  --show-error
  --fail-with-body
  --header "content-type: application/json"
  --header "${HEADER}"
  --data-binary "@${EVENT_FILE}"
  "${TARGET_URL}"
)

if [[ -n "${RESOLVE_TARGET}" ]]; then
  CURL_ARGS=(--resolve "${RESOLVE_TARGET}" "${CURL_ARGS[@]}")
fi

if [[ "${ALLOW_INSECURE}" == "1" ]]; then
  CURL_ARGS=(--insecure "${CURL_ARGS[@]}")
fi

RESPONSE="$(curl "${CURL_ARGS[@]}")"
printf '%s\n' "${RESPONSE}"

if [[ "${RESPONSE}" != *'"received":true'* ]]; then
  echo "Unexpected webhook smoke response: ${RESPONSE}" >&2
  exit 1
fi
