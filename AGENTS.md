# AGENTS.md — Bindersnap Codebase Guide

This file is for AI agents, LLMs, and automated tools working in this codebase.
It describes what Bindersnap is, how the product is designed, and the rules you
must follow when generating or modifying any code, copy, or assets.

---

## Repo Architecture — Read This First

This is a monorepo containing **two frontend applications**, **shared packages**,
**backend services**, and **infrastructure code**. Understanding which directory
serves which purpose is essential before making any changes.

```
bindersnap-editor-demo/
│
├── apps/                       ← Deployable frontend applications
│   ├── landing/                ← LANDING PAGE (published to GitHub Pages)
│   │   ├── index.html          ← Landing page HTML entry
│   │   ├── App.tsx             ← Landing page root component
│   │   └── frontend.tsx        ← React entry point
│   │
│   └── app/                    ← REAL APP (never published publicly)
│       ├── index.html          ← App HTML entry
│       ├── App.tsx             ← App root (auth + routing)
│       ├── auth/               ← PKCE OAuth2 flow
│       └── components/         ← App shell components
|
├── infra/                      ← Infrastructure as code (placeholder)
│   ├── aws/                    ← Terraform/Pulumi for S3, CloudFront, Fargate
│   └── railway/                ← Gitea provisioning config
│
├── packages/                   ← Shared internal libraries
│   ├── editor/                 ← Tiptap editor component (shared by both apps)
│   │   └── README.md           ← Read before editing
│   ├── gitea-client/           ← All Gitea API interaction
│   │   └── README.md           ← Read before editing
│   ├── ui-tokens/              ← CSS design tokens, fonts, icons
│   └── utils/                  ← Shared utilities (sanitizer, etc.)
│
├── services/                   ← Deployable backend services
│   └── hocuspocus/             ← Yjs WebSocket collaboration server
│       ├── server.ts           ← Hocuspocus server entry
│       └── Dockerfile
│
├── tests/                      ← Integration tests
│   └── data/                   ← Files used to seed services (e.g. documents)
│
├── server.ts                   ← Bun dev/prod server (serves both apps)
├── scripts/                    ← Build and utility scripts
├── docs/                       ← Brand and social media assets
├── .github/workflows/          ← CI/CD pipelines
├── .claude/                    ← Claude agent definitions
├── AGENTS.md                   ← This file
├── docker-compose.yml          ← Gitea + Hocuspocus + app
└── Dockerfile                  ← Dev-only Dockerfile for the app container
```

### The two applications

|                      | Landing Page              | Real App                            |
| -------------------- | ------------------------- | ----------------------------------- |
| **Entry point**      | `apps/landing/index.html` | `apps/app/index.html`               |
| **Published**        | GitHub Pages (`/`)        | Never — local + private deploy only |
| **Auth required**    | No                        | Yes (Gitea token)                   |
| **Gitea dependency** | No                        | Yes                                 |
| **Demo editor**      | Read-only snapshot        | Fully wired                         |

### The shared editor

`packages/editor/` is imported by **both** applications. The editor is backend-agnostic
by design — it receives a `giteaClient` prop when wired to the real app, and
operates in read-only demo mode when that prop is absent. Never import from
`packages/gitea-client/` directly inside `packages/editor/`.

### The integration testing stack

`docker-compose.yml` runs Gitea + Hocuspocus locally. `docker compose up`
seeds demo users and documents automatically. Use this to:

- Verify Gitea service implementations against a real API
- Run integration tests (`bun run test:integration`)
- See how the real app looks with realistic data

See `tests/README.md` for full usage.

### When editor UI changes

If you change anything in `packages/editor/` that affects visual appearance, note it
in your PR description. The landing page demo embed is a static snapshot and
must be manually updated by running `bun run sync-demo`. Do not silently change
the editor UI without flagging this in the PR.

---

## Architecture Decisions — Read Before Writing Any Code

These are settled, non-negotiable decisions. Do not reopen them. Do not work
around them. If a task seems to require violating one of these, stop and create
a `human-needed` issue instead.

### The app is a pure SPA. There is no BFF.

The real app (`apps/app/`) is a static single-page application. It communicates
directly with the Gitea API using the user's PKCE OAuth2 bearer token. There is
no backend-for-frontend, no session server, no API proxy, and no middleware
layer between the browser and Gitea.

**If you find yourself:**

- Writing an Express, Bun, or Hono HTTP server for the app
- Adding a `services/api/` directory
- Storing Gitea tokens in server-side sessions or cookies
- Proxying Gitea API calls through any server

**Stop. You are building the wrong thing.**

The only permitted backend services in this repo are:

- `services/hocuspocus/` — Yjs WebSocket server for real-time collaboration (editor path only)
- A future Pandoc conversion service (backlogged, not MVP — see issue #73)
- A future Stripe webhook handler (see issue #75)

### Authentication is PKCE OAuth2. The browser holds the token.

Auth flow: browser → Gitea OAuth2 authorize → PKCE code exchange → bearer token
stored in memory or `sessionStorage`. The token is attached to every Gitea API
request as `Authorization: Bearer <token>`. No cookies. No server-side sessions.

The `apps/app/auth/` directory owns this flow. `packages/gitea-client/` consumes
the token. Nothing else touches auth.

The security model is deliberate: PKCE without a client secret is the correct
pattern for a public SPA client. The token-in-browser threat model is equivalent
to cookie/session token risk and is acceptable given short token lifetimes and
tight Gitea scopes.

### All data lives in Gitea. No secondary database.

Documents, versions, approvals, comments, and audit trail are all stored as
first-class Gitea primitives: repos, branches, commits, pull requests, reviews,
tags, and issue comments. There is no app-managed database, no metadata JSON
file, and no shadow state outside of Gitea.

The consequence: reading app state means calling the Gitea API. This is
intentional. Do not introduce a local cache, a Postgres instance, or any
persistence layer that duplicates Gitea state.

### File uploads go direct: FileReader → base64 → Gitea contents API.

The upload flow for the file vault is entirely browser-side:

1. User selects file
2. SPA reads it via `FileReader` as base64
3. SPA calls `POST /api/v1/repos/{owner}/{repo}/contents/{path}` with the
   base64 content directly
4. SPA creates the PR

There is no multipart upload endpoint. There is no server that receives the file
first. File type and size validation happen client-side before any API call.

See `docs/adr/0001-external-file-workflow.md` for the full upload/review/publish
contract. **That ADR is law for the file vault workflow.**

### The MVP is a document repository, not an editor.

The file vault workflow (issues #101–#105) does not use the inline editor. Users
upload files authored externally (Word, Excel, PDF). Bindersnap provides version
control and approvals on top of those files via Gitea PR primitives.

The inline editor (`packages/editor/`, issues #71–#72) is a parallel workflow
for documents authored inside Bindersnap. These two workflows are independent.
Do not conflate them.

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

### [`src/assets/css/bindersnap-tokens.css`](src/assets/css/bindersnap-tokens.css)

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

### [`docs/bindersnap-social-cheatsheet.html`](docs/bindersnap-social-cheatsheet.html)

A printable one-page reference for social media assets. Contains:

- Exact pixel dimensions for LinkedIn, Twitter/X, Instagram, and Product Hunt
- Color swatches with hex values
- Copy do's and don'ts with real examples
- Typography quick reference

Open this in a browser and use "Print / Save PDF" to export. Reference it when
generating any social media templates, og:image tags, or marketing assets.

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

Reference [`src/assets/css/bindersnap-tokens.css`](src/assets/css/bindersnap-tokens.css) for all values.

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

1. Import `src/assets/css/bindersnap-tokens.css` before any other stylesheet
2. Use `--color-*`, `--font-*`, `--space-*`, `--radius-*`, `--shadow-*`
   variables throughout — zero hardcoded values
3. Check `docs/bindersnap-social-cheatsheet.html` for exact dimensions before
   generating any image assets or meta tags
4. Default background is always `var(--color-paper)` (`#FAFAF7`), never `#fff`
5. Every new section needs: a `.bs-eyebrow` label, a Lora serif headline, and
   a single clear action — never two competing CTAs
6. Add `.bs-reveal` to any block-level element introduced below the fold

---

## GitHub Agent Workflow Policy (Required)

This repository uses a strict MCP-first workflow for all GitHub API actions.
Agents must follow this policy exactly.

### Required default

For GitHub operations, use GitHub MCP tools first:

- Read issues/PRs: `issue_read`, `pull_request_read`, `list_issues`,
  `list_pull_requests`
- Create branches/files/PRs: `create_branch`, `create_or_update_file`,
  `create_pull_request`
- Update PRs/comments/reviews: `update_pull_request`, `add_issue_comment`,
  `pull_request_review_write`

### Allowed fallback

`gh` CLI is fallback-only. Use it only if:

- The required MCP tool is unavailable, or
- The MCP call fails for a non-user-actionable reason

When fallback is used, document:

- The MCP tool name
- The exact failure message
- The `gh` command used as fallback

### Git ownership split

- Use local `git` for working tree operations (edit, stage, commit, diff)
- Use MCP for GitHub API operations (issue, branch, PR, comments, reviews)

### PR evidence is mandatory

Every PR must include workflow evidence:

- Issue read method used
- Branch creation method used
- Commit SHA
- PR creation method used
- Any fallback used and why

Do not merge PRs that omit workflow evidence or contain unexplained fallback.

## MCP Preflight Checklist (Run Before GitHub Writes)

Before creating branches, updating issues, or opening PRs, verify:

1. MCP identity is healthy (`get_me` succeeds)
2. Repo read path is healthy (`list_issues` or `list_branches` succeeds)
3. Write path is healthy (perform one safe write probe in a test branch or
   update an existing test PR body)
4. If any write fails, stop and fix auth before continuing feature work

## Deterministic MCP Setup

Use one GitHub MCP server configuration path at a time. Avoid mixed auth paths
(for example OAuth + PAT at once) to prevent nondeterministic write failures.
