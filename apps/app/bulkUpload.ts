/**
 * Moving a policy manual in: many files at once, or a whole folder.
 *
 * A clinic arrives with a shared drive, not a document. Asking them to add a
 * hundred and forty policies one dialog at a time is asking them not to move
 * in, so a folder dropped on the binder keeps its shape — its subfolders
 * become the binder's folders — and everything goes into **one** change
 * request, because "our existing manual" is one thing to approve, not a
 * hundred and forty.
 *
 * Word documents and PDFs are what a policy manual is made of, so those are
 * what is taken. Everything else a real folder holds — `.DS_Store`, Word's
 * `~$` lock files, a stray spreadsheet — is left out and listed, so nothing
 * disappears without the person being told.
 */

/** The largest file the server takes. Kept in step with `validateUploadFile`. */
export const MAX_BULK_FILE_BYTES = 25 * 1024 * 1024;

/** More than a manual needs, and few enough that one change stays readable. */
export const MAX_BULK_FILES = 300;

const TAKEN_EXTENSIONS = new Set(["doc", "docx", "pdf"]);

/** Files an operating system or Word leaves behind, which nobody meant to send. */
const LITTER = new Set(["thumbs.db", "desktop.ini", ".ds_store"]);

export interface BulkSource {
  file: Pick<File, "name" | "size">;
  /**
   * Where it sat in the folder that was chosen or dropped, including that
   * folder: `Policies/Nursing/Hand hygiene.docx`. Just the name for a loose
   * file.
   */
  relativePath: string;
}

export interface BulkItem<F> {
  file: F;
  /** What the document will be called. */
  name: string;
  /** The binder folder it goes in, as people named it. Empty for the top. */
  folder: string;
  relativePath: string;
}

export interface BulkSkip {
  relativePath: string;
  reason: string;
}

export interface BulkPlan<F> {
  items: BulkItem<F>[];
  skipped: BulkSkip[];
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
}

/**
 * A document's name from its file's: the extension and the underscores go,
 * and it starts with a capital — `hand_hygiene-v3.docx` is "Hand hygiene v3".
 * The rest is left as the author wrote it; guessing at title case turns
 * "PPE and gloves" into "Ppe And Gloves".
 */
export function nameFromFile(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  const lastDot = base.lastIndexOf(".");
  const stem = (lastDot <= 0 ? base : base.slice(0, lastDot))
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return stem.charAt(0).toUpperCase() + stem.slice(1);
}

/** Why a file is not taken, or null when it is. */
export function whyNotTaken(source: BulkSource): string | null {
  const segments = source.relativePath.split("/").filter(Boolean);
  const leaf = segments[segments.length - 1] ?? source.file.name;
  if (
    segments.some((segment) => segment.startsWith(".")) ||
    leaf.startsWith("~$") ||
    LITTER.has(leaf.toLowerCase())
  ) {
    return "A system or temporary file";
  }
  if (!TAKEN_EXTENSIONS.has(extensionOf(leaf))) {
    return "Only Word documents and PDFs are added in bulk";
  }
  if (source.file.size === 0) return "The file is empty";
  if (source.file.size > MAX_BULK_FILE_BYTES) return "Larger than 25 MB";
  return null;
}

/**
 * What will be added, and what will not, before anything is sent.
 *
 * `baseFolder` is where the person asked for them to go; a dropped folder's own
 * name and its subfolders are filed beneath it. Two files that would land at
 * the same name in the same folder keep only the first — the second would be
 * refused by the server halfway through, which is a worse place to learn it.
 */
export function planBulkUpload<F extends Pick<File, "name" | "size">>(
  sources: readonly (BulkSource & { file: F })[],
  baseFolder: string,
): BulkPlan<F> {
  const items: BulkItem<F>[] = [];
  const skipped: BulkSkip[] = [];
  const seen = new Set<string>();

  const sorted = [...sources].sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );

  for (const source of sorted) {
    const reason = whyNotTaken(source);
    if (reason) {
      skipped.push({ relativePath: source.relativePath, reason });
      continue;
    }

    const segments = source.relativePath.split("/").filter(Boolean);
    const leaf = segments.pop() ?? source.file.name;
    const folder = [baseFolder.trim(), ...segments.map((part) => part.trim())]
      .filter(Boolean)
      .join("/");
    const name = nameFromFile(leaf);
    const key = `${folder.toLowerCase()}/${name.toLowerCase()}`;

    if (seen.has(key)) {
      skipped.push({
        relativePath: source.relativePath,
        reason: "Another file here has the same name",
      });
      continue;
    }
    if (items.length >= MAX_BULK_FILES) {
      skipped.push({
        relativePath: source.relativePath,
        reason: `More than ${MAX_BULK_FILES} files at once`,
      });
      continue;
    }

    seen.add(key);
    items.push({
      file: source.file,
      name,
      folder,
      relativePath: source.relativePath,
    });
  }

  return { items, skipped };
}

/** What the change request that carries them is called. */
export function describeBulkChange(
  items: readonly Pick<BulkItem<unknown>, "name" | "folder">[],
): { title: string; body: string } {
  const title =
    items.length === 1
      ? `Add ${items[0]!.name}`
      : `Add ${items.length} documents`;
  const lines = items.map((item) =>
    item.folder
      ? `- ${item.name} (${item.folder.replace(/\//g, " › ")})`
      : `- ${item.name}`,
  );
  return { title, body: lines.join("\n") };
}

/**
 * Every file under something dropped on the page, with where it sat.
 *
 * A dropped folder arrives as a `FileSystemEntry`, not a `File`, and has to be
 * walked; `readEntries` answers a page at a time, so it is read until it
 * returns nothing.
 */
export async function filesFromDrop(
  items: DataTransferItemList,
): Promise<BulkSource[]> {
  const entries: FileSystemEntry[] = [];
  const loose: File[] = [];
  for (const item of Array.from(items)) {
    if (item.kind !== "file") continue;
    const entry = item.webkitGetAsEntry?.();
    if (entry) entries.push(entry);
    else {
      const file = item.getAsFile();
      if (file) loose.push(file);
    }
  }

  const found: BulkSource[] = loose.map((file) => ({
    file,
    relativePath: file.name,
  }));

  const walk = async (entry: FileSystemEntry, path: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) =>
        (entry as FileSystemFileEntry).file(resolve, reject),
      );
      found.push({ file, relativePath: path + entry.name });
      return;
    }
    if (!entry.isDirectory) return;
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
        reader.readEntries(resolve, reject),
      );
      if (batch.length === 0) break;
      for (const child of batch) await walk(child, `${path}${entry.name}/`);
    }
  };

  for (const entry of entries) await walk(entry, "");
  return found;
}

/** Files from an `<input type="file">`, folder picker or not. */
export function filesFromInput(files: FileList | null): BulkSource[] {
  return Array.from(files ?? []).map((file) => ({
    file,
    relativePath: file.webkitRelativePath || file.name,
  }));
}
