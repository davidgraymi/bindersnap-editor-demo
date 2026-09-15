# The binder, redrawn — decision record and build plan

**Design phase. No application code was changed.** The deliverable is this
document plus ten screens in
[`mockups/binder/`](mockups/binder/index.html), which share one stylesheet —
[`mockups/binder/binder.css`](mockups/binder/binder.css). That stylesheet is
the build spec: every class in it is a class we would ship, and it imports the
real `bindersnap-tokens.css` rather than restating its hex values, so a mockup
cannot drift from the product's palette.

Drawn against `feat/adr4-documents-as-files` at `82d1786`, driven in a real
browser on a real stack at 1440×900, signed in as the seeded `alice`. Every
defect named below was seen on screen, not inferred from the stylesheet.

Read `AGENTS.md`, ADR [0004](adr/0004-organization-workspace-folder-and-org-billing.md)
and [0005](adr/0005-document-identity-and-version-tags.md), and
[`handoff-binder-editing.md`](../handoff-binder-editing.md) first. Nothing here
reopens a decision recorded in any of them.

---

## The brief

> Making edits to a binder isn't a smooth, seamless, and pleasant experience.
> Most importantly, it isn't as organized as I would like it to be. […] the
> tabs we have to navigate the binder, change request, people settings, etc.
> aren't great. […] Right now our left side bar is great and intuitive, but the
> content it renders is not so great and looks like a different web page.

Two complaints, and the second explains the first. Editing does not feel fast
because the page it happens on is not organised; and the pages are not
organised because the six binder tabs were built one at a time, each inventing
its own containers, headings and labels.

---

## Verdict

**The binder's problem is not its features. It is that six tabs were drawn as
six web pages, and the deepest ones pay for it twice.**

Every tab works. Several are genuinely good — the tree, the change list, the
document preview. But walking Documents → People → Sign-off rules → Settings
crosses four different container idioms, three heading styles and two label
conventions in four clicks, and nothing about the product's craft survives that
walk. The parts a person spends their day in — editing the tree, deciding a
change — are the two worst laid out, because they inherited the binder's
header, its title and its tab bar on top of their own.

| Dimension                     | Where it stands                                                                        |
| ----------------------------- | -------------------------------------------------------------------------------------- |
| Global navigation (sidebar)   | **Right, and keep it.** The brief says so and the brief is correct                     |
| Binder navigation (six tabs)  | **Wrong shape.** Rare configuration drawn as a peer of daily work; the subject demoted |
| Content inside the tabs       | **No shared grammar.** Four container idioms, three heading styles, two label styles   |
| The editing flow              | **Right model, wrong staging.** The customer's design is built; the screen fights it   |
| Status writing, palette, type | **Better than anything I would replace it with.** Do not touch                         |

---

## What is already right — do not change these while fixing the rest

Restating the guardrails from [`figma-vs-build-review.md`](figma-vs-build-review.md),
because this pass is close enough to them to break one by accident:

- **The type and colour system.** Lora display, Geist body, warm paper, a
  considered coral. Unchanged here.
- **The status vocabulary.** "Ready to publish", "1 more approval needed",
  "Carol Mendes asked for changes". Every sentence says what happens next or
  who you are waiting on, by name. This pass changes how those sentences are
  _set_ — not one word of what they say.
- **The comparison view.** Untouched. It is the strongest screen in the product.
- **The binder as a place.** ADR 0004's "one set of rules, one set of people"
  needs a binder-scoped level, and it keeps one. Moving its navigation into the
  sidebar is not deleting the level — the binder gets a whole sidebar section.
- **Drafts, the tree, edit mode, drag-to-move, archive and restore.** The
  customer's model, already built and reviewed. Every decision in §3 of the
  handoff holds. This changes where things sit, never what they do.

---

## The diagnosis, with the evidence

### 1 · The page's only `h1` names the binder, not the subject

`BinderShell.tsx:344` renders the binder's name as the page `h1` in Lora 26,
above a tab bar, on **every** screen the binder contains. Below it:

- a **policy** renders its own name as a second `h1`, also Lora 26
  (`BinderDocumentPage.tsx:226`) — two `h1`s, the same size, and the second one
  is the subject;
- a **change request** renders its title as an `h2` at Lora **22**
  (`DocumentChangeDetail.tsx:381`) — so the page's only `h1` is the binder, and
  the thing the page is actually about is a smaller heading one rank down.

Measured on the running stack at 1440×900, on change 4 in `clinical`: the top
nav ends at 64px, the binder header at **245px**, and the change's own title
does not begin until **433px** — 48% of the viewport spent before the subject
appears. The same chrome repeats on all six tabs.

```
Riverside Health
Clinical                        ← the only <h1>, Lora 26, and not the subject
Clinical and administrative policies — one set of rules, one set of people.
Documents 4 │ Change requests 3 │ People │ Sign-off rules │ History │ Settings
The binder has moved on since this change was made. …      ← see defect 5
← All changes
Monthly audits, fourteen-day training, …    ← <h2>, Lora 22, at y = 433
```

### 2 · Six tabs, and three of them are the same thing

`BinderShell.tsx:302-316`. **Documents** and **Change requests** are where the
work is. **People**, **Sign-off rules** and **Settings** are all one question —
how this binder is governed — split three ways, and each is visited a handful
of times a year. Drawing them as peers of Documents says a thing somebody edits
twice a year is a peer of the thing they open every morning.

It also costs: six tabs is enough to wrap below 768px, which is the bug PR #450
had to fix by making the strip scroll sideways.

### 3 · No shared container grammar — the complaint, precisely

One screenshot each, and they are four different products:

| Tab                 | What holds the content                                                                                                                  |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Documents**       | One bordered card, rows on hairlines                                                                                                    |
| **Change requests** | A segmented filter floating **above** a bordered card                                                                                   |
| **People**          | A `<fieldset>` with its legend on the border, then a card of rows, then an add-form **loose on the paper**, then a full-bleed group row |
| **Sign-off rules**  | A filled tinted box, then a heading with buttons **loose on the paper**                                                                 |
| **History**         | A bare timeline spine, **no container at all**                                                                                          |
| **Settings**        | A 380px input with its Rename button dropped onto the **line below it**, an unstyled `<ul>`, a bare `<input type=checkbox>`             |

Settings is the worst of them and the most telling: the whole page uses about
520px of a 1080px column, the Rename button sits below the field it acts on —
breaking the one-row-one-control-size rule PR #468 built a test for — and
`describeBinderRules` renders as an unstyled bullet list.

### 4 · The marketing eyebrow is standing in for a form label

`.bs-label` is coral, uppercase, monospace, `letter-spacing: wide`. It is the
landing page's section eyebrow. It has **26 call sites in the app**, and they
are ordinary in-app labels:

```
WHAT YOU ARE ASKING FOR      ProposeChangePage.tsx:89
WHY — OPTIONAL               ProposeChangePage.tsx:106
CHOOSE FILE                  AddPolicyModal.tsx
WHAT IT IS CALLED            AddPolicyModal.tsx
WHO CAN SEE THIS BINDER?     BinderPeople.tsx
```

PR #443's Task 1 took `--brand-font-mono` in `app.css` from 81 declarations to 12. It did not reach `.bs-label`, because `.bs-label` lives in the token file
and is applied from TSX. The mono is still on the labels; it just moved house.

Alongside it, `.doc-rail-title` — a class named for the document page's
**rail** — is used as the page section heading on People, Sign-off rules,
Settings and the change page: 15 call sites, 9 of them on binder tabs. A rail
heading is small, muted and uppercase. As a page heading it is why those
sections read as captions rather than as sections.

### 5 · The change request buries the decision and leads with a warning

On `BinderChangePage.tsx`:

- The "binder has moved on" banner renders at line 200 — **above** the
  `← All changes` link, so the first sentence on the page is about a state you
  have not yet been told you are in.
- The approval count and meter float top-right and **collide with the title**
  when it wraps to two lines, which it does at any realistic length.
- `Approve` is a ghost pill. Putting your name on a policy permanently is the
  most consequential act in the product and it is styled as secondary.
- Everything needed to decide — what is proposed, who is waiting, what is in
  the way, the two buttons — is scattered down a single column between
  comments.

### 6 · Editing works, and the screen fights it

The model is right and is the customer's own. The staging is not:

- **The draft bar is a tall coral box wedged between the tab bar and the
  tree.** It pushes the work down the page and spends the screen's one coral
  element on a status message.
- **The header buttons change identity under the cursor.** Reading:
  `[Add a policy] [Edit]`. Editing: `[New folder] [Add a policy]`. The control
  in the primary slot changes meaning the moment you press the control beside
  it.
- **Row actions are three 14px glyphs at the far right at low opacity.** Rename,
  Move and Archive — the three acts the whole feature exists for.
- **The propose page leaves the draft bar above it carrying a disabled Propose
  button**, so the step has two Propose affordances and the nearer one is dead.
- **Add a policy is the browser's own `Choose File / No file chosen`** on the
  product's primary act. A policy manager drags a `.docx` in from the window
  behind; there is nothing to drag onto.
- **The draft is invisible on the tree.** Which rows you have touched exists
  only as a list of sentences in the bar, so checking your work means reading
  prose instead of looking at the thing you changed.

---

## The decisions

### D1 · Binder navigation moves into the sidebar. The tabs go.

**Decided by the customer, 15 Sep 2026.**

The sidebar gains a binder section when you are inside a binder, and loses it
when you leave:

```
Home
Change requests   5
Documents
Binders
── ▸ Clinical ─────────
   Policies        4
   Changes         3
   History
   Settings
── MANAGE
   People & access
   Activity
── SETTINGS
   Organization
   Billing
```

Three consequences, all of them the point:

1. **The page's one title belongs to its subject.** A policy is titled
   `Infection Control Policy`. A change request is titled by what it asks for.
   The binder is named once, in the sidebar, where it stays put.
2. **Four entries, not six.** People and Sign-off rules become sections inside
   Settings, which keeps its own index so neither is buried. See D5.
3. **A binder is still a place.** It owns a whole labelled section of the
   sidebar, which is a stronger statement of the ADR 0004 level than a tab
   strip was — and it answers the correction
   [`figma-vs-build-review.md`](figma-vs-build-review.md) made to the Figma
   mockups, which had no binder-scoped screen at all.

**Below 768px this is the bottom bar's job, unchanged.** The sidebar is
`display: none` there and PR #450's bottom bar carries the four destinations.
The binder's own sections become a scrolling strip under the page title on
small screens — the same shape the tab strip has now, which already works.

**"Policies", not "Documents", for the binder's own section.** Two entries both
reading "Documents" one above the other is a worse map than no map. The
product's own copy already says policy everywhere it matters — "Add a policy",
"2 archived policies" — and the ICP says policy manual. Global stays
"Documents". _Flagged as a wording call in Open questions._

### D2 · Three containers. Everything on every binder screen is one of them.

This is the answer to "it looks like a different web page", and it is the whole
of it. `binder.css` defines exactly three, and nothing else may hold content:

| Container    | For                                                                                                                                                                                | On                                                            |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `.bs-panel`  | a bordered card of `.bs-row`s, with an optional `.bs-panel-bar` at the top for the controls that filter or act on it, and an optional `.bs-panel-foot` for the act that adds to it | the tree, changes, people, groups, versions, rules, approvals |
| `.bs-fields` | a form block: `.bs-field-label`, control, `.bs-field-hint`                                                                                                                         | settings, propose, modals                                     |
| `.bs-note`   | a tinted explanatory block                                                                                                                                                         | empty states and consequences **only**                        |

The rules that make it hold:

- **A control that acts on a list lives in that list's own bar.** Never floating
  on the page above it. This is what makes Changes and Documents and People
  read as one product.
- **The add-form is the panel's footer**, not a row of controls under it.
- **One row height** (46px), one hairline, one hover. A folder, a policy, a
  change, a person, a version and a rule are all `.bs-row`.
- **`.bs-note` disappears when it has nothing to explain.** The sign-off empty
  state earns its keep precisely because it vanishes the moment a rule exists;
  a permanent explanatory rail is the mistake the Figma mockups made.

### D3 · One heading scale, and the eyebrow never appears in the app

- **One `h1` per screen** — `.bs-title`, Lora 26. Nothing inside a page may
  outrank it. (PR #469's rule; D1 is what finally lets it be true.)
- **`.bs-section-title`** — Geist 15/600, **sentence case**. Never mono, never
  uppercase, never coral. It replaces `.doc-rail-title` as a page heading at
  all 15 call sites.
- **`.bs-field-label`** — Geist 13/600, sentence case. It replaces `.bs-label`
  at all 26 in-app call sites. `.bs-label` stays exactly as it is, on the
  landing page, where it is right.
- **`.bs-crumbs`** — Geist, muted. `nursing / Infection Control Policy` is
  monospace today, which reads as a file path.

Monospace survives in three places in the binder and nowhere else: a filename,
a version number (`v2`), and the `⌘K` hint. Those are machine text.

### D4 · `.bs-status` loses its uppercase monospace

Not a new class — an **amendment to the shipped one** in
`bindersnap-tokens.css`, keeping all seven tone names (`--working`,
`--review`, `--waiting`, `--approved`, `--published`, `--changes`,
`--declined`, `--withdrawn`) and every string they carry.

`READY TO PUBLISH` reads as machine output. "Ready to publish" reads as an
answer. It is the loudest developer-tool signal left in the binder and it is on
every row of every list. A pill radius and a tone border carry the chip at
least as well as the letterspacing did.

### D5 · Settings holds four sections, with its own index

People · Sign-off rules · How changes are approved · Name and description.

A left index inside the page, `.bs-subnav`, keeps them separate without
spending four sidebar entries on configuration somebody visits twice a year.
This is the same call the 2026-08 workspace redesign made when it merged Team
and Settings into "Access & approvals" — it just has four things to merge now
instead of two.

**"How changes are approved" is drawn with the required-approval count as an
editable control.** It is not editable today (`BinderSettings.tsx` says so in a
sentence). Drawing it is deliberate: the section is incoherent without it, and
it is Gitea branch protection, which the BFF already writes. _Flagged in Open
questions._

### D6 · The decision moves into a rail; the floating pill retires

On a change request, everything needed to decide goes in one sticky right rail,
in the same order on every change: **proposed version → approvals → what is in
the way → Approve / Ask for changes.**

The pill floated because it was the only home the decision had. Given a sticky
rail it is on screen at every scroll depth anyway — and it stops covering the
comment somebody is reading _in order to_ decide.

`Approve` becomes a filled green button. Green means approval in this product
and nothing else, so the most consequential act gets the most weight without
taking the page's coral, which belongs to the next step rather than the
irreversible one.

### D7 · Editing: same page, same buttons, quieter chrome, louder targets

The model does not change. Five staging changes:

1. **The draft bar becomes a sticky footer.** Reachable at any scroll depth,
   never between you and the tree. Propose stays the filled button — it is the
   only control that finishes the work.
2. **The header keeps the same buttons in the same slots.** `[Add a policy]`
   and `[Edit]`; Edit becomes `Done` while editing. New folder joins Add a
   policy in the panel bar, next to the tree they act on.
3. **Row actions are 28px targets** with a visible affordance on hover and a
   reachable focus state. Archive is the only one tinted danger.
4. **The draft is legible on the tree.** A row you have renamed, moved or added
   carries a 5px coral dot and a one-line `.bs-row-meta` saying what happened
   to it. Checking your work becomes looking, not reading.
5. **A row somebody else has open in a change says so before you touch it** —
   `.bs-row--contested`. This is the cheapest honest answer to the question
   §4.1 of the handoff left open ("a marked row and a sentence, not a
   refusal"), and it costs nothing: `openChangeCount` is already on every row.

And two on the ends of the flow:

- **Add a policy gets a real dropzone**, with the name derived from the file
  and shown as editable rather than demanded before the file is picked, and the
  folder a picker of folders that exist rather than a free-text path.
- **The propose page owns its step.** The draft bar is gone there. What is
  actually in the envelope — the acts — is listed in a rail beside the form,
  because an author who has been editing for twenty minutes cannot check a
  prefilled paragraph against what they meant to send.

### D8 · History gets a filter and an export

It is the page a surveyor is shown and it had neither, which is the one thing
the audit-trail-is-the-product claim actually owes. A policy filter, a date
range, and Export. The spine stays — it is the right shape for a record read in
time order, and it is the one idiom here no other screen wanted.

---

## The screens

All ten open from [`mockups/binder/index.html`](mockups/binder/index.html).

| Screen               | File                                                              | What it settles                                                                      |
| -------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Policies             | [`documents.html`](mockups/binder/documents.html)                 | The panel + bar grammar; one title; the archive link where it is asked about         |
| Policies, editing    | [`documents-editing.html`](mockups/binder/documents-editing.html) | D7 entire — sticky draft bar, stable header, real targets, dirty rows, contested row |
| Add a policy         | [`add-policy.html`](mockups/binder/add-policy.html)               | The dropzone, and the modal grammar                                                  |
| Propose your changes | [`propose.html`](mockups/binder/propose.html)                     | Sentence-case labels, the acts rail, reviewers chosen before sending                 |
| Change requests      | [`changes.html`](mockups/binder/changes.html)                     | The filter inside the panel bar; the status sentence on every row                    |
| One change request   | [`change.html`](mockups/binder/change.html)                       | D6 entire — the decision rail, the warning in it, green Approve                      |
| One policy           | [`document.html`](mockups/binder/document.html)                   | The rail's three blocks; "who signs this off" where it is read                       |
| History              | [`history.html`](mockups/binder/history.html)                     | D8 — filter, range, Export, spine kept                                               |
| Settings · People    | [`settings-people.html`](mockups/binder/settings-people.html)     | Four container idioms become one; the add-form as panel footer                       |
| Settings · Rules     | [`settings-rules.html`](mockups/binder/settings-rules.html)       | Sign-off, approval and the name, in one grammar; the rename row fixed                |

Two things the mockups are honest about and a Figma frame would not be: a rule
that is holding nothing says so **on its own row** rather than in a paragraph
above the list, and a group with no members says so on the row that grants it.
Both are states the build already detects and currently reports in prose
somewhere else.

---

## Open questions — the customer's, not ours

1. **"Policies" or "Documents" for the binder's own section?** Drawn as
   Policies, because two sidebar entries reading "Documents" is a worse map
   than none, and the product's copy already says policy. ADR 0004's vocabulary
   is document. One word, changed in one place.
2. **Should the required-approval count become editable?** Drawn as editable.
   It is Gitea branch protection and the BFF already writes it, but it is new
   behaviour rather than a presentation change, and it is the one thing in
   these ten screens that is.
3. **Does the floating decision pill go?** Drawn as gone, replaced by the
   sticky rail. The pill's survives-scrolling property is the reason
   [`figma-vs-build-review.md`](figma-vs-build-review.md) told us to keep it,
   and the rail has that property too — but it was drawn, not measured, and it
   is worth a look on a long change before it is deleted.
4. **Does "Everyone at Riverside Health" stay a radio pair?** Kept, for the
   reason `BinderPeople.tsx` already gives: the two states are a choice
   somebody made, not an on and an off.

---

## Build order

One branch and one PR each, on `feat/adr4-documents-as-files`, smallest first.
Each is independently shippable and each leaves the product coherent.

1. **The grammar, and nothing else.** Add `.bs-panel` / `.bs-fields` /
   `.bs-note` / `.bs-row` / `.bs-section-title` / `.bs-field-label` to
   `app.css`. Amend `.bs-status` in the token file (D4). No component changes.
   Reviewable as a stylesheet diff.
2. **Settings absorbs People and Sign-off rules.** `BinderSettings.tsx` gains
   `.bs-subnav`; `BinderPeople.tsx` and `BinderSignOff.tsx` become its
   sections. Rebuild all three on the grammar. Biggest single win: three of the
   six worst screens, one PR.
3. **The other three tabs onto the grammar.** Documents, Change requests,
   History — plus D8's filter and Export. Mostly deletion.
4. **The sidebar takes the binder** (D1). `AppSidebar.tsx` gains the binder
   section; `BinderShell.tsx` loses its `h1`, its subtitle and its tab bar;
   each page grows its own `.bs-pagehead`. Routes are untouched —
   `?tab=people` keeps resolving, it just lands somewhere that draws it
   differently. The small-screen strip is part of this PR, not a follow-up.
5. **Editing** (D7). The sticky draft bar, the stable header, the row targets,
   the dirty and contested rows, the dropzone, the propose page.
6. **The change request** (D6). Largest and last, because it is the only one
   that wants the rail primitive the four before it will have proved.

`tests/design-consistency.pw.ts` is where each of these is held: it already
walks the screens and measures, and every rule in it was checked by
reintroducing the defect and watching it fail. Three rules to add —

- no `.bs-label` inside `.app-main`;
- every binder screen has exactly one `h1`;
- no content-bearing element outside `.bs-panel` / `.bs-fields` / `.bs-note`.

The third is the one that makes D2 true a year from now rather than this week.
Write each by putting the defect back first.
