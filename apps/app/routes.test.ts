import { expect, test } from "bun:test";

import { asShellRoute, getRoute, routeToPath } from "./routes";

test("getRoute maps the SPA home route to the landing/app home kind", () => {
  expect(getRoute("/")).toEqual({ kind: "home" });
  expect(getRoute("/trailing///")).toEqual({ kind: "home" });
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
});

test("routeToPath keeps home and workspace on the root URL", () => {
  expect(routeToPath({ kind: "home" })).toBe("/");
  expect(routeToPath({ kind: "workspace" })).toBe("/");
  expect(routeToPath({ kind: "inbox" })).toBe("/inbox");
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
