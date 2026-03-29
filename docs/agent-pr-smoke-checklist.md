# Agent PR Smoke Checklist

Use this checklist when validating agent GitHub operations in this repository.

## 1) Read issue

- Fetch one open issue and confirm title/body loaded.
- Record issue number in branch name and PR description.

## 2) Branch safety

- Run: `git status --short --branch`
- If output includes `HEAD (no branch)`, immediately run:
  - `git checkout -b codex/issue-<number>-<short-slug>`

## 3) Minimal test change

- Prefer doc-only edits for workflow checks.
- Keep change set small and reversible.

## 4) Commit and push

- `git add <files>`
- `git commit -m "chore: agent workflow smoke test"`
- `git push origin <branch>`

## 5) Open PR

- Prefer GitHub MCP `create_pull_request`.
- If MCP `create_pull_request` returns `404`, fall back to `gh pr create`.
- If using `gh`, prefer `gh pr create --body-file /tmp/pr-body.md` to avoid
  shell quoting bugs.
- Include:
  - what was validated
  - friction encountered
  - fix applied for future agents

## Observed friction in this repo

- Initial worktree state can be detached HEAD.
- This is resolved by creating a `codex/` branch before making edits.
- Inline multi-line `gh pr create --body` text can break on shell quoting.
- This is resolved by using `--body-file` and simple ASCII content.
- `git fetch` can fail in sandboxed worktrees when `.git/worktrees/...` is not
  writable from the agent sandbox.
- This is resolved by proceeding from local refs and documenting the limitation
  in the PR.
- GitHub MCP may be read-capable (issues/branches) while PR create returns 404.
- This is resolved by falling back to `gh pr create` until MCP write access is fixed.
