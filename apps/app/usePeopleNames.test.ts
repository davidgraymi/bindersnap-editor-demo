import { expect, test } from "bun:test";

import { nameFor } from "./usePeopleNames";

test("a login is called by the name its person has", () => {
  const names = new Map([["carol", "Carol Mendes"]]);
  expect(nameFor(names, "carol")).toBe("Carol Mendes");
  expect(nameFor(names, "Carol")).toBe("Carol Mendes");
});

test("without a name, the login stands in, capitalized", () => {
  expect(nameFor(null, "carol")).toBe("Carol");
  expect(nameFor(new Map(), "jsmith")).toBe("Jsmith");
});
