---
name: stack
description: Run, inspect and validate against this worktree's local Bindersnap stack (Gitea, API, Caddy, Mailpit, app). Use before starting the app, opening it in a browser, signing in as a seeded user, running Playwright integration tests, reading service logs, or when a port, CORS or dependency problem appears.
---

# The local stack

The four rules in `AGENTS.md` ("The stack, if you are an agent in a worktree")
always apply: never `docker compose`, never assume 5173, `bun run up` exits
when ready, `bun run down` before deleting a worktree. This is the rest.

## Find your stack

```bash
bun run stack status --json   # ports, urls, stackName, running — never guess a port
bun run up                    # build, start detached, wait until ready; safe to await
bun run down                  # this worktree's stack only
```

## Integration tests

- `bun run test:integration` starts and stops its own stack. With
  `SKIP_STACK=1` it reuses the one `bun run up` started. Both find this
  worktree's ports on their own.
- Tests are `tests/*.pw.ts`. Run a targeted file with 2 workers locally
  (`bunx playwright test tests/<file>.pw.ts --workers=2`); the full suite is
  CI's job.
- The Playwright MCP agents (`playwright-test-*`) need the app URL from
  `bun run stack status --json`, not `localhost:5173`.

Other commands: `bun run stack logs [service]`, `bun run up --fresh` (wipe
volumes and seeded Gitea data first), `bun run stack status --all` (every stack
on this machine).

The stack seeds eleven accounts and seven binders from
`tests/seed-data/dev.yaml`. That file is deliberately full of edge cases — a
binder with nothing in it and one covered in sign-off rules, a change six people
have been asked to review and one nobody has looked at in three versions, empty
folders, every file type the comparison screen can meet — so that looking at a
state does not mean building it first. Its header indexes what is in there, and
`tests/README.md` covers the integration tests.

## Validating a change in the browser

`bun run up` is the only way to see the real app. Its `app` container bind-mounts
the repo and runs `bun --hot server.ts` — it **is** the dev server. Edits under
`apps/` and `packages/` hot-reload with nothing to restart, at the app URL that
`bun run stack status` prints. The `api` container runs the bind-mounted
`services/api/server.ts` under `bun --watch`, so a server edit restarts the API
on its own. Sign in as `alice`, `bob`, `carol`, or `dan` with the password
`dev`. Setting `GITEA_ADMIN_PASS` in a checkout's own `.env` overrides it for
that stack, and `bun run stack status` prints whichever is in force; a new
worktree never inherits the main checkout's.

**Do not start a second SPA on another port to preview a change.** The API sends
CORS headers for exactly one origin — your stack's own `APP_PORT`, set as
`BINDERSNAP_APP_ORIGIN` in `docker-compose.yml` — and compose does not pass
`BINDERSNAP_ALLOWED_ORIGINS` through, so there is no override. A `bun run dev:app`
on any other port gets every API call blocked by CORS and can never sign in. It
renders the sign-in page and nothing behind auth.

The app and the public site are two origins, as in production
(`app.bindersnap.com` and `bindersnap.com`): the app on `APP_PORT`, the landing
page, marketing, help and legal on `SITE_PORT`. `bun run stack status` prints
both.

A dependency change is the one thing hot reload cannot pick up: the container
bakes its own `node_modules` into a volume at image build, so a package added on
the host stays invisible until the stack is rebuilt. Fix that with a full
`bun run down && bun run up` — never by killing a process or rebuilding a single
container, which leaves the stack in a half-state. The seed jobs use the host's
`node_modules`, so run `bun install` on the host as well.
