/**
 * What every page on bindersnap.com tells search engines and AI assistants
 * about itself, in one place: the marketing pages (`renderSite.ts`), help and
 * legal each build their `<head>` from these, and the landing page's
 * `index.html` carries a copy of the organization and website nodes that
 * `renderSite.test.ts` holds equal to these.
 */

export const SITE = "https://bindersnap.com";

/**
 * Who publishes every page. The founder, by name and with the address the
 * landing page already gives, is the person an answer engine can attribute
 * the site to before there are customers to quote.
 */
export const ORGANIZATION_LD = {
  "@type": "Organization",
  "@id": `${SITE}/#organization`,
  name: "Bindersnap",
  legalName: "Solid Gray LLC",
  url: `${SITE}/`,
  logo: `${SITE}/icon-512.png`,
  description:
    "Policy and procedure management software for small healthcare providers: every policy with its current approved version, every earlier version, and the record of who approved each.",
  email: "david@bindersnap.com",
  founder: {
    "@type": "Person",
    name: "David Gray",
    jobTitle: "Founder",
  },
};

export const WEBSITE_LD = {
  "@type": "WebSite",
  "@id": `${SITE}/#website`,
  name: "Bindersnap",
  url: `${SITE}/`,
  inLanguage: "en-US",
  publisher: { "@id": ORGANIZATION_LD["@id"] },
};

/**
 * Every indexable page lets a search engine quote as much of it as it likes
 * and show its share card large: the default caps how much an AI overview or
 * a snippet may lift from the page.
 */
export const ROBOTS_META =
  '<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1">';

/** For a page that should never be a search result, like the 404. */
export const NOINDEX_META = '<meta name="robots" content="noindex, follow">';

/** The share card every page uses, as schema.org wants an article's image. */
export const SHARE_IMAGE_LD = {
  "@type": "ImageObject",
  url: `${SITE}/og-image.png`,
  width: 1200,
  height: 630,
};

export interface LdCrumb {
  name: string;
  path: string;
}

export function breadcrumbLd(crumbs: readonly LdCrumb[]) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: `${SITE}${crumb.path}`,
    })),
  };
}

/**
 * The page's graph as a JSON-LD script, opening with the organization and the
 * website. A `</script>` in a title must not end it.
 */
export function jsonLdScript(nodes: readonly object[]): string {
  const graph = [ORGANIZATION_LD, WEBSITE_LD, ...nodes];
  return `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@graph": graph,
  }).replace(/</g, "\\u003c")}</script>`;
}
