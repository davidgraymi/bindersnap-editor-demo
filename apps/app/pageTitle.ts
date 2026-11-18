/**
 * What the browser tab says.
 *
 * Every page used to be called "Bindersnap": four tabs open on four policies
 * were four identical tabs, the Back button's history was a column of the same
 * word, and a bookmark had to be renamed by hand. A tab names the thing on the
 * page first and the place it is in second — "Expenses Policy · Corporate ·
 * Bindersnap" — so the part that differs is the part that survives a narrow
 * tab.
 *
 * Two layers. **The address always gives a title** (`routeTitle`): it needs no
 * request, so the tab is right from the first paint and while a page loads.
 * **A page that knows better says so** (`usePageTitle`): a change request is
 * "Change 16" by its address and "Subsistence rates… (#16)" once it has been
 * read. When that page goes, the address's title is back.
 */

import { useEffect } from "react";

import { formatDocumentName } from "../../packages/utils/documentTitle";
import { parseDocumentFilename } from "../../packages/utils/documentPath";
import type { AdminSection, AppRoute } from "./routes";

const PRODUCT = "Bindersnap";

const ADMIN_TITLES: Record<AdminSection, string> = {
  overview: "Admin",
  users: "People · Admin",
  organizations: "Organizations · Admin",
  binders: "Binders · Admin",
  signups: "Signups · Admin",
  growth: "Growth · Admin",
  system: "System · Admin",
  config: "Settings · Admin",
};

/** The last part of a path, as a person would say it. */
function lastName(path: string): string {
  const segment = path.split("/").filter(Boolean).pop() ?? path;
  return formatDocumentName(parseDocumentFilename(segment).name || segment);
}

/**
 * The parts of a page's title, most specific first, without the product name.
 *
 * Names come from the address, so a binder is "Corporate" from `corporate`.
 * That is the same reading the breadcrumb falls back to, and it is replaced by
 * the page's own title as soon as there is one.
 */
export function routeTitleParts(route: AppRoute): string[] {
  switch (route.kind) {
    case "home":
    case "workspace":
      return ["Home"];
    case "login":
      return ["Sign in"];
    case "signup":
      return ["Start your free trial"];
    case "forgotPassword":
    case "resetPassword":
      return ["Reset your password"];
    case "verifyEmail":
      return ["Confirm your email"];
    case "unsubscribe":
      return ["Email preferences"];
    case "invitation":
      return ["Invitation"];
    case "callback":
      return [];
    case "documents":
      return ["Documents"];
    case "binders":
      return ["Binders"];
    case "changes":
      return ["Change requests"];
    case "drafts":
      return ["Drafts"];
    case "admin":
      return [ADMIN_TITLES[route.section]];
    case "accountSettings":
      return ["Your account"];
    case "createOrganization":
      return ["New organization"];
    case "billing":
      return route.org
        ? ["Billing", formatDocumentName(route.org)]
        : ["Billing"];
    case "organization": {
      const org = formatDocumentName(route.org);
      if (route.group) return [route.group, "People & access", org];
      switch (route.tab) {
        case "people":
          return ["People & access", org];
        case "changes":
          return ["Change requests", org];
        case "drafts":
          return ["Drafts", org];
        case "settings":
          return ["Settings", org];
        default:
          return [org];
      }
    }
    case "binder": {
      const binder = formatDocumentName(route.binder);
      switch (route.tab) {
        case "changes":
          if (route.change === undefined) return ["Change requests", binder];
          return [
            route.view === "compare"
              ? `Changes in change ${route.change}`
              : route.view === "conflicts"
                ? `Conflicts in change ${route.change}`
                : `Change ${route.change}`,
            binder,
          ];
        case "drafts":
          return ["Drafts", binder];
        case "history":
          return ["History", binder];
        case "people":
          return ["People & access", "Settings", binder];
        case "sign-off":
        case "change-requests":
          return ["Change requests", "Settings", binder];
        case "settings":
          return ["Settings", binder];
        default:
          return route.folder
            ? [lastName(route.folder), binder]
            : [binder, formatDocumentName(route.org)];
      }
    }
    case "binderDocument":
      return [lastName(route.documentPath), formatDocumentName(route.binder)];
  }
}

/** "Expenses Policy · Corporate · Bindersnap". */
export function formatPageTitle(
  parts: readonly (string | null | undefined)[],
): string {
  const named: string[] = [];
  for (const part of [...parts, PRODUCT]) {
    const text = part?.trim();
    // A binder's top folder is the binder: "Clinical · Clinical" says it once.
    if (text && named[named.length - 1] !== text) named.push(text);
  }
  return named.join(" · ");
}

export function routeTitle(route: AppRoute): string {
  return formatPageTitle(routeTitleParts(route));
}

// The address's title, and the one a page on screen has asked for instead.
let fromRoute = PRODUCT;
let fromPage: string | null = null;

function apply(): void {
  if (typeof document === "undefined") return;
  const next = fromPage ?? fromRoute;
  if (document.title !== next) document.title = next;
}

/** Called by the app whenever the address changes. */
export function setRouteTitle(route: AppRoute): void {
  fromRoute = routeTitle(route);
  apply();
}

/**
 * Name the page from what it has read, most specific part first.
 *
 * Pass null (or nothing loaded yet) to leave the address's title in place.
 * `prefix` goes in front of everything, for the editor's unsaved mark.
 */
export function usePageTitle(
  parts: readonly (string | null | undefined)[] | null,
  prefix = "",
): void {
  const title =
    parts && parts.some((part) => part?.trim())
      ? `${prefix}${formatPageTitle(parts)}`
      : null;
  useEffect(() => {
    if (title === null) return;
    fromPage = title;
    apply();
    return () => {
      if (fromPage === title) fromPage = null;
      apply();
    };
  }, [title]);
}
