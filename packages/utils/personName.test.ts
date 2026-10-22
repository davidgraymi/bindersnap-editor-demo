import { expect, test } from "bun:test";

import { joinFullName, splitFullName, validateFullName } from "./personName";

test("a first and last name join into one, tidied", () => {
  expect(joinFullName("  Maria ", " Reyes")).toBe("Maria Reyes");
  expect(joinFullName("Mary  Ann", "Smith")).toBe("Mary Ann Smith");
});

test("splitting and joining again gives back what was stored", () => {
  for (const name of ["Maria Reyes", "Mary Ann Smith", "Cher"]) {
    const { first, last } = splitFullName(name);
    expect(joinFullName(first, last)).toBe(name);
  }
  expect(splitFullName("")).toEqual({ first: "", last: "" });
});

test("both halves are required, and the whole has Gitea's limit", () => {
  expect(validateFullName("Maria", "")).toBe("Enter your first and last name.");
  expect(validateFullName(" ", "Reyes")).toBe(
    "Enter your first and last name.",
  );
  expect(validateFullName("Maria", "Reyes")).toBeNull();
  expect(validateFullName("M".repeat(60), "R".repeat(60))).toContain("100");
});
