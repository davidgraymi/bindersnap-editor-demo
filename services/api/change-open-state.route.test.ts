import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "crypto";

import { config } from "./config";
import { createApiServer } from "./server";
import { SessionStore, sessionStore } from "./sessions";
import { resetStripeClientForTests } from "./stripe/client";
import {
  SubscriptionStore,
  subscriptionStore,
  WebhookEventStore,
  webhookEventStore,
} from "./subscriptions";

const TEST_GITEA_ORG_ID = 4005;
// The organization the routes below write into: the paywall judges that one.
const TEST_ORG_NAME = "acme";
const BRANCH = "draft/bob/1";

/**
 * Closing a change without publishing it, and reopening it.
 *
 * Its author's or a binder admin's, and never a published change: that one is
 * the record. A reopen also has to land somewhere — the draft it came from
 * must still be there, and not proposed again as another change.
 */

const originalFetch = globalThis.fetch;
const originalApiPort = config.apiPort;
const originalSessionsDbPath = config.sessionsDbPath;

let giteaLoginsByToken = new Map<string, string>();
let pullState: { state: string; merged: boolean } = {
  state: "open",
  merged: false,
};
let isBinderAdmin = false;
let branchThere = true;
/** Another change on the same draft, as Gitea's list by head returns it. */
let otherChangeOnBranch: { number: number; state: string } | null = null;
let stateWrites: string[] = [];

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function pull(number: number, state: string, merged = false) {
  return {
    number,
    state,
    merged,
    user: { login: "bob" },
    head: { ref: BRANCH },
    base: { ref: "main" },
  };
}

beforeEach(() => {
  config.apiPort = 0;
  config.sessionsDbPath = `/tmp/bindersnap-change-state-test-${randomUUID()}.sqlite`;
  resetStripeClientForTests();

  (sessionStore as unknown as { _store: SessionStore | null })._store =
    new SessionStore(config.sessionsDbPath);
  (
    subscriptionStore as unknown as { _store: SubscriptionStore | null }
  )._store = new SubscriptionStore(config.sessionsDbPath);
  (
    webhookEventStore as unknown as { _store: WebhookEventStore | null }
  )._store = new WebhookEventStore(config.sessionsDbPath);

  giteaLoginsByToken = new Map();
  pullState = { state: "open", merged: false };
  isBinderAdmin = false;
  branchThere = true;
  otherChangeOnBranch = null;
  stateWrites = [];

  globalThis.fetch = (async (input, init) => {
    const requestUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    const rawBody =
      typeof init?.body === "string"
        ? init.body
        : input instanceof Request
          ? await input.clone().text()
          : "";
    const parsed = rawBody
      ? (JSON.parse(rawBody) as Record<string, unknown>)
      : null;
    const url = new URL(requestUrl);
    const path = url.pathname;

    if (path === "/api/v1/user/orgs") {
      return json([{ id: TEST_GITEA_ORG_ID, username: TEST_ORG_NAME }]);
    }

    if (path === "/api/v1/user") {
      const auth = headers.get("Authorization") ?? "";
      const token = auth.startsWith("token ") ? auth.slice(6) : "";
      const login = giteaLoginsByToken.get(token);
      if (!login) return json({ message: "Not found" }, 404);
      return json({ login, email: `${login}@test.local`, is_admin: false });
    }

    if (path === "/api/v1/repos/acme/policies" && method === "GET") {
      return json({
        id: 1,
        name: "policies",
        full_name: "acme/policies",
        private: true,
        permissions: { admin: isBinderAdmin, push: true, pull: true },
      });
    }

    if (path === "/api/v1/repos/acme/policies/pulls/3") {
      if (method === "GET")
        return json(pull(3, pullState.state, pullState.merged));
      if (method === "PATCH") {
        const next = String(parsed?.state ?? "");
        stateWrites.push(next);
        pullState = { state: next, merged: false };
        return json(pull(3, next));
      }
    }

    if (path === "/api/v1/repos/acme/policies/pulls" && method === "GET") {
      const list = [pull(3, pullState.state, pullState.merged)];
      if (otherChangeOnBranch) {
        list.push(pull(otherChangeOnBranch.number, otherChangeOnBranch.state));
      }
      return json(list);
    }

    if (path.match(/^\/api\/v1\/repos\/acme\/policies\/pulls\/\d+\/reviews$/)) {
      return json([]);
    }

    if (path.startsWith("/api/v1/repos/acme/policies/branches/")) {
      return branchThere
        ? json({ name: BRANCH })
        : json({ message: "branch does not exist" }, 404);
    }

    return json({ error: `unmocked: ${method} ${path}` }, 500);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  config.apiPort = originalApiPort;
  config.sessionsDbPath = originalSessionsDbPath;
});

async function seedSession(username: string): Promise<string> {
  const sessionId = `sess_${randomUUID()}`;
  const giteaToken = `gitea_${randomUUID()}`;
  giteaLoginsByToken.set(giteaToken, username);
  await sessionStore.put({
    id: sessionId,
    username,
    giteaToken,
    giteaTokenName: "change-state-test-token",
    createdAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  });
  await subscriptionStore.upsert({
    giteaOrgId: TEST_GITEA_ORG_ID,
    stripeCustomerId: `cus_${randomUUID()}`,
    stripeSubscriptionId: `sub_${randomUUID()}`,
    status: "active",
    currentPeriodEnd: Math.floor(Date.now() / 1000) + 86_400,
    cancelAtPeriodEnd: false,
    cancelAt: null,
    updatedAt: Date.now(),
  });
  return sessionId;
}

function request(verb: "close" | "reopen", sessionId: string): Request {
  return new Request(
    `http://localhost/api/app/binders/acme/policies/changes/3/${verb}`,
    {
      method: "POST",
      headers: {
        Origin: config.appOrigin,
        Cookie: `${config.sessionCookieName}=${sessionId}`,
      },
    },
  );
}

describe("closing and reopening a change", () => {
  test("its author closes it, and Gitea records the close", async () => {
    const server = createApiServer();
    const session = await seedSession("bob");

    const response = await server.fetch(request("close", session));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ state: "closed" });
    expect(stateWrites).toEqual(["closed"]);
  });

  test("a binder admin closes somebody else's", async () => {
    const server = createApiServer();
    const session = await seedSession("carol");
    isBinderAdmin = true;

    const response = await server.fetch(request("close", session));

    expect(response.status).toBe(200);
    expect(stateWrites).toEqual(["closed"]);
  });

  test("anybody else is refused", async () => {
    const server = createApiServer();
    const session = await seedSession("carol");

    const response = await server.fetch(request("close", session));

    expect(response.status).toBe(403);
    expect(stateWrites).toEqual([]);
  });

  test("a closed change is reopened onto its draft", async () => {
    const server = createApiServer();
    const session = await seedSession("bob");
    pullState = { state: "closed", merged: false };

    const response = await server.fetch(request("reopen", session));

    expect(response.status).toBe(200);
    expect(stateWrites).toEqual(["open"]);
  });

  test("a published change is never reopened", async () => {
    const server = createApiServer();
    const session = await seedSession("bob");
    isBinderAdmin = true;
    pullState = { state: "closed", merged: true };

    const response = await server.fetch(request("reopen", session));

    expect(response.status).toBe(409);
    expect(stateWrites).toEqual([]);
  });

  test("a change whose draft was thrown away cannot be reopened", async () => {
    const server = createApiServer();
    const session = await seedSession("bob");
    pullState = { state: "closed", merged: false };
    branchThere = false;

    const response = await server.fetch(request("reopen", session));

    expect(response.status).toBe(409);
    expect(stateWrites).toEqual([]);
  });

  test("a draft proposed again sends the reopen to the newer change", async () => {
    const server = createApiServer();
    const session = await seedSession("bob");
    pullState = { state: "closed", merged: false };
    otherChangeOnBranch = { number: 5, state: "open" };

    const response = await server.fetch(request("reopen", session));
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(409);
    expect(payload.error).toContain("change 5");
    expect(stateWrites).toEqual([]);
  });
});
