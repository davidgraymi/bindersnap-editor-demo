import { expect, test } from "bun:test";

import {
  asShellRoute,
  getRoute,
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

test("routeToPath round-trips a binder, its tabs and one of its changes", () => {
  // A link into a change arrives from Home and from quick find, so the tab and
  // the change number have to survive the round trip — landing on the binder's
  // Documents tab instead would drop somebody one click away from what they
  // clicked.
  const routes = [
    { kind: "binder", org: "riverside-health", binder: "clinical" },
    {
      kind: "binder",
      org: "riverside-health",
      binder: "clinical",
      tab: "sign-off",
    },
    {
      kind: "binderDocument",
      org: "riverside-health",
      binder: "clinical",
      documentPath: "nursing/infection-control",
    },
  ] as const;

  for (const route of routes) {
    expect(getRoute(routeToPath(route))).toMatchObject({
      kind: route.kind,
      org: route.org,
      binder: route.binder,
    });
  }

  // The binder's own address stays the short one, the way a repository's is.
  expect(
    routeToPath({
      kind: "binder",
      org: "riverside-health",
      binder: "clinical",
    }),
  ).toBe("/riverside-health/clinical");
  expect(
    routeToPath({
      kind: "binder",
      org: "riverside-health",
      binder: "clinical",
      tab: "changes",
      change: 3,
    }),
  ).toBe("/riverside-health/clinical?tab=changes&change=3");
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
