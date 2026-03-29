import { Extension } from "@tiptap/core";

import {
  TrackedDelete,
  TrackedInsert,
  createTrackedChangesPlugin,
  type TrackedChangesOptions,
  trackedChangesPluginKey,
} from "./plugin";
import { createTrackedChangesCommands } from "./commands";

export const TrackedChanges = Extension.create<TrackedChangesOptions>({
  name: "trackedChanges",

  addOptions() {
    return {
      author: "User",
    };
  },

  addExtensions() {
    return [TrackedInsert, TrackedDelete];
  },

  addCommands() {
    return createTrackedChangesCommands();
  },

  addProseMirrorPlugins() {
    return [createTrackedChangesPlugin(this.options.author)];
  },
});

export {
  TrackedDelete,
  TrackedInsert,
  createTrackedChangesCommands,
  createTrackedChangesPlugin,
  trackedChangesPluginKey,
};

export type {
  TrackedChangeKind,
  TrackedChangeRecord,
  TrackedChangesOptions,
  TrackedChangesPluginState,
  TrackedChangesTransactionMeta,
  TrackedMarkAttrs,
  TrackedRange,
} from "./plugin";

