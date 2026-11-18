# Sign-off rules where the work happens

An implementation guide for the agent who builds this. It records what was
decided with the product owner on 2026-11-09, why, what exists in the code
today, and the work, split into a stack of pull requests. Read the whole thing
before the first commit: several pieces depend on decisions recorded only here.

The mocks are screenshots on the `pr-assets/sign-off-rules-in-place` branch,
linked from the table in section 9; the scripts that drew them are in
`docs/design/mockups/sign-off-rules/scripts/`. Each is the real app with its content swapped in, using the app's own CSS classes. They are
references, not markup to copy — see "The mocks" at the end.

---

## 1. The problem

Sign-off rules (`.gitea/CODEOWNERS`, ADR 0004) live in one place today: the
Approvals tab of a binder's settings (`apps/app/components/BinderSettings.tsx`,
the `#sign-off` panel). Three things are wrong with that, and the product owner
confirmed all three:

1. **Two save models on one screen.** On the Approvals tab, the approvals
   count, the approvers and both toggles save the moment they are touched
   (branch protection). The sign-off table beside them opens a change request
   instead (`proposeSignOffRules` in `services/api/gitea-client/signOff.ts`,
   on a `sign-off/<stamp>` branch). Nothing on screen tells them apart.
2. **Nobody learns the rules until they press Propose.** A compliance lead
   visits that tab once, at setup. The rules are invisible while browsing the
   binder or writing a document, which is when they matter.
3. **Folders have no page.** A rule's scope is a folder, but a folder has no
   address: `apps/app/routes.ts` has a `binder` route and a `binderDocument`
   route and nothing for a folder. `/{org}/{binder}/-/blob/main/clinical-standards`
   shows "No such document." ([now-doc.png](https://github.com/davidgraymi/bindersnap-editor-demo/blob/884dd54af48858d2663f0b39429fdd38fb660d9a/sign-off-rules/now-doc.png?raw=true)). A rule with no place to
   live ended up in Settings.

And a fourth, found while mocking: **a change to the rules shows a reviewer
nothing.** The Changes tab of the seeded rules change (Governance #8) says
only "This change versions no document — it changes the binder's sign-off
rules" (`ChangeComparisonPage.tsx:568`, [now-change8-diffs.png](https://github.com/davidgraymi/bindersnap-editor-demo/blob/884dd54af48858d2663f0b39429fdd38fb660d9a/sign-off-rules/now-change8-diffs.png?raw=true)).
Reviewers are asked to approve a change to who approves without seeing it.

The person this is for is the compliance or operations lead at a small
provider. They are not technical. Their idea of a folder comes from Windows
Explorer, SharePoint and a shared drive: click a folder on the left and its
contents fill the right. Every decision below is checked against that.

---

## 2. What was decided

These are settled. Do not reopen them; if one turns out to be impossible,
stop and ask.

| #   | Decision                                                                                                                                                                                                                                                                                                                                              |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **A folder is a place.** It gets an address and a page, in the binder view and on the editor's desk.                                                                                                                                                                                                                                                  |
| D2  | **In a file panel, the arrow opens and shuts a folder in place; clicking its name opens the folder's page.** This is Explorer's left pane. It applies to the binder's file panel (`BinderExplorer.tsx`) and the editor's (`DraftFiles.tsx`).                                                                                                          |
| D3  | **The binder page is the top folder.** It uses the same page and the same sign-off panel as any folder.                                                                                                                                                                                                                                               |
| D4  | **The folder page lists its contents the way the binder page does today** — the binder's existing list (Published picker, filter, count; each row a name, its last change and when), cut to the folder. Not a table of versions and approvers.                                                                                                        |
| D5  | **Sign-off rules are edited in a draft, in the editor,** like a rename or a move. The standalone `sign-off/` change request goes away as the way to edit rules. Settings stops editing them.                                                                                                                                                          |
| D6  | **The sign-off panel separates "Set here" from "From above".** Rules set on this folder or document are listed under Set here, and are editable in the editor. Rules inherited from a parent folder or from the binder are under From above, read only, and each links to the place where it is set.                                                  |
| D7  | **No "changed in your draft" markers anywhere for rules.** No chip, no highlight, no dot, no footnote. Nothing else in the editor marks draft edits; the change request shows the diff. (The blue chip in the first round of mocks looked like the draft picker and was misleading.)                                                                  |
| D8  | **One Edit button.** The binder page, the folder page and the document page lose every header button except Edit, which opens the editor. Whatever those buttons did moves into the editor.                                                                                                                                                           |
| D9  | **The change request overview loses "What this change does" and any separate rule-change block.** Both repeated the Changes tab.                                                                                                                                                                                                                      |
| D10 | **The approvals table is always on the overview,** collapsed by default to a one-line summary that opens into the table. Each row says why the rule applies.                                                                                                                                                                                          |
| D11 | **One approval may meet two rules** that name the same group (for example Policy Office on both the binder rule and the rules rule). The product owner believes Gitea counts it for both and is comfortable saying so on screen. Verify it — see section 7.                                                                                           |
| D12 | **The change page's right rail holds** Reviewers, an "About this change" panel (From, Opened, Assignee) and the Publish box. **Not** a "Publishes" row: it repeated the Changes tab.                                                                                                                                                                  |
| D13 | **Approving a change that edits rules says so at the moment of approval,** and lists which rules the approval counts toward.                                                                                                                                                                                                                          |
| D14 | **Every avatar has a hover card**: full name, username, and why the person is on this screen. It opens on hover, keyboard focus and tap.                                                                                                                                                                                                              |
| D15 | **Every group has its own page**, and every group name in the app links to it.                                                                                                                                                                                                                                                                        |
| D16 | **The editor gets a right-hand panel for "Who signs off here"**, the same rail the binder, folder and document pages have. It mirrors the file panel on the left, shuts to a button the way the file panel does, and shows the rules for whatever is open: a folder or a document. The sign-off rules are never laid out inside the folder's content. |
| D17 | **The backend writes `.gitea/CODEOWNERS` in one canonical form**: rules sorted alphabetically, never two lines for the same binder, folder or document. That makes two drafts' rule edits mergeable, and the backend merges them, or prepares a guided merge for the author when they truly clash.                                                    |

The reasoning behind D5, because it reverses an earlier position: a draft is
a branch over the **whole binder**, not one document. The editor's file panel
already commits renames, moves, folders and archives into the same draft. So
a rule has an obvious home in it. The worry was that a reviewer approving a
document change would approve a rule change without noticing. That is handled
by three things this work builds: the rules scope (whoever guards
`.gitea/CODEOWNERS` must approve any change to it, `codeowners.ts:66`), the
approvals table naming that rule first with a link to the rule diff (D10), and
the approval step saying so (D13).

---

## 3. What exists today

Read these before changing them. Line numbers are as of commit `9b5c239e`.

### Rules model and matching

- `packages/utils/codeowners.ts` — the format. `SignOffScope` is
  `"binder" | "folder" | "document" | "rules"` (line 77); `SignOffRule` is
  `{ scope, target, teams, users }` (line 80). `rulePattern` (180) turns a rule
  into Gitea's anchored regex; `signOffOwnersForPaths` (218) unions owners for
  a set of paths; `parseCodeowners` (465), `renderCodeowners` (421),
  `validateSignOffRules` (574). **There is no function that returns, for one
  path, which rules apply and where each one is set.** That is the first thing
  to build.
- `services/api/approval-rules.ts` — `matchingSignOffRules` (39) filters rules
  by the paths a change touches; `buildApprovalRules` (83) builds the change
  page's rows (`kind: "approvers" | "sign-off"`). Sign-off rules count any
  standing approval from an owner; binder approvers count only `official`
  ones.
- `services/api/requiredReviewers.ts` — which gate a binder is under.

### Reading and writing rules

- `services/api/gitea-client/signOff.ts` — `readSignOffFile` (42, reads at a
  `ref`, default `main`), `readSignOffRules` (75), `signOffBranchName` (95),
  `proposeSignOffRules` (119): opens its own `sign-off/` branch and change.
- Routes (`services/api/server.ts` ~18102): `PATCH /api/app/binders/:org/:binder/rules`
  (approvals count, approvers, toggles — instant) and
  `POST /api/app/binders/:org/:binder/rules/sign-off` (propose rules). Schema
  in `packages/api-schema/registry.ts:1462`.
- Publishing: `server.ts` ~6995 lets a change version nothing when its branch
  starts with `sign-off/` or `shape/`, when it is a draft branch, or when it
  only archives. **A draft holding only a CODEOWNERS edit already publishes.**
- `services/api/gitea-client/workspaceDocuments.ts:447` already expects a
  change that edits CODEOWNERS alongside documents ("publishes two versions,
  not three").
- Drafts: shape acts take an `ActTarget` (`jsonTarget` in `apps/app/api.ts`,
  e.g. `createBinderFolder` at 1678). The server resolves it with
  `resolveOwnDraftBranch` (`server.ts:13605`) or `resolveChangeToJoin` (13454).
  Rules writes must take the same target.

### Screens

- `apps/app/routes.ts` — `binder` (with `ref`), `binderDocument`. No folder.
- `apps/app/components/BinderPage.tsx` — the binder's list (`buildBinderTree`,
  folder rows `.binder-tree-row--folder`). This list is what D4 reuses.
- `apps/app/components/BinderShell.tsx:1460-1500` — the binder header buttons:
  Add a document, Organize, Edit.
- `apps/app/components/BinderDocumentPage.tsx:418-460` — document header
  buttons: Rename or move, Upload new version, Edit in Bindersnap. Line 571:
  the `doc-rail` aside (Waiting on a decision, Versions).
- `apps/app/components/BinderExplorer.tsx` — the binder's file panel.
- `apps/app/components/DraftFiles.tsx` — the editor's file panel: rename,
  move, archive, New, New folder, drag-to-upload (`onUploadDrop`). No upload
  button.
- `apps/app/components/DocumentEditorPage.tsx` — the editor page and its open
  buffers (`OpenPolicy`, keyed by `uid`).
- `apps/app/components/EditorFileCover.tsx` — a Word file or PDF on the desk:
  note with Edit in Bindersnap and Download. No Upload new version.
- `apps/app/components/BinderChangePage.tsx` — the change page; lines 639-648
  special-case a change that touches no document as a rules change.
- `apps/app/components/ApprovalRules.tsx` — the approvals panel: a one-line
  summary that opens into a table. `Faces` uses a `title` tooltip only.
- `apps/app/components/DocumentChangeDetail.tsx` — the decision controls.
  Approve already asks for confirmation inline (`rev-decision-confirm`,
  ~line 686: "Approve this change to …? Your name and the time go on the
  record.").
- `apps/app/components/ChangeComparisonPage.tsx` — the Changes tab; line 568
  is the empty note for a rules change.
- `apps/app/components/OrganizationPeople.tsx` — groups are created and filled
  here; there is no page per group. Group APIs exist:
  `/api/app/orgs/{org}/groups`, `/groups/{group}/members`,
  `/groups/{group}/members/{username}` (`registry.ts:1190-1240`).
- `apps/app/components/PersonAvatar.tsx` — no hover card, no title.

---

## 4. The design, screen by screen

Copy rules for everything below: the app says **document**; never write
"CODEOWNERS", "branch", "pattern" or "team" on screen (say **group**); the
tense of a rule is the future when it is not yet in force ("will need").
Follow `.claude/skills/voice-and-copy/SKILL.md` and
`.claude/skills/design-system/SKILL.md`: tokens only, one coral primary per
section, `.bs-panel`/`.bs-row` grammar, icons from `ICON` (`ICON.rules` is the
shield, `ICON.people` a group, `ICON.folder`).

### 4.1 The sign-off panel ("Who signs off here")

One component, used on the binder, folder and document pages and on the
editor's desk. Mocks: `v2-1`, `v2-2`, `v2-3`, `v2-4`.

```
Who signs off here
<lead>
Set here
  [group icon] Infection Control            (GI)(IM)
               Set on this folder
  + Add a group or a person                  ← editor only
From above                       Read only here ← editor only
  [group icon] Policy Office                (AN)(PR)
               The whole binder · Governance ›   ← link to where it is set
  [shield]     2 approvals
               From the binder's approvers · Governance ›
<foot note>                                   ← read view only
```

- **Leads.** Folder: "Publishing anything in this folder needs one approval
  from each of these." Document: "Publishing a new version needs one approval
  from each of these." Binder: "Everything in this binder needs these,
  whatever folder it is in." In the editor: "…will need…".
- **Set here** lists rules whose target is exactly this place. Empty on a
  document with no rule of its own: "Nothing is set on this document alone."
- **From above** lists, nearest first, the rules of every parent folder, then
  the binder rule, then the binder's approvals count as a row ("2 approvals —
  From the binder's approvers"). The origin line is a link: in the binder view
  to that folder's or the binder's page, in the editor it moves the desk there.
- **The group name is a link to the group page** (4.8). It is a separate link
  from the origin line. Do not make the whole row a link: links cannot nest,
  and the browser breaks the row apart if you try (it did in the mock).
- **Faces** are the group's members, each with the hover card (4.7).
- On the binder page only, a third Set here row: the rules rule —
  "Policy Office · Any change to who signs off", shield icon. A folder or
  document page never shows it: it governs only `.gitea/CODEOWNERS`.
- Binder page foot: "Clinical Standards, Contracts and one document add rules
  of their own. Open them to see." (count from the rules). Folder and document
  page foot in the read view: "To change who signs off here, press Edit. It
  goes into a draft, and the Policy Office approves it." (name the rules-scope
  owners; if there is no rules-scope rule, say "and it is reviewed like any
  change").
- **No draft markers in the editor (D7).** An added group is an ordinary row.

### 4.2 Folder page, binder view — `v2-1`

Address: `/{org}/{binder}/-/tree/{ref}/{folderPath}` (the binder root already
uses `/-/tree/{ref}`). The file panel highlights the folder.

- Header: folder icon, the folder name (`bs-title`), meta "A folder in
  Governance · 2 documents · last published Nov 9, 2026". One button: **Edit**.
- Main: the binder page's list (D4), scoped to the folder: Published picker,
  "Filter this folder…", "2 documents", rows as on the binder page, no indent.
  Subfolders appear as folder rows and open their own page.
- Rail (`doc-rail`): the sign-off panel, then "Waiting on a decision": open
  changes touching anything in the folder, **including a rules change that
  touches this folder's rule** (the seed's #8 shows as "#8 · Would add the
  Quality Committee here").

### 4.3 Binder page as the top folder — `v2-3`

Same page as 4.2 at the root. Keeps its latest-publish banner and list. One
button: **Edit**. Gains the rail with the sign-off panel: the binder rule, the
approvals count and the rules rule under Set here.

### 4.4 Document page — `v2-2`

- Header: one button, **Edit**, shown to anyone who can write. Rename or move,
  Upload new version and Edit in Bindersnap go (they are in the editor, 4.6).
  A reader or reviewer sees no button.
- Rail: the sign-off panel goes **first**, above Waiting on a decision and
  Versions. Usually everything is From above.

### 4.5 The editor: a right-hand panel, and a folder on the desk — `v3-1`, `v3-2`

**The right-hand panel (D16).** The editor gains a panel on its right edge that
mirrors its file panel on the left (`DraftFiles.tsx`, `.doc-files-float`):
floating over the desk under the ribbon, about 300px wide, shut to a small
button with the same remembered toggle (`useRememberedToggle`). Its head reads
"Who signs off here" with the shut button; under it "For **Clinical
Standards**" or "For **Sepsis Pathway**, in Clinical Standards"; then the
sign-off panel (4.1) for whatever is open. It is the editor's version of the
`doc-rail` on the binder, folder and document pages, and the place later
Bindersnap-specific facts (history, waiting on a decision) can join it.

Room: at 1440px wide, the file panel (~260px), a sheet of Letter at 100%
(816px) and this panel (~300px) fit with no gap to spare (measured in the
mock: the page ends at x=1128, where the panel starts). Narrower windows do
not fit all three. Rule: the panel starts shut when the window cannot hold
both panels and the page at the current zoom, and otherwise remembers what
the person last did. Never shrink the page's zoom to make room.

**A folder on the desk.** Clicking a folder's name in the editor's file panel
puts the folder on the desk, where a document's page goes, the way
`EditorFileCover` puts a Word file there. The right-hand panel then shows the
folder's rules.

- The ribbon is locked (as for a Word file). Open documents keep their unsaved
  words; moving to a folder replaces the address like moving between documents.
- Header title in the editor bar: the folder name. Status bar: "Folder".
- A head card: folder icon and name, "Folder · 2 documents", buttons
  **Upload files here** (secondary) and **New document here** (primary).
- Below it: the folder's list (4.2's list), full width **between the two
  panels**. Nothing about sign-off is in the folder's content: it is all in
  the right-hand panel. Use both panels' real widths (the file panel is
  resizable; either may be shut), not constants.
- The list must never cut a document's name before its last-change text; the
  last-change column is the one that shortens.
- Set here is editable: remove a group or person, and "Add a group or a
  person" (reuse `ApproverPicker`'s search and its rule that only someone who
  can read the binder can be picked). Each edit commits `.gitea/CODEOWNERS`
  into the editor's draft, one act each, like a rename. From above is read
  only and says "Read only here". These edits happen in the right-hand
  panel, for a folder or for a document ("Add a group or a person" on a
  document adds a rule for that document alone).
- **No Published picker in the editor's list.** The list on the binder page
  starts with a picker that says which version of the binder you are looking
  at ("Published", or one of your drafts, or a change). The editor always
  shows your draft, and the draft picker in its top bar already says which, so
  a second picker there would repeat it or contradict it. Keep the filter and
  the count. (The mocks still draw it; ignore it.)

### 4.6 Everything that left the page headers, in the editor

| Was                          | Now                                                                                                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Binder: Add a document       | Editor file panel: New document; new **Upload** button in its head (beside New document and New folder); folder menu "Upload files here"; the folder desk's buttons |
| Binder: Organize             | Editor file panel (already renames, moves, makes folders)                                                                                                           |
| Document: Rename or move     | Editor file panel and title (already)                                                                                                                               |
| Document: Upload new version | **New button on `EditorFileCover`**, beside Edit in Bindersnap and Download (`v2-5`), opening `ReviseDocumentModal` into the draft                                  |
| Document: Edit in Bindersnap | Already on `EditorFileCover`                                                                                                                                        |

Edit on any page opens the editor on that thing: a document opens it, a
folder or the binder opens the editor with the folder on the desk. Today Edit
on a binder opens the last-written document (`pickPolicyToWrite`); keep that
when there is no folder in the address.

### 4.7 Hover card on every avatar — `v2-1`

A small card: the face, full name, `@username`, and a context line passed by
the caller ("Infection Control · signs off on this folder", "Approver · Policy
Office"). Use `--bs-elevation-menu`, `--bs-surface-1`, `--brand-radius-lg`.

Accessibility is the point of it, not a detail:

- The trigger is focusable; the card opens on hover (after ~300ms), on
  keyboard focus and on tap, and closes on Escape and blur.
- The card is connected with `aria-describedby`; the face still has an
  accessible name without it.
- It never holds the only copy of something a person must do.

Apply it to `PersonAvatar` so every use gets it: `ApprovalRules`' faces,
reviewers, the timeline, people lists, the sign-off panel.

### 4.8 A group's page — `v2-8`

Address: `/{org}/-/groups/{group}` (in the organization's `/-/` space, per
the root guide's routing rule). Breadcrumb: People / Groups / the group.

- Header: group icon, name, its description, "2 people · a group in Riverside
  Health". Buttons for an organization owner: Rename, **Add a person**.
- **Where it signs off** — every rule in every binder that names the group,
  each a row linking to that folder, document or binder: "Governance ·
  Clinical Standards — Folder · 2 documents · Hand Hygiene, Sepsis Pathway".
  This answers "what does this group actually approve?", which today means
  opening every binder's settings.
- **Binders it can use** — each binder it is granted on, with its level
  (Editor / Reviewer / Admin) and "approver" if it is on the binder's
  approvers.
- **People** — members with face, name, username; Remove for owners. Foot:
  the seat note for a writing group ("Editors cost a seat: $39 a month each")
  and "Only an owner of Riverside Health changes who is in a group."
- Everyone in the organization can read the page; only owners change it
  (the existing rule in `OrganizationPeople.tsx`).

Make one `GroupLink` component and use it for every group name: the sign-off
panel, the approvals table, reviewers' tags, Settings, People.

### 4.9 Change request overview — `v2-6`

- Byline: "Alice Nguyen wants to publish 1 document **and change who signs
  off**." when the change touches `.gitea/CODEOWNERS`. The "from <draft>" chip
  and the date move to the rail.
- Remove the "What this change does" panel (`change-does`) and do not add a
  rule-change block (D9).
- **Approvals table** (replaces `ApprovalRules`' collapsed sentence). Head:
  "Needs sign-off under 4 rules · none met yet". **Collapsed by default** to
  that one line (D10); it opens into the table, and a control in its head
  shuts it again. Nothing is remembered between changes. Columns: Rule, Who can approve,
  Approvals, Approved by. Each rule cell has three lines: the rule's name, its
  owners as group links, and **why it applies**:
  - rules scope: "This change edits a sign-off rule · See the rule change →"
    (links to the rule section of the Changes tab). Always the first row.
  - folder: "Hand Hygiene is in this folder" (name the documents it matched)
  - document: "This document has its own rule"
  - binder rule: "Applies to everything in Governance"
  - approvers: "Governance needs 2 approvals"
- Footnote, when it applies:
  - "One approval from Alice or Priya meets both Policy Office rules." — when
    one person is eligible for more than one unmet rule (D11).
  - "The Quality Committee is not asked: its rule starts with the next change
    after this one is published." — when the change adds owners.
- **Rail** (D12): Reviewers, each tagged with the group they approve for
  ("Approver · Policy Office"); **About this change** — From (draft chip),
  Opened (date and author), Assignee; **Publish** box — the Publish button,
  disabled until every rule is met, with "Publishing opens once every rule
  above is met. Waiting on Priya Raman and Grace Ibori.", and Close without
  publishing under it. The "You submitted this change — it is waiting on its
  reviewers" note is replaced by the Publish box's line.

### 4.10 Approving a change that edits rules — `v2-7`

Extend the existing inline confirmation in `DocumentChangeDetail.tsx`
(`rev-decision-confirm`), do not add a modal. (The mock draws a modal; that
was for the picture. See O2.) When the change touches `.gitea/CODEOWNERS`, add:

- "**This also changes who signs off.** Once it is published, everything in
  Clinical Standards needs the Quality Committee as well. See the rule
  change →"
- "Your approval counts toward:" and one line per rule the approver is
  eligible for ("Who signs off · Policy Office", "The whole binder · Policy
  Office", "Binder approvers · 1 of 2").

### 4.11 The Changes tab — [mock-3-mixed-change.png](https://github.com/davidgraymi/bindersnap-editor-demo/blob/884dd54af48858d2663f0b39429fdd38fb660d9a/sign-off-rules/mock-3-mixed-change.png?raw=true)

- The rule change is the **first** section, above every document, with its
  own entry at the top of the tree ("Who signs off · 1 rule").
- Per changed rule: where (folder icon and name, or "The whole binder", or the
  document), then the owners as chips: unchanged neutral, added green with a
  plus, removed red and struck through. Then the effect: "After this is
  published, every document in Clinical Standards needs an approval from the
  Quality Committee as well — both of the documents in it today."
- A note under the section: "**Counted under the rules in force today.** The
  Policy Office signs off any change to who signs off, so this change needs
  them whatever else it holds. Hand Hygiene v3 is approved under today's rule;
  the Quality Committee's rule starts with the next change."
- A change that only edits rules shows this section alone, replacing the empty
  note at `ChangeComparisonPage.tsx:568`.

### 4.12 Settings

The sign-off table on the Approvals tab becomes a **read-only list of every
rule in the binder**, each row linking to its folder, document or the binder
page. It answers "what applies anywhere" for an admin auditing the binder.
Replace the editing controls with one line: "Who signs off is changed on each
folder, in the editor." The approvals count, approvers and toggles stay and
keep saving instantly: they are branch protection, and with the table gone
the tab has one save model.

### 4.13 Removing a group's access while a rule names it

What Gitea does here is not yet tested (section 7, item 5). From how the gate
works (`gitea-28-findings.md` §2): a rule's owners are expanded to the group's
members, and one of them must approve. A member who can no longer read the
binder cannot open the change, let alone approve it. So the expected result
is that **every change touching that folder stops being publishable, with no
error anywhere**, while the rest of the file keeps enforcing normally. A
deleted group may instead be dropped from the line when Gitea parses it,
which could leave the rule unenforced. Both are silent, which is why
Bindersnap has to say it.

The recommended design, wherever access is removed (the binder's People &
access settings, removing a group from a binder, deleting a group):

1. Before removing, check the rules on `main` and in open drafts for the
   group. If none name it, remove as today.
2. If any do, the confirmation lists them: "Infection Control signs off on
   Clinical Standards. Without access they cannot approve, and nothing in
   Clinical Standards can be published until someone else signs off there."
3. Offer **Remove access and take them off who signs off**: remove the access,
   and open a change, from a draft made for the purpose and proposed at once,
   that removes the group from those rules. It touches only
   `.gitea/CODEOWNERS`, so it is governed by the rules rule and is not stuck
   behind the folder rule it fixes. Until it is published, the change page
   and the folder page say why publishing in that folder is waiting.
4. If removing the group would leave a rule with **no owners**, the
   confirmation asks who should sign off there instead before going on.
5. If the group is the **owner of the rules rule** (whoever approves changes
   to who signs off), refuse: name a new owner for the rules rule first,
   because the change that removes them could otherwise never be approved.
6. Elsewhere, a rule naming a group without access shows "No access to this
   binder" beside the group (the way `approverReach` marks approvers), on the
   sign-off panel and in Settings' list.

Open it as a change rather than editing `main`: the rules are evidence, and
taking a group off who signs off is a change to a control.

---

## 5. Rules of the system the build must respect

- **Evidence stays in Gitea** (non-negotiable 2). CODEOWNERS is the rules'
  only home. The group page's "Where it signs off" reads CODEOWNERS on `main`
  of each binder the viewer can read, live. No SQLite copy, no cache. If it is
  slow, a derived index is allowed only under the root guide's rules, and
  never for a publish gate or an approval check.
- **The BFF owns Gitea** (non-negotiable 1). Every read and write goes through
  `services/api`. Writes use the person's own session token.
- **The paywall gates writing, not reading.** Rules writes use
  `requireSubscription`; every read here uses `requireSession`.
  `services/api/paywall-scope.test.ts` fails on a `GET` that reaches for the
  paywall.
- **Gitea reads CODEOWNERS from the base branch.** A rule added in a draft
  never governs its own change. That is why the copy says "starts with the
  next change".
- **A group named in a rule must be granted on the binder,** or Gitea holds
  the merge for an approval nobody can give (seed comment on `governance`).
  The editor's picker must only offer groups and people who can read the
  binder.
- **Editor visuals** (non-negotiable 5): if any change lands in
  `packages/editor/` (the desk, the `aside`, the cover slot), flag it in the
  PR description.
- **Generated code**: after any API schema change run `bun run generate:bff`
  and commit what it writes.

---

## 6. The work, as a stack

Each PR is based on the one before (`.claude/skills/stacked-pr/SKILL.md`).
Commit titles are Conventional Commits written as the result. Each PR's tests
are listed; run unit tests with `bun test <file>` and Playwright with
`bunx playwright test tests/<file>.pw.ts --workers=2` against `bun run up`.

### PR 1 — `feat(utils): which sign-off rules apply to a path, and where each is set`

`packages/utils/codeowners.ts`:

```ts
export interface ApplyingRule {
  rule: SignOffRule;
  /** Where it is set: this exact place, or above it. */
  origin: "here" | "above";
  /** The place that sets it: "" for the binder, a folder path, a document path. */
  setAt: string;
}
export function signOffRulesFor(
  rules: readonly SignOffRule[],
  place:
    | { kind: "binder" }
    | { kind: "folder"; path: string }
    | { kind: "document"; path: string },
): ApplyingRule[];
```

- Order: here first, then above, nearest parent folder first, binder last.
- A folder place matches folder rules for it and every ancestor; a document
  place matches its own document rule, every ancestor folder, the binder.
- The `rules` scope applies only to the binder place (and to the path
  `.gitea/CODEOWNERS` in a change).
- Use the same anchored compile as `signOffOwnersForPaths`; skip a rule that
  does not compile, as it does.
- Tests in `codeowners.test.ts`: binder, one folder deep, nested folders
  (add a nested-folder rule to a test fixture), a document with its own rule,
  a document inheriting only, a folder name with a space or `#`.

Also add `diffSignOffRules(before, after)` → per `(scope, target)`: added,
removed and unchanged teams and users, plus wholly added or removed rules.
Tests beside it.

### PR 2 — `feat(api): sign-off rules are read at a draft and written into one`

- **Read at a ref.** Wherever the app reads a binder's rules for display, take
  an optional `draft` or `change` and read CODEOWNERS at that branch
  (`readSignOffFile` already takes `ref`). The editor shows the draft's rules;
  every other page shows `main`.
- **Write into a draft.** A new operation (or the existing
  `POST …/rules/sign-off` with a body that carries an `ActTarget`) that
  validates with `validateSignOffRules`, renders with `renderCodeowners`, and
  commits `.gitea/CODEOWNERS` into the resolved draft
  (`resolveOwnDraftBranch`) or the author's open change
  (`resolveChangeToJoin`). No new branch, no new change request. Paywalled.
  Returns the new rules and the draft.
- **Retire proposing rules on their own `sign-off/` branch** for new changes.
  Leave the publish guard's `sign-off/` prefix (`server.ts` ~7018) so changes
  already open still publish.
- **Change detail.** For a change whose files include `.gitea/CODEOWNERS`,
  return `signOffChange: { rules: diffSignOffRules(baseRules, headRules) }`
  with, per changed rule, the documents it covers on the head
  (for the "both of the documents in it today" line).
- **Why each rule applies.** Add a `reason` to each `ApprovalRuleView`
  (`approval-rules.ts`): which changed paths it matched, or that it is the
  rules rule, the binder rule or the approvers count. Add the eligible
  overlaps for the "one approval meets both" footnote, or compute that in the
  app from `eligible`.
- **Group page data.** `GET /api/app/orgs/:org/groups/:group`: description,
  members, binders granted with level and approver status, and the rules that
  name it in every binder the viewer can read.
- **One canonical CODEOWNERS (D17).** Every write renders the whole file
  from parsed rules: binder rule first, then folder and document rules sorted
  alphabetically by target, then the rules rule; **at most one line per
  target**, with its owners sorted too, so the same rules always produce the
  same bytes. Merging two lines for the same target unions their owners.
  `renderCodeowners` already renders from rules; make it sort and dedupe, and
  have `validateSignOffRules` refuse duplicates. The first write after this
  ships normalizes a hand-edited file; say so in that change's description.
- **Merging rules between drafts.** With one line per target, two drafts'
  rule edits merge rule by rule against their common base: a target changed
  on one side only takes that side; owners added on either side are kept;
  owners removed on one side and untouched on the other are removed. A real
  clash is the same target changed both ways (one side removes an owner the
  other side just added, or both sides set different owner lists after a
  removal). Merge everything else automatically when the draft is brought up
  to date (`bringUpToDate`, `conflicts.ts`), and hand the author a **guided
  merge** for the clashes only: per target, both versions in plain words
  ("Clinical Standards: Infection Control and Quality Committee" against
  "Clinical Standards: Infection Control and Pharmacy"), choose one or keep
  both, then commit. Never a text conflict on the raw file.
- **Folder rename keeps its rules.** Renaming or moving a folder in a draft
  (`renameBinderFolder` and the shape acts) must rewrite the CODEOWNERS rules
  whose target is that folder or under it, in the same act. Archiving a
  folder must remove or flag its rules. Nothing does this today: a renamed
  folder would silently lose its rule.
- `bun run generate:bff`. Tests: `services/api/*.test.ts` beside each handler,
  `paywall-scope.test.ts` stays green, and the `gitea-evidence-auditor` agent
  on the diff.

### PR 3 — `feat(app): a folder has an address`

- `routes.ts`: add `folder?: string` to the `binder` route, parsed from
  `/-/tree/{ref}/{path}` and built by `routeToPath`. A folder path must not be
  confused with a document path: the server knows which folders exist
  (`listing.folders`); fall back to "No such folder" when it does not.
- Tests in `apps/app/routes.test.ts` (or beside it): round-trip, nested
  folders, a folder name with spaces, a ref other than `main`.

### PR 4 — `feat(app): open a folder by its name; the arrow still opens it in place`

- `BinderExplorer.tsx` and `DraftFiles.tsx`: the chevron is its own button
  (toggle); the name opens the folder's page (binder view) or puts the folder
  on the desk (editor). Keyboard: Enter on a folder opens its page; Right and
  Left still open and shut; F2 still renames.
- Keep the folder holding the open item expanded (`useOpenFolders`).
- Playwright: click a name → folder page, click its arrow → expanded and same
  page; keyboard path.

### PR 5 — `feat(app): who signs off, on every page that shows a place`

- `SignOffPanel` component (4.1), `GroupLink` (4.8, link only until PR 9
  adds the page — or land PR 9 first), and the person hover card (4.7) in
  `PersonAvatar`.
- Folder page (4.2) and the binder page as the top folder (4.3): extract the
  binder's list from `BinderPage.tsx` so both use it, scoped by folder.
- Document page rail (4.4).
- Tests: component tests for the panel's sections and empty state; the hover
  card opens on focus and closes on Escape; Playwright on the governance
  binder: Clinical Standards shows Infection Control set here and Policy
  Office from above, and the origin link opens the binder.

### PR 6 — `feat(app): one Edit button; everything else is in the editor`

- Remove the header buttons (4.6) from `BinderShell.tsx` and
  `BinderDocumentPage.tsx`; Edit opens the editor on the page's place.
- Add Upload to the editor's file panel head and to a folder's menu
  ("Upload files here"); add Upload new version to `EditorFileCover`.
- Check every removed action is still reachable, for a Word file, a PDF, an
  editor document, a folder and an empty binder. An empty binder has nothing
  to open the editor on today (`pickPolicyToWrite`): Edit must still open it,
  on the root folder.
- Playwright: each removed action, done from the editor.

### PR 7 — `feat(app): a folder on the editor's desk, with its rules beside it`

- `DocumentEditorPage.tsx`: the editor can have a folder open instead of a
  document; the desk shows a folder view (4.5) in the cover slot; the ribbon
  locks; title and status bar follow.
- Set here edits commit through PR 2's write, one act per edit; the panel
  re-reads the draft's rules after each.
- From above origin links move the desk to that folder or the root.
- The right-hand panel (4.5): mirrors the file panel's float and toggle,
  shows the sign-off panel for the open folder or document, starts shut when
  the window cannot hold both panels and the page. Edits happen here.
- Layout: the folder's list fills the desk between the two panels' live
  widths. No Published picker in the editor's list.
- Flag in the PR description if `packages/editor/` changes.
- Playwright: open Clinical Standards in the editor, add the Quality
  Committee, propose, and the change's Changes tab shows the rule first.

### PR 8 — `feat(app): a change says what it does to who signs off`

- Changes tab (4.11): the rule section and tree entry, from `signOffChange`.
- Overview (4.9): byline, approvals table (collapsed by default) with reasons, removing
  `change-does`, the rail's About and Publish panels, reviewers' group tags.
- Approve confirmation (4.10).
- `BinderChangePage.tsx:639-648`: a change that edits rules and versions
  nothing is no longer a special subject; it is a change with a rule section.
- Tests: `changedDocuments`-style pure tests for the rule section's rows;
  Playwright on a seeded mixed change (add one to `tests/seed-data/dev.yaml`:
  a Hand Hygiene revision plus a Clinical Standards rule change in one draft).

### PR 9 — `feat(app): every group has a page`

- Route `/{org}/-/groups/{group}`; the page (4.8); `GroupLink` everywhere.
- Tests: owner sees Add a person and Remove; a member reads only; "Where it
  signs off" lists the governance folders for Infection Control.

### PR 10 — `refactor(app): Settings lists the rules; it no longer edits them`

- 4.12. Remove the edit path and `proposeBinderSignOffRules` from the app.
- Update `apps/app/AGENTS.md` and the root `AGENTS.md` where they describe
  rules, the file vault's upload buttons, the editor's file panel and the
  change page. Update help articles in `apps/help` that describe Settings →
  Approvals or the header buttons.

PR 9 can move before PR 5 if `GroupLink` should be live from the start.

---

## 7. Verify before you promise it on screen

1. **One approval for two rules (D11).** Add to
   `tests/gitea-permission-model.pw.ts`: two CODEOWNERS rules that match the
   same change and both name `policy-office`; one approval from a member;
   assert Gitea allows the merge on `block_on_codeowner_reviews`. If Gitea
   wants two, the footnote and the "1 of 1" counts change — ask before
   shipping.
2. **A draft that edits CODEOWNERS and documents publishes** with a version
   tag per document and none for the rules (expected from
   `workspaceDocuments.ts:447`), and the tag stamps the rules in force.
3. **The rules rule gates a mixed draft.** A change touching CODEOWNERS and a
   document requests the rules owners and cannot merge without them.
4. **Two drafts both editing CODEOWNERS.** Decided (D17): the canonical file
   makes them mergeable rule by rule, and the backend merges them or offers a
   guided merge (PR 2). Test it: two drafts adding different owners to the
   same folder merge cleanly; one removing and one adding the same owner
   reaches the guided merge. The conflict resolver
   (`services/api/gitea-client/conflicts.ts`) pairs files by document
   identity and CODEOWNERS has none, so it needs a rules branch of its own,
   not the document path.
5. **A group that loses access while a rule names it** (O4). Not recorded in
   `gitea-28-findings.md`. Pin each case in `tests/gitea-permission-model.pw.ts`
   before building the warning in 4.13: (a) the group still exists but is no
   longer granted on the binder; (b) the group is deleted; (c) the group is
   emptied; (d) the group was the only owner of its rule; (e) the group is
   the rules rule's owner. For each, record whether Gitea still parses the
   line, whether the rest of the file still enforces, and whether a change
   touching that folder can merge.

---

## 8. Open questions for the product owner

- **O1** Resolved as recommended: no Published picker in the editor's list
  (4.5), unless the product owner says otherwise.
- **O2** Still open. On the change request page, pressing Approve today opens
  a confirmation inside the decision bar ("Approve this change to …? Your name
  and the time go on the record."). The question is whether the "This also
  changes who signs off" warning and the "Your approval counts toward" list go
  into that inline confirmation (this guide's default) or into a dialog over
  the page, as the mock draws it.
- **O3** Resolved: the approvals table is collapsed by default, and the choice
  is not remembered (D10).
- **O4** Open until section 7, item 5 is tested; the recommended design is
  4.13.

---

## 9. The mocks

The screenshots live on the orphan branch `pr-assets/sign-off-rules-in-place`
(kept off `main`; it can be deleted once this work has shipped). The scripts
that drew them are in `docs/design/mockups/sign-off-rules/scripts/`.

| Shot                                                                                                                                                                             | Shows                                                                                                         | Sections      |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------- |
| [now-doc.png](https://github.com/davidgraymi/bindersnap-editor-demo/blob/884dd54af48858d2663f0b39429fdd38fb660d9a/sign-off-rules/now-doc.png?raw=true)                           | Today: a folder's address is "No such document"                                                               | 1             |
| [now-change8-diffs.png](https://github.com/davidgraymi/bindersnap-editor-demo/blob/884dd54af48858d2663f0b39429fdd38fb660d9a/sign-off-rules/now-change8-diffs.png?raw=true)       | Today: a rules change has nothing under Changes                                                               | 1             |
| [v2-1-folder-binder.png](https://github.com/davidgraymi/bindersnap-editor-demo/blob/884dd54af48858d2663f0b39429fdd38fb660d9a/sign-off-rules/v2-1-folder-binder.png?raw=true)     | Folder page, one Edit, split panel, hover card                                                                | 4.1, 4.2, 4.7 |
| [v2-2-document.png](https://github.com/davidgraymi/bindersnap-editor-demo/blob/884dd54af48858d2663f0b39429fdd38fb660d9a/sign-off-rules/v2-2-document.png?raw=true)               | Document page, one Edit, everything From above                                                                | 4.1, 4.4      |
| [v2-3-binder.png](https://github.com/davidgraymi/bindersnap-editor-demo/blob/884dd54af48858d2663f0b39429fdd38fb660d9a/sign-off-rules/v2-3-binder.png?raw=true)                   | Binder page as the top folder                                                                                 | 4.3           |
| [v2-4-folder-editor.png](https://github.com/davidgraymi/bindersnap-editor-demo/blob/884dd54af48858d2663f0b39429fdd38fb660d9a/sign-off-rules/v2-4-folder-editor.png?raw=true)     | **Superseded by v3-1.** Sign-off was laid out inside the folder's content; it belongs in the right-hand panel | —             |
| [v3-1-editor-folder.png](https://github.com/davidgraymi/bindersnap-editor-demo/blob/884dd54af48858d2663f0b39429fdd38fb660d9a/sign-off-rules/v3-1-editor-folder.png?raw=true)     | Folder in the editor: list between the panels, sign-off in the right-hand panel, Upload in the file panel     | 4.5, 4.6      |
| [v3-2-editor-document.png](https://github.com/davidgraymi/bindersnap-editor-demo/blob/884dd54af48858d2663f0b39429fdd38fb660d9a/sign-off-rules/v3-2-editor-document.png?raw=true) | Document in the editor, with the right-hand panel; Letter at 100% just fits at 1440px                         | 4.5           |
| [v2-5-word-in-editor.png](https://github.com/davidgraymi/bindersnap-editor-demo/blob/884dd54af48858d2663f0b39429fdd38fb660d9a/sign-off-rules/v2-5-word-in-editor.png?raw=true)   | Upload new version on a Word file in the editor                                                               | 4.6           |
| [v2-6-overview.png](https://github.com/davidgraymi/bindersnap-editor-demo/blob/884dd54af48858d2663f0b39429fdd38fb660d9a/sign-off-rules/v2-6-overview.png?raw=true)               | Change overview: approvals table, rail                                                                        | 4.9           |
| [v2-7-approve.png](https://github.com/davidgraymi/bindersnap-editor-demo/blob/884dd54af48858d2663f0b39429fdd38fb660d9a/sign-off-rules/v2-7-approve.png?raw=true)                 | Approving a change that edits rules (drawn as a modal; see O2)                                                | 4.10          |
| [v2-8-group.png](https://github.com/davidgraymi/bindersnap-editor-demo/blob/884dd54af48858d2663f0b39429fdd38fb660d9a/sign-off-rules/v2-8-group.png?raw=true)                     | A group's page                                                                                                | 4.8           |
| [mock-3-mixed-change.png](https://github.com/davidgraymi/bindersnap-editor-demo/blob/884dd54af48858d2663f0b39429fdd38fb660d9a/sign-off-rules/mock-3-mixed-change.png?raw=true)   | Changes tab: the rule section first                                                                           | 4.11          |

What in the mocks is **not** design:

- Numbered dark callouts are notes, not UI.
- Faces are initials in tinted circles; the app uses `PersonAvatar`.
- The mixed change is drawn on top of the seeded Clinical #7 change, so
  Grace's avatar on the overview is Bob's, the discussion text was rewritten,
  and the document diff on the Changes tab is the Infection Control policy
  under a Hand Hygiene heading.
- Group links are underlined with a hand-written style; use the app's link
  style.
- Pixel values inside `scripts/*.js` are mock shortcuts. The build uses tokens.
- The editor mocks still draw the Published picker in the folder's list; the
  build drops it (4.5). The approvals table on `v2-6` is drawn open; the
  build starts it collapsed (D10).

To regenerate them: `bun run up`, then from `scripts/`, run `node base.js`
once to sign in as alice (writes `state.json` — never commit it), then
`node mock.js`, `node mock2.js` and `node mock3.js` with `NODE_PATH` pointing at the repo's
`node_modules`. They write into `scripts/shots/`. The editor scenes assume
alice has a draft in Governance; the URL in `mock2.js` (`DRAFT`) must be
changed to one of hers. `mock3.js` reuses `mock2.js`'s helpers.
