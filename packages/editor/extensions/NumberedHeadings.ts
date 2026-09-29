import { Extension, Node } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";

/**
 * Numbered sections, as a policy is written: 1. Purpose, 2. Scope, 2.1 Wards.
 *
 * **One switch for the document, not a number on each heading.** Word numbers
 * headings by linking a list to the heading styles, so every section is
 * numbered or none is; typing the numbers by hand is what goes wrong the day a
 * section is added in the middle. Here the switch is an attribute of the
 * document, and every Heading 2 and 3 carries a `numbered` mark of it, kept in
 * step on every change — so a heading made a moment ago is numbered like the
 * rest, and one pasted in from another policy takes this one's rule.
 *
 * **Sections and their subsections, not the title.** A policy's Heading 1 is
 * its name. The numbers themselves are drawn by CSS counters, in the editor
 * and in the reader alike, so they are never words anybody can edit out of
 * step, and a comparison of two versions is about the headings, not the
 * digits in front of them.
 */

/** The heading levels that are numbered: sections and subsections. */
export const NUMBERED_LEVELS = [2, 3] as const;

const isNumberedLevel = (level: unknown) =>
  (NUMBERED_LEVELS as readonly unknown[]).includes(Number(level));

/** The document node, with the one switch on it. */
export const PolicyDocument = Node.create({
  name: "doc",
  topNode: true,
  content: "block+",

  addAttributes() {
    return {
      numberedHeadings: { default: false },
    };
  },
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    numberedHeadings: {
      /** Number the sections, or stop; the whole document at once. */
      toggleHeadingNumbers: () => ReturnType;
    };
  }
}

/** Whether a document numbers its sections. */
export function numbersHeadings(doc: ProseMirrorNode): boolean {
  return doc.attrs.numberedHeadings === true;
}

/**
 * "1." and "2.1" for a list of heading levels in order, as the counters draw
 * them; null for a level that is not numbered. A subsection before any
 * section is "0.1", as Word's would be.
 */
export function headingNumbers(levels: readonly number[]): (string | null)[] {
  let section = 0;
  let sub = 0;
  return levels.map((level) => {
    if (level === 2) {
      section += 1;
      sub = 0;
      return `${section}.`;
    }
    if (level === 3) {
      sub += 1;
      return `${section}.${sub}`;
    }
    return null;
  });
}

export const numberedHeadingsKey = new PluginKey("numberedHeadings");

export const NumberedHeadings = Extension.create({
  name: "numberedHeadings",

  addGlobalAttributes() {
    return [
      {
        types: ["heading"],
        attributes: {
          numbered: {
            default: false,
            // Derived from the document, never read back from markup: a
            // heading pasted from a numbered policy follows this one.
            parseHTML: () => false,
            renderHTML: (attributes: Record<string, unknown>) =>
              attributes.numbered === true ? { class: "bs-numbered" } : {},
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      toggleHeadingNumbers:
        () =>
        ({ state, tr, dispatch }) => {
          dispatch?.(
            tr.setDocAttribute("numberedHeadings", !numbersHeadings(state.doc)),
          );
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: numberedHeadingsKey,
        appendTransaction(transactions, _old, state) {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          const on = numbersHeadings(state.doc);
          const tr = state.tr;
          state.doc.descendants((node, pos) => {
            if (node.type.name !== "heading") return true;
            const want = on && isNumberedLevel(node.attrs.level);
            if (node.attrs.numbered !== want) {
              tr.setNodeAttribute(pos, "numbered", want);
            }
            return false;
          });
          return tr.docChanged ? tr : null;
        },
      }),
    ];
  },
});
