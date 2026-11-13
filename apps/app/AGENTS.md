# AGENTS.md — the app (`apps/app`)

Read with the root `AGENTS.md`. This file is the detail behind three of the
app's screens — the editor, the change comparison and the conflict resolver —
which the root guide only summarizes.

## Tab titles and help

**Every page names itself in the browser tab** (`pageTitle.ts`): the thing
first, the place second, "Expenses Policy · Corporate · Bindersnap".
`routeTitleParts` gives every `AppRoute` a title from its address alone, so a
new route kind does not compile until it has one. A page that has read
something better calls `usePageTitle` (a change request says its own title;
the editor adds its unsaved mark). Never set `document.title` directly.

**Help opens on the guide about the page on screen.** The guides are data
(`helpGuides.ts`), served as pages on the public site (`apps/help`).
`guideForRoute` in `helpLinks.ts` maps a route to its guide, and the
sidebar's and the profile menu's Help use it; a page with no guide of its own
opens the list. A new screen that raises its own questions gets a guide, or a
section of one, and an entry there. `HelpLink` links to one guide or one
section, by its heading: a heading's anchor is `helpSectionId(heading)`, and
`helpLinks.test.ts` lists every section the app links to, so rewording a
heading fails a test instead of breaking a link. A guide says only what the
app does: when a screen changes, its guide changes in the same PR.

## The document editor

`packages/editor/` is a word processor for policies, imported by the SPA and
laid out the way Word is: a ribbon (Home, Insert, View, and a Table tab while
the cursor is in one) over a sheet of Letter on a desk, find and replace in a
bar floating over the page (Ctrl+F, Ctrl+H), page and word counts and zoom in a
status bar. The headings are the file panel's Outline tab: `DocumentEditor`
hands its `aside` the outline (`OutlineSlot`), and View → Outline opens the
panel on it. `apps/app/components/DocumentEditorPage.tsx` is the page around it, at
`/{org}/{binder}/-/blob/main/{path}?edit=write&draft=…`: **Save commits the document to
the author's draft** through the ordinary revise endpoint, so the version on
record does not move until the draft is proposed and published. Edit on a
document's page opens (or resumes) that draft first. Only a file the editor
writes — `*.json` — is opened in it. **A Word file or a PDF chosen in the
editor is shown there, read only** (`EditorFileCover`, the editor's `cover`):
the document page's own preview on the desk where the page goes, the ribbon
locked, the file panel and status bar where they were, and a note at the top
right — "Word document · View only", Edit in Bindersnap, Upload new version
(into the draft), Download — so moving
to one never leaves the editor. Moving between documents replaces the address
rather than adding to Back. A Word file or a PDF is edited in the
program that made it and uploaded as a new version, **or converted on request**:
"Edit in Bindersnap" (the editor's file panel, and the note on a file shown
in the editor) opens
`ConvertDocumentModal`, which reads the file in the browser
(`convertToEditor.ts`: mammoth for `.docx`, pdf.js for a PDF, then the
editor's own schema) and says what the conversion loses _before_ anything is
written. Confirming revises the same document with `source: "converted"`
into the author's draft — the server keeps the filename's identity segment
and removes the original (ADR 0005), so version numbering carries on, the
original stays in the record, and a reviewer reads the conversion as a diff.
The same conversion is offered on upload — "Make it editable in Bindersnap"
in Add a document (one file or a batch) and in Upload new version
(`ConvertOnUploadField`) — **unticked, every time**: a file is often uploaded
to be kept exactly as it is. In a batch, a file that will not convert is
added as the file it is, and the dialog lists it. It is never done
automatically. Legacy `.doc`, `.xlsx`, `.pptx` and a PDF with no text layer are
not convertible. A Word file's pictures come across, scaled and embedded as
the editor embeds them; one the editor would refuse is left out and named in
the notes. "Edit in Bindersnap" reads the file from the draft it will write
into, never the record while a draft holds a newer copy, and is not offered on
a change request. The comparison of a converted version sniffs each side's
bytes (`sniffDocumentKind`), because only the new `.json` name is known.

The editor opens **full page**:
while it is mounted it sets `bs-writing` on `<html>`, and the shell drops the
sidebar and the binder's file panel so Letter fits at 100% on a laptop. The
editor has **its own file panel** (`components/DraftFiles.tsx`), floating over the desk under the ribbon (`DocumentEditor`'s `aside`), shut to a small button, its width dragged from its right edge, read at the
draft: a policy opens beside the last one, and New starts one, without leaving
the editor. **Several policies are open at once**: moving to another keeps
the words typed in each (`OpenPolicy` buffers in `DocumentEditorPage.tsx`,
keyed by `uid`, so a rename or move keeps the same open file and its
editor); the panel marks every policy with unsaved words, the status bar
counts the others, and Save all commits them, one act each. Only leaving
the editor — Close, Propose, another draft — asks, and offers Save all. **The editor owns the draft**: "Saving to" is the `BinderDraftPicker`
(switch or start a draft on the same policy) and Propose opens the propose
step for that draft, returning to the policy on Back. Close lands on the
document read at the draft, `/-/blob/{draft}/{path}` (a folder on the desk
closes to `/-/tree/{draft}/{folder}`), with the draft bar (Propose, Discard)
at the foot. It says "In <draft>" and lists your drafts
in the file panel's "What you are reading". The binder's own page offers the
same picker while reading, with "On the record" as a place. **One button,
Edit** (D8 of `docs/design/sign-off-rules-in-place.md`): the binder, folder
and document pages offer nothing else, to anyone who can write. Edit on a
document opens it in the editor; on a folder's page it puts the folder on the
desk; on a binder it opens `pickPolicyToWrite`'s policy (the last written in
the draft, else the first), or the binder's top folder when there is none.
**A folder on the desk** (`EditorFolderDesk`, in the `cover` slot, at
`/-/tree/{ref}/{folder}?edit=write`) is a head card — Upload files here, New
document here — over the binder page's own list, read at the draft, with no
Published picker. A folder's name in the file panel opens it there; its
arrow opens and shuts it in place. **"Who signs off here"** is the editor's
right-hand panel (`EditorSignOffSide`, in the `aside` slot beside the file
panel): the rules for the folder or document open, read at the draft; Set
here is edited there (`PUT …/rules/sign-off`, one act per edit), From above
is read only. **The editor's file panel organizes the draft in place**: each row
renames (pencil, double-click on the open one, or F2), moves (drag onto a
folder, or Move), and a policy archives; New folder is in its head. A
right-click, the menu key or Shift+F10 on a row opens the same acts as a
menu, and a folder's adds "New document here", "Upload files here" and "New
folder here"; Upload is also in the panel's head. Every act
goes into the same draft. When one moves the open policy — renaming it,
refiling it, or renaming a folder above it — its unsaved words are saved first
and the editor follows it by identity (`uid`) to its new address; archived, it
goes on to the next policy to write (`actInEditor` in `BinderShell.tsx`).
The title in the editor's header is the open policy's name and renames it
the same way.
Archiving from the panel offers Undo, and the panel's foot lists the archive
with Restore, both into the same draft. **There are two places, reading and the editor, and no third.** The
binder's tree had an edit mode of its own at `?edit=1` (Done and Edit, rename
and drag in place). It is retired: the editor's file panel organizes, and a
draft's home is the binder read at the draft, where `BinderDraftBar`
proposes or discards it (`homeDraftBranch` in `BinderShell.tsx`). An old
`?edit=1` address is rewritten to that page. Do not add a mode between
reading and the editor. **Reading a draft is reading a
branch**: the binder's version picker opens one of your drafts at
`/-/tree/{draft}`, the same page as the record's, under the draft's name,
with "Who signs off here" read there (`?ref=` on `GET …/rules/sign-off`).
The explorer's links, a document's path and a folder's contents stay on the
branch or draft being read, and Edit on your own draft's page carries on
in it. **An open change request is edited in
place by its author and its co-editors** (the pull request's assignees,
named on the change; the server refuses anyone else's save): Edit on its Proposed version card opens the editor at
`?edit=write&change=N`, which reads the change's branch and saves with
`changeNumber` (the server's `resolveChangeToJoin`) — no draft, no Propose,
and Close returns to the change.
**Edit on a document already in an open change asks first**
(`EditChoiceDialog`, `editChoices.ts`): one row per change, with "Continue
in it" for its author and co-editors (into the editor at `?change=N`, or the
change itself for a Word file or a PDF) and "Comment on it" for everybody
else (its Changes tab), and always "Start a separate change".
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
`packages/utils/pdfText.ts` recovers the structure from the page itself: lines
from baselines, paragraphs from the vertical gaps between them, headings from
type size and face relative to whatever the body of _that_ document is set in.
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

**A reviewer comments on the words** (`components/PassageComments.tsx`,
`textAnchor.ts`): select text in a document here, choose Comment, and the
thread remembers the passage. `PassageComments` wraps whatever draws the
document and works on the text of the `.doc-preview-prose` inside it, so the
three renderers know nothing about it. The passages are painted with the CSS
Custom Highlight API rather than wrapped in elements: the page is markup
somebody approved, and it is not edited to show a comment. An anchor is the
words and their neighbours, not an offset, so it survives the document
changing above it and says so when the words themselves have gone.

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
