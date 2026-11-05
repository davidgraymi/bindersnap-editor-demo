/**
 * A file's bytes, as the passages search indexes (ADR 0007, §2).
 *
 * | Format         | Read with                         |
 * | -------------- | --------------------------------- |
 * | Editor `.json` | the Tiptap tree                   |
 * | `.md`, `.txt`  | the Markdown blocks               |
 * | `.docx`        | mammoth to HTML, then its blocks  |
 * | PDF            | pdf.js, then its blocks           |
 *
 * Anything else is not read, and is found by its title only — as is a file of
 * one of these formats that will not open. Null means "not read", which is
 * different from a document with no words in it (a scanned PDF with no text
 * layer), which is an empty list.
 */

import {
  passagesFromBlocks,
  passagesFromEditorDocument,
  passagesFromMarkdown,
  type Passage,
  type TextBlock,
} from "../../../packages/utils/documentPassages";

/** The formats read for their words, by extension. */
export type ReadableFormat = "editor" | "markdown" | "docx" | "pdf";

export function readableFormat(path: string): ReadableFormat | null {
  const extension = /\.([^./]+)$/.exec(path)?.[1]?.toLowerCase() ?? "";
  switch (extension) {
    case "json":
      return "editor";
    case "md":
    case "markdown":
    case "txt":
      return "markdown";
    case "docx":
      return "docx";
    case "pdf":
      return "pdf";
    default:
      return null;
  }
}

/** Larger than any upload the app allows (25 MiB), so only a stray file is skipped. */
export const MAX_EXTRACT_BYTES = 32 * 1024 * 1024;

/** The tags mammoth writes that are a block of their own. */
const DOCX_BLOCKS = "h1, h2, h3, h4, h5, h6, p, li, td, th, caption";

/**
 * Decode the five entities mammoth escapes, and numeric ones — in one pass,
 * so `&amp;lt;` is `&lt;` and never `<`. The text is indexed and shown as
 * text, never put back into a page as markup.
 */
function decodeEntities(text: string): string {
  return text.replace(
    /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|#39);/gi,
    (whole, entity: string) => {
      const name = entity.toLowerCase();
      if (name === "amp") return "&";
      if (name === "lt") return "<";
      if (name === "gt") return ">";
      if (name === "quot") return '"';
      if (name === "apos" || name === "#39") return "'";
      const code = name.startsWith("#x")
        ? Number.parseInt(name.slice(2), 16)
        : Number.parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole;
    },
  );
}

/**
 * Mammoth's HTML as blocks, read by a real HTML parser (Bun's HTMLRewriter),
 * not by regular expressions. A block opens at its tag and takes the words
 * until it closes, so a paragraph inside a list item or a table cell is read
 * once, as itself, and in document order.
 */
export async function htmlBlocks(html: string): Promise<TextBlock[]> {
  const blocks: TextBlock[] = [];
  const open: TextBlock[] = [];

  await new HTMLRewriter()
    .on(DOCX_BLOCKS, {
      element(element) {
        const block: TextBlock = {
          kind: /^h\d$/i.test(element.tagName) ? "heading" : "paragraph",
          text: "",
        };
        blocks.push(block);
        open.push(block);
        element.onEndTag(() => {
          open.pop();
        });
      },
    })
    .on("br", {
      element() {
        const current = open[open.length - 1];
        if (current) current.text += " ";
      },
    })
    .onDocument({
      text(chunk) {
        const current = open[open.length - 1];
        if (current) current.text += chunk.text;
      },
    })
    .transform(new Response(html))
    .text();

  return blocks.map((block) => ({
    ...block,
    text: decodeEntities(block.text),
  }));
}

/** What a Word file may unpack to before it is not opened at all. */
const MAX_DOCX_ENTRY_BYTES = 64 * 1024 * 1024;
const MAX_DOCX_TOTAL_BYTES = 160 * 1024 * 1024;
const MAX_DOCX_ENTRIES = 5_000;

/** Pages of a PDF read for search; the rest is found by its title and first pages. */
export const MAX_PDF_PAGES = 1_000;

/**
 * Refuse a Word file that says it unpacks to far more than any policy does.
 *
 * A .docx is a ZIP, and a ZIP of a few megabytes can inflate to gigabytes:
 * opened in the API's process, that is the API gone. The central directory
 * declares every entry's size, so it is read — without inflating anything —
 * and a file past the limits, or one that will not say (ZIP64), is not
 * opened. A file can lie in its directory; that is what the job's record of
 * files that never finished is for (`SearchStore.beginExtraction`).
 */
export function checkZipSizes(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end-of-central-directory record: in the last 64 KiB plus its own 22.
  let end = -1;
  for (
    let at = bytes.byteLength - 22;
    at >= Math.max(0, bytes.byteLength - 22 - 0xffff);
    at -= 1
  ) {
    if (view.getUint32(at, true) === 0x06054b50) {
      end = at;
      break;
    }
  }
  if (end === -1) throw new Error("Not a Word file: no ZIP directory.");

  const entries = view.getUint16(end + 10, true);
  const offset = view.getUint32(end + 16, true);
  if (entries === 0xffff || offset === 0xffffffff) {
    throw new Error("A Word file too large to read for search (ZIP64).");
  }
  if (entries > MAX_DOCX_ENTRIES) {
    throw new Error("A Word file with too many parts to read for search.");
  }

  let total = 0;
  let at = offset;
  for (let index = 0; index < entries; index += 1) {
    if (at + 46 > bytes.byteLength || view.getUint32(at, true) !== 0x02014b50) {
      throw new Error("A Word file whose ZIP directory is damaged.");
    }
    const size = view.getUint32(at + 24, true);
    if (size === 0xffffffff || size > MAX_DOCX_ENTRY_BYTES) {
      throw new Error("A Word file with a part too large to read for search.");
    }
    total += size;
    if (total > MAX_DOCX_TOTAL_BYTES) {
      throw new Error("A Word file that unpacks too large to read for search.");
    }
    at +=
      46 +
      view.getUint16(at + 28, true) +
      view.getUint16(at + 30, true) +
      view.getUint16(at + 32, true);
  }
}

async function docxPassages(
  bytes: Uint8Array<ArrayBuffer>,
): Promise<Passage[]> {
  checkZipSizes(bytes);
  const mammoth = await import("mammoth");
  // Mammoth's Node reader takes a buffer. Pictures are left out: search reads
  // the words, and an inlined picture is megabytes of base64 for nothing.
  const result = await mammoth.convertToHtml(
    { buffer: Buffer.from(bytes) },
    { convertImage: mammoth.images.imgElement(async () => ({ src: "" })) },
  );
  return passagesFromBlocks(await htmlBlocks(result.value));
}

async function pdfPassages(bytes: Uint8Array<ArrayBuffer>): Promise<Passage[]> {
  const { extractPdfBlocks } = await import("../../../packages/utils/pdfText");
  return passagesFromBlocks(
    await extractPdfBlocks(new Blob([bytes]), { maxPages: MAX_PDF_PAGES }),
  );
}

/**
 * The passages of one file, or null when its words are not read.
 *
 * Throws when a readable file will not open; the job catches it, logs it, and
 * indexes the document by its title.
 */
export async function extractPassages(
  path: string,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<Passage[] | null> {
  const format = readableFormat(path);
  if (format === null || bytes.byteLength > MAX_EXTRACT_BYTES) return null;

  switch (format) {
    case "editor": {
      const document: unknown = JSON.parse(new TextDecoder().decode(bytes));
      const isEditor =
        typeof document === "object" &&
        document !== null &&
        (document as { type?: unknown }).type === "doc";
      // A `.json` the editor did not write is somebody's data file: its
      // title finds it, and its braces are not words.
      return isEditor ? passagesFromEditorDocument(document) : null;
    }
    case "markdown":
      return passagesFromMarkdown(new TextDecoder().decode(bytes));
    case "docx":
      return docxPassages(bytes);
    case "pdf":
      return pdfPassages(bytes);
  }
}
