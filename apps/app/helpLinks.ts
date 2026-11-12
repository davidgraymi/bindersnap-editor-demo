/**
 * Help, from where the question comes up.
 *
 * The guides are pages on the public site (`apps/help`), and the app had one
 * way to them: "Help and guides" in the sidebar, which opened the list of all
 * of them. Somebody stuck on a change request had to know that the guide they
 * wanted was called "Reviewing a change". Two things here fix that:
 *
 * - `guideForRoute` names the guide about the page on screen, so the same
 *   sidebar link opens the right one. The guide's own page lists every other
 *   guide beside it, so nothing is further away than it was.
 * - `helpHref` builds a link to one guide, or one section of it, for the few
 *   places a specific question is asked: `HelpLink`.
 */

import { findGuide, helpSectionId, HELP_GUIDES } from "./helpGuides";
import type { AppRoute } from "./routes";
import { siteUrl } from "./siteLink";

export type HelpGuideSlug =
  | "getting-started"
  | "adding-documents"
  | "writing"
  | "approvals"
  | "reviewing"
  | "out-of-date"
  | "exporting"
  | "finding"
  | "people"
  | "notifications";

/** A guide's page, or one section of it by its heading. */
export function helpHref(guide?: HelpGuideSlug, heading?: string): string {
  if (!guide) return siteUrl("/help");
  const anchor = heading ? `#${helpSectionId(heading)}` : "";
  return siteUrl(`/help/${guide}${anchor}`);
}

/** Does this guide, and this section of it, exist? For the tests. */
export function helpTargetExists(
  guide: HelpGuideSlug,
  heading?: string,
): boolean {
  const found = findGuide(guide);
  if (!found) return false;
  return (
    heading === undefined ||
    found.sections.some((section) => section.heading === heading)
  );
}

/**
 * The guide about the page on screen, or null for the list of all of them.
 *
 * `search` is the address's query: the editor is the document's own address
 * with `?edit=write`.
 */
export function guideForRoute(
  route: AppRoute,
  search = "",
): HelpGuideSlug | null {
  const editing = new URLSearchParams(search).has("edit");
  switch (route.kind) {
    case "changes":
      return "reviewing";
    case "drafts":
      return "writing";
    case "documents":
      return "finding";
    case "billing":
      return "people";
    case "organization":
      if (route.tab === "people") return "people";
      if (route.tab === "changes") return "reviewing";
      if (route.tab === "drafts") return "writing";
      return null;
    case "binder":
      if (editing) return "writing";
      switch (route.tab) {
        case "changes":
          if (route.change === undefined) return "reviewing";
          return route.view === "conflicts" ? "out-of-date" : "reviewing";
        case "drafts":
          return "writing";
        case "history":
          return "finding";
        case "people":
          return "people";
        case "sign-off":
        case "change-requests":
          return "approvals";
        default:
          return null;
      }
    case "binderDocument":
      return editing ? "writing" : "exporting";
    default:
      return null;
  }
}

/** What the guide about this page is called, for the link's own label. */
export function guideTitle(guide: HelpGuideSlug): string {
  return HELP_GUIDES.find((entry) => entry.slug === guide)?.title ?? "";
}
