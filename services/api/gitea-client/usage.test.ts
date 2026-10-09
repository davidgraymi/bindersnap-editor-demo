import { afterEach, expect, test } from "bun:test";

import { gatedFetch } from "./client";
import {
  createGiteaUsage,
  currentGiteaUsage,
  recordGiteaCall,
  withGiteaUsage,
} from "./usage";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// `gatedFetch` is what the typed client is built on. It is called directly
// because another test file mocks `openapi-fetch` for the whole process.
test("every gated call adds itself to the request it ran under", async () => {
  globalThis.fetch = (async () =>
    new Response("[]", {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;

  const usage = createGiteaUsage();
  const call = (path: string) =>
    gatedFetch(new Request(`https://gitea.test/api/v1/${path}`));

  await withGiteaUsage(usage, async () => {
    await Promise.all([call("user"), call("user/orgs"), call("user/repos")]);
  });

  expect(usage.calls).toBe(3);
  expect(usage.sharedCalls).toBe(0);
  expect(usage.giteaMs).toBeGreaterThanOrEqual(0);
  expect(usage.gateWaitMs).toBeGreaterThanOrEqual(0);
});

test("the same read asked at the same moment goes to Gitea once", async () => {
  let fetched = 0;
  globalThis.fetch = (async () => {
    fetched += 1;
    await Bun.sleep(5);
    return new Response('{"login":"alice"}', { status: 200 });
  }) as unknown as typeof fetch;

  const usage = createGiteaUsage();
  const read = (token: string) =>
    gatedFetch(
      new Request("https://gitea.test/api/v1/user", {
        headers: { Authorization: `token ${token}` },
      }),
    );

  const bodies = await withGiteaUsage(usage, () =>
    Promise.all([
      read("alice").then((r) => r.json()),
      read("alice").then((r) => r.json()),
      read("alice").then((r) => r.json()),
    ]),
  );
  // Everybody reads a whole body of their own.
  expect(bodies).toEqual([
    { login: "alice" },
    { login: "alice" },
    { login: "alice" },
  ]);
  expect(fetched).toBe(1);
  expect(usage).toMatchObject({ calls: 1, sharedCalls: 2 });

  // Whose credentials asked is part of the question.
  await Promise.all([read("alice"), read("bob")]);
  expect(fetched).toBe(3);

  // Nothing outlives the read: asked again later, it is asked again.
  await read("alice");
  expect(fetched).toBe(4);
});

test("a read shared from a request that was abandoned is asked for again", async () => {
  let fetched = 0;
  globalThis.fetch = (async (_input: Request, init?: RequestInit) => {
    fetched += 1;
    await new Promise((resolve, reject) => {
      // As `fetch` does: an already-aborted signal rejects at once.
      if (init?.signal?.aborted) return reject(init.signal.reason);
      const timer = setTimeout(resolve, 20);
      init?.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(init.signal!.reason);
      });
    });
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;

  const leaving = new AbortController();
  const read = () => gatedFetch(new Request("https://gitea.test/api/v1/user"));

  const first = withGiteaUsage(createGiteaUsage(), read, {
    signal: leaving.signal,
  });
  const second = withGiteaUsage(createGiteaUsage(), read);
  leaving.abort(new Error("the browser left"));

  await expect(first).rejects.toThrow("the browser left");
  await expect(second).resolves.toBeInstanceOf(Response);
  expect(fetched).toBe(2);
});

test("two requests running at once keep separate counts", async () => {
  const first = createGiteaUsage();
  const second = createGiteaUsage();

  await Promise.all([
    withGiteaUsage(first, async () => {
      for (let index = 0; index < 3; index += 1) {
        await Bun.sleep(1);
        recordGiteaCall({ waitMs: 1, durationMs: 2 });
      }
    }),
    withGiteaUsage(second, async () => {
      await Bun.sleep(1);
      recordGiteaCall({ waitMs: 0, durationMs: 5 });
    }),
  ]);

  expect(first).toEqual({
    calls: 3,
    sharedCalls: 0,
    gateWaitMs: 3,
    giteaMs: 6,
  });
  expect(second).toEqual({
    calls: 1,
    sharedCalls: 0,
    gateWaitMs: 0,
    giteaMs: 5,
  });
});

test("a call made outside any request records nothing", () => {
  expect(currentGiteaUsage()).toBeUndefined();
  // Must not throw, and must not land on some other request's line.
  recordGiteaCall({ waitMs: 1, durationMs: 1 });
  expect(currentGiteaUsage()).toBeUndefined();
});

test("a read memoized for a request is shared within it, and only within it", async () => {
  const { memoizeForRequest } = await import("./usage");
  let reads = 0;
  const read = () =>
    memoizeForRequest("protection:a/b@main", async () => ++reads);

  await withGiteaUsage(createGiteaUsage(), async () => {
    expect(await Promise.all([read(), read(), read()])).toEqual([1, 1, 1]);
  });
  // Another request asks again: nothing outlives the request it was read in.
  await withGiteaUsage(createGiteaUsage(), async () => {
    expect(await read()).toBe(2);
  });
  // Outside a request there is nothing to share it with.
  expect(await read()).toBe(3);
});

test("a Gitea write within the request clears what it had shared", async () => {
  const { memoizeForRequest } = await import("./usage");
  globalThis.fetch = (async () =>
    new Response("{}", { status: 200 })) as unknown as typeof fetch;
  let reads = 0;
  const read = () =>
    memoizeForRequest("protection:a/b@main", async () => ++reads);

  await withGiteaUsage(createGiteaUsage(), async () => {
    expect(await read()).toBe(1);
    await gatedFetch(
      new Request(
        "https://gitea.test/api/v1/repos/a/b/branch_protections/main",
        {
          method: "PATCH",
        },
      ),
    );
    expect(await read()).toBe(2);
  });
});
