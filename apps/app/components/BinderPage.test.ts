import { expect, test } from "bun:test";

import { describeDocument, groupByFolder } from "./BinderPage";
import type { WorkspaceDocumentListEntry } from "../../../packages/api-schema/schemas/workspaces";

function entry(
  overrides: Partial<WorkspaceDocumentListEntry> &
    Pick<WorkspaceDocumentListEntry, "slugPath" | "folder">,
): WorkspaceDocumentListEntry {
  return {
    path: `${overrides.slugPath}.md`,
    name: overrides.slugPath.split("/").pop() ?? "",
    size: 0,
    sha: "",
    state: "published",
    openChangeCount: 0,
    latestVersion: null,
    ...overrides,
  };
}

test("root-level documents lead, then folders alphabetically", () => {
  // A binder nobody has filed yet is the ordinary starting state, and burying
  // those under an empty heading would make a new binder look broken.
  const groups = groupByFolder([
    entry({ slugPath: "nursing/handover", folder: "nursing" }),
    entry({ slugPath: "admissions", folder: "" }),
    entry({ slugPath: "administrative/grievance", folder: "administrative" }),
  ]);

  expect(groups.map((group) => group.folder)).toEqual([
    "",
    "administrative",
    "nursing",
  ]);
});

test("documents in one folder stay together", () => {
  const groups = groupByFolder([
    entry({ slugPath: "nursing/handover", folder: "nursing" }),
    entry({ slugPath: "nursing/infection", folder: "nursing" }),
  ]);

  expect(groups).toHaveLength(1);
  expect(groups[0]?.documents).toHaveLength(2);
});

test("a document says which version it is at", () => {
  expect(
    describeDocument(
      entry({
        slugPath: "nursing/handover",
        folder: "nursing",
        latestVersion: {
          tag: "nursing/handover/v3",
          version: 3,
          commitSha: "a",
          publishedAt: "",
        },
      }),
    ),
  ).toBe("Version 3");
});

test("an unpublished document says so rather than showing nothing", () => {
  // "No version" and "we did not load it" look the same if this is blank.
  expect(describeDocument(entry({ slugPath: "admissions", folder: "" }))).toBe(
    "No published version",
  );
});

test("open changes are counted alongside the version", () => {
  expect(
    describeDocument(
      entry({
        slugPath: "admissions",
        folder: "",
        latestVersion: {
          tag: "admissions/v1",
          version: 1,
          commitSha: "a",
          publishedAt: "",
        },
        openChangeCount: 2,
      }),
    ),
  ).toBe("Version 1 · 2 open changes");
});

test("a document that is only proposed is waiting, not faulty", () => {
  // "No published version" reads like something is wrong with it. It is
  // waiting on a decision, which is the ordinary state of a policy somebody
  // uploaded an hour ago.
  expect(
    describeDocument(
      entry({
        slugPath: "nursing/hand-hygiene",
        folder: "nursing",
        path: null,
        size: null,
        sha: null,
        state: "proposed",
        openChangeCount: 1,
      }),
    ),
  ).toBe("Not published yet · 1 open change");
});
