import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { RESERVED_ORGANIZATION_NAMES } from "./organizationName";

test("no organization can take a file the app's host serves at its root", () => {
  // The static host answers these before the app sees the address, so an
  // organization by one of these names could never be reached.
  const publicDir = join(import.meta.dir, "../../apps/app/public");
  const served = readdirSync(publicDir).filter((name) => !name.startsWith("_"));
  expect(
    served.filter((name) => !RESERVED_ORGANIZATION_NAMES.has(name)),
  ).toEqual([]);
});

test("the public site's sections are organizations' to take", () => {
  // bindersnap.com is another origin (issue #718).
  for (const name of ["help", "legal", "pricing", "templates", "blog"]) {
    expect(RESERVED_ORGANIZATION_NAMES.has(name)).toBe(false);
  }
});
