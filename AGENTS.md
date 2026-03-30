# AGENTS.md — Bindersnap Codebase Guide

This file is for AI agents, LLMs, and automated tools working in this codebase.
It describes what Bindersnap is, how the product is designed, and the rules you
must follow when generating or modifying any code, copy, or assets.

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

- **CSS tokens:** [`src/assets/css/bindersnap-tokens.css`](src/assets/css/bindersnap-tokens.css)
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

## GitHub Agent Workflow (Issue → Branch → PR)

Use this sequence to avoid common handoff failures when automating GitHub work:

1. Run preflight checks before any branch or file changes:

```bash
scripts/agent-gh-preflight.sh <issue-number>
```

2. Create a task branch from `main` using the required prefix:

```bash
git checkout main
git pull --ff-only
git checkout -b codex/<short-task-name>
```

3. Keep changes scoped and explicit:

- Keep commits focused on one issue or one troubleshooting test
- Include the issue number in commit and PR text for traceability
- Do not mix formatting-only churn with behavior changes in the same commit

4. Open PR with deterministic metadata so review automation can parse it:

```bash
gh pr create \
  --base main \
  --head codex/<short-task-name> \
  --title "<type>: <short summary>" \
  --body "Closes #<issue-number>"
```

Prefer `--body-file` over `--body` when your text contains backticks, `$`, or
multi-line markdown to prevent shell interpolation issues:

```bash
cat > /tmp/pr-body.md <<'EOF'
## Summary
- ...
EOF
gh pr create --base main --head codex/<short-task-name> --title "<title>" --body-file /tmp/pr-body.md
```

5. If any step fails, capture the exact command + stderr in the PR or issue comment
   before retrying so the next agent has concrete diagnostics.

Known edge case: `git push -u origin <branch>` can push successfully but fail to
write local upstream tracking (lock/permission error in `.git/refs/remotes`).
If this happens, continue with:

```bash
gh pr create --base main --head <branch> --title "<title>" --body-file /tmp/pr-body.md
```

Then optionally repair tracking later with:

```bash
git branch --set-upstream-to=origin/<branch> <branch>
```
