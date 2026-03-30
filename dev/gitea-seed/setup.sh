#!/bin/sh
# Bindersnap Gitea seed script
# Creates demo users, repo, and documents in a range of approval states.
# Idempotent: safe to run multiple times.

set -eu

GITEA_URL="${GITEA_URL:-http://localhost:3000}"
ADMIN_USER="alice"
ADMIN_PASS="bindersnap-dev"
BOB_USER="bob"
BOB_PASS="bindersnap-dev"
REPO_NAME="quarterly-report"
FEATURE_BRANCH="feature/q2-amendments"
FEATURE_DOC_PATH="documents/in-review.json"
PR_TITLE="Q2 amendments — GDPR section update"
PR_BODY=""
REVIEW_BODY="Section 4.2 needs to reference the updated GDPR guidance from the January memo."

wait_for_gitea() {
  echo "Waiting for Gitea..."
  i=1
  while [ "$i" -le 30 ]; do
    if curl -sf "$GITEA_URL/" > /dev/null 2>&1; then
      echo "Gitea is ready."
      return 0
    fi
    i=$((i + 1))
    sleep 2
  done
  echo "ERROR: Gitea did not become ready in time."
  exit 1
}

wait_for_gitea_api() {
  i=1
  while [ "$i" -le 30 ]; do
    if curl -sf "$GITEA_URL/api/v1/settings/api" > /dev/null 2>&1; then
      return 0
    fi
    i=$((i + 1))
    sleep 2
  done
  echo "ERROR: Gitea API did not become ready in time."
  exit 1
}

alice_curl() {
  curl -sf -u "$ADMIN_USER:$ADMIN_PASS" "$@"
}

bob_curl() {
  curl -sf -u "$BOB_USER:$BOB_PASS" "$@"
}

json_get_string() {
  printf '%s' "$1" | tr -d '\n' | sed -n "s/.*\"$2\":\"\\([^\"]*\\)\".*/\\1/p"
}

json_get_number() {
  printf '%s' "$1" | tr -d '\n' | sed -n "s/.*\"$2\":\\([0-9][0-9]*\\).*/\\1/p"
}

create_user() {
  login="$1"
  pass="$2"
  email="$3"
  name="$4"
  admin="$5"

  if [ "$admin" = "true" ]; then
    payload="{\"login_name\":\"$login\",\"username\":\"$login\",\"email\":\"$email\",\"password\":\"$pass\",\"full_name\":\"$name\",\"must_change_password\":false,\"send_notify\":false,\"source_id\":0}"
  else
    payload="{\"login_name\":\"$login\",\"username\":\"$login\",\"email\":\"$email\",\"password\":\"$pass\",\"full_name\":\"$name\",\"must_change_password\":false,\"send_notify\":false}"
  fi

  curl -sf -X POST "$GITEA_URL/api/v1/admin/users" \
    -u "$ADMIN_USER:$ADMIN_PASS" \
    -H 'Content-Type: application/json' \
    -d "$payload" \
    > /dev/null && echo "Created user: $login" || echo "User already exists: $login"
}

wait_for_gitea

# Bootstrap admin (Gitea requires first user via install endpoint)
curl -sf -X POST "$GITEA_URL" \
  -d "db_type=sqlite3&db_path=%2Fdata%2Fgitea.db&app_name=Gitea&repo_root_path=%2Fdata%2Fgit%2Frepositories&run_user=git&domain=localhost&ssh_port=22&http_port=3000&app_url=http%3A%2F%2Flocalhost%3A3000%2F&log_root_path=%2Fdata%2Fgitea%2Flog&admin_name=$ADMIN_USER&admin_passwd=$ADMIN_PASS&admin_confirm_passwd=$ADMIN_PASS&admin_email=alice%40example.com" \
  > /dev/null 2>&1 || true

wait_for_gitea_api

create_user "$BOB_USER" "$BOB_PASS" "bob@example.com" "Bob Reviewer" "false"

# Create demo repo
curl -sf -X POST "$GITEA_URL/api/v1/user/repos" \
  -u "$ADMIN_USER:$ADMIN_PASS" \
  -H 'Content-Type: application/json' \
  -d "{\"name\":\"$REPO_NAME\",\"description\":\"Quarterly compliance report\",\"private\":false,\"auto_init\":true,\"default_branch\":\"main\"}" \
  > /dev/null && echo "Created repo: $REPO_NAME" || echo "Repo already exists: $REPO_NAME"

# Commit fixture documents to the main branch
for doc in draft in-review changes-requested; do
  CONTENT=$(base64 < "/seed/documents/$doc.json" | tr -d '\n')
  curl -sf -X POST "$GITEA_URL/api/v1/repos/$ADMIN_USER/$REPO_NAME/contents/documents/$doc.json" \
    -u "$ADMIN_USER:$ADMIN_PASS" \
    -H 'Content-Type: application/json' \
    -d "{\"message\":\"seed: add $doc document\",\"content\":\"$CONTENT\"}" \
    > /dev/null && echo "Committed: $doc.json" || echo "Already exists: $doc.json"
done

# Ensure bob has collaborator access with write permissions.
curl -sf -X PUT "$GITEA_URL/api/v1/repos/$ADMIN_USER/$REPO_NAME/collaborators/$BOB_USER" \
  -u "$ADMIN_USER:$ADMIN_PASS" \
  -H 'Content-Type: application/json' \
  -d '{"permission":"write"}' \
  > /dev/null && echo "Ensured collaborator: $BOB_USER" || echo "Collaborator already present: $BOB_USER"

# Build the feature-branch document from the review fixture.
FEATURE_DOC_CONTENT=$(tr -d '\n' < "/seed/documents/in-review.json" | \
  sed 's|Vendor Contract — Acme Corp|Q2 Compliance Report|' | \
  sed 's|This contract has been submitted for review. Awaiting sign-off from the compliance team.|Section 4.2 now reflects the updated GDPR guidance from the January memo.|' | \
  sed 's|Acme Corp will provide data processing services in accordance with our data handling addendum dated 2024-01-15.|Personal data may be retained for no longer than 24 months unless a longer period is required by law.|')

FEATURE_BRANCH_URL="$GITEA_URL/api/v1/repos/$ADMIN_USER/$REPO_NAME/branches/$FEATURE_BRANCH"
if alice_curl "$FEATURE_BRANCH_URL" > /dev/null 2>&1; then
  echo "Branch already exists: $FEATURE_BRANCH"
else
  curl -sf -X POST "$GITEA_URL/api/v1/repos/$ADMIN_USER/$REPO_NAME/branches" \
    -u "$ADMIN_USER:$ADMIN_PASS" \
    -H 'Content-Type: application/json' \
    -d "{\"new_branch_name\":\"$FEATURE_BRANCH\",\"old_ref_name\":\"main\"}" \
    > /dev/null && echo "Created branch: $FEATURE_BRANCH" || echo "Branch already exists: $FEATURE_BRANCH"
fi

FEATURE_RAW_URL="$GITEA_URL/api/v1/repos/$ADMIN_USER/$REPO_NAME/raw/$FEATURE_DOC_PATH?ref=$FEATURE_BRANCH"
FEATURE_CONTENTS_URL="$GITEA_URL/api/v1/repos/$ADMIN_USER/$REPO_NAME/contents/$FEATURE_DOC_PATH?ref=$FEATURE_BRANCH"

if CURRENT_FEATURE_DOC=$(alice_curl "$FEATURE_RAW_URL" 2>/dev/null); then
  CURRENT_FEATURE_DOC=$(printf '%s' "$CURRENT_FEATURE_DOC" | tr -d '\n')
  if [ "$CURRENT_FEATURE_DOC" = "$FEATURE_DOC_CONTENT" ]; then
    echo "Feature branch document already matches: $FEATURE_DOC_PATH"
  else
    FEATURE_DOC_SHA=$(json_get_string "$(alice_curl "$FEATURE_CONTENTS_URL")" sha)
    if [ -n "$FEATURE_DOC_SHA" ]; then
      CONTENT_B64=$(printf '%s' "$FEATURE_DOC_CONTENT" | base64 | tr -d '\n')
      curl -sf -X PUT "$GITEA_URL/api/v1/repos/$ADMIN_USER/$REPO_NAME/contents/$FEATURE_DOC_PATH" \
        -u "$ADMIN_USER:$ADMIN_PASS" \
        -H 'Content-Type: application/json' \
        -d "{\"message\":\"seed: update $FEATURE_DOC_PATH for q2 amendments\",\"branch\":\"$FEATURE_BRANCH\",\"content\":\"$CONTENT_B64\",\"sha\":\"$FEATURE_DOC_SHA\"}" \
        > /dev/null && echo "Updated feature branch document: $FEATURE_DOC_PATH" || echo "Feature branch document already up to date: $FEATURE_DOC_PATH"
    fi
  fi
else
  CONTENT_B64=$(printf '%s' "$FEATURE_DOC_CONTENT" | base64 | tr -d '\n')
  curl -sf -X POST "$GITEA_URL/api/v1/repos/$ADMIN_USER/$REPO_NAME/contents/$FEATURE_DOC_PATH" \
    -u "$ADMIN_USER:$ADMIN_PASS" \
    -H 'Content-Type: application/json' \
    -d "{\"message\":\"seed: add $FEATURE_DOC_PATH on feature branch\",\"branch\":\"$FEATURE_BRANCH\",\"content\":\"$CONTENT_B64\"}" \
    > /dev/null && echo "Created feature branch document: $FEATURE_DOC_PATH" || echo "Feature branch document already exists: $FEATURE_DOC_PATH"
fi

# Find or create the pull request associated with the feature branch.
PR_NUMBER=""
PULLS_URL="$GITEA_URL/api/v1/repos/$ADMIN_USER/$REPO_NAME/pulls?state=open&head=$FEATURE_BRANCH"
PULLS_JSON=$(alice_curl "$PULLS_URL")
PR_NUMBER=$(json_get_number "$PULLS_JSON" number)

if [ -n "$PR_NUMBER" ]; then
  CURRENT_TITLE=$(json_get_string "$PULLS_JSON" title)
  if [ "$CURRENT_TITLE" != "$PR_TITLE" ]; then
    curl -sf -X PATCH "$GITEA_URL/api/v1/repos/$ADMIN_USER/$REPO_NAME/issues/$PR_NUMBER" \
      -u "$ADMIN_USER:$ADMIN_PASS" \
      -H 'Content-Type: application/json' \
      -d "{\"title\":\"$PR_TITLE\"}" \
      > /dev/null && echo "Updated pull request title: $PR_TITLE" || true
  else
    echo "Pull request already exists: #$PR_NUMBER"
  fi
else
  PR_JSON=$(curl -sf -X POST "$GITEA_URL/api/v1/repos/$ADMIN_USER/$REPO_NAME/pulls" \
    -u "$ADMIN_USER:$ADMIN_PASS" \
    -H 'Content-Type: application/json' \
    -d "{\"base\":\"main\",\"head\":\"$FEATURE_BRANCH\",\"title\":\"$PR_TITLE\",\"body\":\"$PR_BODY\"}")
  PR_NUMBER=$(json_get_number "$PR_JSON" number)
  echo "Created pull request: #$PR_NUMBER"
fi

if [ -z "$PR_NUMBER" ]; then
  echo "ERROR: Could not determine pull request number."
  exit 1
fi

# Submit bob's requested-changes review once.
REVIEWS_JSON=$(alice_curl "$GITEA_URL/api/v1/repos/$ADMIN_USER/$REPO_NAME/pulls/$PR_NUMBER/reviews")
if printf '%s' "$REVIEWS_JSON" | tr '{' '\n' | grep -F "\"login\":\"$BOB_USER\"" | grep -F "\"body\":\"$REVIEW_BODY\"" > /dev/null 2>&1; then
  echo "Requested-changes review already exists for #$PR_NUMBER"
else
  bob_curl -X POST "$GITEA_URL/api/v1/repos/$ADMIN_USER/$REPO_NAME/pulls/$PR_NUMBER/reviews" \
    -H 'Content-Type: application/json' \
    -d "{\"body\":\"$REVIEW_BODY\",\"event\":\"REQUEST_CHANGES\"}" \
    > /dev/null && echo "Submitted requested-changes review for #$PR_NUMBER" || echo "Review already submitted for #$PR_NUMBER"
fi

# Create alice's API token and print it
curl -sf -X DELETE "$GITEA_URL/api/v1/users/$ADMIN_USER/tokens/bindersnap-dev" \
  -u "$ADMIN_USER:$ADMIN_PASS" \
  > /dev/null 2>&1 || true

TOKEN=$(curl -sf -X POST "$GITEA_URL/api/v1/users/$ADMIN_USER/tokens" \
  -u "$ADMIN_USER:$ADMIN_PASS" \
  -H 'Content-Type: application/json' \
  -d '{"name":"bindersnap-dev","scopes":["all"]}' | grep -o '"sha1":"[^"]*"' | cut -d'"' -f4)

if [ -n "$TOKEN" ]; then
  echo ""
  echo "=================================================="
  echo "ALICE_TOKEN=$TOKEN"
  echo "Set: export VITE_GITEA_TOKEN=$TOKEN"
  echo "=================================================="
fi

echo "Seed complete."
