import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";

import { signupSourceFromQuery } from "../../packages/utils/signupSource";
import { publicSiteFiles } from "./publicSite";
import {
  SIGNUP_SOURCE_SCRIPT,
  signupSourceParams,
  tagSignupLinks,
} from "./signupSource";

const LINKS = `<a id="nav" href="https://app.bindersnap.com/-/signup">Start</a><a id="in" href="https://app.bindersnap.com/-/login">Sign in</a>`;

function page(path: string, referrer?: string, script = true) {
  return new JSDOM(
    `<html><head>${script ? `<script>${SIGNUP_SOURCE_SCRIPT}</script>` : ""}</head><body>${LINKS}</body></html>`,
    {
      url: `https://bindersnap.com${path}`,
      ...(referrer ? { referrer } : {}),
      runScripts: "dangerously",
    },
  );
}

type Page = ReturnType<typeof page>;

/** Once the page has loaded, which is when the links are tagged. */
const loaded = (dom: Page) =>
  dom.window.document.readyState === "loading"
    ? new Promise((resolve) =>
        dom.window.document.addEventListener("DOMContentLoaded", resolve),
      )
    : Promise.resolve();

const href = (dom: Page, id: string) =>
  dom.window.document.getElementById(id)!.getAttribute("href")!;

test("the first page of a visit tags its signup links with where it began", async () => {
  const dom = page(
    "/glossary/qapi?utm_source=newsletter&utm_campaign=oct",
    "https://www.google.com/search?q=qapi",
  );
  await loaded(dom);
  const url = new URL(href(dom, "nav"));
  expect(url.pathname).toBe("/-/signup");
  expect(signupSourceFromQuery(url.search)).toEqual({
    entryPath: "/glossary/qapi",
    fromPath: "/glossary/qapi",
    referrerHost: "www.google.com",
    utmSource: "newsletter",
    utmCampaign: "oct",
  });
  // Only links to signup.
  expect(href(dom, "in")).toBe("https://app.bindersnap.com/-/login");
});

test("a later page keeps where the visit began, and says where it is", async () => {
  const dom = page("/pricing", "https://bindersnap.com/glossary/qapi", false);
  dom.window.sessionStorage.setItem(
    "bs-entry",
    JSON.stringify({ entry: "/glossary/qapi", ref: "www.google.com" }),
  );
  tagSignupLinks(dom.window as unknown as Window);
  await loaded(dom);
  expect(signupSourceFromQuery(new URL(href(dom, "nav")).search)).toEqual({
    entryPath: "/glossary/qapi",
    fromPath: "/pricing",
    referrerHost: "www.google.com",
  });
  expect(signupSourceParams(dom.window as unknown as Window).toString()).toBe(
    "entry=%2Fglossary%2Fqapi&ref=www.google.com&from=%2Fpricing",
  );
});

test("our own sites are not a referrer", async () => {
  for (const referrer of [
    "https://bindersnap.com/",
    "https://app.bindersnap.com/-/documents",
  ]) {
    const dom = page("/templates", referrer);
    await loaded(dom);
    expect(new URL(href(dom, "nav")).searchParams.get("ref")).toBeNull();
  }
});

test("every public page carries the script", () => {
  for (const [path, html] of publicSiteFiles()) {
    if (!html.startsWith("<!doctype html>")) continue;
    expect(html, path).toContain(SIGNUP_SOURCE_SCRIPT);
  }
});
