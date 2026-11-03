import { describe, expect, test } from "bun:test";

import { FOOTER_COLUMNS } from "./chrome";
import { publicSiteBinaryFiles, publicSiteFiles } from "./publicSite";
import {
  FLYER_PATH,
  ONE_PAGER_PDF,
  ONE_PAGER_PREVIEW,
  SHARE_EMAIL,
  flyerHtml,
  shareEmailHtml,
  shareMailto,
} from "./sharePage";
import { readSitePages } from "./siteContent";

const page = readSitePages().find((p) => p.path === "/share")!;

describe("the share page", () => {
  test("is linked from the footer", () => {
    const links = FOOTER_COLUMNS.flatMap((column) => column.links);
    expect(links.map((link) => link.href)).toContain("/share");
  });

  test("prints the same email the button writes", () => {
    const quoted = page.body
      .split("\n")
      .filter((line) => line.startsWith(">"))
      .map((line) => line.replace(/^>\s?/, ""))
      .join("\n");
    expect(quoted).toContain(`**Subject:** ${SHARE_EMAIL.subject}`);
    for (const paragraph of SHARE_EMAIL.body) {
      expect(quoted).toContain(paragraph);
    }
  });

  test("the email links to the flyer the site serves", () => {
    expect(SHARE_EMAIL.body.at(-1)).toContain(
      `https://bindersnap.com${FLYER_PATH}`,
    );
    expect(publicSiteFiles().has(FLYER_PATH)).toBe(true);
  });

  test("offers the copied email, the mailto and the PDF", () => {
    const html = publicSiteFiles().get("/share")!;
    expect(html).toMatch(/<button[^>]*id="share-copy"[^>]*hidden/);
    expect(html).toContain(`href="${ONE_PAGER_PDF}" download`);
    expect(html).toContain(`src="${ONE_PAGER_PREVIEW}"`);
    expect(html).toContain(`href="${shareMailto()}"`);
  });

  test("the copied email carries the words and the one-pager as a picture", () => {
    const html = shareEmailHtml();
    for (const paragraph of SHARE_EMAIL.body.slice(0, -1)) {
      expect(html).toContain(paragraph.replace(/&/g, "&amp;"));
    }
    // Absolute addresses: the email is read far from bindersnap.com.
    expect(html).toContain(
      `<a href="https://bindersnap.com${FLYER_PATH}"><img src="https://bindersnap.com${ONE_PAGER_PREVIEW}"`,
    );
    expect(html).not.toMatch(/(?:src|href)="\//);
  });

  test("the copy script cannot be ended early by the email inside it", () => {
    const html = publicSiteFiles().get("/share")!;
    const script = html.match(
      /<script>(\(function\(\)\{\s*var button=[\s\S]*?)<\/script>/,
    );
    expect(script).not.toBeNull();
    expect(script![1]).not.toContain("</");
  });

  test("the mailto carries the subject and body intact", () => {
    const url = new URL(shareMailto());
    expect(url.searchParams.get("subject")).toBe(SHARE_EMAIL.subject);
    expect(url.searchParams.get("body")).toBe(SHARE_EMAIL.body.join("\n\n"));
  });

  test("the one-pager is published as a small PDF and preview", async () => {
    const files = await publicSiteBinaryFiles();
    const pdf = files.get(ONE_PAGER_PDF)!;
    const png = files.get(ONE_PAGER_PREVIEW)!;
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe("%PDF-");
    expect([...png.slice(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
    // The token file's paper grain once made it 3 MB; keep it light to send.
    expect(pdf.length).toBeLessThan(1024 * 1024);
  });
});

describe("the flyer", () => {
  const html = flyerHtml("G-ABC123XYZ");

  test("loads nothing from outside the site", () => {
    expect(html).not.toContain("../");
    expect(html).toContain("url(/fonts/lora-latin-wght-normal.woff2)");
    // The token stylesheet is inlined, not linked.
    expect(html).toContain("--brand-coral:");
    expect(html).not.toMatch(/<link[^>]+bindersnap-tokens\.css/);
  });

  test("names itself for search and link previews", () => {
    expect(html).toContain(
      `<link rel="canonical" href="https://bindersnap.com${FLYER_PATH}">`,
    );
    expect(html).toContain(
      `<meta property="og:image" content="https://bindersnap.com${ONE_PAGER_PREVIEW}">`,
    );
    expect(html).toMatch(/<meta name="description" content="[^"]{50,160}">/);
  });

  test("offers the PDF and the trial on screen, and prints the sheet alone", () => {
    expect(html).toContain('<nav class="flyer-bar"');
    expect(html).toContain(`href="${ONE_PAGER_PDF}" download`);
    expect(html).toMatch(/@media print \{\s*\.flyer-bar \{\s*display: none;/);
  });

  test("carries the Google tag like every other public page", () => {
    expect(html).toContain("G-ABC123XYZ");
    expect(flyerHtml("")).not.toContain("googletagmanager");
  });
});
