# Story: Unify Landing Page + App into One SPA on GitHub Pages

**Priority:** High
**Estimate:** 3–5 days
**Labels:** infra, frontend, auth

---

## Context

Bindersnap currently has two separate frontend applications:

| | Landing (`apps/landing/`) | App (`apps/app/`) |
|---|---|---|
| Deployed to | GitHub Pages | S3 (planned, not yet live) |
| Domain | `bindersnap.com` | `app.bindersnap.com` |
| Auth | None | Cookie-based session via API |
| Build | Bun bundler → `dist/landing/` | Bun bundler → `dist/app/` |
| Router | None (static HTML + vanilla JS) | Custom History API router in `App.tsx` |

We want to merge these into a single SPA deployed to GitHub Pages at `bindersnap.com`. This eliminates the S3/CloudFront dependency, the `app.` subdomain, and the separate deploy pipeline.

The landing page content must be pre-rendered into the HTML at build time so crawlers can index it without executing JavaScript. Logged-in users hitting `/` see their workspace instead.

---

## Desired Behavior

1. **`/` (unauthenticated):** Renders the landing page. Content is in the static HTML — crawlers see it immediately. React hydrates on top for interactivity (theme toggle, scroll animations, editor demo, waitlist form).

2. **`/` (authenticated):** React detects a valid session and renders the workspace. The landing page HTML flashes briefly then swaps — acceptable for MVP; can be optimized later with a loading skeleton.

3. **`/login`, `/docs/*`, `/inbox`, `/activity`:** App routes. Behave exactly as they do today.

4. **Any unmatched route:** Falls back to the SPA shell (GitHub Pages `404.html` trick).

---

## Framework Decision: Keep Custom Router

**Do NOT introduce TanStack Router, React Router, or any routing library.**

Rationale:

- The existing custom router in `App.tsx` (lines 51–127) is ~80 lines. It uses `History.pushState`, a `popstate` listener, and a `getRoute()` pattern-matcher that returns a discriminated union. It's type-safe, has zero dependencies, and the team already understands it.
- The app has 6 route variants. This will grow to maybe 10–15, not 100. The custom router handles this trivially.
- TanStack Router's value proposition (file-based routes, loader/action patterns, type-safe search params) solves problems Bindersnap doesn't have. The app doesn't do SSR, doesn't have complex data loading waterfalls, and doesn't need nested layouts beyond what `AppShell` already provides.
- React Router v7's value is similar — it's optimized for remix-style loader patterns and SSR. Overkill here.
- Adding a router library means: new dependency, new mental model, migration of existing routes, and coupling to that library's release cycle. The cost exceeds the benefit at this scale.

**When to revisit:** if the route count exceeds ~20, or if nested layout routing becomes painful. Neither is on the horizon.

---

## Implementation Plan

### Phase 1: Pre-render the landing page into the app's HTML shell

**Goal:** `apps/app/index.html` contains the full landing page markup so crawlers see real content.

1. Move the marketing content from `apps/landing/index.html` (the `<nav>`, `<main>`, and `<footer>` — roughly lines 36–820) into `apps/app/index.html`, inside a `<div id="landing-content">` wrapper that sits alongside the existing `<div id="root">`.

2. The vanilla JS from the landing page (theme toggle, scroll reveal, waitlist form) moves to a standalone file `apps/app/landing-inline.ts` that runs immediately — no React dependency. This script operates on `#landing-content`.

3. On React mount, the app checks auth state:
   - **No session + route is `/`:** Leave `#landing-content` visible. React hydrates the editor demo into its existing container inside the landing markup. The `#root` div renders nothing (or a minimal login trigger).
   - **Valid session OR route is not `/`:** Hide `#landing-content` (set `display: none` or remove from DOM). React renders the app shell into `#root` as it does today.

4. This approach means the raw HTML is the landing page by default — if JS fails to load, the user still sees marketing content. Progressive enhancement.

**Key files:**
- `apps/app/index.html` — merge landing markup in
- `apps/app/landing-inline.ts` — vanilla JS for landing interactivity
- `apps/app/App.tsx` — add landing/app routing at the top level
- `apps/app/components/LandingPage.tsx` — React wrapper that manages the `#landing-content` div visibility and hydrates the editor demo

### Phase 2: Extend the custom router

**Goal:** `/` resolves to either landing or workspace based on auth state.

1. Add a new route variant to `AppRoute`:
   ```typescript
   | { kind: "home" }
   ```

2. Update `getRoute()`: the path `/` returns `{ kind: "home" }` instead of `{ kind: "workspace" }`.

3. In the main render logic, `home` resolves based on auth state:
   ```typescript
   case "home":
     return user ? <Workspace /> : <LandingPage />;
   ```

4. `navigateTo({ kind: "workspace" })` still produces `/` as the path — a logged-in user's URL is just `bindersnap.com`, not `bindersnap.com/workspace`.

5. Login flow: after successful login, if current route is `home`, re-render triggers the workspace. No redirect needed.

6. Logout flow: clear session → re-render triggers landing page. Clean.

### Phase 3: Remember-me auth

**Goal:** Returning users stay logged in across browser sessions.

Currently, the session check is `GET /auth/me` with `credentials: "include"`. The API sets a session cookie. This already works for "remember me" — the cookie just needs a longer `Max-Age`.

1. Add a "Remember me" checkbox to the login form (default: checked).
2. POST `/auth/login` gains an optional `rememberMe: boolean` field.
3. API sets cookie `Max-Age`:
   - `rememberMe: true` → 30 days
   - `rememberMe: false` → session cookie (dies when browser closes)
4. On app mount, `fetchSessionUser()` already calls `/auth/me` — if the cookie is valid, user is auto-logged-in and sees the workspace.

**API file:** `services/api/server.ts` — the login handler where the `Set-Cookie` header is built.

### Phase 4: Consolidate build and deploy

**Goal:** One build command, one deploy target.

1. Remove `apps/landing/` entirely. All its content now lives in `apps/app/`.

2. Update `package.json`:
   - Remove `build:landing`, `dev:landing`, `serve:landing`, `test:landing` scripts
   - `build` becomes just the app build (rename `build:app` → `build`)
   - Update `test:landing` to point tests at the new locations

3. Build output: `dist/` (single directory, not `dist/app/`).

4. Add a post-build step: `cp dist/index.html dist/404.html`. This is the GitHub Pages SPA routing trick — any path that doesn't match a file serves `404.html`, which bootstraps the React app and the client-side router takes over.

5. GitHub Actions deploy workflow:
   ```yaml
   - run: bun run build
   - run: cp dist/index.html dist/404.html
   - uses: peaceiris/actions-gh-pages@v4
     with:
       github_token: ${{ secrets.GITHUB_TOKEN }}
       publish_dir: ./dist
       cname: bindersnap.com
   ```

6. Update DNS: point `bindersnap.com` to GitHub Pages (if not already). Remove the `app.bindersnap.com` subdomain since it's no longer needed.

7. Remove from Terraform (or skip building):
   - `infra/spa/` module (S3 + CloudFront) — never built, but was planned
   - CI module references to S3 sync and CloudFront invalidation
   - The SPA-related variables in `infra/ci/oidc.tf` (`spa_bucket_name`, `cloudfront_distribution_id`)

### Phase 5: Update the API CORS and cookie domain

**Goal:** API accepts requests from the new origin.

1. `BINDERSNAP_APP_ORIGIN` changes from `https://app.bindersnap.com` to `https://bindersnap.com`.
2. Update in SSM Parameter Store (or add as a new parameter).
3. Cookie `Domain` should be `bindersnap.com` (or omitted — the browser defaults to the origin that set it, which is `api.bindersnap.com`; cross-domain cookies need `Domain=.bindersnap.com` and `SameSite=None; Secure`).
4. Verify CORS preflight works: the SPA at `bindersnap.com` calling `api.bindersnap.com` is cross-origin. The API's CORS config must allow the new origin with `credentials: true`.

**This is the one part that needs careful testing.** Cross-origin cookies with `SameSite` and `Secure` flags have browser-specific quirks. Test in Chrome, Firefox, and Safari before shipping.

---

## Out of Scope

- SSR / ISR — not needed. Pre-rendered HTML + client hydration is sufficient.
- Content management for the landing page — it's still hand-authored HTML.
- A/B testing on the landing page — not at 10 customers.
- Moving the editor demo to a web component — the current React embed is fine.

---

## Acceptance Criteria

- [ ] `curl https://bindersnap.com` returns HTML with full landing page content (no JS required to see it)
- [ ] Unauthenticated user at `/` sees the landing page with working scroll animations and editor demo
- [ ] Authenticated user at `/` sees their workspace
- [ ] All existing app routes (`/login`, `/docs/*`, `/inbox`, `/activity`) work unchanged
- [ ] Deep links work: `bindersnap.com/docs/alice/my-doc` loads the SPA and routes correctly
- [ ] "Remember me" keeps users logged in for 30 days across browser restarts
- [ ] Lighthouse SEO score on `/` is ≥ 90 (landing content is in the static HTML)
- [ ] `apps/landing/` directory is deleted; one build produces one artifact
- [ ] GitHub Actions deploys to GitHub Pages on push to main
- [ ] S3/CloudFront references removed from Terraform CI module
- [ ] Cross-origin cookies work in Chrome, Firefox, Safari

---

## Risk / Gotchas

1. **Cross-origin cookies (Phase 5)** — the SPA at `bindersnap.com` calling `api.bindersnap.com` requires `SameSite=None; Secure; Domain=.bindersnap.com` on the cookie. Safari has stricter third-party cookie blocking. Test early.

2. **Flash of landing content for logged-in users** — the pre-rendered landing HTML is visible until React mounts and hides it. Mitigation: add a `<style>#landing-content { opacity: 0; transition: opacity 0.2s; }</style>` that the vanilla JS removes after checking for a session cookie client-side (not the API call — just the cookie existence check, which is instant).

3. **Landing page CSS conflicts** — the landing page has its own styles (inline in the HTML). When merged into the app shell, these may collide with app styles. Namespace landing styles under `#landing-content` or use a CSS layer.

4. **Bundle size** — lazy-load the landing page's editor demo and the app's workspace independently. Neither should be in the other's critical path.
