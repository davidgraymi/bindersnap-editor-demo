#!/usr/bin/env bash
# Make sure the signup form's Turnstile widget exists, and copy its secret
# straight into SSM — never into Terraform state, a file, or the terminal. The
# next deploy renders it into .env.prod as SIGNUP_TURNSTILE_SECRET_KEY, and the
# API refuses to start in production without it.
#
# Prints the site key, which is public: set it as the SIGNUP_TURNSTILE_SITE_KEY
# variable of the GitHub `production` environment, where static-site.yml bakes
# it into the app.
#
# Its own widget, not the feedback dialog's (services/feedback/put-turnstile-secret.sh):
# that secret lives in the feedback Worker, this one in the API, and each
# form's solve rate shows separately in the dashboard.
#
# Why not Terraform: cloudflare_turnstile_widget keeps the secret in state, and
# no secret lives in state here (see put-tunnel-token.sh).
#
# Safe to run again: it finds the widget by name before creating one.
#
# No pre-clearance: with it, Turnstile sets a cf_clearance cookie, and the
# Privacy Policy promises the app sets one cookie only (the session's).
#
# Needs: CLOUDFLARE_API_TOKEN (Account → Turnstile: Edit),
# CLOUDFLARE_ACCOUNT_ID, AWS credentials that can ssm:PutParameter under
# /bindersnap/prod, curl, jq, aws.

set -euo pipefail

SSM_PATH="${BINDERSNAP_SSM_PARAMETER_PATH:-/bindersnap/prod}"
KMS_KEY="${BINDERSNAP_SSM_KMS_KEY:-alias/bindersnap-prod-ssm}"
AWS_REGION="${AWS_REGION:-us-east-1}"
WIDGET_NAME="bindersnap-signup"
# Where the signup form is served from; Turnstile refuses tokens made anywhere
# else.
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

# The value reaches the AWS CLI on stdin, not in argv where `ps` shows it.
api "${widgets}/${sitekey}" | jq -er '.result.secret' | tr -d '\n' |
  aws ssm put-parameter --region "${AWS_REGION}" --overwrite \
    --type SecureString --key-id "${KMS_KEY}" \
    --name "${SSM_PATH}/signup_turnstile_secret_key" \
    --value file:///dev/stdin >/dev/null

echo "Wrote ${SSM_PATH}/signup_turnstile_secret_key. Redeploy to use it."
echo "Site key (public): ${sitekey}"
echo "Set it as the SIGNUP_TURNSTILE_SITE_KEY variable of the GitHub production environment."
