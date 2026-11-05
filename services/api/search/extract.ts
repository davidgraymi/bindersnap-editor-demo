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

async function docxPassages(
  bytes: Uint8Array<ArrayBuffer>,
): Promise<Passage[]> {
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
  return passagesFromBlocks(await extractPdfBlocks(new Blob([bytes])));
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
