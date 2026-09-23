import { expect, test } from "bun:test";

import { describeTeamAccess } from "./binderSettings";

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
