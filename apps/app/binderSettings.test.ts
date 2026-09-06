import { expect, test } from "bun:test";

import { describeBinderRules, describeTeamAccess } from "./binderSettings";

const PROTECTED = {
  requiredApprovals: 2,
  dismissStaleApprovals: true,
  pushBlocked: true,
  blockOnUnresolvedThreads: false,
};

test("the promise the customer is buying leads", () => {
  expect(describeBinderRules(PROTECTED)[0]).toBe(
    "Nothing reaches the record except a change that has been approved and published.",
  );
});

test("an unprotected binder says so rather than staying quiet", () => {
  // A binder without this is not making the product's promise, and the person
  // reading the page is the one who would want to know.
  expect(describeBinderRules({ ...PROTECTED, pushBlocked: false })[0]).toMatch(
    /not protected/,
  );
});

test("the approval count is a sentence, and one is not 1", () => {
  expect(describeBinderRules(PROTECTED)[1]).toBe(
    "A change needs 2 approvals before it can be published.",
  );
  expect(describeBinderRules({ ...PROTECTED, requiredApprovals: 1 })[1]).toBe(
    "A change needs one approval before it can be published.",
  );
});

test("no approvals required and unknown are different answers", () => {
  // "0" and "we could not read the rule" look the same if this says nothing.
  expect(describeBinderRules({ ...PROTECTED, requiredApprovals: 0 })[1]).toBe(
    "A change needs no approvals before it can be published.",
  );
  expect(
    describeBinderRules({ ...PROTECTED, requiredApprovals: null })[1],
  ).toBe("How many approvals a change needs could not be read.");
});

test("both sides of a rule are stated, never only the on side", () => {
  // A rule that is off is still a rule the customer chose, and a page that
  // only lists what is enabled cannot be checked against what they asked for.
  expect(describeBinderRules(PROTECTED)[2]).toMatch(/clears the approvals/);
  expect(
    describeBinderRules({ ...PROTECTED, dismissStaleApprovals: false })[2],
  ).toMatch(/carry over/);

  expect(describeBinderRules(PROTECTED)[3]).toMatch(/can be published with/);
  expect(
    describeBinderRules({ ...PROTECTED, blockOnUnresolvedThreads: true })[3],
  ).toMatch(/cannot be published while/);
});

test("access says what it costs, because the ADR promises reviewers are free", () => {
  // Worded without naming where it is shown: the same sentence appears on a
  // binder, beside a team granted onto it, and on the organization, beside a
  // group that may be granted onto any binder.
  expect(describeTeamAccess("admin")).toBe("Can administer · paid seat");
  expect(describeTeamAccess("write")).toBe("Can publish · paid seat");
  expect(describeTeamAccess("read")).toBe("Can review · free");
  expect(describeTeamAccess("none")).toBe("No access");
});

test("owner is a level, and the highest one", () => {
  // Gitea reports the organization's built-in Owners team as
  // `repo.code: "owner"` on every repository the org holds. A switch that only
  // knew admin/write/read called that "No access" — beside the person who owns
  // the organization — which is the very trap ADR 0004 warns about when it
  // says counting by name suffix would miss the Owners team.
  expect(describeTeamAccess("owner")).toBe("Owns the organization · paid seat");
});
