/**
 * One editor, several documents — each with its own undo.
 *
 * **Why not an editor per document.** An editor built afresh for each policy
 * opened from the file panel starts with an empty undo history, so moving to
 * another policy and back lost Ctrl+Z for everything typed before — which is
 * not what a word processor with several files open does. A ProseMirror state
 * carries the document, the selection *and* the history, but it belongs to the
 * editor whose plugins made it: handing one editor's state to another is
 * handing it plugins it does not run.
 *
 * So the page keeps one editor, and a state per document made with that
 * editor's own plugins. Moving between documents swaps the state in and out,
 * and each comes back exactly as it was left, undo and all.
 */

import type { Editor, JSONContent } from "@tiptap/core";
import { EditorState, type Transaction } from "@tiptap/pm/state";

import { sanitizeProseMirrorJson } from "../utils/sanitizer";

/**
 * A fresh state for a document, made with this editor's plugins.
 *
 * Sanitized the way the editor sanitizes a document it is created with, so a
 * policy opened second is read exactly as one opened first.
 */
export function createDocumentState(
  editor: Editor,
  content: JSONContent,
): EditorState {
  const doc = editor.schema.nodeFromJSON(sanitizeProseMirrorJson(content));
  return EditorState.create({ doc, plugins: editor.state.plugins });
}

/**
 * Put a document's state in the editor, and tell everything watching it.
 *
 * `updateState` replaces the state without a transaction, so the ribbon, the
 * outline and the word count — which follow transactions — would go on
 * describing the document before. One transaction that changes nothing (and
 * is kept out of the history) tells them, and brings the cursor into view.
 */
export function showDocumentState(editor: Editor, state: EditorState): void {
  if (editor.isDestroyed) return;
  editor.view.updateState(state);
  const nudge: Transaction = editor.state.tr
    .setMeta("addToHistory", false)
    .scrollIntoView();
  editor.view.dispatch(nudge);
}
