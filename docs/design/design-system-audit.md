# Design System Audit — 28 Aug 2026

Audited against `main` at `e4e8b93`.

This document is the agent-actionable version of the audit. Each finding is a
discrete task with the files to touch, the exact change, and how to verify it.
The rendered report for humans is
[`design-system-audit.html`](design-system-audit.html).

**Scope:** `packages/ui-tokens/css/bindersnap-tokens.css`,
`packages/ui-tokens/css/bindersnap-landing.css`, `apps/app/app.css`,
`packages/editor/assets/bindersnap-editor.css`, `apps/app/index.html`,
`apps/app/components/*.tsx` — 12,629 lines of CSS, 118 tokens, 1,101 class
selectors.

---

## Score

**57/100.** The average hides the shape of the problem. Split at the token line:

| Half                                                        | Score  |
| ----------------------------------------------------------- | ------ |
| Token layer (architecture, colour, type, spacing)           | 76/100 |
| Above the tokens (components, docs, accessibility, linting) | 38/100 |

| Dimension                | Score |
| ------------------------ | ----- |
| Token architecture       | 13/15 |
| Colour tokenisation      | 14/15 |
| Spacing tokenisation     | 6/10  |
| Type tokenisation        | 5/10  |
| Accessibility            | 7/15  |
| Component layer          | 8/20  |
| Documentation accuracy   | 4/10  |
| Enforcement (lint/tests) | 0/5   |

---

## What is already right — do not change these while fixing the rest

- **The two-layer split is the correct architecture.** `--bs-*` semantic tokens
  flip with the theme; `--brand-*` tokens never do.
- **Colour adoption is near-total.** 34 hardcoded hex and 27 raw `rgba()` across
  12,629 lines, and almost all of them share one root cause (Task 1).
- **Dark mode is designed, not inverted.** Four warm-ink surface steps mirroring
  the paper steps. Only 15 `[data-theme="dark"]` component overrides are needed
  in the whole app.
- **The three-font stack is enforced in practice.** No drift into a fourth face.
- **`prefers-reduced-motion` is handled** in both `app.css` and
  `bindersnap-landing.css`.

---

## Coverage measurements

| Category           | Tokens | Tokenised   | Raw values     | Distinct off-scale values                              |
| ------------------ | ------ | ----------- | -------------- | ------------------------------------------------------ |
| Colour             | 28     | ~99%        | 61 literals    | 13 hex, 14 rgba                                        |
| Spacing            | 13     | 518/792 65% | 274            | 28 — led by `2px`, `3px`, `6px`, `10px`, `5px`         |
| Typography         | 9      | 163/322 50% | 149            | 19 — led by `13px` (24×), `11px` (23×), `12.5px` (18×) |
| Radius             | 7      | ~95%        | 12             | 7                                                      |
| Z-index            | 7      | 21/31 68%   | 10             | 7                                                      |
| Icon size / stroke | 0      | 0%          | ~120 callsites | 8 sizes, 9 stroke widths                               |

The type and spacing gaps are **scale** problems, not discipline problems. The
scales were designed for a marketing page and never extended for dense product
UI. There is no step between `0.75rem` (12px) and `0.875rem` (14px), so 13px is
typed by hand 24 times. Spacing starts at 4px, so 2px and 6px are typed by hand
66 times.

---

## Task 1 — Add a semantic status ramp

**Priority: critical. Estimate: ~2h. Files: `packages/ui-tokens/css/bindersnap-tokens.css`, `apps/app/app.css`.**

### Problem

The system defines two hues: coral and green. The app also needs to say _needs
review_, _waiting_, _informational_ and _destructive_, and every one of those is
a hardcoded literal — amber `#d97706`/`#b45309`, blue `#1d4ed8`/`#3b82f6`,
violet `#7c3aed`, teal `#0f766e`. That accounts for nearly all 61 colour
literals in the codebase.

Because they are literals they do not flip with the theme. **All seven measured
status colours pass WCAG AA in light mode and fail it in dark mode.** Ratios are
measured against the composited tint over `--bs-surface-1`.

| Component                                 | Foreground | Light  | Dark   |
| ----------------------------------------- | ---------- | ------ | ------ |
| `.vault-triage-pill--active-waiting`      | `#1d4ed8`  | 5.96 ✓ | 2.02 ✕ |
| `.rev-avatar--tone1`                      | `#1d4ed8`  | 5.72 ✓ | 2.15 ✕ |
| `.vault-triage-pill--active-needs-review` | `#b45309`  | 4.29 ✓ | 2.46 ✕ |
| `.rev-avatar--tone2`                      | `#7c3aed`  | 4.91 ✓ | 2.49 ✕ |
| `.vault-status-review`                    | `#b45309`  | 4.42 ✓ | 2.56 ✕ |
| document status teal                      | `#0f766e`  | 4.75 ✓ | 2.57 ✕ |
| `.rev-avatar--tone4`                      | `#b45309`  | 4.39 ✓ | 2.76 ✕ |

The triage pills are the primary triage signal on the dashboard and are the
worst of them at 2.02:1.

### Change

Add to `:root` in `bindersnap-tokens.css`:

```css
/* ── SEMANTIC STATUS ─────────────────────────────────────────
   Four tones beyond coral and green. Each is a fg/bg/border
   triad so a chip, a pill and a left-border all read from one
   family. These are --bs-* because they flip with the theme.
──────────────────────────────────────────────────────────────── */
--bs-status-warn-fg: #8f5e02; /* needs review        */
--bs-status-warn-bg: rgba(143, 94, 2, 0.1);
--bs-status-warn-border: rgba(143, 94, 2, 0.22);

--bs-status-info-fg: #1d4ed8; /* waiting             */
--bs-status-info-bg: rgba(29, 78, 216, 0.08);
--bs-status-info-border: rgba(29, 78, 216, 0.2);

--bs-status-danger-fg: #c94d1a; /* changes / declined */
--bs-status-danger-bg: rgba(201, 77, 26, 0.09);
--bs-status-danger-border: rgba(201, 77, 26, 0.22);

--bs-status-ok-fg: #15803d; /* approved            */
--bs-status-ok-bg: rgba(21, 128, 61, 0.09);
--bs-status-ok-border: rgba(21, 128, 61, 0.22);
```

The light-mode warn tone is `#8f5e02` rather than the more obvious amber
`#b45309`. Bindersnap's danger tone is brand coral, and `#b45309` sits only 8° of
hue from it — a warning pill and a declined pill read as the same colour side by
side. `#8f5e02` is 22° away, and measures 4.86:1 on its own tint (`#b45309`
measures 4.46:1). In dark mode the pair separate on their own and no adjustment
is needed.

And to `[data-theme="dark"]` — lift the hue, keep the meaning:

```css
--bs-status-warn-fg: #fbbf24; /* 2.46 → 6.78 */
--bs-status-warn-bg: rgba(251, 191, 36, 0.13);
--bs-status-warn-border: rgba(251, 191, 36, 0.28);

--bs-status-info-fg: #93c5fd; /* 2.02 → 6.50 */
--bs-status-info-bg: rgba(147, 197, 253, 0.12);
--bs-status-info-border: rgba(147, 197, 253, 0.26);

--bs-status-danger-fg: #fb8c5a; /* 3.29 → 4.99 */
--bs-status-danger-bg: rgba(232, 93, 38, 0.15);
--bs-status-danger-border: rgba(232, 93, 38, 0.3);

--bs-status-ok-fg: #4ade80; /* 4.60 → 6.78 */
--bs-status-ok-bg: rgba(74, 222, 128, 0.12);
--bs-status-ok-border: rgba(74, 222, 128, 0.26);
```

Then replace every hardcoded literal in `app.css` with the matching token. The
call sites are:

- `.vault-doc-card--review` (line ~512) — `#d97706` left border
- `.vault-status-review` (~594) — amber fill and text
- `.rev-avatar--tone1`, `--tone2`, `--tone4` (~2136–2157)
- `.rev-dot--green` (~2220) — `#e3f1e6` / `#b6e0c3`
- `.vault-triage-pill--active-needs-review`, `--active-waiting`,
  `--active-approved`, `--active-changes` (~4292–4312)
- `.vault-pr-confirm` (~5606) — amber warning panel

Finally, delete the `[data-theme="dark"]` component overrides that exist only to
patch this (for example `[data-theme="dark"] .rev-dot--green`) — the tokens now
handle it.

### Verify

- No hex or `rgba()` literal remains in `app.css` except the allow-list in
  Task 6.
- Every status colour measures ≥ 4.5:1 in both themes.

---

## Task 2 — Correct the token vocabulary in AGENTS.md

**Priority: critical. Estimate: ~45m. File: `AGENTS.md`.**

### Problem

The frontend rules instruct agents to use `--color-*`, `--font-*`, `--space-*`,
`--radius-*`, `--shadow-*`. **Three of those five families are not defined
anywhere.** `--space-4`, `--radius-md` and `--text-h1` all resolve to nothing.
The real names are `--brand-space-4`, `--brand-radius-md`, `--brand-text-h1`.

The "Key token categories" block in AGENTS.md is the v1 vocabulary; the token
file is v2. Any agent that follows the documentation writes CSS that silently
does not apply — and four agent definitions in `.claude/` read this file.

### Change

Rewrite the "Key token categories" block against the actual token file, listing
the real `--bs-*` and `--brand-*` names. Replace the rule "Use `--color-*`,
`--font-*`, `--space-*`, `--radius-*`, `--shadow-*`" with the rule that actually
governs the system, which today exists only as a comment inside the CSS:

> Components always reference `--bs-*` semantic tokens. Never reference
> `--brand-*` directly in component styles unless the value is intentionally
> fixed across modes.

Also correct the "Spacing" section: it states all spacing is base-8 and no
off-scale value may be introduced. That rule is broken 274 times because
following it is impossible — see Task 7.

### Verify

Every token name mentioned in AGENTS.md exists in
`packages/ui-tokens/css/bindersnap-tokens.css`. Task 6's test can assert this.

---

## Task 3 — Fix the contrast table and `--bs-text-faint`

**Priority: critical. Estimate: ~20m. File: `packages/ui-tokens/css/bindersnap-tokens.css`.**

### Problem

The comment block at line ~219 claims "Contrast ratios verified at WCAG AA for
all text levels." Three of the four rows are inaccurate, and one is a failure
reported as a pass.

| Token                 | File claims | Actual on `#fafaf7` | Verdict                        |
| --------------------- | ----------- | ------------------- | ------------------------------ |
| `--bs-text-primary`   | 13.2        | 16.72               | understated                    |
| `--bs-text-secondary` | 9.4         | 9.82                | close                          |
| `--bs-text-muted`     | 5.1         | 4.59                | still AA, but overstated       |
| `--bs-text-faint`     | 3.1         | **2.41**            | fails even large-text AA (3.0) |

`--bs-text-faint` is also asymmetric between themes — 2.41:1 in light, 3.65:1 in
dark. It is used for input placeholders, which is exactly where it matters.

### Change

- Darken light-mode `--bs-text-faint` from `#a8a29e` to `#96908a` (3.02:1).
- Correct all four numbers in the comment.
- Note in the comment that the ratios are asserted by
  `packages/ui-tokens/tokens.test.ts` (Task 6), so the comment cannot drift
  again.

### Verify

Recompute all eight ratios (four light, four dark) to WCAG 2.1 relative
luminance and confirm the comment matches.

---

## Task 4 — One status primitive to replace 44 classes

**Priority: high. Estimate: ~1d. Files: `apps/app/app.css`, `apps/app/components/`, `packages/ui-tokens/css/bindersnap-tokens.css`.**

### Problem

A small rounded label showing a status is implemented 44 times under 12 naming
families. The design system's own `.bs-pill` and `.bs-nav-badge` are used **zero**
times in the app.

```
.admin-pro-admin-pill          .admin-pro-status-badge       .app-topnav-badge
.app-user-badge                .app-workspace-pill           .audit-chip
.bs-file-chip                  .bs-nav-badge                 .bs-nav-badge-dot
.bs-pill                       .chaos-pill                   .chaos-pill-icon
.chaos-pill-text               .collaborator-existing-badge  .collaborator-panel-status
.collaborator-permission-badge .cta-tag                      .doc-compare-chip
.doc-version-pill              .docs-chip                    .docs-chip-remove
.docs-pill                     .eyebrow-tag                  .feat-tag
.footer-tagline                .home-pill                    .perms-picker-chip
.perms-picker-chip-remove      .perms-picker-chips           .record-claim-tag
.reply-badge                   .rev-event-tag                .review-card-tag
.vault-badges                  .vault-pending-badge          .vault-status-approved
.vault-status-badge            .vault-status-changes         .vault-status-declined
.vault-status-published        .vault-status-review          .vault-status-withdrawn
.vault-status-working          .vault-triage-pill
```

Buttons have the same shape of problem: 29 button classes across 8 families
(`.rev-btn`, `.icon-btn`, `.cancel-btn`, `.confirm-btn`, `.resolve-btn`,
`.change-row-btn`, `.merge-toggle-btn`, `.app-topnav-icon-btn`…), plus 48 blocks
that set `cursor: pointer` and roll their own padding.

### Change

Add one `.bs-status` class to the token file with tone modifiers driven by
Task 1's tokens, and one `<StatusChip tone size />` React primitive in
`apps/app/components/`. Six tones (`working`, `review`, `waiting`, `approved`,
`changes`, `published`) replace 44 classes.

Do this **after** Task 1 — the tones have nowhere to come from until the status
ramp exists.

Buttons come second, the same way. `.bs-btn` already exists and is used 71
times, so it needs the variants the app actually reaches for rather than a
rewrite.

### Verify

`bun run test:app` passes; the app renders identically in both themes; the
badge-family class count drops from 44 to 1 plus modifiers.

---

## Task 5 — Give the primitives their missing states

**Priority: high. Estimate: ~3h. File: `packages/ui-tokens/css/bindersnap-tokens.css`.**

### Problem

| Primitive       | Default | Hover | Focus | Disabled | Loading | Error | Sizes |
| --------------- | ------- | ----- | ----- | -------- | ------- | ----- | ----- |
| `.bs-btn`       | ✓       | ✓     | ✕     | ✕        | ✕       | —     | ✕     |
| `.bs-input`     | ✓       | ✕     | ✓     | ✕        | —       | ✕     | ✕     |
| `.bs-card`      | ✓       | ✓     | ✕     | —        | —       | —     | ✕     |
| `.bs-email-row` | ✓       | ✓     | ✓     | ✕        | ✕       | ✕     | —     |

`.bs-btn` has no `:focus-visible` at all — the token file has zero. Across the
app there are 67 `:hover` rules against 31 `:focus-visible`, so roughly half of
what responds to a mouse is invisible to a keyboard. There is no destructive
variant, so "Remove collaborator" and "Publish" look the same.

### Change

Add to `.bs-btn`: `:focus-visible` (2px coral outline, 2px offset), `:disabled`
(reduced opacity, `cursor: not-allowed`, no transform), `--sm` and `--lg` size
modifiers, `--danger` variant reading `--bs-status-danger-*`, and an
`[aria-busy="true"]` spinner state. Add `:disabled` and an `[aria-invalid]`
error state to `.bs-input`.

This raises the floor for all 71 existing `.bs-btn` call sites at once.

### Verify

Tab through the document detail and change review screens; every interactive
element shows a visible focus ring.

---

## Task 6 — Enforce the system in CI

**Priority: high. Estimate: ~2h. File: `packages/ui-tokens/tokens.test.ts` (new).**

### Problem

There is no stylelint config, no CSS test, and Prettier only checks formatting.
Every finding in this document is free to regress the day after it is fixed.
TypeScript strict mode is treated as the linter; the stylesheets have no
equivalent.

### Change

Add `packages/ui-tokens/tokens.test.ts`, runnable under `bun run test:app` with
no new dependency. It parses the CSS and asserts:

1. No hex or `rgba()` literal appears outside `bindersnap-tokens.css`.
2. Every `var(--…)` reference resolves to a defined token.
3. Every defined token is referenced at least once.
4. Computed contrast for each text token meets its documented ratio.
5. Every token name mentioned in `AGENTS.md` exists.

Rule 4 makes Task 3 permanently unrepeatable. Rule 3 keeps Task 8 done. Rule 5
keeps Task 2 done.

Rule 1 needs a small allow-list for intentionally fixed values: `#000` on
`.doc-compare-blend` (the `mix-blend-mode: difference` comparison requires a true
black ground) and `.bs-btn-dark`, which is documented as deliberately not
theme-reactive.

### Verify

The test fails when a literal is reintroduced, and passes on the current tree
once Tasks 1, 3 and 8 land.

---

## Task 7 — Extend the type and spacing scales

**Priority: high. Estimate: ~3h. Files: `packages/ui-tokens/css/bindersnap-tokens.css`, `AGENTS.md`.**

### Problem — type

The nine-step scale runs from `--brand-text-label` (11px) to
`--brand-text-display`, with nothing designed for tables, chips and metadata
rows. The evidence is 149 hand-typed sizes across 19 values, including five
half-pixel values (`10.5`, `11.5`, `12.5`, `13.5`, `14.5px`) that exist only
because there was no correct step to reach for.

```css
/* Fills the gap between --brand-text-xs (12px) and --brand-text-sm (14px) */
--brand-text-ui-xs: 0.6875rem; /* 11px — replaces 23 hand-typed  */
--brand-text-ui-sm: 0.75rem; /* 12px — replaces 14, + 18 at 12.5 */
--brand-text-ui-md: 0.8125rem; /* 13px — replaces 24, + 7 at 13.5 */
```

### Problem — spacing

The base-8 scale starts at 4px. The three most common raw spacing values in the
app are `2px` (24×), `3px` (22×) and `6px` (20×) — sub-step gaps inside chips,
icon rows and inline stacks.

```css
--brand-space-0-5: 2px; /* icon-to-label, chip internals */
--brand-space-1-5: 6px; /* inline stacks                 */
--brand-space-2-5: 10px; /* dense row padding             */
```

Three steps absorb roughly 70 of the 274 violations.

### Change

Add the tokens above, then migrate the call sites. **Either** add them **or**
amend the AGENTS.md spacing rule to say the scale is base-8 above 12px and free
below — but pick one, because the documentation and the code currently disagree.

### Verify

Raw `font-size` px declarations drop below 40; raw spacing px declarations drop
below 210.

---

## Task 8 — Delete the legacy alias layer

**Priority: medium. Estimate: ~1h. Files: `packages/editor/assets/bindersnap-editor.css`, `packages/ui-tokens/css/bindersnap-tokens.css`.**

### Problem

22 aliases live at the bottom of the token file under a comment reading "Remove
once all components are migrated." **15 of them have zero references.** The 7
survivors are used by exactly one consumer — `packages/editor`, the only package
that never got migrated (68 `--color-*` references).

One alias is worse than dead: `--color-ink-mid: #292524` is a raw hex sitting in
the alias block, so it points at nothing and would not flip with the theme if it
did.

Dead tokens:

```
--brand-tracking-normal  --brand-z-base        --brand-z-toast
--color-coral-dim        --color-coral-glow    --color-green-dim
--color-ink-mid          --color-muted-light   --color-paper-mid
--color-paper-warm       --font-mono           --shadow-sm
--shadow-md              --shadow-lg           --shadow-xl
```

### Change

Rename the editor's 68 `--color-*` references to their `--bs-*`/`--brand-*`
equivalents per the alias map, then delete the whole `LEGACY ALIAS MAP` block.

Per the editor package rules, note the visual change in the PR description.

### Verify

`bun run test:app` passes, the editor renders identically in both themes, and
Task 6's rule 3 holds.

---

## Task 9 — Resolve the duplicate landing primitives

**Priority: medium. Estimate: ~2h. Files: `packages/ui-tokens/css/bindersnap-tokens.css`, `packages/ui-tokens/css/bindersnap-landing.css`, `apps/app/index.html`.**

### Problem

`bindersnap-tokens.css` defines `.bs-reveal`, `.bs-reveal-d1…d4` and
`.bs-compare-item`. `bindersnap-landing.css` defines `.reveal`, `.reveal-d1…d3`
and `.compare-item` — the same components, unprefixed. `index.html` uses the
unprefixed ones exclusively, so the `.bs-*` versions are dead weight shipped on
every page load.

Of the 21 primitives checked, 5 are used anywhere and 16 are used nowhere:
`bs-pill`, `bs-body`, `bs-h1`–`h3`, `bs-display`, `bs-container`, `bs-section`,
`bs-code`, `bs-file-chip`, `bs-email-row`, `bs-nav-badge`, `bs-compare-item`,
`bs-accent`, `bs-theme-toggle` and the reveal family all score zero.

### Change

Pick one. Recommended for a solo codebase: delete the unused half of the token
file's component section rather than adopting it. Keep `.bs-btn`, `.bs-card`,
`.bs-input`, `.bs-eyebrow`, `.bs-label`, add `.bs-status` from Task 4, drop the
rest.

### Verify

The landing page renders identically; the token file's component section shrinks
to the primitives that are actually used.

---

## Task 10 — Move the landing stylesheet out of `ui-tokens`

**Priority: medium. Estimate: ~30m. Files: `packages/ui-tokens/`, `apps/app/`.**

### Problem

`packages/ui-tokens/` is described in AGENTS.md as "CSS design tokens, fonts,
icons," but 73% of its CSS is `bindersnap-landing.css` — page-specific styling
for one route of one app. It also has no `package.json`, so consumers reach it
by relative path (`../../packages/ui-tokens/css/index.css`) rather than through
the `@ui/*` alias the repo otherwise uses.

### Change

Move `bindersnap-landing.css` to `apps/app/landing.css` next to the component it
styles. Give `ui-tokens` a `package.json` with a `./css` export and update
`apps/app/index.html` to import through the alias.

### Verify

`bun run build` succeeds; the landing page renders identically.

---

## Task 11 — Fix white-on-coral and white-on-green

**Priority: high. Estimate: ~30m. Files: `packages/ui-tokens/css/bindersnap-tokens.css`, `apps/app/app.css`.**

### Problem

| Control                                 | Pairing                | Ratio | AA (4.5) |
| --------------------------------------- | ---------------------- | ----- | -------- |
| `.rev-btn--green` — Approve             | `#ffffff` on `#16a34a` | 3.30  | ✕        |
| `.bs-btn-primary`, `.doc-header-submit` | `#ffffff` on `#e85d26` | 3.49  | ✕        |
| `.bs-btn-primary:hover`                 | `#ffffff` on `#c94d1a` | 4.61  | ✓        |
| `.rev-btn--green:hover`                 | `#ffffff` on `#128040` | 5.02  | ✓        |

Both resting states fail; both hover states pass. Approve and Publish are
described in the code as "the only two things on this page that settle
anything" — they should be the most legible controls in the product.

### Change

Use the darker value at rest and reserve `--brand-coral` for fills, borders and
accents. One line per button. The alternative — accepting the 3:1 large-text
exemption by raising button labels to 18px+ — changes the visual weight of every
CTA and is not recommended.

Note this conflicts with the AGENTS.md rule that coral is used for exactly one
element per section; the rule concerns _hue_, and `--brand-coral-dark` is the
same hue. Confirm the reading before changing the CTA colour.

### Verify

Every filled button measures ≥ 4.5:1 at rest in both themes.

---

## Task 12 — Add icon, elevation and motion tokens

**Priority: medium. Estimate: ~3h. Files: `packages/ui-tokens/css/bindersnap-tokens.css`, `apps/app/components/`.**

### Problem

Lucide icons are sized per call site with no tokens: 8 distinct sizes and 9
distinct stroke widths, including `1.4`, `1.5`, `1.6`, `1.7`, `1.75`, `1.8`,
`2`, `2.2` and `2.5` — differences no one can see but which guarantee two icons
side by side never quite match.

Separately, four shadow steps and four transition durations exist but nothing
says which belongs to what. A card, a dropdown and a modal each pick a shadow by
feel. Seven raw z-index values still sit outside the `--brand-z-*` scale.

### Change

```css
--brand-icon-xs: 12px;
--brand-icon-sm: 14px;
--brand-icon-md: 16px;
--brand-icon-lg: 20px;
--brand-icon-stroke: 1.5; /* already the plurality */
--brand-icon-stroke-heavy: 2; /* emphasis only         */
```

Best expressed as an `<Icon>` wrapper around `lucide-react` taking `size="sm"`
rather than `size={14}`, so the tokens cannot be bypassed.

Then name the shadows by role — `--bs-elevation-card`, `--bs-elevation-menu`,
`--bs-elevation-modal` — so the choice stops being a judgement call, and move
the seven raw z-index values onto the `--brand-z-*` scale.

### Verify

No numeric `size=` or `strokeWidth=` prop remains in `apps/app/components/`.

---

## Suggested sequence

If only one afternoon is available: **Tasks 1, 2, 3 and 6**, in that order. The
status ramp removes almost every hardcoded colour and fixes seven dark-mode
contrast failures at once. Correcting AGENTS.md stops agents generating new
violations while the old ones are fixed. The contrast table takes twenty
minutes. The token test makes all three permanent instead of a snapshot.

Tasks 4 and 5 — the badge and button consolidation — are the largest and the
most deferrable. They are worth doing before the next feature that needs a new
status, not before the next release.

---

## Method

Contrast ratios are computed to WCAG 2.1 relative luminance, with alpha fills
composited over the surface token beneath them (`--bs-surface-1`: `#ffffff` in
light, `#292524` in dark). Coverage percentages count declarations, not files.
Class counts are distinct selectors across the four stylesheets in scope.
