import { describe, expect, test } from "bun:test";

import { suggestReviewers } from "./ReviewerChooser";

describe("suggestReviewers", () => {
  test("asks everyone else in a small binder, never the author", () => {
    expect(
      suggestReviewers(
        [{ login: "alice" }, { login: "bob" }, { login: "carol" }],
        "alice",
      ),
    ).toEqual(["bob", "carol"]);
  });

  test("guesses nobody in a binder of more than three others", () => {
    expect(
      suggestReviewers(
        [{ login: "a" }, { login: "b" }, { login: "c" }, { login: "d" }],
        "me",
      ),
    ).toEqual([]);
  });
});
