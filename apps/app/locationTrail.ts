/**
 * Where you are, in two parts, the way GitLab draws it.
 *
 * **The scope, in the top bar:** `Riverside Health / Clinical`. The
 * organization and the binder — GitHub's `owner / repo` — and nothing deeper,
 * so the top bar says the same thing on every screen of a binder and never
 * grows with the page.
 *
 * **The path, in the page:** `Change requests / Change 4 / Compare`, or
 * `Nursing / Wards / Handover Standard`, just above the page's title. It is
 * about the content, so it sits inside the content's own boundary, beside the
 * thing it names.
 *
 * Before this, each screen answered "where am I" its own way or not at all: a
 * policy named neither its binder nor its folder, and a change request drew its
 * own "All changes / Change 4" without naming the binder. Moving between those
 * screens is what felt disjointed.
 */

import { parseDocumentFilename } from "../../packages/utils/documentPath";
import { parseRequestedChange } from "./binderChange";
import { binderTabFromSearch, buildBinderUrl } from "./binderShell";
import { formatDocumentName } from "./documentDisplay";
import type { AppRoute } from "./routes";

export interface TrailStep {
  /** What the step is called on screen. */
  label: string;
  /**
   * Where it goes, or null when it goes nowhere.
   *
   * A folder has no page of its own, and the page you are on is not a link to
   * itself — a link that goes nowhere is worse than plain text.
   */
  href: string | null;
}

export interface LocationTrail {
  /**
   * The binder the page belongs to, for the top bar — null off a binder.
   *
   * A link unless the binder's own contents are the page.
   */
  binder: TrailStep | null;
  /**
   * Where inside the binder the page is, outermost first, for the line above
   * the page's title. Ends at the page itself.
   */
  path: TrailStep[];
  /**
   * Whether the organization is itself the page — its binder list.
   *
   * The organization is drawn by the top bar rather than listed here, so it
   * needs telling when it is the last word.
   */
  organizationIsCurrent: boolean;
}

/** The step naming the page you are on: never a link to itself. */
function here(label: string): TrailStep {
  return { label, href: null };
}

/** "nursing/wards" → the folder names a reader sees in the tree. */
function folderSteps(folder: string): TrailStep[] {
  return folder
    .split("/")
    .filter(Boolean)
    .map((segment) => ({ label: formatDocumentName(segment), href: null }));
}

/**
 * What a document is called, from its address.
 *
 * The address may or may not carry the extension, and a file may carry its
 * identity segment (ADR 0005). Neither is part of its name.
 */
function documentLabel(filename: string): string {
  return formatDocumentName(parseDocumentFilename(filename).name);
}

/** Where in a binder its screen is. Empty on the binder's own contents. */
function binderPath(org: string, binder: string, search: string): TrailStep[] {
  const params = new URLSearchParams(search);

  const change = parseRequestedChange(search);
  const tab = binderTabFromSearch(search);
  const changesStep: TrailStep = {
    label: "Change requests",
    href: buildBinderUrl({ org, binder, tab: "changes" }),
  };

  if (change !== null) {
    const view = params.get("view");
    const changeLabel = `Change ${change}`;
    // The binder as a change would leave it, from the branch link on a
    // comparison. Still inside that change, so still under it.
    const onBranch = params.get("ref") !== null && tab === "documents";
    const subpage =
      view === "compare"
        ? "Compare"
        : view === "preview"
          ? "Preview"
          : onBranch
            ? "Proposed files"
            : null;

    return [
      changesStep,
      subpage === null
        ? here(changeLabel)
        : {
            label: changeLabel,
            href: buildBinderUrl({ org, binder, tab: "changes", change }),
          },
      ...(subpage === null ? [] : [here(subpage)]),
    ];
  }

  if (params.get("archive") === "1") {
    return [here("Archive")];
  }

  const edit = params.get("edit");
  if (edit === "propose") {
    return [here("Propose changes")];
  }

  switch (tab) {
    case "changes":
      return [here("Change requests")];
    case "history":
      return [here("History")];
    // People and Sign-off rules are sections of Settings; their addresses
    // still resolve there, so they are titled by the page they land on.
    case "settings":
    case "people":
    case "sign-off":
      return [here("Settings")];
    case "documents":
    default:
      return edit === "1" ? [here("Editing")] : [];
  }
}

/** Where in a binder a document is: its folders, then the document. */
function documentPath(
  org: string,
  binder: string,
  address: string,
  search: string,
): TrailStep[] {
  const segments = address.split("/").filter(Boolean);
  const filename = segments.pop() ?? address;
  const change = parseRequestedChange(search);

  // Read on a change's branch: the change is where the reader came from, and
  // the way back to it is worth a step. The path under it is the file's own.
  const changeSteps: TrailStep[] =
    change === null
      ? []
      : [
          {
            label: "Change requests",
            href: buildBinderUrl({ org, binder, tab: "changes" }),
          },
          {
            label: `Change ${change}`,
            href: buildBinderUrl({ org, binder, tab: "changes", change }),
          },
        ];

  return [
    ...changeSteps,
    ...folderSteps(segments.join("/")),
    here(documentLabel(filename)),
  ];
}

/**
 * The trail for an address.
 *
 * Takes the query as well as the route because a binder's screens live in the
 * query (`?tab=changes&change=4`), which the route does not carry.
 *
 * Pages across the organization — the queue, Documents, Billing — have no
 * path: they are one level deep, their title names them and the sidebar marks
 * them, so a path of one step would be a third name for the same place.
 */
export function buildLocationTrail(
  route: AppRoute,
  search: string,
): LocationTrail {
  if (route.kind === "binder" || route.kind === "binderDocument") {
    const path =
      route.kind === "binder"
        ? binderPath(route.org, route.binder, search)
        : documentPath(route.org, route.binder, route.documentPath, search);
    const label = formatDocumentName(route.binder);
    return {
      binder:
        path.length === 0
          ? here(label)
          : {
              label,
              href: buildBinderUrl({ org: route.org, binder: route.binder }),
            },
      path,
      organizationIsCurrent: false,
    };
  }

  // The route only carries a tab when the app navigated there itself; an
  // address that was typed or reloaded says it in the query.
  const organizationIsCurrent =
    route.kind === "organization" &&
    (route.tab ?? new URLSearchParams(search).get("tab")) !== "people";

  return { binder: null, path: [], organizationIsCurrent };
}
