---
name: stacked-pr
description: Branch, commit, push and open pull requests the way this repo ships work — Conventional Commits, the PR template, and stacks of PRs each based on the one before. Use when asked to commit, open or update a PR, split work into a stack, rebase a stack, or when a push fails.
---

# Stacked PRs

The rules are in `AGENTS.md` ("Git and GitHub"). This is how to follow them.

## Find the base

Work is rarely based on `main`. Long-running work lives on a `development/*`
branch, and each PR in a stack is based on the PR before it.

```bash
gh pr view --json baseRefName,headRefName   # an existing PR's base
git log --oneline origin/<base>..HEAD       # what this branch adds
git diff origin/<base>...HEAD               # review against the real base, never `main` by habit
```

## Commit

- Conventional Commits with a scope, written as a sentence about the result:
  `feat(auth): a Turnstile check on signup`,
  `fix(deploy): a deploy restarts only what it changed`.
- Never edit `CHANGELOG.md` or the version: `release.yml` does it.
- `bun run format:check` and the relevant `bun run test:*` before pushing.

## Build a stack

1. Branch each PR off the previous one: `git checkout -b <next> <previous>`.
2. Push with `git push -u origin <branch>`.
3. Open each PR against the branch below it:
   `gh pr create --base <previous> --head <next>`. The bottom PR's base is the
   `development/*` branch (or `main`).
4. Link them, bottom to top, **always with `--base`**:
   `gh stack link --base <development-branch> <pr> <pr> …`. Without it the
   bottom PR is retargeted to `main`, and GitHub then refuses to change the
   base of a stacked PR: fixing it takes `gh stack unstack <n>`,
   `gh pr edit <bottom> --base <branch>`, and linking again.
5. The body follows `.github/pull_request_template.md`: Summary, Scope Check,
   Validation with the commands actually run. Flag any visual change under
   `packages/editor/`.

After a lower PR changes, rebase the ones above it onto it and push with
`--force-with-lease` — your own feature branches only, never `main` or a
`development/*` branch (a hook refuses that).

Squash merges orphan the PRs above: retarget each to the new base and rebase
with `git rebase --onto <new-base> <old-base-sha> <branch>`.

## When a push fails

- **`GH007: Your push would publish a private email address`**: the commit
  author email is hidden by the person's GitHub settings. Stop and ask before
  re-authoring commits.
- A network error: retry up to four times, waiting 2s, 4s, 8s, 16s.
