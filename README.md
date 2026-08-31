# Bindersnap Editor Demo

Monorepo with one unified frontend app and supporting services:

- `apps/app`: GitHub Pages SPA with a pre-rendered landing page and authenticated workspace shell
- `services/api`: auth/BFF API for the product SPA
- `services/hocuspocus`: collaboration websocket service

## Quick Start

### Prerequisites

- [Bun](https://bun.com)
- [Docker](https://www.docker.com/)

```bash
bun install
cp tests/.env.example .env
bun run up
```

If you want to exercise the Stripe billing flow locally, fill in these values in
`.env` before starting the stack:

- `STRIPE_SECRET_KEY=sk_test_...`
- `STRIPE_PRICE_ID=price_...` for the subscription price you want to test

`bun run test:integration` now starts the Stripe CLI listener automatically for
hosted Checkout coverage when those Stripe test values are present. You only
need to set `STRIPE_WEBHOOK_SECRET` yourself when you want to exercise the
billing flow outside Playwright, for example with a manual `bun run up` session.

If a Stripe subscription exists but the local subscription row is missing, you
can rebuild it from Stripe with:

```bash
bun run reconcile:stripe-customer -- --username alice
bun run reconcile:stripe-customer -- --customer cus_123
```

## Environment Variables

This is the complete environment variable reference used by repo code, scripts, compose wiring, or tests.

| Variable                                | Default                                   | Used by                                                                  | Purpose                                                                                                                                                                    |
| --------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STACK_NAME`                            | `bindersnap`                              | `docker-compose.yml`, Playwright global setup/teardown                   | Compose project name, container name prefix, and network name. Change it per worktree to run several stacks side by side.                                                  |
| `GITEA_PORT`                            | `3000`                                    | `docker-compose.yml`, `tests/seed.ts`, `tests/helpers.ts`                | Gitea HTTP port, published on the host and used inside the compose network.                                                                                                |
| `HOCUSPOCUS_PORT`                       | `1234`                                    | `services/hocuspocus/server.ts`, compose                                 | Port for the Yjs collaboration websocket server.                                                                                                                           |
| `API_PROXY_PORT`                        | `8788`                                    | `docker-compose.yml` (`caddy`), `tests/Caddyfile.integration`, tests     | Port for the local Caddy proxy that fronts the API.                                                                                                                        |
| `APP_PORT`                              | `5173`                                    | `server.ts`, compose, Playwright config, seed script, integration script | Port for the app web server and base URL construction in local/test flows.                                                                                                 |
| `API_PORT`                              | `8787`                                    | `services/api/server.ts`, compose                                        | Port for the Bun API service. The browser does not use it — it calls whatever `BUN_PUBLIC_API_BASE_URL` was built with (the Caddy proxy port in the local stack).          |
| `PORT`                                  | app/api dependent                         | `server.ts`, `services/api/server.ts`                                    | Generic port override (fallback when app/api-specific vars are not set).                                                                                                   |
| `NODE_ENV`                              | unset                                     | `server.ts`, API TLS policy                                              | Enables production mode behavior (`serve:*` scripts set this).                                                                                                             |
| `BUN_PUBLIC_API_BASE_URL`               | none                                      | `packages/api-client/mutator.ts`                                         | API origin the browser calls. Read when the bundle is built (or when the dev server starts) and inlined — a change needs a restart, not a reload. Unset means same-origin. |
| `BUN_PUBLIC_API_URL`                    | none                                      | `docker-compose.yml`, Playwright global setup                            | Legacy alias. Set by compose and the test runtime; no app code reads it.                                                                                                   |
| `VITE_API_URL`                          | none                                      | `docker-compose.yml`, Playwright global setup                            | Legacy Vite-style alias. Set by compose and the test runtime; no app code reads it.                                                                                        |
| `BUN_PUBLIC_API_PORT`                   | none                                      | nothing                                                                  | Legacy. No code reads it — there is no localhost API fallback; set `BUN_PUBLIC_API_BASE_URL` instead.                                                                      |
| `GITEA_INTERNAL_URL`                    | `http://localhost:3000`                   | `services/api/server.ts`, compose                                        | Upstream Gitea URL used by the API service.                                                                                                                                |
| `BUN_PUBLIC_GITEA_URL`                  | `http://localhost:3000`                   | `services/api/server.ts`, compose                                        | Optional Gitea URL fallback source for API service config.                                                                                                                 |
| `VITE_GITEA_URL`                        | `http://localhost:3000`                   | `services/api/server.ts`, smoke tests, integration tests                 | Gitea URL for test clients and optional API fallback source.                                                                                                               |
| `GITEA_ADMIN_USER`                      | `alice`                                   | seed/tests, bootstrap script                                             | Break-glass admin username for local seeding and one-time service-account bootstrap.                                                                                       |
| `GITEA_ADMIN_PASS`                      | `dev`                                     | seed/tests, bootstrap script                                             | Password for every seeded local account, and for the one-time service-account bootstrap.                                                                                   |
| `GITEA_URL`                             | `http://localhost:3000`                   | `tests/seed.ts`                                                          | Seed script base URL for Gitea API.                                                                                                                                        |
| `USER_UID`                              | `1000`                                    | `docker-compose.yml` (`gitea`)                                           | Linux UID used by the Gitea container for file ownership.                                                                                                                  |
| `USER_GID`                              | `1000`                                    | `docker-compose.yml` (`gitea`)                                           | Linux GID used by the Gitea container for file ownership.                                                                                                                  |
| `GITEA__server__ROOT_URL`               | `http://localhost:3000`                   | `docker-compose.yml` (`gitea`)                                           | Gitea advertised public root URL.                                                                                                                                          |
| `GITEA__server__HTTP_PORT`              | `3000`                                    | `docker-compose.yml` (`gitea`)                                           | Gitea internal HTTP listen port.                                                                                                                                           |
| `GITEA__database__DB_TYPE`              | `sqlite3`                                 | `docker-compose.yml` (`gitea`)                                           | Gitea database backend type for local stack.                                                                                                                               |
| `GITEA__database__PATH`                 | `/data/gitea.db`                          | `docker-compose.yml` (`gitea`)                                           | Local sqlite database path inside Gitea container.                                                                                                                         |
| `GITEA__service__DISABLE_REGISTRATION`  | `false`                                   | `docker-compose.yml` (`gitea`)                                           | Controls open registration behavior in local Gitea.                                                                                                                        |
| `GITEA__cors__ENABLED`                  | `true`                                    | `docker-compose.yml` (`gitea`)                                           | Enables Gitea CORS handling in local stack.                                                                                                                                |
| `GITEA__cors__ALLOW_DOMAIN`             | `http://localhost:${APP_PORT}`            | `docker-compose.yml` (`gitea`)                                           | Allowed CORS origin for Gitea in local stack.                                                                                                                              |
| `GITEA__cors__METHODS`                  | `GET,POST,PUT,PATCH,DELETE,OPTIONS`       | `docker-compose.yml` (`gitea`)                                           | Allowed CORS methods for local Gitea.                                                                                                                                      |
| `GITEA__cors__ALLOW_CREDENTIALS`        | `true`                                    | `docker-compose.yml` (`gitea`)                                           | Allows credentialed cross-origin requests in local Gitea.                                                                                                                  |
| `GITEA__log__LEVEL`                     | `warn`                                    | `docker-compose.yml` (`gitea`)                                           | Gitea log verbosity for local stack.                                                                                                                                       |
| `BINDERSNAP_APP_ORIGIN`                 | `http://localhost:${APP_PORT}`            | `services/api/server.ts`, compose                                        | Primary allowed browser origin for auth/session API requests. Production should be `https://bindersnap.com`.                                                               |
| `BINDERSNAP_ALLOWED_ORIGINS`            | none                                      | `services/api/server.ts`                                                 | Comma-separated override for multiple allowed origins.                                                                                                                     |
| `BINDERSNAP_USER_EMAIL_DOMAIN`          | `users.bindersnap.local`                  | `services/api/server.ts`                                                 | Domain used when creating signup email addresses in Gitea.                                                                                                                 |
| `BINDERSNAP_GITEA_SERVICE_TOKEN`        | none                                      | `services/api/server.ts`, prod compose                                   | Dedicated Gitea service-account token used by the API for signup, email lookup, and token cleanup.                                                                         |
| `BINDERSNAP_SESSION_COOKIE_NAME`        | `bindersnap_session`                      | `services/api/server.ts`                                                 | Session cookie name used by API auth.                                                                                                                                      |
| `BINDERSNAP_SESSION_TTL_MS`             | `604800000`                               | `services/api/server.ts`                                                 | Server-side expiry for non-remembered sessions in milliseconds.                                                                                                            |
| `BINDERSNAP_REMEMBER_ME_SESSION_TTL_MS` | `2592000000`                              | `services/api/server.ts`, prod compose                                   | Server-side expiry and persistent cookie lifetime for remembered sessions.                                                                                                 |
| `BINDERSNAP_SESSION_COOKIE_DOMAIN`      | none                                      | `services/api/server.ts`, prod compose                                   | Optional cookie `Domain`; use `.bindersnap.com` for `bindersnap.com` -> `api.bindersnap.com`.                                                                              |
| `BINDERSNAP_SESSION_COOKIE_SAME_SITE`   | `Lax`                                     | `services/api/server.ts`, prod compose                                   | Session cookie `SameSite` policy. Set `None` only if you need cross-site cookie delivery.                                                                                  |
| `BINDERSNAP_GITEA_TOKEN_SCOPES`         | `write:user,write:repository,write:issue` | `services/api/server.ts`, compose                                        | Optional extra scopes for session-minted upstream Gitea tokens; required write scopes are always added.                                                                    |
| `BINDERSNAP_REQUIRE_HTTPS`              | `true` in production, else `false`        | `services/api/server.ts`, compose                                        | Reject non-HTTPS non-local requests when enabled.                                                                                                                          |
| `BINDERSNAP_AUTH_RATE_LIMIT_ENABLED`    | `true`                                    | `services/api/server.ts`, compose                                        | Enables login/signup rate limiting by client IP.                                                                                                                           |
| `BINDERSNAP_AUTH_RATE_LIMIT_WINDOW_MS`  | `600000`                                  | `services/api/server.ts`, compose                                        | Rate-limit window duration in milliseconds.                                                                                                                                |
| `BINDERSNAP_AUTH_RATE_LIMIT_MAX`        | `20`                                      | `services/api/server.ts`, compose                                        | Max login/signup attempts per IP+action per window.                                                                                                                        |
| `BINDERSNAP_SESSIONS_DB_PATH`           | `/var/lib/bindersnap/sessions.db`         | `services/api/sessions.ts`, prod compose                                 | Persistent SQLite path for API-backed sessions.                                                                                                                            |
| `STRIPE_SECRET_KEY`                     | none                                      | `services/api/server.ts`, compose, Stripe checkout tests                 | Stripe test-mode secret key used by the API to create checkout and billing portal sessions.                                                                                |
| `STRIPE_WEBHOOK_SECRET`                 | none                                      | `services/api/server.ts`, compose, Stripe checkout tests                 | Webhook signing secret used to verify `stripe/webhook` events in local dev and tests.                                                                                      |
| `STRIPE_PRICE_ID`                       | none                                      | `services/api/server.ts`, compose, Stripe checkout tests                 | Subscription price ID used when the API creates Stripe Checkout Sessions.                                                                                                  |
| `GITEA_SERVICE_TOKEN`                   | none                                      | `docker-compose.prod.yml`, `.env.prod.example`, bootstrap script         | SSM-backed source value that prod compose maps into `BINDERSNAP_GITEA_SERVICE_TOKEN` for the API.                                                                          |
| `API_TAG`                               | `latest`                                  | `docker-compose.prod.yml`, GitHub Actions deploys                        | API image tag to pull from GHCR; pin to a prior commit SHA for rollback.                                                                                                   |
| `AWS_REGION`                            | `us-east-1`                               | `docker-compose.prod.yml`, `litestream.yml`, Terraform backups module    | AWS region used by the Litestream container and backup infrastructure.                                                                                                     |
| `LITESTREAM_S3_BUCKET`                  | none                                      | `docker-compose.prod.yml`, `litestream.yml`, `scripts/restore.sh`        | Required S3 bucket for continuous SQLite replication and restores.                                                                                                         |
| `PLAYWRIGHT_BASE_URL`                   | `http://localhost:${APP_PORT}`            | Playwright config, integration script                                    | Base URL for integration browser tests.                                                                                                                                    |
| `VITE_GITEA_TOKEN`                      | none                                      | smoke/integration tests                                                  | Optional pre-existing token for direct Gitea API assertions.                                                                                                               |
| `BUN_PUBLIC_HOCUSPOCUS_URL`             | `ws://localhost:1234`                     | `docker-compose.yml`                                                     | Websocket URL passed to the app container. Collaboration is not wired into the SPA yet, so no app code reads it.                                                           |
| `VITE_HOCUSPOCUS_URL`                   | `ws://localhost:1234`                     | `docker-compose.yml`                                                     | Vite-style alias of the above; no app code reads it.                                                                                                                       |
| `BUN_PUBLIC_GITEA_OAUTH_CLIENT_ID`      | none                                      | `apps/app/` auth flow                                                    | Public OAuth2 client ID for PKCE login — printed by seed script on first `bun run up`.                                                                                     |
| `BUN_PUBLIC_GITEA_OAUTH_REDIRECT_URI`   | `http://localhost:5173/auth/callback`     | `apps/app/` auth flow                                                    | Redirect URI registered with the Gitea OAuth2 app.                                                                                                                         |
| `BUN_PUBLIC_PANDOC_SERVICE_URL`         | `http://localhost:3001`                   | `apps/app/` import/export                                                | Base URL for the Pandoc conversion service.                                                                                                                                |

## Local Stack

Use the dockerized stack when you want seeded Gitea + API + app together:

```bash
bun run up
```

Sign in at `http://localhost:${APP_PORT:-5173}` as `alice`, `bob`, `carol`, or
`dan` — every seeded account uses the password `dev`. The stack comes up with
documents in every review state: draft, in review, changes requested, ready to
publish, and published.

This stack is also the dev server: its `app` container bind-mounts the repo and
runs `bun --hot server.ts`, so edits under `apps/` and `packages/` hot-reload in
the browser with nothing to restart. A change to dependencies is the exception —
the container builds its own `node_modules` at image build, so adding a package
needs a full `bun run down && bun run up`.

Do not run a second SPA on a second port against this stack. The API sends CORS
headers for exactly one origin, `http://localhost:${APP_PORT}`, so
`bun run dev:app` elsewhere is blocked on every request; on its own it serves the
landing page and other UI that calls no API.

What gets seeded is described declaratively in
[`tests/seed-data/dev.yaml`](tests/seed-data/dev.yaml). Edit that file to add an
account, a document, or a review scenario; `bun run test:seed` validates it
without starting anything.

### Running more than one stack at once

Every published port and every container name in `docker-compose.yml` comes from
an environment variable, so a second worktree can run its own stack alongside
the first. Give each worktree its own `.env` with a distinct `STACK_NAME` and a
distinct port block:

```bash
STACK_NAME=bindersnap-wt2
APP_PORT=5273
API_PORT=8887
API_PROXY_PORT=8888
GITEA_PORT=3100
HOCUSPOCUS_PORT=1334
```

`STACK_NAME` sets the Compose project name, the container name prefix, the
network name, and the volume prefix, so the two stacks never touch each other's
containers or data.

See [`tests/README.md`](tests/README.md) for full workflow details.

## Deployment

Two surfaces, both triggered by a push to `main`:

| What                                      | Where                     | Workflow                                                     |
| ----------------------------------------- | ------------------------- | ------------------------------------------------------------ |
| SPA                                       | GitHub Pages              | [`pages.yml`](.github/workflows/pages.yml)                   |
| API, Gitea, Hocuspocus, Caddy, Litestream | One EC2 host, via Compose | [`deploy-pyinfra.yml`](.github/workflows/deploy-pyinfra.yml) |

The backend is a single EC2 instance, not a serverless stack. Its entire
configuration lives in [`deploy/`](deploy/README.md) as a
[pyinfra](https://pyinfra.com/) script. GitHub Actions **pushes** the deploy: it
assumes an OIDC role, pushes a ~60-second ephemeral key with EC2 Instance
Connect, tunnels SSH through `aws ssm start-session`, and runs
`pyinfra deploy/inventory.py deploy/deploy.py`. The host has **no inbound port
22** and there are **no long-lived keys**.

`deploy.py` is idempotent — a fresh host converges to the current stack with no
pre-configuration, and a re-run changes nothing unless config or secrets
changed. Terraform under [`infra/`](infra/) provisions AWS resources only; it
does not configure the host.

Run it yourself (dry run applies nothing):

```bash
python3 -m venv deploy/.venv
deploy/.venv/bin/pip install -r deploy/requirements.txt
source deploy/.venv/bin/activate

deploy/bin/ssm-connect.sh --dry
```

- Pipeline details, required GitHub variables, rollback: [`docs/ops/deploy.md`](docs/ops/deploy.md)
- Recovering the host when CI is down: [`docs/ops/break-glass.md`](docs/ops/break-glass.md)
- Why it is built this way: [`docs/adr/0003-single-ec2-host-pyinfra-push-deploys.md`](docs/adr/0003-single-ec2-host-pyinfra-push-deploys.md)

## Production Secrets

Production no longer relies on a repo-side `.env.prod`. The pyinfra deploy
(`deploy/deploy.py`) renders `/opt/bindersnap/.env.prod` on every run by
reading `/bindersnap/prod/*` from SSM Parameter Store on the control plane.

Use [`.env.prod.example`](.env.prod.example)
as the schema for the generated file only. The committed example keeps
placeholders for the SSM-backed values and documents the non-secret runtime
overrides that can still be passed at deploy time.

The production API now expects `GITEA_SERVICE_TOKEN` in that generated env file.
On the first deploy against a fresh host, the pyinfra run detects the
placeholder value, starts Gitea with the first-boot admin credentials from SSM,
runs `scripts/bootstrap-gitea-service-account.ts` in a throwaway Bun container,
writes the real token back to `/bindersnap/prod/gitea_service_token`, refreshes
`/opt/bindersnap/.env.prod`, and only then starts the API.

To support that flow, set these secrets in `infra/secrets/terraform.tfvars`
before `infra/apply-all.sh apply`:

```hcl
gitea_admin_user = "gitea-admin"
gitea_admin_pass = "REPLACE_WITH_OPENSSL_OUTPUT"
```

`infra/apply-all.sh apply` now also dispatches the same bootstrap over AWS SSM
to the current prod instance after the secrets module is applied, so existing
instances pick up the service token without needing an EC2 rebuild.

Manual create or rotation is still available with:

```bash
bun scripts/bootstrap-gitea-service-account.ts
```

The bootstrap script uses `GITEA_ADMIN_USER` and `GITEA_ADMIN_PASS` only long
enough to ensure the `bindersnap-service` account exists, grant admin, mint a
`write:admin` PAT, and write it to `/bindersnap/prod/gitea_service_token`.
After the token is real, the env render stops writing those admin
credentials into `/opt/bindersnap/.env.prod`, so the steady-state compose stack
does not keep them in its runtime env file.

## Production Backups

`docker-compose.prod.yml` includes a `litestream` sidecar that continuously
replicates the Gitea SQLite database and the API session database to S3. Before
starting the production stack, ensure the SSM-backed generated env file at
`/opt/bindersnap/.env.prod` includes `LITESTREAM_S3_BUCKET`, and leave
`AWS_REGION` aligned with the bucket region.

To restore from S3 during an incident:

```bash
docker compose -f docker-compose.prod.yml --env-file /opt/bindersnap/.env.prod down
export LITESTREAM_S3_BUCKET=bindersnap-litestream-123456789012
./scripts/restore.sh gitea
docker compose -f docker-compose.prod.yml --env-file /opt/bindersnap/.env.prod up -d
```

Use `./scripts/restore.sh api` to restore the API session store instead. The
script assumes the production Docker volumes are mounted at `/data/...`, so run
it from the production app host or an equivalent recovery environment.

## Production API Image

The production API service runs from a published GHCR image instead of a source
bind mount. `deploy-pyinfra.yml` calls the reusable
`.github/workflows/build-api.yml` for the exact commit being deployed, which
pushes:

- `ghcr.io/davidgraymi/bindersnap-api:${GITHUB_SHA}`
- `ghcr.io/davidgraymi/bindersnap-api:latest`

The host pulls the image selected by `API_TAG` in `/opt/bindersnap/.env.prod`.
The deploy pins that to the deployed commit's SHA — the immutable tag, not
mutable `:latest`. Normal rollback is a `git revert` on `main`, or running
`deploy-pyinfra.yml` via **Run workflow** with the `api_tag` input set to a
last-good SHA. For a pin that survives subsequent pushes, set the SSM `api_tag`
override (see [`docs/ops/break-glass.md`](docs/ops/break-glass.md)).

The commands below are the manual fallback for when GitHub Actions is
unavailable — the normal path is a deploy. To deploy the currently selected API
tag by hand on the host:

```bash
cd /opt/bindersnap
docker compose -f docker-compose.prod.yml --env-file /opt/bindersnap/.env.prod pull api
docker compose -f docker-compose.prod.yml --env-file /opt/bindersnap/.env.prod up -d api
```

To roll back by hand, set `API_TAG` to a previous commit SHA in
`/opt/bindersnap/.env.prod`, then run the same `pull` and `up -d api` commands
again. Note that the next pyinfra deploy re-renders `.env.prod` and undoes a
hand-edited pin — use the SSM override for anything that must persist.

The end-to-end production deploy workflow, required GitHub variables, and the
GitHub Actions rollback path are documented in
[`docs/ops/deploy.md`](docs/ops/deploy.md).
