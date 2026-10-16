import { Extension } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import type { Transaction } from "@tiptap/pm/state";
import { Mapping } from "@tiptap/pm/transform";

import { wordAround } from "./FormatPainter";

/**
 * Word's Change Case: the Aa button in the Font group, and Shift+F3.
 *
 * Retyping a heading someone wrote in capitals is the chore this saves. It
 * works on the selection, or on the word the cursor is in, as Word's does;
 * the words keep their formatting because only the letters change, one for
 * one, and a letter whose other case is two letters long (ß) is left alone
 * rather than shifting everything after it.
 */

export type CaseMode = "sentence" | "lower" | "upper" | "title" | "toggle";

/** The menu, worded as Word words it: each choice written in its own case. */
export const CASE_MODES: readonly { mode: CaseMode; label: string }[] = [
  { mode: "sentence", label: "Sentence case." },
  { mode: "lower", label: "lowercase" },
  { mode: "upper", label: "UPPERCASE" },
  { mode: "title", label: "Capitalize Each Word" },
  { mode: "toggle", label: "tOGGLE cASE" },
];

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    changeCase: {
      /** Recase the selection, or the word at the cursor. */
      changeCase: (mode: CaseMode) => ReturnType;
      /** Shift+F3: UPPERCASE, then Capitalize Each Word, then lowercase. */
      cycleCase: () => ReturnType;
    };
  }
}

const LETTER = /\p{L}/u;
const WORD_CHAR = /[\p{L}\p{N}'’]/u;

/** One character in the other case, or itself if that would not be one. */
function oneFor(ch: string, to: "upper" | "lower"): string {
  const next = to === "upper" ? ch.toUpperCase() : ch.toLowerCase();
  return next.length === ch.length ? next : ch;
}

/**
 * `text[from..to]` recased, with the whole of `text` returned.
 *
 * The rest of the paragraph is there for context: whether a letter starts a
 * word or a sentence depends on what is before it, selected or not. The
 * result is always the same length, which is what lets the caller put it
 * back without moving anything else in the document.
 */
export function recaseText(
  text: string,
  from: number,
  to: number,
  mode: CaseMode,
): string {
  // By UTF-16 code unit, as ProseMirror counts positions.
  let out = "";
  let sentenceStart = true;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    const prev = i > 0 ? text[i - 1]! : "";
    const inRange = i >= from && i < to;
    let next = ch;
    if (inRange && LETTER.test(ch)) {
      if (mode === "upper") next = oneFor(ch, "upper");
      else if (mode === "lower") next = oneFor(ch, "lower");
      else if (mode === "toggle") {
        next = oneFor(ch, ch === ch.toUpperCase() ? "lower" : "upper");
      } else if (mode === "title") {
        next = oneFor(ch, WORD_CHAR.test(prev) ? "lower" : "upper");
      } else {
        next = oneFor(ch, sentenceStart ? "upper" : "lower");
      }
    }
    if (LETTER.test(ch)) sentenceStart = false;
    else if (/[.!?]/.test(ch)) sentenceStart = true;
    out += next;
  }
  return out;
}

/** Which case Shift+F3 goes to next, from the letters as they are. */
export function nextCase(text: string): CaseMode | null {
  const letters = text.replace(/[^\p{L}]/gu, "");
  if (letters === "") return null;
  if (letters === letters.toUpperCase()) return "title";
  if (recaseText(text, 0, text.length, "title") === text) return "lower";
  return "upper";
}

/** The range Change Case works on: the selection, or the cursor's word. */
function caseRange(tr: Transaction): { from: number; to: number } | null {
  const { from, to, empty, $from } = tr.selection;
  return empty ? wordAround($from) : { from, to };
}

/** Recase every paragraph the range touches, in place. */
function applyCase(
  tr: Transaction,
  from: number,
  to: number,
  mode: CaseMode,
): boolean {
  let changed = false;
  tr.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true;
    const start = pos + 1;
    // One character per leaf, so offsets in the text are offsets in the node.
    const text = node.textBetween(0, node.content.size, undefined, "￼");
    const out = recaseText(
      text,
      Math.max(from, start) - start,
      Math.min(to, start + node.content.size) - start,
      mode,
    );
    if (out === text) return false;
    node.forEach((child, offset) => {
      if (!child.isText) return;
      const end = offset + child.nodeSize;
      const piece = out.slice(offset, end);
      if (piece === child.text) return;
      tr.replaceWith(
        start + offset,
        start + end,
        tr.doc.type.schema.text(piece, child.marks),
      );
      changed = true;
    });
    return false;
  });
  return changed;
}

export const ChangeCase = Extension.create({
  name: "changeCase",

  addCommands() {
    return {
      changeCase:
        (mode) =>
        ({ tr, dispatch }) => {
          const range = caseRange(tr);
          if (range === null) return false;
          if (!dispatch) return true;
          const selection = tr.selection;
          if (!applyCase(tr, range.from, range.to, mode)) return true;
          // Every letter is replaced by one, so the selection is where it was
          // — put back exactly, not as a replace would map it.
          tr.setSelection(selection.map(tr.doc, new Mapping()));
          // One undo per press, as Word's: Shift+F3 three times quickly is
          // three steps back, not one.
          closeHistory(tr);
          dispatch(tr);
          return true;
        },
      cycleCase:
        () =>
        ({ tr, commands }) => {
          const range = caseRange(tr);
          if (range === null) return false;
          const mode = nextCase(tr.doc.textBetween(range.from, range.to, " "));
          return mode === null ? false : commands.changeCase(mode);
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      "Shift-F3": () => this.editor.commands.cycleCase(),
    };
  },
});
