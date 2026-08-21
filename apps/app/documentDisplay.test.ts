import { expect, test } from "bun:test";

import {
  formatDocumentName,
  getDocumentStatusLabel,
  getInitials,
  getReviewStateLabel,
  parseSubmissionSummary,
  resolveDocumentStatus,
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
  expect(getDocumentStatusLabel("draft")).toBe("No version yet");
  expect(getReviewStateLabel("changes_requested")).toBe("Requested changes");
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
