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
bun run up
```

## Environment Variables

This is the complete environment variable reference used by repo code, scripts, compose wiring, or tests.

| Variable                                | Default                                   | Used by                                                                  | Purpose                                                                                                      |
| --------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `APP_PORT`                              | `5173`                                    | `server.ts`, compose, Playwright config, seed script, integration script | Port for the app web server and base URL construction in local/test flows.                                   |
| `API_PORT`                              | `8787`                                    | `services/api/server.ts`, compose, frontend API fallback                 | Port for the Bun API service.                                                                                |
| `PORT`                                  | app/api dependent                         | `server.ts`, `services/api/server.ts`                                    | Generic port override (fallback when app/api-specific vars are not set).                                     |
| `NODE_ENV`                              | unset                                     | `server.ts`, API TLS policy                                              | Enables production mode behavior (`serve:*` scripts set this).                                               |
| `BUN_PUBLIC_API_BASE_URL`               | none                                      | `apps/app/App.tsx`, `apps/app/components/AppShell.tsx`                   | Preferred API base URL for browser requests.                                                                 |
| `BUN_PUBLIC_API_URL`                    | none                                      | `apps/app/App.tsx`, `apps/app/components/AppShell.tsx`                   | Backward-compatible API base URL alias.                                                                      |
| `VITE_API_URL`                          | none                                      | `apps/app/App.tsx`, `apps/app/components/AppShell.tsx`, tests            | API base URL alias for Vite-style env setups.                                                                |
| `BUN_PUBLIC_API_PORT`                   | none                                      | `apps/app/App.tsx`, `apps/app/components/AppShell.tsx`                   | Optional port used in localhost API fallback URL construction.                                               |
| `GITEA_INTERNAL_URL`                    | `http://localhost:3000`                   | `services/api/server.ts`, compose                                        | Upstream Gitea URL used by the API service.                                                                  |
| `BUN_PUBLIC_GITEA_URL`                  | `http://localhost:3000`                   | `services/api/server.ts`, compose                                        | Optional Gitea URL fallback source for API service config.                                                   |
| `VITE_GITEA_URL`                        | `http://localhost:3000`                   | `services/api/server.ts`, smoke tests, integration tests                 | Gitea URL for test clients and optional API fallback source.                                                 |
| `GITEA_ADMIN_USER`                      | `alice`                                   | seed/tests, bootstrap script                                             | Break-glass admin username for local seeding and one-time service-account bootstrap.                         |
| `GITEA_ADMIN_PASS`                      | `bindersnap-dev`                          | seed/tests, bootstrap script                                             | Break-glass admin password for local seeding and one-time service-account bootstrap.                         |
| `GITEA_BOB_USER`                        | `bob`                                     | `tests/seed.ts`                                                          | Seed collaborator username override.                                                                         |
| `GITEA_BOB_PASS`                        | `bindersnap-dev`                          | `tests/seed.ts`                                                          | Seed collaborator password override.                                                                         |
| `GITEA_URL`                             | `http://localhost:3000`                   | `tests/seed.ts`                                                          | Seed script base URL for Gitea API.                                                                          |
| `USER_UID`                              | `1000`                                    | `docker-compose.yml` (`gitea`)                                           | Linux UID used by the Gitea container for file ownership.                                                    |
| `USER_GID`                              | `1000`                                    | `docker-compose.yml` (`gitea`)                                           | Linux GID used by the Gitea container for file ownership.                                                    |
| `GITEA__server__ROOT_URL`               | `http://localhost:3000`                   | `docker-compose.yml` (`gitea`)                                           | Gitea advertised public root URL.                                                                            |
| `GITEA__server__HTTP_PORT`              | `3000`                                    | `docker-compose.yml` (`gitea`)                                           | Gitea internal HTTP listen port.                                                                             |
| `GITEA__database__DB_TYPE`              | `sqlite3`                                 | `docker-compose.yml` (`gitea`)                                           | Gitea database backend type for local stack.                                                                 |
| `GITEA__database__PATH`                 | `/data/gitea.db`                          | `docker-compose.yml` (`gitea`)                                           | Local sqlite database path inside Gitea container.                                                           |
| `GITEA__service__DISABLE_REGISTRATION`  | `false`                                   | `docker-compose.yml` (`gitea`)                                           | Controls open registration behavior in local Gitea.                                                          |
| `GITEA__cors__ENABLED`                  | `true`                                    | `docker-compose.yml` (`gitea`)                                           | Enables Gitea CORS handling in local stack.                                                                  |
| `GITEA__cors__ALLOW_DOMAIN`             | `http://localhost:${APP_PORT}`            | `docker-compose.yml` (`gitea`)                                           | Allowed CORS origin for Gitea in local stack.                                                                |
| `GITEA__cors__METHODS`                  | `GET,POST,PUT,PATCH,DELETE,OPTIONS`       | `docker-compose.yml` (`gitea`)                                           | Allowed CORS methods for local Gitea.                                                                        |
| `GITEA__cors__ALLOW_CREDENTIALS`        | `true`                                    | `docker-compose.yml` (`gitea`)                                           | Allows credentialed cross-origin requests in local Gitea.                                                    |
| `GITEA__log__LEVEL`                     | `warn`                                    | `docker-compose.yml` (`gitea`)                                           | Gitea log verbosity for local stack.                                                                         |
| `BINDERSNAP_APP_ORIGIN`                 | `http://localhost:${APP_PORT}`            | `services/api/server.ts`, compose                                        | Primary allowed browser origin for auth/session API requests. Production should be `https://bindersnap.com`. |
| `BINDERSNAP_ALLOWED_ORIGINS`            | none                                      | `services/api/server.ts`                                                 | Comma-separated override for multiple allowed origins.                                                       |
| `BINDERSNAP_USER_EMAIL_DOMAIN`          | `users.bindersnap.local`                  | `services/api/server.ts`                                                 | Domain used when creating signup email addresses in Gitea.                                                   |
| `BINDERSNAP_GITEA_SERVICE_TOKEN`        | none                                      | `services/api/server.ts`, prod compose                                   | Dedicated Gitea service-account token used by the API for signup, email lookup, and token cleanup.           |
| `BINDERSNAP_SESSION_COOKIE_NAME`        | `bindersnap_session`                      | `services/api/server.ts`                                                 | Session cookie name used by API auth.                                                                        |
| `BINDERSNAP_SESSION_TTL_MS`             | `604800000`                               | `services/api/server.ts`                                                 | Server-side expiry for non-remembered sessions in milliseconds.                                              |
| `BINDERSNAP_REMEMBER_ME_SESSION_TTL_MS` | `2592000000`                              | `services/api/server.ts`, prod compose                                   | Server-side expiry and persistent cookie lifetime for remembered sessions.                                   |
| `BINDERSNAP_SESSION_COOKIE_DOMAIN`      | none                                      | `services/api/server.ts`, prod compose                                   | Optional cookie `Domain`; use `.bindersnap.com` for `bindersnap.com` -> `api.bindersnap.com`.                |
| `BINDERSNAP_SESSION_COOKIE_SAME_SITE`   | `Lax`                                     | `services/api/server.ts`, prod compose                                   | Session cookie `SameSite` policy. Set `None` only if you need cross-site cookie delivery.                    |
| `BINDERSNAP_GITEA_TOKEN_SCOPES`         | `write:user,write:repository,write:issue` | `services/api/server.ts`, compose                                        | Optional extra scopes for session-minted upstream Gitea tokens; required write scopes are always added.      |
| `BINDERSNAP_REQUIRE_HTTPS`              | `true` in production, else `false`        | `services/api/server.ts`, compose                                        | Reject non-HTTPS non-local requests when enabled.                                                            |
| `BINDERSNAP_AUTH_RATE_LIMIT_ENABLED`    | `true`                                    | `services/api/server.ts`, compose                                        | Enables login/signup rate limiting by client IP.                                                             |
| `BINDERSNAP_AUTH_RATE_LIMIT_WINDOW_MS`  | `600000`                                  | `services/api/server.ts`, compose                                        | Rate-limit window duration in milliseconds.                                                                  |
| `BINDERSNAP_AUTH_RATE_LIMIT_MAX`        | `20`                                      | `services/api/server.ts`, compose                                        | Max login/signup attempts per IP+action per window.                                                          |
| `BINDERSNAP_SESSIONS_DB_PATH`           | `/var/lib/bindersnap/sessions.db`         | `services/api/sessions.ts`, prod compose                                 | Persistent SQLite path for API-backed sessions.                                                              |
| `GITEA_SERVICE_TOKEN`                   | none                                      | `docker-compose.prod.yml`, `.env.prod.example`, bootstrap script         | SSM-backed source value that prod compose maps into `BINDERSNAP_GITEA_SERVICE_TOKEN` for the API.            |
| `API_TAG`                               | `latest`                                  | `docker-compose.prod.yml`, GitHub Actions deploys                        | API image tag to pull from GHCR; pin to a prior commit SHA for rollback.                                     |
| `AWS_REGION`                            | `us-east-1`                               | `docker-compose.prod.yml`, `litestream.yml`, Terraform backups module    | AWS region used by the Litestream container and backup infrastructure.                                       |
| `LITESTREAM_S3_BUCKET`                  | none                                      | `docker-compose.prod.yml`, `litestream.yml`, `scripts/restore.sh`        | Required S3 bucket for continuous SQLite replication and restores.                                           |
| `PLAYWRIGHT_BASE_URL`                   | `http://localhost:${APP_PORT}`            | Playwright config, integration script                                    | Base URL for integration browser tests.                                                                      |
| `VITE_GITEA_TOKEN`                      | none                                      | smoke/integration tests                                                  | Optional pre-existing token for direct Gitea API assertions.                                                 |
| `BUN_PUBLIC_HOCUSPOCUS_URL`             | `ws://localhost:1234`                     | compose                                                                  | Frontend websocket URL wiring for collaboration features.                                                    |
| `VITE_HOCUSPOCUS_URL`                   | `ws://localhost:1234`                     | compose/tests                                                            | Vite-style websocket URL alias for collaboration features.                                                   |
| `BUN_PUBLIC_GITEA_OAUTH_CLIENT_ID`      | none                                      | `apps/app/` auth flow                                                    | Public OAuth2 client ID for PKCE login — printed by seed script on first `bun run up`.                       |
| `BUN_PUBLIC_GITEA_OAUTH_REDIRECT_URI`   | `http://localhost:5173/auth/callback`     | `apps/app/` auth flow                                                    | Redirect URI registered with the Gitea OAuth2 app.                                                           |
| `BUN_PUBLIC_PANDOC_SERVICE_URL`         | `http://localhost:3001`                   | `apps/app/` import/export                                                | Base URL for the Pandoc conversion service.                                                                  |

## Local Stack

Use the dockerized stack when you want seeded Gitea + API + app together:

```bash
bun run up
```

See [`tests/README.md`](tests/README.md) for full workflow details.

## Production Secrets

Production no longer relies on a repo-side `.env.prod`. The EC2 instance writes
`/opt/bindersnap/.env.prod` at boot by reading `/bindersnap/prod/*` from SSM
Parameter Store through `infra/compute/user-data.sh.tftpl`.

Use [`.env.prod.example`](.env.prod.example)
as the schema for the generated file only. The committed example keeps
placeholders for the SSM-backed values and documents the non-secret runtime
overrides that can still be passed at deploy time.

The production API now expects `GITEA_SERVICE_TOKEN` in that generated env file.
Create or rotate it with:

```bash
bun scripts/bootstrap-gitea-service-account.ts
```

The bootstrap script uses `GITEA_ADMIN_USER` and `GITEA_ADMIN_PASS` only long
enough to ensure the `bindersnap-service` account exists, grant admin, mint a
`write:admin` PAT, and write it to `/bindersnap/prod/gitea_service_token`.
Those admin credentials should remain break-glass only and stay out of the
steady-state SSM contract after bootstrap.

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

The production API service now runs from a published GHCR image instead of a
source bind mount. Build and publish happens in
`.github/workflows/build-api.yml`, which pushes:

- `ghcr.io/davidgraymi/bindersnap-api:${GITHUB_SHA}`
- `ghcr.io/davidgraymi/bindersnap-api:latest`

Production hosts pull the image selected by `API_TAG` in
`/opt/bindersnap/.env.prod`.
On the EC2 host that value normally lives in `/opt/bindersnap/.env.prod`, which
is generated from SSM at boot and can be regenerated for secret rotation.

To deploy the currently selected API tag:

```bash
docker compose -f docker-compose.prod.yml --env-file /opt/bindersnap/.env.prod pull api
docker compose -f docker-compose.prod.yml --env-file /opt/bindersnap/.env.prod up -d api
```

To roll back, set `API_TAG` to a previous commit SHA in
`/opt/bindersnap/.env.prod`, then run the same `pull` and `up -d api` commands
again.

The end-to-end production deploy workflow, required GitHub variables, and the
GitHub Actions rollback path are documented in
[`docs/ops/deploy.md`](docs/ops/deploy.md).
