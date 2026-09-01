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
 * End-to-end coverage for reacting to a review comment.
 *
 * A reaction is the one write on a change that is not part of the approval
 * record, so these tests care about two things: that it reaches Gitea's own
 * reaction primitive rather than becoming a comment, and that it cannot be
 * used to reach a comment on some other change.
 */

type GiteaReaction = { content: string; user: { login: string } };

const originalFetch = globalThis.fetch;
const originalApiPort = config.apiPort;
const originalSessionsDbPath = config.sessionsDbPath;

let giteaUsersByLogin = new Map<string, { login: string; email: string }>();
let giteaLoginsByToken = new Map<string, string>();
let reactionsByComment = new Map<number, GiteaReaction[]>();
let reactionCalls: { method: string; commentId: number; content: string }[] =
  [];
let postedComments: string[] = [];

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function comment(id: number, body: string) {
  return {
    id,
    body,
    created_at: `2026-08-24T10:0${id}:00Z`,
    updated_at: `2026-08-24T10:0${id}:00Z`,
    html_url: `https://gitea.test/c/${id}`,
    user: { login: "bob", full_name: "Bob Ellis", avatar_url: "" },
  };
}

/** Two threads, so a cross-thread comment id has somewhere to point. */
const COMMENTS = [
  comment(
    1,
    "Is the cap capped?\n\n<!-- bindersnap:v1 kind=thread thread=t1 -->",
  ),
  comment(
    2,
    "Different concern\n\n<!-- bindersnap:v1 kind=thread thread=t2 -->",
  ),
];

beforeEach(() => {
  config.apiPort = 0;
  config.sessionsDbPath = `/tmp/bindersnap-reaction-test-${randomUUID()}.sqlite`;
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
  reactionsByComment = new Map();
  reactionCalls = [];
  postedComments = [];

  globalThis.fetch = (async (input, init) => {
    const requestUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
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
    const path = new URL(requestUrl).pathname;

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

    const reactionMatch = path.match(
      /^\/api\/v1\/repos\/[^/]+\/[^/]+\/issues\/comments\/(\d+)\/reactions$/,
    );
    if (reactionMatch) {
      const commentId = Number(reactionMatch[1]);
      const held = reactionsByComment.get(commentId) ?? [];

      if (method === "GET") {
        return json(held);
      }

      const content = String(parsed?.content ?? "");
      reactionCalls.push({ method, commentId, content });

      if (method === "POST") {
        reactionsByComment.set(commentId, [
          ...held,
          { content, user: { login: "alice" } },
        ]);
        return json({ content }, 201);
      }

      reactionsByComment.set(
        commentId,
        held.filter((entry) => entry.content !== content),
      );
      return new Response(null, { status: 204 });
    }

    const commentsMatch = path.match(
      /^\/api\/v1\/repos\/[^/]+\/[^/]+\/issues\/(\d+)\/comments$/,
    );
    if (commentsMatch) {
      if (method === "GET") return json(COMMENTS);
      postedComments.push(String(parsed?.body ?? ""));
      return json(comment(9, String(parsed?.body ?? "")), 201);
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
    giteaTokenName: "reaction-test-token",
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

function reactionUrl(threadId: string, commentId: number): string {
  return `/api/app/documents/alice/contract/pull-requests/3/discussions/${threadId}/comments/${commentId}/reactions`;
}

function request(
  threadId: string,
  commentId: number,
  body: Record<string, unknown>,
  sessionId: string,
): Request {
  return new Request(`http://localhost${reactionUrl(threadId, commentId)}`, {
    method: "PUT",
    headers: {
      Origin: config.appOrigin,
      Cookie: `${config.sessionCookieName}=${sessionId}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("comment reaction route", () => {
  test("leaves a reaction on the comment and hands back the discussion", async () => {
    const server = createApiServer();
    const session = await seedSession("alice");

    const response = await server.fetch(
      request("t1", 1, { content: "+1", on: true }, session),
    );
    const payload = (await response.json()) as {
      threads: {
        id: string;
        comments: { id: number; reactions: unknown[] }[];
      }[];
    };

    expect(response.status).toBe(200);
    expect(reactionCalls).toEqual([
      { method: "POST", commentId: 1, content: "+1" },
    ]);
    // A reaction is a reaction, never another comment in the record.
    expect(postedComments).toEqual([]);

    const thread = payload.threads.find((entry) => entry.id === "t1");
    expect(thread?.comments[0]?.reactions[0]).toMatchObject({
      content: "+1",
      count: 1,
      viewerReacted: true,
    });
  });

  test("taking a reaction back deletes it", async () => {
    const server = createApiServer();
    const session = await seedSession("alice");
    reactionsByComment.set(1, [{ content: "+1", user: { login: "alice" } }]);

    const response = await server.fetch(
      request("t1", 1, { content: "+1", on: false }, session),
    );

    expect(response.status).toBe(200);
    expect(reactionCalls).toEqual([
      { method: "DELETE", commentId: 1, content: "+1" },
    ]);
    expect(reactionsByComment.get(1)).toEqual([]);
  });

  test("a comment on another thread cannot be reached through this one", async () => {
    const server = createApiServer();
    const session = await seedSession("alice");

    const response = await server.fetch(
      request("t1", 2, { content: "+1", on: true }, session),
    );

    expect(response.status).toBe(404);
    expect(reactionCalls).toEqual([]);
  });

  test("a reaction outside the vocabulary is refused", async () => {
    const server = createApiServer();
    const session = await seedSession("alice");

    const response = await server.fetch(
      request("t1", 1, { content: "rocket", on: true }, session),
    );

    expect(response.status).toBe(400);
    expect(reactionCalls).toEqual([]);
  });

  test("a request that does not say which way is refused, not guessed", async () => {
    const server = createApiServer();
    const session = await seedSession("alice");

    const response = await server.fetch(
      request("t1", 1, { content: "+1" }, session),
    );

    // Defaulting to `false` would quietly delete a reaction somebody left.
    expect(response.status).toBe(400);
    expect(reactionCalls).toEqual([]);
  });

  test("a signed-out reader cannot react", async () => {
    const server = createApiServer();

    const response = await server.fetch(
      new Request(`http://localhost${reactionUrl("t1", 1)}`, {
        method: "PUT",
        headers: {
          Origin: config.appOrigin,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: "+1", on: true }),
      }),
    );

    expect(response.status).toBe(401);
    expect(reactionCalls).toEqual([]);
  });
});
