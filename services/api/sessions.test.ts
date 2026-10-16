import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionStore, type SessionRecord } from "./sessions";

function makeStore(): SessionStore {
  return new SessionStore(":memory:");
}

function makeSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  const now = Date.now();
  return {
    id: "test-session-id",
    username: "testuser",
    giteaToken: "tok_abc123",
    giteaTokenName: "bindersnap-session",
    createdAt: now,
    expiresAt: now + 60_000,
    ...overrides,
  };
}

describe("SessionStore", () => {
  let store: SessionStore;

  beforeEach(() => {
    store = makeStore();
  });

  test("put then get returns the session", async () => {
    const session = makeSession();
    await store.put(session);
    const result = await store.get(session.id);
    expect(result).toEqual(session);
  });

  test("get on unknown id returns null", async () => {
    const result = await store.get("nonexistent-id");
    expect(result).toBeNull();
  });

  test("delete removes the session", async () => {
    const session = makeSession();
    await store.put(session);
    await store.delete(session.id);
    const result = await store.get(session.id);
    expect(result).toBeNull();
  });

  test("reap removes only expired sessions and returns them", async () => {
    const now = Date.now();
    const expired = makeSession({
      id: "expired-session",
      expiresAt: now - 1000,
    });
    const future = makeSession({
      id: "future-session",
      expiresAt: now + 60_000,
    });

    await store.put(expired);
    await store.put(future);

    const reaped = await store.reap(now);

    expect(reaped).toHaveLength(1);
    // The cookie cannot be read back; the token, to revoke, can.
    expect(reaped[0]!.id).toBe(store.reference("expired-session"));
    expect(reaped[0]!.giteaToken).toBe("tok_abc123");

    expect(await store.get("expired-session")).toBeNull();
    expect(await store.get("future-session")).not.toBeNull();
  });

  test("reap returns empty array when nothing expired", async () => {
    const now = Date.now();
    const future = makeSession({ expiresAt: now + 60_000 });
    await store.put(future);

    const reaped = await store.reap(now);
    expect(reaped).toHaveLength(0);
    expect(await store.get(future.id)).not.toBeNull();
  });

  test("deleteForUser ends a person's other sessions and keeps this one", async () => {
    await store.put(makeSession({ id: "here", username: "jkim" }));
    await store.put(makeSession({ id: "laptop", username: "jkim" }));
    await store.put(makeSession({ id: "someone-else", username: "bob" }));

    const ended = await store.deleteForUser("jkim", "here");

    expect(ended.map((session) => session.id)).toEqual([
      store.reference("laptop"),
    ]);
    expect(await store.get("here")).not.toBeNull();
    expect(await store.get("laptop")).toBeNull();
    expect(await store.get("someone-else")).not.toBeNull();

    // Without an exception, every one of them goes.
    expect((await store.deleteForUser("jkim")).map((s) => s.id)).toEqual([
      store.reference("here"),
    ]);
  });

  test("a listed session's id finds the same row again", async () => {
    await store.put(makeSession({ id: "phone", username: "jkim" }));
    const [live] = await store.liveForUser("jkim");
    expect(live!.giteaToken).toBe("tok_abc123");
    expect((await store.getByReference(live!.id))?.username).toBe("jkim");
    // A reference is not a cookie: `get` hashes whatever it is given.
    expect(await store.get(live!.id)).toBeNull();
  });

  test("a cookie built from a row's key is no session", async () => {
    await store.put(makeSession({ id: "real-cookie", username: "jkim" }));
    // What somebody holding a copy of the database could read off a row.
    const forged = store.reference("real-cookie");
    expect(await store.get(forged)).toBeNull();
    expect(await store.get(forged.slice("ref:".length))).toBeNull();
    expect((await store.get("real-cookie"))?.username).toBe("jkim");
  });
});

describe("what the sessions database holds", () => {
  const dir = mkdtempSync(join(tmpdir(), "sessions-"));

  test("neither the cookie nor the Gitea token is stored as it is", async () => {
    const path = join(dir, "sealed.db");
    const store = new SessionStore(path, "secret-one");
    await store.put(
      makeSession({ id: "cookie-value", giteaToken: "tok_live" }),
    );

    const raw = new Database(path)
      .query("SELECT id, gitea_token FROM sessions")
      .all() as { id: string; gitea_token: string }[];
    expect(raw).toHaveLength(1);
    expect(raw[0]!.id).not.toContain("cookie-value");
    expect(raw[0]!.gitea_token).not.toContain("tok_live");

    expect((await store.get("cookie-value"))?.giteaToken).toBe("tok_live");
  });

  test("a session sealed with another key is no session", async () => {
    const path = join(dir, "rotated.db");
    await new SessionStore(path, "old-secret").put(
      makeSession({ id: "kept-cookie" }),
    );
    expect(
      await new SessionStore(path, "new-secret").get("kept-cookie"),
    ).toBeNull();
  });

  test("rows from before sealing are sealed in place, still signed in", async () => {
    const path = join(dir, "legacy.db");
    // Create the table, then write a row the way the old store did.
    new SessionStore(path, "secret");
    new Database(path)
      .query(
        "INSERT INTO sessions (id, username, gitea_token, gitea_token_name, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        "legacy-cookie",
        "jkim",
        "tok_old",
        "n",
        Date.now(),
        Date.now() + 60_000,
      );

    const store = new SessionStore(path, "secret");
    expect((await store.get("legacy-cookie"))?.giteaToken).toBe("tok_old");
    const raw = new Database(path)
      .query("SELECT id, gitea_token FROM sessions")
      .get() as { id: string; gitea_token: string };
    expect(raw.id).not.toBe("legacy-cookie");
    expect(raw.gitea_token).not.toContain("tok_old");
  });
});
