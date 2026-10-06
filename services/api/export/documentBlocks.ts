import { headingNumbers } from "../../../packages/utils/headingNumbers";

/**
 * A document written in Bindersnap, as blocks a Word or PDF writer can lay out.
 *
 * **The stored file is ProseMirror JSON**, which is the right format for the
 * editor and the wrong one for anybody outside it: a surveyor handed
 * `code-of-conduct.json` has been handed nothing. Both exports read this model
 * rather than the JSON, so a heading, a list or a shaded cell means the same
 * thing in the .docx as in the PDF, and the two cannot drift apart.
 *
 * Read defensively. The JSON is whatever the editor saved, over every version
 * of the editor there has ever been, so an unknown node is kept as its text
 * rather than failing the export — a copy missing a flourish is better than no
 * copy at all.
 */

export interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  code?: boolean;
  superscript?: boolean;
  subscript?: boolean;
  link?: string;
  /** `#rrggbb`, when the author coloured the text. */
  color?: string;
  /** `#rrggbb`, when the author highlighted it. */
  highlight?: string;
  /** The CSS `font-family` the author picked, as the editor stored it. */
  font?: string;
  /** Points, when the author set a size. */
  size?: number;
  /** A line break inside the paragraph, not the end of it. */
  lineBreak?: boolean;
}

/** How a paragraph or heading is set, beyond its runs. */
export interface ParagraphFormat {
  align: Align;
  /** Steps of Indent, half an inch each, as Word's are. */
  indent: number;
  /** A multiple — 1.5 is one and a half lines — or null for the default. */
  lineSpacing: number | null;
}

export type Align = "left" | "center" | "right" | "justify";

export type Block =
  | ({
      kind: "heading";
      level: number;
      runs: Run[];
      /** "2.1" when the document numbers its sections. */
      number: string | null;
    } & ParagraphFormat)
  | ({ kind: "paragraph"; runs: Run[] } & ParagraphFormat)
  | {
      kind: "list";
      style: "bullet" | "ordered" | "task";
      /** For an ordered list: where the count starts. */
      start: number;
      items: ListItem[];
    }
  | { kind: "quote"; blocks: Block[] }
  | { kind: "code"; text: string }
  | { kind: "rule" }
  | { kind: "pageBreak" }
  | { kind: "table"; rows: TableCell[][] }
  | {
      kind: "image";
      /** Decoded from the data URL the editor embeds. Null when it is a link. */
      data: Uint8Array | null;
      mime: string;
      /** Pixels at 100%, when the author sized it. */
      width: number | null;
      alt: string;
      /** The alignment of the paragraph it sits in. */
      align: Align;
    }
  | {
      kind: "contents";
      /** As the editor lists them: "2.1 Checks" when sections are numbered. */
      entries: { level: number; text: string }[];
    };

export interface ListItem {
  blocks: Block[];
  /** For a task list: whether it is ticked. */
  checked?: boolean;
}

export interface TableCell {
  blocks: Block[];
  header: boolean;
  colspan: number;
  /** Pixels, per column it spans, when the author dragged it to a width. */
  colwidth: (number | null)[] | null;
  /** `#rrggbb`, when the cell is shaded. */
  shade: string | null;
}

interface PmNode {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: PmNode[];
  text?: string;
  marks?: { type?: string; attrs?: Record<string, unknown> }[];
}

const HEX = /^#[0-9a-f]{6}$/i;

/** A colour the writers can use, from whatever CSS the editor stored. */
export function normalizeColor(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (HEX.test(trimmed)) return trimmed.toLowerCase();
  const short = trimmed.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);
  if (short) {
    return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase();
  }
  const rgb = trimmed.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgb) {
    return `#${[rgb[1], rgb[2], rgb[3]]
      .map((part) => Math.min(255, Number(part)).toString(16).padStart(2, "0"))
      .join("")}`;
  }
  return undefined;
}

function alignOf(node: PmNode): Align {
  const value = node.attrs?.textAlign;
  return value === "center" || value === "right" || value === "justify"
    ? value
    : "left";
}

/** Word's line-spacing menu, which is all the editor offers. */
const LINE_SPACINGS = new Set(["1", "1.15", "1.5", "2", "2.5", "3"]);

function formatOf(node: PmNode): ParagraphFormat {
  const indent = Math.round(Number(node.attrs?.indent ?? 0));
  const spacing = node.attrs?.lineSpacing;
  return {
    align: alignOf(node),
    indent: Number.isFinite(indent) ? Math.min(8, Math.max(0, indent)) : 0,
    lineSpacing:
      typeof spacing === "string" && LINE_SPACINGS.has(spacing)
        ? Number(spacing)
        : null,
  };
}

/**
 * Points out of a stored size: `12pt`, or `16px` from older documents — the
 * editor's own reading (`parseFontSizePt` in the ribbon's options).
 */
export function parseFontSize(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const match = value.trim().match(/^(\d+(?:\.\d+)?)(pt|px)$/);
  if (!match) return undefined;
  const amount = Number(match[1]);
  if (!(amount > 0)) return undefined;
  return match[2] === "px" ? Math.round(amount * 0.75 * 2) / 2 : amount;
}

/** Every piece of text under a node, joined — for headings in the contents. */
export function plainText(node: PmNode): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return " ";
  return (node.content ?? []).map(plainText).join("");
}

function runsOf(node: PmNode): Run[] {
  const runs: Run[] = [];
  for (const child of node.content ?? []) {
    if (child.type === "hardBreak") {
      runs.push({ text: "", lineBreak: true });
      continue;
    }
    if (child.type === "text") {
      const run: Run = { text: child.text ?? "" };
      for (const mark of child.marks ?? []) {
        switch (mark.type) {
          case "bold":
            run.bold = true;
            break;
          case "italic":
            run.italic = true;
            break;
          case "underline":
            run.underline = true;
            break;
          case "strike":
            run.strike = true;
            break;
          case "code":
            run.code = true;
            break;
          case "superscript":
            run.superscript = true;
            break;
          case "subscript":
            run.subscript = true;
            break;
          case "link":
            if (typeof mark.attrs?.href === "string")
              run.link = mark.attrs.href;
            break;
          case "textStyle": {
            const color = normalizeColor(mark.attrs?.color);
            if (color) run.color = color;
            const family = mark.attrs?.fontFamily;
            if (typeof family === "string" && family.trim()) run.font = family;
            const size = parseFontSize(mark.attrs?.fontSize);
            if (size) run.size = size;
            break;
          }
          case "highlight":
            // A <mark> with no colour is the browser's yellow.
            run.highlight = normalizeColor(mark.attrs?.color) ?? "#ffff00";
            break;
        }
      }
      runs.push(run);
      continue;
    }
    // An inline node the writers do not know — keep what it says.
    const text = plainText(child);
    if (text) runs.push({ text });
  }
  return runs;
}

function decodeDataUrl(src: string): { data: Uint8Array; mime: string } | null {
  const match = src.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (!match) return null;
  const mime = match[1] ?? "application/octet-stream";
  const payload = match[3] ?? "";
  const data = match[2]
    ? Uint8Array.from(Buffer.from(payload, "base64"))
    : new TextEncoder().encode(decodeURIComponent(payload));
  return { data, mime };
}

function imageOf(node: PmNode, align: Align = "left"): Block {
  const src = typeof node.attrs?.src === "string" ? node.attrs.src : "";
  const decoded = decodeDataUrl(src);
  const width = Number(node.attrs?.width);
  return {
    kind: "image",
    data: decoded?.data ?? null,
    mime: decoded?.mime ?? "",
    width: Number.isFinite(width) && width > 0 ? width : null,
    alt: typeof node.attrs?.alt === "string" ? node.attrs.alt : "",
    align,
  };
}

function blocksOf(
  nodes: PmNode[] | undefined,
  numbers: Map<PmNode, string | null>,
): Block[] {
  const blocks: Block[] = [];
  for (const node of nodes ?? []) {
    switch (node.type) {
      case "heading":
        blocks.push({
          kind: "heading",
          level: Math.min(6, Math.max(1, Number(node.attrs?.level) || 1)),
          runs: runsOf(node),
          number: numbers.get(node) ?? null,
          ...formatOf(node),
        });
        break;
      case "paragraph": {
        // Pictures are inline in the editor; a paragraph holding only a
        // picture is a picture to both writers.
        const images = (node.content ?? []).filter(
          (child) => child.type === "image",
        );
        const rest = (node.content ?? []).filter(
          (child) => child.type !== "image",
        );
        if (rest.length > 0 || images.length === 0) {
          blocks.push({
            kind: "paragraph",
            runs: runsOf({ ...node, content: rest }),
            ...formatOf(node),
          });
        }
        for (const image of images) blocks.push(imageOf(image, alignOf(node)));
        break;
      }
      case "image":
        blocks.push(imageOf(node));
        break;
      case "bulletList":
      case "orderedList":
      case "taskList":
        blocks.push({
          kind: "list",
          style:
            node.type === "orderedList"
              ? "ordered"
              : node.type === "taskList"
                ? "task"
                : "bullet",
          start: Number(node.attrs?.start) || 1,
          items: (node.content ?? []).map((item) => ({
            blocks: blocksOf(item.content, numbers),
            ...(node.type === "taskList"
              ? { checked: item.attrs?.checked === true }
              : {}),
          })),
        });
        break;
      case "blockquote":
        blocks.push({ kind: "quote", blocks: blocksOf(node.content, numbers) });
        break;
      case "codeBlock":
        blocks.push({ kind: "code", text: plainText(node) });
        break;
      case "horizontalRule":
        blocks.push({ kind: "rule" });
        break;
      case "pageBreak":
        blocks.push({ kind: "pageBreak" });
        break;
      case "table":
        blocks.push({
          kind: "table",
          rows: (node.content ?? []).map((row) =>
            (row.content ?? []).map((cell) => ({
              blocks: blocksOf(cell.content, numbers),
              header: cell.type === "tableHeader",
              colspan: Math.max(1, Number(cell.attrs?.colspan) || 1),
              colwidth: Array.isArray(cell.attrs?.colwidth)
                ? (cell.attrs.colwidth as unknown[]).map((width) =>
                    typeof width === "number" && width > 0 ? width : null,
                  )
                : null,
              shade: normalizeColor(cell.attrs?.background) ?? null,
            })),
          ),
        });
        break;
      case "tableOfContents":
        // The list the editor stored is the list the author saw. One that
        // is missing is filled in once every heading is known — see
        // `documentBlocks`.
        blocks.push({ kind: "contents", entries: storedEntries(node) });
        break;
      default: {
        const text = plainText(node);
        if (text)
          blocks.push({
            kind: "paragraph",
            runs: [{ text }],
            align: "left",
            indent: 0,
            lineSpacing: null,
          });
      }
    }
  }
  return blocks;
}

/** A contents block's entries as stored, made safe to draw. */
function storedEntries(node: PmNode): { level: number; text: string }[] {
  const value = node.attrs?.entries;
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const { level, text } = item as { level?: unknown; text?: unknown };
    if (typeof text !== "string" || text.trim() === "") return [];
    const n = Math.round(Number(level));
    return [
      { level: Number.isFinite(n) ? Math.min(3, Math.max(1, n)) : 1, text },
    ];
  });
}

function collectHeadings(node: PmNode, into: PmNode[]): void {
  if (node.type === "heading") into.push(node);
  for (const child of node.content ?? []) collectHeadings(child, into);
}

/** Parse the stored JSON, or null when the file is not a Bindersnap document. */
export function parseDocumentJson(text: string): PmNode | null {
  try {
    const parsed = JSON.parse(text) as PmNode;
    return parsed && parsed.type === "doc" ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * The document's blocks, with its sections numbered and its contents filled in
 * the way the editor draws them.
 */
export function documentBlocks(doc: PmNode): Block[] {
  const headings: PmNode[] = [];
  collectHeadings(doc, headings);
  const numbered = doc.attrs?.numberedHeadings === true;
  const labels = numbered
    ? headingNumbers(
        headings.map((heading) => Number(heading.attrs?.level) || 1),
      )
    : headings.map(() => null);
  const numbers = new Map<PmNode, string | null>(
    headings.map((heading, index) => [heading, labels[index] ?? null]),
  );

  // What the editor would list, for a contents block saved without its
  // entries: "2.1 Checks", as `contentsEntries` writes them.
  const entries = headings
    .map((heading, index) => {
      const text = plainText(heading).trim();
      const number = labels[index];
      return {
        level: Number(heading.attrs?.level) || 1,
        text: number ? `${number} ${text}` : text,
        empty: text === "",
      };
    })
    .filter((entry) => !entry.empty && entry.level <= 3)
    .map(({ level, text }) => ({ level, text }));

  const fill = (blocks: Block[]): Block[] =>
    blocks.map((block) => {
      if (block.kind === "contents")
        return block.entries.length > 0 ? block : { ...block, entries };
      if (block.kind === "quote")
        return { ...block, blocks: fill(block.blocks) };
      if (block.kind === "list") {
        return {
          ...block,
          items: block.items.map((item) => ({
            ...item,
            blocks: fill(item.blocks),
          })),
        };
      }
      if (block.kind === "table") {
        return {
          ...block,
          rows: block.rows.map((row) =>
            row.map((cell) => ({ ...cell, blocks: fill(cell.blocks) })),
          ),
        };
      }
      return block;
    });

  return fill(blocksOf(doc.content, numbers));
}
