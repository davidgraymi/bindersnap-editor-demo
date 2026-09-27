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
 * drag paints the word under it, as Word's does. Ctrl+Shift+C and
 * Ctrl+Shift+V copy and paste a look from the keyboard, also as in Word.
 *
 * **The look of the words, not of the paragraph.** Bold, italic, underline,
 * strikethrough, code, sub- and superscript, highlight, and the font, size
 * and colour. A link is not a look, and a heading is a style the Styles
 * gallery already sets in one click.
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

export type Brush = "off" | "once" | "sticky";

interface PainterState {
  /** The look last copied, or null before anything has been. */
  marks: readonly Mark[] | null;
  brush: Brush;
}

type PainterMeta = { pick: readonly Mark[]; brush: Brush } | { brush: Brush };

export const formatPainterKey = new PluginKey<PainterState>("formatPainter");

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    formatPainter: {
      /** Copy the look at the cursor, and pick up the brush with it. */
      pickUpFormatting: (brush?: Brush) => ReturnType;
      /** Put the brush down, keeping the look for Ctrl+Shift+V. */
      putDownFormatPainter: () => ReturnType;
      /** Give the selection — or the word at the cursor — the copied look. */
      pasteFormatting: () => ReturnType;
    };
  }
}

export function formatPainterState(state: EditorState): PainterState {
  return formatPainterKey.getState(state) ?? { marks: null, brush: "off" };
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

/** Replace the formatting of a range with a look, leaving links alone. */
export function applyFormatting(
  tr: Transaction,
  from: number,
  to: number,
  marks: readonly Mark[],
  schema: Schema,
): Transaction {
  for (const name of FORMATTING_MARKS) {
    const type = schema.marks[name];
    if (type) tr.removeMark(from, to, type);
  }
  for (const mark of marks) tr.addMark(from, to, mark);
  return tr;
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

/** The range the brush or Ctrl+Shift+V paints: the selection, or the word. */
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
          const meta: PainterMeta = { pick: formattingAt(state), brush };
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
          const { marks } = formatPainterState(state);
          const range = paintRange(state);
          if (marks === null || range === null) return false;
          if (dispatch) {
            applyFormatting(tr, range.from, range.to, marks, state.schema);
            dispatch(tr);
          }
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      "Mod-Shift-c": () => this.editor.commands.pickUpFormatting("off"),
      // Nothing copied, and the browser's own paste-as-plain-text still runs.
      "Mod-Shift-v": () => this.editor.commands.pasteFormatting(),
      Escape: () => this.editor.commands.putDownFormatPainter(),
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<PainterState>({
        key: formatPainterKey,
        state: {
          init: () => ({ marks: null, brush: "off" }),
          apply(tr, value) {
            const meta = tr.getMeta(formatPainterKey) as
              PainterMeta | undefined;
            if (!meta) return value;
            return "pick" in meta
              ? { marks: meta.pick, brush: meta.brush }
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
          let timer: number | undefined;
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
            window.clearTimeout(timer);
            // After ProseMirror's own mouseup, so the stroke is not undone
            // by it settling the selection.
            timer = window.setTimeout(() => {
              const { state } = view;
              const { marks, brush } = formatPainterState(state);
              if (brush === "off" || marks === null || range === null) return;
              if (range.to > state.doc.content.size) return;
              const tr = applyFormatting(
                state.tr,
                range.from,
                range.to,
                marks,
                state.schema,
              );
              if (brush === "once") {
                const meta: PainterMeta = { brush: "off" };
                tr.setMeta(formatPainterKey, meta);
              }
              view.dispatch(tr);
            }, 0);
          };
          view.dom.addEventListener("mouseup", onUp);
          return {
            destroy() {
              window.clearTimeout(timer);
              view.dom.removeEventListener("mouseup", onUp);
            },
          };
        },
      }),
    ];
  },
});
