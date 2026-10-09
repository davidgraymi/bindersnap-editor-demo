import { HELP_GUIDES } from "../app/helpGuides";
import { helpHref, renderGuideMarkdown } from "../help/renderHelp";
import { readLegalDocuments } from "../legal/legalDocuments";
import { legalHref } from "../legal/renderLegal";
import { siteFiles, type ListedPage } from "./renderSite";
import { TOOLS } from "./requiredPolicies";
import { readSitePages, type SitePage } from "./siteContent";

/**
 * The whole public site, read fresh: the pages in `content/`, plus the help
 * guides and legal documents for the sitemap and the llms files. One function
 * for `scripts/build-site.ts` and `server.ts`, so development serves what
 * GitHub Pages will.
 */
export function publicSiteFiles(): Map<string, string> {
  const help: ListedPage[] = [
    {
      path: helpHref(),
      title: "Help and guides",
      description:
        "Short answers to the questions everybody asks in their first week with Bindersnap.",
    },
    ...HELP_GUIDES.map((guide) => ({
      path: helpHref(guide.slug),
      title: guide.title,
      description: guide.summary,
      markdown: `${helpHref(guide.slug)}.md`,
    })),
  ];
  const legal: ListedPage[] = readLegalDocuments().map((document) => ({
    path: legalHref(document.slug),
    title: document.title,
    description: document.summary,
    markdown: `${legalHref(document.slug)}.md`,
    updated: /^\d{4}-\d{2}-\d{2}$/.test(document.version)
      ? document.version
      : undefined,
  }));
  const pages: SitePage[] = readSitePages().map((page) => {
    const tool = page.collection.key === "tools" ? TOOLS[page.slug] : undefined;
    return tool ? { ...page, tool: tool() } : page;
  });
  return siteFiles(pages, {
    help,
    legal,
    helpMarkdown: HELP_GUIDES.map(renderGuideMarkdown),
  });
}
