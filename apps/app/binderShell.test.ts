import { expect, test } from "bun:test";

import {
  archiveFromSearch,
  binderTabFromSearch,
  buildBinderUrl,
  changeViewFromSearch,
  editModeFromSearch,
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
  expect(binderTabFromSearch("?tab=people")).toBe("people");
  expect(binderTabFromSearch("?tab=history")).toBe("history");
  expect(binderTabFromSearch("?tab=settings")).toBe("settings");
});

test("a tab nobody has opens the documents rather than nothing", () => {
  // A mangled or out-of-date link should show the binder, not a blank pane.
  // `people` was the example here and became a real tab; `sign-off` replaced it
  // and became one too. That is the fallback doing its job twice — an old link
  // keeps working — so the example is deliberately something no tab will be.
  expect(binderTabFromSearch("?tab=nonesuch")).toBe("documents");
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

// ── editing the binder ─────────────────────────────────────────────

test("a binder nobody is editing says nothing about editing", () => {
  expect(editModeFromSearch("")).toBe("off");
  expect(editModeFromSearch("?tab=changes")).toBe("off");
  expect(buildBinderUrl({ org: "riverside", binder: "clinical" })).toBe(
    "/riverside/clinical",
  );
  expect(
    buildBinderUrl({ org: "riverside", binder: "clinical", edit: "off" }),
  ).toBe("/riverside/clinical");
});

test("edit mode is in the address, so a reload lands back in it", () => {
  expect(editModeFromSearch("?edit=1")).toBe("editing");
  expect(
    buildBinderUrl({ org: "riverside", binder: "clinical", edit: "editing" }),
  ).toBe("/riverside/clinical?edit=1");
});

test("writing the change request up is its own address", () => {
  expect(editModeFromSearch("?edit=propose")).toBe("proposing");
  expect(
    buildBinderUrl({ org: "riverside", binder: "clinical", edit: "proposing" }),
  ).toBe("/riverside/clinical?edit=propose");
});

test("an edit value nobody set is not editing, rather than half-editing", () => {
  // A mangled link should show the binder. Reading anything truthy as "edit"
  // would put somebody into a draft they never asked for.
  expect(editModeFromSearch("?edit=")).toBe("off");
  expect(editModeFromSearch("?edit=yes")).toBe("off");
  expect(editModeFromSearch("?edit=true")).toBe("off");
  expect(editModeFromSearch("?edit=0")).toBe("off");
});

// ── the archive ────────────────────────────────────────────────────

test("a binder that is not showing its archive says nothing about it", () => {
  expect(archiveFromSearch("")).toBe(false);
  expect(archiveFromSearch("?edit=1")).toBe(false);
  expect(buildBinderUrl({ org: "riverside", binder: "clinical" })).toBe(
    "/riverside/clinical",
  );
  expect(
    buildBinderUrl({ org: "riverside", binder: "clinical", archive: false }),
  ).toBe("/riverside/clinical");
});

test("the archive has an address, because it is a thing people send", () => {
  expect(archiveFromSearch("?archive=1")).toBe(true);
  expect(
    buildBinderUrl({ org: "riverside", binder: "clinical", archive: true }),
  ).toBe("/riverside/clinical?archive=1");
});

test("an archive value nobody set is not the archive", () => {
  expect(archiveFromSearch("?archive=")).toBe(false);
  expect(archiveFromSearch("?archive=yes")).toBe(false);
  expect(archiveFromSearch("?archive=0")).toBe(false);
});

test("the binder read at a change's branch keeps the documents tab's short address", () => {
  expect(
    buildBinderUrl({
      org: "riverside",
      binder: "clinical",
      ref: "draft/alice-1",
      change: 4,
    }),
  ).toBe("/riverside/clinical?ref=draft%2Falice-1&change=4");
});
