import { describe, test, expect } from "bun:test";
import { runSessionReaper } from "./session-reaper";
import type { SessionRecord } from "./sessions";

function makeSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: "sess-1",
    username: "alice",
    giteaToken: "tok",
    giteaTokenName: "bindersnap-session",
    createdAt: 1_000,
    expiresAt: 2_000,
    ...overrides,
  };
}

describe("runSessionReaper", () => {
  test("returns zero counts when no rows are expired", async () => {
    const result = await runSessionReaper({
      sessionStore: { reap: async () => [] },
      revoke: async () => {
        throw new Error("revoke must not be called");
      },
      now: 5_000,
    });
    expect(result).toEqual({ reaped: 0, revokeErrors: 0 });
  });

  test("revokes each reaped session and reports the count", async () => {
    const reaped = [
      makeSession({ id: "a", username: "alice" }),
      makeSession({ id: "b", username: "bob" }),
    ];
    const revoked: string[] = [];

    const result = await runSessionReaper({
      sessionStore: { reap: async () => reaped },
      revoke: async (s) => {
        revoked.push(s.username);
      },
      now: 5_000,
    });

    expect(result).toEqual({ reaped: 2, revokeErrors: 0 });
    expect(revoked.sort()).toEqual(["alice", "bob"]);
  });

  test("revoke failures are counted but do not throw", async () => {
    const reaped = [
      makeSession({ id: "a" }),
      makeSession({ id: "b" }),
      makeSession({ id: "c" }),
    ];
    const warnings: Array<{ msg: string; meta?: Record<string, unknown> }> = [];

    const result = await runSessionReaper({
      sessionStore: { reap: async () => reaped },
      revoke: async (s) => {
        if (s.id !== "b") throw new Error("gitea down");
      },
      logger: {
        info: () => {},
        warn: (msg, meta) => warnings.push({ msg, meta }),
      },
    });

    expect(result.reaped).toBe(3);
    expect(result.revokeErrors).toBe(2);
    expect(warnings.length).toBe(2);
    expect(warnings[0]?.meta?.error).toBe("gitea down");
  });

  test("uses Date.now() when now is not provided", async () => {
    let observed = -1;
    await runSessionReaper({
      sessionStore: {
        reap: async (now) => {
          observed = now;
          return [];
        },
      },
      revoke: async () => {},
    });
    expect(observed).toBeGreaterThan(0);
    expect(Math.abs(observed - Date.now())).toBeLessThan(1_000);
  });
});
