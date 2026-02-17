import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { ConflictNodeView } from "./components/ConflictNodeView";

export const Conflict = Node.create({
  name: "conflict",
  group: "block",
  content: "conflictOption* block*",
  defining: true,
  selectable: true,

  addAttributes() {
    return {
      conflictId: { default: null },
      base: { default: undefined },
      baseBranch: { default: undefined },
      baseCommitHash: { default: undefined },
    };
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

  addExtensions() {
    return [ConflictOption];
  },
});

export const ConflictOption = Node.create({
  name: "conflictOption",
  content: "block+",
  addAttributes() {
    return {
      branch: { default: undefined },
    };
  },
  parseHTML() {
    return [{ tag: "conflict-option" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["conflict-option", mergeAttributes(HTMLAttributes)];
  },
});
