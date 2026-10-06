import { parseDocumentJson, documentBlocks } from "./documentBlocks";
import { documentToDocx } from "./documentDocx";
import { documentToPdf } from "./documentPdf";

/**
 * Getting a document out of Bindersnap as Word or PDF.
 *
 * **A document written here is converted; a file uploaded here is handed back
 * as it came.** The editor stores ProseMirror JSON, which nobody outside the
 * product can use, so it is laid out afresh as a .docx or a PDF — as the page
 * it is, with nothing added: no header, footer or page number the author did
 * not put there. An uploaded
 * Word file or PDF is already the thing the person wants, and converting a
 * Word file to PDF faithfully needs Word — so a PDF of an uploaded .docx is
 * refused with a sentence rather than approximated.
 */

export type ExportFormat = "pdf" | "docx";

export const EXPORT_TYPES: Record<ExportFormat, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export function parseExportFormat(value: string | null): ExportFormat | null {
  return value === "pdf" || value === "docx" ? value : null;
}

/** `hand-hygiene-v3.pdf`: what the document is, and which version. */
export function exportFilename(params: {
  slugPath: string;
  version: number | null;
  proposed: boolean;
  format: ExportFormat;
}): string {
  const leaf = params.slugPath.split("/").pop() || "document";
  const suffix = params.proposed
    ? "-proposed"
    : params.version !== null
      ? `-v${params.version}`
      : "";
  return `${leaf}${suffix}.${params.format}`;
}

export type ExportResult =
  | { kind: "converted"; bytes: Uint8Array }
  | { kind: "original" }
  | { kind: "refused"; reason: string };

function extensionOf(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot <= 0 ? "" : path.slice(dot + 1).toLowerCase();
}

const FORMAT_NAMES: Record<string, string> = {
  pdf: "a PDF",
  docx: "a Word document",
  doc: "a Word document",
  xlsx: "an Excel spreadsheet",
  xls: "an Excel spreadsheet",
  md: "a text file",
};

/**
 * Turn a document's stored bytes into the format asked for — or say that its
 * own file is already it, or why it cannot be.
 */
export async function exportDocument(params: {
  path: string;
  bytes: Uint8Array;
  format: ExportFormat;
  /** The document's name, for the file's properties. Never printed on it. */
  title: string;
}): Promise<ExportResult> {
  const extension = extensionOf(params.path);

  if (extension === "json") {
    const doc = parseDocumentJson(new TextDecoder().decode(params.bytes));
    if (!doc) {
      return {
        kind: "refused",
        reason: "This document could not be read to export it.",
      };
    }
    const blocks = documentBlocks(doc);
    const bytes =
      params.format === "pdf"
        ? await documentToPdf(blocks, { title: params.title })
        : await documentToDocx(blocks, { title: params.title });
    return { kind: "converted", bytes };
  }

  if (
    extension === params.format ||
    (params.format === "docx" && extension === "doc")
  ) {
    return { kind: "original" };
  }

  const what = FORMAT_NAMES[extension] ?? `a .${extension || "file"} file`;
  return {
    kind: "refused",
    reason: `This document was uploaded as ${what}, so it downloads as that file. Use Download to get it.`,
  };
}
