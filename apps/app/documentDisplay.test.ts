import { expect, test } from "bun:test";

import {
  closedChangeToRecord,
  describeApprovalProgress,
  describeChangeOutcome,
  formatDocumentName,
  getChangeStateBadgeClass,
  getChangeStateLabel,
  getDocumentStatusLabel,
  getInitials,
  getReviewerDisplayName,
  getReviewerStatusLabel,
  getReviewStateLabel,
  hasEnoughApprovals,
  parseSubmissionSummary,
  resolveDocumentStatus,
  resolveReviewerDisplayStatus,
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
    "bs-status bs-status--published",
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
  // Declined is closed; changes-requested is still open. Same hue, own tone.
  expect(getChangeStateBadgeClass(change)).toBe(
    "bs-status bs-status--declined",
  );
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
    "bs-status bs-status--withdrawn",
  );
  expect(describeChangeOutcome(change)).toBe(
    "Withdrawn without a decision · closed Feb 5, 2026",
  );
});

test("a change with no assignments still becomes a record", () => {
  const change = toChangeRecord({
    number: 7,
    body: "Adds the 2026 retention clause.",
    branchName: "upload/v2",
    created_at: "2026-02-01T00:00:00Z",
    approvalState: "in_review",
    user: { login: "bob" },
  });

  expect(change.assignee).toBeNull();
  expect(change.reviewers).toEqual([]);
  expect(change.approvalCount).toBe(0);
  // Absent, not zero: a change that arrives without a policy has an unknown
  // requirement, which is not the same as a document demanding none.
  expect(change.requiredApprovals).toBeNull();
});

test("approval progress counts sign-offs instead of saying 'awaiting'", () => {
  expect(
    describeApprovalProgress({ approvalCount: 1, requiredApprovals: 2 }),
  ).toBe("1 of 2 approvals");
  expect(hasEnoughApprovals({ approvalCount: 1, requiredApprovals: 2 })).toBe(
    false,
  );
  expect(hasEnoughApprovals({ approvalCount: 2, requiredApprovals: 2 })).toBe(
    true,
  );
});

test("a document that demands no approvals gets no counter", () => {
  // "0 of 0 approvals" is a number that answers nothing; the badge is better.
  expect(
    describeApprovalProgress({ approvalCount: 0, requiredApprovals: 0 }),
  ).toBeNull();
  expect(hasEnoughApprovals({ approvalCount: 0, requiredApprovals: 0 })).toBe(
    false,
  );
});

test("an unknown approval requirement is not a requirement of none", () => {
  // A reader who cannot be told the denominator gets the badge, same as a
  // document that demands nothing — but the two arrive as different values, so
  // nothing downstream can mistake "unknown" for "nothing left to collect".
  expect(
    describeApprovalProgress({ approvalCount: 1, requiredApprovals: null }),
  ).toBeNull();
  expect(
    hasEnoughApprovals({ approvalCount: 3, requiredApprovals: null }),
  ).toBe(false);
});

test("an unresolved thread outranks the reviewer's own approval", () => {
  const reviewer = { login: "dana", status: "approved" as const };

  expect(resolveReviewerDisplayStatus(reviewer, new Set(["dana"]))).toBe(
    "thread_open",
  );
  expect(resolveReviewerDisplayStatus(reviewer, new Set())).toBe("approved");
});

test("asking for changes outranks everything, open thread included", () => {
  expect(
    resolveReviewerDisplayStatus(
      { login: "kim", status: "changes_requested" },
      new Set(["kim"]),
    ),
  ).toBe("changes_requested");
});

test("every reviewer state has words to go with its icon", () => {
  expect(getReviewerStatusLabel("awaiting")).toBe("Awaiting review");
  expect(getReviewerStatusLabel("thread_open")).toBe("Has an open thread");
  expect(getReviewerStatusLabel("changes_requested")).toBe("Asked for changes");
  expect(getReviewerStatusLabel("approved")).toBe("Approved");
});

test("a reviewer is named as a person, falling back to their username", () => {
  expect(
    getReviewerDisplayName({ login: "dana", fullName: "Dana Reyes" }),
  ).toBe("Dana Reyes");
  expect(getReviewerDisplayName({ login: "bob", fullName: "  " })).toBe("Bob");
});
