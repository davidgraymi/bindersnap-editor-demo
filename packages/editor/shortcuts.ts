/**
 * The keyboard shortcuts the editor answers to, as one list — what Ctrl+/
 * shows, grouped the way Word's own list is.
 *
 * **Only what works.** Every line here is a key the editor or one of its
 * extensions binds; `shortcuts.test.ts` checks the ones that live in this
 * package's keymaps, so a shortcut dropped from the code is dropped here too
 * rather than left on a list of promises. Written in Word's Windows form and
 * spelled for a Mac by `shortcutLabel`.
 */

export interface Shortcut {
  keys: string;
  does: string;
}

export interface ShortcutGroup {
  title: string;
  items: readonly Shortcut[];
}

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  {
    title: "Document",
    items: [
      { keys: "Ctrl+S", does: "Save" },
      { keys: "Ctrl+Z", does: "Undo" },
      { keys: "Ctrl+Y", does: "Redo" },
      { keys: "Ctrl+F", does: "Find" },
      { keys: "Ctrl+H", does: "Replace" },
      { keys: "Ctrl+A", does: "Select all" },
      { keys: "Ctrl+P", does: "Print" },
      { keys: "Ctrl+/", does: "Show keyboard shortcuts" },
    ],
  },
  {
    title: "Text",
    items: [
      { keys: "Ctrl+B", does: "Bold" },
      { keys: "Ctrl+I", does: "Italic" },
      { keys: "Ctrl+U", does: "Underline" },
      { keys: "Ctrl+Shift+S", does: "Strikethrough" },
      { keys: "Ctrl+,", does: "Subscript" },
      { keys: "Ctrl+.", does: "Superscript" },
      { keys: "Ctrl+Shift+H", does: "Highlight" },
      { keys: "Ctrl+]", does: "Bigger font" },
      { keys: "Ctrl+[", does: "Smaller font" },
      { keys: "Shift+F3", does: "Change case" },
      { keys: "Ctrl+Shift+C", does: "Copy formatting" },
      { keys: "Ctrl+Shift+V", does: "Paste formatting" },
    ],
  },
  {
    title: "Paragraphs",
    items: [
      { keys: "Ctrl+Alt+0", does: "Normal text" },
      { keys: "Ctrl+Alt+1", does: "Heading 1" },
      { keys: "Ctrl+Alt+2", does: "Heading 2" },
      { keys: "Ctrl+Alt+3", does: "Heading 3" },
      { keys: "Ctrl+Shift+8", does: "Bullets" },
      { keys: "Ctrl+Shift+7", does: "Numbering" },
      { keys: "Ctrl+Shift+9", does: "Checklist" },
      { keys: "Ctrl+Shift+L", does: "Align left" },
      { keys: "Ctrl+Shift+E", does: "Center" },
      { keys: "Ctrl+Shift+R", does: "Align right" },
      { keys: "Ctrl+Shift+J", does: "Justify" },
      { keys: "Tab", does: "Indent" },
      { keys: "Shift+Tab", does: "Decrease indent" },
    ],
  },
  {
    title: "Insert",
    items: [
      { keys: "Ctrl+K", does: "Link" },
      { keys: "Ctrl+Enter", does: "Page break" },
      { keys: "Shift+Enter", does: "Line break" },
    ],
  },
];

/**
 * Word's form of a key as ProseMirror binds it: `Ctrl+Shift+C` is
 * `Mod-Shift-c`. For checking the list against the keymaps.
 */
export function toKeymapName(keys: string): string {
  return keys
    .split("+")
    .map((part) =>
      part === "Ctrl" ? "Mod" : part.length === 1 ? part.toLowerCase() : part,
    )
    .join("-");
}
