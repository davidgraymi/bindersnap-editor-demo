import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorState, Selection, Transaction } from "@tiptap/pm/state";
import type { Mapping } from "@tiptap/pm/transform";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export type CommentAnchorRecord = {
  commentId: string;
  from: number;
  to: number;
  resolved: boolean;
};

export type CommentAnchorState = {
  anchors: Map<string, CommentAnchorRecord>;
  decorations: DecorationSet;
  activeCommentId: string | null;
};

export type CommentAnchorPluginMeta =
  | {
      type: "add";
      from: number;
      to: number;
      commentId: string;
      resolved?: boolean;
    }
  | {
      type: "remove";
      commentId: string;
    }
  | {
      type: "set-active";
      commentId: string | null;
    };

export const commentAnchorPluginKey = new PluginKey<CommentAnchorState>(
  "commentAnchorState",
);

const createDecoration = (
  anchor: CommentAnchorRecord,
  isActive: boolean,
) =>
  Decoration.inline(
    anchor.from,
    anchor.to,
    {
      class: isActive
        ? "bs-comment-anchor bs-comment-anchor--active"
        : "bs-comment-anchor",
      "data-comment-id": anchor.commentId,
      "data-resolved": String(anchor.resolved),
      "data-active": String(isActive),
    },
    {
      commentId: anchor.commentId,
    },
  );

const getDecorationsForComment = (
  decorations: DecorationSet,
  commentId: string,
) =>
  decorations.find(undefined, undefined, (spec) => spec.commentId === commentId);

const syncAnchorDecoration = (
  decorations: DecorationSet,
  doc: EditorState["doc"],
  anchor: CommentAnchorRecord,
  isActive: boolean,
) => {
  const staleDecorations = getDecorationsForComment(decorations, anchor.commentId);

  return decorations
    .remove(staleDecorations)
    .add(doc, [createDecoration(anchor, isActive)]);
};

const mapAnchorRecord = (
  anchor: CommentAnchorRecord,
  mapping: Mapping,
): CommentAnchorRecord | null => {
  const from = mapping.map(anchor.from, -1);
  const to = mapping.map(anchor.to, 1);

  if (from >= to) {
    return null;
  }

  return {
    ...anchor,
    from,
    to,
  };
};

const mapAnchorRanges = (
  anchors: Map<string, CommentAnchorRecord>,
  mapping: Mapping,
) => {
  const mappedAnchors = new Map<string, CommentAnchorRecord>();

  for (const [commentId, anchor] of anchors) {
    const mappedAnchor = mapAnchorRecord(anchor, mapping);

    if (mappedAnchor) {
      mappedAnchors.set(commentId, mappedAnchor);
    }
  }

  return mappedAnchors;
};

const getCommentIdAtSelection = (
  anchors: Map<string, CommentAnchorRecord>,
  selection: Selection,
) => {
  for (const [commentId, anchor] of anchors) {
    if (selection.empty) {
      if (selection.from >= anchor.from && selection.from < anchor.to) {
        return commentId;
      }
      continue;
    }

    if (selection.from < anchor.to && selection.to > anchor.from) {
      return commentId;
    }
  }

  return null;
};

const updateActiveDecoration = (
  decorations: DecorationSet,
  doc: EditorState["doc"],
  anchors: Map<string, CommentAnchorRecord>,
  previousActiveCommentId: string | null,
  nextActiveCommentId: string | null,
) => {
  if (previousActiveCommentId === nextActiveCommentId) {
    return decorations;
  }

  let nextDecorations = decorations;

  if (previousActiveCommentId) {
    const previousAnchor = anchors.get(previousActiveCommentId);

    if (previousAnchor) {
      nextDecorations = syncAnchorDecoration(
        nextDecorations,
        doc,
        previousAnchor,
        false,
      );
    }
  }

  if (nextActiveCommentId) {
    const nextAnchor = anchors.get(nextActiveCommentId);

    if (nextAnchor) {
      nextDecorations = syncAnchorDecoration(
        nextDecorations,
        doc,
        nextAnchor,
        true,
      );
    }
  }

  return nextDecorations;
};

const addAnchor = (
  decorations: DecorationSet,
  doc: EditorState["doc"],
  anchors: Map<string, CommentAnchorRecord>,
  activeCommentId: string | null,
  meta: Extract<CommentAnchorPluginMeta, { type: "add" }>,
) => {
  const nextAnchors = new Map(anchors);
  const nextAnchor: CommentAnchorRecord = {
    commentId: meta.commentId,
    from: meta.from,
    to: meta.to,
    resolved: meta.resolved ?? false,
  };

  nextAnchors.set(meta.commentId, nextAnchor);

  const nextDecorations = syncAnchorDecoration(
    decorations,
    doc,
    nextAnchor,
    activeCommentId === meta.commentId,
  );

  return {
    anchors: nextAnchors,
    decorations: nextDecorations,
    activeCommentId,
  };
};

const removeAnchor = (
  decorations: DecorationSet,
  anchors: Map<string, CommentAnchorRecord>,
  activeCommentId: string | null,
  meta: Extract<CommentAnchorPluginMeta, { type: "remove" }>,
) => {
  const nextAnchors = new Map(anchors);
  nextAnchors.delete(meta.commentId);

  return {
    anchors: nextAnchors,
    decorations: decorations.remove(
      getDecorationsForComment(decorations, meta.commentId),
    ),
    activeCommentId:
      activeCommentId === meta.commentId ? null : activeCommentId,
  };
};

const isCommentAnchorMeta = (
  value: unknown,
): value is CommentAnchorPluginMeta =>
  !!value &&
  typeof value === "object" &&
  "type" in value &&
  typeof value.type === "string";

export const getCommentAnchorState = (state: EditorState) =>
  commentAnchorPluginKey.getState(state);

export const commentAnchorPlugin = () =>
  new Plugin<CommentAnchorState>({
    key: commentAnchorPluginKey,

    state: {
      init: () => ({
        anchors: new Map(),
        decorations: DecorationSet.empty,
        activeCommentId: null,
      }),

      apply: (tr: Transaction, pluginState) => {
        let anchors = pluginState.anchors;
        let decorations = pluginState.decorations.map(tr.mapping, tr.doc);
        let activeCommentId = pluginState.activeCommentId;

        if (tr.docChanged) {
          anchors = mapAnchorRanges(anchors, tr.mapping);

          if (activeCommentId && !anchors.has(activeCommentId)) {
            activeCommentId = null;
          }
        }

        const meta = tr.getMeta(commentAnchorPluginKey);

        if (isCommentAnchorMeta(meta)) {
          if (meta.type === "add") {
            const nextState = addAnchor(
              decorations,
              tr.doc,
              anchors,
              activeCommentId,
              meta,
            );

            anchors = nextState.anchors;
            decorations = nextState.decorations;
            activeCommentId = nextState.activeCommentId;
          }

          if (meta.type === "remove") {
            const nextState = removeAnchor(
              decorations,
              anchors,
              activeCommentId,
              meta,
            );

            anchors = nextState.anchors;
            decorations = nextState.decorations;
            activeCommentId = nextState.activeCommentId;
          }

          if (meta.type === "set-active") {
            activeCommentId = meta.commentId;
          }
        }

        if (
          tr.selectionSet &&
          !(isCommentAnchorMeta(meta) && meta.type === "set-active")
        ) {
          activeCommentId = getCommentIdAtSelection(anchors, tr.selection);
        }

        decorations = updateActiveDecoration(
          decorations,
          tr.doc,
          anchors,
          pluginState.activeCommentId,
          activeCommentId,
        );

        return {
          anchors,
          decorations,
          activeCommentId,
        };
      },
    },

    props: {
      decorations(state) {
        return commentAnchorPluginKey.getState(state)?.decorations ?? null;
      },
    },
  });
