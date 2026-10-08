import { documentToDocx } from "../../services/api/export/documentDocx";
import { documentBlocks } from "../../services/api/export/documentBlocks";
import type { SitePage } from "./siteContent";

/**
 * A template page's policy as a document of Bindersnap's own, and as the Word
 * file people download from the page.
 *
 * The template is the Markdown under the page's "## The template" heading. It
 * is turned into the editor's ProseMirror JSON, the format a policy written in
 * Bindersnap is stored in, and that JSON goes through the same Word writer
 * every exported document does (`services/api/export`). So the downloaded
 * file is set in the editor's fonts and spacing, as a customer's own export
 * would be, and the same JSON can later be put straight into a binder. The one
 * thing added is the page's notice, at the top (`templateNote`).
 *
 * Only what the templates use is read: headings, paragraphs, bullet and
 * numbered lists, tables, and bold, italic and links inside them.
 */

interface PmMark {
  type: string;
  attrs?: Record<string, unknown>;
}

interface PmNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PmNode[];
  text?: string;
  marks?: PmMark[];
}

const TEMPLATE_HEADING = /^##\s+The template\s*$/m;

/** The Markdown of the policy itself, or null when the page has none. */
export function templateMarkdown(page: SitePage): string | null {
  const start = page.body.search(TEMPLATE_HEADING);
  if (start === -1) return null;
  const rest = page.body.slice(start).split("\n").slice(1);
  const end = rest.findIndex((line) => /^##\s/.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n").trim();
}

/** `**bold**`, `*italic*` and `[text](url)` as text nodes with marks. */
export function inlineNodes(source: string): PmNode[] {
  const nodes: PmNode[] = [];
  const pattern = /\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  const push = (text: string, marks?: PmMark[]) => {
    if (!text) return;
    nodes.push(
      marks?.length ? { type: "text", text, marks } : { type: "text", text },
    );
  };
  for (const match of source.matchAll(pattern)) {
    push(source.slice(last, match.index));
    if (match[1] !== undefined) push(match[1], [{ type: "bold" }]);
    else if (match[2] !== undefined) push(match[2], [{ type: "italic" }]);
    else {
      const href = match[4]!.startsWith("/")
        ? `https://bindersnap.com${match[4]}`
        : match[4]!;
      push(match[3]!, [{ type: "link", attrs: { href } }]);
    }
    last = match.index! + match[0].length;
  }
  push(source.slice(last));
  return nodes;
}

function paragraph(text: string): PmNode {
  const content = inlineNodes(text.trim());
  return content.length
    ? { type: "paragraph", content }
    : { type: "paragraph" };
}

function cells(line: string): string[] {
  return line
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

/**
 * The template's Markdown as an editor document. Its first heading is the
 * policy's title (Heading 1); the headings under it are its sections
 * (Heading 2).
 */
export function markdownToDocument(markdown: string): PmNode {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const content: PmNode[] = [];
  let sawTitle = false;
  let index = 0;

  while (index < lines.length) {
    const line = lines[index]!;
    if (line.trim() === "") {
      index += 1;
      continue;
    }

    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading) {
      content.push({
        type: "heading",
        attrs: { level: sawTitle ? 2 : 1 },
        content: inlineNodes(heading[1]!.trim()),
      });
      sawTitle = true;
      index += 1;
      continue;
    }

    if (
      /^\s*\|/.test(line) &&
      /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[index + 1] ?? "")
    ) {
      const head = cells(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && /^\s*\|/.test(lines[index]!)) {
        rows.push(cells(lines[index]!));
        index += 1;
      }
      const row = (values: string[], type: "tableHeader" | "tableCell") => ({
        type: "tableRow",
        content: head.map((_, column) => ({
          type,
          content: [paragraph(values[column] ?? "")],
        })),
      });
      content.push({
        type: "table",
        content: [
          row(head, "tableHeader"),
          ...rows.map((r) => row(r, "tableCell")),
        ],
      });
      continue;
    }

    const bullet = /^\s*[-*+]\s+(.*)$/;
    const numbered = /^\s*\d+[.)]\s+(.*)$/;
    const listMatch = line.match(bullet) ?? line.match(numbered);
    if (listMatch) {
      const ordered = numbered.test(line);
      const pattern = ordered ? numbered : bullet;
      const items: PmNode[] = [];
      while (index < lines.length && pattern.test(lines[index]!)) {
        items.push({
          type: "listItem",
          content: [paragraph(lines[index]!.match(pattern)![1]!)],
        });
        index += 1;
      }
      content.push({
        type: ordered ? "orderedList" : "bulletList",
        ...(ordered ? { attrs: { start: 1 } } : {}),
        content: items,
      });
      continue;
    }

    // A paragraph runs until a blank line or the start of another block.
    const text: string[] = [];
    while (
      index < lines.length &&
      lines[index]!.trim() !== "" &&
      !/^(#{1,6}\s|\s*[-*+]\s|\s*\d+[.)]\s|\s*\|)/.test(lines[index]!)
    ) {
      text.push(lines[index]!.trim());
      index += 1;
    }
    content.push(paragraph(text.join(" ")));
  }

  return { type: "doc", content };
}

/**
 * The page's notice, said again at the top of the file, since a downloaded
 * file travels without its page. It is the one thing a template's Word file
 * adds, and it asks to be deleted before the policy is adopted.
 */
export function templateNote(page: SitePage): string | null {
  const notice = page.collection.notice;
  if (!notice) return null;
  return `Template from bindersnap.com${page.path}. ${notice} Delete this note before you adopt the policy.`;
}

/** The template as an editor document, opening with its note. */
export function templateDocument(page: SitePage): PmNode | null {
  const markdown = templateMarkdown(page);
  if (!markdown) return null;
  const doc = markdownToDocument(markdown);
  const note = templateNote(page);
  if (!note) return doc;
  return {
    ...doc,
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: note, marks: [{ type: "italic" }] }],
      },
      ...(doc.content ?? []),
    ],
  };
}

/** The template as a Word file, or null when the page has no template. */
export async function templateDocx(page: SitePage): Promise<Uint8Array | null> {
  const doc = templateDocument(page);
  if (!doc) return null;
  return documentToDocx(documentBlocks(doc), { title: page.title });
}

/** Where a template page's Word file is served. */
export function templateDocxHref(page: SitePage): string {
  return `${page.path}.docx`;
}

/** Every template's Word file, by the path it is served at. */
export async function templateFiles(
  pages: readonly SitePage[],
): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();
  for (const page of pages) {
    if (page.collection.key !== "templates") continue;
    const bytes = await templateDocx(page);
    if (bytes) files.set(templateDocxHref(page), bytes);
  }
  return files;
}
