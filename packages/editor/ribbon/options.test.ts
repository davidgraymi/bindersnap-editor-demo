import { afterEach, expect, test } from "bun:test";
import { Editor, generateHTML, type JSONContent } from "@tiptap/core";

import { documentContentExtensions } from "../documentSchema";
import { dateChoices, shadingColor } from "./options";

const editors: Editor[] = [];

function editorWith(content: string): Editor {
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

test("today in the ways a policy writes a date, ISO last", () => {
  const day = new Date(2026, 8, 27);
  const choices = dateChoices(day, "en-GB");
  expect(choices).toHaveLength(5);
  expect(choices[0]).toBe("27 September 2026");
  // The weekday and the short month are punctuated by ICU, which varies.
  expect(choices[1]).toContain("Sunday");
  expect(choices[1]).toContain("27 September 2026");
  expect(choices[2]).toMatch(/^27 Sept?\.? 2026$/);
  expect(choices[3]).toBe("September 2026");
  expect(choices[4]).toBe("2026-09-27");
  expect(dateChoices(day, "en-US")[0]).toBe("September 27, 2026");
});

test("a single-digit day and month are padded in the ISO form", () => {
  expect(dateChoices(new Date(2027, 0, 5), "en-GB").at(-1)).toBe("2027-01-05");
});

test("a cell's shading is kept as hex, however the browser spelled it", () => {
  expect(shadingColor("#DBEAFE")).toBe("#dbeafe");
  expect(shadingColor("rgb(219, 234, 254)")).toBe("#dbeafe");
  expect(shadingColor("rgb(300, 0, 0)")).toBeNull();
  expect(shadingColor("url(x)")).toBeNull();
  expect(shadingColor("red")).toBeNull();
  expect(shadingColor(null)).toBeNull();
});

test("a shaded cell survives the round trip, header or not", () => {
  const editor = editorWith(
    '<table><tr><th style="background-color: rgb(219, 234, 254)"><p>Owner</p></th></tr><tr><td><p>Ward</p></td></tr></table>',
  );
  const cell = (row: number) => {
    const table: JSONContent | undefined = editor.getJSON().content?.[0];
    return table?.content?.[row]?.content?.[0];
  };
  expect(cell(0)?.attrs?.background).toBe("#dbeafe");
  expect(cell(1)?.attrs?.background).toBeNull();

  // The cursor in the second row's cell, and Shading set on it.
  let wardAt = 0;
  editor.state.doc.descendants((node, pos) => {
    if (node.isText && node.text === "Ward") wardAt = pos;
  });
  editor
    .chain()
    .setTextSelection(wardAt + 1)
    .setCellAttribute("background", "#fef9c3")
    .run();
  expect(cell(1)?.attrs?.background).toBe("#fef9c3");

  const html = generateHTML(editor.getJSON(), documentContentExtensions());
  // The DOM writes a style back in rgb(); either is a colour and no more.
  expect(html).toMatch(/background-color: (#dbeafe|rgb\(219, 234, 254\))/);
  expect(html).toMatch(/background-color: (#fef9c3|rgb\(254, 249, 195\))/);
});
