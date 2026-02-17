import { Extension } from "@tiptap/core";
import {
  ConflictMenuPlugin,
  type ConflictMenuPluginProps,
} from "./conflict-menu-plugin";

export type ConflictMenuOptions = Omit<
  ConflictMenuPluginProps,
  "editor" | "element"
> & {
  element: HTMLElement | null;
};

export const ConflictMenuExtension = Extension.create<ConflictMenuOptions>({
  name: "conflictMenu",

  addOptions() {
    return {
      element: null,
      pluginKey: "conflictMenu",
      updateDelay: undefined,
      shouldShow: null,
    };
  },

  addProseMirrorPlugins() {
    if (!this.options.element) {
      return [];
    }

    return [
      ConflictMenuPlugin({
        pluginKey: this.options.pluginKey,
        editor: this.editor,
        element: this.options.element,
        updateDelay: this.options.updateDelay,
        options: this.options.options,
        shouldShow: this.options.shouldShow,
      }),
    ];
  },
});
