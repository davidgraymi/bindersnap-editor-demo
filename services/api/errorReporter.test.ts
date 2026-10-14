import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";

import type { ErrorReport } from "../../packages/utils/errorReport";
import {
  buildApiErrorReport,
  REPEAT_WINDOW_MS,
  startErrorReporter,
} from "./errorReporter";
import { logger, withLogContext } from "./logger";

const URL = "https://feedback.test/errors";

let sent: { url: string; init: RequestInit }[];
let status: number;
let clock: number;
let stop: () => void;

const fetcher = (async (url: RequestInfo | URL, init: RequestInit = {}) => {
  sent.push({ url: String(url), init });
  return new Response(null, { status });
}) as typeof fetch;

function start(overrides: { url?: string; secret?: string } = {}) {
  stop = startErrorReporter({
    url: URL,
    secret: "s3cret",
    release: "a5e86fa3c0ffee1234",
    fetcher,
    now: () => clock,
    ...overrides,
  });
}

/** The fetch is started synchronously and settles a tick later. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function reports(): ErrorReport[] {
  return sent.map((call) => JSON.parse(String(call.init.body)));
}

beforeEach(() => {
  sent = [];
  status = 202;
  clock = 1_000_000;
  stop = () => {};
  spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(() => {
  stop();
  mock.restore();
});

describe("startErrorReporter", () => {
  test("an error line is sent with the bearer and its request ID", async () => {
    start();
    withLogContext({ requestId: "req-42" }, () =>
      logger.error("Unhandled route exception", {
        message: "boom",
        errorType: "TypeError",
      }),
    );
    await settle();

    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe(URL);
    expect(new Headers(sent[0]!.init.headers).get("Authorization")).toBe(
      "Bearer s3cret",
    );
    expect(reports()[0]).toMatchObject({
      source: "api",
      kind: "Unhandled route exception",
      message: "boom",
      where: "request",
      requestIds: ["req-42"],
      app: { version: "api", commit: "a5e86fa3c0ff" },
    });
  });

  test("warnings and info are not errors", async () => {
    start();
    logger.warn("Gitea API error (4xx)", { status: 404 });
    logger.info("hello");
    await settle();
    expect(sent).toHaveLength(0);
  });

  test("the same error once a minute", async () => {
    start();
    logger.error("A job runner pass failed", { error: "timeout after 30s" });
    logger.error("A job runner pass failed", { error: "timeout after 45s" });
    clock += REPEAT_WINDOW_MS;
    logger.error("A job runner pass failed", { error: "timeout after 50s" });
    await settle();
    expect(sent).toHaveLength(2);
  });

  test("nothing without both a URL and a secret", async () => {
    start({ secret: "" });
    logger.error("boom");
    stop();
    start({ url: "" });
    logger.error("boom");
    await settle();
    expect(sent).toHaveLength(0);
  });

  test("a refused report is a warning, and does not report itself", async () => {
    status = 403;
    const warn = spyOn(logger, "warn");
    start();
    logger.error("boom");
    await settle();
    await settle();
    expect(sent).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith("Error report not sent", { status: 403 });
    warn.mockRestore();
  });
});

describe("buildApiErrorReport", () => {
  test("the line's other fields never leave, even inside the error's text", () => {
    const report = buildApiErrorReport(
      "Failed to read a binder's merge rules",
      {
        owner: "riverside-health",
        repo: "clinical",
        branch: "draft/jane-intake",
        username: "alice",
        error:
          "GET /repos/riverside-health/clinical/branches/draft/jane-intake: 500 for alice",
      },
      "dev",
    );
    expect(report.message).toBe(
      "GET /repos/[owner]/[repo]/branches/[branch]: 500 for [username]",
    );
    expect(JSON.stringify(report)).not.toMatch(/riverside|clinical|alice|jane/);
    expect(report.where).toBe("background");
  });

  test("an Error's message and stack, scrubbed", () => {
    const err = new Error("no user jane@riverside.health");
    const report = buildApiErrorReport("Signup failed", { err }, "dev");
    expect(report.message).toBe("no user [email]");
    expect(report.stack).toStartWith("Error: no user [email]");
  });
});
