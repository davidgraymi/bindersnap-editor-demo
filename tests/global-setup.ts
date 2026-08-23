/**
 * Playwright globalSetup — manages the Docker Compose integration stack.
 *
 * Invoked automatically by Playwright before any test file runs.
 * Brings up the full stack (Gitea + seed + Hocuspocus + API + app),
 * waits until the app is reachable, then lets Playwright proceed.
 *
 * The companion globalTeardown tears everything down after the run.
 *
 * Environment variables (all optional — defaults match docker-compose.yml):
 *   STACK_NAME       Compose project + container name prefix (default: bindersnap)
 *   APP_PORT         App container port (default: 5173)
 *   API_PORT         API container port (default: 8787)
 *   API_PROXY_PORT   Caddy proxy port in front of the API (default: 8788)
 *   GITEA_PORT       Gitea HTTP port (default: 3000)
 *   HOCUSPOCUS_PORT  Collaboration websocket port (default: 1234)
 *   SKIP_STACK       Set to "1" to skip docker compose entirely (use an
 *                    already-running stack, e.g. from `bun run up`)
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_WEBHOOK_TEST_SECRET,
  ensureStripeWebhookSecret,
  stopStripeWebhookSecretRuntime,
} from "./stripe-runtime";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const COMPOSE_FILE = resolve(ROOT, "docker-compose.yml");
const COMPOSE_ARGS = ["compose", "-f", COMPOSE_FILE] as const;

/**
 * Load the root .env file into process.env, skipping keys that are already
 * set. This is a safety net for when playwright is invoked directly (e.g.
 * `bunx playwright test`) rather than via `bun run test:integration`, since
 * bunx does not auto-load .env the way `bun run` does.
 */
function loadEnvFile(): void {
  const envPath = resolve(ROOT, ".env");
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

const STACK_NAME = process.env.STACK_NAME ?? "bindersnap";
const APP_PORT = process.env.APP_PORT ?? "5173";
const API_PORT = process.env.API_PORT ?? "8787";
const API_PROXY_PORT = process.env.API_PROXY_PORT ?? "8788";
const GITEA_PORT = process.env.GITEA_PORT ?? "3000";
const HOCUSPOCUS_PORT = process.env.HOCUSPOCUS_PORT ?? "1234";
const APP_BASE_URL = `http://localhost:${APP_PORT}`;
const API_READY_URL = `http://localhost:${API_PORT}/auth/me`;
const API_PROXY_BASE_URL = `http://localhost:${API_PROXY_PORT}`;
const CADDY_READY_URL = `${API_PROXY_BASE_URL}/auth/me`;
const STRIPE_WEBHOOK_FORWARD_URL = `${API_PROXY_BASE_URL}/stripe/webhook`;
const DEFAULT_STRIPE_SECRET_KEY = "sk_test_bindersnap_playwright";
const DEFAULT_STRIPE_PRICE_ID = "price_bindersnap_playwright";

function log(message: string): void {
  process.stdout.write(`[global-setup] ${message}\n`);
}

function composeDown(env: NodeJS.ProcessEnv): void {
  spawnSync("docker", [...COMPOSE_ARGS, "down", "-v", "--remove-orphans"], {
    stdio: "ignore",
    env,
  });
}

function runComposeCommand(
  args: string[],
  env: NodeJS.ProcessEnv,
): ReturnType<typeof spawnSync> {
  return spawnSync("docker", [...COMPOSE_ARGS, ...args], {
    stdio: "pipe",
    encoding: "utf8",
    env,
  });
}

function printComposeOutput(label: string, output?: string | null): void {
  const trimmed = output?.trim();
  if (!trimmed) {
    return;
  }

  process.stderr.write(`[global-setup] ${label}\n${trimmed}\n`);
}

function collectFailedServiceLogs(env: NodeJS.ProcessEnv): void {
  const ps = runComposeCommand(["ps", "-a"], env);
  printComposeOutput("docker compose ps -a", ps.stdout);
  printComposeOutput("docker compose ps -a stderr", ps.stderr);

  const exitedServices = runComposeCommand(
    ["ps", "-a", "--status", "exited", "--services"],
    env,
  );

  const serviceNames = new Set(
    (exitedServices.stdout ?? "")
      .split("\n")
      .map((name) => name.trim())
      .filter((name) => name.length > 0),
  );

  if (serviceNames.size === 0) {
    serviceNames.add("seed");
  }

  for (const service of serviceNames) {
    const logs = runComposeCommand(["logs", "--no-color", service], env);
    printComposeOutput(`docker compose logs ${service}`, logs.stdout);
    printComposeOutput(`docker compose logs ${service} stderr`, logs.stderr);
  }
}

async function waitForUrl(
  url: string,
  attempts: number,
  delayMs: number,
  isReady: (response: Response) => boolean = (response) => response.ok,
): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetch(url);
      if (isReady(response)) {
        return;
      }
    } catch {
      // Connection refused or similar — keep polling.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
  }
  throw new Error(
    `Timed out after ${attempts * delayMs}ms waiting for ${url} to become reachable.`,
  );
}

export default async function globalSetup(): Promise<void> {
  // Load .env before anything else — safety net for direct `bunx playwright
  // test` invocations that bypass `bun run` and its automatic .env loading.
  loadEnvFile();

  if (process.env.SKIP_STACK !== "1" && !existsSync(COMPOSE_FILE)) {
    throw new Error(`docker-compose.yml not found at: ${COMPOSE_FILE}`);
  }

  // Force the integration run through the local proxy so test workers and the
  // app container share the same ingress path.
  process.env.BUN_PUBLIC_API_BASE_URL = API_PROXY_BASE_URL;
  process.env.BUN_PUBLIC_API_URL = API_PROXY_BASE_URL;
  process.env.VITE_API_URL = API_PROXY_BASE_URL;
  process.env.WEBHOOK_PROXY_BASE_URL = API_PROXY_BASE_URL;

  const hasConfiguredWebhookSecret =
    (process.env.STRIPE_WEBHOOK_SECRET ?? "").trim() !== "";
  const hasStripeListenerInputs =
    (process.env.STRIPE_SECRET_KEY ?? "").trim() !== "" &&
    (process.env.STRIPE_PRICE_ID ?? "").trim() !== "";

  if (
    process.env.SKIP_STACK !== "1" &&
    !hasConfiguredWebhookSecret &&
    !hasStripeListenerInputs
  ) {
    process.env.STRIPE_WEBHOOK_SECRET = DEFAULT_WEBHOOK_TEST_SECRET;
  }

  // When managing the full stack AND real Stripe credentials are available,
  // always clear any stale STRIPE_WEBHOOK_SECRET that may have leaked into
  // process.env from a prior run. ensureStripeWebhookSecret will start a
  // fresh `stripe listen` session and inject the correct secret.
  // This prevents stale secrets from suppressing the CLI listener and causing
  // webhook delivery to fail in back-to-back test runs.
  if (process.env.SKIP_STACK !== "1" && hasStripeListenerInputs) {
    delete process.env.STRIPE_WEBHOOK_SECRET;
  }

  if (process.env.SKIP_STACK !== "1") {
    const dockerCheck = spawnSync("docker", ["info"], { stdio: "ignore" });
    if (dockerCheck.status !== 0) {
      throw new Error(
        "Docker is not running or not installed. Start Docker and retry.",
      );
    }
  }

  await ensureStripeWebhookSecret({
    allowFallbackSecret: process.env.SKIP_STACK !== "1",
    env: process.env,
    // Forward webhooks through the local Caddy proxy so integration runs
    // exercise the same forwarded-header contract as production.
    forwardTo: STRIPE_WEBHOOK_FORWARD_URL,
    log,
  });

  if (process.env.SKIP_STACK === "1") {
    log("SKIP_STACK=1 — assuming stack is already running.");
    if (process.env.STRIPE_WEBHOOK_SECRET) {
      log(
        "Stripe listener started. Note: the running API must have been started with the same " +
          "STRIPE_WEBHOOK_SECRET for signature-verification tests to pass. " +
          "Set STRIPE_WEBHOOK_SECRET in .env before `bun run up` to satisfy that requirement.",
      );
    }
    return;
  }

  const composeEnv = {
    ...process.env,
    STACK_NAME,
    APP_PORT,
    API_PORT,
    API_PROXY_PORT,
    GITEA_PORT,
    HOCUSPOCUS_PORT,
    STRIPE_SECRET_KEY:
      process.env.STRIPE_SECRET_KEY || DEFAULT_STRIPE_SECRET_KEY,
    STRIPE_PRICE_ID: process.env.STRIPE_PRICE_ID || DEFAULT_STRIPE_PRICE_ID,
  };

  try {
    log("Tearing down any previous stack...");
    composeDown(composeEnv);

    log("Starting integration stack (docker compose up --build -d)...");
    const up = spawnSync("docker", [...COMPOSE_ARGS, "up", "--build", "-d"], {
      stdio: "inherit",
      env: composeEnv,
    });

    if (up.status !== 0) {
      log("docker compose up failed. Collecting logs from exited services...");
      collectFailedServiceLogs(composeEnv);
      throw new Error("docker compose up failed — see output above.");
    }

    log(`Waiting for API at ${API_READY_URL} ...`);
    await waitForUrl(
      API_READY_URL,
      60,
      2000,
      (response) => response.status < 500,
    );

    log(`Waiting for Caddy proxy at ${CADDY_READY_URL} ...`);
    await waitForUrl(
      CADDY_READY_URL,
      60,
      2000,
      (response) => response.status < 500,
    );

    log(`Waiting for app at ${APP_BASE_URL} ...`);
    await waitForUrl(APP_BASE_URL, 60, 2000);
    log("Stack is ready.");
  } catch (error) {
    try {
      stopStripeWebhookSecretRuntime({ log });
    } catch {}
    throw error;
  }
}
