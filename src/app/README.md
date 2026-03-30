# `src/app/` — Real Bindersnap Product

This is the **authenticated Bindersnap application** — the real product, not the marketing demo.

## What lives here

- `index.html` — app entry point (separate from landing page)
- `App.tsx` — root React component with auth gate and routing
- `pages/` — page-level components (DocumentList, DocumentEditor, etc.)
- `components/` — app-shell UI (nav, sidebar, auth modal)

## What does NOT live here

- Editor logic → `src/editor/`
- Gitea service clients → `src/services/gitea/`
- Landing page → `src/` root

## How it runs

This app requires a live Gitea backend. In development, use the Docker dev stack:

```bash
cd dev && docker compose up
```

This starts Gitea, Hocuspocus, and serves the app at `http://localhost:5173/app`.
Gitea is pre-seeded with demo users and documents — see `dev/README.md`.

## Auth model

Users log in with a Gitea personal access token. No separate Bindersnap auth database exists. The token is stored in `sessionStorage` (cleared on tab close) and passed to both the Gitea service layer and the Hocuspocus provider. See `src/services/gitea/auth.ts`.

In the Docker dev stack, `/app` auto-sign-in defaults to on.
Set `BINDERSNAP_DEV_AUTO_LOGIN=false` to disable it.
The Bun server mints a dev token using seeded admin credentials and the UI stores it in `sessionStorage`.
If auto-login is disabled or fails, the manual token gate is shown.

## Never published

This app is intentionally excluded from the GitHub Pages build. It is only served via the Docker dev stack locally, or a private deployment. There is no sign-in page exposed on the public landing site.
