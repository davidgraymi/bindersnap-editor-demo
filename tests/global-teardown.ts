/**
 * Playwright globalTeardown — tears down the Docker Compose integration stack.
 *
 * Invoked automatically by Playwright after all test files have finished,
 * whether the run passed or failed.
 *
 * Set SKIP_STACK=1 to leave the stack running (useful when working against
 * an already-running dev stack started with `bun run up`).
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ensureStackEnv } from "../scripts/stack";
import { stopStripeWebhookSecretRuntime } from "./stripe-runtime";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const COMPOSE_FILE = resolve(ROOT, "docker-compose.yml");
const COMPOSE_ARGS = ["compose", "-f", COMPOSE_FILE] as const;
const RESULTS_DIR = resolve(ROOT, "test-results");
const API_LOG_PATH = resolve(RESULTS_DIR, "api.log");
const MAX_PRINTED_ERROR_LINES = 100;
const TAIL_LINES_WHEN_SILENT = 40;

function log(message: string): void {
  process.stdout.write(`[global-teardown] ${message}\n`);
}

/**
 * Save the API container's log before the stack goes away, and echo its error
 * lines into the job output.
 *
 * Without this the only record of a server-side failure dies with the
 * container: a request that the API answers 200 while logging an error — a
 * best-effort step that failed, say — leaves a test asserting on an absence
 * with nothing to explain it. The full log lands in `test-results/` (uploaded
 * as a CI artefact); the error lines are printed because nobody downloads an
 * artefact they do not know to look for.
 */
function captureApiLogs(env: NodeJS.ProcessEnv): void {
  const result = spawnSync(
    "docker",
    // The whole log, not a tail: the API logs at debug level here, so a run of
    // eighty specs buries an early error thousands of lines deep. The 1MB
    // default maxBuffer would truncate that into an ENOBUFS failure and lose
    // the capture entirely.
    [...COMPOSE_ARGS, "logs", "--no-color", "api"],
    { encoding: "utf8", env, maxBuffer: 256 * 1024 * 1024 },
  );

  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.error || result.status !== 0 || output.trim() === "") {
    log("No API container log to capture.");
    return;
  }

  try {
    mkdirSync(RESULTS_DIR, { recursive: true });
    writeFileSync(API_LOG_PATH, output, "utf8");
    log(`Wrote API container log to ${API_LOG_PATH}`);
  } catch (err) {
    process.stderr.write(
      `[global-teardown] WARNING: could not write API log: ${String(err)}\n`,
    );
  }

  const errors = output
    .split("\n")
    .filter((line) => line.includes('"level":"error"'));

  if (errors.length === 0) {
    // No error lines is not the same as nothing wrong. An API that dies while
    // loading — a bad import, a missing file in the container image — never
    // reaches its logger, so it emits no JSON at all and this filter matches
    // nothing. That failure shows up minutes later as global-setup timing out
    // on a URL that was never going to answer, so print the tail rather than
    // leave it to an artefact nobody knows to download.
    const tail = output.trimEnd().split("\n").slice(-TAIL_LINES_WHEN_SILENT);
    log(`API logged no errors; last ${tail.length} line(s):`);
    for (const line of tail) {
      process.stdout.write(`${line}\n`);
    }
    return;
  }

  log(`API logged ${errors.length} error line(s):`);
  // A cascade repeats one cause; the rest are in the artefact.
  for (const line of errors.slice(0, MAX_PRINTED_ERROR_LINES)) {
    process.stdout.write(`${line}\n`);
  }
  if (errors.length > MAX_PRINTED_ERROR_LINES) {
    log(
      `${errors.length - MAX_PRINTED_ERROR_LINES} more error line(s) in ${API_LOG_PATH}.`,
    );
  }
}

export default async function globalTeardown(): Promise<void> {
  if (process.env.SKIP_STACK === "1") {
    log("SKIP_STACK=1 — leaving stack running.");
    return;
  }

  // Resolve the stack the same way globalSetup did, from the worktree's own
  // registered slot. Never from defaults: a teardown that guesses `bindersnap`
  // would `down -v` whatever is running on the shared ports — in practice, the
  // developer's own stack in the main checkout.
  const stack = await ensureStackEnv(ROOT);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    STACK_NAME: stack.stackName,
    APP_PORT: String(stack.ports.APP_PORT),
    API_PORT: String(stack.ports.API_PORT),
    API_PROXY_PORT: String(stack.ports.API_PROXY_PORT),
    GITEA_PORT: String(stack.ports.GITEA_PORT),
    HOCUSPOCUS_PORT: String(stack.ports.HOCUSPOCUS_PORT),
  };
  log(`tearing down ${stack.stackName} (slot ${stack.slot})`);

  // Before the containers go: the API's own account of what it did.
  captureApiLogs(env);

  stopStripeWebhookSecretRuntime({ log });
  log("Tearing down integration stack...");
  const result = spawnSync(
    "docker",
    [...COMPOSE_ARGS, "down", "-v", "--remove-orphans"],
    { stdio: "inherit", env },
  );

  if (result.status !== 0) {
    process.stderr.write(
      "[global-teardown] WARNING: docker compose down exited non-zero.\n",
    );
  } else {
    log("Stack torn down.");
  }
}
