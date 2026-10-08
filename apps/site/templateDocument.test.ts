import { describe, expect, test } from "bun:test";
import { getSchema } from "@tiptap/core";

import { documentContentExtensions } from "../../packages/editor/documentSchema";
import { publicSiteBinaryFiles, publicSitePages } from "./publicSite";
import { publicSiteFiles } from "./publicSite";
import {
  inlineNodes,
  markdownToDocument,
  templateDocument,
  templateMarkdown,
} from "./templateDocument";

const schema = getSchema(documentContentExtensions());
const templates = publicSitePages().filter(
  (page) => page.collection.key === "templates",
);

describe("a template as a document of Bindersnap's own", () => {
  test("bold, italic and links become marks; a site link becomes absolute", () => {
    expect(
      inlineNodes("A **bold** and *quiet* [guide](/help/approvals)."),
    ).toEqual([
      { type: "text", text: "A " },
      { type: "text", text: "bold", marks: [{ type: "bold" }] },
      { type: "text", text: " and " },
      { type: "text", text: "quiet", marks: [{ type: "italic" }] },
      { type: "text", text: " " },
      {
        type: "text",
        text: "guide",
        marks: [
          {
            type: "link",
            attrs: { href: "https://bindersnap.com/help/approvals" },
          },
        ],
      },
      { type: "text", text: "." },
    ]);
  });

  test("the first heading is the title and the rest are its sections", () => {
    const doc = markdownToDocument(
      "### Title\n\n### 1. Purpose\n\nWhy.\n\n- one\n- two\n\n1. first\n2. second\n\n| A | B |\n| --- | --- |\n| x | y |",
    );
    expect(doc.content!.map((node) => node.type)).toEqual([
      "heading",
      "heading",
      "paragraph",
      "bulletList",
      "orderedList",
      "table",
    ]);
    expect(doc.content![0]!.attrs).toEqual({ level: 1 });
    expect(doc.content![1]!.attrs).toEqual({ level: 2 });
    expect(() => schema.nodeFromJSON(doc).check()).not.toThrow();
  });

  for (const page of templates) {
    test(`${page.slug} is a document the editor accepts`, () => {
      const markdown = templateMarkdown(page);
      expect(markdown).not.toBeNull();
      const doc = markdownToDocument(markdown!);
      expect(() => schema.nodeFromJSON(doc).check()).not.toThrow();
      // Nothing is lost on the way: no Markdown syntax survives as text.
      const text = JSON.stringify(doc);
      expect(text).not.toContain("**");
      expect(text).not.toMatch(/"text":"\s*\|/);
    });
  }
});

describe("the Word downloads", () => {
  test("open with the page's notice, which asks to be deleted", () => {
    for (const page of templates) {
      const doc = templateDocument(page)!;
      expect(() => schema.nodeFromJSON(doc).check()).not.toThrow();
      const note = doc.content![0]!.content![0]!;
      expect(note.text).toContain("not legal or clinical advice");
      expect(note.text).toContain(`bindersnap.com${page.path}`);
      expect(note.text).toContain("Delete this note");
      expect(note.marks).toEqual([{ type: "italic" }]);
      // The policy's title still follows it.
      expect(doc.content![1]!.type).toBe("heading");
    }
  });

  test("every template has one, and its page links to it", async () => {
    const binaries = await publicSiteBinaryFiles();
    const files = publicSiteFiles();
    for (const page of templates) {
      const bytes = binaries.get(`${page.path}.docx`);
      expect(bytes).toBeDefined();
      // A .docx is a zip: it starts "PK".
      expect(String.fromCharCode(bytes![0]!, bytes![1]!)).toBe("PK");
      expect(files.get(page.path)).toContain(
        `href="${page.path}.docx" download="${page.slug}.docx"`,
      );
    }
    expect(binaries.size).toBe(templates.length);
  });
});
