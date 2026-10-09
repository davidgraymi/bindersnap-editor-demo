import { describe, expect, test } from "bun:test";

import JSZip from "jszip";
import {
  PDFDocument,
  PDFRawStream,
  PDFArray,
  PDFName,
  decodePDFRawStream,
} from "pdf-lib";

import { exportDocument, exportFilename } from "./exportDocument";
import { fontKey, obfuscateFont } from "./docxFonts";
import { SAMPLE_DOCUMENT } from "./fixtures";
import {
  SCREEN_FACES,
  faceForFamily,
  fontBytes,
  pickFile,
  wordFontForFamily,
} from "./fonts";
import { documentBlocks } from "./documentBlocks";
import { columnShares } from "./documentPdf";

const title = "Infection Control Policy";
const json = new TextEncoder().encode(JSON.stringify(SAMPLE_DOCUMENT));

async function convert(format: "pdf" | "docx", doc: unknown = SAMPLE_DOCUMENT) {
  const result = await exportDocument({
    path: "nursing/infection-control.json",
    bytes: new TextEncoder().encode(JSON.stringify(doc)),
    format,
    title,
  });
  if (result.kind !== "converted") throw new Error(result.kind);
  return result.bytes;
}

/** Every operator drawn on every page, decoded. */
async function pageContents(bytes: Uint8Array): Promise<string[]> {
  const pdf = await PDFDocument.load(bytes);
  return pdf.getPages().map((page) => {
    const contents = page.node.get(PDFName.of("Contents"));
    if (!contents) return "";
    const streams =
      contents instanceof PDFArray
        ? contents.asArray().map((ref) => pdf.context.lookup(ref))
        : [pdf.context.lookup(contents as never)];
    return streams
      .map((stream) =>
        new TextDecoder().decode(
          decodePDFRawStream(stream as PDFRawStream).decode(),
        ),
      )
      .join("\n");
  });
}

describe("documentBlocks", () => {
  const blocks = documentBlocks(SAMPLE_DOCUMENT as never);

  test("numbers sections the way the page does, and lists them as the editor does", () => {
    const headings = blocks.filter((block) => block.kind === "heading");
    expect(
      headings.map((block) => block.kind === "heading" && block.number),
    ).toEqual([null, "1.", "1.1", "2.", null]);
    const contents = blocks.find((block) => block.kind === "contents");
    expect(
      contents?.kind === "contents" &&
        contents.entries.map((entry) => entry.text),
    ).toEqual([
      "Infection Control Policy",
      "1. Hand hygiene",
      "1.1 Checks",
      "2. Records",
    ]);
  });

  test("a contents list the editor stored is the one exported", () => {
    const stored = documentBlocks({
      type: "doc",
      content: [
        {
          type: "tableOfContents",
          attrs: { entries: [{ level: 2, text: "As it was saved" }] },
        },
      ],
    } as never);
    expect(stored[0]).toEqual({
      kind: "contents",
      entries: [{ level: 2, text: "As it was saved" }],
    });
  });

  test("keeps the marks on a run, and the author's font, size and spacing", () => {
    const first = blocks.find((block) => block.kind === "paragraph");
    expect(
      first?.kind === "paragraph" && first.runs.find((run) => run.link)?.link,
    ).toBe("https://www.cdc.gov");
    const set = blocks.findLast((block) => block.kind === "paragraph");
    expect(set).toMatchObject({
      indent: 1,
      lineSpacing: 1.5,
      runs: [
        {
          font: "Calibri, Carlito, Arial, sans-serif",
          size: 14,
          color: "#b91c1c",
        },
      ],
    });
  });
});

describe("fonts", () => {
  test("each font the editor offers is drawn with a file that matches it", () => {
    expect(faceForFamily(undefined)).toBeNull();
    expect(faceForFamily("var(--brand-font-serif)")).toBe("lora");
    expect(faceForFamily("Calibri, Carlito, Arial, sans-serif")).toBe(
      "carlito",
    );
    expect(faceForFamily('"Times New Roman", Times, serif')).toBe("times");
    expect(faceForFamily("Verdana, Geneva, sans-serif")).toBe("vera");
    // A font nobody has falls through to its generic family, as a browser's.
    expect(faceForFamily('"Bradley Hand", cursive, serif')).toBe("times");
    expect(wordFontForFamily("Calibri, Carlito, Arial, sans-serif")).toBe(
      "Calibri",
    );
    expect(wordFontForFamily('"Courier New", Courier, monospace')).toBe(
      "Courier New",
    );
  });

  test("weights are picked as the browser picks them from what the page loads", () => {
    // The page loads Lora at 500–700, so plain Lora is its Medium.
    expect(pickFile(SCREEN_FACES.lora, 400, false).face.file).toBe(
      "Lora-Medium.ttf",
    );
    expect(pickFile(SCREEN_FACES.lora, 600, false).face.file).toBe(
      "Lora-SemiBold.ttf",
    );
    // Bold italic has no 700 italic to use: the 600 is nearest.
    expect(pickFile(SCREEN_FACES.lora, 700, true).face.file).toBe(
      "Lora-SemiBoldItalic.ttf",
    );
    // Geist is loaded to 600, so bold is its SemiBold, and italic is slanted.
    expect(pickFile(SCREEN_FACES.geist, 700, false).face.file).toBe(
      "Geist-SemiBold.ttf",
    );
    expect(pickFile(SCREEN_FACES.geist, 400, true)).toMatchObject({
      slant: true,
      embolden: false,
    });
    // Geist Mono stops at 500, so bold code is emboldened as on screen.
    expect(pickFile(SCREEN_FACES.geistMono, 700, false)).toMatchObject({
      face: { file: "GeistMono-Medium.ttf" },
      embolden: true,
    });
  });
});

describe("a document's PDF", () => {
  test("is a real PDF on Letter, set in the editor's fonts", async () => {
    const bytes = await convert("pdf");
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    const pdf = await PDFDocument.load(bytes);
    const { width, height } = pdf.getPage(0).getSize();
    expect([width, height]).toEqual([612, 792]);
    const text = new TextDecoder("latin1").decode(bytes);
    for (const font of [
      "Geist-Regular",
      "Lora-SemiBold",
      "GeistMono-Regular",
      "Carlito-Regular",
    ]) {
      expect(text).toContain(`/BaseFont /${font}`);
    }
    // Nothing is set in a face the author never chose.
    expect(text).not.toContain("/BaseFont /Times-Roman");
    expect(pdf.getTitle()).toBe(title);
  });

  test("adds nothing: no header, no footer, no page numbers", async () => {
    const empty = await convert("pdf", {
      type: "doc",
      content: [{ type: "paragraph" }],
    });
    const [page] = await pageContents(empty);
    // A page with nothing on it draws no text at all.
    expect(page).not.toMatch(/\bT[jJ]\b/);

    const pages = await pageContents(await convert("pdf"));
    // Two pages, because the author put a page break in; no more.
    expect(pages).toHaveLength(2);
  });

  test("the same document makes the same PDF, byte for byte", async () => {
    const make = async () =>
      exportDocument({ path: "a.json", bytes: json, format: "pdf", title });
    const [first, second] = await Promise.all([make(), make()]);
    if (first.kind !== "converted" || second.kind !== "converted")
      throw new Error("not converted");
    expect(Buffer.from(first.bytes).equals(Buffer.from(second.bytes))).toBe(
      true,
    );
  });

  test("a column the author sized keeps its width", () => {
    const cell = (colwidth: (number | null)[] | null) => ({
      blocks: [],
      header: false,
      colspan: 1,
      colwidth,
      shade: null,
    });
    // 96px is an inch: 72pt, and the other column has the rest.
    expect(columnShares([[cell([96]), cell(null)]], 468)).toEqual({
      shares: [72 / 468, 396 / 468],
      width: 468,
    });
    // Every column sized: the table is as wide as they are.
    expect(columnShares([[cell([96]), cell([192])]], 468).width).toBe(216);
  });
});

describe("a document's Word document", () => {
  test("has no header or footer, and embeds the fonts Word does not have", async () => {
    const zip = await JSZip.loadAsync(await convert("docx"));
    const names = Object.keys(zip.files);
    expect(names.some((name) => /header|footer/.test(name))).toBe(false);

    const document = await zip.file("word/document.xml")!.async("string");
    expect(document).not.toContain("<w:headerReference");
    expect(document).not.toContain("PAGE");
    // The author's own font and size, as Word names them.
    expect(document).toContain('w:ascii="Calibri"');
    expect(document).toContain('<w:sz w:val="28"/>');

    const table = await zip.file("word/fontTable.xml")!.async("string");
    for (const font of ["Geist", "Lora SemiBold", "Geist Mono"]) {
      expect(table).toContain(`w:name="${font}"`);
    }
    expect(table).toContain("w:embedRegular");
    expect(names.filter((name) => name.endsWith(".odttf")).length).toBe(
      (table.match(/w:embed(Regular|Bold|Italic|BoldItalic)/g) ?? []).length,
    );
    expect(await zip.file("word/settings.xml")!.async("string")).toContain(
      "<w:embedTrueTypeFonts/>",
    );
  });

  test("an embedded font is Word's obfuscation of the file, and undoes to it", () => {
    const bytes = fontBytes("Geist-Regular.ttf");
    const key = fontKey(bytes);
    expect(key).toMatch(
      /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/,
    );
    const hidden = obfuscateFont(bytes, key);
    expect(
      Buffer.from(hidden.slice(0, 32)).equals(Buffer.from(bytes.slice(0, 32))),
    ).toBe(false);
    expect(
      Buffer.from(hidden.slice(32)).equals(Buffer.from(bytes.slice(32))),
    ).toBe(true);
    expect(
      Buffer.from(obfuscateFont(hidden, key)).equals(Buffer.from(bytes)),
    ).toBe(true);
  });
});

describe("exportDocument", () => {
  test("an uploaded file is handed back as itself, or the refusal says why", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(
      (await exportDocument({ path: "a.pdf", bytes, format: "pdf", title }))
        .kind,
    ).toBe("original");
    const refused = await exportDocument({
      path: "a.docx",
      bytes,
      format: "pdf",
      title,
    });
    expect(refused.kind).toBe("refused");
    expect(refused.kind === "refused" && refused.reason).toContain(
      "a Word document",
    );
  });
});

describe("exportFilename", () => {
  test("says which document and which version", () => {
    expect(
      exportFilename({
        slugPath: "nursing/hand-hygiene",
        version: 3,
        proposed: false,
        format: "pdf",
      }),
    ).toBe("hand-hygiene-v3.pdf");
    expect(
      exportFilename({
        slugPath: "hand-hygiene",
        version: null,
        proposed: true,
        format: "docx",
      }),
    ).toBe("hand-hygiene-proposed.docx");
  });
});
