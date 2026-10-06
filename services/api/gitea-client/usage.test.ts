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
  const call = () => gatedFetch(new Request("https://gitea.test/api/v1/user"));

  await withGiteaUsage(usage, async () => {
    await Promise.all([call(), call(), call()]);
  });

  expect(usage.calls).toBe(3);
  expect(usage.ungatedCalls).toBe(0);
  expect(usage.giteaMs).toBeGreaterThanOrEqual(0);
  expect(usage.gateWaitMs).toBeGreaterThanOrEqual(0);
});

test("two requests running at once keep separate counts", async () => {
  const first = createGiteaUsage();
  const second = createGiteaUsage();

  await Promise.all([
    withGiteaUsage(first, async () => {
      for (let index = 0; index < 3; index += 1) {
        await Bun.sleep(1);
        recordGiteaCall({ gated: true, waitMs: 1, durationMs: 2 });
      }
    }),
    withGiteaUsage(second, async () => {
      await Bun.sleep(1);
      recordGiteaCall({ gated: false, waitMs: 0, durationMs: 5 });
    }),
  ]);

  expect(first).toEqual({
    calls: 3,
    ungatedCalls: 0,
    gateWaitMs: 3,
    giteaMs: 6,
  });
  expect(second).toEqual({
    calls: 1,
    ungatedCalls: 1,
    gateWaitMs: 0,
    giteaMs: 5,
  });
});

test("a call made outside any request records nothing", () => {
  expect(currentGiteaUsage()).toBeUndefined();
  // Must not throw, and must not land on some other request's line.
  recordGiteaCall({ gated: true, waitMs: 1, durationMs: 1 });
  expect(currentGiteaUsage()).toBeUndefined();
});
