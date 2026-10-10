import { afterEach, expect, test } from "bun:test";
import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";

import { documentContentExtensions } from "../documentSchema";
import { EnterOverSelection } from "./EnterOverSelection";

const editors: Editor[] = [];
afterEach(() => {
  while (editors.length > 0) editors.pop()!.destroy();
});

/** Enter as the keymaps see it: the key, through every handleKeyDown. */
function pressEnter(editor: Editor): boolean {
  const event = {
    key: "Enter",
    keyCode: 13,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    preventDefault() {},
  } as unknown as KeyboardEvent;
  return (
    editor.view.someProp("handleKeyDown", (handle) =>
      handle(editor.view, event),
    ) ?? false
  );
}

function blankLineThenHeading(extra: boolean): Editor {
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: [
      ...documentContentExtensions(),
      ...(extra ? [EnterOverSelection] : []),
    ],
    content: {
      type: "doc",
      content: [
        { type: "paragraph" },
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Code of Conduct" }],
        },
      ],
    },
  });
  editors.push(editor);
  // A triple click on the blank line: to the start of the heading.
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 3)),
  );
  return editor;
}

test("Tiptap's Enter gets a blank line selected to the next block wrong", () => {
  // The bug this extension exists for. Tiptap used to throw ("deeper than
  // insertion position"); since 3.31 it no longer throws but leaves the
  // document with a stray trailing paragraph and the cursor off the heading.
  // If this starts passing, Tiptap has fixed it and the extension can go.
  const editor = blankLineThenHeading(false);
  let threw = false;
  try {
    pressEnter(editor);
  } catch (error) {
    threw = /deeper than insertion position/.test(String(error));
  }
  const rightAnswer =
    editor.getJSON().content?.length === 2 &&
    editor.state.selection.$from.parent.type.name === "heading" &&
    editor.state.selection.$from.parentOffset === 0;
  expect(threw || !rightAnswer).toBe(true);
});

test("with it, Enter replaces the selection and splits, as ProseMirror's does", () => {
  const editor = blankLineThenHeading(true);
  expect(pressEnter(editor)).toBe(true);
  // Word's answer: the blank line is still a blank line, the heading is
  // untouched, and the cursor is at the heading's start.
  const [first, second] = editor.getJSON().content ?? [];
  expect(first?.type).toBe("paragraph");
  expect(first?.content).toBeUndefined();
  expect(second?.type).toBe("heading");
  expect(editor.state.doc.textContent).toBe("Code of Conduct");
  expect(editor.state.selection.$from.parent.type.name).toBe("heading");
  expect(editor.state.selection.$from.parentOffset).toBe(0);
});

test("a selection inside one paragraph is left to the ordinary Enter", () => {
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: [...documentContentExtensions(), EnterOverSelection],
    content: "<p>abcd</p>",
  });
  editors.push(editor);
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2, 4)),
  );
  expect(pressEnter(editor)).toBe(true);
  expect(editor.getText({ blockSeparator: "|" })).toBe("a|d");
});
