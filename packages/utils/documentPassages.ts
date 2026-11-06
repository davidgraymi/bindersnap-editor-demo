/**
 * A document as passages: what search indexes, and what a result points at.
 *
 * A passage is one block of a document — a heading, or a paragraph under it,
 * a list item, a table cell — the unit the comparison already reads a
 * document in (ADR 0007, §2). A result is a passage, so a search can say
 * where in a policy it matched, not only which policy.
 *
 * **One walker, two callers.** The index job reads files on the server; the
 * reader that scrolls to a passage will read the same files in the browser.
 * Both must count blocks the same way, or passage 12 in the index is passage
 * 13 on screen. That is why this lives here and imports nothing: it runs in
 * both places.
 */

export interface Passage {
  /** Its place in the document, from 0. */
  ordinal: number;
  /** The heading it sits under, or null before the first one. */
  heading: string | null;
  text: string;
}

/**
 * A document reduced to the two things a policy is made of: a heading, or a
 * paragraph under it. What the comparison diffs, and what a Word file or a
 * PDF is read back as (`pdfText.ts`, `apps/app/docxHtml.ts`).
 */
export interface DocumentBlock {
  kind: "heading" | "paragraph";
  /** 1 for the document's title, 2 for a section heading. Ignored on paragraphs. */
  level: 1 | 2;
  text: string;
}

/** As much of a block as passages need. */
export type TextBlock = Pick<DocumentBlock, "kind" | "text">;

/** Runs of whitespace, inside a block, are one space. */
function tidy(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Number the blocks and file each under the heading before it. */
export function passagesFromBlocks(blocks: readonly TextBlock[]): Passage[] {
  const passages: Passage[] = [];
  let heading: string | null = null;
  for (const block of blocks) {
    const text = tidy(block.text);
    if (text === "") continue;
    if (block.kind === "heading") heading = text;
    passages.push({
      ordinal: passages.length,
      // A heading is filed under itself: it is the first line of its section.
      heading,
      text,
    });
  }
  return passages;
}

interface EditorNode {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: EditorNode[];
  text?: string;
}

/** Nodes whose children are words: each one is a block. */
const TEXT_BLOCKS = new Set(["paragraph", "heading", "codeBlock"]);

/** Every word under a node, a line break read as a space. */
function inlineText(node: EditorNode): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return " ";
  return (node.content ?? []).map(inlineText).join("");
}

/**
 * A document the editor wrote (ProseMirror JSON), as passages.
 *
 * Every paragraph, heading and code block is one, wherever it sits — at the
 * top level, in a list item, in a table cell, in a quote. A picture is its alt
 * text and title, and never its data. Anything the walker does not recognise
 * is read for the blocks inside it, so an editor that adds a node does not
 * lose its words from search.
 */
export function passagesFromEditorDocument(document: unknown): Passage[] {
  const blocks: TextBlock[] = [];

  const visit = (node: EditorNode) => {
    if (node.type && TEXT_BLOCKS.has(node.type)) {
      blocks.push({
        kind: node.type === "heading" ? "heading" : "paragraph",
        text: inlineText(node),
      });
      // A picture inside a paragraph still has its alt text read below.
    }
    if (node.type === "image") {
      const words = [node.attrs?.alt, node.attrs?.title]
        .filter((value): value is string => typeof value === "string")
        .join(" ");
      if (tidy(words) !== "") blocks.push({ kind: "paragraph", text: words });
      return;
    }
    for (const child of node.content ?? []) {
      if (child.type === "text" || child.type === "hardBreak") continue;
      visit(child);
    }
  };

  if (typeof document === "object" && document !== null) {
    visit(document as EditorNode);
  }
  return passagesFromBlocks(blocks);
}

/** Markdown's inline markup, taken off so the words are what is indexed. */
function stripInlineMarkdown(line: string): string {
  return (
    line
      // ![alt](src) is its alt text; [words](href) is its words.
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/`([^`]*)`/g, "$1")
      .replace(/(\*\*|__|~~)(.+?)\1/g, "$2")
      .replace(/(^|[\s(])[*_]([^*_]+)[*_](?=[\s).,;:!?]|$)/g, "$1$2")
  );
}

/**
 * A Markdown file, as passages.
 *
 * A heading line is one, a list item or a table row is one, and a run of
 * other lines up to a blank line is one paragraph. The same small reading of
 * Markdown the preview does (`apps/app/markdown.ts`), without the rendering.
 */
export function passagesFromMarkdown(source: string): Passage[] {
  const blocks: TextBlock[] = [];
  let paragraph: string[] = [];
  let fence: string | null = null;

  const endParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
      paragraph = [];
    }
  };

  for (const raw of source.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();

    // A fenced code block is one block, its lines kept together.
    const fenceMark = /^(```|~~~)/.exec(line)?.[1];
    if (fence !== null) {
      if (fenceMark === fence) {
        endParagraph();
        fence = null;
      } else {
        paragraph.push(line);
      }
      continue;
    }
    if (fenceMark) {
      endParagraph();
      fence = fenceMark;
      continue;
    }

    if (line === "" || /^([-*_])(\s*\1){2,}$/.test(line)) {
      endParagraph();
      continue;
    }

    const heading = /^#{1,6}\s+(.*?)\s*#*$/.exec(line);
    if (heading) {
      endParagraph();
      blocks.push({ kind: "heading", text: stripInlineMarkdown(heading[1]!) });
      continue;
    }

    const item = /^(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.*)$/.exec(line);
    if (item) {
      endParagraph();
      blocks.push({ kind: "paragraph", text: stripInlineMarkdown(item[1]!) });
      continue;
    }

    if (line.startsWith("|")) {
      endParagraph();
      // The rule under a table's header row says nothing.
      if (/^\|?[\s|:-]+\|?$/.test(line)) continue;
      blocks.push({
        kind: "paragraph",
        text: stripInlineMarkdown(
          line
            .replace(/^\||\|$/g, "")
            .split("|")
            .map((cell) => cell.trim())
            .join(" "),
        ),
      });
      continue;
    }

    paragraph.push(stripInlineMarkdown(line.replace(/^>\s?/, "")));
  }
  endParagraph();

  return passagesFromBlocks(blocks);
}
