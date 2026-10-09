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
- `App.tsx`: Route/auth gate. The app's own pages are behind `/-/`
  (`/-/login`, `/-/documents`, …); see `routes.ts`.
- `components/LandingPage.tsx`: Controls the static landing shell visibility.
- `components/AppShell.tsx`: Authenticated workspace shell and data fetch.

## Local dev

Run the full stack. It is the only configuration in which the SPA can reach the
API, and the only one with data in it:

```bash
bun run up
```

The app container bind-mounts the repo and runs `bun --hot server.ts`, so this
already is the hot-reloading dev server — edits appear at
`http://localhost:${APP_PORT:-5173}` without a restart.

`bun run dev:app` on its own serves the landing page and nothing else. It has no
API: with `BUN_PUBLIC_API_BASE_URL` unset the browser calls the app server
same-origin, and `server.ts` answers every path with the SPA's HTML, so each API
call comes back as an unparseable 200. Pointing it at a running stack does not
help either — the API sends CORS headers only for `http://localhost:${APP_PORT}`,
so a second SPA on a second port is blocked on every request.

## Send feedback

The top bar's feedback button (and "Send feedback" in the account menu) posts
to the feedback Worker, `services/feedback`, with a trace of what the app knew
(`feedbackTrace.ts`). It needs two build variables, and the app shows no button
without both:

- `BUN_PUBLIC_FEEDBACK_URL`: where reports go. Production:
  `https://feedback.bindersnap.com/`. The local stack sets an address nothing
  answers at; the integration tests stand in for the Worker.
- `BUN_PUBLIC_TURNSTILE_SITE_KEY`: the Turnstile widget's public key. The
  local stack uses Turnstile's always-pass test key.

`BUN_PUBLIC_APP_VERSION` and `BUN_PUBLIC_APP_COMMIT` say which build a report
came from; unset, both read "dev". Read any optional `BUN_PUBLIC_` variable
through `publicEnv()`: Bun inlines only the ones a build has, and an unset one
throws in a browser.

## Deployment note

`bun run build` emits a single `dist/` artifact for GitHub Pages and copies
`dist/index.html` to `dist/404.html` so deep links resolve back into the SPA.
