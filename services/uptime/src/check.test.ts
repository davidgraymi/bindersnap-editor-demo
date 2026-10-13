import { beforeEach, describe, expect, spyOn, test } from "bun:test";

import {
  FAILURES_BEFORE_ALERT,
  STATE_KEY,
  alertEmail,
  check,
  run,
  transition,
  type Env,
  type UptimeState,
} from "./check";

const URL_ = "https://api.bindersnap.com/healthz";
const T0 = new Date("2026-10-13T12:00:00Z");

function minutes(n: number): Date {
  return new Date(T0.getTime() + n * 60_000);
}

function answering(status: number): typeof fetch {
  return (async () =>
    new Response("ok\n", { status })) as unknown as typeof fetch;
}

function throwing(error: Error): typeof fetch {
  return (async () => {
    throw error;
  }) as unknown as typeof fetch;
}

let stored: Map<string, string>;
let writes: number;
let sent: { from: string; to: string; raw: string }[];

function env(): Env {
  return {
    HEALTHZ_URL: URL_,
    ALERT_FROM: "uptime@bindersnap.com",
    ALERT_TO: "ops@example.com",
    STATE: {
      get: async (key) => {
        const value = stored.get(key);
        return value === undefined ? null : JSON.parse(value);
      },
      put: async (key, value) => {
        writes += 1;
        stored.set(key, value);
      },
    },
  };
}

async function send(from: string, to: string, raw: string): Promise<void> {
  sent.push({ from, to, raw });
}

beforeEach(() => {
  stored = new Map();
  writes = 0;
  sent = [];
  spyOn(console, "log").mockImplementation(() => {});
});

describe("check", () => {
  test("200 is up", async () => {
    expect(await check(URL_, answering(200))).toEqual({ ok: true });
  });

  test("anything else is down, with the status", async () => {
    expect(await check(URL_, answering(530))).toEqual({
      ok: false,
      reason: "answered HTTP 530",
    });
    // A redirect is not the API answering.
    expect((await check(URL_, answering(301))).ok).toBe(false);
  });

  test("a timeout says so", async () => {
    const timeout = new Error("timed out");
    timeout.name = "TimeoutError";
    expect(await check(URL_, throwing(timeout), 10_000)).toEqual({
      ok: false,
      reason: "no answer within 10 s",
    });
  });

  test("a network error is down", async () => {
    expect(await check(URL_, throwing(new Error("connection reset")))).toEqual({
      ok: false,
      reason: "request failed: connection reset",
    });
  });
});

describe("transition", () => {
  const down = { ok: false as const, reason: "answered HTTP 502" };
  const up = { ok: true as const };

  test("up and staying up writes nothing", () => {
    const first = transition(null, up, T0);
    expect(first).toMatchObject({ changed: false, alert: null });
    expect(transition(first.state, up, minutes(1)).changed).toBe(false);
  });

  test("one failure is remembered but not reported", () => {
    const next = transition(null, down, T0);
    expect(next.alert).toBeNull();
    expect(next.changed).toBe(true);
    expect(next.state).toMatchObject({
      status: "up",
      failures: 1,
      failingSince: T0.toISOString(),
    });
  });

  test("a blip that recovers sends nothing and clears the count", () => {
    const blip = transition(null, down, T0).state;
    const next = transition(blip, up, minutes(1));
    expect(next.alert).toBeNull();
    expect(next.changed).toBe(true);
    expect(next.state.failures).toBe(0);
    expect(next.state.failingSince).toBeUndefined();
  });

  test(`${FAILURES_BEFORE_ALERT} failures in a row report down once, from the first`, () => {
    let state: UptimeState | null = null;
    const alerts: (string | null)[] = [];
    for (let i = 0; i < 10; i += 1) {
      const next = transition(state, down, minutes(i));
      alerts.push(next.alert);
      state = next.state;
    }
    expect(alerts.filter(Boolean)).toEqual(["down"]);
    expect(alerts.indexOf("down")).toBe(FAILURES_BEFORE_ALERT - 1);
    expect(state).toMatchObject({ status: "down", since: T0.toISOString() });
  });

  test("an ongoing outage writes nothing", () => {
    const reported: UptimeState = {
      status: "down",
      since: T0.toISOString(),
      failures: FAILURES_BEFORE_ALERT,
    };
    expect(transition(reported, down, minutes(5))).toMatchObject({
      changed: false,
      alert: null,
    });
  });

  test("recovery reports up once", () => {
    const reported: UptimeState = {
      status: "down",
      since: T0.toISOString(),
      failures: FAILURES_BEFORE_ALERT,
    };
    const next = transition(reported, up, minutes(7));
    expect(next.alert).toBe("up");
    expect(next.state).toEqual({
      status: "up",
      since: minutes(7).toISOString(),
      failures: 0,
    });
    expect(transition(next.state, up, minutes(8)).alert).toBeNull();
  });
});

describe("alertEmail", () => {
  const state: UptimeState = {
    status: "down",
    since: T0.toISOString(),
    failures: 2,
    reason: "answered HTTP 530",
  };

  test("is a raw message Email Routing accepts", () => {
    const raw = alertEmail("down", state, null, env(), minutes(1));
    const split = raw.indexOf("\r\n\r\n");
    const head = raw.slice(0, split);
    const body = raw.slice(split + 4);
    expect(head).toContain("From: Bindersnap uptime <uptime@bindersnap.com>");
    expect(head).toContain("To: ops@example.com");
    expect(head).toContain("Subject: Bindersnap API is down");
    expect(head).toMatch(/Message-ID: <[0-9a-f-]+@bindersnap\.com>/);
    expect(body).toContain(URL_);
    expect(body).toContain("2026-10-13 12:00 UTC");
    expect(body).toContain("answered HTTP 530");
  });

  test("the recovery says how long it was down", () => {
    const raw = alertEmail(
      "up",
      { status: "up", since: minutes(7).toISOString(), failures: 0 },
      state,
      env(),
      minutes(7),
    );
    expect(raw).toContain("Subject: Bindersnap API is back up");
    expect(raw).toContain("about 7 min");
  });
});

describe("run", () => {
  test("an outage and its recovery send exactly two emails", async () => {
    const statuses = [200, 502, 530, 530, 530, 200, 200];
    for (const [i, status] of statuses.entries()) {
      await run(env(), send, minutes(i), answering(status));
    }
    expect(sent.map((m) => m.raw.match(/Subject: (.*)/)?.[1])).toEqual([
      "Bindersnap API is down",
      "Bindersnap API is back up",
    ]);
    expect(sent[0]).toMatchObject({
      from: "uptime@bindersnap.com",
      to: "ops@example.com",
    });
    // First failure, down, recovery: and nothing while it stayed down.
    expect(writes).toBe(3);
  });

  test("if the email fails, nothing is remembered and the next run retries", async () => {
    await run(env(), send, minutes(0), answering(502));
    const failing = async () => {
      throw new Error("send_email refused");
    };
    await expect(
      run(env(), failing, minutes(1), answering(502)),
    ).rejects.toThrow("send_email refused");
    expect(JSON.parse(stored.get(STATE_KEY)!).status).toBe("up");

    await run(env(), send, minutes(2), answering(502));
    expect(sent).toHaveLength(1);
    expect(JSON.parse(stored.get(STATE_KEY)!).status).toBe("down");
  });

  test("a stored value it cannot read starts over", async () => {
    stored.set(STATE_KEY, JSON.stringify({ nonsense: true }));
    const next = await run(env(), send, T0, answering(200));
    expect(next.state.status).toBe("up");
    expect(sent).toHaveLength(0);
  });
});
