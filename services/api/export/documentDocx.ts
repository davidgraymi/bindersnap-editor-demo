import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  LineRuleType,
  Packer,
  PageBreak,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  WidthType,
  type IParagraphOptions,
  type ParagraphChild,
} from "docx";

import type { Align, Block, Run } from "./documentBlocks";
import { pictureSize, readPicture } from "./images";
import { embedFonts } from "./docxFonts";
import { faceForFamily, wordFontForFamily, type FaceKey } from "./fonts";

/**
 * A document as a Word document: the page its author wrote, to keep working on.
 *
 * **Set as the editor sets it.** Geist at 11pt, headings in Lora, the same
 * spacing, indents, colours and rules — and nothing added: no header, no
 * footer, no page numbers the author did not put there. Geist and Lora are
 * embedded, because Word does not have them (`docxFonts.ts`).
 *
 * Headings are Word's own Heading 1–6, so its navigation pane and its own
 * table of contents work on the file as on anything written in Word.
 */

/** Letter, one-inch margins: 6.5 inches of text. */
const TEXT_WIDTH_PT = 468;
const TWIPS = 20;

const INK = "1C1917";
const INK_SOFT = "44403C";
const MUTED = "78716C";
const FAINT = "A8A29E";
const PANEL = "F5F0E8";
const RULE = "E8E8E8";
const LINK = "1D4ED8";

const BODY_SIZE = 11;
const BODY_LINE = 1.15;
const HEADING_SIZES = [20, 16, 13, 11, 11, 11];
const PARAGRAPH_AFTER = 8;
const LIST_INDENT_PT = 0.35 * 72;
const QUOTE_RULE_PT = 2.25;
/** From a task's checkbox to its text, as the page prints it. */
const TASK_TEXT_PT = 15.8;
const QUOTE_PAD_PT = 0.2 * 72;

/**
 * A font's "single" line, as a multiple of its size: its ascent, descent and
 * line gap. Word's line spacing multiplies this; CSS's multiplies the size.
 * So the page's 1.15 is 1.15 ÷ 1.3 of a Geist line in Word.
 */
const SINGLE_LINE: Record<FaceKey, number> = {
  geist: 1.3,
  geistMono: 1.3,
  lora: 1.28,
  helvetica: 1.15,
  times: 1.15,
  courier: 1.133,
  carlito: 1.221,
  caladea: 1.15,
  gelasio: 1.27,
  ebGaramond: 1.305,
  vera: 1.164,
};

function wordLine(css: number, face: FaceKey): number {
  return Math.round((240 * css) / SINGLE_LINE[face]);
}

const ALIGN = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
} satisfies Record<Align, (typeof AlignmentType)[keyof typeof AlignmentType]>;

const hex = (color: string) => color.replace("#", "").toUpperCase();
const twips = (points: number) => Math.round(points * TWIPS);

/** Everything the runs of one paragraph share. */
interface RunBase {
  font: string;
  size: number;
  color: string;
  italic: boolean;
}

interface Context {
  /** From the left margin, in points. */
  indent: number;
  italic: boolean;
  color: string;
  paragraphAfter: number;
  lists: number;
  /** Paragraph borders inside a quotation. */
  quote: { left: number } | null;
}

/** A block as Word will get it, with its CSS margins still to collapse. */
type Spec =
  | {
      kind: "paragraph";
      options: IParagraphOptions;
      /** CSS margins, in points. */
      top: number;
      bottom: number;
    }
  | { kind: "table"; table: Table; bottom: number };

class Writer {
  specs: Spec[] = [];
  /** Word fonts the document uses, so they can be embedded. */
  fonts = new Set<string>(["Geist"]);
  private lists = 0;
  private pageBreak = false;
  orderedStarts = new Set<number>();

  textRun(run: Run, base: RunBase): TextRun {
    const font = run.code
      ? "Geist Mono"
      : (wordFontForFamily(run.font) ?? base.font);
    this.fonts.add(font);
    const size = (run.size ?? base.size) * (run.code ? 0.92 : 1);
    const color = run.color ? hex(run.color) : run.link ? LINK : base.color;
    const fill = run.code ? PANEL : run.highlight ? hex(run.highlight) : null;
    return new TextRun({
      text: run.text,
      break: run.lineBreak ? 1 : undefined,
      bold: run.bold,
      italics: base.italic || run.italic,
      underline: run.underline || run.link ? {} : undefined,
      strike: run.strike,
      superScript: run.superscript,
      subScript: run.subscript,
      font: { ascii: font, hAnsi: font, cs: font, eastAsia: font },
      size: Math.round(size * 2),
      color,
      shading: fill
        ? { type: ShadingType.CLEAR, fill, color: "auto" }
        : undefined,
    });
  }

  children(runs: Run[], base: RunBase): ParagraphChild[] {
    return runs.map((run) =>
      run.link && !run.lineBreak
        ? new ExternalHyperlink({
            link: run.link,
            children: [this.textRun(run, base)],
          })
        : this.textRun(run, base),
    );
  }

  /** The face a paragraph's lines are measured in: its first text's. */
  private faceOf(runs: Run[], fallback: FaceKey): FaceKey {
    const first = runs.find((run) => run.text && !run.lineBreak);
    if (first?.code) return "geistMono";
    return faceForFamily(first?.font) ?? fallback;
  }

  paragraph(options: IParagraphOptions, top: number, bottom: number): void {
    const withBreak = this.pageBreak
      ? { ...options, pageBreakBefore: true }
      : options;
    this.pageBreak = false;
    this.specs.push({ kind: "paragraph", options: withBreak, top, bottom });
  }

  breakPage(): void {
    this.pageBreak = true;
  }

  /** A page break with nothing after it to carry it. */
  flushBreak(): void {
    if (!this.pageBreak) return;
    this.pageBreak = false;
    this.specs.push({
      kind: "paragraph",
      options: {
        children: [new PageBreak()],
        spacing: { line: 20, lineRule: LineRuleType.EXACT },
      },
      top: 0,
      bottom: 0,
    });
  }

  private border(context: Context) {
    return context.quote
      ? {
          left: {
            style: BorderStyle.SINGLE,
            size: Math.round(QUOTE_RULE_PT * 8),
            color: RULE,
            space: Math.round(QUOTE_PAD_PT),
          },
        }
      : undefined;
  }

  render(blocks: Block[], context: Context): void {
    for (const block of blocks) {
      switch (block.kind) {
        case "heading": {
          const face: FaceKey = block.level <= 3 ? "lora" : "geist";
          const font = block.level <= 3 ? "Lora SemiBold" : "Geist SemiBold";
          const base: RunBase = {
            font,
            size: HEADING_SIZES[block.level - 1] ?? BODY_SIZE,
            color: context.color,
            italic: context.italic,
          };
          this.fonts.add(font);
          this.paragraph(
            {
              heading: [
                HeadingLevel.HEADING_1,
                HeadingLevel.HEADING_2,
                HeadingLevel.HEADING_3,
                HeadingLevel.HEADING_4,
                HeadingLevel.HEADING_5,
                HeadingLevel.HEADING_6,
              ][block.level - 1],
              alignment: ALIGN[block.align],
              keepNext: true,
              indent: { left: twips(context.indent + block.indent * 36) },
              border: this.border(context),
              spacing: {
                line: wordLine(block.lineSpacing ?? 1.2, face),
                lineRule: LineRuleType.AUTO,
              },
              children: [
                ...(block.number
                  ? [this.textRun({ text: `${block.number}  ` }, base)]
                  : []),
                ...this.children(block.runs, base),
              ],
            },
            12,
            6,
          );
          break;
        }
        case "paragraph":
          this.paragraph(
            this.paragraphOptions(block, context),
            0,
            context.paragraphAfter,
          );
          break;
        case "list":
          this.list(block, context);
          break;
        case "quote":
          this.render(block.blocks, {
            ...context,
            indent: context.indent + QUOTE_RULE_PT + QUOTE_PAD_PT,
            italic: true,
            color: INK_SOFT,
            paragraphAfter: PARAGRAPH_AFTER,
            quote: { left: context.indent },
          });
          this.bumpLast(PARAGRAPH_AFTER);
          break;
        case "code": {
          const lines = block.text.split("\n");
          const pad = (space: number) => ({
            style: BorderStyle.SINGLE,
            size: 2,
            color: PANEL,
            space,
          });
          lines.forEach((line, index) => {
            this.fonts.add("Geist Mono");
            this.paragraph(
              {
                indent: {
                  left: twips(context.indent + 0.16 * 72),
                  right: twips(0.16 * 72),
                },
                shading: {
                  type: ShadingType.CLEAR,
                  fill: PANEL,
                  color: "auto",
                },
                // `pre { padding: 0.12in 0.16in }`, as a border the colour of
                // the panel: Word's only way to pad a shaded paragraph.
                border: {
                  top: pad(9),
                  bottom: pad(9),
                  left: pad(12),
                  right: pad(12),
                },
                spacing: {
                  // A code line is its font's full height on the page: 13pt.
                  line: wordLine(1.3, "geistMono"),
                  lineRule: LineRuleType.AUTO,
                },
                children: [
                  new TextRun({
                    text: line,
                    font: {
                      ascii: "Geist Mono",
                      hAnsi: "Geist Mono",
                      cs: "Geist Mono",
                      eastAsia: "Geist Mono",
                    },
                    size: Math.round(BODY_SIZE * 0.92 * 2),
                    color: context.color,
                    italics: context.italic,
                  }),
                ],
              },
              0,
              index === lines.length - 1 ? PARAGRAPH_AFTER : 0,
            );
          });
          break;
        }
        case "rule":
          this.paragraph(
            {
              indent: { left: twips(context.indent) },
              border: {
                bottom: {
                  style: BorderStyle.SINGLE,
                  size: 6,
                  color: RULE,
                  space: 0,
                },
              },
              spacing: { line: 20, lineRule: LineRuleType.EXACT },
              children: [new TextRun({ text: "", size: 2 })],
            },
            12,
            12,
          );
          break;
        case "pageBreak":
          this.breakPage();
          break;
        case "image":
          this.paragraph(
            {
              alignment: ALIGN[block.align],
              indent: { left: twips(context.indent) },
              border: this.border(context),
              children: [this.picture(block, context)],
            },
            0,
            context.paragraphAfter,
          );
          break;
        case "contents":
          this.contents(block, context);
          break;
        case "table":
          this.flushBreak();
          this.specs.push({
            kind: "table",
            table: this.table(block, context),
            bottom: PARAGRAPH_AFTER,
          });
          break;
      }
    }
  }

  private paragraphOptions(
    block: Extract<Block, { kind: "paragraph" }>,
    context: Context,
  ): IParagraphOptions {
    const base: RunBase = {
      font: "Geist",
      size: BODY_SIZE,
      color: context.color,
      italic: context.italic,
    };
    return {
      alignment: ALIGN[block.align],
      indent: { left: twips(context.indent + block.indent * 36) },
      border: this.border(context),
      spacing: {
        line: wordLine(
          block.lineSpacing ?? BODY_LINE,
          this.faceOf(block.runs, "geist"),
        ),
        lineRule: LineRuleType.AUTO,
      },
      children: this.children(block.runs, base),
    };
  }

  private picture(
    block: Extract<Block, { kind: "image" }>,
    context: Context,
  ): ParagraphChild {
    const info = block.data ? readPicture(block.data) : null;
    if (!block.data || !info) {
      // A linked or unreadable picture is named rather than silently dropped.
      return new TextRun({
        text: `[Picture${block.alt ? `: ${block.alt}` : ""}]`,
        italics: true,
        color: MUTED,
      });
    }
    const size = pictureSize(info, block.width, TEXT_WIDTH_PT - context.indent);
    return new ImageRun({
      type: info.kind,
      data: block.data,
      // Word sizes pictures in pixels at 96 to the inch.
      transformation: {
        width: Math.round((size.width * 96) / 72),
        height: Math.round((size.height * 96) / 72),
      },
      altText: block.alt
        ? { name: block.alt, description: block.alt, title: block.alt }
        : undefined,
    });
  }

  private list(block: Extract<Block, { kind: "list" }>, context: Context) {
    const task = block.style === "task";
    const level = Math.min(context.lists, 8);
    this.lists += 1;
    // Each list counts from its own start, as each <ol> on the page does.
    const numbering =
      block.style === "ordered"
        ? {
            reference: `ordered-${block.start}`,
            level,
            instance: this.lists,
          }
        : block.style === "bullet"
          ? { reference: "bullet", level, instance: this.lists }
          : null;
    if (block.style === "ordered") this.orderedStarts.add(block.start);
    const inner: Context = {
      ...context,
      indent: context.indent + (task ? TASK_TEXT_PT : LIST_INDENT_PT),
      paragraphAfter: task ? PARAGRAPH_AFTER : 2,
      lists: context.lists + 1,
    };
    for (const item of block.items) {
      const [first, ...rest] = item.blocks;
      if (first && first.kind === "paragraph") {
        const options = this.paragraphOptions(first, inner);
        const children = task
          ? [
              new TextRun({
                text: item.checked ? "☒ " : "☐ ",
                font: {
                  ascii: "MS Gothic",
                  hAnsi: "MS Gothic",
                  eastAsia: "MS Gothic",
                },
              }),
              ...(options.children ?? []),
            ]
          : options.children;
        this.paragraph(
          {
            ...options,
            children,
            ...(numbering
              ? {
                  numbering,
                  indent: {
                    left: twips(inner.indent),
                    hanging: twips(LIST_INDENT_PT / 2),
                  },
                }
              : task
                ? {
                    indent: {
                      left: twips(inner.indent),
                      hanging: twips(TASK_TEXT_PT),
                    },
                  }
                : {}),
          },
          0,
          inner.paragraphAfter,
        );
        this.render(rest, inner);
      } else {
        this.render(item.blocks, inner);
      }
    }
    this.bumpLast(PARAGRAPH_AFTER);
  }

  private contents(
    block: Extract<Block, { kind: "contents" }>,
    context: Context,
  ) {
    const line = (side: "top" | "bottom") => ({
      [side]: { style: BorderStyle.SINGLE, size: 6, color: RULE, space: 6 },
    });
    const base: RunBase = {
      font: "Geist",
      size: BODY_SIZE,
      color: context.color,
      italic: context.italic,
    };
    const spacing = {
      line: wordLine(BODY_LINE, "geist"),
      lineRule: LineRuleType.AUTO,
    };
    this.fonts.add("Geist SemiBold");
    this.paragraph(
      {
        indent: { left: twips(context.indent) },
        border: line("top"),
        spacing,
        children: [
          this.textRun(
            { text: "Contents" },
            {
              ...base,
              font: "Geist SemiBold",
              size: 13,
            },
          ),
        ],
      },
      0,
      4,
    );
    const entries =
      block.entries.length > 0
        ? block.entries
        : [
            {
              level: 1,
              text: "No headings yet. Text styled Heading 1, 2 or 3 is listed here.",
              empty: true,
            },
          ];
    entries.forEach((entry, index) => {
      const last = index === entries.length - 1;
      this.paragraph(
        {
          indent: { left: twips(context.indent + (entry.level - 1) * 18) },
          border: last ? line("bottom") : undefined,
          spacing,
          children: [
            this.textRun(
              { text: entry.text, italic: "empty" in entry },
              "empty" in entry ? { ...base, color: MUTED } : base,
            ),
          ],
        },
        // `padding-block: 1pt` on every entry.
        index === 0 ? 5 : 2,
        last ? 12 : 0,
      );
    });
  }

  private table(
    block: Extract<Block, { kind: "table" }>,
    context: Context,
  ): Table {
    const available = TEXT_WIDTH_PT - context.indent;
    const columns = Math.max(
      1,
      ...block.rows.map((row) => row.reduce((sum, c) => sum + c.colspan, 0)),
    );
    const widths: (number | null)[] = [];
    for (const cell of block.rows[0] ?? []) {
      for (let index = 0; index < cell.colspan; index += 1) {
        const px = cell.colwidth?.[index] ?? null;
        widths.push(px ? (px * 72) / 96 : null);
      }
    }
    while (widths.length < columns) widths.push(null);
    widths.length = columns;
    const fixed = widths.reduce<number>((sum, w) => sum + (w ?? 0), 0);
    const open = widths.filter((w) => w === null).length;
    let points: number[];
    if (open === 0) {
      const scale = fixed > available ? available / fixed : 1;
      points = widths.map((w) => (w ?? 0) * scale);
    } else {
      const rest = Math.max(0, available - fixed) / open;
      const raw = widths.map((w) => w ?? rest);
      const total = raw.reduce((sum, w) => sum + w, 0);
      points = raw.map((w) => (w * available) / total);
    }
    const tableWidth = points.reduce((sum, w) => sum + w, 0);
    const edge = { style: BorderStyle.SINGLE, size: 6, color: FAINT };

    return new Table({
      width: { size: twips(tableWidth), type: WidthType.DXA },
      columnWidths: points.map(twips),
      layout: TableLayoutType.FIXED,
      indent: context.indent
        ? { size: twips(context.indent), type: WidthType.DXA }
        : undefined,
      borders: {
        top: edge,
        bottom: edge,
        left: edge,
        right: edge,
        insideHorizontal: edge,
        insideVertical: edge,
      },
      // `th, td { padding: 4pt 6pt }`.
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      rows: block.rows.map((row) => {
        let column = 0;
        return new TableRow({
          cantSplit: true,
          children: row.map((cell) => {
            const span = points
              .slice(column, column + cell.colspan)
              .reduce((sum, w) => sum + w, 0);
            column += cell.colspan;
            const fill = cell.shade
              ? hex(cell.shade)
              : cell.header
                ? PANEL
                : null;
            return new TableCell({
              columnSpan: cell.colspan > 1 ? cell.colspan : undefined,
              width: { size: twips(span), type: WidthType.DXA },
              shading: fill
                ? { type: ShadingType.CLEAR, fill, color: "auto" }
                : undefined,
              children: this.cell(cell.blocks, cell.header, context),
            });
          }),
        });
      }),
    });
  }

  /** A cell's paragraphs: no margins, as `td > p { margin: 0 }`. */
  private cell(
    blocks: Block[],
    header: boolean,
    context: Context,
  ): Paragraph[] {
    const out: Paragraph[] = [];
    const base: RunBase = {
      font: header ? "Geist SemiBold" : "Geist",
      size: BODY_SIZE,
      color: context.color,
      italic: context.italic,
    };
    if (header) this.fonts.add("Geist SemiBold");
    const push = (runs: Run[], align: Align = "left", css = BODY_LINE) =>
      out.push(
        new Paragraph({
          alignment: ALIGN[align],
          spacing: {
            before: 0,
            after: 0,
            line: wordLine(css, this.faceOf(runs, "geist")),
            lineRule: LineRuleType.AUTO,
          },
          children: this.children(runs, base),
        }),
      );
    const walk = (list: Block[], prefix = "") => {
      for (const block of list) {
        if (block.kind === "paragraph" || block.kind === "heading")
          push(
            prefix ? [{ text: prefix }, ...block.runs] : block.runs,
            block.align,
            block.lineSpacing ?? BODY_LINE,
          );
        else if (block.kind === "list") {
          let count = block.start;
          for (const item of block.items) {
            walk(
              item.blocks,
              block.style === "ordered" ? `${count++}. ` : "• ",
            );
          }
        } else if (block.kind === "quote") walk(block.blocks);
        else if (block.kind === "code")
          for (const line of block.text.split("\n"))
            push([{ text: line, code: true }]);
        prefix = "";
      }
    };
    walk(blocks);
    // Word refuses a cell with nothing in it.
    return out.length > 0 ? out : [new Paragraph({ children: [] })];
  }

  /** A list or quotation ends: its bottom margin collapses into its last. */
  bumpLast(bottom: number): void {
    const last = this.specs[this.specs.length - 1];
    if (last) last.bottom = Math.max(last.bottom, bottom);
  }

  /**
   * The finished body. CSS collapses two margins to the larger; Word adds
   * "space after" to "space before". So each paragraph gets only what the
   * larger margin has beyond what the one before already gave.
   */
  build(): (Paragraph | Table)[] {
    this.flushBreak();
    const out: (Paragraph | Table)[] = [];
    let given = 0;
    let wanted = 0;
    this.specs.forEach((spec, index) => {
      if (spec.kind === "table") {
        out.push(spec.table);
        given = 0;
        wanted = spec.bottom;
        return;
      }
      const top = index === 0 ? 0 : Math.max(spec.top, wanted);
      const spacing = spec.options.spacing ?? {};
      out.push(
        new Paragraph({
          ...spec.options,
          spacing: {
            ...spacing,
            before: twips(Math.max(0, top - given)),
            after: twips(spec.bottom),
          },
        }),
      );
      given = spec.bottom;
      wanted = spec.bottom;
    });
    return out;
  }
}

export async function documentToDocx(
  blocks: Block[],
  meta: { title: string },
): Promise<Uint8Array> {
  const writer = new Writer();
  writer.render(blocks, {
    indent: 0,
    italic: false,
    color: INK,
    paragraphAfter: PARAGRAPH_AFTER,
    lists: 0,
    quote: null,
  });
  const children = writer.build();

  const headingStyle = (level: number) => {
    const lora = level <= 3;
    const font = lora ? "Lora SemiBold" : "Geist SemiBold";
    return {
      run: {
        font: { ascii: font, hAnsi: font, cs: font, eastAsia: font },
        size: (HEADING_SIZES[level - 1] ?? BODY_SIZE) * 2,
        bold: false,
        color: INK,
      },
      paragraph: {
        spacing: {
          before: 240,
          after: 120,
          line: wordLine(1.2, lora ? "lora" : "geist"),
        },
        keepNext: true,
      },
    };
  };

  const document = new Document({
    creator: "Bindersnap",
    title: meta.title,
    styles: {
      default: {
        document: {
          run: {
            font: {
              ascii: "Geist",
              hAnsi: "Geist",
              cs: "Geist",
              eastAsia: "Geist",
            },
            size: BODY_SIZE * 2,
            color: INK,
          },
          paragraph: {
            spacing: {
              after: PARAGRAPH_AFTER * TWIPS,
              line: wordLine(BODY_LINE, "geist"),
            },
          },
        },
        heading1: headingStyle(1),
        heading2: headingStyle(2),
        heading3: headingStyle(3),
        heading4: headingStyle(4),
        heading5: headingStyle(5),
        heading6: headingStyle(6),
      },
    },
    numbering: {
      config: [
        {
          reference: "bullet",
          // A browser's disc, circle and square; Word's own for the last two.
          levels: Array.from({ length: 9 }, (_, level) => {
            const shape = Math.min(level, 2);
            return {
              level,
              format: LevelFormat.BULLET,
              text: ["•", "o", ""][shape]!,
              alignment: AlignmentType.LEFT,
              style: {
                run:
                  shape === 0
                    ? {}
                    : {
                        font: shape === 1 ? "Courier New" : "Wingdings",
                      },
                paragraph: {
                  indent: {
                    left: twips(LIST_INDENT_PT * (level + 1)),
                    hanging: twips(LIST_INDENT_PT / 2),
                  },
                },
              },
            };
          }),
        },
        ...[...writer.orderedStarts].map((start) => ({
          reference: `ordered-${start}`,
          // Decimal at every depth, as nested <ol>s are.
          levels: Array.from({ length: 9 }, (_, level) => ({
            level,
            format: LevelFormat.DECIMAL,
            text: `%${level + 1}.`,
            start: level === 0 ? start : 1,
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: {
                indent: {
                  left: twips(LIST_INDENT_PT * (level + 1)),
                  hanging: twips(LIST_INDENT_PT / 2),
                },
              },
            },
          })),
        })),
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 12240, height: 15840 },
            margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
          },
        },
        children,
      },
    ],
  });
  const packed = new Uint8Array(await Packer.toBuffer(document));
  return embedFonts(packed, writer.fonts);
}
