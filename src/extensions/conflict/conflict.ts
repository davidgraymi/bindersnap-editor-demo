import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";

import { ConflictNodeView } from "./components/ConflictNodeView";

type ConflictExtensionOptions = {
  /**
   * When `true` the conflict node is replaced after resolution. When `false` the conflict nodes
   * **content** is replaced after resolution, allowing for the user to choose a different
   * resolution.
   * @default false
   */
  replaceNodeOnResolve: boolean;
};

declare module "@tiptap/core" {
  interface ConflictOptions {
    conflict: ConflictExtensionOptions;
  }
}

export const Conflict = Node.create<ConflictExtensionOptions>({
  name: "conflict",
  group: "block",
  content: "block*",
  defining: true,
  selectable: true,

  addOptions() {
    return {
      replaceNodeOnResolve: false,
    };
  },

  addAttributes() {
    return {
      conflictId: { default: null },
      // Rich text content stored as JSON arrays (ProseMirror Fragment JSON)
      ourContent: { default: null },
      theirContent: { default: null },
      baseContent: { default: undefined },
      // Branch names
      ourBranch: { default: "ours" },
      theirBranch: { default: "theirs" },
      baseBranch: { default: undefined },
      // Commit hashes
      ourCommitHash: { default: null },
      theirCommitHash: { default: null },
      baseCommitHash: { default: null },
      // Resolution state
      resolved: { default: false },
      acceptedBranch: { default: null },
    };
  },

  addCommands() {
    return {};
  },

  parseHTML() {
    return [{ tag: "conflict-node" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["conflict-node", mergeAttributes(HTMLAttributes)];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ConflictNodeView);
  },
});
