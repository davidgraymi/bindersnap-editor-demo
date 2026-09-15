# Handoff — editing a binder

**Status:** §4.1 and §4.2 are built and in review — drafts, the tree, edit
mode, drag-to-move, archiving and restore. §4.3 has started: form controls are
one system now (#468), which the page shell was waiting on.

This document exists so somebody else can pick the work up without re-deriving
the decisions. It is not a spec: it says what is built, what was decided and
why, and what the next thing is. Where a decision was the customer's rather
than ours, it says so — those are not yours to reopen.

Read `AGENTS.md` and ADRs [0004](adr/0004-organization-workspace-folder-and-org-billing.md)
and [0005](adr/0005-document-identity-and-version-tags.md) first. Everything
below assumes them.

---

## 1. What the customer asked for

Three messages, in order, each one refining the last. Quoted rather than
paraphrased, because the wording carries the intent:

> A user can't add a folder to a binder. A user can't rename a folder. A user
> can't rename a binder. […] Editing binder content generally is bad — to edit
> a document you must upload one with the exact same name; folders are all
> open; nested folders?; the interface should be like Finder/file explorer.

> When you make changes they go in a change request. We can even make multiple
> changes on a single branch and make a change request out of that!

> I'd like users to take ownership of their change requests like in github.
> Maybe a create CR page is necessary so that a user adds a title, description,
> etc. They should also be able to work freely without creating a PR like how a
> github branch works.

> Also, renaming should be as simple as how it is in finder. There should be an
> edit button without going into the document itself. Moving a document should
> be a simple drag and drop. I think with all these features we need an edit
> button that puts the user in edit mode and then allows all these edits to
> happen on a branch. That way we can save everything continuously and when
> they are ready open a CR.

**The destination, in one paragraph.** A binder shows its contents as a file
explorer. You press **Edit** and the tree becomes directly manipulable: rename
in place, drag to move, make a folder, add a policy, archive something. Every
act commits to _your draft_ as it happens — continuous save, no Save button. A
bar says what is in the draft, with **Propose** and **Discard**. Propose opens
a page where you write the title and description, and only then does a change
request exist and reviewers hear about it.

---

## 2. What is built

### Merged

| PR   | What                                                                                                         |
| ---- | ------------------------------------------------------------------------------------------------------------ |
| #453 | ADR 0005 — a document's identity is a ULID in its filename; version tags are `<uid>/vN`                      |
| #454 | A sign-off rule can cover the whole binder, a folder, or one document                                        |
| #456 | A binder lists the record (`main`) and nothing else                                                          |
| #457 | A document can be given a new version without re-uploading under the same name                               |
| #458 | A change request is the unit of work and can hold more than one act                                          |
| #459 | Folders can be made and renamed. **Folders are real, empty or not** — an empty one is a committed `.gitkeep` |
| #460 | A policy can be renamed and filed somewhere else, keeping its identity                                       |

These sit on the integration branch `feat/adr4-documents-as-files`, not on
`main`.

### In review

**[#461 — drafts](https://github.com/davidgraymi/bindersnap-editor-demo/pull/461)**
(`feat/drafts-before-change-requests` → `feat/adr4-documents-as-files`)

Server only, deliberately: the model is reviewable on its own before UI sits on
it.

- `services/api/gitea-client/drafts.ts` — a draft is a branch with commits and
  no change request.
- `resolveWorkTarget` / `applyToWorkTarget` in `services/api/server.ts` — every
  act now goes to a draft, an open change request, or (still the default)
  straight to a new change request.
- Routes: `GET`/`POST`/`DELETE /api/app/binders/{org}/{binder}/draft`, and
  `POST /api/app/binders/{org}/{binder}/changes` to propose one with a title
  and description the author wrote.
- `tests/binder-drafts.pw.ts` — 10 tests against real Gitea.

**[#462 — the tree](https://github.com/davidgraymi/bindersnap-editor-demo/pull/462)**
(`feat/binder-is-a-tree` → `feat/drafts-before-change-requests`)

- `apps/app/binderTree.ts` — `buildBinderTree`, `folderPaths`,
  `ancestorFolders`. Pure, 10 unit tests.
- `apps/app/components/BinderTree.tsx` — `BinderTreeView`, rendering only.
- `apps/app/useCollapsedFolders.ts` — collapse state, per binder, in
  `localStorage`.
- `GET .../documents` now answers with `folders` as well, so an empty folder is
  visible. It was not before: folders were derived from the documents, and a
  folder holding only a `.gitkeep` has none.
- `tests/binder-tree.pw.ts` — 5 tests.

**[#464 — edit mode](https://github.com/davidgraymi/bindersnap-editor-demo/pull/464)**
(`feat/edit-mode-on-a-draft` → `docs/handoff-binder-editing`)

The customer's sentence, built: _"an edit button that puts the user in edit
mode and then allows all these edits to happen on a branch. That way we can
save everything continuously and when they are ready open a CR."_

- **The app client knows about drafts.** `fetchBinderDraft`, `openBinderDraft`,
  `discardBinderDraft`, `proposeBinderDraft` in `apps/app/api.ts`. The five
  acts now take an `ActTarget` — `{changeNumber}` or `{draft}` — in place of a
  bare `changeNumber`, because they are alternatives rather than a list.
  Registry paths and a regenerated client for all four draft routes: #461
  shipped them server-only, so `packages/api-schema/registry.ts` had never
  heard of them.
- **`GET .../documents?draft=<branch>`** reads the tree at your own draft.
  Without it every rename appeared to snap back — the act is on the branch and
  the list was reading `main`. Refused for anybody else's draft, which is
  `resolveOwnDraftBranch` in `services/api/server.ts`; a draft that has been
  discarded answers 409 and the page leaves edit mode on it.
- **`?edit=1` and `?edit=propose`** — `editModeFromSearch` in
  `apps/app/binderShell.ts`. A route, per §4.1's lean: it survives a reload and
  it is linkable. `?edit=1` with no draft drops back out rather than opening
  one, because a read must not create.
- **The draft bar** (`BinderDraftBar.tsx`), listing the acts, with Propose and
  Discard. **Inline rename** in the tree, blur or Enter to commit, Escape to
  cancel — `BinderTreeView` grew a `renderRowLabel` slot alongside
  `renderRowActions`, and a row that fills it stops being a button for as long
  as it does. **The propose page** (`ProposeChangePage.tsx`), description
  prefilled from the acts, title deliberately not.
- New folder and Add a policy go into the draft while you are editing, and hide
  the "Put it in" change picker: a draft is already the answer.
- **The acts are written for a person now.** `planDocumentRename` wrote `Move
nursing/hand-hygiene.01M2DJ….md to nursing/hand-hygiene-and-ppe.01M2DJ….md`
  — which stopped being an internal string the moment a draft read back as its
  commits and prefilled a change request with them. All four planners in
  `services/api/binderShape.ts` now say "Rename Hand Hygiene to Hand Hygiene
  And PPE", "Add the folder Nursing". This changed three assertions in
  `tests/binder-drafts.pw.ts`.
- `tests/binder-edit-mode.pw.ts` — 8 tests. Plus `apps/app/proposeChange.test.ts`
  and four in `apps/app/binderShell.test.ts`.

**[#465 — drag to move](https://github.com/davidgraymi/bindersnap-editor-demo/pull/465)**
(`feat/drag-to-move` → `feat/edit-mode-on-a-draft`)

The customer's last unbuilt sentence: _"Moving a document should be a simple
drag and drop."_

- `apps/app/binderMove.ts` — `planMove`, `acceptsDrop`, `isManaged`. Pure, 13
  unit tests. The rules that decide whether a drop does anything, whether the
  row under the pointer should light up, and whether a row may be picked up at
  all. Not a substitute for the server's refusals: a rule is here when it is
  about the drag, and in `binderShape.ts` when it is about the binder.
- `BinderTreeView` grew a third slot, `rowProps`, for the drag attributes and
  the drop-target class. The tree still does not know what a drag is.
- **A root drop zone**, on screen only while something is in the air. Without
  it the top level is reachable only by dropping on empty space, which is not
  a target anybody can see — and a full binder has none.
- **A Move button beside the pencil**, opening a folder picker. Drag and drop
  needs a pointer, both ends of the move on screen at once, and is unreachable
  from a keyboard; a binder with forty folders and a scrollbar is the ordinary
  case, so this is a second route rather than a fallback.
- **`uid` is on `WorkspaceDocumentListEntry` now.** It was not, so the tree
  could not tell a policy from a `README.md` Gitea wrote with the repository —
  and drew a pencil on both. The second one cannot be renamed (no identity
  segment, nothing for the version tags to be named after) and the server says
  so after the click. It is not offered now.
- 6 more tests in `tests/binder-edit-mode.pw.ts`, including a folder dragged
  onto another taking its contents with it.

**[#466 — archive a policy](https://github.com/davidgraymi/bindersnap-editor-demo/pull/466)**
(`feat/archive-a-policy` → `feat/drag-to-move`)

§3's decision, built exactly as written — no archive branch, no webhook, no
second merge that could half-apply.

- `planDocumentArchive` in `binderShape.ts`. One removal, and it refuses a file
  with no identity: that one really would be a deletion, since no ref would
  point at the commit holding it.
- **`<uid>/archived-<n>` written at publish**, in the same pass as the version
  tags, so the audit line is atomic with the merge by construction.
  `listRemovedDocuments` is the other half of `listChangedDocuments` — and the
  caller subtracts the added half, because Gitea reports a rename as `deleted`
  plus `added` and reading the removals alone would call every rename an
  archiving.
- **`GET .../archive`** — the set difference, computed at read time from two
  reads that already exist. Nothing is stored, so nothing can drift.
- **`readVersionStamp` in `version-stamp.ts`.** An archived document is not on
  `main`, so its tags are the only record of what it was called; the two
  labelled lines at the foot of a version stamp were written for exactly this.
  It is the first thing in the product to read a tag message back, and the file
  header used to say nothing ever would — updated, with the reason.
- An **Archive** button beside Rename and Move, documents only. No confirm
  dialog: the act goes into the draft, the bar names it, and Discard undoes the
  lot — the draft _is_ the undo.
- A quiet link under the tree into the archive, gone when the archive is empty.
  `archivedCount` rides along on the documents payload, free from the tag read
  that already answers every row's version.
- `tests/binder-archive.pw.ts` — 9 tests, including one asserting the versions
  are still readable **after** the file has left `main`, and one asserting no
  second branch is made.

**[#467 — restore](https://github.com/davidgraymi/bindersnap-editor-demo/pull/467)**
(`feat/restore-from-the-archive` → `feat/archive-a-policy`)

§3's other half, built as written: an ordinary change, not an undo.

- `readArchivedDocument` in `workspaceDocuments.ts` — the tree at the last
  version tag, then the blob at that ref. Two calls, no archive branch, and the
  base64 is never decoded on the way through, so nothing can mangle an encoding
  it does not touch.
- `planDocumentRestore` writes the file back **at the filename it left with**,
  which is what keeps the identity and therefore the history: it returns as
  v(N+1), not as a new document at v1.
- **Its old folder if it still exists; the top level if not**, and the act says
  which. Note that archiving the only policy in a folder empties it, and an
  empty folder with no `.gitkeep` stops existing — so "the folder is gone" is
  the common case rather than the edge one.
- `handleBinderShapeChange`'s `plan` may be async now, and takes the client.
  Restore is the first act whose operations are not a pure function of the body
  and the tree; the alternative was a second copy of "resolve the binder, check
  the access, read the tree, join or open a change" for one extra read.
- **It proposes.** A policy reappearing on the record without a decision would
  be the one act in the product that skipped review. The button says
  "Restore as version 2" so the effect on the history is not a surprise.
- 6 more tests in `tests/binder-archive.pw.ts`, 6 on the planner.

**[#468 — form controls](https://github.com/davidgraymi/bindersnap-editor-demo/pull/468)**
(`fix/form-controls-are-one-system` → `feat/restore-from-the-archive`)

§4.3's second item, which §4.3 itself says to do first because the shell sits
on it.

- **One control class.** `.create-document-input` is gone; everything is
  `.bs-input`. There were two implementations with different type sizes,
  borders, radii and padding, so a field's height depended on which screen it
  was on.
- **A `<select>` matches an `<input>` now**, which it cannot be made to do with
  padding alone — the browser draws it its own way. `appearance: none`, a
  pinned `line-height`, and the chevron drawn back on as an inline background.
  That was the customer's named example.
- **One button implementation.** `.doc-header-submit` is gone; it was 13px type
  and 9px padding against `.bs-btn`'s 14px and 13px, so "New folder" and "Edit"
  sat side by side in the binder's header at 42px and 40.1px. `.bs-btn` also
  gained a transparent border, so a filled variant and an outlined one have the
  same box rather than differing by the two pixels the border takes up.
- **Two sizes, each pinned by `min-height`**, and a rule: _a row uses one of
  them._ `.bs-input--sm` is exactly `.bs-btn--sm`'s 32px.
- **`tests/design-controls.pw.ts` is the guard.** It walks eight screens, finds
  every row holding more than one control, measures them, and fails naming the
  row and the heights. Verified by putting the old 36px search box back and
  watching it fail.

**Build on `fix/form-controls-are-one-system`.** It is the tip.

---

## 3. Decisions already made

Reopening these costs a day and lands back in the same place. Each one has its
reason next to it; if you disagree, disagree with the reason.

### A draft is a branch, not a row in a table

`draft/<username>/<stamp>`, one per person per binder. ADR 0004 says to use the
Gitea primitive where one exists, and a branch with commits and no pull request
is exactly what "work in progress nobody has been asked to look at" means.

- **Opening is idempotent.** Pressing Edit twice resumes rather than forks —
  `openDraft` looks for an existing draft first.
- **The stamp is not decoration.** A proposed draft keeps its branch name for
  as long as its change request is open, so `draft/alice` alone would collide
  with work Alice proposed an hour ago.
- **A draft stops being a draft the moment a change request sits on it.**
  `listBinderDrafts` subtracts the open changes rather than trusting the prefix.
  Skip that and a proposed draft appears in both lists and offers "propose
  this" against something already proposed.
- **Other people's drafts are visible; their contents are not.** Knowing
  somebody is editing is what stops two people making the same folder twice.
  Reading unproposed work is not something a draft offers.
- **A draft reads back as the list of things you did to it**, because the acts
  are the commits and the planners already write them in plain language ("Add
  the folder nursing", "Rename Hand Hygiene to Hand Hygiene and PPE"). That is
  what should prefill the change request's description.

### The author writes the title

The server used to write it — `Add nursing/hand-hygiene`. A change request is a
_request_; it is addressed to colleagues, and the words should be the author's.
`POST .../changes` takes `{title, description}` and refuses an empty title.

Body convention, unchanged and relied on by `parseChangeTitle` in
`apps/app/documentDisplay.ts`: **first line is the title, the rest is the
description.**

### Archive, not delete — and the tags are already the archive

The customer's words: _"delete should be allowed, but I think it should be
called archive because delete has connotations."_ They also raised, and then
agreed against, a design where archived files were pushed to a separate
`archive` branch by a second hidden PR.

**Do not build the archive branch.** The reasons, because they will come up
again:

1. Two PRs that must both merge can half-apply. If the archive-branch merge
   fails after the `main` merge succeeds, the document is gone from `main` and
   absent from the archive — evidence loss, which is the failure ADR 0004
   exists to prevent.
2. A webhook or runner fixes the atomicity by adding a moving part to an
   architecture that deliberately has none. ADR 0005 says in as many words: no
   sidecar, index, webhook or reconciler.
3. ADR 0004 permits derived indexes "only if rebuildable from Gitea and
   droppable without loss." An archive branch that is the only home of an
   archived document is not derived — it is primary state with no second
   source, and it can drift from the tags.

**What to build instead.** A tag is a ref, independent of any branch. Deleting
a file from `main` does not touch the tags pointing at the commits that
contained it, and git never collects a commit reachable from a ref. Every
archived document's blob is therefore already permanently reachable, and has
been since ADR 0005. So:

> **archived = (every UID that has a version tag) − (every UID currently on `main`)**

Two reads, both already implemented and both already needed by other pages:
`listAllTags` and `readWorkspaceTree` (`services/api/gitea-client/workspaceDocuments.ts`).
It is derived, rebuildable and droppable — it passes the ADR 0004 test rather
than needing an exception to it.

The display comes free. The version tag's message already carries `title`,
`slugPath` and `path` as they stood at that publish — ADR 0005 gave it that
second job when the tag name became a ULID. See `services/api/version-stamp.ts`.

**For the audit line** — who archived it, when, under which change — write one
more tag at publish: `<uid>/archived-<n>`, in the same transaction that writes
the version tags. Same primitive, same code path, atomic with the merge by
construction. `refs/tags/<uid>/v3` and `refs/tags/<uid>/archived-1` coexist:
both are files under the same ref directory. The `-<n>` suffix is because a
document can be archived, restored and archived again, and each is a separate
fact.

Checked, so you do not have to: `versionFromTag` and `documentUidFromVersionTag`
in `packages/utils/documentPath.ts` are both anchored to `/v<digits>$`, so an
`archived-1` tag parses as "not a version" rather than as garbage.

**Unarchive** is an ordinary change: read the blob out of the last version tag,
write it back, propose it. It keeps its UID, so it returns as v(N+1) rather
than as a new document at v1 — which is honest, because it is the same policy
coming back.

**A new document with the same name still starts at v1**, which the customer
asked about. Version tags are keyed on the UID, not the path, and a new
document mints a fresh UID. Nothing about archiving disturbs that.

### The tree

- **Nothing starts shut.** A policy manual is read by looking, and a surveyor
  asking for the infection control policy should see it without opening
  anything.
- **The collapsed set is stored, not the expanded one.** That is what keeps
  "open by default" true — a folder made after somebody last looked is not in
  the set, so it opens. Storing the open set would have every new folder arrive
  shut.
- **Intermediate levels are inferred.** A folder holding only other folders may
  never be named by the tree read; without inferring it, its children are
  orphans whose parent does not exist and which render nowhere.
- **Folder names are titled the way documents are.** Somebody typed "Estates
  and Facilities"; `estates-and-facilities` is the storage format leaking onto
  the page.
- **`BinderTreeView` is rendering only.** Which folders are open and what a
  click means belong to whoever is showing it. That is what lets edit mode
  reuse it — there is a `renderRowActions` slot on every row for exactly this.

---

## 4. What to build next

In this order. Each is its own PR; the customer reviews iteratively and has
asked not to be handed one large diff.

### 4.1 Edit mode — built (#464, #465), with three things left undecided

Both PRs are in review. What is still open, in the order it is likely to bite:

- **What edit mode does with a document somebody _else_ has in an open change.**
  The count is on every row — `openChangeCount` — and edit mode ignores it. A
  rename that lands on top of somebody's open change is not refused; it merges
  badly later. The cheapest honest answer is probably a marked row and a
  sentence, not a refusal.
- **A binder can list a file this product did not write.** A `README.md` Gitea
  made with the repository has no identity segment, so it cannot be renamed,
  moved or versioned. `bootstrapEmptyMainBranch` deletes it on a new binder, so
  this only reaches binders made before that or by another route — but it does
  reach them, and the answer "draw it, offer nothing on it" (which is what
  #465 does) may be worse than not listing it as a policy at all.
- **The draft bar only recounts after your own acts.** Somebody starting a
  draft while you are in one shows up on your next act, not immediately.
  Polling was not worth it for a bar that is advisory; say so if it is not.

And one that is deliberate rather than undecided: **a folder being renamed
cannot be expanded**, because the twisty is replaced by the input. Probably
right, never tried by anybody but us.

### 4.2 Archive and restore — built (#466, #467)

Both in review. Two things the customer has not seen an answer to yet, asked in
the pull requests:

- **Where a restored policy lands when its folder is gone.** Built as: the
  binder's top level, with the act saying so. It is more common than it sounds
  — archiving the only policy in a folder empties it, and an empty folder with
  no `.gitkeep` stops existing.
- **Whether restoring proposes or publishes.** Built as: proposes, like
  everything else, with the button saying "Restore as version 2" so the effect
  on the history is not a surprise.

Neither is settled until they say so. Both are one line to change.

Still open, and nobody has asked for it: **archiving a folder.** It would mean
archiving everything in it, which is a much larger act than the button would
look like. A folder is emptied by moving what is in it, and then it is just a
folder.

### 4.3 The rest of the customer's list

Still outstanding, in no fixed order:

1. **Rename a binder.** A binder is a Gitea repository; renaming one changes
   every URL that points at it. Worth checking whether Gitea redirects the old
   name before promising it in the UI.
2. ~~**Form controls.**~~ Done in #468. Two sizes, each pinned by height, and
   a test that walks the product and fails when a row mixes them.
3. **Page shell — next.** The customer chose the direction already: _"We need
   less editorial and more useful tool. Not every page has to be the same but
   the padding and style should be the same. Ultimately I just want the tool to
   work intuitively."_ Sidebar and top nav are liked; page content needs the
   work. The controls it sits on are done (#468), and the same trick is
   available: measure the product in a browser and let a test hold the answer,
   rather than deciding by screenshot. Page padding and heading sizes are the
   obvious next measurement.
4. **A sign-off rule that covers the sign-off rules themselves.** A fourth
   scope matching `.gitea/CODEOWNERS`. See `packages/utils/codeowners.ts`,
   which already has `SignOffScope = "binder" | "folder" | "document"`.
5. **`formatDocumentName` title-cases the joining words.** "Hand Hygiene and
   PPE" comes back as "Hand Hygiene **And** PPE", in the tree, in the change
   request, and in the version tag. `packages/utils/documentTitle.ts` is the
   one rule that turns a slug back into a heading and it splits on `-` and
   capitalises every word. The fix is a stop-list ("and", "of", "for", "the",
   "in", "to"), but it changes what every title stamped from here on says while
   the ones already written keep the old spelling — so it is a decision about
   the record rather than about wording, and it wants an answer before a
   customer has a year of tags. Asserted as-is in `binderShape.test.ts` so the
   test says what the product does rather than what it should do.
6. **Two sign-off changes at once.** Currently refused —
   `services/api/server.ts` around the `sign-off/` prefix check: _"Two would
   leave competing versions of the rules in review, and whichever merged last
   would silently win."_ The customer said _"Maybe this is fine, but it seems
   weird. If it's a headache we don't really need this."_ The guard is
   defensible; the message could be better. Left as judgement.

---

## 5. Working notes

Things that cost time to find out. None are in the code comments because they
are about the environment, not the code.

**The `api` container does not hot-reload.** `apps/` and `packages/` are
bind-mounted and reload; `services/api` builds into the image. Any server change
needs `bun run down && bun run up` before an integration test will see it. This
will otherwise look like your fix did nothing.

**A fresh worktree needs `bun install` before the stack will come up.** The
seed container mounts this worktree at `/workspace` and nothing above it, so
module resolution cannot walk up to the main checkout's `node_modules` the way
it does on the host. It fails at seed with `Cannot find package 'docx' from
'/workspace/tests/seed-documents.ts'`, which reads like a broken dependency and
is not one. `bun run down` can surface it later rather than sooner, because it
removes the `app-node-modules` volume on the way out.

**Never run `docker compose` directly**, and never edit the ports in `.env`.
Use `bun run up` / `down` / `stack status`. A raw `docker compose down` from a
worktree kills whatever is on the default ports — in practice the developer's
own stack.

**The approval race.** Approving a change and publishing it immediately hits a
window where Gitea has not finished processing the push and dismisses the
approval, so the publish fails with "does not have enough approvals" right
after the review returned 200. It only shows under the load of a full suite
run. `approveChange` in `tests/workspace-provisioning.pw.ts` and
`approveAndPublish` in `tests/binder-tree.pw.ts` both retry; copy one of them
rather than writing a third.

**`unwrap` treats "no data" as an error**, so a Gitea endpoint answering `204 No
Content` comes back as a thrown `GiteaApiError` carrying status 204. Branch
delete is the one place this bites today — see the comment in `discardDraft`.
If you add another 204 endpoint, check `response.ok` yourself.

**A multipart form has no nulls.** A field nobody filled in reads back as `""`,
not `null`. `resolveWorkTarget` treats an empty-string `draft` as absent for
this reason; getting it wrong refused every upload that did not name a draft.

**Gitea reports a rename as `deleted` + `added`**, not `removed` + `added`.
`ABSENT_STATUSES` in `workspaceDocuments.ts` handles both spellings.

**The collision that matters is the address, not the path.** Two policies named
"Hand Hygiene" in different folders have different identity segments, so their
filenames differ while the address a link resolves by does not. `planFolderRename`
checks both; a path-only check passes and leaves a link resolving to whichever
came first.

**The dev server serves a stale copy of the design tokens.** `apps/app/app.css`
`@import`s `packages/ui-tokens/css/bindersnap-tokens.css`, and the app container
bundles three stylesheets that each inline it. Editing the token file
re-bundles some of them and not others, so the last one loaded can be minutes
old — which looks exactly like a CSS rule that does not work: the class is on
the element, the served bundle contains the rule, and the computed style is the
old value. Cost an hour. `bun run down && bun run up` before you believe a
token change has failed. Editing `app.css` itself does **not** reliably
invalidate them.

**A publish may now write two kinds of tag.** Version tags for what the change
added or changed, and `<uid>/archived-<n>` for what it removed. Both go in one
pass in `handlePublishWorkspaceChange`, which is what makes the audit atomic
with the merge. If you add a third, put it in the same loop rather than in a
second one — two passes over one merge is the half-apply this design exists to
avoid.

**Branch prefixes still carry meaning.** `upload/<slugPath>/…` is read to work
out which document a change is about; `sign-off/…` marks a rules change;
`shape/…` a folder change; `draft/…` a draft. The publish guard's
`mayVersionNothing` lists the prefixes that may legitimately write no version
tag. Adding a fifth prefix means auditing those readers.

**The stack is squash-merged.** When PRs land, your local commits are the
pre-squash originals and `git rebase --onto origin/<base> <old-base>` is the
fix. `gh pr create` fails with "No commits between…" when the base branch has
been deleted after merging — check `gh pr list --state all` to find the new
base.

**Run the whole integration suite before opening a PR.** Several regressions in
this stack were caught only there: the multipart empty-string bug by
`workspace-provisioning.pw.ts`, and `mobile-shell.pw.ts` reading a class name
the tree renamed.

---

## 6. Quick reference

```bash
bun run up            # start this worktree's stack, waits until ready
bun run stack status  # your ports, URLs and the seeded password
bun run down          # tear it down

bun run test:app      # apps/app, packages/*
bun run test:ops      # services/api, scripts, infra
SKIP_STACK=1 bun run test:integration   # reuses a running stack
bun run format        # before every commit
```

Binder routes added by this work:

```
GET    /api/app/binders/{org}/{binder}/documents?draft=<branch>
                                                 the binder as it stands in your draft
GET    /api/app/binders/{org}/{binder}/archive    what this binder has taken off the record
GET    /api/app/binders/{org}/{binder}/draft      your draft, its acts, who else is editing
POST   /api/app/binders/{org}/{binder}/draft      start editing, or resume
DELETE /api/app/binders/{org}/{binder}/draft      discard yours
POST   /api/app/binders/{org}/{binder}/changes    propose it — {title, description}
```

Acts, all of which take `changeNumber` or `draft`:

```
POST /api/app/binders/{org}/{binder}/documents           add a policy
POST /api/app/binders/{org}/{binder}/document-revisions   a new version
POST /api/app/binders/{org}/{binder}/folders              make a folder
POST /api/app/binders/{org}/{binder}/folder-renames       rename or move a folder
POST /api/app/binders/{org}/{binder}/document-renames     rename or refile a policy
POST /api/app/binders/{org}/{binder}/document-archives    take a policy off the record
POST /api/app/binders/{org}/{binder}/document-restores    bring one back, as its next version
```
