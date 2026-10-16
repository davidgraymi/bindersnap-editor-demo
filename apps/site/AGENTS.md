# AGENTS.md — the public site (`apps/site`)

Read with the root `AGENTS.md`, whose design rules (tokens, typography, colour,
voice) apply here too. This file covers only what is particular to
`bindersnap.com`.

## What it is

`apps/site/` is the marketing site: the landing page, pricing, policy
templates, regulatory requirements, pages per kind of provider, comparisons and
a glossary. It is `bindersnap.com`; the app is `app.bindersnap.com` (issue
#718), so a marketing page never takes an organization's name.

Each marketing page is Markdown with front matter in
`apps/site/content/{collection}/{slug}.md`, so whoever checks a regulatory
claim reviews it as a text diff. It is rendered the way `/help` and `/legal`
are: plain HTML with nothing to run, a Markdown copy at `{path}.md`, JSON-LD,
and listed in `/sitemap.xml`, `/llms.txt` and `/llms-full.txt`
(`scripts/build-site.ts`, served live by `server.ts`).

`renderSite.test.ts` is the quality gate: length of titles and descriptions,
minimum words, no broken internal links, no claims we cannot make (never
"HIPAA compliant": Bindersnap holds no patient data). Marketing copy may say
"policy"; the app says "document".

`chrome.ts` is the bar and footer every public page wears — landing, marketing,
help and legal — styled by `chrome.css`. The landing page is a static
`index.html` with a copy of that markup; `landing.test.ts` holds its links to
the lists in `chrome.ts`.

## The landing page

### Sign-up form

The hero and the closing CTA each have one: `.email-row` (hero) and
`.cta-email-row` (closing), from `landing.css` — an email input and a coral
button in one rounded container with a coral focus ring, and a `.form-hint`
line under it. The button signs up; there is no waitlist.

### Section eyebrow

Each section opens with a mono coral label with flanking rules. On the landing
page that is `.eyebrow-tag` (`landing.css`); elsewhere it is `.bs-eyebrow` from
the token file.

### Scroll rhythm

The four sections between the chaos strip and the founder note — The Solution,
The Record, the before/after, The Review — each have a **different silhouette,
on purpose**:

| Section        | Shape                                               | Tone   |
| -------------- | --------------------------------------------------- | ------ |
| The Solution   | sticky left lede + three numbered rows on hairlines | paper  |
| The Record     | one framed chain diagram + a divided claims line    | tinted |
| Before / after | one ledger, the pairs answering across each row     | paper  |
| The Review     | a three-column strip divided by hairlines           | tinted |

They used to be four consecutive "centred header, then a row of bordered
cards" sections. The eye pattern-matches that by the second one and starts
skimming — on the half of the page that leads to the CTA, which is exactly
where interest should be building instead.

So when you add or rework a section in this stretch: **do not reach for a
three-across card grid**, and keep the tinted/paper alternation intact
(`.section-band` puts a bare `<section>` on the tinted beat). If a new section
needs a shape, give it one nothing adjacent already has.

Every new section needs an eyebrow, a Lora headline, and one clear action —
never two competing CTAs.

### Scroll reveal

Add `.reveal` (`landing.css`) to any block-level element below the fold, and
`.reveal-d1` through `.reveal-d3` for staggered delays. `installScrollReveal`
in `landing.ts` adds `.in` on intersect. Marketing pages only.

### Dark sections

When a section uses `--brand-ink` as the background (the chaos strip — always
dark, regardless of theme), text uses `--brand-on-dark-primary`, secondary text
uses `--brand-on-dark-secondary`, and rules use `--brand-on-dark-rule`.
