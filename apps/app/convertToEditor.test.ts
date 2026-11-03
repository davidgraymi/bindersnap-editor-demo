import { afterEach, beforeEach, expect, test } from "bun:test";
import JSZip from "jszip";
import { JSDOM } from "jsdom";

import {
  ConversionError,
  convertibleKind,
  convertToEditorDocument,
  editorDocumentFile,
  htmlToEditorDocument,
} from "./convertToEditor";

let originalParser: unknown;

// The converter reads HTML with the browser's own parser, as the rest of the
// app does; Bun has none, so each test gets jsdom's.
beforeEach(() => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  originalParser = (globalThis as Record<string, unknown>).DOMParser;
  Object.defineProperty(globalThis, "DOMParser", {
    configurable: true,
    value: dom.window.DOMParser,
  });
});

afterEach(() => {
  Object.defineProperty(globalThis, "DOMParser", {
    configurable: true,
    value: originalParser,
  });
});

/** The smallest .docx mammoth will read: a heading and two paragraphs. */
async function wordFile(paragraphs: string[]): Promise<Blob> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  const body = paragraphs
    .map((text, index) =>
      index === 0
        ? `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`
        : `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`,
    )
    .join("");
  zip.file(
    "word/document.xml",
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  );
  return zip.generateAsync({ type: "blob" });
}

test("only Word and PDF files are convertible", () => {
  expect(convertibleKind("Hand Hygiene.docx")).toBe("word");
  expect(convertibleKind("hand-hygiene.01J8XZ4K7MQ9V3B0RN7YHS2E1D.PDF")).toBe(
    "pdf",
  );
  expect(convertibleKind("old.doc")).toBeNull();
  expect(convertibleKind("sheet.xlsx")).toBeNull();
  expect(convertibleKind("policy.json")).toBeNull();
  expect(convertibleKind(null)).toBeNull();
});

test("HTML becomes the editor's own nodes", async () => {
  const doc = await htmlToEditorDocument(
    "<h1>Hand hygiene</h1><p>Wash <strong>before</strong> care.</p><ul><li>Soap</li></ul>",
  );
  expect(doc.type).toBe("doc");
  const types = (doc.content ?? []).map((node) => node.type);
  expect(types).toEqual(["heading", "paragraph", "bulletList"]);
  expect(doc.content?.[0]?.attrs?.level).toBe(1);
});

test("a script in the HTML never reaches the document", async () => {
  const doc = await htmlToEditorDocument(
    "<p>Safe</p><script>alert(1)</script>",
  );
  expect(JSON.stringify(doc)).not.toContain("alert");
});

test("a Word file converts with its heading and a note about layout", async () => {
  const { document, notes } = await convertToEditorDocument(
    await wordFile(["Hand hygiene", "Wash your hands."]),
    "Hand hygiene.docx",
  );
  expect(document.content?.[0]?.type).toBe("heading");
  expect(JSON.stringify(document)).toContain("Wash your hands.");
  expect(notes.join(" ")).toContain("Page layout");
});

test("a file that is not Word or PDF is refused", async () => {
  await expect(
    convertToEditorDocument(new Blob(["x"]), "old.doc"),
  ).rejects.toBeInstanceOf(ConversionError);
});

test("a Word file with no text is refused", async () => {
  await expect(
    convertToEditorDocument(await wordFile([""]), "empty.docx"),
  ).rejects.toBeInstanceOf(ConversionError);
});

test("the converted file is named .json after the original", async () => {
  const file = editorDocumentFile(
    { type: "doc", content: [{ type: "paragraph" }] },
    "Hand hygiene.docx",
  );
  expect(file.name).toBe("Hand hygiene.json");
  expect(JSON.parse(await file.text()).type).toBe("doc");
});
