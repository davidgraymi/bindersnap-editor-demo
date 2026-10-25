import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { HELP_GUIDES } from "../app/helpGuides";
import { helpFiles } from "../help/renderHelp";
import { readLegalDocuments } from "../legal/legalDocuments";
import { legalFiles } from "../legal/renderLegal";
import { publicSiteFiles } from "./publicSite";

/**
 * Search engines cut a `<title>` past about 70 characters, and Bing Webmaster
 * Tools flags every page that goes over. This reads the title of every HTML
 * page bindersnap.com serves — the landing page, the marketing pages, help and
 * legal — so a new or reworded page cannot ship one that is too long.
 */

const MAX_TITLE_LENGTH = 70;

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
};

/** The title as a search result shows it: entities decoded, spaces collapsed. */
function titleOf(html: string): string | undefined {
  const raw = /<title>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  if (raw === undefined) return undefined;
  return raw
    .replace(/&(?:amp|lt|gt|quot|#39);/g, (entity) => ENTITIES[entity]!)
    .replace(/\s+/g, " ")
    .trim();
}

function htmlPages(): [string, string][] {
  const pages: [string, string][] = [
    ["/", readFileSync(join(import.meta.dir, "index.html"), "utf8")],
  ];
  const sources = [
    publicSiteFiles(),
    helpFiles(HELP_GUIDES),
    legalFiles(readLegalDocuments()),
  ];
  for (const files of sources) {
    for (const [path, body] of files) {
      // A page is served at its address without an extension.
      if (!/\.[a-z]+$/.test(path)) pages.push([path, body]);
    }
  }
  return pages;
}

describe("every public page's title", () => {
  const pages = htmlPages();

  test("covers the landing, marketing, help and legal pages", () => {
    const paths = pages.map(([path]) => path);
    expect(paths).toContain("/");
    expect(paths).toContain("/pricing");
    expect(paths).toContain("/help");
    expect(paths).toContain("/legal");
  });

  for (const [path, html] of pages) {
    test(`${path} has a title of at most ${MAX_TITLE_LENGTH} characters`, () => {
      const title = titleOf(html);
      expect(title, path).toBeTruthy();
      expect(title!.length, `${path}: "${title}"`).toBeLessThanOrEqual(
        MAX_TITLE_LENGTH,
      );
    });
  }
});
