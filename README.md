# Bindersnap Editor Demo

Monorepo with two separate frontend apps and supporting services:

- `apps/landing`: public landing/demo site (GitHub Pages target)
- `apps/app`: authenticated product SPA
- `services/api`: auth/BFF API for the product app
- `services/hocuspocus`: collaboration websocket service

## Scripts

```bash
# App targets
bun run dev:landing
bun run dev:app
bun run dev:api

# Build
bun run build:landing
bun run build:app
bun run build:all

# Test
bun run test:landing
bun run test:app
bun run test:integration

# Production-style serve
bun run serve:landing
bun run serve:app
bun run serve:api
```

## Environment Variables

This is the complete environment variable reference used by repo code, scripts, compose wiring, or tests.

| Variable                               | Default                               | Used by                                                                  | Purpose                                                                                |
| -------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `APP_PORT`                             | `5173`                                | `server.ts`, compose, Playwright config, seed script, integration script | Port for the app web server and base URL construction in local/test flows.             |
| `API_PORT`                             | `8787`                                | `services/api/server.ts`, compose, frontend API fallback                 | Port for the Bun API service.                                                          |
| `PORT`                                 | app/api dependent                     | `server.ts`, `services/api/server.ts`                                    | Generic port override (fallback when app/api-specific vars are not set).               |
| `APP_TARGET`                           | `app` (implicit)                      | `server.ts`                                                              | Chooses wildcard target for `server.ts` (`landing` or `app`).                          |
| `NODE_ENV`                             | unset                                 | `server.ts`, API TLS policy                                              | Enables production mode behavior (`serve:*` scripts set this).                         |
| `BUN_PUBLIC_API_BASE_URL`              | none                                  | `apps/app/App.tsx`, `apps/app/components/AppShell.tsx`                   | Preferred API base URL for browser requests.                                           |
| `BUN_PUBLIC_API_URL`                   | none                                  | `apps/app/App.tsx`, `apps/app/components/AppShell.tsx`                   | Backward-compatible API base URL alias.                                                |
| `VITE_API_URL`                         | none                                  | `apps/app/App.tsx`, `apps/app/components/AppShell.tsx`, tests            | API base URL alias for Vite-style env setups.                                          |
| `BUN_PUBLIC_API_PORT`                  | none                                  | `apps/app/App.tsx`, `apps/app/components/AppShell.tsx`                   | Optional port used in localhost API fallback URL construction.                         |
| `GITEA_INTERNAL_URL`                   | `http://localhost:3000`               | `services/api/server.ts`, compose                                        | Upstream Gitea URL used by the API service.                                            |
| `BUN_PUBLIC_GITEA_URL`                 | `http://localhost:3000`               | `services/api/server.ts`, compose                                        | Optional Gitea URL fallback source for API service config.                             |
| `VITE_GITEA_URL`                       | `http://localhost:3000`               | `services/api/server.ts`, smoke tests, integration tests                 | Gitea URL for test clients and optional API fallback source.                           |
| `GITEA_ADMIN_USER`                     | `alice`                               | `services/api/server.ts`, seed/tests                                     | Admin username for signup/token revocation and seed/test setup.                        |
| `GITEA_ADMIN_PASS`                     | `bindersnap-dev`                      | `services/api/server.ts`, seed/tests                                     | Admin password for signup/token revocation and seed/test setup.                        |
| `GITEA_BOB_USER`                       | `bob`                                 | `dev/tests/seed.ts`                                                      | Seed collaborator username override.                                                   |
| `GITEA_BOB_PASS`                       | `bindersnap-dev`                      | `dev/tests/seed.ts`                                                      | Seed collaborator password override.                                                   |
| `GITEA_URL`                            | `http://localhost:3000`               | `dev/tests/seed.ts`                                                      | Seed script base URL for Gitea API.                                                    |
| `USER_UID`                             | `1000`                                | `dev/docker-compose.yml` (`gitea`)                                       | Linux UID used by the Gitea container for file ownership.                              |
| `USER_GID`                             | `1000`                                | `dev/docker-compose.yml` (`gitea`)                                       | Linux GID used by the Gitea container for file ownership.                              |
| `GITEA__server__ROOT_URL`              | `http://localhost:3000`               | `dev/docker-compose.yml` (`gitea`)                                       | Gitea advertised public root URL.                                                      |
| `GITEA__server__HTTP_PORT`             | `3000`                                | `dev/docker-compose.yml` (`gitea`)                                       | Gitea internal HTTP listen port.                                                       |
| `GITEA__database__DB_TYPE`             | `sqlite3`                             | `dev/docker-compose.yml` (`gitea`)                                       | Gitea database backend type for local stack.                                           |
| `GITEA__database__PATH`                | `/data/gitea.db`                      | `dev/docker-compose.yml` (`gitea`)                                       | Local sqlite database path inside Gitea container.                                     |
| `GITEA__service__DISABLE_REGISTRATION` | `false`                               | `dev/docker-compose.yml` (`gitea`)                                       | Controls open registration behavior in local Gitea.                                    |
| `GITEA__cors__ENABLED`                 | `true`                                | `dev/docker-compose.yml` (`gitea`)                                       | Enables Gitea CORS handling in local stack.                                            |
| `GITEA__cors__ALLOW_DOMAIN`            | `http://localhost:${APP_PORT}`        | `dev/docker-compose.yml` (`gitea`)                                       | Allowed CORS origin for Gitea in local stack.                                          |
| `GITEA__cors__METHODS`                 | `GET,POST,PUT,PATCH,DELETE,OPTIONS`   | `dev/docker-compose.yml` (`gitea`)                                       | Allowed CORS methods for local Gitea.                                                  |
| `GITEA__cors__ALLOW_CREDENTIALS`       | `true`                                | `dev/docker-compose.yml` (`gitea`)                                       | Allows credentialed cross-origin requests in local Gitea.                              |
| `GITEA__log__LEVEL`                    | `warn`                                | `dev/docker-compose.yml` (`gitea`)                                       | Gitea log verbosity for local stack.                                                   |
| `BINDERSNAP_APP_ORIGIN`                | `http://localhost:${APP_PORT}`        | `services/api/server.ts`, compose                                        | Primary allowed browser origin for auth/session API requests.                          |
| `BINDERSNAP_ALLOWED_ORIGINS`           | none                                  | `services/api/server.ts`                                                 | Comma-separated override for multiple allowed origins.                                 |
| `BINDERSNAP_USER_EMAIL_DOMAIN`         | `users.bindersnap.local`              | `services/api/server.ts`                                                 | Domain used when creating signup email addresses in Gitea.                             |
| `BINDERSNAP_SESSION_COOKIE_NAME`       | `bindersnap_session`                  | `services/api/server.ts`                                                 | Session cookie name used by API auth.                                                  |
| `BINDERSNAP_SESSION_TTL_MS`            | `604800000`                           | `services/api/server.ts`                                                 | Session expiry duration in milliseconds.                                               |
| `BINDERSNAP_GITEA_TOKEN_SCOPES`        | `read:repository`                     | `services/api/server.ts`, compose                                        | Comma-separated scopes for session-minted upstream Gitea tokens.                       |
| `BINDERSNAP_REQUIRE_HTTPS`             | `true` in production, else `false`    | `services/api/server.ts`, compose                                        | Reject non-HTTPS non-local requests when enabled.                                      |
| `BINDERSNAP_AUTH_RATE_LIMIT_ENABLED`   | `true`                                | `services/api/server.ts`, compose                                        | Enables login/signup rate limiting by client IP.                                       |
| `BINDERSNAP_AUTH_RATE_LIMIT_WINDOW_MS` | `600000`                              | `services/api/server.ts`, compose                                        | Rate-limit window duration in milliseconds.                                            |
| `BINDERSNAP_AUTH_RATE_LIMIT_MAX`       | `20`                                  | `services/api/server.ts`, compose                                        | Max login/signup attempts per IP+action per window.                                    |
| `PLAYWRIGHT_BASE_URL`                  | `http://localhost:${APP_PORT}`        | Playwright config, integration script                                    | Base URL for integration browser tests.                                                |
| `VITE_GITEA_TOKEN`                     | none                                  | smoke/integration tests                                                  | Optional pre-existing token for direct Gitea API assertions.                           |
| `BUN_PUBLIC_HOCUSPOCUS_URL`            | `ws://localhost:1234`                 | compose                                                                  | Frontend websocket URL wiring for collaboration features.                              |
| `VITE_HOCUSPOCUS_URL`                  | `ws://localhost:1234`                 | compose/tests                                                            | Vite-style websocket URL alias for collaboration features.                             |
| `BUN_PUBLIC_GITEA_OAUTH_CLIENT_ID`     | none                                  | `apps/app/` auth flow                                                    | Public OAuth2 client ID for PKCE login — printed by seed script on first `bun run up`. |
| `BUN_PUBLIC_GITEA_OAUTH_REDIRECT_URI`  | `http://localhost:5173/auth/callback` | `apps/app/` auth flow                                                    | Redirect URI registered with the Gitea OAuth2 app.                                     |
| `BUN_PUBLIC_PANDOC_SERVICE_URL`        | `http://localhost:3001`               | `apps/app/` import/export                                                | Base URL for the Pandoc conversion service.                                            |

## Local Stack

Use the dockerized stack when you want seeded Gitea + API + app together:

```bash
bun run up
```

See [`dev/README.md`](dev/README.md) for full workflow details.
