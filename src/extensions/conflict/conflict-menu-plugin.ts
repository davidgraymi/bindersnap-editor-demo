import {
  type VirtualElement,
  arrow,
  autoPlacement,
  computePosition,
  flip,
  hide,
  inline,
  offset,
  shift,
  size,
} from "@floating-ui/dom";
import type { Editor } from "@tiptap/core";
import type { EditorState, PluginView, Transaction } from "@tiptap/pm/state";
import { NodeSelection, Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

export interface ConflictMenuPluginProps {
  pluginKey: PluginKey | string;
  editor: Editor;
  element: HTMLElement;
  updateDelay?: number;
  shouldShow?:
    | ((props: {
        editor: Editor;
        element: HTMLElement;
        view: EditorView;
        state: EditorState;
        oldState?: EditorState;
        from: number;
        to: number;
      }) => boolean)
    | null;
  options?: {
    permission?: "view" | "edit";
    strategy?: "absolute" | "fixed";
    placement?:
      | "top"
      | "right"
      | "bottom"
      | "left"
      | "top-start"
      | "top-end"
      | "right-start"
      | "right-end"
      | "bottom-start"
      | "bottom-end"
      | "left-start"
      | "left-end";
    offset?: Parameters<typeof offset>[0] | boolean;
    flip?: Parameters<typeof flip>[0] | boolean;
    shift?: Parameters<typeof shift>[0] | boolean;
    arrow?: Parameters<typeof arrow>[0] | false;
    size?: Parameters<typeof size>[0] | boolean;
    autoPlacement?: Parameters<typeof autoPlacement>[0] | boolean;
    hide?: Parameters<typeof hide>[0] | boolean;
    inline?: Parameters<typeof inline>[0] | boolean;

    onShow?: () => void;
    onHide?: () => void;
    onUpdate?: () => void;
  };
}

export type ConflictMenuViewProps = ConflictMenuPluginProps & {
  view: EditorView;
};

export class ConflictMenuView implements PluginView {
  public editor: Editor;

  public element: HTMLElement;

  public view: EditorView;

  public preventHide = false;

  public updateDelay: number;

  private updateDebounceTimer: number | undefined;

  public shouldShow: Exclude<ConflictMenuPluginProps["shouldShow"], null> = ({
    view,
    state,
  }) => {
    const { selection } = state;
    const { $from } = selection;

    // Check if selection is inside a 'conflict' node
    // We traverse up from the current selection depth
    let conflictNodeFound = false;

    // Check if the selection itself is a NodeSelection on a conflict node
    // We check for 'node' property to support NodeSelection duck-typing if instance check fails
    if (
      (selection instanceof NodeSelection || "node" in selection) &&
      (selection as any).node?.type?.name === "conflict"
    ) {
      conflictNodeFound = true;
    } else {
      // Check ancestors
      for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type.name === "conflict") {
          conflictNodeFound = true;
          break;
        }
      }
    }

    // Also check if we are NOT in the editor focus (unless interacting with menu)
    const isChildOfMenu = this.element.contains(document.activeElement);
    const hasEditorFocus = view.hasFocus() || isChildOfMenu;

    // If we have a NodeSelection, we might be clicking it which focuses the editor,
    // but we should ensure we don't hide it unnecessarily.
    // However, if we are editing text, we need focus.

    // For NodeSelection, sometimes focus might be ambiguous during click.
    // Let's rely on conflictNodeFound mostly.

    if (!conflictNodeFound || !this.editor.isEditable) {
      return false;
    }

    // Only check focus if we are not explicitly clicking the menu
    if (!hasEditorFocus && !isChildOfMenu) {
      return false;
    }

    return true;
  };

  constructor({
    editor,
    element,
    view,
    updateDelay = 250,
    shouldShow,
    options,
  }: ConflictMenuViewProps) {
    this.editor = editor;
    this.element = element;
    this.view = view;
    this.updateDelay = updateDelay;

    if (shouldShow) {
      this.shouldShow = shouldShow;
    }

    this.element.addEventListener("mousedown", this.mousedownHandler, {
      capture: true,
    });
    this.editor.on("focus", this.focusHandler);
    this.editor.on("blur", this.blurHandler);
    this.editor.on("transaction", this.transactionHandler);

    this.update(view, view.state);
  }

  mousedownHandler = () => {
    this.preventHide = true;
  };

  focusHandler = () => {
    setTimeout(() => this.update(this.editor.view));
  };

  blurHandler = ({ event }: { event: FocusEvent }) => {
    if (this.preventHide) {
      this.preventHide = false;
      return;
    }

    if (
      event?.relatedTarget &&
      this.element.parentNode?.contains(event.relatedTarget as Node)
    ) {
      return;
    }

    this.hide();
  };

  update(view: EditorView, oldState?: EditorState) {
    if (this.updateDelay > 0) {
      if (this.updateDebounceTimer) {
        clearTimeout(this.updateDebounceTimer);
      }
      this.updateDebounceTimer = window.setTimeout(() => {
        this.handleUpdate(view, oldState);
      }, this.updateDelay);
    } else {
      this.handleUpdate(view, oldState);
    }
  }

  handleUpdate(view: EditorView, oldState?: EditorState) {
    const selectionChanged = !oldState?.selection.eq(view.state.selection);
    const docChanged = !oldState?.doc.eq(view.state.doc);

    if (!selectionChanged && !docChanged) {
      return;
    }

    const shouldShow = this.shouldShow?.({
      editor: this.editor,
      element: this.element,
      view,
      state: view.state,
      oldState,
      from: view.state.selection.from,
      to: view.state.selection.to,
    });

    if (shouldShow) {
      this.show();
      this.updatePosition();
    } else {
      this.hide();
    }
  }

  show() {
    this.element.style.visibility = "visible";
    this.element.style.opacity = "1";
  }

  hide() {
    this.element.style.visibility = "hidden";
    this.element.style.opacity = "0";
  }

  updatePosition() {
    // Find the Conflict Node in the DOM
    const { selection } = this.editor.state;
    const { $from } = selection;

    let conflictDom: HTMLElement | null = null;

    // If NodeSelection on conflict
    if (
      (selection instanceof NodeSelection || "node" in selection) &&
      (selection as any).node?.type?.name === "conflict"
    ) {
      const node = this.view.nodeDOM(selection.from) as HTMLElement;
      if (node) {
        conflictDom = node;
      }
    }

    if (!conflictDom) {
      // Find ancestor
      // We can find the DOM node by looking for the closest element with our class
      const domAtPos = this.view.domAtPos($from.pos);
      let current = domAtPos.node as HTMLElement | null;

      // Handle text nodes
      if (current && current.nodeType === Node.TEXT_NODE) {
        current = current.parentElement;
      }

      while (current && current !== this.view.dom) {
        if (current.classList && current.classList.contains("conflict-node")) {
          conflictDom = current;
          break;
        }
        current = current.parentElement;
      }
    }

    if (!conflictDom) {
      this.hide();
      return;
    }

    const virtualElement: VirtualElement = {
      getBoundingClientRect: () => conflictDom!.getBoundingClientRect(),
      getClientRects: () => conflictDom!.getClientRects(),
      contextElement: conflictDom,
    };

    computePosition(virtualElement, this.element, {
      placement: "bottom",
      strategy: "absolute",
      middleware: [offset(10), flip(), shift({ padding: 10 })],
    }).then(({ x, y }) => {
      Object.assign(this.element.style, {
        left: `${x}px`,
        top: `${y}px`,
        position: "absolute",
      });
    });
  }

  transactionHandler = ({ transaction: tr }: { transaction: Transaction }) => {
    // Handle meta if needed
  };

  destroy() {
    this.element.removeEventListener("mousedown", this.mousedownHandler, {
      capture: true,
    });
    this.editor.off("focus", this.focusHandler);
    this.editor.off("blur", this.blurHandler);
    this.editor.off("transaction", this.transactionHandler);
  }
}

export const ConflictMenuPlugin = (options: ConflictMenuPluginProps) => {
  return new Plugin({
    key:
      typeof options.pluginKey === "string"
        ? new PluginKey(options.pluginKey)
        : options.pluginKey,
    view: (view) => new ConflictMenuView({ view, ...options }),
  });
};
