import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderHelpCss } from "../help/renderHelp";
import { renderLegalBody } from "../legal/renderLegal";
import { siteFooter, siteHeader } from "./chrome";
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
 * The Google tag goes on these pages only — never on the landing page, help,
 * legal, or anywhere the app runs, where signed-in customers read — and only
 * when the build names a measurement ID. Issue #718 moves the app to its own
 * subdomain, after which the landing page can carry it too.
 */

export const SITE = "https://bindersnap.com";

/** Not an organization's address: no organization name can start with `_`. */
export const SITE_CSS_PATH = "/_site/site.css";

const FONTS = "/fonts/fonts.css";

const escape = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** JSON inside `<script>`: a `</script>` in a title must not end it. */
const jsonLd = (value: unknown) =>
  `<script type="application/ld+json">${JSON.stringify(value).replace(
    /</g,
    "\\u003c",
  )}</script>`;

const THEME_SCRIPT = `(function(){try{var s=localStorage.getItem("bs-theme");var d=window.matchMedia("(prefers-color-scheme: dark)").matches;document.documentElement.setAttribute("data-theme",s||(d?"dark":"light"));}catch(e){}})();`;

/** Who publishes every page. Also on the landing page, in `index.html`. */
export const ORGANIZATION_LD = {
  "@type": "Organization",
  "@id": `${SITE}/#organization`,
  name: "Bindersnap",
  legalName: "Solid Gray LLC",
  url: `${SITE}/`,
  logo: `${SITE}/icon-512.png`,
};

/** A GA4 measurement ID, as Google issues them. Anything else is ignored. */
const MEASUREMENT_ID = /^G-[A-Z0-9]{4,20}$/;

/**
 * The Google tag, configured the way the Privacy Policy promises: no Google
 * signals and no ad personalization, and not loaded at all when the browser
 * sends Global Privacy Control. `id` comes from `BINDERSNAP_GA_MEASUREMENT_ID`
 * at build time; without one there is no tag.
 *
 * Three settings in the Google Analytics admin keep the rest of the policy
 * true, and nothing here can check them:
 * - Data retention set to 14 months (the policy says so; GA4's default is 2).
 * - Every data-sharing setting off ("Google products & services" first), and
 *   Google's data processing terms accepted, so Google acts as our service
 *   provider and the policy's "we do not share" holds under California law.
 * - Google signals and ad personalization off for the property, as the tag
 *   asks.
 */
export function analyticsTag(id: string | undefined): string {
  if (!id || !MEASUREMENT_ID.test(id)) return "";
  return `<script>
(function(){
  if (navigator.globalPrivacyControl) return;
  var s=document.createElement("script");s.async=true;
  s.src="https://www.googletagmanager.com/gtag/js?id=${id}";
  document.head.appendChild(s);
  window.dataLayer=window.dataLayer||[];
  window.gtag=function(){dataLayer.push(arguments);};
  gtag("js",new Date());
  gtag("config","${id}",{allow_google_signals:false,allow_ad_personalization_signals:false});
})();
</script>`;
}

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

interface Crumb {
  name: string;
  path: string;
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
  hero: string;
  body: string;
  /** Beside the body on a wide screen: where the page goes, and the trial. */
  rail?: string;
  measurementId?: string;
}): string {
  const crumbs =
    params.crumbs.length > 1
      ? `<nav class="site-crumbs" aria-label="Breadcrumb"><ol>${params.crumbs
          .map((crumb, index) =>
            index === params.crumbs.length - 1
              ? `<li aria-current="page">${escape(crumb.name)}</li>`
              : `<li><a href="${crumb.path}">${escape(crumb.name)}</a></li>`,
          )
          .join("")}</ol></nav>`
      : "";

  const graph = [
    ORGANIZATION_LD,
    ...(params.crumbs.length > 1
      ? [
          {
            "@type": "BreadcrumbList",
            itemListElement: params.crumbs.map((crumb, index) => ({
              "@type": "ListItem",
              position: index + 1,
              name: crumb.name,
              item: `${SITE}${crumb.path}`,
            })),
          },
        ]
      : []),
    ...params.structuredData,
  ];

  return `<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(params.title)}</title>
<meta name="description" content="${escape(params.description)}">
<link rel="canonical" href="${SITE}${params.path}">
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
<meta name="twitter:card" content="summary_large_image">
<link rel="stylesheet" href="${FONTS}">
<link rel="stylesheet" href="${SITE_CSS_PATH}">
<script>${THEME_SCRIPT}</script>
${jsonLd({ "@context": "https://schema.org", "@graph": graph })}
${analyticsTag(params.measurementId ?? process.env.BINDERSNAP_GA_MEASUREMENT_ID)}
</head>
<body>
<a class="help-skip" href="#content">Skip to the page</a>
${siteHeader(params.path)}
<main id="content" class="site-main">
<div class="site-hero"><div class="site-hero-inner">
${crumbs}
${params.hero}
</div></div>
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
<a class="site-closing-button" href="/-/signup">Start your 14-day free trial</a>
<p class="site-closing-hint">No card required · Reviewers and readers are free</p>
</div>
</section>`;

/** A page's second-level headings, for the rail's "On this page". */
export function pageSections(html: string): { id: string; title: string }[] {
  return [...html.matchAll(/<h2 id="([^"]+)">([\s\S]*?)<\/h2>/g)].map(
    (match) => ({ id: match[1]!, title: match[2]!.replace(/<[^>]+>/g, "") }),
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
<a href="/-/signup">Try Bindersnap free</a>
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

/** A page as a link card: its title, what it answers, and a way in. */
function card(entry: ListedPage): string {
  return `<li><a href="${entry.path}"><span class="site-card-title">${escape(
    entry.title,
  )}</span><span class="site-card-summary">${escape(entry.description)}</span><span class="site-card-more" aria-hidden="true">Read →</span></a></li>`;
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
          .map((entry) => card(entry))
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
    .map((entry) => card(entry))
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
    publisher: { "@id": ORGANIZATION_LD["@id"] },
    offers: {
      "@type": "Offer",
      name: "Bindersnap Pro",
      price,
      priceCurrency: currency,
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
    ? `<p class="site-download"><a class="site-download-button" href="${page.path}.docx" download="${page.slug}.docx">Download as Word (.docx)</a><span>Edit it in Word, then upload it to Bindersnap to keep its approvals and every version.</span></p>`
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
      dateModified: page.updated,
      mainEntityOfPage: `${SITE}${page.path}`,
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
      inDefinedTermSet: `${SITE}${siteHref(page.collection)}`,
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
    crumbs,
    structuredData,
    pages,
    hero: `<p class="bs-eyebrow site-eyebrow">${escape(eyebrow)}</p>
<h1>${escape(page.title)}</h1>
${lede ? `<p class="site-lede">${lede}</p>\n` : ""}<p class="site-updated">Updated <time datetime="${page.updated}">${escape(
      formatDate(page.updated),
    )}</time></p>`,
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
        hasPart: entries.map((page) => ({
          "@type": "Article",
          headline: page.title,
          url: `${SITE}${page.path}`,
        })),
      },
    ],
    pages,
    hero: `<p class="bs-eyebrow site-eyebrow">Free resources</p>
<h1>${escape(collection.label)}</h1>
<p class="site-lede">${escape(collection.intro)}</p>`,
    body: `<ul class="site-cards site-index">${entries.map(card).join("")}</ul>`,
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
    "> Bindersnap is policy and procedure management software for small healthcare providers — clinics, ambulatory surgery centers, home health agencies and behavioral health programs. Every policy keeps its current approved version, every earlier version, and the record of who approved each one and when, so the organization can answer a surveyor or accreditor in minutes.",
    "",
    "- Pricing: $39 a month per paid seat — the owners, admins and editors who write and publish policies. Reviewers who approve and staff who only read are free, in any number. Every organization starts with a 14-day free trial, no card required. See the pricing page.",
    "- Not for patient health information: Bindersnap holds an organization's policies and procedures, never patient records.",
    "- Exports any version, and an audit packet of versions and approvals, to PDF and Word.",
    "",
    "Every page below is also served as HTML at the same address without `.md`. The full text of all of them is at /llms-full.txt.",
    "",
  ];
  const root = pages.filter((page) => page.collection.prefix === "");
  if (root.length) lines.push("## Product", "", ...root.map(link), "");
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
 * app's own pages behind `/-/` hold nothing a crawler can read.
 */
export function renderRobotsTxt(): string {
  return `# Bindersnap welcomes search engines and AI assistants.
User-agent: *
Allow: /
Disallow: /-/
Disallow: /auth/

Sitemap: ${SITE}/sitemap.xml
`;
}

/**
 * Every file the public site serves, by path: the pages and their Markdown,
 * each collection's index, the stylesheet, the sitemap, robots.txt and the
 * llms files. Help and legal pages are passed in to be listed, not rendered.
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
