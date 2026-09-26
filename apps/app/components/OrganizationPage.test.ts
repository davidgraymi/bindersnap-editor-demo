import { expect, test } from "bun:test";

import type { WorkspaceSummary } from "../../../packages/api-schema/schemas/workspaces";
import { filterBinders } from "./OrganizationPage";

function binder(name: string, description = ""): WorkspaceSummary {
  return { id: name.length, name, description } as WorkspaceSummary;
}

const BINDERS = [
  binder("clinical", "Clinical and administrative policies"),
  binder("hr-investigations", "Investigation procedure and case handling"),
  binder("safety", "Patient and staff safety"),
];

test("an empty filter shows every binder, in order", () => {
  expect(filterBinders(BINDERS, "  ")).toEqual(BINDERS);
});

test("the filter matches the name as it is shown, ignoring case", () => {
  expect(filterBinders(BINDERS, "HR Inv").map((row) => row.name)).toEqual([
    "hr-investigations",
  ]);
});

test("the filter matches the description too", () => {
  expect(filterBinders(BINDERS, "patient").map((row) => row.name)).toEqual([
    "safety",
  ]);
});

test("nothing matching is an empty list, not every binder", () => {
  expect(filterBinders(BINDERS, "retired")).toEqual([]);
});
