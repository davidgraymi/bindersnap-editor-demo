import { afterEach, describe, expect, test } from "bun:test";
import { Editor } from "@tiptap/core";

import { documentContentExtensions } from "../documentSchema";
import { FormatPainter, formatPainterState, wordAround } from "./FormatPainter";

const editors: Editor[] = [];

function editorWith(content: string): Editor {
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: [...documentContentExtensions(), FormatPainter],
    content,
  });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  while (editors.length > 0) editors.pop()!.destroy();
});

/**
 * Ctrl+Shift+<key>, or ⌘ on a Mac. Both are tried: ProseMirror decides which
 * is "Mod" when it loads, and other tests stub the platform after that.
 */
function pressShortcut(editor: Editor, key: string): boolean {
  return [false, true].some((mac) => {
    const event = {
      key: key.toUpperCase(),
      keyCode: key.toUpperCase().charCodeAt(0),
      shiftKey: true,
      altKey: false,
      ctrlKey: !mac,
      metaKey: mac,
      preventDefault() {},
    } as unknown as KeyboardEvent;
    return (
      editor.view.someProp("handleKeyDown", (handle) =>
        handle(editor.view, event),
      ) ?? false
    );
  });
}

/** Where a word starts in the first paragraph. */
function at(editor: Editor, word: string): number {
  return editor.state.doc.textContent.indexOf(word) + 1;
}

describe("the Format Painter", () => {
  test("copies a look and gives it to other words, replacing theirs", () => {
    const editor = editorWith(
      '<p><strong><span style="color: red">Warning</span></strong> wash <em>hands</em> now</p>',
    );
    editor.commands.setTextSelection(at(editor, "Warning") + 2);
    editor.commands.pickUpFormatting("off");
    const names = formatPainterState(editor.state).marks?.map(
      (mark) => mark.type.name,
    );
    expect(names?.sort()).toEqual(["bold", "textStyle"]);

    const from = at(editor, "hands");
    editor.commands.setTextSelection({ from, to: from + 5 });
    editor.commands.pasteFormatting();
    const html = editor.getHTML();
    expect(html).toContain(
      '<span style="color: red;"><strong>hands</strong></span>',
    );
    expect(html).not.toContain("<em>");
  });

  test("a click without a drag paints the whole word", () => {
    const editor = editorWith("<p><u>Note</u> wash hands</p>");
    editor.commands.setTextSelection(at(editor, "Note"));
    editor.commands.pickUpFormatting("off");
    editor.commands.setTextSelection(at(editor, "wash") + 2);
    editor.commands.pasteFormatting();
    expect(editor.getHTML()).toContain("<u>wash</u> hands");
  });

  test("a plain look clears formatting but leaves a link a link", () => {
    const editor = editorWith(
      '<p>plain <strong><a href="https://example.com">site</a></strong></p>',
    );
    editor.commands.setTextSelection(at(editor, "plain") + 1);
    editor.commands.pickUpFormatting("off");
    const from = at(editor, "site");
    editor.commands.setTextSelection({ from, to: from + 4 });
    editor.commands.pasteFormatting();
    const html = editor.getHTML();
    expect(html).not.toContain("<strong>");
    expect(html).toContain('href="https://example.com"');
  });

  test("Ctrl+Shift+C and Ctrl+Shift+V copy and paste a look, as in Word", () => {
    const editor = editorWith("<p><em>Note</em> wash hands</p>");
    editor.commands.setTextSelection(at(editor, "Note") + 1);
    expect(pressShortcut(editor, "c")).toBe(true);
    // Copied from the keyboard, the brush stays down.
    expect(formatPainterState(editor.state).brush).toBe("off");
    editor.commands.setTextSelection(at(editor, "hands") + 1);
    expect(pressShortcut(editor, "v")).toBe(true);
    expect(editor.getHTML()).toContain("wash <em>hands</em>");
  });

  test("nothing copied, and Ctrl+Shift+V is left to the browser", () => {
    const editor = editorWith("<p>words</p>");
    editor.commands.setTextSelection(2);
    expect(editor.commands.pasteFormatting()).toBe(false);
  });

  test("the brush is picked up once or kept, and Escape puts it down", () => {
    const editor = editorWith("<p>words</p>");
    editor.commands.pickUpFormatting("sticky");
    expect(formatPainterState(editor.state).brush).toBe("sticky");
    expect(editor.commands.putDownFormatPainter()).toBe(true);
    expect(formatPainterState(editor.state).brush).toBe("off");
    // Down already: Escape is somebody else's.
    expect(editor.commands.putDownFormatPainter()).toBe(false);
    // The look stays, for Ctrl+Shift+V.
    expect(formatPainterState(editor.state).marks).not.toBeNull();
  });

  test("a word is letters and digits, apostrophes and hyphens included", () => {
    const editor = editorWith("<p>a follow-up, isn’t it</p>");
    const range = (pos: number) => {
      const found = wordAround(editor.state.doc.resolve(pos));
      return found && editor.state.doc.textBetween(found.from, found.to);
    };
    expect(range(at(editor, "follow") + 3)).toBe("follow-up");
    expect(range(at(editor, "isn") + 1)).toBe("isn’t");
    expect(range(at(editor, ",") + 1)).toBeNull();
  });
});
