import { expect, test } from "bun:test";

import { publicEnv } from "./publicEnv";

test("a set variable is read, and an unset one is empty, never a throw", () => {
  expect(publicEnv(() => "https://feedback.bindersnap.com/")).toBe(
    "https://feedback.bindersnap.com/",
  );
  expect(publicEnv(() => undefined)).toBe("");
  // What an unset variable does in a browser: `process` is not defined.
  expect(
    publicEnv(() => {
      throw new ReferenceError("process is not defined");
    }),
  ).toBe("");
});
