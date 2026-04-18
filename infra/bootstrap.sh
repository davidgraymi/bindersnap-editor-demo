#!/usr/bin/env bash
# One-time bootstrap: creates the S3 state bucket + DynamoDB lock table,
# then generates backend.hcl for all other modules.
#
# Usage:
#   bun run tf:bootstrap
#
# After this completes, run: bun run tf:apply
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STATE_DIR="${SCRIPT_DIR}/state"
BACKEND_HCL="${STATE_DIR}/backend.hcl"

if [[ -f "$BACKEND_HCL" ]]; then
  echo "backend.hcl already exists at ${BACKEND_HCL}"
  echo "Bootstrap has already run. If you need to re-bootstrap, delete backend.hcl first."
  exit 0
fi

# Detect AWS account ID
AWS_ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text 2>/dev/null)" || {
  echo "ERROR: Could not determine AWS account ID."
  echo "Ensure AWS credentials are configured (aws configure / env vars / SSO)."
  exit 1
}

AWS_REGION="${AWS_REGION:-us-east-1}"

echo "=== Bindersnap Terraform Bootstrap ==="
echo "  Account: ${AWS_ACCOUNT_ID}"
echo "  Region:  ${AWS_REGION}"
echo ""

# Init + apply the state module (local state — intentional)
echo "--- Initializing state module ---"
terraform -chdir="${STATE_DIR}" init -input=false

echo "--- Applying state module ---"
terraform -chdir="${STATE_DIR}" apply \
  -var="aws_account_id=${AWS_ACCOUNT_ID}" \
  -var="aws_region=${AWS_REGION}" \
  -input=false \
  -auto-approve

# Extract outputs and write backend.hcl
BUCKET="$(terraform -chdir="${STATE_DIR}" output -raw bucket_name)"
LOCK_TABLE="$(terraform -chdir="${STATE_DIR}" output -raw lock_table_name)"

cat > "${BACKEND_HCL}" <<EOF
bucket         = "${BUCKET}"
region         = "${AWS_REGION}"
dynamodb_table = "${LOCK_TABLE}"
encrypt        = true
EOF

echo ""
echo "=== Bootstrap complete ==="
echo "  State bucket:  ${BUCKET}"
echo "  Lock table:    ${LOCK_TABLE}"
echo "  Backend config: ${BACKEND_HCL}"
echo ""
echo "Next steps:"
echo "  1. Copy terraform.tfvars.example → terraform.tfvars in each infra/ subdirectory"
echo "  2. Fill in real values (see comments in each file)"
echo "  3. Run: bun run tf:plan    (dry run)"
echo "  4. Run: bun run tf:apply   (apply all)"
