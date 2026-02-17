import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { ConflictMenu } from "../components/ConflictMenu";

export const Conflict = Node.create({
  name: "conflict",
  group: "block",
  content: "conflictOption* block*", // Allows hidden options + editable content
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
    // This is where we link the UI component for the "Pick a winner" buttons
    return ReactNodeViewRenderer(ConflictMenu);
  },

  addExtensions() {
    return [ConflictOption];
  },
});

export const ConflictOption = Node.create({
  name: "conflictOption",
  content: "block+", // Allows paragraphs, lists, etc.
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
