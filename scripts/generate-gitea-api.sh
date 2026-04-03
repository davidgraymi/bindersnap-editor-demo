#!/usr/bin/env bash
#
# Generates TypeScript types from the local Gitea instance's OpenAPI spec.
#
# Usage:
#   bun run generate:api            (requires Gitea running at localhost:3000)
#   GITEA_URL=http://host:3000 bun run generate:api
#
# The pipeline:
#   1. Pulls /swagger.v1.json from Gitea (Swagger 2.0)
#   2. Converts to OpenAPI 3.0 via swagger2openapi
#   3. Generates TypeScript types via openapi-typescript
#
# Re-run this whenever you upgrade Gitea to keep types in sync.

set -euo pipefail

GITEA_URL="${GITEA_URL:-http://localhost:3000}"
SPEC_DIR="packages/gitea-client/generated"
SWAGGER2_FILE="${SPEC_DIR}/swagger2.json"
OPENAPI3_FILE="${SPEC_DIR}/openapi3.json"
TYPES_FILE="${SPEC_DIR}/gitea.d.ts"

echo "→ Fetching Swagger 2.0 spec from ${GITEA_URL}/swagger.v1.json ..."

# Verify Gitea is reachable
if ! curl -sf "${GITEA_URL}/api/v1/version" > /dev/null 2>&1; then
  echo "ERROR: Cannot reach Gitea at ${GITEA_URL}"
  echo "       Start the dev stack with: bun run up"
  exit 1
fi

mkdir -p "${SPEC_DIR}"

# 1. Pull swagger spec
curl -sf "${GITEA_URL}/swagger.v1.json" -o "${SWAGGER2_FILE}"
GITEA_VERSION=$(python3 -c "import json; print(json.load(open('${SWAGGER2_FILE}'))['info']['version'])")
echo "  Gitea version: ${GITEA_VERSION}"

# 2. Convert Swagger 2.0 → OpenAPI 3.0
echo "→ Converting to OpenAPI 3.0 ..."
npx swagger2openapi "${SWAGGER2_FILE}" -o "${OPENAPI3_FILE}" 2>/dev/null

# 3. Generate TypeScript types
echo "→ Generating TypeScript types ..."
npx openapi-typescript "${OPENAPI3_FILE}" -o "${TYPES_FILE}"

# 4. Prepend version header
GENERATED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
HEADER="// Generated from Gitea ${GITEA_VERSION} at ${GENERATED_AT}
// Source: ${GITEA_URL}/swagger.v1.json
// Do not edit manually — re-run: bun run generate:api
"
TEMP_FILE=$(mktemp)
echo "${HEADER}" > "${TEMP_FILE}"
cat "${TYPES_FILE}" >> "${TEMP_FILE}"
mv "${TEMP_FILE}" "${TYPES_FILE}"

# 5. Clean up intermediate files
rm -f "${SWAGGER2_FILE}" "${OPENAPI3_FILE}"

PATHS=$(python3 -c "import json; print(len(json.load(open('${GITEA_URL}/swagger.v1.json' if False else '/dev/null'))['paths']))" 2>/dev/null || echo "?")
LINES=$(wc -l < "${TYPES_FILE}" | tr -d ' ')
echo ""
echo "✓ Generated ${TYPES_FILE}"
echo "  Gitea ${GITEA_VERSION} · ${LINES} lines"
echo "  Commit this file. Re-run after upgrading Gitea."
