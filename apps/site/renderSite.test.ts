import { describe, expect, test } from "bun:test";

import { RESERVED_ORGANIZATION_NAMES } from "../../packages/utils/organizationName";
import { publicSiteFiles } from "./publicSite";
import {
  extractFaqs,
  pageTitle,
  renderSitePage,
  wordCount,
} from "./renderSite";
import {
  parseSitePage,
  readSitePages,
  SITE_COLLECTIONS,
  type SiteCollection,
} from "./siteContent";

const pages = readSitePages();
const files = publicSiteFiles();
const PAGES_COLLECTION = SITE_COLLECTIONS.find((c) => c.key === "pages")!;

/** Every address a page may link to: the site, help, legal, and the app's doors. */
const known = new Set<string>([
  "/",
  "/-/signup",
  "/-/login",
  ...[...files.keys()],
  ...[
    ...files
      .get("/sitemap.xml")!
      .matchAll(/<loc>https:\/\/bindersnap\.com([^<]*)<\/loc>/g),
  ].map((match) => match[1]!),
]);

/**
 * Claims we cannot make: Bindersnap holds no patient data and certifies
 * nothing, and the Terms keep nothing forever. Free reading is how we operate
 * while an account is open (Terms Section 10), owners can delete a binder, and
 * an ended account's records go after the export window (Section 14).
 */
const FORBIDDEN_CLAIMS = [
  /HIPAA[- ]compliant/i,
  /\bguarantee/i,
  /Bindersnap (is|has been) (certified|endorsed|accredited|approved)/i,
  /(certifies|guarantees|ensures) (your )?compliance/i,
  /free,? always/i,
  /\bforever\b/i,
  /\bpermanent(ly)?\b/i,
];

const TODAY = new Date().toISOString().slice(0, 10);

describe("the public site's front matter", () => {
  const collection: SiteCollection = PAGES_COLLECTION;

  test("reads title, description, updated, related and the rest", () => {
    const page = parseSitePage(
      collection,
      "example",
      `---\ntitle: An example\ndescription: "Quoted, with: a colon"\nupdated: 2026-10-07\nrelated: /pricing, /help\nprice: 100\n---\n\nBody text.\n`,
    );
    expect(page.path).toBe("/example");
    expect(page.description).toBe("Quoted, with: a colon");
    expect(page.related).toEqual(["/pricing", "/help"]);
    expect(page.meta).toEqual({ price: "100" });
    expect(page.body).toBe("Body text.");
  });

  test("refuses a page without its front matter or a required key", () => {
    expect(() => parseSitePage(collection, "x", "# No front matter")).toThrow(
      "front-matter",
    );
    expect(() =>
      parseSitePage(
        collection,
        "x",
        "---\ntitle: T\nupdated: 2026-10-07\n---\n",
      ),
    ).toThrow('"description:"');
  });
});

describe("questions and answers", () => {
  test("come from the FAQ section's third-level headings, as plain text", () => {
    const faqs = extractFaqs(
      "Intro.\n\n## Frequently asked questions\n\n### Is it free?\n\nFor **14 days**, see [pricing](/pricing).\n\n### Second?\n\nYes.\n\n## After\n\n### Not a question\n\nNo.",
    );
    expect(faqs).toEqual([
      { question: "Is it free?", answer: "For 14 days, see pricing." },
      { question: "Second?", answer: "Yes." },
    ]);
  });

  test("a title containing </script> cannot end the JSON-LD block", () => {
    const page = parseSitePage(
      PAGES_COLLECTION,
      "x",
      "---\ntitle: Evil </script><script>alert(1)</script>\ndescription: d\nupdated: 2026-10-07\n---\nBody",
    );
    const html = renderSitePage(page, [page]);
    const ld = html.match(
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/,
    )![1]!;
    expect(ld).not.toContain("</script");
    expect(JSON.parse(ld)["@graph"][1]).toBeDefined();
  });
});

describe("every page on the public site", () => {
  test("there are pages", () => {
    expect(pages.length).toBeGreaterThan(0);
  });

  for (const page of pages) {
    describe(page.path, () => {
      const html = files.get(page.path)!;

      test("has a title and description a search result can show", () => {
        expect(pageTitle(page.title).length).toBeLessThanOrEqual(70);
        expect(page.description.length).toBeGreaterThanOrEqual(50);
        expect(page.description.length).toBeLessThanOrEqual(160);
      });

      test("has a real date and a plain address", () => {
        expect(page.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(Number.isNaN(Date.parse(page.updated))).toBe(false);
        expect(page.updated <= TODAY).toBe(true);
        expect(page.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      });

      test("says enough to be worth finding", () => {
        expect(wordCount(page.body)).toBeGreaterThanOrEqual(
          page.collection.minWords,
        );
      });

      test("links only to pages that exist", () => {
        const links = [
          ...[...page.body.matchAll(/\]\((\/[^)\s#]*)/g)].map((m) => m[1]!),
          ...page.related,
        ];
        for (const link of links) {
          expect({ page: page.path, link, exists: known.has(link) }).toEqual({
            page: page.path,
            link,
            exists: true,
          });
        }
      });

      test("names only providers that have a page", () => {
        for (const facility of page.facilities) {
          expect({ facility, exists: known.has(`/for/${facility}`) }).toEqual({
            facility,
            exists: true,
          });
        }
      });

      test("makes no claim Bindersnap cannot stand behind", () => {
        for (const claim of FORBIDDEN_CLAIMS) {
          expect(page.body).not.toMatch(claim);
          expect(page.description).not.toMatch(claim);
        }
      });

      test("is served as HTML and Markdown, with valid JSON-LD", () => {
        expect(html).toContain(
          `<link rel="canonical" href="https://bindersnap.com${page.path}">`,
        );
        expect(files.get(`${page.path}.md`)).toContain(`# ${page.title}`);
        const ld = html.match(
          /<script type="application\/ld\+json">([\s\S]*?)<\/script>/,
        );
        expect(ld).not.toBeNull();
        const graph = JSON.parse(ld![1]!)["@graph"] as { "@type": string }[];
        expect(graph.map((node) => node["@type"])).toContain("Article");
      });
    });
  }

  test("no two pages share a title or a description", () => {
    const titles = pages.map((page) => page.title);
    const descriptions = pages.map((page) => page.description);
    expect(new Set(titles).size).toBe(titles.length);
    expect(new Set(descriptions).size).toBe(descriptions.length);
  });

  test("no organization can take a page's address", () => {
    for (const collection of SITE_COLLECTIONS) {
      if (collection.prefix) {
        expect(RESERVED_ORGANIZATION_NAMES.has(collection.prefix)).toBe(true);
      }
    }
    for (const page of pages) {
      const first = page.path.split("/")[1]!;
      expect({
        first,
        reserved: RESERVED_ORGANIZATION_NAMES.has(first),
      }).toEqual({
        first,
        reserved: true,
      });
    }
    for (const path of files.keys()) {
      const first = path.split("/")[1]!;
      if (first.startsWith("_")) continue;
      expect({
        path,
        reserved: RESERVED_ORGANIZATION_NAMES.has(first),
      }).toEqual({
        path,
        reserved: true,
      });
    }
  });
});

describe("the files crawlers and agents read", () => {
  test("the sitemap lists the landing page, every page, help and legal", () => {
    const sitemap = files.get("/sitemap.xml")!;
    expect(sitemap).toContain("<loc>https://bindersnap.com/</loc>");
    for (const page of pages) {
      expect(sitemap).toContain(
        `<loc>https://bindersnap.com${page.path}</loc><lastmod>${page.updated}</lastmod>`,
      );
    }
    expect(sitemap).toContain(
      "<loc>https://bindersnap.com/help/approvals</loc>",
    );
    expect(sitemap).toContain(
      "<loc>https://bindersnap.com/legal/privacy</loc>",
    );
  });

  test("robots.txt welcomes crawlers and points at the sitemap", () => {
    const robots = files.get("/robots.txt")!;
    expect(robots).toContain("User-agent: *\nAllow: /");
    expect(robots).toContain("Sitemap: https://bindersnap.com/sitemap.xml");
  });

  test("llms.txt says what Bindersnap is and lists every page's Markdown", () => {
    const llms = files.get("/llms.txt")!;
    expect(llms).toStartWith("# Bindersnap\n\n> ");
    for (const page of pages) {
      expect(llms).toContain(
        `](https://bindersnap.com${page.path}.md): ${page.description}`,
      );
    }
    expect(llms).toContain("](https://bindersnap.com/help/approvals.md)");
    const full = files.get("/llms-full.txt")!;
    for (const page of pages) expect(full).toContain(`# ${page.title}`);
  });

  test("the pricing page says who pays, and claims no price until one is set", () => {
    const pricing = pages.find((page) => page.path === "/pricing")!;
    expect(pricing.body).toContain("Paid seat");
    expect(pricing.body).toMatch(
      /\|\s*\*\*Reviewer\*\*\s*\|[^\n]*\*\*Free\*\*/,
    );
    const html = files.get("/pricing")!;
    const graph = JSON.parse(
      html.match(
        /<script type="application\/ld\+json">([\s\S]*?)<\/script>/,
      )![1]!,
    )["@graph"] as Record<string, unknown>[];
    expect(graph.some((node) => node["@type"] === "FAQPage")).toBe(true);
    const app = graph.find((node) => node["@type"] === "SoftwareApplication");
    if (pricing.meta.price) {
      expect((app!.offers as { price: string }).price).toBe(pricing.meta.price);
    } else {
      expect(app).toBeUndefined();
      expect(pricing.body).not.toMatch(/\$\d/);
    }
    expect(files.get("/llms.txt")).toContain(
      "Reviewers who approve and staff who only read are free",
    );
  });
});

describe("the landing page", () => {
  test("its JSON-LD parses, and offers only the price /pricing states", async () => {
    const html = await Bun.file(
      new URL("../app/index.html", import.meta.url),
    ).text();
    const ld = html.match(
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/,
    );
    expect(ld).not.toBeNull();
    const graph = JSON.parse(ld![1]!)["@graph"] as Record<string, unknown>[];
    const app = graph.find((node) => node["@type"] === "SoftwareApplication")!;
    const pricing = pages.find((page) => page.path === "/pricing")!;
    expect((app.offers as { price?: string } | undefined)?.price).toBe(
      pricing.meta.price,
    );
  });
});
