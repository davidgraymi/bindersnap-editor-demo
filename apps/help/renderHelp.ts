import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { HelpGuide } from "../app/helpGuides";
import {
  chromeCss,
  linkCard,
  pageHero,
  siteFooter,
  siteHeader,
} from "../site/chrome";

/**
 * The help guides as ordinary web pages: `/help`, `/help/{slug}`.
 *
 * **Plain HTML, with nothing to run.** Help is for somebody deciding whether to
 * sign up as much as for somebody signed in, and it is read by search engines
 * and AI agents that fetch a page and never run its scripts. So every page is
 * complete as served: its words, a list of every guide, and links onward. The
 * app opens it in a new tab rather than inside the binder, so reading about a
 * step never loses the place where you were doing it.
 *
 * The same words also come as Markdown (`/help/{slug}.md`), listed in
 * `/help/llms.txt`, for an agent that would rather not parse HTML.
 *
 * Built into `dist/help` for GitHub Pages by `scripts/build-help.ts`, and
 * served from the same function by `server.ts` in development.
 */

const TOKENS_CSS = join(
  import.meta.dir,
  "../../packages/ui-tokens/css/bindersnap-tokens.css",
);

const escape = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export function helpHref(slug?: string): string {
  return slug ? `/help/${slug}` : "/help";
}

/**
 * Link previews need absolute URLs. The icons and the share card are the
 * site's own, from `apps/app/public`, which the build copies to the root.
 */
const SITE = "https://bindersnap.com";

const FONTS = "/fonts/fonts.css";

/**
 * The theme the app would show: the choice made in the app on this browser,
 * else the system's. The page reads correctly without it.
 */
const THEME_SCRIPT = `(function(){try{var s=localStorage.getItem("bs-theme");var d=window.matchMedia("(prefers-color-scheme: dark)").matches;document.documentElement.setAttribute("data-theme",s||(d?"dark":"light"));}catch(e){}})();`;

function page(params: {
  title: string;
  description: string;
  path: string;
  markdown?: string;
  guides: readonly HelpGuide[];
  current?: string;
  hero: Parameters<typeof pageHero>[0];
  body: string;
}): string {
  const nav = params.guides
    .map((guide) => {
      const here = guide.slug === params.current;
      return `<li><a href="${helpHref(guide.slug)}"${
        here ? ' aria-current="page"' : ""
      }>${escape(guide.title)}</a></li>`;
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
}<link rel="alternate" type="text/plain" href="/help/llms.txt" title="Every guide, for AI agents">
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
<link rel="stylesheet" href="/help/help.css">
<script>${THEME_SCRIPT}</script>
</head>
<body>
<a class="help-skip" href="#content">Skip to the guide</a>
${siteHeader(params.path)}
${pageHero(params.hero)}
<div class="help-layout">
  <nav class="help-nav" aria-label="Guides">
    <a class="help-nav-home" href="/help"${
      params.current ? "" : ' aria-current="page"'
    }>All guides</a>
    <ul>${nav}</ul>
  </nav>
  <main id="content" class="help-main">
${params.body}
  </main>
</div>
${siteFooter()}
</body>
</html>
`;
}

function sectionHtml(section: HelpGuide["sections"][number]): string {
  const steps = section.steps
    ? `<ol>${section.steps.map((step) => `<li>${escape(step)}</li>`).join("")}</ol>`
    : "";
  const paragraphs = (section.paragraphs ?? [])
    .map((paragraph) => `<p>${escape(paragraph)}</p>`)
    .join("");
  return `<section><h2>${escape(section.heading)}</h2>${steps}${paragraphs}</section>`;
}

export function renderHelpIndex(guides: readonly HelpGuide[]): string {
  const cards = guides
    .map((guide) =>
      linkCard({
        path: helpHref(guide.slug),
        title: guide.title,
        description: guide.summary,
      }),
    )
    .join("");
  return page({
    title: "Help and guides — Bindersnap",
    description:
      "Short answers to the questions everybody asks in their first week with Bindersnap.",
    path: "/help",
    guides,
    hero: {
      eyebrow: "Help",
      title: "Help and guides",
      lede: "Short answers to the questions everybody asks in their first week.",
    },
    body: `<ul class="site-cards help-index">${cards}</ul>`,
  });
}

export function renderHelpGuide(
  guide: HelpGuide,
  guides: readonly HelpGuide[],
): string {
  const index = guides.findIndex((entry) => entry.slug === guide.slug);
  const previous = index > 0 ? guides[index - 1] : undefined;
  const next = index >= 0 ? guides[index + 1] : undefined;
  const pager = [
    previous
      ? `<a class="help-pager-prev" href="${helpHref(previous.slug)}" rel="prev"><span>Previous</span>${escape(previous.title)}</a>`
      : "",
    next
      ? `<a class="help-pager-next" href="${helpHref(next.slug)}" rel="next"><span>Next</span>${escape(next.title)}</a>`
      : "",
  ].join("");

  return page({
    title: `${guide.title} — Bindersnap Help`,
    description: guide.summary,
    path: helpHref(guide.slug),
    markdown: `${helpHref(guide.slug)}.md`,
    guides,
    current: guide.slug,
    hero: {
      eyebrow: "Help",
      title: guide.title,
      lede: escape(guide.summary),
      crumbs: [
        { name: "Help", path: helpHref() },
        { name: guide.title, path: helpHref(guide.slug) },
      ],
    },
    body: `<article>
${guide.sections.map(sectionHtml).join("\n")}
</article>
<nav class="help-pager" aria-label="More guides">${pager}</nav>`,
  });
}

export function renderGuideMarkdown(guide: HelpGuide): string {
  const lines = [`# ${guide.title}`, "", guide.summary, ""];
  for (const section of guide.sections) {
    lines.push(`## ${section.heading}`, "");
    (section.steps ?? []).forEach((step, index) =>
      lines.push(`${index + 1}. ${step}`),
    );
    if (section.steps) lines.push("");
    for (const paragraph of section.paragraphs ?? []) {
      lines.push(paragraph, "");
    }
  }
  return lines.join("\n");
}

/** The index an agent reads first: https://llmstxt.org. */
export function renderLlmsTxt(guides: readonly HelpGuide[]): string {
  return [
    "# Bindersnap Help",
    "",
    "> Bindersnap keeps an organization's policies and procedures in binders: every document with its current published version, and the record of who approved it and when. These guides explain how to use it.",
    "",
    "Each guide is also a web page at the same address without `.md`.",
    "",
    "## Guides",
    "",
    ...guides.map(
      (guide) =>
        `- [${guide.title}](${helpHref(guide.slug)}.md): ${guide.summary}`,
    ),
    "",
  ].join("\n");
}

export function renderHelpCss(): string {
  return `${readFileSync(TOKENS_CSS, "utf8")}\n${chromeCss()}\n${HELP_CSS}`;
}

/** Every file under `/help`, by the path it is served at. */
export function helpFiles(guides: readonly HelpGuide[]): Map<string, string> {
  const files = new Map<string, string>([
    ["/help", renderHelpIndex(guides)],
    ["/help/llms.txt", renderLlmsTxt(guides)],
    ["/help/help.css", renderHelpCss()],
  ]);
  for (const guide of guides) {
    files.set(helpHref(guide.slug), renderHelpGuide(guide, guides));
    files.set(`${helpHref(guide.slug)}.md`, renderGuideMarkdown(guide));
  }
  return files;
}

export function helpContentType(path: string): string {
  if (path.endsWith(".css")) return "text/css; charset=utf-8";
  if (path.endsWith(".md")) return "text/markdown; charset=utf-8";
  if (path.endsWith(".txt")) return "text/plain; charset=utf-8";
  return "text/html; charset=utf-8";
}

const HELP_CSS = `
*, *::before, *::after { box-sizing: border-box; }
html { background: var(--bs-page-bg); }
body {
  margin: 0;
  background: var(--bs-page-bg);
  color: var(--bs-text-secondary);
  font-family: var(--brand-font-sans);
  font-size: var(--brand-text-body);
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}
a { color: inherit; }
.help-skip {
  position: absolute;
  left: -9999px;
}
.help-skip:focus {
  left: var(--brand-space-4);
  top: var(--brand-space-3);
  z-index: calc(var(--brand-z-nav) + 1);
  padding: var(--brand-space-2) var(--brand-space-3);
  border-radius: var(--brand-radius-md);
  background: var(--bs-surface-1);
}
/* content-box: the 1200px is the hero's, so the sidebar lines up under it. */
.help-layout {
  box-sizing: content-box;
  display: grid;
  grid-template-columns: 220px minmax(0, var(--brand-max-width-text));
  gap: var(--brand-space-16);
  max-width: var(--brand-max-width);
  margin: 0 auto;
  padding: var(--brand-space-12) var(--brand-page-padding-x) var(--brand-space-20);
}
.help-nav {
  position: sticky;
  top: calc(var(--brand-nav-height) + var(--brand-space-8));
  align-self: start;
  font-size: var(--brand-text-sm);
}
.help-nav ul {
  list-style: none;
  margin: var(--brand-space-3) 0 0;
  padding: 0;
  border-left: 1px solid var(--bs-rule);
}
.help-nav li { margin: 0; }
.help-nav ul a {
  display: block;
  margin-left: -1px;
  padding: var(--brand-space-1-5) var(--brand-space-4);
  border-left: 2px solid transparent;
  line-height: var(--brand-leading-normal);
  text-decoration: none;
  color: var(--bs-text-secondary);
}
.help-nav ul a:hover { color: var(--bs-text-primary); }
.help-nav ul a[aria-current="page"] {
  border-left-color: var(--brand-coral);
  color: var(--bs-text-primary);
  font-weight: var(--brand-weight-semibold);
}
.help-nav-home {
  font-family: var(--brand-font-mono);
  font-size: var(--brand-text-label);
  letter-spacing: var(--brand-tracking-wide);
  text-transform: uppercase;
  text-decoration: none;
  color: var(--bs-text-muted);
}
.help-nav-home:hover,
.help-nav-home[aria-current="page"] { color: var(--bs-text-primary); }
.help-main { min-width: 0; }
.help-main h2 {
  margin: var(--brand-space-12) 0 var(--brand-space-3);
  font-family: var(--brand-font-serif);
  font-size: 1.625rem;
  font-weight: var(--brand-weight-semibold);
  line-height: var(--brand-leading-snug);
  letter-spacing: var(--brand-tracking-snug);
  color: var(--bs-text-primary);
}
.help-main article > :first-child h2,
.help-main article > h2:first-child { margin-top: 0; }
.help-main p { margin: 0 0 var(--brand-space-4); }
.help-main ol { margin: 0 0 var(--brand-space-4); padding-left: 1.4em; }
.help-main article li { margin: var(--brand-space-1-5) 0; }
.help-index { margin: 0; }
.help-pager {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--brand-space-4);
  margin-top: var(--brand-space-16);
}
.help-pager a {
  display: flex;
  flex-direction: column;
  gap: var(--brand-space-1);
  padding: var(--brand-space-4) var(--brand-space-5);
  border: 1px solid var(--bs-rule);
  border-radius: var(--brand-radius-lg);
  background: var(--bs-surface-1);
  text-decoration: none;
  font-family: var(--brand-font-serif);
  font-weight: var(--brand-weight-semibold);
  color: var(--bs-text-primary);
  transition: border-color var(--brand-transition-base);
}
.help-pager a:hover { border-color: var(--brand-coral); }
.help-pager span {
  font-family: var(--brand-font-mono);
  font-size: var(--brand-text-label);
  font-weight: var(--brand-weight-regular);
  letter-spacing: var(--brand-tracking-wide);
  text-transform: uppercase;
  color: var(--bs-text-muted);
}
.help-pager-next { grid-column: 2; text-align: right; }
a:focus-visible {
  outline: 2px solid var(--brand-coral);
  outline-offset: 2px;
}
@media (max-width: 900px) {
  .help-layout {
    grid-template-columns: 1fr;
    gap: var(--brand-space-10);
    padding: var(--brand-space-8) var(--brand-page-padding-x-sm) var(--brand-space-16);
  }
  .help-nav {
    position: static;
    order: 2;
    padding-top: var(--brand-space-6);
    border-top: 1px solid var(--bs-rule);
  }
}
@media (max-width: 560px) {
  .help-pager { grid-template-columns: 1fr; }
  .help-pager-next { grid-column: auto; }
}
`;
