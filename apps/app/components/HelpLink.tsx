import type { ReactNode } from "react";

import { ICON } from "../../../packages/ui-tokens/icons";
import { helpHref, type HelpGuideSlug } from "../helpLinks";
import { AppIcon } from "./AppIcon";

/**
 * A way to the guide that answers the question this part of the page raises.
 *
 * One quiet line — the help mark and a few words saying what the guide
 * answers — beside the thing it explains. It opens in a new tab, like every
 * way to help, so reading about a step keeps the place where it was being
 * done. `iconOnly` is for a bar with no room for words; the words are still
 * its accessible name and its tooltip.
 *
 * Use it where somebody stops and asks "why?" or "what does this mean?" —
 * not on every page. The sidebar's Help already opens the guide about the
 * page on screen (`guideForRoute`).
 */
export function HelpLink({
  guide,
  section,
  iconOnly = false,
  className = "",
  children,
}: {
  guide: HelpGuideSlug;
  /** A section of the guide, by its heading in `helpGuides.ts`. */
  section?: string;
  iconOnly?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <a
      className={`bs-help-link${iconOnly ? " bs-help-link--icon" : ""}${
        className ? ` ${className}` : ""
      }`}
      href={helpHref(guide, section)}
      target="_blank"
      rel="noopener"
      title={iconOnly && typeof children === "string" ? children : undefined}
    >
      <AppIcon icon={ICON.help} size={iconOnly ? "md" : "sm"} />
      <span className={iconOnly ? "sr-only" : "bs-help-link-text"}>
        {children}
      </span>
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
