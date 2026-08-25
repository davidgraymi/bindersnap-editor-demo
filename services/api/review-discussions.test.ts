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
 * End-to-end coverage for the discussion routes and, most importantly, the
 * publish gate: the BFF is the only path to a merge, so "block publishing
 * while threads are unresolved" has to hold here even if a client ignores the
 * disabled button.
 */

type MockedComment = {
  id: number;
  body: string;
  created_at: string;
  updated_at: string;
  html_url: string;
  user: { login: string; full_name: string; avatar_url: string };
};

const originalFetch = globalThis.fetch;
const originalApiPort = config.apiPort;
const originalSessionsDbPath = config.sessionsDbPath;

let giteaUsersByLogin = new Map<string, { login: string; email: string }>();
let giteaLoginsByToken = new Map<string, string>();
let commentsByPR = new Map<string, MockedComment[]>();
let reactionsByComment = new Map<
  number,
  { content: string; login: string }[]
>();
let reviewConfigFile: string | null = null;
let mergeCalls = 0;
let nextCommentId = 1;

function prKey(owner: string, repo: string, index: number): string {
  return `${owner}/${repo}#${index}`;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  config.apiPort = 0;
  config.stripeSecretKey = "sk_test_disc";
  config.stripeWebhookSecret = "whsec_test_disc";
  config.stripePriceId = "price_test_disc";
  config.sessionsDbPath = `/tmp/bindersnap-disc-test-${randomUUID()}.sqlite`;
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
  commentsByPR = new Map();
  reactionsByComment = new Map();
  reviewConfigFile = null;
  mergeCalls = 0;
  nextCommentId = 1;

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
    const parsed = rawBody ? (JSON.parse(rawBody) as any) : null;
    const path = url.pathname;

    if (path === "/api/v1/user") {
      const auth = headers.get("Authorization") ?? "";
      const token = auth.startsWith("token ") ? auth.slice(6) : "";
      const login = giteaLoginsByToken.get(token);
      const user = login ? giteaUsersByLogin.get(login) : null;
      if (!user) return json({ message: "Not found" }, 404);
      return json({ ...user, full_name: "", is_admin: false });
    }

    // Issue comments — the substrate the whole thread model sits on.
    const commentsMatch = path.match(
      /^\/api\/v1\/repos\/([^/]+)\/([^/]+)\/issues\/(\d+)\/comments$/,
    );
    if (commentsMatch) {
      const key = prKey(
        commentsMatch[1]!,
        commentsMatch[2]!,
        Number(commentsMatch[3]),
      );
      const list = commentsByPR.get(key) ?? [];

      if (method === "GET") return json(list);

      if (method === "POST") {
        const auth = headers.get("Authorization") ?? "";
        const token = auth.startsWith("token ") ? auth.slice(6) : "";
        const login = giteaLoginsByToken.get(token) ?? "unknown";
        const id = nextCommentId++;
        const created: MockedComment = {
          id,
          body: parsed?.body ?? "",
          created_at: new Date(1_800_000_000_000 + id * 1000).toISOString(),
          updated_at: new Date(1_800_000_000_000 + id * 1000).toISOString(),
          html_url: `https://gitea.test/c/${id}`,
          user: { login, full_name: login, avatar_url: "" },
        };
        commentsByPR.set(key, [...list, created]);
        return json(created, 201);
      }
    }

    // Reactions hang on a comment, not on the pull request.
    const reactionsMatch = path.match(
      /^\/api\/v1\/repos\/([^/]+)\/([^/]+)\/issues\/comments\/(\d+)\/reactions$/,
    );
    if (reactionsMatch) {
      const commentId = Number(reactionsMatch[3]);
      const list = reactionsByComment.get(commentId) ?? [];
      const auth = headers.get("Authorization") ?? "";
      const token = auth.startsWith("token ") ? auth.slice(6) : "";
      const login = giteaLoginsByToken.get(token) ?? "unknown";

      if (method === "GET") {
        return json(
          list.map((entry) => ({
            content: entry.content,
            created_at: new Date(1_800_000_000_000).toISOString(),
            user: {
              login: entry.login,
              full_name: entry.login,
              avatar_url: "",
            },
          })),
        );
      }

      if (method === "POST") {
        const content = parsed?.content ?? "";
        const already = list.some(
          (entry) => entry.content === content && entry.login === login,
        );
        if (!already) {
          reactionsByComment.set(commentId, [...list, { content, login }]);
        }
        return json({ content }, 201);
      }

      if (method === "DELETE") {
        const content = parsed?.content ?? "";
        reactionsByComment.set(
          commentId,
          list.filter(
            (entry) => !(entry.content === content && entry.login === login),
          ),
        );
        return new Response(null, { status: 204 });
      }
    }

    // Review policy file on the config branch.
    const contentsMatch = path.match(
      /^\/api\/v1\/repos\/([^/]+)\/([^/]+)\/contents\/(.+)$/,
    );
    if (contentsMatch) {
      if (method === "GET") {
        if (reviewConfigFile === null)
          return json({ message: "Not found" }, 404);
        return json({
          content: Buffer.from(reviewConfigFile, "utf8").toString("base64"),
          sha: "config-sha",
        });
      }
      if (method === "PUT" || method === "POST") {
        reviewConfigFile = Buffer.from(
          parsed?.content ?? "",
          "base64",
        ).toString("utf8");
        return json({ content: {}, commit: {} }, 201);
      }
    }

    const branchMatch = path.match(
      /^\/api\/v1\/repos\/([^/]+)\/([^/]+)\/branches\/([^/]+)$/,
    );
    if (branchMatch && method === "GET") {
      return json({ name: branchMatch[3] });
    }

    const mergeMatch = path.match(
      /^\/api\/v1\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)\/merge$/,
    );
    if (mergeMatch && method === "POST") {
      mergeCalls += 1;
      return new Response(null, { status: 200 });
    }

    const prMatch = path.match(
      /^\/api\/v1\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)$/,
    );
    if (prMatch && method === "GET") {
      return json({
        number: Number(prMatch[3]),
        state: "open",
        mergeable: true,
        head: { ref: "upload/v2" },
      });
    }

    const tagsMatch = path.match(/^\/api\/v1\/repos\/([^/]+)\/([^/]+)\/tags$/);
    if (tagsMatch) {
      if (method === "GET") return json([]);
      if (method === "POST") {
        return json({
          name: parsed?.tag_name ?? "doc/v0001",
          commit: { sha: "abc", created: new Date().toISOString() },
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
    giteaTokenName: "disc-test-token",
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

function request(
  pathname: string,
  sessionId: string,
  options?: { method?: string; body?: Record<string, unknown> },
): Request {
  return new Request(`http://localhost${pathname}`, {
    method: options?.method ?? "GET",
    headers: {
      Origin: config.appOrigin,
      Cookie: `${config.sessionCookieName}=${sessionId}`,
      ...(options?.body ? { "Content-Type": "application/json" } : {}),
    },
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });
}

function setPolicy(blockOnUnresolvedThreads: boolean): void {
  reviewConfigFile = JSON.stringify({
    version: 1,
    review: { blockOnUnresolvedThreads },
  });
}

const OWNER = "alice";
const REPO = "contract";
const PR = 3;
const DISCUSSIONS = `/api/app/documents/${OWNER}/${REPO}/pull-requests/${PR}/discussions`;
const PUBLISH = `/api/app/documents/${OWNER}/${REPO}/pull-requests/${PR}/publish`;

describe("review discussion routes", () => {
  test("starts a thread and reads it back", async () => {
    const server = createApiServer();
    const session = await seedSession(OWNER);

    try {
      const created = await server.fetch(
        request(DISCUSSIONS, session, {
          method: "POST",
          body: { body: "Clause 4 needs legal sign-off." },
        }),
      );
      expect(created.status).toBe(201);

      const listed = await server.fetch(request(DISCUSSIONS, session));
      const payload = (await listed.json()) as any;

      expect(listed.status).toBe(200);
      expect(payload.threads).toHaveLength(1);
      expect(payload.threads[0].comments[0].body).toBe(
        "Clause 4 needs legal sign-off.",
      );
      expect(payload.unresolvedCount).toBe(1);
    } finally {
      server.stop(true);
    }
  });

  test("rejects an empty comment body", async () => {
    const server = createApiServer();
    const session = await seedSession(OWNER);

    try {
      const response = await server.fetch(
        request(DISCUSSIONS, session, { method: "POST", body: { body: "  " } }),
      );
      expect(response.status).toBe(400);
    } finally {
      server.stop(true);
    }
  });

  test("an invalid thread id in the URL yields 400, not 500", async () => {
    // Regression: GiteaApiError(0) used to reach json(0, …), which Response()
    // rejects, turning a malformed-request error into a crash and a 500.
    const server = createApiServer();
    const session = await seedSession(OWNER);

    try {
      const response = await server.fetch(
        request(
          `${DISCUSSIONS}/${encodeURIComponent("not a!valid*id")}/comments`,
          session,
          {
            method: "POST",
            body: { body: "Reply to a bogus thread." },
          },
        ),
      );
      expect(response.status).toBe(400);
    } finally {
      server.stop(true);
    }
  });

  test("replies attach to the thread and resolving clears the count", async () => {
    const server = createApiServer();
    const session = await seedSession(OWNER);

    try {
      const created = await server.fetch(
        request(DISCUSSIONS, session, {
          method: "POST",
          body: { body: "Please cite the source document." },
        }),
      );
      const threadId = ((await created.json()) as any).threads[0].id;

      const replied = await server.fetch(
        request(`${DISCUSSIONS}/${threadId}/comments`, session, {
          method: "POST",
          body: { body: "Added in section 2." },
        }),
      );
      expect(((await replied.json()) as any).threads[0].comments).toHaveLength(
        2,
      );

      const resolved = await server.fetch(
        request(`${DISCUSSIONS}/${threadId}/resolve`, session, {
          method: "POST",
          body: { resolved: true },
        }),
      );
      const payload = (await resolved.json()) as any;

      expect(payload.threads[0].resolved).toBe(true);
      expect(payload.unresolvedCount).toBe(0);
      // Resolution is appended, never an edit of the original comment.
      expect(payload.threads[0].comments).toHaveLength(2);
      expect(payload.threads[0].events).toHaveLength(1);
    } finally {
      server.stop(true);
    }
  });

  test("a reaction lands on the thread and comes back marked as the reader's", async () => {
    const server = createApiServer();
    const session = await seedSession(OWNER);

    try {
      const created = await server.fetch(
        request(DISCUSSIONS, session, {
          method: "POST",
          body: { body: "Clause 4 needs legal sign-off." },
        }),
      );
      const threadId = ((await created.json()) as any).threads[0].id;

      const reacted = await server.fetch(
        request(`${DISCUSSIONS}/${threadId}/reactions`, session, {
          method: "POST",
          body: { content: "+1", reacted: true },
        }),
      );
      const payload = (await reacted.json()) as any;

      expect(reacted.status).toBe(200);
      expect(payload.threads[0].reactions).toEqual([
        {
          content: "+1",
          count: 1,
          users: [OWNER],
          reactedByViewer: true,
        },
      ]);
      // A reaction is not a comment and must never become one: the record of
      // what people said is unchanged.
      expect(payload.threads[0].comments).toHaveLength(1);
      expect(payload.unresolvedCount).toBe(1);
    } finally {
      server.stop(true);
    }
  });

  test("a reaction can be taken back", async () => {
    const server = createApiServer();
    const session = await seedSession(OWNER);

    try {
      const created = await server.fetch(
        request(DISCUSSIONS, session, {
          method: "POST",
          body: { body: "A concern." },
        }),
      );
      const threadId = ((await created.json()) as any).threads[0].id;

      await server.fetch(
        request(`${DISCUSSIONS}/${threadId}/reactions`, session, {
          method: "POST",
          body: { content: "eyes", reacted: true },
        }),
      );

      const removed = await server.fetch(
        request(`${DISCUSSIONS}/${threadId}/reactions`, session, {
          method: "POST",
          body: { content: "eyes", reacted: false },
        }),
      );

      expect(((await removed.json()) as any).threads[0].reactions).toEqual([]);
    } finally {
      server.stop(true);
    }
  });

  test("asking for the same reaction twice is still one reaction", async () => {
    const server = createApiServer();
    const session = await seedSession(OWNER);

    try {
      const created = await server.fetch(
        request(DISCUSSIONS, session, {
          method: "POST",
          body: { body: "A concern." },
        }),
      );
      const threadId = ((await created.json()) as any).threads[0].id;

      for (let attempt = 0; attempt < 2; attempt += 1) {
        await server.fetch(
          request(`${DISCUSSIONS}/${threadId}/reactions`, session, {
            method: "POST",
            body: { content: "+1", reacted: true },
          }),
        );
      }

      const listed = await server.fetch(request(DISCUSSIONS, session));
      const payload = (await listed.json()) as any;

      expect(payload.threads[0].reactions[0].count).toBe(1);
    } finally {
      server.stop(true);
    }
  });

  test("an emoji outside the picker is refused", async () => {
    const server = createApiServer();
    const session = await seedSession(OWNER);

    try {
      const created = await server.fetch(
        request(DISCUSSIONS, session, {
          method: "POST",
          body: { body: "A concern." },
        }),
      );
      const threadId = ((await created.json()) as any).threads[0].id;

      const response = await server.fetch(
        request(`${DISCUSSIONS}/${threadId}/reactions`, session, {
          method: "POST",
          body: { content: "rocket", reacted: true },
        }),
      );

      expect(response.status).toBe(400);
    } finally {
      server.stop(true);
    }
  });

  test("rejects a reaction request with no explicit boolean", async () => {
    const server = createApiServer();
    const session = await seedSession(OWNER);

    try {
      const created = await server.fetch(
        request(DISCUSSIONS, session, {
          method: "POST",
          body: { body: "A concern." },
        }),
      );
      const threadId = ((await created.json()) as any).threads[0].id;

      const response = await server.fetch(
        request(`${DISCUSSIONS}/${threadId}/reactions`, session, {
          method: "POST",
          body: { content: "+1" },
        }),
      );

      expect(response.status).toBe(400);
    } finally {
      server.stop(true);
    }
  });

  test("a reaction does not gate publishing the way a thread does", async () => {
    // Reactions are feeling, not a raised concern. Only an unresolved thread
    // may stand between a version and its release.
    setPolicy(true);
    const server = createApiServer();
    const session = await seedSession(OWNER);

    try {
      const created = await server.fetch(
        request(DISCUSSIONS, session, {
          method: "POST",
          body: { body: "Looks good to me." },
        }),
      );
      const threadId = ((await created.json()) as any).threads[0].id;

      await server.fetch(
        request(`${DISCUSSIONS}/${threadId}/reactions`, session, {
          method: "POST",
          body: { content: "-1", reacted: true },
        }),
      );

      const resolved = await server.fetch(
        request(`${DISCUSSIONS}/${threadId}/resolve`, session, {
          method: "POST",
          body: { resolved: true },
        }),
      );
      const payload = (await resolved.json()) as any;

      // The thumbs-down is on the record, and the count it does not touch is
      // the one publishing looks at.
      expect(payload.threads[0].reactions[0].content).toBe("-1");
      expect(payload.unresolvedCount).toBe(0);
    } finally {
      server.stop(true);
    }
  });

  test("rejects a resolve request with no explicit boolean", async () => {
    const server = createApiServer();
    const session = await seedSession(OWNER);

    try {
      const created = await server.fetch(
        request(DISCUSSIONS, session, {
          method: "POST",
          body: { body: "A concern." },
        }),
      );
      const threadId = ((await created.json()) as any).threads[0].id;

      const response = await server.fetch(
        request(`${DISCUSSIONS}/${threadId}/resolve`, session, {
          method: "POST",
          body: { notTheRightField: true },
        }),
      );

      expect(response.status).toBe(400);
    } finally {
      server.stop(true);
    }
  });

  test("requires a session", async () => {
    const server = createApiServer();

    try {
      const response = await server.fetch(
        new Request(`http://localhost${DISCUSSIONS}`, {
          method: "POST",
          headers: {
            Origin: config.appOrigin,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ body: "sneaky" }),
        }),
      );
      expect(response.status).toBe(401);
    } finally {
      server.stop(true);
    }
  });
});

describe("publish gate on unresolved threads", () => {
  test("blocks publishing when the policy is on and a thread is open", async () => {
    const server = createApiServer();
    const session = await seedSession(OWNER);
    setPolicy(true);

    try {
      await server.fetch(
        request(DISCUSSIONS, session, {
          method: "POST",
          body: { body: "Unresolved concern." },
        }),
      );

      const response = await server.fetch(
        request(PUBLISH, session, {
          method: "POST",
          body: { nextVersion: 1 },
        }),
      );
      const payload = (await response.json()) as any;

      expect(response.status).toBe(409);
      expect(payload.unresolvedCount).toBe(1);
      // The merge must never have been attempted.
      expect(mergeCalls).toBe(0);
    } finally {
      server.stop(true);
    }
  });

  test("allows publishing once the thread is resolved", async () => {
    const server = createApiServer();
    const session = await seedSession(OWNER);
    setPolicy(true);

    try {
      const created = await server.fetch(
        request(DISCUSSIONS, session, {
          method: "POST",
          body: { body: "Concern to be settled." },
        }),
      );
      const threadId = ((await created.json()) as any).threads[0].id;

      await server.fetch(
        request(`${DISCUSSIONS}/${threadId}/resolve`, session, {
          method: "POST",
          body: { resolved: true },
        }),
      );

      const response = await server.fetch(
        request(PUBLISH, session, {
          method: "POST",
          body: { nextVersion: 1 },
        }),
      );

      expect(response.status).toBe(200);
      expect(mergeCalls).toBe(1);
    } finally {
      server.stop(true);
    }
  });

  test("does not block when the policy is off", async () => {
    const server = createApiServer();
    const session = await seedSession(OWNER);
    setPolicy(false);

    try {
      await server.fetch(
        request(DISCUSSIONS, session, {
          method: "POST",
          body: { body: "Still open, but not gating." },
        }),
      );

      const response = await server.fetch(
        request(PUBLISH, session, {
          method: "POST",
          body: { nextVersion: 1 },
        }),
      );

      expect(response.status).toBe(200);
      expect(mergeCalls).toBe(1);
    } finally {
      server.stop(true);
    }
  });

  test("does not block when no policy file exists at all", async () => {
    const server = createApiServer();
    const session = await seedSession(OWNER);
    // reviewConfigFile stays null — an unconfigured document.

    try {
      await server.fetch(
        request(DISCUSSIONS, session, {
          method: "POST",
          body: { body: "Open thread on an unconfigured document." },
        }),
      );

      const response = await server.fetch(
        request(PUBLISH, session, {
          method: "POST",
          body: { nextVersion: 1 },
        }),
      );

      expect(response.status).toBe(200);
    } finally {
      server.stop(true);
    }
  });

  test("a Gitea-native comment does not wedge the document shut", async () => {
    const server = createApiServer();
    const session = await seedSession(OWNER);
    setPolicy(true);

    // A review body written outside Bindersnap carries no thread marker and
    // can never be resolved through this API — it must not gate publishing.
    commentsByPR.set(prKey(OWNER, REPO, PR), [
      {
        id: 99,
        body: "Changes requested: tighten the indemnity clause.",
        created_at: new Date(1_800_000_000_000).toISOString(),
        updated_at: new Date(1_800_000_000_000).toISOString(),
        html_url: "https://gitea.test/c/99",
        user: { login: "bob", full_name: "Bob", avatar_url: "" },
      },
    ]);

    try {
      const listed = await server.fetch(request(DISCUSSIONS, session));
      const payload = (await listed.json()) as any;
      expect(payload.threads).toHaveLength(1);
      expect(payload.threads[0].origin).toBe("external");
      expect(payload.unresolvedCount).toBe(0);

      const response = await server.fetch(
        request(PUBLISH, session, {
          method: "POST",
          body: { nextVersion: 1 },
        }),
      );
      expect(response.status).toBe(200);
    } finally {
      server.stop(true);
    }
  });
});
