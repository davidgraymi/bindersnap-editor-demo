# The binder, redrawn — decision record and build plan

**Design phase. No application code was changed.** The deliverable is this
document plus eleven screens in
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
[`handoff-binder-editing.md`](../handoff-binder-editing.md) first.

**Revised 16 Sep 2026** after the customer's review. One decision recorded in
the handoff is now reopened, at their request and only theirs: §3's "one draft
per person per binder". See D9. Everything else in those documents still
holds.

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
──────────────────────
▸ Clinical         4      ← the entry AND the binder's contents
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

**There is no "Policies" entry, because the binder's own name is it.** A binder
is its contents: pressing Clinical opens what is filed in Clinical, the way
pressing a folder opens the folder. A child entry repeating its parent is a
second row going to the same place one indent further in — and it sat directly
under the global "Documents", which is a different list entirely.

Three consequences, all of them the point:

1. **The page's one title belongs to its subject.** A policy is titled
   `Infection Control Policy`. A change request is titled by what it asks for.
   The binder is named once, in the sidebar, where it stays put.
2. **Three entries under the binder, not six tabs.** People and Sign-off rules
   become sections of one Settings page. See D5.
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
- **`.bs-crumbs`** — Geist, muted, and on a **change request only**. It is
  gone from a policy: the sidebar already says which binder, the folder is not
  a place you navigate back to, and `nursing / Infection Control Policy` above
  `Infection Control Policy` was the title twice with a path in front of it.
  A change request keeps one, because "Change 4" is not a name and the way
  back to the list is worth a row.

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

### D5 · Settings is one page, one scroll, six blocks

Name · description · who can see it · people · groups · sign-off rules ·
approval.

**No secondary navigation.** An index down the left was solving a problem the
page does not have: this is six short blocks, not six pages, and an index to
reach something already visible on screen adds a click to save none. It also
spent the page's left third on navigation, which is why the content was
crowded into 560px.

The page is `.bs-page--narrow` (860px) rather than the full 1120px, because a
settings page is a form and a form wants a measure. At full width a person's
row puts their name at one edge and their role dropdown at the other with
900px of paper between, and a name field either runs to 1120px — which no name
needs — or sits at 560px beside panels twice its width and leaves the page
visibly ragged.

**"How changes are approved" is drawn with the required-approval count as an
editable control.** It is not editable today (`BinderSettings.tsx` says so in a
sentence). Drawing it is deliberate: the section is incoherent without it, and
it is Gitea branch protection, which the BFF already writes. _Flagged in Open
questions._

**People, Groups and Sign-off rules are one shape.** Each is a panel of rows
with a single footer that adds to it: pick the thing, pick the level, Add. They
had three shapes — People had the footer, Groups had a button in its section
heading, and Sign-off rules had a different button in _its_ heading. Adding a
person and adding a group are the same act on the same page and now look like
it. The rule footer's first picker is also where "a rule can cover the whole
binder, one folder, or a single document" finally becomes visible without
opening anything.

**One Save, under the description, for both fields.** A `Rename` button beside
the name said the name was a different kind of thing from the description
under it — two commits for one edit, and the second field with no way to commit
it at all.

**No state pills on a sign-off rule.** A rule that is on this page _is_ the
binder's rule; an `Enforced` chip on every row is the page repeating its own
title once per line.

One caveat, recorded because it is a correctness question rather than a
styling one: `Enforced` and `Holding nothing` were saying different things.
The second is a real defect — a rule naming a group with **no members** waits
for nobody and lets the publish through, and this is the only screen in the
product that could ever say so. The pill is gone; the fact is not. It is the
row's own meta line now: _"The Compliance group, which has nobody in it."_

**Most of the explanatory notes are gone.** "Links to the old name keep
working", "Who changed it, and when, is recorded", "A group is one object
across every binder it reaches" — each was true, and each was us talking over
the customer's own screen. A settings page is read by somebody who came to
change one thing. The sentences that survive are only the ones that change
what you would **do**: a rule holding nothing, and that changing the rules
needs an approval.

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

**Required and optional reviewers are marked, and it is real state rather than
a label we invent.** Gitea writes a review request for every `.gitea/CODEOWNERS`
rule matching a changed file, read from the **base** branch — so a sign-off
rule puts its owners on a change automatically, the moment it opens. Whether
that request _blocks_ is the part the interface has to read rather than assume:

- a **user** code owner is an official request and blocks the merge;
- a **team** code owner is written and then has its own `official` flag cleared
  by Gitea (`AddTeamReviewRequest`, still true on 28.0.0), so under the
  officialness gate it blocks nothing;
- on 28.0.0 `blockOnCodeownerReviews` ignores officialness entirely, and under
  that gate a team code owner does block.

**Only "Required" is marked.** A reviewer with no marker is one nothing is
waiting on, which is what "optional" means — printing the word on every other
row is labelling the absence of a constraint. Same on the propose page.

`RepoBranchProtection` already carries `blockOnOfficialReviewRequests` and
`blockOnCodeownerReviews`, so the binder knows which of those two worlds it is
in and the rail can say "Required" only when it is true. **A required marker
that is wrong on a compliance product is worse than no marker**, so this is the
one place the build must read the flags rather than infer from CODEOWNERS
alone. The same distinction is drawn on the propose page, where required
reviewers are listed before the change exists — which is what stops "why is
Priya on this" being the first reply.

**The author can edit the title and the description.** An icon button beside
the title, drawn for the author and only while the change is open. A change
request is open for days and the first thing a reviewer's question produces is
a better title; once it is published the title is on the merge commit and in
the version tag, which are the record.

**A reviewer's state is a glyph, not a sentence in a pill.** "Asked a question"
spelled out in a chip beside a name is a paragraph doing an icon's job, three
times down one rail. The state lives in the `title` and the accessible name.
`React` on a comment goes the same way, to the glyph it already is in every
other product a reader has used.

**The rail names the rules and links to them.** "Required reviewers come from
this binder's [sign-off rules]" — the answer to "why is Priya on this" is one
click from the row that raises it, rather than a sentence telling you the
rules exist and leaving you to find them.

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
4. **The draft is legible on the tree, and nothing else is.** A row you have
   touched carries a 5px coral dot. Versions, open-change counts and
   "moved here from …" notes are all **gone from edit mode**: while you are
   rearranging a binder the only state that matters is what you have touched,
   and everything else on the same line is noise to read past to find your own
   work. What each act actually did is in the draft bar, once, and on the
   propose page, once.
5. **One "Add a policy", and it is next to the tree it adds to.** It was in the
   header _and_ in the bar over the list; two of one control on a screen is one
   of them in the wrong place, and the wrong one is the one not beside the
   thing it acts on. The header keeps a single button, and it is the way out.
6. **The archive opens in the tree, with Restore on the row.** It was a page of
   its own reachable only from the reading view — so edit mode, the one place
   somebody can act on what they find, had no way in and no way back. Restore
   is an ordinary change rather than an undo: the policy returns at the
   filename it left with, keeping its identity, so the button says
   "Restore as v3" and the effect on the history is not a surprise. Restore is
   never hover-revealed: hover-reveal is for the secondary acts on a row you
   are reading, never for the only one.

And two on the ends of the flow:

- **Add a policy gets a real dropzone**, with the name derived from the file
  and shown as editable rather than demanded before the file is picked, and the
  folder a picker of folders that exist rather than a free-text path.
- **The propose page owns its step.** The draft bar is gone there. What is
  actually in the envelope — the acts — is listed in a rail beside the form,
  because an author who has been editing for twenty minutes cannot check a
  prefilled paragraph against what they meant to send.

### D8 · A person can have several drafts, and picks between them

**This reopens a decision, at the customer's request.** The handoff's §3 says
one draft per person per binder, and that pressing Edit twice resumes rather
than forks. The reason to change it is good: two unrelated reorganisations
should not have to be proposed in one change request because the same person
did both.

It is a small change to make and a real one to decide:

- A draft is already `draft/<username>/<stamp>`, so several per person are
  representable without changing what a draft is. **The stamp stops being
  defensive and starts being load-bearing.**
- `openDraft` must stop resuming the first draft it finds, and
  `resolveOwnDraftBranch` must take the branch from the request rather than
  assuming there is one.
- **A draft needs a name its author wrote**, which it needs anyway: "resume the
  one from Tuesday" is unanswerable when both are called `draft/alice/…`. That
  name is also the change request's prefilled title when it is proposed.
- Everything else in §3 survives unchanged, including the two that matter most:
  a draft stops being a draft the moment a change request sits on it, and other
  people's drafts are visible as existing and never as contents.

The picker is the only new chrome. `drafts.html` draws it open.

### D9 · History is the binder's changes, and a document's versions live inside them

The version tag on the spine was what made this page read as a jumble, and it
was worse than untidy — it was misleading. Five entries reading
`v1 · v1 · v1 · v2 · v1` look like a sequence and are five unrelated documents'
first versions. Nothing counts up, because **a version belongs to a document
and this timeline belongs to a binder.**

What does count up on a binder's timeline is the change request. So:

- **The knot is the change number**, and it links to the change.
- **Inside each entry are the versions that change wrote** — one row per
  document, read straight out of the version tags on the merge commit, which is
  where a change publishing several documents at once already records what it
  did to each. A change that archived something gets a row for that too; the
  `<uid>/archived-<n>` tag is written in the same pass.
- **The two histories come out of one structure.** The binder's is the spine.
  A document's is the same spine filtered to the changes that wrote a version
  of it — which is what the picker in the bar does — and _its_ versions then do
  read as the sequence they are, because they are one document's.

Plus a date range, and **Export as an icon**. Export is the honest reason this
page exists on an audit product and it was not on it at all.

### D10 · A word is not a label for an act its icon already names

`Download`, `Export` and `React` become icon buttons — `.bs-actionbtn`, sized
like `.bs-btn--sm` so a row of controls stays one height, each with an
`aria-label` and a `title`. A download arrow with the word "Download" beside it
is the word twice.

This does **not** generalise to every button. `Approve`, `Propose`, `Save`,
`Restore as v3` keep their words, because the icon for each is either ambiguous
or invented. The test is whether the glyph is one a reader already knows from
somewhere else.

The same test cuts the other way on labels: `+ Ask somebody else to look` is a
sentence next to a plus sign that already says "add". It is `+ Reviewer`.

### D11 · Nothing lifts on hover

The shipped `.bs-btn:hover` raises the button 1px. On a marketing page that
reads as playful; in a dense tool it reads as instability — a row of controls
that all twitch as the pointer crosses them. Hover is a colour change and
nothing else. One deletion in `bindersnap-tokens.css`.

### D12 · A policy's row says what last changed it, and when

The status pills are gone from the contents list. Four rows each carrying a
coloured chip made a list of four policies look like a list of four problems —
and "1 open change" is not a property of the policy. It is a property of a
change request, which has its own page and its own sidebar entry with the
count already on it.

What replaces them is the question a file list is actually opened with: **the
subject of the change that last touched this, linking to that change, and how
long ago.** "3 weeks ago" rather than a timestamp, for the same reason every
file list does it — the answer wanted is usually "recently" or "not recently".

---

## The screens

All eleven open from [`mockups/binder/index.html`](mockups/binder/index.html).

| Screen                  | File                                                              | What it settles                                                                |
| ----------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Clinical (the contents) | [`documents.html`](mockups/binder/documents.html)                 | The panel + bar grammar; the binder's name as the title; D12's row             |
| Clinical, editing       | [`documents-editing.html`](mockups/binder/documents-editing.html) | D7 entire — sticky draft bar, one header button, real targets, the archive     |
| Which draft             | [`drafts.html`](mockups/binder/drafts.html)                       | D8 — several drafts, the picker open, somebody else's listed and inert         |
| Add a policy            | [`add-policy.html`](mockups/binder/add-policy.html)               | The dropzone, and the modal grammar                                            |
| Propose your changes    | [`propose.html`](mockups/binder/propose.html)                     | Title, description, reviewers — and required reviewers named before it exists  |
| Change requests         | [`changes.html`](mockups/binder/changes.html)                     | The filter inside the panel bar; the status sentence on every row              |
| One change request      | [`change.html`](mockups/binder/change.html)                       | D6 entire — the decision rail, required vs optional, green Approve, edit title |
| One policy              | [`document.html`](mockups/binder/document.html)                   | The rail's three blocks; "who signs this off" where it is read                 |
| History                 | [`history.html`](mockups/binder/history.html)                     | D9 — the change is the knot, the versions it wrote are inside it               |
| Settings                | [`settings.html`](mockups/binder/settings.html)                   | D5 — six blocks, one scroll, no secondary navigation, the notes culled         |

Two things the mockups are honest about and a Figma frame would not be: a rule
that is holding nothing says so **on its own row** rather than in a paragraph
above the list, and a group with no members says so on the row that grants it.
Both are states the build already detects and currently reports in prose
somewhere else.

---

## Answered in review, 16 Sep 2026

**Who can grant a group access to a binder?** Binder administrators, and
nobody else — and it is Gitea's answer rather than ours.
`PUT /teams/{id}/repos/{org}/{repo}` refuses anyone without admin on the
repository (`handleBinderGroup`, `services/api/server.ts`). The payload's
`canManage` is `access.admin`, so the button is simply not drawn for anybody
else. An organization owner has it everywhere, implicitly, through `Owners`.
**Correct as built; nothing to change.**

**Does Gitea automatically add CODEOWNERS as reviewers?** Yes. It writes a
review request for every rule in `.gitea/CODEOWNERS` matching a changed file,
read from the **base** branch, when the change opens. The nuance that matters
for the "Required" marker is which of them actually block — see D6. Short
version: a **user** code owner blocks; a **team** code owner does not under the
officialness gate (Gitea clears its own `official` flag — still true on 28.0.0)
and does under 28.0.0's `blockOnCodeownerReviews`. Both flags are already on
`RepoBranchProtection`, so the rail reads which world the binder is in rather
than guessing.

---

## Still open — the customer's, not ours

1. **Several drafts per person** (D8) reopens the handoff's §3. Drawn as
   asked. It is four small server changes and one new field — a draft's name —
   but it is a model decision, not a presentation one, and it should be
   confirmed before it is built.
2. **Should the required-approval count become editable?** Drawn as editable.
   It is Gitea branch protection and the BFF already writes it, but it is the
   one thing in these eleven screens that is new behaviour rather than a
   presentation change.
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
   `.bs-note` / `.bs-row` / `.bs-section-title` / `.bs-field-label` /
   `.bs-actionbtn` to `app.css`. Amend `.bs-status` (D4) and delete the hover
   lift (D11) in the token file. No component changes — reviewable as a
   stylesheet diff.
2. **Settings becomes one page.** `BinderPeople.tsx` and `BinderSignOff.tsx`
   fold into `BinderSettings.tsx` as sections; all three rebuilt on the
   grammar; the notes culled (D5). Biggest single win: three of the six worst
   screens, one PR.
3. **The contents list and the change list.** Both onto the grammar, plus D12's
   row — the change subject and the relative time, which needs the last
   publishing change per document. It is derivable from the tags the row
   already reads for its version, so no new endpoint; check that before
   assuming one.
4. **History** (D9). The knot becomes the change, the version rows move inside
   it, the filter and the Export icon. The per-document view is the same
   component with a filter, not a second screen — build it that way or the two
   will disagree within a month.
5. **The sidebar takes the binder** (D1). `AppSidebar.tsx` gains the binder
   section; `BinderShell.tsx` loses its `h1`, its subtitle and its tab bar;
   each page grows its own `.bs-pagehead`. Routes are untouched —
   `?tab=people` keeps resolving, it just lands somewhere that draws it
   differently. The small-screen strip is part of this PR, not a follow-up.
6. **Editing** (D7). The sticky draft bar, one header button, the row targets,
   the quieter tree, the archive in place with Restore, the dropzone, the
   propose page.
7. **Several drafts** (D8), **only once it is confirmed.** Server first, the
   way #461 did it: `openDraft` stops resuming blindly, a draft gets a name,
   `resolveOwnDraftBranch` takes the branch from the request. The picker is the
   last few lines.
8. **The change request** (D6). Largest and last, because it is the only one
   that wants the rail primitive the six before it will have proved — and
   because the required/optional marker must read the two branch-protection
   flags rather than infer from CODEOWNERS, which is the one place in this
   plan where being approximately right is worse than not shipping it.

`tests/design-consistency.pw.ts` is where each of these is held: it already
walks the screens and measures, and every rule in it was checked by
reintroducing the defect and watching it fail. Three rules to add —

- no `.bs-label` inside `.app-main`;
- every binder screen has exactly one `h1`;
- no content-bearing element outside `.bs-panel` / `.bs-fields` / `.bs-note`.

The third is the one that makes D2 true a year from now rather than this week.
Write each by putting the defect back first.
