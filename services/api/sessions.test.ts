import { describe, test, expect, beforeEach } from "bun:test";
import { createMigratedTestDbPath } from "./db/test-helpers";
import { SessionStore, type SessionRecord } from "./sessions";

async function makeStore(): Promise<SessionStore> {
  return new SessionStore(
    await createMigratedTestDbPath("bindersnap-session-store-"),
  );
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

  beforeEach(async () => {
    store = await makeStore();
  });

  test("put then get returns the session", () => {
    const session = makeSession();
    store.put(session);
    const result = store.get(session.id);
    expect(result).toEqual(session);
  });

  test("get on unknown id returns null", () => {
    const result = store.get("nonexistent-id");
    expect(result).toBeNull();
  });

  test("delete removes the session", () => {
    const session = makeSession();
    store.put(session);
    store.delete(session.id);
    const result = store.get(session.id);
    expect(result).toBeNull();
  });

  test("reap removes only expired sessions and returns them", () => {
    const now = Date.now();
    const expired = makeSession({
      id: "expired-session",
      expiresAt: now - 1000,
    });
    const future = makeSession({
      id: "future-session",
      expiresAt: now + 60_000,
    });

    store.put(expired);
    store.put(future);

    const reaped = store.reap(now);

    expect(reaped).toHaveLength(1);
    expect(reaped[0].id).toBe("expired-session");

    expect(store.get("expired-session")).toBeNull();
    expect(store.get("future-session")).not.toBeNull();
  });

  test("reap returns empty array when nothing expired", () => {
    const now = Date.now();
    const future = makeSession({ expiresAt: now + 60_000 });
    store.put(future);

    const reaped = store.reap(now);
    expect(reaped).toHaveLength(0);
    expect(store.get(future.id)).not.toBeNull();
  });
});
