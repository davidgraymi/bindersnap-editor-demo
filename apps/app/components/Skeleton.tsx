import type { ReactNode } from "react";

/**
 * The shapes a page wears while it waits.
 *
 * A loading screen should look like the page that is coming, not like a box
 * that says "loading". Every placeholder here is a grey stand-in for a real
 * element on the page it covers, so the swap to real content moves nothing.
 */

/** Line widths, as a share of the row — never a pixel measurement. */
type SkeletonLineWidth = "full" | "wide" | "medium" | "short" | "tiny";

export function SkeletonLine({
  width = "wide",
  heading = false,
}: {
  width?: SkeletonLineWidth;
  /** Taller bar, for the line standing in for a headline. */
  heading?: boolean;
}) {
  return (
    <span
      className={`bs-skeleton-line bs-skeleton-line--${width}${
        heading ? " bs-skeleton-line--heading" : ""
      }`}
    />
  );
}

/** Widths a group of lines cycles through, so stacked rows never look ruled. */
const LINE_CYCLE: SkeletonLineWidth[] = ["wide", "medium", "short"];

/** A stack of lines — the body of a row, a paragraph, or a cell. */
export function SkeletonLines({ count = 2 }: { count?: number }) {
  return (
    <span className="bs-skeleton-lines">
      {Array.from({ length: count }, (_, index) => (
        <SkeletonLine
          key={index}
          width={LINE_CYCLE[index % LINE_CYCLE.length]}
        />
      ))}
    </span>
  );
}

/** A solid block: an icon square, an avatar, a badge, or a button. */
export function SkeletonShape({
  variant,
}: {
  variant: "icon" | "avatar" | "badge" | "pill";
}) {
  return <span className={`bs-skeleton-shape bs-skeleton-shape--${variant}`} />;
}

/**
 * Wraps a set of placeholders and tells a screen reader what is coming.
 *
 * The shapes say nothing out loud, so the label is the only thing announced —
 * which is exactly the sentence the old "Loading…" box used to carry.
 */
export function SkeletonGroup({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`bs-skeleton${className ? ` ${className}` : ""}`}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="bs-skeleton-label">{label}</span>
      {children}
    </div>
  );
}
