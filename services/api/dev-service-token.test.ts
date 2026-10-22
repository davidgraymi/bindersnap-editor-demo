import { afterEach, expect, test } from "bun:test";

import {
  DEFAULT_ADMIN_TOKEN_SCOPES,
  DEFAULT_SERVICE_TOKEN_SCOPES,
} from "../../deploy/files/scripts/bootstrap-gitea-service-account";

import { config } from "./config";
import {
  DEV_SERVICE_TOKEN_NAMES,
  SERVICE_TOKEN_SCOPES,
  adminToken,
  devServiceToken,
  mintDevServiceTokens,
  resetDevServiceToken,
  serviceToken,
} from "./dev-service-token";

const originalFetch = globalThis.fetch;
const original = {
  isProduction: config.isProduction,
  giteaServiceToken: config.giteaServiceToken,
  giteaAdminToken: config.giteaAdminToken,
  giteaAdminUsername: config.giteaAdminUsername,
  giteaAdminPassword: config.giteaAdminPassword,
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  Object.assign(config, original);
  resetDevServiceToken();
});

const devStack = {
  isProduction: false,
  giteaServiceToken: "",
  giteaAdminToken: "",
  giteaAdminUsername: "admin",
  giteaAdminPassword: "dev",
};

test("dev mints exactly the scopes production's deploy mints", () => {
  expect([...SERVICE_TOKEN_SCOPES.read]).toEqual([
    ...DEFAULT_SERVICE_TOKEN_SCOPES,
  ]);
  expect([...SERVICE_TOKEN_SCOPES.admin]).toEqual([
    ...DEFAULT_ADMIN_TOKEN_SCOPES,
  ]);
  // The read token cannot write anything, and the admin token can only
  // administer accounts.
  expect(
    SERVICE_TOKEN_SCOPES.read.every((scope) => scope.startsWith("read:")),
  ).toBe(true);
  expect([...SERVICE_TOKEN_SCOPES.admin]).toEqual(["write:admin"]);
});

test("a dev stack with only admin credentials mints a read token and an admin token", async () => {
  Object.assign(config, devStack);
  const calls: Array<{ method: string; url: string; body?: unknown }> = [];
  globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url: String(input), body });
    if (method === "POST") {
      return new Response(JSON.stringify({ sha1: `minted-${body.name}` }), {
        status: 201,
      });
    }
    return new Response(null, { status: 404 });
  }) as unknown as typeof fetch;

  const minted = await mintDevServiceTokens({ attempts: 1 });
  const read = `minted-${DEV_SERVICE_TOKEN_NAMES.read}`;
  const admin = `minted-${DEV_SERVICE_TOKEN_NAMES.admin}`;
  expect(minted).toEqual({ read, admin });
  expect(devServiceToken("read")).toBe(read);
  expect(serviceToken()).toBe(read);
  expect(adminToken()).toBe(admin);

  // Each one's last-run token is removed first, so restarts do not pile up.
  for (const kind of ["read", "admin"] as const) {
    const name = DEV_SERVICE_TOKEN_NAMES[kind];
    expect(
      calls.some(
        (call) =>
          call.method === "DELETE" &&
          call.url.endsWith(`/users/admin/tokens/${name}`),
      ),
    ).toBe(true);
    const created = calls.find(
      (call) =>
        call.method === "POST" &&
        (call.body as { name?: string } | undefined)?.name === name,
    );
    expect(created?.body).toEqual({ name, scopes: SERVICE_TOKEN_SCOPES[kind] });
  }
});

test("production, or configured tokens, mint nothing", async () => {
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    return new Response(null, { status: 500 });
  }) as unknown as typeof fetch;

  Object.assign(config, { ...devStack, isProduction: true });
  expect(await mintDevServiceTokens({ attempts: 1 })).toEqual({
    read: null,
    admin: null,
  });

  Object.assign(config, {
    ...devStack,
    giteaServiceToken: "svc",
    giteaAdminToken: "adm",
  });
  expect(await mintDevServiceTokens({ attempts: 1 })).toEqual({
    read: null,
    admin: null,
  });
  expect(serviceToken()).toBe("svc");
  expect(adminToken()).toBe("adm");
  expect(called).toBe(false);
});

test("a host with only the old single token keeps account acts working on it", () => {
  Object.assign(config, {
    ...devStack,
    isProduction: true,
    giteaServiceToken: "old-single-token",
  });
  expect(serviceToken()).toBe("old-single-token");
  expect(adminToken()).toBe("old-single-token");
});

test("a Gitea that will not mint leaves privileged calls on basic auth", async () => {
  Object.assign(config, devStack);
  globalThis.fetch = (async () =>
    new Response(null, { status: 503 })) as unknown as typeof fetch;

  expect(await mintDevServiceTokens({ attempts: 2, delayMs: 1 })).toEqual({
    read: null,
    admin: null,
  });
  expect(serviceToken()).toBeNull();
  expect(adminToken()).toBeNull();
});
