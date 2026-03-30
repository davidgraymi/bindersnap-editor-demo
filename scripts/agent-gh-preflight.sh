#!/usr/bin/env bash
set -euo pipefail

issue_number="${1:-}"

if ! command -v gh >/dev/null 2>&1; then
  echo "ERROR: GitHub CLI (gh) is not installed." >&2
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  echo "ERROR: git is not installed." >&2
  exit 1
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "ERROR: Current directory is not a git repository." >&2
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "ERROR: gh is not authenticated. Run: gh auth login" >&2
  exit 1
fi

if ! git remote get-url origin >/dev/null 2>&1; then
  echo "ERROR: origin remote is missing." >&2
  exit 1
fi

repo_full_name="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
default_branch="$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name)"
current_branch="$(git rev-parse --abbrev-ref HEAD)"

if [[ "$current_branch" == "HEAD" ]]; then
  echo "ERROR: Detached HEAD state. Switch to a branch before continuing." >&2
  exit 1
fi

if [[ -n "$issue_number" ]]; then
  if ! gh issue view "$issue_number" --repo "$repo_full_name" >/dev/null 2>&1; then
    echo "ERROR: Issue #$issue_number is not accessible in $repo_full_name." >&2
    exit 1
  fi
  issue_title="$(gh issue view "$issue_number" --repo "$repo_full_name" --json title -q .title)"
  echo "Issue check: #$issue_number $issue_title"
else
  echo "Issue check: skipped (no issue number provided)"
fi

clean_state="yes"
if [[ -n "$(git status --porcelain)" ]]; then
  clean_state="no"
fi

echo "Repo: $repo_full_name"
echo "Default branch: $default_branch"
echo "Current branch: $current_branch"
echo "Working tree clean: $clean_state"
echo "Preflight: OK"
