import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ParagraphChild,
} from "docx";

import type { Align, Block, Run } from "./policyBlocks";
import { pictureSize, readPicture } from "./images";

/**
 * A policy as a Word document a surveyor, a lawyer or a board can open.
 *
 * Styled the way Word's own defaults are, not the way the app is: somebody
 * who opens the .docx is going to keep working in Word, and a document that
 * arrives in our fonts and our colours is one they have to undo first.
 * Headings are Word's Heading 1–6, so its navigation pane and its own table
 * of contents work on the file as they would on anything else.
 */

export interface ExportHeading {
  /** The policy's name, in the running header. */
  title: string;
  /** "Version 3 · approved 14 March 2026", or "Proposed — not yet approved". */
  status: string;
}

/** Letter, with Word's one-inch margins: 6.5 inches of text, in points. */
const TEXT_WIDTH_PT = 468;

const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
] as const;

const ALIGN = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
} satisfies Record<Align, (typeof AlignmentType)[keyof typeof AlignmentType]>;

const hex = (color: string) => color.replace("#", "").toUpperCase();

function textRun(run: Run): TextRun {
  return new TextRun({
    text: run.text,
    break: run.lineBreak ? 1 : undefined,
    bold: run.bold,
    italics: run.italic,
    underline: run.underline || run.link ? {} : undefined,
    strike: run.strike,
    superScript: run.superscript,
    subScript: run.subscript,
    font: run.code ? "Consolas" : undefined,
    color: run.link ? "0563C1" : run.color ? hex(run.color) : undefined,
    shading: run.highlight
      ? { type: ShadingType.CLEAR, fill: hex(run.highlight), color: "auto" }
      : undefined,
  });
}

function children(runs: Run[]): ParagraphChild[] {
  return runs.map((run) =>
    run.link && !run.lineBreak
      ? new ExternalHyperlink({ link: run.link, children: [textRun(run)] })
      : textRun(run),
  );
}

function picture(block: Extract<Block, { kind: "image" }>): Paragraph {
  const info = block.data ? readPicture(block.data) : null;
  if (!block.data || !info) {
    // A linked or unreadable picture is named rather than silently dropped.
    return new Paragraph({
      children: [
        new TextRun({
          text: `[Picture${block.alt ? `: ${block.alt}` : ""}]`,
          italics: true,
        }),
      ],
    });
  }
  const size = pictureSize(info, block.width, TEXT_WIDTH_PT);
  return new Paragraph({
    children: [
      new ImageRun({
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
      }),
    ],
  });
}

/** Header cells read as bold, the way Word's own table styles draw them. */
function embolden(blocks: Block[]): Block[] {
  return blocks.map((block) =>
    block.kind === "paragraph" || block.kind === "heading"
      ? { ...block, runs: block.runs.map((run) => ({ ...run, bold: true })) }
      : block,
  );
}

function paragraphs(
  blocks: Block[],
  depth: number,
  listRef?: { reference: string; level: number },
  /** Inside a quotation: indented, as Word's Quote style is. */
  quoted = false,
): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  for (const block of blocks) {
    switch (block.kind) {
      case "heading":
        out.push(
          new Paragraph({
            heading: HEADINGS[block.level - 1],
            alignment: ALIGN[block.align],
            children: [
              ...(block.number
                ? [new TextRun({ text: `${block.number} ` })]
                : []),
              ...children(block.runs),
            ],
          }),
        );
        break;
      case "paragraph":
        out.push(
          new Paragraph({
            alignment: ALIGN[block.align],
            children: children(
              quoted
                ? block.runs.map((run) => ({ ...run, italic: true }))
                : block.runs,
            ),
            ...(listRef ? { numbering: listRef } : {}),
            ...(quoted ? { indent: { left: 720, right: 720 } } : {}),
          }),
        );
        listRef = undefined;
        break;
      case "list": {
        const reference =
          block.style === "ordered" ? "policy-ordered" : "policy-bullet";
        for (const item of block.items) {
          const [first, ...rest] = item.blocks;
          const level = Math.min(depth, 8);
          if (block.style === "task") {
            const lead = first && first.kind === "paragraph" ? first.runs : [];
            out.push(
              new Paragraph({
                indent: { left: 360 * (level + 1) },
                children: [
                  new TextRun({ text: item.checked ? "☒ " : "☐ " }),
                  ...children(lead),
                ],
              }),
            );
            out.push(
              ...paragraphs(
                first && first.kind !== "paragraph" ? [first, ...rest] : rest,
                depth + 1,
              ),
            );
            continue;
          }
          out.push(
            ...paragraphs(first ? [first] : [], depth + 1, {
              reference,
              level,
            }),
          );
          out.push(...paragraphs(rest, depth + 1));
        }
        break;
      }
      case "quote":
        out.push(...paragraphs(block.blocks, depth, undefined, true));
        break;
      case "code":
        for (const line of block.text.split("\n")) {
          out.push(
            new Paragraph({
              children: [new TextRun({ text: line, font: "Consolas" })],
            }),
          );
        }
        break;
      case "rule":
        out.push(
          new Paragraph({
            border: {
              bottom: {
                style: BorderStyle.SINGLE,
                size: 6,
                color: "BFBFBF",
                space: 1,
              },
            },
            children: [],
          }),
        );
        break;
      case "pageBreak":
        out.push(new Paragraph({ children: [new PageBreak()] }));
        break;
      case "image":
        out.push(picture(block));
        break;
      case "contents":
        out.push(
          new Paragraph({
            children: [new TextRun({ text: "Contents", bold: true, size: 26 })],
          }),
        );
        for (const entry of block.entries) {
          out.push(
            new Paragraph({
              indent: { left: 360 * (entry.level - 1) },
              children: [
                new TextRun({
                  text: entry.number
                    ? `${entry.number} ${entry.text}`
                    : entry.text,
                }),
              ],
            }),
          );
        }
        break;
      case "table": {
        const columns = Math.max(
          1,
          ...block.rows.map((row) =>
            row.reduce((sum, cell) => sum + cell.colspan, 0),
          ),
        );
        out.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: block.rows.map(
              (row) =>
                new TableRow({
                  tableHeader: row.every((cell) => cell.header),
                  children: row.map(
                    (cell) =>
                      new TableCell({
                        columnSpan: cell.colspan > 1 ? cell.colspan : undefined,
                        width: {
                          size: Math.round((100 * cell.colspan) / columns),
                          type: WidthType.PERCENTAGE,
                        },
                        shading: cell.shade
                          ? {
                              type: ShadingType.CLEAR,
                              fill: hex(cell.shade),
                              color: "auto",
                            }
                          : cell.header
                            ? {
                                type: ShadingType.CLEAR,
                                fill: "F2F2F2",
                                color: "auto",
                              }
                            : undefined,
                        children: (() => {
                          const inner = paragraphs(
                            cell.header ? embolden(cell.blocks) : cell.blocks,
                            0,
                          );
                          // Word refuses a cell with nothing in it.
                          return inner.length > 0 ? inner : [new Paragraph("")];
                        })(),
                      }),
                  ),
                }),
            ),
          }),
        );
        break;
      }
    }
  }
  return out;
}

export async function policyToDocx(
  blocks: Block[],
  heading: ExportHeading,
): Promise<Uint8Array> {
  const document = new Document({
    creator: "Bindersnap",
    title: heading.title,
    description: heading.status,
    numbering: {
      config: [
        {
          reference: "policy-bullet",
          levels: Array.from({ length: 9 }, (_, level) => ({
            level,
            format: LevelFormat.BULLET,
            text: ["•", "◦", "▪"][level % 3]!,
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: { indent: { left: 360 * (level + 1), hanging: 360 } },
            },
          })),
        },
        {
          reference: "policy-ordered",
          levels: Array.from({ length: 9 }, (_, level) => ({
            level,
            format: [
              LevelFormat.DECIMAL,
              LevelFormat.LOWER_LETTER,
              LevelFormat.LOWER_ROMAN,
            ][level % 3]!,
            text: `%${level + 1}.`,
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: { indent: { left: 360 * (level + 1), hanging: 360 } },
            },
          })),
        },
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
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: heading.title,
                    size: 16,
                    color: "7F7F7F",
                  }),
                  new TextRun({
                    text: `  ·  ${heading.status}`,
                    size: 16,
                    color: "7F7F7F",
                  }),
                ],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({
                    children: [
                      "Page ",
                      PageNumber.CURRENT,
                      " of ",
                      PageNumber.TOTAL_PAGES,
                    ],
                    size: 16,
                    color: "7F7F7F",
                  }),
                ],
              }),
            ],
          }),
        },
        children: paragraphs(blocks, 0),
      },
    ],
  });
  return new Uint8Array(await Packer.toBuffer(document));
}
