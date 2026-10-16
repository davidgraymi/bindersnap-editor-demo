import { afterEach, expect, test } from "bun:test";

import { siteUrl } from "./siteLink";

afterEach(() => {
  delete process.env.BUN_PUBLIC_SITE_URL;
});

test("a site address is absolute where the site is another origin", () => {
  process.env.BUN_PUBLIC_SITE_URL = "https://bindersnap.com/";
  expect(siteUrl("/help/approvals")).toBe(
    "https://bindersnap.com/help/approvals",
  );
});

test("a build that names no site keeps the path as it is", () => {
  expect(siteUrl("/legal/terms")).toBe("/legal/terms");
});
