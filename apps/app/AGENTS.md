# AGENTS.md — the app (`apps/app`)

Read with the root `AGENTS.md`. This file is the detail behind three of the
app's screens — the editor, the change comparison and the conflict resolver —
which the root guide only summarizes.

## The document editor

`packages/editor/` is a word processor for policies, imported by the SPA and
laid out the way Word is: a ribbon (Home, Insert, View, and a Table tab while
the cursor is in one) over a sheet of Letter on a desk, the headings and find
and replace in a navigation pane, page and word counts and zoom in a status
bar. `apps/app/components/DocumentEditorPage.tsx` is the page around it, at
`/{org}/{binder}/-/blob/main/{path}?edit=write&draft=…`: **Save commits the document to
the author's draft** through the ordinary revise endpoint, so the version on
record does not move until the draft is proposed and published. Edit on a
document's page opens (or resumes) that draft first. Only a file the editor
writes — `*.json` — is offered it; a Word file or a PDF is edited in the
program that made it and uploaded as a new version. It opens **full page**:
while it is mounted it sets `bs-writing` on `<html>`, and the shell drops the
sidebar and the binder's file panel so Letter fits at 100% on a laptop. The
editor has **its own file panel** (`components/DraftFiles.tsx`), read at the
draft: a policy opens beside the last one, and New starts one, without leaving
the editor. **Several policies are open at once**: moving to another keeps
the words typed in each (`OpenPolicy` buffers in `DocumentEditorPage.tsx`,
keyed by `uid`, so a rename or move keeps the same open file and its
editor); the panel marks every policy with unsaved words, the status bar
counts the others, and Save all commits them, one act each. Only leaving
the editor — Close, Propose, another draft — asks, and offers Save all. **The editor owns the draft**: "Saving to" is the `BinderDraftPicker`
(switch or start a draft on the same policy) and Propose opens the propose
step for that draft, returning to the policy on Back. Close lands on the
document at `?edit=1&draft=`, with the draft bar (Propose, Discard) at the foot
as on the binder's own page. It says "In <draft>" and lists your drafts
in the file panel's "What you are reading". The binder's own page offers the
same picker while reading, with "On the record" as a place. **Edit on a
binder opens the editor** (`pickPolicyToWrite`: the policy last written in the
draft, else the first) — only a binder with nothing the editor writes opens
the tree. **The editor's file panel organizes the draft in place**: each row
renames (pencil, double-click on the open one, or F2), moves (drag onto a
folder, or Move), and a policy archives; New folder is in its head. A
right-click, the menu key or Shift+F10 on a row opens the same acts as a
menu, and a folder's adds "New document here" and "New folder here". Every act
goes into the same draft. When one moves the open policy — renaming it,
refiling it, or renaming a folder above it — its unsaved words are saved first
and the editor follows it by identity (`uid`) to its new address; archived, it
goes on to the next policy to write (`actInEditor` in `BinderShell.tsx`).
The title in the editor's header is the open policy's name and renames it
the same way.
Archiving from the panel offers Undo, and the panel's foot lists the archive
with Restore, both into the same draft. Organize on the binder's header is the
same tree on the binder's own page. **An open change request is edited in
place by its author**: Edit on its Proposed version card opens the editor at
`?edit=write&change=N`, which reads the change's branch and saves with
`changeNumber` (the server's `resolveChangeToJoin`) — no draft, no Propose,
and Close returns to the change.
**A proposed draft is still its owner's draft**, like a branch with a pull
request open on it: `listBinderDrafts({ proposed: true })` keeps it, with its
`changeNumber`, in the owner's picker and in `?draft=` reads; a save into it
lands in the change; it keeps its name, which the change's branch chip shows
(`branchLabel`) and links back to. It cannot be proposed again or discarded —
the bar and the editor offer "Change N" instead. Publishing deletes a draft
branch. Other people's proposed drafts are change requests, not "others".

**Pictures are embedded, not linked** (`packages/editor/imageFiles.ts`): chosen,
pasted or dropped, a picture is scaled to at most 1600px and written into the
document as a `data:image/…;base64` source, so it is versioned with the words
in the same commit and cannot change under an approved version. Raster types
only; the sanitizer (`isSafeImageSrc`) refuses SVG and every other `data:`
address. Limit 1.5 MB per picture after scaling. A picture's size is its
`width` attribute alone, in pixels at 100% zoom (`extensions/PictureSize.ts`,
the corner handles, and the Picture tab's presets); a height is never stored,
so it cannot be saved squashed.

**AutoRecover** (`apps/app/editorRecovery.ts`): unsaved words are kept in this
browser's `localStorage`, per org/binder/draft/policy, 800ms after the last
change, and offered back (Restore / Discard) the next time that policy opens
in that draft. Dropped on save and on any deliberate "without saving". It is a
device-local safety net only — nothing reaches Gitea until Save.

`documentSchema.ts` is the one list of Tiptap extensions both the editor and
the reader (`apps/app/editorDocumentHtml.ts`) load. Add a node or an attribute
there, never to one side: ProseMirror drops what its schema does not declare,
so formatting added only to the editor vanishes for every reviewer. The
sanitizer keeps a filtered set of inline styles (`safeStyle` in
`packages/utils/sanitizer.ts`) for the same reason.

If you change anything in `packages/editor/` that affects visual appearance, note it
in your PR description.

## The change comparison

`apps/app/components/ChangeComparisonPage.tsx` is the screen: **everything one
change does to a binder, on one page.** A change is the unit of approval and
may touch several documents, so the question a reviewer opens it with is what
the _change_ does — not what it does to whichever document a selector happens
to be pointing at. It is reached from the change at
`/{org}/{binder}/-/changes/3/diffs`, and each document's section carries an
anchor (`#cmp-nursing-hand-hygiene`) so "look at the hand hygiene diff" is a
link somebody can send.

Three shapes, because a change does three things to a document and only one of
them is a diff: a revision is read against the version it replaces, a new
document has nothing to be read against so it is read whole, and a removal has
no file on the branch at all — it offers the last version on record instead.
What is in the list and what each row says lives in
`apps/app/changedDocuments.ts`, testable without a browser.

**It is laid out the way a code review is.** Under the title, one line says
who wants to publish how many documents from which branch, and the branch is
a link to the binder's root read at that branch (`/{org}/{binder}/-/tree/{ref}?change=N`
— the whole tree as the change would leave it, not its first file). Below it, a tree of only what changed —
grouped by folder — sits on the **left**, and one panel per document on the
right, in the same order. **Every fact and control about a document is in
that panel's single bar**: its path, its word counts (`+12 −3`), its version
step, a badge for New, Archiving/Archived or Restoring/Restored (a revision
gets none — it is what nearly every row is), and Viewed, View and Download.
A restore diffs exactly like a revision, so the badge is the only thing that
tells them apart: the server sets `restored` on a changed document from the
tags (the last thing that happened to that identity was an archiving). View is a real link to the exact file
on the change's branch. Nothing about a document sits below it.

A move or rename is drawn in the path itself — the old path struck out in the
removed colour, the new one in the added — never as a sentence under the bar.
Two versions whose words did not move draw nothing at all: the bar already
says what happened, and the page never announces "nothing changed".

It is still the binder's grammar: one document is a `.bs-panel`, the tree is
a `.bs-panel` of `.bs-row`s in a `.bs-rail`. The first draft invented its own
rail, row, card and head, and read as a different product the moment you
arrived from the change request.

The tree is the map: every document, its word counts as each comparison
finishes, and which one is being read. Comparisons mount a screen ahead of
the viewport rather than all at once — comparing one Word file or PDF means
fetching two files and loading a parser, and a change touching eight
documents would otherwise spend a reviewer's first ten seconds on documents
they have not looked at. Ticking a document as viewed is a bookmark in
`sessionStorage`, never a review: the record of who approved what is in
Gitea, and the tick is drawn so it cannot be mistaken for part of it.

**Every file read on this screen goes by identity, never by address.** A change
that renames a policy has two different addresses for one document and the base
ref has never heard of the new one, so a read by `slugPath` 404s at one of the
two refs — on exactly the change the screen exists to explain. The scope is
built from `row.path`, which carries the identity (ADR 0005). The rename itself
is drawn in the file's bar from `previousSlugPath`, because the diff cannot
say it: both refs read identically.

One document's comparison is `apps/app/components/DocumentComparison.tsx`,
which renders a change against the version it replaces for every file type the
app previews. What it compares and what it says about it lives in
`apps/app/documentComparison.ts`, so both are testable without a browser.

The comparison is built on libraries, not hand-rolled: `diff` for word-level
text, `node-htmldiff` for diffing two rendered documents as markup,
`pdfjs-dist` for the words inside a PDF, and `mammoth` for the contents of a
Word file. Everything runs in the browser — there is no conversion service and
no binary on the API host, and nothing is uploaded anywhere to be rendered.
Both heavy libraries are imported on demand and code-split, so a reader who
never opens a PDF or a Word document never downloads them. pdf.js runs on the
main thread via `globalThis.pdfjsWorker`, so there is no worker URL to get
wrong in a subdirectory deploy.

Markdown, Word files and PDFs all end up on the same path: render both
versions to HTML, diff the markup, sanitize. That is what makes the answer a
readable policy with the change marked inside it rather than two columns of
source. A PDF carries no headings — only glyphs at coordinates — so
`apps/app/pdfText.ts` recovers the structure from the page itself: lines from
baselines, paragraphs from the vertical gaps between them, headings from type
size and face relative to whatever the body of _that_ document is set in.
Without that step a policy's title, its first heading and its opening sentence
run together into one line.

Two images are compared by eye instead: side by side, or stacked with
`mix-blend-mode: difference`.

`.docx` renders; a legacy `.doc` does not, and neither do `.xlsx` or `.pptx`.
Those keep the honest card that names the file type and offers both versions
to download. Converting them would mean a conversion service on the backend —
deliberately not built, because everything above covers the documents the ICP
actually keeps a policy manual in.

Added text is green and removed text is coral, and both carry an underline or
a strike as well as a colour, so the comparison still reads without one.

## Resolving a change's conflicts

A change that is behind `main` and would not merge — a document changed both
in the change and in the binder since it began — offers **Resolve conflicts**
where it would offer Bring up to date. The resolver is
`apps/app/components/ChangeConflictsPage.tsx` at
`/{org}/{binder}/-/changes/N/conflicts`.

The server (`services/api/gitea-client/conflicts.ts`) reads the three trees —
the merge base, the change, and `main` — and lists every file changed on both
sides, **paired by identity** (ADR 0005) so a policy renamed on one side and
edited on the other settles itself instead of reading as a deletion. The page
merges a document the editor wrote a block at a time and a text file a line at
a time (`apps/app/threeWayMerge.ts`, git's diff3), asks only about the places
both sides changed, and offers a Word file or a PDF as a whole choice.

Gitea cannot write a merge commit with chosen contents, so a resolution is
three steps on the change's branch: commit the published version of each
conflicting file, run the ordinary update merge (which now has nothing to
disagree about), then commit what the person chose. A failed merge is undone
with a commit restoring the change's own versions. The request names the heads
the page read, and is refused if either has moved.
