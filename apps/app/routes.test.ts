import { expect, test } from "bun:test";

import {
  asShellRoute,
  canonicalLocation,
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
  ).toBe("/riverside-health/clinical/-/changes/3");
});

// ── the `/-/` addresses ────────────────────────────────────────────

test("every screen of a binder sits behind the `-` no binder can be called", () => {
  const at = (tab: string, extra: object = {}) =>
    routeToPath({
      kind: "binder",
      org: "riverside-health",
      binder: "clinical",
      tab: tab as never,
      ...extra,
    });
  expect(at("changes")).toBe("/riverside-health/clinical/-/changes");
  expect(at("changes", { change: 4, view: "compare" })).toBe(
    "/riverside-health/clinical/-/changes/4/diffs",
  );
  expect(at("history")).toBe("/riverside-health/clinical/-/history");
  expect(at("settings")).toBe("/riverside-health/clinical/-/settings");
  expect(at("people")).toBe("/riverside-health/clinical/-/settings/people");
});

test("a binder can hold a folder called changes without losing its tab", () => {
  // The collision `/-/` exists to remove: a policy filed at `changes/…` and
  // the Change requests tab used to be one address.
  expect(getRoute("/riverside-health/clinical/-/changes")).toMatchObject({
    kind: "binder",
    tab: "changes",
  });
  expect(
    getRoute("/riverside-health/clinical/-/blob/main/changes/intake"),
  ).toMatchObject({ kind: "binderDocument", documentPath: "changes/intake" });
});

test("a file sits at the branch it is read on, and `main` is the record", () => {
  expect(
    getRoute("/riverside-health/clinical/-/blob/main/nursing/hand-hygiene"),
  ).toEqual({
    kind: "binderDocument",
    org: "riverside-health",
    binder: "clinical",
    documentPath: "nursing/hand-hygiene",
  });
  // A branch name has slashes, so it is one encoded segment.
  expect(
    getRoute(
      "/riverside-health/clinical/-/blob/upload%2Fnursing%2Fhand-hygiene/nursing/hand-hygiene",
    ),
  ).toMatchObject({
    documentPath: "nursing/hand-hygiene",
    ref: "upload/nursing/hand-hygiene",
  });
  expect(
    routeToPath({
      kind: "binder",
      org: "riverside-health",
      binder: "clinical",
      ref: "draft/alice/20260923",
    }),
  ).toBe("/riverside-health/clinical/-/tree/draft%2Falice%2F20260923");
});

test("an organization's own screens are behind `-` too", () => {
  expect(getRoute("/riverside-health/-/people")).toEqual({
    kind: "organization",
    org: "riverside-health",
    tab: "people",
  });
  expect(getRoute("/riverside-health/-/binders/new")).toEqual({
    kind: "organization",
    org: "riverside-health",
  });
  expect(
    routeToPath({
      kind: "organization",
      org: "riverside-health",
      tab: "people",
    }),
  ).toBe("/riverside-health/-/people");
});

test("an address from before `/-/` is rewritten to the one that replaced it", () => {
  const clinical = "/riverside-health/clinical";
  expect(
    canonicalLocation(clinical, "?tab=changes&change=4&view=compare", "#doc-2"),
  ).toBe(`${clinical}/-/changes/4/diffs#doc-2`);
  expect(canonicalLocation(clinical, "?tab=people")).toBe(
    `${clinical}/-/settings/people`,
  );
  expect(canonicalLocation(clinical, "?archive=1")).toBe(
    `${clinical}/-/archive`,
  );
  expect(canonicalLocation(clinical, "?ref=upload%2Fx&change=7")).toBe(
    `${clinical}/-/tree/upload%2Fx`,
  );
  expect(
    canonicalLocation(`${clinical}/nursing/hand-hygiene`, "?version=2"),
  ).toBe(`${clinical}/-/blob/main/nursing/hand-hygiene?version=2`);
  expect(
    canonicalLocation(
      `${clinical}/nursing/hand-hygiene`,
      "?ref=upload%2Fx&change=7",
    ),
  ).toBe(`${clinical}/-/blob/upload%2Fx/nursing/hand-hygiene`);
  // Editing is not a screen, so it stays where it was.
  expect(canonicalLocation(`${clinical}/nursing/hand-hygiene`, "?edit=1")).toBe(
    `${clinical}/-/blob/main/nursing/hand-hygiene?edit=1`,
  );
  expect(canonicalLocation("/riverside-health", "?tab=people")).toBe(
    "/riverside-health/-/people",
  );
  expect(canonicalLocation("/riverside-health", "?new=binder")).toBe(
    "/riverside-health/-/binders/new",
  );
});

test("a current address is left as it is", () => {
  for (const [path, search] of [
    ["/riverside-health/clinical", ""],
    ["/riverside-health/clinical", "?edit=1&draft=draft%2Falice%2Fx"],
    ["/riverside-health/clinical/-/changes/4", ""],
    ["/riverside-health", ""],
    ["/changes", ""],
    ["/", ""],
  ] as const) {
    expect(canonicalLocation(path, search)).toBeNull();
  }
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

/**
 * The history links to a version, not to a document.
 *
 * A row on the history is evidence that a change published v2; following it to
 * whatever the document says now answers a different question than the one
 * that was clicked, which on an audit product is the whole point.
 */
test("a document route carries the version it was opened at", () => {
  expect(
    routeToPath({
      kind: "binderDocument",
      org: "riverside-health",
      binder: "clinical",
      documentPath: "nursing/handover",
      version: 2,
    }),
  ).toBe("/riverside-health/clinical/-/blob/main/nursing/handover?version=2");
});

/** No version means the version on record, which is every other link. */
test("a document route with no version addresses the record", () => {
  expect(
    routeToPath({
      kind: "binderDocument",
      org: "riverside-health",
      binder: "clinical",
      documentPath: "nursing/handover",
    }),
  ).toBe("/riverside-health/clinical/-/blob/main/nursing/handover");
});

test("a bare /{org} addresses the organization itself", () => {
  expect(getRoute("/riverside-health")).toEqual({
    kind: "organization",
    org: "riverside-health",
  });
});

test("the app's own single-segment routes are still not organizations", () => {
  expect(getRoute("/documents").kind).toBe("documents");
  expect(getRoute("/login").kind).toBe("login");
  expect(getRoute("/billing").kind).toBe("billing");
});

test("billing names the organization it is about", () => {
  expect(getRoute("/riverside-health/-/billing")).toEqual({
    kind: "billing",
    org: "riverside-health",
  });
  expect(routeToPath({ kind: "billing", org: "riverside-health" })).toBe(
    "/riverside-health/-/billing",
  );
  // The address billing had before it sat under its organization.
  expect(canonicalLocation("/billing/riverside-health", "")).toBe(
    "/riverside-health/-/billing",
  );
  // The address from before billing was per organization still resolves.
  expect(getRoute("/billing")).toEqual({ kind: "billing" });
  expect(routeToPath({ kind: "billing" })).toBe("/billing");
});
