import { Extension, Mark, mergeAttributes } from "@tiptap/core";
import { sanitizeHtml } from "../../utils/sanitizer";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    versionHistory: {
      /**
       * Set the content with diff highlighting
       */
      setDiffContent: (base: string, head: string) => ReturnType;
    };
  }
}

export const Insertion = Mark.create({
  name: "insertion",

  parseHTML() {
    return [{ tag: "ins" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["ins", mergeAttributes(HTMLAttributes), 0];
  },
});

export const Deletion = Mark.create({
  name: "deletion",

  parseHTML() {
    return [
      {
        tag: "span",
        getAttrs: (element) =>
          (element as HTMLElement).hasAttribute("data-deletion") && null,
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, { "data-deletion": "" }),
      0,
    ];
  },
});

export const FormatChange = Mark.create({
  name: "formatChange",

  parseHTML() {
    return [
      {
        tag: "span",
        getAttrs: (element) =>
          (element as HTMLElement).hasAttribute("data-format-change") && null,
      },
      {
        tag: "span",
        getAttrs: (element) =>
          (element as HTMLElement).classList.contains("format-change") && null,
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, { "data-format-change": "" }),
      0,
    ];
  },
});

export const VersionHistory = Extension.create({
  name: "versionHistory",

  addExtensions() {
    return [Insertion, Deletion, FormatChange];
  },

  addCommands() {
    return {
      setDiffContent:
        (base: string, head: string) =>
        ({ commands }) => {
          // const html = diffHtml(base, head);
          return commands.setContent(sanitizeHtml(head));
        },
    };
  },
});
