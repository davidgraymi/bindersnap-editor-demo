/**
 * A document reduced to the two things a policy is made of.
 *
 * A PDF has no headings — it has glyphs at coordinates, in a font, at a size.
 * Reading its text back out as one long string is what made the comparison
 * run "Medication Administration Policy Purpose This policy sets out…"
 * together as a single sentence. Recovering blocks is what puts the structure
 * back, and a block is all the structure a policy needs: a heading, or a
 * paragraph under it.
 */

export interface DocumentBlock {
  kind: "heading" | "paragraph";
  /** 1 for the document's title, 2 for a section heading. Ignored on paragraphs. */
  level: 1 | 2;
  text: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Blocks as HTML, so the comparison can diff them as markup.
 *
 * Every character is escaped here, so the output contains only the tags this
 * function produced. Callers still pass the result through `sanitizeHtml`
 * before it reaches the DOM.
 */
export function blocksToHtml(blocks: readonly DocumentBlock[]): string {
  return blocks
    .map((block) =>
      block.kind === "heading"
        ? `<h${block.level}>${escapeHtml(block.text)}</h${block.level}>`
        : `<p>${escapeHtml(block.text)}</p>`,
    )
    .join("\n");
}

/** Blocks as plain text, for counting what moved. */
export function blocksToText(blocks: readonly DocumentBlock[]): string {
  return blocks.map((block) => block.text).join("\n\n");
}
