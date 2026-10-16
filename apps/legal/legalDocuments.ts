import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The legal pages: what a customer agrees to, and what we promise back.
 *
 * The words are Markdown in `documents/`, one file each, so a lawyer can read
 * and redline them as text and a change to them is a reviewable diff. Each
 * file opens with its title, then `Last updated:` and `Version:` lines, which
 * the page shows under the title.
 */

export interface LegalDocumentEntry {
  slug: string;
  /** What the index card says the document is for. */
  summary: string;
}

/** In the order the index and the side navigation list them. */
export const LEGAL_DOCUMENTS: readonly LegalDocumentEntry[] = [
  {
    slug: "terms",
    summary: "The agreement between your organization and Bindersnap.",
  },
  {
    slug: "privacy",
    summary: "What we collect, why, who else sees it, and your rights.",
  },
  {
    slug: "dpa",
    summary: "How we process the personal data in your binders on your behalf.",
  },
  {
    slug: "subprocessors",
    summary: "Every company that handles data for us, and what for.",
  },
  {
    slug: "security",
    summary: "How we host, encrypt, back up and guard your binders.",
  },
];

export interface LegalDocument extends LegalDocumentEntry {
  title: string;
  lastUpdated: string;
  version: string;
  /** The Markdown after the title and the date lines. */
  body: string;
}

const DOCUMENTS_DIR = join(import.meta.dir, "documents");

/** Split a document's opening lines from its body. Throws on a malformed file. */
export function parseLegalDocument(
  entry: LegalDocumentEntry,
  source: string,
): LegalDocument {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const title = lines[0]?.match(/^#\s+(.+)$/)?.[1]?.trim();
  let lastUpdated = "";
  let version = "";
  let index = 1;
  for (; index < lines.length; index += 1) {
    const line = lines[index]!.trim();
    if (line === "") continue;
    const updated = line.match(/^Last updated:\s*(.+)$/);
    const stamped = line.match(/^Version:\s*(.+)$/);
    if (updated) lastUpdated = updated[1]!.trim();
    else if (stamped) version = stamped[1]!.trim();
    else break;
  }
  if (!title || !lastUpdated || !version) {
    throw new Error(
      `apps/legal/documents/${entry.slug}.md must open with "# Title", "Last updated:" and "Version:"`,
    );
  }
  return {
    ...entry,
    title,
    lastUpdated,
    version,
    body: lines.slice(index).join("\n").trim(),
  };
}

export function readLegalDocuments(): LegalDocument[] {
  return LEGAL_DOCUMENTS.map((entry) =>
    parseLegalDocument(
      entry,
      readFileSync(join(DOCUMENTS_DIR, `${entry.slug}.md`), "utf8"),
    ),
  );
}
