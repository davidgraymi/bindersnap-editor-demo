# CLAUDE.md

**Read `AGENTS.md` before making any changes.** It is the single source of truth for architecture decisions, design system rules, GitHub workflow policy, and product context.

---

## Commands

All commands use **Bun** as the runtime and package manager.

```bash
# Run the app (Gitea + seed + Hocuspocus + API + Caddy + app)
bun run up            # Start — the only way to get a working, seeded app
bun run down          # Tear down

# Partial servers — neither gives you a working app on its own
bun run dev:app       # SPA only: landing page and other UI that calls no API.
                      # Binds APP_PORT from .env (5173 if unset).
bun run dev:api       # API only: still needs Gitea, which only `bun run up` runs.

# Build
bun run build         # Build SPA to dist/

# Tests
bun run test          # All unit tests (test:app + test:ops + test:seed)
bun run test:app      # apps/app, packages/editor, packages/utils, packages/ui-tokens
bun run test:ops      # services/api, scripts, infra/backups
bun run test:integration  # Playwright — starts and stops its own stack
                          # SKIP_STACK=1 reuses a running `bun run up` stack
bun test path/to/file.test.ts  # Single file

# Code formatting
bun run format        # Format all source files
bun run format:check  # Check without writing
```

Test files live alongside source as `*.test.ts`. TypeScript strict mode is the linter.

Production deploys run themselves — `deploy-pyinfra.yml` on every push to `main`.
To drive one by hand (Python, not Bun):

```bash
python3 -m venv deploy/.venv
deploy/.venv/bin/pip install -r deploy/requirements.txt
source deploy/.venv/bin/activate

deploy/bin/ssm-connect.sh --dry   # report changes without applying
deploy/bin/ssm-connect.sh         # apply
```

## Validating a change in the browser

`bun run up` is the only way to see the real app. Its `app` container bind-mounts
the repo and runs `bun --hot server.ts` — it **is** the dev server. Edits under
`apps/` and `packages/` hot-reload at `http://localhost:${APP_PORT:-5173}` with
nothing to restart. Sign in as `alice`, `bob`, `carol`, or `dan`; every seeded
account uses the password `dev`.

Ports come from `.env`, not from the defaults above. A worktree with its own
`STACK_NAME` and port block serves the app on that block's `APP_PORT`.

**Do not start a second SPA on another port to preview a change.** The API sends
CORS headers for exactly one origin — `http://localhost:${APP_PORT}`, set as
`BINDERSNAP_APP_ORIGIN` in `docker-compose.yml` — and compose does not pass
`BINDERSNAP_ALLOWED_ORIGINS` through, so there is no override. A `bun run dev:app`
on any other port gets every API call blocked by CORS and can never sign in. It
renders the landing page and nothing behind auth.

A dependency change is the one thing hot reload cannot pick up: the container
bakes its own `node_modules` into a volume at image build, so a package added on
the host stays invisible until the stack is rebuilt. Fix that with a full
`bun run down && bun run up` — never by killing a process or rebuilding a single
container, which leaves the stack in a half-state.

---

## Architecture

Bun monorepo — one SPA, shared packages, backend services.

Production is **one EC2 host** running the `docker-compose.prod.yml` stack (API,
Gitea, Hocuspocus, Caddy, Litestream). `deploy/deploy.py` configures it over an
SSH-through-SSM tunnel on every push to `main`; Terraform only provisions AWS
resources. See `docs/adr/0003-single-ec2-host-pyinfra-push-deploys.md` and
`deploy/README.md`.

---

## Non-Negotiable Architecture Decisions

Settled. Do not reopen. If a task requires violating one, open a `human-needed` issue.

1. **BFF owns auth; Gitea tokens stay server-side.** The browser receives only an `HttpOnly` session cookie. No bearer tokens in `sessionStorage` or `localStorage`.

2. **Gitea is the only datastore.** No Postgres, no cache, no shadow state beyond the BFF's SQLite session store.

3. **File uploads flow browser → BFF → Gitea.** The BFF reads the file as base64 and commits to the Gitea contents API. See `docs/adr/0001-external-file-workflow-contract.md` — that ADR is law.

4. **Two independent workflows.** File vault (external uploads) and inline editor are separate. Do not conflate them.

5. **Editor UI changes need a flag.** If you change `packages/editor/` visuals, note it in your PR. The landing page no longer embeds the editor, so no demo re-sync is needed.

6. **`deploy/` configures the host; Terraform does not.** No serverless (no Lambda, Aurora, or API Gateway), no config bucket, no bootstrap logic in `user-data.sh`. Host config changes are commits to `deploy/`.
