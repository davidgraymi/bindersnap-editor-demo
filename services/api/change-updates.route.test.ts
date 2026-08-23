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

/**
 * The updates route, end to end.
 *
 * `buildChangeUpdates` covers the numbering; what this covers is the walk that
 * gets to it — the change's branch, the file named *on that branch*, and the
 * approval-reset flag read from branch protection. Every one of those is a
 * place the route can silently return an empty list.
 */

const originalFetch = globalThis.fetch;
const originalApiPort = config.apiPort;
const originalSessionsDbPath = config.sessionsDbPath;

let giteaUsersByLogin = new Map<string, { login: string; email: string }>();
let giteaLoginsByToken = new Map<string, string>();
let headRef: string | null = null;
let commits: { sha: string; date: string; author: string }[] = [];
let commitQuery: {
  sha: string | null;
  not: string | null;
  path: string | null;
} | null = null;
let dismissStaleApprovals = false;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  config.apiPort = 0;
  config.stripeSecretKey = "sk_test_upd";
  config.stripeWebhookSecret = "whsec_test_upd";
  config.stripePriceId = "price_test_upd";
  config.sessionsDbPath = `/tmp/bindersnap-upd-test-${randomUUID()}.sqlite`;
  resetStripeClientForTests();

  (sessionStore as unknown as { _store: SessionStore | null })._store =
    new SessionStore(config.sessionsDbPath);
  (
    subscriptionStore as unknown as { _store: SubscriptionStore | null }
  )._store = new SubscriptionStore(config.sessionsDbPath);
  (
    webhookEventStore as unknown as { _store: WebhookEventStore | null }
  )._store = new WebhookEventStore(config.sessionsDbPath);

  giteaUsersByLogin = new Map();
  giteaLoginsByToken = new Map();
  headRef = "upload/v2";
  commits = [
    { sha: "sha-b", date: "2026-08-21T09:00:00Z", author: "Maya Khan" },
    { sha: "sha-a", date: "2026-08-20T09:00:00Z", author: "Maya Khan" },
  ];
  dismissStaleApprovals = false;
  commitQuery = null;

  globalThis.fetch = (async (input, init) => {
    const requestUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const url = new URL(requestUrl);
    const headers =
      input instanceof Request ? input.headers : new Headers(init?.headers);
    const method =
      input instanceof Request ? input.method : (init?.method ?? "GET");
    const path = url.pathname;

    if (path === "/api/v1/user") {
      const auth = headers.get("Authorization") ?? "";
      const token = auth.startsWith("token ") ? auth.slice(6) : "";
      const login = giteaLoginsByToken.get(token);
      const user = login ? giteaUsersByLogin.get(login) : null;
      if (!user) return json({ message: "Not found" }, 404);
      return json({ ...user, full_name: "", is_admin: false });
    }

    const prMatch = path.match(
      /^\/api\/v1\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)$/,
    );
    if (prMatch && method === "GET") {
      return json({
        number: Number(prMatch[3]),
        state: "open",
        base: { ref: "main" },
        head: headRef === null ? undefined : { ref: headRef },
      });
    }

    if (/\/pulls\/\d+\/reviews$/.test(path) && method === "GET") {
      return json([]);
    }

    if (path.endsWith("/commits") && method === "GET") {
      // The route asks for the commits the change's branch has and the base
      // does not; anything else means it went back to the broken path filter.
      commitQuery = {
        sha: url.searchParams.get("sha"),
        not: url.searchParams.get("not"),
        path: url.searchParams.get("path"),
      };
      return json(
        commits.map((entry) => ({
          sha: entry.sha,
          commit: {
            message: "Upload",
            author: { name: entry.author, date: entry.date },
          },
        })),
      );
    }

    if (path.endsWith("/branch_protections") && method === "GET") {
      return json([
        {
          rule_name: "main",
          required_approvals: 2,
          dismiss_stale_approvals: dismissStaleApprovals,
        },
      ]);
    }

    const repoMatch = path.match(/^\/api\/v1\/repos\/([^/]+)\/([^/]+)$/);
    if (repoMatch && method === "GET") {
      return json({
        id: 1,
        name: repoMatch[2],
        full_name: `${repoMatch[1]}/${repoMatch[2]}`,
        private: true,
        permissions: { admin: true, push: true, pull: true },
      });
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
  giteaUsersByLogin.set(username, {
    login: username,
    email: `${username}@test.local`,
  });
  giteaLoginsByToken.set(giteaToken, username);
  await sessionStore.put({
    id: sessionId,
    username,
    giteaToken,
    giteaTokenName: "upd-test-token",
    createdAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  });
  await subscriptionStore.upsert({
    username,
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

const OWNER = "alice";
const REPO = "contract";
const UPDATES = `/api/app/documents/${OWNER}/${REPO}/pull-requests/3/updates`;

function request(sessionId: string): Request {
  return new Request(`http://localhost${UPDATES}`, {
    headers: {
      Origin: config.appOrigin,
      Cookie: `${config.sessionCookieName}=${sessionId}`,
    },
  });
}

describe("change updates route", () => {
  test("numbers the branch's commits oldest first", async () => {
    const server = createApiServer();
    const session = await seedSession(OWNER);

    const response = await server.fetch(request(session));
    const payload = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(payload.updates).toEqual([
      {
        index: 1,
        sha: "sha-a",
        author: "Maya Khan",
        at: "2026-08-20T09:00:00Z",
      },
      {
        index: 2,
        sha: "sha-b",
        author: "Maya Khan",
        at: "2026-08-21T09:00:00Z",
      },
    ]);
  });

  test("reports whether an update resets approvals", async () => {
    dismissStaleApprovals = true;
    const server = createApiServer();
    const session = await seedSession(OWNER);

    const payload = (await (
      await server.fetch(request(session))
    ).json()) as any;

    expect(payload.resetsApprovals).toBe(true);
  });

  test("a change whose branch is gone has no updates left to list", async () => {
    headRef = null;
    const server = createApiServer();
    const session = await seedSession(OWNER);

    const response = await server.fetch(request(session));
    const payload = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(payload).toEqual({ updates: [], resetsApprovals: false });
  });

  test("asks Gitea for the branch's own commits, not a path history", async () => {
    const server = createApiServer();
    const session = await seedSession(OWNER);

    await server.fetch(request(session));

    // Gitea's `path` filter on this endpoint returns only the newest matching
    // commit, which would report every change as having exactly one update.
    expect(commitQuery).toEqual({
      sha: "upload/v2",
      not: "main",
      path: null,
    });
  });

  test("the route needs a session", async () => {
    const server = createApiServer();

    const response = await server.fetch(
      new Request(`http://localhost${UPDATES}`, {
        headers: { Origin: config.appOrigin },
      }),
    );

    expect(response.status).toBe(401);
  });
});
