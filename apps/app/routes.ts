export type AppRoute =
  | { kind: "home" }
  | { kind: "login" }
  | { kind: "signup" }
  | { kind: "callback" }
  | { kind: "workspace" }
  | { kind: "documents" }
  | { kind: "inbox" }
  | { kind: "activity" }
  | { kind: "billing" }
  | {
      kind: "document";
      owner: string;
      repo: string;
      tab: "overview" | "collaborators";
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

  if (normalizedPath === "/billing") {
    return { kind: "billing" };
  }

  const collaboratorsMatch = normalizedPath.match(
    /^\/docs\/([^/]+)\/([^/]+)\/collaborators$/,
  );
  if (collaboratorsMatch) {
    return {
      kind: "document",
      owner: collaboratorsMatch[1]!,
      repo: collaboratorsMatch[2]!,
      tab: "collaborators",
    };
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
    case "document":
      return route.tab === "collaborators"
        ? `/docs/${route.owner}/${route.repo}/collaborators`
        : `/docs/${route.owner}/${route.repo}`;
    case "documents":
      return "/documents";
    case "inbox":
      return "/inbox";
    case "activity":
      return "/activity";
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
    route.kind === "document" ||
    route.kind === "inbox" ||
    route.kind === "activity"
  );
}

export function asShellRoute(route: AppRoute): AppRoute {
  if (route.kind === "home") {
    return { kind: "workspace" };
  }

  return route;
}
