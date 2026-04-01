import { Extension } from "@tiptap/core";

import { commentAnchorCommands } from "./commands";
import {
  commentAnchorPlugin,
  commentAnchorPluginKey,
  getCommentAnchorState,
} from "./plugin";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    commentAnchor: {
      addCommentAnchor: (
        from: number,
        to: number,
        commentId: string,
      ) => ReturnType;
      removeCommentAnchor: (commentId: string) => ReturnType;
      setActiveComment: (commentId: string | null) => ReturnType;
    };
  }
}

export const CommentAnchor = Extension.create({
  name: "commentAnchor",

  addCommands() {
    return commentAnchorCommands();
  },

  addProseMirrorPlugins() {
    return [commentAnchorPlugin()];
  },
});

export { commentAnchorPluginKey, getCommentAnchorState };
export type { CommentAnchorRecord, CommentAnchorState } from "./plugin";
