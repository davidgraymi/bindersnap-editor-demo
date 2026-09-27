/**
 * What a Bindersnap document is made of — the one list of Tiptap extensions
 * that both the editor and the reader load.
 *
 * **One list, because two drift.** The page that reads a policy renders the
 * stored JSON with `generateHTML`, and it used to carry its own copy of the
 * editor's list "less what only matters while typing". The day the editor
 * learned paragraph spacing, the reader would have dropped it without a word:
 * ProseMirror ignores an attribute its schema does not declare. So the content
 * schema lives here and nowhere else, and the editor adds only what exists
 * while somebody is typing — the placeholder, the search highlights.
 *
 * Nothing in this file touches the DOM or React, so the reader can import it
 * without pulling in the editor's interface.
 */

import {
  Extension,
  Node,
  mergeAttributes,
  type AnyExtension,
} from "@tiptap/core";
import type { Selection, Transaction } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import TextAlign from "@tiptap/extension-text-align";
import {
  Color,
  FontFamily,
  FontSize,
  TextStyle,
} from "@tiptap/extension-text-style";
import Highlight from "@tiptap/extension-highlight";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import {
  Table,
  TableCell,
  TableHeader,
  TableRow,
} from "@tiptap/extension-table";

import { TableOfContents } from "./extensions/TableOfContents";
import { pictureWidth } from "./imageFiles";

/**
 * A cell's shading as `#rrggbb`, or null for anything that is not a colour.
 *
 * A browser hands back a colour it was given as hex in `rgb()` form, so both
 * are read, and it is kept as hex whichever arrived: one spelling, so two
 * versions of a policy with the same shading compare as the same.
 */
export function shadingColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(text)) return text;
  const rgb = text.match(
    /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/,
  );
  if (!rgb) return null;
  const parts = rgb.slice(1).map(Number);
  if (parts.some((part) => part > 255)) return null;
  return `#${parts.map((part) => part.toString(16).padStart(2, "0")).join("")}`;
}

/** Word's cell Shading, kept on the cell and drawn as its background. */
const CELL_SHADING = {
  background: {
    default: null,
    parseHTML: (element: HTMLElement) =>
      shadingColor(element.style.backgroundColor),
    renderHTML: (attributes: Record<string, unknown>) => {
      const color = shadingColor(attributes.background);
      return color ? { style: `background-color: ${color}` } : {};
    },
  },
};

/** Line spacing a paragraph may take — Word's own menu, as multiples. */
export const LINE_SPACINGS = ["1", "1.15", "1.5", "2", "2.5", "3"] as const;

/** How far one step of Indent moves a paragraph, in inches, as Word does. */
export const INDENT_STEP_IN = 0.5;
/** Past this a paragraph is off the page on a portrait Letter sheet. */
export const MAX_INDENT = 8;

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    paragraphFormat: {
      /** Line spacing for every paragraph and heading in the selection. */
      setLineSpacing: (spacing: string) => ReturnType;
      /** Back to the document's own spacing. */
      unsetLineSpacing: () => ReturnType;
      /** One step further in, or out, for paragraphs that are not list items. */
      indentParagraph: () => ReturnType;
      outdentParagraph: () => ReturnType;
    };
    pageBreak: {
      /** Start the next block on a new page. */
      setPageBreak: () => ReturnType;
    };
  }
}

const FORMATTED_BLOCKS = ["paragraph", "heading"];

/**
 * Line spacing and indentation, on the paragraph.
 *
 * **Paragraph attributes, because that is what they are in Word.** Tiptap's
 * own `LineHeight` is a text style — a mark on a run of characters — so
 * "double-space this paragraph" would set it on whatever text was selected
 * and leave the rest of the paragraph single-spaced, which is not a thing a
 * word processor has ever done.
 */
export const ParagraphFormat = Extension.create({
  name: "paragraphFormat",

  addGlobalAttributes() {
    return [
      {
        types: FORMATTED_BLOCKS,
        attributes: {
          lineSpacing: {
            default: null,
            parseHTML: (element) =>
              element.getAttribute("data-line-spacing") ?? null,
            renderHTML: (attributes) => {
              const spacing = attributes.lineSpacing as string | null;
              if (!spacing || !isLineSpacing(spacing)) return {};
              return {
                "data-line-spacing": spacing,
                style: `line-height: ${spacing}`,
              };
            },
          },
          indent: {
            default: 0,
            parseHTML: (element) =>
              clampIndent(Number(element.getAttribute("data-indent") ?? 0)),
            renderHTML: (attributes) => {
              const indent = clampIndent(Number(attributes.indent ?? 0));
              if (indent === 0) return {};
              return {
                "data-indent": String(indent),
                style: `margin-left: ${indent * INDENT_STEP_IN}in`,
              };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setLineSpacing:
        (spacing) =>
        ({ commands }) =>
          isLineSpacing(spacing)
            ? FORMATTED_BLOCKS.map((type) =>
                commands.updateAttributes(type, { lineSpacing: spacing }),
              ).some(Boolean)
            : false,
      unsetLineSpacing:
        () =>
        ({ commands }) =>
          FORMATTED_BLOCKS.map((type) =>
            commands.resetAttributes(type, "lineSpacing"),
          ).some(Boolean),
      indentParagraph:
        () =>
        ({ tr, state, dispatch }) =>
          shiftIndent(tr, state.selection, 1, dispatch),
      outdentParagraph:
        () =>
        ({ tr, state, dispatch }) =>
          shiftIndent(tr, state.selection, -1, dispatch),
    };
  },
});

function isLineSpacing(value: string): boolean {
  return (LINE_SPACINGS as readonly string[]).includes(value);
}

function clampIndent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(MAX_INDENT, Math.round(value)));
}

function shiftIndent(
  tr: Transaction,
  selection: Selection,
  step: number,
  dispatch: ((tr: Transaction) => void) | undefined,
): boolean {
  let changed = false;
  tr.doc.nodesBetween(selection.from, selection.to, (node, pos, parent) => {
    if (!FORMATTED_BLOCKS.includes(node.type.name)) return true;
    // A list item's paragraph is indented by nesting the list, which is what
    // Tab does there; a margin on top of that would double it.
    if (parent && parent.type.name.endsWith("Item")) return false;
    const current = clampIndent(Number(node.attrs.indent ?? 0));
    const next = clampIndent(current + step);
    if (next !== current) {
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next });
      changed = true;
    }
    return false;
  });
  if (changed && dispatch) dispatch(tr);
  return changed;
}

/**
 * A page break: what follows starts on a new page.
 *
 * On screen it is a labelled rule; on paper it is `break-after: page`, so a
 * policy printed from the browser breaks where its author said it would.
 */
export const PageBreak = Node.create({
  name: "pageBreak",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,

  parseHTML() {
    return [{ tag: "div[data-page-break]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-page-break": "",
        class: "bs-page-break",
      }),
    ];
  },

  addCommands() {
    return {
      setPageBreak:
        () =>
        ({ chain }) =>
          chain()
            .insertContent([{ type: "pageBreak" }, { type: "paragraph" }])
            .run(),
    };
  },

  addKeyboardShortcuts() {
    // Word's shortcut, and the one people who write policies already know.
    return { "Mod-Enter": () => this.editor.commands.setPageBreak() };
  },
});

/**
 * Every extension that defines what a document may contain.
 *
 * The reader renders with exactly this; the editor adds its typing-only
 * extensions on top.
 */
export function documentContentExtensions(): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      // Links are for following in the reader and for editing in the editor:
      // a click that navigates away mid-sentence loses somebody's place.
      link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
    }),
    // In line with the text, as Word places a picture by default — and as
    // every document written before this list existed already stores them.
    // Pictures from the author's computer are embedded — see `imageFiles.ts`.
    Image.extend({
      addAttributes() {
        return {
          ...this.parent?.(),
          // Pixels at 100% zoom, set by dragging a corner (`PictureSize`).
          // Only the width: the height follows, so it cannot be squashed.
          width: {
            default: null,
            parseHTML: (element) => pictureWidth(element.getAttribute("width")),
          },
          height: {
            default: null,
            parseHTML: () => null,
            renderHTML: () => ({}),
          },
        };
      },
    }).configure({ inline: true, allowBase64: true }),
    TextStyle,
    Color,
    FontFamily,
    FontSize,
    Highlight.configure({ multicolor: true }),
    TextAlign.configure({ types: FORMATTED_BLOCKS }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Subscript,
    Superscript,
    Table.configure({ resizable: true }),
    TableRow,
    TableCell.extend({
      addAttributes() {
        return { ...this.parent?.(), ...CELL_SHADING };
      },
    }),
    TableHeader.extend({
      addAttributes() {
        return { ...this.parent?.(), ...CELL_SHADING };
      },
    }),
    ParagraphFormat,
    PageBreak,
    TableOfContents,
  ];
}

/** An empty document: one paragraph to type into. */
export const EMPTY_DOCUMENT = {
  type: "doc",
  content: [{ type: "paragraph" }],
} as const;
