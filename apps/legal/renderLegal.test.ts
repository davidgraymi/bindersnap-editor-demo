import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { LEGAL_VERSION } from "../../packages/utils/legal";
import {
  LEGAL_DOCUMENTS,
  parseLegalDocument,
  readLegalDocuments,
} from "./legalDocuments";
import { legalFiles, renderLegalBody } from "./renderLegal";

const documents = readLegalDocuments();
const files = legalFiles(documents);

const atSiteRoot = (href: string) =>
  existsSync(join(import.meta.dir, "../app/public", href.slice(1)));

function localLinks(html: string): string[] {
  return [...html.matchAll(/href="(\/[^"#]*)"/g)].map((match) => match[1]!);
}

describe("the legal pages", () => {
  test("there is a page and a Markdown copy of every document", () => {
    expect(files.has("/legal")).toBe(true);
    for (const document of documents) {
      expect(files.get(`/legal/${document.slug}`)).toContain(
        `<h1>${document.title}</h1>`,
      );
      expect(files.get(`/legal/${document.slug}.md`)).toStartWith(
        `# ${document.title}\n\nLast updated: `,
      );
    }
  });

  test("every link stays on pages that exist, the app, or help", () => {
    for (const [path, body] of files) {
      if (path.includes(".")) continue;
      for (const href of localLinks(body)) {
        if (href === "/" || href === "/help" || href.startsWith("/help/"))
          continue;
        const bare = href.replace(/\/+$/, "");
        expect(
          files.has(bare) || atSiteRoot(href),
          `${path} links to ${href}`,
        ).toBe(true);
      }
    }
  });

  test("signup records agreement to the Terms and Privacy Policy as published", () => {
    // `LEGAL_VERSION` is what a signup stores. If the words move on, so must it.
    for (const slug of ["terms", "privacy"]) {
      const document = documents.find((entry) => entry.slug === slug);
      expect(document?.version, `${slug}.md's Version line`).toBe(
        LEGAL_VERSION,
      );
    }
  });

  test("the documents keep to what the renderer draws", () => {
    // The renderer draws one level of list. A nested item would come out as a
    // paragraph with a stray dash, so the words would read wrong.
    for (const entry of LEGAL_DOCUMENTS) {
      const document = documents.find((each) => each.slug === entry.slug)!;
      expect(document.body, entry.slug).not.toMatch(/^ {2,}[-*+] /m);
      expect(document.body, entry.slug).not.toMatch(/<[a-z]/i);
    }
  });

  test("headings carry anchors, unique within a page", () => {
    const html = renderLegalBody(
      "## 1. Scope\n\nText.\n\n## 1. Scope\n\n### Notes",
    );
    expect(html).toContain('<h2 id="1-scope">1. Scope</h2>');
    expect(html).toContain('<h2 id="1-scope-2">1. Scope</h2>');
    expect(html).toContain('<h3 id="notes">Notes</h3>');
  });

  test("a document without its date lines is refused at build", () => {
    expect(() =>
      parseLegalDocument({ slug: "terms", summary: "" }, "# Terms\n\nHello."),
    ).toThrow("Last updated:");
  });

  test("the index says up front that patient data does not belong here", () => {
    expect(files.get("/legal")).toContain("not for patient health information");
  });
});
