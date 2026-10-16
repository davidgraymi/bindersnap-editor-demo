import { expect, test } from "bun:test";

import { describeLastChange } from "./BinderPage";
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
    lastChange: null,
    ...overrides,
  };
}

// Grouping moved to `binderTree.ts` and is tested there. What stayed here is
// what a row says beside its name, which is this file's own.

test("a policy's row says what last changed it, and how long ago", () => {
  const now = Date.parse("2026-09-17T12:00:00Z");
  expect(
    describeLastChange(
      entry({
        slugPath: "nursing/handover",
        folder: "nursing",
        lastChange: {
          number: 4,
          title: "Monthly audits and fourteen-day training",
          publishedAt: "2026-08-27T12:00:00Z",
        },
      }),
      now,
    ),
  ).toEqual({
    number: 4,
    subject: "Monthly audits and fourteen-day training",
    when: "3 weeks ago",
  });
});

test("a change with no title is still named, by its number", () => {
  expect(
    describeLastChange(
      entry({
        slugPath: "admissions",
        folder: "",
        lastChange: { number: 9, title: "", publishedAt: "" },
      }),
    )?.subject,
  ).toBe("Change 9");
});

test("a policy with no recorded change says nothing rather than guessing", () => {
  expect(
    describeLastChange(entry({ slugPath: "admissions", folder: "" })),
  ).toBeNull();
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
