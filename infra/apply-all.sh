#!/usr/bin/env bash
# Applies all Terraform modules in dependency order, wiring outputs forward.
#
# Usage:
#   cd infra/
#   ./apply-all.sh          # apply all modules (wires outputs between them)
#   ./apply-all.sh plan     # plan only — each module uses its own tfvars
#
# Prerequisites:
#   1. infra/state/ already applied (bun run tf:bootstrap)
#   2. infra/state/backend.hcl exists with real values
#   3. Each module has a terraform.tfvars with non-derivable values filled in

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ACTION="${1:-apply}"
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
tf_output() {
  local dir="$1" key="$2"
  local val
  val="$(terraform -chdir="${SCRIPT_DIR}/${dir}" output -raw "${key}" 2>/dev/null)" || true
  # Terraform emits ANSI warning text when no outputs exist — detect and discard
  if [[ -z "$val" || "$val" == *"Warning"* || "$val" == *"No outputs"* ]]; then
    echo ""
  else
    echo "$val"
  fi
}

# Returns 0 (true) if the Gitea service token SSM parameter still holds the
# bootstrap placeholder and the bootstrap therefore needs to run.
# Returns 1 (false) if a real token is already stored, so the bootstrap can be
# skipped entirely without dispatching any SSM command.
needs_service_token_bootstrap() {
  local ssm_path="$1"
  local parameter="${ssm_path}/gitea_service_token"
  local placeholder="BOOTSTRAP_WITH_scripts/bootstrap-gitea-service-account.ts"
  local current_value

  if ! command -v aws >/dev/null 2>&1; then
    # No AWS CLI locally — assume bootstrap is needed; the function itself will
    # emit a warning if it cannot proceed.
    return 0
  fi

  current_value="$(
    aws ssm get-parameter \
      --name "${parameter}" \
      --with-decryption \
      --query 'Parameter.Value' \
      --output text 2>/dev/null
  )" || true  # treat a missing parameter the same as the placeholder

  if [[ -z "${current_value}" || "${current_value}" == "${placeholder}" ]]; then
    return 0  # needs bootstrap
  fi

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
    base64 <"${SCRIPT_DIR}/../scripts/bootstrap-gitea-service-account.ts" | tr -d '\n'
  )"
  caddyfile_b64="$(
    base64 <"${SCRIPT_DIR}/../Caddyfile.prod" | tr -d '\n'
  )"
  commands_file="$(mktemp)"

  bun "${SCRIPT_DIR}/../scripts/bootstrap-gitea-service-account.ts" \
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
  else
    echo "--- Applying ${dir} ---"
    terraform -chdir="${SCRIPT_DIR}/${dir}" apply "${tf_args[@]}" -auto-approve
  fi
}

echo "=== Bindersnap infrastructure: ${ACTION} ==="

# --- Plan mode: each module plans independently using its own tfvars ---
if [[ "$ACTION" == "plan" ]]; then
  tf_run "compute"
  tf_run "secrets"
  tf_run "backups"
  tf_run "monitoring"
  tf_run "ci"

  echo ""
  echo "=== Done. All modules planned. ==="
  echo "Cross-module output wiring happens at apply time."
  exit 0
fi

# --- Apply mode: chain modules, wire outputs forward ---

# 1. Compute (no upstream deps)
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

# 2. Secrets (needs instance role for policy attachment)
tf_run "secrets" "ec2_instance_role_name=${INSTANCE_ROLE}"

SSM_PATH="$(tf_output secrets ssm_parameter_path)"
SSM_PATH="${SSM_PATH:-/bindersnap/prod}"

if needs_service_token_bootstrap "${SSM_PATH}"; then
  bootstrap_service_token_via_ssm "${INSTANCE_ID}"
else
  echo "  Gitea service token already bootstrapped — skipping remote bootstrap."
fi

# 3. Backups (needs instance role + volume ID)
tf_run "backups" \
  "ec2_instance_role_name=${INSTANCE_ROLE}" \
  "gitea_data_volume_id=${DATA_VOLUME_ID}"

LITESTREAM_BUCKET="$(tf_output backups litestream_bucket_name)"
echo "  Backups outputs: litestream_bucket=${LITESTREAM_BUCKET}"

# 4. Monitoring (needs instance ID)
tf_run "monitoring" "instance_id=${INSTANCE_ID}"

# 5. CI (SPA bucket + CloudFront dist come from tfvars — no upstream module yet)
tf_run "ci"

echo ""
echo "=== Done. All modules applied successfully. ==="
