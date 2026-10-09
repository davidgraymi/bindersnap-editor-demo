#!/usr/bin/env bash
# Write Bindersnap's production secrets straight to SSM Parameter Store, so they
# never pass through Terraform state, a tfvars file, or this machine's disk.
#
#   ./put-secrets.sh            set every secret that is missing; leave the rest
#   ./put-secrets.sh --rotate   replace all of them (do this once at cutover:
#                               older versions of secrets/terraform.tfstate still
#                               hold the previous values)
#
# What it sets:
#   gitea_secret_key, gitea_internal_token   generated (openssl rand)
#   gitea_admin_pass                         generated; read it back from SSM when needed
#   gitea_service_token, gitea_admin_token   the bootstrap placeholder; the first
#                                            deploy mints the real tokens
#   stripe_secret_key, stripe_webhook_secret prompted for, without echo
#
# Not here: cloudflare_tunnel_token (infra/edge/put-tunnel-token.sh) and the
# restic_* leaves (docs/ops/restore.md).
#
# Needs AWS credentials allowed to ssm:PutParameter/GetParameter under the path
# and to use the KMS key. Rotating Gitea's SECRET_KEY on a live Gitea breaks
# its stored 2FA and OAuth secrets; at cutover the database is new, so it is safe.

set -euo pipefail

SSM_PATH="${BINDERSNAP_SSM_PARAMETER_PATH:-/bindersnap/prod}"
KMS_KEY="${BINDERSNAP_SSM_KMS_KEY:-alias/bindersnap-prod-ssm}"
AWS_REGION="${AWS_REGION:-us-east-1}"
BOOTSTRAP_PLACEHOLDER="BOOTSTRAP_WITH_scripts/bootstrap-gitea-service-account.ts"

rotate=0
if [ "${1:-}" = "--rotate" ]; then
  rotate=1
elif [ $# -gt 0 ]; then
  echo "Usage: $0 [--rotate]" >&2
  exit 1
fi

exists() {
  aws ssm get-parameter --region "${AWS_REGION}" --name "${SSM_PATH}/$1" \
    --query Parameter.Name --output text >/dev/null 2>&1
}

put() {
  # The value reaches the AWS CLI on stdin, not in argv where `ps` shows it,
  # and is never written to disk or echoed.
  printf '%s' "$2" | aws ssm put-parameter --region "${AWS_REGION}" --overwrite \
    --type SecureString --key-id "${KMS_KEY}" \
    --name "${SSM_PATH}/$1" --value file:///dev/stdin >/dev/null
  echo "  set ${SSM_PATH}/$1"
}

needs() {
  [ "${rotate}" -eq 1 ] || ! exists "$1"
}

echo "Secrets under ${SSM_PATH} ($([ "${rotate}" -eq 1 ] && echo rotating all || echo only missing ones)):"

for name in gitea_secret_key gitea_internal_token; do
  if needs "${name}"; then put "${name}" "$(openssl rand -base64 48 | tr -d '\n')"; fi
done

if needs gitea_admin_pass; then
  put gitea_admin_pass "$(openssl rand -base64 30 | tr -d '\n/+=' | head -c 32)"
fi

# A rotation re-mints Gitea's tokens on the next deploy (bootstrap runs again).
for name in gitea_service_token gitea_admin_token; do
  if needs "${name}"; then put "${name}" "${BOOTSTRAP_PLACEHOLDER}"; fi
done

prompt_secret() {
  local name="$1" hint="$2" value=""
  while [ -z "${value}" ]; do
    read -r -s -p "  ${name} (${hint}): " value
    echo
  done
  put "${name}" "${value}"
}

if needs stripe_secret_key; then
  prompt_secret stripe_secret_key "Stripe → Developers → API keys → a restricted or secret live key, sk_live_/rk_live_"
fi
if needs stripe_webhook_secret; then
  prompt_secret stripe_webhook_secret "Stripe → Webhooks → the api.bindersnap.com endpoint → signing secret, whsec_"
fi

echo "Done. The next deploy renders them into .env.prod."
