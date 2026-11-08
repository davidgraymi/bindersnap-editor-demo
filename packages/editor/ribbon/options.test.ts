import { afterEach, describe, expect, test } from "bun:test";
import { Editor, generateHTML, type JSONContent } from "@tiptap/core";

import { documentContentExtensions } from "../documentSchema";
import {
  ZOOM_MAX,
  ZOOM_MIN,
  dateChoices,
  pinchZoom,
  shadingColor,
  stepZoom,
  zoomKey,
} from "./options";

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

describe("zoom", () => {
  const press = (key: string, extra: Partial<KeyboardEvent> = {}) =>
    zoomKey({
      key,
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      ...extra,
    });

  test("Ctrl+=, Ctrl+- and Ctrl+0 are the page's zoom", () => {
    expect(press("=")).toBe("in");
    expect(press("+", { shiftKey: true } as Partial<KeyboardEvent>)).toBe("in");
    expect(press("-")).toBe("out");
    expect(press("0")).toBe("reset");
    expect(press("=", { ctrlKey: false, metaKey: true })).toBe("in");
  });

  test("by where the key is, when the layout moves the character", () => {
    expect(press("ß", { code: "Minus" })).toBe("out");
    expect(press("à", { code: "Digit0" })).toBe("reset");
  });

  test("not without Ctrl, and not with Alt: Ctrl+Alt+0 is Normal text", () => {
    expect(press("=", { ctrlKey: false })).toBeNull();
    expect(press("0", { altKey: true })).toBeNull();
    expect(press("b")).toBeNull();
  });

  test("a step lands on the next tenth, within the bounds", () => {
    expect(stepZoom(100, "in")).toBe(110);
    expect(stepZoom(94, "in")).toBe(100);
    expect(stepZoom(94, "out")).toBe(90);
    expect(stepZoom(ZOOM_MAX, "in")).toBe(ZOOM_MAX);
    expect(stepZoom(ZOOM_MIN, "out")).toBe(ZOOM_MIN);
  });

  test("a pinch scales the zoom, a wheel's notch by about a tenth", () => {
    expect(pinchZoom(100, -100)).toBeCloseTo(110.5, 1);
    expect(pinchZoom(100, 2)).toBeCloseTo(98.02, 2);
    expect(pinchZoom(ZOOM_MAX, -100)).toBe(ZOOM_MAX);
    expect(pinchZoom(ZOOM_MIN, 100)).toBe(ZOOM_MIN);
  });
});
