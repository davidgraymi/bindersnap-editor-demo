export type AppRoute =
  | { kind: "home" }
  | { kind: "login" }
  | { kind: "signup" }
  | { kind: "callback" }
  | { kind: "workspace" }
  | { kind: "documents" }
  | { kind: "inbox" }
  | { kind: "activity" }
  | { kind: "adminSubscriptions" }
  | { kind: "billing" }
  | {
      kind: "document";
      owner: string;
      repo: string;
      tab: DocumentTab;
    };

/**
 * The document workspace tabs. `overview` is the document itself and owns the
 * bare `/docs/:owner/:repo` path; every other tab is a suffix so any view can
 * be linked to, bookmarked, and reloaded.
 */
export type DocumentTab =
  "overview" | "changes" | "history" | "collaborators" | "permissions";

const DOCUMENT_TAB_PATHS: Record<Exclude<DocumentTab, "overview">, string> = {
  changes: "changes",
  history: "history",
  collaborators: "collaborators",
  permissions: "permissions",
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

  if (normalizedPath === "/inbox") {
    return { kind: "inbox" };
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

  const docTabMatch = normalizedPath.match(
    /^\/docs\/([^/]+)\/([^/]+)\/([^/]+)$/,
  );
  if (docTabMatch) {
    const segment = docTabMatch[3]!;
    const tab = (
      Object.keys(DOCUMENT_TAB_PATHS) as Exclude<DocumentTab, "overview">[]
    ).find((candidate) => DOCUMENT_TAB_PATHS[candidate] === segment);

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
      return `${base}/${DOCUMENT_TAB_PATHS[route.tab]}`;
    }
    case "documents":
      return "/documents";
    case "inbox":
      return "/inbox";
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
    route.kind === "inbox" ||
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
