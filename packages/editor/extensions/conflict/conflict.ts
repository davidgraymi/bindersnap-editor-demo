import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";

import { ConflictNodeView } from "./components/ConflictNodeView";

// --- Public types ---

export type ConflictInfo = {
  /** The conflict ID from the node attribute. */
  id: string | number;
  /** Absolute document position of the conflict node. */
  pos: number;
  /** Whether this conflict has been resolved. */
  resolved: boolean;
  /** Which branch was accepted, or null if unresolved. */
  acceptedBranch: string | null;
};

export type ConflictStorage = {
  /** Map of conflictId → ConflictInfo, rebuilt on every doc change. */
  conflicts: Map<string | number, ConflictInfo>;
  unresolved: number;
  resolved: number;
  total: number;
};

// --- Extension options ---

type ConflictOptions = {
  /**
   * When `true` the conflict node is replaced after resolution. When `false` the conflict node's
   * **content** is replaced after resolution, allowing for the user to choose a different
   * resolution.
   * @default false
   */
  replaceNodeOnResolve: boolean;
};

// --- Module augmentation ---

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    conflict: {
      /**
       * Scroll the editor viewport so the conflict with the given ID is visible.
       */
      scrollToConflict: (conflictId: string | number) => ReturnType;
    };
  }

  interface ExtensionStorage {
    conflict: ConflictStorage;
  }
}

// --- Plugin key (exported so tests / external code can read plugin state if needed) ---

export const conflictPluginKey = new PluginKey("conflictState");

// --- Extension ---

export const Conflict = Node.create<ConflictOptions, ConflictStorage>({
  name: "conflict",
  group: "block",
  content: "block*",
  defining: true,
  selectable: true,

  addOptions(): ConflictOptions {
    return {
      replaceNodeOnResolve: false,
    };
  },

  addStorage(): ConflictStorage {
    return {
      conflicts: new Map(),
      unresolved: 0,
      resolved: 0,
      total: 0,
    };
  },

  addAttributes() {
    return {
      conflictId: { default: null },
      // Rich text content stored as JSON arrays (ProseMirror Fragment JSON)
      ourContent: { default: null },
      theirContent: { default: null },
      baseContent: { default: undefined },
      // Branch names
      ourBranch: { default: "ours" },
      theirBranch: { default: "theirs" },
      baseBranch: { default: undefined },
      // Commit hashes
      ourCommitHash: { default: null },
      theirCommitHash: { default: null },
      baseCommitHash: { default: null },
      // Resolution state
      resolved: { default: false },
      acceptedBranch: { default: null },
    };
  },

  addCommands() {
    return {
      scrollToConflict:
        (conflictId: string | number) =>
        ({ editor }) => {
          const info = this.storage.conflicts.get(conflictId);
          if (!info) return false;

          // Scroll the node into view
          const { view } = editor;
          const dom = view.nodeDOM(info.pos);
          if (dom instanceof HTMLElement) {
            dom.scrollIntoView({ behavior: "smooth", block: "center" });
          }

          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    const extensionStorage = this.storage;

    return [
      new Plugin({
        key: conflictPluginKey,

        view: () => ({
          /**
           * Called after every state update that reaches the view.
           * We rebuild the conflict map here so storage is always fresh.
           */
          update: (view) => {
            const { doc } = view.state;
            const conflicts = new Map<string | number, ConflictInfo>();
            let resolved = 0;
            let unresolved = 0;

            doc.descendants((node, pos) => {
              if (node.type.name === "conflict") {
                const id = node.attrs.conflictId;
                if (id != null) {
                  conflicts.set(id, {
                    id,
                    pos,
                    resolved: !!node.attrs.resolved,
                    acceptedBranch: node.attrs.acceptedBranch ?? null,
                  });
                }
                if (node.attrs.resolved) {
                  resolved++;
                } else {
                  unresolved++;
                }
                return false; // don't descend into conflict children
              }
              return true;
            });

            extensionStorage.conflicts = conflicts;
            extensionStorage.resolved = resolved;
            extensionStorage.unresolved = unresolved;
            extensionStorage.total = conflicts.size;
          },
        }),
      }),
    ];
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
