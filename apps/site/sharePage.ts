import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { analyticsTag, trackAttributes } from "./analytics";
import { appUrl } from "./appLink";
import { SIGNUP_SOURCE_SCRIPT } from "./signupSource";

/**
 * The share page (`content/pages/share.md`) and the one-pager it passes on,
 * for someone telling a colleague about Bindersnap. Linked from the footer
 * only.
 *
 * The one-pager is drawn once, in `one-pager/bindersnap-one-pager.html`, and
 * published three ways: as a web page at /flyer (`flyerHtml`), and as the PDF
 * and PNG that `bun apps/site/one-pager/render.ts` writes beside it. After
 * editing the HTML, run that and commit the two files.
 */

export const FLYER_PATH = "/flyer";
export const ONE_PAGER_PDF = "/bindersnap-one-pager.pdf";
export const ONE_PAGER_PREVIEW = "/bindersnap-one-pager.png";

const SITE = "https://bindersnap.com";
const FLYER_URL = `${SITE}${FLYER_PATH}`;

/**
 * The email both email links fill in, in the sender's voice, not ours. The
 * share page prints the same words for anyone who would rather write their
 * own; `sharePage.test.ts` holds the two equal. It ends with the flyer's link.
 */
export const SHARE_EMAIL = {
  subject: "Thought of you: Bindersnap",
  body: [
    "Hi,",
    "Do you still get asked which version of a policy was approved, and have to dig through email to answer? I came across something built for exactly that.",
    "Bindersnap keeps every policy with its current approved version and a record of who signed off on it, and when. Approvals happen on the policy itself, so when a surveyor asks, the answer is on the page.",
    "It's made for small providers: $39 a month for each person who writes policies, and reviewers and staff who only read are free. There's a 14-day free trial, no card needed.",
    `Here's a one-page overview: ${FLYER_URL}`,
  ],
} as const;

/**
 * A `mailto:` can carry only plain text (RFC 6068), so the email it opens
 * links to the flyer rather than showing it.
 */
export function shareMailto(): string {
  return `mailto:?subject=${encodeURIComponent(
    SHARE_EMAIL.subject,
  )}&body=${encodeURIComponent(SHARE_EMAIL.body.join("\n\n"))}`;
}

/** The preview and the ways to send it, under the share page's lede. */
export function shareHtml(): string {
  return `<div class="site-share">
<a class="site-share-preview" href="${FLYER_PATH}"${trackAttributes("share_click", { method: "preview" })}><img src="${ONE_PAGER_PREVIEW}" width="408" height="528" alt="The Bindersnap one-pager: the surveyor headline, a policy's approval record, how it works, who it is for and the price." loading="lazy"></a>
<div class="site-share-actions">
<a class="site-share-button site-share-primary" href="${shareMailto()}"${trackAttributes("share_click", { method: "email" })}>Email the flyer</a>
<a class="site-share-button" href="${FLYER_PATH}"${trackAttributes("share_click", { method: "flyer" })}>Open the flyer</a>
<a class="site-share-button" href="${ONE_PAGER_PDF}" download${trackAttributes("share_click", { method: "pdf" })}>Download the PDF</a>
<p>Or send the link yourself, in a text, a chat or your own email: <a href="${FLYER_PATH}">bindersnap.com${FLYER_PATH}</a>. Nothing about who you send it to comes to us.</p>
</div>
</div>`;
}

const FLYER_DESCRIPTION =
  "Bindersnap in one page: every policy with its current approved version and the record of who signed off on it, for small healthcare providers.";

/**
 * The one-pager as a page of the site, at /flyer: the same HTML the PDF is
 * printed from, with the token stylesheet inlined and the fonts pointed at
 * the site's own copies. A bar above the sheet, on screen only, offers the
 * PDF, the same email as the share page, and the trial; printing the page prints the sheet alone.
 */
export function flyerHtml(
  measurementId = process.env.BINDERSNAP_GA_MEASUREMENT_ID,
): string {
  const dir = join(import.meta.dir, "one-pager");
  const tokens = readFileSync(
    join(import.meta.dir, "../../packages/ui-tokens/css/bindersnap-tokens.css"),
    "utf8",
  );
  const source = readFileSync(join(dir, "bindersnap-one-pager.html"), "utf8");
  const tokenLink =
    /<link\s+rel="stylesheet"\s+href="(?:\.\.\/)+packages\/ui-tokens\/css\/bindersnap-tokens\.css"\s*\/?>/;
  if (!tokenLink.test(source)) {
    throw new Error(
      "apps/site/one-pager/bindersnap-one-pager.html no longer links the token stylesheet the way flyerHtml expects",
    );
  }
  const head = `<meta name="viewport" content="width=880">
<meta name="description" content="${FLYER_DESCRIPTION}">
<link rel="canonical" href="${FLYER_URL}">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Bindersnap">
<meta property="og:url" content="${FLYER_URL}">
<meta property="og:title" content="Bindersnap, in one page">
<meta property="og:description" content="${FLYER_DESCRIPTION}">
<meta property="og:image" content="${SITE}${ONE_PAGER_PREVIEW}">
<meta name="twitter:card" content="summary_large_image">
<style>${tokens}</style>
<style>${FLYER_CSS}</style>
<script>${SIGNUP_SOURCE_SCRIPT}</script>
${analyticsTag(measurementId, FLYER_PATH)}`;
  const bar = `<nav class="flyer-bar" aria-label="Flyer">
<a class="flyer-link" href="${ONE_PAGER_PDF}" download${trackAttributes("share_click", { method: "flyer_pdf" })}>Download the PDF</a>
<a class="flyer-link" href="${shareMailto()}"${trackAttributes("share_click", { method: "flyer_email" })}>Email it to someone</a>
<a class="flyer-cta" href="${appUrl("/-/signup")}"${trackAttributes("cta_click", { cta: "flyer" })}>Start free trial</a>
</nav>`;
  return source
    .replace(tokenLink, () => head)
    .replace(/url\((?:\.\.\/)+apps\/app\/public\/fonts\//g, "url(/fonts/")
    .replace(/<body>/, () => `<body>\n${bar}`);
}

/** The bar above the flyer: on screen only, in the site's own tokens. */
const FLYER_CSS = `
.flyer-bar {
  position: sticky;
  top: 0;
  z-index: 1;
  width: 8.5in;
  margin: 0 auto var(--brand-space-4);
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: var(--brand-space-2);
  padding: var(--brand-space-3) 0;
  font-family: var(--brand-font-sans);
  font-size: var(--brand-text-sm);
  background: var(--bs-surface-3);
}
.flyer-link,
.flyer-cta {
  padding: var(--brand-space-2) var(--brand-space-4);
  border-radius: var(--brand-radius-md);
  font-weight: var(--brand-weight-semibold);
  text-decoration: none;
}
.flyer-link {
  color: var(--bs-text-primary);
  background: var(--bs-surface-1);
  border: 1px solid var(--bs-rule);
}
.flyer-cta {
  color: var(--brand-on-coral);
  background: var(--brand-coral);
}
.flyer-cta:hover {
  color: var(--brand-on-brand);
  background: var(--brand-coral-dark);
}
@media screen {
  body {
    padding-top: 0;
  }
}
@media print {
  .flyer-bar {
    display: none;
  }
}
`;

/** The one-pager's files, served at the site's root. */
export async function onePagerFiles(): Promise<Map<string, Uint8Array>> {
  const dir = join(import.meta.dir, "one-pager");
  return new Map(
    await Promise.all(
      [ONE_PAGER_PDF, ONE_PAGER_PREVIEW].map(
        async (path) =>
          [path, new Uint8Array(await readFile(join(dir, path.slice(1))))] as [
            string,
            Uint8Array,
          ],
      ),
    ),
  );
}
