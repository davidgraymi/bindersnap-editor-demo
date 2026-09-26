import { buildDocumentUrl } from "./binderDocument";
import {
  buildBinderUrl,
  parseBinderAddress,
  parseLegacyBinderQuery,
  DEFAULT_REF,
  type BinderTab,
} from "./binderShell";

export type AppRoute =
  | { kind: "home" }
  | { kind: "login" }
  | { kind: "signup" }
  | { kind: "callback" }
  | { kind: "workspace" }
  | { kind: "documents" }
  | { kind: "changes" }
  | { kind: "adminSubscriptions" }
  /**
   * One organization's billing: `/{org}/-/billing`.
   *
   * Billing is per organization, so the page names the one it is about. Bare
   * `/billing` is an address that predates that — the app answers it with the
   * session's oldest organization and rewrites the address to say so.
   */
  | { kind: "billing"; org?: string }
  | { kind: "createOrganization" }
  /**
   * An organization: what it owns, and who is in it. `/{org}`, and
   * `/{org}/-/people` for who.
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
      /** The branch the documents are read on: `/-/tree/{ref}`. */
      ref?: string;
    }
  /** One document inside it: `/{org}/{binder}/-/blob/{ref}/{path}`. */
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

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
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
  const billingMatch = normalizedPath.match(/^\/billing\/([^/]+)$/);
  if (billingMatch) {
    return { kind: "billing", org: decodeSegment(billingMatch[1]!) };
  }

  // `/{org}/{binder}` and `/{org}/{binder}/{path}`, the address Gitea and
  // GitHub both use. It is matched last because it would otherwise swallow
  // every route above it — see RESERVED_FIRST_SEGMENTS.
  const orgMatch = normalizedPath.match(/^\/([^/]+)$/);
  if (orgMatch && !RESERVED_FIRST_SEGMENTS.has(orgMatch[1]!)) {
    return { kind: "organization", org: orgMatch[1]! };
  }

  // The organization's own screens, behind the `-` no binder can be called.
  const orgScreenMatch = normalizedPath.match(/^\/([^/]+)\/-\/(.+)$/);
  if (orgScreenMatch && !RESERVED_FIRST_SEGMENTS.has(orgScreenMatch[1]!)) {
    const org = orgScreenMatch[1]!;
    const screen = orgScreenMatch[2]!;
    if (screen === "billing") return { kind: "billing", org };
    return {
      kind: "organization",
      org,
      ...(screen === "people" ? { tab: "people" as const } : {}),
    };
  }

  const binderMatch = normalizedPath.match(/^\/([^/]+)\/([^/]+)(\/.*)?$/);
  if (binderMatch && !RESERVED_FIRST_SEGMENTS.has(binderMatch[1]!)) {
    const org = binderMatch[1]!;
    const binder = binderMatch[2]!;
    const rest = binderMatch[3] ?? "";
    const address = parseBinderAddress(rest);
    // An address from before `/-/`, which the app rewrites on arrival. Read
    // the way it always was in the meantime, so nothing flashes a 404.
    if (address === null) {
      return {
        kind: "binderDocument",
        org,
        binder,
        documentPath: rest.slice(1),
      };
    }
    if (address.documentPath !== null) {
      return {
        kind: "binderDocument",
        org,
        binder,
        documentPath: address.documentPath,
        ...(address.ref && address.ref !== DEFAULT_REF
          ? { ref: address.ref }
          : {}),
      };
    }
    return {
      kind: "binder",
      org,
      binder,
      ...(address.tab !== "documents" ? { tab: address.tab } : {}),
      ...(address.change !== null ? { change: address.change } : {}),
      ...(address.view !== "discussion" ? { view: address.view } : {}),
      ...(address.ref ? { ref: address.ref } : {}),
    };
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
      return route.org ? `/${route.org}/-/billing` : "/billing";
    case "createOrganization":
      return "/organizations/new";
    case "organization":
      return route.tab && route.tab !== "binders"
        ? `/${route.org}/-/${route.tab}`
        : `/${route.org}`;
    case "binder":
      return buildBinderUrl({
        org: route.org,
        binder: route.binder,
        tab: route.tab,
        change: route.change,
        view: route.view,
        ref: route.ref ?? null,
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

/**
 * Where an address written before `/-/` lives now, or null when it is current.
 *
 * `?tab=changes&change=4&view=compare` is `/-/changes/4/diffs`,
 * `/{org}/{binder}/{path}?ref=x` is `/-/blob/x/{path}`, `/billing/{org}` is
 * `/{org}/-/billing` and `?tab=people` on an organization is `/-/people`.
 * Links that were sent, bookmarked or pasted into a ticket keep working; the
 * app replaces them in the address bar before anything reads them, so there
 * is only ever one grammar on screen.
 */
export function canonicalLocation(
  pathname: string,
  search: string,
  hash = "",
): string | null {
  const path = normalizePathname(pathname);
  const params = new URLSearchParams(search);
  const [first = "", second, ...rest] = path.slice(1).split("/");
  if (first === "" || RESERVED_FIRST_SEGMENTS.has(first)) {
    const billing = path.match(/^\/billing\/([^/]+)$/);
    return billing ? `/${billing[1]}/-/billing${hash}` : null;
  }

  // `/{org}?tab=people`, `/{org}?new=binder`.
  if (second === undefined) {
    if (params.get("tab") === "people") return `/${first}/-/people${hash}`;
    if (params.get("new") === "binder") {
      return `/${first}/-/binders/new${hash}`;
    }
    return null;
  }
  if (second === "-") return null;

  const keep = (url: string): string => {
    const edit = params.get("edit");
    const draft = params.get("draft");
    const query = new URLSearchParams(url.split("?")[1] ?? "");
    if (edit && !query.has("edit")) query.set("edit", edit);
    if (draft && !query.has("draft")) query.set("draft", draft);
    const tail = query.toString();
    return `${url.split("?")[0]}${tail ? `?${tail}` : ""}${hash}`;
  };

  // `/{org}/{binder}/{path}` — a document, from before it sat at a branch.
  if (rest.length > 0 && rest[0] !== "-") {
    const legacy = parseLegacyBinderQuery(search);
    const version = Number(params.get("version"));
    return keep(
      buildDocumentUrl({
        org: first,
        binder: second,
        documentPath: rest.join("/"),
        version: Number.isInteger(version) && version > 0 ? version : null,
        change: legacy.change,
        ref: legacy.ref,
      }),
    );
  }

  // `/{org}/{binder}?tab=…` — a screen, from before screens had paths.
  if (
    rest.length === 0 &&
    ["tab", "change", "view", "ref", "archive"].some((key) => params.has(key))
  ) {
    const legacy = parseLegacyBinderQuery(search);
    return keep(
      buildBinderUrl({
        org: first,
        binder: second,
        tab: legacy.tab,
        ...(legacy.change !== null ? { change: legacy.change } : {}),
        view: legacy.view,
        ref: legacy.ref,
        archive: legacy.archive,
      }),
    );
  }

  return null;
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
