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
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const COMPOSE_FILE = resolve(ROOT, "docker-compose.yml");
const APP_PORT = process.env.APP_PORT ?? "5173";

function log(message: string): void {
  process.stdout.write(`[global-teardown] ${message}\n`);
}

export default async function globalTeardown(): Promise<void> {
  if (process.env.SKIP_STACK === "1") {
    log("SKIP_STACK=1 — leaving stack running.");
    return;
  }

  log("Tearing down integration stack...");
  const result = spawnSync(
    "docker",
    ["compose", "-f", COMPOSE_FILE, "down", "-v", "--remove-orphans"],
    {
      stdio: "inherit",
      env: { ...process.env, APP_PORT },
    },
  );

  if (result.status !== 0) {
    // Log but don't throw — a teardown failure shouldn't mask test results.
    process.stderr.write(
      "[global-teardown] WARNING: docker compose down exited non-zero.\n",
    );
  } else {
    log("Stack torn down.");
  }
}
