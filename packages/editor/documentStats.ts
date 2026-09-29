import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

/**
 * The facts a word processor's status bar and navigation pane show about a
 * document, worked out from the document rather than from the screen — so
 * they are testable, and so they do not change when the window does.
 */

/**
 * Words the way Word counts them: runs of anything that is not a space.
 *
 * "Follow-up" is one word and "3.5" is one word, which is what the person
 * checking a policy against a 500-word limit expects.
 */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed === "") return 0;
  return trimmed.split(/\s+/u).length;
}

export interface DocumentCounts {
  words: number;
  /** Characters, spaces included — Word's "Characters (with spaces)". */
  characters: number;
  paragraphs: number;
}

/** Words, characters and paragraphs in a document. */
export function countDocument(doc: ProseMirrorNode): DocumentCounts {
  let words = 0;
  let characters = 0;
  let paragraphs = 0;

  doc.descendants((node) => {
    if (!node.isTextblock) return true;
    const text = node.textContent;
    if (text.trim() !== "") {
      paragraphs += 1;
      words += countWords(text);
      characters += text.length;
    }
    return false;
  });

  return { words, characters, paragraphs };
}

export interface OutlineEntry {
  level: number;
  text: string;
  /** Where the heading starts, to put the cursor there. */
  pos: number;
}

/** Every heading, in order — the navigation pane's list. */
export function documentOutline(doc: ProseMirrorNode): OutlineEntry[] {
  const outline: OutlineEntry[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "heading") {
      const text = node.textContent.trim();
      if (text !== "") {
        outline.push({ level: Number(node.attrs.level ?? 1), text, pos });
      }
      return false;
    }
    // Headings only live at the top level or inside containers like quotes;
    // a paragraph's children are never one.
    return !node.isTextblock;
  });
  return outline;
}

/**
 * Where each page begins, given the height of every top-level block.
 *
 * **Blocks do not split**, which is the one liberty this takes with a real
 * word processor: a paragraph that would cross the bottom of a page starts
 * the next one instead. It keeps the count honest to within a paragraph and
 * lets the editor mark a page's start between two blocks rather than across
 * a line of somebody's text. A page break always starts a new page, and a
 * block taller than a whole page takes as many as it fills.
 *
 * Returns the index of the block that starts each page after the first, and
 * the number of pages.
 */
export function paginate(
  blocks: ReadonlyArray<{ height: number; pageBreak?: boolean }>,
  pageHeight: number,
): { starts: number[]; pages: number } {
  const starts: number[] = [];
  let pages = 1;
  let used = 0;

  blocks.forEach((block, index) => {
    if (block.pageBreak) {
      // The break itself sits at the bottom of the page it ends; what follows
      // it starts the next.
      if (index + 1 < blocks.length) {
        starts.push(index + 1);
        pages += 1;
        used = 0;
      }
      return;
    }

    // Nothing is ever moved off an empty page: a block that does not fit on
    // one that has nothing on it yet would not fit on the next one either.
    if (used > 0 && used + block.height > pageHeight) {
      starts.push(index);
      pages += 1;
      used = 0;
    }

    used += block.height;
    if (used > pageHeight) {
      // A table or a picture taller than a page fills whole pages of its own.
      const extra = Math.floor((used - 1) / pageHeight);
      pages += extra;
      used -= extra * pageHeight;
    }
  });

  return { starts, pages };
}
