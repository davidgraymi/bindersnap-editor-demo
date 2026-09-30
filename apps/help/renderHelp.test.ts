import { describe, expect, test } from "bun:test";

import { HELP_GUIDES, type HelpGuide } from "../app/helpGuides";
import {
  helpContentType,
  helpFiles,
  renderGuideMarkdown,
  renderHelpGuide,
  renderLlmsTxt,
} from "./renderHelp";

const files = helpFiles(HELP_GUIDES);

/** Every `href` on a page that stays on this site. */
function localLinks(html: string): string[] {
  return [...html.matchAll(/href="(\/[^"#]*)"/g)].map((match) => match[1]!);
}

describe("the help pages", () => {
  test("there is a page and a Markdown copy for every guide", () => {
    expect(files.has("/help")).toBe(true);
    for (const guide of HELP_GUIDES) {
      expect(files.get(`/help/${guide.slug}`)).toContain(guide.title);
      expect(files.get(`/help/${guide.slug}.md`)).toStartWith(
        `# ${guide.title}`,
      );
    }
  });

  test("every page links only to pages that exist, or to the app", () => {
    // Navigable on its own: a person or an agent that lands anywhere can
    // reach every guide, and nothing points at a page that is not there.
    for (const [path, body] of files) {
      if (!path.endsWith("/help") && path.includes(".")) continue;
      for (const href of localLinks(body)) {
        if (href === "/") continue;
        expect(files.has(href), `${path} links to ${href}`).toBe(true);
      }
      for (const guide of HELP_GUIDES) {
        expect(body).toContain(`href="/help/${guide.slug}"`);
      }
    }
  });

  test("a page says which guide it is, and leads to the next", () => {
    const [first, second] = HELP_GUIDES;
    const html = files.get(`/help/${first!.slug}`)!;
    expect(html).toContain(
      `<a href="/help/${first!.slug}" aria-current="page">`,
    );
    expect(html).toContain(`href="/help/${second!.slug}" rel="next"`);
    expect(html).toContain(`<link rel="alternate" type="text/markdown"`);
  });

  test("a page is whole without running anything", () => {
    // The only script sets the theme; the words are in the HTML as served.
    const html = files.get("/help/approvals")!;
    expect(html.match(/<script/g)).toHaveLength(1);
    expect(html).toContain("<h2>How many approvals</h2>");
  });

  test("words are escaped, not trusted as markup", () => {
    const guide: HelpGuide = {
      slug: "odd",
      title: "Fish & <chips>",
      summary: 'A "quoted" summary',
      sections: [{ heading: "<b>", paragraphs: ["1 < 2"] }],
    };
    const html = renderHelpGuide(guide, [guide]);
    expect(html).toContain("Fish &amp; &lt;chips&gt;");
    expect(html).toContain("&quot;quoted&quot;");
    expect(html).toContain("<p>1 &lt; 2</p>");
    expect(html).not.toContain("<chips>");
  });

  test("the Markdown numbers steps and keeps every paragraph", () => {
    const md = renderGuideMarkdown(
      HELP_GUIDES.find((guide) => guide.slug === "approvals")!,
    );
    expect(md).toContain("## The path every change takes\n\n1. ");
    expect(md).toContain("## How many approvals\n\nA new binder needs no");
  });

  test("llms.txt lists every guide, at the site root too", () => {
    const text = renderLlmsTxt(HELP_GUIDES);
    for (const guide of HELP_GUIDES) {
      expect(text).toContain(`](/help/${guide.slug}.md): ${guide.summary}`);
    }
    expect(files.get("/llms.txt")).toBe(text);
    expect(files.get("/help/llms.txt")).toBe(text);
  });

  test("each file says what it is", () => {
    expect(helpContentType("/help")).toStartWith("text/html");
    expect(helpContentType("/help/approvals.md")).toStartWith("text/markdown");
    expect(helpContentType("/llms.txt")).toStartWith("text/plain");
    expect(helpContentType("/help/help.css")).toStartWith("text/css");
    expect(files.get("/help/help.css")).toContain("--bs-page-bg");
  });
});
