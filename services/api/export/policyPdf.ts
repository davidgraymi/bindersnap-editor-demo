import type { Block, Run } from "./policyBlocks";
import type { ExportHeading } from "./policyDocx";
import { PdfWriter, type TextStyle } from "./pdfLayout";

/**
 * A policy as a PDF: the copy that goes in the binder on the shelf, on the
 * surveyor's laptop, and in the email to the board.
 *
 * Laid out as the printed page is (#591): Letter, one-inch margins, the
 * policy's name and version at the top of every page and "Page 3 of 7" at the
 * foot, so a single page that has come loose still says what it belongs to.
 */

const HEADING_SIZES = [20, 15, 13, 12, 11, 11];
const BODY = 11;
const INDENT = 18;

function bodyStyle(align: TextStyle["align"], indent: number): TextStyle {
  return { size: BODY, align, indent, spaceAfter: 6 };
}

async function render(
  writer: PdfWriter,
  blocks: Block[],
  indent: number,
  quoted = false,
): Promise<void> {
  for (const block of blocks) {
    switch (block.kind) {
      case "heading": {
        const runs: Run[] = block.number
          ? [{ text: `${block.number} ` }, ...block.runs]
          : block.runs;
        writer.text(runs, {
          size: HEADING_SIZES[block.level - 1] ?? BODY,
          bold: true,
          align: block.align,
          indent,
          spaceBefore: block.level === 1 ? 4 : 12,
          spaceAfter: 6,
          lineHeight: 1.2,
          // A heading is never the last thing on a page.
          keepWithNext: BODY * 2.8,
        });
        break;
      }
      case "paragraph":
        writer.text(
          quoted
            ? block.runs.map((run) => ({ ...run, italic: true }))
            : block.runs,
          bodyStyle(block.align, indent + (quoted ? INDENT : 0)),
        );
        break;
      case "list": {
        let count = block.start;
        for (const item of block.items) {
          const [first, ...rest] = item.blocks;
          const marker =
            block.style === "ordered"
              ? `${count}.`
              : block.style === "task"
                ? item.checked
                  ? "[x]"
                  : "[ ]"
                : "•";
          count += 1;
          if (first && first.kind === "paragraph") {
            writer.text(first.runs, {
              ...bodyStyle(first.align, indent + INDENT),
              spaceAfter: 3,
              marker,
            });
            await render(writer, rest, indent + INDENT);
          } else {
            writer.text([{ text: "" }], {
              size: BODY,
              indent: indent + INDENT,
              marker,
            });
            await render(writer, item.blocks, indent + INDENT);
          }
        }
        writer.space(3);
        break;
      }
      case "quote":
        await render(writer, block.blocks, indent, true);
        break;
      case "code":
        for (const line of block.text.split("\n")) {
          writer.text([{ text: line || " ", code: true }], {
            size: 9.5,
            indent,
            lineHeight: 1.25,
          });
        }
        writer.space(6);
        break;
      case "rule":
        writer.rule();
        break;
      case "pageBreak":
        if (!writer.atTop) writer.newPage();
        break;
      case "image":
        await writer.picture(block.data, block.width, block.alt);
        break;
      case "contents":
        writer.say("Contents", {
          size: 12,
          bold: true,
          spaceBefore: 6,
          spaceAfter: 4,
          indent,
        });
        for (const entry of block.entries) {
          writer.say(
            entry.number ? `${entry.number} ${entry.text}` : entry.text,
            {
              size: 10.5,
              indent: indent + (entry.level - 1) * INDENT,
              spaceAfter: 2,
            },
          );
        }
        writer.space(8);
        break;
      case "table":
        writer.table(
          block.rows.map((row) =>
            row.map((cell) => ({
              runs: flatten(cell.blocks),
              header: cell.header,
              shade: cell.shade,
              colspan: cell.colspan,
            })),
          ),
        );
        break;
    }
  }
}

/**
 * A cell's blocks as one run of text. Cells hold paragraphs almost always;
 * a list inside one keeps its items as lines rather than losing them.
 */
function flatten(blocks: Block[]): Run[] {
  const runs: Run[] = [];
  const push = (more: Run[]) => {
    if (runs.length > 0) runs.push({ text: "", lineBreak: true });
    runs.push(...more);
  };
  for (const block of blocks) {
    if (block.kind === "paragraph" || block.kind === "heading")
      push(block.runs);
    else if (block.kind === "list") {
      for (const item of block.items)
        push([{ text: "• " }, ...flatten(item.blocks)]);
    } else if (block.kind === "quote") push(flatten(block.blocks));
    else if (block.kind === "code") push([{ text: block.text, code: true }]);
  }
  return runs;
}

export async function policyToPdf(
  blocks: Block[],
  heading: ExportHeading,
): Promise<Uint8Array> {
  const writer = await PdfWriter.create({
    title: heading.title,
    subject: heading.status,
  });
  await render(writer, blocks, 0);
  writer.furnish(`${heading.title}  ·  ${heading.status}`);
  return writer.save();
}
