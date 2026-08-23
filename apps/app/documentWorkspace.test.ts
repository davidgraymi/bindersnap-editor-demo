import { expect, test } from "bun:test";

import type {
  DocTag,
  PullRequestWithApprovalState,
  RepoCollaboratorPermissionSummary,
} from "./api";
import {
  buildDocumentHeaderFacts,
  buildPendingDecisionRows,
  buildTeamAvatars,
  buildVersionMenuOptions,
  buildVersionRailRows,
} from "./documentWorkspace";

function tag(version: number, created: string): DocTag {
  return { name: `v${version}`, version, sha: `sha-${version}`, created };
}

function pullRequest(
  overrides: Partial<PullRequestWithApprovalState> = {},
): PullRequestWithApprovalState {
  return {
    id: 1,
    number: 4,
    title: "Updated liability clause",
    state: "open",
    created: "2026-08-22T08:00:00Z",
    created_at: "2026-08-22T08:00:00Z",
    branchName: "upload/v4",
    approvalCount: 2,
    requiredApprovals: 3,
    isApproved: false,
    isRejected: false,
    reviewers: [],
    assignee: null,
    body: "Updated liability clause",
    approvalState: "in_review",
    user: { login: "maya" },
    ...overrides,
  };
}

test("the header states the version on record, the date, and the file", () => {
  expect(
    buildDocumentHeaderFacts({
      latestTag: tag(3, "2026-01-12T00:00:00Z"),
      fileName: "vendor-agreement.docx",
    }),
  ).toEqual({
    versionLabel: "v3 · Current",
    tone: "current",
    approvedLine: "Approved Jan 12, 2026",
    fileName: "vendor-agreement.docx",
  });
});

test("a document with nothing published says so instead of showing a version", () => {
  const facts = buildDocumentHeaderFacts({ latestTag: null, fileName: null });

  expect(facts.versionLabel).toBe("No version yet");
  // Green is approval. Nothing has been approved, so nothing is green.
  expect(facts.tone).toBe("none");
  expect(facts.approvedLine).toBe("Nothing published yet");
});

test("a pending change reads as one sentence: who, when, how far along", () => {
  const now = new Date("2026-08-22T10:00:00Z").getTime();

  expect(buildPendingDecisionRows([pullRequest()], now)).toEqual([
    {
      key: "change-4",
      number: 4,
      title: "Updated liability clause",
      meta: "Maya · 2h ago · 2 of 3 approvals",
    },
  ]);
});

test("a change on a document that demands no approvals still says where it stands", () => {
  const now = new Date("2026-08-22T10:00:00Z").getTime();
  const rows = buildPendingDecisionRows(
    [pullRequest({ approvalCount: 0, requiredApprovals: 0 })],
    now,
  );

  expect(rows[0]?.meta).toBe("Maya · 2h ago · no approvals needed");
});

test("the rail never grows past three pending changes", () => {
  const changes = [1, 2, 3, 4, 5].map((number) => pullRequest({ number }));

  expect(buildPendingDecisionRows(changes)).toHaveLength(3);
});

test("the newest version is the current one and the rest are history", () => {
  const rows = buildVersionRailRows([
    tag(3, "2026-01-12T00:00:00Z"),
    tag(2, "2025-11-03T00:00:00Z"),
    tag(1, "2025-09-22T00:00:00Z"),
  ]);

  expect(rows.map((row) => row.label)).toEqual(["v3", "v2", "v1"]);
  expect(rows.map((row) => row.current)).toEqual([true, false, false]);
  expect(rows[0]?.date).toBe("Jan 12, 2026");
});

test("reading an earlier version says so in the header, in coral", () => {
  expect(
    buildDocumentHeaderFacts({
      latestTag: tag(3, "2026-01-12T00:00:00Z"),
      fileName: "vendor-agreement.docx",
      viewedTag: tag(1, "2025-09-22T00:00:00Z"),
    }),
  ).toEqual({
    versionLabel: "v1 · Earlier version",
    tone: "past",
    approvedLine: "Approved Sep 22, 2025 · v3 is current",
    fileName: "vendor-agreement.docx",
  });
});

test("opening the version on record by number is not an earlier version", () => {
  const facts = buildDocumentHeaderFacts({
    latestTag: tag(3, "2026-01-12T00:00:00Z"),
    fileName: null,
    viewedTag: tag(3, "2026-01-12T00:00:00Z"),
  });

  expect(facts.tone).toBe("current");
  expect(facts.versionLabel).toBe("v3 · Current");
});

test("the version dropdown lists every version and ticks the record by default", () => {
  const options = buildVersionMenuOptions(
    [
      tag(3, "2026-01-12T00:00:00Z"),
      tag(2, "2025-11-03T00:00:00Z"),
      tag(1, "2025-09-22T00:00:00Z"),
    ],
    null,
  );

  expect(options.map((option) => option.label)).toEqual(["v3", "v2", "v1"]);
  expect(options.map((option) => option.current)).toEqual([true, false, false]);
  expect(options.map((option) => option.selected)).toEqual([
    true,
    false,
    false,
  ]);
});

test("the version dropdown ticks the earlier version being read", () => {
  const options = buildVersionMenuOptions(
    [tag(3, "2026-01-12T00:00:00Z"), tag(2, "2025-11-03T00:00:00Z")],
    2,
  );

  expect(options.map((option) => option.selected)).toEqual([false, true]);
});

test("the version rail stops at four rows", () => {
  const tags = [5, 4, 3, 2, 1].map((version) =>
    tag(version, "2026-01-12T00:00:00Z"),
  );

  expect(buildVersionRailRows(tags)).toHaveLength(4);
});

function collaborator(
  login: string,
  fullName: string,
): RepoCollaboratorPermissionSummary {
  return {
    permission: "write",
    access: "write",
    permissionLabel: "Can edit",
    roleName: "Editor",
    user: {
      id: 1,
      login,
      full_name: fullName,
      email: `${login}@example.com`,
      avatar_url: "",
    },
  };
}

test("the team row puts the owner first and never repeats a person", () => {
  const avatars = buildTeamAvatars(
    [
      collaborator("maya", "Maya Kaur"),
      collaborator("Alice", ""),
      collaborator("priya", "Priya Shah"),
    ],
    "alice",
  );

  expect(avatars.map((person) => person.key)).toEqual([
    "alice",
    "maya",
    "priya",
  ]);
  expect(avatars.map((person) => person.initials)).toEqual(["AL", "MK", "PS"]);
  expect(avatars[0]?.name).toBe("Alice");
});
