import { markdownToHtml } from "../app/markdown";
import { renderHelpCss } from "../help/renderHelp";
import { linkCard, pageHero, siteFooter, siteHeader } from "../site/chrome";
import type { LegalDocument } from "./legalDocuments";

/**
 * The legal pages as ordinary web pages: `/legal`, `/legal/{slug}`.
 *
 * Plain HTML with nothing to run, for the same reasons as help: a buyer's
 * lawyer, a search engine and an AI agent all read them without running a
 * script, and they must read the same words. Each one is also served as its
 * Markdown source at `/legal/{slug}.md`.
 *
 * They wear the help pages' clothes — the same bar, side navigation and type —
 * so the stylesheet is help's plus the few things a contract has that a guide
 * does not: tables, third-level headings, and bullet lists.
 *
 * Built into `dist/legal` for GitHub Pages by `scripts/build-legal.ts`, and
 * served from the same function by `server.ts` in development.
 */

const escape = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export function legalHref(slug?: string): string {
  return slug ? `/legal/${slug}` : "/legal";
}

const SITE = "https://bindersnap.com";

const FONTS = "/fonts/fonts.css";

const THEME_SCRIPT = `(function(){try{var s=localStorage.getItem("bs-theme");var d=window.matchMedia("(prefers-color-scheme: dark)").matches;document.documentElement.setAttribute("data-theme",s||(d?"dark":"light"));}catch(e){}})();`;

function page(params: {
  title: string;
  description: string;
  path: string;
  markdown?: string;
  documents: readonly LegalDocument[];
  current?: string;
  hero: Parameters<typeof pageHero>[0];
  body: string;
}): string {
  const nav = params.documents
    .map((document) => {
      const here = document.slug === params.current;
      return `<li><a href="${legalHref(document.slug)}"${
        here ? ' aria-current="page"' : ""
      }>${escape(document.title)}</a></li>`;
    })
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
}<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Bindersnap">
<meta property="og:url" content="${SITE}${params.path}">
<meta property="og:title" content="${escape(params.title)}">
<meta property="og:description" content="${escape(params.description)}">
<meta property="og:image" content="${SITE}/og-image.png">
<link rel="stylesheet" href="${FONTS}">
<link rel="stylesheet" href="/legal/legal.css">
<script>${THEME_SCRIPT}</script>
</head>
<body>
<a class="help-skip" href="#content">Skip to the text</a>
${siteHeader(params.path)}
${pageHero(params.hero)}
<div class="help-layout">
  <nav class="help-nav" aria-label="Legal documents">
    <a class="help-nav-home" href="/legal"${
      params.current ? "" : ' aria-current="page"'
    }>All legal documents</a>
    <ul>${nav}</ul>
    <a class="help-nav-home legal-nav-help" href="/help">Help and guides</a>
  </nav>
  <main id="content" class="help-main legal-main">
${params.body}
  </main>
</div>
${siteFooter()}
</body>
</html>
`;
}

/** A heading's anchor, so "see section 7 of the DPA" can be a link. */
function headingId(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z]+;/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function renderLegalBody(markdown: string): string {
  const used = new Set<string>();
  return markdownToHtml(markdown).replace(
    /<h([23])>(.*?)<\/h\1>/g,
    (_match, level: string, inner: string) => {
      let id = headingId(inner) || "section";
      for (let n = 2; used.has(id); n += 1) id = `${headingId(inner)}-${n}`;
      used.add(id);
      return `<h${level} id="${id}">${inner}</h${level}>`;
    },
  );
}

export function renderLegalIndex(documents: readonly LegalDocument[]): string {
  const cards = documents
    .map((document) =>
      linkCard({
        path: legalHref(document.slug),
        title: document.title,
        description: document.summary,
      }),
    )
    .join("");
  return page({
    title: "Legal — Bindersnap",
    description:
      "Bindersnap's Terms of Service, Privacy Policy, Data Processing Addendum, subprocessors and security overview.",
    path: "/legal",
    documents,
    hero: {
      eyebrow: "Legal",
      title: "Legal",
      lede: "What you agree to when you use Bindersnap, and what we promise back.",
    },
    body: `<p class="legal-callout">Bindersnap is not for patient health information. Keep your policies and procedures here — never patient records.</p>
<ul class="site-cards help-index">${cards}</ul>`,
  });
}

export function renderLegalDocument(
  document: LegalDocument,
  documents: readonly LegalDocument[],
): string {
  return page({
    title: `${document.title} — Bindersnap`,
    description: document.summary,
    path: legalHref(document.slug),
    markdown: `${legalHref(document.slug)}.md`,
    documents,
    current: document.slug,
    hero: {
      eyebrow: "Legal",
      title: document.title,
      lede: escape(document.summary),
      meta: `Last updated ${escape(document.lastUpdated)} · Version ${escape(document.version)}`,
      crumbs: [
        { name: "Legal", path: legalHref() },
        { name: document.title, path: legalHref(document.slug) },
      ],
    },
    body: `<article>
${renderLegalBody(document.body)}
</article>`,
  });
}

export function renderLegalMarkdown(document: LegalDocument): string {
  return `# ${document.title}\n\nLast updated: ${document.lastUpdated}\nVersion: ${document.version}\n\n${document.body}\n`;
}

/** Every file under `/legal`, by the path it is served at. */
export function legalFiles(
  documents: readonly LegalDocument[],
): Map<string, string> {
  const files = new Map<string, string>([
    ["/legal", renderLegalIndex(documents)],
    ["/legal/legal.css", `${renderHelpCss()}\n${LEGAL_CSS}`],
  ]);
  for (const document of documents) {
    files.set(
      legalHref(document.slug),
      renderLegalDocument(document, documents),
    );
    files.set(`${legalHref(document.slug)}.md`, renderLegalMarkdown(document));
  }
  return files;
}

const LEGAL_CSS = `
.legal-nav-help { display: block; margin-top: var(--brand-space-6); }
.legal-callout {
  margin: 0 0 var(--brand-space-6);
  padding: var(--brand-space-3) var(--brand-space-4);
  border: 1px solid var(--bs-status-warn-border);
  border-radius: var(--brand-radius-md);
  background: var(--bs-status-warn-bg);
  color: var(--bs-status-warn-fg);
  font-weight: var(--brand-weight-medium);
}
.legal-main h2,
.legal-main h3 { scroll-margin-top: calc(var(--brand-nav-height) + var(--brand-space-4)); }
.legal-main article > h2:first-child { margin-top: 0; }
.legal-main h3 {
  margin: var(--brand-space-6) 0 var(--brand-space-1-5);
  font-size: var(--brand-text-body);
  font-weight: var(--brand-weight-semibold);
  color: var(--bs-text-primary);
}
.legal-main article ul { margin: 0 0 var(--brand-space-4); padding-left: 1.4em; }
.legal-main strong { color: var(--bs-text-primary); font-weight: var(--brand-weight-semibold); }
.legal-main a { color: var(--bs-coral-text); }
.legal-main blockquote {
  margin: 0 0 var(--brand-space-4);
  padding: var(--brand-space-2-5) var(--brand-space-4);
  border-left: 3px solid var(--bs-rule-warm);
  border-radius: 0 var(--brand-radius-md) var(--brand-radius-md) 0;
  background: var(--bs-surface-2);
}
.legal-main blockquote p { margin: 0; }
.legal-main table {
  display: block;
  width: 100%;
  overflow-x: auto;
  margin: var(--brand-space-2) 0 var(--brand-space-5);
  border-collapse: collapse;
  font-size: var(--brand-text-sm);
}
.legal-main th, .legal-main td {
  padding: var(--brand-space-2) var(--brand-space-2-5);
  text-align: left;
  vertical-align: top;
  border-bottom: 1px solid var(--bs-rule);
}
.legal-main th { color: var(--bs-text-primary); font-weight: var(--brand-weight-semibold); background: var(--bs-surface-2); }
`;
