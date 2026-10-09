import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { HelpGuide } from "../app/helpGuides";
import { chromeCss, siteFooter, siteHeader } from "../site/chrome";

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
    .map(
      (guide) =>
        `<li><a href="${helpHref(guide.slug)}"><span class="help-card-title">${escape(
          guide.title,
        )}</span><span class="help-card-summary">${escape(guide.summary)}</span></a></li>`,
    )
    .join("");
  return page({
    title: "Help and guides — Bindersnap",
    description:
      "Short answers to the questions everybody asks in their first week with Bindersnap.",
    path: "/help",
    guides,
    body: `<h1>Help and guides</h1>
<p class="help-lede">Short answers to the questions everybody asks in their first week.</p>
<ul class="help-cards">${cards}</ul>`,
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
    body: `<article>
<h1>${escape(guide.title)}</h1>
<p class="help-lede">${escape(guide.summary)}</p>
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
  font-family: var(--brand-font-sans, "Geist", system-ui, sans-serif);
  font-size: 16px;
  line-height: 1.6;
}
a { color: inherit; }
.help-skip {
  position: absolute;
  left: -9999px;
}
.help-skip:focus {
  left: 16px;
  top: 12px;
  background: var(--bs-surface-1);
  padding: 8px 12px;
  border-radius: 8px;
  z-index: 10;
}
.help-layout {
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  gap: 48px;
  max-width: 1080px;
  margin: 0 auto;
  padding: 40px 24px 80px;
}
.help-nav { font-size: 14px; }
.help-nav ul { list-style: none; margin: 8px 0 0; padding: 0; }
.help-nav li { margin: 0; }
.help-nav a {
  display: block;
  padding: 6px 10px;
  border-radius: 6px;
  text-decoration: none;
  color: var(--bs-text-secondary);
}
.help-nav a:hover { background: var(--bs-surface-2); }
.help-nav a[aria-current="page"] {
  background: var(--bs-surface-2);
  color: var(--bs-text-primary);
  font-weight: 600;
}
.help-nav-home { font-weight: 500; }
.help-main { max-width: 680px; min-width: 0; }
.help-main h1 {
  font-family: var(--brand-font-serif, "Lora", Georgia, serif);
  font-weight: 600;
  font-size: 32px;
  line-height: 1.2;
  color: var(--bs-text-primary);
  margin: 0 0 8px;
}
.help-main h2 {
  font-family: var(--brand-font-serif, "Lora", Georgia, serif);
  font-weight: 600;
  font-size: 20px;
  line-height: 1.3;
  color: var(--bs-text-primary);
  margin: 36px 0 8px;
}
.help-lede { font-size: 18px; color: var(--bs-text-muted); margin: 0 0 8px; }
.help-main p { margin: 0 0 14px; }
.help-main ol { margin: 0 0 14px; padding-left: 1.4em; }
.help-main li { margin: 6px 0; }
.help-cards {
  list-style: none;
  padding: 0;
  margin: 28px 0 0;
  display: grid;
  gap: 12px;
}
.help-cards a {
  display: block;
  padding: 16px 18px;
  border: 1px solid var(--bs-rule);
  border-radius: 12px;
  background: var(--bs-surface-1);
  text-decoration: none;
}
.help-cards a:hover { border-color: var(--brand-coral); }
.help-card-title {
  display: block;
  color: var(--bs-text-primary);
  font-weight: 600;
}
.help-card-summary { display: block; color: var(--bs-text-muted); font-size: 15px; }
.help-pager {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  margin-top: 56px;
  padding-top: 24px;
  border-top: 1px solid var(--bs-rule);
}
.help-pager a {
  display: flex;
  flex-direction: column;
  text-decoration: none;
  color: var(--bs-text-primary);
  font-weight: 500;
}
.help-pager span { font-size: 13px; color: var(--bs-text-muted); font-weight: 400; }
.help-pager-next { margin-left: auto; text-align: right; }
a:focus-visible {
  outline: 2px solid var(--brand-coral);
  outline-offset: 2px;
}
@media (max-width: 760px) {
  .help-layout { grid-template-columns: 1fr; gap: 24px; padding: 24px 16px 64px; }
  .help-nav { order: 2; border-top: 1px solid var(--bs-rule); padding-top: 16px; }
  .help-main h1 { font-size: 26px; }
}
`;
