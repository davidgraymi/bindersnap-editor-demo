import { beforeAll, describe, expect, test } from "bun:test";
import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { JSDOM } from "jsdom";

import { CommentAnchor, getCommentAnchorState } from "./index";

const { window } = new JSDOM("<!doctype html><html><body></body></html>");
type TextRange = { from: number; to: number };

beforeAll(() => {
  Object.assign(globalThis, {
    window,
    document: window.document,
    navigator: window.navigator,
    Node: window.Node,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    HTMLAnchorElement: window.HTMLAnchorElement,
    HTMLBodyElement: window.HTMLBodyElement,
    DOMParser: window.DOMParser,
    DocumentFragment: window.DocumentFragment,
    MutationObserver: window.MutationObserver,
    getSelection: window.getSelection.bind(window),
    getComputedStyle: window.getComputedStyle.bind(window),
    requestAnimationFrame: (callback: FrameRequestCallback) =>
      setTimeout(() => callback(0), 0),
    cancelAnimationFrame: (handle: number) => clearTimeout(handle),
    innerHeight: 900,
    innerWidth: 1440,
  });
});

const createEditor = () =>
  new Editor({
    element: window.document.createElement("div"),
    extensions: [StarterKit, CommentAnchor],
    content: "<p>Alpha Beta Gamma</p>",
  });

const getAnchorState = (editor: Editor) => {
  const pluginState = getCommentAnchorState(editor.state);

  if (!pluginState) {
    throw new Error("Comment anchor plugin state was not registered.");
  }

  return pluginState;
};

const findTextRange = (editor: Editor, targetText: string): TextRange => {
  let range: TextRange | null = null;

  editor.state.doc.descendants((node, pos) => {
    if (range || !node.isText || !node.text) {
      return true;
    }

    const index = node.text.indexOf(targetText);

    if (index === -1) {
      return true;
    }

    range = {
      from: pos + index,
      to: pos + index + targetText.length,
    };

    return false;
  });

  if (!range) {
    throw new Error(`Could not find "${targetText}" in the test document.`);
  }

  return range;
};

const getCommentAnchorElement = (editor: Editor, commentId: string) => {
  const element = editor.view.dom.querySelector<HTMLElement>(
    `[data-comment-id="${commentId}"]`,
  );

  if (!element) {
    throw new Error(`Could not find anchor element for comment "${commentId}".`);
  }

  return element;
};

describe("CommentAnchor", () => {
  test("addCommentAnchor creates a decoration and removeCommentAnchor cleans it up", () => {
    const editor = createEditor();
    const range = findTextRange(editor, "Beta");

    expect(editor.commands.addCommentAnchor(range.from, range.to, "comment-1")).toBe(
      true,
    );

    let pluginState = getAnchorState(editor);

    expect(pluginState.anchors.get("comment-1")).toMatchObject({
      commentId: "comment-1",
      from: range.from,
      to: range.to,
    });
    expect(pluginState.decorations.find(range.from, range.to)).toHaveLength(1);

    expect(editor.commands.removeCommentAnchor("comment-1")).toBe(true);

    pluginState = getAnchorState(editor);

    expect(pluginState.anchors.has("comment-1")).toBe(false);
    expect(pluginState.decorations.find()).toHaveLength(0);

    editor.destroy();
  });

  test("setActiveComment toggles the active decoration class", () => {
    const editor = createEditor();
    const range = findTextRange(editor, "Beta");

    editor.commands.addCommentAnchor(range.from, range.to, "comment-1");
    editor.commands.setActiveComment("comment-1");

    const activeAnchor = getCommentAnchorElement(editor, "comment-1");

    expect(activeAnchor.className).toContain(
      "bs-comment-anchor--active",
    );

    editor.commands.setActiveComment(null);

    const inactiveAnchor = getCommentAnchorElement(editor, "comment-1");

    expect(inactiveAnchor.className).not.toContain(
      "bs-comment-anchor--active",
    );

    editor.destroy();
  });

  test("cursor movement inside an anchor updates the active comment", () => {
    const editor = createEditor();
    const range = findTextRange(editor, "Beta");

    editor.commands.addCommentAnchor(range.from, range.to, "comment-cursor");

    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, range.from + 1),
      ),
    );

    expect(getAnchorState(editor).activeCommentId).toBe("comment-cursor");

    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, range.to),
      ),
    );

    expect(getAnchorState(editor).activeCommentId).toBe(null);

    editor.destroy();
  });

  test("selection changes mark the comment under the cursor as active", () => {
    const editor = createEditor();
    const range = findTextRange(editor, "Beta");

    editor.commands.addCommentAnchor(range.from, range.to, "comment-1");
    editor.commands.setTextSelection(range.from + 1);

    expect(getAnchorState(editor).activeCommentId).toBe("comment-1");

    editor.commands.setTextSelection(1);

    expect(getAnchorState(editor).activeCommentId).toBeNull();

    editor.destroy();
  });

  test("anchors map forward when text is inserted before the anchor", () => {
    const editor = createEditor();
    const range = findTextRange(editor, "Beta");

    editor.commands.addCommentAnchor(range.from, range.to, "comment-before");
    editor.commands.insertContentAt(range.from - 1, "Start ");

    expect(getAnchorState(editor).anchors.get("comment-before")).toMatchObject({
      from: range.from + "Start ".length,
      to: range.to + "Start ".length,
    });

    editor.destroy();
  });

  test("anchors map forward when text is inserted after the anchor", () => {
    const editor = createEditor();
    const range = findTextRange(editor, "Beta");

    editor.commands.addCommentAnchor(range.from, range.to, "comment-after");
    editor.commands.insertContentAt(range.to + 1, " End");

    expect(getAnchorState(editor).anchors.get("comment-after")).toMatchObject({
      from: range.from,
      to: range.to,
    });

    editor.destroy();
  });

  test("anchors expand when text is inserted within the anchor", () => {
    const editor = createEditor();
    const range = findTextRange(editor, "Beta");

    editor.commands.addCommentAnchor(range.from, range.to, "comment-within");
    editor.commands.insertContentAt(range.from + 2, "++");

    expect(getAnchorState(editor).anchors.get("comment-within")).toMatchObject({
      from: range.from,
      to: range.to + 2,
    });

    editor.destroy();
  });
});
