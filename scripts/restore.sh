#!/usr/bin/env bash
set -euo pipefail

# restore.sh — Restore one SQLite database from its Litestream replica in S3,
# into the Docker volume the production stack reads.
#
# Use it for a corrupted or mis-migrated database while the git repositories
# are intact (a bad Gitea upgrade, say). For a whole-host loss, restore one EBS
# snapshot or one restic snapshot instead, and never lay a newer gitea.db over
# older repositories: Gitea's rows would point at commits that are not there.
# See docs/ops/restore.md.
#
# Run on the production host, as root, from /opt/bindersnap:
#
#   1. Stop the stack:
#        docker compose --env-file .env.prod -f docker-compose.prod.yml down
#   2. Restore:
#        LITESTREAM_S3_BUCKET=$(grep ^LITESTREAM_S3_BUCKET= .env.prod | cut -d= -f2) \
#          /opt/bindersnap/scripts/restore.sh gitea     # or: api
#   3. Start it again:
#        bindersnap-stack-up
#
# The restore runs inside the same Litestream image the stack uses, so the host
# needs no litestream binary, and it writes into the named Docker volume rather
# than a path on the host. The database it replaces is kept beside it as
# <name>.pre-restore-<UTC timestamp>, with its -wal and -shm files.

DOCKER_BIN="${DOCKER_BIN:-docker}"
RESTORE_ASSUME_YES="${RESTORE_ASSUME_YES:-0}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-bindersnap}"
AWS_REGION="${AWS_REGION:-us-east-1}"
# Keep in step with the litestream service in deploy/files/docker-compose.prod.yml.
LITESTREAM_IMAGE="${LITESTREAM_IMAGE:-litestream/litestream:0.3.14@sha256:c5a1e1b01916b3a110f6600820ef176d048d9b9c2411ef0a680de0caa68934a5}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

if [ $# -ne 1 ]; then
  echo -e "${RED}Usage: $0 <gitea|api>${NC}"
  echo "  gitea — restore Gitea database (gitea.db)"
  echo "  api   — restore API sessions database (sessions.db)"
  exit 1
fi

DB_TARGET="$1"

if [[ "$DB_TARGET" != "gitea" && "$DB_TARGET" != "api" ]]; then
  echo -e "${RED}Error: Invalid target '$DB_TARGET'${NC}"
  echo -e "Valid targets: ${GREEN}gitea${NC}, ${GREEN}api${NC}"
  exit 1
fi

if [ -z "${LITESTREAM_S3_BUCKET:-}" ]; then
  echo -e "${RED}Error: LITESTREAM_S3_BUCKET environment variable is not set${NC}"
  echo ""
  echo "On the host it is in /opt/bindersnap/.env.prod:"
  echo "  export LITESTREAM_S3_BUCKET=\$(grep ^LITESTREAM_S3_BUCKET= .env.prod | cut -d= -f2)"
  exit 1
fi

# The volume, the path it is mounted at, and the database inside it: the same
# mounts litestream.yml replicates from.
if [ "$DB_TARGET" = "gitea" ]; then
  VOLUME_NAME="${COMPOSE_PROJECT}_gitea-data"
  MOUNT_PATH="/data/gitea"
  DB_FILE="gitea.db"
  S3_PATH="gitea"
  CONTAINER="bindersnap-gitea-prod"
else
  VOLUME_NAME="${COMPOSE_PROJECT}_api-data"
  MOUNT_PATH="/data/api"
  DB_FILE="sessions.db"
  S3_PATH="api"
  CONTAINER="bindersnap-api-prod"
fi
TARGET_PATH="${MOUNT_PATH}/${DB_FILE}"

# Restoring under a running process corrupts the database it has open.
running="$("$DOCKER_BIN" ps --filter "name=^${CONTAINER}\$" --filter status=running --format '{{.Names}}')"
if [ -n "$running" ]; then
  echo -e "${RED}Error: ${CONTAINER} is running. Stop the stack first:${NC}"
  echo "  docker compose --env-file .env.prod -f docker-compose.prod.yml down"
  exit 1
fi

echo -e "${YELLOW}======================================${NC}"
echo -e "${YELLOW}Litestream Database Restore${NC}"
echo -e "${YELLOW}======================================${NC}"
echo ""
echo -e "Target database:   ${GREEN}${DB_TARGET}${NC}"
echo -e "Docker volume:     ${GREEN}${VOLUME_NAME}${NC} (${TARGET_PATH})"
echo -e "S3 source:         ${GREEN}s3://${LITESTREAM_S3_BUCKET}/${S3_PATH}${NC}"
echo ""
echo -e "${RED}WARNING: This replaces the current database. The old one is kept beside it.${NC}"
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

stamp="$(date -u +%Y%m%dT%H%M%SZ)"

echo ""
echo -e "${GREEN}Starting restore...${NC}"
echo ""

# `litestream restore` refuses to overwrite an existing file, so move the old
# database (and its WAL) aside first, inside the same volume.
"$DOCKER_BIN" run --rm \
  -v "${VOLUME_NAME}:${MOUNT_PATH}" \
  -e "AWS_REGION=${AWS_REGION}" \
  --entrypoint sh \
  "$LITESTREAM_IMAGE" \
  -c 'set -e
      for f in "$1" "$1-wal" "$1-shm"; do
        if [ -e "$f" ]; then mv "$f" "$f.pre-restore-$2"; fi
      done
      litestream restore -o "$1" "$3"' \
  restore "$TARGET_PATH" "$stamp" "s3://${LITESTREAM_S3_BUCKET}/${S3_PATH}"

echo ""
echo -e "${GREEN}✓ Restore complete${NC}"
echo ""
echo "Next steps:"
echo "  1. Start the stack: bindersnap-stack-up"
echo "  2. Check the app, then delete ${TARGET_PATH}.pre-restore-${stamp}* from the volume"
echo ""
