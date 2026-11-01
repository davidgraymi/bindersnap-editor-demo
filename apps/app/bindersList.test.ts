import { expect, test } from "bun:test";

import type { WorkspaceSummary } from "../../packages/api-schema/schemas/workspaces";
import {
  describeBinderAccess,
  filterBindersByText,
  groupBindersByOrganization,
  sortBinders,
} from "./bindersList";

let nextId = 1;
function binder(
  name: string,
  overrides: Partial<WorkspaceSummary> = {},
): WorkspaceSummary {
  return {
    id: nextId++,
    name,
    owner: "riverside-health",
    fullName: `riverside-health/${name}`,
    description: "",
    openChangeCount: 0,
    updatedAt: "2026-10-30T10:00:00Z",
    access: { push: false, admin: false },
    ...overrides,
  };
}

const names = (list: WorkspaceSummary[]) => list.map((entry) => entry.name);

test("relevant puts the binders you write in first, then the newest", () => {
  const sorted = sortBinders(
    [
      binder("safety", { updatedAt: "2026-10-31T10:00:00Z" }),
      binder("clinical", { access: { push: true, admin: false } }),
      binder("corporate", { access: { push: true, admin: true } }),
      binder("facilities", { updatedAt: "2026-10-29T10:00:00Z" }),
    ],
    "relevant",
  );
  expect(names(sorted)).toEqual([
    "corporate",
    "clinical",
    "safety",
    "facilities",
  ]);
});

test("most active is the most open change requests, then the newest", () => {
  const sorted = sortBinders(
    [
      binder("safety", { openChangeCount: 1 }),
      binder("corporate", { openChangeCount: 9 }),
      binder("clinical", {
        openChangeCount: 1,
        updatedAt: "2026-10-31T10:00:00Z",
      }),
    ],
    "active",
  );
  expect(names(sorted)).toEqual(["corporate", "clinical", "safety"]);
});

test("A–Z is by the name a person reads, not the address", () => {
  expect(
    names(
      sortBinders(
        [binder("safety"), binder("hr-investigations"), binder("clinical")],
        "name",
      ),
    ),
  ).toEqual(["clinical", "hr-investigations", "safety"]);
});

test("what you may do is said in a word or two", () => {
  expect(
    describeBinderAccess(binder("a", { access: { push: true, admin: true } })),
  ).toBe("Admin");
  expect(
    describeBinderAccess(binder("a", { access: { push: true, admin: false } })),
  ).toBe("Can edit");
  expect(describeBinderAccess(binder("a"))).toBe("Can read");
  expect(describeBinderAccess(binder("a", { access: undefined }))).toBe(
    "Can read",
  );
});

test("filtering reads the name and the description", () => {
  const list = [
    binder("clinical", { description: "Nursing and pharmacy" }),
    binder("corporate"),
  ];
  expect(names(filterBindersByText(list, "pharm"))).toEqual(["clinical"]);
  expect(names(filterBindersByText(list, "CORP"))).toEqual(["corporate"]);
  expect(names(filterBindersByText(list, "  "))).toEqual([
    "clinical",
    "corporate",
  ]);
});

test("one organization is one group with no heading", () => {
  const groups = groupBindersByOrganization([binder("a"), binder("b")]);
  expect(groups).toHaveLength(1);
  expect(groups[0]?.org).toBeNull();
});

test("two organizations are a group each, in the order they came", () => {
  const groups = groupBindersByOrganization([
    binder("a", { owner: "lakeside" }),
    binder("b"),
    binder("c", { owner: "lakeside" }),
  ]);
  expect(groups.map((group) => [group.org, names(group.binders)])).toEqual([
    ["lakeside", ["a", "c"]],
    ["riverside-health", ["b"]],
  ]);
});
