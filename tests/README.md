# `tests/` — Integration Test Stack

Everything needed to run the **full Bindersnap target architecture locally** for development and integration testing.

## What this spins up

| Service        | URL                                  | Purpose                                    |
| -------------- | ------------------------------------ | ------------------------------------------ |
| Gitea          | `http://localhost:3000`              | Git backend, auth source, document storage |
| Hocuspocus     | `ws://localhost:1234`                | Real-time collaboration WebSocket server   |
| Bindersnap app | `http://localhost:${APP_PORT:-5173}` | The real app (`apps/app/`) with hot reload |

## Running integration tests

```bash
bun run test:integration
```

No shell scripts. No manual `docker compose up` beforehand. Playwright's `globalSetup`
starts the full Docker Compose stack, waits for the app to become reachable, then runs
all `*.pw.ts` test files. `globalTeardown` shuts the stack down when the run finishes,
whether it passed or failed.

First run takes ~60s for Gitea to initialize and images to pull. Subsequent runs are
faster because Docker caches the images.

### Using an already-running stack

If you have the stack running from `bun run up` and want to skip the start/stop cycle:

```bash
SKIP_STACK=1 bun run test:integration
```

`SKIP_STACK=1` tells `globalSetup` and `globalTeardown` to leave the stack alone.

### Overriding the app port

```bash
APP_PORT=4000 bun run test:integration
```

## Running unit tests

Unit tests live alongside source as `*.test.ts` and use `bun:test`. No Docker required.

```bash
bun run test          # all unit tests (app + landing + editor + gitea-client + utils)
bun run test:app      # apps/app + packages/gitea-client
bun run test:landing  # apps/landing + packages/editor + packages/utils
```

## Seeded data

After Gitea is healthy, the `seed` container runs `tests/seed.ts` automatically and creates:

- Two users: `alice` (admin) and `bob` (collaborator)
- A demo repository: `alice/quarterly-report`
- Three documents in different approval states (see `documents/`)
- An open PR from `bob/feature/q2-amendments` → `main` with a "Changes Requested" review
- A public OAuth2 app registered for PKCE login at the app's redirect URI

Integration tests call `seedDevStack()` from `seed.ts` themselves to ensure these
fixtures are present before asserting against them. Seeding is idempotent — re-running
it against an already-seeded Gitea is safe.

## Re-seeding from scratch

```bash
docker compose down -v   # destroys volumes
bun run test:integration # starts fresh and re-seeds
```

## Structure

```
tests/
  README.md                 — this file
  playwright.config.ts      — Playwright configuration
  global-setup.ts           — starts the Docker Compose stack before tests
  global-teardown.ts        — tears down the stack after tests
  seed.ts                   — shared TypeScript seeding workflow
  smoke.pw.ts               — basic stack health + app shell smoke tests
  api-auth.pw.ts            — API credential auth flow tests
  pkce-oauth.pw.ts          — PKCE OAuth2 app registration tests
  gitea-services.pw.ts      — gitea-client service wrapper integration tests
  documents/
    draft.json              — ProseMirror JSON fixture: working draft
    in-review.json          — ProseMirror JSON fixture: open PR, awaiting review
    changes-requested.json  — ProseMirror JSON fixture: PR with changes requested
```

## This is not production

`tests/` is a developer tool. It is never deployed. The Docker Compose config uses
insecure defaults (fixed passwords, no TLS) that are intentional for local speed.
Do not use this config as a basis for any production deployment.
