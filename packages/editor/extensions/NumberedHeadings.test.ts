import { afterEach, describe, expect, test } from "bun:test";
import { Editor, generateHTML, type JSONContent } from "@tiptap/core";

import { documentContentExtensions } from "../documentSchema";
import { headingNumbers, numbersHeadings } from "./NumberedHeadings";
import { contentsEntries } from "./TableOfContents";

const editors: Editor[] = [];

function editorWith(content: string | JSONContent): Editor {
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: documentContentExtensions(),
    content,
  });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  while (editors.length > 0) editors.pop()!.destroy();
});

const POLICY =
  "<h1>Hand Hygiene</h1><h2>Purpose</h2><p>Why.</p><h2>Scope</h2><h3>Wards</h3><h3>Theatres</h3><h4>Note</h4><h2>Records</h2>";

/** Each heading's level and whether it is marked numbered, in order. */
function marks(editor: Editor): [number, boolean][] {
  const out: [number, boolean][] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === "heading") {
      out.push([node.attrs.level as number, node.attrs.numbered === true]);
    }
  });
  return out;
}

describe("numbered headings", () => {
  test("sections count on, subsections count within them", () => {
    expect(headingNumbers([1, 2, 2, 3, 3, 4, 2, 3])).toEqual([
      null,
      "1.",
      "2.",
      "2.1",
      "2.2",
      null,
      "3.",
      "3.1",
    ]);
    // A subsection before any section, as Word would number it.
    expect(headingNumbers([3])).toEqual(["0.1"]);
  });

  test("the switch numbers every section and subsection, never the title", () => {
    const editor = editorWith(POLICY);
    expect(numbersHeadings(editor.state.doc)).toBe(false);
    editor.commands.toggleHeadingNumbers();
    expect(numbersHeadings(editor.state.doc)).toBe(true);
    expect(marks(editor)).toEqual([
      [1, false],
      [2, true],
      [2, true],
      [3, true],
      [3, true],
      [4, false],
      [2, true],
    ]);

    editor.commands.toggleHeadingNumbers();
    expect(marks(editor).some(([, numbered]) => numbered)).toBe(false);
  });

  test("a heading made after the switch is numbered like the rest", () => {
    const editor = editorWith("<h2>Purpose</h2><p>Scope</p>");
    editor.commands.toggleHeadingNumbers();
    editor.chain().setTextSelection(12).setHeading({ level: 2 }).run();
    expect(marks(editor)).toEqual([
      [2, true],
      [2, true],
    ]);
  });

  test("undo takes the numbers off in one step", () => {
    const editor = editorWith(POLICY);
    editor.commands.toggleHeadingNumbers();
    editor.commands.undo();
    expect(numbersHeadings(editor.state.doc)).toBe(false);
    expect(marks(editor).some(([, numbered]) => numbered)).toBe(false);
  });

  test("the switch is kept with the policy and drawn in the reader", () => {
    const editor = editorWith(POLICY);
    editor.commands.toggleHeadingNumbers();
    const json = editor.getJSON();
    expect(json.attrs?.numberedHeadings).toBe(true);

    const reopened = editorWith(json);
    expect(numbersHeadings(reopened.state.doc)).toBe(true);

    const html = generateHTML(json, documentContentExtensions());
    expect(html).toContain('<h2 class="bs-numbered">Purpose</h2>');
    expect(html).toContain("<h1>Hand Hygiene</h1>");
  });

  test("a heading pasted in with numbers follows this policy's rule", () => {
    const editor = editorWith('<h2 class="bs-numbered">Pasted</h2>');
    expect(marks(editor)).toEqual([[2, false]]);
  });

  test("the contents list each section with its number", () => {
    const editor = editorWith(POLICY);
    editor.commands.toggleHeadingNumbers();
    expect(
      contentsEntries(editor.state.doc).map((entry) => entry.text),
    ).toEqual([
      "Hand Hygiene",
      "1. Purpose",
      "2. Scope",
      "2.1 Wards",
      "2.2 Theatres",
      "3. Records",
    ]);
  });
});
