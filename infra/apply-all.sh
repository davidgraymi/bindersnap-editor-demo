#!/usr/bin/env bash
# Applies all Terraform modules in dependency order, wiring outputs forward.
#
# Usage:
#   cd infra/
#   ./apply-all.sh          # apply all modules (wires outputs between them)
#   ./apply-all.sh plan     # plan only — each module uses its own tfvars
#   ./apply-all.sh drift    # plan every module with the same output wiring as
#                           # apply, change nothing, exit 2 if any has drifted
#                           # (.github/workflows/terraform-drift.yml runs this)
#
# Prerequisites:
#   1. infra/state/ already applied (bun run tf:bootstrap)
#   2. infra/state/backend.hcl exists with real values
#   3. Each module has a terraform.tfvars with non-derivable values filled in
#   4. CLOUDFLARE_API_TOKEN (infra/edge), STRIPE_API_KEY (infra/billing, a
#      live key) and STRIPE_TEST_API_KEY (infra/billing-test, a test key) are
#      exported

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ACTION="${1:-apply}"
case "${ACTION}" in
  apply | plan | drift) ;;
  *) echo "Usage: $0 [apply|plan|drift]"; exit 1 ;;
esac
BACKEND_CONFIG="${SCRIPT_DIR}/state/backend.hcl"

if [[ ! -f "$BACKEND_CONFIG" ]]; then
  echo "ERROR: ${BACKEND_CONFIG} not found."
  echo "Run: bun run tf:bootstrap"
  exit 1
fi

tf_init() {
  local dir="$1"
  echo "--- Initializing ${dir} ---"
  terraform -chdir="${SCRIPT_DIR}/${dir}" init -backend-config="${BACKEND_CONFIG}" -input=false -reconfigure
}

# Read a terraform output. Returns empty string if state has no outputs yet.
# Trusts terraform's exit code — `output -raw` exits non-zero when missing —
# and discards stderr so deprecation warnings can't contaminate the value.
tf_output() {
  local dir="$1" key="$2"
  terraform -chdir="${SCRIPT_DIR}/${dir}" output -raw "${key}" 2>/dev/null || echo ""
}

# Returns 0 (true) if either Gitea service-account token SSM parameter
# (gitea_service_token, gitea_admin_token) still holds the bootstrap
# placeholder and the bootstrap therefore needs to run.
# Returns 1 (false) if real tokens are already stored, so the bootstrap can be
# skipped entirely without dispatching any SSM command.
needs_service_token_bootstrap() {
  local ssm_path="$1"
  local placeholder="BOOTSTRAP_WITH_scripts/bootstrap-gitea-service-account.ts"
  local leaf
  local current_value

  if ! command -v aws >/dev/null 2>&1; then
    # No AWS CLI locally — assume bootstrap is needed; the function itself will
    # emit a warning if it cannot proceed.
    return 0
  fi

  for leaf in gitea_service_token gitea_admin_token; do
    current_value="$(
      aws ssm get-parameter \
        --name "${ssm_path}/${leaf}" \
        --with-decryption \
        --query 'Parameter.Value' \
        --output text 2>/dev/null
    )" || true  # treat a missing parameter the same as the placeholder

    if [[ -z "${current_value}" || "${current_value}" == "${placeholder}" ]]; then
      return 0  # needs bootstrap
    fi
  done

  return 1  # already bootstrapped
}

bootstrap_service_token_via_ssm() {
  local instance_id="$1"
  local commands_file
  local script_b64
  local caddyfile_b64
  local command_id
  local status
  local stdout
  local stderr
  local attempt

  if ! command -v aws >/dev/null 2>&1; then
    echo "WARNING: aws CLI not found locally; skipping remote service-token bootstrap."
    return 0
  fi

  script_b64="$(
    base64 <"${SCRIPT_DIR}/../deploy/files/scripts/bootstrap-gitea-service-account.ts" | tr -d '\n'
  )"
  caddyfile_b64="$(
    base64 <"${SCRIPT_DIR}/../deploy/files/Caddyfile.prod" | tr -d '\n'
  )"
  commands_file="$(mktemp)"

  bun "${SCRIPT_DIR}/../deploy/files/scripts/bootstrap-gitea-service-account.ts" \
    print-ssm-commands \
    --script-b64 "${script_b64}" \
    --caddyfile-b64 "${caddyfile_b64}" \
    >"${commands_file}"

  echo "--- Bootstrapping Gitea service token on instance ${instance_id} via SSM ---"
  command_id=""
  for attempt in $(seq 1 12); do
    command_id="$(
      aws ssm send-command \
        --instance-ids "${instance_id}" \
        --document-name "AWS-RunShellScript" \
        --comment "Bindersnap Gitea service-token bootstrap" \
        --parameters "file://${commands_file}" \
        --query 'Command.CommandId' \
        --output text 2>/dev/null
    )" && break

    echo "  SSM command dispatch not ready yet (attempt ${attempt}/12); retrying in 10s..."
    sleep 10
  done

  rm -f "${commands_file}"

  if [[ -z "${command_id}" ]]; then
    echo "ERROR: unable to dispatch the remote bootstrap command via SSM."
    exit 1
  fi

  aws ssm wait command-executed --command-id "${command_id}" --instance-id "${instance_id}" || true

  status="$(
    aws ssm get-command-invocation \
      --command-id "${command_id}" \
      --instance-id "${instance_id}" \
      --query 'Status' \
      --output text
  )"
  stdout="$(
    aws ssm get-command-invocation \
      --command-id "${command_id}" \
      --instance-id "${instance_id}" \
      --query 'StandardOutputContent' \
      --output text
  )"
  stderr="$(
    aws ssm get-command-invocation \
      --command-id "${command_id}" \
      --instance-id "${instance_id}" \
      --query 'StandardErrorContent' \
      --output text
  )"

  if [[ -n "${stdout}" && "${stdout}" != "None" ]]; then
    echo "${stdout}"
  fi

  if [[ "${status}" != "Success" ]]; then
    if [[ -n "${stderr}" && "${stderr}" != "None" ]]; then
      echo "${stderr}" >&2
    fi
    echo "ERROR: remote bootstrap command finished with status ${status}."
    exit 1
  fi
}

tf_run() {
  local dir="$1"
  shift
  local extra_vars=("$@")

  tf_init "${dir}"

  local tf_args=(-input=false)

  # tfvars file (if present)
  local tfvars="${SCRIPT_DIR}/${dir}/terraform.tfvars"
  if [[ -f "$tfvars" ]]; then
    tf_args+=(-var-file="${tfvars}")
  fi

  # Extra vars passed by the caller (output wiring from upstream modules)
  if [[ ${#extra_vars[@]} -gt 0 ]]; then
    for v in "${extra_vars[@]}"; do
      tf_args+=(-var "${v}")
    done
  fi

  if [[ "$ACTION" == "plan" ]]; then
    echo "--- Planning ${dir} ---"
    terraform -chdir="${SCRIPT_DIR}/${dir}" plan "${tf_args[@]}"
  elif [[ "$ACTION" == "drift" ]]; then
    # Read-only: no lock (the drift role cannot write the lock table), and
    # -detailed-exitcode says 2 when the real world differs from the code.
    echo "--- Checking ${dir} for drift ---"
    local status=0
    terraform -chdir="${SCRIPT_DIR}/${dir}" plan "${tf_args[@]}" \
      -lock=false -detailed-exitcode -compact-warnings || status=$?
    case "${status}" in
      0) ;;
      2) DRIFTED+=("${dir}") ;;
      *) echo "ERROR: plan failed for ${dir}"; exit 1 ;;
    esac
  else
    echo "--- Applying ${dir} ---"
    terraform -chdir="${SCRIPT_DIR}/${dir}" apply "${tf_args[@]}" -auto-approve
  fi
}

echo "=== Bindersnap infrastructure: ${ACTION} ==="

DRIFTED=()

# The edge module talks to Cloudflare, not AWS. Fail before anything applies
# rather than half-way through.
if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "ERROR: CLOUDFLARE_API_TOKEN is not set (needed by infra/edge; see infra/edge/README.md)."
  exit 1
fi
# Likewise infra/billing and infra/billing-test, which talk to Stripe: one key
# per mode, and each in its own mode.
if [[ ! "${STRIPE_API_KEY:-}" =~ ^(sk|rk)_live_ ]]; then
  echo "ERROR: STRIPE_API_KEY must be a live key (needed by infra/billing; see infra/billing/README.md)."
  exit 1
fi
if [[ ! "${STRIPE_TEST_API_KEY:-}" =~ ^(sk|rk)_test_ ]]; then
  echo "ERROR: STRIPE_TEST_API_KEY must be a test key (needed by infra/billing-test; see infra/billing/README.md)."
  exit 1
fi

# infra/billing-test reads STRIPE_API_KEY like infra/billing; hand it the test
# key for that one run.
tf_run_billing_test() {
  local live_key="${STRIPE_API_KEY}"
  export STRIPE_API_KEY="${STRIPE_TEST_API_KEY}"
  tf_run "billing-test"
  export STRIPE_API_KEY="${live_key}"
}

# --- Plan mode: each module plans independently using its own tfvars ---
if [[ "$ACTION" == "plan" ]]; then
  tf_run "account-baseline"
  tf_run "compute"
  tf_run "billing"
  tf_run_billing_test
  tf_run "secrets"
  tf_run "backups"
  tf_run "email"
  tf_run "monitoring"
  tf_run "ci"
  tf_run "edge"

  echo ""
  echo "=== Done. All modules planned. ==="
  echo "Cross-module output wiring happens at apply time."
  exit 0
fi

# --- Apply mode: chain modules, wire outputs forward ---

# 0. Account baseline (CloudTrail, GuardDuty, Budget, Access Analyzer). No
#    inputs; first, so the trail records everything that follows.
tf_run "account-baseline"

# 1. Compute (no upstream deps — host configuration is applied by the pyinfra
#    deploy after the instance exists, not by Terraform)
tf_run "compute"

INSTANCE_ID="$(tf_output compute instance_id)"
INSTANCE_ROLE="$(tf_output compute instance_role_name)"
DATA_VOLUME_ID="$(tf_output compute data_volume_id)"

if [[ -z "$INSTANCE_ID" || -z "$INSTANCE_ROLE" || -z "$DATA_VOLUME_ID" ]]; then
  echo "ERROR: compute module applied but outputs are missing."
  echo "  instance_id=${INSTANCE_ID:-<empty>}"
  echo "  instance_role_name=${INSTANCE_ROLE:-<empty>}"
  echo "  data_volume_id=${DATA_VOLUME_ID:-<empty>}"
  exit 1
fi

echo "  Compute outputs: instance=${INSTANCE_ID} role=${INSTANCE_ROLE} volume=${DATA_VOLUME_ID}"

# 2. Billing (Stripe: the product, the writer-seat price, the webhook endpoint
#    and the portal). No AWS inputs; before secrets, which stores its price ID.
tf_run "billing"

SEAT_PRICE_ID="$(tf_output billing seat_price_id)"
if [[ -z "$SEAT_PRICE_ID" ]]; then
  echo "ERROR: billing module applied but seat_price_id is missing."
  echo "  Refusing to apply secrets: STRIPE_PRICE_ID would fall back to a hand-copied value."
  exit 1
fi
echo "  Billing outputs: seat_price=${SEAT_PRICE_ID}"

# The same catalog in test mode, which CI checks out against. Nothing depends
# on its outputs: CI finds the price by its lookup key.
tf_run_billing_test

# 3. Secrets (needs instance role for policy attachment, and the price ID)
tf_run "secrets" \
  "ec2_instance_role_name=${INSTANCE_ROLE}" \
  "stripe_price_id=${SEAT_PRICE_ID}"

SSM_PATH="$(tf_output secrets ssm_parameter_path)"
SSM_PATH="${SSM_PATH:-/bindersnap/prod}"

# Secrets are not Terraform's: put-secrets.sh writes the missing ones straight
# to SSM (generated, or prompted for). It changes nothing that is already set.
if [[ "$ACTION" == "apply" ]]; then
  "${SCRIPT_DIR}/secrets/put-secrets.sh"
fi

if [[ "$ACTION" == "drift" ]]; then
  : # read-only: never bootstrap
elif needs_service_token_bootstrap "${SSM_PATH}"; then
  bootstrap_service_token_via_ssm "${INSTANCE_ID}"
else
  echo "  Gitea service token already bootstrapped — skipping remote bootstrap."
fi

# 4. Backups (needs instance role + volume ID)
tf_run "backups" \
  "ec2_instance_role_name=${INSTANCE_ROLE}" \
  "gitea_data_volume_id=${DATA_VOLUME_ID}"

LITESTREAM_BUCKET="$(tf_output backups litestream_bucket_name)"
DLM_POLICY_ID="$(tf_output backups dlm_policy_id)"
echo "  Backups outputs: litestream_bucket=${LITESTREAM_BUCKET} dlm_policy=${DLM_POLICY_ID:-<none>}"

# 5. Email (needs instance role — the API sends through SES as the instance)
tf_run "email" "ec2_instance_role_name=${INSTANCE_ROLE}"
echo "  Email: add these records to the sending domain's DNS, then request SES production access:"
terraform -chdir="${SCRIPT_DIR}/email" output -json dns_records 2>/dev/null || true

# 6. Monitoring (needs instance ID; backup alarms need the DLM policy ID)
# The backup alarms exist only while dlm_policy_id is set, so applying without
# it would destroy them. The backups module always creates the policy — an
# empty output means something is wrong, so stop rather than drop the alarms.
if [[ -z "$DLM_POLICY_ID" ]]; then
  echo "ERROR: backups module applied but dlm_policy_id is missing."
  echo "  Refusing to apply monitoring: it would remove the backup alarms."
  exit 1
fi
tf_run "monitoring" "instance_id=${INSTANCE_ID}" "dlm_policy_id=${DLM_POLICY_ID}"

# 7. CI (SPA bucket + CloudFront dist come from tfvars — no upstream module yet)
tf_run "ci"

# 8. Edge (Cloudflare: tunnel, DNS, redirects, rate limits). No AWS inputs.
tf_run "edge"
if [[ -z "$(aws ssm get-parameter --name "${SSM_PATH}/cloudflare_tunnel_token" --query Parameter.Name --output text 2>/dev/null || true)" ]]; then
  echo "  Edge: no tunnel token in SSM yet. Run infra/edge/put-tunnel-token.sh before the next deploy."
fi

if [[ "$ACTION" == "drift" ]]; then
  echo ""
  if [[ ${#DRIFTED[@]} -gt 0 ]]; then
    echo "=== Drift in: ${DRIFTED[*]} ==="
    echo "Someone changed these outside Terraform, or a merged change was never applied."
    exit 2
  fi
  echo "=== No drift. ==="
  exit 0
fi

echo ""
echo "=== Done. All modules applied successfully. ==="
