import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { trackAttributes } from "./analytics";

/**
 * The share page (`content/pages/share.md`): the one-pager to download, and an
 * email that is already written, for someone passing Bindersnap on to a
 * colleague. Linked from the footer only.
 *
 * The one-pager is drawn from `one-pager/bindersnap-one-pager.html`; after
 * editing it, run `bun apps/site/one-pager/render.ts` and commit the PDF and
 * PNG it writes.
 */

export const ONE_PAGER_PDF = "/bindersnap-one-pager.pdf";
export const ONE_PAGER_PREVIEW = "/bindersnap-one-pager.png";

/**
 * The email "Write the email" fills in. The share page prints the same words
 * for anyone whose email is a browser tab; `sharePage.test.ts` holds the two
 * equal. Written in the sender's voice, not ours.
 */
export const SHARE_EMAIL = {
  subject: "Thought of you: Bindersnap",
  body: [
    "Hi,",
    "Do you still get asked which version of a policy was approved, and have to dig through email to answer? I came across something built for exactly that.",
    "Bindersnap keeps every policy with its current approved version and a record of who signed off on it, and when. Approvals happen on the policy itself, so when a surveyor asks, the answer is on the page.",
    "It's made for small providers: $39 a month for each person who writes policies, and reviewers and staff who only read are free. There's a 14-day free trial, no card needed.",
    "Here's a one-page overview: https://bindersnap.com/bindersnap-one-pager.pdf",
  ],
} as const;

export function shareMailto(): string {
  return `mailto:?subject=${encodeURIComponent(
    SHARE_EMAIL.subject,
  )}&body=${encodeURIComponent(SHARE_EMAIL.body.join("\n\n"))}`;
}

/** The preview and the two ways to send it, under the share page's lede. */
export function shareHtml(): string {
  return `<div class="site-share">
<a class="site-share-preview" href="${ONE_PAGER_PDF}" download${trackAttributes("share_click", { method: "preview" })}><img src="${ONE_PAGER_PREVIEW}" width="408" height="528" alt="The Bindersnap one-pager: the surveyor headline, a policy's approval record, how it works, who it is for and the price." loading="lazy"></a>
<div class="site-share-actions">
<a class="site-share-button site-share-primary" href="${shareMailto()}"${trackAttributes("share_click", { method: "email" })}>Write the email</a>
<a class="site-share-button" href="${ONE_PAGER_PDF}" download${trackAttributes("share_click", { method: "pdf" })}>Download the one-pager (PDF)</a>
<p>The email opens in your own email program, with the overview linked. Nothing about who you send it to comes to us.</p>
</div>
</div>`;
}

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
