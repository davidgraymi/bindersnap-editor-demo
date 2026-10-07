import { markdownToHtml } from "../app/markdown";
import { renderHelpCss } from "../help/renderHelp";
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

const LOGO_MARK = `<svg viewBox="0 0 18 18" fill="none" aria-hidden="true" width="18" height="18"><rect x="2" y="1" width="9" height="13" rx="1.5" stroke="currentColor" stroke-width="1.5"/><rect x="6" y="4" width="9" height="13" rx="1.5" stroke="currentColor" stroke-width="1.5"/></svg>`;

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
<link rel="canonical" href="${params.path}">
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
<header class="help-bar">
  <a class="help-brand" href="/legal">${LOGO_MARK}<span>Bindersnap <span class="help-brand-sub">Legal</span></span></a>
  <a class="help-open" href="/">Open Bindersnap</a>
</header>
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
    .map(
      (document) =>
        `<li><a href="${legalHref(document.slug)}"><span class="help-card-title">${escape(
          document.title,
        )}</span><span class="help-card-summary">${escape(document.summary)}</span></a></li>`,
    )
    .join("");
  return page({
    title: "Legal — Bindersnap",
    description:
      "Bindersnap's Terms of Service, Privacy Policy, Data Processing Addendum, subprocessors and security overview.",
    path: "/legal",
    documents,
    body: `<h1>Legal</h1>
<p class="help-lede">What you agree to when you use Bindersnap, and what we promise back.</p>
<p class="legal-callout">Bindersnap is not for patient health information. Keep your policies and procedures here — never patient records.</p>
<ul class="help-cards">${cards}</ul>`,
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
    body: `<article>
<h1>${escape(document.title)}</h1>
<p class="legal-dates">Last updated ${escape(document.lastUpdated)} · Version ${escape(document.version)}</p>
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
.legal-nav-help { display: block; margin-top: 16px; padding: 6px 10px; }
.legal-dates {
  font-family: var(--brand-font-mono, "Geist Mono", monospace);
  font-size: 13px;
  color: var(--bs-text-muted);
  margin: 0 0 28px;
}
.legal-callout {
  margin: 20px 0 0;
  padding: 12px 16px;
  border: 1px solid var(--bs-status-warn-border);
  border-radius: 10px;
  background: var(--bs-status-warn-bg);
  color: var(--bs-status-warn-fg);
  font-weight: 500;
}
.legal-main h2 { scroll-margin-top: 16px; }
.legal-main h3 {
  font-size: 16px;
  font-weight: 600;
  color: var(--bs-text-primary);
  margin: 24px 0 6px;
  scroll-margin-top: 16px;
}
.legal-main ul { margin: 0 0 14px; padding-left: 1.4em; }
.legal-main strong { color: var(--bs-text-primary); font-weight: 600; }
.legal-main a { color: var(--bs-coral-text); }
.legal-main blockquote {
  margin: 0 0 14px;
  padding: 10px 16px;
  border-left: 3px solid var(--bs-rule-warm);
  background: var(--bs-surface-2);
  border-radius: 0 8px 8px 0;
}
.legal-main blockquote p { margin: 0; }
.legal-main table {
  width: 100%;
  border-collapse: collapse;
  margin: 8px 0 20px;
  font-size: 14px;
  display: block;
  overflow-x: auto;
}
.legal-main th, .legal-main td {
  text-align: left;
  vertical-align: top;
  padding: 8px 10px;
  border-bottom: 1px solid var(--bs-rule);
}
.legal-main th { color: var(--bs-text-primary); font-weight: 600; background: var(--bs-surface-2); }
`;
