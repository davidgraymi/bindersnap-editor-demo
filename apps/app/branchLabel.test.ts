import { expect, test } from "bun:test";

import { describeBranch } from "./branchLabel";

const names = (login: string) =>
  ({ carol: "Carol Mendes", james: "James Okafor" })[login] ?? login;

test("an upload is named after the document it carries", () => {
  expect(
    describeBranch(
      "upload/finance/expenses-policy/20260505/140000Z-carol-b39f0c17",
      names,
    ),
  ).toBe("Expenses Policy upload");
});

test("a draft is somebody's, by first name", () => {
  expect(describeBranch("draft/carol/20260923T101500", names)).toBe(
    "Carol’s draft",
  );
  expect(describeBranch("draft/james/20260923T101500", names)).toBe(
    "James’ draft",
  );
  expect(describeBranch("shape/carol/20260923101500", names)).toBe(
    "Carol’s folder changes",
  );
});

test("sign-off rules say so", () => {
  expect(describeBranch("sign-off/20260923101500")).toBe("Sign-off rules");
});

test("a branch somebody named by hand keeps its name", () => {
  expect(describeBranch("change-4")).toBe("change-4");
  expect(describeBranch("draft/carol")).toBe("draft/carol");
});
