import { renderHelpCss } from "../help/renderHelp";
import { renderLegalBody } from "../legal/renderLegal";
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

const LOGO_MARK = `<svg viewBox="0 0 18 18" fill="none" aria-hidden="true" width="18" height="18"><rect x="2" y="1" width="9" height="13" rx="1.5" stroke="currentColor" stroke-width="1.5"/><rect x="6" y="4" width="9" height="13" rx="1.5" stroke="currentColor" stroke-width="1.5"/></svg>`;

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

/** The sections a page's navigation offers: every collection with an index. */
function navCollections(pages: readonly SitePage[]): SiteCollection[] {
  return SITE_COLLECTIONS.filter(
    (collection) =>
      collection.prefix !== "" &&
      pages.some((page) => page.collection.key === collection.key),
  );
}

function rootPage(pages: readonly SitePage[], slug: string) {
  return pages.find(
    (page) => page.collection.prefix === "" && page.slug === slug,
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
  body: string;
  measurementId?: string;
}): string {
  const sections = navCollections(params.pages);
  const pricing = rootPage(params.pages, "pricing");
  const navLinks = [
    ...sections.map((collection) => ({
      href: siteHref(collection),
      label: collection.label,
    })),
    ...(pricing ? [{ href: pricing.path, label: "Pricing" }] : []),
    { href: "/help", label: "Help" },
  ];
  const nav = navLinks
    .map(
      (link) =>
        `<a href="${link.href}"${
          params.path === link.href || params.path.startsWith(`${link.href}/`)
            ? ' aria-current="page"'
            : ""
        }>${escape(link.label)}</a>`,
    )
    .join("");

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

  const footerColumns = [
    {
      heading: "Product",
      links: [
        { href: "/", label: "Bindersnap" },
        ...(pricing ? [{ href: pricing.path, label: "Pricing" }] : []),
        { href: "/help", label: "Help and guides" },
        { href: "/-/signup", label: "Create an account" },
      ],
    },
    ...(sections.length
      ? [
          {
            heading: "Resources",
            links: sections.map((collection) => ({
              href: siteHref(collection),
              label: collection.label,
            })),
          },
        ]
      : []),
    {
      heading: "Legal",
      links: [
        { href: "/legal/terms", label: "Terms" },
        { href: "/legal/privacy", label: "Privacy" },
        { href: "/legal/security", label: "Security" },
        { href: "/legal/subprocessors", label: "Subprocessors" },
      ],
    },
  ];
  const footer = footerColumns
    .map(
      (column) =>
        `<div><h2>${escape(column.heading)}</h2><ul>${column.links
          .map(
            (link) =>
              `<li><a href="${link.href}">${escape(link.label)}</a></li>`,
          )
          .join("")}</ul></div>`,
    )
    .join("");

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
<header class="help-bar site-bar">
  <a class="help-brand" href="/">${LOGO_MARK}<span>Bindersnap</span></a>
  <nav class="site-nav" aria-label="Site">${nav}</nav>
  <div class="site-bar-actions">
    <a class="site-signin" href="/-/login">Sign in</a>
    <a class="help-open site-start" href="/-/signup">Start free trial</a>
  </div>
</header>
<main id="content" class="site-main">
${crumbs}
${params.body}
</main>
<footer class="site-footer">
  <div class="site-footer-inner">${footer}</div>
  <p class="site-footer-note">© 2026 Solid Gray LLC · Bindersnap is for policies and procedures, never patient records.</p>
</footer>
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

/** The call to action at the foot of every page. */
const CTA = `<aside class="site-cta">
<h2>Keep the approval record with the policy</h2>
<p>Bindersnap keeps every policy's current version, every earlier one, and who approved each — ready when the surveyor asks.</p>
<a class="site-cta-button" href="/-/signup">Start your 14-day free trial</a>
</aside>`;

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
        )}</h2><ul class="help-cards">${group.pages
          .map(
            (entry) =>
              `<li><a href="${entry.path}"><span class="help-card-title">${escape(
                entry.title,
              )}</span><span class="help-card-summary">${escape(entry.description)}</span></a></li>`,
          )
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
  return `<nav class="site-related" aria-label="Related"><h2>Related</h2><ul class="help-cards">${items
    .map(
      (entry) =>
        `<li><a href="${entry.path}"><span class="help-card-title">${escape(
          entry.title,
        )}</span><span class="help-card-summary">${escape(entry.description)}</span></a></li>`,
    )
    .join("")}</ul></nav>`;
}

/**
 * The product and its price, for a page whose front matter states one
 * (`price:`, per paid seat per month). No page does until a price is set.
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
export function frameTemplate(html: string): string {
  return html.replace(
    /(<h2 id="the-template">[\s\S]*?<\/h2>)([\s\S]*?)(?=<h2 |$)/,
    '$1<div class="site-template">$2</div>',
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

  return shell({
    title: pageTitle(page.title),
    description: page.description,
    path: page.path,
    markdown: `${page.path}.md`,
    crumbs,
    structuredData,
    pages,
    body: `<article class="site-article">
<h1>${escape(page.title)}</h1>
<p class="site-updated">Updated <time datetime="${page.updated}">${escape(
      formatDate(page.updated),
    )}</time></p>
${
  page.collection.notice
    ? `<p class="site-notice">${escape(page.collection.notice)}</p>\n`
    : ""
}${frameTemplate(renderLegalBody(page.body))}
</article>
${facilityHtml(page, pages)}
${relatedHtml(page, pages, listed)}
${CTA}`,
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
    body: `<h1>${escape(collection.label)}</h1>
<p class="help-lede">${escape(collection.intro)}</p>
<ul class="help-cards site-index">${entries
      .map(
        (page) =>
          `<li><a href="${page.path}"><span class="help-card-title">${escape(
            page.title,
          )}</span><span class="help-card-summary">${escape(page.description)}</span></a></li>`,
      )
      .join("")}</ul>
${CTA}`,
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
  return `# ${page.title}\n\n${page.description}\n\nUpdated: ${page.updated}\nSource: ${SITE}${page.path}\n\n${notice}${page.body}\n`;
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
    "- Pricing: per paid seat — the owners, admins and editors who write and publish policies. Reviewers who approve and staff who only read are free, in any number. Every organization starts with a 14-day free trial, no card required. See the pricing page.",
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
    [SITE_CSS_PATH, `${renderHelpCss()}\n${SITE_CSS}`],
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

const SITE_CSS = `
.site-bar { flex-wrap: wrap; }
.site-nav { display: flex; gap: 4px; flex-wrap: wrap; flex: 1; justify-content: center; }
.site-nav a {
  font-size: 14px;
  padding: 6px 10px;
  border-radius: 6px;
  text-decoration: none;
  color: var(--bs-text-secondary);
}
.site-nav a:hover, .site-nav a[aria-current="page"] {
  background: var(--bs-surface-2);
  color: var(--bs-text-primary);
}
.site-bar-actions { display: flex; align-items: center; gap: 12px; }
.site-signin { font-size: 14px; text-decoration: none; color: var(--bs-text-secondary); }
.site-start { background: var(--brand-coral); border-color: var(--brand-coral); color: #fff; }
.site-start:hover { background: var(--brand-coral); filter: brightness(0.95); }
.site-main { max-width: 760px; margin: 0 auto; padding: 32px 24px 64px; }
.site-main h1 {
  font-family: var(--brand-font-serif, "Lora", Georgia, serif);
  font-weight: 600;
  font-size: 36px;
  line-height: 1.15;
  color: var(--bs-text-primary);
  margin: 0 0 8px;
}
.site-main h2 {
  font-family: var(--brand-font-serif, "Lora", Georgia, serif);
  font-weight: 600;
  font-size: 22px;
  line-height: 1.3;
  color: var(--bs-text-primary);
  margin: 40px 0 10px;
  scroll-margin-top: 16px;
}
.site-main h3 {
  font-size: 17px;
  font-weight: 600;
  color: var(--bs-text-primary);
  margin: 24px 0 6px;
  scroll-margin-top: 16px;
}
.site-main p, .site-main ul, .site-main ol { margin: 0 0 14px; }
.site-main ul, .site-main ol { padding-left: 1.4em; }
.site-main li { margin: 6px 0; }
.site-main strong { color: var(--bs-text-primary); font-weight: 600; }
.site-article a { color: var(--bs-coral-text); }
.site-main blockquote {
  margin: 0 0 14px;
  padding: 10px 16px;
  border-left: 3px solid var(--bs-rule-warm);
  background: var(--bs-surface-2);
  border-radius: 0 8px 8px 0;
}
.site-main blockquote p { margin: 0; }
.site-main table {
  width: 100%;
  border-collapse: collapse;
  margin: 8px 0 20px;
  font-size: 15px;
  display: block;
  overflow-x: auto;
}
.site-main th, .site-main td {
  text-align: left;
  vertical-align: top;
  padding: 8px 10px;
  border-bottom: 1px solid var(--bs-rule);
}
.site-main th { color: var(--bs-text-primary); font-weight: 600; background: var(--bs-surface-2); }
.site-main pre {
  white-space: pre-wrap;
  background: var(--bs-surface-2);
  border: 1px solid var(--bs-rule);
  border-radius: 10px;
  padding: 14px 16px;
  font-size: 14px;
}
.site-notice {
  margin: 0 0 24px;
  padding: 12px 16px;
  border: 1px solid var(--bs-status-warn-border);
  border-radius: 10px;
  background: var(--bs-status-warn-bg);
  color: var(--bs-status-warn-fg);
  font-size: 15px;
}
.site-template {
  margin: 12px 0 8px;
  padding: 28px 32px;
  border: 1px solid var(--bs-rule);
  border-radius: 12px;
  background: var(--bs-surface-1);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}
.site-template h3:first-child {
  margin-top: 0;
  font-family: var(--brand-font-serif, "Lora", Georgia, serif);
  font-size: 20px;
}
.site-updated {
  font-family: var(--brand-font-mono, "Geist Mono", monospace);
  font-size: 13px;
  color: var(--bs-text-muted);
  margin: 0 0 24px;
}
.site-crumbs ol { list-style: none; display: flex; flex-wrap: wrap; gap: 6px; padding: 0; margin: 0 0 20px; font-size: 14px; color: var(--bs-text-muted); }
.site-crumbs li + li::before { content: "/"; margin-right: 6px; }
.site-crumbs a { color: var(--bs-text-muted); }
.site-related, .site-facility { margin-top: 48px; }
.site-facility .help-cards, .site-cta {
  margin: 48px 0 0;
  padding: 24px;
  border: 1px solid var(--bs-rule);
  border-radius: 14px;
  background: var(--bs-surface-1);
}
.site-cta h2 { margin-top: 0; }
.site-cta-button {
  display: inline-block;
  margin-top: 4px;
  padding: 10px 18px;
  border-radius: 8px;
  background: var(--brand-coral);
  color: #fff;
  font-weight: 600;
  text-decoration: none;
}
.site-footer { border-top: 1px solid var(--bs-rule); padding: 40px 24px; }
.site-footer-inner {
  max-width: 1080px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 24px;
}
.site-footer h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--bs-text-muted); margin: 0 0 8px; }
.site-footer ul { list-style: none; padding: 0; margin: 0; font-size: 14px; }
.site-footer li { margin: 4px 0; }
.site-footer a { text-decoration: none; color: var(--bs-text-secondary); }
.site-footer a:hover { color: var(--bs-text-primary); }
.site-footer-note { max-width: 1080px; margin: 24px auto 0; font-size: 13px; color: var(--bs-text-muted); }
@media (max-width: 760px) {
  .site-nav { order: 3; flex-basis: 100%; justify-content: flex-start; }
  .site-signin { display: none; }
  .site-main { padding: 24px 16px 56px; }
  .site-main h1 { font-size: 28px; }
  .site-template { padding: 18px 16px; }
}
`;
