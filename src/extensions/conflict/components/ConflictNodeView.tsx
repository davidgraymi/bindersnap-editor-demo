import { useMemo, useState, useCallback } from "react";
import { NodeViewWrapper, NodeViewContent } from "@tiptap/react";
import type { ReactNodeViewProps } from "@tiptap/react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  GitBranch,
  GitCommitVertical,
} from "lucide-react";

/**
 * Renders a single ProseMirror content JSON array as read-only HTML.
 * This is a lightweight approach — we parse the JSON into simple HTML
 * rather than spinning up a full Tiptap editor instance.
 */
const RichTextPreview = ({
  content,
  label,
  branchName,
  color,
  icon: Icon,
}: {
  content: any[] | null;
  label: string;
  branchName: string;
  color: string;
  icon: React.ComponentType<{ size: number }>;
}) => {
  const c = {
    border: `border-${color}-200`,
    bg: `bg-${color}-50/40`,
    header: `bg-${color}-50`,
    text: `text-${color}-700`,
    dimText: `text-${color}-400`,
  };

  // Convert ProseMirror JSON to simple HTML for preview
  const html = useMemo(() => {
    if (!content) return "<p><em>No content</em></p>";
    return content.map((node: any) => renderNodeToHTML(node)).join("");
  }, [content]);

  return (
    <div
      className={`flex flex-col rounded-md border ${c.border} overflow-hidden`}
    >
      <div
        className={`flex items-center justify-between px-3 py-1.5 ${c.header}`}
      >
        <span
          className={`flex items-center gap-1.5 text-xs font-semibold ${c.text}`}
        >
          <Icon size={12} />
          {label}
        </span>
        <span className={`text-[10px] font-medium ${c.dimText}`}>
          {branchName}
        </span>
      </div>
      <div
        className={`p-3 text-sm leading-relaxed ${c.bg} prose prose-sm max-w-none`}
        // biome-ignore lint: Rich text preview from trusted source
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
};

/** Recursively convert a ProseMirror JSON node to HTML string */
function renderNodeToHTML(node: any): string {
  if (!node) return "";

  if (node.type === "text") {
    let text = escapeHTML(node.text || "");
    if (node.marks) {
      for (const mark of node.marks) {
        switch (mark.type) {
          case "bold":
            text = `<strong>${text}</strong>`;
            break;
          case "italic":
            text = `<em>${text}</em>`;
            break;
          case "underline":
            text = `<u>${text}</u>`;
            break;
          case "strike":
            text = `<s>${text}</s>`;
            break;
          case "code":
            text = `<code>${text}</code>`;
            break;
        }
      }
    }
    return text;
  }

  const children = (node.content || [])
    .map((child: any) => renderNodeToHTML(child))
    .join("");

  switch (node.type) {
    case "paragraph":
      return `<p>${children || "&nbsp;"}</p>`;
    case "heading": {
      const level = node.attrs?.level || 1;
      return `<h${level}>${children}</h${level}>`;
    }
    case "bulletList":
      return `<ul>${children}</ul>`;
    case "orderedList":
      return `<ol>${children}</ol>`;
    case "listItem":
      return `<li>${children}</li>`;
    case "blockquote":
      return `<blockquote>${children}</blockquote>`;
    case "codeBlock":
      return `<pre><code>${children}</code></pre>`;
    case "hardBreak":
      return "<br />";
    default:
      return children;
  }
}

function escapeHTML(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const ConflictNodeView = (props: ReactNodeViewProps) => {
  const { editor, node, getPos, updateAttributes } = props;

  const resolved = node.attrs.resolved;
  const acceptedBranch = node.attrs.acceptedBranch;
  const [isExpanded, setIsExpanded] = useState(false);

  const wrapperClass = useMemo(() => {
    if (resolved) {
      return "conflict-node relative rounded-md border-2 border-green-400 transition-all my-2";
    }
    return "conflict-node relative rounded-md border-2 border-amber-400 transition-all my-2";
  }, [resolved]);

  const handleResolve = useCallback(
    (branch: "ours" | "theirs" | "manual") => {
      const pos = getPos();
      if (pos === undefined) return;

      const { state } = editor;
      const conflictNode = state.doc.nodeAt(pos);
      if (!conflictNode) return;

      const tr = state.tr;
      const contentJson =
        branch === "theirs"
          ? conflictNode.attrs.theirsContent
          : conflictNode.attrs.oursContent;

      if (contentJson && branch !== "manual") {
        // Parse the JSON content back into ProseMirror nodes
        const nodes = contentJson.map((nodeJson: any) =>
          state.schema.nodeFromJSON(nodeJson),
        );

        // Replace the conflict node's content
        const start = pos + 1;
        const end = pos + conflictNode.nodeSize - 1;
        tr.replaceWith(start, end, nodes);
      }

      // Update attributes to mark as resolved
      // After replaceWith, we need to re-find the node at pos
      tr.setNodeMarkup(pos, undefined, {
        ...conflictNode.attrs,
        resolved: true,
        acceptedBranch: branch,
      });

      editor.view.dispatch(tr);
      setIsExpanded(false);
    },
    [editor, getPos],
  );

  const branchLabel = useMemo(() => {
    switch (acceptedBranch) {
      case "ours":
        return `${node.attrs.ourBranch} (ours)`;
      case "theirs":
        return `${node.attrs.theirBranch} (theirs)`;
      case "manual":
        return "manual";
      default:
        return "";
    }
  }, [acceptedBranch, node.attrs.ourBranch, node.attrs.theirBranch]);

  return (
    <NodeViewWrapper
      className={wrapperClass}
      id={`conflict-id-${node.attrs.conflictId}`}
    >
      {/* Header bar */}
      {resolved ? (
        <div className="flex justify-between">
          <div className="flex w-fit items-center gap-1 rounded-br-md bg-green-400 px-2 py-0.5 text-xs font-medium text-green-900">
            <Check size={12} strokeWidth={3} />
            Resolved — {branchLabel}
          </div>
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium bg-transparent text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
            contentEditable={false}
          >
            {isExpanded ? (
              <>
                <ChevronUp size={12} /> Collapse
              </>
            ) : (
              <>
                <ChevronDown size={12} /> Compare
              </>
            )}
          </button>
        </div>
      ) : (
        <div className="flex justify-between">
          <div className="flex w-fit items-center gap-1 rounded-br-md bg-amber-400 px-2 py-0.5 text-xs font-medium text-gray-700">
            <AlertTriangle size={12} />
            Conflict
          </div>
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium bg-transparent text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
            contentEditable={false}
          >
            {isExpanded ? (
              <>
                <ChevronUp size={12} /> Collapse
              </>
            ) : (
              <>
                <ChevronDown size={12} /> Compare
              </>
            )}
          </button>
        </div>
      )}

      {/* Main content (editable) */}
      <NodeViewContent className="conflict-content px-3 py-2" />

      {/* Side-by-side comparison panel (inline, not a portal) */}
      {isExpanded && (
        <div
          className="rounded-b-md border-t border-gray-200 bg-gray-50/50 p-3"
          contentEditable={false}
        >
          <div className="grid grid-cols-2 gap-3 mb-3">
            <RichTextPreview
              content={node.attrs.oursContent}
              label="Ours"
              branchName={node.attrs.ourBranch}
              color="orange"
              icon={GitCommitVertical}
            />
            <RichTextPreview
              content={node.attrs.theirsContent}
              label="Theirs"
              branchName={node.attrs.theirBranch}
              color="blue"
              icon={GitBranch}
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleResolve("ours")}
              className="flex-1 rounded-md border border-orange-200 bg-orange-50 px-3 py-1.5 text-xs font-semibold text-orange-700 hover:bg-orange-100 transition-colors"
            >
              Accept Ours
            </button>
            <button
              type="button"
              onClick={() => handleResolve("theirs")}
              className="flex-1 rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 transition-colors"
            >
              Accept Theirs
            </button>
            <button
              type="button"
              onClick={() => handleResolve("manual")}
              className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-50 transition-colors"
            >
              Keep as-is
            </button>
          </div>
        </div>
      )}
    </NodeViewWrapper>
  );
};
