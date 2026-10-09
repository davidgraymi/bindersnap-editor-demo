import { rgb } from "pdf-lib";

import type { Block, Run } from "./documentBlocks";
import { faceForFamily, type FaceKey } from "./fonts";
import {
  MARGIN,
  PdfWriter,
  TASK_TEXT_OFFSET,
  TEXT_WIDTH,
  type Rgb,
  type TableCellInput,
  type TextStyle,
} from "./pdfLayout";

/**
 * A document as a PDF: the page its author wrote, on paper.
 *
 * **Nothing is added.** No running header, no page numbers, no title the
 * author did not type: a copy that says more than the document did is a
 * different document. Every measure here is the editor's own — the sheet,
 * the fonts, the sizes, the spacing and the colours in
 * `packages/editor/assets/document-editor.css` — so the PDF is what printing
 * the page from the editor gives, and what the reviewers approved.
 */

const hex = (value: string): Rgb => [
  parseInt(value.slice(1, 3), 16) / 255,
  parseInt(value.slice(3, 5), 16) / 255,
  parseInt(value.slice(5, 7), 16) / 255,
];

// The editor's tokens, as the page draws them on white paper.
const INK = hex("#1c1917"); // --brand-mockup-ink
const INK_SOFT = hex("#44403c"); // --brand-mockup-ink-soft
const MUTED = hex("#78716c"); // --brand-mockup-muted
const FAINT = hex("#a8a29e"); // --brand-mockup-faint: table borders
const PANEL = hex("#f5f0e8"); // --brand-mockup-bg-alt: code, header cells
const RULE = hex("#e8e8e8"); // --brand-mockup-rule, 10% ink on white
const LINK = hex("#1d4ed8"); // --bs-status-info-fg

const PT_PER_IN = 72;
/** `.bs-doc-content`: 11pt, line-height 1.15. */
const BODY_SIZE = 11;
const BODY_LINE = 1.15;
/** `p { margin: 0 0 8pt }`. */
const PARAGRAPH_AFTER = 8;
/** h1–h6. Lora to h3, Geist below; all semibold, line-height 1.2. */
const HEADING_SIZES = [20, 16, 13, 11, 11, 11];
/** `ul, ol { padding-left: 0.35in }`. */
const LIST_INDENT = 0.35 * PT_PER_IN;
/** A task's checkbox and the half-em gap after it. */
const TASK_INDENT = TASK_TEXT_OFFSET;
/** `blockquote { padding-left: 0.2in; border-left: 3px }`. */
const QUOTE_RULE = 2.25;
const QUOTE_INDENT = 0.2 * PT_PER_IN + QUOTE_RULE;
/** One step of Indent, as Word's. */
const INDENT_STEP = 0.5 * PT_PER_IN;
/** A browser's bullets, by how deep the list is. */
const BULLETS = ["•", "◦", "▪"];

interface Context {
  /** From the left margin to where text starts, in points. */
  indent: number;
  /** Inside a quotation. */
  italic: boolean;
  color: Rgb;
  /** A paragraph's bottom margin here. `li > p` is 2pt; elsewhere 8pt. */
  paragraphAfter: number;
  /** How many lists this is inside. */
  lists: number;
}

function body(context: Context): TextStyle {
  return {
    size: BODY_SIZE,
    face: "geist",
    codeFace: "geistMono",
    codeFill: PANEL,
    lineHeight: BODY_LINE,
    color: context.color,
    linkColor: LINK,
    italic: context.italic,
    indent: context.indent,
  };
}

/** The space an image line keeps under its baseline, as the page's does. */
function descentBelow(writer: PdfWriter): number {
  const { font } = writer.resolve("geist", 400, false);
  const { ascent, descent } = writer.metrics(font);
  const box = BODY_SIZE * BODY_LINE;
  const content = (ascent + descent) * BODY_SIZE;
  return box - ((box - content) / 2 + ascent * BODY_SIZE);
}

/** Runs a table cell holds, as its paragraphs. */
function cellParagraphs(
  blocks: Block[],
  italic: boolean,
): NonNullable<TableCellInput["paragraphs"]> {
  const out: NonNullable<TableCellInput["paragraphs"]> = [];
  const italicise = (runs: Run[]) =>
    italic ? runs.map((run) => ({ ...run, italic: true })) : runs;
  for (const block of blocks) {
    switch (block.kind) {
      case "paragraph":
        out.push({
          runs: italicise(block.runs),
          style: {
            align: block.align,
            lineHeight: block.lineSpacing ?? BODY_LINE,
          },
        });
        break;
      case "heading":
        out.push({
          runs: italicise(block.runs),
          style: {
            face: block.level <= 3 ? "lora" : "geist",
            size: HEADING_SIZES[block.level - 1] ?? BODY_SIZE,
            weight: 600,
            lineHeight: block.lineSpacing ?? 1.2,
            align: block.align,
          },
        });
        break;
      case "list": {
        let count = block.start;
        for (const item of block.items) {
          const marker =
            block.style === "ordered"
              ? `${count}. `
              : block.style === "task"
                ? item.checked
                  ? "☑ "
                  : "☐ "
                : "• ";
          count += 1;
          const inner = cellParagraphs(item.blocks, italic);
          const [first, ...rest] = inner;
          out.push({
            runs: [{ text: marker }, ...(first?.runs ?? [])],
            style: first?.style,
          });
          out.push(...rest);
        }
        break;
      }
      case "quote":
        out.push(...cellParagraphs(block.blocks, true));
        break;
      case "code":
        for (const line of block.text.split("\n"))
          out.push({ runs: [{ text: line || " ", code: true }] });
        break;
      case "image":
        out.push({
          runs: [{ text: `[Picture${block.alt ? `: ${block.alt}` : ""}]` }],
        });
        break;
      default:
        break;
    }
  }
  return out.length > 0 ? out : [{ runs: [] }];
}

/**
 * Each column's share of the table, as the page sizes it: a column the author
 * dragged keeps its width, and the rest share what is left.
 */
export function columnShares(
  rows: Extract<Block, { kind: "table" }>["rows"],
  available: number,
): { shares: number[]; width: number } {
  const columns = Math.max(
    1,
    ...rows.map((row) => row.reduce((sum, cell) => sum + cell.colspan, 0)),
  );
  const widths: (number | null)[] = [];
  for (const cell of rows[0] ?? []) {
    for (let index = 0; index < cell.colspan; index += 1) {
      const px = cell.colwidth?.[index] ?? null;
      widths.push(px ? (px * 72) / 96 : null);
    }
  }
  while (widths.length < columns) widths.push(null);
  widths.length = columns;

  const fixed = widths.reduce<number>((sum, width) => sum + (width ?? 0), 0);
  const open = widths.filter((width) => width === null).length;
  if (open === 0) {
    // Every column sized: the table is as wide as its columns, and no wider
    // than the page.
    const width = Math.min(fixed, available);
    return { shares: widths.map((w) => (w ?? 0) / fixed), width };
  }
  const rest = Math.max(0, available - fixed);
  const resolved = widths.map((width) => width ?? rest / open);
  const total = resolved.reduce((sum, width) => sum + width, 0);
  return {
    shares: resolved.map((width) => width / total),
    width: available,
  };
}

async function render(
  writer: PdfWriter,
  blocks: Block[],
  context: Context,
): Promise<void> {
  for (const block of blocks) {
    switch (block.kind) {
      case "heading": {
        const runs: Run[] = block.number
          ? [{ text: `${block.number}  ` }, ...block.runs]
          : block.runs;
        writer.text(runs, {
          ...body(context),
          face: block.level <= 3 ? "lora" : "geist",
          size: HEADING_SIZES[block.level - 1] ?? BODY_SIZE,
          weight: 600,
          lineHeight: block.lineSpacing ?? 1.2,
          align: block.align,
          indent: context.indent + block.indent * INDENT_STEP,
          spaceBefore: 12,
          spaceAfter: 6,
          // `break-after: avoid`, as the editor prints: never the last
          // thing on a page.
          keepWithNext: 6 + BODY_SIZE * BODY_LINE,
        });
        break;
      }
      case "paragraph":
        writer.text(block.runs, {
          ...body(context),
          align: block.align,
          lineHeight: block.lineSpacing ?? BODY_LINE,
          indent: context.indent + block.indent * INDENT_STEP,
          spaceAfter: context.paragraphAfter,
        });
        break;
      case "list": {
        writer.gap(0);
        const task = block.style === "task";
        const inner: Context = {
          ...context,
          indent: context.indent + (task ? TASK_INDENT : LIST_INDENT),
          // A task's paragraphs sit in a <div>, so `li > p` does not reach
          // them and they keep the full 8pt.
          paragraphAfter: task ? PARAGRAPH_AFTER : 2,
          lists: context.lists + 1,
        };
        let count = block.start;
        for (const item of block.items) {
          const marker =
            block.style === "ordered"
              ? `${count}.`
              : task
                ? undefined
                : BULLETS[Math.min(context.lists, BULLETS.length - 1)];
          count += 1;
          const [first, ...rest] = item.blocks;
          const lead: Partial<TextStyle> = task
            ? { checkbox: item.checked === true }
            : { marker };
          if (first && first.kind === "paragraph") {
            writer.text(first.runs, {
              ...body(inner),
              align: first.align,
              lineHeight: first.lineSpacing ?? BODY_LINE,
              indent: inner.indent + first.indent * INDENT_STEP,
              spaceAfter: inner.paragraphAfter,
              ...lead,
            });
            await render(writer, rest, inner);
          } else {
            writer.text([{ text: "" }], { ...body(inner), ...lead });
            await render(writer, item.blocks, inner);
          }
          // A task is a flex box: its paragraph's margin stays inside it
          // rather than collapsing into the list's.
          if (task) writer.gap(0);
        }
        writer.after(PARAGRAPH_AFTER);
        break;
      }
      case "quote": {
        writer.gap(0);
        const from = writer.mark();
        await render(writer, block.blocks, {
          ...context,
          indent: context.indent + QUOTE_INDENT,
          italic: true,
          color: INK_SOFT,
          paragraphAfter: PARAGRAPH_AFTER,
        });
        const to = writer.mark();
        const x = MARGIN + context.indent + QUOTE_RULE / 2;
        writer.decorate(from, to, (page, top, bottom) =>
          page.drawLine({
            start: { x, y: top },
            end: { x, y: bottom },
            thickness: QUOTE_RULE,
            color: rgb(...RULE),
          }),
        );
        writer.after(PARAGRAPH_AFTER);
        break;
      }
      case "code":
        writer.codeBlock(block.text, {
          ...body(context),
          face: "geistMono",
          size: BODY_SIZE * 0.92,
          // Measured off Chromium's print: a code line is its font's full
          // height, 13pt, whatever the paragraph's 1.15 says.
          lineHeight: 1.3,
          fill: PANEL,
          // `pre { padding: 0.12in 0.16in }`.
          padX: 0.16 * PT_PER_IN,
          padY: 0.12 * PT_PER_IN,
          spaceAfter: PARAGRAPH_AFTER,
        });
        break;
      case "rule":
        writer.rule({
          spaceBefore: 12,
          spaceAfter: 12,
          thickness: 0.75,
          color: RULE,
          indent: context.indent,
        });
        break;
      case "pageBreak":
        writer.gap(0);
        writer.newPage(true);
        break;
      case "image":
        await writer.picture(block.data, block.width, block.alt, {
          indent: context.indent,
          align: block.align,
          below: descentBelow(writer),
          spaceAfter: context.paragraphAfter,
          placeholder: { ...body(context), italic: true, color: MUTED },
        });
        break;
      case "contents": {
        // `.bs-toc`: a rule above and below, 6pt inside them, 12pt after.
        const rule = { thickness: 0.75, color: RULE, indent: context.indent };
        writer.rule({ ...rule, spaceBefore: 0, spaceAfter: 0 });
        writer.space(6);
        writer.text([{ text: "Contents" }], {
          ...body(context),
          size: 13,
          weight: 600,
          spaceAfter: 4,
        });
        if (block.entries.length === 0) {
          writer.text(
            [
              {
                text: "No headings yet. Text styled Heading 1, 2 or 3 is listed here.",
              },
            ],
            { ...body(context), italic: true, color: MUTED },
          );
        }
        for (const entry of block.entries) {
          // `padding-block: 1pt`, which does not collapse as margins do.
          writer.gap(0);
          writer.space(1);
          writer.text([{ text: entry.text }], {
            ...body(context),
            indent: context.indent + (entry.level - 1) * 0.25 * PT_PER_IN,
          });
          writer.space(1);
        }
        writer.space(6);
        writer.rule({ ...rule, spaceBefore: 0, spaceAfter: 12 });
        break;
      }
      case "table": {
        const { shares, width } = columnShares(
          block.rows,
          TEXT_WIDTH - context.indent,
        );
        writer.table(
          block.rows.map((row) =>
            row.map((cell) => ({
              paragraphs: cellParagraphs(cell.blocks, context.italic),
              header: cell.header,
              shade: cell.shade,
              colspan: cell.colspan,
            })),
          ),
          {
            size: BODY_SIZE,
            face: "geist",
            lineHeight: BODY_LINE,
            color: context.color,
            text: {
              codeFace: "geistMono",
              codeFill: PANEL,
              linkColor: LINK,
            },
            widths: shares,
            width,
            indent: context.indent,
            // `th, td { padding: 4pt 6pt; border: 1px solid }`.
            padX: 6,
            padY: 4,
            borderColor: FAINT,
            borderWidth: 0.75,
            headerFill: PANEL,
            headerWeight: 600,
            // The page has no <thead>, so a header row is printed once.
            repeatHeader: false,
            spaceAfter: PARAGRAPH_AFTER,
          },
        );
        break;
      }
    }
  }
}

/** Every typeface the document uses, so each is embedded once, up front. */
export function facesUsed(blocks: Block[]): FaceKey[] {
  const faces = new Set<FaceKey>(["geist"]);
  const runs = (list: Run[]) => {
    for (const run of list) {
      if (run.code) faces.add("geistMono");
      const face = faceForFamily(run.font);
      if (face) faces.add(face);
    }
  };
  const walk = (list: Block[]) => {
    for (const block of list) {
      switch (block.kind) {
        case "heading":
          if (block.level <= 3) faces.add("lora");
          runs(block.runs);
          break;
        case "paragraph":
          runs(block.runs);
          break;
        case "list":
          for (const item of block.items) walk(item.blocks);
          break;
        case "quote":
          walk(block.blocks);
          break;
        case "code":
          faces.add("geistMono");
          break;
        case "table":
          for (const row of block.rows)
            for (const cell of row) walk(cell.blocks);
          break;
        default:
          break;
      }
    }
  };
  walk(blocks);
  return [...faces];
}

export async function documentToPdf(
  blocks: Block[],
  meta: { title: string },
): Promise<Uint8Array> {
  const writer = await PdfWriter.create({
    title: meta.title,
    faces: facesUsed(blocks),
  });
  await render(writer, blocks, {
    indent: 0,
    italic: false,
    color: INK,
    paragraphAfter: PARAGRAPH_AFTER,
    lists: 0,
  });
  return writer.save();
}
