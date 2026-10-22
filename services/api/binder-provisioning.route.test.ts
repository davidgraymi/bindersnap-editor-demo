import { afterEach, beforeEach, expect, test } from "bun:test";
import { randomUUID } from "crypto";

import { config } from "./config";
import { createApiServer } from "./server";
import { SessionStore, sessionStore } from "./sessions";
import { resetStripeClientForTests } from "./stripe/client";
import { SubscriptionStore, subscriptionStore } from "./subscriptions";

/**
 * Creating a binder is five Gitea writes, and protecting `main` is the last.
 * A run that stops before it leaves a binder anybody with write access can
 * push to unreviewed — and asking again used to be refused, because the name
 * was taken. These pin that a stopped setup is finished instead.
 */

const ORG_ID = 5005;
const ORG = "mercy-health";
const NAME = "clinical";

const originalFetch = globalThis.fetch;
const originalSessionsDbPath = config.sessionsDbPath;
const originalApiPort = config.apiPort;

let repoExists = false;
let protectedMain = false;
let failNextProtection = false;
let repoCreates = 0;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  config.apiPort = 0;
  config.stripeSecretKey = "sk_test_prov";
  config.stripeWebhookSecret = "whsec_test_prov";
  config.stripePriceId = "price_test_prov";
  config.sessionsDbPath = `/tmp/bindersnap-prov-test-${randomUUID()}.sqlite`;
  resetStripeClientForTests();
  (sessionStore as unknown as { _store: SessionStore | null })._store =
    new SessionStore(config.sessionsDbPath);
  (
    subscriptionStore as unknown as { _store: SubscriptionStore | null }
  )._store = new SubscriptionStore(config.sessionsDbPath);

  repoExists = false;
  protectedMain = false;
  failNextProtection = false;
  repoCreates = 0;

  globalThis.fetch = (async (input, init) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url,
    );
    const method =
      input instanceof Request ? input.method : (init?.method ?? "GET");
    const path = url.pathname;

    if (path === "/api/v1/user/orgs") {
      return json([{ id: ORG_ID, username: ORG }]);
    }
    if (path === "/api/v1/user") {
      return json({ login: "alice", full_name: "", is_admin: false });
    }
    if (path === `/api/v1/repos/${ORG}/${NAME}` && method === "GET") {
      return repoExists
        ? json({
            id: 9,
            name: NAME,
            full_name: `${ORG}/${NAME}`,
            owner: { login: ORG },
            permissions: { admin: true, push: true, pull: true },
          })
        : json({ message: "Not found" }, 404);
    }
    if (path === `/api/v1/orgs/${ORG}/repos` && method === "POST") {
      repoCreates += 1;
      repoExists = true;
      return json({ id: 9, name: NAME, owner: { login: ORG } }, 201);
    }
    if (path === `/api/v1/orgs/${ORG}/teams` && method === "GET") {
      return json([{ id: 7, name: "staff", permission: "read" }]);
    }
    if (
      path === `/api/v1/repos/${ORG}/${NAME}/branch_protections` &&
      method === "POST"
    ) {
      if (failNextProtection) {
        failNextProtection = false;
        return json({ message: "the process went away" }, 500);
      }
      protectedMain = true;
      return json({ rule_name: "main" }, 201);
    }
    if (
      path === `/api/v1/repos/${ORG}/${NAME}/branch_protections/main` &&
      method === "GET"
    ) {
      return protectedMain
        ? json({ rule_name: "main" })
        : json({ message: "Not found" }, 404);
    }
    if (method === "GET") return json({ message: "Not found" }, 404);
    return json({}, 200);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  config.sessionsDbPath = originalSessionsDbPath;
  config.apiPort = originalApiPort;
});

async function seedSession(): Promise<string> {
  const id = `sess_${randomUUID()}`;
  await sessionStore.put({
    id,
    username: "alice",
    giteaToken: `gitea_${randomUUID()}`,
    giteaTokenName: "prov-test",
    createdAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  });
  await subscriptionStore.upsert({
    giteaOrgId: ORG_ID,
    stripeCustomerId: `cus_${randomUUID()}`,
    stripeSubscriptionId: `sub_${randomUUID()}`,
    status: "active",
    currentPeriodEnd: Math.floor(Date.now() / 1000) + 86_400,
    cancelAtPeriodEnd: false,
    cancelAt: null,
    updatedAt: Date.now(),
  });
  return id;
}

function create(sessionId: string): Request {
  return new Request(`http://localhost/api/app/orgs/${ORG}/binders`, {
    method: "POST",
    headers: {
      Origin: config.appOrigin,
      Cookie: `${config.sessionCookieName}=${sessionId}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: "Clinical" }),
  });
}

test("a binder whose setup stopped before protection is finished by asking again", async () => {
  const server = createApiServer();
  const session = await seedSession();
  failNextProtection = true;

  try {
    const first = await server.fetch(create(session));
    expect(first.status).toBe(202);
    expect(repoExists).toBe(true);
    expect(protectedMain).toBe(false);

    // Before jobs: 409, "already exists", and an unprotected `main` for good.
    const again = await server.fetch(create(session));
    expect(again.status).toBe(201);
    expect(protectedMain).toBe(true);
    expect(repoCreates).toBe(1);

    // And once it is finished, the name is taken in the ordinary way.
    const third = await server.fetch(create(session));
    expect(third.status).toBe(409);
  } finally {
    server.stop(true);
  }
});

test("a binder that could not be created at all leaves nothing to resume", async () => {
  const server = createApiServer();
  const session = await seedSession();

  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url,
    );
    const method =
      input instanceof Request ? input.method : (init?.method ?? "GET");
    if (url.pathname === `/api/v1/orgs/${ORG}/repos` && method === "POST") {
      return json({ message: "quota exceeded" }, 403);
    }
    return realFetch(input, init);
  }) as typeof fetch;

  try {
    const first = await server.fetch(create(session));
    expect(first.status).toBe(403);
    expect(repoExists).toBe(false);
  } finally {
    server.stop(true);
  }
});
