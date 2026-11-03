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
 * The email, in the sender's voice, not ours. The share page prints the same
 * words for anyone who cannot use the buttons; `sharePage.test.ts` holds the
 * two equal. The last line is where the one-pager goes: a link in plain text,
 * the picture of it in the copied email.
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

const escapeHtml = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * A `mailto:` can carry only plain text (RFC 6068), so the email it opens
 * links to the flyer rather than showing it.
 */
export function shareMailto(): string {
  return `mailto:?subject=${encodeURIComponent(
    SHARE_EMAIL.subject,
  )}&body=${encodeURIComponent(SHARE_EMAIL.body.join("\n\n"))}`;
}

/**
 * The email as HTML, for the clipboard: the words, then the one-pager itself
 * as a picture linking to the flyer. Pasted into Gmail, Outlook or Apple Mail
 * it arrives as written. Email programs ignore stylesheets and most layout,
 * so this is paragraphs and an image with absolute addresses, nothing more.
 */
export function shareEmailHtml(): string {
  const words = SHARE_EMAIL.body.slice(0, -1);
  return `${words.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}<p>Here's a one-page overview (<a href="${FLYER_URL}">open it in your browser</a>):</p><p><a href="${FLYER_URL}"><img src="${SITE}${ONE_PAGER_PREVIEW}" width="600" alt="Bindersnap: the surveyor asks which version you approved. Show them." style="max-width:100%;height:auto;border:0"></a></p>`;
}

/**
 * Copies the email, picture and all, as rich text and plain text. The button
 * stays hidden until this runs, so without it the page offers only what
 * works. `</` is escaped in the inlined strings so neither can end the script.
 */
function copyScript(): string {
  const json = (value: string) =>
    JSON.stringify(value).replace(/</g, "\\u003c");
  return `(function(){
  var button=document.getElementById("share-copy");
  var status=document.getElementById("share-copy-status");
  if(!button||!status)return;
  var html=${json(shareEmailHtml())};
  var text=${json(SHARE_EMAIL.body.join("\n\n"))};
  function done(ok){
    status.textContent=ok?"Copied. Paste it into a new email: the one-pager comes with it.":"Your browser would not copy it. Use the email below instead.";
  }
  function fallback(){
    var box=document.createElement("div");
    box.contentEditable="true";box.innerHTML=html;
    box.style.position="fixed";box.style.left="-9999px";
    document.body.appendChild(box);
    var range=document.createRange();range.selectNodeContents(box);
    var sel=window.getSelection();sel.removeAllRanges();sel.addRange(range);
    var ok=false;try{ok=document.execCommand("copy");}catch(e){}
    sel.removeAllRanges();box.remove();done(ok);
  }
  button.hidden=false;
  button.addEventListener("click",function(){
    if(navigator.clipboard&&window.ClipboardItem){
      navigator.clipboard.write([new ClipboardItem({
        "text/html":new Blob([html],{type:"text/html"}),
        "text/plain":new Blob([text],{type:"text/plain"})
      })]).then(function(){done(true);},fallback);
    }else{fallback();}
  });
})();`;
}

/** The preview and the ways to send it, under the share page's lede. */
export function shareHtml(): string {
  return `<div class="site-share">
<a class="site-share-preview" href="${FLYER_PATH}"${trackAttributes("share_click", { method: "preview" })}><img src="${ONE_PAGER_PREVIEW}" width="408" height="528" alt="The Bindersnap one-pager: the surveyor headline, a policy's approval record, how it works, who it is for and the price." loading="lazy"></a>
<div class="site-share-actions">
<button type="button" id="share-copy" class="site-share-button site-share-primary" hidden${trackAttributes("share_click", { method: "copy" })}>Copy the email</button>
<p id="share-copy-status" role="status"></p>
<a class="site-share-button" href="${shareMailto()}"${trackAttributes("share_click", { method: "email" })}>Open it in my email program</a>
<a class="site-share-button" href="${ONE_PAGER_PDF}" download${trackAttributes("share_click", { method: "pdf" })}>Download the PDF</a>
<p>Copy the email to paste it, one-pager and all, into Gmail, Outlook or any other email. Your email program opens it as plain text, with a link to the one-pager at <a href="${FLYER_PATH}">bindersnap.com${FLYER_PATH}</a>. Nothing about who you send it to comes to us.</p>
</div>
<script>${copyScript()}</script>
</div>`;
}

const FLYER_DESCRIPTION =
  "Bindersnap in one page: every policy with its current approved version and the record of who signed off on it, for small healthcare providers.";

/**
 * The one-pager as a page of the site, at /flyer: the same HTML the PDF is
 * printed from, with the token stylesheet inlined and the fonts pointed at
 * the site's own copies. A bar above the sheet, on screen only, offers the
 * PDF and the trial; printing the page prints the sheet alone.
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
<a class="flyer-link" href="/share">Send it to someone</a>
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
