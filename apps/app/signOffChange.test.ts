import { describe, expect, test } from "bun:test";

import {
  approvalCountsToward,
  approvalsHead,
  describeWaiting,
  reasonLine,
  ruleChangeRows,
  rulesWarning,
  sharedApprovalNote,
  startsNextNote,
  type ApprovalRuleRow,
  type SignOffChangeRule,
} from "./signOffChange";

const HAND = "clinical-standards/hand-hygiene.01M7612B99W02WY516SGE92RWR.md";
const SEPSIS =
  "clinical-standards/sepsis-pathway.01M7612QZCW4FFC8VDZBCFZDR2.json";

const addQuality: SignOffChangeRule = {
  scope: "folder",
  target: "clinical-standards",
  status: "changed",
  teams: {
    added: ["quality-committee"],
    removed: [],
    unchanged: ["infection-control"],
  },
  users: { added: [], removed: [], unchanged: [] },
  place: "clinical-standards",
  covers: [
    { path: HAND, uid: "a", name: "hand-hygiene" },
    { path: SEPSIS, uid: "b", name: "sepsis-pathway" },
  ],
};

const user = (login: string, fullName: string) => ({
  login,
  fullName,
  avatarUrl: "",
});
const alice = user("alice", "Alice Nguyen");
const priya = user("priya", "Priya Raman");

function rule(partial: Partial<ApprovalRuleRow>): ApprovalRuleRow {
  return {
    kind: "sign-off",
    scope: "folder",
    target: "",
    groups: [],
    people: [],
    required: 1,
    eligible: [],
    approvedBy: [],
    reason: { kind: "folder", matched: [] },
    ...partial,
  };
}

describe("the Changes tab's rule section", () => {
  test("names where, the owners as chips, and what it does", () => {
    const [row] = ruleChangeRows([addQuality], "Governance");
    expect(row!.where).toBe("Clinical Standards");
    expect(row!.owners.map((o) => `${o.change}:${o.label}`)).toEqual([
      "unchanged:Infection Control",
      "added:Quality Committee",
    ]);
    expect(row!.effect).toBe(
      "After this is published, every document in Clinical Standards needs an approval from the Quality Committee as well — both of the documents in it today.",
    );
  });

  test("a removed owner is said as no longer needed", () => {
    const [row] = ruleChangeRows(
      [
        {
          ...addQuality,
          teams: {
            added: [],
            removed: ["quality-committee"],
            unchanged: ["infection-control"],
          },
        },
      ],
      "Governance",
    );
    expect(row!.effect).toContain(
      "no longer needs an approval from the Quality Committee",
    );
  });

  test("the added owner is not asked on this change", () => {
    expect(startsNextNote([addQuality])).toBe(
      "The Quality Committee is not asked: its rule starts with the next change after this one is published.",
    );
  });

  test("the approve step says what publishing would change", () => {
    expect(rulesWarning([addQuality], "Governance")).toBe(
      "Once it is published, every document in Clinical Standards needs an approval from the Quality Committee as well — both of the documents in it today.",
    );
  });
});

describe("the approvals table", () => {
  const rules: ApprovalRuleRow[] = [
    rule({
      scope: "rules",
      groups: ["policy-office"],
      eligible: [alice, priya],
      reason: { kind: "rules", matched: [] },
    }),
    rule({
      scope: "folder",
      target: "clinical-standards",
      groups: ["infection-control"],
      reason: { kind: "folder", matched: [HAND] },
    }),
    rule({
      scope: "binder",
      groups: ["policy-office"],
      eligible: [alice, priya],
      reason: { kind: "binder", matched: [] },
    }),
    rule({
      kind: "approvers",
      scope: null,
      required: 2,
      eligible: [alice, priya],
      approvedBy: [alice],
      reason: { kind: "approvers", matched: [] },
    }),
  ];

  test("its head counts the rules and how many are met", () => {
    expect(approvalsHead(rules)).toBe(
      "Needs sign-off under 4 rules · none met yet",
    );
  });

  test("each row says why it applies", () => {
    expect(rules.map((row) => reasonLine(row, "Governance"))).toEqual([
      "This change edits a sign-off rule",
      "Hand Hygiene is in this folder",
      "Applies to everything in Governance",
      "Governance needs 2 approvals",
    ]);
  });

  test("one approval that meets two rules is said once", () => {
    expect(sharedApprovalNote(rules)).toBe(
      "One approval from Alice Nguyen or Priya Raman meets both Policy Office rules.",
    );
  });

  test("an approval counts toward every rule its approver is on", () => {
    expect(approvalCountsToward(rules, "priya")).toEqual([
      "Who signs off · Policy Office",
      "The whole binder · Policy Office",
      "Binder approvers · 2 of 2",
    ]);
  });
});

describe("what publishing is still waiting for", () => {
  const person = (login: string) => ({ login, fullName: login });
  const rule = (overrides: Record<string, unknown>) =>
    ({
      required: 1,
      eligible: [person("alice"), person("carol"), person("dan")],
      approvedBy: [],
      ...overrides,
    }) as unknown as Parameters<typeof describeWaiting>[0][number];
  const name = (login: string) => login[0]!.toUpperCase() + login.slice(1);

  test("one approval from several people is any one of them, not all", () => {
    expect(describeWaiting([rule({})], name)).toBe(
      "Needs 1 more approval. Any one of these can give it: Alice, Carol and Dan.",
    );
  });

  test("a long list names three and counts the rest", () => {
    const many = ["a", "b", "c", "d", "e", "f"].map(person);
    expect(describeWaiting([rule({ eligible: many })], name)).toBe(
      "Needs 1 more approval. Any one of these can give it: A, B, C and 3 others.",
    );
  });

  test("when everybody left has to approve, it is waiting on them", () => {
    expect(
      describeWaiting(
        [rule({ required: 2, eligible: [person("alice"), person("carol")] })],
        name,
      ),
    ).toBe("Needs 2 more approvals. Waiting on Alice and Carol.");
  });

  test("somebody who has approved is not asked again", () => {
    expect(
      describeWaiting(
        [rule({ required: 2, approvedBy: [person("alice")] })],
        name,
      ),
    ).toBe(
      "Needs 1 more approval. Any one of these can give it: Carol and Dan.",
    );
  });

  test("a rule nobody can meet says so", () => {
    expect(describeWaiting([rule({ eligible: [] })], name)).toBe(
      "Needs 1 more approval. Nobody who can give it has access yet.",
    );
    expect(
      describeWaiting([rule({ required: 3, eligible: [person("dan")] })], name),
    ).toBe(
      "Needs 3 more approvals. Only Dan can approve, which is not enough.",
    );
  });

  test("several unmet rules point at the list of them", () => {
    expect(describeWaiting([rule({}), rule({})], name)).toBe(
      "2 sign-off rules are not met yet. The list above says who can approve under each.",
    );
  });

  test("nothing is said once every rule is met", () => {
    expect(
      describeWaiting([rule({ approvedBy: [person("alice")] })], name),
    ).toBeNull();
  });
});
