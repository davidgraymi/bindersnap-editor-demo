import { expect, test } from "bun:test";

import {
  acceptsDrop,
  isManaged,
  planMove,
  type DragSubject,
} from "./binderMove";
import type { BinderTreeNode } from "./binderTree";

const policy = (folder: string, slug = "hand-hygiene"): DragSubject => ({
  kind: "document",
  slugPath: folder === "" ? slug : `${folder}/${slug}`,
  folder,
});

const folder = (path: string): DragSubject => ({ kind: "folder", path });

// ── dropping a policy ──────────────────────────────────────────────

test("a policy dropped on a folder is filed there", () => {
  expect(planMove(policy("nursing"), "pharmacy")).toEqual({
    kind: "document",
    slugPath: "nursing/hand-hygiene",
    folder: "pharmacy",
  });
});

test("a policy dropped at the top level goes to the top level", () => {
  // "" is the root, and it is a real answer rather than the absence of one —
  // dragging something out of a folder is the whole point of a root drop zone.
  expect(planMove(policy("nursing"), "")).toEqual({
    kind: "document",
    slugPath: "nursing/hand-hygiene",
    folder: "",
  });
});

test("a policy dropped back where it was does nothing", () => {
  // Not a failure. A folder row is a large target and somebody who thought
  // better of a drag should pay nothing for it — no act, no commit, no line in
  // the change request saying a policy was moved to where it already was.
  expect(planMove(policy("nursing"), "nursing")).toBeNull();
  expect(planMove(policy(""), "")).toBeNull();
});

// ── dropping a folder ──────────────────────────────────────────────

test("a folder dropped on another keeps its name and gains a parent", () => {
  expect(planMove(folder("nursing"), "clinical")).toEqual({
    kind: "folder",
    from: "nursing",
    to: "clinical/nursing",
  });
});

test("a nested folder dragged to the top level loses its parent", () => {
  expect(planMove(folder("clinical/nursing"), "")).toEqual({
    kind: "folder",
    from: "clinical/nursing",
    to: "nursing",
  });
});

test("a folder dropped on itself does nothing", () => {
  expect(planMove(folder("nursing"), "nursing")).toBeNull();
});

test("a folder dropped on the parent it already has does nothing", () => {
  expect(planMove(folder("clinical/nursing"), "clinical")).toBeNull();
});

test("a folder cannot be dropped inside itself", () => {
  // Every file under it would land at a path that is about to stop existing.
  // Refused here as well as on the server, because the row under the pointer
  // has to not light up — a drop that is going to fail should not look like
  // one that will work.
  expect(planMove(folder("nursing"), "nursing/infection-control")).toEqual({
    kind: "refused",
    why: "A folder cannot be moved inside itself.",
  });
  expect(planMove(folder("a"), "a/b/c/d")).toMatchObject({ kind: "refused" });
});

test("a folder whose name merely starts the same is a different folder", () => {
  // `nursing-admin` is not inside `nursing`, and a `startsWith` without the
  // slash would have said it was.
  expect(planMove(folder("nursing"), "nursing-admin")).toEqual({
    kind: "folder",
    from: "nursing",
    to: "nursing-admin/nursing",
  });
});

// ── what lights up ─────────────────────────────────────────────────

test("a row accepts a drop only when the drop would do something", () => {
  expect(acceptsDrop(policy("nursing"), "pharmacy")).toBe(true);
  expect(acceptsDrop(policy("nursing"), "nursing")).toBe(false);
  expect(acceptsDrop(folder("nursing"), "nursing/infection-control")).toBe(
    false,
  );
  expect(acceptsDrop(folder("nursing"), "clinical")).toBe(true);
});

// ── what edit mode may touch ───────────────────────────────────────

/** A document row, as the tree hands one over. */
function row(uid: string | null): BinderTreeNode {
  return {
    kind: "document",
    document: {
      path: "nursing/hand-hygiene.md",
      slugPath: "nursing/hand-hygiene",
      name: "hand-hygiene",
      uid,
      folder: "nursing",
      size: 0,
      sha: "",
      state: "published",
      openChangeCount: 0,
      latestVersion: null,
    },
  };
}

test("a policy this product wrote can be renamed and moved", () => {
  expect(isManaged(row("01J8XZ4K7MQ0R3V6Y9B2C5D8EF"))).toBe(true);
});

test("a file with no identity cannot", () => {
  // A `README.md` Gitea made with the repository. Its filename has no identity
  // segment, so the version tags have nothing to be named after and the server
  // refuses the rename — correctly, because it would orphan a history the file
  // never had. The pencil is not drawn rather than drawn and then apologised
  // for.
  expect(isManaged(row(null))).toBe(false);
});

test("a folder is always editable, having no identity to be missing", () => {
  expect(
    isManaged({
      kind: "folder",
      path: "nursing",
      name: "nursing",
      children: [],
      documentCount: 0,
    }),
  ).toBe(true);
});
