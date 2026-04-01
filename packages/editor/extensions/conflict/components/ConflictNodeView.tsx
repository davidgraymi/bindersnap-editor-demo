import { useMemo, useCallback } from "react";
import { NodeViewWrapper, NodeViewContent } from "@tiptap/react";
import type { ReactNodeViewProps } from "@tiptap/react";
import { DOMSerializer } from "@tiptap/pm/model";
import type { Editor } from "@tiptap/core";

type BranchType = "ours" | "theirs" | "manual";

/**
 * Renders ProseMirror content JSON using the editor's own schema
 * via DOMSerializer — identical rendering to the main editor.
 */
const RichTextPreview = ({
  editor,
  content,
}: {
  editor: Editor;
  content: any[] | null | undefined;
}) => {
  const html = useMemo(() => {
    if (!content || content.length === 0) return "";
    try {
      const { schema } = editor;
      const doc = schema.nodeFromJSON({ type: "doc", content });
      const serializer = DOMSerializer.fromSchema(schema);
      const fragment = serializer.serializeFragment(doc.content);
      const wrapper = document.createElement("div");
      wrapper.appendChild(fragment);
      return wrapper.innerHTML;
    } catch {
      return "";
    }
  }, [content, editor]);

  return (
    <div
      className="bs-conflict__preview"
      // biome-ignore lint: Rich text preview from trusted source
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};

export const ConflictNodeView = (props: ReactNodeViewProps) => {
  const { editor, node, getPos, extension } = props;

  const resolved = node.attrs.resolved;
  const acceptedBranch = node.attrs.acceptedBranch;
  const replaceNodeOnResolve = extension.options.replaceNodeOnResolve;
  const hasBase = Array.isArray(node.attrs.baseContent);

  const handleResolve = useCallback(
    (branch: BranchType) => {
      const pos = getPos();
      if (pos === undefined) return;

      const { state } = editor;
      const conflictNode = state.doc.nodeAt(pos);
      if (!conflictNode) return;

      const tr = state.tr;

      /** In the case the user chooses to accept a manual resolution and the replaceNodeOnResolve
       * option is false, we just update the attributes to mark as resolved.
       */
      if (!(branch === "manual" && !replaceNodeOnResolve)) {
        const getContent = () => {
          switch (branch) {
            case "theirs":
              return (conflictNode.attrs.theirContent ?? []).map((nodeJson: any) =>
                state.schema.nodeFromJSON(nodeJson),
              );
            case "ours":
              return (conflictNode.attrs.ourContent ?? []).map((nodeJson: any) =>
                state.schema.nodeFromJSON(nodeJson),
              );
            case "manual":
              return conflictNode.content;
            default:
              return [];
          }
        };
        const nodes = getContent();

        // Replace the conflict node's content
        const offset = replaceNodeOnResolve ? 0 : 1;
        const start = pos + offset;
        const end = pos + conflictNode.nodeSize - offset;
        tr.replaceWith(start, end, nodes);
      }

      // Update attributes to mark as resolved
      tr.setNodeMarkup(pos, undefined, {
        ...conflictNode.attrs,
        resolved: true,
        acceptedBranch: branch,
      });

      editor.view.dispatch(tr);
    },
    [editor, getPos, replaceNodeOnResolve],
  );

  const branchLabel = useMemo(() => {
    switch (acceptedBranch) {
      case "ours":
        return `${node.attrs.ourBranch} (yours)`;
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
      className={`bs-conflict${resolved ? " bs-conflict--resolved" : ""}`}
      id={`conflict-id-${node.attrs.conflictId}`}
    >
      <div className="bs-conflict__zone bs-conflict__zone--ours">
        <div className="bs-conflict__label">
          Current (yours)
          <span className="bs-conflict__branch">{node.attrs.ourBranch}</span>
        </div>
        <NodeViewContent className="bs-conflict__content" />
      </div>

      {hasBase && (
        <>
          <div className="bs-conflict__divider">
            <span>======= base</span>
          </div>
          <div
            className="bs-conflict__zone bs-conflict__zone--base"
            contentEditable={false}
          >
            <div className="bs-conflict__label">
              Base
              <span className="bs-conflict__branch">
                {node.attrs.baseBranch || "base"}
              </span>
            </div>
            <RichTextPreview editor={editor} content={node.attrs.baseContent} />
          </div>
        </>
      )}

      <div className="bs-conflict__divider">
        <span>======= incoming</span>
        {resolved && branchLabel ? (
          <span className="bs-conflict__resolved-note">Resolved — {branchLabel}</span>
        ) : null}
      </div>

      <div
        className="bs-conflict__zone bs-conflict__zone--theirs"
        contentEditable={false}
      >
        <div className="bs-conflict__label">
          Incoming
          <span className="bs-conflict__branch">{node.attrs.theirBranch}</span>
        </div>
        <RichTextPreview editor={editor} content={node.attrs.theirContent} />
      </div>

      {!resolved && (
        <div className="bs-conflict__actions" contentEditable={false}>
          <button
            type="button"
            onClick={() => handleResolve("ours")}
            className="bs-conflict__resolve-btn bs-conflict__resolve-btn--accept-ours"
          >
            Accept Yours
          </button>
          <button
            type="button"
            onClick={() => handleResolve("theirs")}
            className="bs-conflict__resolve-btn bs-conflict__resolve-btn--accept-theirs"
          >
            Accept Theirs
          </button>
          <button
            type="button"
            onClick={() => handleResolve("manual")}
            className="bs-conflict__resolve-btn bs-conflict__resolve-btn--accept-both"
          >
            Keep Both
          </button>
        </div>
      )}
    </NodeViewWrapper>
  );
};
