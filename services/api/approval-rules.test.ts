import { describe, expect, test } from "bun:test";

import { buildApprovalRules, matchingSignOffRules } from "./approval-rules";
import type { components } from "./gitea-client/spec/gitea";

type PullReview = components["schemas"]["PullReview"];

function user(login: string, fullName = "") {
  return { login, fullName, avatarUrl: "" };
}

function review(
  login: string,
  state: string,
  overrides: Partial<PullReview> = {},
): PullReview {
  return {
    id: Math.floor(Math.random() * 1_000_000),
    user: { login, full_name: "", avatar_url: "" },
    state,
    official: true,
    submitted_at: "2026-10-30T00:00:00Z",
    ...overrides,
  } as PullReview;
}

const board = [
  user("chair", "Cam Chair"),
  user("treasurer", "Tia Treasurer"),
  user("author", "Ann Author"),
];

function build(overrides: Partial<Parameters<typeof buildApprovalRules>[0]>) {
  return buildApprovalRules({
    author: "author",
    requiredApprovals: 2,
    approvers: { groups: ["board"], people: [] },
    signOff: [],
    reviews: [],
    ignoresStale: true,
    members: (group) => (group === "board" ? board : []),
    person: (login) => user(login),
    ...overrides,
  });
}

describe("the binder's approvers", () => {
  test("lists everyone who can approve, without the author", () => {
    const [rule] = build({});
    expect(rule).toMatchObject({ kind: "approvers", required: 2 });
    expect(rule!.eligible.map((person) => person.login)).toEqual([
      "chair",
      "treasurer",
    ]);
  });

  test("counts only official approvals that still stand", () => {
    const [rule] = build({
      reviews: [
        review("chair", "APPROVED"),
        review("treasurer", "APPROVED", { stale: true }),
        // Not an approver when they approved: Gitea did not count it.
        review("nurse", "APPROVED", { official: false }),
      ],
    });
    expect(rule!.approvedBy.map((person) => person.login)).toEqual(["chair"]);
  });

  test("is not a rule when the binder needs no approvals", () => {
    expect(build({ requiredApprovals: 0 })).toEqual([]);
  });

  test("names somebody named directly, by name", () => {
    const [rule] = build({
      approvers: { groups: [], people: ["dr-okafor"] },
      person: (login) => user(login, "Dr. Bola Okafor"),
    });
    expect(rule!.eligible).toEqual([user("dr-okafor", "Dr. Bola Okafor")]);
  });
});

describe("sign-off rules", () => {
  const rules = [
    {
      scope: "folder" as const,
      target: "clinical",
      teams: ["board"],
      users: [],
    },
    { scope: "folder" as const, target: "hr", teams: ["hr"], users: [] },
  ];

  test("only the rules matching a changed file apply", () => {
    expect(
      matchingSignOffRules(rules, ["clinical/hand-hygiene.01J8.md"]).map(
        (rule) => rule.target,
      ),
    ).toEqual(["clinical"]);
  });

  test("need one owner's approval, official or not", () => {
    // Gitea's code-owner gate ignores officialness: an owner's standing
    // approval meets the rule whether or not they are a binder approver.
    const [, rule] = build({
      signOff: [rules[0]!],
      reviews: [review("treasurer", "APPROVED", { official: false })],
    });
    expect(rule).toMatchObject({ kind: "sign-off", required: 1 });
    expect(rule!.approvedBy.map((person) => person.login)).toEqual([
      "treasurer",
    ]);
  });
});
