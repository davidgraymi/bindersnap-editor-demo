import { describe, expect, test } from "bun:test";
import { JSDOM } from "jsdom";

import { sanitizeHtml, sanitizeProseMirrorJson } from "./sanitizer";

const { window } = new JSDOM("<!doctype html><html><body></body></html>");

Object.assign(globalThis, {
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
});

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

  test("passes valid StarterKit HTML through unchanged", () => {
    const input =
      '<p class="intro">Hello <strong>world</strong></p><h2>Heading</h2><ul><li>Item</li></ul>';

    expect(sanitizeHtml(input)).toBe(input);
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
