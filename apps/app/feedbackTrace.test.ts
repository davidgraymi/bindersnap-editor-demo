import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  spyOn,
  test,
} from "bun:test";
import { QueryClient } from "@tanstack/react-query";

import { customFetch } from "../../packages/api-client/mutator";
import {
  captureFeedbackTrace,
  redactUrl,
  resetFeedbackTraceForTests,
  routeFacts,
  startFeedbackTrace,
} from "./feedbackTrace";

function capture(queryClient = new QueryClient()) {
  return captureFeedbackTrace({
    route: { kind: "binderDocument", org: "acme", binder: "policies" },
    user: { username: "alice", fullName: "Alice Doe" },
    organization: { name: "acme", displayName: "Acme Health" },
    queryClient,
  });
}

const realConsole = { error: console.error, warn: console.warn };

beforeAll(() => {
  // The trace passes everything on to the console it found; let that one be
  // quiet, so the expected errors below don't read as failures.
  console.error = () => {};
  console.warn = () => {};
  startFeedbackTrace();
  // Twice, as StrictMode and hot reload do: still one set of wrappers.
  startFeedbackTrace();
});

afterEach(() => {
  resetFeedbackTraceForTests();
});

afterAll(() => {
  Object.assign(console, realConsole);
});

describe("API calls", () => {
  test("each call is kept with its status, timing and the API's request ID", async () => {
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async () =>
      Response.json(
        { error: "Publish failed" },
        { status: 500, headers: { "X-Request-Id": "req-500" } },
      )) as unknown as typeof fetch);
    try {
      await customFetch(
        "/api/app/documents/acme/policies/pull-requests/12/publish?force=1",
        { method: "post" },
      ).catch(() => undefined);
    } finally {
      fetchSpy.mockRestore();
    }

    const [call] = capture().apiCalls;
    expect(call).toMatchObject({
      method: "POST",
      // No query string: a search box's words stay in the browser.
      path: "/api/app/documents/acme/policies/pull-requests/12/publish",
      status: 500,
      requestId: "req-500",
    });
    expect(call!.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("a call that never got an answer is status 0", async () => {
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
      (async () => {
        throw new TypeError("Failed to fetch");
      }) as unknown as typeof fetch,
    );
    try {
      await customFetch("/auth/me", {}).catch(() => undefined);
    } finally {
      fetchSpy.mockRestore();
    }
    expect(capture().apiCalls[0]).toMatchObject({
      method: "GET",
      path: "/auth/me",
      status: 0,
    });
  });

  test("only the newest twenty are kept", async () => {
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
      (async () =>
        new Response(null, { status: 204 })) as unknown as typeof fetch,
    );
    try {
      for (let i = 0; i < 25; i += 1) {
        await customFetch(`/api/app/call/${i}`, {});
      }
    } finally {
      fetchSpy.mockRestore();
    }
    const calls = capture().apiCalls;
    expect(calls).toHaveLength(20);
    expect(calls[0]!.path).toBe("/api/app/call/5");
    expect(calls.at(-1)!.path).toBe("/api/app/call/24");
  });
});

describe("errors", () => {
  test("console errors and warnings are kept, with an Error's stack", () => {
    console.error("Couldn't load", new Error("boom"));
    console.warn("slow", { ms: 900 });
    const [error, warning] = capture().errors;
    expect(error).toMatchObject({
      source: "console.error",
      message: "Couldn't load Error: boom",
    });
    expect(error!.stack).toContain("boom");
    expect(warning).toMatchObject({
      source: "console.warn",
      message: 'slow {"ms":900}',
    });
  });

  test("an unhandled rejection is kept", () => {
    const event = new window.Event("unhandledrejection") as Event & {
      reason?: unknown;
    };
    event.reason = new Error("nobody caught me");
    window.dispatchEvent(event);
    expect(capture().errors[0]).toMatchObject({
      source: "rejection",
      message: "Error: nobody caught me",
    });
  });
});

describe("where the person was", () => {
  test("pages visited are kept, path only", () => {
    window.history.pushState({}, "", "/acme/policies?q=private+words");
    window.history.replaceState({}, "", "/acme/policies/-/changes/12");
    const paths = capture().navigation.map((step) => step.path);
    expect(paths).toEqual(["/acme/policies", "/acme/policies/-/changes/12"]);
  });

  test("the route becomes facts, and a token in it never leaves", () => {
    expect(
      routeFacts({
        kind: "invitation",
        token: "s3cret",
        version: 4,
        nested: { no: "objects" },
      }),
    ).toEqual({ kind: "invitation", version: 4 });
  });

  test("who and which organization, as the app knows them", () => {
    const trace = capture();
    expect(trace.user).toEqual({ username: "alice", name: "Alice Doe" });
    expect(trace.organization).toEqual({
      name: "acme",
      displayName: "Acme Health",
    });
    expect(trace.route).toEqual({
      kind: "binderDocument",
      org: "acme",
      binder: "policies",
    });
    expect(trace.app).toEqual({ version: "dev", commit: "dev" });
  });

  test("queries that are failing say what they were and why", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    await queryClient
      .fetchQuery({
        queryKey: ["binder", "acme", "policies"],
        queryFn: () => Promise.reject(new Error("403 Forbidden")),
      })
      .catch(() => undefined);
    expect(capture(queryClient).failingQueries).toEqual([
      { key: '["binder","acme","policies"]', error: "Error: 403 Forbidden" },
    ]);
  });
});

describe("secrets in URLs", () => {
  test("a reset link's token is cut out, the rest kept", () => {
    expect(
      redactUrl("https://bindersnap.com/-/reset_password?token=abc&next=/x", {
        keepQuery: true,
      }),
    ).toBe(
      "https://bindersnap.com/-/reset_password?token=[redacted]&next=%2Fx",
    );
  });

  test("an invitation's token is a path segment, and is cut out too", () => {
    expect(
      redactUrl("https://bindersnap.com/-/invitations/abc123def456#top", {
        keepQuery: true,
      }),
    ).toBe("https://bindersnap.com/-/invitations/[redacted]");
  });

  test("a relative path stays relative", () => {
    expect(
      redactUrl("/api/app/invitations/abc?x=1", { keepQuery: false }),
    ).toBe("/api/app/invitations/[redacted]");
  });
});
