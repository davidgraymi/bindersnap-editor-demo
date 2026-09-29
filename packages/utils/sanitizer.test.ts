import { describe, expect, test } from "bun:test";
import { JSDOM } from "jsdom";

import { safeStyle, sanitizeHtml, sanitizeProseMirrorJson } from "./sanitizer";

const { window } = new JSDOM("<!doctype html><html><body></body></html>");

for (const [key, value] of Object.entries({
  window,
  document: window.document,
  Node: window.Node,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  HTMLAnchorElement: window.HTMLAnchorElement,
  HTMLFormElement: window.HTMLFormElement,
  NamedNodeMap: window.NamedNodeMap,
  DocumentFragment: window.DocumentFragment,
  Text: window.Text,
  DOMParser: window.DOMParser,
  NodeFilter: window.NodeFilter,
  MutationObserver: window.MutationObserver,
})) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value,
  });
}

describe("sanitizeHtml", () => {
  test("strips script tags entirely", () => {
    const output = sanitizeHtml(
      "<p>Safe</p><script>alert(1)</script><p>Next</p>",
    );

    expect(output).not.toContain("<script");
    expect(output).not.toContain("alert(1)");
    expect(output).toBe("<p>Safe</p><p>Next</p>");
  });

  test("removes event handlers", () => {
    const output = sanitizeHtml(
      '<img src="https://example.com/image.png" alt="Example" onerror="alert(1)" onclick="alert(2)" class="hero">',
    );

    expect(output).not.toContain("onerror");
    expect(output).not.toContain("onclick");
    expect(output).toBe(
      '<img src="https://example.com/image.png" alt="Example" class="hero">',
    );
  });

  test("strips javascript links", () => {
    const output = sanitizeHtml(
      '<a href="javascript:alert(1)" class="link">Click</a>',
    );

    expect(output).not.toContain("javascript:");
    expect(output).toContain("<a");
    expect(output).toContain("Click");
  });

  test("adds noopener noreferrer to all anchors", () => {
    const output = sanitizeHtml('<a href="https://example.com">Docs</a>');

    expect(output).toContain('rel="noopener noreferrer"');
    expect(output).toContain('href="https://example.com"');
  });

  // The change comparison renders a document with its own additions and
  // deletions marked in it. Both tags are plain semantic HTML; the operation
  // index htmldiff attaches to each one is not, and goes.
  test("keeps the comparison's ins and del marks and drops their data attributes", () => {
    const output = sanitizeHtml(
      '<p>Due within <del data-operation-index="1" class="doc-compare-mark">thirty</del><ins data-operation-index="1" class="doc-compare-mark">sixty</ins> days.</p>',
    );

    expect(output).toBe(
      '<p>Due within <del class="doc-compare-mark">thirty</del><ins class="doc-compare-mark">sixty</ins> days.</p>',
    );
  });

  test("passes valid StarterKit HTML through unchanged", () => {
    const input =
      '<p class="intro">Hello <strong>world</strong></p><h2>Heading</h2><ul><li>Item</li></ul>';

    expect(sanitizeHtml(input)).toBe(input);
  });

  test("keeps the typography an author set in the editor", () => {
    const input =
      '<p style="text-align: center; line-height: 1.5; margin-left: 0.5in">' +
      '<span style="color: #e85d26; font-family: Georgia, serif; font-size: 14pt">Red</span> ' +
      '<mark style="background-color: #fef08a">marked</mark> H<sub>2</sub>O x<sup>2</sup></p>' +
      '<div class="bs-page-break"></div><hr>';

    expect(sanitizeHtml(input)).toBe(input);
  });

  test("keeps only typographic style values, and nothing that could load or run", () => {
    const output = sanitizeHtml(
      '<p style="position: fixed; top: 0; color: red; background-image: url(https://x.test/a.png)">' +
        '<span style="color: expression(alert(1))">a</span>' +
        '<span style="font-family: x; width: calc(100%)">b</span>' +
        '<span style="background-color: url(javascript:alert(1))">c</span></p>',
    );

    expect(output).toBe(
      '<p style="color: red"><span>a</span><span style="font-family: x">b</span><span>c</span></p>',
    );
  });
});

describe("safeStyle", () => {
  test("drops properties outside the list, and values of the wrong shape", () => {
    expect(safeStyle("color: #fff; behavior: url(x.htc)")).toBe("color: #fff");
    expect(safeStyle("font-size: 12pt; font-size: 12 pt")).toBe(
      "font-size: 12pt",
    );
    expect(safeStyle("line-height: 1.15")).toBe("line-height: 1.15");
    expect(safeStyle("line-height: normal")).toBe("");
    expect(safeStyle("color: var(--brand-coral)")).toBe(
      "color: var(--brand-coral)",
    );
    expect(safeStyle("font-family: a\\62 c")).toBe("");
    expect(safeStyle("")).toBe("");
  });
});

describe("sanitizeProseMirrorJson", () => {
  test("strips unknown node and mark types without throwing", () => {
    const output = sanitizeProseMirrorJson({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Keep",
              marks: [{ type: "bold" }, { type: "evilMark" }],
            },
          ],
        },
        {
          type: "evilWidget",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Nested" }],
            },
          ],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "Stay" }],
        },
      ],
    });

    expect(output).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Keep",
              marks: [{ type: "bold" }],
            },
          ],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Nested",
            },
          ],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "Stay" }],
        },
      ],
    });
  });
});

describe("pictures embedded by the editor", () => {
  const png =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

  test("a raster picture in a document survives the reader", () => {
    expect(sanitizeHtml(`<p><img src="${png}" alt="Map"></p>`)).toContain(
      `src="${png}"`,
    );
    const json = sanitizeProseMirrorJson({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "image", attrs: { src: png, alt: "Map" } }],
        },
      ],
    });
    expect(JSON.stringify(json)).toContain(png);
  });

  test("an SVG or any other data address is dropped", () => {
    const svg = "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=";
    const html = "data:text/html;base64,PHNjcmlwdD48L3NjcmlwdD4=";
    expect(sanitizeHtml(`<img src="${svg}">`)).not.toContain("data:");
    expect(sanitizeHtml(`<img src="${html}">`)).not.toContain("data:");
    expect(sanitizeHtml(`<a href="${png}">x</a>`)).not.toContain("data:");
    const json = sanitizeProseMirrorJson({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "image", attrs: { src: svg } }],
        },
      ],
    });
    expect(JSON.stringify(json)).not.toContain("svg");
  });
});
