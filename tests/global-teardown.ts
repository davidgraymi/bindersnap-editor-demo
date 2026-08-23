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
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { stopStripeWebhookSecretRuntime } from "./stripe-runtime";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const COMPOSE_FILE = resolve(ROOT, "docker-compose.yml");
const COMPOSE_ARGS = ["compose", "-f", COMPOSE_FILE] as const;
const STACK_NAME = process.env.STACK_NAME ?? "bindersnap";
const APP_PORT = process.env.APP_PORT ?? "5173";
const API_PORT = process.env.API_PORT ?? "8787";
const API_PROXY_PORT = process.env.API_PROXY_PORT ?? "8788";
const GITEA_PORT = process.env.GITEA_PORT ?? "3000";
const HOCUSPOCUS_PORT = process.env.HOCUSPOCUS_PORT ?? "1234";

function log(message: string): void {
  process.stdout.write(`[global-teardown] ${message}\n`);
}

export default async function globalTeardown(): Promise<void> {
  if (process.env.SKIP_STACK === "1") {
    log("SKIP_STACK=1 — leaving stack running.");
    return;
  }

  stopStripeWebhookSecretRuntime({ log });
  log("Tearing down integration stack...");
  const result = spawnSync(
    "docker",
    [...COMPOSE_ARGS, "down", "-v", "--remove-orphans"],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        STACK_NAME,
        APP_PORT,
        API_PORT,
        API_PROXY_PORT,
        GITEA_PORT,
        HOCUSPOCUS_PORT,
      },
    },
  );

  if (result.status !== 0) {
    process.stderr.write(
      "[global-teardown] WARNING: docker compose down exited non-zero.\n",
    );
  } else {
    log("Stack torn down.");
  }
}
