# `apps/app/` — Product SPA

This is the authenticated Bindersnap product app.

## Runtime model

- Browser UI authenticates with `username` + `password` against `services/api`.
- API sets an `HttpOnly` session cookie.
- Browser never stores or receives upstream Gitea access tokens.
- App data calls go through API routes (for example `/api/app/documents`).
- The file-vault shell uses `/api/app/documents` and `/api/app/documents/:id` to keep the list and detail views in sync.

## Entry points

- `index.html`: HTML entry for the product app.
- `App.tsx`: Route/auth gate (`/app`, `/login`, `/auth/callback` shell handling).
- `components/AppShell.tsx`: Authenticated vault shell with document list and detail state.

## Local dev

Run app + API together:

```bash
bun run dev:api
bun run dev:app
```

Or run the full stack through Docker:

```bash
bun run up
```

## Deployment note

`apps/app` is a private product app target. Keep it separate from the public
landing deployment target (`apps/landing`).
