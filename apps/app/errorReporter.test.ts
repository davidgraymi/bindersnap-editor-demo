import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { ApiRequestError } from "../../packages/api-client/mutator";
import type { ErrorReport } from "../../packages/utils/errorReport";
import {
  buildErrorReport,
  ERRORS_PER_PAGE,
  ignored,
  reportError,
  resetErrorReporterForTests,
} from "./errorReporter";

const URL = "https://feedback.test/errors";

let sent: { url: string; init: RequestInit }[];
const send = (async (url: RequestInfo | URL, init: RequestInit = {}) => {
  sent.push({ url: String(url), init });
  return new Response(null, { status: 202 });
}) as typeof fetch;

function reports(): ErrorReport[] {
  return sent.map((call) => JSON.parse(String(call.init.body)));
}

beforeEach(() => {
  process.env.BUN_PUBLIC_ERROR_REPORT_URL = URL;
  sent = [];
  resetErrorReporterForTests();
});

afterEach(() => {
  delete process.env.BUN_PUBLIC_ERROR_REPORT_URL;
});

describe("reportError", () => {
  test("sends a scrubbed report: what broke, which kind of page, never who", async () => {
    window.history.replaceState(null, "", "/riverside-health/clinical");
    const error = new TypeError(
      `No policy "Jane Doe intake" for jane@riverside.health`,
    );
    await reportError(error, send);

    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe(URL);
    expect(sent[0]!.init.credentials).toBe("omit");
    expect(sent[0]!.init.keepalive).toBe(true);
    // Plain text, so the browser sends it without a preflight.
    expect(new Headers(sent[0]!.init.headers).get("Content-Type")).toBe(
      "text/plain",
    );
    const [report] = reports();
    expect(report).toMatchObject({
      source: "app",
      kind: "TypeError",
      message: `No policy "…" for [email]`,
      where: "binder",
      requestIds: [],
    });
    expect(String(sent[0]!.init.body)).not.toContain("riverside");
  });

  test("each error once a page", async () => {
    await reportError(new Error("same"), send);
    await reportError(new Error("same"), send);
    expect(sent).toHaveLength(1);
  });

  test(`no more than ${ERRORS_PER_PAGE} a page`, async () => {
    for (let i = 0; i < ERRORS_PER_PAGE + 5; i++) {
      await reportError(new Error(`error ${"x".repeat(i)}`), send);
    }
    expect(sent).toHaveLength(ERRORS_PER_PAGE);
  });

  test("nothing when the build has no address", async () => {
    delete process.env.BUN_PUBLIC_ERROR_REPORT_URL;
    await reportError(new Error("boom"), send);
    expect(sent).toHaveLength(0);
  });

  test("a failed send is swallowed", async () => {
    const failing = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    await expect(reportError(new Error("boom"), failing)).resolves.toBe(
      undefined,
    );
  });

  test("a rejection that is not an Error still says what it was", async () => {
    await reportError({ code: 7 }, send);
    expect(reports()[0]).toMatchObject({
      kind: "Unhandled rejection",
      message: '{"code":7}',
    });
  });
});

describe("ignored", () => {
  test("the API's own failures, the network, and other people's scripts", () => {
    expect(ignored(new ApiRequestError(500, "Internal"))).toBe(true);
    expect(ignored(new TypeError("Failed to fetch"))).toBe(true);
    expect(ignored(new TypeError("Load failed"))).toBe(true);
    expect(ignored(new DOMException("aborted", "AbortError"))).toBe(true);
    expect(ignored("Script error.")).toBe(true);
    expect(
      ignored("ResizeObserver loop completed with undelivered notifications."),
    ).toBe(true);
    const extension = new Error("boom");
    extension.stack =
      "Error: boom\n    at chrome-extension://abc/content.js:1:2";
    expect(ignored(extension)).toBe(true);
  });

  test("not the app's own errors", () => {
    expect(ignored(new TypeError("x is undefined"))).toBe(false);
    expect(
      ignored(new Error("Failed to fetch dynamically imported module")),
    ).toBe(false);
  });
});

test("buildErrorReport keeps a script's stack frame readable", () => {
  const report = buildErrorReport({
    kind: "TypeError",
    message: "x",
    stack: "at f (https://app.bindersnap.com/chunk-a1.js:1:20345)",
    where: "home",
  });
  expect(report.stack).toBe(
    "at f (https://app.bindersnap.com/chunk-a1.js:1:20345)",
  );
  expect(report.app).toEqual({ version: "dev", commit: "dev" });
});
