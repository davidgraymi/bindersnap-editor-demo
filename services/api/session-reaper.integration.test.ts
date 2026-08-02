// Integration tests for the session reaper composed with the real
// SessionStore (in-memory SQLite). The unit tests in session-reaper.test.ts
// cover orchestration with a mock backend; these exercise the actual
// SQL round-trips:
//
//   - rows are actually inserted via the backend's put() path,
//   - reap() actually deletes them in SQL,
//   - the reaper calls revoke() with whatever the backend hands back.

import { describe, test, expect, beforeEach } from "bun:test";
import { runSessionReaper } from "./session-reaper";
import { SessionStore, type SessionRecord } from "./sessions";

function makeSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  const now = 1_700_000_000_000;
  return {
    id: `sess-${Math.random().toString(36).slice(2, 10)}`,
    username: "alice",
    giteaToken: "tok_plain_xyz",
    giteaTokenName: "bindersnap-session",
    createdAt: now,
    expiresAt: now + 60_000,
    ...overrides,
  };
}

describe("session reaper × SessionStore (SQLite, integration)", () => {
  let store: SessionStore;

  beforeEach(() => {
    store = new SessionStore(":memory:");
  });

  test("reaps only expired rows and leaves live ones in place", async () => {
    const live = makeSession({ id: "live-1", expiresAt: 10_000 });
    const expiredA = makeSession({
      id: "expired-a",
      username: "alice",
      expiresAt: 1_000,
    });
    const expiredB = makeSession({
      id: "expired-b",
      username: "bob",
      expiresAt: 1_500,
    });
    await store.put(live);
    await store.put(expiredA);
    await store.put(expiredB);

    const revoked: string[] = [];
    const result = await runSessionReaper({
      sessionStore: store,
      revoke: async (s) => {
        revoked.push(s.id);
      },
      now: 5_000,
    });

    expect(result).toEqual({ reaped: 2, revokeErrors: 0 });
    expect(revoked.sort()).toEqual(["expired-a", "expired-b"]);
    expect(await store.get("live-1")).not.toBeNull();
    expect(await store.get("expired-a")).toBeNull();
    expect(await store.get("expired-b")).toBeNull();
  });

  test("revoke receives the round-tripped session record", async () => {
    const sess = makeSession({
      id: "rt-1",
      username: "carol",
      giteaToken: "tok_unique_carol",
      giteaTokenName: "carol-tok",
      expiresAt: 1_000,
    });
    await store.put(sess);

    let observed: SessionRecord | null = null;
    await runSessionReaper({
      sessionStore: store,
      revoke: async (s) => {
        observed = s;
      },
      now: 5_000,
    });

    expect(observed).not.toBeNull();
    expect(observed!).toMatchObject({
      id: "rt-1",
      username: "carol",
      giteaToken: "tok_unique_carol",
      giteaTokenName: "carol-tok",
    });
  });

  test("revoke failures still result in rows being deleted", async () => {
    const sess = makeSession({ id: "rev-fail", expiresAt: 1_000 });
    await store.put(sess);

    const result = await runSessionReaper({
      sessionStore: store,
      revoke: async () => {
        throw new Error("gitea unreachable");
      },
      now: 5_000,
    });

    expect(result).toEqual({ reaped: 1, revokeErrors: 1 });
    // SessionStore.reap() deletes inside the same call that returns the rows;
    // a failing revoke must not resurrect the row.
    expect(await store.get("rev-fail")).toBeNull();
  });

  test("empty table is a no-op", async () => {
    const result = await runSessionReaper({
      sessionStore: store,
      revoke: async () => {
        throw new Error("revoke must not be called");
      },
      now: 5_000,
    });
    expect(result).toEqual({ reaped: 0, revokeErrors: 0 });
  });

  test("a row whose expires_at equals now is reaped (boundary)", async () => {
    const sess = makeSession({ id: "boundary", expiresAt: 5_000 });
    await store.put(sess);

    const result = await runSessionReaper({
      sessionStore: store,
      revoke: async () => {},
      now: 5_000,
    });
    expect(result.reaped).toBe(1);
    expect(await store.get("boundary")).toBeNull();
  });
});
