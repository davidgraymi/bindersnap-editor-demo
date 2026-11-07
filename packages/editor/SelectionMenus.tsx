import type { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { BubbleMenu } from "@tiptap/react/menus";
import {
  Bold,
  ClipboardPaste,
  Copy,
  Italic,
  Link as LinkIcon,
  RemoveFormatting,
  Scissors,
  Strikethrough,
  Type,
  Underline,
  type LucideIcon,
} from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import { cutOrCopy, paste } from "./clipboard";
import { keepSelection, RibbonButton, shortcutLabel } from "./ribbon/controls";
import { useFormatState } from "./ribbon/formatState";

/**
 * The menus the page itself offers, as Word's and Google Docs' do: a small
 * toolbar over words that are selected, and a menu where the page is
 * right-clicked. Both offer what the ribbon does — the same commands, so
 * neither is a second way of doing a thing that behaves differently.
 */

/**
 * Over selected words: their look, a link, and the way back to plain. Not
 * over a picture, which is selected to be sized and has its own tab, and not
 * while the right-click menu is open.
 */
export function SelectionToolbar({
  editor,
  onLink,
  hidden,
}: {
  editor: Editor;
  onLink: () => void;
  /** The right-click menu is open: one menu at a time. */
  hidden: boolean;
}) {
  const format = useFormatState(editor);
  const hiddenRef = useRef(hidden);
  hiddenRef.current = hidden;

  return (
    <BubbleMenu
      editor={editor}
      className="bs-bubble"
      role="toolbar"
      aria-label="Selected text"
      options={{ placement: "top", offset: 8 }}
      shouldShow={({ editor: current, state, from, to }) => {
        if (hiddenRef.current || !current.isEditable) return false;
        if (!current.view.hasFocus()) return false;
        if (state.selection instanceof NodeSelection) return false;
        if (from === to) return false;
        return state.doc.textBetween(from, to, " ").trim() !== "";
      }}
    >
      <RibbonButton
        icon={Bold}
        label="Bold"
        shortcut="Ctrl+B"
        active={format.bold}
        onClick={() => editor.chain().focus().toggleBold().run()}
      />
      <RibbonButton
        icon={Italic}
        label="Italic"
        shortcut="Ctrl+I"
        active={format.italic}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      />
      <RibbonButton
        icon={Underline}
        label="Underline"
        shortcut="Ctrl+U"
        active={format.underline}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      />
      <RibbonButton
        icon={Strikethrough}
        label="Strikethrough"
        active={format.strike}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      />
      <span className="bs-bubble-sep" aria-hidden="true" />
      <RibbonButton
        icon={LinkIcon}
        label="Link"
        shortcut="Ctrl+K"
        active={format.link}
        onClick={onLink}
      />
      <RibbonButton
        icon={RemoveFormatting}
        label="Clear formatting"
        onClick={() => editor.chain().focus().unsetAllMarks().run()}
      />
    </BubbleMenu>
  );
}

interface PageMenuItem {
  label: string;
  icon: LucideIcon;
  shortcut?: string;
  disabled?: boolean;
  /** A rule above it: the next set of commands. */
  separated?: boolean;
  run: () => void;
}

/**
 * Where the page is right-clicked: the clipboard, then the selection's look
 * and a link — Word's short menu rather than the browser's, which offers
 * nothing a policy needs and much it does not.
 */
export function PageContextMenu({
  editor,
  at,
  onLink,
  onClose,
}: {
  editor: Editor;
  at: { x: number; y: number };
  onLink: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState({ left: at.x, top: at.y });
  const selected = !editor.state.selection.empty;
  const format = useFormatState(editor);

  const items: PageMenuItem[] = [
    {
      label: "Cut",
      icon: Scissors,
      shortcut: "Ctrl+X",
      disabled: !selected,
      run: () => cutOrCopy(editor, "cut"),
    },
    {
      label: "Copy",
      icon: Copy,
      shortcut: "Ctrl+C",
      disabled: !selected,
      run: () => cutOrCopy(editor, "copy"),
    },
    {
      label: "Paste",
      icon: ClipboardPaste,
      shortcut: "Ctrl+V",
      run: () => void paste(editor, "source"),
    },
    {
      label: "Paste as plain text",
      icon: Type,
      shortcut: "Ctrl+Shift+V",
      run: () => void paste(editor, "text"),
    },
    {
      label: format.bold ? "Remove bold" : "Bold",
      icon: Bold,
      shortcut: "Ctrl+B",
      separated: true,
      run: () => editor.chain().focus().toggleBold().run(),
    },
    {
      label: format.italic ? "Remove italic" : "Italic",
      icon: Italic,
      shortcut: "Ctrl+I",
      run: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      label: format.underline ? "Remove underline" : "Underline",
      icon: Underline,
      shortcut: "Ctrl+U",
      run: () => editor.chain().focus().toggleUnderline().run(),
    },
    {
      label: format.link ? "Edit link…" : "Link…",
      icon: LinkIcon,
      shortcut: "Ctrl+K",
      separated: true,
      run: onLink,
    },
    {
      label: "Clear formatting",
      icon: RemoveFormatting,
      disabled: !selected,
      run: () => editor.chain().focus().unsetAllMarks().run(),
    },
  ];

  // Kept on screen: opened near an edge, it opens the other way.
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    const { width, height } = box.getBoundingClientRect();
    const margin = 8;
    setPlace({
      left: Math.max(
        margin,
        Math.min(at.x, window.innerWidth - width - margin),
      ),
      top: Math.max(
        margin,
        Math.min(at.y, window.innerHeight - height - margin),
      ),
    });
    // The menu itself takes the keys, so the arrows walk it — and no item
    // is drawn as chosen before anybody has chosen one.
    box.focus({ preventScroll: true });
  }, [at.x, at.y]);

  // Gone with a press anywhere else, a scroll or a resize, as a menu goes.
  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      if (event.target instanceof Node && ref.current?.contains(event.target)) {
        return;
      }
      onClose();
    };
    const onLeave = () => onClose();
    document.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("resize", onLeave);
    window.addEventListener("scroll", onLeave, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("resize", onLeave);
      window.removeEventListener("scroll", onLeave, true);
    };
  }, [onClose]);

  const onKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const buttons = Array.from(
      ref.current?.querySelectorAll<HTMLButtonElement>(
        "button:not(:disabled)",
      ) ?? [],
    );
    const now = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      onClose();
      editor.commands.focus();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      buttons[(now + step + buttons.length) % buttons.length]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      buttons[event.key === "Home" ? 0 : buttons.length - 1]?.focus();
    }
  };

  return (
    <div
      ref={ref}
      className="bs-rpanel bs-pagemenu"
      role="menu"
      aria-label="Page actions"
      tabIndex={-1}
      style={{ left: place.left, top: place.top }}
      onKeyDown={onKey}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item) => (
        <div key={item.label} role="none">
          {item.separated ? (
            <div className="bs-rmenu-sep" role="separator" />
          ) : null}
          <button
            type="button"
            role="menuitem"
            className="bs-rmenu-item"
            disabled={item.disabled}
            onMouseDown={keepSelection}
            onClick={() => {
              onClose();
              item.run();
            }}
          >
            <span className="bs-pagemenu-label">
              <item.icon size={15} strokeWidth={1.75} aria-hidden="true" />
              {item.label}
            </span>
            {item.shortcut ? (
              <span className="bs-rmenu-hint">
                {shortcutLabel(item.shortcut)}
              </span>
            ) : null}
          </button>
        </div>
      ))}
    </div>
  );
}
