import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

/** As tall as `.rev-picker-float` lets it grow, for deciding above or below. */
const MAX_HEIGHT = 320;

/**
 * A search box's results, floating under it instead of pushing the page down.
 *
 * **Fixed, and measured from the box.** The boxes this serves sit inside a
 * `.bs-panel`, whose `overflow: hidden` is what rounds its corners — a list
 * absolutely positioned inside it would be cut off at the panel's edge, the
 * bug the reviewer picker on a change once had. So the list is `position:
 * fixed`, as wide as the box, under it (or above it, when the window ends
 * first), and follows it on scroll and resize.
 *
 * Escape or a press anywhere outside the box and the list closes it.
 */
export function FloatingResults({
  anchor,
  onClose,
  children,
}: {
  anchor: RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [at, setAt] = useState<{
    left: number;
    top: number;
    width: number;
  } | null>(null);

  const place = () => {
    const box = anchor.current;
    if (!box) return;
    const rect = box.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom;
    const next = {
      left: rect.left,
      width: rect.width,
      top:
        below < MAX_HEIGHT && rect.top > below
          ? Math.max(8, rect.top - Math.min(MAX_HEIGHT, rect.top - 8) - 4)
          : rect.bottom + 4,
    };
    setAt((current) =>
      current &&
      current.left === next.left &&
      current.top === next.top &&
      current.width === next.width
        ? current
        : next,
    );
  };

  // Every render, not once: picking an approver adds a row above the box and
  // moves it, and nothing scrolls or resizes to say so.
  useLayoutEffect(place);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (anchor.current?.contains(target)) return;
      if (listRef.current?.contains(target)) return;
      onClose();
    };
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  });

  return (
    <div
      ref={listRef}
      className="rev-picker-float"
      style={
        at
          ? { left: `${at.left}px`, top: `${at.top}px`, width: `${at.width}px` }
          : { visibility: "hidden" }
      }
    >
      {children}
    </div>
  );
}
