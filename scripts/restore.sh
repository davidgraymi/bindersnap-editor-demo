#!/usr/bin/env bash
set -euo pipefail

# restore.sh — Restore SQLite databases from Litestream S3 backups
#
# RESTORE PROCEDURE:
#
# 1. Stop all containers:
#      cd /path/to/bindersnap-editor-demo
#      docker compose -f docker-compose.prod.yml --env-file .env.prod down
#
# 2. Run this script to restore a database:
#      export LITESTREAM_S3_BUCKET=bindersnap-litestream-123456789012
#      ./scripts/restore.sh gitea    # restore Gitea database
#      ./scripts/restore.sh api      # restore API sessions database
#
# 3. Restart containers:
#      docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
#
# PREREQUISITES:
#   - litestream CLI installed (https://litestream.io/install/)
#   - AWS credentials configured (IMDSv2 on EC2, or ~/.aws/credentials locally)
#   - LITESTREAM_S3_BUCKET environment variable set
#   - Containers STOPPED before running (or database files will be locked)
#
# NOTES:
#   - This script restores to Docker volume mount paths (/data/...)
#   - On EC2, run from the app directory with volumes mounted
#   - For local testing, ensure volumes exist and paths are correct

LITESTREAM_BIN="${LITESTREAM_BIN:-litestream}"
RESTORE_ASSUME_YES="${RESTORE_ASSUME_YES:-0}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Validate argument
if [ $# -ne 1 ]; then
  echo -e "${RED}Usage: $0 <gitea|api>${NC}"
  echo "  gitea — restore Gitea database (gitea.db)"
  echo "  api   — restore API sessions database (sessions.db)"
  exit 1
fi

DB_TARGET="$1"

# Validate target
if [[ "$DB_TARGET" != "gitea" && "$DB_TARGET" != "api" ]]; then
  echo -e "${RED}Error: Invalid target '$DB_TARGET'${NC}"
  echo -e "Valid targets: ${GREEN}gitea${NC}, ${GREEN}api${NC}"
  exit 1
fi

# Check for LITESTREAM_S3_BUCKET
if [ -z "${LITESTREAM_S3_BUCKET:-}" ]; then
  echo -e "${RED}Error: LITESTREAM_S3_BUCKET environment variable is not set${NC}"
  echo ""
  echo "Set it to your S3 bucket name:"
  echo "  export LITESTREAM_S3_BUCKET=bindersnap-litestream-XXXXXXXXXX"
  exit 1
fi

# Set paths based on target
if [ "$DB_TARGET" = "gitea" ]; then
  TARGET_PATH="/data/gitea/gitea.db"
  S3_PATH="gitea"
  VOLUME_NAME="gitea-data"
elif [ "$DB_TARGET" = "api" ]; then
  TARGET_PATH="/data/api/sessions.db"
  S3_PATH="api"
  VOLUME_NAME="api-data"
fi

# Confirm action
echo -e "${YELLOW}======================================${NC}"
echo -e "${YELLOW}Litestream Database Restore${NC}"
echo -e "${YELLOW}======================================${NC}"
echo ""
echo -e "Target database:   ${GREEN}${DB_TARGET}${NC}"
echo -e "Restore to:        ${GREEN}${TARGET_PATH}${NC}"
echo -e "S3 source:         ${GREEN}s3://${LITESTREAM_S3_BUCKET}/${S3_PATH}${NC}"
echo -e "Docker volume:     ${GREEN}${VOLUME_NAME}${NC}"
echo ""
echo -e "${RED}WARNING: This will OVERWRITE the current database file.${NC}"
echo -e "${RED}         Ensure all containers are STOPPED before proceeding.${NC}"
echo ""

if [ "$RESTORE_ASSUME_YES" = "1" ]; then
  echo "Continue? (y/N): y"
else
  read -p "Continue? (y/N): " -n 1 -r
  echo ""

  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Restore cancelled."
    exit 0
  fi
fi

# Run restore
echo ""
echo -e "${GREEN}Starting restore...${NC}"
echo ""

"$LITESTREAM_BIN" restore -o "$TARGET_PATH" "s3://${LITESTREAM_S3_BUCKET}/${S3_PATH}"

echo ""
echo -e "${GREEN}✓ Restore complete${NC}"
echo ""
echo "Next steps:"
echo "  1. Verify the restored database at: ${TARGET_PATH}"
echo "  2. Restart containers:"
echo "       docker compose -f docker-compose.prod.yml --env-file .env.prod up -d"
echo ""
