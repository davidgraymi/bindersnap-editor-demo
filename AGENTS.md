# AGENTS.md — Bindersnap Codebase Guide

This file is for AI agents, LLMs, and automated tools working in this codebase.
It describes what Bindersnap is, how the product is designed, and the rules you
must follow when generating or modifying any code, copy, or assets.

---

## Repo Architecture — Read This First

This is a monorepo containing **one frontend application**, **shared packages**,
**backend services**, and **infrastructure code**. Understanding which directory
serves which purpose is essential before making any changes.

```
bindersnap-editor-demo/
│
├── apps/
│   └── app/                        ← UNIFIED SPA (deployed to GitHub Pages)
│       ├── index.html              ← Pre-rendered landing shell + React mount root
│       ├── App.tsx                 ← Auth gate + routing
│       ├── api.ts                  ← All browser-to-API calls (BFF client)
│       ├── routes.ts               ← Client-side route definitions
│       └── components/             ← App shell, landing page, document UI
│
├── infra/                          ← Infrastructure as code
│   ├── compute/                    ← EC2 Terraform for API host
│   ├── backups/                    ← DLM snapshot policy
│   ├── ci/                         ← GitHub Actions OIDC role
│   ├── secrets/                    ← AWS Secrets Manager
│   ├── state/                      ← Terraform remote state
│   └── monitoring/                 ← CloudWatch / alerting
│
├── packages/                       ← Shared internal libraries
│   ├── editor/                     ← Tiptap editor component (shared by landing + app)
│   │   └── README.md               ← Read before editing
│   ├── gitea-client/               ← All Gitea API interaction
│   │   └── README.md               ← Read before editing
│   ├── ui-tokens/                  ← CSS design tokens, fonts, icons
│   └── utils/                      ← Shared utilities (sanitizer, etc.)
│
├── services/                       ← Deployable backend services
│   ├── api/                        ← Auth + data BFF (Bun, port 8787)
│   │   ├── server.ts               ← HTTP server entry point
│   │   ├── sessions.ts             ← SQLite session store
│   │   └── README.md               ← API env vars and routes
│   └── hocuspocus/                 ← Yjs WebSocket collaboration server
│       ├── server.ts               ← Hocuspocus server entry
│       └── Dockerfile
│
├── tests/                          ← Integration tests (Playwright)
│   └── data/                       ← Seed files for local stack
│
├── scripts/                        ← Build and utility scripts
│   └── bootstrap-gitea-service-account.ts  ← Provisions the service account token
│
├── server.ts                       ← Bun dev/prod server (serves the SPA)
├── docs/                           ← Brand assets and ADRs
├── .github/workflows/              ← CI/CD pipelines (pages.yml, deploy.yml)
├── .claude/                        ← Claude agent definitions
├── AGENTS.md                       ← This file
├── docker-compose.yml              ← Local dev stack (Gitea + Hocuspocus + app)
└── Dockerfile                      ← Dev-only Dockerfile for the app container
```

### The unified SPA

`apps/app/` is a single deployable frontend. It pre-renders a static landing shell
into `index.html`; React swaps to the workspace shell when a valid session is
present. There is no separate `apps/landing/` directory.

Routes:

- `/` — landing page (unauthenticated) or workspace home (authenticated)
- `/login`, `/signup` — credential forms
- `/documents` — document list
- `/docs/:owner/:repo` — document detail and review
- `/docs/:owner/:repo/collaborators` — collaborator management
- `/inbox`, `/activity` — notifications and audit log

### The shared editor

`packages/editor/` is imported by the SPA. The editor is backend-agnostic by
design — it receives a `giteaClient` prop when wired to the real app, and runs
in read-only demo mode when that prop is absent. **Never import from
`packages/gitea-client/` directly inside `packages/editor/`.**

If you change anything in `packages/editor/` that affects visual appearance, note it
in your PR description. The landing page demo embed is a static snapshot and must
be manually updated by running `bun run sync-demo`.

### The BFF (`services/api`)

All browser-to-data calls go through the BFF. The browser never contacts Gitea
directly.

- `POST /auth/signup` — create Gitea account + session
- `POST /auth/login` — authenticate + set `HttpOnly` session cookie
- `POST /auth/logout` — revoke session + Gitea token
- `GET /auth/me` — return current session user + a Gitea token for the client
- `GET /api/app/documents` — list workspace repos with PR state
- `POST /api/app/documents` — create repo + upload initial file
- `GET /api/app/documents/:owner/:repo` — document detail
- `POST /api/app/documents/:owner/:repo/versions` — upload new version
- `POST /api/app/documents/:owner/:repo/pull-requests/:n/reviews` — submit review
- `POST /api/app/documents/:owner/:repo/pull-requests/:n/publish` — merge + tag
- `GET /api/app/documents/:owner/:repo/download` — proxy file download
- `GET/PUT/DELETE /api/app/documents/:owner/:repo/collaborators/:user` — manage access
- `GET /api/app/users/search` — user search

Per-session Gitea tokens are stored server-side in a SQLite session store
(`services/api/sessions.ts`). The browser holds only the `bindersnap_session`
`HttpOnly` cookie. After login, `/auth/me` also returns the token to the client
for storage in `sessionStorage` as a runtime cache — but the session cookie is
the source of truth.

### The integration testing stack

`docker-compose.yml` runs Gitea + Hocuspocus locally. `docker compose up` seeds
demo users and documents automatically. Use this to:

- Verify Gitea service implementations against a real API
- Run integration tests (`bun run test:integration`)
- See how the real app looks with realistic data

See `tests/README.md` for full usage.

### Deployment

| Component  | Host           | How deployed                         |
| ---------- | -------------- | ------------------------------------ |
| SPA        | GitHub Pages   | `pages.yml` on push to `main`        |
| API        | EC2 via Docker | `deploy.yml` via AWS SSM on tag push |
| Gitea      | Same EC2 host  | `docker-compose.prod.yml`            |
| Hocuspocus | Same EC2 host  | `docker-compose.prod.yml`            |

The SPA is built with `BUN_PUBLIC_API_BASE_URL=https://api.bindersnap.com`
baked in at compile time. Locally, this is `http://localhost:8787`.

---

## Architecture Decisions — Read Before Writing Any Code

These are settled, non-negotiable decisions. Do not reopen them. Do not work
around them. If a task seems to require violating one of these, stop and create
a `human-needed` issue instead.

### The BFF owns auth; Gitea tokens never reach the browser as cookies.

`services/api` handles login and signup. It mints a per-user Gitea token at
login time, stores it in its SQLite session store, and sets an `HttpOnly`
`bindersnap_session` cookie on the browser. The Gitea token is also returned in
the login/me response body so the SPA can cache it in `sessionStorage` for
`gitea-client` calls, but the primary auth path is always the session cookie.
No bearer tokens in cookies. No Gitea credentials in `localStorage`.

### All data lives in Gitea. No secondary database.

Documents, versions, approvals, comments, and audit trail are all stored as
first-class Gitea primitives: repos, branches, commits, pull requests, reviews,
tags, and issue comments. There is no app-managed database, no metadata JSON
file, and no shadow state outside of Gitea. The only exception is the BFF's
SQLite session store, which holds only session → Gitea token mappings.

The consequence: reading app state means calling the Gitea API. This is
intentional. Do not introduce a local cache, a Postgres instance, or any
persistence layer that duplicates Gitea state.

### File uploads flow browser → BFF → Gitea.

The upload flow for the file vault:

1. User selects file
2. SPA validates client-side (size ≤ 25 MiB; any extension allowed)
3. SPA sends multipart form to BFF (`POST /api/app/documents` or `.../versions`)
4. BFF reads the file as base64, commits to Gitea contents API, opens PR

There is no multipart endpoint that bypasses the BFF. The BFF is always the
server that writes to Gitea. File type and size validation happen client-side
before any API call.

See `docs/adr/0001-external-file-workflow-contract.md` for the full
upload/review/publish contract. **That ADR is law for the file vault workflow.**

### The MVP is a document repository, not an editor.

The file vault workflow does not use the inline editor. Users upload files
authored externally (Word, Excel, PDF). Bindersnap provides version control and
approvals on top of those files via Gitea PR primitives.

The inline editor (`packages/editor/`) is a parallel workflow for documents
authored inside Bindersnap. These two workflows are independent. Do not
conflate them.

---

## What is Bindersnap?

Bindersnap is a pre-launch document management SaaS targeting regulated industries
(legal, compliance, healthcare, finance). It replaces the fragmented stack of
Word + email + shared drives with a single collaborative workspace that has a
real, tamper-proof approval trail built in.

**The one-liner:** Kill the email approval chain.

**The problem it solves:** Teams in regulated industries manage document approvals
through reply-all email threads, mismatched file versions, and no clear record of
who signed off on what. The canonical villain is the filename:

```
contract_FINAL_v2_JanEdits_APPROVED(1).docx
```

**The three pillars:**

| Pillar      | Reference                   | What it means                                               |
| ----------- | --------------------------- | ----------------------------------------------------------- |
| Write       | As easy as Word             | Rich document editor, no training needed                    |
| Collaborate | Real-time like Notion       | Live co-editing, inline comments, presence                  |
| Approve     | Version control like GitHub | PR-style diffs, explicit sign-off, locked approved versions |

**The core differentiator:** The audit trail is the product — not a feature. You
cannot modify an approved document without creating a new reviewable version. The
record is always clean, complete, and exportable for regulators.

**Target user (Primary ICP):** Compliance or operations manager at a
regulated-adjacent company. Age 28–45. Non-technical. Currently stitching together
Word + email + a shared drive to run approvals. Has been burned by "which version
did we approve?" at least once. Would pay for a tool that gives a clean audit trail
without IT involvement.

---

## Design Philosophy

The Bindersnap visual identity is **warm, human, and empathy-first** — not
corporate, not cold, not "enterprise software." Every design decision flows from
a single principle:

> _If it doesn't feel like it was built by someone who lived the problem, rebuild it._

**Three design rules to internalize before touching anything:**

1. **Empathy before product.** Lead with the pain, not the feature. The hero of
   any page is the problem the user recognizes — the product is the resolution.

2. **Coral is the hero, not the chorus.** Use `--color-coral` for exactly ONE
   primary action or emphasis element per section. When everything is coral,
   nothing is.

3. **Paper over white.** The default background is `--color-paper` (`#FAFAF7`),
   not pure `#FFFFFF`. White is reserved for card interiors only.

---

## Design System Files

The complete token system and social media guidelines live in two files. Always
reference these before writing any styles or generating any visual assets:

- **CSS tokens:** [`packages/ui-tokens/css/bindersnap-tokens.css`](packages/ui-tokens/css/bindersnap-tokens.css)
- **Social media & brand cheat sheet:** [`docs/bindersnap-social-cheatsheet.html`](docs/bindersnap-social-cheatsheet.html)

### `packages/ui-tokens/css/bindersnap-tokens.css`

This is the single source of truth for all visual values. Import it once at the
root of your stylesheet. **Never hardcode hex values or pixel sizes in component
files** — always use the CSS variables defined here.

Key token categories:

```css
/* Colors */
--color-coral, --color-coral-dark, --color-coral-dim, --color-coral-glow
--color-ink, --color-ink-mid, --color-ink-soft
--color-paper, --color-paper-warm, --color-paper-mid
--color-muted, --color-muted-light, --color-rule
--color-green, --color-green-dim

/* Typography */
--font-serif    /* 'Lora' — headlines only */
--font-sans     /* 'Geist' — body and UI */
--font-mono     /* 'Geist Mono' — labels, code, metadata */

/* Type scale */
--text-display, --text-h1, --text-h2, --text-h3
--text-body-lg, --text-body, --text-sm, --text-xs, --text-label

/* Spacing (base-8 system) */
--space-1 through --space-24

/* Border radius */
--radius-xs (2px) through --radius-2xl (24px), --radius-full

/* Shadows */
--shadow-sm, --shadow-md, --shadow-lg, --shadow-xl, --shadow-coral

/* Transitions */
--transition-fast (0.15s), --transition-base (0.2s), --transition-slow (0.3s)
--transition-reveal (0.7s)  /* scroll-reveal animations */
```

The file also includes pre-built utility classes for common patterns:
`.bs-btn-primary`, `.bs-btn-secondary`, `.bs-btn-dark`, `.bs-card`,
`.bs-input`, `.bs-email-row`, `.bs-eyebrow`, `.bs-pill`, `.bs-file-chip`,
`.bs-reveal` / `.bs-in` (scroll reveal).

---

## Typography Rules

Typography is non-negotiable. The three-font stack is intentional and each font
has an exclusive job:

| Font           | Role                                                           | Rule                                                                                      |
| -------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Lora**       | All headlines (H1–H3), pull quotes, display text               | Warm, literary, serif. Use Bold or SemiBold. Italic for `<em>` accent phrases in coral.   |
| **Geist**      | All body copy, UI labels, buttons, navigation                  | Clean, modern. Light (300) for hero subtext, Regular (400) for body, Medium (500) for UI. |
| **Geist Mono** | Section eyebrow tags, code, filenames, timestamps, data labels | Fixed-width, technical. Always uppercase + wide letter-spacing for section labels.        |

**Never mix fonts within a heading level.** Never use Lora for body copy. Never
use Geist for a main headline.

---

## Color Usage Rules

Reference `packages/ui-tokens/css/bindersnap-tokens.css` for all values.

**Coral (`--color-coral`, `#E85D26`):**
Used for CTAs, the top-border reveal on hover cards, section eyebrow labels,
waitlist badges, form focus rings, and key emphasis. Maximum one coral element
per section. Never use coral decoratively.

**Ink (`--color-ink`, `#1C1917`):**
Primary text color, dark backgrounds (nav bar, dark sections, footer). Not pure
black — this is a warm charcoal.

**Paper (`--color-paper`, `#FAFAF7`):**
Default page background. Never use `#FFFFFF` as a page background. White is
reserved for card and input interiors only.

**Paper Warm (`--color-paper-warm`, `#F5F0E8`):**
Alternating section backgrounds, card backgrounds, tag fills.

**Muted (`--color-muted`, `#78716C`):**
Secondary body text. Never use color lighter than `--color-muted-light`
(`#A8A29E`) for any text that must be readable.

**Green (`--color-green`, `#16A34A`):**
Success states, compliance badges, "after" column in comparisons, the live dot
in the nav badge. Not an accent — only use for positive/success semantic meaning.

---

## Spacing

All spacing is on a base-8 system. Use `--space-*` tokens from the CSS file.
Never introduce a spacing value that isn't on the scale (4, 8, 12, 16, 20, 24,
32, 40, 48, 64, 80, 96, 120px). Section vertical padding is `--space-30`
(120px) by default, `--space-24` (96px) for compressed sections.

---

## Border Radius

Each radius value has a specific semantic use. Do not apply them arbitrarily:

| Token           | Value  | Use                                           |
| --------------- | ------ | --------------------------------------------- |
| `--radius-xs`   | 2px    | Code blocks, compliance badges, table rows    |
| `--radius-sm`   | 4px    | Tags, pills, small chips                      |
| `--radius-md`   | 8px    | Nav elements, feature icons, small cards      |
| `--radius-lg`   | 12px   | Inputs, form elements, standard cards         |
| `--radius-xl`   | 16px   | Large cards, feature panels, comparison boxes |
| `--radius-2xl`  | 24px   | CTA boxes, hero containers, modal dialogs     |
| `--radius-full` | 9999px | Pills, avatar badges, the nav badge           |

---

## Voice & Copy

When generating any copy — marketing text, UI labels, error messages,
documentation, email subjects — follow these rules:

**Do:**

- Lead with the pain before the product
- Use short, active sentences
- Be direct: make claims you can back up, don't hedge with "may" or "might"
- Use the document chaos as a hook when relevant: `contract_FINAL_v2_JanEdits_APPROVED(1).docx`
- Keep UI copy warm and human — write as if a helpful colleague wrote it

**Don't:**

- Use enterprise jargon: leverage, synergize, paradigm, ecosystem, streamline
- Bury the value proposition behind feature descriptions
- Use passive voice for anything action-oriented
- Write anything that sounds like it came from a compliance manual

**Proven headline formulas:**

```
Pain → Resolution:  "Your approval process is a mess. We fixed it."
Enemy → Hero:       "Kill the email approval chain. Finally."
Question hook:      "Wait — which version did we actually sign off on?"
Before/After:       "From reply-all chaos to a clean audit trail — in one tool."
```

---

## Component Patterns

### Email capture form

The primary conversion element on every marketing page. Always use the
`.bs-email-row` pattern from the token file: email input + coral button inside
a shared rounded container with a coral focus ring. Form hint text below in
`--font-mono` at `--text-label` size. Always include the waitlist counter with
avatar stack above the form.

### Section eyebrow label

Every section opens with a mono label in coral with flanking line decorations:

```html
<div class="bs-eyebrow">The Solution</div>
```

### Card hover pattern

Feature cards use `.bs-card`. On hover: translate up 4px, elevate shadow,
border becomes transparent, and a 3px coral top border scales in from the left
via `scaleX`. Never apply this pattern to non-interactive content.

### Scroll reveal

Add `.bs-reveal` to any element that should animate in on scroll. Add
`.bs-reveal-d1` through `.bs-reveal-d4` for staggered delays. Initialize with
the IntersectionObserver snippet in the token file's comments.

### Dark sections

When a section uses `--color-ink` as the background (the villain/problem
section, footer), text uses `#F5F0E8` (paper cream), secondary text uses
`rgba(245,240,232,0.6)`, and rules use `rgba(255,255,255,0.08)`.

---

## What Bindersnap Is NOT

Agents should never frame Bindersnap as any of the following:

- An "AI-powered" tool (we don't lead with AI)
- "Enterprise software" (we're bottom-up, team-first)
- A competitor to DocuSign (we're upstream — the writing and collaboration layer)
- A project management tool (we're document-specific)
- A replacement for Word (we're an upgrade to the approval workflow around documents)

The positioning is: **the only document tool where the approval trail is the
product, not a plugin.**

---

## File Conventions

When generating new pages, components, or templates:

1. Import `packages/ui-tokens/css/bindersnap-tokens.css` before any other stylesheet
2. Use `--color-*`, `--font-*`, `--space-*`, `--radius-*`, `--shadow-*`
   variables throughout — zero hardcoded values
3. Check `docs/bindersnap-social-cheatsheet.html` for exact dimensions before
   generating any image assets or meta tags
4. Default background is always `var(--color-paper)` (`#FAFAF7`), never `#fff`
5. Every new section needs: a `.bs-eyebrow` label, a Lora serif headline, and
   a single clear action — never two competing CTAs
6. Add `.bs-reveal` to any block-level element introduced below the fold

---

## GitHub Agent Workflow Policy

This repository uses a strict MCP-first workflow for all GitHub API actions.
Agents must follow this policy exactly.

### Tool mapping

- Read: `issue_read`, `pull_request_read`, `list_issues`, `list_pull_requests`
- Write: `create_branch`, `create_or_update_file`, `create_pull_request`, `update_pull_request`, `add_issue_comment`, `pull_request_review_write`

Every PR must include workflow evidence (issue read method, branch creation method, commit SHA, PR creation method, any fallbacks used).

### Allowed fallback

`gh` CLI is fallback-only. Use it only if:

- The required MCP tool is unavailable, or
- The MCP call fails for a non-user-actionable reason

When fallback is used, document the MCP tool name, the exact failure message, and the `gh` command used as fallback.

### Git ownership split

- Use local `git` for working tree operations (edit, stage, commit, diff)
- Use MCP for GitHub API operations (issue, branch, PR, comments, reviews)

---

## Production Security Rules

These apply to any changes touching `docker-compose.prod.yml`, `Caddyfile.prod`, or EC2 deployment:

1. **Never hardcode credentials.** All secrets (`GITEA_ADMIN_PASS`, `GITEA_SECRET_KEY`, `BINDERSNAP_GITEA_SERVICE_TOKEN`, etc.) must come from environment variables, loaded from `.env.prod` on the server. `.env.prod` is in `.gitignore` and must never be committed.
2. **Registration is disabled in prod.** `GITEA__service__DISABLE_REGISTRATION=true` is non-negotiable for production. Dev compose may differ.
3. **`INSTALL_LOCK=true` in prod.** Prevents Gitea setup wizard from re-running after first boot.
4. **Rotate credentials on first deploy.** Generate with `openssl rand -base64 20` for passwords and `openssl rand -base64 32` for secret keys.
5. **Service account token is required in prod.** `BINDERSNAP_GITEA_SERVICE_TOKEN` must be set; the API exits at startup if it is missing in production.

---

## Deterministic MCP Setup

Use one GitHub MCP server configuration path at a time. Avoid mixed auth paths
(for example OAuth + PAT at once) to prevent nondeterministic write failures.
