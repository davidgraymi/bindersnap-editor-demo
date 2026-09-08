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

type MockedFetchCall = {
  path: string;
  method: string;
  queryParams: URLSearchParams;
  body: string | null;
};

type MockedGiteaUser = {
  id: number;
  login: string;
  email: string;
  fullName?: string;
  isAdmin?: boolean;
};

type MockedGiteaRepo = {
  id: number;
  name: string;
  owner: { id: number; login: string };
  description?: string;
  private: boolean;
};

const originalFetch = globalThis.fetch;
const originalApiPort = config.apiPort;
const originalStripeSecretKey = config.stripeSecretKey;
const originalStripeWebhookSecret = config.stripeWebhookSecret;
const originalStripePriceId = config.stripePriceId;
const originalSessionsDbPath = config.sessionsDbPath;
const originalBypassSubscriptionForUsers = config.bypassSubscriptionForUsers;

let fetchCalls: MockedFetchCall[] = [];
let giteaUsersByLogin = new Map<string, MockedGiteaUser>();
let giteaUsersById = new Map<number, MockedGiteaUser>();
let giteaLoginsByToken = new Map<string, string>();
let giteaRepos: MockedGiteaRepo[] = [];

beforeEach(() => {
  config.apiPort = 0;
  config.stripeSecretKey = "sk_test_bindersnap";
  config.stripeWebhookSecret = "whsec_test_bindersnap";
  config.stripePriceId = "price_test_bindersnap";
  config.sessionsDbPath = `/tmp/bindersnap-server-search-test-${randomUUID()}.sqlite`;
  config.bypassSubscriptionForUsers = [];
  resetStripeClientForTests();

  (sessionStore as { _store: SessionStore | null })._store = new SessionStore(
    config.sessionsDbPath,
  );
  (subscriptionStore as { _store: SubscriptionStore | null })._store =
    new SubscriptionStore(config.sessionsDbPath);
  (webhookEventStore as { _store: WebhookEventStore | null })._store =
    new WebhookEventStore(config.sessionsDbPath);

  fetchCalls = [];
  giteaUsersByLogin = new Map();
  giteaUsersById = new Map();
  giteaLoginsByToken = new Map();
  giteaRepos = [];

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
    const body =
      typeof init?.body === "string"
        ? init.body
        : init?.body instanceof URLSearchParams
          ? init.body.toString()
          : null;

    fetchCalls.push({
      path: url.pathname,
      method: init?.method ?? "GET",
      queryParams: url.searchParams,
      body,
    });

    // Mock /api/v1/user (current authenticated user)
    if (url.pathname === "/api/v1/user") {
      const authHeader = headers.get("Authorization") ?? "";
      const token = authHeader.startsWith("token ")
        ? authHeader.slice("token ".length)
        : "";
      const login = giteaLoginsByToken.get(token);
      const user = login ? giteaUsersByLogin.get(login) : null;

      if (!user) {
        return new Response(JSON.stringify({ message: "Not found" }), {
          status: 404,
          headers: {
            "Content-Type": "application/json",
          },
        });
      }

      return new Response(
        JSON.stringify({
          id: user.id,
          login: user.login,
          email: user.email,
          full_name: user.fullName ?? "",
          is_admin: user.isAdmin === true,
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
    }

    // Mock /api/v1/users/{username} (lookup user by username)
    if (
      url.pathname.startsWith("/api/v1/users/") &&
      !url.pathname.includes("/search")
    ) {
      const username = url.pathname.slice("/api/v1/users/".length);
      const user = giteaUsersByLogin.get(username);

      if (!user) {
        return new Response(JSON.stringify({ message: "Not found" }), {
          status: 404,
          headers: {
            "Content-Type": "application/json",
          },
        });
      }

      return new Response(
        JSON.stringify({
          id: user.id,
          login: user.login,
          email: user.email,
          full_name: user.fullName ?? "",
          is_admin: user.isAdmin === true,
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
    }

    // Mock /api/v1/repos/search
    if (url.pathname === "/api/v1/repos/search") {
      const qParam = url.searchParams.get("q")?.toLowerCase() ?? "";
      const uidParam = url.searchParams.get("uid");
      const exclusiveParam = url.searchParams.get("exclusive") === "true";

      let filtered = giteaRepos;

      // Filter by uid (owner or member)
      if (uidParam) {
        const uid = Number.parseInt(uidParam, 10);
        if (exclusiveParam) {
          // Exclusive = only repos owned by this user
          filtered = filtered.filter((repo) => repo.owner.id === uid);
        } else {
          // Non-exclusive = repos owned by OR where user is member (for simplicity, just owner)
          filtered = filtered.filter((repo) => repo.owner.id === uid);
        }
      }

      // Filter by free text query
      if (qParam) {
        filtered = filtered.filter(
          (repo) =>
            repo.name.toLowerCase().includes(qParam) ||
            (repo.description ?? "").toLowerCase().includes(qParam),
        );
      }

      // Gitea pages its repo search; quick find is the caller that relies on it.
      const limitParam = Number.parseInt(
        url.searchParams.get("limit") ?? "100",
        10,
      );
      const pageParam = Number.parseInt(
        url.searchParams.get("page") ?? "1",
        10,
      );
      const start = (pageParam - 1) * limitParam;
      filtered = filtered.slice(start, start + limitParam);

      return new Response(
        JSON.stringify({
          ok: true,
          data: filtered.map((repo) => ({
            id: repo.id,
            name: repo.name,
            owner: {
              id: repo.owner.id,
              login: repo.owner.login,
            },
            description: repo.description ?? "",
            private: repo.private,
            html_url: `https://git.bindersnap.com/${repo.owner.login}/${repo.name}`,
          })),
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
    }

    // Mock /api/v1/user/repos (list current user's repos)
    if (url.pathname === "/api/v1/user/repos") {
      const authHeader = headers.get("Authorization") ?? "";
      const token = authHeader.startsWith("token ")
        ? authHeader.slice("token ".length)
        : "";
      const login = giteaLoginsByToken.get(token);
      const user = login ? giteaUsersByLogin.get(login) : null;

      if (!user) {
        console.log("DEBUG: /api/v1/user/repos 401", {
          token,
          availableTokens: Array.from(giteaLoginsByToken.keys()),
          authHeader,
          init,
        });
        return new Response(JSON.stringify({ message: "Unauthorized" }), {
          status: 401,
          headers: {
            "Content-Type": "application/json",
          },
        });
      }

      const userRepos = giteaRepos.filter((repo) => repo.owner.id === user.id);

      return new Response(
        JSON.stringify(
          userRepos.map((repo) => ({
            id: repo.id,
            name: repo.name,
            owner: {
              id: repo.owner.id,
              login: repo.owner.login,
            },
            description: repo.description ?? "",
            private: repo.private,
            html_url: `https://git.bindersnap.com/${repo.owner.login}/${repo.name}`,
          })),
        ),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
    }

    // Mock /api/v1/repos/{owner}/{repo}/tags
    if (url.pathname.match(/^\/api\/v1\/repos\/[^/]+\/[^/]+\/tags$/)) {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      });
    }

    // Mock /api/v1/repos/{owner}/{repo}/pulls
    if (url.pathname.match(/^\/api\/v1\/repos\/[^/]+\/[^/]+\/pulls$/)) {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      });
    }

    // Default Stripe response
    const responseUrl = url.pathname.includes("billing_portal")
      ? "https://billing.stripe.com/p/session/test_123"
      : "https://checkout.stripe.com/c/pay/test_123";

    return new Response(JSON.stringify({ url: responseUrl }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  config.apiPort = originalApiPort;
  config.stripeSecretKey = originalStripeSecretKey;
  config.stripeWebhookSecret = originalStripeWebhookSecret;
  config.stripePriceId = originalStripePriceId;
  config.sessionsDbPath = originalSessionsDbPath;
  config.bypassSubscriptionForUsers = originalBypassSubscriptionForUsers;
});

async function seedSession(
  username: string,
  options?: {
    email?: string;
    fullName?: string;
    isAdmin?: boolean;
  },
): Promise<string> {
  const sessionId = `sess_${randomUUID()}`;
  const giteaToken = `gitea_token_${randomUUID()}`;
  const email =
    options?.email ?? `${username.toLowerCase()}@${config.emailDomain}`;

  const userId = giteaUsersByLogin.size + 1;
  const user: MockedGiteaUser = {
    id: userId,
    login: username,
    email,
    fullName: options?.fullName,
    isAdmin: options?.isAdmin === true,
  };

  giteaUsersByLogin.set(username, user);
  giteaUsersById.set(userId, user);
  giteaLoginsByToken.set(giteaToken, username);
  await sessionStore.put({
    id: sessionId,
    username,
    giteaToken,
    giteaTokenName: "bindersnap-test-token",
    createdAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  });

  // Bypass subscription check for this user
  config.bypassSubscriptionForUsers.push(username);

  return sessionId;
}

function seedGiteaUser(user: Omit<MockedGiteaUser, "id">): MockedGiteaUser {
  const userId = giteaUsersByLogin.size + 1;
  const fullUser = { ...user, id: userId };
  giteaUsersByLogin.set(user.login, fullUser);
  giteaUsersById.set(userId, fullUser);
  return fullUser;
}

function seedGiteaRepo(repo: Omit<MockedGiteaRepo, "id">): MockedGiteaRepo {
  const repoId = giteaRepos.length + 1;
  const fullRepo = { ...repo, id: repoId };
  giteaRepos.push(fullRepo);
  return fullRepo;
}

function makeSessionRequest(
  pathname: string,
  sessionId: string,
  options?: {
    method?: string;
    queryParams?: Record<string, string>;
    body?: Record<string, unknown>;
  },
): Request {
  const method = options?.method ?? "GET";
  const body = options?.body;
  let url = `http://localhost${pathname}`;
  if (options?.queryParams) {
    const qs = new URLSearchParams(options.queryParams);
    url += `?${qs.toString()}`;
  }

  return new Request(url, {
    method,
    headers: {
      Origin: config.appOrigin,
      Cookie: `${config.sessionCookieName}=${sessionId}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

/**
 * What this file used to cover, and why most of it is gone.
 *
 * The library and the nav's quick find were both searches over Gitea
 * *repositories*, because a document was one — so a test could mock
 * `/repos/search` and assert which `uid`, `exclusive` and `q` came back out.
 * Under ADR 0004 a document is a file inside a binder, and the same two screens
 * are answered by walking each binder the reader can reach: its tree, its open
 * changes and its tags.
 *
 * Mocking that faithfully would be reimplementing Gitea, and a mock detailed
 * enough to be worth trusting is a mock that can be wrong in its own way. So
 * the behaviour is proved against a real stack in
 * `tests/workspace-provisioning.pw.ts`, and what stays here is what genuinely
 * has no Gitea in it — the two answers given before anything is fetched.
 */
describe("GET /api/app/documents/search", () => {
  test("a search for nothing is a bad request, not an empty library", async () => {
    const user = seedGiteaUser({ login: "alice", email: "alice@example.com" });
    const sessionId = await seedSession(user.login);
    const server = createApiServer();

    const response = await server.fetch(
      makeSessionRequest("/api/app/documents/search", sessionId, {
        queryParams: { q: "   " },
      }),
    );

    expect(response.status).toBe(400);
    // Asserted because it is the guarantee the route depends on: the check runs
    // before a single binder is read, so an empty box costs nothing.
    expect(
      fetchCalls.some((call) => call.path.includes("/repos/")),
      "an empty query reached Gitea",
    ).toBe(false);
  });

  test("an unauthenticated reader gets nothing", async () => {
    const server = createApiServer();

    const response = await server.fetch(
      new Request("http://localhost/api/app/documents/search?q=policy", {
        headers: { Origin: config.appOrigin },
      }),
    );

    expect(response.status).toBe(401);
  });
});
