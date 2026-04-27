# `tests/` — Integration Test Stack

Everything needed to run the **full Bindersnap target architecture locally** for development and integration testing.

## What this spins up

| Service        | URL                                  | Purpose                                       |
| -------------- | ------------------------------------ | --------------------------------------------- |
| Gitea          | `http://localhost:3000`              | Git backend, auth source, document storage    |
| Hocuspocus     | `ws://localhost:1234`                | Real-time collaboration WebSocket server      |
| Bindersnap app | `http://localhost:${APP_PORT:-5173}` | The unified SPA (`apps/app/`) with hot reload |

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

## Stripe billing flow

The local compose stack can exercise the subscription checkout flow when the
API container gets real Stripe test credentials from `.env`.

Set these values before `bun run up`:

- `STRIPE_SECRET_KEY=sk_test_...`
- `STRIPE_PRICE_ID=price_...` for the subscription price you want to test

`bun run test:integration` will start `stripe listen` automatically, capture the
runtime webhook signing secret, inject it into the API container, and keep the
listener alive for the duration of the Playwright run.

Set `STRIPE_WEBHOOK_SECRET` yourself only when you are testing the billing flow
manually outside Playwright, for example with `bun run up`.

The `tests/stripe-subscription.pw.ts` suite reads the same Stripe values and
skips Stripe-specific assertions when they are unset.

### Stripe billing in CI

The Playwright integration job in `.github/workflows/pr-verify.yml` enables
Stripe billing coverage only when these GitHub Actions secrets are set:

- `STRIPE_TEST_SECRET_KEY`
- `STRIPE_TEST_PRICE_ID`

When both are present, the workflow installs the Stripe CLI, `globalSetup`
starts `stripe listen`, and the runtime webhook signing secret is generated on
the fly. Do not store `STRIPE_WEBHOOK_SECRET` in CI — the test runtime creates
it for each run before `docker compose up`.

## Running unit tests

Unit tests live alongside source as `*.test.ts` and use `bun:test`. No Docker required.

```bash
bun test apps/app packages/gitea-client packages/editor packages/utils
bun test services/api scripts infra/backups
```

## Seeded data

After Gitea is healthy, the `seed` container runs `tests/seed.ts` automatically and creates:

- Two users: `alice` (admin) and `bob` (collaborator)
- Two private demo document repositories: `alice/quarterly-report` and `alice/vendor-contracts`
- Canonical document files stored on the seeded review branches at the repo root as `document.json`
- Empty, protected `main` branches on the seeded document repositories
- An open PR on `alice/quarterly-report` with a "Changes Requested" review
- An open PR on `alice/vendor-contracts` awaiting review
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
  seed.ts                   — shared TypeScript seeding workflow (do not edit lightly)
  helpers.ts                — shared constants, createMemoryStorage, makeClient,
                              pollUntil, resolveAndStoreToken — imported by all *.pw.ts
  smoke.pw.ts               — stack health checks + app shell route smoke tests
  pkce-oauth.pw.ts          — PKCE OAuth2 app registration and SPA route tests
  gitea-services.pw.ts      — gitea-client integration tests (auth, documents,
                              pull requests, repos, uploads)
  documents/
    draft.json              — ProseMirror JSON fixture: working draft
    in-review.json          — ProseMirror JSON fixture: open PR, awaiting review
    changes-requested.json  — ProseMirror JSON fixture: PR with changes requested
```

### Why there is no api-auth.pw.ts

The product app now authenticates through `services/api` with an `HttpOnly`
session cookie, but the end-to-end auth path is already exercised through the
main Playwright flows. A separate browser-only auth suite would duplicate the
same surface without adding much signal.

## This is not production

`tests/` is a developer tool. It is never deployed. The Docker Compose config uses
insecure defaults (fixed passwords, no TLS) that are intentional for local speed.
Do not use this config as a basis for any production deployment.
