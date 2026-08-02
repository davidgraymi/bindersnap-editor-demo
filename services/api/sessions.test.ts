import { describe, test, expect, beforeEach } from "bun:test";
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
    expect(reaped[0]!.id).toBe("expired-session");

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
});
