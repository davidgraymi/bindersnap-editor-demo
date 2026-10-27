import { afterEach, beforeEach, expect, test } from "bun:test";
import { randomUUID } from "crypto";

import { config } from "./config";
import { emailVerificationStore } from "./email-verification";
import { emailOutboxStore } from "./mail/outbox";
import { createApiServer } from "./server";
import { SessionStore, sessionStore } from "./sessions";

/**
 * The console's System, Configuration and New account routes: only a site
 * admin reaches them, a secret never leaves the API, and a new account is
 * made with the admin token and greeted the right way.
 */

const SECRETS = {
  giteaAdminToken: `admin-token-${randomUUID()}`,
  giteaServiceToken: `service-token-${randomUUID()}`,
  stripeSecretKey: `sk_test_${randomUUID()}`,
  stripeWebhookSecret: `whsec_${randomUUID()}`,
  sessionSecret: `session-${randomUUID()}`,
};

const originalFetch = globalThis.fetch;
const original = {
  sessionsDbPath: config.sessionsDbPath,
  apiPort: config.apiPort,
  release: config.release,
  ...Object.fromEntries(
    Object.keys(SECRETS).map((key) => [
      key,
      (config as unknown as Record<string, unknown>)[key],
    ]),
  ),
};

let isAdmin = true;
let existingEmail: string | null = null;
let createdUsers: Array<{ body: Record<string, unknown>; auth: string }> = [];

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  config.apiPort = 0;
  config.release = "2ec0a5b93e300610fd6051d349e54a25e4ec0829";
  Object.assign(config, SECRETS);
  config.sessionsDbPath = `/tmp/bindersnap-admin-routes-${randomUUID()}.sqlite`;
  (sessionStore as unknown as { _store: SessionStore | null })._store =
    new SessionStore(config.sessionsDbPath);

  isAdmin = true;
  existingEmail = null;
  createdUsers = [];

  globalThis.fetch = (async (input, init) => {
    const request = input instanceof Request ? input : null;
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url,
    );
    const method = request?.method ?? init?.method ?? "GET";
    const headers = new Headers(request?.headers ?? init?.headers);
    const path = url.pathname;

    if (path === "/api/v1/user") {
      return json({ login: "root", full_name: "Rae Root", is_admin: isAdmin });
    }
    if (path === "/api/v1/version") return json({ version: "28.0.0" });
    if (path === "/api/v1/admin/emails/search") {
      return json(
        existingEmail ? [{ email: existingEmail, username: "taken" }] : [],
      );
    }
    if (path === "/api/v1/admin/users" && method === "POST") {
      const body = JSON.parse(
        request ? await request.text() : String(init?.body ?? "{}"),
      ) as Record<string, unknown>;
      createdUsers.push({ body, auth: headers.get("Authorization") ?? "" });
      return json({ id: 77, login: body.username }, 201);
    }
    return json({ message: "Not found" }, 404);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  Object.assign(config, original);
});

async function seedSession(): Promise<string> {
  const id = `sess_${randomUUID()}`;
  await sessionStore.put({
    id,
    username: "root",
    giteaToken: `gitea_${randomUUID()}`,
    giteaTokenName: "admin-routes-test",
    createdAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  });
  return id;
}

function request(
  sessionId: string,
  path: string,
  body?: Record<string, unknown>,
): Request {
  return new Request(`http://localhost${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Origin: config.appOrigin,
      Cookie: `${config.sessionCookieName}=${sessionId}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

test("only a site admin reaches the console's routes", async () => {
  const server = createApiServer();
  const session = await seedSession();
  isAdmin = false;
  try {
    for (const path of ["/api/app/admin/config", "/api/app/admin/system"]) {
      expect((await server.fetch(request(session, path))).status).toBe(403);
    }
    const create = await server.fetch(
      request(session, "/api/app/admin/users", {
        firstName: "Jordan",
        lastName: "Kim",
        email: "jordan@example.com",
      }),
    );
    expect(create.status).toBe(403);
    expect(createdUsers).toEqual([]);
  } finally {
    server.stop(true);
  }
});

test("the configuration says a secret is set and never what it is", async () => {
  const server = createApiServer();
  const session = await seedSession();
  try {
    const response = await server.fetch(
      request(session, "/api/app/admin/config"),
    );
    expect(response.status).toBe(200);
    const text = await response.text();
    for (const secret of Object.values(SECRETS)) {
      expect(text).not.toContain(secret);
    }
    const { sections } = JSON.parse(text) as {
      sections: Array<{
        entries: Array<{ key: string; secret: boolean; isSet: boolean }>;
      }>;
    };
    const entries = sections.flatMap((section) => section.entries);
    expect(entries.find((entry) => entry.key === "stripeSecretKey")).toEqual(
      expect.objectContaining({ secret: true, isSet: true }),
    );
    expect(
      entries.find((entry) => entry.key === "giteaUrl"),
    ).not.toHaveProperty("secret", true);
  } finally {
    server.stop(true);
  }
});

test("the system page names the build, Gitea and the pinned images", async () => {
  const server = createApiServer();
  const session = await seedSession();
  try {
    const response = await server.fetch(
      request(session, "/api/app/admin/system"),
    );
    expect(response.status).toBe(200);
    const system = (await response.json()) as {
      bindersnap: { version: string; commit: string };
      gitea: { version: string };
      images: Array<{ service: string; name: string; tag: string }>;
    };
    expect(system.bindersnap.commit).toBe(config.release);
    expect(system.bindersnap.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(system.gitea.version).toBe("28.0.0");
    expect(system.images).toContainEqual(
      expect.objectContaining({
        service: "api",
        name: "ghcr.io/davidgraymi/bindersnap-api",
        tag: config.release,
      }),
    );
  } finally {
    server.stop(true);
  }
});

test("an account made without a password is emailed a link to choose one", async () => {
  const server = createApiServer();
  const session = await seedSession();
  const email = `jordan-${randomUUID()}@example.com`;
  try {
    const response = await server.fetch(
      request(session, "/api/app/admin/users", {
        firstName: "Jordan",
        lastName: "Kim",
        email,
        username: `jkim${Date.now()}`,
      }),
    );
    expect(response.status).toBe(201);
    const created = (await response.json()) as {
      username: string;
      emailed: string;
    };
    expect(created.emailed).toBe("welcome");

    // Made with the admin token, and with a password nobody was told.
    expect(createdUsers).toHaveLength(1);
    expect(createdUsers[0]!.auth).toBe(`token ${SECRETS.giteaAdminToken}`);
    expect(createdUsers[0]!.body).toMatchObject({
      username: created.username,
      email,
      full_name: "Jordan Kim",
    });
    expect(String(createdUsers[0]!.body.password).length).toBeGreaterThan(30);

    // Waiting on the address, which choosing a password confirms.
    expect(emailVerificationStore().status(created.username).state).toBe(
      "waiting",
    );
    const sent = emailOutboxStore()
      .due(Date.now() + 1000, 100)
      .filter((queued) => queued.recipient === email);
    expect(sent.map((queued) => queued.kind)).toEqual(["welcome"]);
    expect(sent[0]!.text).toContain("/-/reset_password?token=");
  } finally {
    server.stop(true);
  }
});

test("an account given a password still confirms its address by email", async () => {
  const server = createApiServer();
  const session = await seedSession();
  const email = `casey-${randomUUID()}@example.com`;
  try {
    const response = await server.fetch(
      request(session, "/api/app/admin/users", {
        firstName: "Casey",
        lastName: "Lee",
        email,
        password: "a-handed-over-password",
      }),
    );
    expect(response.status).toBe(201);
    const created = (await response.json()) as { emailed: string };
    expect(created.emailed).toBe("confirmation");
    expect(createdUsers[0]!.body.password).toBe("a-handed-over-password");
    const sent = emailOutboxStore()
      .due(Date.now() + 1000, 100)
      .filter((queued) => queued.recipient === email);
    expect(sent.map((queued) => queued.kind)).toEqual(["verify-email"]);
  } finally {
    server.stop(true);
  }
});

test("an address another account uses is refused before Gitea is asked", async () => {
  const server = createApiServer();
  const session = await seedSession();
  existingEmail = "taken@example.com";
  try {
    const response = await server.fetch(
      request(session, "/api/app/admin/users", {
        firstName: "Sam",
        lastName: "Taken",
        email: "taken@example.com",
      }),
    );
    expect(response.status).toBe(409);
    expect(createdUsers).toEqual([]);
  } finally {
    server.stop(true);
  }
});
