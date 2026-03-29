import type { CommandProps } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";

import { commentAnchorPluginKey } from "./plugin";

const clampPosition = (state: EditorState, position: number) =>
  Math.max(0, Math.min(position, state.doc.content.size));

export const commentAnchorCommands = () => ({
  addCommentAnchor:
    (from: number, to: number, commentId: string) =>
    ({ state, tr, dispatch }: CommandProps) => {
      const safeFrom = clampPosition(state, Math.min(from, to));
      const safeTo = clampPosition(state, Math.max(from, to));

      if (!commentId || safeFrom === safeTo) {
        return false;
      }

      tr.setMeta(commentAnchorPluginKey, {
        type: "add",
        commentId,
        from: safeFrom,
        to: safeTo,
      });

      if (dispatch) {
        dispatch(tr);
      }

      return true;
    },

  removeCommentAnchor:
    (commentId: string) =>
    ({ tr, dispatch }: CommandProps) => {
      if (!commentId) {
        return false;
      }

      tr.setMeta(commentAnchorPluginKey, {
        type: "remove",
        commentId,
      });

      if (dispatch) {
        dispatch(tr);
      }

      return true;
    },

  setActiveComment:
    (commentId: string | null) =>
    ({ tr, dispatch }: CommandProps) => {
      tr.setMeta(commentAnchorPluginKey, {
        type: "set-active",
        commentId,
      });

      if (dispatch) {
        dispatch(tr);
      }

      return true;
    },
});
