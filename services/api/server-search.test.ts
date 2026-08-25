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

describe("GET /api/app/documents with search query", () => {
  test("no query param uses listWorkspaceRepos (no filters on search)", async () => {
    const server = await createApiServer();
    const sessionId = await seedSession("alice");
    const aliceUser = giteaUsersByLogin.get("alice")!;

    seedGiteaRepo({
      name: "doc-alpha",
      owner: { id: aliceUser.id, login: "alice" },
      private: true,
    });
    seedGiteaRepo({
      name: "doc-beta",
      owner: { id: aliceUser.id, login: "alice" },
      private: true,
    });

    const response = await server.fetch(
      makeSessionRequest("/api/app/documents", sessionId),
    );

    expect(response.status).toBe(200);
    // listWorkspaceRepos uses /repos/search with no filters
    const searchCalls = fetchCalls.filter(
      (call) => call.path === "/api/v1/repos/search",
    );
    expect(searchCalls.length).toBe(1);
    expect(searchCalls[0]!.queryParams.get("q")).toBeNull();
    expect(searchCalls[0]!.queryParams.get("uid")).toBeNull();
    expect(searchCalls[0]!.queryParams.get("exclusive")).toBeNull();
  });

  test("no query params resolves to no filters", async () => {
    const server = await createApiServer();
    const sessionId = await seedSession("alice");
    const aliceUser = giteaUsersByLogin.get("alice")!;

    seedGiteaRepo({
      name: "doc-alpha",
      owner: { id: aliceUser.id, login: "alice" },
      private: true,
    });

    const response = await server.fetch(
      makeSessionRequest("/api/app/documents", sessionId),
    );

    expect(response.status).toBe(200);
    // no query params — uses listWorkspaceRepos (/repos/search with no filters)
    const searchCalls = fetchCalls.filter(
      (call) => call.path === "/api/v1/repos/search",
    );
    expect(searchCalls.length).toBe(1);
    expect(searchCalls[0]!.queryParams.get("q")).toBeNull();
    expect(searchCalls[0]!.queryParams.get("uid")).toBeNull();
    expect(searchCalls[0]!.queryParams.get("exclusive")).toBeNull();
  });

  test("owner:@me resolves to session username and exclusive=true", async () => {
    const server = await createApiServer();
    const sessionId = await seedSession("alice");
    const aliceUser = giteaUsersByLogin.get("alice")!;

    seedGiteaRepo({
      name: "doc-alpha",
      owner: { id: aliceUser.id, login: "alice" },
      private: true,
    });

    // Frontend resolves @me → "alice" before sending
    const response = await server.fetch(
      makeSessionRequest("/api/app/documents", sessionId, {
        queryParams: { owner: "alice" },
      }),
    );

    expect(response.status).toBe(200);
    const searchCalls = fetchCalls.filter(
      (call) => call.path === "/api/v1/repos/search",
    );
    expect(searchCalls.length).toBe(1);
    expect(searchCalls[0]!.queryParams.get("uid")).toBe(
      aliceUser.id.toString(),
    );
    expect(searchCalls[0]!.queryParams.get("exclusive")).toBe("true");
    expect(searchCalls[0]!.queryParams.get("q")).toBeNull();
  });

  test("owner:@username resolves to specified username and exclusive=true", async () => {
    const server = await createApiServer();
    const sessionId = await seedSession("alice");
    const bobUser = seedGiteaUser({ login: "bob", email: "bob@example.com" });

    seedGiteaRepo({
      name: "doc-bob-1",
      owner: { id: bobUser.id, login: "bob" },
      private: true,
    });

    // Frontend resolves @bob → "bob" before sending
    const response = await server.fetch(
      makeSessionRequest("/api/app/documents", sessionId, {
        queryParams: { owner: "bob" },
      }),
    );

    expect(response.status).toBe(200);
    const searchCalls = fetchCalls.filter(
      (call) => call.path === "/api/v1/repos/search",
    );
    expect(searchCalls.length).toBe(1);
    expect(searchCalls[0]!.queryParams.get("uid")).toBe(bobUser.id.toString());
    expect(searchCalls[0]!.queryParams.get("exclusive")).toBe("true");
  });

  test("contributed-by:@me resolves to session username without exclusive", async () => {
    const server = await createApiServer();
    const sessionId = await seedSession("alice");
    const aliceUser = giteaUsersByLogin.get("alice")!;

    seedGiteaRepo({
      name: "doc-alpha",
      owner: { id: aliceUser.id, login: "alice" },
      private: true,
    });

    // Frontend resolves @me → "alice" before sending
    const response = await server.fetch(
      makeSessionRequest("/api/app/documents", sessionId, {
        queryParams: { member: "alice" },
      }),
    );

    expect(response.status).toBe(200);
    const searchCalls = fetchCalls.filter(
      (call) => call.path === "/api/v1/repos/search",
    );
    expect(searchCalls.length).toBe(1);
    expect(searchCalls[0]!.queryParams.get("uid")).toBe(
      aliceUser.id.toString(),
    );
    expect(searchCalls[0]!.queryParams.get("exclusive")).toBeNull();
  });

  test("contributed-by:@username resolves to specified username without exclusive", async () => {
    const server = await createApiServer();
    const sessionId = await seedSession("alice");
    const bobUser = seedGiteaUser({ login: "bob", email: "bob@example.com" });

    seedGiteaRepo({
      name: "doc-bob-1",
      owner: { id: bobUser.id, login: "bob" },
      private: true,
    });

    // Frontend resolves @bob → "bob" before sending
    const response = await server.fetch(
      makeSessionRequest("/api/app/documents", sessionId, {
        queryParams: { member: "bob" },
      }),
    );

    expect(response.status).toBe(200);
    const searchCalls = fetchCalls.filter(
      (call) => call.path === "/api/v1/repos/search",
    );
    expect(searchCalls.length).toBe(1);
    expect(searchCalls[0]!.queryParams.get("uid")).toBe(bobUser.id.toString());
    expect(searchCalls[0]!.queryParams.get("exclusive")).toBeNull();
  });

  test("owner:@me with free text passes freeText to q param", async () => {
    const server = await createApiServer();
    const sessionId = await seedSession("alice");
    const aliceUser = giteaUsersByLogin.get("alice")!;

    seedGiteaRepo({
      name: "doc-alpha",
      owner: { id: aliceUser.id, login: "alice" },
      description: "hello world",
      private: true,
    });

    // Frontend resolves "owner:@me hello world" → { ownerUsername: "alice", freeText: "hello world" }
    const response = await server.fetch(
      makeSessionRequest("/api/app/documents", sessionId, {
        queryParams: { owner: "alice", q: "hello world" },
      }),
    );

    expect(response.status).toBe(200);
    const searchCalls = fetchCalls.filter(
      (call) => call.path === "/api/v1/repos/search",
    );
    expect(searchCalls.length).toBe(1);
    expect(searchCalls[0]!.queryParams.get("uid")).toBe(
      aliceUser.id.toString(),
    );
    expect(searchCalls[0]!.queryParams.get("exclusive")).toBe("true");
    expect(searchCalls[0]!.queryParams.get("q")).toBe("hello world");
  });

  test("contributed-by:@me with free text passes freeText to q param", async () => {
    const server = await createApiServer();
    const sessionId = await seedSession("alice");
    const aliceUser = giteaUsersByLogin.get("alice")!;

    seedGiteaRepo({
      name: "doc-alpha",
      owner: { id: aliceUser.id, login: "alice" },
      description: "some query",
      private: true,
    });

    // Frontend resolves "contributed-by:@me some query" → { memberUsername: "alice", freeText: "some query" }
    const response = await server.fetch(
      makeSessionRequest("/api/app/documents", sessionId, {
        queryParams: { member: "alice", q: "some query" },
      }),
    );

    expect(response.status).toBe(200);
    const searchCalls = fetchCalls.filter(
      (call) => call.path === "/api/v1/repos/search",
    );
    expect(searchCalls.length).toBe(1);
    expect(searchCalls[0]!.queryParams.get("uid")).toBe(
      aliceUser.id.toString(),
    );
    expect(searchCalls[0]!.queryParams.get("exclusive")).toBeNull();
    expect(searchCalls[0]!.queryParams.get("q")).toBe("some query");
  });

  test("both owner and contributed-by: owner takes precedence (exclusive=true)", async () => {
    const server = await createApiServer();
    const sessionId = await seedSession("alice");
    const aliceUser = giteaUsersByLogin.get("alice")!;
    const bobUser = seedGiteaUser({ login: "bob", email: "bob@example.com" });

    seedGiteaRepo({
      name: "doc-alpha",
      owner: { id: aliceUser.id, login: "alice" },
      private: true,
    });

    // Frontend sends both; searchWorkspaceRepos uses ownerUsername ?? memberUsername
    const response = await server.fetch(
      makeSessionRequest("/api/app/documents", sessionId, {
        queryParams: { owner: "alice", member: "bob" },
      }),
    );

    expect(response.status).toBe(200);
    const searchCalls = fetchCalls.filter(
      (call) => call.path === "/api/v1/repos/search",
    );
    expect(searchCalls.length).toBe(1);
    // ownerUsername takes precedence over memberUsername
    expect(searchCalls[0]!.queryParams.get("uid")).toBe(
      aliceUser.id.toString(),
    );
    expect(searchCalls[0]!.queryParams.get("exclusive")).toBe("true");
  });

  test("free text without owner or contributed-by searches all repos", async () => {
    const server = await createApiServer();
    const sessionId = await seedSession("alice");
    const aliceUser = giteaUsersByLogin.get("alice")!;

    seedGiteaRepo({
      name: "doc-alpha",
      owner: { id: aliceUser.id, login: "alice" },
      description: "foobar",
      private: true,
    });

    const response = await server.fetch(
      makeSessionRequest("/api/app/documents", sessionId, {
        queryParams: { q: "foobar" },
      }),
    );

    expect(response.status).toBe(200);
    const searchCalls = fetchCalls.filter(
      (call) => call.path === "/api/v1/repos/search",
    );
    expect(searchCalls.length).toBe(1);
    expect(searchCalls[0]!.queryParams.get("q")).toBe("foobar");
    expect(searchCalls[0]!.queryParams.get("uid")).toBeNull();
    expect(searchCalls[0]!.queryParams.get("exclusive")).toBeNull();
  });

  test("@me is resolved in owner query", async () => {
    const server = await createApiServer();
    const sessionId = await seedSession("alice");
    const aliceUser = giteaUsersByLogin.get("alice")!;

    seedGiteaRepo({
      name: "doc-alpha",
      owner: { id: aliceUser.id, login: "alice" },
      private: true,
    });

    // Frontend resolves @me → "alice"; backend receives the plain username
    const response = await server.fetch(
      makeSessionRequest("/api/app/documents", sessionId, {
        queryParams: { owner: "alice" },
      }),
    );

    expect(response.status).toBe(200);
    const searchCalls = fetchCalls.filter(
      (call) => call.path === "/api/v1/repos/search",
    );
    expect(searchCalls.length).toBe(1);
    expect(searchCalls[0]!.queryParams.get("uid")).toBe(
      aliceUser.id.toString(),
    );
  });

  test("@ prefix is stripped from usernames", async () => {
    const server = await createApiServer();
    const sessionId = await seedSession("alice");
    const bobUser = seedGiteaUser({ login: "bob", email: "bob@example.com" });

    seedGiteaRepo({
      name: "doc-bob-1",
      owner: { id: bobUser.id, login: "bob" },
      private: true,
    });

    // Frontend strips @ from "@bob" → "bob" before sending
    const response = await server.fetch(
      makeSessionRequest("/api/app/documents", sessionId, {
        queryParams: { owner: "bob" },
      }),
    );

    expect(response.status).toBe(200);
    const userLookupCalls = fetchCalls.filter(
      (call) => call.path === "/api/v1/users/bob",
    );
    expect(userLookupCalls.length).toBe(1);
  });
});

/**
 * Quick find's endpoint. It answers with repo rows and nothing else: no tags,
 * no open changes, no approval policy — that is what makes it cheap enough to
 * call on a keystroke, and the assertion below is what keeps it that way.
 */
describe("GET /api/app/documents/search", () => {
  test("returns one page of matches with the paging flag set", async () => {
    const server = await createApiServer();
    const sessionId = await seedSession("alice");
    const aliceUser = giteaUsersByLogin.get("alice")!;

    for (const name of ["doc-alpha", "doc-beta", "doc-gamma"]) {
      seedGiteaRepo({
        name,
        owner: { id: aliceUser.id, login: "alice" },
        private: true,
      });
    }

    const response = await server.fetch(
      makeSessionRequest("/api/app/documents/search", sessionId, {
        queryParams: { q: "doc", limit: "2" },
      }),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      documents: { name: string; owner: { login: string } }[];
      page: number;
      limit: number;
      hasMore: boolean;
    };

    expect(payload.documents.map((doc) => doc.name)).toEqual([
      "doc-alpha",
      "doc-beta",
    ]);
    expect(payload.documents[0]!.owner.login).toBe("alice");
    expect(payload).toMatchObject({ page: 1, limit: 2, hasMore: true });
  });

  test("a later page continues where the previous one stopped", async () => {
    const server = await createApiServer();
    const sessionId = await seedSession("alice");
    const aliceUser = giteaUsersByLogin.get("alice")!;

    for (const name of ["doc-alpha", "doc-beta", "doc-gamma"]) {
      seedGiteaRepo({
        name,
        owner: { id: aliceUser.id, login: "alice" },
        private: true,
      });
    }

    const response = await server.fetch(
      makeSessionRequest("/api/app/documents/search", sessionId, {
        queryParams: { q: "doc", limit: "2", page: "2" },
      }),
    );

    const payload = (await response.json()) as {
      documents: { name: string }[];
      page: number;
      hasMore: boolean;
    };

    expect(payload.documents.map((doc) => doc.name)).toEqual(["doc-gamma"]);
    expect(payload).toMatchObject({ page: 2, hasMore: false });
  });

  test("does not fan out per document the way the library listing does", async () => {
    const server = await createApiServer();
    const sessionId = await seedSession("alice");
    const aliceUser = giteaUsersByLogin.get("alice")!;

    seedGiteaRepo({
      name: "doc-alpha",
      owner: { id: aliceUser.id, login: "alice" },
      private: true,
    });

    await server.fetch(
      makeSessionRequest("/api/app/documents/search", sessionId, {
        queryParams: { q: "doc" },
      }),
    );

    expect(
      fetchCalls.filter((call) => call.path.endsWith("/tags")),
    ).toHaveLength(0);
    expect(
      fetchCalls.filter((call) => call.path.endsWith("/pulls")),
    ).toHaveLength(0);
  });

  test("a search for nothing is a bad request, not an empty library", async () => {
    const server = await createApiServer();
    const sessionId = await seedSession("alice");

    const response = await server.fetch(
      makeSessionRequest("/api/app/documents/search", sessionId, {
        queryParams: { q: "  " },
      }),
    );

    expect(response.status).toBe(400);
  });

  test("an unauthenticated reader gets nothing", async () => {
    const server = await createApiServer();

    const response = await server.fetch(
      new Request("http://localhost/api/app/documents/search?q=doc"),
    );

    expect(response.status).toBe(401);
  });
});
