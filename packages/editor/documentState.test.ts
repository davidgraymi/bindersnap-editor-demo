import { afterEach, expect, test } from "bun:test";
import { Editor, type JSONContent } from "@tiptap/core";

import { documentContentExtensions } from "./documentSchema";
import { createDocumentState, showDocumentState } from "./documentState";

const editors: Editor[] = [];
afterEach(() => {
  while (editors.length > 0) editors.pop()!.destroy();
});

const paragraph = (text: string): JSONContent => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

function editorWith(content: JSONContent): Editor {
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: documentContentExtensions(),
    content,
  });
  editors.push(editor);
  return editor;
}

test("each document keeps its own undo across a move to another and back", () => {
  const editor = editorWith(paragraph("Hand hygiene."));
  editor.commands.insertContentAt(
    editor.state.doc.content.size - 1,
    " Always.",
  );
  expect(editor.getText()).toBe("Hand hygiene. Always.");

  // Away to another document: its own words, and nothing to undo there.
  const hand = editor.state;
  showDocumentState(
    editor,
    createDocumentState(editor, paragraph("Visitors.")),
  );
  expect(editor.getText()).toBe("Visitors.");
  expect(editor.can().undo()).toBe(false);

  // Back: the words as they were left, and Ctrl+Z still takes them back.
  showDocumentState(editor, hand);
  expect(editor.getText()).toBe("Hand hygiene. Always.");
  expect(editor.commands.undo()).toBe(true);
  expect(editor.getText()).toBe("Hand hygiene.");
});

test("a swap tells the editor's watchers without touching the history", () => {
  const editor = editorWith(paragraph("One."));
  let transactions = 0;
  let updates = 0;
  editor.on("transaction", () => (transactions += 1));
  editor.on("update", () => (updates += 1));

  showDocumentState(editor, createDocumentState(editor, paragraph("Two.")));

  // Watchers hear of it; nothing counts it as an edit, and there is nothing
  // to undo back into "One.".
  expect(transactions).toBe(1);
  expect(updates).toBe(0);
  expect(editor.can().undo()).toBe(false);
});
