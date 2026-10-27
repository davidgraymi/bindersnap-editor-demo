#!/usr/bin/env bash
# Keeps each module's terraform.tfvars in the state bucket, the one copy of
# record, so any machine can plan and apply with the values production uses.
#
# Usage:
#   bun run tf:pull           # download every module's tfvars; refuses to
#                             # overwrite a local file that differs
#   bun run tf:pull --force   # overwrite local files that differ
#   bun run tf:push           # upload every local tfvars that differs
#
# The flow: tf:pull, edit, tf:plan, tf:apply, tf:push.
#
# Objects live at s3://<bucket>/tfvars/<module>/terraform.tfvars, next to the
# state, under the same encryption, versioning and access. Secrets never go in
# a tfvars file (infra/secrets/put-secrets.sh puts them in SSM), so neither
# copy holds one.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ACTION="${1:-}"
FORCE="${2:-}"
case "${ACTION}" in
  pull | push) ;;
  *) echo "Usage: $0 pull [--force] | push"; exit 1 ;;
esac

BACKEND_CONFIG="${SCRIPT_DIR}/state/backend.hcl"
if [[ ! -f "$BACKEND_CONFIG" ]]; then
  echo "ERROR: ${BACKEND_CONFIG} not found."
  echo "Run: bun run tf:bootstrap"
  exit 1
fi

# `bucket = "..."` and `region = "..."` from the partial backend config.
hcl_value() {
  sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*\"\(.*\)\".*/\1/p" "$BACKEND_CONFIG" | head -n 1
}
BUCKET="$(hcl_value bucket)"
REGION="$(hcl_value region)"
if [[ -z "$BUCKET" || -z "$REGION" ]]; then
  echo "ERROR: could not read bucket and region from ${BACKEND_CONFIG}."
  exit 1
fi

# The modules apply-all.sh applies. billing and billing-test take no tfvars;
# infra/state keeps its own state locally and is not here either.
MODULES=(account-baseline compute secrets backups email monitoring ci edge)

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# Downloads a module's remote copy to $TMP_DIR/<module>. Fails quietly when
# there is none.
fetch() {
  local module="$1"
  aws s3 cp --only-show-errors --region "$REGION" \
    "s3://${BUCKET}/tfvars/${module}/terraform.tfvars" "${TMP_DIR}/${module}" 2>/dev/null
}

echo "=== tfvars ${ACTION}: s3://${BUCKET}/tfvars/ ==="

CONFLICTS=()
for module in "${MODULES[@]}"; do
  local_file="${SCRIPT_DIR}/${module}/terraform.tfvars"
  remote_file="${TMP_DIR}/${module}"

  if [[ "$ACTION" == "pull" ]]; then
    if ! fetch "$module"; then
      echo "  ${module}: none in the bucket"
    elif [[ ! -f "$local_file" ]]; then
      cp "$remote_file" "$local_file"
      echo "  ${module}: downloaded"
    elif cmp -s "$remote_file" "$local_file"; then
      echo "  ${module}: up to date"
    elif [[ "$FORCE" == "--force" ]]; then
      cp "$remote_file" "$local_file"
      echo "  ${module}: overwritten"
    else
      echo "  ${module}: local file differs (- bucket, + local):"
      diff -u --label bucket --label local "$remote_file" "$local_file" | sed 's/^/      /' || true
      CONFLICTS+=("$module")
    fi
  else
    if [[ ! -f "$local_file" ]]; then
      echo "  ${module}: no local file"
    elif fetch "$module" && cmp -s "$remote_file" "$local_file"; then
      echo "  ${module}: up to date"
    else
      aws s3 cp --only-show-errors --region "$REGION" \
        "$local_file" "s3://${BUCKET}/tfvars/${module}/terraform.tfvars"
      echo "  ${module}: uploaded"
    fi
  fi
done

if [[ ${#CONFLICTS[@]} -gt 0 ]]; then
  echo ""
  echo "Kept the local file for: ${CONFLICTS[*]}"
  echo "Run bun run tf:push to keep your edits, or bun run tf:pull --force to discard them."
  exit 1
fi
