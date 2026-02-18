import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";

import { ConflictNodeView } from "./components/ConflictNodeView";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    conflict: {
      resolveConflict: (branch: "ours" | "theirs" | "manual") => ReturnType;
    };
  }
}

export const Conflict = Node.create({
  name: "conflict",
  group: "block",
  content: "block+",
  defining: true,
  selectable: true,

  addAttributes() {
    return {
      conflictId: { default: null },
      // Rich text content stored as JSON arrays (ProseMirror Fragment JSON)
      oursContent: { default: null },
      theirsContent: { default: null },
      // Branch names
      ourBranch: { default: "ours" },
      theirBranch: { default: "theirs" },
      // Base info
      base: { default: undefined },
      baseBranch: { default: undefined },
      baseCommitHash: { default: undefined },
      // Resolution state
      resolved: { default: false },
      acceptedBranch: { default: null },
    };
  },

  addCommands() {
    return {
      resolveConflict:
        (branch: "ours" | "theirs" | "manual") =>
        ({ tr, state }) => {
          // Find the conflict node at the current selection
          const { selection } = state;
          const { $from } = selection;

          let conflictPos = -1;
          let conflictNode: any = null;

          // Check ancestors for the conflict node
          for (let d = $from.depth; d > 0; d--) {
            const node = $from.node(d);
            if (node.type.name === "conflict") {
              conflictNode = node;
              conflictPos = $from.before(d);
              break;
            }
          }

          if (!conflictNode || conflictPos === -1) return false;

          if (branch === "manual") {
            // Manual: just mark as resolved, keep current content
            tr.setNodeMarkup(conflictPos, undefined, {
              ...conflictNode.attrs,
              resolved: true,
              acceptedBranch: "manual",
            });
          } else {
            // Accept ours or theirs: swap content and mark resolved
            const contentJson =
              branch === "theirs"
                ? conflictNode.attrs.theirsContent
                : conflictNode.attrs.oursContent;

            if (contentJson) {
              // Parse the JSON content back into ProseMirror nodes
              const nodes = contentJson.map((nodeJson: any) =>
                state.schema.nodeFromJSON(nodeJson),
              );

              // Replace the conflict node's content
              const start = conflictPos + 1; // Inside the node
              const end = conflictPos + conflictNode.nodeSize - 1;

              tr.replaceWith(start, end, nodes);
            }

            // Mark as resolved
            tr.setNodeMarkup(conflictPos, undefined, {
              ...conflictNode.attrs,
              resolved: true,
              acceptedBranch: branch,
            });
          }

          return true;
        },
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
});
