# `apps/app/` — the Bindersnap app

The app, served from `app.bindersnap.com` by its own assets-only Cloudflare
Worker (`wrangler.jsonc` here). The landing page and the rest of the public
site are `apps/site`, on `bindersnap.com` (issue #718). A signed-out visitor
at `/` is sent to `/-/login`.

## Runtime model

- Browser UI authenticates with `username` + `password` against `services/api`.
- API sets an `HttpOnly` session cookie and serves the app-facing endpoints.
- App data calls go through API routes (for example `/api/app/documents`).

## Entry points

- `index.html`: the shell — icons, fonts, theme, and the React mount root.
- `App.tsx`: Route/auth gate. The app's own pages are behind `/-/`
  (`/-/login`, `/-/documents`, …); see `routes.ts`.
- `siteLink.ts`: links to the public site (help, legal), which is another
  origin; `BUN_PUBLIC_SITE_URL` names it.
- `components/AppShell.tsx`: Authenticated workspace shell and data fetch.

## Local dev

Run the full stack. It is the only configuration in which the SPA can reach the
API, and the only one with data in it:

```bash
bun run up
```

The app container bind-mounts the repo and runs `bun --hot server.ts`, so this
already is the hot-reloading dev server — edits appear at
`http://localhost:${APP_PORT:-5173}` without a restart. It serves the public
site too, as a second origin, on `SITE_PORT` (`bun run stack status` prints
both).

`bun run dev:app` on its own serves the sign-in page and the public site, and
nothing behind auth. It has no
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

Signup has its own Turnstile widget, so a script cannot fill Gitea with
accounts or send confirmation emails to strangers:

- `BUN_PUBLIC_SIGNUP_TURNSTILE_SITE_KEY`: its public key, which
  `infra/edge/put-signup-turnstile-secret.sh` prints. Unset (the local stack,
  CI), the form shows no check, and the API, which has no secret either,
  checks nothing.

`BUN_PUBLIC_APP_VERSION` and `BUN_PUBLIC_APP_COMMIT` say which build a report
came from; unset, both read "dev". Read any optional `BUN_PUBLIC_` variable
through `publicEnv()`: Bun inlines only the ones a build has, and an unset one
throws in a browser.

## Error reports

An error nothing caught — an uncaught exception, an unhandled rejection, a
screen React could not render — is reported to the same Worker's `/errors`
route by `errorReporter.ts`: the error's type, its scrubbed message and stack,
the route's kind and nothing else from it, the build, the browser, and the
request IDs of API calls that had just failed. Never who, never which
organization. Ten a page at most, each error once.

- `BUN_PUBLIC_ERROR_REPORT_URL`: where they go. Production:
  `https://feedback.bindersnap.com/errors`. Unset, nothing is sent. The local
  stack sets an address nothing answers at.

## Deployment note

`bun run build` emits a single `dist/` artifact for GitHub Pages and copies
`dist/index.html` to `dist/404.html` so deep links resolve back into the SPA.
