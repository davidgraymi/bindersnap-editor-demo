import { buildDocumentUrl } from "./binderDocument";
import { buildBinderUrl, type BinderTab } from "./binderShell";

export type AppRoute =
  | { kind: "home" }
  | { kind: "login" }
  | { kind: "signup" }
  | { kind: "callback" }
  | { kind: "workspace" }
  | { kind: "documents" }
  | { kind: "changes" }
  | { kind: "adminSubscriptions" }
  | { kind: "billing" }
  | { kind: "createOrganization" }
  /**
   * An organization: what it owns, and who is in it. `/{org}`.
   *
   * `tab` exists so a link from outside can land on People rather than on the
   * binder list. The page manages the query itself once it is on screen, the
   * same way a binder's tabs do.
   */
  | { kind: "organization"; org: string; tab?: OrganizationTab }
  /** A binder's documents: `/{org}/{binder}`. */
  | {
      kind: "binder";
      org: string;
      binder: string;
      /**
       * Which pane, and which change, for a link that arrives from outside the
       * binder — Home and quick find both do. The binder's own tab bar keeps
       * managing the query itself once it is on screen; these exist so a link
       * *into* a change lands on it rather than on the binder's Documents tab.
       */
      tab?: BinderTab;
      change?: number;
      view?: DocumentChangeView;
    }
  /** One document inside it: `/{org}/{binder}/{path}`. */
  | {
      kind: "binderDocument";
      org: string;
      binder: string;
      /** May carry folders, and may or may not carry the file extension. */
      documentPath: string;
      /**
       * Which published version to open at, from `?version=`.
       *
       * The history links to one: a row there is a version a change wrote, and
       * following it to whatever the document says *now* answers a different
       * question than the one that was clicked. Absent means the version on
       * record, which is what every other link to a document means.
       */
      version?: number;
      /**
       * Read it on a change request's branch, rather than on the record.
       *
       * **A change request is a branch, and a document on it has an address.**
       * Reading a proposed version used to happen inside the change's own page
       * — half a column wide, under a heading naming the change rather than
       * the document. This is the binder at another ref.
       */
      change?: number;
      /**
       * The branch to read it on.
       *
       * A file lives on a branch, which is why every code host addresses one
       * by ref. `change` rides along when there is one, so a reader who
       * arrived from a change keeps the way back.
       */
      ref?: string;
    };
export type DocumentChangeView = "discussion" | "preview" | "compare";
/** The organization's own tabs. Binders is the one it opens on. */
export type OrganizationTab = "binders" | "people";

/**
 * The two tabs that became one.
 *
 * "Team" listed who could see the document and "Settings" held how many of
 * them had to sign off — two halves of the same question, so the redesign
 * merged them into Access & approvals. Links that were sent, bookmarked, or
 * pasted into a ticket still land on the page that answers them.
 */

function normalizePathname(pathname: string): string {
  if (!pathname || pathname === "/") {
    return "/";
  }

  // **Strip a query and a fragment before anything else.** `window.location
  // .pathname` never carries one, but `routeToPath` does — a binder's tab and
  // change ride in the query — so anything that round-trips a built path back
  // through here would otherwise read `clinical?tab=changes` as the binder's
  // name. Cheap to tolerate, and silently wrong if not.
  const path = pathname.split(/[?#]/)[0] ?? "";
  if (!path || path === "/") return "/";

  return path.replace(/\/+$/, "") || "/";
}

export function isHomePath(pathname: string): boolean {
  return normalizePathname(pathname) === "/";
}

/** A link to the retired `/inbox` page. Its contents now live on Home. */
export function isLegacyInboxPath(pathname: string): boolean {
  return normalizePathname(pathname) === "/inbox";
}

/**
 * First path segments that are the app's own, not an organization's.
 *
 * A bare `/{org}/{binder}` address means the app has to know which names are
 * not organizations — the same problem GitHub solves by reserving `settings`,
 * `login` and the rest. Anything added here must also be refused as an
 * organization name, or somebody's binder becomes unreachable.
 */
export const RESERVED_FIRST_SEGMENTS = new Set([
  "activity",
  "admin",
  "auth",
  "billing",
  "changes",
  "docs",
  "documents",
  "login",
  "organizations",
  "signup",
]);

export function getRoute(pathname: string): AppRoute {
  const normalizedPath = normalizePathname(pathname);

  if (normalizedPath === "/auth/callback") {
    return { kind: "callback" };
  }

  if (normalizedPath === "/login") {
    return { kind: "login" };
  }

  if (normalizedPath === "/signup") {
    return { kind: "signup" };
  }

  if (normalizedPath === "/documents") {
    return { kind: "documents" };
  }

  // Every change in flight, across every binder. The counterpart to a binder's
  // own Change requests tab, which can only answer for one binder.
  if (normalizedPath === "/changes") {
    return { kind: "changes" };
  }

  // The redesign folded the inbox into Home — every change request that was
  // waiting there is now the first thing Home shows. Old links still resolve;
  // `App` rewrites the address bar so nobody bookmarks a page that is gone.
  if (isLegacyInboxPath(normalizedPath)) {
    return { kind: "workspace" };
  }

  // There was an Activity page, a "coming soon" placeholder. An address
  // somebody kept for it lands on Home rather than on an organization called
  // "activity", which is why the name stays reserved.
  if (normalizedPath === "/activity") {
    return { kind: "workspace" };
  }

  if (
    normalizedPath === "/admin/subscriptions" ||
    normalizedPath === "/admin/pro-access"
  ) {
    return { kind: "adminSubscriptions" };
  }

  if (normalizedPath === "/organizations/new") {
    return { kind: "createOrganization" };
  }
  if (normalizedPath === "/billing") {
    return { kind: "billing" };
  }

  // `/{org}/{binder}` and `/{org}/{binder}/{path}`, the address Gitea and
  // GitHub both use. It is matched last because it would otherwise swallow
  // every route above it — see RESERVED_FIRST_SEGMENTS.
  const orgMatch = normalizedPath.match(/^\/([^/]+)$/);
  if (orgMatch && !RESERVED_FIRST_SEGMENTS.has(orgMatch[1]!)) {
    return { kind: "organization", org: orgMatch[1]! };
  }

  const binderMatch = normalizedPath.match(/^\/([^/]+)\/([^/]+)(?:\/(.+))?$/);
  if (binderMatch && !RESERVED_FIRST_SEGMENTS.has(binderMatch[1]!)) {
    const documentPath = binderMatch[3];
    return documentPath
      ? {
          kind: "binderDocument",
          org: binderMatch[1]!,
          binder: binderMatch[2]!,
          documentPath,
        }
      : { kind: "binder", org: binderMatch[1]!, binder: binderMatch[2]! };
  }

  return { kind: "home" };
}

export function routeToPath(route: AppRoute): string {
  switch (route.kind) {
    case "login":
      return "/login";
    case "signup":
      return "/signup";
    case "callback":
      return "/auth/callback";
    case "documents":
      return "/documents";
    case "changes":
      return "/changes";
    case "adminSubscriptions":
      return "/admin/subscriptions";
    case "billing":
      return "/billing";
    case "createOrganization":
      return "/organizations/new";
    case "organization":
      return route.tab && route.tab !== "binders"
        ? `/${route.org}?tab=${route.tab}`
        : `/${route.org}`;
    case "binder":
      return buildBinderUrl({
        org: route.org,
        binder: route.binder,
        tab: route.tab,
        change: route.change,
        view: route.view,
      });
    case "binderDocument":
      return buildDocumentUrl({
        org: route.org,
        binder: route.binder,
        documentPath: route.documentPath,
        version: route.version ?? null,
        change: route.change ?? null,
        ref: route.ref ?? null,
      });
    case "home":
    case "workspace":
    default:
      return "/";
  }
}

export function isProtectedAppRoute(route: AppRoute): boolean {
  return (
    route.kind === "workspace" ||
    route.kind === "documents" ||
    route.kind === "changes" ||
    route.kind === "adminSubscriptions" ||
    // An organization's own pages need a session to resolve at all: which
    // binders you can see is a question about you.
    route.kind === "organization" ||
    route.kind === "binder" ||
    route.kind === "binderDocument"
  );
}

export function asShellRoute(route: AppRoute): AppRoute {
  if (route.kind === "home") {
    return { kind: "workspace" };
  }

  return route;
}
