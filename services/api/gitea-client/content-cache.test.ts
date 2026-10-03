import { afterEach, expect, test } from "bun:test";

import { gatedFetch } from "./client";
import {
  ContentCache,
  giteaContentCache,
  isContentAddressed,
} from "./content-cache";
import { createGiteaUsage, withGiteaUsage } from "./usage";

const SHA = "0111b863ad806612b0a53d790fe5cba548d39696";
const REPO = "https://gitea.test/api/v1/repos/acme/nursing";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  giteaContentCache.clear();
});

test("only an address that is a full object hash counts", () => {
  expect(isContentAddressed(`${REPO}/git/trees/${SHA}`)).toBe(true);
  expect(isContentAddressed(`${REPO}/git/trees/${SHA}?recursive=1`)).toBe(true);
  expect(isContentAddressed(`${REPO}/git/blobs/${SHA}`)).toBe(true);
  expect(isContentAddressed(`${REPO}/raw/nursing/a.json?ref=${SHA}`)).toBe(
    true,
  );

  // Names that move are never content.
  expect(isContentAddressed(`${REPO}/git/trees/main`)).toBe(false);
  expect(isContentAddressed(`${REPO}/raw/nursing/a.json?ref=main`)).toBe(false);
  expect(isContentAddressed(`${REPO}/raw/nursing/a.json`)).toBe(false);
  expect(isContentAddressed(`${REPO}/raw/a.json?ref=01J8XZ4K7M/v3`)).toBe(
    false,
  );
  // A short hash could name a different object tomorrow.
  expect(isContentAddressed(`${REPO}/git/blobs/${SHA.slice(0, 12)}`)).toBe(
    false,
  );
  expect(isContentAddressed(`${REPO}/pulls?state=open`)).toBe(false);
});

test("the oldest answers go first when the bytes run out", async () => {
  const cache = new ContentCache({ maxBytes: 10, maxEntryBytes: 10 });
  const ok = (body: string) => new Response(body, { status: 200 });

  await cache.put("a", ok("aaaa"));
  await cache.put("b", ok("bbbb"));
  expect(await cache.get("a")?.text()).toBe("aaaa"); // a is now newest
  await cache.put("c", ok("cccc"));

  expect(cache.get("b")).toBeNull();
  expect(await cache.get("a")?.text()).toBe("aaaa");
  expect(await cache.get("c")?.text()).toBe("cccc");
  expect(cache.bytes).toBe(8);
});

test("a failure, and an answer too big for a slot, are not kept", async () => {
  const cache = new ContentCache({ maxBytes: 100, maxEntryBytes: 4 });
  await cache.put("missing", new Response("nope", { status: 404 }));
  await cache.put("big", new Response("too big", { status: 200 }));
  expect(cache.size).toBe(0);
});

test("a read at a commit goes to Gitea once per person, then from memory", async () => {
  let fetched = 0;
  globalThis.fetch = (async () => {
    fetched += 1;
    return new Response("the words", { status: 200 });
  }) as unknown as typeof fetch;

  const read = (token: string, ref: string) =>
    gatedFetch(
      new Request(`${REPO}/raw/nursing/a.json?ref=${ref}`, {
        headers: { Authorization: `token ${token}` },
      }),
    ).then((response) => response.text());

  const usage = createGiteaUsage();
  await withGiteaUsage(usage, async () => {
    expect(await read("alice", SHA)).toBe("the words");
    // Kept from a clone after the answer settles.
    await Bun.sleep(1);
    expect(await read("alice", SHA)).toBe("the words");
  });
  expect(fetched).toBe(1);
  expect(usage).toMatchObject({ calls: 1, cachedCalls: 1 });

  // Somebody else asks Gitea themselves: access is theirs to be granted.
  await read("bob", SHA);
  expect(fetched).toBe(2);

  // A branch is never kept.
  await read("alice", "main");
  await Bun.sleep(1);
  await read("alice", "main");
  expect(fetched).toBe(4);
});
