import type { ReactNode } from "react";

/**
 * The six tones a document, a change, or a review can be in — one primitive
 * standing in for the vault-status, vault-pending-badge and vault-triage-pill
 * family (see docs/design/design-system-audit.md, Task 4).
 */
export type StatusTone =
  "working" | "review" | "waiting" | "approved" | "changes" | "published";

export function StatusChip({
  tone,
  size,
  children,
  className,
}: {
  tone: StatusTone;
  /** Default is the standard chip; "sm" is for a dense row or a table cell. */
  size?: "sm";
  children: ReactNode;
  className?: string;
}) {
  const classes = [
    "bs-status",
    `bs-status--${tone}`,
    size === "sm" ? "bs-status--sm" : null,
    className ?? null,
  ]
    .filter(Boolean)
    .join(" ");

  return <span className={classes}>{children}</span>;
}
