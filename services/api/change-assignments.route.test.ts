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
 * End-to-end coverage for the assignment route.
 *
 * The reviewer list arrives as the end state the caller wants, and the server
 * turns it into the add and remove calls Gitea actually needs. If that turns
 * into the wrong calls, a reviewer silently drops off a change nobody knows is
 * unattended — so the calls themselves are what these tests assert on.
 */

type GiteaUser = { login: string; full_name: string; avatar_url: string };

const originalFetch = globalThis.fetch;
const originalApiPort = config.apiPort;
const originalSessionsDbPath = config.sessionsDbPath;
const originalServiceToken = config.giteaServiceToken;

/** The token the BFF holds; the only one Gitea serves branch protection to. */
const SERVICE_TOKEN = "gitea_service_token";

let giteaUsersByLogin = new Map<string, { login: string; email: string }>();
let giteaLoginsByToken = new Map<string, string>();
let requestedReviewers: GiteaUser[] = [];
let assignees: GiteaUser[] = [];
let reviewerCalls: { method: string; reviewers: string[] }[] = [];
let assigneeCalls: string[][] = [];
let requiredApprovals = 2;
/** False when Gitea refuses the rule to everyone, service account included. */
let protectionReadable = true;

function person(login: string): GiteaUser {
  return {
    login,
    full_name: `${login[0]?.toUpperCase()}${login.slice(1)} Reyes`,
    avatar_url: `https://gitea.test/${login}.png`,
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  config.apiPort = 0;
  config.giteaServiceToken = SERVICE_TOKEN;
  config.sessionsDbPath = `/tmp/bindersnap-assign-test-${randomUUID()}.sqlite`;
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
  requestedReviewers = [];
  assignees = [];
  reviewerCalls = [];
  assigneeCalls = [];
  requiredApprovals = 2;
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
    const rawBody =
      input instanceof Request
        ? await input.clone().text()
        : typeof init?.body === "string"
          ? init.body
          : null;
    const parsed = rawBody
      ? (JSON.parse(rawBody) as Record<string, unknown>)
      : null;
    const path = url.pathname;

    // ADR 0004: the paywall asks which organization the session belongs to.
    if (path === "/api/v1/user/orgs") {
      return json([{ id: TEST_GITEA_ORG_ID, username: TEST_ORG_NAME }]);
    }

    if (path === "/api/v1/user") {
      const auth = headers.get("Authorization") ?? "";
      const token = auth.startsWith("token ") ? auth.slice(6) : "";
      const login = giteaLoginsByToken.get(token);
      const user = login ? giteaUsersByLogin.get(login) : null;
      if (!user) return json({ message: "Not found" }, 404);
      return json({ ...user, full_name: "", is_admin: false });
    }

    const reviewersMatch = path.match(
      /^\/api\/v1\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)\/requested_reviewers$/,
    );
    if (reviewersMatch) {
      const logins = Array.isArray(parsed?.reviewers)
        ? (parsed.reviewers as string[])
        : [];
      reviewerCalls.push({ method, reviewers: logins });

      if (method === "POST") {
        requestedReviewers = [
          ...requestedReviewers,
          ...logins
            .map(person)
            .filter(
              (candidate) =>
                !requestedReviewers.some(
                  (held) => held.login === candidate.login,
                ),
            ),
        ];
        return json([], 201);
      }

      requestedReviewers = requestedReviewers.filter(
        (held) => !logins.includes(held.login),
      );
      return new Response(null, { status: 204 });
    }

    const reviewsMatch = path.match(
      /^\/api\/v1\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)\/reviews$/,
    );
    if (reviewsMatch && method === "GET") {
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

    const protectionMatch = path.match(
      /^\/api\/v1\/repos\/([^/]+)\/([^/]+)\/branch_protections$/,
    );
    if (protectionMatch && method === "GET") {
      // Gitea serves this to an owner or an admin collaborator and nobody
      // else, which is the whole reason the BFF reads it as the service
      // account. A caller's own token gets the 403 a reviewer would get.
      const auth = headers.get("Authorization") ?? "";
      const token = auth.startsWith("token ") ? auth.slice(6) : "";
      if (!protectionReadable || token !== SERVICE_TOKEN) {
        return json(
          {
            message:
              "user should be an owner or a collaborator with admin write of a repository",
          },
          403,
        );
      }
      return json([
        { rule_name: "main", required_approvals: requiredApprovals },
      ]);
    }

    const prMatch = path.match(
      /^\/api\/v1\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)$/,
    );
    if (prMatch) {
      if (method === "PATCH") {
        const logins = Array.isArray(parsed?.assignees)
          ? (parsed.assignees as string[])
          : [];
        assigneeCalls.push(logins);
        assignees = logins.map(person);
        return json({});
      }

      if (method === "GET") {
        return json({
          number: Number(prMatch[3]),
          state: "open",
          head: { ref: "upload/v2" },
          user: person("bob"),
          assignees,
          requested_reviewers: requestedReviewers,
        });
      }
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
  config.giteaServiceToken = originalServiceToken;
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
    giteaTokenName: "assign-test-token",
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

const ASSIGNMENTS =
  "/api/app/documents/alice/contract/pull-requests/3/assignments";

function request(body: Record<string, unknown> | null, sessionId: string) {
  return new Request(`http://localhost${ASSIGNMENTS}`, {
    method: "PUT",
    headers: {
      Origin: config.appOrigin,
      Cookie: `${config.sessionCookieName}=${sessionId}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body ?? {}),
  });
}

describe("change assignment route", () => {
  test("names an assignee and reports it back", async () => {
    const server = createApiServer();
    const session = await seedSession("alice");

    const response = await server.fetch(request({ assignee: "kim" }, session));
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(assigneeCalls).toEqual([["kim"]]);
    expect(payload.assignee).toEqual({
      login: "kim",
      fullName: "Kim Reyes",
      avatarUrl: "https://gitea.test/kim.png",
    });
  });

  test("clears the assignee when handed null", async () => {
    const server = createApiServer();
    const session = await seedSession("alice");

    await server.fetch(request({ assignee: "kim" }, session));
    const response = await server.fetch(request({ assignee: null }, session));

    expect(response.status).toBe(200);
    expect(assigneeCalls).toEqual([["kim"], []]);
    expect((await response.json()).assignee).toBeNull();
  });

  test("writes only the difference between the two reviewer lists", async () => {
    const server = createApiServer();
    const session = await seedSession("alice");
    requestedReviewers = [person("dana"), person("kim")];

    const response = await server.fetch(
      request({ reviewers: ["dana", "lee"] }, session),
    );

    expect(response.status).toBe(200);
    expect(reviewerCalls).toEqual([
      { method: "POST", reviewers: ["lee"] },
      { method: "DELETE", reviewers: ["kim"] },
    ]);
  });

  test("never asks the submitter to review their own change", async () => {
    const server = createApiServer();
    const session = await seedSession("alice");

    const response = await server.fetch(
      request({ reviewers: ["bob", "lee"] }, session),
    );

    expect(response.status).toBe(200);
    // "bob" opened this change; Gitea would reject the request with a 422 and
    // take the rest of the edit down with it.
    expect(reviewerCalls).toEqual([{ method: "POST", reviewers: ["lee"] }]);
  });

  test("reports where every reviewer stands, against what publishing needs", async () => {
    const server = createApiServer();
    const session = await seedSession("alice");

    const response = await server.fetch(
      request({ reviewers: ["dana", "lee"] }, session),
    );
    const payload = (await response.json()) as {
      reviewers: { login: string; status: string; requested: boolean }[];
      approvalCount: number;
      requiredApprovals: number | null;
    };

    expect(payload.approvalCount).toBe(1);
    expect(payload.requiredApprovals).toBe(2);
    // The one nobody has heard from comes first: that is who it waits on.
    expect(
      payload.reviewers.map((reviewer) => [reviewer.login, reviewer.status]),
    ).toEqual([
      ["lee", "awaiting"],
      ["dana", "approved"],
    ]);
  });

  test("a write collaborator is told what publishing needs", async () => {
    const server = createApiServer();
    // Bob's own Gitea token is refused the branch protection rule; the count
    // comes back anyway, because the BFF reads it as the service account.
    const session = await seedSession("carol");

    const response = await server.fetch(
      request({ reviewers: ["dana"] }, session),
    );
    const payload = (await response.json()) as {
      requiredApprovals: number | null;
    };

    expect(response.status).toBe(200);
    expect(payload.requiredApprovals).toBe(2);
  });

  test("reports an unreadable policy as unknown rather than none", async () => {
    protectionReadable = false;
    const server = createApiServer();
    const session = await seedSession("alice");

    const response = await server.fetch(
      request({ reviewers: ["dana"] }, session),
    );
    const payload = (await response.json()) as {
      requiredApprovals: number | null;
    };

    expect(response.status).toBe(200);
    expect(payload.requiredApprovals).toBeNull();
  });

  test("rejects a request that changes nothing", async () => {
    const server = createApiServer();
    const session = await seedSession("alice");

    const response = await server.fetch(request({}, session));

    expect(response.status).toBe(400);
    expect(reviewerCalls).toEqual([]);
    expect(assigneeCalls).toEqual([]);
  });

  test("rejects a reviewer list that is not a list", async () => {
    const server = createApiServer();
    const session = await seedSession("alice");

    const response = await server.fetch(
      request({ reviewers: "dana" }, session),
    );

    expect(response.status).toBe(400);
    expect(reviewerCalls).toEqual([]);
  });

  test("turns away a caller with no session", async () => {
    const server = createApiServer();

    const response = await server.fetch(
      new Request(`http://localhost${ASSIGNMENTS}`, {
        method: "PUT",
        headers: {
          Origin: config.appOrigin,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ assignee: "kim" }),
      }),
    );

    expect(response.status).toBe(401);
    expect(assigneeCalls).toEqual([]);
  });
});
