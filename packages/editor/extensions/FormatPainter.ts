import { Extension } from "@tiptap/core";
import type { Mark, ResolvedPos, Schema } from "@tiptap/pm/model";
import {
  Plugin,
  PluginKey,
  type EditorState,
  type Transaction,
} from "@tiptap/pm/state";

/**
 * Word's Format Painter: copy how some words look, and brush it onto others.
 *
 * Click the brush and the next words selected with the mouse take the look of
 * the words the cursor was in; double-click it and it stays on for as many as
 * you like, until Escape or another click on the brush. A click without a
 * drag paints the word under it, as Word's does. Ctrl+Alt+C and Ctrl+Alt+V
 * copy and paste a look from the keyboard, as in Google Docs — not Word's
 * Ctrl+Shift+V, which in a browser is paste as plain text and stays that.
 *
 * **The look of the words and of their paragraph.** Bold, italic,
 * underline, strikethrough, code, sub- and superscript, highlight, the font,
 * size and colour — and the paragraph's style (Normal, Title or a heading), its
 * alignment and its line spacing, as Google Docs' paint format carries them.
 * Copying only the words' look made the brush seem broken on the one look
 * people reach for most: a heading's is its paragraph's, with no marks on
 * the words at all, so painting it from a heading took everything away and
 * gave nothing. A link is not a look, and nor is an indent: that is where a
 * paragraph sits, not how it looks.
 */

/** The marks that are formatting, and so are what the brush carries. */
export const FORMATTING_MARKS = [
  "bold",
  "italic",
  "underline",
  "strike",
  "code",
  "subscript",
  "superscript",
  "highlight",
  "textStyle",
] as const;

/** The paragraphs whose style the brush carries, and gives. */
const STYLED_BLOCKS = ["paragraph", "heading"];

/** The paragraph attributes that are its look. */
const BLOCK_LOOK_ATTRS = [
  "level",
  "variant",
  "textAlign",
  "lineSpacing",
] as const;

export type Brush = "off" | "once" | "sticky";

/** A paragraph's look: Normal or a heading, its alignment, its spacing. */
export interface BlockLook {
  type: string;
  attrs: Record<string, unknown>;
}

interface PainterState {
  /** The look last copied, or null before anything has been. */
  marks: readonly Mark[] | null;
  /** Its paragraph's look, or null when it was in a list, table cell and so on. */
  block: BlockLook | null;
  brush: Brush;
}

type PainterMeta =
  | { pick: readonly Mark[]; block: BlockLook | null; brush: Brush }
  | { brush: Brush };

export const formatPainterKey = new PluginKey<PainterState>("formatPainter");

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    formatPainter: {
      /** Copy the look at the cursor, and pick up the brush with it. */
      pickUpFormatting: (brush?: Brush) => ReturnType;
      /** Put the brush down, keeping the look for Ctrl+Alt+V. */
      putDownFormatPainter: () => ReturnType;
      /** Give the selection — or the word at the cursor — the copied look. */
      pasteFormatting: () => ReturnType;
    };
  }
}

export function formatPainterState(state: EditorState): PainterState {
  return (
    formatPainterKey.getState(state) ?? {
      marks: null,
      block: null,
      brush: "off",
    }
  );
}

/** The look of the paragraph the selection starts in, if it has one to give. */
export function blockLookAt(state: EditorState): BlockLook | null {
  const parent = state.selection.$from.parent;
  if (!STYLED_BLOCKS.includes(parent.type.name)) return null;
  const attrs: Record<string, unknown> = {};
  for (const name of BLOCK_LOOK_ATTRS) {
    if (name in parent.attrs) attrs[name] = parent.attrs[name];
  }
  return { type: parent.type.name, attrs };
}

/** The look of the selection's first words, or of the cursor. */
export function formattingAt(state: EditorState): Mark[] {
  const { from, to, empty, $from } = state.selection;
  let marks: readonly Mark[] = empty
    ? (state.storedMarks ?? $from.marks())
    : [];
  if (!empty) {
    let found = false;
    state.doc.nodesBetween(from, to, (node) => {
      if (found) return false;
      if (node.isText) {
        marks = node.marks;
        found = true;
        return false;
      }
      return true;
    });
  }
  const names: readonly string[] = FORMATTING_MARKS;
  return marks.filter((mark) => names.includes(mark.type.name));
}

/**
 * Replace the formatting of a range with a look, leaving links alone — and,
 * given a paragraph's look, give it to every paragraph the range touches.
 */
export function applyFormatting(
  tr: Transaction,
  from: number,
  to: number,
  marks: readonly Mark[],
  schema: Schema,
  block: BlockLook | null = null,
): Transaction {
  for (const name of FORMATTING_MARKS) {
    const type = schema.marks[name];
    if (type) tr.removeMark(from, to, type);
  }
  for (const mark of marks) tr.addMark(from, to, mark);
  if (block) applyBlockLook(tr, from, to, block, schema);
  return tr;
}

function applyBlockLook(
  tr: Transaction,
  from: number,
  to: number,
  block: BlockLook,
  schema: Schema,
): void {
  const wanted = schema.nodes[block.type];
  if (!wanted) return;
  tr.doc.nodesBetween(from, to, (node, pos, parent, index) => {
    if (!node.isTextblock) return true;
    if (!STYLED_BLOCKS.includes(node.type.name)) return false;
    // A list item or a table cell takes a paragraph and nothing else: there
    // it keeps its type and takes the rest of the look.
    const type =
      parent && parent.canReplaceWith(index, index + 1, wanted)
        ? wanted
        : node.type;
    const attrs: Record<string, unknown> = { ...node.attrs };
    for (const name of BLOCK_LOOK_ATTRS) {
      if (!(name in (type.spec.attrs ?? {}))) {
        delete attrs[name];
      } else if (name in block.attrs) {
        attrs[name] = block.attrs[name];
      }
    }
    if (type === node.type && sameAttrs(attrs, node.attrs)) return false;
    tr.setNodeMarkup(pos, type, attrs);
    return false;
  });
}

function sameAttrs(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((key) => a[key] === b[key]);
}

const WORD = /[\p{L}\p{N}_'’-]/u;

/** The word around a position, or null between words. */
export function wordAround(
  $pos: ResolvedPos,
): { from: number; to: number } | null {
  const parent = $pos.parent;
  if (!parent.isTextblock) return null;
  // One character per leaf, so offsets in the text are offsets in the node.
  const text = parent.textBetween(0, parent.content.size, undefined, "￼");
  let start = $pos.parentOffset;
  let end = $pos.parentOffset;
  while (start > 0 && WORD.test(text[start - 1] ?? "")) start -= 1;
  while (end < text.length && WORD.test(text[end] ?? "")) end += 1;
  if (start === end) return null;
  const base = $pos.start();
  return { from: base + start, to: base + end };
}

/** The range the brush or Ctrl+Alt+V paints: the selection, or the word. */
function paintRange(state: EditorState): { from: number; to: number } | null {
  const { from, to, empty, $from } = state.selection;
  return empty ? wordAround($from) : { from, to };
}

export const FormatPainter = Extension.create({
  name: "formatPainter",

  addCommands() {
    return {
      pickUpFormatting:
        (brush = "once") =>
        ({ state, tr, dispatch }) => {
          const meta: PainterMeta = {
            pick: formattingAt(state),
            block: blockLookAt(state),
            brush,
          };
          dispatch?.(tr.setMeta(formatPainterKey, meta));
          return true;
        },
      putDownFormatPainter:
        () =>
        ({ state, tr, dispatch }) => {
          if (formatPainterState(state).brush === "off") return false;
          const meta: PainterMeta = { brush: "off" };
          dispatch?.(tr.setMeta(formatPainterKey, meta));
          return true;
        },
      pasteFormatting:
        () =>
        ({ state, tr, dispatch }) => {
          const { marks, block } = formatPainterState(state);
          const range = paintRange(state);
          if (marks === null || range === null) return false;
          if (dispatch) {
            applyFormatting(
              tr,
              range.from,
              range.to,
              marks,
              state.schema,
              block,
            );
            dispatch(tr);
          }
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      "Mod-Alt-c": () => this.editor.commands.pickUpFormatting("off"),
      "Mod-Alt-v": () => this.editor.commands.pasteFormatting(),
      Escape: () => this.editor.commands.putDownFormatPainter(),
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<PainterState>({
        key: formatPainterKey,
        state: {
          init: () => ({ marks: null, block: null, brush: "off" }),
          apply(tr, value) {
            const meta = tr.getMeta(formatPainterKey) as
              PainterMeta | undefined;
            if (!meta) return value;
            return "pick" in meta
              ? { marks: meta.pick, block: meta.block, brush: meta.brush }
              : { ...value, brush: meta.brush };
          },
        },
        props: {
          // The pointer says the brush is loaded, as Word's does.
          attributes: (state): Record<string, string> =>
            formatPainterState(state).brush === "off"
              ? {}
              : { class: "is-painting" },
        },
        // The stroke lands when the mouse comes up. The range is read from
        // the page's own selection, which the browser has already moved,
        // rather than from ProseMirror's, which catches up a moment later —
        // and a moment later a quick second click has already happened.
        view(view) {
          // One per stroke: a second click before the first has landed is a
          // second stroke, not a correction of the first.
          const timers = new Set<number>();
          const strokeRange = () => {
            const dom = view.dom.ownerDocument.getSelection();
            if (!dom || !dom.anchorNode || !dom.focusNode) return null;
            if (!view.dom.contains(dom.anchorNode)) return null;
            try {
              const anchor = view.posAtDOM(dom.anchorNode, dom.anchorOffset);
              const head = view.posAtDOM(dom.focusNode, dom.focusOffset);
              if (anchor === head) {
                return wordAround(view.state.doc.resolve(anchor));
              }
              return {
                from: Math.min(anchor, head),
                to: Math.max(anchor, head),
              };
            } catch {
              return null;
            }
          };
          const onUp = () => {
            if (formatPainterState(view.state).brush === "off") return;
            const range = strokeRange();
            // After ProseMirror's own mouseup, so the stroke is not undone
            // by it settling the selection.
            const timer = window.setTimeout(() => {
              timers.delete(timer);
              const { state } = view;
              const { marks, block, brush } = formatPainterState(state);
              if (brush === "off" || marks === null || range === null) return;
              if (range.to > state.doc.content.size) return;
              const tr = applyFormatting(
                state.tr,
                range.from,
                range.to,
                marks,
                state.schema,
                block,
              );
              if (brush === "once") {
                const meta: PainterMeta = { brush: "off" };
                tr.setMeta(formatPainterKey, meta);
              }
              view.dispatch(tr);
            }, 0);
            timers.add(timer);
          };
          view.dom.addEventListener("mouseup", onUp);
          return {
            destroy() {
              for (const pending of timers) window.clearTimeout(pending);
              view.dom.removeEventListener("mouseup", onUp);
            },
          };
        },
      }),
    ];
  },
});
