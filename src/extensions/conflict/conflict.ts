import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";

import { ConflictNodeView } from "./components/ConflictNodeView";

export const Conflict = Node.create({
  name: "conflict",
  group: "block",
  content: "block*",
  defining: true,
  selectable: true,

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
