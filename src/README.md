# `src/` — Shared Source Root

This directory contains **all frontend source code** for two distinct applications that are built and served separately.

## Applications

### `src/` root files (`index.html`, `App.tsx`, `frontend.tsx`, etc.)
The **Bindersnap landing page** — a static marketing site published to GitHub Pages.
- Served at `/`
- No authentication, no Gitea dependency
- Built with `bun run build` → deployed to GitHub Pages
- The embedded editor demo (`<BindersnapEditor>`) is a **read-only snapshot** — it does not connect to any backend

**When you change editor UI:** If a change affects the visual appearance of the editor, update the demo data in `src/index.html` to reflect what the new UI looks like. Run `bun run sync-demo` to regenerate the embedded snapshot. See `scripts/README.md` for details.

### `src/app/`
The **real Bindersnap product** — the authenticated editor application.
- Served at `/app` in development and in the Docker dev stack
- Requires a live Gitea instance (see `dev/`)
- **Never published to GitHub Pages**
- Auth is handled here via Gitea token (see `src/services/gitea/auth.ts`)

## Shared Code

### `src/editor/`
The core Tiptap editor component. **Imported by both applications.**
- The landing page uses it in demo/read-only mode
- The real app uses it fully wired to Gitea
- Design tokens: `src/assets/css/bindersnap-tokens.css`

### `src/services/`
Backend service clients and utilities shared between applications.
- `src/services/gitea/` — all Gitea API interaction (auth, documents, PRs)
- `src/services/sanitizer.ts` — HTML sanitization shared across both apps

### `src/assets/`
Shared CSS tokens, fonts, icons. The single source of truth for all visual values.
