import { afterEach, describe, expect, test } from "bun:test";
import { Editor } from "@tiptap/core";

import { documentContentExtensions } from "../documentSchema";
import { ChangeCase, nextCase, recaseText } from "./ChangeCase";

const editors: Editor[] = [];

function editorWith(content: string): Editor {
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: [...documentContentExtensions(), ChangeCase],
    content,
  });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  while (editors.length > 0) editors.pop()!.destroy();
});

/** Where a phrase starts in the first paragraph. */
function at(editor: Editor, phrase: string): number {
  return editor.state.doc.textContent.indexOf(phrase) + 1;
}

describe("recaseText", () => {
  const all = (text: string, mode: Parameters<typeof recaseText>[3]) =>
    recaseText(text, 0, text.length, mode);

  test("gives each of Word's five cases", () => {
    const text = "wash HANDS. then Dry them";
    expect(all(text, "upper")).toBe("WASH HANDS. THEN DRY THEM");
    expect(all(text, "lower")).toBe("wash hands. then dry them");
    expect(all(text, "title")).toBe("Wash Hands. Then Dry Them");
    expect(all(text, "sentence")).toBe("Wash hands. Then dry them");
    expect(all(text, "toggle")).toBe("WASH hands. THEN dRY THEM");
  });

  test("reads what is before the range, but changes only inside it", () => {
    // "hands" is mid-sentence, so sentence case leaves it lower.
    const text = "Wash your HANDS now";
    expect(recaseText(text, 10, 15, "sentence")).toBe("Wash your hands now");
    expect(recaseText(text, 10, 15, "title")).toBe("Wash your Hands now");
  });

  test("keeps an apostrophe inside a word, and a letter with no one-letter twin", () => {
    expect(recaseText("DON'T", 0, 5, "title")).toBe("Don't");
    // "ß".toUpperCase() is "SS": two letters where there was one would move
    // every position after it, so it stays as it is.
    expect(recaseText("straße", 0, 6, "upper")).toBe("STRAßE");
  });
});

describe("nextCase", () => {
  test("cycles UPPERCASE, then Capitalize Each Word, then lowercase", () => {
    expect(nextCase("wash hands")).toBe("upper");
    expect(nextCase("WASH HANDS")).toBe("title");
    expect(nextCase("Wash Hands")).toBe("lower");
    expect(nextCase("Wash hands")).toBe("upper");
    expect(nextCase("  42 ")).toBeNull();
  });
});

describe("Change Case in the editor", () => {
  test("recases the selection and keeps its formatting and the selection", () => {
    const editor = editorWith("<p>ALWAYS <strong>WASH</strong> YOUR HANDS</p>");
    const from = at(editor, "ALWAYS");
    const to = at(editor, "HANDS") + 5;
    editor.commands.setTextSelection({ from, to });
    editor.commands.changeCase("sentence");

    expect(editor.getHTML()).toBe(
      "<p>Always <strong>wash</strong> your hands</p>",
    );
    expect(editor.state.selection.from).toBe(from);
    expect(editor.state.selection.to).toBe(to);
  });

  test("with no selection, recases the word the cursor is in", () => {
    const editor = editorWith("<p>wash hands now</p>");
    editor.commands.setTextSelection(at(editor, "hands") + 2);
    editor.commands.changeCase("upper");
    expect(editor.getText()).toBe("wash HANDS now");
  });

  test("works across paragraphs, each its own first sentence", () => {
    const editor = editorWith("<p>ONE TWO</p><p>THREE</p>");
    editor.commands.selectAll();
    editor.commands.changeCase("sentence");
    expect(editor.getHTML()).toBe("<p>One two</p><p>Three</p>");
  });

  test("Shift+F3 steps through the cycle, one undo each", () => {
    const editor = editorWith("<p>wash hands</p>");
    editor.commands.selectAll();
    editor.commands.cycleCase();
    expect(editor.getText()).toBe("WASH HANDS");
    editor.commands.cycleCase();
    expect(editor.getText()).toBe("Wash Hands");
    editor.commands.cycleCase();
    expect(editor.getText()).toBe("wash hands");
    editor.commands.undo();
    expect(editor.getText()).toBe("Wash Hands");
  });

  test("between words there is nothing to recase", () => {
    const editor = editorWith("<p>wash. hands</p>");
    editor.commands.setTextSelection(at(editor, ".") + 1);
    expect(editor.commands.changeCase("upper")).toBe(false);
  });
});
