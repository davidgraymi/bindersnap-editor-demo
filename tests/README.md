# `tests/` — Integration Test Stack

Everything needed to run the **full Bindersnap target architecture locally** for development and integration testing.

## What this spins up

| Service        | URL                                        | Purpose                                              |
| -------------- | ------------------------------------------ | ---------------------------------------------------- |
| Gitea          | `http://localhost:${GITEA_PORT:-3000}`     | Git backend, auth source, document storage           |
| Hocuspocus     | `ws://localhost:${HOCUSPOCUS_PORT:-1234}`  | Real-time collaboration WebSocket server             |
| Caddy          | `http://localhost:${API_PROXY_PORT:-8788}` | Local reverse proxy for production-style API ingress |
| API            | `http://localhost:${API_PORT:-8787}`       | The BFF (`services/api/`)                            |
| Bindersnap app | `http://localhost:${APP_PORT:-5173}`       | The unified SPA (`apps/app/`) with hot reload        |

## Running integration tests

```bash
bun run test:integration
```

No shell scripts. No manual `bun run up` beforehand. Playwright's
`globalSetup` starts the full Docker Compose stack, including the local Caddy
proxy in front of the API, waits until the stack is reachable, then runs all
`*.pw.ts` test files. `globalTeardown` shuts the stack down when the run
finishes, whether it passed or failed.

First run takes ~60s for Gitea to initialize and images to pull. Subsequent runs are
faster because Docker caches the images.

### Using an already-running stack

If you have the stack running from `bun run up` and want to skip the start/stop cycle:

```bash
SKIP_STACK=1 bun run test:integration
```

`SKIP_STACK=1` tells `globalSetup` and `globalTeardown` to leave the stack alone.
If you want proxy-path webhook coverage in that mode, make sure the existing
stack includes the local Caddy service on `http://localhost:${API_PROXY_PORT:-8788}`.

### Testing an API you built from source

By default the run goes through the stack's Caddy proxy, which means the API
under test is the one baked into the container image — an API change is only
exercisable after a rebuild, and CI becomes the only loop. Set
`BUN_PUBLIC_API_BASE_URL` and the test workers call your API instead:

```bash
bun run up                                   # terminal 1: the stack
PORT=8790 bun run dev:api                    # terminal 2: your API, from source
SKIP_STACK=1 BUN_PUBLIC_API_BASE_URL=http://localhost:8790 bun run test:integration
```

The value has to come from the environment, not from `.env` — `.env` supplies
defaults, and only what you type is treated as an override. `globalSetup` waits
for `/auth/me` on that URL and fails with one clear message if nothing answers,
rather than letting every suite fail on its own.

What this does and does not cover: every suite that talks to the API over
`fetch` exercises your build, which is most of the API-level coverage. The app
container's SPA has its own base URL baked in at image build and still calls
the proxy, so browser-driven assertions stay about the containerised API. Your
API needs `BINDERSNAP_ALLOWED_ORIGINS` to include the app origin, and needs to
point at the same Gitea the stack is running.

### Overriding ports

Every published port is an environment variable, so nothing in the stack is
pinned to a fixed number:

| Variable          | Default | What it moves                       |
| ----------------- | ------- | ----------------------------------- |
| `APP_PORT`        | `5173`  | The SPA                             |
| `API_PORT`        | `8787`  | The BFF                             |
| `API_PROXY_PORT`  | `8788`  | The Caddy proxy in front of the BFF |
| `GITEA_PORT`      | `3000`  | Gitea                               |
| `HOCUSPOCUS_PORT` | `1234`  | The collaboration websocket server  |

```bash
APP_PORT=4000 bun run test:integration
```

### Running two stacks side by side (one per worktree)

Ports are only half the problem — container names, the network name and the
volume prefix all have to differ too. `STACK_NAME` moves all of them at once:
it is the Compose project name, so it prefixes every container, the network
`${STACK_NAME}-dev`, and every volume.

Give each worktree a `.env` with its own name and its own port block:

```bash
STACK_NAME=bindersnap-wt2
APP_PORT=5273
API_PORT=8887
API_PROXY_PORT=8888
GITEA_PORT=3100
HOCUSPOCUS_PORT=1334
```

Then `bun run up`, `bun run down` and `bun run test:integration` all operate on
that worktree's stack alone. Gitea's data lives in the worktree's own
`./data/gitea`, so the two instances never share state.

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

When Stripe credentials are absent, the test runtime injects a deterministic
`STRIPE_WEBHOOK_SECRET` into the local stack so the signature-verification and
`/stripe/webhook`-through-Caddy coverage still runs. The dedicated proxy test
is `tests/stripe-webhook-caddy.pw.ts`.

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
bun test apps/app packages/editor packages/utils
bun test services/api scripts infra/backups
```

## Seeded data

After Gitea is healthy, the `seed` container runs `tests/seed.ts`, which applies
the scenario described in **[`tests/seed-data/dev.yaml`](seed-data/dev.yaml)**.

**That YAML file is the seed data.** Want another account, another document, or a
document parked in a particular review state? Edit the YAML. `seed.ts` is only the
engine that turns the description into Gitea calls — you should not need to read it.

Every seeded account signs in with the password `dev`:

| User    | Password | Who they are                                         |
| ------- | -------- | ---------------------------------------------------- |
| `alice` | `dev`    | Compliance manager — owns most documents, site admin |
| `bob`   | `dev`    | Legal counsel — the reviewer who blocks and approves |
| `carol` | `dev`    | Operations lead — owns documents of her own          |
| `dan`   | `dev`    | External auditor — read-only access                  |

The documents cover every status the workspace list can show:

| Document                          | Owner | Status                   |
| --------------------------------- | ----- | ------------------------ |
| `alice/quarterly-report`          | alice | Changes requested        |
| `alice/vendor-contracts`          | alice | In review                |
| `alice/incident-response-plan`    | alice | Ready to publish         |
| `alice/data-processing-agreement` | alice | Published                |
| `alice/employee-handbook`         | alice | Draft                    |
| `carol/vendor-security-review`    | carol | Published + open change  |
| `bob/hipaa-training-policy`       | bob   | Published (two versions) |

Three more are the same clinic policy manual in the three file types the app
actually meets, so the preview and comparison screens can be judged on the file
type rather than on the prose. Each is published once and has a second version
open for review, and each second version makes the same three kinds of edit — a
deadline shortened, a clause reworded, a paragraph added:

| Document                                 | File    | What it shows                                                |
| ---------------------------------------- | ------- | ------------------------------------------------------------ |
| `alice/infection-control-policy`         | `.docx` | A file a browser cannot read inside — both versions offered  |
| `alice/medication-administration-policy` | `.pdf`  | The comparison reading a PDF's text layer back with pdf.js   |
| `alice/patient-grievance-policy`         | `.md`   | The rendered comparison: the change marked inside the policy |

Set a document's `format:` in the YAML (`prosemirror`, `markdown`, `pdf`, or
`docx`) and the prose beneath it is rendered into that file. Word files and PDFs
are generated from the same YAML rather than committed as binary fixtures, so
editing a policy is still a YAML edit. Their timestamps are pinned — otherwise
identical prose would produce different bytes on every run and each re-seed
would silently add another update to every open change.

Plus review threads (open and resolved), read-only collaborators, protected `main`
branches, `doc/vNNNN` version tags, and a public OAuth2 app registered for PKCE
login at the app's redirect URI.

Integration tests call `seedDevStack()` from `seed.ts` themselves to ensure these
fixtures are present before asserting against them. Seeding is idempotent — re-running
it against an already-seeded Gitea is safe, including after a password change.

Validate the scenario without starting anything:

```bash
bun run test:seed
```

## Re-seeding from scratch

```bash
bun run down             # destroys volumes
bun run test:integration # starts fresh and re-seeds
```

## Structure

```
tests/
  README.md                 — this file
  playwright.config.ts      — Playwright configuration
  global-setup.ts           — starts the Docker Compose stack before tests
  global-teardown.ts        — tears down the stack after tests
  seed-data/dev.yaml        — THE SEED DATA: users, documents, changes, reviews
  seed-scenario.ts          — the seed format: types, validation, document rendering
  seed-scenario.test.ts     — unit tests for the format and for dev.yaml itself
  seed-documents.ts         — a document's prose to bytes: Markdown, PDF, .docx
  seed-documents.test.ts    — unit tests for each format, and for reproducibility
  seed.ts                   — the engine that applies a scenario to Gitea
  helpers.ts                — shared constants, createMemoryStorage, makeClient,
                              pollUntil, resolveAndStoreToken — imported by all *.pw.ts
  smoke.pw.ts               — stack health checks + app shell route smoke tests
  pkce-oauth.pw.ts          — PKCE OAuth2 app registration and SPA route tests
  gitea-services.pw.ts      — gitea-client integration tests (auth, documents,
                              pull requests, repos, uploads)
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
