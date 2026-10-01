import { expect, test } from "bun:test";

import { binderRule, renderCodeowners } from "../../packages/utils/codeowners";

import { renamedDraftBranch, signOffNamesUser } from "./account";

test("a sign-off rule names somebody by @login, whatever the case", () => {
  const content = renderCodeowners("riverside-health", [
    binderRule(["nursing-leads"], ["JKim"]),
  ]);

  expect(signOffNamesUser("riverside-health", content, "jkim")).toBe(true);
  // A team is not a person, and somebody else is not them.
  expect(signOffNamesUser("riverside-health", content, "nursing-leads")).toBe(
    false,
  );
  expect(signOffNamesUser("riverside-health", content, "bob")).toBe(false);
});

test("only this person's drafts move to their new login", () => {
  expect(
    renamedDraftBranch("draft/jkim/20260919145255000", "jkim", "jordan"),
  ).toBe("draft/jordan/20260919145255000");
  expect(
    renamedDraftBranch("draft/bob/20260919145255000", "jkim", "jordan"),
  ).toBeNull();
  expect(renamedDraftBranch("upload/jkim/1", "jkim", "jordan")).toBeNull();
});
