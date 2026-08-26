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

/** Marks where one block ended and the next began, before whitespace collapses. */
const BLOCK_BREAK = "\u0000";

/**
 * The words out of a fragment of HTML, for counting what moved.
 *
 * The counts run on text rather than markup so that a Word file whose only
 * change is a style — a paragraph re-tagged as a heading, say — is not
 * reported as a hundred words rewritten.
 *
 * The browser's own parser does the reading. Stripping tags and decoding
 * entities with regular expressions is the pattern that produces
 * `<scr<script>ipt>` surviving a single pass, and `&amp;lt;` decoding twice —
 * CodeQL flags both, and it is right to: even where the result is only ever
 * counted, a hand-rolled HTML reader is one refactor away from being rendered
 * by someone who assumed it was safe. `DOMParser` is inert — it runs no
 * script and fetches nothing — and it decodes entities exactly once, because
 * it is a parser rather than a series of substitutions.
 */
export function htmlToText(html: string): string {
  const parsed = new DOMParser().parseFromString(html, "text/html");

  // Block elements are where one run of words ends and the next begins. With
  // nothing between them "…six years.Review" counts as one word.
  //
  // The break is marked rather than written, because a newline inside the
  // markup is only layout — a paragraph wrapped across three source lines is
  // still one paragraph — and it has to collapse like any other space. A
  // control character cannot appear in the text of a document.
  for (const block of parsed.body.querySelectorAll(
    "p, h1, h2, h3, h4, h5, h6, li, tr, div, br",
  )) {
    block.after(parsed.createTextNode(BLOCK_BREAK));
  }

  return (parsed.body.textContent ?? "")
    .replace(/\s+/g, " ")
    .split(BLOCK_BREAK)
    .map((block) => block.trim())
    .filter((block) => block !== "")
    .join("\n\n");
}
