import { expect, test } from "bun:test";

import {
  asShellRoute,
  getRoute,
  isLegacyDocumentTabPath,
  isLegacyInboxPath,
  isProtectedAppRoute,
  routeToPath,
} from "./routes";

test("getRoute maps the SPA home route to the landing/app home kind", () => {
  expect(getRoute("/")).toEqual({ kind: "home" });
  // Trailing slashes normalize away. This used to assert `/trailing///` was
  // home, which only held because nothing matched a single segment — now
  // `/trailing` is an organization's address, so the normalization is tested
  // without leaning on a path that fell through.
  expect(getRoute("///")).toEqual({ kind: "home" });
  expect(getRoute("/trailing///")).toEqual({
    kind: "organization",
    org: "trailing",
  });
  expect(getRoute("/login")).toEqual({ kind: "login" });
  expect(getRoute("/signup")).toEqual({ kind: "signup" });
  expect(getRoute("/admin/subscriptions")).toEqual({
    kind: "adminSubscriptions",
  });
  expect(getRoute("/admin/pro-access")).toEqual({
    kind: "adminSubscriptions",
  });
});

test("getRoute preserves document detail routes", () => {
  expect(getRoute("/docs/alice/quarterly-report")).toEqual({
    kind: "document",
    owner: "alice",
    repo: "quarterly-report",
    tab: "overview",
  });

  expect(getRoute("/docs/alice/quarterly-report/access")).toEqual({
    kind: "document",
    owner: "alice",
    repo: "quarterly-report",
    tab: "access",
  });
});

// Team and Settings became one tab. Links that were already sent still land
// on the page that answers them.
test("getRoute resolves the retired Team and Settings tabs to Access", () => {
  expect(getRoute("/docs/alice/quarterly-report/collaborators")).toEqual({
    kind: "document",
    owner: "alice",
    repo: "quarterly-report",
    tab: "access",
  });

  expect(getRoute("/docs/alice/quarterly-report/permissions")).toEqual({
    kind: "document",
    owner: "alice",
    repo: "quarterly-report",
    tab: "access",
  });

  expect(
    isLegacyDocumentTabPath("/docs/alice/quarterly-report/permissions"),
  ).toBe(true);
  expect(isLegacyDocumentTabPath("/docs/alice/quarterly-report/access")).toBe(
    false,
  );
  expect(isLegacyDocumentTabPath("/docs/alice/quarterly-report")).toBe(false);
});

test("getRoute maps the changes and history tabs", () => {
  expect(getRoute("/docs/alice/quarterly-report/changes")).toEqual({
    kind: "document",
    owner: "alice",
    repo: "quarterly-report",
    tab: "changes",
  });

  expect(getRoute("/docs/alice/quarterly-report/history")).toEqual({
    kind: "document",
    owner: "alice",
    repo: "quarterly-report",
    tab: "history",
  });
});

test("getRoute gives every change its own page", () => {
  expect(getRoute("/docs/alice/quarterly-report/changes/7")).toEqual({
    kind: "document",
    owner: "alice",
    repo: "quarterly-report",
    tab: "changes",
    changeNumber: 7,
    changeView: "discussion",
  });

  expect(
    routeToPath({
      kind: "document",
      owner: "alice",
      repo: "quarterly-report",
      tab: "changes",
      changeNumber: 7,
    }),
  ).toBe("/docs/alice/quarterly-report/changes/7");
});

test("the file under review is its own screen within a change", () => {
  expect(getRoute("/docs/alice/quarterly-report/changes/7/preview")).toEqual({
    kind: "document",
    owner: "alice",
    repo: "quarterly-report",
    tab: "changes",
    changeNumber: 7,
    changeView: "preview",
  });

  expect(
    routeToPath({
      kind: "document",
      owner: "alice",
      repo: "quarterly-report",
      tab: "changes",
      changeNumber: 7,
      changeView: "preview",
    }),
  ).toBe("/docs/alice/quarterly-report/changes/7/preview");
});

test("the comparison against the last version is its own screen too", () => {
  expect(getRoute("/docs/alice/quarterly-report/changes/7/compare")).toEqual({
    kind: "document",
    owner: "alice",
    repo: "quarterly-report",
    tab: "changes",
    changeNumber: 7,
    changeView: "compare",
  });

  expect(
    routeToPath({
      kind: "document",
      owner: "alice",
      repo: "quarterly-report",
      tab: "changes",
      changeNumber: 7,
      changeView: "compare",
    }),
  ).toBe("/docs/alice/quarterly-report/changes/7/compare");
});

test("every published version has a page of its own", () => {
  expect(getRoute("/docs/alice/quarterly-report/version/2")).toEqual({
    kind: "document",
    owner: "alice",
    repo: "quarterly-report",
    tab: "overview",
    version: 2,
  });

  expect(
    routeToPath({
      kind: "document",
      owner: "alice",
      repo: "quarterly-report",
      tab: "overview",
      version: 2,
    }),
  ).toBe("/docs/alice/quarterly-report/version/2");
});

test("the document tab without a version is the version on record", () => {
  expect(
    routeToPath({
      kind: "document",
      owner: "alice",
      repo: "quarterly-report",
      tab: "overview",
    }),
  ).toBe("/docs/alice/quarterly-report");
});

test("a non-numeric version segment is not a version page", () => {
  expect(getRoute("/docs/alice/quarterly-report/version/latest")).toEqual({
    kind: "home",
  });
});

test("an unknown segment under a change is not a change page", () => {
  expect(getRoute("/docs/alice/quarterly-report/changes/7/nonsense")).toEqual({
    kind: "home",
  });
});

test("a non-numeric change segment is not a change page", () => {
  expect(getRoute("/docs/alice/quarterly-report/changes/latest")).toEqual({
    kind: "home",
  });
});

test("getRoute falls back to home for an unknown document tab", () => {
  expect(getRoute("/docs/alice/quarterly-report/nonsense")).toEqual({
    kind: "home",
  });
});

test("routeToPath round-trips every document tab", () => {
  const tabs = ["overview", "changes", "history", "access"] as const;

  for (const tab of tabs) {
    const route = {
      kind: "document",
      owner: "alice",
      repo: "quarterly-report",
      tab,
    } as const;
    expect(getRoute(routeToPath(route))).toEqual(route);
  }
});

test("getRoute maps the access path with URL-encoded owner/repo", () => {
  expect(getRoute("/docs/alice-org/my%20doc/access")).toEqual({
    kind: "document",
    owner: "alice-org",
    repo: "my%20doc",
    tab: "access",
  });
});

test("routeToPath keeps home and workspace on the root URL", () => {
  expect(routeToPath({ kind: "home" })).toBe("/");
  expect(routeToPath({ kind: "workspace" })).toBe("/");
  expect(routeToPath({ kind: "login" })).toBe("/login");
  expect(routeToPath({ kind: "signup" })).toBe("/signup");
  expect(routeToPath({ kind: "adminSubscriptions" })).toBe(
    "/admin/subscriptions",
  );
});

test("document routes are not protected — anonymous users can view public docs", () => {
  expect(
    isProtectedAppRoute({
      kind: "document",
      owner: "alice",
      repo: "report",
      tab: "overview",
    }),
  ).toBe(false);
  expect(isProtectedAppRoute({ kind: "documents" })).toBe(true);
  expect(isProtectedAppRoute({ kind: "workspace" })).toBe(true);
});

test("the retired /inbox path resolves to Home", () => {
  expect(getRoute("/inbox")).toEqual({ kind: "workspace" });
  expect(getRoute("/inbox/")).toEqual({ kind: "workspace" });
  expect(isLegacyInboxPath("/inbox")).toBe(true);
  expect(isLegacyInboxPath("/")).toBe(false);
});

test("asShellRoute converts home to workspace for the authenticated shell", () => {
  expect(asShellRoute({ kind: "home" })).toEqual({ kind: "workspace" });
  expect(
    asShellRoute({
      kind: "document",
      owner: "alice",
      repo: "quarterly-report",
      tab: "overview",
    }),
  ).toEqual({
    kind: "document",
    owner: "alice",
    repo: "quarterly-report",
    tab: "overview",
  });
});

test("a bare /{org}/{binder} addresses a binder", () => {
  expect(getRoute("/riverside-health/clinical")).toEqual({
    kind: "binder",
    org: "riverside-health",
    binder: "clinical",
  });
});

test("everything after the binder is the document's path, folders and all", () => {
  expect(getRoute("/riverside-health/clinical/nursing/handover.md")).toEqual({
    kind: "binderDocument",
    org: "riverside-health",
    binder: "clinical",
    documentPath: "nursing/handover.md",
  });
});

test("the app's own routes are not organizations", () => {
  // A bare /{org}/{binder} would swallow every one of these. Anything added to
  // RESERVED_FIRST_SEGMENTS has to be refused as an organization name too, or
  // somebody's binder becomes unreachable.
  expect(getRoute("/organizations/new").kind).toBe("createOrganization");
  expect(getRoute("/admin/subscriptions").kind).toBe("adminSubscriptions");
  expect(getRoute("/auth/callback").kind).toBe("callback");
  expect(getRoute("/docs/alice/handbook").kind).toBe("document");
});

test("a binder route round-trips through routeToPath", () => {
  const binder = {
    kind: "binder" as const,
    org: "riverside-health",
    binder: "clinical",
  };
  expect(getRoute(routeToPath(binder))).toEqual(binder);

  const document = {
    kind: "binderDocument" as const,
    org: "riverside-health",
    binder: "clinical",
    documentPath: "nursing/handover.md",
  };
  expect(getRoute(routeToPath(document))).toEqual(document);
});

test("a bare /{org} addresses the organization itself", () => {
  expect(getRoute("/riverside-health")).toEqual({
    kind: "organization",
    org: "riverside-health",
  });
});

test("the app's own single-segment routes are still not organizations", () => {
  expect(getRoute("/documents").kind).toBe("documents");
  expect(getRoute("/activity").kind).toBe("activity");
  expect(getRoute("/login").kind).toBe("login");
  expect(getRoute("/billing").kind).toBe("billing");
});
