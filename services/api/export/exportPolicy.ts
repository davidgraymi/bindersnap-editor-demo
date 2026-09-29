import { parsePolicyJson, policyBlocks } from "./policyBlocks";
import { policyToDocx, type ExportHeading } from "./policyDocx";
import { policyToPdf } from "./policyPdf";

/**
 * Getting a document out of Bindersnap as Word or PDF.
 *
 * **A policy written here is converted; a file uploaded here is handed back
 * as it came.** The editor stores ProseMirror JSON, which nobody outside the
 * product can use, so it is laid out afresh as a .docx or a PDF. An uploaded
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

const DATE = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});

function formatDate(iso: string): string | null {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : DATE.format(date);
}

/**
 * What the running header says about the copy: which version, and whether it
 * is the one in force. A page that has come loose from the binder on the
 * shelf still has to say whether it is current.
 */
export function describeExportStatus(params: {
  ref: string;
  versions: readonly { tag: string; version: number; publishedAt: string }[];
}): string {
  const { ref, versions } = params;
  const latest = versions[0] ?? null;

  if (ref === "main") {
    if (!latest) return "Not yet published";
    const date = formatDate(latest.publishedAt);
    return `Version ${latest.version} · published${date ? ` ${date}` : ""}`;
  }

  const tagged = versions.find((entry) => entry.tag === ref);
  if (tagged) {
    const date = formatDate(tagged.publishedAt);
    const current = latest && latest.version === tagged.version;
    return `Version ${tagged.version} · published${date ? ` ${date}` : ""}${
      current ? "" : ` · replaced by version ${latest?.version}`
    }`;
  }

  return "Proposed — not yet approved";
}

/** `hand-hygiene-v3.pdf`: what the policy is, and which version. */
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
  heading: ExportHeading;
}): Promise<ExportResult> {
  const extension = extensionOf(params.path);

  if (extension === "json") {
    const doc = parsePolicyJson(new TextDecoder().decode(params.bytes));
    if (!doc) {
      return {
        kind: "refused",
        reason: "This document could not be read to export it.",
      };
    }
    const blocks = policyBlocks(doc);
    const bytes =
      params.format === "pdf"
        ? await policyToPdf(blocks, params.heading)
        : await policyToDocx(blocks, params.heading);
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
