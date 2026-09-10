# Design Review — the Figma workflow mockups against the build, 9 Sep 2026

Reviewed against `feat/adr4-documents-as-files` at `9aef399`, driven in a real
browser on a real stack: 21 screens captured at 1440×900 and 390×844, signed in
as the seeded `alice` and `bob`. The mockups are the four frames of
[Bindersnap Organization & Workflow UI](https://www.figma.com/design/sjgYmz7fQAZrdqpUL7HQuM/Bindersnap-Organization---Workflow-UI),
last modified 7 Sep 2026, rendered at 2× through the Figma REST API.

This document is the agent-actionable version. Each task below is discrete: the
files to touch, the exact change, and how to verify it. The rendered report with
the side-by-side screenshots is a published artifact — see
[Rendered report](#rendered-report) at the end.

**The brief this answers:** the current interface was designed after GitHub, and
should instead be intuitive to someone unfamiliar with GitHub, or with software
generally.

---

## Verdict

**The mockups win on getting you to the work. The build wins on doing the work.**

Neither is a daily driver yet, and the gap is not aesthetic. The mockups never
draw the two screens where a policy manager spends their day — the document, and
the difference between two versions of it. The build never draws the one screen
that gets them there — a queue that spans binders. Each is missing precisely
what the other has.

| Dimension               | Winner             | Why                                                                                          |
| ----------------------- | ------------------ | -------------------------------------------------------------------------------------------- |
| Navigation & vocabulary | Figma, clearly     | Persistent sidebar, cross-binder queue, plain-language roles, display names instead of slugs |
| Craft & language        | The build, clearly | Real typography, considered warm palette, status copy that says what happens next            |
| The core job            | Neither, fully     | Only the build draws the diff and the publish step; only the mockups draw a way to find them |

The important correction to the brief: **the build is not simply "GitHub with a
new coat of paint."** Its typography, palette and status writing are better than
the mockups'. The GitHub problem is narrower and far more fixable than a
redesign — it is concentrated in four places, which are Tasks 1–4 below and are
collectively about two days of work.

---

## What is already right — do not change these while fixing the rest

- **The type and colour system.** Lora display, Geist body, a warm paper ground
  and a considered coral. The mockups' Inter-on-white is a downgrade; do not
  adopt it. See `packages/ui-tokens/css/bindersnap-tokens.css`.
- **The status vocabulary.** "Ready to publish · all approvals in · becomes v2
  when you publish", "1 more approval needed", "Carol Mendes asked for changes".
  Every one says what happens next or who you are waiting on, by name. The
  mockups would regress this to `Needs review` / `In review` / `Blocked`, which
  name a state and answer nothing. **Keep the build's wording.**
- **The comparison view** (`DocumentComparison.tsx`, `documentComparison.ts`).
  "What this change does to v1 — added, removed, and rewritten", a plain-English
  legend, a real count, working across Markdown, Word and PDF. It is the
  strongest screen in the product and has no mockup counterpart. Do not touch it.
- **Publishing from Home.** An approved change carries a `Publish` button on the
  row with the consequence stated beside it. The mockups have no publish step at
  all. Whatever the new IA is, this must survive it.
- **The binder as a place.** The six binder tabs express ADR 0004's "one set of
  rules, one set of people" directly. The mockups have no binder-scoped screen —
  adopting their sidebar wholesale would delete the level the data model is built
  on. Keep the tabs underneath the new global navigation.
- **The floating decision bar** on a change request. It survives scrolling a long
  document, which matters. It needs the right colour (Task 3), not removal.

---

## Task 1 — Retire decorative monospace

**Priority: critical. Estimate: ~2h. Files: `apps/app/app.css`.**

### Problem

`apps/app/app.css` sets `--brand-font-mono` in **81 places**. Only about a
quarter of them are code, a path, or a keyboard key. The rest are ordinary
interface labels: section headings, status chips, counts, breadcrumbs, roles,
dates, table headers and metadata.

Monospace reads as _code_ to anyone who has seen a terminal and as _machine
output_ to anyone who has not. It is applied to roughly every label in the
product, and it is the single loudest "this is a developer tool" signal in the
interface — louder than the tab bar, the change numbers, or the branch icons.

Representative offenders, all currently mono:

| String on screen                     | Selector                                         |
| ------------------------------------ | ------------------------------------------------ |
| `WAITING ON YOU`, `YOUR SUBMISSIONS` | `.home-section-label`                            |
| `1 of 1 approvals`                   | `.rev-approval-count`, `.approval-meter`         |
| `Ready to publish`, `Closed · Sep 9` | `.home-pill`, `.change-row-outcome`              |
| `riverside-health`                   | `.app-breadcrumb-current`                        |
| `nursing / Infection Control Policy` | `.app-breadcrumb-sep`, `.app-breadcrumb-current` |
| `REVIEWERS`, `SIGN-OFF RULES`        | `.rev-reviewers-label`, `.perms-group-heading`   |
| `v1`, `ec22500`                      | `.doc-version-pill`, `.doc-rail-version`         |
| Table headers in a rendered document | `.doc-preview-prose th`                          |

### Change

Keep mono **only** where the string is literally machine text. That is this
allow-list — 12 selectors:

```
.app-inline-code          .doc-preview-prose code
.app-gate-url             .doc-preview-plain
.add-policy-path code     .doc-preview-filename
.doc-header-file          .doc-preview-fallback-name
.app-nav-search-kbd       .doc-compare-fallback-name
.quick-find-field-hint    .quick-find-legend kbd
```

`.app-doc-path` also carries mono but has no call-site in any `.tsx` — it is
dead CSS. Delete the rule rather than deciding its font.

Remove `font-family: var(--brand-font-mono)` from the other ~68 declarations so
they inherit Geist. Two judgement calls inside that set:

- **`.doc-preview-prose th`** — a table header inside a rendered policy is
  document content, not machine text. Remove the mono.
- **Avatar initials** (`.app-topnav-avatar`, `.doc-review-avatar`,
  `.collaborator-avatar-fallback`, `.app-profile-menu-avatar`,
  `.app-sidebar-user-avatar`, `.rev-picker-login`, `.perms-picker-result-login`)
  — mono initials read as usernames rather than people. Remove it here too, but
  this is the lowest-confidence part of the task; if it looks worse, revert just
  these six and leave the rest.

Uppercase section labels keep their `letter-spacing`; they were carrying the
label look through the mono, and lose legibility without it.

### Verify

- `grep -c "brand-font-mono" apps/app/app.css` returns ~12, not 81.
- `bun run test:app` passes.
- On the running stack: Home, a binder, a document and a change request show no
  mono outside filenames and the `⌘K`/`/` hint.

---

## Task 2 — Show names, not identifiers

**Priority: critical. Estimate: ~4h. Files: `apps/app/components/OrganizationPage.tsx`, `apps/app/components/BinderShell.tsx`, `apps/app/components/BinderDocumentPage.tsx`, `apps/app/documentDisplay.ts`.**

### Problem

Four separate leaks of storage identifiers onto the screen:

1. **`OrganizationPage.tsx:102`** renders `<h1>{org}</h1>` — the slug. The page
   is titled `riverside-health` while the organization switcher directly above it
   says "Riverside Health". The display name is already in the payload.
2. **`BinderShell.tsx:182`** renders `<h1>{binder}</h1>` — the repository name.
   The binder is titled `clinical`, lowercase.
3. **`BinderDocumentPage.tsx:364`** renders
   `{version.commitSha.slice(0, 7)}` in the Versions rail — a git commit SHA
   (`ec22500`) shown to a compliance manager beside `v1`. It is the one element
   on screen with no meaning to its audience, and on a document whose purpose is
   to be trustworthy it reads like an error code.
4. **`documentDisplay.ts:19` `formatDocumentName`** title-cases a slug
   word-by-word, so `hipaa-training-policy` renders as **"Hipaa Training
   Policy"**. A machine that does not know HIPAA is an initialism is visibly
   guessing at the name of a regulation.

ADR 0004 says evidence lives in git. It does not say git coordinates belong on
screen. The SHA stays in the audit export and the tag, where a surveyor can ask
for it.

### Change

1. Title the organization page with the display name, falling back to the slug
   only when absent. Keep the slug available — as a subtitle or on hover — for
   anyone who needs the URL.
2. Same for the binder: display name in the `h1`, slug demoted.
3. Replace the SHA in the Versions rail with something a reader can use — the
   publish date, or the name of whoever published it. Both are already on the
   change that produced the version. If neither is reachable without an extra
   call per version, render nothing rather than the SHA; `v1 · Current` alone is
   more useful than `v1 · ec22500`.
4. Stop deriving document titles from slugs. The document's real title is
   already carried in the seeded fixtures and in the file itself — use it, and
   keep `formatDocumentName` only as the last-resort fallback. At minimum,
   preserve casing for known initialisms rather than lowercasing them.

### Verify

- `bun run test:app` passes; `documentDisplay.test.ts` updated for the new
  fallback behaviour.
- On the running stack: the org page reads "Riverside Health", the binder reads
  its display name, the Versions rail shows no hex, and the HIPAA policy is
  spelled correctly.
- No route changes. `/riverside-health/clinical` still resolves — this task
  touches presentation only.

---

## Task 3 — Fix the action hierarchy

**Priority: high. Estimate: ~3h. Files: `apps/app/components/BinderShell.tsx`, `apps/app/components/DocumentChangeDetail.tsx`, `apps/app/app.css`.**

### Problem

On a change request awaiting the reviewer's decision, the build renders
**Approve** as `.rev-btn--green` — a green pill floating bottom-right — while the
solid coral button, the brand's primary emphasis and the most visually dominant
control on the page, is **"Add a policy"** (`.doc-header-submit`), an action with
no relationship to the change being reviewed.

The colour hierarchy is inverted. The most consequential act in the product —
putting your name on a policy, permanently — is styled as a secondary control,
and an irrelevant action is styled as the page's purpose.

Compounding it, `BinderShell.tsx:199-207` renders "Add a policy" on **all six**
binder tabs. On Change requests, People, Sign-off rules, History and Settings —
five of six — it is the wrong action.

### Change

1. In `BinderShell.tsx`, make the header action contextual: render "Add a policy"
   only on the Documents tab. On the other tabs render that tab's own primary
   action, or nothing. (People → "Add people"; Sign-off rules already has
   "Propose these rules" in the body and needs no header action.)
2. Give the coral to the decision. `Approve` becomes the primary filled button on
   a change awaiting your decision; `Publish` becomes primary on one that is
   ready. `Request changes` stays secondary.
3. Keep the floating bar — it survives scrolling a long document, which is why it
   exists. Only the colour weighting changes.

Do not introduce a new button class. `.doc-header-submit` and `.rev-btn--*`
already exist; this is a reassignment, not a new primitive.

### Verify

- `bun run test:app` and `bun run test:integration` pass — several integration
  tests click these buttons by accessible name, which does not change.
- On the running stack, signed in as `bob`, open change 4 in `clinical`: Approve
  is the most prominent control on the page, and there is no "Add a policy"
  button on that tab.

---

## Task 4 — Rewrite the git-flavoured prose

**Priority: high. Estimate: ~3h. Files: `apps/app/components/BinderChangePage.tsx`, `apps/app/components/DocumentChanges.tsx`, `apps/app/components/AppIcon.tsx` (or the icon call-sites).**

### Problem

**`BinderChangePage.tsx:200-202`** — when a change falls behind, the build says:

> **The binder has moved on since this change was made.** Bringing it up to date
> merges the binder's current main into it. Approvals already given are
> dismissed, because they were for different content.

The first and third sentences are excellent — plain, causal, and they explain why
approvals vanished, which is the part that would otherwise feel like a bug. The
middle sentence exposes `main`, a branch name, and "merges", a git operation.

**`DocumentChanges.tsx:111`** renders `#{change.number} submitted by {submitter}`.
The issue number is a GitHub artefact; to this audience it is noise that looks
like it should mean something.

**Branch-fork glyphs** mark every change row and the Open/Closed toggle. Outside
engineering the symbol is unreadable.

### Change

1. Rewrite the middle sentence in the register of the two around it. Suggested:
   _"Updating it will pull in everything published since — your reviewers will
   need to look again."_ Keep the button labelled "Bring up to date".
2. Drop the bare `#N` from the row. If the number is needed for support or for
   deep links, label it ("Change 8") or move it to the detail page. The row
   already carries the title, the submitter, the date and the document.
3. Replace the fork glyph with something that means "a proposed change" to a
   non-technical reader — a document-with-pencil, or simply the status dot the
   row already has. Audit `AppIcon.tsx` for other git iconography while there.

### Verify

- `bun run test:app` passes; update any test asserting on `#8`-style strings.
- `grep -rn "main\b" apps/app/components/*.tsx` surfaces no branch names in
  user-facing copy.

---

## Task 5 — A review queue that spans binders

**Priority: high. Estimate: ~1–2 weeks. Files: new route, new component, `apps/app/routes.ts`, `services/api` (new aggregate endpoint).**

### Problem

This is the mockups' most important structural idea and the build's largest gap.

Change requests exist only _inside_ a binder. To find work you either remember
which binder it was in, or you rely on Home — which shows a fixed, unsortable,
unfilterable list under "Waiting on you". There is no cross-binder queue, no
filter, no sort, no "everything blocked", no "everything I approved this month".

For a person whose job is "keep the policy manual current across four binders",
this is the screen they would live on, and it does not exist.

### Change

Frame `02 - Change Requests` is the reference. Build:

- A route — `/changes` — listing open changes across every binder the reader can
  see, with columns for the change, its binder, who requested it, approvals, when
  it moved, and status.
- Four counters across the top, doubling as filters: awaiting your review, in
  progress, approved this month, blocked.
- A filter control on the queue itself.

Two departures from the mockup, both deliberate:

- **Fill the status column with the build's sentences**, not the mockup's state
  names. "Carol Mendes asked for changes" beats "Blocked".
- **Carry the publish action onto the row**, exactly as Home does today. The
  mockup's queue ends at `Approved` with nothing to click, which drops the single
  most important action in the product.

**Correction, made while building this (PR #443).** This section originally
said the API needed a new aggregate endpoint. It does not.
`GET /api/app/home/changes` already returns every open change on every binder
the reader is involved in — Home filters that payload down to two sections
rather than the server sending a narrower one. The queue reads the same
endpoint, so it needs no new API and cannot disagree with Home about the state
of a change.

The real limit is the scoping, not the shape: "involved in" means the reader has
a change of their own in the binder, is a requested reviewer on one, or owns the
document. A binder they can see but have never been part of does not appear.
That is the right shape for a review queue — the work that concerns you, not a
feed of the organization — but the day the product wants "every change I have
permission to see", that needs a server-side search, not a wider filter on the
client.

### Verify

- New unit tests for the queue's grouping and filtering, in the style of
  `homeChanges.test.ts`.
- An integration test that opens `/changes` as `alice` and sees changes from both
  `clinical` and `corporate` in one list.

---

## Task 6 — The global sidebar shell

**Priority: medium — do it after Task 5. Estimate: ~1 week. Files: `apps/app/components/AppShell.tsx`, `apps/app/app.css`, `routes.ts`.**

### Problem

The build's entire global navigation is "Home · Documents · [org switcher]".
Everything else — people, sign-off rules, history, settings, activity, billing —
is reachable only by first entering a binder, or by typing a URL. A new user has
no way to learn what the product contains.

### Change

Adopt the mockups' sidebar, including its grouping, which is doing real teaching:

```
Home
Binders
Change requests
Discussions          (decided, deferred — see below)
── MANAGE
People & access
Activity
── SETTINGS
Organization
Billing
```

**The correction the mockups need:** they have no binder-scoped screen at all —
a list of binders, a global queue, and nothing in between. Keep the existing six
binder tabs underneath the sidebar. The sidebar's "Binders" entry leads to the
list; a binder leads to its own tabbed home. A binder is a place, and the data
model depends on it being one.

Sequencing note: build this **after** the queue, not before. The sidebar mainly
exists to point at global destinations, and until Task 5 lands there are only two.

**What shipped (PR #444), and two departures.**

_Discussions is not on it._ The question this section said to answer first has
since been answered — a discussion **is** a new object, not a view over review
threads — and the answer is that it is not MVP. Tracked in
[#445](https://github.com/davidgraymi/bindersnap-editor-demo/issues/445). Adding
the sidebar entry is a few lines once there is a page to point at.

_The top bar keeps its links._ `.app-sidebar` is `display: none` below 768px, so
moving navigation into it wholesale would have left small screens with none at
all. The top bar's links are now hidden **above** 768px instead, where the
sidebar carries the same destinations — exactly one navigation exists at any
width, and neither is duplicated. The organization switcher moved out of that
nav into its own box, because it is a control rather than a link and is wanted
at every width. There is an integration test for the breakpoint.

Mobile navigation is still thin. That is the gap below, not something this
closed.

### Verify

- Every existing route still resolves; `routes.test.ts` passes unchanged.
- The binder tabs are reachable and unchanged.
- Keyboard navigation reaches every sidebar item; focus order is sane.

---

## Smaller items, not yet scheduled

- **Search — done (PR #447), with a correction.** The review said to "bind ⌘K as
  well as `/`". **⌘K was already bound**, and had been: the review read the
  visible hint rather than the handler. What was actually wrong was narrower and
  more interesting — the hint _advertised_ `/`, which is the half a reader learns
  from, and the panel searched documents only. It now advertises ⌘K (both still
  work), and reaches binders and people as well as policies, grouped under
  headings. Documents come from the server; binders and people are two short
  lists filtered in the browser, because a search endpoint for a list of four
  binders is a round trip to filter an array.
- **Roles — already done, and the review was wrong about this.** It claimed the
  build "names roles after the Gitea teams underneath — `admins`, `authors`,
  `reviewers`". Those are the _team names in Gitea_; the interface has shown
  **Admin / Editor / Reviewer** with a one-line definition each since before this
  review, in `apps/app/binderSettings.ts`. The review looked at the wrong layer.

  It is also better than what the mockups drew, for reasons already written down
  there: **Reviewer, not Viewer**, because a reviewer approves and asks for
  changes and the free tier depends on that being understood without a footnote;
  and **Editor, not Author**, because "Author: Priya" on a policy Priya never
  drafted reads as a false attribution on a product whose output is evidence.

  The one thing still owed: group rows show their Gitea team names ("Clinical
  Authors") beside the correct level labels. A small leak, not scheduled.

- **Density.** The build is a single centred column of ~1200px; at 1440×900 the
  right half is empty on every page, and Sign-off rules is six lines in a full
  viewport. The mockups fill that space with a right rail — but with static
  onboarding copy ("Approval flow 01–04", "Discussion principles") that is dead
  pixels by week four. Take the instinct, change the payload: live context for
  the current screen — who is waiting and for how long, what changed since you
  last looked, which version this becomes on publish.
- **Mobile.** At 390px the build shows a raw slug in the top bar, no search, no
  notifications, no account control, and no bottom navigation. The mockups have
  no mobile frame at all. For a product whose central act is a named person
  signing off, approving from a phone is not an edge case. Worth a frame before
  the desktop IA locks, because sidebar and bottom-tab navigation want different
  architectures.
- **Discussions as a first-class object — decided, and deferred.** It is a new
  object. The threads on a change request resolve, and their resolution is
  evidence that gates publishing; a discussion is a question that never resolves,
  gates nothing, and outlives the change it may not even be about. Modelling
  either as the other would mean giving discussions a resolution they do not have
  or taking it off the threads that need it. **Not MVP** — the decision and the
  open questions are recorded in
  [#445](https://github.com/davidgraymi/bindersnap-editor-demo/issues/445).
  One caution for whoever builds it: the mockup's `03 - Discussions` frame draws
  a **Resolved** tab, which contradicts this and should not be built as drawn.

---

## Known gaps in this review

- **Mockup fidelity.** The four frames are static and unannotated — no states, no
  empty states, no errors, no loading, no responsive behaviour. Where a frame is
  silent, this document says so rather than guessing.
- **Screens neither side has drawn.** Onboarding and first run, the authoring and
  upload flow, notifications, billing and the paywall state, and the read-only
  auditor experience — the last of which is a seeded persona (`dan`) in the
  project's own fixtures and appears in neither artefact.
- **Accessibility.** Not audited. The tokens carry documented contrast ratios,
  which is a good sign, but keyboard paths, focus order and screen-reader
  labelling were not verified on any screen. Worth its own pass.
- **A layout bug in the Figma file.** In all four frames the right rail is drawn
  overlapping the fourth summary card, clipping "Pro plan", "1 Blocked" and
  "4 Viewers". Treated here as an error rather than intent — worth confirming
  before the frames are handed to anyone as a specification.

---

## Rendered report

The version with the side-by-side screenshots — build against mockup, on the
same screens — is published as an artifact:

<https://claude.ai/code/artifact/f4b78fd9-8b86-49fc-a201-ff5d2ed17351>

It is not committed here: it carries ~0.7 MB of embedded PNG evidence, which does
not belong in the repository. The markdown above is the source of truth for the
work; the artifact is the source of truth for what the screens actually looked
like on `9aef399`.
