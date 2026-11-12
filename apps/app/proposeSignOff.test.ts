import { expect, test } from "bun:test";

import {
  approverLogins,
  approversFirst,
  describeApprovalNeed,
} from "./proposeSignOff";

const member = (login: string) => ({ login, fullName: login, hasAccess: true });

test("approvers are the people named and everybody in the groups named", () => {
  const logins = approverLogins({
    requiredApprovals: 1,
    approvers: { groups: ["Quality Committee"], people: ["Bob"] },
    groups: [
      {
        name: "Quality Committee",
        description: "",
        members: [member("dan"), member("hugo")],
        hasAccess: true,
      },
      // A group a sign-off rule names is not an approver for that.
      {
        name: "Infection Control",
        description: "",
        members: [member("grace")],
        hasAccess: true,
      },
    ],
  });
  expect([...logins].sort()).toEqual(["bob", "dan", "hugo"]);
});

test("a binder with no approvers set has none", () => {
  expect(
    approverLogins({ requiredApprovals: 0, approvers: null, groups: [] }).size,
  ).toBe(0);
  expect(approverLogins(null).size).toBe(0);
});

test("no approvals needed says you can publish it yourself", () => {
  expect(describeApprovalNeed(0, 4)).toEqual({
    line: "This binder needs no approvals, so you can publish this yourself. Ask somebody if you want their view first.",
    blocked: false,
  });
});

test("approvals needed says how many and whose count", () => {
  expect(describeApprovalNeed(1, 3)?.line).toBe(
    "This binder needs 1 approval before a change is published. Only the people marked “Can approve” count toward it; anybody can comment.",
  );
  expect(describeApprovalNeed(2, 3)?.line).toContain("needs 2 approvals");
  expect(describeApprovalNeed(2, 3)?.blocked).toBe(false);
});

test("when everybody listed can approve, nobody is marked", () => {
  expect(describeApprovalNeed(1, 5, true)?.line).toBe(
    "This binder needs 1 approval before a change is published. Anybody listed here can give it.",
  );
});

test("too few approvers is said before the change is opened", () => {
  expect(describeApprovalNeed(1, 0)).toEqual({
    line: "This binder needs 1 approval before a change is published, and nobody but you can give one. A binder admin chooses its approvers in Settings.",
    blocked: true,
  });
  expect(describeApprovalNeed(3, 1)?.line).toContain(
    "only 1 other person can approve",
  );
});

test("a rule that could not be read says nothing", () => {
  expect(describeApprovalNeed(null, 2)).toBeNull();
});

test("the people who can approve are listed first", () => {
  const people = [member("alice"), member("bob"), member("carol")];
  expect(
    approversFirst(people, new Set(["carol"])).map((person) => person.login),
  ).toEqual(["carol", "alice", "bob"]);
});
