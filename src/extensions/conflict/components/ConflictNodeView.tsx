import React from "react";
import { NodeViewWrapper, NodeViewContent } from "@tiptap/react";
import type { ReactNodeViewProps } from "@tiptap/react";

export const ConflictNodeView = (props: ReactNodeViewProps) => {
  return (
    <NodeViewWrapper className="conflict-node relative rounded-md border-2 border-amber-400 bg-amber-50 p-2 transition-all">
      <NodeViewContent className="conflict-content" />
      <style>{`
        .conflict-content conflict-option[branch="theirs"] {
            display: none;
        }
        .conflict-content conflict-option[branch="ours"] {
            display: block;
        }
      `}</style>
    </NodeViewWrapper>
  );
};
