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
