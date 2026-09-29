import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ChevronDown, type LucideIcon } from "lucide-react";

/**
 * The ribbon's building blocks: a button, a labelled group, a menu that drops
 * from a button, and the popover that holds a small form.
 *
 * **Word's ribbon, in this product's hand.** The shape is Word's — tabs over
 * groups of commands, each group named underneath, the command you reach for
 * most drawn large — because the people writing policies here have spent a
 * decade learning where Word keeps things. The type, colour and spacing are
 * Bindersnap's, so the editor reads as part of the app it sits in.
 *
 * Every control keeps the editor's selection: pressing a button with the mouse
 * would otherwise move focus off the page, and "make this bold" would find
 * nothing selected by the time it ran.
 */

/**
 * A shortcut as this computer spells it: Ctrl on Windows, ⌘ on a Mac.
 *
 * Written once as Word's Windows form and translated, so a Mac user is never
 * told to press a key their keyboard does not have.
 */
export function shortcutLabel(shortcut: string): string {
  const mac =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  if (!mac) return shortcut;
  return shortcut
    .replace(/Ctrl\+/g, "⌘")
    .replace(/Alt\+/g, "⌥")
    .replace(/Shift\+/g, "⇧");
}

/** Stop a mouse press from taking focus (and the selection) off the page. */
export const keepSelection = (event: React.MouseEvent) =>
  event.preventDefault();

interface RibbonButtonProps {
  icon: LucideIcon;
  /** Said aloud, and shown as the tooltip with the shortcut beside it. */
  label: string;
  shortcut?: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  /** Draw the label under a large icon — the group's main command. */
  large?: boolean;
  /** Draw the label beside the icon. */
  showLabel?: boolean;
  /** A colour bar under the icon, for text colour and highlight. */
  swatch?: string | null;
}

export function RibbonButton({
  icon: Icon,
  label,
  shortcut,
  onClick,
  active = false,
  disabled = false,
  large = false,
  showLabel = false,
  swatch,
}: RibbonButtonProps) {
  const tip = shortcut ? `${label} (${shortcutLabel(shortcut)})` : label;
  return (
    <button
      type="button"
      className={`bs-rb${large ? " bs-rb--large" : ""}${
        showLabel ? " bs-rb--labelled" : ""
      }${active ? " is-on" : ""}`}
      aria-label={large || showLabel ? undefined : label}
      aria-pressed={active || undefined}
      title={tip}
      disabled={disabled}
      onMouseDown={keepSelection}
      onClick={onClick}
    >
      <span className="bs-rb-icon" aria-hidden="true">
        <Icon size={large ? 22 : 16} strokeWidth={1.75} />
        {swatch !== undefined ? (
          <span
            className="bs-rb-swatch"
            style={{ background: swatch ?? "transparent" }}
          />
        ) : null}
      </span>
      {large || showLabel ? <span className="bs-rb-label">{label}</span> : null}
    </button>
  );
}

/** A named cluster of commands, the way Word groups Font and Paragraph. */
export function RibbonGroup({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`bs-rgroup ${className}`} role="group" aria-label={label}>
      <div className="bs-rgroup-body">{children}</div>
      <div className="bs-rgroup-label" aria-hidden="true">
        {label}
      </div>
    </div>
  );
}

/** A row inside a group, for the small buttons Word stacks two high. */
export function RibbonRow({ children }: { children: ReactNode }) {
  return <div className="bs-rrow">{children}</div>;
}

/**
 * Where a floating panel sits: under its button, kept on screen.
 *
 * Fixed rather than laid out, because the ribbon scrolls sideways on a narrow
 * screen and clips anything that hangs out of it.
 */
function useAnchoredPosition(
  open: boolean,
  anchor: React.RefObject<HTMLElement | null>,
  panel: React.RefObject<HTMLElement | null>,
): CSSProperties {
  const [style, setStyle] = useState<CSSProperties>({ visibility: "hidden" });

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const button = anchor.current;
      const box = panel.current;
      if (!button || !box) return;
      const rect = button.getBoundingClientRect();
      const width = box.offsetWidth;
      const height = box.offsetHeight;
      const left = Math.max(
        8,
        Math.min(rect.left, window.innerWidth - width - 8),
      );
      const below = rect.bottom + 4;
      const top =
        below + height > window.innerHeight - 8 && rect.top > height + 12
          ? rect.top - height - 4
          : below;
      setStyle({ left, top });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, anchor, panel]);

  return style;
}

/**
 * Close on Escape and on a press anywhere else — every menu in the app does,
 * and one that only closes by its own button is a trap.
 */
function useDismiss(
  open: boolean,
  onClose: () => void,
  inside: Array<React.RefObject<HTMLElement | null>>,
) {
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close.current();
      }
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (inside.some((ref) => ref.current?.contains(target))) return;
      close.current();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointer);
    };
    // The refs are stable objects; what they point at is read at event time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}

interface DropButtonProps {
  /** The trigger's visible content. */
  children: ReactNode;
  label: string;
  className?: string;
  /** What drops down. Given a way to close itself. */
  panel: (close: () => void) => ReactNode;
  panelClassName?: string;
  /** The panel is a menu of choices, not a form. */
  role?: "menu" | "listbox" | "dialog";
  disabled?: boolean;
  active?: boolean;
}

/**
 * A button that drops a panel: a menu, a palette, a small form.
 *
 * The panel is portalled to the body so the ribbon's sideways scroll cannot
 * clip it, and focus moves into it when it opens so a keyboard can reach it.
 */
export function DropButton({
  children,
  label,
  className = "",
  panel,
  panelClassName = "",
  role = "menu",
  disabled = false,
  active = false,
}: DropButtonProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const style = useAnchoredPosition(open, buttonRef, panelRef);
  const close = () => setOpen(false);
  useDismiss(open, close, [buttonRef, panelRef]);

  useEffect(() => {
    if (!open) return;
    // After the panel is placed, so focusing it does not scroll to 0,0.
    const frame = requestAnimationFrame(() => {
      const first = panelRef.current?.querySelector<HTMLElement>(
        "[aria-checked='true'], [aria-selected='true'], input, button",
      );
      first?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`bs-rdrop ${className}${active ? " is-on" : ""}`}
        aria-haspopup={role === "dialog" ? "dialog" : role}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={label}
        title={label}
        disabled={disabled}
        onMouseDown={keepSelection}
        onClick={() => setOpen((was) => !was)}
      >
        {children}
        <ChevronDown
          className="bs-rdrop-chevron"
          size={12}
          strokeWidth={2}
          aria-hidden="true"
        />
      </button>
      {open
        ? createPortal(
            <div
              ref={panelRef}
              id={id}
              role={role}
              aria-label={label}
              className={`bs-rpanel ${panelClassName}`}
              style={style}
              onMouseDown={(event) => {
                // Keep the editor's selection, except in a field somebody is
                // typing into.
                if (!(event.target instanceof HTMLInputElement)) {
                  event.preventDefault();
                }
              }}
              onKeyDown={(event) => {
                if (role === "menu" || role === "listbox") {
                  moveFocusWithArrows(event);
                }
              }}
            >
              {panel(() => {
                // Back to the button only if focus would otherwise be lost
                // with the panel. A command that put something in the page
                // has already focused the page, and that is where the next
                // keystroke belongs — taking it back to the button left a
                // picture inserted and Ctrl+S, or typing, going nowhere.
                const active = document.activeElement;
                const lost =
                  active === null ||
                  active === document.body ||
                  (panelRef.current?.contains(active) ?? false);
                close();
                if (lost) buttonRef.current?.focus({ preventScroll: true });
              })}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/** Up and Down move between a menu's items, as a native menu's do. */
function moveFocusWithArrows(event: React.KeyboardEvent<HTMLElement>) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const items = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(
      "[role='menuitem'], [role='menuitemradio'], [role='option']",
    ),
  );
  if (items.length === 0) return;
  event.preventDefault();
  const at = items.indexOf(document.activeElement as HTMLElement);
  const next =
    event.key === "ArrowDown"
      ? items[(at + 1) % items.length]
      : items[(at - 1 + items.length) % items.length];
  next?.focus();
}

/** One choice in a dropped menu. */
export function MenuChoice({
  checked,
  onPick,
  children,
  style,
  hint,
}: {
  /** Left out for a command, as against one choice of several. */
  checked?: boolean;
  onPick: () => void;
  children: ReactNode;
  style?: CSSProperties;
  hint?: string;
}) {
  return (
    <button
      type="button"
      role={checked === undefined ? "menuitem" : "menuitemradio"}
      aria-checked={checked}
      className={`bs-rmenu-item${checked ? " is-on" : ""}`}
      onClick={onPick}
    >
      <span className="bs-rmenu-text" style={style}>
        {children}
      </span>
      {hint ? <span className="bs-rmenu-hint">{hint}</span> : null}
    </button>
  );
}
