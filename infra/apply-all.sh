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
