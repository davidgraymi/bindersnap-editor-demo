import { describe, expect, test } from "bun:test";

import {
  EMERGENCY_APPENDIX,
  manualDocx,
  manualDocxHref,
  manualFiles,
  manualRows,
  manualWorksheetMarkdown,
  POLICY_MANUALS,
} from "./policyManuals";
import { publicSiteFiles, publicSitePages } from "./publicSite";

const files = publicSiteFiles();
const pages = publicSitePages();

describe("the policy manual indexes", () => {
  test("each has a page, and each page in /manuals has an index", () => {
    const slugs = POLICY_MANUALS.map((manual) => manual.slug).sort();
    const pageSlugs = pages
      .filter((page) => page.collection.key === "manuals")
      .map((page) => page.slug)
      .sort();
    expect(pageSlugs).toEqual(slugs);
  });

  for (const manual of POLICY_MANUALS) {
    describe(manual.slug, () => {
      const rows = manualRows(manual);
      const html = files.get(`/manuals/${manual.slug}`)!;

      test("every row cites a rule in the provider's own part, or says why not", () => {
        const part = manual.conditions.match(/Part (\d+)/)![1]!;
        for (const row of rows) {
          expect(row.citation).toStartWith("42 CFR ");
          expect(row.citation).toContain(row.section);
          expect(row.section).toStartWith(`${part}.`);
          expect(row.requirement.endsWith(".")).toBe(true);
        }
      });

      test("every tag is one its appendix prints", () => {
        const pattern = new RegExp(
          `^(${manual.appendix.letter}|${EMERGENCY_APPENDIX.letter})-?\\d{3,4}`,
        );
        for (const row of rows) {
          for (const tag of (row.tag ?? "").split(/, | to /).filter(Boolean)) {
            expect({ row: row.name, tag, ok: pattern.test(tag) }).toEqual({
              row: row.name,
              tag,
              ok: true,
            });
          }
        }
        // Emergency preparedness is cited under Appendix Z for everyone.
        const emergency = manual.sections.at(-1)!;
        expect(emergency.title).toBe("Emergency preparedness");
        expect(emergency.rows.map((row) => row.tag)).toEqual([
          "E-0004",
          "E-0013",
          "E-0029",
          "E-0036",
        ]);
      });

      test("links only to pages that exist", () => {
        for (const row of rows) {
          if (row.help) {
            expect({ help: row.help, exists: files.has(row.help) }).toEqual({
              help: row.help,
              exists: true,
            });
          }
        }
      });

      test("its page shows every row without a script, and says which kind each is", () => {
        for (const row of rows) {
          expect(html).toContain(`<strong>${row.name.replace(/'/g, "'")}`);
        }
        expect(html.match(/class="site-manual-kind"/g)?.length).toBe(
          rows.length,
        );
        expect(html).not.toContain("<script>(function(){var form");
        const md = files.get(`/manuals/${manual.slug}.md`)!;
        for (const row of rows) expect(md).toContain(`| ${row.name}`);
      });

      test("its download is tracked, and is a Word file with every row to fill in", async () => {
        expect(html).toContain(
          `href="${manualDocxHref(manual)}" download="${manual.slug}.docx" data-track="manual_download" data-track-manual="${manual.slug}"`,
        );
        const worksheet = manualWorksheetMarkdown(manual);
        for (const row of rows) expect(worksheet).toContain(`| ${row.name}`);
        expect(worksheet).toContain("not legal advice");
        const bytes = await manualDocx(manual);
        // A .docx is a zip: "PK".
        expect([bytes[0], bytes[1]]).toEqual([0x50, 0x4b]);
        expect(bytes.length).toBeGreaterThan(2000);
      });
    });
  }

  test("every index's Word file is served beside its page", async () => {
    const downloads = await manualFiles();
    expect([...downloads.keys()].sort()).toEqual(
      POLICY_MANUALS.map((manual) => `/manuals/${manual.slug}.docx`).sort(),
    );
  });

  test("a provider's page lists its manual index", () => {
    expect(files.get("/for/hospices")).toContain(
      'href="/manuals/hospice-policy-and-procedure-manual"',
    );
  });
});
