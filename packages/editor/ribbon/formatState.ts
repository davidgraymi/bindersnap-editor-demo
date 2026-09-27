import type { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { useEditorState } from "@tiptap/react";

import { shadingColor } from "../documentSchema";
import { formatPainterState } from "../extensions/FormatPainter";
import { pictureWidth } from "../imageFiles";

import type { ParagraphStyleId } from "./options";
import { HIGHLIGHT_COLORS, parseFontSizePt } from "./options";

/**
 * What the selection looks like, for the ribbon to reflect.
 *
 * Word's ribbon is a mirror as much as a set of commands: put the cursor in a
 * heading and the Styles gallery says Heading 2, in bold text and B is
 * pressed. Read through `useEditorState`, so the ribbon re-renders when one of
 * these answers changes rather than on every keystroke.
 *
 * A mixed selection answers `null` for a value — the font box goes blank, as
 * Word's does, rather than naming whichever run happened to come first.
 */
export interface FormatState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  subscript: boolean;
  superscript: boolean;
  code: boolean;
  link: boolean;
  fontFamily: string | null;
  fontSizePt: number | null;
  color: string | null;
  highlight: string | null;
  style: ParagraphStyleId | null;
  align: "left" | "center" | "right" | "justify";
  lineSpacing: string | null;
  bulletList: boolean;
  orderedList: boolean;
  taskList: boolean;
  inTable: boolean;
  canMergeCells: boolean;
  canSplitCell: boolean;
  /** The shading of the cell the cursor is in, or null for none. */
  cellShading: string | null;
  /** The Format Painter's brush is loaded. */
  painting: boolean;
  /** A picture is selected, by clicking it: the Picture tab's cue. */
  picture: boolean;
  /** Its width in pixels, or null at its own size. */
  pictureWidth: number | null;
  /** Its description, for screen readers. */
  pictureAlt: string;
  /** Something is selected — what Cut and Copy need. */
  hasSelection: boolean;
  canUndo: boolean;
  canRedo: boolean;
}

/** One value across the selection's text, or null when it varies. */
function uniformTextStyle(
  editor: Editor,
  read: (attrs: Record<string, unknown>) => unknown,
): string | null {
  const { from, to, empty } = editor.state.selection;
  if (empty) {
    const value = read(editor.getAttributes("textStyle"));
    return typeof value === "string" ? value : "";
  }

  let seen: string | undefined;
  let mixed = false;
  editor.state.doc.nodesBetween(from, to, (node) => {
    if (!node.isText || mixed) return !mixed;
    const mark = node.marks.find((entry) => entry.type.name === "textStyle");
    const raw = mark ? read(mark.attrs) : "";
    const value = typeof raw === "string" ? raw : "";
    if (seen === undefined) seen = value;
    else if (seen !== value) mixed = true;
    return true;
  });
  return mixed ? null : (seen ?? "");
}

function currentStyle(editor: Editor): ParagraphStyleId | null {
  if (editor.isActive("codeBlock")) return "code";
  for (const level of [1, 2, 3, 4] as const) {
    if (editor.isActive("heading", { level })) {
      return `heading${level}` as ParagraphStyleId;
    }
  }
  if (editor.isActive("heading")) return null;
  if (editor.isActive("blockquote")) return "quote";
  return "normal";
}

function selectedPicture(editor: Editor) {
  const { selection } = editor.state;
  return selection instanceof NodeSelection &&
    selection.node.type.name === "image"
    ? selection.node
    : null;
}

export function readFormatState(editor: Editor): FormatState {
  const picture = selectedPicture(editor);
  const family = uniformTextStyle(editor, (attrs) => attrs.fontFamily);
  const size = uniformTextStyle(editor, (attrs) => attrs.fontSize);
  const color = uniformTextStyle(editor, (attrs) => attrs.color);
  const block = editor.isActive("heading") ? "heading" : "paragraph";
  const blockAttrs = editor.getAttributes(block);
  const highlight = editor.getAttributes("highlight").color;

  return {
    bold: editor.isActive("bold"),
    italic: editor.isActive("italic"),
    underline: editor.isActive("underline"),
    strike: editor.isActive("strike"),
    subscript: editor.isActive("subscript"),
    superscript: editor.isActive("superscript"),
    code: editor.isActive("code"),
    link: editor.isActive("link"),
    fontFamily: family,
    // No size set is the document's default size, not "mixed".
    fontSizePt: size === null ? null : size === "" ? 11 : parseFontSizePt(size),
    color: color === "" ? null : color,
    highlight:
      typeof highlight === "string" && highlight !== ""
        ? highlight
        : editor.isActive("highlight")
          ? (HIGHLIGHT_COLORS[0]?.value ?? null)
          : null,
    style: currentStyle(editor),
    align:
      (["center", "right", "justify"] as const).find((align) =>
        editor.isActive({ textAlign: align }),
      ) ?? "left",
    lineSpacing:
      typeof blockAttrs.lineSpacing === "string"
        ? blockAttrs.lineSpacing
        : null,
    bulletList: editor.isActive("bulletList"),
    orderedList: editor.isActive("orderedList"),
    taskList: editor.isActive("taskList"),
    inTable: editor.isActive("table"),
    canMergeCells: editor.can().mergeCells(),
    canSplitCell: editor.can().splitCell(),
    cellShading: shadingColor(
      editor.getAttributes("tableCell").background ??
        editor.getAttributes("tableHeader").background,
    ),
    painting: formatPainterState(editor.state).brush !== "off",
    picture: picture !== null,
    pictureWidth: picture ? pictureWidth(picture.attrs.width) : null,
    pictureAlt:
      picture && typeof picture.attrs.alt === "string" ? picture.attrs.alt : "",
    hasSelection: !editor.state.selection.empty,
    canUndo: editor.can().undo(),
    canRedo: editor.can().redo(),
  };
}

const EMPTY: FormatState = {
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  subscript: false,
  superscript: false,
  code: false,
  link: false,
  fontFamily: "",
  fontSizePt: 11,
  color: null,
  highlight: null,
  style: "normal",
  align: "left",
  lineSpacing: null,
  bulletList: false,
  orderedList: false,
  taskList: false,
  inTable: false,
  canMergeCells: false,
  canSplitCell: false,
  cellShading: null,
  painting: false,
  picture: false,
  pictureWidth: null,
  pictureAlt: "",
  hasSelection: false,
  canUndo: false,
  canRedo: false,
};

/** The selection's formatting, kept current as the editor changes. */
export function useFormatState(editor: Editor | null): FormatState {
  return (
    useEditorState({
      editor,
      // A destroyed editor has no commands to ask. Tiptap tears one down when
      // React disconnects the component's effects — a Suspense boundary
      // re-suspending, StrictMode's second pass — and builds a new one when
      // they reconnect, so for a moment the old one is still in hand.
      selector: ({ editor: current }) =>
        current && !current.isDestroyed ? readFormatState(current) : EMPTY,
      equalityFn: (a, b) => {
        if (a === b) return true;
        if (!a || !b) return false;
        return (Object.keys(a) as Array<keyof FormatState>).every(
          (key) => a[key] === b[key],
        );
      },
    }) ?? EMPTY
  );
}
