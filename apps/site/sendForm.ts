import { publicEnv } from "../app/publicEnv";
import { trackAttributes } from "./analytics";

/**
 * "Email it to me", beside a template's, a policy manual index's or the
 * checklist's download: the step for a reader who wants the page and isn't
 * ready for a trial.
 *
 * A plain form posted to the API (`services/api/resource-requests.ts`), so
 * the page still runs no script. The API sends the browser back to the same
 * page at `#sent` or `#send-again`, and the matching line below the form
 * shows with `:target`.
 *
 * What the hint says is what the Privacy Policy says we do with the address
 * (section 7): send the page, and perhaps write again. Change them together.
 */

export const PRODUCTION_API_URL = "https://api.bindersnap.com";

/** The API, from the public site. The local stack names its own. */
export function apiOrigin(): string {
  return (
    publicEnv(() => process.env.BUN_PUBLIC_API_BASE_URL) || PRODUCTION_API_URL
  ).replace(/\/+$/, "");
}

export const SEND_FORM_PATH = "/site/resource-requests";

/** The pages that offer it: the API accepts these and no others. */
export function offersSendForm(path: string): boolean {
  return /^\/(templates|manuals|tools)\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(path);
}

export function sendForm(resource: string, what: string): string {
  return `<form class="site-send" id="send" method="post" action="${apiOrigin()}${SEND_FORM_PATH}">
<input type="hidden" name="resource" value="${resource}">
<label class="site-send-label" for="send-email">Or have ${what} emailed to you</label>
<div class="site-send-row">
<input id="send-email" type="email" name="email" required autocomplete="email" placeholder="you@yourclinic.org">
<button type="submit"${trackAttributes("resource_request", { resource })}>Email it to me</button>
</div>
<p class="site-send-trap" aria-hidden="true"><label>Leave this empty <input type="text" name="website" tabindex="-1" autocomplete="off"></label></p>
<p class="site-send-hint">We'll email it now, and may write again about the rules behind it or about Bindersnap. Unsubscribe any time. <a href="/legal/privacy">Privacy</a></p>
</form>
<p class="site-send-note" id="sent" role="status">Sent. It should reach your inbox in a minute or two.</p>
<p class="site-send-note" id="send-again" role="status">That didn't go through. Check the address and try again.</p>`;
}
