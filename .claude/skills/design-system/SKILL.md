---
name: design-system
description: Bindersnap's design tokens, typography, color, spacing, radius and component rules. Use before writing or reviewing any CSS, component markup, or visual change in apps/app, apps/site, apps/help, apps/legal, packages/editor or packages/ui-tokens.
---

# Bindersnap design system

Moved here from `AGENTS.md` so it loads only for UI work. It is still the one
source: `packages/ui-tokens/tokens.test.ts` checks that every token named below
exists. A visual change under `packages/editor/` needs a flag in the PR
(non-negotiable 5).

The visual identity is **warm, human, and empathy-first** — not corporate, not
"enterprise software". _If it doesn't feel like it was built by someone who
lived the problem, rebuild it._ Lead with the pain the reader recognizes; the
product is the resolution.

The sources of truth:

- **Tokens:** `packages/ui-tokens/css/bindersnap-tokens.css`. Import it before
  any other stylesheet. **Never hardcode a hex value or a pixel size** in a
  component.
- **Image assets and meta tags:** `docs/bindersnap-social-cheatsheet.html` has
  the exact dimensions.
- **Open design-system work:** `docs/design/design-system-audit.md`.

## Tokens

Two layers:

- **`--bs-*` semantic tokens** flip with the theme. Components use these.
- **`--brand-*` tokens** never change between modes. Reference one directly
  only when the value is meant to stay fixed across themes (the chaos strip is
  always dark ink; the email-thread mockup is always a light UI).

The names, as the token file defines them:

```css
/* Semantic surfaces / text / borders (--bs-*, flip with theme) */
--bs-page-bg, --bs-surface-1, --bs-surface-2, --bs-surface-3, --bs-nav-bg
--bs-text-primary, --bs-text-secondary, --bs-text-muted, --bs-text-faint
--bs-rule, --bs-rule-warm
--bs-coral-dim, --bs-coral-glow, --bs-coral-border, --bs-coral-border-soft
--bs-green-dim, --bs-green-border, --bs-green-border-soft

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
--brand-on-coral                     /* ink label on a coral fill   */

/* Typography (--brand-*) */
--brand-font-serif    /* 'Lora' — headlines only */
--brand-font-sans     /* 'Geist' — body and UI */
--brand-font-mono     /* 'Geist Mono' — labels, code, metadata */

/* Type scale (--brand-*) */
--brand-text-h1, --brand-text-h2, --brand-text-h3
--brand-text-body-lg, --brand-text-body, --brand-text-sm, --brand-text-xs
--brand-text-label
--brand-text-ui-xs, --brand-text-ui-sm, --brand-text-ui-md  /* dense UI: 12/13/14px */
--brand-text-ui-lg                   /* 15px: the name a row is about */

/* Spacing (--brand-space-*): the number × 4px, so -6 is 24px */
--brand-space-0-5, --brand-space-1, --brand-space-1-5, --brand-space-2,
--brand-space-2-5, --brand-space-3, --brand-space-4, --brand-space-5,
--brand-space-6, --brand-space-8, --brand-space-10, --brand-space-12,
--brand-space-16, --brand-space-20, --brand-space-24, --brand-space-30

/* Border radius (--brand-*) */
--brand-radius-xs, --brand-radius-sm, --brand-radius-md, --brand-radius-lg,
--brand-radius-xl, --brand-radius-2xl, --brand-radius-full

/* Shadows */
--bs-shadow-sm, --bs-shadow-md, --bs-shadow-lg, --bs-shadow-xl  /* flip with theme */
--brand-shadow-coral                                            /* fixed */
--bs-elevation-card, --bs-elevation-menu, --bs-elevation-modal   /* named by role */

/* Transitions (--brand-*) */
--brand-transition-fast (0.15s), --brand-transition-base (0.2s)
--brand-transition-slow (0.3s), --brand-transition-reveal (0.45s)

/* Icons (--brand-*) */
--brand-icon-xs, --brand-icon-sm, --brand-icon-md, --brand-icon-lg
--brand-icon-stroke, --brand-icon-stroke-heavy
```

The file also defines utility classes: `.bs-btn` (`.bs-btn-primary`,
`.bs-btn-secondary`, `.bs-btn-dark`, size and danger modifiers), `.bs-card`,
`.bs-input`, `.bs-eyebrow`, `.bs-label`, `.bs-status` (tone modifiers).

## Typography

Each font has one job:

| Font           | Role                                                           | Rule                                                                                      |
| -------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Lora**       | All headlines (H1–H3), pull quotes, display text               | Warm, literary, serif. Use Bold or SemiBold. Italic for `<em>` accent phrases in coral.   |
| **Geist**      | All body copy, UI labels, buttons, navigation                  | Clean, modern. Regular (400) for body and subtext, Medium (500) for UI. Never Light.      |
| **Geist Mono** | Section eyebrow tags, code, filenames, timestamps, data labels | Fixed-width, technical. Always uppercase + wide letter-spacing for section labels.        |

Never mix fonts within a heading level. Never use Lora for body copy, or Geist
for a main headline.

## Color

- **Coral (`--brand-coral`, `#E85D26`)** is for CTAs, the top-border reveal on
  hover cards, section eyebrow labels, form focus rings, and key emphasis.
  **Exactly one primary action or emphasis element per section** — when
  everything is coral, nothing is. Never decorative.
- **White on `--brand-coral` measures 3.49:1 and fails WCAG AA.** Never fill a
  button with `--brand-coral` and put white on it. Instead:
  - **Landing CTAs** (hero, closing, nav) fill with `--brand-coral` and set the
    label in `--brand-on-coral` — ink, 5.02:1. On hover the fill darkens to
    `--brand-coral-dark` and the label flips to `--brand-on-brand` (4.61:1).
  - **White-label buttons** (in-app primaries, where an ink label would read as
    disabled in dense UI) fill with `--bs-cta-fill` / `--bs-cta-fill-hover` —
    the coral hue dropped in lightness until white clears 4.5:1.
- **Paper (`--bs-page-bg`, `#FAFAF7` in light mode)** is the page background,
  never `#FFFFFF`. White is for card and input interiors only (`--bs-surface-1`).
  **Paper warm (`--bs-surface-2`, `#F5F0E8`)** is for alternating sections,
  card backgrounds and tag fills.
- **Ink (`--bs-text-primary`, `#1C1917` in light mode)** is primary text, a warm
  charcoal, not black. Backgrounds that stay dark in both themes (the chaos
  strip, the footer) use `--brand-ink`.
- **`--bs-text-secondary`** is paragraph text, on the landing page as in the
  app. **`--bs-text-muted`** is metadata and short secondary lines — on
  `--bs-surface-2` it measures 4.23:1, so nothing readable in muted sits on
  beige. **`--bs-text-faint`** (3.0:1) is the floor — placeholders,
  separators, icons and disabled items only; never text a person reads.
- **Green (`--brand-green`, `#16A34A`)** means success and nothing else:
  success states, compliance badges, the "after" column in comparisons.
- **The status ramp** (`--bs-status-warn-*`, `-info-*`, `-danger-*`, `-ok-*`,
  each a `-fg`/`-bg`/`-border` triad) is for needs-review (amber), waiting
  (blue), declined or changes requested, and approved. Never a hand-picked hex:
  a literal amber or blue passes contrast in light mode and fails it in dark.

## Spacing and radius

A `--brand-space-*` token is its number × 4px, from `--brand-space-0-5` (2px) to
`--brand-space-30` (120px). Use one of the sixteen tokens — never a raw pixel
value. Section vertical padding is `--brand-space-30` by default,
`--brand-space-24` (96px) for compressed sections.

Each radius has a use. Do not apply them arbitrarily:

| Token                 | Value  | Use                                           |
| --------------------- | ------ | --------------------------------------------- |
| `--brand-radius-xs`   | 2px    | Code blocks, compliance badges, table rows    |
| `--brand-radius-sm`   | 4px    | Tags, pills, small chips                      |
| `--brand-radius-md`   | 8px    | Nav elements, feature icons, small cards      |
| `--brand-radius-lg`   | 12px   | Inputs, form elements, standard cards         |
| `--brand-radius-xl`   | 16px   | Large cards, feature panels, comparison boxes |
| `--brand-radius-2xl`  | 24px   | CTA boxes, hero containers, modal dialogs     |
| `--brand-radius-full` | 9999px | Pills, avatars, count badges                  |

## Components

- **Section eyebrow:** every section opens with a mono coral label with
  flanking rules: `<div class="bs-eyebrow">The Solution</div>`.
- **Card hover:** `.bs-card` translates up 4px, elevates its shadow, drops its
  border, and scales a 3px coral top border in from the left. Never on
  non-interactive content.
- The landing page's own patterns — sign-up form, scroll rhythm, scroll reveal,
  dark sections — are in `apps/site/AGENTS.md`.
