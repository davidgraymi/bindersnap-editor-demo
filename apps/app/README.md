# `apps/app/` — Product SPA

This is the authenticated Bindersnap product app.

## Runtime model

- Browser UI authenticates with `username` + `password` against `services/api`.
- API sets an `HttpOnly` session cookie.
- Browser never stores or receives upstream Gitea access tokens.
- App data calls go through API routes (for example `/api/app/documents`).
- The file-vault shell uses `/api/app/documents` and `/api/app/documents/:id` to keep the list and detail views in sync.
- Document detail also includes a multipart upload form that posts to `/api/app/documents/:id/versions` and refreshes the vault after the upload PR is created.
- The approver queue uses `/api/app/documents/:id/versions/:prNumber/review` and `/api/app/documents/:id/versions/:prNumber/publish` for inline review and publish actions.
- Where the app has a configured Gitea web URL, the queue and audit timeline expose direct source/review links for published and candidate versions.

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
