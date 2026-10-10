import { generateKeyPairSync } from "node:crypto";
import { beforeEach, describe, expect, spyOn, test } from "bun:test";

import { FEEDBACK_MAX_BYTES } from "../../../packages/utils/feedbackReport";
import { handle, type Env } from "./index";
import { testReport } from "./testReport";

// GitHub hands out PKCS#1; the Worker has to take it as is.
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const ORIGIN = "https://bindersnap.com";

let underLimit: boolean;
let limitedKeys: string[];

function env(overrides: Partial<Env> = {}): Env {
  return {
    ALLOWED_ORIGINS: `${ORIGIN}, https://app.bindersnap.com`,
    FEEDBACK_REPOSITORY: "davidgraymi/bindersnap-feedback",
    GITHUB_APP_ID: "123456",
    GITHUB_APP_PRIVATE_KEY: privateKey,
    TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
    FEEDBACK_LIMITER: {
      limit: async ({ key }) => {
        limitedKeys.push(key);
        return { success: underLimit };
      },
    },
    ...overrides,
  };
}

interface Call {
  url: string;
  init: RequestInit;
}

/** Turnstile and GitHub, answering as told; every call recorded. */
function fakeUpstream(
  answers: { turnstile?: boolean; issueStatus?: number } = {},
) {
  const calls: Call[] = [];
  const fetcher = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes("turnstile")) {
      return Response.json({
        success: answers.turnstile ?? true,
        "error-codes":
          answers.turnstile === false ? ["invalid-input-response"] : [],
      });
    }
    if (url.endsWith("/installation")) return Response.json({ id: 42 });
    if (url.endsWith("/access_tokens")) {
      return Response.json({ token: "ghs_installation" }, { status: 201 });
    }
    if (url.endsWith("/issues")) {
      return Response.json(
        { number: 7 },
        { status: answers.issueStatus ?? 201 },
      );
    }
    return new Response("unexpected", { status: 500 });
  }) as typeof fetch;
  return { calls, fetcher };
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://feedback.bindersnap.com/", {
    method: "POST",
    headers: {
      Origin: ORIGIN,
      "Content-Type": "application/json",
      "CF-Connecting-IP": "203.0.113.9",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  underLimit = true;
  limitedKeys = [];
  spyOn(console, "log").mockImplementation(() => {});
});

describe("filing a report", () => {
  test("a good report opens an issue as the app's installation", async () => {
    const upstream = fakeUpstream();
    const response = await handle(post(testReport()), env(), upstream.fetcher);

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ received: true });
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);

    const [turnstile, installation, token, issue] = upstream.calls;
    expect(turnstile!.url).toContain("challenges.cloudflare.com");
    expect(installation!.url).toBe(
      "https://api.github.com/repos/davidgraymi/bindersnap-feedback/installation",
    );
    expect(token!.url).toBe(
      "https://api.github.com/app/installations/42/access_tokens",
    );
    expect(issue!.url).toBe(
      "https://api.github.com/repos/davidgraymi/bindersnap-feedback/issues",
    );
    const headers = new Headers(issue!.init.headers);
    expect(headers.get("Authorization")).toBe("Bearer ghs_installation");
    const sent = JSON.parse(String(issue!.init.body));
    expect(sent.title).toBe("Publishing does nothing");
    expect(sent.labels).toEqual(["from-app", "bug"]);
    // Turnstile's token is checked and dropped, never filed.
    expect(String(issue!.init.body)).not.toContain("DUMMY.TOKEN");
  });

  test("the rate limit is per address", async () => {
    await handle(post(testReport()), env(), fakeUpstream().fetcher);
    expect(limitedKeys).toEqual(["203.0.113.9"]);
  });

  test("GitHub failing is a 502, and the log says where", async () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    const upstream = fakeUpstream({ issueStatus: 422 });
    const response = await handle(post(testReport()), env(), upstream.fetcher);

    expect(response.status).toBe(502);
    const line = JSON.parse(String(log.mock.calls.at(-1)![0]));
    expect(line).toEqual({
      event: "failed",
      step: "create issue",
      status: 422,
    });
  });

  test("nothing the person wrote reaches the log", async () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    await handle(post(testReport()), env(), fakeUpstream().fetcher);
    const logged = log.mock.calls.map((call) => String(call[0])).join("\n");
    expect(logged).not.toContain("hand hygiene");
    expect(logged).not.toContain("alice");
  });
});

describe("refusing a report", () => {
  test("from an origin that is not the app", async () => {
    const upstream = fakeUpstream();
    const response = await handle(
      post(testReport(), { Origin: "https://evil.example" }),
      env(),
      upstream.fetcher,
    );
    expect(response.status).toBe(403);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(upstream.calls).toHaveLength(0);
  });

  test("over the rate limit, before anything else is spent", async () => {
    underLimit = false;
    const upstream = fakeUpstream();
    const response = await handle(post(testReport()), env(), upstream.fetcher);
    expect(response.status).toBe(429);
    expect(upstream.calls).toHaveLength(0);
  });

  test("too large", async () => {
    const huge = testReport({ description: "x".repeat(FEEDBACK_MAX_BYTES) });
    const response = await handle(post(huge), env(), fakeUpstream().fetcher);
    expect(response.status).toBe(413);
  });

  test("not JSON, or missing what a report needs", async () => {
    const upstream = fakeUpstream();
    expect((await handle(post("{"), env(), upstream.fetcher)).status).toBe(400);

    const { title: _title, ...untitled } = testReport();
    const response = await handle(post(untitled), env(), upstream.fetcher);
    expect(response.status).toBe(400);
    expect(((await response.json()) as { fields: string[] }).fields).toEqual([
      "title",
    ]);
    expect(upstream.calls).toHaveLength(0);
  });

  test("when Turnstile says no, GitHub is never asked", async () => {
    const upstream = fakeUpstream({ turnstile: false });
    const response = await handle(post(testReport()), env(), upstream.fetcher);
    expect(response.status).toBe(403);
    expect(upstream.calls).toHaveLength(1);
  });

  test("any method but POST, and any path but /", async () => {
    const get = new Request("https://feedback.bindersnap.com/", {
      headers: { Origin: ORIGIN },
    });
    expect((await handle(get, env())).status).toBe(405);
    const elsewhere = new Request("https://feedback.bindersnap.com/admin", {
      method: "POST",
      headers: { Origin: ORIGIN },
    });
    expect((await handle(elsewhere, env())).status).toBe(404);
  });
});

describe("the browser's preflight", () => {
  test("the app's origin may post JSON", async () => {
    const response = await handle(
      new Request("https://feedback.bindersnap.com/", {
        method: "OPTIONS",
        headers: { Origin: "https://app.bindersnap.com" },
      }),
      env(),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://app.bindersnap.com",
    );
    expect(response.headers.get("Access-Control-Allow-Headers")).toBe(
      "Content-Type",
    );
  });

  test("anyone else may not", async () => {
    const response = await handle(
      new Request("https://feedback.bindersnap.com/", {
        method: "OPTIONS",
        headers: { Origin: "https://evil.example" },
      }),
      env(),
    );
    expect(response.status).toBe(403);
  });
});
