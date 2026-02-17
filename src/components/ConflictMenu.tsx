import React, { useMemo } from "react";
import type { ReactNodeViewProps } from "@tiptap/react";
import { NodeViewWrapper, NodeViewContent } from "@tiptap/react";
import { GitBranch, User, Check, AlertTriangle, Info } from "lucide-react";

export const ConflictMenu = (props: ReactNodeViewProps) => {
  // Memoize the extraction of content from ConflictOption nodes
  const options = useMemo(() => {
    const opts = {
      theirs: { content: null as any, label: "Theirs" },
      ours: { content: null as any, label: "Ours" },
    };

    // The node's content is a Fragment.
    props.node.content.forEach((child) => {
      if (child.type.name === "conflictOption") {
        const branch = child.attrs.branch;
        if (branch === "theirs") {
          opts.theirs.content = child.content;
        } else if (branch === "ours") {
          opts.ours.content = child.content;
        }
      }
    });

    return opts;
  }, [props.node.content]);

  const handleResolve = (e: React.MouseEvent, source: "theirs" | "ours") => {
    e.preventDefault();
    const sourceContent = options[source].content;

    if (!sourceContent) {
      console.warn(`No content found for ${source}`);
      return;
    }

    const startPos = props.getPos();
    if (typeof startPos !== "number") {
      console.error("Cannot resolve conflict: Node position is undefined");
      return;
    }

    const { state, dispatch } = props.editor.view;
    const { tr } = state;
    const node = props.node;

    // Calculate where "editable" content begins (after all conflictOptions)
    let optionsEndOffset = 0;
    node.content.forEach((child) => {
      if (child.type.name === "conflictOption") {
        optionsEndOffset += child.nodeSize;
      }
    });

    const editableContentStart = startPos + 1 + optionsEndOffset;
    const editableContentEnd = startPos + 1 + node.content.size;

    // Delete existing editable content and insert the selected option's content
    tr.delete(editableContentStart, editableContentEnd);
    tr.insert(editableContentStart, sourceContent);

    dispatch(tr);
  };

  return (
    <NodeViewWrapper className="conflict-node group relative rounded-md border-2 border-amber-400 bg-amber-50 p-2 transition-all">
      <NodeViewContent className="conflict-content" />

      {/* Hover Bubble Menu */}
      <div className="absolute left-1/2 top-full z-50 mt-2 w-[500px] -translate-x-1/2 transform rounded-lg border border-gray-200 bg-white shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 ease-in-out">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50/50 px-3 py-2">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-500">
            <AlertTriangle size={12} className="text-amber-500" />
            Resolve Conflict
          </span>
        </div>

        <div className="p-3">
          {/* Options Grid */}
          <div className="mb-3 grid gap-3 md:grid-cols-2">
            {/* Theirs (Incoming) */}
            <div
              role="button"
              tabIndex={0}
              onClick={(e) => handleResolve(e, "theirs")}
              className="group/option flex cursor-pointer flex-col gap-2 rounded-md border border-blue-100 bg-blue-50/30 p-2 transition-all hover:border-blue-300 hover:bg-blue-50"
            >
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-medium text-blue-700">
                  <GitBranch size={12} />
                  Incoming (Theirs)
                </span>
                {props.node.attrs.theirBranch && (
                  <span className="text-[10px] text-blue-400">
                    {props.node.attrs.theirBranch}
                  </span>
                )}
              </div>
              <div className="line-clamp-3 text-xs text-gray-600">
                {options.theirs.content && options.theirs.content.size > 0 ? (
                  options.theirs.content.textBetween(
                    0,
                    options.theirs.content.size,
                    "\n",
                  )
                ) : (
                  <span className="italic text-gray-400">Empty</span>
                )}
              </div>
            </div>

            {/* Ours (Current) */}
            <div
              role="button"
              tabIndex={0}
              onClick={(e) => handleResolve(e, "ours")}
              className="group/option flex cursor-pointer flex-col gap-2 rounded-md border border-emerald-100 bg-emerald-50/30 p-2 transition-all hover:border-emerald-300 hover:bg-emerald-50"
            >
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                  <User size={12} />
                  Current (Ours)
                </span>
                {props.node.attrs.ourBranch && (
                  <span className="text-[10px] text-emerald-400">
                    {props.node.attrs.ourBranch}
                  </span>
                )}
              </div>
              <div className="line-clamp-3 text-xs text-gray-600">
                {options.ours.content && options.ours.content.size > 0 ? (
                  options.ours.content.textBetween(
                    0,
                    options.ours.content.size,
                    "\n",
                  )
                ) : (
                  <span className="italic text-gray-400">Empty</span>
                )}
              </div>
            </div>
          </div>

          {/* Base */}
          {(props.node.attrs.base || props.node.attrs.baseCommitHash) && (
            <div className="rounded border border-gray-100 bg-gray-50 p-2">
              <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                <Info size={10} />
                Original (Base)
              </div>
              <div className="line-clamp-2 text-xs text-gray-500">
                {props.node.attrs.base || "No content"}
              </div>
            </div>
          )}
        </div>
      </div>

      <style>{`
        /* Hide ConflictOption nodes in the rendered output */
        .conflict-content conflict-option {
            display: none !important;
        }
      `}</style>
    </NodeViewWrapper>
  );
};
