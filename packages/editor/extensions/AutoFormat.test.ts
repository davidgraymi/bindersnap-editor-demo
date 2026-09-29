import { afterEach, describe, expect, test } from "bun:test";
import { Editor } from "@tiptap/core";

import { documentContentExtensions } from "../documentSchema";
import { AutoFormat } from "./AutoFormat";

const editors: Editor[] = [];

function editorWith(content = "<p></p>"): Editor {
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: [...documentContentExtensions(), AutoFormat],
    content,
  });
  editors.push(editor);
  editor.commands.setTextSelection(editor.state.doc.content.size - 1);
  return editor;
}

afterEach(() => {
  while (editors.length > 0) editors.pop()!.destroy();
});

/** Type as a person does: one character at a time, through the rules. */
function type(editor: Editor, text: string) {
  for (const ch of text) {
    const { view } = editor;
    const { from, to } = view.state.selection;
    const handled = view.someProp("handleTextInput", (handle) =>
      handle(view, from, to, ch, () => view.state.tr.insertText(ch, from, to)),
    );
    if (!handled) view.dispatch(view.state.tr.insertText(ch, from, to));
  }
}

describe("AutoFormat as you type", () => {
  test("curls quotes the way they face", () => {
    const editor = editorWith();
    type(editor, `She said "wash" and 'dry' — don't skip it.`);
    expect(editor.getText()).toBe("She said “wash” and ‘dry’ — don’t skip it.");
  });

  test("opens a quote at the start of a paragraph and after a bracket", () => {
    const editor = editorWith();
    type(editor, `"Clean" ("always")`);
    expect(editor.getText()).toBe("“Clean” (“always”)");
  });

  test("turns two hyphens into a dash and three dots into an ellipsis", () => {
    const editor = editorWith();
    type(editor, "Gloves--then wash...");
    expect(editor.getText()).toBe("Gloves—then wash…");
  });

  test("gives the symbols and the fractions standing alone", () => {
    const editor = editorWith();
    type(editor, "(c) (R) (tm) 1/2 cup, 3/4 done, not 11/2 ");
    expect(editor.getText()).toBe("© ® ™ ½ cup, ¾ done, not 11/2 ");
  });

  test("Backspace straight after puts back what was typed", () => {
    const editor = editorWith();
    type(editor, "(c)");
    expect(editor.getText()).toBe("©");
    editor.commands.undoInputRule();
    expect(editor.getText()).toBe("(c)");
  });

  test("leaves code alone", () => {
    const editor = editorWith("<pre><code></code></pre>");
    type(editor, `x = "a" -- b...`);
    expect(editor.state.doc.firstChild?.textContent).toBe(`x = "a" -- b...`);
  });
});
