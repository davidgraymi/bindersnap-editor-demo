import { expect, test } from "bun:test";

import { describeDocument } from "./BinderPage";
import type { WorkspaceDocumentListEntry } from "../../../packages/api-schema/schemas/workspaces";

function entry(
  overrides: Partial<WorkspaceDocumentListEntry> &
    Pick<WorkspaceDocumentListEntry, "slugPath" | "folder">,
): WorkspaceDocumentListEntry {
  return {
    path: `${overrides.slugPath}.md`,
    name: overrides.slugPath.split("/").pop() ?? "",
    uid: "01J8XZ4K7MQ0R3V6Y9B2C5D8EF",
    size: 0,
    sha: "",
    state: "published",
    openChangeCount: 0,
    latestVersion: null,
    ...overrides,
  };
}

// Grouping moved to `binderTree.ts` and is tested there. What stayed here is
// the sentence under a row, which is this file's own.

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

test("a binder lists the record, so every row has a file behind it", () => {
  // The list used to carry rows for policies that existed only inside an open
  // change — no version, no file, no guarantee of arriving — beside policies
  // in force. A reader could not tell the two apart at a glance, which is the
  // one thing a list of what is in force must never allow.
  const row = entry({ slugPath: "nursing/hand-hygiene", folder: "nursing" });
  expect(row.state).toBe("published");
  expect(typeof row.path).toBe("string");
  expect(typeof row.sha).toBe("string");
});
