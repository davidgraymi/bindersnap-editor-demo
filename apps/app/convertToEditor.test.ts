import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import JSZip from "jszip";
import { JSDOM } from "jsdom";

import { renderSeedDocumentFile } from "../../tests/seed-documents";

import {
  ConversionError,
  convertibleKind,
  convertToEditorDocument,
  convertToEditorFile,
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

test("Word's Title and Subtitle convert to the editor's", async () => {
  const docx = new Document({
    // Word defines Subtitle in every file; this library only when asked.
    styles: { paragraphStyles: [{ id: "Subtitle", name: "Subtitle" }] },
    sections: [
      {
        children: [
          new Paragraph({ text: "Hand Hygiene", heading: HeadingLevel.TITLE }),
          new Paragraph({ text: "Nursing", style: "Subtitle" }),
          new Paragraph({ text: "Wash your hands." }),
        ],
      },
    ],
  });
  const { document } = await convertToEditorDocument(
    await Packer.toBlob(docx),
    "Hand hygiene.docx",
  );
  expect(
    (document.content ?? []).map((node) => node.attrs?.variant ?? null),
  ).toEqual(["title", "subtitle", null]);
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

/** The smallest PNG there is: one transparent pixel. */
const PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

/** A Word file with a line of text and one picture of the given kind. */
async function wordFileWithPicture(type: "png" | "bmp"): Promise<Blob> {
  const buffer = await Packer.toBuffer(
    new Document({
      sections: [
        {
          children: [
            new Paragraph({ children: [new TextRun("Hand hygiene")] }),
            new Paragraph({
              children: [
                new ImageRun({
                  type,
                  data: PIXEL_PNG,
                  transformation: { width: 10, height: 10 },
                }),
              ],
            }),
          ],
        },
      ],
    }),
  );
  return new Blob([new Uint8Array(buffer)]);
}

/** Bun has no FileReader; the editor's picture scaling reads with one. */
function withFileReader(): () => void {
  const original = (globalThis as Record<string, unknown>).FileReader;
  class Reader {
    result: string | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    readAsDataURL(blob: Blob) {
      void blob.arrayBuffer().then((bytes) => {
        this.result = `data:${blob.type};base64,${Buffer.from(bytes).toString("base64")}`;
        this.onload?.();
      });
    }
  }
  Object.defineProperty(globalThis, "FileReader", {
    configurable: true,
    value: Reader,
  });
  return () =>
    Object.defineProperty(globalThis, "FileReader", {
      configurable: true,
      value: original,
    });
}

test("a Word file's picture comes across, embedded", async () => {
  const restore = withFileReader();
  try {
    const { document, notes } = await convertToEditorDocument(
      await wordFileWithPicture("png"),
      "Hand hygiene.docx",
    );
    expect(JSON.stringify(document)).toContain("data:image/png;base64,");
    expect(notes.join(" ")).not.toContain("could not come across");
  } finally {
    restore();
  }
});

test("a picture the editor would refuse is left out, and the notes say so", async () => {
  const { document, notes } = await convertToEditorDocument(
    await wordFileWithPicture("bmp"),
    "Hand hygiene.docx",
  );
  expect(JSON.stringify(document)).not.toContain('"image"');
  expect(notes.join(" ")).toContain("One picture could not come across");
});

test("a PDF converts with its headings recovered and a note saying they were guessed", async () => {
  const file = await renderSeedDocumentFile(
    {
      title: "Medication Administration Policy",
      sections: [
        {
          heading: "Purpose",
          paragraphs: ["This policy sets out how medication is given."],
        },
      ],
    },
    "pdf",
    "nursing/medication",
    "01J8XZ4K7MQ9V3B0RN7YHS2E1D",
  );
  const { document, notes } = await convertToEditorDocument(
    new Blob([new Uint8Array(Buffer.from(file.content, "base64"))]),
    "Medication.pdf",
  );
  expect(document.content?.[0]?.type).toBe("heading");
  expect(JSON.stringify(document)).toContain("how medication is given");
  expect(notes.join(" ")).toContain("guessed from type size");
});

test("a converted file is named .json and sent as the editor's document", async () => {
  const source = new File(
    [await wordFile(["Hand hygiene", "Wash your hands."])],
    "Hand hygiene.docx",
  );
  const { file, notes } = await convertToEditorFile(source);
  expect(file.name).toBe("Hand hygiene.json");
  expect(JSON.parse(await file.text()).content[0].type).toBe("heading");
  expect(notes.length).toBeGreaterThan(0);
});
