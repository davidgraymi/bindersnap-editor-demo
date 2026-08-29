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
├── deploy/                         ← CONFIGURATION AS CODE (pyinfra push deploy)
│   ├── deploy.py                   ← The production deployment itself
│   ├── inventory.py                ← Single prod host + SSH-over-SSM connection
│   ├── files/                      ← Runtime config uploaded to the host
│   ├── bin/ssm-connect.sh          ← Ephemeral key + SSM tunnel, then pyinfra
│   └── README.md                   ← Read before touching production config
│
├── infra/                          ← INFRASTRUCTURE AS CODE (Terraform only)
│   ├── compute/                    ← EC2 Terraform for the app host
│   ├── backups/                    ← DLM snapshot policy
│   ├── ci/                         ← GitHub Actions OIDC role
│   ├── secrets/                    ← AWS Secrets Manager
│   ├── state/                      ← Terraform remote state
│   └── monitoring/                 ← CloudWatch / alerting
│
├── packages/                       ← Shared internal libraries
│   ├── editor/                     ← Tiptap editor component (shared by landing + app)
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
├── .github/workflows/              ← CI/CD pipelines (pages.yml, deploy-pyinfra.yml)
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
- `/docs/:owner/:repo/changes` — open and closed change requests
- `/docs/:owner/:repo/changes/:number` — one change: its discussion and decision
- `/docs/:owner/:repo/changes/:number/preview` — the file that change proposes
- `/docs/:owner/:repo/changes/:number/compare` — that file against the version
  it replaces, rendered with the additions and deletions marked
- `/docs/:owner/:repo/collaborators` — collaborator management
- `/activity` — audit log (`/inbox` was folded into `/`, which now lists the
  change requests the reader is part of)

### The shared editor

`packages/editor/` is imported by the SPA.

If you change anything in `packages/editor/` that affects visual appearance, note it
in your PR description. The landing page no longer embeds the editor, so there is
nothing to re-sync — but the editor is still the authoring surface inside the app.

### The change comparison

`apps/app/components/DocumentComparison.tsx` renders a change against the
version it replaces for every file type the app previews. What it compares and
what it says about it lives in `apps/app/documentComparison.ts`, so both are
testable without a browser.

The comparison is built on libraries, not hand-rolled: `diff` for word-level
text, `node-htmldiff` for diffing two rendered documents as markup,
`pdfjs-dist` for the words inside a PDF, and `mammoth` for the contents of a
Word file. Everything runs in the browser — there is no conversion service and
no binary on the API host, and nothing is uploaded anywhere to be rendered.
Both heavy libraries are imported on demand and code-split, so a reader who
never opens a PDF or a Word document never downloads them. pdf.js runs on the
main thread via `globalThis.pdfjsWorker`, so there is no worker URL to get
wrong in a subdirectory deploy.

Markdown, Word files and PDFs all end up on the same path: render both
versions to HTML, diff the markup, sanitize. That is what makes the answer a
readable policy with the change marked inside it rather than two columns of
source. A PDF carries no headings — only glyphs at coordinates — so
`apps/app/pdfText.ts` recovers the structure from the page itself: lines from
baselines, paragraphs from the vertical gaps between them, headings from type
size and face relative to whatever the body of _that_ document is set in.
Without that step a policy's title, its first heading and its opening sentence
run together into one line.

Two images are compared by eye instead: side by side, or stacked with
`mix-blend-mode: difference`.

`.docx` renders; a legacy `.doc` does not, and neither do `.xlsx` or `.pptx`.
Those keep the honest card that names the file type and offers both versions
to download. Converting them would mean a conversion service on the backend —
deliberately not built, because everything above covers the documents the ICP
actually keeps a policy manual in.

Added text is green and removed text is coral, and both carry an underline or
a strike as well as a colour, so the comparison still reads without one.

### The BFF (`services/api`)

All browser-to-data calls go through the BFF. The browser never contacts Gitea
directly.

- `POST /auth/signup` — create Gitea account + session
- `POST /auth/login` — authenticate + set `HttpOnly` session cookie
- `POST /auth/logout` — revoke session + Gitea token
- `GET /auth/me` — return current session user + a Gitea token for the client
- `GET /api/app/documents` — list workspace repos with PR state
- `GET /api/app/documents/search` — one page of quick-find matches (repo rows only)
- `POST /api/app/documents` — create repo + upload initial file
- `GET /api/app/documents/:owner/:repo` — document detail
- `GET /api/app/documents/:owner/:repo/changes/closed` — closed changes with how each ended
- `POST /api/app/documents/:owner/:repo/versions` — upload new version
- `POST /api/app/documents/:owner/:repo/pull-requests/:n/reviews` — submit review
- `PUT /api/app/documents/:owner/:repo/pull-requests/:n/assignments` — set the assignee and reviewers
- `GET/POST /api/app/documents/:owner/:repo/pull-requests/:n/discussions` — review threads
- `POST /api/app/documents/:owner/:repo/pull-requests/:n/discussions/:threadId/comments` — reply
- `POST /api/app/documents/:owner/:repo/pull-requests/:n/discussions/:threadId/resolve` — resolve/unresolve
- `PUT /api/app/documents/:owner/:repo/pull-requests/:n/discussions/:threadId/comments/:commentId/reactions` — leave or take back a reaction
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
demo users and documents automatically from `tests/seed-data/dev.yaml` — which
carries the same clinic policy as a Word file, a PDF, and a Markdown file, so
the preview and comparison screens can be checked against every file type the
app meets. Use this to:

- Verify Gitea service implementations against a real API
- Run integration tests (`bun run test:integration`)
- See how the real app looks with realistic data

See `tests/README.md` for full usage.

### Deployment

Everything except the SPA runs as Docker Compose services on **one EC2 host**,
deployed by **pushing with pyinfra** from GitHub Actions. There is no serverless
stack: Lambda, Aurora, API Gateway and the Gitea-as-NAT plumbing were removed
(epic #302). See `docs/adr/0003-single-ec2-host-pyinfra-push-deploys.md`.

| Component  | Host           | How deployed                                                          |
| ---------- | -------------- | --------------------------------------------------------------------- |
| SPA        | GitHub Pages   | `pages.yml` on push to `main`                                         |
| API        | EC2 via Docker | `deploy-pyinfra.yml` (pyinfra over SSH-through-SSM) on push to `main` |
| Gitea      | Same EC2 host  | `docker-compose.prod.yml`, same pyinfra run                           |
| Hocuspocus | Same EC2 host  | `docker-compose.prod.yml`, same pyinfra run                           |
| Caddy      | Same EC2 host  | `docker-compose.prod.yml`, same pyinfra run                           |

The SPA is built with `BUN_PUBLIC_API_BASE_URL=https://api.bindersnap.com`
baked in at compile time. Locally, this is `http://localhost:8787`.

**How a production deploy runs.** On every push to `main`,
`deploy-pyinfra.yml` runs the unit suites, builds and pushes
`ghcr.io/davidgraymi/bindersnap-api:<sha>`, assumes the OIDC deploy role, then
runs `deploy/bin/ssm-connect.sh`. That script resolves the instance by tag,
pushes a ~60-second ephemeral key with EC2 Instance Connect, tunnels SSH through
`aws ssm start-session`, and runs `pyinfra deploy/inventory.py deploy/deploy.py`.
**There is no inbound port 22 and no long-lived key material anywhere in this
path.** `deploy.py` is idempotent: it installs Docker, mounts the EBS volume,
uploads `deploy/files/`, renders `/opt/bindersnap/.env.prod` from SSM Parameter
Store, and force-recreates the stack only when config or secrets actually
changed.

Rollback is `git revert` on `main` (the deploy re-applies the prior stack), or a
`workflow_dispatch` run with an explicit `api_tag`. Each deploy pins `API_TAG`
to the deployed commit's SHA — never mutable `:latest`.

**Terraform provisions; pyinfra configures.** These do not overlap:

- Anything about the _host's contents_ — packages, config files, secrets,
  containers, the CloudWatch agent — belongs in `deploy/`. Adding a config file
  is a commit to `deploy/files/`, not an infrastructure change.
- Anything about _AWS resources_ — instance, volumes, IAM, networking, backups,
  monitoring, Parameter Store — belongs in `infra/`.
- `infra/compute/user-data.sh` does exactly one thing: confirm the SSM agent is
  running. Do not add bootstrap logic to it, and do not reintroduce a config
  bucket. If you find yourself editing Terraform to change how the app is
  configured, you are in the wrong directory.

Read `deploy/README.md` before changing anything under `deploy/`, and
`docs/ops/deploy.md` for the pipeline, required GitHub variables, and rollback.
`docs/ops/break-glass.md` covers recovering the host over SSM when CI is
unavailable.

---

## Architecture Decisions — Read Before Writing Any Code

These are settled, non-negotiable decisions. Do not reopen them. Do not work
around them. If a task seems to require violating one of these, stop and create
a `human-needed` issue instead.

### The BFF owns auth; Gitea tokens never reach the browser as cookies.

`services/api` handles login and signup. It mints a per-user Gitea token at
login time, stores it in its SQLite session store, and sets an `HttpOnly`
`bindersnap_session` cookie on the browser. The primary auth path is always the session cookie.
No bearer tokens in cookies. No Gitea credentials in `sessionStorage` or `localStorage`.

### All data lives in Gitea. No secondary database.

Documents, versions, approvals, comments, and audit trail are all stored as
first-class Gitea primitives: repos, branches, commits, pull requests, reviews,
tags, and issue comments. There is no app-managed database, no metadata JSON
file, and no shadow state outside of Gitea. The only exception is the BFF's
SQLite session store, which holds only session → Gitea token mappings.

The consequence: reading app state means calling the Gitea API. This is
intentional. Do not introduce a local cache, a Postgres instance, or any
persistence layer that duplicates Gitea state.

**Review threads** follow the same rule. Gitea has no thread primitive (its
review comments are anchored to a file path and line, which is meaningless for
a binary .docx), so threads are modelled as pull-request issue comments
carrying a trailing `<!-- bindersnap:v1 ... -->` marker. Resolution is an
**append-only event log** — resolving posts a new comment rather than editing
the root — because an audit product must never lose the history of who
reopened a concern. See `services/api/gitea-client/discussions.ts`.

**Reactions** on review comments are Gitea comment reactions, nothing more.
The vocabulary is five keys — `+1`, `-1`, `confused`, `eyes`, `heart` — all
inside Gitea's default allow-list, so no Gitea config change is involved. A
reaction is deliberately not part of the approval record: it never counts
toward `unresolvedCount`, never gates publishing, and never stands in for a
review. It exists so that agreeing with a concern costs the record nothing
instead of a fourth comment reading "+1". See
`services/api/gitea-client/reactions.ts`.

**Change assignments** follow the rule too. A change's assignee is the pull
request's Gitea assignee and its reviewers are Gitea review requests, so who a
change is waiting on is part of the same record as the reviews themselves. The
reviewer states the UI shows are derived from those two facts plus the reviews
(`services/api/change-assignments.ts`) — nothing about an assignment is stored
outside Gitea.

**Per-document review policy** lives in `.bindersnap/config.json` on a
dedicated `bindersnap-config` branch (`reviewSettings.ts`), so policy changes
are commits with an author and a timestamp. It is a side branch because `main`
is protected with `enable_push: false` on every document repo. The companion
"reset approvals on a new version" setting maps onto Gitea's native
`dismiss_stale_approvals` branch protection flag and lives there instead, so
Gitea enforces it during merge.

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

### Production is one EC2 host, deployed by pushing with pyinfra.

No serverless. The backend is a Docker Compose stack on a single EC2 instance,
and `deploy/` is the only thing that configures it. Do not add a Lambda, an
Aurora cluster, an API Gateway, a config bucket, or a bootstrap script to
Terraform user-data. Do not add a pull agent to the host. Deployment logic goes
in `deploy/deploy.py`, in Python, in version control.

See `docs/adr/0003-single-ec2-host-pyinfra-push-deploys.md`. Note that
`docs/adr/0002-mvp-backend-aws-s3-dynamodb-cognito.md` describes an
AWS-native backend that was **reversed** — it is history, not guidance.

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

2. **Coral is the hero, not the chorus.** Use `--brand-coral` for exactly ONE
   primary action or emphasis element per section. When everything is coral,
   nothing is.

3. **Paper over white.** The default background is `--bs-page-bg` (`#FAFAF7`),
   not pure `#FFFFFF`. White is reserved for card interiors only.

---

## Design System Files

The complete token system and social media guidelines live in two files. Always
reference these before writing any styles or generating any visual assets:

- **CSS tokens:** [`packages/ui-tokens/css/bindersnap-tokens.css`](packages/ui-tokens/css/bindersnap-tokens.css)
- **Social media & brand cheat sheet:** [`docs/bindersnap-social-cheatsheet.html`](docs/bindersnap-social-cheatsheet.html)
- **Open design system work:** [`docs/design/design-system-audit.md`](docs/design/design-system-audit.md)

### `packages/ui-tokens/css/bindersnap-tokens.css`

This is the single source of truth for all visual values. Import it once at the
root of your stylesheet. **Never hardcode hex values or pixel sizes in component
files** — always use the CSS variables defined here.

The token system has two layers:

- **`--bs-*` semantic tokens** — what components use. They flip in dark mode
  (`--bs-page-bg`, `--bs-surface-1`…`--bs-surface-3`, `--bs-text-primary`,
  `--bs-text-secondary`, `--bs-text-muted`, `--bs-text-faint`, `--bs-rule`,
  `--bs-rule-warm`, `--bs-shadow-sm`…`--bs-shadow-xl`, `--bs-coral-dim`,
  `--bs-coral-glow`, `--bs-coral-text`, `--bs-cta-fill`,
  `--bs-cta-fill-hover`, `--bs-green-dim`, `--bs-status-warn-*`,
  `--bs-status-info-*`, `--bs-status-danger-*`, `--bs-status-ok-*`,
  `--bs-coral-border`, `--bs-coral-border-soft`, `--bs-green-border`,
  `--bs-green-border-soft`).
- **`--brand-*` fixed tokens** — never change between modes
  (`--brand-coral`, `--brand-coral-dark`, `--brand-green`,
  `--brand-font-serif`, `--brand-font-sans`, `--brand-font-mono`,
  `--brand-text-*` type scale, `--brand-space-*` spacing scale,
  `--brand-radius-*`, `--brand-shadow-coral`, `--brand-transition-*`,
  `--brand-z-*`, plus a small set of intentionally-fixed values —
  `--brand-ink`, `--brand-on-brand`, `--brand-scrim*`, `--brand-mockup-*`,
  `--brand-mac-*` — for sections and mockups that stay the same regardless
  of theme).

**Rule: components always reference `--bs-*` semantic tokens. Never
reference `--brand-*` directly in component styles unless the value is
intentionally fixed across modes** (e.g. the chaos strip is always dark
ink, the email-thread mockup is always a light UI).

Key token categories, using the real names as defined in the token file:

```css
/* Semantic surfaces / text / borders (--bs-*, flip with theme) */
--bs-page-bg, --bs-surface-1, --bs-surface-2, --bs-surface-3, --bs-nav-bg
--bs-text-primary, --bs-text-secondary, --bs-text-muted, --bs-text-faint
--bs-rule, --bs-rule-warm

/* Coral that has to stay legible in both themes (--bs-*, flip with theme) */
--bs-cta-fill, --bs-cta-fill-hover   /* filled primary button       */
--bs-coral-text                      /* coral labels, links, emphasis */

/* Semantic status ramp (--bs-*, flip with theme) */
--bs-status-warn-fg, --bs-status-warn-bg, --bs-status-warn-border      /* needs review        */
--bs-status-info-fg, --bs-status-info-bg, --bs-status-info-border      /* waiting             */
--bs-status-danger-fg, --bs-status-danger-bg, --bs-status-danger-border /* changes / declined */
--bs-status-ok-fg, --bs-status-ok-bg, --bs-status-ok-border            /* approved            */

/* Fixed brand colors (--brand-*, never flip) */
--brand-coral, --brand-coral-dark, --brand-coral-mid
--brand-green, --brand-green-dim
--brand-ink                          /* chaos strip / footer fill   */
--brand-on-brand                     /* text/icon on a solid fill   */

/* Typography (--brand-*) */
--brand-font-serif    /* 'Lora' — headlines only */
--brand-font-sans     /* 'Geist' — body and UI */
--brand-font-mono     /* 'Geist Mono' — labels, code, metadata */

/* Type scale (--brand-*) */
--brand-text-h1, --brand-text-h2, --brand-text-h3
--brand-text-body-lg, --brand-text-body, --brand-text-sm, --brand-text-xs
--brand-text-label
--brand-text-ui-xs, --brand-text-ui-sm, --brand-text-ui-md  /* dense UI */

/* Spacing (--brand-*, base-8 with three sub-8 steps for dense UI) */
--brand-space-1, --brand-space-2, --brand-space-3, --brand-space-4,
--brand-space-5, --brand-space-6, --brand-space-8, --brand-space-10,
--brand-space-12, --brand-space-16, --brand-space-20, --brand-space-24,
--brand-space-30
--brand-space-0-5, --brand-space-1-5, --brand-space-2-5

/* Border radius (--brand-*) */
--brand-radius-xs, --brand-radius-sm, --brand-radius-md, --brand-radius-lg,
--brand-radius-xl, --brand-radius-2xl, --brand-radius-full

/* Shadows */
--bs-shadow-sm, --bs-shadow-md, --bs-shadow-lg, --bs-shadow-xl  /* flip with theme */
--brand-shadow-coral                                            /* fixed */
--bs-elevation-card, --bs-elevation-menu, --bs-elevation-modal   /* named by role */

/* Transitions (--brand-*) */
--brand-transition-fast (0.15s), --brand-transition-base (0.2s)
--brand-transition-slow (0.3s), --brand-transition-reveal (0.7s)

/* Icons (--brand-*) */
--brand-icon-xs, --brand-icon-sm, --brand-icon-md, --brand-icon-lg
--brand-icon-stroke, --brand-icon-stroke-heavy
```

The file also includes pre-built utility classes for common patterns:
`.bs-btn` (`.bs-btn-primary`, `.bs-btn-secondary`, `.bs-btn-dark`, size and
danger modifiers), `.bs-card`, `.bs-input`, `.bs-eyebrow`, `.bs-label`,
`.bs-status` (tone modifiers). The landing page's own primitives — the email
capture row, the reveal-on-scroll animation, the comparison table row — live
in `apps/app/landing.css` instead; see Component Patterns below.

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

**Coral (`--brand-coral`, `#E85D26`):**
Used for CTAs, the top-border reveal on hover cards, section eyebrow labels,
waitlist badges, form focus rings, and key emphasis. Maximum one coral element
per section. Never use coral decoratively.

White on `--brand-coral` measures 3.49:1 and fails WCAG AA. That constrains
every coral filled button, and the fix depends on what the label is:

- **Landing CTAs** (hero, closing, nav) fill with `--brand-coral` and set the
  label in `--brand-on-coral` — ink, 5.02:1. This keeps the page's buttons the
  exact colour of the hero's _approved._ On hover the fill darkens to
  `--brand-coral-dark` and the label flips to `--brand-on-brand` (4.61:1).
- **White-label buttons** (in-app primaries, where an ink label would read as
  disabled in dense UI) fill with `--bs-cta-fill` / `--bs-cta-fill-hover` —
  the coral hue at full chroma, dropped in lightness until white clears 4.5:1.

Never fill a button with `--brand-coral` and put white on it.

**Ink (`--bs-text-primary`, `#1C1917` in light mode):**
Primary text color. Dark backgrounds that are intentionally fixed regardless
of theme (nav bar in some contexts, the chaos strip, the footer) use
`--brand-ink`. Not pure black — this is a warm charcoal.

**Paper (`--bs-page-bg`, `#FAFAF7` in light mode):**
Default page background. Never use `#FFFFFF` as a page background. White is
reserved for card and input interiors only (`--bs-surface-1`).

**Paper Warm (`--bs-surface-2`, `#F5F0E8` in light mode):**
Alternating section backgrounds, card backgrounds, tag fills.

**Muted (`--bs-text-muted`) and faint (`--bs-text-faint`):**
`--bs-text-muted` is secondary body text. `--bs-text-faint` is the floor —
placeholders and hints only — never use anything lighter for text that must
be readable.

**Green (`--brand-green`, `#16A34A`):**
Success states, compliance badges, "after" column in comparisons, the live dot
in the nav badge. Not an accent — only use for positive/success semantic meaning.

**Status ramp (`--bs-status-warn-*`, `--bs-status-info-*`,
`--bs-status-danger-*`, `--bs-status-ok-*`):**
Use these — never a hand-picked hex — for anything that isn't plain coral or
green: needs-review (amber), waiting (blue), declined/changes (a coral-adjacent
but distinct hue), approved (green). Each is a `-fg`/`-bg`/`-border` triad and
each flips in dark mode; a literal amber or blue will pass contrast in light
mode and silently fail it in dark mode.

---

## Spacing

Spacing is base-8 from 12px up: use `--brand-space-*` tokens from the CSS file
(4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96, 120px — `--brand-space-1`
through `--brand-space-30`). Below 12px, three sub-8 steps exist for dense UI
(chips, icon rows, table cells): `--brand-space-0-5` (2px), `--brand-space-1-5`
(6px), `--brand-space-2-5` (10px). Use one of these thirteen tokens — never a
raw pixel value. Section vertical padding is `--brand-space-30` (120px) by
default, `--brand-space-24` (96px) for compressed sections.

---

## Border Radius

Each radius value has a specific semantic use. Do not apply them arbitrarily:

| Token                 | Value  | Use                                           |
| --------------------- | ------ | --------------------------------------------- |
| `--brand-radius-xs`   | 2px    | Code blocks, compliance badges, table rows    |
| `--brand-radius-sm`   | 4px    | Tags, pills, small chips                      |
| `--brand-radius-md`   | 8px    | Nav elements, feature icons, small cards      |
| `--brand-radius-lg`   | 12px   | Inputs, form elements, standard cards         |
| `--brand-radius-xl`   | 16px   | Large cards, feature panels, comparison boxes |
| `--brand-radius-2xl`  | 24px   | CTA boxes, hero containers, modal dialogs     |
| `--brand-radius-full` | 9999px | Pills, avatar badges, the nav badge           |

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
`.email-row` pattern from `apps/app/landing.css`: email input + coral button
inside a shared rounded container with a coral focus ring. Form hint text
below in `--brand-font-mono` at `--brand-text-label` size. Always include the
waitlist counter with avatar stack above the form.

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

Add `.reveal` (defined in `apps/app/landing.css`) to any element that should
animate in on scroll. Add `.reveal-d1` through `.reveal-d3` for staggered
delays. The IntersectionObserver that adds `.in` on intersect lives in
`landing-inline.ts`.

### Dark sections

When a section uses `--brand-ink` as the background (the villain/problem
section, footer — always dark, regardless of theme), text uses
`--brand-on-dark-primary`, secondary text uses `--brand-on-dark-secondary`,
and rules use `--brand-on-dark-rule`.

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
2. Components always reference `--bs-*` semantic tokens. Never reference
   `--brand-*` directly in component styles unless the value is
   intentionally fixed across modes — zero hardcoded values
3. Check `docs/bindersnap-social-cheatsheet.html` for exact dimensions before
   generating any image assets or meta tags
4. Default background is always `var(--bs-page-bg)` (`#FAFAF7`), never `#fff`
5. Every new section needs: a `.bs-eyebrow` label, a Lora serif headline, and
   a single clear action — never two competing CTAs
6. Add `.reveal` (from `apps/app/landing.css`) to any block-level element
   introduced below the fold, on marketing pages only

---

## GitHub Agent Workflow Policy

This repository uses either `gh` CLI or an MCP tool.

### Tool mapping

- Read: `issue_read`, `pull_request_read`, `list_issues`, `list_pull_requests`
- Write: `create_branch`, `create_or_update_file`, `create_pull_request`, `update_pull_request`, `add_issue_comment`, `pull_request_review_write`

### Git ownership split

- Use local `git` for working tree operations (edit, stage, commit, diff)
- Use `gh` or MCP for GitHub API operations (issue, branch, PR, comments, reviews)

---

## Production Security Rules

These apply to any changes touching `deploy/`, `deploy/files/docker-compose.prod.yml`, `deploy/files/Caddyfile.prod`, or EC2 deployment:

1. **Never hardcode credentials.** All secrets (`GITEA_ADMIN_PASS`, `GITEA_SECRET_KEY`, `BINDERSNAP_GITEA_SERVICE_TOKEN`, etc.) must come from environment variables in `/opt/bindersnap/.env.prod`, which `deploy.py` renders on every run from `/bindersnap/prod/*` in SSM Parameter Store. The SSM read happens on the control plane and the file is uploaded `0600` — secrets are never written to a control-plane disk file, printed, or committed. Never commit an `.env.prod`; it is in `.gitignore`.
2. **Registration is disabled in prod.** `GITEA__service__DISABLE_REGISTRATION=true` is non-negotiable for production. Dev compose may differ.
3. **`INSTALL_LOCK=true` in prod.** Prevents Gitea setup wizard from re-running after first boot.
4. **Rotate credentials on first deploy.** Generate with `openssl rand -base64 20` for passwords and `openssl rand -base64 32` for secret keys.
5. **Service account token is required in prod.** `BINDERSNAP_GITEA_SERVICE_TOKEN` must be set; the API exits at startup if it is missing in production.

---

## Deterministic MCP Setup

Use one GitHub MCP server configuration path at a time. Avoid mixed auth paths
(for example OAuth + PAT at once) to prevent nondeterministic write failures.
