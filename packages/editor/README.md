# `packages/editor/` — the document editor

A word processor for policies, built on Tiptap. Word's layout — a ribbon of
commands over a sheet of paper, the document's headings in a navigation pane,
page and word counts in a status bar — in Bindersnap's type and colour.

## Boundary rules

- This directory is **only the editor**: no routing, no auth, no API calls.
- It never saves. It reports changes through `onChange` and asks for a save
  through `onSave` (Ctrl+S); the page around it decides what those mean. In
  the app that page is `apps/app/components/DocumentEditorPage.tsx`, which
  commits into the author's draft.
- Visual changes here need a note in the PR (CLAUDE.md, decision 5).

## Structure

```
documentSchema.ts        — what a document may contain: the one extension list
                           the editor and the reader (editorDocumentHtml.ts)
                           both load, plus paragraph spacing, indent and page
                           breaks
documentStats.ts         — word counts, the heading outline, pagination
DocumentEditor.tsx       — the editor: ribbon, page, panes, status bar
NavigationPane.tsx       — headings, and find and replace
ribbon/                  — Home, Insert, View and the contextual Table tab
extensions/
  SearchAndReplace.ts    — find and replace, with every match marked
  WordKeymap.ts          — Tab to indent, Ctrl+] / Ctrl+[, Ctrl+Alt+1…3
  CommentAnchor/         — anchors for inline review comments (not yet wired)
assets/document-editor.css
```

## Two rules worth knowing before changing anything

**One schema.** `documentContentExtensions()` is what a document is. Add a
node or an attribute there and the reader renders it too; add it only to the
editor and it vanishes the moment somebody who is not editing opens the
policy, because ProseMirror drops what its schema does not declare.

**The page is paper.** Chrome takes the app's `--bs-*` tokens and flips with
the theme; the page uses the fixed `--brand-mockup-*` tokens and stays white.
The colours an author gives their text are stored in the document and were
chosen against white.
