import { Extension } from "@tiptap/core";

/**
 * Enter over a selection that runs from one paragraph into the next.
 *
 * **Tiptap's `splitBlock` throws on one shape of it**: a selection from an
 * empty paragraph to the very start of the block after it — what a triple
 * click on a blank line selects. It splits at positions it read before
 * deleting the selection, and ProseMirror refuses the step ("Inserted content
 * deeper than insertion position"), so Enter did nothing and the page showed
 * an error. ProseMirror's own command deletes the selection first and then
 * splits; this does the same, and lets the ordinary Enter handling — lists,
 * code blocks, headings — carry on from a collapsed cursor.
 *
 * First in line, so it runs before any keymap that might split.
 */
export const EnterOverSelection = Extension.create({
  name: "enterOverSelection",
  priority: 1000,

  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const { selection } = this.editor.state;
        if (selection.empty) return false;
        if (selection.$from.sameParent(selection.$to)) return false;
        this.editor.commands.deleteSelection();
        // Not handled: Enter goes on to split where the selection was.
        return false;
      },
    };
  },
});
