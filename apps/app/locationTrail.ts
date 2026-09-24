/**
 * Where you are, as one line: `Riverside Health / Clinical / Nursing / Hand Hygiene`.
 *
 * **The same answer, in the same place, on every page.** Before this, each
 * screen answered "where am I" its own way or not at all: a policy named
 * neither its binder nor its folder (the sidebar collapses to icons while one
 * is open, so the binder's name went with it), a change request drew its own
 * "All changes / Change 4" inside the page without naming the binder, and the
 * top bar only ever named the organization. Moving between those screens is
 * what felt disjointed.
 *
 * GitHub puts `owner / repo` in its header and the path above the file; GitLab
 * puts `group / project / Merge requests / !12` above every page. Same idea
 * here, in the top bar, so it never moves and never competes with a page's
 * own title.
 *
 * The organization is not a step in this list: the top bar draws it as the
 * switcher, because for somebody in two organizations it is a control and not
 * only a place.
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
  /** The steps after the organization, outermost first. */
  steps: TrailStep[];
  /**
   * Whether the organization is itself the page — its binder list.
   *
   * The organization step is drawn by the top bar rather than listed here,
   * so it needs telling when it is the last word.
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

function binderTrail(org: string, binder: string, search: string): TrailStep[] {
  const params = new URLSearchParams(search);
  const binderStep: TrailStep = {
    label: formatDocumentName(binder),
    href: buildBinderUrl({ org, binder }),
  };

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
      binderStep,
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
    return [binderStep, here("Archive")];
  }

  const edit = params.get("edit");
  if (edit === "propose") {
    return [binderStep, here("Propose changes")];
  }

  switch (tab) {
    case "changes":
      return [binderStep, here("Change requests")];
    case "history":
      return [binderStep, here("History")];
    // People and Sign-off rules are sections of Settings; their addresses
    // still resolve there, so they are titled by the page they land on.
    case "settings":
    case "people":
    case "sign-off":
      return [binderStep, here("Settings")];
    case "documents":
    default:
      return [
        edit === "1" ? binderStep : here(binderStep.label),
        ...(edit === "1" ? [here("Editing")] : []),
      ];
  }
}

function documentTrail(
  org: string,
  binder: string,
  documentPath: string,
  search: string,
): TrailStep[] {
  const segments = documentPath.split("/").filter(Boolean);
  const filename = segments.pop() ?? documentPath;
  const change = parseRequestedChange(search);

  const binderStep: TrailStep = {
    label: formatDocumentName(binder),
    href: buildBinderUrl({ org, binder }),
  };

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
    binderStep,
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
 */
export function buildLocationTrail(
  route: AppRoute,
  search: string,
): LocationTrail {
  const none = (steps: TrailStep[]): LocationTrail => ({
    steps,
    organizationIsCurrent: false,
  });

  switch (route.kind) {
    // The route only carries a tab when the app navigated there itself; an
    // address that was typed or reloaded says it in the query.
    case "organization":
      return (route.tab ?? new URLSearchParams(search).get("tab")) === "people"
        ? none([here("People")])
        : { steps: [], organizationIsCurrent: true };
    case "binder":
      return none(binderTrail(route.org, route.binder, search));
    case "binderDocument":
      return none(
        documentTrail(route.org, route.binder, route.documentPath, search),
      );
    case "changes":
      return none([here("Change requests")]);
    case "documents":
      return none([here("Documents")]);
    case "activity":
      return none([here("Activity")]);
    case "billing":
      return none([here("Billing")]);
    case "adminSubscriptions":
      return none([here("Pro access")]);
    case "createOrganization":
      return none([here("New organization")]);
    // Home is the organization's front door and says so in its own greeting;
    // a step reading "Home" under the organization would be a second name for
    // the same place.
    default:
      return none([]);
  }
}
