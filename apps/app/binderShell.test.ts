import { expect, test } from "bun:test";

import {
  buildBinderUrl,
  editModeFromSearch,
  parseBinderAddress,
  parseLegacyBinderQuery,
} from "./binderShell";

const tabOf = (rest: string) => parseBinderAddress(rest)?.tab;
const viewOf = (rest: string) => parseBinderAddress(rest)?.view;

// ── the screen in the address bar ──────────────────────────────────

test("nothing after the binder opens the documents", () => {
  expect(tabOf("")).toBe("documents");
  expect(tabOf("/")).toBe("documents");
});

test("every screen the binder has is addressable", () => {
  expect(tabOf("/-/changes")).toBe("changes");
  expect(tabOf("/-/history")).toBe("history");
  expect(tabOf("/-/settings")).toBe("settings");
  expect(tabOf("/-/settings/people")).toBe("people");
  expect(tabOf("/-/settings/sign-off")).toBe("sign-off");
  expect(parseBinderAddress("/-/archive")?.archive).toBe(true);
});

test("a screen nobody has opens the documents rather than nothing", () => {
  // A mangled or out-of-date link should show the binder, not a blank pane.
  expect(tabOf("/-/nonesuch")).toBe("documents");
  expect(tabOf("/-/changes/zero")).toBe("changes");
});

test("a path that is not one of ours is left for the rewrite", () => {
  // `/{org}/{binder}/{path}` from before files sat at a branch.
  expect(parseBinderAddress("/nursing/hand-hygiene")).toBeNull();
});

test("a branch is one segment, however many slashes its name has", () => {
  expect(parseBinderAddress("/-/tree/upload%2Fnursing%2Fx")?.ref).toBe(
    "upload/nursing/x",
  );
  expect(
    parseBinderAddress("/-/blob/upload%2Fx/nursing/hand-hygiene", "?change=7"),
  ).toMatchObject({
    ref: "upload/x",
    documentPath: "nursing/hand-hygiene",
    // A branch is the whole address: nothing on it is a way back.
    change: null,
  });
});

test("the older query form reads as the same screen", () => {
  expect(
    parseLegacyBinderQuery("?tab=changes&change=3&view=compare"),
  ).toMatchObject({ tab: "changes", change: 3, view: "compare" });
  expect(parseLegacyBinderQuery("?tab=nonesuch").tab).toBe("documents");
  expect(parseLegacyBinderQuery("?archive=1").archive).toBe(true);
  expect(parseLegacyBinderQuery("?archive=yes").archive).toBe(false);
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
  ).toBe("/riverside/clinical/-/changes");
});

test("one change is addressed inside its tab", () => {
  expect(
    buildBinderUrl({
      org: "riverside",
      binder: "clinical",
      tab: "changes",
      change: 3,
    }),
  ).toBe("/riverside/clinical/-/changes/3");
});

// ── which screen of a change ───────────────────────────────────────

test("a bare change link opens the discussion, where the decision is made", () => {
  expect(viewOf("/-/changes/3")).toBe("discussion");
  expect(viewOf("/-/changes/3/nonsense")).toBe("discussion");
});

test("the comparison has its own address, GitLab's `diffs`", () => {
  expect(viewOf("/-/changes/3/diffs")).toBe("compare");
  expect(viewOf("/-/changes/3/preview")).toBe("preview");
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
  ).toBe("/riverside/clinical/-/changes/3");
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
  ).toBe("/riverside/clinical/-/changes/3/diffs");
});

// ── editing the binder ─────────────────────────────────────────────

test("a binder nobody is editing says nothing about editing", () => {
  expect(editModeFromSearch("")).toBe("off");
  expect(editModeFromSearch("?draft=x")).toBe("off");
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
  expect(parseBinderAddress("")?.archive).toBe(false);
  expect(
    buildBinderUrl({ org: "riverside", binder: "clinical", archive: false }),
  ).toBe("/riverside/clinical");
});

test("the archive has an address, because it is a thing people send", () => {
  expect(
    buildBinderUrl({ org: "riverside", binder: "clinical", archive: true }),
  ).toBe("/riverside/clinical/-/archive");
});

test("the binder read at a branch is that branch's tree", () => {
  expect(
    buildBinderUrl({
      org: "riverside",
      binder: "clinical",
      ref: "draft/alice-1",
      change: 4,
    }),
  ).toBe("/riverside/clinical/-/tree/draft%2Falice-1");
});
