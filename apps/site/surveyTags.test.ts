import { describe, expect, test } from "bun:test";

import { manualRows } from "./policyManuals";
import { publicSiteFiles, publicSitePages } from "./publicSite";
import {
  EMERGENCY_SECTIONS,
  EMERGENCY_TAGS,
  EMERGENCY_TAGS_PATH,
  policyTagRows,
  TAG_PAGES,
} from "./surveyTags";

const files = publicSiteFiles();
const pages = publicSitePages();

describe("the survey tag pages", () => {
  test("each has a page, and each page in /survey-tags is built from data", () => {
    const expected = [
      ...TAG_PAGES.map((page) => `/survey-tags/${page.slug}`),
      EMERGENCY_TAGS_PATH,
    ].sort();
    const found = pages
      .filter((page) => page.collection.key === "survey-tags")
      .map((page) => page.path)
      .sort();
    expect(found).toEqual(expected);
    for (const page of pages) {
      if (page.collection.key === "survey-tags") {
        expect(page.tool).toBeDefined();
      }
    }
  });

  for (const page of TAG_PAGES) {
    describe(page.slug, () => {
      const html = files.get(`/survey-tags/${page.slug}`)!;
      const letter = page.manual.appendix.letter;

      test("lists every tag its manual index cites, and no emergency tag", () => {
        const rows = policyTagRows(page);
        const cited = manualRows(page.manual).filter((row) =>
          row.tag?.startsWith(letter),
        );
        expect(rows.length).toBe(cited.length);
        expect(rows.length).toBeGreaterThan(5);
        for (const row of rows) {
          expect(html).toContain(`<span class="site-manual-tag">${row.tag}`);
          expect(row.tag).not.toStartWith("E-");
        }
      });

      test("its condition tags are in the provider's part, in the appendix's letter", () => {
        const part = page.manual.conditions.match(/Part (\d+)/)![1]!;
        const tags = page.conditions.map((entry) => entry.tag);
        expect(new Set(tags).size).toBe(tags.length);
        for (const entry of page.conditions) {
          expect(entry.tag).toMatch(new RegExp(`^${letter}-?\\d{3,4}$`));
          expect(entry.section).toStartWith(`${part}.`);
        }
      });

      test("sends emergency preparedness to the E-tag page, and policies to the manual", () => {
        expect(html).toContain(`href="${EMERGENCY_TAGS_PATH}"`);
        expect(html).toContain(`href="/manuals/${page.manual.slug}"`);
        expect(files.get(`/manuals/${page.manual.slug}`)).toContain(
          `href="/survey-tags/${page.slug}"`,
        );
      });
    });
  }

  test("the E-tag page names each provider's section and every shared tag", () => {
    const html = files.get(EMERGENCY_TAGS_PATH)!;
    for (const entry of EMERGENCY_SECTIONS) {
      expect(html).toContain(`section-${entry.section}"`);
    }
    for (const entry of EMERGENCY_TAGS) {
      expect(entry.tag).toMatch(/^E-00\d\d$/);
      expect(html).toContain(`<span class="site-manual-tag">${entry.tag}`);
    }
    // The four a manual index cites are all on it.
    const cited = new Set(
      TAG_PAGES.flatMap((page) => manualRows(page.manual))
        .map((row) => row.tag)
        .filter((tag) => tag?.startsWith("E-")),
    );
    const listed = new Set(EMERGENCY_TAGS.map((entry) => entry.tag));
    for (const tag of cited) expect(listed.has(tag!)).toBe(true);
  });
});
