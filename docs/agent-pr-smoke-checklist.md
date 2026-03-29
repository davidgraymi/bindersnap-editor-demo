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

- Prefer `gh pr create --body-file /tmp/pr-body.md` to avoid shell quoting bugs.
- If you use `--body`, avoid backticks and complex shell characters.
- If `gh` reports it cannot connect to `api.github.com`, rerun with approved
  network escalation.
- Include:
  - what was validated
  - friction encountered
  - fix applied for future agents

## Observed friction in this repo

- Initial worktree state can be detached HEAD.
- This is resolved by creating a `codex/` branch before making edits.
- Inline multi-line `gh pr create --body` text can break on shell quoting.
- This is resolved by using `--body-file` and simple ASCII content.
