import { generateKeyPairSync } from "node:crypto";
import { beforeEach, describe, expect, spyOn, test } from "bun:test";

import {
  ERROR_REPORT_MAX_BYTES,
  errorFingerprint,
  type ErrorReport,
} from "../../../packages/utils/errorReport";
import type { FoundIssue } from "./github";
import { handle, type Env, type RateLimit } from "./index";

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const ORIGIN = "https://app.bindersnap.com";
const SECRET = "s3cret-for-the-api";
const REPO = "davidgraymi/bindersnap-errors";

let limits: Record<"ip" | "fingerprint" | "overall", boolean>;
let limitedKeys: string[];

function limiter(which: keyof typeof limits): RateLimit {
  return {
    limit: async ({ key }) => {
      limitedKeys.push(`${which}:${key}`);
      return { success: limits[which] };
    },
  };
}

function env(overrides: Partial<Env> = {}): Env {
  return {
    ALLOWED_ORIGINS: ORIGIN,
    FEEDBACK_REPOSITORY: "davidgraymi/bindersnap-feedback",
    GITHUB_APP_ID: "123456",
    GITHUB_APP_PRIVATE_KEY: privateKey,
    TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
    FEEDBACK_LIMITER: { limit: async () => ({ success: true }) },
    ERRORS_REPOSITORY: REPO,
    ERROR_REPORT_SECRET: SECRET,
    ERROR_IP_LIMITER: limiter("ip"),
    ERROR_FINGERPRINT_LIMITER: limiter("fingerprint"),
    ERROR_OVERALL_LIMITER: limiter("overall"),
    ...overrides,
  };
}

function testError(overrides: Partial<ErrorReport> = {}): ErrorReport {
  return {
    source: "app",
    kind: "TypeError",
    message: "Cannot read properties of undefined (reading 'title')",
    stack:
      "TypeError: Cannot read properties of undefined\n    at render (https://app.bindersnap.com/chunk-a1b2c3.js:1:20345)",
    where: "binderDocument",
    app: { version: "0.4.80", commit: "a5e86fa3" },
    occurredAt: "2026-10-13T15:04:05.000Z",
    requestIds: ["req-1"],
    browser: "Mozilla/5.0 (Macintosh) Safari/605.1.15",
    sinceLoadMs: 42_000,
    ...overrides,
  };
}

interface Call {
  url: string;
  init: RequestInit;
}

/** GitHub, with these issues already on file; every call recorded. */
function fakeGitHub(found: Partial<FoundIssue>[] = [], failStep?: string) {
  const calls: Call[] = [];
  const fetcher = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (failStep && url.includes(failStep)) {
      return new Response("no", { status: 500 });
    }
    if (url.endsWith("/installation")) return Response.json({ id: 42 });
    if (url.endsWith("/access_tokens")) {
      return Response.json({ token: "ghs_installation" }, { status: 201 });
    }
    if (url.includes("/search/issues")) {
      return Response.json({
        items: found.map((issue) => ({
          number: 9,
          title: "x",
          state: "open",
          state_reason: null,
          labels: [],
          ...issue,
        })),
      });
    }
    return Response.json({ number: 9 }, { status: 201 });
  }) as typeof fetch;
  return {
    calls,
    fetcher,
    /** The calls after the installation token: the ones about issues. */
    work: () => calls.slice(2),
  };
}

function post(
  body: unknown,
  headers: Record<string, string> = { Origin: ORIGIN },
): Request {
  return new Request("https://feedback.bindersnap.com/errors", {
    method: "POST",
    headers: {
      "Content-Type": "text/plain",
      "CF-Connecting-IP": "203.0.113.9",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const fromApi = { Authorization: `Bearer ${SECRET}` };

beforeEach(() => {
  limits = { ip: true, fingerprint: true, overall: true };
  limitedKeys = [];
  spyOn(console, "log").mockImplementation(() => {});
});

describe("a new error", () => {
  test("opens an issue whose title ends in its fingerprint", async () => {
    const github = fakeGitHub();
    const response = await handle(post(testError()), env(), github.fetcher);

    expect(response.status).toBe(202);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    const fingerprint = await errorFingerprint(testError());
    const [search, create] = github.work();
    expect(github.calls[0]!.url).toBe(
      `https://api.github.com/repos/${REPO}/installation`,
    );
    expect(decodeURIComponent(search!.url)).toContain(
      `repo:${REPO} is:issue in:title "${fingerprint}"`,
    );
    expect(create!.url).toBe(`https://api.github.com/repos/${REPO}/issues`);
    const sent = JSON.parse(String(create!.init.body));
    expect(sent.title).toBe(
      `TypeError: Cannot read properties of undefined (reading 'title') · ${fingerprint}`,
    );
    expect(sent.labels).toEqual(["error", "from-app"]);
    expect(sent.body).toContain("binderDocument");
    expect(sent.body).toContain("chunk-a1b2c3.js:1:20345");
  });

  test("a search hit whose title only looks alike is not the same error", async () => {
    const github = fakeGitHub([{ title: "something else entirely" }]);
    await handle(post(testError()), env(), github.fetcher);
    expect(github.work()[1]!.url).toEndWith(`/repos/${REPO}/issues`);
  });

  test("is scrubbed here even when the sender did not", async () => {
    const github = fakeGitHub();
    await handle(
      post(
        testError({
          message: `No document "Jane Doe intake" for jane@riverside.health`,
          where: "binder at https://app.bindersnap.com/riverside/clinical",
        }),
      ),
      env(),
      github.fetcher,
    );
    const sent = String(github.work()[1]!.init.body);
    expect(sent).not.toContain("Jane");
    expect(sent).not.toContain("jane@");
    expect(sent).not.toContain("riverside");
  });
});

describe("an error already on file", () => {
  async function onFile(issue: Partial<FoundIssue>) {
    const fingerprint = await errorFingerprint(testError());
    const github = fakeGitHub([
      { number: 31, title: `TypeError: x · ${fingerprint}`, ...issue },
    ]);
    const response = await handle(post(testError()), env(), github.fetcher);
    expect(response.status).toBe(202);
    return github.work().slice(1);
  }

  test("open: a comment", async () => {
    const [comment, ...rest] = await onFile({ state: "open" });
    expect(comment!.url).toEndWith(`/repos/${REPO}/issues/31/comments`);
    expect(JSON.parse(String(comment!.init.body)).body).toContain(
      "Seen again.",
    );
    expect(rest).toHaveLength(0);
  });

  test("closed as completed: reopened as a regression, and a comment", async () => {
    const [reopen, comment] = await onFile({
      state: "closed",
      state_reason: "completed",
      labels: [{ name: "error" }, { name: "triaged" }],
    });
    expect(reopen!.url).toEndWith(`/repos/${REPO}/issues/31`);
    expect(reopen!.init.method).toBe("PATCH");
    expect(JSON.parse(String(reopen!.init.body))).toEqual({
      state: "open",
      labels: ["error", "triaged", "from-app", "regression"],
    });
    expect(comment!.url).toEndWith("/issues/31/comments");
  });

  test("closed as not planned: muted, nothing written", async () => {
    const writes = await onFile({
      state: "closed",
      state_reason: "not_planned",
    });
    expect(writes).toHaveLength(0);
  });
});

describe("who may send one", () => {
  test("the API, with its secret and no origin", async () => {
    const github = fakeGitHub();
    const response = await handle(
      post(testError({ source: "api", where: "api" }), fromApi),
      env(),
      github.fetcher,
    );
    expect(response.status).toBe(202);
    // The per-IP limit is the app's; the API is one address.
    expect(limitedKeys.some((key) => key.startsWith("ip:"))).toBe(false);
  });

  test("not with the wrong secret, or when none is set", async () => {
    const github = fakeGitHub();
    const api = testError({ source: "api" });
    const wrong = { Authorization: "Bearer guess" };
    expect((await handle(post(api, wrong), env(), github.fetcher)).status).toBe(
      403,
    );
    expect(
      (
        await handle(
          post(api, fromApi),
          env({ ERROR_REPORT_SECRET: "" }),
          github.fetcher,
        )
      ).status,
    ).toBe(403);
    expect(github.calls).toHaveLength(0);
  });

  test("not from another origin", async () => {
    const github = fakeGitHub();
    const response = await handle(
      post(testError(), { Origin: "https://evil.example" }),
      env(),
      github.fetcher,
    );
    expect(response.status).toBe(403);
    expect(github.calls).toHaveLength(0);
  });

  test("a browser cannot claim to be the API, nor the API the app", async () => {
    const github = fakeGitHub();
    const asApi = await handle(
      post(testError({ source: "api" })),
      env(),
      github.fetcher,
    );
    const asApp = await handle(
      post(testError(), fromApi),
      env(),
      github.fetcher,
    );
    expect([asApi.status, asApp.status]).toEqual([403, 403]);
    expect(github.calls).toHaveLength(0);
  });
});

describe("limits", () => {
  test("the app, per IP, before anything is read", async () => {
    limits.ip = false;
    const github = fakeGitHub();
    const response = await handle(post(testError()), env(), github.fetcher);
    expect(response.status).toBe(429);
    expect(limitedKeys).toEqual(["ip:203.0.113.9"]);
    expect(github.calls).toHaveLength(0);
  });

  test("one write a minute per fingerprint; the rest are accepted and dropped", async () => {
    limits.fingerprint = false;
    const github = fakeGitHub();
    const response = await handle(post(testError()), env(), github.fetcher);
    expect(response.status).toBe(202);
    const fingerprint = await errorFingerprint(testError());
    expect(limitedKeys).toContain(`fingerprint:fp:${fingerprint}`);
    expect(github.calls).toHaveLength(0);
  });

  test("an overall cap, so GitHub's search quota holds", async () => {
    limits.overall = false;
    const github = fakeGitHub();
    expect(
      (await handle(post(testError()), env(), github.fetcher)).status,
    ).toBe(202);
    expect(github.calls).toHaveLength(0);
  });

  test("size and shape", async () => {
    const github = fakeGitHub();
    const huge = testError({ stack: "x".repeat(ERROR_REPORT_MAX_BYTES) });
    expect((await handle(post(huge), env(), github.fetcher)).status).toBe(413);
    expect((await handle(post("{"), env(), github.fetcher)).status).toBe(400);
    const { where: _where, ...nowhere } = testError();
    const response = await handle(post(nowhere), env(), github.fetcher);
    expect(response.status).toBe(400);
    expect(((await response.json()) as { fields: string[] }).fields).toEqual([
      "where",
    ]);
    expect(github.calls).toHaveLength(0);
  });
});

test("GitHub failing is a 502, and the log names the step, not the error", async () => {
  const log = spyOn(console, "log").mockImplementation(() => {});
  const github = fakeGitHub([], "/search/issues");
  const response = await handle(post(testError()), env(), github.fetcher);
  expect(response.status).toBe(502);
  const line = JSON.parse(String(log.mock.calls.at(-1)![0]));
  expect(line).toMatchObject({
    event: "failed",
    route: "errors",
    step: "search issues",
    status: 500,
  });
  expect(JSON.stringify(log.mock.calls)).not.toContain("Cannot read");
});
