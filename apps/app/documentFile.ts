/**
 * What we can show a reader without asking them to download anything.
 *
 * Bindersnap accepts any file, and most of what regulated teams approve is a
 * .docx or a .pdf. We render what the browser can render honestly and say so
 * plainly when we cannot, rather than pretending a preview exists.
 */
export type DocumentPreviewKind =
  "markdown" | "text" | "pdf" | "image" | "unsupported";

const MARKDOWN_EXTENSIONS = new Set(["md", "markdown", "mdown", "mkd"]);

const TEXT_EXTENSIONS = new Set([
  "txt",
  "text",
  "csv",
  "tsv",
  "log",
  "json",
  "yaml",
  "yml",
  "xml",
  "toml",
  "ini",
  "rtf",
  "sql",
]);

const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
  "bmp",
]);

/** Lower-cased extension without the dot, or "" when the name has none. */
export function fileExtension(fileName: string): string {
  const base = fileName.split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  return base.slice(dot + 1).toLowerCase();
}

export function classifyDocumentFile(
  fileName: string | null | undefined,
): DocumentPreviewKind {
  if (!fileName) return "unsupported";

  const extension = fileExtension(fileName);
  if (MARKDOWN_EXTENSIONS.has(extension)) return "markdown";
  if (TEXT_EXTENSIONS.has(extension)) return "text";
  if (extension === "pdf") return "pdf";
  // SVG is deliberately excluded: it is a script-bearing document, not a
  // picture, and we never render untrusted markup inline.
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  return "unsupported";
}

/**
 * A human label for a file type — "Word document", not "application/vnd…".
 * Used on the card shown when a file has no inline preview.
 */
export function describeFileKind(fileName: string | null | undefined): string {
  switch (fileExtension(fileName ?? "")) {
    case "doc":
    case "docx":
      return "Word document";
    case "xls":
    case "xlsx":
      return "Excel spreadsheet";
    case "ppt":
    case "pptx":
      return "PowerPoint deck";
    case "pdf":
      return "PDF";
    case "zip":
      return "Archive";
    case "":
      return "File";
    default:
      return `${fileExtension(fileName ?? "").toUpperCase()} file`;
  }
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unitIndex]}`;
}
