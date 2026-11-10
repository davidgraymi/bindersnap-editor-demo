import { HELP_GUIDES } from "../app/helpGuides";
import { helpHref, renderGuideMarkdown } from "../help/renderHelp";
import { readLegalDocuments } from "../legal/legalDocuments";
import { legalHref } from "../legal/renderLegal";
import { siteFiles, type ListedPage } from "./renderSite";
import { FLYER_PATH, flyerHtml, onePagerFiles } from "./sharePage";
import { manualFiles, MANUAL_PARTS } from "./policyManuals";
import { TOOLS } from "./requiredPolicies";
import { templateFiles } from "./templateDocument";
import { readSitePages, type SitePage } from "./siteContent";

/**
 * Every page, read fresh, with its data-built part attached where it has one:
 * a free tool's, or a policy manual index's table.
 */
export function publicSitePages(): SitePage[] {
  return readSitePages().map((page) => {
    const tool =
      (page.collection.key === "tools" ? TOOLS[page.slug] : undefined) ??
      MANUAL_PARTS[page.path];
    return tool ? { ...page, tool: tool() } : page;
  });
}

/**
 * The files that are not text: each template and each policy manual index as
 * a Word document, and the one-pager the share page offers.
 */
export async function publicSiteBinaryFiles(): Promise<
  Map<string, Uint8Array>
> {
  return new Map([
    ...(await templateFiles(publicSitePages())),
    ...(await manualFiles()),
    ...(await onePagerFiles()),
  ]);
}

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
  const files = siteFiles(publicSitePages(), {
    help,
    legal,
    helpMarkdown: HELP_GUIDES.map(renderGuideMarkdown),
  });
  // The one-pager as a page, for linking straight to it. Not a Markdown page,
  // so it stays out of the sitemap and the llms files: /share describes it.
  files.set(FLYER_PATH, flyerHtml());
  return files;
}
