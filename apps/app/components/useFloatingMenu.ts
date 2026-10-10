import { useEffect, useRef, useState } from "react";

/** How wide a floating menu is, and how much room it needs below. */
const MENU_WIDTH = 340;
const MENU_MAX_HEIGHT = 360;

/**
 * A menu that floats over the page from a button in a panel's bar.
 *
 * **It floats rather than being laid out** because the button lives in a
 * `.bs-panel`'s bar, and a panel is a squircle — `overflow: hidden` is what
 * rounds its corners, and it cut a laid-out menu off mid-row. So the menu is
 * `position: fixed`, and this measures the button and keeps the menu on it as
 * the page scrolls under it.
 *
 * Closes on Escape and on a click elsewhere, like every other menu on the page:
 * one that only closes by its own button is a trap. `onClose` runs for both.
 */
export function useFloatingMenu(open: boolean, onClose: () => void) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close.current();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        boxRef.current &&
        !boxRef.current.contains(target)
      ) {
        close.current();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const place = () => {
      const button = buttonRef.current;
      if (!button) return;
      const rect = button.getBoundingClientRect();
      const width = Math.min(MENU_WIDTH, window.innerWidth - 16);
      const below = window.innerHeight - rect.bottom;
      setAt({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        top:
          below < MENU_MAX_HEIGHT && rect.top > below
            ? Math.max(8, rect.top - MENU_MAX_HEIGHT - 8)
            : rect.bottom + 6,
      });
    };

    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  /** The menu's inline style: on its button, or hidden until measured. */
  const style = at
    ? { left: `${at.left}px`, top: `${at.top}px` }
    : { visibility: "hidden" as const };

  return { boxRef, buttonRef, style };
}
