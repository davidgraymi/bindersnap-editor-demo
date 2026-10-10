import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";

import { siteFooter, siteHeader } from "./chrome";
import { publicSiteFiles } from "./publicSite";

const links = (root: ParentNode, selector: string) =>
  [...root.querySelectorAll<HTMLAnchorElement>(`${selector} a`)].map(
    (a) => `${a.getAttribute("href")} ${a.textContent?.trim()}`,
  );

const fragment = (html: string) => JSDOM.fragment(html);

test("the landing page wears the same bar and footer as every other public page", () => {
  const landing = new JSDOM(
    readFileSync(join(import.meta.dir, "../app/index.html"), "utf8"),
  ).window.document;

  expect(links(landing, ".site-header")).toEqual(
    links(fragment(siteHeader("/")), ".site-header"),
  );
  expect(links(landing, ".site-footer")).toEqual(
    links(fragment(siteFooter()), ".site-footer"),
  );
});

test("the site, help and legal pages share the bar and the footer", () => {
  const files = publicSiteFiles();
  for (const path of ["/pricing", "/templates", "/glossary/qapi"]) {
    const html = files.get(path)!;
    expect(html).toContain(siteFooter());
    expect(html).toContain('<header class="site-header">');
  }
});

test("the bar marks the section the page is in", () => {
  const bar = fragment(siteHeader("/templates/hand-hygiene-policy"));
  const current = [...bar.querySelectorAll('[aria-current="page"]')].map((a) =>
    a.getAttribute("href"),
  );
  expect(current).toEqual(["/templates"]);
});

test("every link in the bar and footer goes to a page the site has", () => {
  const files = publicSiteFiles();
  const known = (href: string) =>
    href === "/" ||
    href.startsWith("/-/") ||
    href.startsWith("/help") ||
    href.startsWith("/legal/") ||
    files.has(href);
  const hrefs = [
    ...links(fragment(siteHeader("/")), ".site-header"),
    ...links(fragment(siteFooter()), ".site-footer"),
  ].map((entry) => entry.split(" ")[0]!);
  expect(hrefs.filter((href) => !known(href))).toEqual([]);
});
