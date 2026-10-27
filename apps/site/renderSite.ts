import { readFileSync } from "node:fs";
import { join } from "node:path";

import { stripTags } from "../../packages/utils/stripTags";
import { analyticsTag, trackAttributes } from "./analytics";
import { SIGNUP_SOURCE_SCRIPT } from "./signupSource";
import { appOrigin, appUrl } from "./appLink";
import { renderHelpCss } from "../help/renderHelp";
import { renderLegalBody } from "../legal/renderLegal";
import {
  linkCard,
  pageHero,
  siteFooter,
  siteHeader,
  type Crumb,
} from "./chrome";
import {
  breadcrumbLd,
  jsonLdScript,
  NOINDEX_META,
  ORGANIZATION_LD,
  ROBOTS_META,
  SHARE_IMAGE_LD,
  SITE,
  WEBSITE_LD,
} from "./structuredData";
import {
  SITE_COLLECTIONS,
  siteHref,
  type SiteCollection,
  type SitePage,
} from "./siteContent";

/**
 * The public site as ordinary web pages, built for people searching for help
 * with their policy manual and for the AI agents that answer them.
 *
 * **Plain HTML with nothing to run**, like `/help` and `/legal`: a search
 * engine or an agent that fetches a page and never runs its scripts reads
 * every word. Each page also comes as its Markdown source at `{path}.md`, is
 * listed in `/llms.txt` and `/sitemap.xml`, and carries schema.org JSON-LD:
 * the organization, a breadcrumb trail, the article, and its questions and
 * answers when it has a "Frequently asked questions" section.
 *
 * The Google tag goes on these pages, as on every page of bindersnap.com, when
 * the build names a measurement ID (`./analytics`).
 */

export { ORGANIZATION_LD, SITE };

/**
 * Our IndexNow key (https://www.indexnow.org). Not a secret: a search engine
 * proves we own the host by fetching it from `/{key}.txt`, and
 * `scripts/indexnow.ts` names it when it tells them a page changed. A new key
 * is only a new value here; the old file stops being served with it.
 */
export const INDEXNOW_KEY = "d4b96929a40564eed43a0ffbe2f43e28";

/** Not an organization's address: no organization name can start with `_`. */
export const SITE_CSS_PATH = "/_site/site.css";

const FONTS = "/fonts/fonts.css";

const escape = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const THEME_SCRIPT = `(function(){try{var s=localStorage.getItem("bs-theme");var d=window.matchMedia("(prefers-color-scheme: dark)").matches;document.documentElement.setAttribute("data-theme",s||(d?"dark":"light"));}catch(e){}})();`;

export function pageTitle(title: string): string {
  return /bindersnap/i.test(title) ? title : `${title} | Bindersnap`;
}

/** Every collection with an index page. */
function navCollections(pages: readonly SitePage[]): SiteCollection[] {
  return SITE_COLLECTIONS.filter(
    (collection) =>
      collection.prefix !== "" &&
      pages.some((page) => page.collection.key === collection.key),
  );
}

function shell(params: {
  title: string;
  description: string;
  path: string;
  markdown?: string;
  crumbs: Crumb[];
  structuredData: object[];
  pages: readonly SitePage[];
  /** The band under the bar: an eyebrow, the heading, and what to expect. */
  hero: { eyebrow: string; title: string; lede?: string; meta?: string };
  body: string;
  /** Beside the body on a wide screen: where the page goes, and the trial. */
  rail?: string;
  measurementId?: string;
  /** The date the page last changed, for `article:modified_time`. */
  updated?: string;
  /** Kept out of search results: the 404. */
  noindex?: boolean;
}): string {
  const graph = [
    ...(params.crumbs.length > 1 ? [breadcrumbLd(params.crumbs)] : []),
    ...params.structuredData,
  ];

  return `<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(params.title)}</title>
<meta name="description" content="${escape(params.description)}">
${
  params.noindex
    ? NOINDEX_META
    : `${ROBOTS_META}\n<link rel="canonical" href="${SITE}${params.path}">`
}
${
  params.markdown
    ? `<link rel="alternate" type="text/markdown" href="${params.markdown}">\n`
    : ""
}<link rel="alternate" type="text/plain" href="/llms.txt" title="The whole site, for AI agents">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Bindersnap">
<meta property="og:url" content="${SITE}${params.path}">
<meta property="og:title" content="${escape(params.title)}">
<meta property="og:description" content="${escape(params.description)}">
<meta property="og:image" content="${SITE}/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Bindersnap: The surveyor asks which version you approved. Show them.">
<meta property="og:locale" content="en_US">
${
  params.updated
    ? `<meta property="article:modified_time" content="${params.updated}">\n`
    : ""
}<meta name="twitter:card" content="summary_large_image">
<link rel="stylesheet" href="${FONTS}">
<link rel="stylesheet" href="${SITE_CSS_PATH}">
<script>${THEME_SCRIPT}</script>
<script>${SIGNUP_SOURCE_SCRIPT}</script>
${jsonLdScript(graph)}
${analyticsTag(
  params.measurementId ?? process.env.BINDERSNAP_GA_MEASUREMENT_ID,
  params.path,
)}
</head>
<body>
<a class="help-skip" href="#content">Skip to the page</a>
${siteHeader(params.path)}
<main id="content" class="site-main">
${pageHero({ ...params.hero, crumbs: params.crumbs })}
<div class="site-layout${params.rail ? " site-layout-rail" : ""}">
<div class="site-content">
${params.body}
</div>
${params.rail ? `<aside class="site-rail" aria-label="On this page">${params.rail}</aside>` : ""}
</div>
${CTA}
</main>
${siteFooter()}
</body>
</html>
`;
}

export interface Faq {
  question: string;
  answer: string;
}

const FAQ_HEADING = /^##\s+Frequently asked questions\s*$/im;

/**
 * The questions and answers under a page's "## Frequently asked questions":
 * each `### Question` and the paragraphs after it, as plain text for the
 * FAQPage JSON-LD. The page itself shows them as ordinary headings.
 */
export function extractFaqs(markdown: string): Faq[] {
  const start = markdown.search(FAQ_HEADING);
  if (start === -1) return [];
  const rest = markdown.slice(start).split("\n").slice(1);
  const end = rest.findIndex((line) => /^##\s/.test(line));
  const section = (end === -1 ? rest : rest.slice(0, end)).join("\n");
  return section
    .split(/^###\s+/m)
    .slice(1)
    .map((chunk) => {
      const [question, ...answer] = chunk.split("\n");
      return {
        question: question!.trim(),
        answer: plainText(answer.join("\n")),
      };
    })
    .filter((faq) => faq.question && faq.answer);
}

/** Markdown as the sentence a reader hears: no links' addresses, no emphasis marks. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`]/g, "")
    .replace(/^\s*[-+]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function wordCount(markdown: string): number {
  return plainText(markdown.replace(/^#+\s.*$/gm, ""))
    .split(" ")
    .filter(Boolean).length;
}

/**
 * The call to action at the foot of every page: the landing page's closing
 * card, so a page read from a search result ends where the landing page does.
 */
const CTA = `<section class="site-closing" aria-labelledby="site-closing-heading">
<div class="site-closing-card">
<p class="site-closing-tag">Get started</p>
<h2 id="site-closing-heading">Keep the approval record <em>with the policy.</em></h2>
<p>Bindersnap keeps every policy's current version, every earlier one, and who approved each — ready when the surveyor asks.</p>
<a class="site-closing-button" href="${appUrl("/-/signup")}"${trackAttributes("cta_click", { cta: "closing" })}>Start your 14-day free trial</a>
<p class="site-closing-hint">No card required · Reviewers and readers are free</p>
</div>
</section>`;

/** A page's second-level headings, for the rail's "On this page". */
export function pageSections(html: string): { id: string; title: string }[] {
  return [...html.matchAll(/<h2 id="([^"]+)">([\s\S]*?)<\/h2>/g)].map(
    (match) => ({ id: match[1]!, title: stripTags(match[2]!) }),
  );
}

function railHtml(
  sections: { id: string; title: string }[],
): string | undefined {
  if (sections.length < 3) return undefined;
  return `<nav class="site-toc" aria-label="On this page"><p class="site-rail-label">On this page</p><ol>${sections
    .map((section) => `<li><a href="#${section.id}">${section.title}</a></li>`)
    .join("")}</ol></nav>
<div class="site-rail-card">
<p>Every version of every policy, and who approved each.</p>
<a href="${appUrl("/-/signup")}"${trackAttributes("cta_click", { cta: "rail" })}>Try Bindersnap free</a>
</div>`;
}

/**
 * The body's opening paragraph, lifted into the hero as the page's lede, and
 * the body without it. A body that opens with anything else keeps it, and so
 * does one whose first paragraph ends in a colon: it introduces what follows.
 */
export function splitLede(html: string): { lede: string; rest: string } {
  const match = html.match(/^\s*<p>([\s\S]*?)<\/p>/);
  if (!match || /:\s*$/.test(match[1]!)) return { lede: "", rest: html };
  return { lede: match[1]!, rest: html.slice(match[0].length) };
}

/**
 * On a provider's page (`/for/{slug}`), every other page written for that
 * provider, by section: its templates, its requirements, the terms it meets.
 * Tagging a new page with `facilities:` is all it takes to be listed here.
 */
export function pagesForFacility(
  facility: string,
  pages: readonly SitePage[],
): { collection: SiteCollection; pages: SitePage[] }[] {
  return SITE_COLLECTIONS.map((collection) => ({
    collection,
    pages: pages.filter(
      (page) =>
        page.collection.key === collection.key &&
        page.facilities.includes(facility),
    ),
  })).filter((group) => group.pages.length > 0);
}

function facilityHtml(page: SitePage, pages: readonly SitePage[]): string {
  if (page.collection.key !== "for") return "";
  return pagesForFacility(page.slug, pages)
    .map(
      (group) =>
        `<section class="site-facility"><h2>${escape(group.collection.label)} for ${escape(
          (page.meta.crumb ?? page.title).toLowerCase(),
        )}</h2><ul class="site-cards">${group.pages
          .map((entry) => linkCard(entry))
          .join("")}</ul></section>`,
    )
    .join("");
}

function relatedHtml(
  page: SitePage,
  pages: readonly SitePage[],
  listed: readonly ListedPage[],
): string {
  const items = page.related
    .map(
      (path): ListedPage | undefined =>
        pages.find((entry) => entry.path === path) ??
        listed.find((entry) => entry.path === path),
    )
    .filter((entry): entry is ListedPage => entry !== undefined);
  if (!items.length) return "";
  return `<nav class="site-related" aria-label="Related"><h2>Related</h2><ul class="site-cards">${items
    .map((entry) => linkCard(entry))
    .join("")}</ul></nav>`;
}

/**
 * The product and its price, for a page whose front matter states one
 * (`price:`, per paid seat per month). Only /pricing does, and the landing
 * page's own JSON-LD must state the same offer (a test holds them together).
 */
export function softwareApplicationLd(price: string, currency = "USD") {
  return {
    "@type": "SoftwareApplication",
    name: "Bindersnap",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    url: `${SITE}/`,
    description: ORGANIZATION_LD.description,
    publisher: { "@id": ORGANIZATION_LD["@id"] },
    offers: {
      "@type": "Offer",
      name: "Bindersnap Pro",
      price,
      priceCurrency: currency,
      url: `${SITE}/pricing`,
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        price,
        priceCurrency: currency,
        unitText: "per writer per month",
        unitCode: "MON",
        referenceQuantity: {
          "@type": "QuantitativeValue",
          value: 1,
          unitCode: "MON",
        },
      },
    },
  };
}

/**
 * The policy itself, on a template page, as a sheet set apart from the advice
 * around it: everything from the "The template" heading to the next `h2`.
 */
export function frameTemplate(html: string, page?: SitePage): string {
  const download = page
    ? `<p class="site-download"><a class="site-download-button" href="${page.path}.docx" download="${page.slug}.docx"${trackAttributes("template_download", { template: page.slug })}>Download as Word (.docx)</a><span>Edit it in Word, then upload it to Bindersnap to keep its approvals and every version.</span></p>`
    : "";
  return html.replace(
    /(<h2 id="the-template">[\s\S]*?<\/h2>)([\s\S]*?)(?=<h2 |$)/,
    (_match, heading: string, sheet: string) =>
      `${heading}${download}<div class="site-template">${sheet}</div>`,
  );
}

export function renderSitePage(
  page: SitePage,
  pages: readonly SitePage[],
  /** Help guides and legal documents a page may recommend. */
  listed: readonly ListedPage[] = [],
): string {
  const crumbs: Crumb[] = [{ name: "Home", path: "/" }];
  if (page.collection.prefix) {
    crumbs.push({
      name: page.collection.label,
      path: siteHref(page.collection),
    });
  }
  crumbs.push({ name: page.meta.crumb ?? page.title, path: page.path });

  const faqs = extractFaqs(page.body);
  const structuredData: object[] = [
    {
      "@type": "Article",
      headline: page.title,
      description: page.description,
      // `published:` in the front matter, when the page has been out longer
      // than its last change.
      datePublished: page.meta.published ?? page.updated,
      dateModified: page.updated,
      inLanguage: "en-US",
      image: SHARE_IMAGE_LD,
      mainEntityOfPage: `${SITE}${page.path}`,
      isPartOf: { "@id": WEBSITE_LD["@id"] },
      author: { "@id": ORGANIZATION_LD["@id"] },
      publisher: { "@id": ORGANIZATION_LD["@id"] },
    },
  ];
  if (page.collection.key === "glossary") {
    structuredData.push({
      "@type": "DefinedTerm",
      name: page.meta.term ?? page.title,
      description: page.description,
      url: `${SITE}${page.path}`,
      inDefinedTermSet: { "@id": `${SITE}${siteHref(page.collection)}` },
    });
  }
  if (page.meta.price) {
    structuredData.push(
      softwareApplicationLd(page.meta.price, page.meta.currency),
    );
  }
  if (faqs.length) {
    structuredData.push({
      "@type": "FAQPage",
      mainEntity: faqs.map((faq) => ({
        "@type": "Question",
        name: faq.question,
        acceptedAnswer: { "@type": "Answer", text: faq.answer },
      })),
    });
  }

  const body = frameTemplate(
    renderLegalBody(page.body),
    page.collection.key === "templates" ? page : undefined,
  );
  // A tool's own part comes first and its prose explains it after, so its
  // hero says what it is in the page's description instead.
  const { lede, rest } = page.tool
    ? { lede: escape(page.description), rest: body }
    : splitLede(body);
  const eyebrow = page.collection.prefix
    ? page.collection.label
    : (page.meta.crumb ?? page.title);

  return shell({
    title: pageTitle(page.title),
    description: page.description,
    path: page.path,
    markdown: `${page.path}.md`,
    updated: page.updated,
    crumbs,
    structuredData,
    pages,
    hero: {
      eyebrow,
      title: page.title,
      lede,
      meta: `Updated <time datetime="${page.updated}">${escape(
        formatDate(page.updated),
      )}</time>`,
    },
    body: `<article class="site-article">
${
  page.collection.notice
    ? `<p class="site-notice">${escape(page.collection.notice)}</p>\n`
    : ""
}${page.tool?.html ?? ""}${rest}
</article>
${facilityHtml(page, pages)}
${relatedHtml(page, pages, listed)}`,
    rail: railHtml(pageSections(rest)),
  });
}

export function renderCollectionIndex(
  collection: SiteCollection,
  pages: readonly SitePage[],
): string {
  const entries = pages.filter(
    (page) => page.collection.key === collection.key,
  );
  const path = siteHref(collection);
  return shell({
    title: pageTitle(collection.label),
    description: collection.intro,
    path,
    crumbs: [
      { name: "Home", path: "/" },
      { name: collection.label, path },
    ],
    structuredData: [
      {
        "@type": "CollectionPage",
        name: collection.label,
        description: collection.intro,
        url: `${SITE}${path}`,
        isPartOf: { "@id": WEBSITE_LD["@id"] },
        hasPart: entries.map((page) => ({
          "@type": "Article",
          headline: page.title,
          url: `${SITE}${page.path}`,
        })),
      },
      // The glossary is also the set its terms name in `inDefinedTermSet`.
      ...(collection.key === "glossary"
        ? [
            {
              "@type": "DefinedTermSet",
              "@id": `${SITE}${path}`,
              name: collection.label,
              description: collection.intro,
              hasDefinedTerm: entries.map((page) => ({
                "@type": "DefinedTerm",
                name: page.meta.term ?? page.title,
                url: `${SITE}${page.path}`,
              })),
            },
          ]
        : []),
    ],
    pages,
    hero: {
      eyebrow: "Free resources",
      title: collection.label,
      lede: escape(collection.intro),
    },
    body: `<ul class="site-cards site-index">${entries.map(linkCard).join("")}</ul>`,
  });
}

/**
 * The site's 404. Before issue #718 the app lived here, at `/{org}/...`, so a
 * link shared then names bindersnap.com. A static host cannot tell an
 * organization from a typo, so the page never sends anyone to the app on its
 * own: an address whose first segment is not one of the site's own `sections`
 * shows a link to the same path on the app, with its query and fragment.
 * `_redirects` already sends `/-/` and `/auth/` there with a 301.
 */
export function renderNotFoundPage(
  sections: readonly string[],
  pages: readonly SitePage[],
): string {
  // Constant code: what it needs is in the paragraph's attributes, which
  // `escape` makes safe, so no value is ever spliced into the script.
  const offer = `(function(){var offer=document.getElementById("not-found-app");var first=location.pathname.split("/")[1]||"";if(!first||offer.dataset.sections.split(" ").indexOf(first)!==-1)return;offer.querySelector("a").href=offer.dataset.app+location.pathname+location.search+location.hash;offer.hidden=false;})();`;
  return shell({
    title: pageTitle("Page not found"),
    description: "There is no page at this address.",
    path: "/404",
    noindex: true,
    crumbs: [{ name: "Home", path: "/" }],
    structuredData: [],
    pages,
    hero: {
      eyebrow: "Not found",
      title: "There is no page here.",
      lede: `It may have moved. Your documents are in <a href="${escape(appUrl("/"))}">the app</a>; everything else starts at <a href="/">the home page</a>.`,
    },
    body: `<p id="not-found-app" hidden data-sections="${escape([...sections].sort().join(" "))}" data-app="${escape(appOrigin())}">Looking for one of your binders? <a href="${escape(appUrl("/"))}">Open this address in the app</a>.</p>
<script>${offer}</script>`,
  });
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function formatDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return `${MONTHS[(month ?? 1) - 1]} ${day}, ${year}`;
}

export function renderPageMarkdown(page: SitePage): string {
  const notice = page.collection.notice
    ? `> ${page.collection.notice}\n\n`
    : "";
  const tool = page.tool ? `${page.tool.markdown}\n\n` : "";
  return `# ${page.title}\n\n${page.description}\n\nUpdated: ${page.updated}\nSource: ${SITE}${page.path}\n\n${notice}${tool}${page.body}\n`;
}

/** Another site's page this one lists: help guides, legal documents, the landing page. */
export interface ListedPage {
  path: string;
  title: string;
  description: string;
  /** Its Markdown copy, when it has one. */
  markdown?: string;
  updated?: string;
}

/**
 * The index an agent reads first (https://llmstxt.org): what Bindersnap is, in
 * the words a buyer would use, then every page with its Markdown copy.
 */
export function renderLlmsTxt(
  pages: readonly SitePage[],
  others: { help: readonly ListedPage[]; legal: readonly ListedPage[] },
): string {
  const link = (entry: ListedPage | SitePage) =>
    `- [${entry.title}](${SITE}${
      "body" in entry ? `${entry.path}.md` : (entry.markdown ?? entry.path)
    }): ${entry.description}`;

  const lines = [
    "# Bindersnap",
    "",
    "> Bindersnap is policy and procedure management software for small healthcare providers — clinics, ambulatory surgery centers, home health agencies, hospices, behavioral health programs and rural health clinics. Every policy keeps its current approved version, every earlier version, and the record of who approved each one and when, so the organization can answer a surveyor or accreditor in minutes.",
    "",
    `- Pricing: $39 a month per paid seat — the owners, admins and editors who write and publish policies. Reviewers who approve and staff who only read are free, in any number. Every organization starts with a 14-day free trial, no card required. See the [pricing page](${SITE}/pricing.md).`,
    "- How it works: a change to a policy is proposed, reviewed by the approvers the organization names, and only then becomes the current version. An approved version cannot change without a new, reviewable version.",
    "- Works with the files you have: write policies in Bindersnap's editor, or upload the Word and PDF files you already keep.",
    "- Exports any version, and an audit packet of versions and approvals, to PDF and Word. Reading and exporting stay free even if a subscription lapses.",
    "- Not for patient health information: Bindersnap holds an organization's policies and procedures, never patient records.",
    "- Not a training or accreditation platform: it has no courses, tests or read-and-sign acknowledgments. The comparison pages below say where other products do more.",
    "- Made by Solid Gray LLC, a Missouri company, for organizations in the United States. Questions go to the founder, David Gray, at david@bindersnap.com.",
    "",
    `Every page below is also served as HTML at the same address without \`.md\`. The full text of all of them is at ${SITE}/llms-full.txt.`,
    "",
  ];
  const root = pages.filter((page) => page.collection.prefix === "");
  lines.push(
    "## Product",
    "",
    `- [Bindersnap](${SITE}/): What Bindersnap is, who it is for, and how a policy's approval record works.`,
    ...root.map(link),
    "",
  );
  for (const collection of SITE_COLLECTIONS) {
    if (!collection.prefix) continue;
    const entries = pages.filter(
      (page) => page.collection.key === collection.key,
    );
    if (!entries.length) continue;
    lines.push(
      `## ${collection.label}`,
      "",
      collection.intro,
      "",
      ...entries.map(link),
      "",
    );
  }
  if (others.help.length)
    lines.push("## Help", "", ...others.help.map(link), "");
  if (others.legal.length) {
    lines.push("## Optional", "", ...others.legal.map(link), "");
  }
  return lines.join("\n");
}

/** Every page's Markdown in one file, for an agent that wants it all at once. */
export function renderLlmsFullTxt(
  pages: readonly SitePage[],
  helpMarkdown: readonly string[],
): string {
  return [
    "# Bindersnap — the full text of bindersnap.com",
    "",
    ...pages.map(renderPageMarkdown),
    ...helpMarkdown,
  ].join("\n---\n\n");
}

export function renderSitemap(
  entries: readonly { path: string; updated?: string }[],
): string {
  const urls = entries
    .map(
      (entry) =>
        `<url><loc>${SITE}${escape(entry.path)}</loc>${
          entry.updated ? `<lastmod>${entry.updated}</lastmod>` : ""
        }</url>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

/**
 * Every crawler is welcome, AI search included: being cited by ChatGPT,
 * Claude or Perplexity is how a growing share of buyers find software. The
 * app is another origin with its own robots.txt, which turns them all away.
 */
export function renderRobotsTxt(): string {
  return `# Bindersnap welcomes search engines and AI assistants.
User-agent: *
Allow: /

Sitemap: ${SITE}/sitemap.xml
`;
}

/**
 * Every file the public site serves, by path: the pages and their Markdown,
 * each collection's index, the stylesheet, the sitemap, robots.txt, the
 * IndexNow key and the llms files. Help and legal pages are passed in to be listed, not rendered.
 */
export function siteFiles(
  pages: readonly SitePage[],
  others: {
    help: readonly ListedPage[];
    legal: readonly ListedPage[];
    helpMarkdown: readonly string[];
  },
): Map<string, string> {
  const files = new Map<string, string>([
    [
      SITE_CSS_PATH,
      `${renderHelpCss()}\n${readFileSync(join(import.meta.dir, "site.css"), "utf8")}`,
    ],
    ["/robots.txt", renderRobotsTxt()],
    [`/${INDEXNOW_KEY}.txt`, INDEXNOW_KEY],
    ["/llms.txt", renderLlmsTxt(pages, others)],
    ["/llms-full.txt", renderLlmsFullTxt(pages, others.helpMarkdown)],
  ]);
  for (const page of pages) {
    files.set(
      page.path,
      renderSitePage(page, pages, [...others.help, ...others.legal]),
    );
    files.set(`${page.path}.md`, renderPageMarkdown(page));
  }
  const indexes = navCollections(pages);
  for (const collection of indexes) {
    files.set(siteHref(collection), renderCollectionIndex(collection, pages));
  }
  // Every first segment the site answers for; anything else is the app's.
  const sections = new Set(["help", "legal", "fonts", "_site"]);
  for (const path of files.keys()) {
    const first = path.split("/")[1]?.replace(/\.[a-z]+$/, "");
    if (first) sections.add(first);
  }
  files.set("/404", renderNotFoundPage([...sections], pages));
  files.set(
    "/sitemap.xml",
    renderSitemap([
      { path: "/" },
      ...pages.map((page) => ({ path: page.path, updated: page.updated })),
      ...indexes.map((collection) => ({
        path: siteHref(collection),
        updated: latest(pages, collection),
      })),
      ...others.help.map((entry) => ({
        path: entry.path,
        updated: entry.updated,
      })),
      ...others.legal.map((entry) => ({
        path: entry.path,
        updated: entry.updated,
      })),
    ]),
  );
  return files;
}

function latest(pages: readonly SitePage[], collection: SiteCollection) {
  return pages
    .filter((page) => page.collection.key === collection.key)
    .map((page) => page.updated)
    .sort()
    .at(-1);
}

export function siteContentType(path: string): string {
  if (path.endsWith(".css")) return "text/css; charset=utf-8";
  if (path.endsWith(".md")) return "text/markdown; charset=utf-8";
  if (path.endsWith(".txt")) return "text/plain; charset=utf-8";
  if (path.endsWith(".xml")) return "application/xml; charset=utf-8";
  return "text/html; charset=utf-8";
}
