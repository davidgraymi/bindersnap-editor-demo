import { expect, test } from "bun:test";

import { describeBinderAddress } from "./NewBinderPage";

/** The line under the name: the address it will have, or why it cannot. */

const existing = [{ name: "corporate-policies" }];

test("previews the address the server will give", () => {
  expect(
    describeBinderAddress("riverbend", "Clinical Policies", existing),
  ).toEqual({ slug: "clinical-policies", problem: null });
});

test("says nothing is wrong with a name nobody has typed yet", () => {
  expect(describeBinderAddress("riverbend", "  ", existing).problem).toBeNull();
});

test("refuses a name with nothing usable in it", () => {
  expect(describeBinderAddress("riverbend", "!!!", existing).problem).toBe(
    "Use at least one letter or number.",
  );
});

test("refuses a name another binder already has, whatever its case", () => {
  expect(
    describeBinderAddress("riverbend", "Corporate  Policies", existing).problem,
  ).toBe("riverbend already has a binder at /riverbend/corporate-policies.");
});

test("cannot refuse what it has not loaded", () => {
  expect(
    describeBinderAddress("riverbend", "Corporate Policies", null).problem,
  ).toBeNull();
});
