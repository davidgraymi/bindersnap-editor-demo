import { describe, expect, test } from "bun:test";

import { FOOTER_COLUMNS } from "./chrome";
import { publicSiteBinaryFiles, publicSiteFiles } from "./publicSite";
import {
  ONE_PAGER_PDF,
  ONE_PAGER_PREVIEW,
  SHARE_EMAIL,
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

  test("the email links to the PDF the site serves", () => {
    expect(SHARE_EMAIL.body.join(" ")).toContain(
      `https://bindersnap.com${ONE_PAGER_PDF}`,
    );
  });

  test("offers the PDF and the email", () => {
    const html = publicSiteFiles().get("/share")!;
    expect(html).toContain(`href="${ONE_PAGER_PDF}" download`);
    expect(html).toContain(`src="${ONE_PAGER_PREVIEW}"`);
    expect(html).toContain(`href="${shareMailto()}"`);
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
