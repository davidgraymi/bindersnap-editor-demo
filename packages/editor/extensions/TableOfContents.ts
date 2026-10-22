import { Node, mergeAttributes } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, Selection, TextSelection } from "@tiptap/pm/state";

import { headingNumbers, numbersHeadings } from "./NumberedHeadings";
import { documentOutline } from "../documentStats";

/**
 * A table of contents: the policy's headings, listed where the author put it.
 *
 * Word's References > Table of Contents, with one difference. Word's is a
 * field that goes stale until somebody right-clicks Update Field, and a
 * policy approved with a contents list that no longer matches its sections is
 * a finding waiting to happen. This one is updated in the same step as the
 * edit that changed a heading, so it is never out of date and an Undo takes
 * both back together.
 *
 * **The entries are stored, not worked out on reading.** The node keeps its
 * list as an attribute, so the reading page, the printout and a comparison of
 * two versions all show the list the author saw, with no code of their own.
 * Headings 1 to 3 are listed, as Word's default is.
 */

/** Word's default: the first three heading levels. */
export const CONTENTS_LEVELS = 3;

export interface ContentsEntry {
  level: number;
  text: string;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    tableOfContents: {
      /** Put a table of contents at the cursor. */
      insertTableOfContents: () => ReturnType;
    };
  }
}

/** The entries a document's headings make, in order. */
export function contentsEntries(doc: ProseMirrorNode): ContentsEntry[] {
  const outline = documentOutline(doc);
  // Numbered sections are listed with their numbers, as Word's contents are.
  // Counted over every heading, as the page's counters are, so a section's
  // number here is the one printed beside it.
  const numbers = numbersHeadings(doc)
    ? headingNumbers(outline.map((entry) => entry.level))
    : [];
  return outline.flatMap(({ level, text }, index) => {
    if (level > CONTENTS_LEVELS) return [];
    const number = numbers[index];
    return [{ level, text: number ? `${number} ${text}` : text }];
  });
}

/** An entries attribute as stored, made safe to draw whatever it holds. */
export function readEntries(value: unknown): ContentsEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const { level, text } = item as { level?: unknown; text?: unknown };
    if (typeof text !== "string" || text.trim() === "") return [];
    const n = Math.round(Number(level));
    return [
      {
        level: Number.isFinite(n)
          ? Math.min(CONTENTS_LEVELS, Math.max(1, n))
          : 1,
        text,
      },
    ];
  });
}

function sameEntries(a: ContentsEntry[], b: ContentsEntry[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (entry, index) =>
        entry.level === b[index]?.level && entry.text === b[index]?.text,
    )
  );
}

export const TableOfContents = Node.create({
  name: "tableOfContents",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      entries: {
        default: [],
        // Pasted, it is refilled from the headings of wherever it lands.
        parseHTML: () => [],
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-table-of-contents]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const entries = readEntries(node.attrs.entries);
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-table-of-contents": "",
        class: "bs-toc",
      }),
      ["p", { class: "bs-toc-title" }, "Contents"],
      ...(entries.length === 0
        ? [
            [
              "p",
              { class: "bs-toc-empty" },
              "No headings yet. Text styled Heading 1, 2 or 3 is listed here.",
            ] as const,
          ]
        : entries.map(
            (entry, index) =>
              [
                "p",
                {
                  class: `bs-toc-entry bs-toc-entry--${entry.level}`,
                  "data-toc-index": String(index),
                },
                entry.text,
              ] as const,
          )),
    ];
  },

  addCommands() {
    return {
      // Beside the block the cursor is in, never through it: an empty line
      // becomes the contents, the start of a block puts them before it, and
      // anywhere else after it.
      insertTableOfContents:
        () =>
        ({ state, tr, dispatch }) => {
          const { $from } = state.selection;
          if ($from.depth === 0) return false;
          const block = $from.node(1);
          const node = this.type.create({
            entries: contentsEntries(state.doc),
          });
          let at: number;
          if (block.isTextblock && block.content.size === 0) {
            at = $from.before(1);
            tr.replaceWith(at, $from.after(1), node);
          } else {
            const atStart =
              state.selection.empty && $from.pos === $from.start(1);
            at = atStart ? $from.before(1) : $from.after(1);
            tr.insert(at, node);
          }
          // The cursor goes on after it, as Word's does.
          tr.setSelection(
            Selection.near(tr.doc.resolve(at + node.nodeSize), 1),
          ).scrollIntoView();
          dispatch?.(tr);
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    const type = this.type;
    return [
      new Plugin({
        key: new PluginKey("tableOfContents"),

        // Kept current in the same step as the edit, so Undo takes both.
        appendTransaction(transactions, _old, state) {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          let entries: ContentsEntry[] | null = null;
          let tr = state.tr;
          state.doc.descendants((node, pos) => {
            if (node.type !== type) return !node.isTextblock;
            entries ??= contentsEntries(state.doc);
            if (!sameEntries(readEntries(node.attrs.entries), entries)) {
              tr = tr.setNodeMarkup(pos, undefined, { entries });
            }
            return false;
          });
          return tr.docChanged ? tr : null;
        },

        props: {
          // A click on an entry goes to its heading, as a link would.
          handleClickOn(view, _pos, node, _nodePos, event) {
            if (node.type !== type) return false;
            const target = event.target;
            if (!(target instanceof HTMLElement)) return false;
            const entry = target.closest<HTMLElement>("[data-toc-index]");
            if (!entry) return false;
            const heading = documentOutline(view.state.doc).filter(
              (item) => item.level <= CONTENTS_LEVELS,
            )[Number(entry.dataset.tocIndex)];
            if (!heading) return false;
            const selection = TextSelection.create(
              view.state.doc,
              heading.pos + 1,
            );
            view.dispatch(
              view.state.tr.setSelection(selection).scrollIntoView(),
            );
            view.focus();
            return true;
          },
        },
      }),
    ];
  },
});
