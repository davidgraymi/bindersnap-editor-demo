#!/bin/sh
# Bindersnap Gitea seed script
# Creates demo users, repo, and documents in a range of approval states.
# Idempotent: safe to run multiple times.

set -e

GITEA_URL="${GITEA_URL:-http://localhost:3000}"
ADMIN_USER="alice"
ADMIN_PASS="bindersnap-dev"
BOB_USER="bob"
BOB_PASS="bindersnap-dev"
REPO_NAME="quarterly-report"

wait_for_gitea() {
  echo "Waiting for Gitea..."
  for i in $(seq 1 30); do
    if curl -sf "$GITEA_URL/api/v1/settings/api" > /dev/null 2>&1; then
      echo "Gitea is ready."
      return 0
    fi
    sleep 2
  done
  echo "ERROR: Gitea did not become ready in time."
  exit 1
}

create_user() {
  local login="$1" pass="$2" email="$3" name="$4" admin="$5"
  curl -sf -X POST "$GITEA_URL/api/v1/admin/users" \
    -u "$ADMIN_USER:$ADMIN_PASS" \
    -H 'Content-Type: application/json' \
    -d "{\"login_name\":\"$login\",\"username\":\"$login\",\"email\":\"$email\",\"password\":\"$pass\",\"full_name\":\"$name\",\"must_change_password\":false,\"send_notify\":false$([ \"$admin\" = \"true\" ] && echo ',\"source_id\":0')}" \
    > /dev/null && echo "Created user: $login" || echo "User already exists: $login"
}

wait_for_gitea

# Bootstrap admin (Gitea requires first user via install endpoint)
curl -sf -X POST "$GITEA_URL" \
  -d "db_type=SQLite3&db_path=%2Fdata%2Fgitea.db&app_name=Gitea&repo_root_path=%2Fdata%2Fgitea%2Frepositories&run_user=git&domain=localhost&ssh_port=22&http_port=3000&app_url=http%3A%2F%2Flocalhost%3A3000%2F&log_root_path=%2Fdata%2Fgitea%2Flog&admin_name=$ADMIN_USER&admin_passwd=$ADMIN_PASS&admin_confirm_passwd=$ADMIN_PASS&admin_email=alice%40example.com" \
  > /dev/null 2>&1 || true

create_user "$BOB_USER" "$BOB_PASS" "bob@example.com" "Bob Reviewer" "false"

# Create demo repo
curl -sf -X POST "$GITEA_URL/api/v1/user/repos" \
  -u "$ADMIN_USER:$ADMIN_PASS" \
  -H 'Content-Type: application/json' \
  -d "{\"name\":\"$REPO_NAME\",\"description\":\"Quarterly compliance report\",\"private\":false,\"auto_init\":true,\"default_branch\":\"main\"}" \
  > /dev/null && echo "Created repo: $REPO_NAME" || echo "Repo already exists: $REPO_NAME"

# Commit fixture documents
for doc in draft in-review changes-requested; do
  CONTENT=$(base64 < "/seed/documents/$doc.json" | tr -d '\n')
  curl -sf -X POST "$GITEA_URL/api/v1/repos/$ADMIN_USER/$REPO_NAME/contents/documents/$doc.json" \
    -u "$ADMIN_USER:$ADMIN_PASS" \
    -H 'Content-Type: application/json' \
    -d "{\"message\":\"seed: add $doc document\",\"content\":\"$CONTENT\"}" \
    > /dev/null && echo "Committed: $doc.json" || echo "Already exists: $doc.json"
done

# Create alice's API token and print it
TOKEN=$(curl -sf -X POST "$GITEA_URL/api/v1/users/$ADMIN_USER/tokens" \
  -u "$ADMIN_USER:$ADMIN_PASS" \
  -H 'Content-Type: application/json' \
  -d '{"name":"bindersnap-dev"}' | grep -o '"sha1":"[^"]*"' | cut -d'"' -f4)

if [ -n "$TOKEN" ]; then
  echo ""
  echo "=================================================="
  echo "ALICE_TOKEN=$TOKEN"
  echo "Set: export VITE_GITEA_TOKEN=$TOKEN"
  echo "=================================================="
fi

echo "Seed complete."
