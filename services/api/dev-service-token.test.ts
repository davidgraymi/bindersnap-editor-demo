import { afterEach, expect, test } from "bun:test";

import { config } from "./config";
import {
  DEV_SERVICE_TOKEN_NAME,
  DEV_SERVICE_TOKEN_SCOPES,
  devServiceToken,
  mintDevServiceToken,
  resetDevServiceToken,
  serviceToken,
} from "./dev-service-token";

const originalFetch = globalThis.fetch;
const original = {
  isProduction: config.isProduction,
  giteaServiceToken: config.giteaServiceToken,
  giteaAdminUsername: config.giteaAdminUsername,
  giteaAdminPassword: config.giteaAdminPassword,
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  Object.assign(config, original);
  resetDevServiceToken();
});

test("a dev stack with only admin credentials mints a token with production's scopes", async () => {
  Object.assign(config, {
    isProduction: false,
    giteaServiceToken: "",
    giteaAdminUsername: "admin",
    giteaAdminPassword: "dev",
  });
  const calls: Array<{ method: string; url: string; body?: unknown }> = [];
  globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({
      method,
      url: String(input),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    if (method === "POST") {
      return new Response(JSON.stringify({ sha1: "minted-token" }), {
        status: 201,
      });
    }
    return new Response(null, { status: 404 });
  }) as unknown as typeof fetch;

  expect(await mintDevServiceToken({ attempts: 1 })).toBe("minted-token");
  expect(devServiceToken()).toBe("minted-token");
  expect(serviceToken()).toBe("minted-token");
  // The last run's token is removed first, so restarts do not pile them up.
  expect(calls.map((call) => call.method)).toEqual(["DELETE", "POST"]);
  expect(calls[0]!.url).toEndWith(
    `/users/admin/tokens/${DEV_SERVICE_TOKEN_NAME}`,
  );
  expect(calls[1]!.body).toEqual({
    name: DEV_SERVICE_TOKEN_NAME,
    scopes: DEV_SERVICE_TOKEN_SCOPES,
  });
});

test("production, or a configured token, mints nothing", async () => {
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    return new Response(null, { status: 500 });
  }) as unknown as typeof fetch;

  Object.assign(config, {
    isProduction: true,
    giteaServiceToken: "",
    giteaAdminUsername: "admin",
    giteaAdminPassword: "dev",
  });
  expect(await mintDevServiceToken({ attempts: 1 })).toBeNull();

  Object.assign(config, { isProduction: false, giteaServiceToken: "svc" });
  expect(await mintDevServiceToken({ attempts: 1 })).toBeNull();
  expect(serviceToken()).toBe("svc");
  expect(called).toBe(false);
});

test("a Gitea that will not mint leaves privileged reads on basic auth", async () => {
  Object.assign(config, {
    isProduction: false,
    giteaServiceToken: "",
    giteaAdminUsername: "admin",
    giteaAdminPassword: "dev",
  });
  globalThis.fetch = (async () =>
    new Response(null, { status: 503 })) as unknown as typeof fetch;

  expect(await mintDevServiceToken({ attempts: 2, delayMs: 1 })).toBeNull();
  expect(serviceToken()).toBeNull();
});
