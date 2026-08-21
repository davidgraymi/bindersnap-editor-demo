import { expect, test } from "bun:test";

import {
  closedChangeToRecord,
  describeChangeOutcome,
  formatDocumentName,
  getChangeStateBadgeClass,
  getChangeStateLabel,
  getDocumentStatusLabel,
  getInitials,
  getReviewStateLabel,
  parseSubmissionSummary,
  resolveDocumentStatus,
  resolveWorkspaceDocumentStatus,
  toChangeRecord,
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

test("a generated upload is named after the file, not its submitter", () => {
  const change = toChangeRecord({
    number: 4,
    body: "Automated upload from Bindersnap file vault. Source file: CHANGELOG.md Document: changelog Uploaded by: bob",
    branchName: "upload/v2",
    created_at: "2026-02-01T00:00:00Z",
    approvalState: "in_review",
    user: { login: "bob" },
  });

  // The row already says "submitted by Bob on 1 Feb"; a title that repeats it
  // is the same sentence twice.
  expect(change.summary).toBe("New version of CHANGELOG.md");
});

test("getInitials handles one and two part names", () => {
  expect(getInitials("Dana Reyes")).toBe("DR");
  expect(getInitials("bob")).toBe("BO");
  expect(getInitials("  ")).toBe("?");
});

test("an open change keeps its approval state as its badge", () => {
  const change = toChangeRecord({
    number: 4,
    body: "Adds the 2026 retention clause.",
    branchName: "upload/v2",
    created_at: "2026-02-01T00:00:00Z",
    approvalState: "in_review",
    user: { login: "bob" },
  });

  expect(change.open).toBe(true);
  expect(change.summary).toBe("Adds the 2026 retention clause.");
  expect(getChangeStateLabel(change)).toBe("Awaiting Approval");
  expect(describeChangeOutcome(change)).toBeNull();
});

test("a published change says which version it became", () => {
  const change = closedChangeToRecord({
    number: 4,
    body: "",
    branchName: "upload/v2",
    submittedBy: "bob",
    submittedAt: "2026-02-01T00:00:00Z",
    closedAt: "2026-02-03T00:00:00Z",
    outcome: "published",
    decidedBy: "dana",
    publishedVersion: 2,
  });

  expect(getChangeStateLabel(change)).toBe("Published");
  expect(getChangeStateBadgeClass(change)).toBe(
    "vault-status-badge vault-status-published",
  );
  expect(describeChangeOutcome(change)).toBe(
    "Published as v2 by Dana on Feb 3, 2026",
  );
});

test("a declined change names who asked for the changes it never made", () => {
  const change = closedChangeToRecord({
    number: 5,
    body: "",
    branchName: "",
    submittedBy: "bob",
    submittedAt: "2026-02-01T00:00:00Z",
    closedAt: "2026-02-04T00:00:00Z",
    outcome: "declined",
    decidedBy: "dana",
    publishedVersion: null,
  });

  expect(getChangeStateLabel(change)).toBe("Declined");
  expect(change.branchName).toBeNull();
  expect(describeChangeOutcome(change)).toBe(
    "Declined after Dana requested changes · closed Feb 4, 2026",
  );
});

test("a withdrawn change says so rather than saying nothing", () => {
  const change = closedChangeToRecord({
    number: 6,
    body: "",
    branchName: "upload/v3",
    submittedBy: "bob",
    submittedAt: "2026-02-01T00:00:00Z",
    closedAt: "2026-02-05T00:00:00Z",
    outcome: "withdrawn",
    decidedBy: null,
    publishedVersion: null,
  });

  expect(getChangeStateLabel(change)).toBe("Withdrawn");
  expect(getChangeStateBadgeClass(change)).toBe(
    "vault-status-badge vault-status-withdrawn",
  );
  expect(describeChangeOutcome(change)).toBe(
    "Withdrawn without a decision · closed Feb 5, 2026",
  );
});
