import { Extension } from "@tiptap/core";

import {
  DEFAULT_FONT_SIZE_PT,
  parseFontSizePt,
  stepFontSize,
} from "../ribbon/options";

/**
 * The keyboard shortcuts people bring with them from Word.
 *
 * Low priority on purpose: a list and a table already own Tab (nest the item,
 * move to the next cell), and they are asked first. Only a plain paragraph
 * falls through to here, where Tab indents it the way Word's does instead of
 * moving focus out of the page mid-sentence.
 */
export const WordKeymap = Extension.create({
  name: "wordKeymap",
  priority: 50,

  addKeyboardShortcuts() {
    const size = () =>
      parseFontSizePt(this.editor.getAttributes("textStyle").fontSize) ??
      DEFAULT_FONT_SIZE_PT;

    return {
      Tab: () => this.editor.commands.indentParagraph(),
      "Shift-Tab": () => this.editor.commands.outdentParagraph(),
      "Mod-]": () =>
        this.editor.commands.setFontSize(`${stepFontSize(size(), 1)}pt`),
      "Mod-[": () =>
        this.editor.commands.setFontSize(`${stepFontSize(size(), -1)}pt`),
      "Mod-Alt-0": () => this.editor.commands.setParagraph(),
      "Mod-Alt-1": () => this.editor.commands.setHeading({ level: 1 }),
      "Mod-Alt-2": () => this.editor.commands.setHeading({ level: 2 }),
      "Mod-Alt-3": () => this.editor.commands.setHeading({ level: 3 }),
    };
  },
});
