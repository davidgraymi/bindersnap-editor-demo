import { CircleCheck, CircleSlash, FilePen } from "lucide-react";

import { followInApp } from "../appLink";
import type { ChangeOutcome } from "../documentDisplay";
import type { DocumentChangeView } from "../routes";

/**
 * The top of a change request, whichever of its screens is showing.
 *
 * **One change, one header.** The discussion and the comparison were two
 * pages that happened to share a title: each drew its own line under it, and
 * the way from one to the other was a Compare button in the rail one way and
 * the trail the other. A code host draws a merge request as one object with
 * tabs — Overview, Changes — under a header that says whether it is still
 * open. This is that, so a reviewer always knows which change they are on,
 * what state it is in, and where the other half of it is.
 */

/**
 * Where a change stands on its own page: open, or how it ended.
 *
 * Every change that ended without being published reads `Closed`, whichever
 * outcome the server guessed: a badge that said "Declined" would be a claim
 * about who decided what.
 */
export type ChangeState = "open" | "closed" | ChangeOutcome;

/** Open, or how it ended — the badge GitLab puts before "requested to merge". */
export function ChangeStateBadge({ state }: { state: ChangeState }) {
  const props = { size: 13, strokeWidth: 1.75, "aria-hidden": true } as const;

  // The same glyphs a change row carries, so the list and the page agree.
  if (state === "published") {
    return (
      <span className="bs-status bs-status--published change-state">
        <CircleCheck {...props} />
        Published
      </span>
    );
  }
  if (state === "closed" || state === "declined" || state === "withdrawn") {
    return (
      <span className="bs-status bs-status--withdrawn change-state">
        <CircleSlash {...props} />
        Closed
      </span>
    );
  }
  return (
    <span className="bs-status bs-status--review change-state">
      <FilePen {...props} />
      Open
    </span>
  );
}

interface ChangeTabsProps {
  view: DocumentChangeView;
  /** The change's discussion: its own address, without a view. */
  overviewHref: string;
  /** Everything it changes, side by side: `/-/changes/{n}/diffs`. */
  changesHref: string;
  /** How many documents it touches; none for a change to the rules. */
  documentCount: number;
  onSelect: (view: DocumentChangeView) => void;
}

/**
 * Overview and Changes, as links.
 *
 * Links because each is an address — a reviewer sends "the diff" as a URL —
 * and a tab that opens in a new tab is the whole reason to have one.
 */
export function ChangeTabs({
  view,
  overviewHref,
  changesHref,
  documentCount,
  onSelect,
}: ChangeTabsProps) {
  const onChanges = view === "compare";

  return (
    <nav className="change-tabs" aria-label="This change request">
      <div className="doc-tabs">
        <a
          className={`doc-tab${onChanges ? "" : " doc-tab--active"}`}
          href={overviewHref}
          aria-current={onChanges ? undefined : "page"}
          onClick={(event) => followInApp(event, () => onSelect("discussion"))}
        >
          Overview
        </a>
        <a
          className={`doc-tab${onChanges ? " doc-tab--active" : ""}`}
          href={changesHref}
          aria-current={onChanges ? "page" : undefined}
          onClick={(event) => followInApp(event, () => onSelect("compare"))}
        >
          Changes
          {documentCount > 0 ? (
            <span className="doc-tab-count">{documentCount}</span>
          ) : null}
        </a>
      </div>
    </nav>
  );
}
