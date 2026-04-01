# Bindersnap API

Lightweight Bun auth/BFF service for the authenticated app.

## What it does

- `POST /auth/signup`
- `POST /auth/login`
- `POST /auth/logout`
- `GET /auth/me`
- `GET /api/app/documents`

The browser only receives a Bindersnap session cookie. Gitea access tokens stay server-side in memory for this MVP.

## Environment

- `API_PORT` or `PORT`: API listen port. Default `8787`.
- `GITEA_INTERNAL_URL`: Internal Gitea URL used by the API. Default `http://localhost:3000`.
- `GITEA_ADMIN_USER`: Admin username used for signup and token revocation.
- `GITEA_ADMIN_PASS`: Admin password used for signup and token revocation.
- `BINDERSNAP_APP_ORIGIN`: Single allowed SPA origin for CORS. Default `http://localhost:${APP_PORT:-5173}`.
- `BINDERSNAP_ALLOWED_ORIGINS`: Optional comma-separated override for multiple allowed origins.
- `BINDERSNAP_USER_EMAIL_DOMAIN`: Placeholder signup email domain. Default `users.bindersnap.local`.
- `BINDERSNAP_SESSION_COOKIE_NAME`: Session cookie name. Default `bindersnap_session`.
- `BINDERSNAP_SESSION_TTL_MS`: Session lifetime in milliseconds. Default `604800000` (7 days).
- `BINDERSNAP_GITEA_TOKEN_SCOPES`: Comma-separated Gitea token scopes. Default `read:repository`.
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

- Sessions are stored in memory, so restarting the API signs every user out.
- The API keeps per-session Gitea tokens in process memory.
- Tokens are revoked on logout, on user re-login (old session replacement), and during expiration cleanup.
- This is intentionally small for startup speed. Move sessions to Redis or a database before running multiple API instances.
