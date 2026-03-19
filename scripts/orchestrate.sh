#!/bin/bash
# =============================================================
# orchestrate.sh — Launches the Opus orchestrator for one session
# Scheduled via launchd on your Mac mini.
#
# Prerequisites:
#   - ~/.claude-dev.env exists and is filled in
#   - claude CLI is installed and authenticated
#   - gh CLI is installed and authenticated
#   - Git is configured with push access to your repo
# =============================================================

set -euo pipefail

# --- Load environment ---
ENV_FILE="${CLAUDE_DEV_ENV_FILE:-$HOME/.claude-dev.env}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: Environment file not found at $ENV_FILE"
  echo "Copy scripts/claude-dev.env.example to ~/.claude-dev.env and fill in your values."
  exit 1
fi
source "$ENV_FILE"

# --- Validate required variables ---
REQUIRED_VARS=(
  CLAUDE_DEV_PROJECT_DIR
  CLAUDE_DEV_BASE_BRANCH
  CLAUDE_DEV_LOG_DIR
  CLAUDE_DEV_ORCHESTRATOR_MODEL
  CLAUDE_DEV_GITHUB_REPO
  CLAUDE_DEV_LABEL_READY
  CLAUDE_DEV_LABEL_IN_PROGRESS
  CLAUDE_DEV_LABEL_PR_OPEN
  CLAUDE_DEV_LABEL_BLOCKED
  CLAUDE_DEV_MAX_FIX_CYCLES
  CLAUDE_DEV_MAX_REVIEW_CYCLES
)

for var in "${REQUIRED_VARS[@]}"; do
  if [[ -z "${!var:-}" ]]; then
    echo "ERROR: Required environment variable $var is not set in $ENV_FILE"
    exit 1
  fi
done

# --- Setup ---
DATE=$(date +%Y-%m-%d_%H-%M)
mkdir -p "$CLAUDE_DEV_LOG_DIR"

echo "[$DATE] Starting orchestration session (repo: $CLAUDE_DEV_GITHUB_REPO)" \
  >> "$CLAUDE_DEV_LOG_DIR/sessions.log"

# --- Sync repo ---
cd "$CLAUDE_DEV_PROJECT_DIR"
git checkout "$CLAUDE_DEV_BASE_BRANCH"
git pull origin "$CLAUDE_DEV_BASE_BRANCH"

# --- Build the orchestrator prompt with env vars injected ---
PROMPT=$(cat "$CLAUDE_DEV_PROJECT_DIR/scripts/orchestrator-prompt.md")

# Substitute env vars into the prompt so agents know labels, limits, etc.
PROMPT=$(echo "$PROMPT" \
  | sed "s|{{BASE_BRANCH}}|$CLAUDE_DEV_BASE_BRANCH|g" \
  | sed "s|{{GITHUB_REPO}}|$CLAUDE_DEV_GITHUB_REPO|g" \
  | sed "s|{{LABEL_READY}}|$CLAUDE_DEV_LABEL_READY|g" \
  | sed "s|{{LABEL_IN_PROGRESS}}|$CLAUDE_DEV_LABEL_IN_PROGRESS|g" \
  | sed "s|{{LABEL_PR_OPEN}}|$CLAUDE_DEV_LABEL_PR_OPEN|g" \
  | sed "s|{{LABEL_BLOCKED}}|$CLAUDE_DEV_LABEL_BLOCKED|g" \
  | sed "s|{{MAX_FIX_CYCLES}}|$CLAUDE_DEV_MAX_FIX_CYCLES|g" \
  | sed "s|{{MAX_REVIEW_CYCLES}}|$CLAUDE_DEV_MAX_REVIEW_CYCLES|g")

# --- Run orchestrator ---
echo "[$DATE] Invoking Claude ($CLAUDE_DEV_ORCHESTRATOR_MODEL)..." \
  >> "$CLAUDE_DEV_LOG_DIR/sessions.log"

claude -p "$PROMPT" \
  --model "$CLAUDE_DEV_ORCHESTRATOR_MODEL" \
  --output-format json \
  2>&1 | tee "$CLAUDE_DEV_LOG_DIR/$DATE.json"

EXIT_CODE=${PIPESTATUS[0]}

if [[ $EXIT_CODE -eq 0 ]]; then
  echo "[$DATE] Session completed successfully." >> "$CLAUDE_DEV_LOG_DIR/sessions.log"
else
  echo "[$DATE] Session exited with code $EXIT_CODE." >> "$CLAUDE_DEV_LOG_DIR/sessions.log"
fi

exit $EXIT_CODE