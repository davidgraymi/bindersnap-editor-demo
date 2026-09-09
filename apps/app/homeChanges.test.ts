import { describe, expect, test } from "bun:test";

import type {
  ChangeReviewer,
  ClosedChange,
  PullRequestWithApprovalState,
  VersionReview,
  HomeOpenDocument,
} from "./api";
import {
  buildDecidedChangeRows,
  buildOpenChangeRows,
  describeWaitingCount,
  formatNameList,
  formatWhen,
  getGreetingName,
  selectSubmissions,
  selectWaitingOnYou,
} from "./homeChanges";

const NOW = new Date("2026-08-22T12:00:00Z").getTime();

function reviewer(
  login: string,
  overrides: Partial<ChangeReviewer> = {},
): ChangeReviewer {
  return {
    login,
    fullName: "",
    avatarUrl: "",
    status: "awaiting",
    reviewedAt: "",
    stale: false,
    requested: true,
    ...overrides,
  };
}

function review(
  login: string,
  overrides: Partial<VersionReview> = {},
): VersionReview {
  return {
    id: 1,
    author: { login, fullName: "", avatarUrl: "" },
    state: "approved",
    body: "",
    submittedAt: "2026-08-19T10:00:00Z",
    stale: false,
    dismissed: false,
    ...overrides,
  };
}

type HomeChange = HomeOpenDocument["pendingPRs"][number];

function change(overrides: Partial<HomeChange> = {}): HomeChange {
  return {
    id: 1,
    number: 4,
    title: "Change",
    state: "open",
    created: "2026-08-22T10:00:00Z",
    created_at: "2026-08-22T10:00:00Z",
    updated_at: "2026-08-22T10:00:00Z",
    branchName: "version/2",
    approvalCount: 2,
    requiredApprovals: 3,
    isApproved: false,
    isRejected: false,
    reviewers: [],
    assignee: null,
    body: "Updated liability clause",
    approvalState: "in_review",
    user: { login: "maya" },
    // A version is per document, so it rides on the change. It used to be a
    // repository-wide `latestTag`, which answered a question about none of a
    // binder's documents.
    documentSlugPath: "nursing/vendor-agreement",
    nextVersion: 2,
    ...overrides,
  };
}

function document(
  overrides: Partial<HomeOpenDocument> = {},
  repoOverrides: Partial<HomeOpenDocument["repo"]> = {},
): HomeOpenDocument {
  return {
    repo: {
      name: "clinical",
      owner: { login: "riverside-health" },
      ...repoOverrides,
    },
    pendingPRs: [],
    error: null,
    ...overrides,
  };
}

function closed(overrides: Partial<ClosedChange> = {}): ClosedChange {
  return {
    number: 3,
    title: "New onboarding checklist",
    body: "New onboarding checklist",
    branchName: "version/6",
    submittedBy: "maya",
    submittedAt: "2026-08-18T10:00:00Z",
    closedAt: "2026-08-19T10:00:00Z",
    outcome: "published",
    decidedBy: "david",
    publishedVersion: 6,
    reviews: [],
    reviewers: [],
    assignee: null,
    approvalCount: 3,
    requiredApprovals: 3,
    ...overrides,
  };
}

describe("buildOpenChangeRows", () => {
  test("a change awaiting the reader's review needs their review", () => {
    const rows = buildOpenChangeRows(
      [
        document({
          pendingPRs: [change({ reviewers: [reviewer("david")] })],
        }),
      ],
      "david",
      NOW,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("needs_review");
    expect(rows[0]?.pillLabel).toBe("Needs your review");
    expect(rows[0]?.action).toBe("Review");
    expect(rows[0]?.documentName).toBe("Vendor Agreement");
    expect(rows[0]?.meta).toBe("Maya submitted 2h ago · 2 of 3 approvals");
  });

  test("a reader whose approval went stale is asked again", () => {
    const rows = buildOpenChangeRows(
      [
        document({
          pendingPRs: [
            change({
              reviewers: [
                reviewer("david", { status: "approved", stale: true }),
              ],
            }),
          ],
        }),
      ],
      "david",
      NOW,
    );

    expect(rows[0]?.kind).toBe("needs_review");
  });

  test("a fully approved change is the submitter's to publish", () => {
    const rows = buildOpenChangeRows(
      [
        document({
          pendingPRs: [
            change({
              user: { login: "david" },
              approvalCount: 3,
              isApproved: true,
            }),
          ],
        }),
      ],
      "david",
      NOW,
    );

    expect(rows[0]?.kind).toBe("ready_to_publish");
    expect(rows[0]?.pillLabel).toBe("Ready to publish");
    expect(rows[0]?.action).toBe("Publish");
    expect(rows[0]?.meta).toBe(
      "all approvals in · becomes v2 when you publish",
    );
  });

  test("the reader's own open change names who it is waiting on", () => {
    const rows = buildOpenChangeRows(
      [
        document({
          pendingPRs: [
            change({
              user: { login: "david" },
              created_at: "2026-08-21T10:00:00Z",
              updated_at: "2026-08-21T10:00:00Z",
              reviewers: [reviewer("priya"), reviewer("tom")],
              approvalCount: 1,
            }),
          ],
        }),
      ],
      "david",
      NOW,
    );

    expect(rows[0]?.kind).toBe("submission");
    expect(rows[0]?.meta).toBe(
      "waiting on Priya and Tom · submitted yesterday",
    );
    expect(rows[0]?.pillLabel).toBe("1 of 3 approvals");
    expect(rows[0]?.action).toBeNull();
  });

  test("a change the reader has nothing to do with is left off", () => {
    const rows = buildOpenChangeRows(
      [
        document(
          { pendingPRs: [change({ reviewers: [reviewer("priya")] })] },
          { owner: { login: "maya" } },
        ),
      ],
      "david",
      NOW,
    );

    expect(rows).toHaveLength(0);
  });

  test("newest movement comes first, across documents", () => {
    const rows = buildOpenChangeRows(
      [
        document({
          pendingPRs: [
            change({
              number: 9,
              updated_at: "2026-08-20T10:00:00Z",
              user: { login: "david" },
            }),
          ],
        }),
        document(
          {
            pendingPRs: [
              change({
                number: 1,
                updated_at: "2026-08-22T09:00:00Z",
                user: { login: "david" },
              }),
            ],
          },
          { name: "corporate" },
        ),
      ],
      "david",
      NOW,
    );

    expect(rows.map((row) => row.number)).toEqual([1, 9]);
  });

  test("sections split by what the reader must do", () => {
    const rows = buildOpenChangeRows(
      [
        document({
          pendingPRs: [
            change({ number: 1, reviewers: [reviewer("david")] }),
            change({ number: 2, user: { login: "david" } }),
          ],
        }),
      ],
      "david",
      NOW,
    );

    expect(selectWaitingOnYou(rows).map((row) => row.number)).toEqual([1]);
    expect(selectSubmissions(rows).map((row) => row.number)).toEqual([2]);
  });
});

describe("buildDecidedChangeRows", () => {
  test("a published change says what version it became", () => {
    const rows = buildDecidedChangeRows(
      [
        {
          owner: "david",
          repo: "employee-handbook",
          changes: [
            closed({
              reviews: [review("david"), review("maya"), review("tom")],
            }),
          ],
        },
      ],
      "david",
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.outcome).toBe("published");
    expect(rows[0]?.documentName).toBe("Employee Handbook");
    expect(rows[0]?.meta).toBe("you and 2 others approved");
    expect(rows[0]?.pillLabel).toBe("Published as v6 · Aug 19");
  });

  test("a withdrawn change says who withdrew it", () => {
    const rows = buildDecidedChangeRows(
      [
        {
          owner: "david",
          repo: "mutual-nda",
          changes: [
            closed({
              outcome: "withdrawn",
              publishedVersion: null,
              decidedBy: "tom",
              closedAt: "2026-08-12T10:00:00Z",
              reviewers: [reviewer("david")],
            }),
          ],
        },
      ],
      "david",
    );

    expect(rows[0]?.outcome).toBe("closed");
    expect(rows[0]?.meta).toBe("withdrawn by Tom");
    expect(rows[0]?.pillLabel).toBe("Closed · Aug 12");
  });

  test("a decision the reader had no part in is left off", () => {
    const rows = buildDecidedChangeRows(
      [
        {
          owner: "maya",
          repo: "mutual-nda",
          changes: [closed({ decidedBy: "maya" })],
        },
      ],
      "david",
    );

    expect(rows).toHaveLength(0);
  });

  test("a decision on a document the reader owns is kept", () => {
    const rows = buildDecidedChangeRows(
      [{ owner: "david", repo: "mutual-nda", changes: [closed()] }],
      "priya",
      new Set(["david/mutual-nda"]),
    );

    expect(rows).toHaveLength(1);
  });

  test("newest decision first, capped", () => {
    const rows = buildDecidedChangeRows(
      [
        {
          owner: "david",
          repo: "mutual-nda",
          changes: [
            closed({ number: 1, closedAt: "2026-08-10T10:00:00Z" }),
            closed({ number: 2, closedAt: "2026-08-20T10:00:00Z" }),
            closed({ number: 3, closedAt: "2026-08-15T10:00:00Z" }),
          ],
        },
      ],
      "david",
      new Set(["david/mutual-nda"]),
      2,
    );

    expect(rows.map((row) => row.number)).toEqual([2, 3]);
  });
});

describe("copy helpers", () => {
  test("formatWhen shades from minutes to a date", () => {
    expect(formatWhen("2026-08-22T11:59:30Z", NOW)).toBe("just now");
    expect(formatWhen("2026-08-22T11:20:00Z", NOW)).toBe("40m ago");
    expect(formatWhen("2026-08-22T09:00:00Z", NOW)).toBe("3h ago");
    expect(formatWhen("2026-08-21T09:00:00Z", NOW)).toBe("yesterday");
    expect(formatWhen("2026-08-19T09:00:00Z", NOW)).toBe("3 days ago");
    expect(formatWhen("2026-08-01T09:00:00Z", NOW)).toBe("on Aug 1");
  });

  test("formatNameList reads like a sentence", () => {
    expect(formatNameList([])).toBe("");
    expect(formatNameList(["Priya"])).toBe("Priya");
    expect(formatNameList(["Priya", "Tom"])).toBe("Priya and Tom");
    expect(formatNameList(["Priya", "Tom", "Ana"])).toBe("Priya, Tom and Ana");
    expect(formatNameList(["Priya", "Tom", "Ana", "Sam"])).toBe(
      "Priya, Tom and 2 others",
    );
  });

  test("describeWaitingCount agrees with itself", () => {
    expect(describeWaitingCount(0)).toBe("Nothing is waiting on you.");
    expect(describeWaitingCount(1)).toBe("1 change request is waiting on you.");
    expect(describeWaitingCount(2)).toBe(
      "2 change requests are waiting on you.",
    );
  });

  test("the greeting uses a first name, not a login", () => {
    expect(getGreetingName("david-gray")).toBe("David");
    expect(getGreetingName("dgray", "David Gray")).toBe("David");
  });
});

describe("naming what a row is about", () => {
  test("a row names the document, not the binder it is in", () => {
    // `document.repo` is the binder now, so naming it put "Clinical" on a row
    // about the infection control policy. The change carries which document it
    // is about.
    const rows = buildOpenChangeRows(
      [
        document({
          pendingPRs: [
            change({
              documentSlugPath: "nursing/infection-control-policy",
              reviewers: [reviewer("david")],
            }),
          ],
        }),
      ],
      "david",
      NOW,
    );

    expect(rows[0]?.documentName).toBe("Infection Control Policy");
  });

  test("a change about no document falls back to the binder", () => {
    // A sign-off rules change touches no document. Naming the binder is the
    // honest answer; inventing a document is not.
    const rows = buildOpenChangeRows(
      [
        document({
          pendingPRs: [
            change({
              documentSlugPath: null,
              nextVersion: null,
              reviewers: [reviewer("david")],
            }),
          ],
        }),
      ],
      "david",
      NOW,
    );

    expect(rows[0]?.documentName).toBe("Clinical");
  });

  test("a change ready to publish says the version it becomes", () => {
    const rows = buildOpenChangeRows(
      [
        document({
          pendingPRs: [
            change({
              nextVersion: 4,
              approvalCount: 3,
              requiredApprovals: 3,
              approvalState: "approved",
            }),
          ],
        }),
      ],
      "maya",
      NOW,
    );

    expect(rows[0]?.meta).toContain("becomes v4 when you publish");
  });

  test("a change with no document says it is ready, without inventing v1", () => {
    // The bug this replaced: `latestTag` matched the retired `doc/vNNNN`
    // format, so it was always null and every row said "becomes v1" however
    // many versions the document already had.
    const rows = buildOpenChangeRows(
      [
        document({
          pendingPRs: [
            change({
              documentSlugPath: null,
              nextVersion: null,
              approvalCount: 3,
              requiredApprovals: 3,
              approvalState: "approved",
            }),
          ],
        }),
      ],
      "maya",
      NOW,
    );

    expect(rows[0]?.meta).toBe("all approvals in · ready to publish");
    expect(rows[0]?.meta).not.toContain("v1");
  });
});
