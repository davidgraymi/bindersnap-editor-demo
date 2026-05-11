// Integration tests for the session reaper composed with a real
// SessionBackend implementation. The unit tests in session-reaper.test.ts
// cover orchestration with a mock backend; these exercise the actual
// SQL/round-trips:
//
//   - real SessionStore (in-memory SQLite) — always runs
//   - real PostgresSessionBackend — runs only when BINDERSNAP_TEST_DATABASE_URL
//     is set, since we don't carry a PGlite dep yet. The local Compose stack
//     and CI can opt in.
//
// What "integration" means here:
//   - rows are actually inserted via the backend's put() path,
//   - reap() actually deletes them in SQL,
//   - the reaper calls revoke() with whatever the backend hands back
//     (important for Postgres, where the token is decrypted from the
//     envelope on its way out).

import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { runSessionReaper } from "./session-reaper";
import { SessionStore, type SessionRecord } from "./sessions";
import { PostgresSessionBackend } from "./db/postgres-sessions";
import { LocalTokenCrypto } from "./token-crypto";

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

const POSTGRES_URL = process.env.BINDERSNAP_TEST_DATABASE_URL;
const describePg = POSTGRES_URL ? describe : describe.skip;

describePg("session reaper × PostgresSessionBackend (integration)", () => {
  // Skip-when-env-unset pattern: gives the local Compose stack and CI a path
  // to exercise the production backend without forcing every contributor to
  // run Postgres. CI sets BINDERSNAP_TEST_DATABASE_URL against a throwaway db.
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase;
  let backend: PostgresSessionBackend;

  beforeEach(async () => {
    client = postgres(POSTGRES_URL!, { max: 2, prepare: false });
    db = drizzle(client);
    // Tests are responsible for a clean slate. The migration runner is the
    // canonical schema source; we assume it has been run against the test DB.
    await db.execute(sql`TRUNCATE TABLE sessions`);
    const masterKey = Buffer.alloc(32, 0xab);
    backend = new PostgresSessionBackend(new LocalTokenCrypto(masterKey), db);
  });

  afterAll(async () => {
    await client?.end({ timeout: 5 });
  });

  test("reaps only expired rows and decrypts tokens for revoke", async () => {
    const live = makeSession({ id: "pg-live", expiresAt: 10_000 });
    const expired = makeSession({
      id: "pg-expired",
      username: "dora",
      giteaToken: "tok_pg_secret",
      expiresAt: 1_000,
    });
    await backend.put(live);
    await backend.put(expired);

    const handed: SessionRecord[] = [];
    const result = await runSessionReaper({
      sessionStore: backend,
      revoke: async (s) => {
        handed.push(s);
      },
      now: 5_000,
    });

    expect(result).toEqual({ reaped: 1, revokeErrors: 0 });
    expect(handed).toHaveLength(1);
    expect(handed[0]!.id).toBe("pg-expired");
    // Critical: the reaper must hand the *decrypted* token to revoke, not the
    // ciphertext blob. Otherwise the Gitea DELETE would never authenticate.
    expect(handed[0]!.giteaToken).toBe("tok_pg_secret");
    expect(await backend.get("pg-live")).not.toBeNull();
    expect(await backend.get("pg-expired")).toBeNull();
  });

  test("revoke failure still removes the row (DELETE ... RETURNING semantics)", async () => {
    const sess = makeSession({ id: "pg-rev-fail", expiresAt: 1_000 });
    await backend.put(sess);

    const result = await runSessionReaper({
      sessionStore: backend,
      revoke: async () => {
        throw new Error("gitea 500");
      },
      now: 5_000,
    });

    expect(result).toEqual({ reaped: 1, revokeErrors: 1 });
    expect(await backend.get("pg-rev-fail")).toBeNull();
  });
});
