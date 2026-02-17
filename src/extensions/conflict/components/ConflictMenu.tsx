import {
  ConflictMenuPlugin,
  type ConflictMenuPluginProps,
} from "../conflict-menu-plugin";
import { useCurrentEditor } from "@tiptap/react";
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GitBranch, User, AlertTriangle, Info } from "lucide-react";

type Optional<T, K extends keyof T> = Pick<Partial<T>, K> & Omit<T, K>;

export type ConflictMenuProps = Optional<
  Omit<Optional<ConflictMenuPluginProps, "pluginKey">, "element">,
  "editor"
> &
  React.HTMLAttributes<HTMLDivElement> & {
    // Allow custom children, but we provide a default UI if none
    children?: React.ReactNode;
  };

export const ConflictMenu = React.forwardRef<HTMLDivElement, ConflictMenuProps>(
  (
    {
      pluginKey = "conflictMenu",
      editor,
      updateDelay,
      shouldShow = null,
      children,
      className,
      ...restProps
    },
    ref,
  ) => {
    const menuEl = useRef(document.createElement("div"));

    if (typeof ref === "function") {
      ref(menuEl.current);
    } else if (ref) {
      ref.current = menuEl.current;
    }

    const { editor: currentEditor } = useCurrentEditor();
    const pluginEditor = editor || currentEditor;

    const [pluginInitialized, setPluginInitialized] = useState(false);

    useEffect(() => {
      if (!pluginEditor || pluginEditor.isDestroyed) {
        return;
      }

      const conflictMenuElement = menuEl.current;
      // Initial styles
      conflictMenuElement.style.visibility = "hidden";
      conflictMenuElement.style.opacity = "0";
      conflictMenuElement.style.position = "absolute";
      conflictMenuElement.style.transition = "opacity 0.2s, visibility 0.2s";

      // Default classes for styling
      ("z-50 rounded-lg border border-gray-200 bg-white shadow-xl");

      // Append to the editor's parent node (or body if not available)
      // We need to ensure it's in the DOM for Floating UI to work correctly
      if (pluginEditor.view.dom.parentNode) {
        pluginEditor.view.dom.parentNode.appendChild(conflictMenuElement);
      } else {
        document.body.appendChild(conflictMenuElement);
      }

      const plugin = ConflictMenuPlugin({
        pluginKey,
        editor: pluginEditor,
        element: conflictMenuElement,
        updateDelay,
        shouldShow,
      });

      pluginEditor.registerPlugin(plugin);
      setPluginInitialized(true);

      return () => {
        pluginEditor.unregisterPlugin(pluginKey);
        if (conflictMenuElement.parentNode) {
          conflictMenuElement.parentNode.removeChild(conflictMenuElement);
        }
      };
    }, [pluginEditor, pluginKey, updateDelay, shouldShow, className]);

    const [tick, setTick] = useState(0);

    useEffect(() => {
      if (!pluginEditor) return;

      const handleUpdate = () => {
        setTick((t) => t + 1);
      };

      pluginEditor.on("selectionUpdate", handleUpdate);
      pluginEditor.on("transaction", handleUpdate);

      return () => {
        pluginEditor.off("selectionUpdate", handleUpdate);
        pluginEditor.off("transaction", handleUpdate);
      };
    }, [pluginEditor]);

    // If children are provided, render them. Otherwise render default UI.
    // The default UI needs to access the current selection state to show "Ours/Theirs".
    // We can use `useEditorState` or just re-render when editor updates.
    // However, this component is a Portal. It re-renders when parent re-renders.
    // `BubbleMenu` relies on the fact that `children` usually contains components that subscribe to editor state.

    // Let's implement a Default UI component that reads state
    const DefaultUI = () => {
      if (!pluginEditor) return null;

      // We need to trigger re-render on selection update to show correct content
      // But `useCurrentEditor` hook handles that context.
      // Actually, we might need a `useEditorState` type hook or just force update.
      // Tiptap's `BubbleMenu` doesn't handle content updates for you, you put your own components inside.

      // Let's implementing the logic to pull data from the active node
      const { state } = pluginEditor;
      const { selection } = state;
      const { $from } = selection;

      // Find conflict node properties
      let conflictNode: any = null;
      let conflictNodePos = -1;

      // Logic to find the node (similar to plugin) to get attributes
      state.doc.nodesBetween($from.pos, $from.pos, (node, pos) => {
        if (node.type.name === "conflict") {
          conflictNode = node;
          conflictNodePos = pos;
          return false;
        }
      });

      if (!conflictNode) {
        // Try ancestors
        for (let d = $from.depth; d > 0; d--) {
          const node = $from.node(d);
          if (node.type.name === "conflict") {
            conflictNode = node;
            conflictNodePos = $from.before(d);
            break;
          }
        }
      }

      if (!conflictNode) return null;

      const attrs = conflictNode.attrs;

      const handleResolve = (source: "theirs" | "ours") => {
        // Dispatch command or transaction
        // We can use the logic we had in Conflict.tsx
        // Ideally we should move that logic to a command.

        // For now, I'll replicate the logic here or cleaner:
        // We need the content of 'ours' vs 'theirs'.
        // The conflict node content has them.

        // ... Logic simplified for now, assuming command exists or we implement it
        // Actually, I should probably implement a command `resolveConflict` in the extension.
        // But for now, let's just log or do simple replace if possible.

        // Reimplementing logic from Conflict.tsx locally for now
        const tr = pluginEditor.state.tr;

        // Find options positions
        let theirContent = null;
        let ourContent = null;

        conflictNode.content.forEach((child: any) => {
          if (child.type.name === "conflictOption") {
            if (child.attrs.branch === "theirs") theirContent = child.content;
            if (child.attrs.branch === "ours") ourContent = child.content;
          }
        });

        const content = source === "theirs" ? theirContent : ourContent;
        if (!content) return;

        const start = conflictNodePos;
        const end = conflictNodePos + conflictNode.nodeSize;

        tr.replaceWith(start, end, content);
        pluginEditor.view.dispatch(tr);
      };

      return (
        <div className="w-[500px] bg-white rounded-lg overflow-hidden">
          <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50/50 px-3 py-2">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-500">
              <AlertTriangle size={12} className="text-amber-500" />
              Resolve Conflict
            </span>
          </div>
          <div className="p-3 grid gap-3 md:grid-cols-2">
            <button
              onClick={() => handleResolve("theirs")}
              className="group flex flex-col gap-2 rounded-md border border-blue-100 bg-blue-50/30 p-2 text-left hover:border-blue-300 hover:bg-blue-50"
            >
              <div className="flex items-center justify-between text-xs font-medium text-blue-700">
                <span className="flex items-center gap-1">
                  <GitBranch size={12} /> Incoming
                </span>
                <span className="text-blue-400">{attrs.theirBranch}</span>
              </div>
              <div className="text-xs text-gray-600 line-clamp-3">
                {/* Preview content? accessing node content here is hard without traversing. 
                                    For now just static text or generic preview */}
                Preview Incoming...
              </div>
            </button>

            <button
              onClick={() => handleResolve("ours")}
              className="group flex flex-col gap-2 rounded-md border border-emerald-100 bg-emerald-50/30 p-2 text-left hover:border-emerald-300 hover:bg-emerald-50"
            >
              <div className="flex items-center justify-between text-xs font-medium text-emerald-700">
                <span className="flex items-center gap-1">
                  <User size={12} /> Current
                </span>
                <span className="text-emerald-400">{attrs.ourBranch}</span>
              </div>
              <div className="text-xs text-gray-600 line-clamp-3">
                Preview Current...
              </div>
            </button>
          </div>
          {(attrs.base || attrs.baseCommitHash) && (
            <div className="px-3 pb-3">
              <div className="rounded border border-gray-100 bg-gray-50 p-2 text-xs text-gray-500">
                <div className="flex items-center gap-1 mb-1 font-semibold uppercase tracking-wider text-gray-400 text-[10px]">
                  <Info size={10} /> Base
                </div>
                {attrs.base}
              </div>
            </div>
          )}
        </div>
      );
    };

    return createPortal(
      <div {...restProps}>{children || <DefaultUI />}</div>,
      menuEl.current,
    );
  },
);
