import type { SessionBackend, SessionRecord } from "./sessions";

export interface SessionReaperLogger {
  info: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
}

export interface SessionReaperDeps {
  sessionStore: Pick<SessionBackend, "reap">;
  revoke: (session: SessionRecord) => Promise<void>;
  now?: number;
  logger?: SessionReaperLogger;
}

export interface SessionReaperResult {
  reaped: number;
  revokeErrors: number;
}

// Extracted from server.ts's in-process cleanup loop so the reap-and-revoke
// logic is testable on its own. The session table has no native TTL —
// something has to call this on a schedule.
//
// Behavior:
//   - Deletes expired session rows in a single round-trip (backend-specific).
//   - Best-effort revokes each expired session's Gitea token. Revoke failures
//     are counted and logged but never throw — a transient Gitea outage must
//     not leave stale rows in the DB.
export async function runSessionReaper(
  deps: SessionReaperDeps,
): Promise<SessionReaperResult> {
  const now = deps.now ?? Date.now();
  const expired = await deps.sessionStore.reap(now);

  if (expired.length === 0) {
    return { reaped: 0, revokeErrors: 0 };
  }

  const results = await Promise.allSettled(
    expired.map((session) => deps.revoke(session)),
  );

  let revokeErrors = 0;
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r && r.status === "rejected") {
      revokeErrors += 1;
      const reason: unknown = r.reason;
      deps.logger?.warn("Session token revoke failed during reap", {
        username: expired[i]?.username,
        error: reason instanceof Error ? reason.message : String(reason),
      });
    }
  }

  deps.logger?.info("Session reaper run complete", {
    reaped: expired.length,
    revokeErrors,
  });

  return { reaped: expired.length, revokeErrors };
}
