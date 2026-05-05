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
