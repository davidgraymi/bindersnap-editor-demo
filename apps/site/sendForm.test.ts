import { describe, expect, test } from "bun:test";

import { SITE_RESOURCES } from "../../packages/utils/siteResources";
import { readLegalDocuments } from "../legal/legalDocuments";
import { isRequestableResource } from "../../services/api/resource-requests";
import { publicSiteFiles, publicSitePages } from "./publicSite";
import { offersSendForm, PRODUCTION_API_URL, SEND_FORM_PATH } from "./sendForm";

const files = publicSiteFiles();
const pages = publicSitePages();

describe('"Email it to me"', () => {
  const offering = pages.filter(
    (page) =>
      ["templates", "manuals", "tools"].includes(page.collection.key) &&
      files.get(page.path)!.includes('class="site-send"'),
  );

  test("every template, manual index and tool offers it, and no other page does", () => {
    expect(offering.map((page) => page.path).sort()).toEqual(
      pages
        .filter((page) =>
          ["templates", "manuals", "tools"].includes(page.collection.key),
        )
        .map((page) => page.path)
        .sort(),
    );
    for (const page of pages) {
      if (offering.includes(page)) continue;
      expect(files.get(page.path)).not.toContain('class="site-send"');
    }
  });

  test("the list the API sends from is exactly these pages, by their titles", () => {
    expect(SITE_RESOURCES).toEqual(
      Object.fromEntries(offering.map((page) => [page.path, page.title])),
    );
  });

  test("the form asks for a page the API will send, and is tracked", () => {
    expect(offering.length).toBeGreaterThan(10);
    for (const page of offering) {
      const html = files.get(page.path)!;
      expect(offersSendForm(page.path)).toBe(true);
      // The API's own test of what may be asked for.
      expect(isRequestableResource(page.path)).toBe(true);
      expect(html).toContain(
        `<input type="hidden" name="resource" value="${page.path}">`,
      );
      expect(html).toContain(
        `data-track="resource_request" data-track-resource="${page.path}"`,
      );
      expect(html.match(/<form class="site-send"/g)).toHaveLength(1);
    }
  });

  test("posts to the API with no script, and the page can say how it went", () => {
    const html = files.get("/templates/hand-hygiene-policy")!;
    const action = html.match(
      /<form class="site-send" id="send" method="post" action="([^"]+)"/,
    )![1]!;
    expect(action.endsWith(SEND_FORM_PATH)).toBe(true);
    expect(new URL(action).pathname).toBe(SEND_FORM_PATH);
    expect(PRODUCTION_API_URL).toBe("https://api.bindersnap.com");
    expect(html).toContain('type="email" name="email" required');
    expect(html).toContain(
      '<p class="site-send-note" id="sent" role="status">',
    );
    expect(html).toContain(
      '<p class="site-send-note" id="send-again" role="status">',
    );
  });

  test("says what we do with the address, and links the Privacy Policy that says the same", () => {
    const html = files.get("/manuals/hospice-policy-and-procedure-manual")!;
    expect(html).toContain("may write again");
    expect(html).toContain("Unsubscribe any time.");
    expect(html).toContain('<a href="/legal/privacy">Privacy</a>');
    const privacy = readLegalDocuments().find(
      (document) => document.slug === "privacy",
    )!.body;
    expect(privacy).toContain("**Pages you ask us to email.**");
    expect(privacy).toContain("we may write to that address again");
    expect(privacy).toContain("one click stops them all");
  });

  test("the field people never see is out of reach of a keyboard and a screen reader", () => {
    const html = files.get("/tools/required-policies-checklist")!;
    expect(html).toContain('<p class="site-send-trap" aria-hidden="true">');
    expect(html).toContain('name="website" tabindex="-1" autocomplete="off"');
  });
});
