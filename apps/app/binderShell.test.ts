import { expect, test } from "bun:test";

import {
  binderTabFromSearch,
  buildBinderUrl,
  changeViewFromSearch,
} from "./binderShell";

// ── the tab in the address bar ─────────────────────────────────────

test("no tab in the query opens the documents", () => {
  expect(binderTabFromSearch("")).toBe("documents");
  expect(binderTabFromSearch("?change=3")).toBe("documents");
});

test("a tab in the query is the tab", () => {
  expect(binderTabFromSearch("?tab=changes")).toBe("changes");
});

test("every tab the binder has is addressable", () => {
  expect(binderTabFromSearch("?tab=history")).toBe("history");
  expect(binderTabFromSearch("?tab=settings")).toBe("settings");
});

test("a tab nobody has opens the documents rather than nothing", () => {
  // A mangled or out-of-date link should show the binder, not a blank pane.
  expect(binderTabFromSearch("?tab=people")).toBe("documents");
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

// ── which screen of a change ───────────────────────────────────────

test("a bare change link opens the discussion, where the decision is made", () => {
  expect(changeViewFromSearch("?change=3")).toBe("discussion");
  expect(changeViewFromSearch("?change=3&view=nonsense")).toBe("discussion");
});

test("the file and the comparison each have their own address", () => {
  expect(changeViewFromSearch("?view=preview")).toBe("preview");
  expect(changeViewFromSearch("?view=compare")).toBe("compare");
});

test("the discussion carries no view, so a change's own link stays short", () => {
  expect(
    buildBinderUrl({
      org: "riverside",
      binder: "clinical",
      tab: "changes",
      change: 3,
      view: "discussion",
    }),
  ).toBe("/riverside/clinical?tab=changes&change=3");
});

test("another screen names itself", () => {
  expect(
    buildBinderUrl({
      org: "riverside",
      binder: "clinical",
      tab: "changes",
      change: 3,
      view: "compare",
    }),
  ).toBe("/riverside/clinical?tab=changes&change=3&view=compare");
});
