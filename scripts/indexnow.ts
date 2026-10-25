/**
 * Tell search engines which pages of bindersnap.com changed, through IndexNow
 * (https://www.indexnow.org): one POST reaches Bing, Yandex, Seznam, Naver
 * and the rest, which share what they are sent.
 *
 *   bun scripts/indexnow.ts <old-sitemap.xml> <new-sitemap.xml>
 *   bun scripts/indexnow.ts --all <new-sitemap.xml>
 *
 * `static-site.yml` saves the live sitemap before it deploys and runs this
 * after, so only an address that is new, or whose `<lastmod>` moved, is sent.
 * A page with no `<lastmod>` (the landing page) is sent only when it first
 * appears; `--all` sends every address, for a first run or a new key.
 *
 * The engine checks the key by fetching `/{key}.txt` from the site
 * (`INDEXNOW_KEY` in apps/site/renderSite.ts), so run this only once that
 * file is live.
 */
import { readFileSync } from "node:fs";

import { INDEXNOW_KEY, SITE } from "../apps/site/renderSite";

export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";

/** The protocol's ceiling on one request. */
const MAX_URLS = 10_000;

/** Each `<loc>` in a sitemap, with its `<lastmod>` or "" when it has none. */
export function sitemapEntries(xml: string): Map<string, string> {
  const entries = new Map<string, string>();
  for (const [, body] of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const loc = body!.match(/<loc>([^<]*)<\/loc>/)?.[1]?.trim();
    if (!loc) continue;
    const lastmod = body!.match(/<lastmod>([^<]*)<\/lastmod>/)?.[1]?.trim();
    entries.set(unescapeXml(loc), lastmod ?? "");
  }
  return entries;
}

/** The addresses in `next` that `previous` lacks, or lists with another date. */
export function changedUrls(previous: string, next: string): string[] {
  const before = sitemapEntries(previous);
  return [...sitemapEntries(next)]
    .filter(([loc, lastmod]) => before.get(loc) !== lastmod)
    .map(([loc]) => loc);
}

export function indexNowBody(urls: readonly string[]) {
  const host = new URL(SITE).host;
  return {
    host,
    key: INDEXNOW_KEY,
    keyLocation: `${SITE}/${INDEXNOW_KEY}.txt`,
    urlList: urls.filter((url) => new URL(url).host === host),
  };
}

/**
 * Send `urls` in as few requests as the protocol allows. 200 and 202 (the
 * key is still being checked) are success; anything else throws, with what
 * the engine said.
 */
export async function submitUrls(
  urls: readonly string[],
  send: typeof fetch = fetch,
): Promise<void> {
  for (let start = 0; start < urls.length; start += MAX_URLS) {
    const response = await send(INDEXNOW_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(indexNowBody(urls.slice(start, start + MAX_URLS))),
    });
    if (response.status !== 200 && response.status !== 202) {
      throw new Error(
        `IndexNow answered ${response.status}: ${await response.text()}`,
      );
    }
  }
}

function unescapeXml(text: string): string {
  return text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const all = args[0] === "--all";
  const [previousPath, nextPath] = all ? ["", args[1]] : args;
  if (!nextPath || (!all && !previousPath)) {
    console.error(
      "Usage: bun scripts/indexnow.ts <old-sitemap.xml> <new-sitemap.xml>\n" +
        "       bun scripts/indexnow.ts --all <new-sitemap.xml>",
    );
    process.exit(2);
  }
  const next = readFileSync(nextPath, "utf8");
  const previous = all ? "" : readFileSync(previousPath!, "utf8");
  const urls = indexNowBody(changedUrls(previous, next)).urlList;
  if (urls.length === 0) {
    console.log("IndexNow: no page changed, nothing sent.");
  } else {
    await submitUrls(urls);
    console.log(`IndexNow: sent ${urls.length} address(es).`);
    for (const url of urls) console.log(`  ${url}`);
  }
}
