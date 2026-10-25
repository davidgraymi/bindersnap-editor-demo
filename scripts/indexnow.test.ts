import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { INDEXNOW_KEY, renderSitemap } from "../apps/site/renderSite";
import {
  changedUrls,
  INDEXNOW_ENDPOINT,
  indexNowBody,
  sitemapEntries,
  submitUrls,
} from "./indexnow";

const before = renderSitemap([
  { path: "/" },
  { path: "/pricing", updated: "2026-10-01" },
  { path: "/templates/hand-hygiene", updated: "2026-09-01" },
  { path: "/help/a&b", updated: "2026-09-01" },
]);
const after = renderSitemap([
  { path: "/" },
  { path: "/pricing", updated: "2026-10-20" },
  { path: "/templates/hand-hygiene", updated: "2026-09-01" },
  { path: "/help/a&b", updated: "2026-09-01" },
  { path: "/templates/fire-safety", updated: "2026-10-20" },
]);

describe("which pages changed", () => {
  test("reads each address and its date from the sitemap the site builds", () => {
    const entries = sitemapEntries(before);
    expect(entries.get("https://bindersnap.com/")).toBe("");
    expect(entries.get("https://bindersnap.com/pricing")).toBe("2026-10-01");
    expect(entries.has("https://bindersnap.com/help/a&b")).toBe(true);
  });

  test("a new address, or one whose date moved, is sent; nothing else", () => {
    expect(changedUrls(before, after)).toEqual([
      "https://bindersnap.com/pricing",
      "https://bindersnap.com/templates/fire-safety",
    ]);
    expect(changedUrls(after, after)).toEqual([]);
  });

  test("with no earlier sitemap, every address is sent", () => {
    expect(changedUrls("", after)).toHaveLength(5);
  });
});

describe("what is sent", () => {
  test("names the host, the key and where the key lives", () => {
    expect(indexNowBody(["https://bindersnap.com/pricing"])).toEqual({
      host: "bindersnap.com",
      key: INDEXNOW_KEY,
      keyLocation: `https://bindersnap.com/${INDEXNOW_KEY}.txt`,
      urlList: ["https://bindersnap.com/pricing"],
    });
  });

  test("never an address on another host, which the engine would refuse", () => {
    expect(
      indexNowBody([
        "https://app.bindersnap.com/-/login",
        "https://bindersnap.com/",
      ]).urlList,
    ).toEqual(["https://bindersnap.com/"]);
  });

  test("posts JSON to the shared endpoint, and accepts 200 and 202", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    for (const status of [200, 202]) {
      await submitUrls(["https://bindersnap.com/"], (async (url, init) => {
        calls.push({ url: String(url), init: init! });
        return new Response(null, { status });
      }) as typeof fetch);
    }
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toBe(INDEXNOW_ENDPOINT);
    expect(calls[0]!.init.method).toBe("POST");
    expect(JSON.parse(String(calls[0]!.init.body)).urlList).toEqual([
      "https://bindersnap.com/",
    ]);
  });

  test("throws on any other answer, with what the engine said", async () => {
    const send = (async () =>
      new Response("Key not valid", {
        status: 403,
      })) as unknown as typeof fetch;
    await expect(submitUrls(["https://bindersnap.com/"], send)).rejects.toThrow(
      "IndexNow answered 403: Key not valid",
    );
  });
});

test("the deploy saves the live sitemap first and tells IndexNow after", () => {
  const workflow = readFileSync(
    join(import.meta.dir, "../.github/workflows/static-site.yml"),
    "utf8",
  );
  const save = workflow.indexOf("https://bindersnap.com/sitemap.xml");
  const deploy = workflow.indexOf("- name: Deploy bindersnap.com\n");
  const tell = workflow.indexOf("scripts/indexnow.ts");
  expect(save).toBeGreaterThan(-1);
  expect(save).toBeLessThan(deploy);
  expect(tell).toBeGreaterThan(deploy);
});
