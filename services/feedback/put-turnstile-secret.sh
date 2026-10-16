#!/usr/bin/env bash
# Make sure the feedback dialog's Turnstile widget exists, and copy its secret
# straight into the feedback Worker — never into Terraform state, a file, or
# the terminal. Prints the site key, which is public: set it as the
# TURNSTILE_SITE_KEY variable of the GitHub `production` environment, where
# static-site.yml bakes it into the app.
#
# Why not Terraform: cloudflare_turnstile_widget keeps the secret in state, and
# no secret lives in state here (see infra/edge/put-tunnel-token.sh).
#
# Safe to run again: it finds the widget by name before creating one.
#
# No pre-clearance: with it, Turnstile sets a cf_clearance cookie, and the
# Privacy Policy promises the app sets one cookie only (the session's).
#
# Needs: CLOUDFLARE_API_TOKEN (Account → Turnstile: Edit, and Workers Scripts:
# Edit for the secret), CLOUDFLARE_ACCOUNT_ID, curl, jq, bunx.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WIDGET_NAME="bindersnap-feedback"
# Where the app is served from; Turnstile refuses tokens made anywhere else.
DOMAINS='["bindersnap.com","app.bindersnap.com"]'

: "${CLOUDFLARE_API_TOKEN:?export CLOUDFLARE_API_TOKEN first}"
: "${CLOUDFLARE_ACCOUNT_ID:?export CLOUDFLARE_ACCOUNT_ID first}"

api() {
  curl -fsS \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    -H "Content-Type: application/json" \
    "$@"
}
widgets="https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/challenges/widgets"

sitekey="$(
  api "${widgets}?filter=name:${WIDGET_NAME}&per_page=50" |
    jq -r --arg name "${WIDGET_NAME}" '[.result[] | select(.name == $name)][0].sitekey // empty'
)"

if [[ -z "${sitekey}" ]]; then
  sitekey="$(
    api -X POST "${widgets}" --data "$(
      jq -n --arg name "${WIDGET_NAME}" --argjson domains "${DOMAINS}" \
        '{name: $name, domains: $domains, mode: "managed", clearance_level: "no_clearance"}'
    )" | jq -er '.result.sitekey'
  )"
  echo "Created Turnstile widget ${WIDGET_NAME}."
fi

api "${widgets}/${sitekey}" | jq -er '.result.secret' |
  bunx wrangler@4.149.0 secret put TURNSTILE_SECRET_KEY \
    --config "${SCRIPT_DIR}/wrangler.jsonc" >/dev/null

echo "Set TURNSTILE_SECRET_KEY on the bindersnap-feedback Worker."
echo "Site key (public): ${sitekey}"
echo "Set it as the TURNSTILE_SITE_KEY variable of the GitHub production environment."
