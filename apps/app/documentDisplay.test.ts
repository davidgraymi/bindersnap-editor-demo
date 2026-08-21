import { expect, test } from "bun:test";

import {
  formatDocumentName,
  getDocumentStatusLabel,
  getInitials,
  getReviewStateLabel,
  parseSubmissionSummary,
  resolveDocumentStatus,
  resolveWorkspaceDocumentStatus,
} from "./documentDisplay";

test("formatDocumentName turns a repo slug into a title", () => {
  expect(formatDocumentName("quarterly-report")).toBe("Quarterly Report");
  expect(formatDocumentName("resume")).toBe("Resume");
});

test("resolveDocumentStatus reports the most urgent open state first", () => {
  expect(
    resolveDocumentStatus({
      hasPublishedVersion: true,
      openApprovalStates: ["in_review", "changes_requested"],
    }),
  ).toBe("changes_requested");

  expect(
    resolveDocumentStatus({
      hasPublishedVersion: true,
      openApprovalStates: ["in_review", "approved"],
    }),
  ).toBe("approved");

  expect(
    resolveDocumentStatus({
      hasPublishedVersion: false,
      openApprovalStates: ["in_review"],
    }),
  ).toBe("in_review");
});

test("resolveDocumentStatus falls back to the published state when nothing is open", () => {
  expect(
    resolveDocumentStatus({
      hasPublishedVersion: true,
      openApprovalStates: [],
    }),
  ).toBe("published");

  expect(
    resolveDocumentStatus({
      hasPublishedVersion: false,
      openApprovalStates: [],
    }),
  ).toBe("draft");
});

test("status labels read like a person wrote them", () => {
  expect(getDocumentStatusLabel("approved")).toBe("Ready to publish");
  expect(getDocumentStatusLabel("published")).toBe("Published");
  expect(getDocumentStatusLabel("draft")).toBe("Draft");
  expect(getReviewStateLabel("changes_requested")).toBe("Requested changes");
});

test("resolveWorkspaceDocumentStatus scans every open change, not just the first", () => {
  // The bug this replaced: both list pages read `pendingPRs[0]` and stopped,
  // so a second change asking for work was invisible on the row.
  expect(
    resolveWorkspaceDocumentStatus({
      latestTag: { version: 3 },
      pendingPRs: [
        { approvalState: "in_review" },
        { approvalState: "changes_requested" },
      ],
    }),
  ).toBe("changes_requested");
});

test("resolveWorkspaceDocumentStatus separates published from ready-to-publish", () => {
  // Both used to render "Approved" on the list, which made a document with
  // nothing outstanding look identical to one waiting to be published.
  expect(
    resolveWorkspaceDocumentStatus({
      latestTag: { version: 3 },
      pendingPRs: [],
    }),
  ).toBe("published");

  expect(
    resolveWorkspaceDocumentStatus({
      latestTag: { version: 3 },
      pendingPRs: [{ approvalState: "approved" }],
    }),
  ).toBe("approved");

  expect(
    resolveWorkspaceDocumentStatus({ latestTag: null, pendingPRs: [] }),
  ).toBe("draft");
});

test("parseSubmissionSummary rewrites the generated upload body", () => {
  expect(
    parseSubmissionSummary(
      "Automated upload from Bindersnap file vault. Source file: CHANGELOG.md Document: changelog Uploaded by: bob File hash (SHA-256): 76ff",
    ),
  ).toBe("Submitted by Bob · CHANGELOG.md");
});

test("parseSubmissionSummary keeps a body a person wrote", () => {
  expect(parseSubmissionSummary("Adds the 2026 retention clause.")).toBe(
    "Adds the 2026 retention clause.",
  );
  expect(parseSubmissionSummary("   ")).toBeNull();
  expect(parseSubmissionSummary(null)).toBeNull();
});

test("getInitials handles one and two part names", () => {
  expect(getInitials("Dana Reyes")).toBe("DR");
  expect(getInitials("bob")).toBe("BO");
  expect(getInitials("  ")).toBe("?");
});
