import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The public site's pages: pricing, policy templates, regulatory requirements,
 * pages for each kind of provider, comparisons and the glossary.
 *
 * Every page is a Markdown file in `content/{collection}/{slug}.md`, so the
 * person who checks a template's clinical or regulatory claims reads and
 * redlines it as text, and a change to it is a reviewable diff. Each file
 * opens with a front-matter block of `key: value` lines between `---` fences.
 *
 * Built into `dist` for GitHub Pages by `scripts/build-site.ts`, and served
 * from the same functions by `server.ts` in development, like `/help` and
 * `/legal`.
 */

export interface SiteCollection {
  /** Directory under `content/`, and the first segment of every page's address. */
  key: string;
  /**
   * Where the pages are served. `""` puts them at the root (`/pricing`); the
   * root collection has no index page.
   */
  prefix: string;
  /** The index page's heading and the breadcrumb's middle link. */
  label: string;
  /** The index page's lede, and its meta description. */
  intro: string;
  /** Fewest words a page in this collection may have. Thin pages rank for nothing. */
  minWords: number;
  /** Shown above every page's body: what a reader must know before using it. */
  notice?: string;
}

/**
 * Above every page that explains the rules: what we write is information, and
 * the reader's own advisers decide what applies to them.
 */
export const GUIDANCE_NOTICE =
  "General information about the federal rules, not legal advice. Your state, your accreditor and your own services may require more, so check the cited rules, and ask your own advisers, before you rely on it.";

/** In the order llms.txt and the sitemap list them. */
export const SITE_COLLECTIONS: readonly SiteCollection[] = [
  {
    key: "pages",
    prefix: "",
    label: "Bindersnap",
    intro: "",
    minWords: 250,
  },
  {
    key: "for",
    prefix: "for",
    label: "Who it's for",
    intro:
      "What surveyors and accreditors expect from your policy manual, by kind of provider, and how Bindersnap keeps the approval record for each policy.",
    minWords: 500,
    notice: GUIDANCE_NOTICE,
  },
  {
    key: "templates",
    prefix: "templates",
    label: "Policy templates",
    intro:
      "Free policy and procedure templates for small healthcare providers, written from the federal rules they answer to, with the citations to check them against.",
    minWords: 800,
    notice:
      "A starting point, not legal or clinical advice. Each template follows the federal rules cited on the page. Your state, your accreditor and your own services may require more, so have the people responsible for this policy review it before you adopt it.",
  },
  {
    key: "requirements",
    prefix: "requirements",
    label: "Requirements, answered",
    intro:
      "Plain answers, with citations, to the questions people ask about healthcare policy rules: how often to review, who approves, and how long to keep old versions.",
    minWords: 450,
    notice: GUIDANCE_NOTICE,
  },
  {
    key: "tools",
    prefix: "tools",
    label: "Free tools",
    intro:
      "Free tools for the person who keeps the policy manual, built on the federal rules and the citations behind them.",
    minWords: 250,
    notice: GUIDANCE_NOTICE,
  },
  {
    key: "compare",
    prefix: "compare",
    label: "Compare",
    intro:
      "How Bindersnap compares with other ways to manage healthcare policies, from enterprise policy software to a shared drive, including where the others do more.",
    minWords: 500,
  },
  {
    key: "glossary",
    prefix: "glossary",
    label: "Glossary",
    intro:
      "Plain definitions of the survey, accreditation and policy management terms small healthcare providers meet, with the rule each comes from.",
    minWords: 200,
    notice: GUIDANCE_NOTICE,
  },
];

export interface SitePage {
  collection: SiteCollection;
  slug: string;
  /** Served at this address, without an extension. */
  path: string;
  /** The page's heading. The `<title>` adds " | Bindersnap" unless it already names it. */
  title: string;
  /** The meta description and the index card's summary: 50–160 characters. */
  description: string;
  /** ISO date (YYYY-MM-DD) the words last changed. */
  updated: string;
  /** Addresses of other pages to recommend at the foot of this one. */
  related: string[];
  /**
   * The kinds of provider this page is for: slugs of pages in `for/`. A
   * provider's page lists every page that names it.
   */
  facilities: string[];
  /**
   * Any other front-matter keys: `crumb` (a short name for the breadcrumb when
   * the title is long), and whatever a collection's own renderer reads.
   */
  meta: Record<string, string>;
  /** The Markdown after the front matter. */
  body: string;
  /**
   * A page built from data rather than a Markdown file (a free tool) adds its
   * own HTML above the body, and the same content as Markdown for its `.md`
   * copy and the llms files.
   */
  tool?: { html: string; markdown: string };
}

const CONTENT_DIR = join(import.meta.dir, "content");

const REQUIRED = ["title", "description", "updated"] as const;

/** Split a page's front matter from its body. Throws on a malformed file. */
export function parseSitePage(
  collection: SiteCollection,
  slug: string,
  source: string,
): SitePage {
  const where = `apps/site/content/${collection.key}/${slug}.md`;
  const text = source.replace(/\r\n?/g, "\n");
  const match = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match)
    throw new Error(`${where} must open with a --- front-matter block`);

  const meta: Record<string, string> = {};
  for (const line of match[1]!.split("\n")) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const field = line.match(/^([a-zA-Z][\w-]*):\s*(.*)$/);
    if (!field)
      throw new Error(`${where}: cannot read front-matter line "${line}"`);
    meta[field[1]!] = field[2]!.trim().replace(/^"(.*)"$/, "$1");
  }
  for (const key of REQUIRED) {
    if (!meta[key])
      throw new Error(`${where} needs "${key}:" in its front matter`);
  }

  const { title, description, updated, related, facilities, ...rest } = meta;
  const list = (value: string | undefined) =>
    (value ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  return {
    collection,
    slug,
    path: siteHref(collection, slug),
    title: title!,
    description: description!,
    updated: updated!,
    related: list(related),
    facilities: list(facilities),
    meta: rest,
    body: match[2]!.trim(),
  };
}

export function siteHref(collection: SiteCollection, slug?: string): string {
  if (!slug) return `/${collection.prefix}`;
  return collection.prefix ? `/${collection.prefix}/${slug}` : `/${slug}`;
}

/** Every page, collection by collection, each collection sorted by title. */
export function readSitePages(
  collections: readonly SiteCollection[] = SITE_COLLECTIONS,
  contentDir: string = CONTENT_DIR,
): SitePage[] {
  return collections.flatMap((collection) => {
    let names: string[];
    try {
      names = readdirSync(join(contentDir, collection.key));
    } catch {
      return [];
    }
    return names
      .filter((name) => name.endsWith(".md"))
      .map((name) =>
        parseSitePage(
          collection,
          name.slice(0, -3),
          readFileSync(join(contentDir, collection.key, name), "utf8"),
        ),
      )
      .sort((a, b) => a.title.localeCompare(b.title));
  });
}
