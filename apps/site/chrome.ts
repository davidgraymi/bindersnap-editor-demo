import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The bar and the footer every public page wears: the landing page, the
 * marketing pages, help and legal. One set, so a reader who follows a link
 * from the landing page to a template, a guide or the terms stays on the same
 * site — the same mark, the same links in the same places, the same way to
 * sign up.
 *
 * The landing page is a static `index.html`, so it carries a copy of this
 * markup; `landing.test.ts` holds its links to these lists, and both load
 * `chrome.css`.
 */

export const LOGO_MARK = `<svg viewBox="0 0 18 18" fill="none" aria-hidden="true" width="18" height="18"><rect x="2" y="1" width="9" height="13" rx="1.5" stroke="currentColor" stroke-width="1.5"/><rect x="6" y="4" width="9" height="13" rx="1.5" stroke="currentColor" stroke-width="1.5"/></svg>`;

export interface ChromeLink {
  href: string;
  label: string;
}

/** The bar's links. Everything else is one scroll away, in the footer. */
export const HEADER_LINKS: readonly ChromeLink[] = [
  { href: "/for", label: "Who it's for" },
  { href: "/templates", label: "Templates" },
  { href: "/pricing", label: "Pricing" },
  { href: "/help", label: "Help" },
];

export const SIGN_IN: ChromeLink = { href: "/-/login", label: "Sign in" };
export const SIGN_UP: ChromeLink = { href: "/-/signup", label: "Sign up" };

export const FOOTER_COLUMNS: readonly {
  heading: string;
  links: readonly ChromeLink[];
}[] = [
  {
    heading: "Product",
    links: [
      { href: "/pricing", label: "Pricing" },
      { href: "/for", label: "Who it's for" },
      { href: "/help", label: "Help and guides" },
      SIGN_IN,
      { href: "/-/signup", label: "Create an account" },
    ],
  },
  {
    heading: "Resources",
    links: [
      { href: "/templates", label: "Policy templates" },
      { href: "/requirements", label: "Requirements, answered" },
      {
        href: "/tools/required-policies-checklist",
        label: "Required policies checklist",
      },
      { href: "/compare", label: "Compare" },
      { href: "/glossary", label: "Glossary" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { href: "/legal/terms", label: "Terms" },
      { href: "/legal/privacy", label: "Privacy" },
      { href: "/legal/security", label: "Security" },
      { href: "/legal/subprocessors", label: "Subprocessors" },
      { href: "/legal/dpa", label: "DPA" },
    ],
  },
];

const escape = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const current = (href: string, path: string) =>
  path === href || path.startsWith(`${href}/`) ? ' aria-current="page"' : "";

/** The bar, with the section `path` is in marked as the current one. */
export function siteHeader(path: string): string {
  const links = HEADER_LINKS.map(
    (link) =>
      `<a class="site-header-link site-header-secondary" href="${link.href}"${current(
        link.href,
        path,
      )}>${escape(link.label)}</a>`,
  ).join("");
  return `<header class="site-header">
  <div class="site-header-inner">
    <a class="site-logo" href="/"><span class="site-logo-mark">${LOGO_MARK}</span><span class="site-logo-name">Bindersnap</span></a>
    <nav class="site-header-nav" aria-label="Site">${links}<a class="site-header-link" href="${SIGN_IN.href}">${SIGN_IN.label}</a><a class="site-header-cta" href="${SIGN_UP.href}">${SIGN_UP.label}</a></nav>
  </div>
</header>`;
}

export function siteFooter(): string {
  const columns = FOOTER_COLUMNS.map(
    (column) =>
      `<div><h2>${escape(column.heading)}</h2><ul>${column.links
        .map(
          (link) => `<li><a href="${link.href}">${escape(link.label)}</a></li>`,
        )
        .join("")}</ul></div>`,
  ).join("");
  return `<footer class="site-footer">
  <div class="site-footer-inner">
    <div class="site-footer-brand">
      <a class="site-logo" href="/"><span class="site-logo-mark">${LOGO_MARK}</span><span class="site-logo-name">Bindersnap</span></a>
      <p>Policy software is <strong>priced for health systems with a compliance department.</strong> You do not have one. That is exactly who we built this for.</p>
    </div>
    <nav class="site-footer-columns" aria-label="Footer">${columns}</nav>
  </div>
  <div class="site-footer-bottom">
    <span>© 2026 Solid Gray LLC</span>
    <span>For policies and procedures — never patient records</span>
  </div>
</footer>`;
}

export interface Crumb {
  name: string;
  path: string;
}

/**
 * The band under the bar that opens every marketing, help and legal page:
 * the trail back, a coral eyebrow naming the section, the Lora headline, a
 * lede, and a line of small print (a date, a version).
 */
export function pageHero(params: {
  eyebrow: string;
  title: string;
  /** HTML: an opening paragraph may carry its own emphasis. */
  lede?: string;
  /** HTML, set small in mono under the lede. */
  meta?: string;
  crumbs?: readonly Crumb[];
}): string {
  const crumbs =
    params.crumbs && params.crumbs.length > 1
      ? `<nav class="site-crumbs" aria-label="Breadcrumb"><ol>${params.crumbs
          .map((crumb, index) =>
            index === params.crumbs!.length - 1
              ? `<li aria-current="page">${escape(crumb.name)}</li>`
              : `<li><a href="${crumb.path}">${escape(crumb.name)}</a></li>`,
          )
          .join("")}</ol></nav>\n`
      : "";
  return `<div class="site-hero"><div class="site-hero-inner">
${crumbs}<p class="bs-eyebrow site-eyebrow">${escape(params.eyebrow)}</p>
<h1>${escape(params.title)}</h1>
${params.lede ? `<p class="site-lede">${params.lede}</p>\n` : ""}${
    params.meta ? `<p class="site-updated">${params.meta}</p>\n` : ""
  }</div></div>`;
}

/** A page as a link card: its title, what it answers, and a way in. */
export function linkCard(entry: {
  path: string;
  title: string;
  description: string;
}): string {
  return `<li><a href="${entry.path}"><span class="site-card-title">${escape(
    entry.title,
  )}</span><span class="site-card-summary">${escape(entry.description)}</span><span class="site-card-more" aria-hidden="true">Read →</span></a></li>`;
}

const CHROME_CSS = join(import.meta.dir, "chrome.css");

export function chromeCss(): string {
  return readFileSync(CHROME_CSS, "utf8");
}
