# Bindersnap API

Lightweight Bun auth/BFF service for the unified GitHub Pages SPA.

## What it does

- `POST /auth/signup`
- `POST /auth/login` accepts `identifier`/`password` plus optional `rememberMe`
- `POST /auth/logout`
- `GET /auth/me`
- `GET /api/app/documents`

The browser only receives a Bindersnap session cookie. Gitea access tokens stay server-side in the session store for this MVP.

## Environment

- `API_PORT` or `PORT`: API listen port. Default `8787`.
- `GITEA_INTERNAL_URL`: Internal Gitea URL used by the API. Default `http://localhost:3000`.
- `BINDERSNAP_GITEA_SERVICE_TOKEN`: Dedicated Gitea service-account token used for signup, email lookup during login, and token revocation fallback.
- `BINDERSNAP_APP_ORIGIN`: Single allowed SPA origin for CORS. Default `http://localhost:${APP_PORT:-5173}`. Production should be `https://bindersnap.com`.
- `BINDERSNAP_ALLOWED_ORIGINS`: Optional comma-separated override for multiple allowed origins.
- `BINDERSNAP_USER_EMAIL_DOMAIN`: Placeholder signup email domain. Default `users.bindersnap.local`.
- `BINDERSNAP_SESSION_COOKIE_NAME`: Session cookie name. Default `bindersnap_session`.
- `BINDERSNAP_SESSION_TTL_MS`: Server-side expiry for non-remembered sessions. Default `604800000` (7 days).
- `BINDERSNAP_REMEMBER_ME_SESSION_TTL_MS`: Server-side expiry and persistent cookie lifetime for remembered sessions. Default `2592000000` (30 days).
- `BINDERSNAP_SESSION_COOKIE_DOMAIN`: Optional cookie `Domain` attribute. Set `.bindersnap.com` when the SPA runs at `bindersnap.com` and the API runs at `api.bindersnap.com`.
- `BINDERSNAP_SESSION_COOKIE_SAME_SITE`: Cookie `SameSite` attribute. Default `Lax`; set `None` only when you explicitly need cross-site cookie delivery.
- `BINDERSNAP_GITEA_TOKEN_SCOPES`: Optional comma-separated extra Gitea token scopes. The API always adds `write:user`, `write:repository`, and `write:issue` so session-minted tokens can create repos, open PRs, and manage collaborators.
- `BINDERSNAP_REQUIRE_HTTPS`: Enforce HTTPS for non-local requests. Default `true` in production, `false` otherwise.
- `BINDERSNAP_AUTH_RATE_LIMIT_ENABLED`: Enable auth endpoint rate limiting. Default `true`.
- `BINDERSNAP_AUTH_RATE_LIMIT_WINDOW_MS`: Rate-limit window for `/auth/login` and `/auth/signup`. Default `600000` (10 minutes).
- `BINDERSNAP_AUTH_RATE_LIMIT_MAX`: Max auth attempts per IP per action per window. Default `20`.

## Local usage

```bash
bun run dev:api
```

Production-style run:

```bash
bun run serve:api
```

## MVP tradeoffs

- Sessions are stored in a local SQLite database and are not shared across multiple API instances.
- The API keeps per-session Gitea tokens in the session store.
- Tokens are revoked on logout, on user re-login (old session replacement), and during expiration cleanup.
- The API no longer uses break-glass admin credentials at runtime. Production signup/admin flows depend on the dedicated `bindersnap-service` token provisioned by `scripts/bootstrap-gitea-service-account.ts`.
- This is intentionally small for startup speed. Move sessions to Redis or a database before running multiple API instances.
