import { expect, test } from "bun:test";

import { binderTabFromSearch, buildBinderUrl } from "./binderShell";

// ── the tab in the address bar ─────────────────────────────────────

test("no tab in the query opens the documents", () => {
  expect(binderTabFromSearch("")).toBe("documents");
  expect(binderTabFromSearch("?change=3")).toBe("documents");
});

test("a tab in the query is the tab", () => {
  expect(binderTabFromSearch("?tab=changes")).toBe("changes");
});

test("a tab nobody has opens the documents rather than nothing", () => {
  // A mangled or out-of-date link should show the binder, not a blank pane.
  expect(binderTabFromSearch("?tab=settings")).toBe("documents");
  expect(binderTabFromSearch("?tab=")).toBe("documents");
});

// ── building the address ───────────────────────────────────────────

test("the binder's own address is the short one", () => {
  // The tab it opens on carries no query, the way a repository's does not.
  expect(buildBinderUrl({ org: "riverside", binder: "clinical" })).toBe(
    "/riverside/clinical",
  );
  expect(
    buildBinderUrl({ org: "riverside", binder: "clinical", tab: "documents" }),
  ).toBe("/riverside/clinical");
});

test("another tab names itself, so it can be sent to somebody", () => {
  expect(
    buildBinderUrl({ org: "riverside", binder: "clinical", tab: "changes" }),
  ).toBe("/riverside/clinical?tab=changes");
});

test("one change is addressed inside its tab", () => {
  expect(
    buildBinderUrl({
      org: "riverside",
      binder: "clinical",
      tab: "changes",
      change: 3,
    }),
  ).toBe("/riverside/clinical?tab=changes&change=3");
});
