import { expect, test } from "bun:test";

import {
  buildReplayCommitMessage,
  formatReport,
  parseArgs,
  slugPathForSourceRepo,
  targetPathFor,
  versionFromLegacyTag,
  type DocumentPlan,
  type SourceVersion,
} from "./backfill-workspace-documents";

test("versionFromLegacyTag reads the old zero-padded tag", () => {
  expect(versionFromLegacyTag("doc/v0001")).toBe(1);
  expect(versionFromLegacyTag("doc/v0042")).toBe(42);
});

test("versionFromLegacyTag ignores tags this app did not publish", () => {
  // Replaying someone's release tag as a policy version would invent evidence.
  expect(versionFromLegacyTag("v1")).toBeNull();
  expect(versionFromLegacyTag("release-2026")).toBeNull();
  expect(versionFromLegacyTag("doc/v0000")).toBeNull();
  expect(versionFromLegacyTag("doc/draft")).toBeNull();
});

test("the repository name becomes the document's path", () => {
  expect(slugPathForSourceRepo("infection-control-policy")).toBe(
    "infection-control-policy",
  );
  // The repository name was the document's name, so it is what a person will
  // recognise — but it still has to be a usable path segment.
  expect(slugPathForSourceRepo("Infection Control (2026)")).toBe(
    "infection-control-2026",
  );
});

test("the extension follows the file, not the repository", () => {
  expect(targetPathFor("infection-control", "document.pdf")).toBe(
    "infection-control.pdf",
  );
  expect(targetPathFor("handover", "document")).toBe("handover");
});

const plan: DocumentPlan = {
  sourceOwner: "alice",
  sourceRepo: "infection-control-policy",
  slugPath: "infection-control-policy",
  targetPath: "infection-control-policy.pdf",
  versions: [],
  alreadyPresent: [],
};

const version: SourceVersion = {
  version: 2,
  tag: "doc/v0002",
  commitSha: "abc1234",
  authorName: "Alice Example",
  authorEmail: "alice@example.com",
  authoredAt: "2026-03-01T10:00:00Z",
  sourcePath: "document.pdf",
  approvals: [{ reviewer: "bob", submittedAt: "2026-03-01T09:00:00Z" }],
};

test("the replayed commit carries its provenance", () => {
  const message = buildReplayCommitMessage(plan, version);

  // A surveyor asking where this version came from gets the answer from the
  // record, not from a runbook nobody kept.
  expect(message).toContain("Publish v2: infection-control-policy");
  expect(message).toContain("alice/infection-control-policy");
  expect(message).toContain("doc/v0002");
  expect(message).toContain("abc1234");
  expect(message).toContain("Alice Example");
});

test("the replayed commit records who approved, because a review cannot follow it", () => {
  const message = buildReplayCommitMessage(plan, version);

  expect(message).toContain("Approved in the source repository by:");
  expect(message).toContain("bob on 2026-03-01T09:00:00Z");
});

test("an unapproved version says so rather than going quiet", () => {
  // "No approval recorded" and "we lost the approval" look identical in a
  // silent migration, and they are not the same fact.
  const message = buildReplayCommitMessage(plan, {
    ...version,
    approvals: [],
  });

  expect(message).toContain("No approval was recorded");
});

test("parseArgs defaults to writing nothing", () => {
  expect(parseArgs([]).dryRun).toBe(false);
  expect(parseArgs(["--dry"]).dryRun).toBe(true);
  expect(parseArgs(["--user=alice"]).username).toBe("alice");
  expect(parseArgs(["--workspace=clinical"]).workspace).toBe("clinical");
});

test("the report names what it skipped and why", () => {
  const output = formatReport({
    organization: "mercy-health",
    workspace: "binder",
    planned: [{ ...plan, versions: [version], alreadyPresent: [] }],
    skipped: [
      { repo: "alice/scratch", reason: "no published version" },
      { repo: "alice/infection control policy", reason: 'would land on "x"' },
    ],
  });

  expect(output).toContain("infection-control-policy.pdf");
  expect(output).toContain("infection-control-policy/v2");
  expect(output).toContain("bob");
  // The skipped list is the point of the dry run: these need a decision.
  expect(output).toContain("need a decision, not a guess");
  expect(output).toContain("alice/scratch");
});

test("a document already replayed reports nothing to do", () => {
  const output = formatReport({
    organization: "mercy-health",
    workspace: "binder",
    planned: [{ ...plan, versions: [version], alreadyPresent: [2] }],
    skipped: [],
  });

  // Re-running has to be safe and boring, or nobody will run it twice.
  expect(output).toContain("already replayed, nothing to do");
});
