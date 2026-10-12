import { afterEach, expect, test } from "bun:test";
import { JSDOM } from "jsdom";

import { appUrl, retargetAppLinks } from "./appLink";

afterEach(() => {
  delete process.env.BUN_PUBLIC_APP_URL;
});

const page = () =>
  new JSDOM(
    `<a id="in" href="https://app.bindersnap.com/-/login">Sign in</a>
     <a id="out" href="/pricing">Pricing</a>`,
  ).window.document;

test("the site's app links name production unless told otherwise", () => {
  expect(appUrl("/-/signup")).toBe("https://app.bindersnap.com/-/signup");
  const doc = page();
  retargetAppLinks(doc);
  expect(doc.getElementById("in")?.getAttribute("href")).toBe(
    "https://app.bindersnap.com/-/login",
  );
});

test("the local stack's site sends its links to the local app", () => {
  process.env.BUN_PUBLIC_APP_URL = "http://localhost:21010/";
  expect(appUrl("/-/signup")).toBe("http://localhost:21010/-/signup");
  const doc = page();
  retargetAppLinks(doc);
  expect(doc.getElementById("in")?.getAttribute("href")).toBe(
    "http://localhost:21010/-/login",
  );
  expect(doc.getElementById("out")?.getAttribute("href")).toBe("/pricing");
});
