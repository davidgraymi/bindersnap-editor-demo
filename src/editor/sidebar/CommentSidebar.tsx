import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";

import { getCommentAnchorState } from "../extensions/CommentAnchor";

export type CommentThread = {
  id: string;
  author: string;
  body: string;
  createdAt?: string;
  resolved?: boolean;
  targetText?: string;
  anchor?: {
    from: number;
    to: number;
  };
};

type CommentSidebarProps = {
  comments: CommentThread[];
  editor: Editor | null;
};

type CommentSidebarState = {
  activeCommentId: string | null;
  anchorTextById: Map<string, string>;
  anchoredCommentIds: Set<string>;
};

const readSidebarState = (editor: Editor | null): CommentSidebarState => {
  if (!editor) {
    return {
      activeCommentId: null,
      anchorTextById: new Map(),
      anchoredCommentIds: new Set(),
    };
  }

  const pluginState = getCommentAnchorState(editor.state);
  const anchorTextById = new Map<string, string>();
  const anchoredCommentIds = new Set<string>();

  for (const [commentId, anchor] of (pluginState?.anchors ?? [])) {
    anchoredCommentIds.add(commentId);
    anchorTextById.set(
      commentId,
      editor.state.doc.textBetween(anchor.from, anchor.to, " ").trim(),
    );
  }

  return {
    activeCommentId: pluginState?.activeCommentId ?? null,
    anchorTextById,
    anchoredCommentIds,
  };
};

export const CommentSidebar = ({
  comments,
  editor,
}: CommentSidebarProps) => {
  const [sidebarState, setSidebarState] = useState<CommentSidebarState>(() =>
    readSidebarState(editor),
  );

  useEffect(() => {
    if (!editor) {
      setSidebarState(readSidebarState(null));
      return;
    }

    const syncSidebarState = () => {
      setSidebarState(readSidebarState(editor));
    };

    syncSidebarState();
    editor.on("transaction", syncSidebarState);

    return () => {
      editor.off("transaction", syncSidebarState);
    };
  }, [editor]);

  return (
    <div className="bs-comment-sidebar">
      <div className="bs-comment-sidebar__header">
        <div>
          <p className="bs-comment-sidebar__eyebrow">Comment Threads</p>
          <h3 className="bs-comment-sidebar__title">Review without reply-all.</h3>
          <p className="bs-comment-sidebar__copy">
            Comments live beside the document while anchors stay attached to
            the exact text under review.
          </p>
        </div>
        <span className="bs-comment-sidebar__count">{comments.length}</span>
      </div>

      {comments.length === 0 ? (
        <div className="bs-comment-sidebar__empty">
          No comment threads are attached to this document yet.
        </div>
      ) : (
        <div className="bs-comment-sidebar__list" role="list">
          {comments.map((comment) => {
            const isActive = sidebarState.activeCommentId === comment.id;
            const isAnchored = sidebarState.anchoredCommentIds.has(comment.id);
            const excerpt =
              sidebarState.anchorTextById.get(comment.id) ??
              comment.targetText ??
              "Anchor unavailable";

            return (
              <button
                key={comment.id}
                type="button"
                role="listitem"
                className={`bs-comment-thread${isActive ? " is-active" : ""}`}
                onClick={() => editor?.commands.setActiveComment(comment.id)}
                aria-pressed={isActive}
              >
                <div className="bs-comment-thread__meta">
                  <span className="bs-comment-thread__author">
                    {comment.author}
                  </span>
                  <span className="bs-comment-thread__status">
                    {comment.createdAt ?? "Draft"}
                  </span>
                </div>
                <p className="bs-comment-thread__body">{comment.body}</p>
                <p className="bs-comment-thread__quote">“{excerpt}”</p>
                <div className="bs-comment-thread__footer">
                  <span className="bs-comment-thread__status">
                    {comment.resolved ? "Resolved" : "Open"}
                  </span>
                  <span className="bs-comment-thread__status">
                    {isAnchored ? "Anchored" : "Waiting for match"}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
