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

/**
 * What a reviewer who is not a repo admin is told about a change.
 *
 * Gitea serves branch protection only to an owner or a collaborator with admin
 * write. Reading it as the caller therefore handed every write collaborator a
 * 403, which the BFF turned into `requiredApprovals: 0` — no denominator, no
 * count, for exactly the people the count exists for. The service account
 * reads it now, and these tests hold the line on both halves of that: the
 * number reaches a non-admin, and the whitelists on the same Gitea object,
 * which name individual people, still do not.
 */

const originalFetch = globalThis.fetch;
const originalApiPort = config.apiPort;
const originalSessionsDbPath = config.sessionsDbPath;
const originalServiceToken = config.giteaServiceToken;

/** The BFF's own token — the only one this Gitea admits to the rule. */
const SERVICE_TOKEN = "gitea_service_token";

const WHITELISTED = "carol";

let giteaLoginsByToken = new Map<string, string>();
let requiredApprovals = 2;
/** What the caller's own token is allowed to do with the repo. */
let callerIsAdmin = false;
/** False when even the service account cannot read the rule. */
let protectionReadable = true;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function person(login: string) {
  return {
    login,
    full_name: `${login[0]?.toUpperCase()}${login.slice(1)} Reyes`,
    avatar_url: `https://gitea.test/${login}.png`,
  };
}

function pullRequest(number: number, state: "open" | "closed") {
  return {
    id: number,
    number,
    title: `Change ${number}`,
    body: "Adds the 2026 retention clause.",
    state,
    created_at: "2026-02-01T00:00:00Z",
    updated_at: "2026-02-02T00:00:00Z",
    head: { ref: `upload/v${number}` },
    base: { ref: "main" },
    user: person("bob"),
    assignees: [],
    requested_reviewers: [person("dana")],
    merged: state === "closed",
    merge_commit_sha: state === "closed" ? "sha-closed" : undefined,
  };
}

beforeEach(() => {
  config.apiPort = 0;
  config.sessionsDbPath = `/tmp/bindersnap-detail-test-${randomUUID()}.sqlite`;
  config.giteaServiceToken = SERVICE_TOKEN;
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
  requiredApprovals = 2;
  callerIsAdmin = false;
  protectionReadable = true;

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
    const auth = headers.get("Authorization") ?? "";
    const token = auth.startsWith("token ") ? auth.slice(6) : "";

    // ADR 0004: the paywall asks which organization the session belongs to.
    if (path === "/api/v1/user/orgs") {
      return json([{ id: TEST_GITEA_ORG_ID, username: TEST_ORG_NAME }]);
    }

    if (path === "/api/v1/user") {
      const login = giteaLoginsByToken.get(token);
      if (!login) return json({ message: "Not found" }, 404);
      return json({
        login,
        email: `${login}@test.local`,
        full_name: "",
        is_admin: false,
      });
    }

    if (/^\/api\/v1\/repos\/[^/]+\/[^/]+\/branch_protections$/.test(path)) {
      // The 403 a write collaborator actually receives, verbatim.
      if (!protectionReadable || (token !== SERVICE_TOKEN && !callerIsAdmin)) {
        return json(
          {
            message:
              "user should be an owner or a collaborator with admin write of a repository",
          },
          403,
        );
      }
      return json([
        {
          rule_name: "main",
          required_approvals: requiredApprovals,
          enable_approvals_whitelist: true,
          approvals_whitelist_username: [WHITELISTED],
          approvals_whitelist_teams: ["legal"],
          enable_merge_whitelist: true,
          merge_whitelist_usernames: [WHITELISTED],
          merge_whitelist_teams: ["legal"],
        },
      ]);
    }

    if (/^\/api\/v1\/repos\/[^/]+\/[^/]+\/tags$/.test(path)) {
      return json([]);
    }

    const pullsMatch = path.match(/^\/api\/v1\/repos\/[^/]+\/[^/]+\/pulls$/);
    if (pullsMatch && method === "GET") {
      const state =
        url.searchParams.get("state") === "closed" ? "closed" : "open";
      return json([pullRequest(3, state)]);
    }

    if (/^\/api\/v1\/repos\/[^/]+\/[^/]+\/pulls\/\d+\/reviews$/.test(path)) {
      return json([
        {
          id: 11,
          state: "APPROVED",
          body: "",
          submitted_at: "2026-02-02T00:00:00Z",
          user: person("dana"),
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
        owner: person(repoMatch[1]!),
        permissions: {
          admin: token === SERVICE_TOKEN ? true : callerIsAdmin,
          push: true,
          pull: true,
        },
      });
    }

    // Everything else on a document's page — the canonical file, the
    // collaborator lookup, the review settings — is read behind a catch and
    // has no bearing on the approval count.
    return json({ message: "Not found" }, 404);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  config.giteaServiceToken = originalServiceToken;
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
    giteaTokenName: "detail-test-token",
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

function get(path: string, sessionId: string) {
  return new Request(`http://localhost${path}`, {
    headers: {
      Origin: config.appOrigin,
      Cookie: `${config.sessionCookieName}=${sessionId}`,
    },
  });
}

const DETAIL = "/api/app/documents/alice/quarterly-report";
const CLOSED = "/api/app/documents/alice/quarterly-report/changes/closed";

interface DetailPayload {
  openPullRequests: { requiredApprovals: number | null }[];
  branchProtection: { approvalsWhitelistUsernames: string[] } | null;
}

describe("document detail approval policy", () => {
  test("a write collaborator sees the count the owner sees", async () => {
    const server = createApiServer();
    const session = await seedSession("bob");

    const response = await server.fetch(get(DETAIL, session));
    const payload = (await response.json()) as DetailPayload;

    expect(response.status).toBe(200);
    // Bob's own token is refused the rule; the service account is not, and the
    // number it reads is the number Bob is served.
    expect(payload.openPullRequests[0]?.requiredApprovals).toBe(2);
  });

  test("the whitelists stay admin-only", async () => {
    const server = createApiServer();
    const session = await seedSession("bob");

    const response = await server.fetch(get(DETAIL, session));
    const body = await response.text();
    const payload = JSON.parse(body) as DetailPayload;

    // The count is policy every reviewer is entitled to. Who is on the
    // approval or merge whitelist is policy about named people, and reaching
    // it still requires admin on the repo.
    expect(payload.branchProtection).toBeNull();
    expect(body).not.toContain(WHITELISTED);
    expect(body).not.toContain("approvalsWhitelistUsernames");
  });

  test("an admin still receives the whole rule", async () => {
    callerIsAdmin = true;
    const server = createApiServer();
    const session = await seedSession("alice");

    const response = await server.fetch(get(DETAIL, session));
    const payload = (await response.json()) as DetailPayload;

    expect(payload.openPullRequests[0]?.requiredApprovals).toBe(2);
    expect(payload.branchProtection?.approvalsWhitelistUsernames).toEqual([
      WHITELISTED,
    ]);
  });

  test("a document that demands no approvals reports zero, not unknown", async () => {
    requiredApprovals = 0;
    const server = createApiServer();
    const session = await seedSession("bob");

    const response = await server.fetch(get(DETAIL, session));
    const payload = (await response.json()) as DetailPayload;

    expect(payload.openPullRequests[0]?.requiredApprovals).toBe(0);
  });

  test("a policy that cannot be read reports null, not zero", async () => {
    // Gitea refusing even the service account is the one case where nobody
    // can read the rule. It has to stay distinguishable from a document that
    // demands nothing, or the UI reports "nothing left to collect" when what
    // it means is "we do not know".
    protectionReadable = false;
    const server = createApiServer();
    const session = await seedSession("bob");

    const response = await server.fetch(get(DETAIL, session));
    const payload = (await response.json()) as DetailPayload;

    expect(payload.openPullRequests[0]?.requiredApprovals).toBeNull();
  });

  test("closed changes carry the same count", async () => {
    const server = createApiServer();
    const session = await seedSession("bob");

    const response = await server.fetch(get(CLOSED, session));
    const payload = (await response.json()) as {
      changes: { requiredApprovals: number | null }[];
    };

    expect(response.status).toBe(200);
    expect(payload.changes[0]?.requiredApprovals).toBe(2);
  });
});
