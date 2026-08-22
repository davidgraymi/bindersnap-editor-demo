export type AppRoute =
  | { kind: "home" }
  | { kind: "login" }
  | { kind: "signup" }
  | { kind: "callback" }
  | { kind: "workspace" }
  | { kind: "documents" }
  | { kind: "activity" }
  | { kind: "adminSubscriptions" }
  | { kind: "billing" }
  | {
      kind: "document";
      owner: string;
      repo: string;
      tab: DocumentTab;
      /**
       * One change, on its own page. Only ever set on the `changes` tab —
       * reviewing #3 should not mean scrolling past #4 through #10.
       */
      changeNumber?: number;
      /**
       * Which half of that change's page: the conversation, or the file it
       * proposes. Only meaningful alongside `changeNumber`.
       */
      changeView?: DocumentChangeView;
    };

/**
 * The document workspace tabs. `overview` is the document itself and owns the
 * bare `/docs/:owner/:repo` path; every other tab is a suffix so any view can
 * be linked to, bookmarked, and reloaded.
 */
export type DocumentTab = "overview" | "changes" | "history" | "access";

/**
 * The two halves of a change's page. The decision is made in the discussion,
 * so that is what a bare change URL opens; the file it proposes gets its own
 * screen instead of pushing the conversation below the fold.
 */
export type DocumentChangeView = "discussion" | "preview";

const DOCUMENT_TAB_PATHS: Record<Exclude<DocumentTab, "overview">, string> = {
  changes: "changes",
  history: "history",
  access: "access",
};

/**
 * The two tabs that became one.
 *
 * "Team" listed who could see the document and "Settings" held how many of
 * them had to sign off — two halves of the same question, so the redesign
 * merged them into Access & approvals. Links that were sent, bookmarked, or
 * pasted into a ticket still land on the page that answers them.
 */
const LEGACY_DOCUMENT_TAB_PATHS: Record<string, DocumentTab> = {
  collaborators: "access",
  permissions: "access",
};

function normalizePathname(pathname: string): string {
  if (!pathname || pathname === "/") {
    return "/";
  }

  return pathname.replace(/\/+$/, "") || "/";
}

export function isHomePath(pathname: string): boolean {
  return normalizePathname(pathname) === "/";
}

/**
 * A link to one of the two document tabs the redesign merged.
 *
 * `getRoute` already resolves these to Access & approvals; this is what lets
 * the app rewrite the address bar so nobody keeps a bookmark to a tab that no
 * longer exists.
 */
export function isLegacyDocumentTabPath(pathname: string): boolean {
  const match = normalizePathname(pathname).match(
    /^\/docs\/[^/]+\/[^/]+\/([^/]+)$/,
  );
  return match !== null && match[1]! in LEGACY_DOCUMENT_TAB_PATHS;
}

/** A link to the retired `/inbox` page. Its contents now live on Home. */
export function isLegacyInboxPath(pathname: string): boolean {
  return normalizePathname(pathname) === "/inbox";
}

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

  // The redesign folded the inbox into Home — every change request that was
  // waiting there is now the first thing Home shows. Old links still resolve;
  // `App` rewrites the address bar so nobody bookmarks a page that is gone.
  if (isLegacyInboxPath(normalizedPath)) {
    return { kind: "workspace" };
  }

  if (normalizedPath === "/activity") {
    return { kind: "activity" };
  }

  if (
    normalizedPath === "/admin/subscriptions" ||
    normalizedPath === "/admin/pro-access"
  ) {
    return { kind: "adminSubscriptions" };
  }

  if (normalizedPath === "/billing") {
    return { kind: "billing" };
  }

  const changeMatch = normalizedPath.match(
    /^\/docs\/([^/]+)\/([^/]+)\/changes\/(\d+)(?:\/(preview))?$/,
  );
  if (changeMatch) {
    return {
      kind: "document",
      owner: changeMatch[1]!,
      repo: changeMatch[2]!,
      tab: "changes",
      changeNumber: Number(changeMatch[3]),
      changeView: changeMatch[4] === "preview" ? "preview" : "discussion",
    };
  }

  const docTabMatch = normalizedPath.match(
    /^\/docs\/([^/]+)\/([^/]+)\/([^/]+)$/,
  );
  if (docTabMatch) {
    const segment = docTabMatch[3]!;
    const tab =
      (
        Object.keys(DOCUMENT_TAB_PATHS) as Exclude<DocumentTab, "overview">[]
      ).find((candidate) => DOCUMENT_TAB_PATHS[candidate] === segment) ??
      LEGACY_DOCUMENT_TAB_PATHS[segment];

    if (tab) {
      return {
        kind: "document",
        owner: docTabMatch[1]!,
        repo: docTabMatch[2]!,
        tab,
      };
    }
  }

  const docMatch = normalizedPath.match(/^\/docs\/([^/]+)\/([^/]+)$/);
  if (docMatch) {
    return {
      kind: "document",
      owner: docMatch[1]!,
      repo: docMatch[2]!,
      tab: "overview",
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
    case "document": {
      const base = `/docs/${route.owner}/${route.repo}`;
      if (route.tab === "overview") return base;
      if (route.tab === "changes" && route.changeNumber !== undefined) {
        const change = `${base}/changes/${route.changeNumber}`;
        return route.changeView === "preview" ? `${change}/preview` : change;
      }
      return `${base}/${DOCUMENT_TAB_PATHS[route.tab]}`;
    }
    case "documents":
      return "/documents";
    case "activity":
      return "/activity";
    case "adminSubscriptions":
      return "/admin/subscriptions";
    case "billing":
      return "/billing";
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
    route.kind === "activity" ||
    route.kind === "adminSubscriptions"
  );
}

export function asShellRoute(route: AppRoute): AppRoute {
  if (route.kind === "home") {
    return { kind: "workspace" };
  }

  return route;
}
