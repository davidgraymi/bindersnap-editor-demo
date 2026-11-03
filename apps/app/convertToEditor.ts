/**
 * Turning a Word file or a PDF into a document the editor can write.
 *
 * A `.docx` or a PDF is edited in the program that made it, so a person who
 * wants to keep working on one in Bindersnap has had to retype it. This reads
 * the file in the browser — the same mammoth and pdf.js the comparison uses,
 * so there is still no conversion service — and hands back the editor's own
 * JSON. The caller commits it as a new version of the same document (the
 * server keeps the identity segment of the filename, ADR 0005) or as a new
 * document, in a draft, so it goes through review like anything else.
 *
 * **It is a conversion, not a copy, and it says so.** A Word file keeps its
 * headings, lists, tables, emphasis and pictures (embedded as the editor
 * embeds them, `imageFiles.ts`) but not its page layout; a PDF has no
 * structure at all, so headings are recovered from type size. {@link notes}
 * lists what was lost so the person is told to read it before proposing it.
 * The original stays in the record: the converted version is a diff a
 * reviewer can read against it.
 */

import type { JSONContent } from "@tiptap/core";

import { validateUploadFile } from "./api";
import { blocksToHtml } from "./documentBlocks";
import { fileExtension } from "./documentFile";
import { docxToHtml } from "./docxHtml";
import { sanitizeHtml } from "../../packages/utils/sanitizer";
import { pictureToDataUrl } from "../../packages/editor/imageFiles";

export type ConvertibleKind = "word" | "pdf";

/** Which kind of file this is, or null when it cannot be converted. */
export function convertibleKind(
  fileName: string | null | undefined,
): ConvertibleKind | null {
  if (!fileName) return null;
  const extension = fileExtension(fileName);
  if (extension === "docx") return "word";
  if (extension === "pdf") return "pdf";
  return null;
}

export interface ConvertedDocument {
  /** The document in the editor's own JSON. */
  document: JSONContent;
  /** What the person should check, in plain words. May be empty. */
  notes: string[];
}

/** Thrown when a file converts to nothing, so the caller can say why. */
export class ConversionError extends Error {}

const PDF_NOTE =
  "A PDF carries no headings, lists or tables, only text on a page. Headings were guessed from type size and the rest is plain paragraphs, so read it through before you propose it.";
const WORD_NOTE =
  "Page layout, headers, footers, page numbers and text boxes do not come across. Headings, lists, tables, emphasis and pictures do.";

/** What became of the pictures that could not come across, in plain words. */
function picturesNote(leftOut: number): string {
  return leftOut === 1
    ? "One picture could not come across: only PNG, JPEG, GIF and WebP pictures up to 1.5 MB, once scaled, go in a document. Add it back in the editor if the document needs it."
    : `${leftOut} pictures could not come across: only PNG, JPEG, GIF and WebP pictures up to 1.5 MB, once scaled, go in a document. Add them back in the editor if the document needs them.`;
}

let parser: Promise<(html: string) => JSONContent> | null = null;

/** The editor's schema as an HTML parser, loaded once. */
function loadHtmlParser(): Promise<(html: string) => JSONContent> {
  if (parser === null) {
    parser = (async () => {
      const [{ getSchema }, pm, { documentContentExtensions }] =
        await Promise.all([
          import("@tiptap/core"),
          import("@tiptap/pm/model"),
          import("../../packages/editor/documentSchema"),
        ]);
      // The editor's own list, so ProseMirror keeps exactly what the editor
      // and the reader both know and drops the rest.
      const schema = getSchema(documentContentExtensions());
      const domParser = pm.DOMParser.fromSchema(schema);
      return (html: string) => {
        const dom = new DOMParser().parseFromString(
          `<body>${html}</body>`,
          "text/html",
        );
        return domParser.parse(dom.body).toJSON() as JSONContent;
      };
    })().catch((err: unknown) => {
      parser = null;
      throw err;
    });
  }
  return parser;
}

/** Whether a parsed document holds any text at all. */
function hasText(node: JSONContent): boolean {
  if (typeof node.text === "string" && node.text.trim() !== "") return true;
  return (node.content ?? []).some(hasText);
}

/**
 * An HTML fragment as an editor document.
 *
 * Sanitized first, though the converters only emit a small subset: the one
 * place HTML becomes a document should not depend on that staying true.
 */
export async function htmlToEditorDocument(html: string): Promise<JSONContent> {
  const parse = await loadHtmlParser();
  return parse(sanitizeHtml(html));
}

/**
 * Read a Word file or a PDF as an editor document.
 *
 * @throws {ConversionError} when the file is not one we can read, or holds no
 *   text to convert (a scanned PDF is a picture of a page).
 */
export async function convertToEditorDocument(
  file: Blob,
  fileName: string,
): Promise<ConvertedDocument> {
  const kind = convertibleKind(fileName);
  if (kind === null) {
    throw new ConversionError(
      "Only Word (.docx) files and PDFs can be converted.",
    );
  }

  let html: string;
  const notes: string[] = [];

  if (kind === "word") {
    // Each picture scaled and embedded as the editor would on a paste; one it
    // would refuse is left out and counted, so the notes can say so.
    let leftOut = 0;
    html = await docxToHtml(file, {
      picture: async (image) => {
        try {
          return await pictureToDataUrl(
            new File([image], "picture", { type: image.type }),
          );
        } catch {
          leftOut += 1;
          return null;
        }
      },
    }).catch(() => {
      throw new ConversionError(
        "That Word file could not be read. Save it again as .docx and try again.",
      );
    });
    notes.push(WORD_NOTE);
    if (leftOut > 0) notes.push(picturesNote(leftOut));
  } else {
    const { extractPdfBlocks } = await import("./pdfText");
    const blocks = await extractPdfBlocks(file).catch(() => {
      throw new ConversionError(
        "That PDF could not be read. It may be damaged or protected.",
      );
    });
    html = blocksToHtml(blocks);
    notes.push(PDF_NOTE);
  }

  const document = await htmlToEditorDocument(html);
  if (!hasText(document)) {
    throw new ConversionError(
      kind === "pdf"
        ? "That PDF has no text to convert. A scanned page is a picture, so it stays a file."
        : "That Word file has no text to convert.",
    );
  }
  return { document, notes };
}

/**
 * The converted document as the file the editor writes.
 *
 * Named after the original with `.json` in place of its extension. The server
 * rebuilds the stored filename from the document's name and identity, so this
 * name only decides the extension.
 */
export function editorDocumentFile(
  document: JSONContent,
  originalName: string,
): File {
  const base = originalName.replace(/\.[^./]+$/, "") || "document";
  return new File([JSON.stringify(document)], `${base}.json`, {
    type: "application/json",
  });
}

/**
 * A Word file or PDF read into the file the editor writes, ready to send.
 *
 * Checked against the same limit as any upload: pictures now come across, and
 * a converted document carries them as text, so it can outgrow the original.
 *
 * @throws {ConversionError} as {@link convertToEditorDocument} does, or when
 *   the converted document is too large to upload.
 */
export async function convertToEditorFile(
  source: File,
): Promise<ConvertedDocument & { file: File }> {
  const converted = await convertToEditorDocument(source, source.name);
  const file = editorDocumentFile(converted.document, source.name);
  const validation = validateUploadFile(file);
  if (!validation.valid) {
    const sizeMiB = (file.size / (1024 * 1024)).toFixed(1);
    throw new ConversionError(
      `Converted, with its pictures, it comes to ${sizeMiB} MiB, over the 25 MiB a document can be. Add it as the file it is, or make its pictures smaller in Word first.`,
    );
  }
  return { ...converted, file };
}
