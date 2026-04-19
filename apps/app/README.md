# `apps/app/` — Unified Bindersnap SPA

This is the single Bindersnap frontend deployed to GitHub Pages.
The landing page is pre-rendered into `index.html`, and React swaps to the
workspace shell when a valid session is present.

## Runtime model

- Browser UI authenticates with `username` + `password` against `services/api`.
- API sets an `HttpOnly` session cookie and serves the app-facing endpoints.
- App data calls go through API routes (for example `/api/app/documents`).

## Entry points

- `index.html`: Pre-rendered landing shell plus the React mount root.
- `App.tsx`: Route/auth gate for `/`, `/login`, `/docs/*`, `/inbox`, and `/activity`.
- `components/LandingPage.tsx`: Controls the static landing shell visibility.
- `components/AppShell.tsx`: Authenticated workspace shell and data fetch.

## Local dev

Run the unified SPA + API together:

```bash
bun run dev:api
bun run dev:app
```

Or run the full stack through Docker:

```bash
bun run up
```

## Deployment note

`bun run build` emits a single `dist/` artifact for GitHub Pages and copies
`dist/index.html` to `dist/404.html` so deep links resolve back into the SPA.
