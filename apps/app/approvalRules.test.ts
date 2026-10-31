import { describe, expect, test } from "bun:test";

import {
  describeRuleOwners,
  describeRuleTarget,
  summarizeRules,
  type ApprovalRule,
} from "./components/ApprovalRules";

const person = (login: string, fullName = "") => ({
  login,
  fullName,
  avatarUrl: "",
});

function rule(overrides: Partial<ApprovalRule>): ApprovalRule {
  return {
    kind: "approvers",
    scope: null,
    target: "",
    groups: ["board"],
    people: [],
    required: 3,
    eligible: [person("chair"), person("treasurer"), person("secretary")],
    approvedBy: [],
    ...overrides,
  };
}

describe("the summary line", () => {
  test("says what is required, the way GitLab's widget does", () => {
    expect(summarizeRules([rule({})])).toBe("Requires 3 approvals from Board.");
  });

  test("adds a sign-off rule after the approvers", () => {
    expect(
      summarizeRules([
        rule({ required: 1 }),
        rule({
          kind: "sign-off",
          scope: "folder",
          target: "clinical",
          groups: ["medical-staff"],
          required: 1,
        }),
      ]),
    ).toBe("Requires 1 approval from Board and a sign-off from Medical Staff.");
  });

  test("says when everything is met", () => {
    expect(
      summarizeRules([
        rule({
          required: 1,
          approvedBy: [person("chair")],
        }),
      ]),
    ).toBe("Every approval rule is met.");
  });

  test("says when nothing is required", () => {
    expect(summarizeRules([])).toBe("No approvals required.");
  });
});

describe("a rule's row", () => {
  test("names its groups and people", () => {
    expect(
      describeRuleOwners(
        rule({
          people: ["okafor"],
          eligible: [person("okafor", "Dr. Bola Okafor")],
        }),
      ),
    ).toBe("Board and Dr. Bola Okafor");
  });

  test("calls staff Everyone", () => {
    expect(describeRuleOwners(rule({ groups: ["staff"] }))).toBe("Everyone");
  });

  test("names what a sign-off rule covers", () => {
    expect(describeRuleTarget(rule({}))).toBe("Binder approvers");
    expect(
      describeRuleTarget(
        rule({ kind: "sign-off", scope: "folder", target: "clinical/nursing" }),
      ),
    ).toBe("Sign-off for Clinical / Nursing");
  });
});
