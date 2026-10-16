#!/usr/bin/env bash
# Copy the bindersnap-prod tunnel's token from Cloudflare into SSM, without it
# ever touching Terraform state or a file on disk. The next deploy renders it
# into .env.prod as CLOUDFLARE_TUNNEL_TOKEN, and cloudflared connects with it.
#
# Run after `terraform apply` in this directory, and again only if the tunnel
# is recreated or its token rotated.
#
# Needs: CLOUDFLARE_API_TOKEN (Cloudflare Tunnel: Read), AWS credentials that
# can ssm:PutParameter under /bindersnap/prod, curl, jq, aws.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SSM_PATH="${BINDERSNAP_SSM_PARAMETER_PATH:-/bindersnap/prod}"
KMS_KEY="${BINDERSNAP_SSM_KMS_KEY:-alias/bindersnap-prod-ssm}"
AWS_REGION="${AWS_REGION:-us-east-1}"

: "${CLOUDFLARE_API_TOKEN:?export CLOUDFLARE_API_TOKEN first}"

account_id="$(terraform -chdir="${SCRIPT_DIR}" output -raw cloudflare_account_id)"
tunnel_id="$(terraform -chdir="${SCRIPT_DIR}" output -raw tunnel_id)"

token="$(
  curl -fsS \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    "https://api.cloudflare.com/client/v4/accounts/${account_id}/cfd_tunnel/${tunnel_id}/token" |
    jq -er '.result'
)"

aws ssm put-parameter \
  --region "${AWS_REGION}" \
  --name "${SSM_PATH}/cloudflare_tunnel_token" \
  --type SecureString \
  --key-id "${KMS_KEY}" \
  --value "${token}" \
  --overwrite >/dev/null

echo "Wrote ${SSM_PATH}/cloudflare_tunnel_token for tunnel ${tunnel_id}. Redeploy to use it."
