import { expect, test } from "bun:test";

import {
  asShellRoute,
  getRoute,
  isProtectedAppRoute,
  routeToPath,
} from "./routes";

test("getRoute maps the SPA home route to the landing/app home kind", () => {
  expect(getRoute("/")).toEqual({ kind: "home" });
  expect(getRoute("/trailing///")).toEqual({ kind: "home" });
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

  expect(getRoute("/docs/alice/quarterly-report/collaborators")).toEqual({
    kind: "document",
    owner: "alice",
    repo: "quarterly-report",
    tab: "collaborators",
  });

  expect(getRoute("/docs/alice/quarterly-report/permissions")).toEqual({
    kind: "document",
    owner: "alice",
    repo: "quarterly-report",
    tab: "permissions",
  });
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
  const tabs = [
    "overview",
    "changes",
    "history",
    "collaborators",
    "permissions",
  ] as const;

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

test("getRoute maps permissions path with URL-encoded owner/repo", () => {
  expect(getRoute("/docs/alice-org/my%20doc/permissions")).toEqual({
    kind: "document",
    owner: "alice-org",
    repo: "my%20doc",
    tab: "permissions",
  });
});

test("routeToPath keeps home and workspace on the root URL", () => {
  expect(routeToPath({ kind: "home" })).toBe("/");
  expect(routeToPath({ kind: "workspace" })).toBe("/");
  expect(routeToPath({ kind: "login" })).toBe("/login");
  expect(routeToPath({ kind: "signup" })).toBe("/signup");
  expect(routeToPath({ kind: "inbox" })).toBe("/inbox");
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
  expect(isProtectedAppRoute({ kind: "inbox" })).toBe(true);
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
