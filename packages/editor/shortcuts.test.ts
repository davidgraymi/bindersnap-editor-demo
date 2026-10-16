import { describe, expect, test } from "bun:test";
import { Editor } from "@tiptap/core";

import { SHORTCUT_GROUPS, toKeymapName } from "./shortcuts";
import { documentContentExtensions } from "./documentSchema";
import { ChangeCase } from "./extensions/ChangeCase";
import { FormatPainter } from "./extensions/FormatPainter";
import { WordKeymap } from "./extensions/WordKeymap";

describe("keyboard shortcuts", () => {
  test("Word's spelling becomes ProseMirror's", () => {
    expect(toKeymapName("Ctrl+Shift+C")).toBe("Mod-Shift-c");
    expect(toKeymapName("Ctrl+Alt+1")).toBe("Mod-Alt-1");
    expect(toKeymapName("Shift+F3")).toBe("Shift-F3");
    expect(toKeymapName("Ctrl+Enter")).toBe("Mod-Enter");
  });

  test("every shortcut the list promises is bound by an extension", () => {
    const editor = new Editor({
      extensions: [
        ...documentContentExtensions(),
        ChangeCase,
        FormatPainter,
        WordKeymap,
      ],
    });
    const bound = new Set<string>();
    for (const extension of editor.extensionManager.extensions) {
      const shortcutsOf = extension.config.addKeyboardShortcuts as
        ((this: unknown) => Record<string, unknown>) | undefined;
      const keys = shortcutsOf?.call({
        ...extension,
        editor,
        name: extension.name,
        options: extension.options,
        storage: extension.storage,
        type: undefined,
        parent: undefined,
      });
      for (const key of Object.keys(keys ?? {})) bound.add(key);
    }
    // Bound by the page around the editor or the browser, not a keymap.
    const outside = new Set([
      "Mod-s",
      "Mod-f",
      "Mod-h",
      "Mod-p",
      "Mod-/",
      "Mod-k",
      "Mod-a",
      "Mod-y",
    ]);
    const missing = SHORTCUT_GROUPS.flatMap((group) => group.items)
      .map((item) => toKeymapName(item.keys))
      .filter((key) => !outside.has(key) && !bound.has(key));
    editor.destroy();
    expect(missing).toEqual([]);
  });

  test("no key is listed twice", () => {
    const keys = SHORTCUT_GROUPS.flatMap((group) =>
      group.items.map((item) => item.keys),
    );
    expect(new Set(keys).size).toBe(keys.length);
  });
});
