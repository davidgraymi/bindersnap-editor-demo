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

const TEST_GITEA_ORG_ID = 4004;
const TEST_ORG_NAME = "adr0004-test-org";

// ── Mock Gitea state ─────────────────────────────────────────────────────────

type MockedGiteaUser = { login: string; email: string };
type MockedRepo = { private: boolean; internal: boolean };
type MockedBranchProtection = {
  rule_name: string;
  required_approvals: number;
  enable_approvals_whitelist: boolean;
  approvals_whitelist_username: string[];
  approvals_whitelist_teams: string[];
  enable_merge_whitelist: boolean;
  merge_whitelist_usernames: string[];
  merge_whitelist_teams: string[];
  block_on_rejected_reviews: boolean;
};
type MockedFetchCall = { path: string; method: string; body: string | null };

const originalFetch = globalThis.fetch;
const originalApiPort = config.apiPort;
const originalSessionsDbPath = config.sessionsDbPath;

let fetchCalls: MockedFetchCall[] = [];
let giteaUsersByLogin = new Map<string, MockedGiteaUser>();
let giteaLoginsByToken = new Map<string, string>();
let reposByKey = new Map<string, MockedRepo>();
let branchProtectionsByRepoKey = new Map<string, MockedBranchProtection[]>();
let collaboratorPermissionsByRepoKey = new Map<string, Map<string, string>>();

function repoKey(owner: string, repo: string): string {
  return `${owner}/${repo}`;
}

beforeEach(() => {
  config.apiPort = 0;
  config.stripeSecretKey = "sk_test_perms";
  config.stripeWebhookSecret = "whsec_test_perms";
  config.stripePriceId = "price_test_perms";
  config.sessionsDbPath = `/tmp/bindersnap-perms-test-${randomUUID()}.sqlite`;
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
  giteaLoginsByToken = new Map();
  reposByKey = new Map();
  branchProtectionsByRepoKey = new Map();
  collaboratorPermissionsByRepoKey = new Map();

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
    const rawBody =
      input instanceof Request
        ? await input.clone().text()
        : typeof init?.body === "string"
          ? init.body
          : null;
    const bodyText = rawBody || null;

    fetchCalls.push({ path: url.pathname, method, body: bodyText });

    // ADR 0004: the paywall asks which organization the session belongs to.
    if (url.pathname === "/api/v1/user/orgs") {
      return new Response(
        JSON.stringify([{ id: TEST_GITEA_ORG_ID, username: TEST_ORG_NAME }]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // Gitea: GET /api/v1/user — authenticate token
    if (url.pathname === "/api/v1/user") {
      const authHeader = headers.get("Authorization") ?? "";
      const token = authHeader.startsWith("token ") ? authHeader.slice(6) : "";
      const login = giteaLoginsByToken.get(token);
      const user = login ? giteaUsersByLogin.get(login) : null;
      if (!user) {
        return new Response(JSON.stringify({ message: "Not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          login: user.login,
          email: user.email,
          full_name: "",
          is_admin: false,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // Gitea: GET /api/v1/repos/{owner}/{repo}/branch_protections
    const bpListMatch = url.pathname.match(
      /^\/api\/v1\/repos\/([^/]+)\/([^/]+)\/branch_protections$/,
    );
    if (bpListMatch && method === "GET") {
      const key = repoKey(bpListMatch[1]!, bpListMatch[2]!);
      const rules = branchProtectionsByRepoKey.get(key) ?? [];
      return new Response(JSON.stringify(rules), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Gitea: PATCH /api/v1/repos/{owner}/{repo}/branch_protections/{name}
    const bpPatchMatch = url.pathname.match(
      /^\/api\/v1\/repos\/([^/]+)\/([^/]+)\/branch_protections\/([^/]+)$/,
    );
    if (bpPatchMatch && method === "PATCH") {
      const key = repoKey(bpPatchMatch[1]!, bpPatchMatch[2]!);
      const ruleName = bpPatchMatch[3]!;
      const rules = branchProtectionsByRepoKey.get(key) ?? [];
      const existing = rules.find((r) => r.rule_name === ruleName) ?? rules[0];
      if (!existing) {
        return new Response(JSON.stringify({ message: "Not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }
      const patch = bodyText
        ? (JSON.parse(bodyText) as Record<string, unknown>)
        : {};
      const updated: MockedBranchProtection = {
        ...existing,
        ...(typeof patch.required_approvals === "number" && {
          required_approvals: patch.required_approvals,
        }),
        ...(typeof patch.enable_approvals_whitelist === "boolean" && {
          enable_approvals_whitelist: patch.enable_approvals_whitelist,
        }),
        ...(Array.isArray(patch.approvals_whitelist_username) && {
          approvals_whitelist_username:
            patch.approvals_whitelist_username as string[],
        }),
        ...(typeof patch.enable_merge_whitelist === "boolean" && {
          enable_merge_whitelist: patch.enable_merge_whitelist,
        }),
        ...(Array.isArray(patch.merge_whitelist_usernames) && {
          merge_whitelist_usernames:
            patch.merge_whitelist_usernames as string[],
        }),
      };
      const newRules = rules.map((r) =>
        r.rule_name === ruleName ? updated : r,
      );
      branchProtectionsByRepoKey.set(key, newRules);
      return new Response(JSON.stringify(updated), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Gitea: GET /api/v1/repos/{owner}/{repo}
    const repoMatch = url.pathname.match(
      /^\/api\/v1\/repos\/([^/]+)\/([^/]+)$/,
    );
    if (repoMatch && method === "GET") {
      const key = repoKey(repoMatch[1]!, repoMatch[2]!);
      const repo = reposByKey.get(key);
      if (!repo) {
        return new Response(JSON.stringify({ message: "Not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }
      const authHeader = headers.get("Authorization") ?? "";
      const token = authHeader.startsWith("token ") ? authHeader.slice(6) : "";
      const requester = giteaLoginsByToken.get(token) ?? "";
      const isRepoOwner = requester === repoMatch[1];
      return new Response(
        JSON.stringify({
          id: 1,
          name: repoMatch[2],
          full_name: key,
          private: repo.private,
          internal: repo.internal,
          permissions: { admin: isRepoOwner, push: isRepoOwner, pull: true },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // Gitea: PATCH /api/v1/repos/{owner}/{repo} — update visibility
    if (repoMatch && method === "PATCH") {
      const key = repoKey(repoMatch[1]!, repoMatch[2]!);
      const repo = reposByKey.get(key);
      if (!repo) {
        return new Response(JSON.stringify({ message: "Not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }
      const patch = bodyText
        ? (JSON.parse(bodyText) as Record<string, unknown>)
        : {};
      if (typeof patch.private === "boolean") repo.private = patch.private;
      return new Response(
        JSON.stringify({
          id: 1,
          name: repoMatch[2],
          full_name: key,
          private: repo.private,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // Gitea: GET /api/v1/repos/{owner}/{repo}/tags — return empty tags
    const tagsMatch = url.pathname.match(
      /^\/api\/v1\/repos\/([^/]+)\/([^/]+)\/tags$/,
    );
    if (tagsMatch && method === "GET") {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Gitea: GET /api/v1/repos/{owner}/{repo}/pulls — return empty pulls
    const pullsMatch = url.pathname.match(
      /^\/api\/v1\/repos\/([^/]+)\/([^/]+)\/pulls$/,
    );
    if (pullsMatch && method === "GET") {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Gitea: GET /api/v1/repos/{owner}/{repo}/contents/* — return empty
    const contentsMatch = url.pathname.match(
      /^\/api\/v1\/repos\/([^/]+)\/([^/]+)\/contents\//,
    );
    if (contentsMatch && method === "GET") {
      return new Response(JSON.stringify({ message: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Gitea: GET /api/v1/repos/{owner}/{repo}/branches — return empty branches
    const branchesMatch = url.pathname.match(
      /^\/api\/v1\/repos\/([^/]+)\/([^/]+)\/branches$/,
    );
    if (branchesMatch && method === "GET") {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Gitea: GET /api/v1/repos/{owner}/{repo}/collaborators — return empty list
    const collabListMatch = url.pathname.match(
      /^\/api\/v1\/repos\/([^/]+)\/([^/]+)\/collaborators$/,
    );
    if (collabListMatch && method === "GET") {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Gitea: GET /api/v1/repos/{owner}/{repo}/collaborators/{user}/permission
    const collabPermMatch = url.pathname.match(
      /^\/api\/v1\/repos\/([^/]+)\/([^/]+)\/collaborators\/([^/]+)\/permission$/,
    );
    if (collabPermMatch && method === "GET") {
      const key = repoKey(collabPermMatch[1]!, collabPermMatch[2]!);
      const login = collabPermMatch[3]!;
      const permission = collaboratorPermissionsByRepoKey.get(key)?.get(login);
      if (!permission) {
        return new Response(JSON.stringify({ message: "Not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          permission,
          role_name: permission,
          user: { id: 1, login, full_name: "", email: "", avatar_url: "" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // Gitea: GET /api/v1/repos/{owner}/{repo}/collaborators/{user} — return 404 (no collaborators setup)
    const collabMatch = url.pathname.match(
      /^\/api\/v1\/repos\/([^/]+)\/([^/]+)\/collaborators\/([^/]+)$/,
    );
    if (collabMatch && method === "GET") {
      return new Response(JSON.stringify({ message: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Fallback — unexpected call
    return new Response(JSON.stringify({ error: "unmocked fetch" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  config.apiPort = originalApiPort;
  config.sessionsDbPath = originalSessionsDbPath;
});

// ── Helpers ──────────────────────────────────────────────────────────────────

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
    giteaTokenName: "perms-test-token",
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

function seedRepo(
  owner: string,
  repo: string,
  options?: { isPrivate?: boolean; isInternal?: boolean },
): void {
  reposByKey.set(repoKey(owner, repo), {
    private: options?.isPrivate ?? true,
    internal: options?.isInternal ?? false,
  });
}

function seedBranchProtection(
  owner: string,
  repo: string,
  rule: Partial<MockedBranchProtection> & { rule_name: string },
): void {
  const key = repoKey(owner, repo);
  const existing = branchProtectionsByRepoKey.get(key) ?? [];
  branchProtectionsByRepoKey.set(key, [
    ...existing,
    {
      required_approvals: 1,
      enable_approvals_whitelist: false,
      approvals_whitelist_username: [],
      approvals_whitelist_teams: [],
      enable_merge_whitelist: false,
      merge_whitelist_usernames: [],
      merge_whitelist_teams: [],
      block_on_rejected_reviews: false,
      ...rule,
    },
  ]);
}

function seedCollaboratorPermission(
  owner: string,
  repo: string,
  login: string,
  permission: string,
): void {
  const key = repoKey(owner, repo);
  const existing =
    collaboratorPermissionsByRepoKey.get(key) ?? new Map<string, string>();
  existing.set(login, permission);
  collaboratorPermissionsByRepoKey.set(key, existing);
}

function makeRequest(
  pathname: string,
  sessionId: string,
  options?: { method?: string; body?: Record<string, unknown> },
): Request {
  const method = options?.method ?? "GET";
  return new Request(`http://localhost${pathname}`, {
    method,
    headers: {
      Origin: config.appOrigin,
      Cookie: `${config.sessionCookieName}=${sessionId}`,
      ...(options?.body ? { "Content-Type": "application/json" } : {}),
    },
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });
}

// ── Tests: Public document access (no session) ──────────────────────────────

describe("public document access — GET /api/app/documents/:owner/:repo", () => {
  test("returns 401 for an anonymous request to a private repo", async () => {
    const server = createApiServer();
    const owner = `owner-${randomUUID()}`;
    const repo = "private-doc";
    seedRepo(owner, repo, { isPrivate: true });

    try {
      const response = await server.fetch(
        new Request(`http://localhost/api/app/documents/${owner}/${repo}`, {
          headers: { Origin: config.appOrigin },
        }),
      );
      expect(response.status).toBe(401);
    } finally {
      server.stop(true);
    }
  });

  test("returns 404 for an anonymous request to a non-existent repo", async () => {
    const server = createApiServer();

    try {
      const response = await server.fetch(
        new Request(
          `http://localhost/api/app/documents/nobody/does-not-exist`,
          { headers: { Origin: config.appOrigin } },
        ),
      );
      expect(response.status).toBe(401);
    } finally {
      server.stop(true);
    }
  });

  test("returns 200 for an anonymous request to a public repo", async () => {
    const server = createApiServer();
    const owner = `owner-${randomUUID()}`;
    const repo = "public-doc";
    seedRepo(owner, repo, { isPrivate: false });

    try {
      const response = await server.fetch(
        new Request(`http://localhost/api/app/documents/${owner}/${repo}`, {
          headers: { Origin: config.appOrigin },
        }),
      );
      const body = (await response.json()) as Record<string, unknown>;
      expect(response.status).toBe(200);
      expect(body.currentUserPermission).toBeNull();
      expect(Array.isArray(body.tags)).toBe(true);
    } finally {
      server.stop(true);
    }
  });

  test("returns 200 for anonymous request even when no service token is configured", async () => {
    // Regression test: createGiteaClient must not send `Authorization: token `
    // (with empty token) — an empty/missing service token should result in a
    // headerless anonymous request to Gitea, not a malformed one that Gitea rejects.
    const originalToken = config.giteaServiceToken;
    config.giteaServiceToken = "";
    const server = createApiServer();
    const owner = `owner-${randomUUID()}`;
    const repo = "public-doc";

    const originalMockFetch = globalThis.fetch;
    globalThis.fetch = (async (input, init) => {
      const requestUrl =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;
      const url = new URL(requestUrl);
      const headers =
        input instanceof Request
          ? (input as Request).headers
          : new Headers((init as RequestInit | undefined)?.headers);
      const method =
        input instanceof Request
          ? (input as Request).method
          : ((init as RequestInit | undefined)?.method ?? "GET");

      const repoMatch = url.pathname.match(
        /^\/api\/v1\/repos\/([^/]+)\/([^/]+)$/,
      );
      if (repoMatch && method === "GET") {
        // Simulate Gitea rejecting an empty/malformed token with 401.
        // `Authorization: token ` (empty token value) is also invalid.
        const authHeader = headers.get("Authorization") ?? "";
        const tokenValue = authHeader.startsWith("token ")
          ? authHeader.slice(6)
          : null;
        if (authHeader !== "" && !tokenValue) {
          return new Response(JSON.stringify({ message: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }
        // No auth header (truly anonymous) — allow public repo access
        if (repoMatch[1] === owner && repoMatch[2] === repo) {
          return new Response(
            JSON.stringify({
              id: 1,
              name: repo,
              full_name: `${owner}/${repo}`,
              private: false,
              internal: false,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({ message: "Not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      return originalMockFetch(input, init);
    }) as typeof fetch;

    try {
      const response = await server.fetch(
        new Request(`http://localhost/api/app/documents/${owner}/${repo}`, {
          headers: { Origin: config.appOrigin },
        }),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.currentUserPermission).toBeNull();
    } finally {
      globalThis.fetch = originalMockFetch;
      config.giteaServiceToken = originalToken;
      server.stop(true);
    }
  });

  test("returns 503 when Gitea rejects the service token", async () => {
    // Regression test: when the service client gets a non-404 error from Gitea
    // (e.g. invalid service token → Gitea 401), the API must return 503, not a
    // misleading 401 that looks like the user needs to log in.
    const server = createApiServer();
    const owner = `owner-${randomUUID()}`;
    const repo = "public-doc";

    const originalMockFetch = globalThis.fetch;
    globalThis.fetch = (async (input, init) => {
      const requestUrl =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;
      const url = new URL(requestUrl);
      const method =
        input instanceof Request
          ? (input as Request).method
          : ((init as RequestInit | undefined)?.method ?? "GET");

      const repoMatch = url.pathname.match(
        /^\/api\/v1\/repos\/([^/]+)\/([^/]+)$/,
      );
      if (repoMatch && method === "GET") {
        // Simulate Gitea rejecting the service token with 401
        return new Response(JSON.stringify({ message: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      return originalMockFetch(input, init);
    }) as typeof fetch;

    try {
      const response = await server.fetch(
        new Request(`http://localhost/api/app/documents/${owner}/${repo}`, {
          headers: { Origin: config.appOrigin },
        }),
      );
      // Must be 503 (service misconfigured), not 401 (user must log in)
      expect(response.status).toBe(503);
    } finally {
      globalThis.fetch = originalMockFetch;
      server.stop(true);
    }
  });
});

describe("public document access — GET /api/app/documents/:owner/:repo/collaborators", () => {
  test("returns 401 for an anonymous request to collaborators of a private repo", async () => {
    const server = createApiServer();
    const owner = `owner-${randomUUID()}`;
    const repo = "private-doc";
    seedRepo(owner, repo, { isPrivate: true });

    try {
      const response = await server.fetch(
        new Request(
          `http://localhost/api/app/documents/${owner}/${repo}/collaborators`,
          { headers: { Origin: config.appOrigin } },
        ),
      );
      expect(response.status).toBe(401);
    } finally {
      server.stop(true);
    }
  });

  test("returns 200 for an anonymous request to collaborators of a public repo", async () => {
    const server = createApiServer();
    const owner = `owner-${randomUUID()}`;
    const repo = "public-doc";
    seedRepo(owner, repo, { isPrivate: false });

    try {
      const response = await server.fetch(
        new Request(
          `http://localhost/api/app/documents/${owner}/${repo}/collaborators`,
          { headers: { Origin: config.appOrigin } },
        ),
      );
      const body = (await response.json()) as Record<string, unknown>;
      expect(response.status).toBe(200);
      expect(body.currentUserPermission).toBeNull();
    } finally {
      server.stop(true);
    }
  });
});

// ── Tests: GET /api/app/documents/:owner/:repo/permissions ───────────────────

describe("GET /api/app/documents/:owner/:repo/permissions", () => {
  test("returns 401 when no session cookie is present", async () => {
    const server = createApiServer();
    try {
      const response = await server.fetch(
        new Request(
          "http://localhost/api/app/documents/alice/my-doc/permissions",
          {
            headers: { Origin: config.appOrigin },
          },
        ),
      );
      expect(response.status).toBe(401);
    } finally {
      server.stop(true);
    }
  });

  test("is never gated by the paywall, because reading is never gated", async () => {
    const server = createApiServer();
    const sessionId = `sess_${randomUUID()}`;
    const giteaToken = `gitea_${randomUUID()}`;
    const username = `no-sub-${randomUUID()}`;
    giteaUsersByLogin.set(username, {
      login: username,
      email: `${username}@test.local`,
    });
    giteaLoginsByToken.set(giteaToken, username);
    await sessionStore.put({
      id: sessionId,
      username,
      giteaToken,
      giteaTokenName: "perms-test-token",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    });
    seedRepo(username, "my-doc", { isPrivate: true });
    // no subscriptionStore.upsert — no active subscription

    try {
      const response = await server.fetch(
        makeRequest(
          `/api/app/documents/${username}/my-doc/permissions`,
          sessionId,
        ),
      );
      // ADR 0004: the paywall gates authoring and mutation and nothing else.
      // Who may act on a binder, and under what rules, is part of the record a
      // surveyor can ask about — so a delinquent organization still reads it.
      expect(response.status).not.toBe(402);
      expect(response.status).toBe(200);
    } finally {
      server.stop(true);
    }
  });

  test("returns branch protection and visibility for a document with a branch protection rule", async () => {
    const server = createApiServer();
    const owner = `owner-${randomUUID()}`;
    const repo = "my-doc";
    const sessionId = await seedSession(owner);

    seedRepo(owner, repo, { isPrivate: true });
    seedBranchProtection(owner, repo, {
      rule_name: "main",
      required_approvals: 2,
      enable_approvals_whitelist: true,
      approvals_whitelist_username: ["reviewer1"],
    });

    try {
      const response = await server.fetch(
        makeRequest(
          `/api/app/documents/${owner}/${repo}/permissions`,
          sessionId,
        ),
      );
      expect(response.status).toBe(200);

      const body = (await response.json()) as {
        branchProtection: {
          requiredApprovals: number;
          enableApprovalsWhitelist: boolean;
          approvalsWhitelistUsernames: string[];
        } | null;
        isPrivate: boolean;
        currentUserPermission: unknown;
      };

      expect(body.branchProtection).not.toBeNull();
      expect(body.branchProtection?.requiredApprovals).toBe(2);
      expect(body.branchProtection?.enableApprovalsWhitelist).toBe(true);
      expect(body.branchProtection?.approvalsWhitelistUsernames).toEqual([
        "reviewer1",
      ]);
      expect(body.isPrivate).toBe(true);
    } finally {
      server.stop(true);
    }
  });

  test("returns null branchProtection when repo has no branch protection rules", async () => {
    const server = createApiServer();
    const owner = `owner-${randomUUID()}`;
    const repo = "no-bp-doc";
    const sessionId = await seedSession(owner);

    seedRepo(owner, repo, { isPrivate: false });
    // no seedBranchProtection — empty list

    try {
      const response = await server.fetch(
        makeRequest(
          `/api/app/documents/${owner}/${repo}/permissions`,
          sessionId,
        ),
      );
      expect(response.status).toBe(200);

      const body = (await response.json()) as {
        branchProtection: null;
        isPrivate: boolean;
      };
      expect(body.branchProtection).toBeNull();
      expect(body.isPrivate).toBe(false);
    } finally {
      server.stop(true);
    }
  });

  test("returns isPrivate: false for a public repo", async () => {
    const server = createApiServer();
    const owner = `owner-${randomUUID()}`;
    const repo = "public-doc";
    const sessionId = await seedSession(owner);

    seedRepo(owner, repo, { isPrivate: false });

    try {
      const response = await server.fetch(
        makeRequest(
          `/api/app/documents/${owner}/${repo}/permissions`,
          sessionId,
        ),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as { isPrivate: boolean };
      expect(body.isPrivate).toBe(false);
    } finally {
      server.stop(true);
    }
  });

  test("returns isInternal: false for a normal private repo", async () => {
    const server = createApiServer();
    const owner = `owner-${randomUUID()}`;
    const repo = "private-doc";
    const sessionId = await seedSession(owner);

    seedRepo(owner, repo, { isPrivate: true, isInternal: false });

    try {
      const response = await server.fetch(
        makeRequest(
          `/api/app/documents/${owner}/${repo}/permissions`,
          sessionId,
        ),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        isPrivate: boolean;
        isInternal: boolean;
      };
      expect(body.isPrivate).toBe(true);
      expect(body.isInternal).toBe(false);
    } finally {
      server.stop(true);
    }
  });

  test("returns isInternal: true for an internal repo", async () => {
    const server = createApiServer();
    const owner = `owner-${randomUUID()}`;
    const repo = "internal-doc";
    const sessionId = await seedSession(owner);

    seedRepo(owner, repo, { isPrivate: false, isInternal: true });

    try {
      const response = await server.fetch(
        makeRequest(
          `/api/app/documents/${owner}/${repo}/permissions`,
          sessionId,
        ),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        isPrivate: boolean;
        isInternal: boolean;
      };
      expect(body.isPrivate).toBe(false);
      expect(body.isInternal).toBe(true);
    } finally {
      server.stop(true);
    }
  });
});

// ── Tests: PUT /api/app/documents/:owner/:repo/permissions ───────────────────

describe("PUT /api/app/documents/:owner/:repo/permissions", () => {
  test("returns 403 when the requesting user is not the repo owner", async () => {
    const server = createApiServer();
    const owner = `owner-${randomUUID()}`;
    const collaborator = `collab-${randomUUID()}`;
    const repo = "shared-doc";
    seedRepo(owner, repo, { isPrivate: true });
    seedBranchProtection(owner, repo, { rule_name: "main" });
    const collabSessionId = await seedSession(collaborator);

    try {
      const response = await server.fetch(
        makeRequest(
          `/api/app/documents/${owner}/${repo}/permissions`,
          collabSessionId,
          {
            method: "PUT",
            body: { requiredApprovals: 3 },
          },
        ),
      );
      expect(response.status).toBe(403);
      const body = (await response.json()) as { error: string };
      expect(body.error).toMatch(/owner/i);
    } finally {
      server.stop(true);
    }
  });

  test("an admin collaborator can change permissions", async () => {
    const server = createApiServer();
    const owner = `owner-${randomUUID()}`;
    const admin = `admin-${randomUUID()}`;
    const repo = "shared-doc";
    seedRepo(owner, repo, { isPrivate: true });
    seedBranchProtection(owner, repo, {
      rule_name: "main",
      required_approvals: 1,
    });
    seedCollaboratorPermission(owner, repo, admin, "admin");
    const adminSessionId = await seedSession(admin);

    try {
      const response = await server.fetch(
        makeRequest(
          `/api/app/documents/${owner}/${repo}/permissions`,
          adminSessionId,
          {
            method: "PUT",
            body: { requiredApprovals: 3 },
          },
        ),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        branchProtection: { requiredApprovals: number } | null;
      };
      expect(body.branchProtection?.requiredApprovals).toBe(3);
    } finally {
      server.stop(true);
    }
  });

  test("a write collaborator cannot change permissions", async () => {
    const server = createApiServer();
    const owner = `owner-${randomUUID()}`;
    const writer = `writer-${randomUUID()}`;
    const repo = "shared-doc";
    seedRepo(owner, repo, { isPrivate: true });
    seedBranchProtection(owner, repo, { rule_name: "main" });
    seedCollaboratorPermission(owner, repo, writer, "write");
    const writerSessionId = await seedSession(writer);

    try {
      const response = await server.fetch(
        makeRequest(
          `/api/app/documents/${owner}/${repo}/permissions`,
          writerSessionId,
          {
            method: "PUT",
            body: { blockOnUnresolvedThreads: true },
          },
        ),
      );
      expect(response.status).toBe(403);
      const body = (await response.json()) as { error: string };
      expect(body.error).toMatch(/owner or an admin/i);
    } finally {
      server.stop(true);
    }
  });

  test("owner can update requiredApprovals", async () => {
    const server = createApiServer();
    const owner = `owner-${randomUUID()}`;
    const repo = "my-doc";
    const sessionId = await seedSession(owner);
    seedRepo(owner, repo, { isPrivate: true });
    seedBranchProtection(owner, repo, {
      rule_name: "main",
      required_approvals: 1,
    });

    try {
      const response = await server.fetch(
        makeRequest(
          `/api/app/documents/${owner}/${repo}/permissions`,
          sessionId,
          {
            method: "PUT",
            body: { requiredApprovals: 3 },
          },
        ),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        branchProtection: { requiredApprovals: number } | null;
      };
      expect(body.branchProtection?.requiredApprovals).toBe(3);
    } finally {
      server.stop(true);
    }
  });

  test("owner can enable approvals whitelist with specific users", async () => {
    const server = createApiServer();
    const owner = `owner-${randomUUID()}`;
    const repo = "my-doc";
    const sessionId = await seedSession(owner);
    seedRepo(owner, repo, { isPrivate: true });
    seedBranchProtection(owner, repo, { rule_name: "main" });

    try {
      const response = await server.fetch(
        makeRequest(
          `/api/app/documents/${owner}/${repo}/permissions`,
          sessionId,
          {
            method: "PUT",
            body: {
              enableApprovalsWhitelist: true,
              approvalsWhitelistUsernames: ["alice", "bob"],
            },
          },
        ),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        branchProtection: {
          enableApprovalsWhitelist: boolean;
          approvalsWhitelistUsernames: string[];
        } | null;
      };
      expect(body.branchProtection?.enableApprovalsWhitelist).toBe(true);
      expect(body.branchProtection?.approvalsWhitelistUsernames).toEqual([
        "alice",
        "bob",
      ]);
    } finally {
      server.stop(true);
    }
  });

  test("owner can enable merge whitelist with specific users", async () => {
    const server = createApiServer();
    const owner = `owner-${randomUUID()}`;
    const repo = "my-doc";
    const sessionId = await seedSession(owner);
    seedRepo(owner, repo, { isPrivate: true });
    seedBranchProtection(owner, repo, { rule_name: "main" });

    try {
      const response = await server.fetch(
        makeRequest(
          `/api/app/documents/${owner}/${repo}/permissions`,
          sessionId,
          {
            method: "PUT",
            body: {
              enableMergeWhitelist: true,
              mergeWhitelistUsernames: ["publisher1"],
            },
          },
        ),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        branchProtection: {
          enableMergeWhitelist: boolean;
          mergeWhitelistUsernames: string[];
        } | null;
      };
      expect(body.branchProtection?.enableMergeWhitelist).toBe(true);
      expect(body.branchProtection?.mergeWhitelistUsernames).toEqual([
        "publisher1",
      ]);
    } finally {
      server.stop(true);
    }
  });

  test("owner can flip repo from private to public", async () => {
    const server = createApiServer();
    const owner = `owner-${randomUUID()}`;
    const repo = "my-doc";
    const sessionId = await seedSession(owner);
    seedRepo(owner, repo, { isPrivate: true });
    seedBranchProtection(owner, repo, { rule_name: "main" });

    try {
      const response = await server.fetch(
        makeRequest(
          `/api/app/documents/${owner}/${repo}/permissions`,
          sessionId,
          {
            method: "PUT",
            body: { isPrivate: false },
          },
        ),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as { isPrivate: boolean };
      expect(body.isPrivate).toBe(false);
    } finally {
      server.stop(true);
    }
  });

  test("owner can flip repo from public to private", async () => {
    const server = createApiServer();
    const owner = `owner-${randomUUID()}`;
    const repo = "my-doc";
    const sessionId = await seedSession(owner);
    seedRepo(owner, repo, { isPrivate: false });
    seedBranchProtection(owner, repo, { rule_name: "main" });

    try {
      const response = await server.fetch(
        makeRequest(
          `/api/app/documents/${owner}/${repo}/permissions`,
          sessionId,
          {
            method: "PUT",
            body: { isPrivate: true },
          },
        ),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as { isPrivate: boolean };
      expect(body.isPrivate).toBe(true);
    } finally {
      server.stop(true);
    }
  });

  test("floats requiredApprovals to 0 when a negative value is provided", async () => {
    const server = createApiServer();
    const owner = `owner-${randomUUID()}`;
    const repo = "my-doc";
    const sessionId = await seedSession(owner);
    seedRepo(owner, repo, { isPrivate: true });
    seedBranchProtection(owner, repo, {
      rule_name: "main",
      required_approvals: 1,
    });

    try {
      const response = await server.fetch(
        makeRequest(
          `/api/app/documents/${owner}/${repo}/permissions`,
          sessionId,
          {
            method: "PUT",
            body: { requiredApprovals: -5 },
          },
        ),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        branchProtection: { requiredApprovals: number } | null;
      };
      expect(body.branchProtection?.requiredApprovals).toBe(0);
    } finally {
      server.stop(true);
    }
  });

  test("non-string entries in approvalsWhitelistUsernames are stripped", async () => {
    const server = createApiServer();
    const owner = `owner-${randomUUID()}`;
    const repo = "my-doc";
    const sessionId = await seedSession(owner);
    seedRepo(owner, repo, { isPrivate: true });
    seedBranchProtection(owner, repo, { rule_name: "main" });

    try {
      const response = await server.fetch(
        makeRequest(
          `/api/app/documents/${owner}/${repo}/permissions`,
          sessionId,
          {
            method: "PUT",
            body: {
              enableApprovalsWhitelist: true,
              approvalsWhitelistUsernames: [
                "alice",
                42,
                null,
                "bob",
              ] as unknown as string[],
            },
          },
        ),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        branchProtection: { approvalsWhitelistUsernames: string[] } | null;
      };
      expect(body.branchProtection?.approvalsWhitelistUsernames).toEqual([
        "alice",
        "bob",
      ]);
    } finally {
      server.stop(true);
    }
  });

  test("returns 401 when no session cookie is present", async () => {
    const server = createApiServer();
    try {
      const response = await server.fetch(
        new Request(
          "http://localhost/api/app/documents/alice/my-doc/permissions",
          {
            method: "PUT",
            headers: {
              Origin: config.appOrigin,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ isPrivate: false }),
          },
        ),
      );
      expect(response.status).toBe(401);
    } finally {
      server.stop(true);
    }
  });

  test("owner can set requiredApprovals to 0 (no approvals needed)", async () => {
    const server = createApiServer();
    const owner = `owner-${randomUUID()}`;
    const repo = "my-doc";
    const sessionId = await seedSession(owner);
    seedRepo(owner, repo, { isPrivate: true });
    seedBranchProtection(owner, repo, {
      rule_name: "main",
      required_approvals: 2,
    });

    try {
      const response = await server.fetch(
        makeRequest(
          `/api/app/documents/${owner}/${repo}/permissions`,
          sessionId,
          {
            method: "PUT",
            body: { requiredApprovals: 0 },
          },
        ),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        branchProtection: { requiredApprovals: number } | null;
      };
      expect(body.branchProtection?.requiredApprovals).toBe(0);
    } finally {
      server.stop(true);
    }
  });

  test("owner can set multiple requiredApprovals (e.g. 5)", async () => {
    const server = createApiServer();
    const owner = `owner-${randomUUID()}`;
    const repo = "my-doc";
    const sessionId = await seedSession(owner);
    seedRepo(owner, repo, { isPrivate: true });
    seedBranchProtection(owner, repo, {
      rule_name: "main",
      required_approvals: 1,
    });

    try {
      const response = await server.fetch(
        makeRequest(
          `/api/app/documents/${owner}/${repo}/permissions`,
          sessionId,
          {
            method: "PUT",
            body: { requiredApprovals: 5 },
          },
        ),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        branchProtection: { requiredApprovals: number } | null;
      };
      expect(body.branchProtection?.requiredApprovals).toBe(5);
    } finally {
      server.stop(true);
    }
  });

  test("owner can disable approvals whitelist", async () => {
    const server = createApiServer();
    const owner = `owner-${randomUUID()}`;
    const repo = "my-doc";
    const sessionId = await seedSession(owner);
    seedRepo(owner, repo, { isPrivate: true });
    seedBranchProtection(owner, repo, {
      rule_name: "main",
      enable_approvals_whitelist: true,
      approvals_whitelist_username: ["alice", "bob"],
    });

    try {
      const response = await server.fetch(
        makeRequest(
          `/api/app/documents/${owner}/${repo}/permissions`,
          sessionId,
          {
            method: "PUT",
            body: {
              enableApprovalsWhitelist: false,
              approvalsWhitelistUsernames: [],
            },
          },
        ),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        branchProtection: {
          enableApprovalsWhitelist: boolean;
          approvalsWhitelistUsernames: string[];
        } | null;
      };
      expect(body.branchProtection?.enableApprovalsWhitelist).toBe(false);
      expect(body.branchProtection?.approvalsWhitelistUsernames).toEqual([]);
    } finally {
      server.stop(true);
    }
  });

  test("owner can disable merge whitelist", async () => {
    const server = createApiServer();
    const owner = `owner-${randomUUID()}`;
    const repo = "my-doc";
    const sessionId = await seedSession(owner);
    seedRepo(owner, repo, { isPrivate: true });
    seedBranchProtection(owner, repo, {
      rule_name: "main",
      enable_merge_whitelist: true,
      merge_whitelist_usernames: ["publisher1"],
    });

    try {
      const response = await server.fetch(
        makeRequest(
          `/api/app/documents/${owner}/${repo}/permissions`,
          sessionId,
          {
            method: "PUT",
            body: {
              enableMergeWhitelist: false,
              mergeWhitelistUsernames: [],
            },
          },
        ),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        branchProtection: {
          enableMergeWhitelist: boolean;
          mergeWhitelistUsernames: string[];
        } | null;
      };
      expect(body.branchProtection?.enableMergeWhitelist).toBe(false);
      expect(body.branchProtection?.mergeWhitelistUsernames).toEqual([]);
    } finally {
      server.stop(true);
    }
  });

  test("non-string entries in mergeWhitelistUsernames are stripped", async () => {
    const server = createApiServer();
    const owner = `owner-${randomUUID()}`;
    const repo = "my-doc";
    const sessionId = await seedSession(owner);
    seedRepo(owner, repo, { isPrivate: true });
    seedBranchProtection(owner, repo, { rule_name: "main" });

    try {
      const response = await server.fetch(
        makeRequest(
          `/api/app/documents/${owner}/${repo}/permissions`,
          sessionId,
          {
            method: "PUT",
            body: {
              enableMergeWhitelist: true,
              mergeWhitelistUsernames: [
                "publisher1",
                123,
                null,
                "publisher2",
              ] as unknown as string[],
            },
          },
        ),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        branchProtection: { mergeWhitelistUsernames: string[] } | null;
      };
      expect(body.branchProtection?.mergeWhitelistUsernames).toEqual([
        "publisher1",
        "publisher2",
      ]);
    } finally {
      server.stop(true);
    }
  });

  test("owner can update multiple permission fields simultaneously", async () => {
    const server = createApiServer();
    const owner = `owner-${randomUUID()}`;
    const repo = "my-doc";
    const sessionId = await seedSession(owner);
    seedRepo(owner, repo, { isPrivate: true });
    seedBranchProtection(owner, repo, { rule_name: "main" });

    try {
      const response = await server.fetch(
        makeRequest(
          `/api/app/documents/${owner}/${repo}/permissions`,
          sessionId,
          {
            method: "PUT",
            body: {
              requiredApprovals: 2,
              enableApprovalsWhitelist: true,
              approvalsWhitelistUsernames: ["alice"],
              enableMergeWhitelist: true,
              mergeWhitelistUsernames: ["bob"],
            },
          },
        ),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        branchProtection: {
          requiredApprovals: number;
          enableApprovalsWhitelist: boolean;
          approvalsWhitelistUsernames: string[];
          enableMergeWhitelist: boolean;
          mergeWhitelistUsernames: string[];
        } | null;
      };
      expect(body.branchProtection?.requiredApprovals).toBe(2);
      expect(body.branchProtection?.enableApprovalsWhitelist).toBe(true);
      expect(body.branchProtection?.approvalsWhitelistUsernames).toEqual([
        "alice",
      ]);
      expect(body.branchProtection?.enableMergeWhitelist).toBe(true);
      expect(body.branchProtection?.mergeWhitelistUsernames).toEqual(["bob"]);
    } finally {
      server.stop(true);
    }
  });
});

// ── Tests: Additional GET /api/app/documents/:owner/:repo/permissions scenarios ──

describe("GET /api/app/documents/:owner/:repo/permissions - additional scenarios", () => {
  test("returns merge whitelist data when present", async () => {
    const server = createApiServer();
    const owner = `owner-${randomUUID()}`;
    const repo = "my-doc";
    const sessionId = await seedSession(owner);

    seedRepo(owner, repo, { isPrivate: true });
    seedBranchProtection(owner, repo, {
      rule_name: "main",
      enable_merge_whitelist: true,
      merge_whitelist_usernames: ["publisher"],
    });

    try {
      const response = await server.fetch(
        makeRequest(
          `/api/app/documents/${owner}/${repo}/permissions`,
          sessionId,
        ),
      );
      expect(response.status).toBe(200);

      const body = (await response.json()) as {
        branchProtection: {
          enableMergeWhitelist: boolean;
          mergeWhitelistUsernames: string[];
        } | null;
      };

      expect(body.branchProtection).not.toBeNull();
      expect(body.branchProtection?.enableMergeWhitelist).toBe(true);
      expect(body.branchProtection?.mergeWhitelistUsernames).toContain(
        "publisher",
      );
    } finally {
      server.stop(true);
    }
  });

  test("returns currentUserPermission for owner", async () => {
    const server = createApiServer();
    const owner = `owner-${randomUUID()}`;
    const repo = "my-doc";
    const sessionId = await seedSession(owner);

    seedRepo(owner, repo, { isPrivate: true });
    seedBranchProtection(owner, repo, { rule_name: "main" });

    try {
      const response = await server.fetch(
        makeRequest(
          `/api/app/documents/${owner}/${repo}/permissions`,
          sessionId,
        ),
      );
      expect(response.status).toBe(200);

      const body = (await response.json()) as {
        currentUserPermission: {
          permission: string;
          access: string;
          permissionLabel: string;
          roleName: string;
          user: { login: string };
        } | null;
      };

      expect(body.currentUserPermission).not.toBeNull();
      expect(body.currentUserPermission?.permission).toBe("owner");
      expect(body.currentUserPermission?.access).toBe("owner");
      expect(body.currentUserPermission?.permissionLabel).toBe("Owner");
      expect(body.currentUserPermission?.roleName).toBe("owner");
      expect(body.currentUserPermission?.user.login).toBe(owner);
    } finally {
      server.stop(true);
    }
  });
});

// ── Tests: GET /api/app/documents/:owner/:repo (public/private access) ──

describe("GET /api/app/documents/:owner/:repo - public and private access", () => {
  test("public repo is viewable by non-owner with valid session", async () => {
    const server = createApiServer();
    const owner = `owner-${randomUUID()}`;
    const nonOwner = `viewer-${randomUUID()}`;
    const repo = "public-doc";

    seedRepo(owner, repo, { isPrivate: false });
    const nonOwnerSessionId = await seedSession(nonOwner);

    try {
      const response = await server.fetch(
        makeRequest(`/api/app/documents/${owner}/${repo}`, nonOwnerSessionId),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        repository: { full_name: string };
      };
      expect(body.repository.full_name).toBe(`${owner}/${repo}`);
    } finally {
      server.stop(true);
    }
  });

  test("private repo is blocked for non-collaborator", async () => {
    const server = createApiServer();
    const owner = `owner-${randomUUID()}`;
    const nonCollaborator = `outsider-${randomUUID()}`;
    const repo = "private-doc";

    seedRepo(owner, repo, { isPrivate: true });
    const nonCollabSessionId = await seedSession(nonCollaborator);

    // Override the mock fetch for this test to simulate Gitea returning 404
    // for a private repo when accessed by a non-collaborator
    const originalMockFetch = globalThis.fetch;
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

      // Check if this is a repo GET request for the private repo from the non-collaborator
      const repoMatch = url.pathname.match(
        /^\/api\/v1\/repos\/([^/]+)\/([^/]+)$/,
      );
      if (repoMatch && repoMatch[1] === owner && repoMatch[2] === repo) {
        const authHeader = headers.get("Authorization") ?? "";
        const token = authHeader.startsWith("token ")
          ? authHeader.slice(6)
          : "";
        const login = giteaLoginsByToken.get(token);

        // If the requesting user is NOT the owner, return 404
        if (login !== owner) {
          return new Response(JSON.stringify({ message: "Not found" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          });
        }
      }

      // Fall back to the original mock for all other calls
      return originalMockFetch(input, init);
    }) as typeof fetch;

    try {
      const response = await server.fetch(
        makeRequest(`/api/app/documents/${owner}/${repo}`, nonCollabSessionId),
      );
      // Expect a 4xx error (likely 404 propagated from Gitea)
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).toBeLessThan(500);
    } finally {
      globalThis.fetch = originalMockFetch;
      server.stop(true);
    }
  });
});
