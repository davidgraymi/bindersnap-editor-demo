#!/usr/bin/env bash
# Applies all Terraform modules in dependency order, wiring outputs forward.
#
# Usage:
#   cd infra/
#   ./apply-all.sh          # plan + apply all modules
#   ./apply-all.sh plan     # plan only (no changes)
#
# Prerequisites:
#   1. infra/state/ already applied (local state, one-time bootstrap)
#   2. infra/state/backend.hcl exists with real values
#   3. Each module has a terraform.tfvars with non-derivable values filled in

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ACTION="${1:-apply}"
BACKEND_CONFIG="${SCRIPT_DIR}/state/backend.hcl"

if [[ ! -f "$BACKEND_CONFIG" ]]; then
  echo "ERROR: ${BACKEND_CONFIG} not found."
  echo "Run: cd infra/state && terraform apply, then copy backend.hcl.example to backend.hcl"
  exit 1
fi

tf_init() {
  local dir="$1"
  echo "--- Initializing ${dir} ---"
  terraform -chdir="${SCRIPT_DIR}/${dir}" init -backend-config="${BACKEND_CONFIG}" -input=false -reconfigure
}

tf_output() {
  local dir="$1" key="$2"
  terraform -chdir="${SCRIPT_DIR}/${dir}" output -raw "${key}" 2>/dev/null
}

tf_apply() {
  local dir="$1"
  shift
  local extra_vars=("$@")

  tf_init "${dir}"

  local var_args=()
  for v in "${extra_vars[@]}"; do
    var_args+=(-var "${v}")
  done

  local tfvars="${SCRIPT_DIR}/${dir}/terraform.tfvars"
  local var_file_arg=()
  if [[ -f "$tfvars" ]]; then
    var_file_arg=(-var-file="${tfvars}")
  fi

  if [[ "$ACTION" == "plan" ]]; then
    echo "--- Planning ${dir} ---"
    terraform -chdir="${SCRIPT_DIR}/${dir}" plan "${var_file_arg[@]}" "${var_args[@]}" -input=false
  else
    echo "--- Applying ${dir} ---"
    terraform -chdir="${SCRIPT_DIR}/${dir}" apply "${var_file_arg[@]}" "${var_args[@]}" -input=false -auto-approve
  fi
}

echo "=== Bindersnap infrastructure: ${ACTION} ==="

# 1. Compute (no upstream deps — other modules depend on its outputs)
tf_apply "compute"

INSTANCE_ID="$(tf_output compute instance_id)"
INSTANCE_ROLE="$(tf_output compute instance_role_name)"
DATA_VOLUME_ID="$(tf_output compute data_volume_id)"

echo "  Compute outputs: instance=${INSTANCE_ID} role=${INSTANCE_ROLE} volume=${DATA_VOLUME_ID}"

# 2. Secrets (needs instance role for policy attachment)
tf_apply "secrets" "ec2_instance_role_name=${INSTANCE_ROLE}"

# 3. Backups (needs instance role + volume ID)
tf_apply "backups" \
  "ec2_instance_role_name=${INSTANCE_ROLE}" \
  "gitea_data_volume_id=${DATA_VOLUME_ID}"

LITESTREAM_BUCKET="$(tf_output backups litestream_bucket_name)"
echo "  Backups outputs: litestream_bucket=${LITESTREAM_BUCKET}"

# 4. Monitoring (needs instance ID)
tf_apply "monitoring" "instance_id=${INSTANCE_ID}"

# 5. CI (needs SPA bucket + CloudFront dist — these come from tfvars since SPA module doesn't exist yet)
tf_apply "ci"

echo ""
echo "=== Done. All modules ${ACTION}ed successfully. ==="
